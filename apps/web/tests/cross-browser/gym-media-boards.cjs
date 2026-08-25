/**
 * gym-media-boards.cjs — production gate for the six gym media boards.
 *
 * Two things are checked, in Chromium and WebKit, across every source
 * state the runtime can be in:
 *
 *  1. LAYOUT — Codex's own acceptance criteria for these boards, applied
 *     to the shipped files rather than the review mockups: a fixed stage
 *     at exactly its design size, no page scroll, no text clipped by an
 *     ancestor or pushed off the stage, no two text runs overlapping, and
 *     no essential text below the legibility floor (34px portrait /
 *     30px landscape at stage scale).
 *
 *     This matters more in production than it did in review, because the
 *     shipped truth labels are LONGER than the mockups' ad-hoc wording
 *     ("LIVE · CONNECTED" for "CONNECTED", "COMMERCIAL RIGHTS VERIFIED"
 *     for "RIGHTS VERIFIED"). A label contract that overflows its own row
 *     is not a contract, so every state is measured, not assumed.
 *
 *  2. TRUTH — no state that is not an acknowledged live feed may render
 *     the words LIVE or CONNECTED, and the two states the designer never
 *     composed (unconfigured, denied) must still say something specific
 *     rather than falling back to a connected-looking default.
 *
 * State is driven the way the host drives it — postMessage — not by URL,
 * because on a live screen the URL cannot set state at all.
 */
const { chromium, webkit } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path'), url = require('url');

const PUBLIC = path.resolve(__dirname, '..', '..', 'public');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.css': 'text/css' };

const BOARDS = [
  ['gym-media-pulsecast', 1920, 1080],
  ['gym-media-pulsecast-portrait', 1080, 1920],
  ['gym-media-soundfloor', 1920, 1080],
  ['gym-media-soundfloor-portrait', 1080, 1920],
  ['gym-media-motion-studio', 1920, 1080],
  ['gym-media-motion-studio-portrait', 1080, 1920],
];

/** Every state the runtime can reach, and what each may/may not say. */
const STATES = {
  unconfigured: { must: /NOT CONFIGURED/, mustNot: /\bLIVE\b|\bCONNECTED\b/ },
  fresh:        { must: /\bLIVE\b|\bCONNECTED\b/, mustNot: null },
  stale:        { must: /DELAYED|STALE/,   mustNot: /\bLIVE\b|\bCONNECTED\b/ },
  offline:      { must: /OFFLINE/,         mustNot: /\bLIVE\b|\bCONNECTED\b/ },
  external:     { must: /EXTERNAL/,        mustNot: /\bLIVE\b|\bCONNECTED\b/ },
  denied:       { must: /NOT AUTHORIZED/,  mustNot: /\bLIVE\b|\bCONNECTED\b/ },
  pending:      { must: /ADAPTER PENDING/, mustNot: /\bLIVE\b|\bCONNECTED\b/ },
  demo:         { must: /DEMO/,            mustNot: /\bLIVE\b|\bCONNECTED\b/ },
};

/* Codex's measurement, unchanged in substance: text-run rectangles via
 * Range (not element boxes, which include line-box leading and produce
 * false overlaps), ancestor-clip detection, stage containment. */
function measure({ width, height }) {
  const stage = document.querySelector('#stage, .stage');
  if (!stage) return { missingStage: true };
  const stageRect = stage.getBoundingClientRect();
  const rows = [];
  for (const el of stage.querySelectorAll('*')) {
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) === 0) continue;
    for (const node of [...el.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim())) {
      const range = document.createRange();
      range.selectNodeContents(node);
      const r = range.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      let clipped = false;
      let a = el;
      while (a && a !== document.body) {
        const as = getComputedStyle(a);
        if ([as.overflow, as.overflowX, as.overflowY].some(v => v === 'hidden' || v === 'clip')) {
          const ar = a.getBoundingClientRect();
          if (r.left < ar.left - 1 || r.right > ar.right + 1 || r.top < ar.top - 1 || r.bottom > ar.bottom + 1) clipped = true;
        }
        a = a.parentElement;
      }
      /* Occlusion — but only behind something OPAQUE.
       *
       * These boards drop a fallback PANEL over the hero in every
       * non-playing state: an opaque, z-index-20 box that is SUPPOSED to
       * cover the program copy behind it. Comparing text rectangles alone
       * reports that as an overlap, which would fail the designer's own
       * composed `offline` state.
       *
       * The naive fix — "hit-test the centre, skip anything not on top" —
       * is worse than the bug: when two text runs genuinely collide, the
       * lower one also fails that test, so real overlaps go unreported.
       * (Verified: it silently passed a deliberately overlapped board.)
       *
       * So a run counts as hidden only when something painted above it has
       * a near-opaque background AND covers essentially all of it. Text
       * jumbled on top of other text has no such backing and is still
       * reported. */
      const cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2;
      const hit = document.elementFromPoint(cx, cy);
      let occluded = false;
      if (hit && !(hit === el || el.contains(hit) || hit.contains(el))) {
        const area = Math.max(1, (r.right - r.left) * (r.bottom - r.top));
        for (let n = hit; n && n !== document.body; n = n.parentElement) {
          /* An ANCESTOR of the text is painted beneath it, never over it.
           * Without this the walk reaches .stage — opaque, and covering
           * every run on the board — so everything looked "hidden" and
           * the overlap check reported nothing at all. */
          if (n.contains(el)) break;
          const bg = getComputedStyle(n).backgroundColor || '';
          const parts = (bg.match(/rgba?\(([^)]+)\)/) || [, ''])[1].split(',');
          const alpha = parts.length > 3 ? parseFloat(parts[3]) : (parts.length === 3 ? 1 : 0);
          if (!(alpha > 0.85)) continue;
          const nr = n.getBoundingClientRect();
          const ow = Math.min(nr.right, r.right) - Math.max(nr.left, r.left);
          const oh = Math.min(nr.bottom, r.bottom) - Math.max(nr.top, r.top);
          if (ow > 0 && oh > 0 && (ow * oh) / area >= 0.9) { occluded = true; break; }
        }
      }
      rows.push({
        text: node.textContent.trim().replace(/\s+/g, ' ').slice(0, 80),
        cls: String(el.className || ''),
        fontSize: parseFloat(st.fontSize),
        rect: { left: r.left, right: r.right, top: r.top, bottom: r.bottom },
        outside: r.left < stageRect.left - 1 || r.right > stageRect.right + 1 || r.top < stageRect.top - 1 || r.bottom > stageRect.bottom + 1,
        clipped, occluded,
      });
    }
  }
  const overlaps = [];
  const visible = rows.filter(r => !r.occluded);
  for (let i = 0; i < visible.length; i += 1) {
    for (let j = i + 1; j < visible.length; j += 1) {
      const a = visible[i], b = visible[j];
      const w = Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left);
      const h = Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top);
      if (w > 3 && h > 3) overlaps.push([a.text, b.text]);
    }
  }
  const scale = stageRect.width / (getComputedStyle(stage).width.replace('px', '') || 1);
  const floor = (height > width ? 34 : 30) * scale;
  return {
    missingStage: false,
    stageSize: [parseFloat(getComputedStyle(stage).width), parseFloat(getComputedStyle(stage).height)],
    stageRect: { left: stageRect.left, top: stageRect.top, right: stageRect.right, bottom: stageRect.bottom },
    pageScroll: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
    /* Badges assert; the detail line explains. They are read separately
     * because a detail that says "no provider connected" is the OPPOSITE
     * of a live claim, and a substring test cannot tell the difference. */
    labels: [...document.querySelectorAll('[data-source-status],[data-rights-status],[data-music-status]')]
      .map(n => n.textContent.trim()),
    detail: [...document.querySelectorAll('[data-source-detail]')].map(n => n.textContent.trim()),
    clipped: visible.filter(r => r.outside || r.clipped).map(r => ({ text: r.text, cls: r.cls })),
    small: visible.filter(r => r.fontSize < floor - 0.5).map(r => ({ text: r.text, px: Math.round(r.fontSize / scale), cls: r.cls })),
    occludedCount: rows.length - visible.length,
    overlaps,
  };
}

