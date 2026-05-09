// Netlify serverless function: handles all GCS write operations for Polaris Knowledge Base
// Set GCS_SERVICE_ACCOUNT_KEY in Netlify environment variables (the full JSON key contents)
//
// Actions:
//   commit-knowledge  - Merges extracted knowledge into the 5 skill JSON files in GCS
//   flush-approvals   - Pushes approved translation records to GCS training data
//   upload-raw        - Uploads a raw file to the GCS bucket (for archival)
//
// The GCS bucket is: translation-engine-vault
// Skill files live at: kb/<language>/skill/<filename>.json

import crypto from "crypto";

const BUCKET = "translation-engine-vault";

// CRITICAL: This map MUST match LANGUAGE_TO_FOLDER_MAP in geminiService.ts
// If these get out of sync, the function writes to wrong folders and Polaris
// will never find the knowledge data.
const LANGUAGE_TO_FOLDER = {
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

function getLanguageFolder(language) {
  // Try exact match first
  if (LANGUAGE_TO_FOLDER[language]) {
    return LANGUAGE_TO_FOLDER[language];
  }
  // Fallback: normalize to folder-safe string
  return (language || "german")
    .toLowerCase()
    .replace(/[^a-z]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

// Google Cloud auth via service account key
async function getAccessToken(serviceAccountKey) {
  let key;
  try {
    key = JSON.parse(serviceAccountKey);
  } catch (e) {
    throw new Error("GCS_SERVICE_ACCOUNT_KEY is not valid JSON. Check the Netlify env variable.");
  }

  if (!key.client_email || !key.private_key) {
    throw new Error("GCS_SERVICE_ACCOUNT_KEY is missing client_email or private_key fields.");
  }

  const now = Math.floor(Date.now() / 1000);

  // Build JWT header and claim set
  const header = { alg: "RS256", typ: "JWT" };
  const claimSet = {
    iss: key.client_email,
    scope: "https://www.googleapis.com/auth/devstorage.full_control",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };

  // Base64url encode
  const b64url = (obj) =>
    Buffer.from(JSON.stringify(obj))
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

  const headerB64 = b64url(header);
  const claimB64 = b64url(claimSet);
  const signatureInput = `${headerB64}.${claimB64}`;

  // Sign with RSA private key
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(signatureInput);
  const signature = signer
    .sign(key.private_key, "base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const jwt = `${signatureInput}.${signature}`;

  // Exchange JWT for access token
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    throw new Error(`GCS auth failed. Check that the service account has Storage Object Admin role. Details: ${err}`);
  }

  const tokenData = await tokenRes.json();
  return tokenData.access_token;
}

// Read a JSON file from GCS (returns parsed object or default)
async function readGCSJson(accessToken, path, defaultValue = {}) {
  const encoded = encodeURIComponent(path);
  const res = await fetch(
    `https://storage.googleapis.com/storage/v1/b/${BUCKET}/o/${encoded}?alt=media`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (res.status === 404) return defaultValue;
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`GCS read failed for ${path}: ${err}`);
  }

  try {
    return await res.json();
  } catch (e) {
    // File exists but isn't valid JSON; return default
    console.error(`GCS file ${path} is not valid JSON, using default`);
    return defaultValue;
  }
}

// Write a JSON file to GCS
async function writeGCSJson(accessToken, path, data) {
  const body = JSON.stringify(data, null, 2);

  const res = await fetch(
    `https://storage.googleapis.com/upload/storage/v1/b/${BUCKET}/o?uploadType=media&name=${path}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body,
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`GCS write failed for ${path}: ${err}`);
  }

  return await res.json();
}

// Extract array from GCS file (handles flat arrays AND wrapper objects)
function extractArray(data, ...keys) {
  if (Array.isArray(data)) return data;
  for (const key of keys) {
    if (data && Array.isArray(data[key])) return data[key];
  }
  return [];
}

// Merge extracted glossary terms into existing glossary
function mergeGlossary(existing, newTerms) {
  const baseArray = extractArray(existing, "entries");
  const merged = [...baseArray];
  const existingMap = new Map();

  // Index existing by de_approved (case-insensitive)
  for (let i = 0; i < merged.length; i++) {
    const key = (merged[i].de_approved || "").toLowerCase().trim();
    if (key) existingMap.set(key, i);
  }

  let added = 0;
  let updated = 0;

  for (const term of newTerms) {
    if (!term.de_approved) continue; // Skip entries with no German term
    const key = term.de_approved.toLowerCase().trim();
    if (!key) continue;

    if (existingMap.has(key)) {
      // Update usage count and note if new info
      const idx = existingMap.get(key);
      merged[idx].usage_count = (merged[idx].usage_count || 1) + (term.usage_count || 1);
      if (term.note && !merged[idx].note) merged[idx].note = term.note;
      if (term.en && !merged[idx].en) merged[idx].en = term.en;
      if (term.source) merged[idx].last_source = term.source;
      merged[idx].last_updated = new Date().toISOString();
      updated++;
    } else {
      merged.push({
        ...term,
        usage_count: term.usage_count || 1,
        source: term.source || "knowledge-upload",
        added_date: new Date().toISOString(),
      });
      existingMap.set(key, merged.length - 1);
      added++;
    }
  }

  return { merged, added, updated };
}

// Merge extracted idioms into existing idiom map
function mergeIdioms(existing, newIdioms) {
  const baseArray = extractArray(existing, "idioms", "entries");
  const merged = [...baseArray];
  const existingSet = new Set(
    merged.map((i) => (i.de_equivalent || "").toLowerCase().trim())
  );

  let added = 0;
  for (const idiom of newIdioms) {
    if (!idiom.de_equivalent) continue;
    const key = idiom.de_equivalent.toLowerCase().trim();
    if (!key || existingSet.has(key)) continue;

    merged.push({
      ...idiom,
      source: idiom.source || "knowledge-upload",
      added_date: new Date().toISOString(),
    });
    existingSet.add(key);
    added++;
  }

  return { merged, added };
}

// Merge extracted cultural safeguards
function mergeSafeguards(existing, newSafeguards) {
  const baseArray = extractArray(existing, "safeguards", "entries");
  const merged = [...baseArray];
  const existingSet = new Set(
    merged.map(
      (s) =>
        `${(s.risk_term || "").toLowerCase().trim()}|${(s.preferred_alternative || "").toLowerCase().trim()}`
    )
  );

  let added = 0;
  for (const safeguard of newSafeguards) {
    const riskTerm = (safeguard.risk_term || "").toLowerCase().trim();
    const prefAlt = (safeguard.preferred_alternative || "").toLowerCase().trim();
    // Need at least one identifier
    if (!riskTerm && !prefAlt) continue;

    const key = `${riskTerm}|${prefAlt}`;
    if (existingSet.has(key)) continue;

    merged.push({
      ...safeguard,
      source: safeguard.source || "knowledge-upload",
      added_date: new Date().toISOString(),
    });
    existingSet.add(key);
    added++;
  }

  return { merged, added };
}

// Merge SRT timing data (preserves existing constraints wrapper format)
function mergeSRTConstraints(existing, newTiming) {
  if (!newTiming) return { merged: existing, updated: false };

  // The existing srt_constraints.json has a {constraints: {...}} wrapper
  // We add our extracted timing data alongside it
  const existingTiming = existing?.extracted_timing || {};

  // Average with existing extracted timing if present, otherwise use new
  if (existingTiming && typeof existingTiming.avg_chars_per_line === "number") {
    const updatedTiming = {
      avg_chars_per_line: Math.round(
        (existingTiming.avg_chars_per_line + newTiming.avg_chars_per_line) / 2
      ),
      avg_duration_sec:
        Math.round(
          ((existingTiming.avg_duration_sec + newTiming.avg_duration_sec) / 2) * 10
        ) / 10,
      avg_cps:
        Math.round(((existingTiming.avg_cps + newTiming.avg_cps) / 2) * 10) / 10,
      line_break_patterns: [
        ...new Set([
          ...(existingTiming.line_break_patterns || []),
          ...(newTiming.line_break_patterns || []),
        ]),
      ].slice(0, 50),
      samples_count: (existingTiming.samples_count || 1) + 1,
      last_updated: new Date().toISOString(),
    };
    // Preserve existing constraints, add extracted timing alongside
    return {
      merged: { ...existing, extracted_timing: updatedTiming },
      updated: true,
    };
  }

  const newTimingData = {
    ...newTiming,
    samples_count: 1,
    last_updated: new Date().toISOString(),
  };
  // Preserve existing constraints, add extracted timing alongside
  return {
    merged: { ...existing, extracted_timing: newTimingData },
    updated: true,
  };
}

// ============================================
// MAIN HANDLER
// ============================================

export async function handler(event) {
  // CORS headers used in every response
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };

  // CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const serviceAccountKey = process.env.GCS_SERVICE_ACCOUNT_KEY;
  if (!serviceAccountKey) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
      body: JSON.stringify({
        error: "GCS_SERVICE_ACCOUNT_KEY not configured in Netlify env",
      }),
    };
  }

  try {
    let incoming;
    try {
      incoming = JSON.parse(event.body);
    } catch (e) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
        body: JSON.stringify({ error: "Invalid JSON in request body" }),
      };
    }

    const { action, language, data } = incoming;

    if (!action) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
        body: JSON.stringify({ error: "Missing 'action' field" }),
      };
    }

    if (!language) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
        body: JSON.stringify({ error: "Missing 'language' field" }),
      };
    }

    // Get GCS access token
    const accessToken = await getAccessToken(serviceAccountKey);

    // Map language display name to folder name (must match geminiService.ts)
    const langFolder = getLanguageFolder(language);
    const basePath = `kb/${langFolder}/skill`;

    // ============================================
    // ACTION: commit-knowledge
    // Merges extraction results into the 5 skill files
    // ============================================
    if (action === "commit-knowledge") {
      const { glossary, idioms, cultural_safeguards, srt_timing, metadata } =
        data || {};

      if (!data) {
        return {
          statusCode: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders },
          body: JSON.stringify({ error: "Missing 'data' field for commit-knowledge" }),
        };
      }

      const results = {
        glossary: { added: 0, updated: 0 },
        idioms: { added: 0 },
        safeguards: { added: 0 },
        srt: { updated: false },
        source: metadata?.source_file || "unknown",
        language: langFolder,
      };

      // CRITICAL: Write formats must match what geminiService.ts loadKnowledgeBase expects:
      //   glossary_master.json     -> { entries: [...] }         (accessed via kb.glossary?.entries)
      //   idiom_map.json           -> { idioms: [...] }          (accessed via kb.idiom_map?.idioms)
      //   cultural_safeguards.json -> { safeguards: [...] }      (accessed via kb.cultural_safeguards?.safeguards)
      //   qa_overrides.json        -> { qa_updates: [...], banned_variants: [...] }
      //   srt_constraints.json     -> { constraints: {...} }

      // 1. Merge glossary
      if (glossary && glossary.length > 0) {
        const existing = await readGCSJson(
          accessToken,
          `${basePath}/glossary_master.json`,
          { entries: [] }
        );
        const { merged, added, updated } = mergeGlossary(existing, glossary);
        // Write in wrapper format: { entries: [...] }
        await writeGCSJson(
          accessToken,
          `${basePath}/glossary_master.json`,
          { entries: merged }
        );
        results.glossary = { added, updated };
      }

      // 2. Merge idioms
      if (idioms && idioms.length > 0) {
        const existing = await readGCSJson(
          accessToken,
          `${basePath}/idiom_map.json`,
          { idioms: [] }
        );
        const { merged, added } = mergeIdioms(existing, idioms);
        // Write in wrapper format: { idioms: [...] }
        await writeGCSJson(accessToken, `${basePath}/idiom_map.json`, { idioms: merged });
        results.idioms = { added };
      }

      // 3. Merge cultural safeguards
      if (cultural_safeguards && cultural_safeguards.length > 0) {
        const existing = await readGCSJson(
          accessToken,
          `${basePath}/cultural_safeguards.json`,
          { safeguards: [] }
        );
        const { merged, added } = mergeSafeguards(existing, cultural_safeguards);
        // Write in wrapper format: { safeguards: [...] }
        await writeGCSJson(
          accessToken,
          `${basePath}/cultural_safeguards.json`,
          { safeguards: merged }
        );
        results.safeguards = { added };
      }

      // 4. Merge SRT timing constraints
      if (srt_timing) {
        const existing = await readGCSJson(
          accessToken,
          `${basePath}/srt_constraints.json`,
          {}
        );
        const { merged, updated } = mergeSRTConstraints(existing, srt_timing);
        if (updated) {
          await writeGCSJson(
            accessToken,
            `${basePath}/srt_constraints.json`,
            merged
          );
        }
        results.srt = { updated };
      }

      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
        body: JSON.stringify({
          success: true,
          action: "commit-knowledge",
          results,
        }),
      };
    }

    // ============================================
    // ACTION: flush-approvals
    // Pushes approved translation records to GCS
    // ============================================
    if (action === "flush-approvals") {
      const approvals = data?.approvals || [];
      if (approvals.length === 0) {
        return {
          statusCode: 200,
          headers: { "Content-Type": "application/json", ...corsHeaders },
          body: JSON.stringify({
            success: true,
            action: "flush-approvals",
            flushed: 0,
          }),
        };
      }

      // Read existing training data
      const trainingPath = `kb/${langFolder}/training/approved_translations.json`;
      const existing = await readGCSJson(accessToken, trainingPath, []);

      // Deduplicate: skip approvals that already exist by ID
      const existingIds = new Set(
        (Array.isArray(existing) ? existing : []).map((e) => e.id)
      );
      const newApprovals = approvals.filter((a) => !existingIds.has(a.id));

      if (newApprovals.length > 0) {
        const merged = [...(Array.isArray(existing) ? existing : []), ...newApprovals];
        await writeGCSJson(accessToken, trainingPath, merged);
      }

      // Also extract any glossary-worthy terms from approved translations
      // and merge them into QA overrides (these are human-verified translations)
      // QA overrides format: { qa_updates: [...], banned_variants: [...] }
      const qaPath = `${basePath}/qa_overrides.json`;
      const existingQA = await readGCSJson(accessToken, qaPath, { qa_updates: [], banned_variants: [] });

      const newQAEntries = newApprovals
        .filter((a) => a.humanEdited && a.sourceText && a.approvedTranslation)
        .map((a) => ({
          source: a.sourceText.substring(0, 200),
          approved_output: a.approvedTranslation.substring(0, 500),
          mode: a.mode || "general",
          formality: a.formality || "formal",
          approved_at: a.approvedAt,
          score: a.score,
          approval_id: a.id,
        }));

      if (newQAEntries.length > 0) {
        const existingUpdates = Array.isArray(existingQA?.qa_updates) ? existingQA.qa_updates : [];
        const mergedQA = {
          qa_updates: [...existingUpdates, ...newQAEntries],
          banned_variants: existingQA?.banned_variants || [],
        };
        await writeGCSJson(accessToken, qaPath, mergedQA);
      }

      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
        body: JSON.stringify({
          success: true,
          action: "flush-approvals",
          flushed: newApprovals.length,
          duplicatesSkipped: approvals.length - newApprovals.length,
          qaEntriesAdded: newQAEntries.length,
        }),
      };
    }

    // ============================================
    // ACTION: upload-raw
    // Archives the original uploaded file to GCS
    // ============================================
    if (action === "upload-raw") {
      const { fileName, fileData, contentType, gcsPath } = data || {};
      if (!fileName || !fileData || !gcsPath) {
        return {
          statusCode: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders },
          body: JSON.stringify({
            error: "Missing fileName, fileData, or gcsPath",
          }),
        };
      }

      const fileBuffer = Buffer.from(fileData, "base64");

      const res = await fetch(
        `https://storage.googleapis.com/upload/storage/v1/b/${BUCKET}/o?uploadType=media&name=${gcsPath}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": contentType || "application/octet-stream",
          },
          body: fileBuffer,
        }
      );

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Raw file upload failed: ${err}`);
      }

      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
        body: JSON.stringify({
          success: true,
          action: "upload-raw",
          path: gcsPath,
        }),
      };
    }

    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json", ...corsHeaders },
      body: JSON.stringify({
        error: `Unknown action: ${action}. Valid actions: commit-knowledge, flush-approvals, upload-raw`,
      }),
    };
  } catch (err) {
    console.error("gcs-upload error:", err);
    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({
        error: err.message || "Internal server error",
      }),
    };
  }
}
