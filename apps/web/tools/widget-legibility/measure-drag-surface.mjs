/**
 * Drag-surface sweep — can an operator MOVE this widget with the mouse?
 *
 * BuilderZone treats a press on any `[data-field]` / `[data-field-jump]`
 * hotspot as an EDIT, never a drag (that is how one-click text editing
 * works). So a zone whose whole body is hotspots cannot be dragged at all —
 * only nudged with the arrow keys or typed into the Position panel. The
 * template-maker audit (2026-09-13) sampled a 9×9 grid inside a zone to find
 * a non-hotspot press point; this sweep asks the same question of EVERY
 * picker variant, rendered in the widget lab at a board-like size.
 *
 * Metric per variant: `hot` = share of a 12×12 grid inside the stage whose
 * top-most element sits inside a hotspot. ≥ 95% = undraggable by mouse.
 * A point that hits nothing but the stage counts as FREE (in the builder that
 * press lands on the zone root and starts a move).
 *
 * Usage (dev server on LAB_BASE):
 *   node apps/web/tools/widget-legibility/measure-drag-surface.mjs
 *   ONLY=text-chalkboard,clock-analog-wood node …   LIMIT=20 node …
 */
import { chromium } from '/Users/gschiemann/Desktop/EDU CMS/node_modules/.pnpm/playwright@1.59.1/node_modules/playwright/index.mjs';
import fs from 'node:fs';

const BASE = process.env.LAB_BASE || 'http://localhost:3100';
const W = Number(process.env.STAGE_W || 960), H = Number(process.env.STAGE_H || 540);
const GRID = Number(process.env.GRID || 12);
const OUT = process.env.OUT || '/tmp/drag-surface.json';
const LIMIT = Number(process.env.LIMIT || 0);
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',').map((x) => x.trim()).filter(Boolean)) : null;
const SETTLE_MS = Number(process.env.SETTLE_MS || 900);
const HOT_LIMIT = Number(process.env.HOT_LIMIT || 0.95);

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: W + 40, height: H + 40 } });
let page = await ctx.newPage();

await page.goto(`${BASE}/dev/widget-lab?list=1`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-lab-state="list"]', { timeout: 60_000 });
let roster = JSON.parse(await page.textContent('[data-lab-state="list"]'));
if (ONLY) roster = roster.filter((v) => ONLY.has(v.id));
if (LIMIT) roster = roster.slice(0, LIMIT);
console.log(`roster: ${roster.length} variants · stage ${W}x${H} · grid ${GRID}x${GRID} · undraggable at ≥ ${HOT_LIMIT * 100}% hotspot`);

const MEASURE = (grid) => {
  const stage = document.querySelector('[data-lab-stage]');
  if (!stage) return { threw: true };
  const r = stage.getBoundingClientRect();
  let total = 0, hot = 0, empty = 0; const fields = new Set();
  for (let gy = 1; gy <= grid; gy++) for (let gx = 1; gx <= grid; gx++) {
    const x = r.x + (r.width * gx) / (grid + 1), y = r.y + (r.height * gy) / (grid + 1); total++;
    const el = document.elementFromPoint(x, y);
    if (!el || el === stage) { empty++; continue; }
    const f = el.closest('[data-field],[data-field-jump]');
    if (f) { hot++; fields.add(f.getAttribute('data-field') || `jump:${f.getAttribute('data-field-jump')}`); }
  }
  return { total, hot, empty, fields: Array.from(fields).slice(0, 8) };
};

const results = []; let i = 0;
for (const v of roster) {
  i++;
  if (i % 60 === 0) { await page.close(); page = await ctx.newPage(); }
  const row = { id: v.id, type: v.type };
  try {
    await page.goto(`${BASE}/dev/widget-lab?id=${encodeURIComponent(v.id)}&w=${W}&h=${H}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    // The lab reports `warming` while fonts/first paint settle, then `ready`; wait for a terminal state.
    await page.waitForSelector('[data-lab-state="ready"], [data-lab-state="unknown-variant"]', { timeout: 12_000 });
    const state = await page.getAttribute('[data-lab-state]', 'data-lab-state');
    if (state !== 'ready') { row.error = state; results.push(row); continue; }
    await page.waitForTimeout(SETTLE_MS);
    const m = await page.evaluate(MEASURE, GRID);
    Object.assign(row, m, { hotFraction: m.total ? m.hot / m.total : 0 });
  } catch (e) { row.error = String(e).slice(0, 120); }
  results.push(row);
  const tag = row.error ? 'ERR ' : row.hotFraction >= HOT_LIMIT ? 'UNDRAGGABLE' : row.hotFraction >= 0.6 ? 'mostly-hot' : 'ok  ';
  console.log(`${String(i).padStart(3)} ${tag} ${v.id} (${v.type}) hot=${row.hotFraction === undefined ? '-' : Math.round(row.hotFraction * 100) + '%'}${row.fields && row.fields.length ? ' fields=' + row.fields.join(',') : ''}${row.error ? ' ' + row.error : ''}`);
}
await browser.close();

const undraggable = results.filter((r) => !r.error && r.hotFraction >= HOT_LIMIT);
const mostly = results.filter((r) => !r.error && r.hotFraction >= 0.6 && r.hotFraction < HOT_LIMIT);
const errors = results.filter((r) => r.error);
fs.writeFileSync(OUT, JSON.stringify({ base: BASE, stage: { W, H }, grid: GRID, hotLimit: HOT_LIMIT, results, summary: { total: results.length, undraggable: undraggable.length, mostlyHot: mostly.length, errors: errors.length } }, null, 2));
console.log(`\n${results.length} variants · UNDRAGGABLE (≥${HOT_LIMIT * 100}% hotspot): ${undraggable.length} · mostly-hot (60–95%): ${mostly.length} · errors: ${errors.length} → ${OUT}`);
if (undraggable.length) console.log('UNDRAGGABLE: ' + undraggable.map((r) => r.id).join(', '));
