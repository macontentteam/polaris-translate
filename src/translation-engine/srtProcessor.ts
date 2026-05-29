import { SRTConstraints, GlossaryEntry } from './types';

// ============================================
// TYPES
// ============================================

export interface SRTCue {
  index: number;
  startTime: string;
  endTime: string;
  startSeconds: number;
  endSeconds: number;
  duration: number;
  lines: string[];
  text: string;
}

export interface SRTDocument {
  cues: SRTCue[];
  totalDuration: number;
  totalCues: number;
}

export interface JoinedSentence {
  text: string;
  cueIndices: number[];
  cues: SRTCue[];
}

export interface SRTTranslationBlock {
  sentenceIndex: number;
  originalSentence: string;
  translatedSentence: string;
  cues: SRTCue[];
  cueIndices: number[];
}

export interface FittedCue {
  index: number;
  startTime: string;
  endTime: string;
  startSeconds: number;
  endSeconds: number;
  duration: number;
  originalText: string;
  translatedLines: string[];
  translatedText: string;
  cps: number;
  maxCharsPerLine: number;
  lineCount: number;
  violations: CueViolation[];
  usedSrtShort: boolean;
}

export interface CueViolation {
  type: 'cps_exceeded' | 'line_too_long' | 'too_many_lines' | 'glossary_abbreviation_used';
  message: string;
  severity: 'critical' | 'warning' | 'info';
  value: number;
  limit: number;
}

export interface SRTProcessingResult {
  fittedCues: FittedCue[];
  srtOutput: string;
  totalViolations: number;
  criticalViolations: number;
  warningViolations: number;
  srtShortSubstitutions: number;
  stats: {
    totalCues: number;
    avgCps: number;
    maxCps: number;
    avgCharsPerLine: number;
    maxCharsPerLine: number;
    cuesExceedingCps: number;
    cuesExceedingLineLength: number;
  };
}

// ============================================
// SRT PARSER
// ============================================

const parseTimecode = (tc: string): number => {
  const match = tc.trim().match(/(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/);
  if (!match) return 0;
  const [, h, m, s, ms] = match;
  return parseInt(h) * 3600 + parseInt(m) * 60 + parseInt(s) + parseInt(ms) / 1000;
};

const formatTimecode = (seconds: number): string => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
};

export const parseSRT = (content: string): SRTDocument => {
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const stripped = normalized.replace(/^﻿/, '');
  const blocks = stripped.split(/\n\n+/).filter(b => b.trim());

  const cues: SRTCue[] = [];

  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length < 2) continue;

    const timeLineIdx = lines.findIndex(l =>
      /\d{2}:\d{2}:\d{2}[,.]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[,.]\d{3}/.test(l)
    );
    if (timeLineIdx < 0) continue;

    const timeMatch = lines[timeLineIdx].match(
      /(\d{2}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,.]\d{3})/
    );
    if (!timeMatch) continue;

    const indexLine = timeLineIdx > 0 ? lines[timeLineIdx - 1].trim() : '';
    const index = /^\d+$/.test(indexLine) ? parseInt(indexLine) : cues.length + 1;

    const startTime = timeMatch[1];
    const endTime = timeMatch[2];
    const startSeconds = parseTimecode(startTime);
    const endSeconds = parseTimecode(endTime);
    const duration = endSeconds - startSeconds;

    const textLines = lines.slice(timeLineIdx + 1).filter(l => l.trim());

    cues.push({
      index,
      startTime,
      endTime,
      startSeconds,
      endSeconds,
      duration,
      lines: textLines,
      text: textLines.join(' '),
    });
  }

  const totalDuration = cues.length > 0
    ? cues[cues.length - 1].endSeconds - cues[0].startSeconds
    : 0;

  return { cues, totalDuration, totalCues: cues.length };
};

// ============================================
// SENTENCE JOINER
// ============================================
// Solves the #1 DeepL failure: sentences that span multiple cues
// get fragmented because each cue is translated independently.
// We join cues that form part of the same sentence before translation,
// then re-split the translated text back into individual cues afterward.

const SENTENCE_ENDINGS = /[.!?;:]\s*$/;
const SENTENCE_ENDINGS_STRONG = /[.!?]\s*$/;

