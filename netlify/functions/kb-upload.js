// Netlify serverless function: handles all R2 write operations for Polaris Knowledge Base
// Env vars required on Netlify:
//   R2_ACCESS_KEY_ID     - Cloudflare R2 API token access key
//   R2_SECRET_ACCESS_KEY - Cloudflare R2 API token secret key
//   R2_ACCOUNT_ID        - Cloudflare account ID
//
// Actions:
//   commit-knowledge  - Merges extracted knowledge into the 5 skill JSON files in R2
//   flush-approvals   - Pushes approved translation records to R2 training data
//   upload-raw        - Uploads a raw file to the R2 bucket (for archival)
//
// The R2 bucket is: polaris-knowledge-base
// Skill files live at: kb/<language>/skill/<filename>.json

import crypto from "crypto";

const BUCKET = "polaris-knowledge-base";
const R2_REGION = "auto";
const SERVICE = "s3";

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
  if (LANGUAGE_TO_FOLDER[language]) {
    return LANGUAGE_TO_FOLDER[language];
  }
  return (language || "german")
    .toLowerCase()
    .replace(/[^a-z]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

// ============================================
// AWS Signature V4 for R2 (S3-compatible)
// ============================================

function hmacSHA256(key, data) {
  return crypto.createHmac("sha256", key).update(data, "utf8").digest();
}

function sha256Hex(data) {
  return crypto.createHash("sha256").update(data, "utf8").digest("hex");
}

function getSignatureKey(secretKey, dateStamp, region, service) {
  const kDate = hmacSHA256(`AWS4${secretKey}`, dateStamp);
  const kRegion = hmacSHA256(kDate, region);
  const kService = hmacSHA256(kRegion, service);
  const kSigning = hmacSHA256(kService, "aws4_request");
  return kSigning;
}

function signRequest(method, path, body, accountId, accessKeyId, secretAccessKey) {
  const host = `${accountId}.r2.cloudflarestorage.com`;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.substring(0, 8);

  const contentHash = sha256Hex(body || "");
  const contentType = "application/json";

  const canonicalHeaders =
    `content-type:${contentType}\n` +
    `host:${host}\n` +
    `x-amz-content-sha256:${contentHash}\n` +
    `x-amz-date:${amzDate}\n`;

  const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date";

  const canonicalRequest = [
    method,
    `/${BUCKET}/${path}`,
    "",
    canonicalHeaders,
    signedHeaders,
    contentHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${R2_REGION}/${SERVICE}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const signingKey = getSignatureKey(secretAccessKey, dateStamp, R2_REGION, SERVICE);
  const signature = crypto
    .createHmac("sha256", signingKey)
    .update(stringToSign, "utf8")
    .digest("hex");

  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    url: `https://${host}/${BUCKET}/${path}`,
    headers: {
      "Content-Type": contentType,
      "x-amz-date": amzDate,
      "x-amz-content-sha256": contentHash,
      Authorization: authorization,
    },
  };
}

// Read a JSON file from R2 via S3 API
async function readR2Json(accountId, accessKeyId, secretAccessKey, path, defaultValue = {}) {
  const { url, headers } = signRequest("GET", path, "", accountId, accessKeyId, secretAccessKey);

  const res = await fetch(url, { method: "GET", headers });

  if (res.status === 404 || res.status === 403) return defaultValue;
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`R2 read failed for ${path}: ${err}`);
  }

  try {
    return await res.json();
  } catch (e) {
    console.error(`R2 file ${path} is not valid JSON, using default`);
    return defaultValue;
  }
}

// Write a JSON file to R2 via S3 API
async function writeR2Json(accountId, accessKeyId, secretAccessKey, path, data) {
  const body = JSON.stringify(data, null, 2);
  const { url, headers } = signRequest("PUT", path, body, accountId, accessKeyId, secretAccessKey);

  const res = await fetch(url, { method: "PUT", headers, body });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`R2 write failed for ${path}: ${err}`);
  }

  return { success: true, path };
}

