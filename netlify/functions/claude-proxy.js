// Netlify serverless function: proxies all Claude API calls server-side
// Set ANTHROPIC_API_KEY in Netlify environment variables
//
// Client sends: { messages, model?, max_tokens?, system?, temperature? }
// Messages use Claude format: [{role: "user", content: "..." or [{type, ...}]}]
// Returns: { text: "response text" }

export async function handler(event) {
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

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ error: "ANTHROPIC_API_KEY not configured in Netlify env" }),
    };
  }

  try {
    const incoming = JSON.parse(event.body);
    const {
      model,
      messages,
      max_tokens,
      system,
      temperature,
    } = incoming;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ error: "Missing or empty 'messages' array" }),
      };
    }

    const requestBody = {
      model: model || "claude-sonnet-4-20250514",
      messages,
      max_tokens: max_tokens || 4096,
    };

    if (system) requestBody.system = system;
    if (temperature !== undefined) requestBody.temperature = temperature;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        statusCode: response.status,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({
          error: data.error?.message || `Claude API error (${response.status})`,
        }),
      };
    }

    const text = data.content
      ?.filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("") || "";

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ text }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ error: err.message || "Internal server error" }),
    };
  }
}