export const joinSentences = (doc: SRTDocument): JoinedSentence[] => {
  const sentences: JoinedSentence[] = [];
  let currentText = '';
  let currentIndices: number[] = [];
  let currentCues: SRTCue[] = [];

  for (let i = 0; i < doc.cues.length; i++) {
    const cue = doc.cues[i];
    const joinedCueText = cue.lines.join(' ').trim();

    currentText += (currentText ? ' ' : '') + joinedCueText;
    currentIndices.push(i);
    currentCues.push(cue);

    const endsWithSentence = SENTENCE_ENDINGS_STRONG.test(joinedCueText);
    const isLastCue = i === doc.cues.length - 1;

    const hasLargeTimeGap = i < doc.cues.length - 1 &&
      (doc.cues[i + 1].startSeconds - cue.endSeconds) > 1.0;

    if (endsWithSentence || isLastCue || hasLargeTimeGap) {
      sentences.push({
        text: currentText.trim(),
        cueIndices: [...currentIndices],
        cues: [...currentCues],
      });
      currentText = '';
      currentIndices = [];
      currentCues = [];
    }
  }

  return sentences;
};

// ============================================
// TRANSLATION BLOCK BUILDER
// ============================================
// Prepares the joined sentences for batch translation.
// Each block maps a joined English sentence to its target cues.

export const buildTranslationBlocks = (
  sentences: JoinedSentence[],
  translations: string[]
): SRTTranslationBlock[] => {
  return sentences.map((s, i) => ({
    sentenceIndex: i,
    originalSentence: s.text,
    translatedSentence: translations[i] || '',
    cues: s.cues,
    cueIndices: s.cueIndices,
  }));
};

// ============================================
// TEXT FITTING ENGINE
// ============================================
// Takes a translated sentence and distributes it across its original
// cue timing windows, respecting CPS and line-length constraints.
// This is the core differentiator vs. DeepL.

const splitIntoLines = (text: string, maxCharsPerLine: number): string[] => {
  if (text.length <= maxCharsPerLine) return [text];

  const words = text.split(/\s+/);
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    if (testLine.length <= maxCharsPerLine) {
      currentLine = testLine;
    } else {
      if (currentLine) lines.push(currentLine);
      currentLine = word;
    }
  }
  if (currentLine) lines.push(currentLine);

  return lines;
};

const findNaturalBreakPoint = (text: string, maxCharsPerLine: number): number => {
  if (text.length <= maxCharsPerLine) return text.length;

  const breakChars = [',', ';', ':', ' '];
  const searchRegion = text.substring(0, maxCharsPerLine + 1);

  for (const char of breakChars) {
    const lastIdx = searchRegion.lastIndexOf(char);
    if (lastIdx > maxCharsPerLine * 0.3) return lastIdx + 1;
  }

  const lastSpace = searchRegion.lastIndexOf(' ');
  if (lastSpace > 0) return lastSpace + 1;

  return maxCharsPerLine;
};

const distributeTextAcrossCues = (
  translatedSentence: string,
  cues: SRTCue[],
  constraints: SRTConstraints['constraints']
): { text: string; charBudget: number }[] => {
  const maxCps = constraints.timing_readability.target_cps;
  const totalDuration = cues.reduce((sum, c) => sum + c.duration, 0);
  const totalChars = translatedSentence.length;

  if (cues.length === 1) {
    return [{ text: translatedSentence, charBudget: Math.floor(cues[0].duration * maxCps) }];
  }

  const distributions: { text: string; charBudget: number }[] = [];
  const words = translatedSentence.split(/\s+/);
  let wordIdx = 0;

  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i];
    const proportionalShare = totalDuration > 0 ? cue.duration / totalDuration : 1 / cues.length;
    const charBudget = Math.floor(totalChars * proportionalShare);
    const targetWordCount = Math.max(1, Math.round(words.length * proportionalShare));

    const isLast = i === cues.length - 1;
    let cueWords: string[];

    if (isLast) {
      cueWords = words.slice(wordIdx);
    } else {
      cueWords = words.slice(wordIdx, wordIdx + targetWordCount);

      const candidateText = cueWords.join(' ');
      const lastPunct = candidateText.search(/[,;:.!?]\s*\S*$/);
      if (lastPunct > candidateText.length * 0.5) {
        const wordsBeforePunct = candidateText.substring(0, lastPunct + 1).split(/\s+/).length;
        cueWords = words.slice(wordIdx, wordIdx + wordsBeforePunct);
      }
    }

    distributions.push({
      text: cueWords.join(' '),
      charBudget: Math.floor(cue.duration * maxCps),
    });

    wordIdx += cueWords.length;
  }

  return distributions;
};

