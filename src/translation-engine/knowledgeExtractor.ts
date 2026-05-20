import JSZip from 'jszip';

// ============================================
// CLAUDE PROXY HELPER (shared pattern)
// ============================================

const CLAUDE_PROXY_URL = "/api/claude-proxy";

const callClaudeProxy = async (request: {
  messages: Array<{ role: string; content: string | any[] }>;
  max_tokens?: number;
  temperature?: number;
  system?: string;
}): Promise<string> => {
  const response = await fetch(CLAUDE_PROXY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "Unknown error");
    throw new Error(`Claude proxy error (${response.status}): ${errText}`);
  }

  const data = await response.json();
  return data.text || "";
};

// ============================================
// TYPES
// ============================================

interface GlossaryEntry {
  en: string;
  target_approved: string;
  phonetic?: string;
  srt_short?: string;
  note?: string;
  usage_count?: number;
  source?: string;
}

interface IdiomEntry {
  en_idiom: string;
  target_equivalent: string;
  context?: string;
  application?: string;
  source?: string;
}

interface CulturalSafeguard {
  risk_term?: string;
  preferred_alternative?: string;
  forbidden_alternative?: string;
  required_term?: string;
  context?: string;
  severity?: "low" | "medium" | "high";
}

interface SRTTiming {
  avg_chars_per_line: number;
  avg_duration_sec: number;
  avg_cps: number;
  line_break_patterns: string[];
}

export interface QAOverrideEntry {
  incorrect: string;
  suggested: string;
  issue_type: string;
  issue_description: string;
  timestamp?: string;
  slide_number?: number;
}

export interface ExtractionResult {
  glossary: GlossaryEntry[];
  idioms: IdiomEntry[];
  cultural_safeguards: CulturalSafeguard[];
  srt_timing?: SRTTiming;
  qa_overrides?: QAOverrideEntry[];
  metadata: {
    source_file: string;
    extraction_date: string;
    content_type: string;
    language: string;
    total_terms_found: number;
  };
}

// ============================================
// AUDIO/VIDEO TRANSCRIPTION (via OpenAI Whisper)
// ============================================

