import JSZip from 'jszip';

// ============================================
// TYPES
// ============================================

export interface StoryboardShot {
  shotNumber: string;
  camera: string;
  action: string;
  dialog: string;           // English text from DIALOG column
  existingTranslation: string; // Existing translation (if any) from TRANSLATION column
  startTime: string;         // e.g. "00:00"
  endTime: string;           // e.g. "00:27"
  startSeconds: number;
  endSeconds: number;
  duration: number;
  slideNumber: number;
  speakers: string[];        // Extracted speaker names (e.g. ["Doug", "William"])
}

export interface StoryboardDocument {
  title: string;
  shots: StoryboardShot[];
  totalDuration: number;
  totalShots: number;
  slideCount: number;
  storyboardSlides: number[];  // Which slide numbers contain storyboard tables
  moodBoardSlides: number[];   // Which slide numbers are mood board / non-table slides
}

export interface StoryboardTranslationResult {
  shot: StoryboardShot;
  translatedDialog: string;
  speakerSegments: SpeakerSegment[];
  timingFit: 'good' | 'tight' | 'over';
  characterExpansion: number;  // Percentage expansion vs English
}

export interface SpeakerSegment {
  speaker: string;
  englishText: string;
  translatedText: string;
}

export interface StoryboardProcessingResult {
  shots: StoryboardTranslationResult[];
  stats: {
    totalShots: number;
    goodFit: number;
    tightFit: number;
    overFit: number;
    avgExpansion: number;
    maxExpansion: number;
    totalDuration: number;
  };
}

// ============================================
// TIMECODE PARSER
// ============================================
// Storyboard timecodes are in MM:SS format (not SRT's HH:MM:SS,mmm)

const parseStoryboardTimecode = (tc: string): number => {
  const trimmed = tc.trim();
  const parts = trimmed.split(':');
  if (parts.length === 2) {
    // MM:SS format
    return parseInt(parts[0]) * 60 + parseInt(parts[1]);
  } else if (parts.length === 3) {
    // HH:MM:SS format
    return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseInt(parts[2]);
  }
  return 0;
};

const formatTimecodeDisplay = (tc: string): string => {
  // Keep the original format for display
  return tc.trim();
};

// ============================================
// SPEAKER EXTRACTOR
// ============================================
// Parses dialog text to find speaker labels like "Doug:" or "William (off camera):"

const extractSpeakers = (dialog: string): string[] => {
  const speakerPattern = /^([A-Z][a-zA-Z]+(?:\s*\([^)]*\))?)\s*:/gm;
  const speakers = new Set<string>();
  let match;
  while ((match = speakerPattern.exec(dialog)) !== null) {
    // Normalize: strip parenthetical notes for the speaker name
    const name = match[1].replace(/\s*\([^)]*\)/, '').trim();
    speakers.add(name);
  }
  return Array.from(speakers);
};

// Split dialog into speaker segments
const splitBySpeaker = (dialog: string): SpeakerSegment[] => {
  const segments: SpeakerSegment[] = [];
  // Match speaker labels, including parenthetical notes like "(off camera)"
  const parts = dialog.split(/(?=^[A-Z][a-zA-Z]+(?:\s*\([^)]*\))?\s*:)/m);

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    const labelMatch = trimmed.match(/^([A-Z][a-zA-Z]+(?:\s*\([^)]*\))?)\s*:\s*([\s\S]*)/);
    if (labelMatch) {
      segments.push({
        speaker: labelMatch[1].replace(/\s*\([^)]*\)/, '').trim(),
        englishText: labelMatch[2].trim(),
        translatedText: '',
      });
    } else if (segments.length > 0) {
      // Continuation of previous speaker
      segments[segments.length - 1].englishText += '\n' + trimmed;
    } else {
      // No speaker label, treat as narration
      segments.push({
        speaker: 'Narration',
        englishText: trimmed,
        translatedText: '',
      });
    }
  }

  return segments;
};

// ============================================
// PPTX XML TABLE PARSER
// ============================================
// PPTX tables are stored as XML in slide files.
// We look for <a:tbl> elements and extract cell text.

