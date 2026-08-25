/**
 * K-12 backlog canary — bell schedules, achievement showcases, and the
 * school-level news + wayfinder editions (2026-08-21).
 *
 * The headline contract this guards is the LIVING BELL BOARD. Operator:
 * "make sure the bell schedules are living templates with the current period
 * always being updated based on the current time of the template." So the
 * proof here is not "a row is highlighted" — it is that the highlighted row
 * MOVES with wall-clock time, and that the wall clock it follows is the one
 * configured ON THE BOARD (clock.timeZone), not the device's. Two screens in
 * different districts must be able to run the same template and each show
 * their own correct period.
 *
 * Runs its own WebKit instance (the k12-menu canary saturates one browser).
 */
const { webkit } = require('@playwright/test');
const { spawn } = require('node:child_process');
const http = require('node:http');
const { setTimeout: delay } = require('node:timers/promises');
const { resolve } = require('node:path');

/**
 * The board carries an editor-bridge marker like `EDUCMS-SHIM-V9`. Assert a
 * FLOOR, not an exact version: pinning the exact string means the day someone
 * re-injects this pack at the next version, a green suite goes red for a
 * reason that has nothing to do with these boards. (It has already happened
 * twice — a V7 pin, then a V8 one.) The shim is a superset each version, so
 * "at least N" is the real invariant.
 */
function shimVersionAtLeast(html, min) {
  const m = String(html || '').match(/EDUCMS-SHIM-V(\d+)/);
  return !!m && Number(m[1]) >= min;
}

const PUBLIC_DIR = resolve(__dirname, '../../public');
const PORT = 8771;
const BASE = `http://localhost:${PORT}`;

const BELL = [
  'hs/bell-schedule', 'hs/bell-schedule-ledger', 'hs/bell-schedule-orbit',
  'school/ms-bell-locker-line', 'school/ms-bell-agenda-flip', 'school/ms-bell-rotation-radar',
  'school/elem-bell-color-hop', 'school/elem-bell-daybook', 'school/elem-bell-sun-clock',
];
const OTHERS = [
  'hs/achievement', 'hs/achievement-victory-wall', 'hs/achievement-stage-call',
  'school/elem-news-storybook', 'school/elem-news-tv-cart', 'school/elem-news-mailroom',
  'school/ms-news-locker-channel', 'school/ms-news-studio-switcher', 'school/ms-news-notebook-cut',
  'school/elem-wayfinder-color-trail', 'school/elem-wayfinder-neighborhood', 'school/elem-wayfinder-mascot-signpost',
  'school/ms-wayfinder-locker-compass', 'school/ms-wayfinder-patchboard', 'school/ms-wayfinder-courtline',
];
const ALL = [...BELL, ...OTHERS];

// No known defects. (An entry here would name a board+orientation whose
// design owner still owes a fix; it is a disclosure, never a way to quiet a
// gate. 2026-08-21: the one entry that briefly lived here turned out to be a
// self-referential CSS variable in the port — MY bug, not the design's — so
// it was fixed at the source rather than excused.)
const KNOWN_DEFECTS = new Set();

const BRAND = {
  background: '#0d2137', surface: '#fdf8ec', text: '#f2f7fb', muted: '#9fb4c6',
  primary: '#2f6df6', secondary: '#ff7a5c', accent: '#9be24f', accent2: '#ffd75e',
  fontDisplay: 'Georgia', fontBody: 'Verdana',
};

function encodeMap(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function waitForServer(timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await new Promise((ok, bad) => {
        const req = http.get(`${BASE}/`, (res) => { res.resume(); ok(); });
        req.on('error', bad);
        req.setTimeout(1000, () => req.destroy(new Error('timeout')));
      });
      return;
    } catch { await delay(150); }
  }
  throw new Error(`backlog canary server did not start on ${PORT}`);
}

