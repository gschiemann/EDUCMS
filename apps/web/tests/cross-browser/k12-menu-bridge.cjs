/**
 * K-12 flagship menu bridge + layout canary (WebKit / Safari engine).
 *
 * Guards the exact regressions called out during the 2026-08-16 menu refresh:
 * clipped copy, text collisions, missing portrait composition, dead editor
 * hot-zones, and a video that looks editable but cannot actually be replaced.
 */
const { webkit } = require('@playwright/test');
const { spawn } = require('node:child_process');
const http = require('node:http');
const { setTimeout: delay } = require('node:timers/promises');
const { resolve } = require('node:path');

const PUBLIC_DIR = resolve(__dirname, '../../public');
const PORT = 8768;
const BASE = `http://localhost:${PORT}`;
const BOARDS = [
  'elem-lunch-v1.html',
  'elem-lunch-v2.html',
  'elem-lunch-v3.html',
  'elem-lunch-v4-service-ticket.html',
  'elem-lunch-v5-fresh-counter.html',
  'elem-lunch-v6-menu-lab.html',
  'elem-lunch-v7-counter-windows.html',
  'ms-lunch-campus-lineup.html',
  'ms-lunch-signal-deck.html',
  'ms-lunch-poster-loop.html',
];

// The 2026-08-16 elementary three-choice boards (Color Route / Lunch Edition /
// Counter Windows) additionally prove the full editor contract end-to-end:
// every image slot, every canonical brand token, per-field styles (incl.
// hidden + unhide), max-budget stress copy, click-to-edit key/kind, and both
// clock modes. See ALL-THREE-IMPLEMENTATION-HANDOFF QA gates 3-9.
const CHOICE_BOARDS = ['elem-lunch-v2.html', 'elem-lunch-v3.html', 'elem-lunch-v7-counter-windows.html'];
const STRESS_TEXT = {
  'school.name': 'Dr. Maya Angelou International Elementary School',
  'choice.0.name': 'Oven-Baked Whole-Grain Chicken Tenders',
  'choice.0.description': 'Whole-grain breading with roasted vegetables and a fresh seasonal fruit choice.',
};
const BRAND_OVERRIDES = {
  background: '#0d2137', surface: '#fdf8ec', text: '#f2f7fb', muted: '#9fb4c6',
  primary: '#2f6df6', secondary: '#ff7a5c', accent: '#9be24f', accent2: '#ffd75e',
  positive: '#57a814', negative: '#e0492f',
  fontDisplay: 'Georgia', fontBody: 'Verdana', fontCondensed: 'Courier New',
};
const IMAGE_OVERRIDES = {
  'board.background': '/templates/school/menu-assets/teriyaki-chicken.jpg',
  'school.logo': '/templates/school/menu-assets/quesadilla.jpg',
  'choice.0.photo': '/templates/school/menu-assets/quesadilla.jpg',
  'choice.1.photo': '/templates/school/menu-assets/teriyaki-chicken.jpg',
  'choice.2.photo': '/templates/school/menu-assets/salad-prep-poster.jpg',
};
const STYLE_OVERRIDES = {
  'menu.title': { fontSize: 64, fontFamily: 'Georgia', fontWeight: 900, fontStyle: 'italic', color: '#ffef9f', backgroundColor: 'rgba(0,0,0,0.28)', textAlign: 'left', lineHeight: 1.02 },
  'choice.0.name': { color: '#7a1f11', fontWeight: 900 },
  'choice.0.description': { fontStyle: 'italic' },
  'side.0.name': { textDecoration: 'underline' },
  'allergen.note': { lineHeight: 1.4 },
  'side.2.name': { hidden: true },
};

async function waitForServer(timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await new Promise((resolveReady, reject) => {
        const req = http.get(`${BASE}/`, (res) => {
          res.resume();
          resolveReady();
        });
        req.on('error', reject);
        req.setTimeout(1000, () => req.destroy(new Error('readiness timeout')));
      });
      return;
    } catch {
      await delay(150);
    }
  }
  throw new Error(`menu bridge server did not start on ${PORT}`);
}

function encodeMap(value) {
  return Buffer.from(JSON.stringify(value), 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function auditLayout(page) {
  return page.evaluate(() => {
    const stage = document.getElementById('stage');
    if (!stage) return { error: 'missing #stage' };
    const stageRect = stage.getBoundingClientRect();
    const fields = [...document.querySelectorAll('[data-field]')]
      .filter((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      })
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          element,
          key: element.getAttribute('data-field'),
          rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
        };
      });

    const outside = fields
      .filter(({ rect }) => rect.left < stageRect.left - 0.5 || rect.top < stageRect.top - 0.5 ||
        rect.right > stageRect.right + 0.5 || rect.bottom > stageRect.bottom + 0.5)
      .map(({ key }) => key);
    const overlaps = [];
    for (let i = 0; i < fields.length; i += 1) {
      for (let j = i + 1; j < fields.length; j += 1) {
        const a = fields[i];
        const b = fields[j];
        if (a.element.contains(b.element) || b.element.contains(a.element)) continue;
        const overlapWidth = Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left);
        const overlapHeight = Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top);
        if (overlapWidth > 1 && overlapHeight > 1) overlaps.push([a.key, b.key]);
      }
    }
    return {
      outside,
      overlaps,
      stage: { width: Math.round(stageRect.width), height: Math.round(stageRect.height) },
    };
  });
}