const transcribeAudioOrVideo = async (
  file: File,
  targetLanguage: string,
  onProgress?: (status: string) => void
): Promise<string> => {
  onProgress?.("Transcribing audio/video...");

  const formData = new FormData();
  formData.append("file", file);
  formData.append("language", targetLanguage);

  const response = await fetch("/api/openai-audit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "transcribe", fileName: file.name }),
  });

  if (!response.ok) {
    onProgress?.("Whisper unavailable, extracting text with Claude...");
    const base64Data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve((reader.result as string).split(",")[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

    const text = await callClaudeProxy({
      messages: [
        {
          role: "user",
          content: `This is a base64-encoded ${file.type || "audio"} file named "${file.name}".
I cannot play it, but based on the filename and context, this appears to be a ${targetLanguage} cybersecurity podcast or training content.
Please note: I was unable to transcribe the audio directly. The user should provide an SRT file or text transcript instead for best results.
Return the text: "Audio transcription requires an SRT or text file upload. Please re-upload the content as a subtitle file (.srt) or text document."`,
        },
      ],
      max_tokens: 256,
    });

    return text.trim();
  }

  const data = await response.json();
  return (data.transcript || data.text || "").trim();
};

// ============================================
// KNOWLEDGE EXTRACTION
// ============================================

const extractFromTranscript = async (
  transcript: string,
  targetLanguage: string,
  onProgress?: (status: string) => void
): Promise<Omit<ExtractionResult, "metadata" | "srt_timing">> => {
  onProgress?.("Extracting glossary terms, idioms, and cultural patterns...");

  const prompt = `You are analyzing a ${targetLanguage} cybersecurity podcast/audio transcript to extract localization knowledge.

TARGET LANGUAGE: ${targetLanguage}
TRANSCRIPT:
"""
${transcript.substring(0, 20000)}
"""

Extract the following in STRICT JSON format:

{
  "glossary": [
    {
      "en": "English term (inferred from context)",
      "target_approved": "Exact ${targetLanguage} term used in transcript",
      "note": "Context of usage",
      "usage_count": number of times this term appears
    }
  ],
  "idioms": [
    {
      "target_equivalent": "${targetLanguage} idiom/expression used",
      "en_idiom": "English equivalent (best match)",
      "context": "When/how it was used",
      "application": "Professional or casual"
    }
  ],
  "cultural_safeguards": [
    {
      "risk_term": "Term that triggered caution or was avoided",
      "preferred_alternative": "What was used instead",
      "context": "Why this matters in German corporate culture",
      "severity": "low" | "medium" | "high"
    }
  ]
}

EXTRACTION RULES:
1. GLOSSARY: Only extract technical cybersecurity terms (20-100 terms)
   - Focus on: malware, attacks, security controls, compliance terms
   - Ignore: common words like "the", "and", "very"
   - Include usage_count if a term appears multiple times

2. IDIOMS: Only extract professional idioms/expressions (5-20 max)
   - Professional expressions used in business context
   - NOT textbook idioms - only what was ACTUALLY spoken
   - Must be relevant to cybersecurity or business communication

3. CULTURAL SAFEGUARDS: Flag sensitive topics (0-10 max)
   - Terms related to surveillance, privacy, data collection
   - Topics that were handled carefully or avoided
   - GDPR/DSGVO-related caution
   - Inclusive language considerations

Return ONLY valid JSON, no preamble.`;

  const rawText = await callClaudeProxy({
    messages: [{ role: "user", content: prompt }],
    temperature: 0,
    max_tokens: 4096,
  }) || "{}";
  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("Failed to extract valid JSON from analysis");
  }

  const extracted = JSON.parse(jsonMatch[0]);

  return {
    glossary: Array.isArray(extracted.glossary) ? extracted.glossary : [],
    idioms: Array.isArray(extracted.idioms) ? extracted.idioms : [],
    cultural_safeguards: Array.isArray(extracted.cultural_safeguards)
      ? extracted.cultural_safeguards
      : [],
  };
};

// ============================================
// SRT ANALYSIS
// ============================================

const extractFromSRT = async (
  content: string,
  onProgress?: (status: string) => void
): Promise<SRTTiming> => {
  onProgress?.("Analyzing SRT timing patterns...");

  // Parse SRT format
  const subtitleBlocks = content.split(/\n\n+/).filter(Boolean);
  const timings: { chars: number; duration: number; lines: number }[] = [];
  const lineBreaks: string[] = [];

  for (const block of subtitleBlocks) {
    const lines = block.split("\n").filter(Boolean);
    if (lines.length < 3) continue;

    // Line 1: index, Line 2: timestamp, Line 3+: text
    const timestampLine = lines[1];
    const textLines = lines.slice(2);

    // Parse timestamp: 00:00:01,000 --> 00:00:03,500
    const match = timestampLine.match(/(\d{2}):(\d{2}):(\d{2}),(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2}),(\d{3})/);
    if (!match) continue;

    const startMs =
      parseInt(match[1]) * 3600000 +
      parseInt(match[2]) * 60000 +
      parseInt(match[3]) * 1000 +
      parseInt(match[4]);
    const endMs =
      parseInt(match[5]) * 3600000 +
      parseInt(match[6]) * 60000 +
      parseInt(match[7]) * 1000 +
      parseInt(match[8]);
    const durationSec = (endMs - startMs) / 1000;

    const fullText = textLines.join(" ");
    const charCount = fullText.length;

    timings.push({
      chars: charCount,
      duration: durationSec,
      lines: textLines.length,
    });

    // Track line break patterns
    if (textLines.length > 1) {
      const firstLine = textLines[0];
      const breakPoint = firstLine.slice(-10); // Last 10 chars before break
      lineBreaks.push(breakPoint);
    }
  }

  if (timings.length === 0) {
    return {
      avg_chars_per_line: 42,
      avg_duration_sec: 3,
      avg_cps: 15,
      line_break_patterns: [],
    };
  }

  const avgChars = timings.reduce((sum, t) => sum + t.chars / t.lines, 0) / timings.length;
  const avgDuration = timings.reduce((sum, t) => sum + t.duration, 0) / timings.length;
  const avgCPS = timings.reduce((sum, t) => sum + t.chars / t.duration, 0) / timings.length;

  return {
    avg_chars_per_line: Math.round(avgChars),
    avg_duration_sec: Math.round(avgDuration * 10) / 10,
    avg_cps: Math.round(avgCPS * 10) / 10,
    line_break_patterns: lineBreaks.slice(0, 20), // Sample
  };
};

