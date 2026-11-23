#!/usr/bin/env bash
# Regenerates docs/notice-technique-extension.pdf from docs/NOTICE_TECHNIQUE.md (pandoc + Playwright Chromium).
set -euo pipefail
cd "$(dirname "$0")/../.."
tmp="$(mktemp -d)"
pandoc docs/NOTICE_TECHNIQUE.md -s --metadata lang=fr --css scripts/docs/notice.css --embed-resources --no-highlight -o "$tmp/notice.html"
node scripts/docs/html_to_pdf.cjs "$tmp/notice.html" docs/notice-technique-extension.pdf
rm -rf "$tmp"
echo "written docs/notice-technique-extension.pdf"