interface ParsedTable {
  headers: string[];
  rows: Record<string, string>[];
}

const extractTextFromXmlElement = (xml: string): string => {
  // Extract all <a:t> text nodes from an XML fragment
  // IMPORTANT: Use negative lookahead (?![a-zA-Z]) to avoid matching
  // <a:txBody>, <a:tbl>, <a:tcPr>, etc. Only match the actual <a:t> element.
  //
  // Strategy: Split by <a:p> paragraphs first (each paragraph = a line),
  // then within each paragraph handle <a:br/> line breaks.

  // Split into paragraphs by <a:p> boundaries
  const paragraphs = xml.split(/<\/a:p>/);
  const lines: string[] = [];

  for (const para of paragraphs) {
    // Handle <a:br/> line breaks within the paragraph
    let processed = para;
    processed = processed.replace(/<a:br\s*\/>/g, '{{LINEBREAK}}');
    processed = processed.replace(/<a:br>/g, '{{LINEBREAK}}');

    const segments = processed.split('{{LINEBREAK}}');
    for (const seg of segments) {
      const segTexts: string[] = [];
      const segRegex = /<a:t(?![a-zA-Z])[^>]*>([\s\S]*?)<\/a:t>/g;
      let segMatch;
      while ((segMatch = segRegex.exec(seg)) !== null) {
        segTexts.push(segMatch[1]);
      }
      if (segTexts.length > 0) {
        lines.push(segTexts.join(''));
      }
    }
  }

  return lines.join('\n').trim();
};

const parseTableFromSlideXml = (slideXml: string): ParsedTable | null => {
  // Find <a:tbl> element
  const tblMatch = slideXml.match(/<a:tbl>[\s\S]*?<\/a:tbl>/);
  if (!tblMatch) return null;

  const tblXml = tblMatch[0];

  // Extract rows: <a:tr> elements
  const rowRegex = /<a:tr\b[^>]*>([\s\S]*?)<\/a:tr>/g;
  const rows: string[][] = [];
  let rowMatch;

  while ((rowMatch = rowRegex.exec(tblXml)) !== null) {
    const rowXml = rowMatch[1];
    // Extract cells: <a:tc> elements
    const cellRegex = /<a:tc\b[^>]*>([\s\S]*?)<\/a:tc>/g;
    const cells: string[] = [];
    let cellMatch;

    while ((cellMatch = cellRegex.exec(rowXml)) !== null) {
      cells.push(extractTextFromXmlElement(cellMatch[1]));
    }
    rows.push(cells);
  }

  if (rows.length < 2) return null;

  const headers = rows[0].map(h => h.trim().toUpperCase());
  const dataRows: Record<string, string>[] = [];

  for (let i = 1; i < rows.length; i++) {
    const record: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      record[headers[j]] = rows[i][j] || '';
    }
    dataRows.push(record);
  }

  return { headers, rows: dataRows };
};

// ============================================
// PPTX PARSER - MAIN ENTRY POINT
// ============================================