// ============================================
// DOCUMENT ANALYSIS
// ============================================

const extractFromDocument = async (
  file: File,
  targetLanguage: string,
  onProgress?: (status: string) => void
): Promise<Omit<ExtractionResult, "metadata" | "srt_timing">> => {
  onProgress?.("Extracting text from document...");

  const base64Data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const mimeType = file.type || "application/pdf";

  const mediaType = mimeType || "application/pdf";
  const documentText = await callClaudeProxy({
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: base64Data } },
          { type: "text", text: "Extract all text from this document. Output only the text content." },
        ],
      },
    ],
    max_tokens: 4096,
  });

  // Now analyze like a transcript
  return await extractFromTranscript(documentText.trim(), targetLanguage, onProgress);
};

// ============================================
// PPTX REVIEWER FEEDBACK EXTRACTION
// ============================================

const extractNotesFromPptx = async (
  file: File
): Promise<{ slideNumber: number; text: string }[]> => {
  const arrayBuffer = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(arrayBuffer);

  const notesTexts: { slideNumber: number; text: string }[] = [];

  const noteFileNames = Object.keys(zip.files)
    .filter((name) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/i.test(name))
    .sort((a, b) => {
      const numA = parseInt(a.match(/notesSlide(\d+)/)?.[1] || "0");
      const numB = parseInt(b.match(/notesSlide(\d+)/)?.[1] || "0");
      return numA - numB;
    });

  for (const noteFile of noteFileNames) {
    const slideNum = parseInt(noteFile.match(/notesSlide(\d+)/)?.[1] || "0");
    const xml = await zip.file(noteFile)?.async("text");
    if (!xml) continue;

    const paragraphs: string[] = [];
    const pBlocks = xml.split(/<a:p[^>]*>/);

    for (const block of pBlocks) {
      const textRuns: string[] = [];
      const runMatches = block.matchAll(/<a:t[^>]*>([^<]*)<\/a:t>/g);
      for (const m of runMatches) {
        if (m[1]) textRuns.push(m[1]);
      }
      const lineText = textRuns.join("").trim();
      if (lineText) {
        paragraphs.push(lineText);
      }
    }

    const fullText = paragraphs.join("\n").trim();

    if (fullText && fullText.length > 10 && !fullText.match(/^[\d\s]+$/)) {
      notesTexts.push({ slideNumber: slideNum, text: fullText });
    }
  }

  return notesTexts;
};

const extractFromPptxFeedback = async (
  file: File,
  targetLanguage: string,
  onProgress?: (status: string) => void
): Promise<
  Omit<ExtractionResult, "metadata" | "srt_timing"> & {
    qa_overrides: QAOverrideEntry[];
  }
