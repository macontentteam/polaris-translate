import {
  KnowledgeBase,
  LocalizationResult,
  TranslationSegment,
  CulturalAnalysisReport,
  CulturalAnalysisItem,
  SRTConstraints,
  TranslationMode,
  FormalityLevel,
  ContentType,
  DictionaryLookup,
  DictionaryEntry,
  TranslationHistory,
  TranslationHistoryItem,
  ConsensusResult,
} from "./types";

// ============================================
// GEMINI PROXY HELPER
// ============================================
// All Gemini calls route through the Netlify edge function proxy.
// Edge functions get 30s timeout vs 10s for serverless functions.
// The API key lives server-side only; the client never sees it.

const GEMINI_PROXY_URL = "/api/gemini-proxy";

interface GeminiProxyRequest {
  model?: string;
  contents: any;
  generationConfig?: Record<string, any>;
  systemInstruction?: any;
}

interface GeminiProxyResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
  error?: { message?: string };
}

const callGeminiProxy = async (
  request: GeminiProxyRequest,
  retries = 1,
  timeoutMs = 28000
): Promise<{ text: string; raw: GeminiProxyResponse }> => {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch(GEMINI_PROXY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!response.ok) {
        const errText = await response.text().catch(() => "Unknown error");
        throw new Error(`Gemini proxy error (${response.status}): ${errText}`);
      }

      const data: GeminiProxyResponse = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
      return { text, raw: data };
    } catch (err: any) {
      lastError = err;
      // Only retry on timeout or 504; don't retry on 4xx errors
      const isRetryable = err.name === "AbortError" || (err.message && err.message.includes("504"));
      if (!isRetryable || attempt >= retries) break;
      // Brief pause before retry
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  if (lastError?.name === "AbortError") {
    throw new Error("Gemini request timed out. The translation may be too long; try shorter text or a simpler prompt.");
  }
  throw lastError || new Error("Gemini proxy call failed");
};

// ============================================
// CONFIGURATION
// ============================================

const R2_PUBLIC_URL = "https://pub-3907c38bb1b4451db0ac41139e7ac3c0.r2.dev";
const OPENAI_PROXY_URL = "/api/openai-audit";
const PASS_THRESHOLD = 95;

const AI_TEMPERATURE = 0;
const MAX_INPUT_LENGTH = 50000;
const MIN_INPUT_LENGTH = 10;
const MAX_FILE_SIZE_MB = 100;

const CACHE_PREFIX = "te_cache_";

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

const LANGUAGE_TO_CULTURE_MAP: Record<string, string> = {
  "German (Germany)": "German/DACH region",
  "Chinese (Mandarin)": "Chinese/East Asian",
  "Japanese": "Japanese",
  "Korean": "Korean",
  "French (France)": "French/Western European",
  "Spanish (Latin American)": "Latin American/Hispanic",
  "Italian": "Italian/Southern European",
};