export const parseStoryboardPPTX = async (file: File): Promise<StoryboardDocument> => {
  const arrayBuffer = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(arrayBuffer);

  // Get slide count from [Content_Types].xml or by counting slide files
  const slideFiles: { num: number; path: string }[] = [];
  zip.forEach((path) => {
    const slideMatch = path.match(/ppt\/slides\/slide(\d+)\.xml$/);
    if (slideMatch) {
      slideFiles.push({ num: parseInt(slideMatch[1]), path });
    }
  });

  slideFiles.sort((a, b) => a.num - b.num);

  const shots: StoryboardShot[] = [];
  const storyboardSlides: number[] = [];
  const moodBoardSlides: number[] = [];
  let title = file.name.replace(/\.pptx$/i, '');

  for (const slideFile of slideFiles) {
    const slideXml = await zip.file(slideFile.path)?.async('string');
    if (!slideXml) continue;

    const table = parseTableFromSlideXml(slideXml);

    if (!table) {
      moodBoardSlides.push(slideFile.num);
      // Try to extract title from first slide's text
      if (slideFile.num === 1) {
        const titleMatch = slideXml.match(/<a:t[^>]*>([^<]*(?:Storyboard|Production|Script)[^<]*)<\/a:t>/i);
        if (titleMatch) {
          title = titleMatch[1].trim();
        }
      }
      continue;
    }

    // Check if this table has the storyboard columns we need
    const hasDialog = table.headers.some(h => h === 'DIALOG' || h === 'DIALOGUE');
    const hasTranslation = table.headers.includes('TRANSLATION');
    const hasTime = table.headers.includes('TIME') || table.headers.includes('TIMECODE');

    if (!hasDialog) {
      moodBoardSlides.push(slideFile.num);
      continue;
    }

    storyboardSlides.push(slideFile.num);

    for (const row of table.rows) {
      const dialog = row['DIALOG'] || row['DIALOGUE'] || '';
      if (!dialog.trim()) continue;

      const translation = row['TRANSLATION'] || '';
      const timeRaw = row['TIME'] || row['TIMECODE'] || '';
      const shotNum = row['SHOT'] || (shots.length + 1).toString();
      const camera = row['CAM'] || row['CAMERA'] || '';
      const action = row['ACTION'] || '';

      // Parse timecode: format is "MM:SS\nMM:SS" (start on first line, end on second)
      const timeLines = timeRaw.split('\n').map(t => t.trim()).filter(Boolean);
      const startTime = timeLines[0] || '00:00';
      const endTime = timeLines[1] || timeLines[0] || '00:00';
      const startSeconds = parseStoryboardTimecode(startTime);
      const endSeconds = parseStoryboardTimecode(endTime);

      const speakers = extractSpeakers(dialog);

      shots.push({
        shotNumber: shotNum.trim(),
        camera: camera.trim(),
        action: action.trim(),
        dialog: dialog.trim(),
        existingTranslation: translation.trim(),
        startTime: formatTimecodeDisplay(startTime),
        endTime: formatTimecodeDisplay(endTime),
        startSeconds,
        endSeconds,
        duration: Math.max(0, endSeconds - startSeconds),
        slideNumber: slideFile.num,
        speakers,
      });
    }
  }

  // Try to get a better title from slide 1
  const slide1 = await zip.file('ppt/slides/slide1.xml')?.async('string');
  if (slide1) {
    // Look for substantial text that could be the project title
    const allTexts: string[] = [];
    const textRegex = /<a:t[^>]*>([^<]+)<\/a:t>/g;
    let m;
    while ((m = textRegex.exec(slide1)) !== null) {
      const t = m[1].trim();
      if (t.length > 5 && !t.match(/^(Inspiration|Modeled|Lorem)/i)) {
        allTexts.push(t);
      }
    }
    if (allTexts.length > 0) {
      // Take the first substantial text as title
      title = allTexts[0].substring(0, 80);
    }
  }

  const totalDuration = shots.length > 0
    ? Math.max(...shots.map(s => s.endSeconds)) - Math.min(...shots.map(s => s.startSeconds))
    : 0;

  return {
    title,
    shots,
    totalDuration,
    totalShots: shots.length,
    slideCount: slideFiles.length,
    storyboardSlides,
    moodBoardSlides,
  };
};

// ============================================
// STORYBOARD TRANSLATION PROMPT BUILDER
// ============================================