// ============================================
// SRT_SHORT SUBSTITUTION ENGINE
// ============================================
// When a cue exceeds CPS limits, attempt to shorten using pre-approved
// srt_short abbreviations from the glossary.

const applySrtShortSubstitutions = (
  text: string,
  glossaryEntries: GlossaryEntry[],
  maxChars: number
): { text: string; substitutionsMade: number } => {
  let result = text;
  let substitutionsMade = 0;

  if (result.length <= maxChars) return { text: result, substitutionsMade: 0 };

  const shortableEntries = glossaryEntries
    .filter(e => e.srt_short && e.target_approved && e.srt_short !== e.target_approved)
    .sort((a, b) => (b.target_approved?.length || 0) - (a.target_approved?.length || 0));

  for (const entry of shortableEntries) {
    if (result.length <= maxChars) break;

    const fullForm = entry.target_approved;
    const shortForm = entry.srt_short!;

    if (result.includes(fullForm)) {
      result = result.replace(fullForm, shortForm);
      substitutionsMade++;
    }
  }

  return { text: result, substitutionsMade };
};

// ============================================
// CONSTRAINT ENFORCER
// ============================================
// Validates each fitted cue against the language's SRT constraints
// and reports violations.

const enforceCueConstraints = (
  translatedText: string,
  cue: SRTCue,
  constraints: SRTConstraints['constraints'],
  glossaryEntries: GlossaryEntry[]
): FittedCue => {
  const maxCps = constraints.timing_readability.target_cps;
  const maxCharsPerLine = constraints.visual_formatting.max_chars_per_line;
  const maxLines = constraints.visual_formatting.max_lines_per_subtitle;

  const violations: CueViolation[] = [];
  let usedSrtShort = false;

  let charBudget = Math.floor(cue.duration * maxCps);
  let workingText = translatedText;

  if (workingText.length > charBudget) {
    const shortened = applySrtShortSubstitutions(workingText, glossaryEntries, charBudget);
    if (shortened.substitutionsMade > 0) {
      workingText = shortened.text;
      usedSrtShort = true;
      violations.push({
        type: 'glossary_abbreviation_used',
        message: `${shortened.substitutionsMade} srt_short substitution(s) applied to fit timing`,
        severity: 'info',
        value: shortened.substitutionsMade,
        limit: 0,
      });
    }
  }

  const lines = splitIntoLines(workingText, maxCharsPerLine);

  const totalChars = lines.join('').length;
  const cps = cue.duration > 0 ? totalChars / cue.duration : 0;

  if (cps > maxCps * 1.2) {
    violations.push({
      type: 'cps_exceeded',
      message: `CPS ${cps.toFixed(1)} exceeds limit ${maxCps} by more than 20%`,
      severity: 'critical',
      value: Math.round(cps * 10) / 10,
      limit: maxCps,
    });
  } else if (cps > maxCps) {
    violations.push({
      type: 'cps_exceeded',
      message: `CPS ${cps.toFixed(1)} slightly exceeds target ${maxCps}`,
      severity: 'warning',
      value: Math.round(cps * 10) / 10,
      limit: maxCps,
    });
  }

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].length > maxCharsPerLine) {
      violations.push({
        type: 'line_too_long',
        message: `Line ${i + 1}: ${lines[i].length} chars exceeds ${maxCharsPerLine} limit`,
        severity: 'warning',
        value: lines[i].length,
        limit: maxCharsPerLine,
      });
    }
  }

  if (lines.length > maxLines) {
    violations.push({
      type: 'too_many_lines',
      message: `${lines.length} lines exceeds ${maxLines} line limit`,
      severity: 'warning',
      value: lines.length,
      limit: maxLines,
    });
  }

  return {
    index: cue.index,
    startTime: cue.startTime,
    endTime: cue.endTime,
    startSeconds: cue.startSeconds,
    endSeconds: cue.endSeconds,
    duration: cue.duration,
    originalText: cue.text,
    translatedLines: lines.slice(0, maxLines),
    translatedText: lines.slice(0, maxLines).join('\n'),
    cps: Math.round(cps * 10) / 10,
    maxCharsPerLine: Math.max(...lines.map(l => l.length)),
    lineCount: Math.min(lines.length, maxLines),
    violations,
    usedSrtShort,
  };
};

