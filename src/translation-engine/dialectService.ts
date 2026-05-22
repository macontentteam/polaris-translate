import { DialectProfile } from "./types";

const CLAUDE_PROXY_URL = "/api/claude-proxy";
const KB_UPLOAD_URL = "/api/kb-upload";
const R2_PUBLIC_URL = "https://pub-3907c38bb1b4451db0ac41139e7ac3c0.r2.dev";

const LANGUAGE_TO_FOLDER_MAP: Record<string, string> = {
  "Chinese (Mandarin)": "chinese-mandarin",
  "Danish": "danish",
  "Dutch": "dutch",
  "English (UK)": "english-uk",
  "English (US)": "english-us",
  "Finnish": "finnish",
  "French (France)": "french",
  "German (Germany)": "german",
  "Italian": "italian",
  "Japanese": "japanese",
  "Korean": "korean",
  "Norwegian": "norwegian",
  "Spanish (Latin American)": "spanish",
  "Swedish": "swedish",
};

interface ClaudeProxyResponse {
  text?: string;
  error?: string;
}

const callClaudeProxy = async (
  request: {
    model?: string;
    messages: Array<{ role: string; content: string | any[] }>;
    max_tokens?: number;
    system?: string;
    temperature?: number;
  },
  timeoutMs = 120000
): Promise<string> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const response = await fetch(CLAUDE_PROXY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal: controller.signal,
  });

  clearTimeout(timer);

  if (!response.ok) {
    const errText = await response.text().catch(() => "Unknown error");
    throw new Error(`Claude proxy error (${response.status}): ${errText}`);
  }

  const data: ClaudeProxyResponse = await response.json();
  return data.text || "";
};

const DIALECT_PROFILE_SCHEMA = `{
  "language": "string (e.g. 'German (Germany)')",
  "profile_version": "1.0",
  "source_material": {
    "type": "audio|video|transcript",
    "title": "string",
    "duration_minutes": number,
    "speaker_region": "string",
    "speaker_context": "string",
    "analyzed_date": "YYYY-MM-DD"
  },
  "pacing": {
    "words_per_minute_avg": number,
    "words_per_minute_range": [number, number],
    "pause_frequency": "string",
    "pause_duration_avg_ms": number,
    "emphasis_pattern": "string",
    "sentence_length_avg_words": number
  },
  "register": {
    "formality_level": "string",
    "address_form": "string",
    "humor_frequency": "string",
    "hedging_language": "string",
    "directness": "string"
  },
  "terminology_in_practice": {
    "terms_used_as_english_loanwords": ["string"],
    "terms_always_translated": [{"en": "string", "spoken_as": "string", "note": "string"}],
    "terms_with_regional_variation": [{"en": "string", "standard": "string", "spoken": "string", "note": "string"}]
  },
  "idioms_observed": [{"context": "string", "english_equivalent": "string", "spoken_form": "string", "frequency": "string"}],
  "subtitle_pacing": {
    "natural_cps_range": [number, number],
    "preferred_cps": number,
    "line_break_preference": "string",
    "compound_noun_handling": "string"
  },
  "voice_characteristics": {
    "pitch_range": "string",
    "speaking_style": "string",
    "energy_level": "string",
    "accent_region": "string",
    "breathing_pattern": "string"
  }
}`;

const buildAnalysisSystemPrompt = (language: string): string => {
  return `You are a linguistic analyst specializing in speech patterns for localization and voice synthesis.

Analyze the provided ${language} content from a cybersecurity professional. Extract:

1. PACING: Words per minute (average and range), pause frequency and duration, emphasis patterns, typical sentence length

2. REGISTER: Formality level, address forms used, use of humor, hedging language, directness level

3. TERMINOLOGY: Which English tech/security terms are used as loanwords vs. translated. Note any regional variations.

4. IDIOMS: Natural expressions used, especially for warnings, recommendations, and calls to action

5. SUBTITLE PACING: Based on their natural speech rate, what CPS range would feel comfortable for subtitles? Where do they naturally pause (good line break points)?

6. VOICE CHARACTERISTICS: Pitch range, speaking style, energy level, accent/regional markers, breathing patterns

Return the analysis as a JSON object matching this schema:
${DIALECT_PROFILE_SCHEMA}

Return ONLY the JSON object. No preamble, no explanation, no markdown fences.`;
};

const fileToBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

export const analyzeDialectFromAudio = async (
  file: File,
  language: string,
  onProgress: (stage: string, detail?: string) => void
): Promise<DialectProfile> => {
  onProgress("encoding", `Encoding ${file.name}...`);
  const base64Data = await fileToBase64(file);
  const mimeType = file.type || "audio/mpeg";

  onProgress("analyzing", `Sending to Claude for ${language} dialect analysis...`);

  const contentType = mimeType.startsWith("audio/") ? "audio" : "image";

  const responseText = await callClaudeProxy({
    system: buildAnalysisSystemPrompt(language),
    messages: [
      {
        role: "user",
        content: [
          {
            type: contentType,
            source: { type: "base64", media_type: mimeType, data: base64Data },
          },
          {
            type: "text",
            text: `Analyze this ${language} audio recording. The speaker is a cybersecurity professional. Extract a complete dialect profile following the schema in your instructions. Set analyzed_date to "${new Date().toISOString().split("T")[0]}" and language to "${language}".`,
          },
        ],
      },
    ],
    max_tokens: 4096,
    temperature: 0,
  }, 120000);

  onProgress("parsing", "Parsing dialect profile...");
  return parseDialectProfile(responseText, language);
};

