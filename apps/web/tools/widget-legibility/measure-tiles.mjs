/**
 * Grade every PICKER THUMBNAIL the way the operator sees it.
 *
 * ── WHY A SECOND MEASURER (2026-09-12) ────────────────────────────────
 * `measure.mjs` grades a widget at 3840x2160 — the wall. It says nothing about
 * the 185x115 box the operator picks FROM, and the picker does not render a
 * widget the way the canvas does: it calls the variant's own `render` with
 * `{...defaultConfig, _thumb: true}` at a fixed `fontSize: 14px`. A widget can
 * be flawless on a wall and useless as a thumbnail, which is exactly what the
 * operator reported:
 *
 *   *"the MJ one is over laping the widget and the confetti one isnt vidsible…
 *    find all these problem ones and fix them"*
 *
 * Two faults, both invisible to the 4K sweep:
 *   BLIND  the tile paints (almost) nothing in its box. The operator cannot
 *          tell what they are about to add. Confetti was this: decoration that
 *          starts above the frame and falls INTO it, so at thumbnail scale the
 *          box is empty.
 *   BLEED  the tile paints OUTSIDE its box. STAFF_HERO_BANNER's dark card ran
 *          past the bottom edge and covered the tile's own name and type.
 *          (The picker now clips — `overflow-hidden` on `data-tile-preview` —
 *          so the label is safe. Clipping is not a fix for the art: a bleeding
 *          tile is showing the operator a CROP of itself. This grades the art.)
 *
 *          ⚠️ BLEED IS A REPORT, NOT A VERDICT. Some designs draw outside
 *          themselves ON PURPOSE — the Hallway LED clock hangs two 2000px
 *          "cables" upward from `bottom: 100%` so they reach the ceiling of
 *          whatever surface it sits on. That is intent, and no measurement can
 *          tell it from an accident. Read the magnitude: the faults worth
 *          chasing announced themselves at 20,000-50,000px with TEXT in them
 *          (a runaway font-size loop); a few hundred px of decoration is a
 *          judgement call, not a defect.
 *
 * BLIND is measured from PIXELS, not the DOM. A DOM walk counts elements with a
 * background and would happily call a 2%-covered tile "painted" — and the whole
 * reason this file exists is that a plausible-looking proxy metric let a visibly
 * broken thumbnail through. So: screenshot the stage, count the pixels that
 * differ from the empty box, and report the fraction.
 *
 * Animations get 700ms to enter the frame before the shutter. A thumbnail that
 * is only legible at one moment of a loop is still broken, but it deserves the
 * chance to be judged at a representative one rather than at t=0.
 *
 * Usage (needs the dev server on LAB_BASE):
 *   node apps/web/tools/widget-legibility/measure-tiles.mjs
 *   ONLY=cel-confetti,staff-hero-banner node …/measure-tiles.mjs
 */
import { chromium } from '/Users/gschiemann/Desktop/EDU CMS/node_modules/.pnpm/playwright@1.59.1/node_modules/playwright/index.mjs';
// pngjs is CommonJS with no ESM export map — reach it through createRequire
// rather than guessing at an entry file that does not exist.
import { createRequire } from 'node:module';
const { PNG } = createRequire(import.meta.url)('/Users/gschiemann/Desktop/EDU CMS/node_modules/.pnpm/pngjs@5.0.0/node_modules/pngjs');
import fs from 'node:fs';

const BASE = process.env.LAB_BASE || 'http://localhost:3100';
// The picker's real geometry: 16:10, ~185px wide in a two-column rail.
const W = Number(process.env.TILE_W || 185);
const H = Math.round((W * 10) / 16);
const OUT = process.env.OUT || '/tmp/tilemeasure.json';
const LIMIT = Number(process.env.LIMIT || 0);
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',').map((x) => x.trim()).filter(Boolean)) : null;
// Below this fraction of painted pixels the tile tells the operator nothing.
// 4% is deliberately generous — a single centred glyph on an empty ground
// clears it; Confetti at 0.6% does not.
const INK_FLOOR = Number(process.env.INK_FLOOR || 0.04);
const SETTLE_MS = Number(process.env.SETTLE_MS || 700);
// The lab paints the empty stage in slate-100, same as the picker.
const BG = [241, 245, 249];

const browser = await chromium.launch({ headless: true });
const RECYCLE = Number(process.env.RECYCLE || 60);
let ctx = await browser.newContext({ viewport: { width: 900, height: 700 }, deviceScaleFactor: 1 });
let page = await ctx.newPage();
async function freshTab() {
  try { await ctx.close(); } catch { /* already gone */ }
  ctx = await browser.newContext({ viewport: { width: 900, height: 700 }, deviceScaleFactor: 1 });
  page = await ctx.newPage();
}