// ============================================
// SRT WRITER
// ============================================

export const writeSRT = (fittedCues: FittedCue[]): string => {
  return fittedCues
    .map((cue, i) => {
      const index = i + 1;
      const timeLine = `${cue.startTime} --> ${cue.endTime}`;
      const text = cue.translatedText;
      return `${index}\n${timeLine}\n${text}`;
    })
    .join('\n\n') + '\n';
};

// ============================================
// FULL PIPELINE: PROCESS SRT TRANSLATION
// ============================================
// This is the main entry point. It takes:
// 1. The parsed English master SRT
// 2. An array of translated sentences (one per joined sentence group)
// 3. The language's SRT constraints and glossary entries
//
// It distributes translations across cue timing windows,
// enforces constraints, and produces the final SRT.

export const processSRTTranslation = (
  masterSRT: SRTDocument,
  sentences: JoinedSentence[],
  translations: string[],
  constraints: SRTConstraints,
  glossaryEntries: GlossaryEntry[]
): SRTProcessingResult => {
  const blocks = buildTranslationBlocks(sentences, translations);
  const fittedCues: FittedCue[] = [];
  let totalSrtShortSubs = 0;

  for (const block of blocks) {
    const distributions = distributeTextAcrossCues(
      block.translatedSentence,
      block.cues,
      constraints.constraints
    );

    for (let i = 0; i < block.cues.length; i++) {
      const cue = block.cues[i];
      const dist = distributions[i];
      if (!dist) continue;

      const fitted = enforceCueConstraints(
        dist.text,
        cue,
        constraints.constraints,
        glossaryEntries
      );

      if (fitted.usedSrtShort) totalSrtShortSubs++;
      fittedCues.push(fitted);
    }
  }

  fittedCues.sort((a, b) => a.startSeconds - b.startSeconds);

  const allViolations = fittedCues.flatMap(c => c.violations);
  const criticalViolations = allViolations.filter(v => v.severity === 'critical').length;
  const warningViolations = allViolations.filter(v => v.severity === 'warning').length;

  const allCps = fittedCues.filter(c => c.duration > 0).map(c => c.cps);
  const allLineLengths = fittedCues.flatMap(c => c.translatedLines.map(l => l.length));

  const srtOutput = writeSRT(fittedCues);

  return {
    fittedCues,
    srtOutput,
    totalViolations: allViolations.length,
    criticalViolations,
    warningViolations,
    srtShortSubstitutions: totalSrtShortSubs,
    stats: {
      totalCues: fittedCues.length,
      avgCps: allCps.length > 0 ? Math.round((allCps.reduce((a, b) => a + b, 0) / allCps.length) * 10) / 10 : 0,
      maxCps: allCps.length > 0 ? Math.max(...allCps) : 0,
      avgCharsPerLine: allLineLengths.length > 0 ? Math.round(allLineLengths.reduce((a, b) => a + b, 0) / allLineLengths.length) : 0,
      maxCharsPerLine: allLineLengths.length > 0 ? Math.max(...allLineLengths) : 0,
      cuesExceedingCps: fittedCues.filter(c => c.cps > constraints.constraints.timing_readability.target_cps).length,
      cuesExceedingLineLength: fittedCues.filter(c => c.maxCharsPerLine > constraints.constraints.visual_formatting.max_chars_per_line).length,
    },
  };
};

// ============================================
// SRT TRANSLATION PROMPT BUILDER
// ============================================
// Builds the prompt for translating joined sentences in SRT mode.
// Each sentence includes its timing budget so the AI can prioritize
// conciseness when space is tight.