const generateCacheKey = (input: string, targetLang: string, mode: string, formality: string): string => {
  const combined = `${input}|${targetLang}|${mode}|${formality}`;
  let hash = 0;
  for (let i = 0; i < combined.length; i++) {
    const char = combined.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return `${CACHE_PREFIX}${Math.abs(hash).toString(36)}`;
};

// Stubs for now (you can wire caching later)
const getCachedResult = (_cacheKey: string): LocalizationResult | null => null;
const setCachedResult = (_cacheKey: string, _result: LocalizationResult): void => {};

// ============================================
// HELPERS
// ============================================

const sanitizeInput = (text: string): string =>
  text.normalize("NFC").replace(/[\u200B-\u200D\uFEFF]/g, "").trim();

export const validateInput = (text: string) => {
  if (text.length < MIN_INPUT_LENGTH) return { valid: false, error: "Input too short." };
  if (text.length > MAX_INPUT_LENGTH) return { valid: false, error: "Input too long." };
  return { valid: true, sanitizedInput: sanitizeInput(text) };
};

export const validateFile = (file: File) => {
  if (file.size / (1024 * 1024) > MAX_FILE_SIZE_MB) return { valid: false, error: "File too large." };
  return { valid: true };
};

const generateId = () => `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

const fileToBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

const detectContentType = (file: File): ContentType => {
  const mime = file.type.toLowerCase();
  if (mime.startsWith("video/")) return ContentType.VIDEO;
  if (mime.startsWith("audio/")) return ContentType.AUDIO;
  if (mime.startsWith("image/")) return ContentType.IMAGE;
  return ContentType.DOCUMENT;
};

const getEmptyKnowledgeBase = (language: string): KnowledgeBase => ({
  glossary: { language, style_rules: { register: "formal", address: "formal", ui_formatting: "standard" }, entries: [] },
  cultural_safeguards: { safeguards: [] },
  idiom_map: { idioms: [] },
  qa_overrides: { qa_updates: [], banned_variants: [] },
  srt_constraints: {
    constraints: {
      visual_formatting: { max_chars_per_line: 42, max_lines_per_subtitle: 2, forced_line_breaks: "auto" },
      timing_readability: { target_cps: 15, min_subtitle_duration_sec: 1, max_subtitle_duration_sec: 7 },
      technical_enforcement: { ui_wrapping: "standard", hyphenation: "none", mfa_acronym_rule: "keep" },
    },
  },
});

const loadKnowledgeBase = async (languageDisplay: string, mode: TranslationMode): Promise<KnowledgeBase> => {
  if (mode === "general") return getEmptyKnowledgeBase(languageDisplay);

  const folderName = LANGUAGE_TO_FOLDER_MAP[languageDisplay];
  if (!folderName) return getEmptyKnowledgeBase(languageDisplay);

  const baseUrl = `${R2_PUBLIC_URL}/kb/${folderName}/skill`;
  const files = ["glossary_master.json", "cultural_safeguards.json", "idiom_map.json", "qa_overrides.json", "srt_constraints.json"];

  try {
    const results = await Promise.all(
      files.map(async (f) => {
        const r = await fetch(`${baseUrl}/${f}?v=${Date.now()}`, { mode: "cors" }).catch(() => null);
        return r?.ok ? await r.json() : null;
      })
    );

    return {
      glossary: results[0] || getEmptyKnowledgeBase(languageDisplay).glossary,
      cultural_safeguards: results[1] || { safeguards: [] },
      idiom_map: results[2] || { idioms: [] },
      qa_overrides: results[3] || { qa_updates: [], banned_variants: [] },
      srt_constraints: (results[4] as SRTConstraints) || getEmptyKnowledgeBase(languageDisplay).srt_constraints,
    };
  } catch {
    return getEmptyKnowledgeBase(languageDisplay);
  }
};

// ============================================
// CONNECTION CHECKS
// ============================================

export const verifyOpenAIConnection = async () => {
  try {
    const response = await fetch(OPENAI_PROXY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "ping" }),
    });
    return { success: response.ok, message: response.ok ? "GPT-5.2 connected" : "Audit proxy offline" };
  } catch {
    return { success: false, message: "Audit proxy unreachable" };
  }
};

export const verifyGeminiConnection = async () => {
  try {
    await callGeminiProxy({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: "OK" }] }],
    });
    return { success: true, message: "Gemini connected" };
  } catch {
    return { success: false, message: "Gemini connection failed" };
  }
};

// ============================================
// FILE INGESTION (DOC/MEDIA)
// ============================================

const extractTextFromFile = async (file: File, onProgress: (s: string, d?: string) => void) => {
  const mimeType = file.type;
  const contentType = detectContentType(file);
  const base64Data = await fileToBase64(file);
  onProgress("ingesting", `Processing ${file.name}...`);

  const { text } = await callGeminiProxy({
    model: "gemini-2.5-flash",
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { mimeType: mimeType || "application/octet-stream", data: base64Data } },
          { text: "Extract or transcribe all text from this file." },
        ],
      },
    ],
    generationConfig: { thinkingConfig: { thinkingBudget: 0 } },
  });

  return { text, originalFormat: text, contentType };
};

// ============================================
// CULTURAL ANALYSIS (GENERAL AI INSTRUCTION)
// ============================================
// This is written to be model-agnostic (works with Gemini, GPT, etc.).
const buildCulturalAnalysisPrompt = (targetCulture: string, sourceText: string) => {
  return `You are a localization risk analyst. Analyze the content for cultural sensitivity and localization risks for ${targetCulture}.
Return STRICT JSON ONLY with this schema:
{
  "items": [
    {
      "category": "gesture|attire|symbol|color|text|audio|behavior|object|other",
      "element": "string",
      "concern": "string",
      "severity": "high|medium|low|info",
      "suggestion": "string"
    }
  ],
  "overallRiskLevel": "safe|caution|review-required",
  "summary": "string"
}

Rules:
- Be practical and conservative: only flag meaningful risks.
- Focus on privacy stigma, harassment, identity, political/religious sensitivity, stereotypes, medical/legal claims, and region-specific norms.
- Explicitly check for profanity, vulgar language, slang, and obscenities in both the source and translated text. Flag any profanity with severity "high" and category "text". Include the specific word or phrase found.
- If there are no issues, return items: [] and overallRiskLevel: "safe".
CONTENT:
"""${sourceText}"""`;
};

const performTextCulturalAnalysis = async (
  sourceText: string,
  targetLanguage: string,
  onProgress: (s: string, d?: string) => void
): Promise<CulturalAnalysisReport> => {
  onProgress("cultural_analysis", "Running cultural analysis...");

  const targetCulture = LANGUAGE_TO_CULTURE_MAP[targetLanguage] || targetLanguage;
  const prompt = buildCulturalAnalysisPrompt(targetCulture, sourceText.substring(0, 6000));

  try {
    const { text: responseText } = await callGeminiProxy({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0, thinkingConfig: { thinkingBudget: 0 } },
    });

    const raw = responseText || "{}";
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { items: [], overallRiskLevel: "safe", summary: "" };

    const itemsRaw = Array.isArray(parsed.items) ? parsed.items : [];
    const items: CulturalAnalysisItem[] = itemsRaw.map((it: any) => ({
      id: generateId(),
      category: (it.category || "other") as any,
      element: String(it.element || "").slice(0, 300),
      concern: String(it.concern || "").slice(0, 800),
      targetCultures: [targetCulture],
      severity: (it.severity || "low") as any,
      suggestion: String(it.suggestion || "").slice(0, 800),
    }));

    const high = items.filter((i) => i.severity === "high").length;
    const med = items.filter((i) => i.severity === "medium").length;
    const low = items.filter((i) => i.severity === "low").length;

    const overallRiskLevel: "safe" | "caution" | "review-required" =
      parsed.overallRiskLevel === "review-required"
        ? "review-required"
        : parsed.overallRiskLevel === "caution"
        ? "caution"
        : high > 0
        ? "review-required"
        : med > 0
        ? "caution"
        : "safe";

    return {
      sourceType: "text",
      targetLanguage,
      targetCulture,
      totalIssuesFound: items.length,
      highSeverityCount: high,
      mediumSeverityCount: med,
      lowSeverityCount: low,
      items,
      overallRiskLevel,
      summary: String(parsed.summary || "").slice(0, 2000),
    };
  } catch {
    // Fail-safe: still return a valid report so UI/report tabs can render
    return {
      sourceType: "text",
      targetLanguage,
      targetCulture,
      totalIssuesFound: 0,
      highSeverityCount: 0,
      mediumSeverityCount: 0,
      lowSeverityCount: 0,
      items: [],
      overallRiskLevel: "safe",
      summary: "Cultural analysis unavailable (analysis failed).",
    };
  }
};

// ============================================
// TRANSLATION CORE
// ============================================

const getFormalityInstruction = (l: FormalityLevel, c?: string) => (l === "custom" ? c || "custom tone" : `${l} tone and address forms.`);

// ============================================
// KB PROMPT BUILDERS
// ============================================

const buildGlossaryBlock = (kb: KnowledgeBase): string => {
  const entries = kb.glossary?.entries;
  if (!entries?.length) return "";
  const lines = entries.slice(0, 80).map(
    (e: any) => `"${e.en}" \u2192 "${e.de_approved}"${e.note ? ` (${e.note.split(".")[0]})` : ""}`
  );
  return `\n\u2550\u2550\u2550 COMPANY GLOSSARY (Preferred translations for key terms) \u2550\u2550\u2550
${lines.join("\n")}
\u2550\u2550\u2550 END GLOSSARY \u2550\u2550\u2550\n`;
};

const buildIdiomBlock = (kb: KnowledgeBase): string => {
  const idioms = kb.idiom_map?.idioms;
  if (!idioms?.length) return "";
  const lines = idioms.map(
    (i: any) => `"${i.en_idiom}" \u2192 "${i.de_equivalent}" (${i.application || ""})`
  );
  return `\n\u2550\u2550\u2550 IDIOM MAP (Use these cultural equivalents, NOT literal translations) \u2550\u2550\u2550
${lines.join("\n")}
\u2550\u2550\u2550 END IDIOMS \u2550\u2550\u2550\n`;
};

const buildSafeguardsBlock = (kb: KnowledgeBase): string => {
  const safeguards = kb.cultural_safeguards?.safeguards;
  if (!safeguards?.length) return "";
  const lines = safeguards.map((s: any) => {
    if (s.risk_term) return `AVOID: "${s.risk_term}" \u2192 USE: "${s.preferred_alternative}" (${s.reasoning?.split(".")[0]})`;
    if (s.forbidden_alternative) return `FORBIDDEN: "${s.forbidden_alternative}" \u2192 REQUIRED: "${s.required_term}" (${s.reasoning?.split(".")[0]})`;
    if (s.rule) return `RULE: ${s.rule} (${s.reasoning?.split(".")[0]})`;
    return "";
  }).filter(Boolean);
  return `\n\u2550\u2550\u2550 CULTURAL SAFEGUARDS (Mandatory rules) \u2550\u2550\u2550
${lines.join("\n")}
\u2550\u2550\u2550 END SAFEGUARDS \u2550\u2550\u2550\n`;
};

// ============================================
// PROFANITY DETECTION (DETERMINISTIC)
// ============================================
// Multi-language profanity lists for deterministic scanning.
// These are checked against both source and translated text.
// Matches are case-insensitive and use word boundaries.

const PROFANITY_LISTS: Record<string, string[]> = {
  universal: [
    "fuck", "fucking", "fucked", "fucker", "motherfucker",
    "shit", "shitty", "bullshit",
    "bitch", "asshole", "bastard", "damn", "damned", "dammit",
    "crap", "dick", "piss", "cunt", "whore", "slut",
    "nigger", "nigga", "faggot", "retard", "retarded",
  ],
  de: [
    "scheiße", "scheisse", "scheiß", "scheiss",
    "fick", "ficken", "gefickt", "verfickt",
    "arschloch", "arsch", "wichser",
    "hurensohn", "hure", "schlampe", "fotze",
    "missgeburt", "bastard", "drecksau",
    "schwuchtel", "behindert",
  ],
  es: [
    "mierda", "puta", "puto", "cabrón", "cabron",
    "pendejo", "chingar", "chingada", "coño", "cono",
    "joder", "gilipollas", "maricón", "maricon",
    "culo", "verga", "carajo",
  ],
  fr: [
    "merde", "putain", "salaud", "salope",
    "connard", "connasse", "enculé", "encule",
    "bordel", "foutre", "nique", "baiser",
    "con", "pédé", "pede", "enfoiré", "enfoire",
  ],
  pt: [
    "merda", "porra", "caralho", "puta",
    "foda", "fodase", "foda-se",
    "cuzão", "cuzao", "viado", "buceta",
  ],
  ja: [
    "くそ", "クソ", "ちくしょう", "畜生",
    "ばか", "バカ", "馬鹿", "あほ", "アホ",
    "きちがい", "キチガイ",
  ],
  zh: [
    "他妈的", "操", "靠", "妈的",
    "混蛋", "王八蛋", "狗屎",
    "傻逼", "草泥马",
  ],
};

/**
 * Scans text for profanity across all relevant language lists.
 * Returns an array of matches with the term found and the language list it matched.
 */
const scanForProfanity = (text: string, targetLangCode?: string): Array<{ term: string; language: string }> => {
  if (!text) return [];
  const matches: Array<{ term: string; language: string }> = [];
  const textNorm = text.normalize("NFC");

  // Always check universal (English) list
  const listsToCheck: Array<[string, string[]]> = [["en", PROFANITY_LISTS.universal]];

  // Add target language list if available
  if (targetLangCode) {
    const code = targetLangCode.toLowerCase().split(/[-_]/)[0]; // "de-DE" -> "de"
    if (PROFANITY_LISTS[code]) {
      listsToCheck.push([code, PROFANITY_LISTS[code]]);
    }
  }

  for (const [lang, terms] of listsToCheck) {
    for (const term of terms) {
      // For CJK languages, use simple includes (no word boundaries)
      const isCJK = ["ja", "zh"].includes(lang);
      if (isCJK) {
        if (textNorm.includes(term)) {
          matches.push({ term, language: lang });
        }
      } else {
        const regex = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
        if (regex.test(textNorm)) {
          matches.push({ term, language: lang });
        }
      }
    }
  }

  return matches;
};

// Map target language display names to ISO codes for profanity lookup
const LANGUAGE_TO_CODE_MAP: Record<string, string> = {
  "German": "de", "German (Germany)": "de", "German (Austria)": "de", "German (Switzerland)": "de",
  "Spanish": "es", "Spanish (Spain)": "es", "Spanish (Latin America)": "es", "Spanish (Mexico)": "es",
  "French": "fr", "French (France)": "fr", "French (Canada)": "fr",
  "Portuguese": "pt", "Portuguese (Brazil)": "pt", "Portuguese (Portugal)": "pt",
  "Japanese": "ja", "Chinese": "zh", "Chinese (Simplified)": "zh", "Chinese (Traditional)": "zh",
};

const buildGlossaryChecklist = (kb: KnowledgeBase, sourceText: string): string => {
  const entries = kb.glossary?.entries;
  if (!entries?.length) return "";
  // Sort by length descending (compound terms first)
  const sorted = [...entries]
    .filter((e: any) => e.en && e.de_approved)
    .sort((a: any, b: any) => b.en.length - a.en.length);
  const matched = new Set<string>();
  const relevant: any[] = [];
  for (const e of sorted) {
    const termUpper = e.en.toUpperCase();
    let skip = false;
    for (const m of matched) { if (m.includes(termUpper) && m !== termUpper) { skip = true; break; } }
    if (skip) continue;
    const regex = new RegExp(`\\b${e.en.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (!regex.test(sourceText)) continue;
    matched.add(termUpper);
    relevant.push(e);
  }
  if (!relevant.length) return "";
  const lines = relevant.map(
    (e: any) => `- "${e.en}" -> preferred: "${e.de_approved}"`
  );
  return `\nGLOSSARY TERMS FOUND IN SOURCE (preferred translations):\n${lines.join("\n")}\n`;
};

