/**
 * Holiday template bridge test — cross-browser regression guard.
 *
 * Boots a real WebKit (= Safari engine) browser and exercises the
 * postMessage protocol every holiday template uses. Catches the class
 * of "works in Chrome, crashes in Safari" bugs that bit us on
 * 2026-05-09 (literal LF byte inside a regex literal in the inline
 * minified bridge — V8 tolerated it, WebKit threw).
 *
 * Run locally:
 *   cd apps/web && pnpm test:cross-browser
 *
 * Run in CI: see .github/workflows/cross-browser.yml — same script,
 * runs on every push + PR.
 *
 * Per canonical template (18 templates, 3 in parallel):
 *   1. holiday:ready fires with non-empty field schema
 *      (HS Easter also proves a saved size survives delayed data-fit passes)
 *   2. template-set-hotspots:enabled=true sets <html data-hotspots-on="1">,
 *      [data-field] elements get dotted outline + cursor:pointer
 *   3. Click [data-field] posts holiday:fieldClicked with correct key
 *   4. brand vars cross the message boundary and resolve in field styles
 *   5. template-apply-styles applies the complete StyleableField contract,
 *      including an injected Google-font stylesheet
 *   6. hidden=true hides the field and clearing styles restores it
 *   7. template-set-hotspots:enabled=false clears the attribute + outline
 * ES Christmas additionally proves a manual live-clock value stays pinned and
 * clearing it restores runtime text. A final sandbox probe sends brand/font
 * messages from a real null-origin parent into a sandboxed board iframe.
 *
 * Why we need this: the user's policy is "the app must always support
 * Mac and Windows browsers." Ad-hoc local Chrome testing missed Safari
 * fragility for months. This test is the canary.
 *
 * Adding more browsers: import { chromium, firefox } alongside webkit
 * and run testOne for each. Today it's WebKit-only because Safari is
 * the historical blind spot; the protocol passes trivially in Chromium.
 */
const { webkit } = require('@playwright/test');
const { spawn } = require('node:child_process');
const http = require('node:http');
const { setTimeout: delay } = require('node:timers/promises');
const { mkdirSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');

const REPORT_DIR = __dirname;
// apps/web/tests/cross-browser → apps/web/public is up two levels.
const PUBLIC_DIR = resolve(__dirname, '../../public');
const PORT = 8765;
const BASE = `http://localhost:${PORT}`;

const TEMPLATES = [
  'es-christmas', 'es-easter', 'es-halloween', 'es-stpatricks', 'es-thanksgiving', 'es-valentines',
  'ms-christmas', 'ms-easter', 'ms-halloween', 'ms-stpatricks', 'ms-thanksgiving', 'ms-valentines',
  'hs-christmas', 'hs-easter', 'hs-halloween', 'hs-stpatricks', 'hs-thanksgiving', 'hs-valentines',
  // Approved elementary Halloween design alternates (2026-08-21) — same
  // bridge contract as every board above, so they get the same coverage.
  'es-halloween-moonlight', 'es-halloween-parade', 'es-halloween-storybook',
  'ms-halloween-neon-circuit', 'ms-halloween-spirit-zine', 'ms-halloween-midnight-broadcast',
  'hs-halloween-fright-night-cinema', 'hs-halloween-midnight-gallery', 'hs-halloween-editorial-after-dark',
];
const REPORT_TARGETS = [...TEMPLATES, 'sandbox-null-origin'];

const results = [];
function pass(template, step, detail = '') { results.push({ template, step, ok: true, detail }); }
function fail(template, step, detail = '') { results.push({ template, step, ok: false, detail }); }

// Resolve once the server is actually accepting connections, or throw.
// A fixed `await delay(600)` raced the first page.goto into "Connection
// refused" on a loaded CI runner (flaky Cross-Browser red, 2026-05-28) —
// python's http.server can take well over 600ms to bind. Poll instead.
async function waitForServer(port, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      await new Promise((res, rej) => {
        const req = http.get(`http://localhost:${port}/`, (r) => { r.resume(); res(); });
        req.on('error', rej);
        req.setTimeout(1000, () => req.destroy(new Error('readiness probe timeout')));
      });
      return; // listening
    } catch (e) {
      lastErr = e;
      await delay(200);
    }
  }
  throw new Error(`local HTTP server on port ${port} did not become ready in ${timeoutMs}ms: ${lastErr && lastErr.message}`);
}

