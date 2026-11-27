// Usage: node scripts/docs/html_to_pdf.cjs input.html output.pdf
const { chromium } = require('playwright');
(async () => {
  const [, , input, output] = process.argv;
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('file://' + require('path').resolve(input));
  await page.pdf({
    path: output, format: 'A4', printBackground: true,
    margin: { top: '16mm', bottom: '16mm', left: '15mm', right: '15mm' },
    displayHeaderFooter: true, headerTemplate: '<span></span>',
    footerTemplate: '<div style="font-size:7px;color:#5b6472;width:100%;padding:0 15mm;display:flex;justify-content:space-between"><span>' + (process.env.FOOTER || 'Extension UI OneStock — notice technique') + '</span><span class="pageNumber"></span></div>',
  });
  await browser.close();
})();
