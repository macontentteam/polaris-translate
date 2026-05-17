// -- CONFIGURATION KEYRING --
// Claude calls route through /api/claude-proxy (serverless function, 60s timeout).
// API keys live server-side only. NEVER hardcode in source files.

export const KEYS = {
    CLAUDE_PROXY: '/api/claude-proxy',
    R2_PUBLIC: 'https://pub-3907c38bb1b4451db0ac41139e7ac3c0.r2.dev',
};