// Poll page.evaluate(fn,arg) until it returns truthy, or timeout. Fixed
// `delay()`+check races slow / parallel CI runners: the clean holiday boards
// (3 webfonts + ember/fog animation) pushed WebKit past the old 80–150ms
// budget, flaking Cross-Browser red on 2026-06-08 — including UNTOUCHED
// originals that merely shared a 4-up batch. Polling asserts the same thing
// but is robust to load. (Same reasoning as waitForServer above.)
async function waitUntilTruthy(page, fn, arg, timeoutMs = 4000, intervalMs = 60) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await page.evaluate(fn, arg);
    if (last) return last;
    await delay(intervalMs);
  }
  return last;
}

async function startServer() {
  const proc = spawn('python3', ['-m', 'http.server', String(PORT), '--directory', PUBLIC_DIR], {
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  await waitForServer(PORT);
  return proc;
}

async function testOne(browser, template) {
  // reducedMotion: the CI runner renders WebKit in software on 2 cores, and
  // the animation-heavy boards (christmas snow, valentines hearts,
  // thanksgiving leaves) can saturate the main thread there. Boards that
  // honor prefers-reduced-motion stop animating, which keeps style recalc
  // responsive; boards that don't are unaffected. (2026-08-30 — the daily
  // scheduled run had been red since the ~08-19 runner-image roll, failing
  // exactly the 4 heaviest boards on a computed-style wait. See the
  // transition:none note in step 5 for the other half of the fix.)
  const ctx = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    reducedMotion: 'reduce',
  });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  try {
    // Listener BEFORE navigation — captures holiday:ready when inline script
    // posts on DOMContentLoaded. window.parent === window when loaded as
    // top-level page, so the message lands back on this same window.
    await page.addInitScript(({ autoFitProbeField }) => {
      const w = window;
      w.__msgs = [];
      window.addEventListener('message', (e) => {
        if (e.data && typeof e.data === 'object' && typeof e.data.type === 'string') {
          w.__msgs.push({ type: e.data.type, key: e.data.key, fields: e.data.fields });
          // Reproduce the production timing: HolidayWidget posts saved styles
          // as soon as the board announces ready, before delayed data-fit and
          // document.fonts callbacks finish. The shared bridge must reassert
          // this size when those board callbacks mutate the style attribute.
          if (e.data.type === 'holiday:ready' && autoFitProbeField) {
            window.postMessage({
              type: 'template-apply-styles',
              styles: { [autoFitProbeField]: { fontSize: 37 } },
            }, window.location.origin);
          }
        }
      });
    }, { autoFitProbeField: template === 'hs-easter' ? 'headline.sub' : '' });

    await page.goto(`${BASE}/holiday-templates/${template}.html`, { waitUntil: 'load' });

    // Step 1 — holiday:ready (poll: webfonts + load can delay the post on CI)
    const ready = await waitUntilTruthy(page, () => window.__msgs.find((m) => m.type === 'holiday:ready'), null, 8000);
    if (!ready) { fail(template, 'holiday:ready', 'never received'); return; }
    if (!Array.isArray(ready.fields) || ready.fields.length === 0) {
      fail(template, 'holiday:ready', `empty fields array`); return;
    }
    pass(template, 'holiday:ready', `${ready.fields.length} fields`);

    if (template === 'hs-easter') {
      // The board runs fit at 120ms, 500ms, document.fonts.ready, and again
      // after text mutations. Waiting past all scheduled passes catches the
      // exact regression where the saved 37px was replaced by ~96px.
      await delay(900);
      const pinnedSize = await page.evaluate(() => {
        const el = document.querySelector('[data-field="headline.sub"]');
        return el ? el.style.fontSize : null;
      });
      if (pinnedSize !== '37px') {
        fail(template, 'data-fit-style-pinning', `fontSize=${pinnedSize} (expected 37px)`); return;
      }
      pass(template, 'data-fit-style-pinning', '37px survived all delayed fit passes');
      await page.evaluate(() => {
        window.postMessage({ type: 'template-apply-styles', styles: {} }, window.location.origin);
      });
    }

    // Step 2 — enable hotspots
    await page.evaluate(() => {
      window.postMessage({ type: 'template-set-hotspots', enabled: true }, window.location.origin);
    });
    const hotspotsOn = await waitUntilTruthy(page, () => document.documentElement.getAttribute('data-hotspots-on') === '1' ? '1' : null, null, 4000);
    if (hotspotsOn !== '1') {
      fail(template, 'hotspots-on', `attribute = ${JSON.stringify(hotspotsOn)}`); return;
    }
    const outlineProbe = await page.evaluate(() => {
      // Probe a VISIBLE content field. Boards may lead with hidden config
      // spans (theme tokens carrying data-css-var), which are not hotspots and
      // cannot be clicked — picking one made a healthy board look broken.
      const el = [...document.querySelectorAll('[data-field]')].find((node) => {
        const key = node.getAttribute('data-field') || '';
        if (key.startsWith('theme.')) return false;
        const cs = getComputedStyle(node);
        if (cs.display === 'none' || cs.visibility === 'hidden') return false;
        const r = node.getBoundingClientRect();
        if (r.width <= 1 || r.height <= 1) return false;
        // …and the centre must actually hit this field. A field can be visible
        // yet covered by its own container's decoration (the neon-circuit logo
        // paints a ::after border over its initials), and a click there belongs
        // to the container, not the text.
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return !!(hit && hit.closest && hit.closest('[data-field]') === node);
      });
      if (!el) return { found: false };
      const cs = getComputedStyle(el);
      return {
        found: true,
        fieldKey: el.getAttribute('data-field'),
        outlineStyle: cs.outlineStyle,
        outlineWidth: cs.outlineWidth,
        cursor: cs.cursor,
      };
    });
    if (!outlineProbe.found) {
      fail(template, 'hotspot-outline', 'no [data-field] in DOM'); return;
    }
    if (outlineProbe.outlineStyle !== 'dotted' || outlineProbe.cursor !== 'pointer') {
      fail(template, 'hotspot-outline',
        `outlineStyle=${outlineProbe.outlineStyle}, cursor=${outlineProbe.cursor}`); return;
    }
    pass(template, 'hotspot-outline',
      `${outlineProbe.outlineStyle} ${outlineProbe.outlineWidth} on "${outlineProbe.fieldKey}"`);

    // Step 3 — click [data-field], expect holiday:fieldClicked
    await page.evaluate(() => { window.__msgs = []; });
    const firstFieldKey = outlineProbe.fieldKey;
    await page.click(`[data-field="${firstFieldKey}"]`, { force: true });
    const clickMsg = await waitUntilTruthy(page, () => window.__msgs.find((m) => m.type === 'holiday:fieldClicked'), null, 4000);
    if (!clickMsg) {
      fail(template, 'holiday:fieldClicked', 'no message after click'); return;
    }
    if (clickMsg.key !== firstFieldKey) {
      fail(template, 'holiday:fieldClicked', `got "${clickMsg.key}" expected "${firstFieldKey}"`); return;
    }
    pass(template, 'holiday:fieldClicked', `key="${clickMsg.key}"`);

    // Step 4 — brand-token transport. Holiday boards are isolated documents,
    // so inherited custom properties must be explicitly recreated in-frame.
    await page.evaluate(() => {
      window.postMessage({
        type: 'template-apply-brand-vars',
        vars: {
          '--brand-primary': '#123456',
          '--brand-accent': '#fedcba',
        },
      }, window.location.origin);
    });
    const brandVars = await waitUntilTruthy(page, () => {
      const root = document.documentElement.style;
      const primary = root.getPropertyValue('--brand-primary').trim();
      const accent = root.getPropertyValue('--brand-accent').trim();
      return primary === '#123456' && accent === '#fedcba'
        ? { primary, accent }
        : null;
    }, null, 4000);
    if (!brandVars) {
      fail(template, 'template-apply-brand-vars', 'brand variables were not applied'); return;
    }
    pass(template, 'template-apply-brand-vars', `${brandVars.primary} / ${brandVars.accent}`);

    // Step 5 — template-apply-styles (the complete BuilderBottomBar map).
    await page.evaluate((field) => {
      window.postMessage({
        type: 'template-apply-styles',
        styles: { [field]: {
          fontFamily: 'Montserrat, sans-serif',
          fontSize: 99,
          color: 'var(--brand-primary)',
          bold: true,
          italic: true,
          underline: true,
          strikethrough: true,
          textAlign: 'center',
          lineHeight: 1.4,
          backgroundColor: 'var(--brand-accent)',
        } },
      }, window.location.origin);
    }, firstFieldKey);
    // Kill the hotspot affordance's 120ms `background` transition on the
    // element under test BEFORE polling its computed background. On a
    // starved main thread (software-rendered CI WebKit under a canvas
    // animation) a transition can sit on its transparent first frame for
    // the entire wait — this check is about the shim applying the style
    // map and the brand var resolving, not about transition timing. With
    // the transition inert, the computed value lands on the next style
    // recalc. (2026-08-30 — this exact wait was the 10-days-red daily CI
    // failure on es-christmas / es-valentines / ms-thanksgiving /
    // hs-valentines.)
    await page.evaluate((field) => {
      const el = document.querySelector(`[data-field="${field.replace(/"/g, '\\"')}"]`);
      if (el) el.style.setProperty('transition', 'none', 'important');
    }, firstFieldKey);
    await waitUntilTruthy(page, (field) => {
      const el = document.querySelector(`[data-field="${field.replace(/"/g, '\\"')}"]`);
      if (!el || el.style.fontSize !== '99px') return null;
      return /254, 220, 186/.test(getComputedStyle(el).backgroundColor)
        ? true
        : null;
    }, firstFieldKey, 8000);
    const afterStyles = await page.evaluate((field) => {
      const sel = `[data-field="${field.replace(/"/g, '\\"')}"]`;
      const el = document.querySelector(sel);
      if (!el) return null;
      return {
        inlineColor: el.style.color,
        inlineFontFamily: el.style.fontFamily,
        inlineFontSize: el.style.fontSize,
        inlineFontWeight: el.style.fontWeight,
        inlineFontStyle: el.style.fontStyle,
        inlineTextDecoration: el.style.textDecoration,
        inlineTextAlign: el.style.textAlign,
        inlineLineHeight: el.style.lineHeight,
        inlineBackgroundColor: el.style.backgroundColor,
        computedColor: getComputedStyle(el).color,
        computedBackgroundColor: getComputedStyle(el).backgroundColor,
        fontLink: !!document.querySelector('link[data-edu-holiday-font="Montserrat"]'),
      };
    }, firstFieldKey);
    if (!afterStyles) {
      fail(template, 'template-apply-styles', 'field disappeared'); return;
    }
    if (afterStyles.inlineFontSize !== '99px') {
      fail(template, 'template-apply-styles',
        `fontSize=${afterStyles.inlineFontSize} (expected 99px)`); return;
    }
    if (afterStyles.inlineColor !== 'var(--brand-primary)' ||
        !/18, 52, 86/.test(afterStyles.computedColor)) {
      fail(template, 'template-apply-styles',
        `brand color did not resolve: ${JSON.stringify(afterStyles)}`); return;
    }
    const richStyleOk =
      /Montserrat/i.test(afterStyles.inlineFontFamily) &&
      afterStyles.inlineFontWeight === '800' &&
      afterStyles.inlineFontStyle === 'italic' &&
      /underline/.test(afterStyles.inlineTextDecoration) &&
      /line-through/.test(afterStyles.inlineTextDecoration) &&
      afterStyles.inlineTextAlign === 'center' &&
      afterStyles.inlineLineHeight === '1.4' &&
      afterStyles.inlineBackgroundColor === 'var(--brand-accent)' &&
      /254, 220, 186/.test(afterStyles.computedBackgroundColor) &&
      afterStyles.fontLink;
    if (!richStyleOk) {
      fail(template, 'template-apply-styles', `rich style mismatch: ${JSON.stringify(afterStyles)}`); return;
    }

    // Living widgets and editor text changes replace text nodes. Typography
    // must remain sticky after that mutation instead of snapping to defaults.
    await page.evaluate((field) => {
      const el = document.querySelector(`[data-field="${field.replace(/"/g, '\\"')}"]`);
      if (el) el.textContent = `${el.textContent || ''} `;
    }, firstFieldKey);
    const stickyFontSize = await waitUntilTruthy(page, (field) => {
      const el = document.querySelector(`[data-field="${field.replace(/"/g, '\\"')}"]`);
      return el && el.style.fontSize === '99px' ? el.style.fontSize : null;
    }, firstFieldKey, 4000);
    if (stickyFontSize !== '99px') {
      fail(template, 'template-apply-styles', 'font size was lost after a text mutation'); return;
    }
    pass(template, 'template-apply-styles',
      `font=${afterStyles.inlineFontFamily}, size=${afterStyles.inlineFontSize}, decoration=${afterStyles.inlineTextDecoration}`);

    // Step 6 — visibility + reset. This also proves authored display values
    // are restored instead of being permanently clobbered by the bridge.
    const originalDisplay = await page.evaluate((field) => {
      const el = document.querySelector(`[data-field="${field.replace(/"/g, '\\"')}"]`);
      return el ? el.style.display : null;
    }, firstFieldKey);
    await page.evaluate((field) => {
      window.postMessage({
        type: 'template-apply-styles',
        styles: { [field]: { hidden: true } },
      }, window.location.origin);
    }, firstFieldKey);
    const hiddenDisplay = await waitUntilTruthy(page, (field) => {
      const el = document.querySelector(`[data-field="${field.replace(/"/g, '\\"')}"]`);
      return el && el.style.display === 'none' ? el.style.display : null;
    }, firstFieldKey, 4000);
    if (hiddenDisplay !== 'none') {
      fail(template, 'template-style-visibility', `display=${hiddenDisplay}`); return;
    }
    await page.evaluate(() => {
      window.postMessage({ type: 'template-apply-styles', styles: {} }, window.location.origin);
    });
    const restoredDisplay = await waitUntilTruthy(page, ({ field, original }) => {
      const el = document.querySelector(`[data-field="${field.replace(/"/g, '\\"')}"]`);
      return el && el.style.display === original ? `restored:${el.style.display}` : null;
    }, { field: firstFieldKey, original: originalDisplay }, 4000);
    if (restoredDisplay == null) {
      fail(template, 'template-style-visibility', `display did not restore to ${JSON.stringify(originalDisplay)}`); return;
    }
    pass(template, 'template-style-visibility', `display restored to ${JSON.stringify(originalDisplay)}`);

    if (template === 'es-christmas') {
      const liveKey = 'clock.time';
      await page.evaluate((key) => {
        window.postMessage({ type: 'holiday:setField', key, value: 'MANUAL' }, window.location.origin);
      }, liveKey);
      const manualPinned = await waitUntilTruthy(page, (key) => {
        const el = document.querySelector(`[data-field="${key}"][data-live]`);
        return el && el.textContent === 'MANUAL' && el.getAttribute('data-pin') === '1'
          ? true
          : null;
      }, liveKey, 4000);
      if (!manualPinned) {
        fail(template, 'live-field-pinning', 'manual value did not pin'); return;
      }

      // Stand in for the board's clock interval. The bridge records the latest
      // runtime value as the resume point, then immediately restores MANUAL.
      await page.evaluate((key) => {
        const el = document.querySelector(`[data-field="${key}"][data-live]`);
        if (el) el.textContent = 'RUNTIME';
      }, liveKey);
      const stayedPinned = await waitUntilTruthy(page, (key) => {
        const el = document.querySelector(`[data-field="${key}"][data-live]`);
        return el && el.textContent === 'MANUAL' ? true : null;
      }, liveKey, 4000);
      if (!stayedPinned) {
        fail(template, 'live-field-pinning', 'runtime update replaced MANUAL'); return;
      }

      const beforeClear = await page.evaluate((key) => {
        const el = document.querySelector(`[data-field="${key}"][data-live]`);
        return el ? {
          text: el.textContent,
          pin: el.getAttribute('data-pin'),
          fallback: el.__eduHolidayLiveFallback,
        } : null;
      }, liveKey);

      await page.evaluate((key) => {
        window.postMessage({ type: 'holiday:setField', key, value: '' }, window.location.origin);
      }, liveKey);
      const resumed = await waitUntilTruthy(page, (key) => {
        const el = document.querySelector(`[data-field="${key}"][data-live]`);
        return el && el.textContent === 'RUNTIME' && !el.hasAttribute('data-pin')
          ? true
          : null;
      }, liveKey, 4000);
      if (!resumed) {
        const state = await page.evaluate((key) => {
          const el = document.querySelector(`[data-field="${key}"][data-live]`);
          return el ? { text: el.textContent, pin: el.getAttribute('data-pin') } : null;
        }, liveKey);
        fail(template, 'live-field-resume', JSON.stringify({ beforeClear, afterClear: state })); return;
      }
      pass(template, 'live-field-pinning', 'MANUAL survived runtime mutation');
      pass(template, 'live-field-resume', 'clear restored RUNTIME and removed data-pin');
    }

    // Step 7 — disable hotspots
    await page.evaluate(() => {
      window.postMessage({ type: 'template-set-hotspots', enabled: false }, window.location.origin);
    });
    await waitUntilTruthy(page, () => document.documentElement.getAttribute('data-hotspots-on') === null ? true : null, null, 4000);
    const hotspotsOff = await page.evaluate(() => {
      const attr = document.documentElement.getAttribute('data-hotspots-on');
      const el = document.querySelector('[data-field]');
      const cs = el ? getComputedStyle(el) : null;
      return { attr, outlineStyle: cs?.outlineStyle };
    });
    if (hotspotsOff.attr !== null) {
      fail(template, 'hotspots-off', `attribute still set: ${hotspotsOff.attr}`); return;
    }
    if (hotspotsOff.outlineStyle === 'dotted') {
      fail(template, 'hotspots-off', `outline still ${hotspotsOff.outlineStyle}`); return;
    }
    pass(template, 'hotspots-off', `outline=${hotspotsOff.outlineStyle}`);

    if (pageErrors.length > 0) {
      fail(template, 'page-errors', pageErrors.slice(0, 2).join(' | '));
    }
  } finally {
    await ctx.close();
  }
}

