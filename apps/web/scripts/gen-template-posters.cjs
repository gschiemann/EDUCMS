#!/usr/bin/env node
/**
 * gen-template-posters.cjs — render a static poster PNG for every EXTERNAL_HTML
 * signage board so the templates gallery can show lightweight <img> thumbnails
 * instead of mounting a live 3840×2160 iframe per card (which is slow to load
 * and spawns a heavy per-tile process). The live iframe is kept only for the
 * full-screen preview + the builder.
 *
 * Output: apps/web/public/templates/_thumbs/<same-rel-path>.png
 * Re-run after editing any board:  node scripts/gen-template-posters.cjs http://localhost:8910
 * (start a static server first:     python3 -m http.server 8910 --directory apps/web/public)
 *
 * Capture is done with the REAL board JS running (autofit fits the text), then
 * animations are frozen one frame before the shot so the poster matches the
 * live look. The run()/autofit observer loops are fixed (7d53be44), so a
 * no-freeze capture is safe (no CPU peg).
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('@playwright/test');

const BASE = process.argv[2] || 'http://localhost:8910';
const ROOT = path.join(__dirname, '..', 'public', 'templates');
const OUT = path.join(ROOT, '_thumbs');
const SUBDIRS = ['hs', 'signage', 'fitness', 'school', 'kiosk'];
const W = 800, H = 450;            // 16:9 poster; ~30-45KB PNG each
const CONCURRENCY = 4;

function listBoards(dir, rel = '') {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('_')) continue;                 // _edit-shim.js, _thumbs, partials
    const abs = path.join(dir, e.name), r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) out.push(...listBoards(abs, r));
    else if (e.name.endsWith('.html')) out.push(r);
  }
  return out;
}

(async () => {
  const boards = SUBDIRS.flatMap(s => {
    const d = path.join(ROOT, s);
    return fs.existsSync(d) ? listBoards(d, s) : [];
  });
  console.log(`Boards to capture: ${boards.length} (base ${BASE})`);
  const browser = await chromium.launch();
  let ok = 0, fail = 0;
  const queue = boards.slice();
  async function worker(id) {
    const ctx = await browser.newContext({ viewport: { width: W, height: H } });
    while (queue.length) {
      const rel = queue.shift();
      const page = await ctx.newPage();
      try {
        await page.goto(`${BASE}/templates/${rel}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await page.waitForTimeout(2600);                  // fonts + autofit + settle
        await page.addStyleTag({ content: '*{animation:none!important;transition:none!important;}' });
        await page.waitForTimeout(120);
        const dest = path.join(OUT, rel.replace(/\.html$/, '.png'));
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        await page.screenshot({ path: dest });
        ok++;
      } catch (e) {
        fail++; console.log(`  FAIL ${rel}: ${String(e.message).slice(0, 80)}`);
      } finally { await page.close(); }
    }
    await ctx.close();
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => worker(i)));
  await browser.close();
  console.log(`DONE — ${ok} posters written to public/templates/_thumbs/, ${fail} failed`);
})();
