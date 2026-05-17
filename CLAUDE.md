# Polaris Standalone

## What This Is
Polaris Global Translation Engine, the standalone version. Forked from the portfolio's `translation-engine/` in May 2026. This is now the sole source of truth for all Polaris development.

## Architecture
- **Frontend**: Vite + React 19, Tailwind via CDN, Lucide icons
- **API Proxies**: Three Netlify serverless functions in `netlify/functions/`:
  - `claude-proxy.js` - Proxies to Claude Sonnet 4 for translation
  - `openai-audit.js` - Proxies to OpenAI GPT-4o for quality audit
  - `kb-upload.js` - Proxies to Cloudflare R2 for knowledge base uploads
- **Knowledge Base**: Cloudflare R2 bucket `polaris-knowledge-base`, public read via r2.dev
- **No routing library**: Single-page app, view state managed via React useState

## Deployment
- **GitHub**: `macontentteam/polaris-translate`
- **Netlify**: `global-translation-engine` site on macontentteam account
- **Deploy method**: Push to `main` triggers auto-deploy
- **Auth**: Netlify password protection (configured in dashboard)
- **Env vars on Netlify**: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`
- **Dev server**: `npm run dev` on port 3010, `npm run dev:netlify` for local function testing

## Important
- The portfolio (`jason-vazquez-portfolio/translation-engine/`) has a FROZEN copy of the old code. Do not sync back to it. Do not edit it. It serves as a demo for recruiters.
- All Polaris development happens here.
- LOCAL-FIRST: Use `npm run dev` during development. Only deploy when a feature is done.