async function testNullOriginSandboxTransport(browser) {
  const target = 'sandbox-null-origin';
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  try {
    // page.setContent keeps the parent at about:blank (`location.origin ===
    // "null"). The child intentionally omits allow-same-origin, matching
    // HolidayWidget's production sandbox. Playwright can still inspect that
    // opaque frame even though page JavaScript cannot read its DOM.
    await page.setContent(
      `<iframe title="holiday-sandbox-probe" sandbox="allow-scripts" ` +
      `src="${BASE}/holiday-templates/hs-easter.html" ` +
      `style="width:1280px;height:720px;border:0"></iframe>`,
      { waitUntil: 'load' },
    );

    let frame = page.frames().find((candidate) => candidate.url().includes('/holiday-templates/hs-easter.html'));
    const deadline = Date.now() + 8000;
    while (!frame && Date.now() < deadline) {
      await delay(50);
      frame = page.frames().find((candidate) => candidate.url().includes('/holiday-templates/hs-easter.html'));
    }
    if (!frame) {
      fail(target, 'sandbox-transport', 'holiday iframe never loaded'); return;
    }
    await frame.waitForSelector('[data-field="headline.sub"]', { timeout: 8000 });
    await frame.evaluate(() => {
      window.__holidayParentMessageOrigin = '';
      window.addEventListener('message', (event) => {
        if (event.data && (event.data.type === 'template-apply-brand-vars' ||
            event.data.type === 'template-apply-styles')) {
          window.__holidayParentMessageOrigin = event.origin;
        }
      });
    });

    const parentOrigin = await page.evaluate(() => window.location.origin);
    await page.$eval('iframe', (iframe) => {
      iframe.contentWindow.postMessage({
        type: 'template-apply-brand-vars',
        vars: {
          '--brand-primary': '#0a5c36',
          '--brand-accent': '#ffb000',
        },
      }, '*');
      iframe.contentWindow.postMessage({
        type: 'template-apply-styles',
        styles: {
          'headline.sub': {
            fontFamily: 'Montserrat, sans-serif',
            fontSize: 41,
            color: 'var(--brand-primary)',
          },
        },
      }, '*');
    });

    const state = await waitUntilTruthy(frame, () => {
      const el = document.querySelector('[data-field="headline.sub"]');
      if (!el || el.style.fontSize !== '41px') return null;
      return {
        eventOrigin: window.__holidayParentMessageOrigin,
        primary: document.documentElement.style.getPropertyValue('--brand-primary').trim(),
        accent: document.documentElement.style.getPropertyValue('--brand-accent').trim(),
        inlineFont: el.style.fontFamily,
        inlineColor: el.style.color,
        computedColor: getComputedStyle(el).color,
        fontLink: !!document.querySelector('link[data-edu-holiday-font="Montserrat"]'),
      };
    }, null, 8000);

    const valid = state &&
      parentOrigin === 'null' &&
      state.eventOrigin === 'null' &&
      state.primary === '#0a5c36' &&
      state.accent === '#ffb000' &&
      /Montserrat/.test(state.inlineFont) &&
      state.inlineColor === 'var(--brand-primary)' &&
      /10, 92, 54/.test(state.computedColor) &&
      state.fontLink;
    if (!valid) {
      fail(target, 'sandbox-transport', JSON.stringify({ parentOrigin, state })); return;
    }
    if (pageErrors.length > 0) {
      fail(target, 'page-errors', pageErrors.slice(0, 2).join(' | ')); return;
    }
    pass(target, 'sandbox-transport', 'null-origin brand + font payload applied');
  } finally {
    await ctx.close();
  }
}

