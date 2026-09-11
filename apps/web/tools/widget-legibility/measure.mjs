/**
 * Measure every widget as it ACTUALLY RENDERS at a real signage canvas.
 *
 * ── WHY A REAL BROWSER ────────────────────────────────────────────────
 * The first version of this did the render in jsdom and dumped HTML. jsdom has
 * no layout engine, so every widget that measures its own box rendered nothing
 * and the sweep reported 230 of 702 "blank" — all 230 were the harness. This
 * drives the dev-only widget lab (`/dev/widget-lab`) in Chromium instead, which
 * mounts through the same `WidgetPreview` path as the builder and the player.
 *
 * ── WHAT IT GRADES, and why these four ────────────────────────────────
 *   tiny      Visible text below the legibility floor. A 3840x2160 board is
 *             read from 10-20ft; ~1% of height (22px) is the usual signage
 *             floor. The 2026-09-11 fault that started this — a class name
 *             pinned at 20px by `clamp(12px, 2.2cqh, 20px)` — is exactly this.
 *   overlap   Two text boxes intersecting ("10:00 AM" painted under "Yogger").
 *   overflow  Text painted outside the zone: clipped on a real screen.
 *   blank     A widget that paints no visible text AND no background of its
 *             own. Reported, never auto-failed — a SHAPE or BACKGROUND is
 *             legitimately textless, which is why `blank` is informational and
 *             the baseline decides.
 */
import { chromium } from '/Users/gschiemann/Desktop/EDU CMS/node_modules/.pnpm/playwright@1.59.1/node_modules/playwright/index.mjs';
import fs from 'node:fs';

const BASE = process.env.LAB_BASE || 'http://localhost:3100';
const W = Number(process.env.LAB_W || 3840);
const H = Number(process.env.LAB_H || 2160);
// The floor SCALES with the canvas. A widget in a 320x180 picker tile does not
// need 24px type; a 3840x2160 wall does. ~1.1% of canvas height is the usual
// signage legibility rule, with an 11px absolute floor so a thumbnail is still
// graded on something. Without this an agent could "fix" 4K by hard-coding
// large px and wreck every small zone — which is the mirror image of the bug
// this tool exists to catch.
const FLOOR = Number(process.env.LEGIBILITY_FLOOR || Math.max(11, Math.round(Number(process.env.LAB_H || 2160) * 0.011)));
const OUT = process.env.OUT || '/tmp/wmeasure.json';
const LIMIT = Number(process.env.LIMIT || 0);
// ONLY=a,b,c — measure just these variant ids. What you use while fixing a
// file: a 35-variant pass is seconds, the full 702 is minutes.
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',').map((x) => x.trim()).filter(Boolean)) : null;

const browser = await chromium.launch({ headless: true });

/**
 * The tab is RECYCLED every RECYCLE widgets. Rendering hundreds of 3840x2160
 * pages in one context exhausts the renderer process: the first full run died
 * at widget 401 and then reported "Page crashed" for all 301 that followed —
 * 301 phantom failures that were the harness, not the widgets. A fresh context
 * releases the memory, and a crash mid-flight is retried once on a new tab
 * rather than being recorded as a defect.
 */
const RECYCLE = Number(process.env.RECYCLE || 40);
let ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
let page = await ctx.newPage();
async function freshTab() {
  try { await ctx.close(); } catch { /* already gone */ }
  ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  page = await ctx.newPage();
}

// Roster comes from the RUNNING APP, not a second copy of the registry.
await page.goto(`${BASE}/dev/widget-lab?list=1`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-lab-state="list"]', { timeout: 60_000 });
let roster = JSON.parse(await page.textContent('[data-lab-state="list"]'));
if (ONLY) roster = roster.filter((v) => ONLY.has(v.id));
if (LIMIT) roster = roster.slice(0, LIMIT);
console.log(`roster: ${roster.length} variants · canvas ${W}x${H} · floor ${FLOOR}px`);