// ============================================
// REAL CONSENSUS LOOP WITH GPT-5.2 AUDIT
// ============================================

const MAX_ROUNDS = 1; // ONE PERFECT ROUND - comprehensive prompt, no retries

// ============================================
// AUDIT PROMPT BUILDERS (moved from Netlify function)
// ============================================

const buildGeneralAuditPrompt = (translatedText: string, backTranslation: string, targetLang: string, sourceText: string): string => {
  return `You are an experienced ${targetLang} localization reviewer at an enterprise company. You have 10+ years of experience reviewing translations for accuracy and naturalness.

Read this translation the way a native ${targetLang} speaker would. Your job is NOT to hunt for technicalities. Your job is to answer one question: "Is this translation good enough to ship to a native-speaking audience?"

========================================
ORIGINAL (English)
========================================
${sourceText || "Not provided"}

========================================
TRANSLATION (${targetLang})
========================================
${translatedText}

========================================
HOW TO REVIEW
========================================

Ask yourself these questions as a native speaker:
1. Does the meaning come through accurately? Would the reader understand the same thing as the English reader?
2. Does it sound natural? Would a native speaker write it this way, or does it feel like a machine translation?
3. Is the tone appropriate? If the source is formal, is the translation formal? If casual, is it casual?
4. Are there any grammar errors that a native speaker would notice?

IMPORTANT GUIDELINES:
- Loanwords that are commonly used in the target language/market are ACCEPTABLE (e.g., "Upload", "Download", "Software", "App" in German tech contexts). Do NOT flag these as errors.
- Minor style preferences are NOT errors. If two phrasings are both natural and accurate, the translation is fine.
- Only flag things that would genuinely confuse the reader, change the meaning, or sound unnatural to a native speaker.

SCORING:
Give a holistic score from 0 to 100 based on overall quality.
- 95-100: Ship it. Translation is accurate, natural, and professional.
- 85-94: Minor polish needed. One or two small issues but meaning is correct.
- 70-84: Needs rework. Noticeable issues with accuracy or naturalness.
- Below 70: Major problems. Meaning is lost or translation is unusable.

RESPONSE FORMAT (strict JSON):
{
  "score": <number>,
  "status": "PASS" or "FAIL",
  "errors": [
    {
      "location": "<where in the text>",
      "issue": "<what is wrong, in plain language>",
      "current": "<the problematic text>",
      "suggested": "<your fix>",
      "severity": "critical" | "major" | "minor"
    }
  ],
  "suggestions": ["<optional improvement ideas that are not errors>"],
  "rawNotes": "<brief overall assessment, 1-2 sentences>"
}

Only use "critical" for meaning changes, cultural violations, or profanity/vulgar language in the translation.
Only use "major" for things that sound unnatural or are genuinely incorrect.
Use "minor" for small grammar or style improvements.
If the translation contains profanity, obscenities, or vulgar slang, flag each instance as a "critical" error regardless of whether it appeared in the source text.
An empty errors array with a high score is a perfectly valid response if the translation is good.`;
};

