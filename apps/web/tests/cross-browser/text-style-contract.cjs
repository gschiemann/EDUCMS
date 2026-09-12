/**
 * M0-3 — Bold / Italic / Underline on a REAL packaged board, measured with
 * getComputedStyle, in WebKit and Chromium.
 *
 * THE BUG. The builder's text bar writes BOOLEAN flags into the per-field
 * override map (`{bold:true, italic:true, underline:true, strikethrough:true}`).
 * Every board shim read CSS props only. `ExternalHtmlWidget` forwarded the map
 * verbatim, so on all 250 packaged boards the operator pressed Bold, the button
 * lit up, and the headline did not change — in the builder AND on the player,
 * which render through the same component.
 *
 * WHY A BROWSER. The shim is minified inline JS inside a null-origin sandboxed
 * iframe; the thing that matters is the RESOLVED style on the glass, which
 * jsdom cannot tell you (a jsdom `style.fontWeight` reflects the assignment,
 * not the cascade against the board's own CSS). And per CLAUDE.md the whole
 * reason this class of bug shipped once before is that local dev was
 * Chrome-only, so WebKit runs first here.
 *
 * WHAT IT PROVES, per browser, on a packaged board and on a kiosk board:
 *   1. TRANSLATED  — the CSS-prop map the fixed sender now ships lands on the
 *      element (this is the load-bearing path).
 *   2. RAW BOOLEAN — the SAME element responds to the untranslated map the
 *      builder writes, because EDUCMS-SHIM-V14 / `_edit-shim.js` learned the
 *      boolean half too. Delete either `else if` and this assertion goes red.
 *   3. PRECEDENCE  — an explicit numeric fontWeight still beats `bold`.
 *   4. The remaining five properties (line-height, alignment, the highlight
 *      background, colour, hide-field) land in the same pass.
 *
 * Static server only — no Next, no API.
 * Run locally:  cd apps/web && pnpm test:text-style-contract
 */
const { webkit, chromium } = require('@playwright/test');
const { spawn } = require('node:child_process');
const http = require('node:http');
const { setTimeout: delay } = require('node:timers/promises');
const { resolve } = require('node:path');

const PUBLIC_DIR = resolve(__dirname, '../../public');
const PORT = 8773;
const BASE = `http://localhost:${PORT}`;

/** A packaged board (baked shim) and a kiosk board (external _edit-shim.js). */
const BOARD = '/templates/hs/achievement.html';
const KIOSK = '/templates/kiosk/food.html';

let passN = 0;
let failN = 0;
const pass = (b, name, info) => { passN++; console.log(`  ✓ [${b}] ${name}${info ? ' — ' + info : ''}`); };
const fail = (b, name, info) => { failN++; console.log(`  ✗ [${b}] ${name}${info ? ' — ' + info : ''}`); };

async function waitForServer(port, timeoutMs = 10000) {
  const start = Date.now();
  let lastErr;
  while (Date.now() - start < timeoutMs) {
    try {
      await new Promise((res, rej) => {
        const req = http.get(`http://localhost:${port}${BOARD}`, (r) => { r.resume(); res(); });
        req.on('error', rej);
        req.setTimeout(500, () => req.destroy(new Error('timeout')));
      });
      return;
    } catch (e) { lastErr = e; await delay(200); }
  }
  throw new Error(`http server on ${port} not ready in ${timeoutMs}ms: ${lastErr && lastErr.message}`);
}

function startServer() {
  return spawn('python3', ['-m', 'http.server', String(PORT), '--directory', PUBLIC_DIR], { stdio: ['ignore', 'ignore', 'ignore'] });
}

/**
 * Pick a real, visible, leaf-ish text field on whatever the board renders
 * today. Hard-coding a key is how the sibling hide-field spec went stale the
 * moment a board was redesigned.
 */
async function pickField(page) {
  return page.evaluate(() => {
    for (const el of document.querySelectorAll('[data-field]')) {
      const k = el.getAttribute('data-field') || '';
      if (!k || k.startsWith('theme.') || k.startsWith('clock.') || k.startsWith('carousel.')) continue;
      if (!(el.textContent || '').trim()) continue;
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      if (cs.display === 'none' || cs.visibility === 'hidden' || r.width < 2 || r.height < 2) continue;
      return k;
    }
    return null;
  });
}

function readStyle(page, key) {
  return page.evaluate((k) => {
    const el = document.querySelector(`[data-field="${k}"]`);
    if (!el) return null;
    const cs = getComputedStyle(el);
    return {
      fontWeight: cs.fontWeight,
      fontStyle: cs.fontStyle,
      // WebKit reports the longhand; both engines agree on this one.
      textDecorationLine: cs.textDecorationLine,
      lineHeight: cs.lineHeight,
      textAlign: cs.textAlign,
      backgroundColor: cs.backgroundColor,
      color: cs.color,
      display: cs.display,
      fontSize: cs.fontSize,
    };
  }, key);
}

/** Post the exact message shape the live-edit path sends, then settle. */
async function applyStyles(page, key, style) {
  await page.evaluate(
    ({ k, s }) => window.postMessage({ type: 'educms-overrides', text: {}, textStyles: { [k]: s }, img: {} }, '*'),
    { k: key, s: style },
  );
  await delay(250);
}

const hasUnderline = (v) => typeof v === 'string' && v.includes('underline');
const hasLineThrough = (v) => typeof v === 'string' && v.includes('line-through');