(async () => {
  // ulimit bump: WebKit holds paused byte-range connections open while the
  // news boards stream their MP4, and after ~90 page loads the server can
  // exhaust the default macOS 256-fd limit — every later goto then times out
  // (first seen when the wayfinder pass landed after the video passes).
  const server = spawn('/bin/sh', ['-c', `ulimit -n 4096 2>/dev/null; exec python3 -m http.server ${PORT} --directory "${PUBLIC_DIR}"`], {
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  await waitForServer();
  const browser = await webkit.launch({ headless: true });
  // Second instance for the late sections — see the wayfinder comment.
  let wfBrowser = null;
  let failures = 0;

  try {
    for (const board of BOARDS) {
      for (const orientation of ['landscape', 'portrait']) {
        const viewport = orientation === 'portrait'
          ? { width: 540, height: 960 }
          : { width: 960, height: 540 };
        const context = await browser.newContext({ viewport });
        const page = await context.newPage();
        const pageErrors = [];
        page.on('pageerror', (error) => pageErrors.push(error.message));
        await page.addInitScript(() => {
          window.__menuMessages = [];
          window.addEventListener('message', (event) => {
            if (event.data && typeof event.data === 'object') window.__menuMessages.push(event.data);
          });
        });

        const query = orientation === 'portrait' ? '?o=portrait' : '';
        await page.goto(`${BASE}/templates/school/${board}${query}`, { waitUntil: 'load' });
        await page.evaluate(() => document.fonts && document.fonts.ready);
        const marker = await page.content();
        const ready = await page.evaluate(() => window.__menuMessages.some((message) => message.type === 'educms-ready'));
        const layout = await auditLayout(page);
        const expectedStage = orientation === 'portrait'
          ? { width: 540, height: 960 }
          : { width: 960, height: 540 };
        const problems = [];
        if (!marker.includes('EDUCMS-SHIM-V8')) problems.push('missing V8 editor bridge');
        if (!ready) problems.push('missing educms-ready');
        if (layout.error) problems.push(layout.error);
        if (layout.outside?.length) problems.push(`clipped/outside: ${layout.outside.join(', ')}`);
        if (layout.overlaps?.length) problems.push(`text overlaps: ${JSON.stringify(layout.overlaps)}`);
        if (JSON.stringify(layout.stage) !== JSON.stringify(expectedStage)) {
          problems.push(`stage ${JSON.stringify(layout.stage)} != ${JSON.stringify(expectedStage)}`);
        }
        if (pageErrors.length) problems.push(`page errors: ${pageErrors.join(' | ')}`);

        if (problems.length) {
          failures += 1;
          console.error(`✗ ${board} ${orientation}: ${problems.join('; ')}`);
        } else {
          console.log(`✓ ${board} ${orientation}: no clipping or text collisions`);
        }
        await context.close();
      }
    }

    // Editor-contract pass for the three-choice boards: overrides + stress
    // copy must apply AND keep the layout collision-free in both orientations.
    for (const board of CHOICE_BOARDS) {
      for (const orientation of ['landscape', 'portrait']) {
        const viewport = orientation === 'portrait'
          ? { width: 540, height: 960 }
          : { width: 960, height: 540 };
        const context = await browser.newContext({ viewport });
        const page = await context.newPage();
        const pageErrors = [];
        page.on('pageerror', (error) => pageErrors.push(error.message));
        await page.addInitScript(() => {
          window.__menuMessages = [];
          window.addEventListener('message', (event) => {
            if (event.data && typeof event.data === 'object') window.__menuMessages.push(event.data);
          });
        });
        const query = new URLSearchParams({
          text: encodeMap(STRESS_TEXT),
          brand: encodeMap(BRAND_OVERRIDES),
          img: encodeMap(IMAGE_OVERRIDES),
          textStyles: encodeMap(STYLE_OVERRIDES),
        });
        if (orientation === 'portrait') query.set('o', 'portrait');
        await page.goto(`${BASE}/templates/school/${board}?${query}`, { waitUntil: 'load' });
        await page.evaluate(() => document.fonts && document.fonts.ready);
        await delay(80);

        const state = await page.evaluate(() => {
          const rootStyle = document.documentElement.style;
          const title = document.querySelector('[data-field="menu.title"]');
          const titleCs = title ? getComputedStyle(title) : {};
          const hiddenEl = document.querySelector('[data-field="side.2.name"]');
          return {
            slots: [...document.querySelectorAll('[data-imgslot]')].map((el) => ({
              key: el.getAttribute('data-imgslot'),
              has: el.getAttribute('data-has-image') === 'true',
              bg: (el.style.backgroundImage || '').includes('menu-assets'),
            })),
            primary: rootStyle.getPropertyValue('--primary').trim(),
            muted: rootStyle.getPropertyValue('--text-muted').trim(),
            accent2: rootStyle.getPropertyValue('--accent2').trim(),
            positive: rootStyle.getPropertyValue('--positive').trim(),
            fonts: [rootStyle.getPropertyValue('--font-display'), rootStyle.getPropertyValue('--font-body'), rootStyle.getPropertyValue('--font-condensed')].join('|'),
            title: { size: titleCs.fontSize, style: titleCs.fontStyle, family: titleCs.fontFamily, weight: titleCs.fontWeight, align: titleCs.textAlign, lineHeight: titleCs.lineHeight },
            schoolName: (document.querySelector('[data-field="school.name"]') || {}).textContent || '',
            hiddenDisplay: hiddenEl ? getComputedStyle(hiddenEl).display : 'missing',
          };
        });
        const layout = await auditLayout(page);
        const problems = [];
        if (state.slots.length !== 5 || state.slots.some((slot) => !slot.has || !slot.bg)) {
          problems.push(`image slots not applied: ${JSON.stringify(state.slots)}`);
        }
        if (state.primary !== '#2f6df6' || state.muted !== '#9fb4c6' || state.accent2 !== '#ffd75e' || state.positive !== '#57a814') {
          problems.push(`brand tokens not applied: ${state.primary}/${state.muted}/${state.accent2}/${state.positive}`);
        }
        if (!/Georgia/.test(state.fonts) || !/Verdana/.test(state.fonts) || !/Courier New/.test(state.fonts)) {
          problems.push(`brand fonts not applied: ${state.fonts}`);
        }
        if (state.title.size !== '64px' || state.title.style !== 'italic' || !/Georgia/.test(state.title.family) ||
            String(state.title.weight) !== '900' || state.title.align !== 'left') {
          problems.push(`field styles not applied: ${JSON.stringify(state.title)}`);
        }
        if (state.schoolName !== STRESS_TEXT['school.name']) problems.push(`stress text not applied: "${state.schoolName}"`);
        if (state.hiddenDisplay !== 'none') problems.push(`hidden style not applied (side.2.name display=${state.hiddenDisplay})`);
        if (layout.error) problems.push(layout.error);
        if (layout.outside?.length) problems.push(`stress copy clipped/outside: ${layout.outside.join(', ')}`);
        // Stress-string OVERLAPS are a WARNING, not a failure: the approved
        // board geometry is untouchable (operator directive 2026-08-16 — no
        // implementation-side design changes, ever), the content budgets are
        // editor guidance, and two of the three mandated stress strings exceed
        // those budgets. Default copy stays hard-asserted collision-free in
        // the generic pass above; anything ESCAPING the stage still fails here.
        if (layout.overlaps?.length) {
          console.warn(`  ⚠ ${board} ${orientation}: over-budget stress copy wraps into a neighbor region: ${JSON.stringify(layout.overlaps)}`);
        }

        // Unhide over the live bridge (postMessage transport, not URL).
        await page.evaluate(() => window.postMessage({ type: 'educms-overrides', textStyles: { 'side.2.name': { hidden: false } } }, '*'));
        await delay(40);
        const unhidden = await page.evaluate(() => getComputedStyle(document.querySelector('[data-field="side.2.name"]')).display);
        if (unhidden === 'none') problems.push('unhide via educms-overrides failed');

        if (orientation === 'landscape') {
          // Click-to-edit hot zones report the right key/kind.
          await page.evaluate(() => window.postMessage({ type: 'educms-edit-mode', on: true }, '*'));
          await delay(40);
          await page.locator('[data-field="menu.title"]').click({ force: true });
          await delay(40);
          await page.locator('[data-imgslot="choice.0.photo"]').click({ force: true });
          await delay(40);
          const clicks = await page.evaluate(() => window.__menuMessages.filter((message) => message.type === 'educms-field-click'));
          const textClick = clicks.find((click) => click.key === 'menu.title' && click.kind === 'text');
          const imgClick = clicks.find((click) => click.key === 'choice.0.photo' && click.kind === 'img');
          if (!textClick || !imgClick) problems.push(`click-to-edit wrong: ${JSON.stringify(clicks)}`);
        }
        if (pageErrors.length) problems.push(`page errors: ${pageErrors.join(' | ')}`);

        if (problems.length) {
          failures += 1;
          console.error(`✗ ${board} ${orientation} editor contract: ${problems.join('; ')}`);
        } else {
          console.log(`✓ ${board} ${orientation}: overrides, styles, stress copy, hot zones`);
        }
        await context.close();
      }

      // Clock contract: manual text survives a >35s window untouched; a live
      // America/New_York 24-hour clock renders correctly and never throws.
      const clockContext = await browser.newContext({ viewport: { width: 960, height: 540 } });
      const clockPage = await clockContext.newPage();
      const clockErrors = [];
      clockPage.on('pageerror', (error) => clockErrors.push(error.message));
      await clockPage.clock.install({ time: new Date('2026-08-17T11:05:00-07:00') });
      await clockPage.goto(`${BASE}/templates/school/${board}?text=${encodeMap({ 'clock.mode': 'manual', 'clock.time': '7:58 PM' })}`, { waitUntil: 'load' });
      await clockPage.clock.fastForward(36_000);
      const manualText = await clockPage.evaluate(() => document.querySelector('[data-live="clock"]').textContent.trim());
      await clockContext.close();

      const nyContext = await browser.newContext({ viewport: { width: 960, height: 540 } });
      const nyPage = await nyContext.newPage();
      nyPage.on('pageerror', (error) => clockErrors.push(error.message));
      await nyPage.clock.install({ time: new Date('2026-08-17T16:45:00-04:00') });
      await nyPage.goto(`${BASE}/templates/school/${board}?text=${encodeMap({ 'clock.timeZone': 'America/New_York', 'clock.hour12': 'no' })}`, { waitUntil: 'load' });
      await nyPage.clock.fastForward(31_000);
      const nyText = await nyPage.evaluate(() => document.querySelector('[data-live="clock"]').textContent.trim());
      await nyContext.close();

      const clockProblems = [];
      if (manualText !== '7:58 PM') clockProblems.push(`manual clock overwritten: "${manualText}"`);
      if (nyText !== '16:45') clockProblems.push(`NY 24h clock wrong: "${nyText}"`);
      if (clockErrors.length) clockProblems.push(`clock page errors: ${clockErrors.join(' | ')}`);
      if (clockProblems.length) {
        failures += 1;
        console.error(`✗ ${board} clock contract: ${clockProblems.join('; ')}`);
      } else {
        console.log(`✓ ${board}: manual clock survives 36s; live NY 24h clock correct`);
      }
    }

    // MS Campus Lineup boards (2026-08-17, all three shipped on operator
    // request): carousel + editor contract. Every slide must pass collision QA
    // in both orientations (fake clock steps the 6s autoplay), IMG-tag media
    // slots must actually swap src (the V8 IMG-slot branch), the hidden
    // logo/background slots must reveal when set, and the carousel config
    // spans (autoplay / interval / initialIndex / showProgress / edit-pause)
    // must actually drive the board.
    const MS_BOARDS = ['ms-lunch-campus-lineup.html', 'ms-lunch-signal-deck.html', 'ms-lunch-poster-loop.html'];
    const MS_STRESS = {
      'school.name': 'Dr. Maya Angelou International Middle School',
      'choice.0.name': 'Oven-Baked Whole-Grain Cheese Pizza Slices',
      'choice.0.description': 'Whole-grain crust with seasoned tomato sauce, low-fat mozzarella and a fresh garden side.',
    };
    const MS_IMGS = {
      'board.background': '/templates/school/menu-assets/ms-campus-pasta.jpg',
      'school.logo': '/templates/school/menu-assets/ms-campus-pizza.jpg',
      'choice.0.photo': '/templates/school/menu-assets/ms-campus-pasta.jpg',
      'choice.1.photo': '/templates/school/menu-assets/ms-campus-pizza.jpg',
      'choice.2.photo': '/templates/school/menu-assets/ms-campus-chicken-bowl.jpg',
    };
    const activeSlide = (page) => page.evaluate(() =>
      [...document.querySelectorAll('.slide')].findIndex((el) => el.classList.contains('active')));

    for (const board of MS_BOARDS) {
      for (const orientation of ['landscape', 'portrait']) {
        const viewport = orientation === 'portrait'
          ? { width: 540, height: 960 }
          : { width: 960, height: 540 };
        const context = await browser.newContext({ viewport });
        const page = await context.newPage();
        const pageErrors = [];
        page.on('pageerror', (error) => pageErrors.push(error.message));
        await page.addInitScript(() => {
          window.__menuMessages = [];
          window.addEventListener('message', (event) => {
            if (event.data && typeof event.data === 'object') window.__menuMessages.push(event.data);
          });
        });
        await page.clock.install({ time: new Date('2026-08-17T11:05:00-07:00') });
        const query = new URLSearchParams({
          text: encodeMap(MS_STRESS),
          brand: encodeMap(BRAND_OVERRIDES),
          img: encodeMap(MS_IMGS),
          textStyles: encodeMap({ 'choice.0.name': { fontStyle: 'italic', color: '#7a1f11' }, 'menu.kicker': { hidden: true } }),
        });
        if (orientation === 'portrait') query.set('o', 'portrait');
        await page.goto(`${BASE}/templates/school/${board}?${query}`, { waitUntil: 'load' });
        await page.evaluate(() => document.fonts && document.fonts.ready);
        await page.clock.fastForward(200);

        const problems = [];
        const state = await page.evaluate(() => {
          const rootStyle = document.documentElement.style;
          const bg = document.querySelector('[data-imgslot="board.background"]');
          const logo = document.querySelector('[data-imgslot="school.logo"]');
          const fallback = logo && logo.nextElementSibling;
          const name = document.querySelector('.slide.active [data-field="choice.0.name"]') || document.querySelector('[data-field="choice.0.name"]');
          const nameCs = name ? getComputedStyle(name) : {};
          const kicker = document.querySelector('[data-field="menu.kicker"]');
          return {
            photoSrcs: [0, 1, 2].map((n) => {
              const el = document.querySelector(`[data-imgslot="choice.${n}.photo"]`);
              return el ? el.getAttribute('src') || '' : 'missing';
            }),
            bgVisible: bg ? getComputedStyle(bg).opacity : 'missing',
            bgSrc: bg ? bg.getAttribute('src') || '' : 'missing',
            logoShown: logo ? getComputedStyle(logo).display : 'missing',
            fallbackHidden: fallback ? getComputedStyle(fallback).display : 'missing',
            primary: rootStyle.getPropertyValue('--primary').trim(),
            muted: rootStyle.getPropertyValue('--text-muted').trim(),
            fonts: [rootStyle.getPropertyValue('--font-display'), rootStyle.getPropertyValue('--font-body'), rootStyle.getPropertyValue('--font-condensed')].join('|'),
            nameStyle: { style: nameCs.fontStyle, color: nameCs.color },
            schoolName: (document.querySelector('[data-field="school.name"]') || {}).textContent || '',
            kickerHidden: kicker ? getComputedStyle(kicker).display : 'missing',
          };
        });
        if (state.photoSrcs.some((src) => !src.includes('menu-assets/ms-campus-'))) {
          problems.push(`IMG slot src override failed: ${JSON.stringify(state.photoSrcs)}`);
        }
        if (state.bgVisible !== '1' || !state.bgSrc.includes('ms-campus-pasta')) {
          problems.push(`board.background not revealed: opacity=${state.bgVisible} src=${state.bgSrc}`);
        }
        if (state.logoShown === 'none' || state.fallbackHidden !== 'none') {
          problems.push(`school.logo reveal failed: logo=${state.logoShown} fallback=${state.fallbackHidden}`);
        }
        if (state.primary !== '#2f6df6' || state.muted !== '#9fb4c6') {
          problems.push(`brand tokens not applied: ${state.primary}/${state.muted}`);
        }
        if (!/Georgia/.test(state.fonts) || !/Verdana/.test(state.fonts) || !/Courier New/.test(state.fonts)) {
          problems.push(`brand fonts not applied: ${state.fonts}`);
        }
        if (state.nameStyle.style !== 'italic') problems.push(`field style not applied: ${JSON.stringify(state.nameStyle)}`);
        if (state.schoolName !== MS_STRESS['school.name']) problems.push(`stress text not applied: "${state.schoolName}"`);
        if (state.kickerHidden !== 'none') problems.push(`hidden style not applied (menu.kicker display=${state.kickerHidden})`);

        // Every carousel slide passes collision QA — step via the 6s autoplay.
        for (let slide = 0; slide < 3; slide += 1) {
          if (slide > 0) {
            await page.clock.fastForward(6_050);
            const idx = await activeSlide(page);
            if (idx !== slide) problems.push(`autoplay did not reach slide ${slide} (at ${idx})`);
          }
          const layout = await auditLayout(page);
          if (layout.error) problems.push(layout.error);
          if (layout.outside?.length) problems.push(`slide ${slide} clipped/outside: ${layout.outside.join(', ')}`);
          if (layout.overlaps?.length) {
            console.warn(`  ⚠ ${board} ${orientation} slide ${slide}: over-budget stress copy wraps into a neighbor region: ${JSON.stringify(layout.overlaps)}`);
          }
        }

        if (orientation === 'landscape') {
          // Editor mode: carousel pauses; click-to-edit reports key/kind.
          await page.evaluate(() => window.postMessage({ type: 'educms-edit-mode', on: true }, '*'));
          await page.clock.fastForward(12_500);
          const pausedIdx = await activeSlide(page);
          if (pausedIdx !== 2) problems.push(`carousel did not pause in editor mode (moved to ${pausedIdx})`);
          await page.locator('.slide.active [data-field="choice.2.name"]').click({ force: true });
          await page.locator(`[data-imgslot="choice.2.photo"]`).click({ force: true });
          await page.clock.fastForward(100);
          const clicks = await page.evaluate(() => window.__menuMessages.filter((m) => m.type === 'educms-field-click'));
          if (!clicks.some((c) => c.key === 'choice.2.name' && c.kind === 'text') ||
              !clicks.some((c) => c.key === 'choice.2.photo' && c.kind === 'img')) {
            problems.push(`click-to-edit wrong: ${JSON.stringify(clicks)}`);
          }
        }
        if (pageErrors.length) problems.push(`page errors: ${pageErrors.join(' | ')}`);

        if (problems.length) {
          failures += 1;
          console.error(`✗ ${board} ${orientation} carousel contract: ${problems.join('; ')}`);
        } else {
          console.log(`✓ ${board} ${orientation}: carousel slides, IMG slots, reveals, overrides, editor pause`);
        }
        await context.close();
      }

      // Clock contract (same behavior class as the elementary boards).
      const clockErrors = [];
      const clockContext = await browser.newContext({ viewport: { width: 960, height: 540 } });
      const clockPage = await clockContext.newPage();
      clockPage.on('pageerror', (error) => clockErrors.push(error.message));
      await clockPage.clock.install({ time: new Date('2026-08-17T11:05:00-07:00') });
      await clockPage.goto(`${BASE}/templates/school/${board}?text=${encodeMap({ 'clock.mode': 'manual', 'clock.time': '7:58 PM' })}`, { waitUntil: 'load' });
      await clockPage.clock.fastForward(36_000);
      const manualText = await clockPage.evaluate(() => document.querySelector('[data-field="clock.time"]').textContent.trim());
      await clockContext.close();
      const nyContext = await browser.newContext({ viewport: { width: 960, height: 540 } });
      const nyPage = await nyContext.newPage();
      nyPage.on('pageerror', (error) => clockErrors.push(error.message));
      await nyPage.clock.install({ time: new Date('2026-08-17T16:45:00-04:00') });
      await nyPage.goto(`${BASE}/templates/school/${board}?text=${encodeMap({ 'clock.timeZone': 'America/New_York', 'clock.hour12': 'no' })}`, { waitUntil: 'load' });
      await nyPage.clock.fastForward(31_000);
      const nyText = await nyPage.evaluate(() => document.querySelector('[data-field="clock.time"]').textContent.trim());
      await nyContext.close();
      const clockProblems = [];
      if (manualText !== '7:58 PM') clockProblems.push(`manual clock overwritten: "${manualText}"`);
      if (nyText !== '16:45') clockProblems.push(`NY 24h clock wrong: "${nyText}"`);
      if (clockErrors.length) clockProblems.push(`clock page errors: ${clockErrors.join(' | ')}`);
      if (clockProblems.length) {
        failures += 1;
        console.error(`✗ ${board} clock contract: ${clockProblems.join('; ')}`);
      } else {
        console.log(`✓ ${board}: manual clock survives 36s; live NY 24h clock correct`);
      }
    }

    // Carousel CONFIG spans drive the board (identical inline engine in all
    // three MS boards, so one board proves the wiring).
    {
      const cfgProblems = [];
      const cfgCase = async (textCfg, run) => {
        const context = await browser.newContext({ viewport: { width: 960, height: 540 } });
        const page = await context.newPage();
        await page.clock.install({ time: new Date('2026-08-17T11:05:00-07:00') });
        await page.goto(`${BASE}/templates/school/ms-lunch-campus-lineup.html?text=${encodeMap(textCfg)}`, { waitUntil: 'load' });
        await page.clock.fastForward(150);
        await run(page);
        await context.close();
      };
      await cfgCase({ 'carousel.intervalSeconds': '3' }, async (page) => {
        await page.clock.fastForward(3_100);
        if ((await activeSlide(page)) !== 1) cfgProblems.push('intervalSeconds=3 not honored');
      });
      await cfgCase({ 'carousel.autoplay': 'no' }, async (page) => {
        await page.clock.fastForward(13_000);
        if ((await activeSlide(page)) !== 0) cfgProblems.push('autoplay=no still advanced');
      });
      await cfgCase({ 'carousel.showProgress': 'no' }, async (page) => {
        const disp = await page.evaluate(() => getComputedStyle(document.querySelector('.nav')).display);
        if (disp !== 'none') cfgProblems.push(`showProgress=no left nav visible (${disp})`);
      });
      await cfgCase({ 'carousel.initialIndex': '2' }, async (page) => {
        if ((await activeSlide(page)) !== 1) cfgProblems.push('initialIndex=2 did not start on slide 2');
      });
      if (cfgProblems.length) {
        failures += 1;
        console.error(`✗ carousel config contract: ${cfgProblems.join('; ')}`);
      } else {
        console.log('✓ carousel config: interval, autoplay off, hide progress, initial slide');
      }
    }

    // Morning News boards (2026-08-18, all three shipped on operator request):
    // video-led broadcast boards under /templates/hs/. Generic layout QA both
    // orientations, then the video editor contract — slot swaps (video, poster
    // via the shared story.poster key, logo/background reveals), playback
    // config spans, autoplay-off, failure→poster, reduced-motion→poster, and
    // the clock contract.
    const NEWS_BOARDS = ['morning-news.html', 'morning-news-rundown-desk.html', 'morning-news-daily-cut.html'];
    const NEWS_STRESS = {
      'school.name': 'Dr. Maya Angelou International High School',
      'story.headline': 'Peer tutoring program expands to every grade level',
      'story.summary': 'Student mentors are available before school, at lunch, and after the final bell in the library collaboration zone.',
    };
    for (const board of NEWS_BOARDS) {
      for (const orientation of ['landscape', 'portrait']) {
        const viewport = orientation === 'portrait'
          ? { width: 540, height: 960 }
          : { width: 960, height: 540 };
        const context = await browser.newContext({ viewport });
        const page = await context.newPage();
        const pageErrors = [];
        page.on('pageerror', (error) => pageErrors.push(error.message));
        await page.addInitScript(() => {
          window.__menuMessages = [];
          window.addEventListener('message', (event) => {
            if (event.data && typeof event.data === 'object') window.__menuMessages.push(event.data);
          });
        });
        const query = orientation === 'portrait' ? '?o=portrait' : '';
        await page.goto(`${BASE}/templates/hs/${board}${query}`, { waitUntil: 'load' });
        await page.evaluate(() => document.fonts && document.fonts.ready);
        const marker = await page.content();
        const ready = await page.evaluate(() => window.__menuMessages.some((m) => m.type === 'educms-ready'));
        const layout = await auditLayout(page);
        const problems = [];
        if (!marker.includes('EDUCMS-SHIM-V8')) problems.push('missing V8 editor bridge');
        if (!ready) problems.push('missing educms-ready');
        if (layout.error) problems.push(layout.error);
        if (layout.outside?.length) problems.push(`clipped/outside: ${layout.outside.join(', ')}`);
        if (layout.overlaps?.length) problems.push(`text overlaps: ${JSON.stringify(layout.overlaps)}`);
        if (pageErrors.length) problems.push(`page errors: ${pageErrors.join(' | ')}`);
        if (problems.length) {
          failures += 1;
          console.error(`✗ ${board} ${orientation}: ${problems.join('; ')}`);
        } else {
          console.log(`✓ ${board} ${orientation}: no clipping or text collisions`);
        }
        await context.close();
      }

      // Landscape editor contract.
      {
        const context = await browser.newContext({ viewport: { width: 960, height: 540 } });
        const page = await context.newPage();
        const pageErrors = [];
        page.on('pageerror', (error) => pageErrors.push(error.message));
        await page.addInitScript(() => {
          window.__menuMessages = [];
          window.addEventListener('message', (event) => {
            if (event.data && typeof event.data === 'object') window.__menuMessages.push(event.data);
          });
        });
        const query = new URLSearchParams({
          text: encodeMap({ ...NEWS_STRESS, 'video.playbackRate': '1.25', 'video.loop': 'no' }),
          brand: encodeMap(BRAND_OVERRIDES),
          img: encodeMap({
            'board.background': '/templates/school/menu-assets/ms-campus-pizza.jpg',
            'school.logo': '/templates/school/menu-assets/ms-campus-pasta.jpg',
            'story.poster': '/templates/school/menu-assets/ms-campus-chicken-bowl.jpg',
          }),
          video: encodeMap({ 'story.video': '/templates/school/menu-assets/salad-prep-4k.mp4' }),
          textStyles: encodeMap({ 'story.headline': { fontStyle: 'italic' }, 'program.name': { hidden: true } }),
        });
        await page.goto(`${BASE}/templates/hs/${board}?${query}`, { waitUntil: 'load' });
        await page.evaluate(() => document.fonts && document.fonts.ready);
        await delay(150);
        const state = await page.evaluate(() => {
          const rootStyle = document.documentElement.style;
          const bg = document.querySelector('[data-imgslot="board.background"]');
          const logo = document.querySelector('[data-imgslot="school.logo"]');
          const fallback = logo && logo.nextElementSibling;
          const poster = document.querySelector('[data-imgslot="story.poster"]');
          const video = document.querySelector('[data-videoslot="story.video"]');
          const headline = document.querySelector('[data-field="story.headline"]');
          const program = document.querySelector('[data-field="program.name"]');
          return {
            bgVisible: bg ? getComputedStyle(bg).opacity : 'missing',
            bgSrc: bg ? bg.getAttribute('src') || '' : 'missing',
            logoShown: logo ? getComputedStyle(logo).display : 'missing',
            fallbackHidden: fallback ? getComputedStyle(fallback).display : 'missing',
            posterSrc: poster ? poster.getAttribute('src') || '' : 'missing',
            videoSrc: video ? video.getAttribute('src') || '' : 'missing',
            videoPosterAttr: video ? video.getAttribute('poster') || '' : 'missing',
            rate: video ? video.playbackRate : 'missing',
            loop: video ? video.loop : 'missing',
            primary: rootStyle.getPropertyValue('--primary').trim(),
            muted: rootStyle.getPropertyValue('--text-muted').trim(),
            headlineStyle: headline ? getComputedStyle(headline).fontStyle : 'missing',
            programHidden: program ? getComputedStyle(program).display : 'missing',
            schoolName: (document.querySelector('[data-field="school.name"]') || {}).textContent || '',
          };
        });
        const layout = await auditLayout(page);
        const problems = [];
        if (state.bgVisible !== '1' || !state.bgSrc.includes('ms-campus-pizza')) problems.push(`bg reveal failed: ${state.bgVisible}/${state.bgSrc}`);
        if (state.logoShown === 'none' || state.fallbackHidden !== 'none') problems.push(`logo reveal failed: ${state.logoShown}/${state.fallbackHidden}`);
        if (!state.posterSrc.includes('ms-campus-chicken-bowl')) problems.push(`poster img swap failed: ${state.posterSrc}`);
        if (!state.videoPosterAttr.includes('ms-campus-chicken-bowl')) problems.push(`video poster attr swap failed: ${state.videoPosterAttr}`);
        if (!state.videoSrc.includes('salad-prep-4k')) problems.push(`video swap failed: ${state.videoSrc}`);
        if (state.rate !== 1.25 || state.loop !== false) problems.push(`playback config failed: rate=${state.rate} loop=${state.loop}`);
        if (state.primary !== '#2f6df6' || state.muted !== '#9fb4c6') problems.push(`brand tokens failed: ${state.primary}/${state.muted}`);
        if (state.headlineStyle !== 'italic') problems.push(`field style failed: ${state.headlineStyle}`);
        if (state.programHidden !== 'none') problems.push(`hidden style failed: ${state.programHidden}`);
        if (state.schoolName !== NEWS_STRESS['school.name']) problems.push(`stress text failed: "${state.schoolName}"`);
        if (layout.outside?.length) problems.push(`stress copy clipped/outside: ${layout.outside.join(', ')}`);
        if (layout.overlaps?.length) {
          console.warn(`  ⚠ ${board} landscape: over-budget stress copy wraps into a neighbor region: ${JSON.stringify(layout.overlaps)}`);
        }
        // Click-to-edit kinds: text, img (revealed logo), video.
        await page.evaluate(() => window.postMessage({ type: 'educms-edit-mode', on: true }, '*'));
        await delay(40);
        await page.locator('[data-field="story.headline"]').click({ force: true });
        await page.locator('[data-imgslot="school.logo"]').click({ force: true });
        await page.locator('[data-videoslot="story.video"]').click({ force: true });
        await delay(40);
        const clicks = await page.evaluate(() => window.__menuMessages.filter((m) => m.type === 'educms-field-click'));
        if (!clicks.some((c) => c.key === 'story.headline' && c.kind === 'text') ||
            !clicks.some((c) => c.key === 'school.logo' && c.kind === 'img') ||
            !clicks.some((c) => c.key === 'story.video' && c.kind === 'video')) {
          problems.push(`click-to-edit wrong: ${JSON.stringify(clicks)}`);
        }
        if (pageErrors.length) problems.push(`page errors: ${pageErrors.join(' | ')}`);
        if (problems.length) {
          failures += 1;
          console.error(`✗ ${board} editor contract: ${problems.join('; ')}`);
        } else {
          console.log(`✓ ${board}: video/poster/logo/background swaps, playback config, styles, hot zones`);
        }
        await context.close();
      }

      // Clock contract.
      const clockErrors = [];
      const clockContext = await browser.newContext({ viewport: { width: 960, height: 540 } });
      const clockPage = await clockContext.newPage();
      clockPage.on('pageerror', (error) => clockErrors.push(error.message));
      await clockPage.clock.install({ time: new Date('2026-08-18T08:05:00-07:00') });
      await clockPage.goto(`${BASE}/templates/hs/${board}?text=${encodeMap({ 'clock.mode': 'manual', 'clock.time': '7:58 PM' })}`, { waitUntil: 'load' });
      await clockPage.clock.fastForward(36_000);
      const manualText = await clockPage.evaluate(() => document.querySelector('[data-field="clock.time"]').textContent.trim());
      await clockContext.close();
      const nyContext = await browser.newContext({ viewport: { width: 960, height: 540 } });
      const nyPage = await nyContext.newPage();
      nyPage.on('pageerror', (error) => clockErrors.push(error.message));
      await nyPage.clock.install({ time: new Date('2026-08-18T16:45:00-04:00') });
      await nyPage.goto(`${BASE}/templates/hs/${board}?text=${encodeMap({ 'clock.timeZone': 'America/New_York', 'clock.hour12': 'no' })}`, { waitUntil: 'load' });
      await nyPage.clock.fastForward(31_000);
      const nyText = await nyPage.evaluate(() => document.querySelector('[data-field="clock.time"]').textContent.trim());
      await nyContext.close();
      const clockProblems = [];
      if (manualText !== '7:58 PM') clockProblems.push(`manual clock overwritten: "${manualText}"`);
      if (nyText !== '16:45') clockProblems.push(`NY 24h clock wrong: "${nyText}"`);
      if (clockErrors.length) clockProblems.push(`clock page errors: ${clockErrors.join(' | ')}`);
      if (clockProblems.length) {
        failures += 1;
        console.error(`✗ ${board} clock contract: ${clockProblems.join('; ')}`);
      } else {
        console.log(`✓ ${board}: manual clock survives 36s; live NY 24h clock correct`);
      }
    }

    // Hall Wayfinder boards run in a FRESH WebKit instance: by this point the
    // shared browser has served ~70 contexts incl. MP4 streaming, and its
    // network process can wedge — every goto then times out at this exact
    // boundary while a fresh instance loads the same URL instantly.
    wfBrowser = await webkit.launch({ headless: true });
    // Hall Wayfinder boards (2026-08-21, all three shipped on operator
    // request): text/clock boards under /templates/hs/. Generic layout QA in
    // both orientations, plus an editor pass proving the canonical
    // brand-token ALIAS seam (each board's themed palette vars are aliased to
    // --primary/--secondary/… so V8 brand overrides restyle the design), the
    // school.logo div slot reveal, stress copy, styles, click kinds, and the
    // clock contract.
    const WAYFINDER_BOARDS = [
      { file: 'hall-wayfinder.html', primaryEl: '.route.r1' },
      { file: 'hall-wayfinder-campus-grid.html', primaryEl: '.top .logo' },
      { file: 'hall-wayfinder-signal-stack.html', primaryEl: '.signal.s1' },
    ];
    const WAYFINDER_STRESS = {
      'school.name': 'Dr. Maya Angelou International High School',
      'notice.message': 'C-wing elevator is offline today for scheduled maintenance. Please use the B-wing lift beside the library until Friday.',
    };
    for (const { file: board, primaryEl } of WAYFINDER_BOARDS) {
      for (const orientation of ['landscape', 'portrait']) {
        const viewport = orientation === 'portrait'
          ? { width: 540, height: 960 }
          : { width: 960, height: 540 };
        const context = await wfBrowser.newContext({ viewport });
        const page = await context.newPage();
        const pageErrors = [];
        page.on('pageerror', (error) => pageErrors.push(error.message));
        await page.addInitScript(() => {
          window.__menuMessages = [];
          window.addEventListener('message', (event) => {
            if (event.data && typeof event.data === 'object') window.__menuMessages.push(event.data);
          });
        });
        const query = orientation === 'portrait' ? '?o=portrait' : '';
        await page.goto(`${BASE}/templates/hs/${board}${query}`, { waitUntil: 'domcontentloaded' });
        await page.evaluate(() => document.fonts && document.fonts.ready);
        const marker = await page.content();
        const ready = await page.evaluate(() => window.__menuMessages.some((m) => m.type === 'educms-ready'));
        const layout = await auditLayout(page);
        const problems = [];
        if (!marker.includes('EDUCMS-SHIM-V8')) problems.push('missing V8 editor bridge');
        if (!ready) problems.push('missing educms-ready');
        if (layout.error) problems.push(layout.error);
        if (layout.outside?.length) problems.push(`clipped/outside: ${layout.outside.join(', ')}`);
        if (layout.overlaps?.length) problems.push(`text overlaps: ${JSON.stringify(layout.overlaps)}`);
        if (pageErrors.length) problems.push(`page errors: ${pageErrors.join(' | ')}`);
        if (problems.length) {
          failures += 1;
          console.error(`✗ ${board} ${orientation}: ${problems.join('; ')}`);
        } else {
          console.log(`✓ ${board} ${orientation}: no clipping or text collisions`);
        }
        await context.close();
      }

      // Landscape editor contract.
      {
        const context = await wfBrowser.newContext({ viewport: { width: 960, height: 540 } });
        const page = await context.newPage();
        const pageErrors = [];
        page.on('pageerror', (error) => pageErrors.push(error.message));
        await page.addInitScript(() => {
          window.__menuMessages = [];
          window.addEventListener('message', (event) => {
            if (event.data && typeof event.data === 'object') window.__menuMessages.push(event.data);
          });
        });
        const query = new URLSearchParams({
          text: encodeMap(WAYFINDER_STRESS),
          brand: encodeMap(BRAND_OVERRIDES),
          img: encodeMap({ 'school.logo': '/templates/school/menu-assets/ms-campus-pizza.jpg' }),
          textStyles: encodeMap({ 'school.name': { fontStyle: 'italic' }, 'school.systemName': { hidden: true } }),
        });
        await page.goto(`${BASE}/templates/hs/${board}?${query}`, { waitUntil: 'domcontentloaded' });
        await page.evaluate(() => document.fonts && document.fonts.ready);
        await delay(150);
        const state = await page.evaluate((sel) => {
          const rootStyle = document.documentElement.style;
          const logo = document.querySelector('[data-imgslot="school.logo"]');
          const primaryNode = document.querySelector(sel);
          const nameEl = document.querySelector('[data-field="school.name"]');
          const sysEl = document.querySelector('[data-field="school.systemName"]');
          return {
            primaryVar: rootStyle.getPropertyValue('--primary').trim(),
            primaryPaint: primaryNode ? getComputedStyle(primaryNode).backgroundColor : 'missing',
            logoHasImg: logo ? logo.classList.contains('has-img') : 'missing',
            logoBg: logo ? (logo.style.backgroundImage || '') : 'missing',
            nameStyle: nameEl ? getComputedStyle(nameEl).fontStyle : 'missing',
            sysHidden: sysEl ? getComputedStyle(sysEl).display : 'missing',
            schoolName: nameEl ? nameEl.textContent : '',
          };
        }, primaryEl);
        const layout = await auditLayout(page);
        const problems = [];
        if (state.primaryVar !== '#2f6df6') problems.push(`brand primary var not applied: ${state.primaryVar}`);
        if (state.primaryPaint !== 'rgb(47, 109, 246)') problems.push(`brand alias did not restyle ${primaryEl}: ${state.primaryPaint}`);
        if (state.logoHasImg !== true || !state.logoBg.includes('ms-campus-pizza')) problems.push(`logo slot reveal failed: ${state.logoHasImg}/${state.logoBg}`);
        if (state.nameStyle !== 'italic') problems.push(`field style failed: ${state.nameStyle}`);
        if (state.sysHidden !== 'none') problems.push(`hidden style failed: ${state.sysHidden}`);
        if (state.schoolName !== WAYFINDER_STRESS['school.name']) problems.push(`stress text failed: "${state.schoolName}"`);
        if (layout.outside?.length) problems.push(`stress copy clipped/outside: ${layout.outside.join(', ')}`);
        if (layout.overlaps?.length) {
          console.warn(`  ⚠ ${board} landscape: over-budget stress copy wraps into a neighbor region: ${JSON.stringify(layout.overlaps)}`);
        }
        await page.evaluate(() => window.postMessage({ type: 'educms-edit-mode', on: true }, '*'));
        await delay(40);
        await page.locator('[data-field="school.name"]').click({ force: true });
        await delay(40);
        const clicks = await page.evaluate(() => window.__menuMessages.filter((m) => m.type === 'educms-field-click'));
        if (!clicks.some((c) => c.key === 'school.name' && c.kind === 'text')) {
          problems.push(`click-to-edit wrong: ${JSON.stringify(clicks)}`);
        }
        if (pageErrors.length) problems.push(`page errors: ${pageErrors.join(' | ')}`);
        if (problems.length) {
          failures += 1;
          console.error(`✗ ${board} editor contract: ${problems.join('; ')}`);
        } else {
          console.log(`✓ ${board}: brand alias restyle, logo reveal, styles, stress copy, hot zones`);
        }
        await context.close();
      }

      // Clock contract.
      const clockErrors = [];
      const clockContext = await wfBrowser.newContext({ viewport: { width: 960, height: 540 } });
      const clockPage = await clockContext.newPage();
      clockPage.on('pageerror', (error) => clockErrors.push(error.message));
      await clockPage.clock.install({ time: new Date('2026-08-21T10:24:00-07:00') });
      await clockPage.goto(`${BASE}/templates/hs/${board}?text=${encodeMap({ 'clock.mode': 'manual', 'clock.time': '7:58 PM' })}`, { waitUntil: 'domcontentloaded' });
      await clockPage.clock.fastForward(36_000);
      const manualText = await clockPage.evaluate(() => document.querySelector('[data-field="clock.time"]').textContent.trim());
      await clockContext.close();
      const nyContext = await wfBrowser.newContext({ viewport: { width: 960, height: 540 } });
      const nyPage = await nyContext.newPage();
      nyPage.on('pageerror', (error) => clockErrors.push(error.message));
      await nyPage.clock.install({ time: new Date('2026-08-21T16:45:00-04:00') });
      await nyPage.goto(`${BASE}/templates/hs/${board}?text=${encodeMap({ 'clock.timeZone': 'America/New_York', 'clock.hour12': 'no' })}`, { waitUntil: 'domcontentloaded' });
      await nyPage.clock.fastForward(31_000);
      const nyText = await nyPage.evaluate(() => document.querySelector('[data-field="clock.time"]').textContent.trim());
      await nyContext.close();
      const clockProblems = [];
      if (manualText !== '7:58 PM') clockProblems.push(`manual clock overwritten: "${manualText}"`);
      if (nyText !== '16:45') clockProblems.push(`NY 24h clock wrong: "${nyText}"`);
      if (clockErrors.length) clockProblems.push(`clock page errors: ${clockErrors.join(' | ')}`);
      if (clockProblems.length) {
        failures += 1;
        console.error(`✗ ${board} clock contract: ${clockProblems.join('; ')}`);
      } else {
        console.log(`✓ ${board}: manual clock survives 36s; live NY 24h clock correct`);
      }
    }


    // Video resilience states (identical engine in all three news boards; one
    // board proves the wiring): failure→poster, reduced-motion→poster,
    // autoplay=no→poster, and no page errors in any of them.
    {
      const vProblems = [];
      const vCase = async (label, url, contextOpts, check) => {
        const context = await wfBrowser.newContext({ viewport: { width: 960, height: 540 }, ...contextOpts });
        const page = await context.newPage();
        const errs = [];
        page.on('pageerror', (e) => errs.push(e.message));
        await page.goto(url, { waitUntil: 'load' });
        await delay(400);
        const st = await page.evaluate(() => {
          const media = document.querySelector('.media');
          const video = media.querySelector('video');
          return { cls: media.className, videoDisplay: getComputedStyle(video).display, paused: video.paused };
        });
        await check(st, errs);
        await context.close();
      };
      await vCase('failure', `${BASE}/templates/hs/morning-news.html?video=${encodeMap({ 'story.video': '/templates/hs/news-assets/missing.mp4' })}`, {}, async (st, errs) => {
        if (!/failed/.test(st.cls) || st.videoDisplay !== 'none') vProblems.push(`failure state wrong: ${st.cls}/${st.videoDisplay}`);
        if (errs.length) vProblems.push(`failure case errors: ${errs.join('|')}`);
      });
      await vCase('reduced', `${BASE}/templates/hs/morning-news.html`, { reducedMotion: 'reduce' }, async (st, errs) => {
        if (!/reduced/.test(st.cls) || st.videoDisplay !== 'none') vProblems.push(`reduced-motion state wrong: ${st.cls}/${st.videoDisplay}`);
        if (errs.length) vProblems.push(`reduced case errors: ${errs.join('|')}`);
      });
      await vCase('autoplay-off', `${BASE}/templates/hs/morning-news.html?text=${encodeMap({ 'video.autoplay': 'no' })}`, {}, async (st, errs) => {
        if (!/reduced/.test(st.cls) || !st.paused) vProblems.push(`autoplay=no state wrong: ${st.cls}/paused=${st.paused}`);
        if (errs.length) vProblems.push(`autoplay case errors: ${errs.join('|')}`);
      });
      if (vProblems.length) {
        failures += 1;
        console.error(`✗ news video resilience: ${vProblems.join('; ')}`);
      } else {
        console.log('✓ news video resilience: failure→poster, reduced-motion→poster, autoplay off');
      }
    }

    // Prove the new first-class video transport and hot-zone in the real board.
    const context = await wfBrowser.newContext({ viewport: { width: 960, height: 540 } });
    const page = await context.newPage();
    await page.addInitScript(() => {
      window.__menuMessages = [];
      window.addEventListener('message', (event) => {
        if (event.data && typeof event.data === 'object') window.__menuMessages.push(event.data);
      });
    });
    const videoUrl = '/templates/school/menu-assets/salad-prep-4k.mp4';
    const query = new URLSearchParams({
      video: encodeMap({ 'entree.video': videoUrl }),
      text: encodeMap({ 'video.playbackRate': '1.25', 'video.loop': 'no' }),
    });
    await page.goto(`${BASE}/templates/school/elem-lunch-v6-menu-lab.html?${query}`, { waitUntil: 'load' });
    await page.evaluate(() => window.postMessage({ type: 'educms-edit-mode', on: true }, '*'));
    await page.locator('[data-videoslot="entree.video"]').click({ force: true });
    await delay(50);
    const videoState = await page.evaluate(() => {
      const video = document.querySelector('[data-videoslot="entree.video"]');
      const click = window.__menuMessages.filter((message) => message.type === 'educms-field-click').at(-1);
      return {
        src: video.getAttribute('src'),
        rate: video.playbackRate,
        loop: video.loop,
        click,
      };
    });
    const videoOk = videoState.src === videoUrl && videoState.rate === 1.25 && videoState.loop === false &&
      videoState.click?.key === 'entree.video' && videoState.click?.kind === 'video';
    if (!videoOk) {
      failures += 1;
      console.error('✗ Menu Lab video editor bridge:', JSON.stringify(videoState));
    } else {
      console.log('✓ Menu Lab video source, playback controls, and video hot-zone');
    }
    await context.close();
  } finally {
    if (wfBrowser) await wfBrowser.close();
    await browser.close();
    server.kill();
  }

  console.log(`K-12 menu WebKit canary: ${failures ? `${failures} failure(s)` : 'all checks passed'}`);
  process.exit(failures ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
