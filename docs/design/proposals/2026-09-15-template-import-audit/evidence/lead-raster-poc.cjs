/* PoC: rasterize PDF pages using ONLY deps the repo already ships —
 * pdfjs-dist (already an API dependency, already used for text extraction)
 * running inside a headless Chromium page (the API already ships Chromium +
 * puppeteer-core and a hardened forked render worker for SEC-006).
 * Playwright's chromium stands in for the system binary locally. */
const fs = require('fs');
const path = require('path');
const { chromium } = require('@playwright/test');
const REPO = '/Users/gschiemann/Desktop/EDU CMS';
const OUT = '/private/tmp/claude-501/-Users-gschiemann-Desktop-EDU-CMS/18159a1d-5971-45be-a86d-670d68ba1d77/scratchpad/raster';
const PDF = path.join(REPO, 'docs/design/proposals/2026-09-15-template-import-audit/evidence/mixed-layout.pdf');

(async () => {
  const pdfjsPath = require.resolve('pdfjs-dist/legacy/build/pdf.mjs', { paths: [path.join(REPO, 'apps/api')] });
  const pdfjsDir = path.dirname(pdfjsPath);
  const pdfjsSrc = fs.readFileSync(pdfjsPath, 'utf8');
  console.log('pdfjs resolved from the API workspace:', pdfjsPath.replace(REPO, '<repo>'));
  const pdfBytes = fs.readFileSync(PDF);
  console.log('fixture:', path.basename(PDF), pdfBytes.length, 'bytes');

  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // Nothing loads from the network: the module, the worker and the bytes are all injected.
  await page.route('**/*', (r) => (r.request().url().startsWith('data:') ? r.continue() : r.abort()));
  await page.goto('data:text/html,<body></body>');

  const t0 = Date.now();
  const out = await page.evaluate(async ({ src, bytes }) => {
    const blob = new Blob([src], { type: 'text/javascript' });
    const mod = await import(URL.createObjectURL(blob));
    mod.GlobalWorkerOptions.workerSrc = '';           // run on the main thread, no worker fetch
    const data = Uint8Array.from(atob(bytes), (c) => c.charCodeAt(0));
    const doc = await mod.getDocument({ data, isEvalSupported: false, useSystemFonts: false }).promise;
    const pages = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const p = await doc.getPage(i);
      const vp = p.getViewport({ scale: 2 });          // 2x for a crisp signage-grade raster
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
      await p.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
      pages.push({ n: i, w: canvas.width, h: canvas.height, png: canvas.toDataURL('image/png').split(',')[1] });
    }
    return { numPages: doc.numPages, pages };
  }, { src: pdfjsSrc, bytes: pdfBytes.toString('base64') });
  const ms = Date.now() - t0;

  for (const p of out.pages) {
    fs.writeFileSync(path.join(OUT, `page-${p.n}.png`), Buffer.from(p.png, 'base64'));
  }
  console.log(`rendered ${out.pages.length}/${out.numPages} pages in ${ms}ms`);
  for (const p of out.pages) console.log(`  page ${p.n}: ${p.w}x${p.h}px, ${Math.round(p.png.length * 0.75 / 1024)}KB png`);
  console.log('page errors:', errors.length ? errors : 'none');
  await browser.close();
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
