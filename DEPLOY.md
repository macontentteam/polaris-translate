# Polaris Dual-Deploy Workflow

## How This Works

Polaris source code lives in one place:
`jason-vazquez-portfolio/translation-engine/`

This standalone project wraps those same files with its own entry point
so it can be built and deployed independently to the macontentteam
Netlify account (global-translation-engine).

## Local Development

All Polaris development happens inside the portfolio:
```bash
cd ~/Documents/CLAUDES/jason-vazquez-portfolio
npm run dev
# Visit http://localhost:3000/#/translation-generator
```

## When Ready to Deploy

### Step 1: Deploy to empiremediacontent (portfolio)
This is the portfolio deploy. Follow the normal portfolio deploy process.

### Step 2: Deploy to macontentteam (standalone)
```bash
cd ~/Documents/CLAUDES/polaris-standalone

# Sync latest Polaris files from portfolio and build
npm run deploy-prep

# The dist/ folder is now ready for Netlify Drop
# Go to https://app.netlify.com/projects/global-translation-engine/deploys
# Drag the dist/ folder onto the deploy area
```

Or if you have netlify-cli installed:
```bash
npx netlify deploy --prod --dir=dist --site=global-translation-engine
```
(This will only work if your CLI is authenticated to the macontentteam account)

## Important Notes

- NEVER edit files in polaris-standalone/src/translation-engine/ directly
- Always edit in jason-vazquez-portfolio/translation-engine/ and run sync
- The sync script automatically patches the AppView import for standalone mode
- Both versions should stay identical for now
