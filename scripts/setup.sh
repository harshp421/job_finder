#!/usr/bin/env bash
# scripts/setup.sh — one-time install of Playwright, markdown parser, and project deps.
# Run from anywhere: `bash scripts/setup.sh` from the project root.

set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"

echo "==> Setting up job_finder in $ROOT"
echo ""

# 1. Node check
if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: Node.js not found."
  echo "Install Node 18+ first: brew install node"
  exit 1
fi
NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "ERROR: Node.js v$NODE_MAJOR detected. Need Node 18 or newer."
  exit 1
fi
echo "✓ Node $(node -v)"

# 2. npm check
if ! command -v npm >/dev/null 2>&1; then
  echo "ERROR: npm not found."
  exit 1
fi
echo "✓ npm $(npm -v)"

# 3. Init package.json if missing
if [ ! -f package.json ]; then
  echo "==> Creating package.json"
  cat > package.json <<'EOF'
{
  "name": "job_finder",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "description": "Local agentic job-search pipeline (Claude Code orchestrated, no external paid APIs).",
  "scripts": {
    "pdf": "node scripts/md-to-pdf.mjs",
    "apply": "node scripts/auto-apply.mjs"
  },
  "dependencies": {
    "marked": "^15.0.0",
    "playwright": "^1.50.0"
  }
}
EOF
fi

# 4. Install npm deps
echo "==> Installing npm dependencies (marked, playwright)..."
npm install --no-fund --no-audit --silent

# 5. Install Playwright Chromium browser
echo "==> Installing Playwright Chromium (~200 MB, one-time)..."
npx --yes playwright install chromium

echo ""
echo "✅ Setup complete."
echo ""
echo "Next:"
echo "  1. Copy each profile/*.example.{json,md} → drop the '.example' and fill in your real details:"
echo "       cp profile/profile.example.json        profile/profile.json"
echo "       cp profile/preferences.example.json    profile/preferences.json"
echo "       cp profile/apply_config.example.json   profile/apply_config.json"
echo "       cp profile/resume_base.example.md      profile/resume_base.md"
echo "  2. Copy .env.example → .env and fill in your SMTP credentials (Gmail App Password recommended)."
echo "  3. (Optional) Connect the Gmail MCP integration in Claude Code to the same address you'll be applying from — needed for /jf-inbox and /jf-outreach."
echo "  4. In Claude Code, from this folder, run:   /jf-daily"
echo ""
echo "Auto-submit is OFF by default — first run will fill forms but NOT submit (you'll see preview.png files)."
echo "When you've checked a few and they look right, set  auto_submit: true  in profile/apply_config.json."