(async () => {
  const srv = http.createServer((q, r) => {
    const p = path.join(PUBLIC, decodeURIComponent(url.parse(q.url).pathname));
    fs.readFile(p, (e, d) => {
      if (e) { r.writeHead(404); return r.end('nf'); }
      r.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
      r.end(d);
    });
  });
  await new Promise(r => srv.listen(0, r));
  const port = srv.address().port;
  const failures = [];
  let checks = 0;

  for (const [engineName, engine] of [['chromium', chromium], ['webkit', webkit]]) {
    const browser = await engine.launch();
    for (const [board, W, H] of BOARDS) {
      const page = await browser.newPage({ viewport: { width: W, height: H } });
      const errors = [];
      page.on('pageerror', e => errors.push('pageerror: ' + e.message));
      page.on('console', m => { if (m.type() === 'error' && !m.text().includes('Failed to load resource')) errors.push('console: ' + m.text()); });
      await page.goto(`http://127.0.0.1:${port}/templates/fitness/${board}.html`, { waitUntil: 'networkidle' });

      for (const [state, rule] of Object.entries(STATES)) {
        await page.evaluate((s) => window.postMessage({ type: 'educms-overrides', media: { state: s } }, '*'), state);
        await page.waitForTimeout(140);
        const res = await page.evaluate(measure, { width: W, height: H });
        const at = `${engineName}/${board}/${state}`;
        checks += 1;
        if (res.missingStage) { failures.push(`${at}: no fixed stage`); continue; }
        if (res.stageSize[0] !== W || res.stageSize[1] !== H)
          failures.push(`${at}: stage ${res.stageSize.join('x')} expected ${W}x${H}`);
        if (res.pageScroll[0] > W + 1 || res.pageScroll[1] > H + 1)
          failures.push(`${at}: page scrolls ${res.pageScroll.join('x')} past ${W}x${H}`);
        if (res.clipped.length) failures.push(`${at}: clipped text ${JSON.stringify(res.clipped.slice(0, 3))}`);
        if (res.overlaps.length) failures.push(`${at}: overlapping text ${JSON.stringify(res.overlaps.slice(0, 3))}`);
        if (res.small.length) failures.push(`${at}: text below the legibility floor ${JSON.stringify(res.small.slice(0, 3))}`);
        if (!res.labels.length) failures.push(`${at}: no runtime-owned label on the board`);
        const joined = res.labels.join(' | ').toUpperCase();
        if (rule.must && !rule.must.test(joined)) failures.push(`${at}: labels do not say what this state means — "${joined}"`);
        if (rule.mustNot && rule.mustNot.test(joined)) failures.push(`${at}: claims a live feed while ${state} — "${joined}"`);
      }
      if (errors.length) failures.push(`${engineName}/${board}: ${errors.slice(0, 3).join(' | ')}`);
      await page.close();
    }
    await browser.close();
  }
  srv.close();

  if (failures.length) {
    console.error(`\nGYM MEDIA BOARDS — ${failures.length} failure(s) of ${checks} checks:\n`);
    failures.forEach(f => console.error('  ✗ ' + f));
    console.error('');
    process.exit(1);
  }
  console.log(`GYM MEDIA BOARDS: ${checks} checks pass — 6 boards × 8 source states × 2 engines, no clipping/overlap/undersized text, no false live claim.`);
})();
