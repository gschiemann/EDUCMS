#!/usr/bin/env node
// regen-posters.cjs — regenerate gallery poster PNGs for a scoped subdir of
// boards (so we don't touch ~100 unrelated posters and create spurious PNG
// diffs). Mirrors gen-template-posters.cjs. After running, BUMP POSTER_VERSION
// in ScaledTemplateThumbnail.tsx so browsers/CDN refetch.
//
// Usage:  node apps/web/scripts/regen-posters.cjs <subpath> [baseUrl]
//   e.g.  node apps/web/scripts/regen-posters.cjs signage/corporate http://localhost:3000
// baseUrl must serve apps/web/public (the web-prod dev server on :3000 does).
const fs = require('fs');
const path = require('path');
const { chromium } = require('@playwright/test');

const SUBPATH = (process.argv[2] || '').replace(/^\/+|\/+$/g, '');
const BASE = process.argv[3] || 'http://localhost:3000';
if (!SUBPATH) { console.error('usage: regen-posters.cjs <subpath> [baseUrl]'); process.exit(2); }
const ROOT = path.join(__dirname, '..', 'public', 'templates');
const OUT = path.join(ROOT, '_thumbs');
const W = 800, H = 450;

function listBoards(dir, rel) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('_')) continue;
    const abs = path.join(dir, e.name), r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) out.push(...listBoards(abs, r));
    else if (e.name.endsWith('.html')) out.push(r);
  }
  return out;
}

(async () => {
  const dir = path.join(ROOT, SUBPATH);
  if (!fs.existsSync(dir)) { console.error('no such dir: ' + dir); process.exit(2); }
  const boards = listBoards(dir, SUBPATH);
  console.log('Regenerating ' + boards.length + ' posters under ' + SUBPATH + ' from ' + BASE);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  let ok = 0, fail = 0;
  for (const rel of boards) {
    const page = await ctx.newPage();
    try {
      await page.goto(BASE + '/templates/' + rel, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForTimeout(3000); // fonts + autofit + image load + settle
      await page.addStyleTag({ content: '*{animation:none!important;transition:none!important;}' });
      await page.waitForTimeout(150);
      const dest = path.join(OUT, rel.replace(/\.html$/, '.png'));
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      await page.screenshot({ path: dest });
      console.log('  ok ' + rel);
      ok++;
    } catch (e) {
      fail++; console.log('  FAIL ' + rel + ': ' + String(e.message).slice(0, 80));
    } finally { await page.close(); }
  }
  await ctx.close();
  await browser.close();
  console.log('DONE — ' + ok + ' posters written, ' + fail + ' failed');
})();