export const analyzeDialectFromTranscript = async (
  transcript: string,
  language: string,
  title: string,
  onProgress: (stage: string, detail?: string) => void
): Promise<DialectProfile> => {
  onProgress("analyzing", `Analyzing ${language} transcript...`);

  const responseText = await callClaudeProxy({
    system: buildAnalysisSystemPrompt(language),
    messages: [
      {
        role: "user",
        content: `Analyze this ${language} transcript from a cybersecurity professional. The title is "${title}". Extract a complete dialect profile following the schema in your instructions. Set the source_material.type to "transcript", analyzed_date to "${new Date().toISOString().split("T")[0]}", and language to "${language}".\n\nTRANSCRIPT:\n"""\n${transcript}\n"""`,
      },
    ],
    max_tokens: 4096,
    temperature: 0,
  }, 90000);

  onProgress("parsing", "Parsing dialect profile...");
  return parseDialectProfile(responseText, language);
};

const parseDialectProfile = (responseText: string, language: string): DialectProfile => {
  const raw = responseText.trim();
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("Claude did not return valid JSON. Try again or use a different reference file.");
  }

  const parsed = JSON.parse(jsonMatch[0]);

  const profile: DialectProfile = {
    language: parsed.language || language,
    profile_version: parsed.profile_version || "1.0",
    source_material: {
      type: parsed.source_material?.type || "audio",
      title: parsed.source_material?.title || "Unknown",
      duration_minutes: parsed.source_material?.duration_minutes,
      speaker_region: parsed.source_material?.speaker_region,
      speaker_context: parsed.source_material?.speaker_context,
      analyzed_date: parsed.source_material?.analyzed_date || new Date().toISOString().split("T")[0],
    },
    pacing: {
      words_per_minute_avg: parsed.pacing?.words_per_minute_avg || 0,
      words_per_minute_range: parsed.pacing?.words_per_minute_range || [0, 0],
      pause_frequency: parsed.pacing?.pause_frequency || "",
      pause_duration_avg_ms: parsed.pacing?.pause_duration_avg_ms || 0,
      emphasis_pattern: parsed.pacing?.emphasis_pattern || "",
      sentence_length_avg_words: parsed.pacing?.sentence_length_avg_words || 0,
    },
    register: {
      formality_level: parsed.register?.formality_level || "",
      address_form: parsed.register?.address_form || "",
      humor_frequency: parsed.register?.humor_frequency || "",
      hedging_language: parsed.register?.hedging_language || "",
      directness: parsed.register?.directness || "",
    },
    terminology_in_practice: {
      terms_used_as_english_loanwords: Array.isArray(parsed.terminology_in_practice?.terms_used_as_english_loanwords)
        ? parsed.terminology_in_practice.terms_used_as_english_loanwords
        : [],
      terms_always_translated: Array.isArray(parsed.terminology_in_practice?.terms_always_translated)
        ? parsed.terminology_in_practice.terms_always_translated.map((t: any) => ({
            en: t.en || "",
            spoken_as: t.spoken_as || "",
            note: t.note,
          }))
        : [],
      terms_with_regional_variation: Array.isArray(parsed.terminology_in_practice?.terms_with_regional_variation)
        ? parsed.terminology_in_practice.terms_with_regional_variation.map((t: any) => ({
            en: t.en || "",
            standard: t.standard || "",
            spoken: t.spoken || "",
            note: t.note,
          }))
        : [],
    },
    idioms_observed: Array.isArray(parsed.idioms_observed)
      ? parsed.idioms_observed.map((i: any) => ({
          context: i.context || "",
          english_equivalent: i.english_equivalent || "",
          spoken_form: i.spoken_form || "",
          frequency: i.frequency || "",
        }))
      : [],
    subtitle_pacing: {
      natural_cps_range: parsed.subtitle_pacing?.natural_cps_range || [14, 18],
      preferred_cps: parsed.subtitle_pacing?.preferred_cps || 16,
      line_break_preference: parsed.subtitle_pacing?.line_break_preference || "",
      compound_noun_handling: parsed.subtitle_pacing?.compound_noun_handling || "",
    },
    voice_characteristics: {
      pitch_range: parsed.voice_characteristics?.pitch_range || "",
      speaking_style: parsed.voice_characteristics?.speaking_style || "",
      energy_level: parsed.voice_characteristics?.energy_level || "",
      accent_region: parsed.voice_characteristics?.accent_region || "",
      breathing_pattern: parsed.voice_characteristics?.breathing_pattern || "",
    },
  };

  return profile;
};

export const saveDialectProfileToR2 = async (
  profile: DialectProfile,
  language: string
): Promise<{ success: boolean; path: string }> => {
  const folderName = LANGUAGE_TO_FOLDER_MAP[language];
  if (!folderName) {
    throw new Error(`Unknown language: ${language}. Cannot determine R2 path.`);
  }

  const gcsPath = `kb/${folderName}/skill/dialect_profile.json`;
  const jsonStr = JSON.stringify(profile, null, 2);
  const base64Data = btoa(unescape(encodeURIComponent(jsonStr)));

  const response = await fetch(KB_UPLOAD_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "upload-raw",
      language,
      data: {
        fileName: "dialect_profile.json",
        fileData: base64Data,
        contentType: "application/json",
        gcsPath,
      },
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "Upload failed");
    throw new Error(`R2 upload failed: ${errText}`);
  }

  return { success: true, path: gcsPath };
};

export const loadExistingDialectProfile = async (
  language: string
): Promise<DialectProfile | null> => {
  const folderName = LANGUAGE_TO_FOLDER_MAP[language];
  if (!folderName) return null;

  try {
    const url = `${R2_PUBLIC_URL}/kb/${folderName}/skill/dialect_profile.json?v=${Date.now()}`;
    const response = await fetch(url, { mode: "cors" });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
};
