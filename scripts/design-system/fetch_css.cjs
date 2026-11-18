/**
 * Download the per-component stylesheets of the OneStock design system storybook
 * (https://design-system.onestock-retail.com) into a folder, for build_official_css.py.
 *
 *   node scripts/design-system/fetch_css.cjs /tmp/dscss
 *   python3 scripts/design-system/build_official_css.py /tmp/dscss web/src/ds/official.css
 *
 * Needs Playwright (Chromium) to render one story per component and collect the CSS it loads.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const BASE = 'https://design-system.onestock-retail.com';
(async () => {
  const outDir = process.argv[2] ?? 'dscss';
  fs.mkdirSync(outDir, { recursive: true });
  const index = await (await fetch(`${BASE}/index.json`)).json();
  const firstStory = new Map();
  for (const e of Object.values(index.entries)) if (e.type === 'story' && /^Components|^Layouts/.test(e.title) && !firstStory.has(e.title)) firstStory.set(e.title, e.id);
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const urls = new Set();
  page.on('response', (r) => /\/assets\/.*\.css$/.test(r.url()) && !/iframe-/.test(r.url()) && urls.add(r.url()));
  for (const id of firstStory.values()) await page.goto(`${BASE}/iframe.html?viewMode=story&id=${id}`, { waitUntil: 'networkidle' });
  await browser.close();
  for (const u of urls) {
    const name = path.basename(u).replace(/-[A-Za-z0-9_-]{8}\.css$/, '.css');
    fs.writeFileSync(path.join(outDir, name), await (await fetch(u)).text());
  }
  console.log(`${urls.size} stylesheets in ${outDir}`);
})();