async function auditLayout(page) {
  return page.evaluate(() => {
    const stage = document.getElementById('stage');
    if (!stage) return { error: 'missing #stage' };
    const sr = stage.getBoundingClientRect();
    const vis = [...document.querySelectorAll('[data-field]')].filter((el) => {
      const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
      return cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0' && r.width > 0 && r.height > 0;
    });

    // ESCAPING THE STAGE is measured on the element box: a field whose box
    // leaves the canvas is genuinely broken (that measurement is what caught
    // the Signal Stack footer bug on 2026-08-21).
    const outside = vis.map((el) => ({ key: el.getAttribute('data-field'), r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.left < sr.left - 0.5 || r.top < sr.top - 0.5 ||
        r.right > sr.right + 0.5 || r.bottom > sr.bottom + 0.5).map((f) => f.key);

    // COLLISIONS are measured on the text RANGE (painted glyph extent), not
    // the element box, with the tolerance the design QA itself uses — plus one
    // correction for scale. All numbers below were measured on these boards
    // (2026-08-21) and checked against screenshots:
    //  · element boxes report 1-3px overlaps everywhere from line-box leading;
    //  · emoji font extents dwarf their glyphs (a 📚 box overlaps its label by
    //    26x2.8px while the glyphs never touch), so .icon fields are skipped;
    //  · leading scales with type size, so a fixed 16px floor over-reports on
    //    display faces: a 160px numeral above an 80px heading shares 38px of
    //    line box with a clean 30px gap between the painted glyphs. The height
    //    threshold therefore tracks the smaller font rather than a constant.
    const recs = vis.map((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      return {
        el, key: el.getAttribute('data-field'), r: range.getBoundingClientRect(),
        fs: parseFloat(getComputedStyle(el).fontSize) || 16,
        text: (el.textContent || '').trim(),
      };
    }).filter((rec) => rec.text && !rec.key.endsWith('.icon'));
    const overlaps = [];
    for (let i = 0; i < recs.length; i += 1) {
      for (let j = i + 1; j < recs.length; j += 1) {
        const a = recs[i], b = recs[j];
        if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
        const w = Math.max(0, Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left));
        const h = Math.max(0, Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top));
        const hTol = Math.max(16, 0.5 * Math.min(a.fs, b.fs));
        if (w > 5 && h > hTol && w * h > 150) overlaps.push([a.key, b.key]);
      }
    }
    return { outside, overlaps };
  });
}

const liveState = (page) => page.evaluate(() => {
  const rows = [...document.querySelectorAll('.station, .row, .slot')];
  const f = (k) => ((document.querySelector(`[data-field="${k}"]`) || {}).textContent || '').trim();
  return {
    rows: rows.length,
    now: rows.findIndex((r) => r.classList.contains('now')),
    next: rows.findIndex((r) => r.classList.contains('next-up')),
    done: rows.filter((r) => r.classList.contains('done')).length,
    clock: f('clock.time'),
    count: f('count.value'),
    course: f('current.course'),
  };
});