async function runPage(page, label, browserName, url) {
  await page.goto(`${BASE}${url}`, { waitUntil: 'load' });
  // Kiosk boards build their DOM from an engine; give it a beat either way.
  await delay(600);

  const key = await pickField(page);
  if (!key) { fail(browserName, `${label}: found an editable text field`); return; }

  const before = await readStyle(page, key);

  // ── 1 + 2. The RAW BOOLEAN map the builder writes ────────────────────
  // This is the assertion the whole fix exists for. Pre-fix it read back the
  // board's own weight, upright, undecorated.
  await applyStyles(page, key, {
    bold: true, italic: true, underline: true, strikethrough: true,
    lineHeight: 1.9, textAlign: 'center', backgroundColor: 'rgb(255, 0, 0)',
  });
  const raw = await readStyle(page, key);

  if (raw.fontWeight === '800') pass(browserName, `${label}: bold:true → font-weight 800`, `was ${before.fontWeight}`);
  else fail(browserName, `${label}: bold:true → font-weight 800`, `got ${raw.fontWeight}`);

  if (raw.fontStyle === 'italic') pass(browserName, `${label}: italic:true → font-style italic`);
  else fail(browserName, `${label}: italic:true → font-style italic`, `got ${raw.fontStyle}`);

  if (hasUnderline(raw.textDecorationLine) && hasLineThrough(raw.textDecorationLine)) {
    pass(browserName, `${label}: underline + strikethrough COMBINE`, raw.textDecorationLine);
  } else {
    fail(browserName, `${label}: underline + strikethrough COMBINE`, `got "${raw.textDecorationLine}"`);
  }

  if (raw.textAlign === 'center') pass(browserName, `${label}: textAlign`);
  else fail(browserName, `${label}: textAlign`, `got ${raw.textAlign}`);

  // line-height resolves to px against the element's own font-size.
  const expectedLh = Math.round(parseFloat(raw.fontSize) * 1.9);
  const gotLh = Math.round(parseFloat(raw.lineHeight));
  if (Number.isFinite(gotLh) && Math.abs(gotLh - expectedLh) <= 2) {
    pass(browserName, `${label}: lineHeight 1.9`, `${raw.lineHeight} ≈ 1.9 × ${raw.fontSize}`);
  } else {
    fail(browserName, `${label}: lineHeight 1.9`, `got ${raw.lineHeight}, expected ≈ ${expectedLh}px`);
  }

  if (raw.backgroundColor === 'rgb(255, 0, 0)') pass(browserName, `${label}: highlight background`);
  else fail(browserName, `${label}: highlight background`, `got ${raw.backgroundColor}`);

  // ── 3. PRECEDENCE — an explicit numeric weight beats the alias ────────
  await applyStyles(page, key, { bold: true, fontWeight: 300 });
  const pre = await readStyle(page, key);
  if (pre.fontWeight === '300') pass(browserName, `${label}: numeric fontWeight wins over bold`);
  else fail(browserName, `${label}: numeric fontWeight wins over bold`, `got ${pre.fontWeight}`);

  // ── 4. The TRANSLATED map the fixed sender actually ships ────────────
  await page.goto(`${BASE}${url}`, { waitUntil: 'load' });
  await delay(600);
  await applyStyles(page, key, {
    fontWeight: 800, fontStyle: 'italic', textDecoration: 'underline line-through',
    lineHeight: 1.9, textAlign: 'center', color: 'rgb(0, 128, 0)',
  });
  const tr = await readStyle(page, key);
  const trOk = tr.fontWeight === '800'
    && tr.fontStyle === 'italic'
    && hasUnderline(tr.textDecorationLine) && hasLineThrough(tr.textDecorationLine)
    && tr.textAlign === 'center'
    && tr.color === 'rgb(0, 128, 0)';
  if (trOk) pass(browserName, `${label}: the sender's TRANSLATED map lands intact`);
  else fail(browserName, `${label}: the sender's TRANSLATED map lands intact`, JSON.stringify(tr));

  // ── 5. hide / restore a field ────────────────────────────────────────
  await applyStyles(page, key, { hidden: true });
  const hidden = await readStyle(page, key);
  if (hidden.display === 'none') pass(browserName, `${label}: hidden:true → display none`);
  else fail(browserName, `${label}: hidden:true → display none`, `got ${hidden.display}`);

  await applyStyles(page, key, { hidden: false });
  const shown = await readStyle(page, key);
  if (shown.display !== 'none') pass(browserName, `${label}: hidden:false restores the field`);
  else fail(browserName, `${label}: hidden:false restores the field`, 'still display:none');
}

async function runBrowser(browserType, browserName) {
  const browser = await browserType.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => {
    if (/access control|Load failed|Failed to fetch|NetworkError|ipapi|fonts\.g/i.test(e.message)) return;
    pageErrors.push(e.message);
  });
  try {
    await runPage(page, 'packaged board', browserName, BOARD);
    await runPage(page, 'kiosk board', browserName, KIOSK);
    if (pageErrors.length === 0) pass(browserName, 'no uncaught page errors');
    else fail(browserName, 'no uncaught page errors', pageErrors.slice(0, 2).join(' || '));
  } finally {
    await browser.close();
  }
}

(async () => {
  const proc = startServer();
  try {
    await waitForServer(PORT);
    console.log(`\nM0-3 text-style contract on real boards (${BOARD}, ${KIOSK})`);
    // WebKit FIRST — the historical blind spot (CLAUDE.md cross-browser #1).
    await runBrowser(webkit, 'webkit');
    await runBrowser(chromium, 'chromium');
  } finally {
    proc.kill();
  }
  console.log(`\n${passN} passed, ${failN} failed`);
  process.exit(failN ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
