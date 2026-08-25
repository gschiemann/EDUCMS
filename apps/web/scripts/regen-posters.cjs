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
const crypto = require('crypto');
const { chromium } = require('@playwright/test');

/**
 * Capture-time query per board.
 *
 * The gym media boards render SOURCE NOT CONFIGURED until a source is
 * bound — correct on a real screen, and exactly wrong on a gallery card,
 * where every one of them would advertise itself with an error panel.
 * `freeze=1` is the preview surface: the runtime shows the composition
 * under a locked DEMO PREVIEW badge, which is what the operator is
 * actually choosing between. Encoded here so it is not something the
 * next person has to remember.
 */
function captureQuery(rel) {
  if (/^fitness\/gym-media-/.test(rel)) return '?freeze=1';
  return '';
}

/**
 * Provenance. `_thumbs/poster-manifest.json` records the hash of the board
 * each poster was captured from, so the freshness gate can answer "was
 * this poster generated from THIS version of the board?" instead of
 * guessing from byte churn. Writing a PNG without updating this leaves the
 * gate correctly reporting the poster as stale — which is what happened
 * when these were regenerated with an ad-hoc script.
 */
const MANIFEST = path.join(__dirname, '..', 'public', 'templates', '_thumbs', 'poster-manifest.json');
function recordProvenance(entries) {
  let manifest = {};
  try { manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8')); } catch (_) { /* first write */ }
  for (const rel of entries) {
    const board = path.join(__dirname, '..', 'public', 'templates', rel);
    try {
      manifest[rel.replace(/\.html$/, '')] =
        crypto.createHash('sha256').update(fs.readFileSync(board)).digest('hex').slice(0, 16);
    } catch (_) { /* board vanished mid-run */ }
  }
  const sorted = {};
  for (const k of Object.keys(manifest).sort()) sorted[k] = manifest[k];
  fs.writeFileSync(MANIFEST, JSON.stringify(sorted, null, 2) + '\n');
  return Object.keys(sorted).length;
}

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
  const captured = [];
  for (const rel of boards) {
    const page = await ctx.newPage();
    try {
      await page.goto(BASE + '/templates/' + rel + captureQuery(rel), { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForTimeout(3000); // fonts + autofit + image load + settle
      await page.addStyleTag({ content: '*{animation:none!important;transition:none!important;}' });
      await page.waitForTimeout(150);
      const dest = path.join(OUT, rel.replace(/\.html$/, '.png'));
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      await page.screenshot({ path: dest });
      console.log('  ok ' + rel + (captureQuery(rel) ? '  ' + captureQuery(rel) : ''));
      captured.push(rel);
      ok++;
    } catch (e) {
      fail++; console.log('  FAIL ' + rel + ': ' + String(e.message).slice(0, 80));
    } finally { await page.close(); }
  }
  await ctx.close();
  await browser.close();
  const total = recordProvenance(captured);
  console.log('DONE — ' + ok + ' posters written, ' + fail + ' failed; provenance recorded for '
    + captured.length + ' board(s) (' + total + ' in the manifest).');
})();
