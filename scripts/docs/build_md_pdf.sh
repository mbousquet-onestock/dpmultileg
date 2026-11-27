#!/usr/bin/env bash
# Markdown -> PDF (pandoc + Playwright Chromium), same style as the other documents.
# Usage: scripts/docs/build_md_pdf.sh docs/SPECIFICATION.md docs/specification-delivery-promise.pdf "Footer text"
set -euo pipefail
cd "$(dirname "$0")/../.."
src="$1"; out="$2"; footer="${3:-Extension UI OneStock}"
tmp="$(mktemp -d)"
pandoc "$src" -s --metadata lang=fr --css scripts/docs/notice.css --embed-resources --no-highlight -o "$tmp/doc.html"
FOOTER="$footer" node scripts/docs/html_to_pdf.cjs "$tmp/doc.html" "$out"
rm -rf "$tmp"
echo "written $out"