(async () => {
  console.log('Starting local HTTP server on port', PORT);
  const server = await startServer();
  try {
    console.log('Launching WebKit (Safari engine)...');
    const browser = await webkit.launch();
    try {
      console.log(`Running ${TEMPLATES.length} templates in 3-way parallel batches...`);
      for (let i = 0; i < TEMPLATES.length; i += 3) {
        const batch = TEMPLATES.slice(i, i + 3);
        await Promise.all(batch.map((t) => testOne(browser, t)));
        process.stdout.write('.');
      }
      await testNullOriginSandboxTransport(browser);
      console.log('');
    } finally {
      await browser.close();
    }
  } finally {
    server.kill();
  }

  const byTemplate = {};
  for (const r of results) {
    if (!byTemplate[r.template]) byTemplate[r.template] = [];
    byTemplate[r.template].push(r);
  }
  let passCount = 0;
  let failCount = 0;
  console.log('\n=== RESULTS ===');
  for (const t of REPORT_TARGETS) {
    const tr = byTemplate[t] || [];
    const tpass = tr.filter((r) => r.ok).length;
    const tfail = tr.filter((r) => !r.ok).length;
    passCount += tpass;
    failCount += tfail;
    const status = tfail === 0 ? '✓' : '✗';
    console.log(`${status} ${t}: ${tpass} pass, ${tfail} fail`);
    for (const r of tr.filter((x) => !x.ok)) {
      console.log(`    ✗ ${r.step}: ${r.detail}`);
    }
  }
  console.log(`\nTOTAL: ${passCount} pass, ${failCount} fail`);

  mkdirSync(REPORT_DIR, { recursive: true });
  writeFileSync(resolve(REPORT_DIR, 'report.json'), JSON.stringify(results, null, 2));
  console.log(`Wrote ${REPORT_DIR}/report.json`);

  process.exit(failCount > 0 ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