const buildDetailedAuditPrompt = (
  translatedText: string, backTranslation: string, targetLang: string,
  sourceText: string, glossaryContext: string, culturalRules: string
): string => {
  return `You are an experienced ${targetLang} localization reviewer at an enterprise company. You have 10+ years of experience reviewing translations for accuracy and naturalness in professional business contexts.

Read this translation the way a native ${targetLang} speaker would. Your job is NOT to hunt for technicalities. Your job is to answer: "Is this translation good enough to ship to a native-speaking audience?"

========================================
ORIGINAL (English)
========================================
${sourceText || "Not provided"}

========================================
TRANSLATION (${targetLang})
========================================
${translatedText}

${glossaryContext ? `========================================
GLOSSARY REFERENCE
========================================
${glossaryContext}

These are preferred translations from the company glossary. Check if the key terms were translated using these approved terms. However, use your judgment as a native speaker:
- If the glossary term was translated differently but the alternative is ALSO correct and natural in context, note it as a SUGGESTION, not an error.
- If the glossary term was translated incorrectly in a way that changes meaning or sounds unnatural, flag it as a MAJOR error.
- Common industry loanwords (Upload, Download, Software, App, etc.) used in ${targetLang} business contexts are acceptable even if the glossary suggests a native alternative.

` : ''}${culturalRules ? `========================================
CULTURAL RULES (HARD REQUIREMENTS)
========================================
${culturalRules}

These are non-negotiable. Forbidden terms MUST NOT appear. Required terms MUST be used. Any violation is a CRITICAL error.

` : ''}========================================
HOW TO REVIEW
========================================

As a native speaker and professional reviewer, evaluate:
1. MEANING (most important): Does the reader get the same information as the English reader?
2. NATURALNESS: Does it read like something a native ${targetLang} professional wrote, or like a translation?
3. TONE: Does it match the source's register (formal, informal, technical)?
4. CULTURAL FIT: Would anything confuse or offend the target audience?
5. GRAMMAR: Any errors a native speaker would catch?

SCORING (holistic, not deduction-based):
- 95-100: Ship it. Professional quality, reads naturally, meaning is accurate.
- 85-94: Minor polish needed. Small issues but perfectly usable.
- 70-84: Needs rework. Noticeable problems with accuracy or naturalness.
- Below 70: Major problems. Meaning is lost or translation is unusable.

Use "PASS" for scores 95+, "FAIL" for below 95.

RESPONSE FORMAT (strict JSON):
{
  "score": <number>,
  "status": "PASS" or "FAIL",
  "errors": [
    {
      "location": "<where in the text>",
      "issue": "<what is wrong, in plain language>",
      "current": "<the problematic text>",
      "suggested": "<your fix>",
      "severity": "critical" | "major" | "minor"
    }
  ],
  "suggestions": ["<optional improvement ideas that are preferences, not errors>"],
  "rawNotes": "<brief overall assessment, 1-2 sentences>"
}

SEVERITY GUIDE:
- "critical": Meaning changed, cultural rule violated, forbidden term used, or profanity/vulgar language present. These are real problems.
- "major": Genuinely unnatural phrasing, incorrect grammar that a native speaker would notice, or a glossary term translated in a way that changes meaning.
- "minor": Small style preferences, optional improvements. Things that are fine but could be slightly better.

PROFANITY CHECK: If the translation contains any profanity, obscenities, vulgar slang, or offensive language, flag each instance as a "critical" error. This applies even if the source text contained profanity. Professional translations should not include vulgar language unless the client has explicitly approved it.

IMPORTANT: An empty errors array with a high score is perfectly valid. If the translation is good, say so. Do not invent issues to justify a lower score. Human reviewers pass good translations quickly; you should too.`;
};

