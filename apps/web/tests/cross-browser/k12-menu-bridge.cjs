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
  const server = spawn('python3', ['-m', 'http.server', String(PORT), '--directory', PUBLIC_DIR], {
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  await waitForServer();
  const browser = await webkit.launch({ headless: true });
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
        if (layout.overlaps?.length) problems.push(`stress copy overlaps: ${JSON.stringify(layout.overlaps)}`);

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

    // Prove the new first-class video transport and hot-zone in the real board.
    const context = await browser.newContext({ viewport: { width: 960, height: 540 } });
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
    await browser.close();
    server.kill();
  }

  console.log(`K-12 menu WebKit canary: ${failures ? `${failures} failure(s)` : 'all checks passed'}`);
  process.exit(failures ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