> => {
  onProgress?.("Parsing PowerPoint feedback file...");

  const slideNotes = await extractNotesFromPptx(file);

  if (slideNotes.length === 0) {
    throw new Error(
      "No reviewer notes found in the PowerPoint file. " +
        "The feedback must be in the slide notes (the notes pane below each slide in PowerPoint)."
    );
  }

  onProgress?.(
    `Found ${slideNotes.length} slides with reviewer notes. Extracting corrections...`
  );

  const notesContent = slideNotes
    .map((n) => `--- Slide ${n.slideNumber} ---\n${n.text}`)
    .join("\n\n");

  const prompt = `You are parsing reviewer feedback from a translation QA review for ${targetLanguage}.

Each slide contains structured notes from a human reviewer who checked a localized video/subtitle. The notes typically follow this format:
- Issue Types: (category of the problem)
- Issue Description: (what is wrong)
- Incorrect: (the wrong text)
- Suggested: (the correct text)
- Timestamp: (where in the video)

REVIEWER NOTES:
"""
${notesContent}
"""

Parse EVERY slide's feedback into structured corrections. Return STRICT JSON:

{
  "qa_corrections": [
    {
      "incorrect": "The exact incorrect text from the reviewer's notes",
      "suggested": "The exact suggested correction from the reviewer's notes",
      "issue_type": "Capitalize the category (e.g., Linguistic, Spelling, Grammar, Punctuation, Capitalization, Mistranslation)",
      "issue_description": "The reviewer's description of the issue",
      "timestamp": "Video timestamp if provided",
      "slide_number": 0
    }
  ],
  "patterns": [
    {
      "rule": "A general rule derived from multiple corrections (only if a clear pattern exists across 2+ corrections)",
      "severity": "high|medium|low",
      "context": "When this rule applies"
    }
  ]
}

RULES:
1. Extract ONLY what the reviewer explicitly wrote. Do not infer corrections not present in the notes.
2. Use the reviewer's exact text for "incorrect" and "suggested" fields. Do not modify, translate, or "fix" them.
3. Every slide with Issue/Incorrect/Suggested fields MUST produce a qa_corrections entry.
4. "patterns" should only contain rules derivable from MULTIPLE similar corrections. If corrections are all different types, the patterns array can be empty.
5. Return ONLY valid JSON, no preamble, no markdown fences.`;

  const rawText = await callClaudeProxy({
    messages: [{ role: "user", content: prompt }],
    temperature: 0,
    max_tokens: 4096,
  });

  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(
      "Failed to parse reviewer feedback. Claude did not return valid JSON."
    );
  }

  const parsed = JSON.parse(jsonMatch[0]);

  const qaOverrides: QAOverrideEntry[] = Array.isArray(parsed.qa_corrections)
    ? parsed.qa_corrections.map((c: any) => ({
        incorrect: c.incorrect || "",
        suggested: c.suggested || "",
        issue_type: c.issue_type || "Other",
        issue_description: c.issue_description || "",
        timestamp: c.timestamp,
        slide_number: c.slide_number,
      }))
    : [];

  const culturalSafeguards: CulturalSafeguard[] = Array.isArray(
    parsed.patterns
  )
    ? parsed.patterns.map((p: any) => ({
        risk_term: p.rule || "",
        preferred_alternative: p.context || "",
        severity: p.severity || "medium",
        context: `Derived from reviewer feedback: ${file.name}`,
      }))
    : [];

  onProgress?.(
    `Extracted ${qaOverrides.length} corrections and ${culturalSafeguards.length} patterns.`
  );

  return {
    glossary: [],
    idioms: [],
    cultural_safeguards: culturalSafeguards,
    qa_overrides: qaOverrides,
  };
};

// ============================================
// MAIN EXTRACTION FUNCTION
// ============================================