export const buildStoryboardTranslationPrompt = (
  shots: StoryboardShot[],
  targetLanguage: string,
  glossaryBlock: string,
  idiomBlock: string,
  safeguardsBlock: string,
  formalityInstruction: string,
  qaOverridesBlock: string = ""
): string => {
  const shotList = shots.map((s, i) => {
    return `[SHOT ${s.shotNumber}] (${s.startTime} - ${s.endTime}, ${s.duration}s)
${s.dialog}`;
  }).join('\n\n');

  return `You are a native ${targetLanguage} professional translator specializing in video dubbing for cybersecurity training content. You translate dialog scripts so they can be voiced by native speakers and synced to the original video timing.

TASK: Translate each shot's dialog from English into ${targetLanguage}. Each shot has a timecode window showing when the dialog must be spoken. The translated dialog will be read by a voice actor and MUST fit naturally within the same time window as the English version.

DUBBING CONSTRAINTS:
- The translated dialog must be speakable within the shot's time window
- Preserve all speaker labels exactly (e.g. "Doug:", "William:") on their own line before their dialog
- Maintain the emotional tone, pacing, and dramatic beats of the original
- The dialog must sound natural when spoken aloud by a voice actor
- If the target language naturally expands (e.g. German, French), condense where possible without losing meaning
- Do NOT add or remove dialog beats. Every speaker turn in the English must appear in the translation.

FORMALITY AND REGISTER: ${formalityInstruction}
- This is enterprise cybersecurity training content. Default to formal register unless explicitly told otherwise.
- For German: use "Sie" (formal address), not "du". Use full verb forms ("haben", not "hab"). Maintain professional tone even in conversational dialog.
- For French: use "vous" (formal address), not "tu".
- For Spanish: use "usted" (formal address), not "tu".
- For Japanese: use desu/masu forms.
- Do NOT use slang, colloquialisms, or overly casual contractions unless the source English is explicitly casual AND the formality setting is informal.
${glossaryBlock}${idiomBlock}${safeguardsBlock}${qaOverridesBlock}

CRITICAL RULES:
- Preserve speaker labels EXACTLY as they appear (Doug:, William:, etc.)
- Each speaker's lines should start on a new line after the speaker label
- Keep the same number of dialog exchanges per shot
- Do NOT add stage directions, parentheticals, or translator notes
- Do NOT translate speaker names
- Technical terms (URLs, product names, acronyms) stay in English unless in the glossary

SHOTS TO TRANSLATE:
${shotList}

OUTPUT FORMAT:
Return ONLY the translations, one shot block per input shot. Use this exact format:

[SHOT ${shots[0]?.shotNumber || '1'}]
Speaker:
Translated dialog here...

[SHOT ${shots[1]?.shotNumber || '2'}]
Speaker:
Translated dialog here...

No preamble, no explanations, no notes. Just the translated dialog blocks.`;
};

// ============================================
// STORYBOARD AUDIT PROMPT
// ============================================

export const buildStoryboardAuditPrompt = (
  shots: StoryboardShot[],
  translations: string[],
  targetLanguage: string,
  formalityInstruction: string,
  safeguardsBlock: string,
  qaOverridesBlock: string,
  glossaryBlock: string
): string => {
  const pairs = shots.map((s, i) => {
    return `[SHOT ${s.shotNumber}] (${s.startTime} - ${s.endTime}, ${s.duration}s)
ENGLISH:
${s.dialog}

TRANSLATION:
${translations[i] || '(missing)'}`;
  }).join('\n\n---\n\n');

  return `You are a senior ${targetLanguage} translation reviewer for enterprise cybersecurity training content. Your job is to audit a dubbing translation and fix any errors.

REVIEW CHECKLIST:
1. FORMALITY: ${formalityInstruction}
   - For German: every instance of "du/dein/dir" must become "Sie/Ihr/Ihnen". Verb forms must be formal ("haben" not "hab", "sind" not "bist").
   - For Spanish: every instance of "tu/ti/tus" must become "usted/su/sus". Verb conjugations must match usted.
   - For French: every instance of "tu/ton/ta" must become "vous/votre/vos".
2. SPEAKER LABELS: Must be preserved exactly as in English (Doug:, William:, etc.). Never translated.
3. COMPLETENESS: Every speaker turn in the English must appear in the translation. No lines dropped, no lines added.
4. TIMING FIT: The translation should be roughly the same spoken length as the English. If it expanded significantly, condense without losing meaning.
5. NATURALNESS: The dialog must sound natural when spoken aloud. Not literary, not stilted, but professional.
${glossaryBlock}${safeguardsBlock}${qaOverridesBlock}

SHOTS TO REVIEW:
${pairs}

INSTRUCTIONS:
- If a shot is correct, output it unchanged.
- If a shot has errors, output the corrected version.
- Output ALL shots, even if unchanged, using the exact same [SHOT X] format.
- Do NOT add notes, explanations, or markup. Just the corrected translations.

OUTPUT FORMAT (same as translation format):
[SHOT ${shots[0]?.shotNumber || '1'}]
Speaker:
Corrected/verified dialog here...

[SHOT ${shots[1]?.shotNumber || '2'}]
Speaker:
Corrected/verified dialog here...

No preamble, no explanations. Just the verified/corrected dialog blocks.`;
};