await page.goto(`${BASE}/dev/widget-lab?list=1`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-lab-state="list"]', { timeout: 60_000 });
let roster = JSON.parse(await page.textContent('[data-lab-state="list"]'));
if (ONLY) roster = roster.filter((v) => ONLY.has(v.id));
if (LIMIT) roster = roster.slice(0, LIMIT);
console.log(`roster: ${roster.length} tiles · box ${W}x${H} · ink floor ${(INK_FLOOR * 100).toFixed(1)}%`);

/** DOM half: where the art actually landed, relative to the tile box. */
const GEOMETRY = ({ w, h }) => {
  const stage = document.querySelector('[data-lab-stage]');
  if (!stage) return { threw: true };
  const sr = stage.getBoundingClientRect();
  let worst = 0;
  const bleeders = [];
  const texts = [];
  const walk = (el) => {
    for (const c of el.children) walk(c);
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) < 0.08) return;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    const inked =
      (cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent') ||
      (cs.backgroundImage && cs.backgroundImage !== 'none') ||
      el.tagName === 'IMG' || el.tagName === 'SVG' || el.tagName === 'CANVAS';
    const own = Array.from(el.childNodes)
      .filter((n) => n.nodeType === 3 && n.textContent.trim())
      .map((n) => n.textContent.trim()).join(' ');
    if (own) texts.push({ px: parseFloat(cs.fontSize), x: r.x - sr.x, y: r.y - sr.y, w: r.width, h: r.height, t: own.slice(0, 28) });
    if (!inked && !own) return;
    // How far outside the box, in px, on the worst side.
    const out = Math.max(
      sr.x - r.x, sr.y - r.y,
      (r.x + r.width) - (sr.x + w), (r.y + r.height) - (sr.y + h),
    );
    // CLIPPED OVERFLOW IS NOT A BLEED. The first run of this reported 287
    // bleeds, and the worst offender was a 51,635px sponsor marquee — a
    // SCROLLING TRACK that is deliberately wider than its window and is clipped
    // by an `overflow: hidden` parent. Counting those would have sent me
    // "fixing" ~200 tiles that render perfectly, which is the exact failure
    // this whole measuring rig exists to avoid. Only art that actually reaches
    // the operator's eye outside the frame counts.
    let clipped = false;
    for (let a = el.parentElement; a && a !== stage.parentElement; a = a.parentElement) {
      const acs = getComputedStyle(a);
      if (/hidden|clip|scroll|auto/.test(acs.overflowX) || /hidden|clip|scroll|auto/.test(acs.overflowY)) {
        const ar = a.getBoundingClientRect();
        // The clipping box has to be inside the frame for the clip to help.
        if (ar.x >= sr.x - 3 && ar.y >= sr.y - 3 && ar.x + ar.width <= sr.x + w + 3 && ar.y + ar.height <= sr.y + h + 3) {
          clipped = true;
        }
        break;
      }
    }
    if (out > 3 && !clipped) {
      worst = Math.max(worst, out);
      if (bleeders.length < 3) bleeders.push(`${Math.round(out)}px ${el.tagName.toLowerCase()}${own ? ` "${own.slice(0, 18)}"` : ''}`);
    }
  };
  walk(stage);

  let overlap = 0; const overlapEx = [];
  for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
    const a = texts[i], b = texts[j];
    const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    // 4px of mutual intrusion on BOTH axes at thumbnail scale is a collision,
    // not kerning.
    if (ox > 4 && oy > 4) { overlap++; if (overlapEx.length < 2) overlapEx.push(`"${a.t}" x "${b.t}"`); }
  }
  return {
    bleed: Math.round(worst), bleedEx: bleeders,
    overlap, overlapEx,
    texts: texts.length,
    minPx: texts.length ? Math.round(Math.min(...texts.map((t) => t.px)) * 10) / 10 : null,
  };
};

/**
 * Pixel half: how much FIGURE the tile has against its own GROUND.
 *
 * The first version of this counted pixels differing from the picker's pale
 * panel — and the obvious fix for a blind tile is to paint a background, which
 * would have scored 100% while showing the operator an empty rectangle. A
 * metric a fix can satisfy without doing the work is worse than no metric.
 *
 * So the ground is whatever the tile's MODAL colour turns out to be (its own
 * backdrop, or the empty panel when it paints none), and `figure` is the
 * fraction of pixels that differ from it. A dark card with a white glyph scores
 * on the glyph; a dark card with nothing on it scores ~0, which is the answer.
 * `ink` is kept alongside purely as the "did anything change at all" reading.
 */
