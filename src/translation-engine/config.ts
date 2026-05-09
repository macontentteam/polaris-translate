// -- CONFIGURATION KEYRING --
// Gemini calls now route through /api/gemini-proxy (edge function, 30s timeout).
// The GEMINI key is intentionally removed from the client bundle.
// NEVER hardcode API keys in source files.

export const KEYS = {
    GEMINI_PROXY: '/api/gemini-proxy',
    BUCKET: 'translation-engine-vault'
};