export const extractKnowledgeFromFile = async (
  file: File,
  cardType: "podcasts" | "srt" | "documents" | "video" | "approved" | "rejected",
  targetLanguage: string,
  onProgress?: (status: string) => void
): Promise<ExtractionResult> => {

  let extraction: Omit<ExtractionResult, "metadata" | "srt_timing"> = {
    glossary: [],
    idioms: [],
    cultural_safeguards: [],
  };
  let srt_timing: SRTTiming | undefined;
  let qa_overrides: QAOverrideEntry[] | undefined;

  try {
    if (cardType === "podcasts" || cardType === "video") {
      const transcript = await transcribeAudioOrVideo(file, targetLanguage, onProgress);
      extraction = await extractFromTranscript(transcript, targetLanguage, onProgress);
    } else if (cardType === "srt") {
      const content = await file.text();
      srt_timing = await extractFromSRT(content, onProgress);

      const textOnly = content.replace(/^\d+\n/gm, "").replace(/\d{2}:\d{2}:\d{2},\d{3}\s*-->\s*\d{2}:\d{2}:\d{2},\d{3}\n/g, "");
      extraction = await extractFromTranscript(textOnly, targetLanguage, onProgress);
    } else if (cardType === "documents") {
      extraction = await extractFromDocument(file, targetLanguage, onProgress);
    } else if (cardType === "approved" || cardType === "rejected") {
      const isPptx = file.name.toLowerCase().endsWith(".pptx");

      if (isPptx && cardType === "rejected") {
        const result = await extractFromPptxFeedback(file, targetLanguage, onProgress);
        extraction = {
          glossary: result.glossary,
          idioms: result.idioms,
          cultural_safeguards: result.cultural_safeguards,
        };
        qa_overrides = result.qa_overrides;
      } else {
        const content = await file.text();
        extraction = await extractFromTranscript(content, targetLanguage, onProgress);
      }
    }

    return {
      ...extraction,
      srt_timing,
      qa_overrides,
      metadata: {
        source_file: file.name,
        extraction_date: new Date().toISOString(),
        content_type: cardType,
        language: targetLanguage,
        total_terms_found: extraction.glossary.length,
      },
    };
  } catch (error: any) {
    throw new Error(`Extraction failed: ${error.message}`);
  }
};

// ============================================
// MERGE UTILITIES
// ============================================

export const generateMergePreview = (
  extraction: ExtractionResult,
  existingGlossary: GlossaryEntry[],
  existingIdioms: IdiomEntry[],
  existingSafeguards: CulturalSafeguard[]
): {
  new_terms: number;
  updated_terms: number;
  new_idioms: number;
  new_safeguards: number;
  preview: string;
} => {
  // Find new vs existing
  const newTerms = extraction.glossary.filter(
    (newEntry) => !existingGlossary.some((existing) => existing.target_approved === newEntry.target_approved)
  );
  const updatedTerms = extraction.glossary.filter((newEntry) =>
    existingGlossary.some((existing) => existing.target_approved === newEntry.target_approved)
  );
  const newIdioms = extraction.idioms.filter(
    (newEntry) => !existingIdioms.some((existing) => existing.target_equivalent === newEntry.target_equivalent)
  );
  const newSafeguards = extraction.cultural_safeguards.filter(
    (newEntry) =>
      !existingSafeguards.some(
        (existing) =>
          existing.risk_term === newEntry.risk_term ||
          existing.preferred_alternative === newEntry.preferred_alternative
      )
  );

  const preview = `
EXTRACTION SUMMARY
==================
Source: ${extraction.metadata.source_file}
Date: ${extraction.metadata.extraction_date}
Type: ${extraction.metadata.content_type}

GLOSSARY TERMS:
- New terms to add: ${newTerms.length}
- Existing terms with updates: ${updatedTerms.length}

NEW TERMS SAMPLE (first 10):
${newTerms.slice(0, 10).map((t) => `  - "${t.en}" → "${t.target_approved}" (used ${t.usage_count || 1}x)`).join("\n")}

IDIOMS:
- New idioms to add: ${newIdioms.length}

NEW IDIOMS:
${newIdioms.map((i) => `  - Target: "${i.target_equivalent}" | EN: "${i.en_idiom}"`).join("\n")}

CULTURAL SAFEGUARDS:
- New safeguards to add: ${newSafeguards.length}

NEW SAFEGUARDS:
${newSafeguards.map((s) => `  - ${s.severity?.toUpperCase()}: "${s.risk_term}" → "${s.preferred_alternative}"`).join("\n")}

${extraction.srt_timing ? `
SRT TIMING ANALYSIS:
- Avg chars per line: ${extraction.srt_timing.avg_chars_per_line}
- Avg duration: ${extraction.srt_timing.avg_duration_sec}s
- Avg CPS: ${extraction.srt_timing.avg_cps}
` : ""}
`;

  return {
    new_terms: newTerms.length,
    updated_terms: updatedTerms.length,
    new_idioms: newIdioms.length,
    new_safeguards: newSafeguards.length,
    preview: preview.trim(),
  };
};
