// Netlify Serverless Function: OpenAI GPT audit proxy for translation quality review
// Set OPENAI_API_KEY in Netlify environment variables

const OPENAI_MODEL = "gpt-4o";

function buildGeneralAuditPrompt(translatedText, backTranslation, targetLang, sourceText) {
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
}

function buildDetailedAuditPrompt(translatedText, backTranslation, targetLang, sourceText, glossaryContext, culturalRules) {
  let prompt = `You are an experienced ${targetLang} localization reviewer at an enterprise company. You have 10+ years of experience reviewing translations for accuracy and naturalness in professional business contexts.

Read this translation the way a native ${targetLang} speaker would. Your job is NOT to hunt for technicalities. Your job is to answer: "Is this translation good enough to ship to a native-speaking audience?"

========================================
ORIGINAL (English)
========================================
${sourceText || "Not provided"}

========================================
TRANSLATION (${targetLang})
========================================
${translatedText}

`;

  if (glossaryContext) {
    prompt += `========================================
GLOSSARY REFERENCE
========================================
${glossaryContext}

These are preferred translations from the company glossary. Check if the key terms were translated using these approved terms. However, use your judgment as a native speaker:
- If the glossary term was translated differently but the alternative is ALSO correct and natural in context, note it as a SUGGESTION, not an error.
- If the glossary term was translated incorrectly in a way that changes meaning or sounds unnatural, flag it as a MAJOR error.
- Common industry loanwords (Upload, Download, Software, App, etc.) used in ${targetLang} business contexts are acceptable even if the glossary suggests a native alternative.

`;
  }

  if (culturalRules) {
    prompt += `========================================
CULTURAL RULES (HARD REQUIREMENTS)
========================================
${culturalRules}

These are non-negotiable. Forbidden terms MUST NOT appear. Required terms MUST be used. Any violation is a CRITICAL error.

`;
  }

  prompt += `========================================
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

  return prompt;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: corsHeaders, body: "Method not allowed" };
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
      body: JSON.stringify({ error: "OPENAI_API_KEY not configured" }),
    };
  }

  try {
    const body = JSON.parse(event.body);
    const {
      translatedText = "",
      backTranslation = "",
      targetLang = "German (Germany)",
      sourceText = "",
      glossaryContext = "",
      culturalRules = "",
      mode = "general",
    } = body;

    const prompt = mode === "detailed_audit"
      ? buildDetailedAuditPrompt(translatedText, backTranslation, targetLang, sourceText, glossaryContext, culturalRules)
      : buildGeneralAuditPrompt(translatedText, backTranslation, targetLang, sourceText);

    const openaiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [
          {
            role: "system",
            content: "You are a professional translation quality auditor. Always respond with valid JSON only. No markdown, no code fences, no preamble.",
          },
          { role: "user", content: prompt },
        ],
        temperature: 0.1,
        max_tokens: 2000,
        response_format: { type: "json_object" },
      }),
    });

    if (!openaiResponse.ok) {
      const errBody = await openaiResponse.text().catch(() => "no body");
      return {
        statusCode: 502,
        headers: { "Content-Type": "application/json", ...corsHeaders },
        body: JSON.stringify({
          error: "OpenAI API error",
          details: errBody,
          openaiStatus: openaiResponse.status,
          model: OPENAI_MODEL,
        }),
      };
    }

    const openaiData = await openaiResponse.json();
    const content = openaiData.choices?.[0]?.message?.content || "{}";

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
    }

    const result = {
      score: typeof parsed.score === "number" ? parsed.score : 95,
      status: parsed.status || (parsed.score >= 95 ? "PASS" : "FAIL"),
      errors: Array.isArray(parsed.errors) ? parsed.errors : [],
      suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
      rawNotes: parsed.rawNotes || "",
    };

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
      body: JSON.stringify(result),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
      body: JSON.stringify({ error: "Audit function error", details: err.message }),
    };
  }
}
