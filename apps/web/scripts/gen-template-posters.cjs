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
 * Append relative HTML paths to refresh only those boards and their registered
 * portrait previews, e.g. ... http://localhost:8910 school/elem-schedule-v1.html
 *
 * Capture is done with the REAL board JS running (autofit fits the text), then
 * animations are frozen one frame before the shot so the poster matches the
 * live look. The run()/autofit observer loops are fixed (7d53be44), so a
 * no-freeze capture is safe (no CPU peg).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { chromium } = require('@playwright/test');

const BASE = process.argv[2] || 'http://localhost:8910';
const ROOT = path.join(__dirname, '..', 'public', 'templates');
const OUT = path.join(ROOT, '_thumbs');
const MANIFEST = path.join(OUT, 'poster-manifest.json');
const W = 800, H = 450;            // 16:9 poster; ~30-45KB PNG each
const CONCURRENCY = 4;

// The registry, rather than already-existing PNGs, determines which portrait
// captures are needed. Otherwise the first capture of a new portrait preset
// never creates its preview. Type-only preset modules have no service deps.
function registeredOrientations() {
  const ts = require('typescript');
  const previous = require.extensions['.ts'];
  const catalog = path.resolve(__dirname, '../../api/src/templates');
  const orientations = new Map();
  require.extensions['.ts'] = (module, filename) => module._compile(
    ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    }).outputText, filename,
  );
  try {
    for (const file of fs.readdirSync(catalog).filter(name => /-presets\.ts$/.test(name) && !name.startsWith('ensure-'))) {
      for (const [name, presets] of Object.entries(require(path.join(catalog, file)))) {
        if (!Array.isArray(presets) || !/_TEMPLATE_PRESETS$/.test(name)) continue;
        for (const preset of presets) for (const zone of preset.zones || []) {
          const url = zone.widgetType === 'EXTERNAL_HTML' && zone.defaultConfig?.url;
          if (typeof url !== 'string' || !url.startsWith('/templates/')) continue;
          const rel = url.split(/[?#]/)[0].slice('/templates/'.length);
          const entry = orientations.get(rel) || { landscape: false, portrait: false, portraitQuery: false };
          const portraitQuery = /[?&](?:orientation|o)=portrait\b/.test(url);
          if (preset.orientation === 'PORTRAIT' || portraitQuery) entry.portrait = true;
          else entry.landscape = true;
          entry.portraitQuery ||= portraitQuery;
          orientations.set(rel, entry);
        }
      }
    }
  } finally {
    if (previous) require.extensions['.ts'] = previous;
    else delete require.extensions['.ts'];
  }
  return orientations;
}

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
  const allBoards = listBoards(ROOT);
  const requested = [...new Set(process.argv.slice(3))];
  const unknown = requested.filter(rel => !allBoards.includes(rel));
  if (unknown.length) throw new Error(`Unknown board paths: ${unknown.join(', ')}`);
  const boards = requested.length ? requested : allBoards;
  const orientations = registeredOrientations();
  console.log(`Boards to capture: ${boards.length} (base ${BASE})`);
  const browser = await chromium.launch();
  let ok = 0, fail = 0;
  const queue = boards.slice();
  const captured = {};
  async function worker(id) {
    const ctx = await browser.newContext({ viewport: { width: W, height: H } });
    while (queue.length) {
      const rel = queue.shift();
      const page = await ctx.newPage();
      try {
        const portraitPoster = path.join(OUT, rel.replace(/\.html$/, '-portrait.png'));
        const registered = orientations.get(rel);
        const nativePortrait = registered?.portrait && !registered.landscape && !registered.portraitQuery;
        const captures = [{ portrait: !!nativePortrait, suffix: false }];
        if (registered?.portraitQuery || (registered?.portrait && registered.landscape) || fs.existsSync(portraitPoster)) {
          captures.push({ portrait: true, suffix: true });
        }
        let sourceHash;
        for (const { portrait, suffix } of captures) {
          await page.setViewportSize(portrait ? { width: H, height: W } : { width: W, height: H });
          // The source runtime's explicit demo is for gallery captures only.
          // Never generate an unconfigured-source error as a gallery poster.
          const query = portrait ? '?orientation=portrait' : /^fitness\/gym-media-/.test(rel) ? '?freeze=1' : '';
          const response = await page.goto(`${BASE}/templates/${rel}${query}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
          if (!response || !response.ok()) throw new Error('Board response was not successful');
          const hash = crypto.createHash('sha256').update(await response.body()).digest('hex').slice(0, 16);
          if (sourceHash && sourceHash !== hash) throw new Error('Board changed during its poster capture');
          sourceHash = hash;
          await page.evaluate(() => document.fonts.ready);
          await page.waitForTimeout(2600);               // media + autofit + settle
          await page.addStyleTag({ content: '*{animation:none!important;transition:none!important;}' });
          await page.waitForTimeout(120);
          const dest = path.join(OUT, rel.replace(/\.html$/, suffix ? '-portrait.png' : '.png'));
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          await page.screenshot({ path: dest });
        }
        captured[rel.replace(/\.html$/, '')] = sourceHash;
        ok++;
        if (ok % 25 === 0) console.log(`Captured ${ok}/${boards.length} boards`);
      } catch (e) {
        fail++; console.log(`  FAIL ${rel}: ${String(e.message).slice(0, 80)}`);
      } finally { await page.close(); }
    }
    await ctx.close();
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => worker(i)));
  await browser.close();
  let manifest = {};
  try { manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8')); } catch (_) { /* first capture */ }
  Object.assign(manifest, captured);
  fs.writeFileSync(MANIFEST, JSON.stringify(Object.fromEntries(Object.entries(manifest).sort()), null, 2) + '\n');
  console.log(`DONE — ${ok} posters written to public/templates/_thumbs/, ${fail} failed`);
  if (fail) process.exitCode = 1;
})();