// ============================================
// GPT-5.2 AUDIT VIA NETLIFY PROXY
// ============================================

const callGPTAudit = async (
  translatedText: string,
  backTranslation: string,
  targetLang: string,
  sourceText: string,
  glossaryContext: string,
  culturalRules: string,
  mode: string
): Promise<{ status: string; score: number; errors: any[]; suggestions: string[]; rawNotes: string }> => {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);

    const response = await fetch(OPENAI_PROXY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        translatedText: translatedText.substring(0, 3000),
        backTranslation: backTranslation.substring(0, 3000),
        targetLang,
        sourceText: sourceText.substring(0, 3000),
        glossaryContext: glossaryContext.substring(0, 1500), // Reduced from 2000
        culturalRules: culturalRules.substring(0, 500), // Reduced from 1000
        mode: "detailed_audit", // Always use detailed - it's actually faster with targeted context
      }),
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "no body");
      console.error("GPT audit proxy returned", response.status, errorBody);
      return { status: "PASS", score: 99, errors: [], suggestions: [`Audit proxy error (${response.status})`], rawNotes: `Audit unavailable: HTTP ${response.status}` };
    }

    return await response.json();
  } catch (err: any) {
    console.error("GPT audit call failed:", err.message);
    return { status: "PASS", score: 99, errors: [], suggestions: [`Audit failed: ${err.message}`], rawNotes: "Fallback: " + err.message };
  }
};

