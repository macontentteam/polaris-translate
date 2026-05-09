// Netlify serverless function: proxies ALL Gemini API calls server-side
// Set GEMINI_API_KEY in Netlify environment variables (NOT in .env or client code)
//
// The client sends the full request body that would normally go to the Gemini REST API.
// This proxy appends the API key and forwards the request.
//
// Client sends: { model, contents, generationConfig?, systemInstruction?, ... }
// Any field accepted by the Gemini generateContent REST API is forwarded as-is.

export async function handler(event) {
  // CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
      body: "",
    };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ error: { message: "GEMINI_API_KEY not configured in Netlify env" } }),
    };
  }

  try {
    const incoming = JSON.parse(event.body);

    // Handle file status polling (used by the File API upload flow)
    if (incoming._fileStatusCheck && incoming.fileName) {
      const statusUrl = `https://generativelanguage.googleapis.com/v1beta/${incoming.fileName}?key=${apiKey}`;
      const statusRes = await fetch(statusUrl);
      const statusData = await statusRes.text();
      return {
        statusCode: statusRes.status,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        body: statusData,
      };
    }

    // Extract model — everything else is forwarded to Gemini as-is
    const { model, ...requestBody } = incoming;
    const geminiModel = model || "gemini-2.5-flash";

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${apiKey}`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });

    const data = await response.text();

    return {
      statusCode: response.status,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      body: data,
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ error: { message: err.message } }),
    };
  }
}
