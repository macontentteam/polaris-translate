// ============================================
// GEMINI PROXY HELPER (shared pattern)
// ============================================

const GEMINI_PROXY_URL = "/api/gemini-proxy";

const callGeminiProxy = async (request: {
  model?: string;
  contents: any;
  generationConfig?: Record<string, any>;
}): Promise<string> => {
  const response = await fetch(GEMINI_PROXY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "Unknown error");
    throw new Error(`Gemini proxy error (${response.status}): ${errText}`);
  }

  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
};

// ============================================
// TYPES
// ============================================

interface GlossaryEntry {
  en: string;
  de_approved: string;
  phonetic?: string;
  srt_short?: string;
  note?: string;
  usage_count?: number;
  source?: string;
}

interface IdiomEntry {
  en_idiom: string;
  de_equivalent: string;
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

export interface ExtractionResult {
  glossary: GlossaryEntry[];
  idioms: IdiomEntry[];
  cultural_safeguards: CulturalSafeguard[];
  srt_timing?: SRTTiming;
  metadata: {
    source_file: string;
    extraction_date: string;
    content_type: string;
    language: string;
    total_terms_found: number;
  };
}

// ============================================
// GEMINI TRANSCRIPTION
// ============================================

const transcribeAudioOrVideo = async (
  file: File,
  targetLanguage: string,
  onProgress?: (status: string) => void
): Promise<string> => {
  onProgress?.("Transcribing audio/video...");

  const base64Data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const mimeType = file.type || "audio/mpeg";

  const text = await callGeminiProxy({
    model: "gemini-2.5-flash",
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { mimeType, data: base64Data } },
          {
            text: `Transcribe all spoken content from this ${targetLanguage} audio/video file.
Include all technical terms, idioms, and complete sentences exactly as spoken.
Output ONLY the transcribed text, no metadata or timestamps.`,
          },
        ],
      },
    ],
    generationConfig: { thinkingConfig: { thinkingBudget: 0 } },
  });

  return text.trim();
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

  const prompt = `You are analyzing a German cybersecurity podcast/audio transcript to extract localization knowledge.

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
      "de_approved": "Exact German term used in transcript",
      "note": "Context of usage",
      "usage_count": number of times this term appears
    }
  ],
  "idioms": [
    {
      "de_equivalent": "German idiom/expression used",
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

  const rawText = await callGeminiProxy({
    model: "gemini-2.5-flash",
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0, thinkingConfig: { thinkingBudget: 0 } },
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

  // Extract text from document via proxy
  const documentText = await callGeminiProxy({
    model: "gemini-2.5-flash",
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { mimeType, data: base64Data } },
          { text: "Extract all text from this document. Output only the text content." },
        ],
      },
    ],
    generationConfig: { thinkingConfig: { thinkingBudget: 0 } },
  });

  // Now analyze like a transcript
  return await extractFromTranscript(documentText.trim(), targetLanguage, onProgress);
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

  try {
    if (cardType === "podcasts" || cardType === "video") {
      // Transcribe then extract
      const transcript = await transcribeAudioOrVideo(file, targetLanguage, onProgress);
      extraction = await extractFromTranscript(transcript, targetLanguage, onProgress);
    } else if (cardType === "srt") {
      // Read SRT content and analyze timing
      const content = await file.text();
      srt_timing = await extractFromSRT(content, onProgress);

      // Also extract glossary terms from subtitle text
      const textOnly = content.replace(/^\d+\n/gm, "").replace(/\d{2}:\d{2}:\d{2},\d{3}\s*-->\s*\d{2}:\d{2}:\d{2},\d{3}\n/g, "");
      extraction = await extractFromTranscript(textOnly, targetLanguage, onProgress);
    } else if (cardType === "documents") {
      extraction = await extractFromDocument(file, targetLanguage, onProgress);
    } else if (cardType === "approved" || cardType === "rejected") {
      // For approved/rejected translations, extract patterns
      const content = await file.text();
      extraction = await extractFromTranscript(content, targetLanguage, onProgress);
    }

    return {
      ...extraction,
      srt_timing,
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
    (newEntry) => !existingGlossary.some((existing) => existing.de_approved === newEntry.de_approved)
  );
  const updatedTerms = extraction.glossary.filter((newEntry) =>
    existingGlossary.some((existing) => existing.de_approved === newEntry.de_approved)
  );
  const newIdioms = extraction.idioms.filter(
    (newEntry) => !existingIdioms.some((existing) => existing.de_equivalent === newEntry.de_equivalent)
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
${newTerms.slice(0, 10).map((t) => `  - "${t.en}" → "${t.de_approved}" (used ${t.usage_count || 1}x)`).join("\n")}

IDIOMS:
- New idioms to add: ${newIdioms.length}

NEW IDIOMS:
${newIdioms.map((i) => `  - DE: "${i.de_equivalent}" | EN: "${i.en_idiom}"`).join("\n")}

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