// Extract array from file data (handles flat arrays AND wrapper objects)
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

  for (let i = 0; i < merged.length; i++) {
    const key = (merged[i].target_approved || "").toLowerCase().trim();
    if (key) existingMap.set(key, i);
  }

  let added = 0;
  let updated = 0;

  for (const term of newTerms) {
    if (!term.target_approved) continue;
    const key = term.target_approved.toLowerCase().trim();
    if (!key) continue;

    if (existingMap.has(key)) {
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
    merged.map((i) => (i.target_equivalent || "").toLowerCase().trim())
  );

  let added = 0;
  for (const idiom of newIdioms) {
    if (!idiom.target_equivalent) continue;
    const key = idiom.target_equivalent.toLowerCase().trim();
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

// Merge SRT timing data
function mergeSRTConstraints(existing, newTiming) {
  if (!newTiming) return { merged: existing, updated: false };

  const existingTiming = existing?.extracted_timing || {};

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
  return {
    merged: { ...existing, extracted_timing: newTimingData },
    updated: true,
  };
}

// ============================================
// MAIN HANDLER
// ============================================

export async function handler(event) {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

  if (!accountId || !accessKeyId || !secretAccessKey) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
      body: JSON.stringify({
        error: "R2 credentials not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY in Netlify env.",
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

    const langFolder = getLanguageFolder(language);
    const basePath = `kb/${langFolder}/skill`;

    // ============================================
    // ACTION: commit-knowledge
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

      // 1. Merge glossary
      if (glossary && glossary.length > 0) {
        const existing = await readR2Json(
          accountId, accessKeyId, secretAccessKey,
          `${basePath}/glossary_master.json`,
          { entries: [] }
        );
        const { merged, added, updated } = mergeGlossary(existing, glossary);
        await writeR2Json(
          accountId, accessKeyId, secretAccessKey,
          `${basePath}/glossary_master.json`,
          { entries: merged }
        );
        results.glossary = { added, updated };
      }

      // 2. Merge idioms
      if (idioms && idioms.length > 0) {
        const existing = await readR2Json(
          accountId, accessKeyId, secretAccessKey,
          `${basePath}/idiom_map.json`,
          { idioms: [] }
        );
        const { merged, added } = mergeIdioms(existing, idioms);
        await writeR2Json(accountId, accessKeyId, secretAccessKey, `${basePath}/idiom_map.json`, { idioms: merged });
        results.idioms = { added };
      }

      // 3. Merge cultural safeguards
      if (cultural_safeguards && cultural_safeguards.length > 0) {
        const existing = await readR2Json(
          accountId, accessKeyId, secretAccessKey,
          `${basePath}/cultural_safeguards.json`,
          { safeguards: [] }
        );
        const { merged, added } = mergeSafeguards(existing, cultural_safeguards);
        await writeR2Json(
          accountId, accessKeyId, secretAccessKey,
          `${basePath}/cultural_safeguards.json`,
          { safeguards: merged }
        );
        results.safeguards = { added };
      }

      // 4. Merge SRT timing constraints
      if (srt_timing) {
        const existing = await readR2Json(
          accountId, accessKeyId, secretAccessKey,
          `${basePath}/srt_constraints.json`,
          {}
        );
        const { merged, updated } = mergeSRTConstraints(existing, srt_timing);
        if (updated) {
          await writeR2Json(
            accountId, accessKeyId, secretAccessKey,
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

      const trainingPath = `kb/${langFolder}/training/approved_translations.json`;
      const existing = await readR2Json(accountId, accessKeyId, secretAccessKey, trainingPath, []);

      const existingIds = new Set(
        (Array.isArray(existing) ? existing : []).map((e) => e.id)
      );
      const newApprovals = approvals.filter((a) => !existingIds.has(a.id));

      if (newApprovals.length > 0) {
        const merged = [...(Array.isArray(existing) ? existing : []), ...newApprovals];
        await writeR2Json(accountId, accessKeyId, secretAccessKey, trainingPath, merged);
      }

      const qaPath = `${basePath}/qa_overrides.json`;
      const existingQA = await readR2Json(accountId, accessKeyId, secretAccessKey, qaPath, { qa_updates: [], banned_variants: [] });

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
        await writeR2Json(accountId, accessKeyId, secretAccessKey, qaPath, mergedQA);
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
      const host = `${accountId}.r2.cloudflarestorage.com`;
      const now = new Date();
      const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
      const dateStamp = amzDate.substring(0, 8);
      const contentHash = crypto.createHash("sha256").update(fileBuffer).digest("hex");
      const ct = contentType || "application/octet-stream";

      const canonicalHeaders =
        `content-type:${ct}\n` +
        `host:${host}\n` +
        `x-amz-content-sha256:${contentHash}\n` +
        `x-amz-date:${amzDate}\n`;
      const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date";

      const canonicalRequest = [
        "PUT",
        `/${BUCKET}/${gcsPath}`,
        "",
        canonicalHeaders,
        signedHeaders,
        contentHash,
      ].join("\n");

      const credentialScope = `${dateStamp}/${R2_REGION}/${SERVICE}/aws4_request`;
      const stringToSign = [
        "AWS4-HMAC-SHA256",
        amzDate,
        credentialScope,
        sha256Hex(canonicalRequest),
      ].join("\n");

      const signingKey = getSignatureKey(secretAccessKey, dateStamp, R2_REGION, SERVICE);
      const signature = crypto
        .createHmac("sha256", signingKey)
        .update(stringToSign, "utf8")
        .digest("hex");

      const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

      const res = await fetch(`https://${host}/${BUCKET}/${gcsPath}`, {
        method: "PUT",
        headers: {
          "Content-Type": ct,
          "x-amz-date": amzDate,
          "x-amz-content-sha256": contentHash,
          Authorization: authorization,
        },
        body: fileBuffer,
      });

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
    console.error("kb-upload error:", err);
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