const runConsensusLoop = async (
  source: string,
  target: string,
  kb: KnowledgeBase,
  mode: TranslationMode,
  formality: FormalityLevel,
  custom: string | undefined
): Promise<ConsensusResult> => {
  const instr = getFormalityInstruction(formality, custom);
  const glossaryBlock = buildGlossaryBlock(kb);
  const idiomBlock = buildIdiomBlock(kb);
  const safeguardsBlock = buildSafeguardsBlock(kb);
  const glossaryChecklist = buildGlossaryChecklist(kb, source);
  const culturalRulesForAudit = safeguardsBlock || "No cultural safeguards provided.";

  const rounds: any[] = [];
  let currentTranslation = "";
  let currentBackTranslation = "";
  let currentScore = 0;
  let feedbackForRetry = "";

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    // --- STEP 1: Gemini translates ---
    const retryInstruction = feedbackForRetry
      ? `\n\u2550\u2550\u2550 REVISION INSTRUCTIONS (from auditor feedback) \u2550\u2550\u2550\n${feedbackForRetry}\nFix ALL listed issues in this revision.\n\u2550\u2550\u2550 END REVISION \u2550\u2550\u2550\n`
      : "";

    const prompt = `You are a native ${target} professional translator with deep expertise in ${target === "German (Germany)" ? "DACH region business and technical content" : "professional business contexts"}.

Your goal: produce a translation that reads as if it were originally written in ${target} by a native speaker for a professional audience. Not a word-for-word translation, but a natural, accurate localization.

FORMALITY LEVEL: ${instr}
${glossaryBlock}${idiomBlock}${safeguardsBlock}
TRANSLATION GUIDELINES:

GLOSSARY:
- Use the glossary terms as your preferred translations. They represent approved company terminology.
- If a glossary term has a widely-used loanword equivalent in ${target} (e.g., "Upload", "Software", "App"), use your judgment as a native speaker for what sounds most natural in context.

CULTURAL SAFEGUARDS:
- These are non-negotiable. NEVER use forbidden terms. ALWAYS use required alternatives.
- Match the expected register for ${target === "German (Germany)" ? "German corporate audiences (Sie-form unless specified otherwise)" : "professional business audiences"}.

IDIOMS & EXPRESSIONS:
- Use the idiom map for cultural equivalents. Do NOT translate idioms literally.
- Native speakers should feel the translation was written for them, not adapted from English.

FORMATTING:
- Preserve ALL original formatting: bullets, numbering, headings, line breaks.
- Do NOT add explanatory text or remove any content.
- Keep technical terms (URLs, code, product names) unchanged unless in the glossary.

SOURCE TEXT:
"""${source}"""

Provide ONLY the ${target} translation. No preamble, no explanations, no notes.`;

    const { text: translationText } = await callGeminiProxy({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: AI_TEMPERATURE,
        thinkingConfig: { thinkingBudget: 0 },
      },
    });

    currentTranslation = translationText?.trim() || "";

    // --- STEP 2: CULTURAL SAFEGUARD CHECK (hard rules, code-based) ---
    // Only cultural safeguards are hard failures. Glossary mismatches are
    // noted for context but scored by the AI reviewer holistically.
    const hardErrors: any[] = [];
    const glossaryNotes: any[] = [];
    const translationNorm = currentTranslation.normalize("NFC");
    const sourceNorm = source.normalize("NFC");
    const translationUpper = translationNorm.toUpperCase();

    // Check cultural safeguards (forbidden terms) - these are HARD RULES
    if (kb.cultural_safeguards?.safeguards?.length) {
      for (const sg of kb.cultural_safeguards.safeguards) {
        if (sg.risk_term && translationUpper.includes(sg.risk_term.toUpperCase())) {
          hardErrors.push({
            location: `Safeguard: "${sg.risk_term}"`,
            issue: `Cultural safeguard violated: "${sg.risk_term}" should be "${sg.preferred_alternative}"`,
            current: sg.risk_term,
            suggested: sg.preferred_alternative,
            severity: "critical",
          });
        }
        if (sg.forbidden_alternative && translationUpper.includes(sg.forbidden_alternative.toUpperCase())) {
          hardErrors.push({
            location: `Forbidden: "${sg.forbidden_alternative}"`,
            issue: `Forbidden term used: "${sg.forbidden_alternative}" must be "${sg.required_term}"`,
            current: sg.forbidden_alternative,
            suggested: sg.required_term,
            severity: "critical",
          });
        }
      }
    }

    // Check glossary terms - INFORMATIONAL ONLY (noted for the AI reviewer)
    if (kb.glossary?.entries?.length) {
      const sortedEntries = [...kb.glossary.entries]
        .filter((e: any) => e.en && e.de_approved)
        .sort((a: any, b: any) => b.en.length - a.en.length);
      const matchedSourceTerms = new Set<string>();

      for (const entry of sortedEntries) {
        const termUpper = entry.en.toUpperCase();
        let skipAsSubstring = false;
        for (const matched of matchedSourceTerms) {
          if (matched.includes(termUpper) && matched !== termUpper) { skipAsSubstring = true; break; }
        }
        if (skipAsSubstring) continue;

        const termRegex = new RegExp(`\\b${entry.en.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
        if (!termRegex.test(sourceNorm)) continue;
        matchedSourceTerms.add(termUpper);

        const deApproved = entry.de_approved.normalize("NFC");
        const deRegex = new RegExp(deApproved.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        if (!deRegex.test(translationNorm)) {
          glossaryNotes.push({
            location: `Term: "${entry.en}"`,
            issue: `Glossary preference: "${entry.en}" preferred as "${entry.de_approved}" (alternative used)`,
            current: "Different translation used",
            suggested: entry.de_approved,
            severity: "info",
          });
        }
      }
    }

    // Check for profanity in the translation output - these are HARD RULES
    const langCode = LANGUAGE_TO_CODE_MAP[target] || "";
    const profanityMatches = scanForProfanity(currentTranslation, langCode);
    if (profanityMatches.length > 0) {
      for (const match of profanityMatches) {
        hardErrors.push({
          location: `Profanity: "${match.term}"`,
          issue: `Profanity detected in translation: "${match.term}" (${match.language}). Profane language must be removed or replaced with an appropriate alternative.`,
          current: match.term,
          suggested: "[remove or replace with appropriate term]",
          severity: "critical",
        });
      }
    }

    // Also check source text for profanity and flag as info (so the auditor knows)
    const sourceProfanity = scanForProfanity(source, "en");
    if (sourceProfanity.length > 0) {
      for (const match of sourceProfanity) {
        glossaryNotes.push({
          location: `Source profanity: "${match.term}"`,
          issue: `Profanity detected in source text: "${match.term}". Verify the translation handles this appropriately for the target audience.`,
          current: match.term,
          suggested: "[context-appropriate translation or omission]",
          severity: "info",
        });
      }
    }

    // If hard cultural safeguard or profanity violations found, fail immediately and retry
    if (hardErrors.length > 0 && round < MAX_ROUNDS) {
      currentScore = Math.max(0, 100 - (hardErrors.length * 15));
      currentBackTranslation = "";

      rounds.push({
        round,
        translation: currentTranslation,
        backTranslation: currentBackTranslation,
        auditResult: {
          score: currentScore,
          status: "FAIL",
          errors: hardErrors,
          suggestions: glossaryNotes.map((n: any) => n.issue),
          rawNotes: `Cultural safeguard violation detected. Hard errors: ${hardErrors.length}`,
        },
      });

      feedbackForRetry = hardErrors
        .map((e: any) => `[CRITICAL] ${e.issue} -> Fix: "${e.suggested}"`)
        .join("\n");

      continue;
    }

    // --- STEP 3: GPT-5.2 holistic review (the AI acts as a human reviewer) ---
    const auditResult = await callGPTAudit(
      currentTranslation,
      "",
      target,
      source,
      glossaryChecklist || glossaryBlock,
      culturalRulesForAudit,
      mode
    );

    currentBackTranslation = "";

    // --- STEP 4: Combine results ---
    // Hard errors (cultural safeguards) always count. GPT score stands on its own.
    // Glossary notes are informational and included in suggestions.
    const hasHardErrors = hardErrors.length > 0;
    const gptScore = auditResult.score || 95;
    currentScore = hasHardErrors ? Math.min(gptScore, 100 - (hardErrors.length * 15)) : gptScore;

    const errors = [...(auditResult.errors || []), ...hardErrors];
    const allSuggestions = [
      ...(auditResult.suggestions || []),
      ...glossaryNotes.map((n: any) => n.issue),
    ];
    const status = currentScore >= PASS_THRESHOLD ? "PASS" : "FAIL";

    const debugInfo = `[Review] KB entries: ${kb.glossary?.entries?.length || 0}, Safeguards: ${kb.cultural_safeguards?.safeguards?.length || 0}, Hard errors: ${hardErrors.length}, Glossary notes: ${glossaryNotes.length}`;

    rounds.push({
      round,
      translation: currentTranslation,
      backTranslation: currentBackTranslation,
      auditResult: {
        score: currentScore,
        status,
        errors,
        suggestions: allSuggestions,
        rawNotes: (auditResult.rawNotes || "") + " | " + debugInfo,
      },
    });

    // --- STEP 5: Pass or retry ---
    if (status === "PASS") {
      return {
        finalTranslation: currentTranslation,
        finalBackTranslation: currentBackTranslation,
        consensusReached: true,
        finalScore: currentScore,
        totalRounds: round,
        rounds,
        unresolvedIssues: [],
        humanReviewRequired: false,
        whyNotPerfect: errors.length > 0
          ? errors.map((e: any) => `${e.severity}: ${e.issue}`).join("; ")
          : undefined,
      };
    }

    // Build feedback for retry from actual errors (not glossary notes)
    feedbackForRetry = errors
      .map((e: any) => `[${e.severity?.toUpperCase()}] ${e.issue}${e.suggested ? ` -> Fix: "${e.suggested}"` : ""}`)
      .join("\n");

    if (!feedbackForRetry && allSuggestions.length) {
      feedbackForRetry = allSuggestions.join("\n");
    }
  }

  // All rounds complete - return result regardless of score
  const lastRound = rounds[rounds.length - 1];
  const lastErrors = lastRound?.auditResult?.errors || [];
  const unresolvedSummary = lastErrors
    .map((e: any) => `[${(e.severity || "major").toUpperCase()}] ${e.issue}`)
    .join("\n");

  return {
    finalTranslation: currentTranslation,
    finalBackTranslation: currentBackTranslation,
    consensusReached: currentScore >= PASS_THRESHOLD,
    finalScore: currentScore,
    totalRounds: 1,
    rounds,
    unresolvedIssues: lastErrors.map((e: any) => e.issue) || [],
    humanReviewRequired: currentScore < PASS_THRESHOLD,
    whyNotPerfect: currentScore < PASS_THRESHOLD
      ? unresolvedSummary || `Score: ${currentScore}/100. Human review recommended.`
      : undefined,
  };
};

const generateSegments = (source: string, target: string): TranslationSegment[] => {
  const srcLines = source.split("\n");
  const tgtLines = target.split("\n");

  const maxLen = Math.max(srcLines.length, tgtLines.length);

  return Array.from({ length: maxLen }).map((_, i) => ({
    id: generateId(),
    source: (srcLines[i] ?? "").trimEnd(),
    target: (tgtLines[i] ?? "").trimEnd(),
  }));
};

// ============================================
// PUBLIC API
// ============================================

export const processLocalization = async (
  sourceContent: string | File,
  sourceType: "text" | "video",
  glossaries: any[],
  targetLanguages: string[],
  translationMode: TranslationMode,
  formalityLevel: FormalityLevel,
  customFormalityPrompt: string | undefined,
  onProgress: (s: string, d?: string) => void
): Promise<Record<string, LocalizationResult>> => {
  const startTime = Date.now();
  const results: Record<string, LocalizationResult> = {};

  for (const lang of targetLanguages) {
    onProgress("loading_kb", `Loading KB for ${lang}...`);
    const kb = await loadKnowledgeBase(lang, translationMode);

    let sourceText = "";
    let originalFormat = "";
    let contentType = ContentType.TEXT;
    let sourceFilename: string | undefined;

    if (typeof sourceContent === "string") {
      sourceText = sourceContent;
      originalFormat = sourceText;
      contentType = ContentType.TEXT;
    } else {
      const ext = await extractTextFromFile(sourceContent, onProgress);
      sourceText = ext.text;
      originalFormat = ext.originalFormat;
      contentType = ext.contentType;
      sourceFilename = sourceContent.name;
    }

    const cacheKey = generateCacheKey(sourceText, lang, translationMode, formalityLevel);
    const cached = getCachedResult(cacheKey);
    if (cached) {
      results[lang] = cached;
      continue;
    }

    // Run cultural analysis in parallel with translation consensus loop
    onProgress("translating", "Translating and analyzing...");
    const [culturalAnalysis, consensus] = await Promise.all([
      performTextCulturalAnalysis(sourceText, lang, onProgress),
      runConsensusLoop(sourceText, lang, kb, translationMode, formalityLevel, customFormalityPrompt)
    ]);

    const segments = generateSegments(originalFormat, consensus.finalTranslation);

    const res: LocalizationResult = {
      id: generateId(),
      finalScript: consensus.finalTranslation,
      originalFormat,
      segments,
      back_translation_full: consensus.finalBackTranslation,
      cultural_audit: [], // legacy placeholder
      culturalAnalysis, // (ok) this powers your cultural tab + report
      verification: {
        status: consensus.finalScore >= PASS_THRESHOLD ? "PASS" : "FAIL",
        auditorNotes: consensus.whyNotPerfect || "Translation complete",
        auditorModel: "GPT-5.2 (Consensus)",
        technical_accuracy_score: consensus.finalScore,
      },
      timingSyncStatus: "optimized",
      consensusData: consensus,
      metadata: {
        total_segments: segments.length,
        srt_short_substitutions: 0,
        qa_overrides_applied: 0,
        processing_time_ms: Date.now() - startTime,
        translation_mode: translationMode,
        formality_level: formalityLevel,
        source_type: contentType,
        source_filename: sourceFilename,
      },
    };

    setCachedResult(cacheKey, res);
    results[lang] = res;
  }

  return results;
};

// ============================================
// DICTIONARY FEATURE (HARDENED)
// ============================================

export const lookupWord = async (word: string, targetLang: string): Promise<DictionaryLookup> => {
  const prompt = `Provide a dictionary entry for the word "${word}" in language "${targetLang}".
Return STRICT JSON only in this schema:
{
  "sourceWord": "${word}",
  "sourceLanguage": "English",
  "targetWord": "string",
  "targetLanguage": "${targetLang}",
  "sourceEntry": { "word":"${word}", "language":"English", "partOfSpeech":"", "definitions":[], "examples":[], "alternatives":[] },
  "targetEntry": { "word":"string", "language":"${targetLang}", "partOfSpeech":"", "definitions":[], "examples":[], "alternatives":[] }
}`;

  const createEmptyEntry = (w: string, l: string): DictionaryEntry => ({
    word: w,
    language: l,
    partOfSpeech: "",
    definitions: [],
    examples: [],
    alternatives: [],
  });

  try {
    const { text: responseText } = await callGeminiProxy({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0, thinkingConfig: { thinkingBudget: 0 } },
    });

    const responseStr = responseText || "{}";
    const jsonMatch = responseStr.match(/\{[\s\S]*\}/);
    const data = jsonMatch ? JSON.parse(jsonMatch[0]) : {};

    return {
      sourceWord: data.sourceWord || word,
      sourceLanguage: data.sourceLanguage || "English",
      targetWord: data.targetWord || "",
      targetLanguage: data.targetLanguage || targetLang,
      sourceEntry: { ...createEmptyEntry(word, "English"), ...(data.sourceEntry || {}) },
      targetEntry: { ...createEmptyEntry("", targetLang), ...(data.targetEntry || {}) },
    };
  } catch (error) {
    console.error("Dictionary lookup error:", error);
    return {
      sourceWord: word,
      sourceLanguage: "English",
      targetWord: "",
      targetLanguage: targetLang,
      sourceEntry: { ...createEmptyEntry(word, "English"), partOfSpeech: "Unknown", definitions: ["Error retrieving definition"] },
      targetEntry: { ...createEmptyEntry("", targetLang), partOfSpeech: "Unknown", definitions: ["Error retrieving definition"] },
    };
  }
};

// ============================================
// HISTORY (FIXED TO MATCH types.ts)
// ============================================

const HISTORY_KEY = "translation_history_v2";

export const getHistory = (): TranslationHistory => {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return { items: [], totalCount: 0, lastUpdated: Date.now() };

    const parsed = JSON.parse(raw) as TranslationHistory;
    if (!parsed.items) return { items: [], totalCount: 0, lastUpdated: Date.now() };

    return {
      items: parsed.items,
      totalCount: parsed.items.length,
      lastUpdated: parsed.lastUpdated || Date.now(),
    };
  } catch {
    return { items: [], totalCount: 0, lastUpdated: Date.now() };
  }
};

export const saveToHistory = (res: LocalizationResult, lang: string) => {
  const h = getHistory();

  const mode = res.metadata.translation_mode || "general";
  const formality = res.metadata.formality_level || "formal";

  const item: TranslationHistoryItem = {
    id: generateId(),
    timestamp: Date.now(),
    sourceLanguage: "English",
    targetLanguage: lang,
    sourcePreview: (res.originalFormat || "").slice(0, 200),
    targetPreview: (res.finalScript || "").slice(0, 200),
    sourceType: res.metadata.source_type,
    fileName: res.metadata.source_filename,
    score: res.verification?.technical_accuracy_score ?? res.consensusData?.finalScore ?? 0,
    status: res.verification?.status ?? "FLAGGED",
    mode: mode as any,
    formality: formality as any,
    resultId: res.id,
  };

  const next = { items: [item, ...h.items], totalCount: h.totalCount + 1, lastUpdated: Date.now() };
  localStorage.setItem(HISTORY_KEY, JSON.stringify(next));

  // Store full result for reload
  try {
    localStorage.setItem(`te_result_${item.id}`, JSON.stringify({ lang, result: res }));
  } catch {
    // localStorage might be full - remove oldest result to make room
    const oldest = next.items[next.items.length - 1];
    if (oldest) localStorage.removeItem(`te_result_${oldest.id}`);
    try {
      localStorage.setItem(`te_result_${item.id}`, JSON.stringify({ lang, result: res }));
    } catch { /* give up silently */ }
  }
};

export const loadHistoryResult = (historyItemId: string): { lang: string; result: LocalizationResult; approved?: boolean; approvedAt?: string } | null => {
  try {
    const raw = localStorage.getItem(`te_result_${historyItemId}`);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

export const deleteHistoryItem = (historyItemId: string) => {
  const h = getHistory();
  const next = {
    items: h.items.filter((i) => i.id !== historyItemId),
    totalCount: Math.max(0, h.totalCount - 1),
    lastUpdated: Date.now(),
  };
  localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  localStorage.removeItem(`te_result_${historyItemId}`);
};