function pixelStats(buf) {
  const png = PNG.sync.read(buf);
  const total = png.width * png.height;
  let inked = 0;
  // Quantise to a 32-level cube so antialiasing and gradients don't split the
  // ground into thousands of near-identical buckets.
  const hist = new Map();
  for (let i = 0; i < total; i++) {
    const o = i * 4;
    const a = png.data[o + 3];
    const r = a < 24 ? BG[0] : png.data[o];
    const g = a < 24 ? BG[1] : png.data[o + 1];
    const b = a < 24 ? BG[2] : png.data[o + 2];
    if (Math.abs(r - BG[0]) > 12 || Math.abs(g - BG[1]) > 12 || Math.abs(b - BG[2]) > 12) inked++;
    const key = ((r >> 5) << 10) | ((g >> 5) << 5) | (b >> 5);
    hist.set(key, (hist.get(key) || 0) + 1);
  }
  let bestKey = 0, bestN = -1;
  for (const [k, n] of hist) if (n > bestN) { bestN = n; bestKey = k; }
  const gr = ((bestKey >> 10) & 31) * 8 + 4;
  const gg = ((bestKey >> 5) & 31) * 8 + 4;
  const gb = (bestKey & 31) * 8 + 4;
  let figure = 0;
  for (let i = 0; i < total; i++) {
    const o = i * 4;
    const a = png.data[o + 3];
    const r = a < 24 ? BG[0] : png.data[o];
    const g = a < 24 ? BG[1] : png.data[o + 1];
    const b = a < 24 ? BG[2] : png.data[o + 2];
    if (Math.abs(r - gr) > 18 || Math.abs(g - gg) > 18 || Math.abs(b - gb) > 18) figure++;
  }
  return { ink: inked / total, figure: figure / total };
}

const measureOne = async (v) => {
  await page.goto(`${BASE}/dev/widget-lab?tile=1&id=${encodeURIComponent(v.id)}&w=${W}`, {
    waitUntil: 'domcontentloaded', timeout: 30_000,
  });
  await page.waitForSelector('[data-lab-stage]', { timeout: 20_000 });
  await page.waitForTimeout(SETTLE_MS);
  const geo = await page.evaluate(GEOMETRY, { w: W, h: H });
  const shot = await page.locator('[data-lab-stage]').screenshot({ type: 'png' });
  const px = pixelStats(shot);
  return { ...geo, ink: Math.round(px.ink * 1000) / 1000, figure: Math.round(px.figure * 1000) / 1000 };
};

const results = [];
for (let i = 0; i < roster.length; i++) {
  const v = roster[i];
  if (i > 0 && i % RECYCLE === 0) await freshTab();
  try {
    results.push({ id: v.id, type: v.type, ...(await measureOne(v)) });
  } catch {
    try {
      await freshTab();
      results.push({ id: v.id, type: v.type, ...(await measureOne(v)), retried: true });
    } catch (e2) {
      results.push({ id: v.id, type: v.type, threw: true, err: String(e2).slice(0, 120) });
    }
  }
  if ((i + 1) % 100 === 0) console.log(`  … ${i + 1}/${roster.length}`);
}
await browser.close();
fs.writeFileSync(OUT, JSON.stringify(results, null, 1));

// BLIND is judged on FIGURE, not ink — see pixelStats.
const blind = results.filter((r) => !r.threw && r.figure < INK_FLOOR);
const bleed = results.filter((r) => r.bleed > 3);
const overlap = results.filter((r) => r.overlap > 0);
const threw = results.filter((r) => r.threw);
const n = (a) => a.length;
console.log(`\nmeasured ${results.length} tiles at ${W}x${H}`);
console.log(`  threw   : ${n(threw)}`);
console.log(`  BLIND   : ${n(blind)}   (< ${(INK_FLOOR * 100).toFixed(1)}% of the box is figure against its own ground)`);
console.log(`  BLEED   : ${n(bleed)}   (art outside the frame — REPORT, not a verdict; read the magnitude)`);
console.log(`  overlap : ${n(overlap)}`);
console.log(`  CLEAN   : ${n(results.filter((r) => !r.threw && r.figure >= INK_FLOOR && r.bleed <= 3 && !r.overlap))}`);
console.log(`→ ${OUT}`);

const show = (title, rows, fmt) => {
  if (!rows.length) return;
  console.log(`\n${title}`);
  for (const r of rows.slice(0, 40)) console.log(`  ${r.id.padEnd(34)} ${fmt(r)}`);
  if (rows.length > 40) console.log(`  … and ${rows.length - 40} more`);
};
show('BLIND — the operator cannot see what they are adding:',
  blind.sort((a, b) => a.figure - b.figure), (r) => `figure=${(r.figure * 100).toFixed(1)}%  ink=${(r.ink * 100).toFixed(1)}%  texts=${r.texts}`);
show('BLEED — art escapes the thumbnail frame:',
  bleed.sort((a, b) => b.bleed - a.bleed), (r) => `${r.bleed}px  ${(r.bleedEx || [])[0] || ''}`);
show('OVERLAP — two labels on top of each other:',
  overlap, (r) => `${r.overlap}  ${(r.overlapEx || [])[0] || ''}`);