export const buildSRTTranslationPrompt = (
  sentences: JoinedSentence[],
  targetLanguage: string,
  constraints: SRTConstraints,
  glossaryBlock: string,
  idiomBlock: string,
  safeguardsBlock: string,
  formalityInstruction: string,
  qaOverridesBlock: string = ""
): string => {
  const maxCps = constraints.constraints.timing_readability.target_cps;
  const maxCharsPerLine = constraints.constraints.visual_formatting.max_chars_per_line;
  const maxLines = constraints.constraints.visual_formatting.max_lines_per_subtitle;

  const sentenceList = sentences.map((s, i) => {
    const totalDuration = s.cues.reduce((sum, c) => sum + c.duration, 0);
    const charBudget = Math.floor(totalDuration * maxCps);
    return `[${i + 1}] (${totalDuration.toFixed(1)}s, max ~${charBudget} chars) ${s.text}`;
  }).join('\n');

  return `You are a native ${targetLanguage} professional subtitle translator specializing in cybersecurity training content.

TASK: Translate each numbered English sentence into ${targetLanguage} for use in subtitles. Each sentence has a timing budget showing the available duration and approximate character limit. Translations MUST be concise enough to fit these constraints.

SUBTITLE CONSTRAINTS (non-negotiable):
- Maximum ${maxCps} characters per second (CPS)
- Maximum ${maxCharsPerLine} characters per line
- Maximum ${maxLines} lines per subtitle block
- Prioritize clarity and brevity over literal accuracy when space is tight
- Use approved srt_short abbreviations from the glossary when the full term would exceed the character budget

FORMALITY: ${formalityInstruction}
${glossaryBlock}${idiomBlock}${safeguardsBlock}${qaOverridesBlock}

CRITICAL RULES:
- Each sentence may span multiple subtitle cues. Translate the FULL meaning concisely.
- Do NOT add words, explanations, or content not in the source.
- Do NOT split a numbered sentence into multiple numbered outputs.
- If a translation would be too long for its timing budget, condense naturally rather than truncating.
- Preserve technical terms (URLs, product names) unchanged unless in the glossary.

SENTENCES TO TRANSLATE:
${sentenceList}

OUTPUT FORMAT:
Return ONLY the translations, one per line, numbered to match the input. Example:
[1] Translated sentence one
[2] Translated sentence two

No preamble, no explanations, no notes.`;
};

// ============================================
// PARSE TRANSLATION RESPONSE
// ============================================

export const parseTranslationResponse = (response: string, expectedCount: number): string[] => {
  const lines = response.trim().split('\n').filter(l => l.trim());
  const translations: string[] = [];

  for (const line of lines) {
    const match = line.match(/^\[(\d+)\]\s*(.+)$/);
    if (match) {
      const idx = parseInt(match[1]) - 1;
      const text = match[2].trim();
      translations[idx] = text;
    }
  }

  for (let i = 0; i < expectedCount; i++) {
    if (!translations[i]) translations[i] = '';
  }

  return translations.slice(0, expectedCount);
};

// ============================================
// VALIDATION SUMMARY
// ============================================

export interface SRTValidationSummary {
  isReady: boolean;
  totalCues: number;
  passingCues: number;
  warningCues: number;
  failingCues: number;
  srtShortSubstitutions: number;
  avgCps: number;
  maxCps: number;
  recommendations: string[];
}

export const generateValidationSummary = (result: SRTProcessingResult, constraints: SRTConstraints): SRTValidationSummary => {
  const maxCps = constraints.constraints.timing_readability.target_cps;

  const failingCues = result.fittedCues.filter(c =>
    c.violations.some(v => v.severity === 'critical')
  ).length;

  const warningCues = result.fittedCues.filter(c =>
    !c.violations.some(v => v.severity === 'critical') &&
    c.violations.some(v => v.severity === 'warning')
  ).length;

  const passingCues = result.fittedCues.length - failingCues - warningCues;

  const recommendations: string[] = [];

  if (failingCues > 0) {
    recommendations.push(`${failingCues} cue(s) critically exceed CPS limits. Consider condensing the translation or splitting cues.`);
  }
  if (warningCues > 0) {
    recommendations.push(`${warningCues} cue(s) slightly exceed constraints. Review for natural condensation opportunities.`);
  }
  if (result.srtShortSubstitutions > 0) {
    recommendations.push(`${result.srtShortSubstitutions} glossary abbreviation(s) were applied automatically. Verify they read naturally.`);
  }
  if (result.stats.maxCps > maxCps * 1.5) {
    recommendations.push(`Peak CPS of ${result.stats.maxCps} is very high. The affected cue(s) may need human review or cue splitting.`);
  }

  return {
    isReady: failingCues === 0,
    totalCues: result.fittedCues.length,
    passingCues,
    warningCues,
    failingCues,
    srtShortSubstitutions: result.srtShortSubstitutions,
    avgCps: result.stats.avgCps,
    maxCps: result.stats.maxCps,
    recommendations,
  };
};