const MEASURE = ({ floor, w, h }) => {
  const stage = document.querySelector('[data-lab-stage]');
  if (!stage) return { threw: true };
  const texts = [];
  let painted = 0;
  const walk = (el) => {
    for (const c of el.children) walk(c);
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (r.width >= 2 && r.height >= 2 && cs.visibility !== 'hidden' && cs.display !== 'none' && parseFloat(cs.opacity) > 0.05) {
      const bg = cs.backgroundColor, bi = cs.backgroundImage;
      if ((bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') || (bi && bi !== 'none')) painted++;
    }
    const own = Array.from(el.childNodes).filter((n) => n.nodeType === 3 && n.textContent.trim()).map((n) => n.textContent.trim()).join(' ');
    if (!own) return;
    if (r.width < 1 || r.height < 1) return;
    if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) < 0.08) return;
    texts.push({ px: parseFloat(cs.fontSize), x: r.x, y: r.y, w: r.width, h: r.height, t: own.slice(0, 40) });
  };
  walk(stage);
  const sr = stage.getBoundingClientRect();
  if (!texts.length) return { blank: true, painted };

  const rel = texts.map((t) => ({ ...t, x: t.x - sr.x, y: t.y - sr.y }));
  const tiny = rel.filter((t) => t.px < floor);
  const overflow = rel.filter((t) => t.x < -2 || t.y < -2 || t.x + t.w > w + 2 || t.y + t.h > h + 2);
  let overlap = 0; const overlapEx = [];
  for (let i = 0; i < rel.length; i++) for (let j = i + 1; j < rel.length; j++) {
    const a = rel[i], b = rel[j];
    const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    if (ox > 6 && oy > 6) { overlap++; if (overlapEx.length < 3) overlapEx.push(`"${a.t}" x "${b.t}"`); }
  }
  return {
    texts: rel.length, painted,
    minPx: Math.round(Math.min(...rel.map((t) => t.px)) * 10) / 10,
    maxPx: Math.round(Math.max(...rel.map((t) => t.px)) * 10) / 10,
    tiny: tiny.length, tinyEx: tiny.sort((a, b) => a.px - b.px).slice(0, 3).map((t) => `${Math.round(t.px)}px "${t.t}"`),
    overflow: overflow.length, overflowEx: overflow.slice(0, 2).map((t) => `"${t.t}"`),
    overlap, overlapEx,
  };
};

const measureOne = async (v) => {
  await page.goto(`${BASE}/dev/widget-lab?id=${encodeURIComponent(v.id)}&w=${W}&h=${H}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForSelector('[data-lab-stage]', { timeout: 20_000 });
  await page.waitForTimeout(90);
  return page.evaluate(MEASURE, { floor: FLOOR, w: W, h: H });
};

const results = [];
for (let i = 0; i < roster.length; i++) {
  const v = roster[i];
  if (i > 0 && i % RECYCLE === 0) await freshTab();
  try {
    results.push({ id: v.id, type: v.type, ...(await measureOne(v)) });
  } catch (e) {
    // One retry on a clean tab — distinguishes a widget that really fails from
    // a renderer that had just run out of memory.
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

const n = (f) => results.filter(f).length;
console.log(`\nmeasured ${results.length} at ${W}x${H}`);
console.log(`  threw     : ${n((r) => r.threw)}`);
console.log(`  blank     : ${n((r) => r.blank)}   (informational — a SHAPE/BACKGROUND has no text)`);
console.log(`  tiny text : ${n((r) => r.tiny > 0)}`);
console.log(`  overflow  : ${n((r) => r.overflow > 0)}`);
console.log(`  overlap   : ${n((r) => r.overlap > 0)}`);
console.log(`  CLEAN     : ${n((r) => !r.threw && !r.blank && !r.tiny && !r.overflow && !r.overlap)}`);
console.log(`→ ${OUT}`);

// Name every widget still failing, so a fix loop does not need to open the JSON.
const failing = results.filter((r) => r.threw || r.tiny > 0 || r.overflow > 0 || r.overlap > 0);
if (failing.length) {
  console.log('\nstill failing:');
  for (const f of failing.slice(0, 60)) {
    const bits = [];
    if (f.threw) bits.push('THREW');
    if (f.tiny) bits.push(`tiny=${f.tiny} (${(f.tinyEx || [])[0] || ''})`);
    if (f.overlap) bits.push(`overlap=${f.overlap} (${(f.overlapEx || [])[0] || ''})`);
    if (f.overflow) bits.push(`overflow=${f.overflow} (${(f.overflowEx || [])[0] || ''})`);
    console.log(`  ${f.id.padEnd(34)} ${bits.join('  ')}`);
  }
  if (failing.length > 60) console.log(`  … and ${failing.length - 60} more`);
}