(async () => {
  const server = spawn('/bin/sh', ['-c', `ulimit -n 4096 2>/dev/null; exec python3 -m http.server ${PORT} --directory "${PUBLIC_DIR}"`], { stdio: ['ignore', 'ignore', 'ignore'] });
  await waitForServer();
  // WebKit's network process wedges after roughly seventy contexts in one
  // instance (every later goto then times out at whatever section it reaches).
  // This run makes well over a hundred, so recycle the instance instead.
  let browser = await webkit.launch({ headless: true });
  let made = 0;
  const newContext = async (opts) => {
    if (made >= 40) {
      await browser.close();
      browser = await webkit.launch({ headless: true });
      made = 0;
    }
    made += 1;
    return browser.newContext(opts);
  };
  let failures = 0;

  try {
    // ── 1. every board: shim + layout, both orientations ──────────────────
    for (const board of ALL) {
      for (const orientation of ['landscape', 'portrait']) {
        const viewport = orientation === 'portrait' ? { width: 540, height: 960 } : { width: 960, height: 540 };
        const context = await newContext({ viewport });
        const page = await context.newPage();
        const pageErrors = [];
        page.on('pageerror', (e) => pageErrors.push(e.message));
        await page.addInitScript(() => {
          window.__msgs = [];
          window.addEventListener('message', (e) => { if (e.data && typeof e.data === 'object') window.__msgs.push(e.data); });
        });
        // Bell boards are staged mid-morning so the audit sees a live board
        // (a real school day, not an all-complete evening state).
        const q = new URLSearchParams();
        if (orientation === 'portrait') q.set('o', 'portrait');
        if (BELL.includes(board)) q.set('time', '10:00');
        await page.goto(`${BASE}/templates/${board}.html?${q}`, { waitUntil: 'domcontentloaded' });
        await page.evaluate(() => document.fonts && document.fonts.ready);
        await delay(120);
        const html = await page.content();
        const ready = await page.evaluate(() => window.__msgs.some((m) => m.type === 'educms-ready'));
        const layout = await auditLayout(page);
        const problems = [];
        if (!shimVersionAtLeast(html, 8)) problems.push('missing the EDUCMS editor bridge (need V8 or newer)');
        if (!ready) problems.push('missing educms-ready');
        if (layout.error) problems.push(layout.error);
        if (layout.outside?.length) problems.push(`clipped/outside: ${layout.outside.join(', ')}`);
        if (layout.overlaps?.length) {
          if (KNOWN_DEFECTS.has(`${board}|${orientation}`)) {
            console.warn(`  ⚠ ${board} ${orientation}: KNOWN design defect, awaiting a composition fix: ${JSON.stringify(layout.overlaps)}`);
          } else {
            problems.push(`text overlaps: ${JSON.stringify(layout.overlaps)}`);
          }
        }
        if (pageErrors.length) problems.push(`page errors: ${pageErrors.join(' | ')}`);
        if (problems.length) { failures += 1; console.error(`✗ ${board} ${orientation}: ${problems.join('; ')}`); }
        else console.log(`✓ ${board} ${orientation}`);
        await context.close();
      }
    }

    // ── 2. THE LIVING CONTRACT: the highlighted period tracks the clock ────
    for (const board of BELL) {
      const context = await newContext({ viewport: { width: 960, height: 540 } });
      const page = await context.newPage();
      const errs = [];
      page.on('pageerror', (e) => errs.push(e.message));
      const at = async (t) => {
        await page.goto(`${BASE}/templates/${board}.html?time=${t}`, { waitUntil: 'domcontentloaded' });
        await delay(250);
        return liveState(page);
      };
      const morning = await at('08:00');
      const midday = await at('10:00');
      const afternoon = await at('13:00');
      const problems = [];
      for (const [label, st] of [['08:00', morning], ['10:00', midday], ['13:00', afternoon]]) {
        if (st.rows < 5) problems.push(`${label}: only ${st.rows} period rows found`);
        if (st.now < 0) problems.push(`${label}: no period marked live`);
        if (!/^\d{2}:\d{2}$/.test(st.count)) problems.push(`${label}: countdown not running ("${st.count}")`);
        if (!st.clock) problems.push(`${label}: clock empty`);
      }
      // The whole point: a later time must land on a later period, and the
      // completed count must grow. A board that highlights a fixed row passes
      // every "is something lit" check and still fails here.
      if (!(morning.now < midday.now && midday.now < afternoon.now)) {
        problems.push(`period did not advance with time: ${morning.now} -> ${midday.now} -> ${afternoon.now}`);
      }
      if (!(morning.done < midday.done && midday.done < afternoon.done)) {
        problems.push(`completed count did not grow: ${morning.done} -> ${midday.done} -> ${afternoon.done}`);
      }
      if (errs.length) problems.push(`page errors: ${errs.join(' | ')}`);
      if (problems.length) { failures += 1; console.error(`✗ ${board} LIVE: ${problems.join('; ')}`); }
      else console.log(`✓ ${board} LIVE: period ${morning.now}→${midday.now}→${afternoon.now}, countdown running`);
      await context.close();
    }

    // ── 3. the clock it follows is the BOARD's, not the device's ──────────
    for (const board of BELL) {
      const problems = [];
      const seen = {};
      for (const zone of ['America/New_York', 'America/Los_Angeles']) {
        const context = await newContext({ viewport: { width: 960, height: 540 } });
        const page = await context.newPage();
        // One fixed real instant: 17:30 UTC = 1:30 PM Eastern / 10:30 AM Pacific.
        await page.clock.install({ time: new Date('2026-08-21T17:30:00Z') });
        await page.goto(`${BASE}/templates/${board}.html?text=${encodeMap({ 'clock.timeZone': zone })}`, { waitUntil: 'domcontentloaded' });
        await delay(300);
        seen[zone] = await liveState(page);
        await context.close();
      }
      const east = seen['America/New_York'], west = seen['America/Los_Angeles'];
      if (east.clock === west.clock) problems.push(`clock ignored the board time zone (both "${east.clock}")`);
      if (east.now === west.now && east.done === west.done) {
        problems.push(`schedule state identical across time zones (now=${east.now}, done=${east.done})`);
      }
      if (problems.length) { failures += 1; console.error(`✗ ${board} TIMEZONE: ${problems.join('; ')}`); }
      else console.log(`✓ ${board} TIMEZONE: ET ${east.clock} (done ${east.done}) vs PT ${west.clock} (done ${west.done})`);
    }

    // ── 4. manual overrides still win over the live engine ────────────────
    {
      const context = await newContext({ viewport: { width: 960, height: 540 } });
      const page = await context.newPage();
      await page.goto(`${BASE}/templates/hs/bell-schedule.html?time=10:00&text=${encodeMap({
        'current.course': 'ASSEMBLY — ALL SCHOOL', 'clock.mode': 'manual', 'clock.time': '9:41 AM',
      })}`, { waitUntil: 'domcontentloaded' });
      await delay(2600); // several 1s ticks
      const st = await liveState(page);
      const problems = [];
      if (st.course !== 'ASSEMBLY — ALL SCHOOL') problems.push(`live engine overwrote a manual field ("${st.course}")`);
      if (st.clock !== '9:41 AM') problems.push(`manual clock overwritten ("${st.clock}")`);
      if (st.now < 0) problems.push('row highlighting stopped while fields were pinned');
      if (problems.length) { failures += 1; console.error(`✗ manual override: ${problems.join('; ')}`); }
      else console.log('✓ manual overrides win; row highlighting keeps tracking');
      await context.close();
    }

    // ── 5. brand tokens reach every ported design ─────────────────────────
    for (const board of ALL) {
      const context = await newContext({ viewport: { width: 960, height: 540 } });
      const page = await context.newPage();
      await page.goto(`${BASE}/templates/${board}.html`, { waitUntil: 'domcontentloaded' });
      await delay(80);
      const before = await page.evaluate(() => {
        const el = document.getElementById('stage');
        const snap = (n) => { const cs = getComputedStyle(n); return cs.backgroundColor + '|' + cs.color; };
        return [...el.querySelectorAll('*')].slice(0, 400).map(snap).join(',');
      });
      await page.goto(`${BASE}/templates/${board}.html?brand=${encodeMap(BRAND)}`, { waitUntil: 'domcontentloaded' });
      await delay(160);
      const after = await page.evaluate(() => {
        const el = document.getElementById('stage');
        const snap = (n) => { const cs = getComputedStyle(n); return cs.backgroundColor + '|' + cs.color; };
        return [...el.querySelectorAll('*')].slice(0, 400).map(snap).join(',');
      });
      if (before === after) { failures += 1; console.error(`✗ ${board}: brand override changed nothing (canonical tokens not wired)`); }
      else console.log(`✓ ${board}: brand override restyles the design`);
      await context.close();
    }
  } finally {
    await browser.close();
    server.kill();
  }

  console.log(`K-12 backlog canary: ${failures ? `${failures} failure(s)` : 'all checks passed'}`);
  process.exit(failures ? 1 : 0);
})().catch((error) => { console.error(error); process.exit(1); });