// ============================================
// PARSE STORYBOARD TRANSLATION RESPONSE
// ============================================

export const parseStoryboardTranslationResponse = (
  response: string,
  shots: StoryboardShot[]
): string[] => {
  const translations: string[] = [];

  // Split by [SHOT X] markers
  const shotPattern = /\[SHOT\s+(\S+)\]/g;
  const markers: { shotNum: string; index: number }[] = [];
  let match;

  while ((match = shotPattern.exec(response)) !== null) {
    markers.push({ shotNum: match[1], index: match.index + match[0].length });
  }

  for (let i = 0; i < markers.length; i++) {
    const start = markers[i].index;
    const end = i + 1 < markers.length ? markers[i + 1].index - markers[i + 1].shotNum.length - 7 : response.length;
    const text = response.substring(start, end).trim();
    translations.push(text);
  }

  // Pad if we got fewer translations than shots
  while (translations.length < shots.length) {
    translations.push('');
  }

  return translations.slice(0, shots.length);
};

// ============================================
// PROCESS STORYBOARD TRANSLATIONS
// ============================================

export const processStoryboardTranslations = (
  doc: StoryboardDocument,
  translations: string[]
): StoryboardProcessingResult => {
  const results: StoryboardTranslationResult[] = [];

  for (let i = 0; i < doc.shots.length; i++) {
    const shot = doc.shots[i];
    const translated = translations[i] || '';

    // Parse speaker segments from both English and translated
    const englishSegments = splitBySpeaker(shot.dialog);
    const translatedSegments = splitBySpeaker(translated);

    // Merge: match by speaker order
    const speakerSegments: SpeakerSegment[] = englishSegments.map((eng, idx) => ({
      speaker: eng.speaker,
      englishText: eng.englishText,
      translatedText: translatedSegments[idx]?.englishText || '',
    }));

    // Calculate character expansion
    const engChars = shot.dialog.replace(/[A-Z][a-zA-Z]+(?:\s*\([^)]*\))?\s*:\s*/g, '').length;
    const transChars = translated.replace(/[A-Z][a-zA-Z]+(?:\s*\([^)]*\))?\s*:\s*/g, '').length;
    const expansion = engChars > 0 ? Math.round(((transChars - engChars) / engChars) * 100) : 0;

    // Determine timing fit based on expansion and duration
    // Rule of thumb: speaking rate is ~150 words/min or ~13 chars/sec for most languages
    const charsPerSec = shot.duration > 0 ? transChars / shot.duration : 0;
    let timingFit: 'good' | 'tight' | 'over' = 'good';
    if (charsPerSec > 16) timingFit = 'over';
    else if (charsPerSec > 13) timingFit = 'tight';

    results.push({
      shot,
      translatedDialog: translated,
      speakerSegments,
      timingFit,
      characterExpansion: expansion,
    });
  }

  const goodFit = results.filter(r => r.timingFit === 'good').length;
  const tightFit = results.filter(r => r.timingFit === 'tight').length;
  const overFit = results.filter(r => r.timingFit === 'over').length;
  const expansions = results.map(r => r.characterExpansion);

  return {
    shots: results,
    stats: {
      totalShots: results.length,
      goodFit,
      tightFit,
      overFit,
      avgExpansion: expansions.length > 0 ? Math.round(expansions.reduce((a, b) => a + b, 0) / expansions.length) : 0,
      maxExpansion: expansions.length > 0 ? Math.max(...expansions) : 0,
      totalDuration: doc.totalDuration,
    },
  };
};
