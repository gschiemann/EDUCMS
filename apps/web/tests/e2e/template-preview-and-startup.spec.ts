import { test, expect, type Locator, type Page } from '@playwright/test';

const TENANT = 'e2e-preview';
const USER = { id: 'preview-user', role: 'SCHOOL_ADMIN', email: 'preview@example.test', tenantId: TENANT };
const TEMPLATE = { id: 'board', name: 'Demo template', screenWidth: 3840, screenHeight: 2160, bgColor: '#fff', zones: [{ id: 'board-zone', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 0, defaultConfig: JSON.stringify({ url: '/templates/custom/brookfield/07-tour-takeaway.html' }) }] };
const PLAYLIST = { id: 'demo-playlist', name: 'Demo board', templateId: TEMPLATE.id, template: TEMPLATE, items: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
const SCHEDULE = { id: 'rule', playlistId: PLAYLIST.id, screenId: 'display', screen: { id: 'display', name: 'Demo display' }, isActive: true, startTime: new Date(Date.now() - 86400000).toISOString() };

// A packaged board whose own native image carousel is configured by a saved text override.
const CAROUSEL_BOARD = '/templates/signage/corporate/homebuilder/07-tour-takeaway.html';
// An example host the website-screenshot guard lets through (it refuses localhost / private networks / credentials).
const PUBLIC_SITE = 'https://www.example.test';

type Kind = 'template' | 'website' | 'images' | 'carousel';

async function setup(page: Page, command = false, kind: Kind = 'template', websiteUrl = PUBLIC_SITE) {
  const website = kind === 'website';
  let failure = false;
  const headers = { 'Access-Control-Allow-Origin': 'http://localhost:3000', 'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Headers': 'authorization,content-type,x-csrf-token,x-requested-with', 'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS' };
  const webAsset = { id: 'website-asset', originalName: 'Example website', mimeType: 'text/html', fileUrl: websiteUrl, status: 'APPROVED' };
  const imageAssets = ['a', 'b', 'c'].map(id => ({ id, originalName: `Image ${id}`, mimeType: 'image/png', fileUrl: `https://preview.example.test/${id}.svg` }));
  const playlist = website ? { ...PLAYLIST, templateId: null, template: null, items: [{ id: 'web-item', sequenceOrder: 0, durationMs: 10000, asset: webAsset }] } : kind === 'images' ? { ...PLAYLIST, templateId: null, template: null, items: imageAssets.map((asset, sequenceOrder) => ({ id: asset.id, sequenceOrder, durationMs: 10000, asset })) } : kind === 'carousel' ? { ...PLAYLIST, template: { ...TEMPLATE, zones: TEMPLATE.zones.map(zone => ({ ...zone, defaultConfig: JSON.stringify({ url: CAROUSEL_BOARD, textOverrides: { 'carousel.intervalSeconds': '2' } }) })) } } : PLAYLIST;
  const tenant = { id: TENANT, slug: TENANT, name: 'Preview test', vertical: 'CORPORATE' };
  const screen = () => ({ id: 'display', name: 'Demo display', tenantId: TENANT, status: 'ONLINE', resolution: '1920x1080', orientation: 'LANDSCAPE', authState: 'PROVEN', renderHealth: 'OK', renderStale: false, lastPingAt: new Date().toISOString(), lastRenderedAt: new Date(Date.now() - (failure ? 1000 : 10000)).toISOString(), lastRenderedHash: failure ? 'idle:content-unavailable' : 'idle:content-loading', pendingRefreshAt: new Date(Date.now() - (failure ? 20000 : 5000)).toISOString() });
  await page.addInitScript(user => {
    sessionStorage.setItem('edu_cms_token', 'e2e-token'); sessionStorage.setItem('edu_cms_user', JSON.stringify(user)); localStorage.setItem('edu_cms_eula_accepted_v1.0', '1');
  }, USER);
  await page.route('**/api/v1/**', route => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const requestUrl = new URL(route.request().url());
    const path = requestUrl.pathname.replace('/api/v1', '');
    const bodies: Record<string, unknown> = {
      '/auth/me': USER, '/users/me': USER, '/tenants': [tenant], '/tenants/accessible': [tenant], '/branding/me': {},
      '/screens': [screen()], '/screen-groups': [], '/schedules': [SCHEDULE], '/playlists': [playlist], '/playlists/demo-playlist': playlist,
      // No gallery hit: preview must come from the saved playlist data.
      '/templates': [], '/templates/board': TEMPLATE, '/assets': website ? (requestUrl.searchParams.has('take') ? { assets: [webAsset], total: 1 } : [webAsset]) : [],
      '/screens/fleet': { root: tenant, locations: command ? [tenant, { id: 'other', slug: 'other', name: 'Other location' }] : [], screens: [screen()], stats: { total: 1, online: 1, offline: 0, locationCount: command ? 2 : 1 } },
      '/playlists/demo-playlist/delivery': { latest: { id: 'push', createdAt: new Date(Date.now() - 5000).toISOString(), targetCount: 1, acknowledged: 0, targets: [{ screenId: 'display', name: 'Demo display', online: true, state: 'not-updated', ackAt: null, lastProofAt: null, pushChannel: 'live' }] }, history: [] },
      '/assets/storage-summary': { totalBytes: 0, totalFiles: website ? 1 : 0, images: { bytes: 0, files: 0 }, videos: { bytes: 0, files: 0 }, other: { bytes: 0, files: website ? 1 : 0 } },
      '/screens/display/faces': { faces: [] }, '/screens/display/events': { events: [] }, '/screens/display/device-inventory': { report: null },
      '/player/latest-version': { versionName: '1.1.20', versionCode: 10120 },
    };
    return route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify(bodies[path] ?? []) });
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  return { fail: () => { failure = true; } };
}

for (const command of [false, true]) {
  test(`saved template previews across dashboard ${command ? 'fleet' : 'standard'}, playlist library and screen details`, async ({ page }, info) => {
    await setup(page, command);
    await page.goto(`/${TENANT}/dashboard`);
    const schedule = command ? page.getByRole('group', { name: 'Today’s Schedule' }) : page.locator('main').filter({ has: page.getByText('Demo board', { exact: true }) }).last();
    const poster = schedule.locator('[data-tpl-poster] img').first();
    await expect(poster).toBeVisible();
    await expect.poll(() => poster.evaluate(img => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    await page.screenshot({ path: info.outputPath('dashboard-template.png'), fullPage: true });
    await page.goto(`/${TENANT}/playlists`);
    await expect(page.locator('[data-tpl-poster] img').first()).toBeVisible();
    await page.getByRole('checkbox', { name: 'Select Demo board', exact: true }).check();
    const remove = page.getByTestId('bulk-remove');
    await expect(remove).toHaveText('Remove 1');
    const removeBox = await remove.boundingBox();
    const searchBox = await page.getByRole('searchbox', { name: 'Search playlists' }).boundingBox();
    expect(removeBox!.y + removeBox!.height).toBeLessThan(searchBox!.y);
    await page.screenshot({ path: info.outputPath('playlist-template-toolbar.png'), fullPage: true });
    await page.goto(`/${TENANT}/screens`);
    await expect(page.locator('[data-tpl-poster] img').first()).toBeVisible();
    await page.getByRole('button', { name: 'Demo display', exact: true }).click();
    const content = page.getByTestId('screen-content-card');
    await expect(content.locator('[data-tpl-poster] img')).toBeVisible();
    await expect(content).toContainText('Preview of the saved template.');
    await page.screenshot({ path: info.outputPath('screen-template-preview.png'), fullPage: true });
  });
}

test('playlist startup has no failure banner; a newer explicit content failure stays visible', async ({ page }, info) => {
  const scenario = await setup(page);
  await page.goto(`/${TENANT}/playlists/demo-playlist`);
  await expect(page.getByRole('heading', { name: 'Demo board', exact: true }).first()).toBeVisible();
  await expect(page.getByText(/playback problem/)).toHaveCount(0);
  await page.getByRole('tab', { name: 'Screens', exact: true }).click();
  await expect(page.getByText(/playback problem/)).toHaveCount(0);
  await expect(page.getByText('Sending update', { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('playlist-starting.png'), fullPage: true });
  scenario.fail();
  await page.reload();
  await expect(page.getByText(/Demo display: playback problem/).first()).toBeVisible();
  await page.screenshot({ path: info.outputPath('playlist-real-failure.png'), fullPage: true });
});

// ── Website screenshots ─────────────────────────────────────────────────────

const WEBSITE_SHOT = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#e1edf3"/><rect width="640" height="65" fill="#003556"/><text x="40" y="42" fill="white" font-size="28">Website screenshot fixture</text><text x="40" y="180" fill="#003556" font-size="36">Homes and communities</text></svg>';

test('website screenshot previews appear across assets, dashboard, playlists, screen rows and details', async ({ page }, info) => {
  await setup(page, false, 'website');
  let requests = 0;
  await page.route('https://s.wordpress.com/mshots/**', route => {
    requests++;
    // The first request is the service still taking the picture ("warming"): it fails, and the thumbnail retries.
    return requests === 1 ? route.fulfill({ status: 503, body: 'Screenshot warming' }) : route.fulfill({ status: 200, contentType: 'image/svg+xml', body: WEBSITE_SHOT });
  });
  for (const path of ['assets', 'dashboard', 'playlists', 'screens']) {
    await page.goto(`/${TENANT}/${path}`);
    const preview = page.getByRole('img', { name: /Website preview/ }).first();
    await expect(preview).toBeVisible();
    await expect.poll(() => preview.evaluate(img => (img as HTMLImageElement).naturalWidth), { timeout: 10000 }).toBeGreaterThan(0);
    await expect(preview).toHaveCSS('opacity', '1');
    // The stored address, untouched: the key the service has already warmed for this site.
    expect(await preview.getAttribute('src')).toContain(encodeURIComponent(PUBLIC_SITE));
    // The whole page, never cropped.
    await expect(preview).toHaveCSS('object-fit', 'contain');
  }
  await page.getByRole('button', { name: 'Demo display', exact: true }).click();
  const card = page.getByTestId('screen-content-card');
  await expect(card.getByRole('img', { name: /Website preview/ })).toBeVisible();
  await expect(card).toHaveCSS('opacity', '1');
  await page.screenshot({ path: info.outputPath('website-screen-preview.png'), fullPage: true });
  expect(requests).toBeGreaterThan(1);
});

test('an address that must not leave the building is never sent to the screenshot service — the globe, labelled', async ({ page }, info) => {
  await setup(page, false, 'website', 'http://192.168.1.20/signage');
  let requests = 0;
  await page.route('https://s.wordpress.com/mshots/**', route => { requests++; return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: WEBSITE_SHOT }); });
  for (const path of ['assets', 'dashboard', 'playlists', 'screens']) {
    await page.goto(`/${TENANT}/${path}`);
    await expect(page.getByRole('img', { name: /Website preview of .* unavailable/ }).first()).toBeVisible();
  }
  await page.screenshot({ path: info.outputPath('website-private-address.png'), fullPage: true });
  expect(requests).toBe(0);
});

// ── Images: the grid keeps its slow rotation; everywhere else, hover only ───

/**
 * The playlist library's slideshow that is actually ON SCREEN, read in the page.
 *
 * ListView keeps TWO copies of every thumbnail in the DOM — the ≥1024 px table
 * and the compact cards under it — and hides one with CSS, so counting every
 * slideshow in the document reads 6 frames for a 3-image playlist (the hidden
 * copy never runs). Frames are found by their COMPUTED transition (opacity over
 * 0.9 s — the browser serialises the inline `900ms` as `0.9s`, so a selector on
 * the style string matches in jsdom and nowhere else) and counted only when they
 * have a box.
 */
const slideshowFrames = (page: Page) => page.evaluate(() => {
  const frames = Array.from(document.querySelectorAll<HTMLElement>('div')).filter(div => {
    const style = getComputedStyle(div);
    return style.transitionProperty === 'opacity' && style.transitionDuration === '0.9s' && div.getClientRects().length > 0;
  });
  return { count: frames.length, shown: frames.findIndex(frame => getComputedStyle(frame).opacity === '1') };
});
const slideshowIndex = async (page: Page) => (await slideshowFrames(page)).shown;

type Fade = { type: string; at: number; seconds: number };

test('the playlist library’s image slideshow rotates by itself, slowly (7 s hold, 900 ms cross-fade), exactly as it always has', async ({ page }) => {
  await setup(page, false, 'images');
  await page.route('https://preview.example.test/**', route => route.fulfill({ status: 200, contentType: 'image/svg+xml', body: WEBSITE_SHOT }));
  await page.goto(`/${TENANT}/playlists`);
  // The slideshow on screen holds all three pictures (the compact cards' copy is hidden and never runs).
  await expect.poll(async () => (await slideshowFrames(page)).count, { timeout: 15000 }).toBe(3);
  // From here, keep the browser's own transition events: when each cross-fade starts and how long it runs.
  await page.evaluate(() => {
    const w = window as unknown as { __fades: Fade[] };
    w.__fades = [];
    for (const type of ['transitionrun', 'transitionend']) {
      document.addEventListener(type, event => {
        const e = event as TransitionEvent;
        const target = e.target as HTMLElement;
        if (e.propertyName === 'opacity' && getComputedStyle(target).transitionDuration === '0.9s' && target.getClientRects().length > 0) w.__fades.push({ type, at: e.timeStamp, seconds: e.elapsedTime });
      }, true);
    }
  });
  expect(await slideshowIndex(page)).toBe(0);
  // Well past the quick hover cadence (350 ms to a first step, then a picture every 1.45 s), and still on the
  // first picture: at rest, with no pointer on it, this is the calm 7 s rotation.
  await page.waitForTimeout(3500);
  expect(await slideshowIndex(page)).toBe(0);
  await expect.poll(() => slideshowIndex(page), { timeout: 10000 }).toBe(1);
  await expect.poll(() => slideshowIndex(page), { timeout: 12000 }).toBe(2);
  await page.waitForTimeout(300); // let the last transitionend land
  const fades = await page.evaluate(() => (window as unknown as { __fades: Fade[] }).__fades);
  // Every cross-fade the browser ran lasted exactly 900 ms (two per rotation: one picture in, one out)…
  const ended = fades.filter(fade => fade.type === 'transitionend');
  expect(ended.length).toBeGreaterThanOrEqual(4);
  for (const fade of ended) expect(fade.seconds).toBeCloseTo(0.9, 2);
  // …and the picture changes every 7 s: the gap between the first two rotations.
  const starts = fades.filter(fade => fade.type === 'transitionrun').map(fade => fade.at);
  const rotations = starts.filter((at, i) => i === 0 || at - starts[i - 1] > 500);
  expect(rotations.length).toBeGreaterThanOrEqual(2);
  expect(rotations[1] - rotations[0]).toBeGreaterThan(6500);
  expect(rotations[1] - rotations[0]).toBeLessThan(7500);
});

// The quick cadence is 350 ms to the first step + a 250 ms fade = the second picture is ON SHOW ~600 ms
// after the pointer lands (the old 2.5 s hold + 300 ms fade took 2.8 s). Every wait below is 2 s, so it
// fails against the old cadence and still leaves a loaded CI runner generous room.
const QUICK_STEP_TIMEOUT = 2000;

test('hovering the playlist library’s image slideshow makes THAT thumbnail quick — and leaving hands it back to the slow rotation, on the picture it is showing', async ({ page }, info) => {
  await setup(page, false, 'images');
  await page.route('https://preview.example.test/**', route => route.fulfill({ status: 200, contentType: 'image/svg+xml', body: WEBSITE_SHOT }));
  await page.goto(`/${TENANT}/playlists`);
  // The slideshow on screen (the compact cards' copy is hidden by CSS and never runs).
  const slideshow = page.locator('[data-image-slideshow]:visible').first();
  await expect(slideshow).toHaveAttribute('data-preview-state', 'rest', { timeout: 15000 });
  // The quick walk only steps to a picture that has arrived: let all three load first (a real person's pointer
  // arrives seconds after the page, not milliseconds).
  await expect.poll(() => slideshow.evaluate(el => Array.from(el.querySelectorAll('img')).filter(image => image.complete && image.naturalWidth > 0).length), { timeout: 15000 }).toBe(3);
  const fadeOf = () => slideshow.evaluate(el => getComputedStyle(el.querySelector('div.absolute') as HTMLElement).transitionDuration);
  expect(await fadeOf()).toBe('0.9s'); // at rest: the slow cross-fade
  // Indices are read, not assumed: the slow clock is 7 s, and a loaded runner may already have moved it.
  const start = Number(await slideshow.getAttribute('data-preview-index'));
  const at = (steps: number) => String((start + steps) % 3);

  await slideshow.hover();
  // The pointer rests ~350 ms, then the thumbnail steps at once — against the 7 s a picture it takes at rest.
  await expect(slideshow).toHaveAttribute('data-preview-state', 'quick', { timeout: QUICK_STEP_TIMEOUT });
  await expect(slideshow).toHaveAttribute('data-preview-index', at(1), { timeout: QUICK_STEP_TIMEOUT });
  expect(await fadeOf()).toBe('0.25s'); // the browser's own computed fade, not the style string we asked for
  // …and a picture every ~1.45 s after that (1.2 s held + a 250 ms fade).
  await expect(slideshow).toHaveAttribute('data-preview-index', at(2), { timeout: 2500 });
  await page.screenshot({ path: info.outputPath('library-slideshow-quick.png'), fullPage: true });

  // Leaving: back to the slow rotation, ON THE PICTURE IT WAS SHOWING (never snapped back to the first).
  await page.mouse.move(0, 0);
  await expect(slideshow).toHaveAttribute('data-preview-state', 'rest', { timeout: QUICK_STEP_TIMEOUT });
  const shown = await slideshow.getAttribute('data-preview-index');
  expect(shown).not.toBeNull();
  expect(await fadeOf()).toBe('0.9s');
  // Calm again: well over a quick step's worth of time later, nothing has moved (the slow clock is 7 s).
  await page.waitForTimeout(3000);
  await expect(slideshow).toHaveAttribute('data-preview-index', shown!);
});

test('a pointer that only crosses the library slideshow leaves no trace — the slow rotation keeps its own clock', async ({ page }) => {
  await setup(page, false, 'images');
  await page.route('https://preview.example.test/**', route => route.fulfill({ status: 200, contentType: 'image/svg+xml', body: WEBSITE_SHOT }));
  await page.goto(`/${TENANT}/playlists`);
  const slideshow = page.locator('[data-image-slideshow]:visible').first();
  await expect(slideshow).toHaveAttribute('data-preview-state', 'rest', { timeout: 15000 });
  const box = (await slideshow.boundingBox())!;
  // Cross it fast — in, across and out well inside the 350 ms rest.
  await page.mouse.move(box.x - 20, box.y + box.height / 2);
  await page.mouse.move(box.x + box.width + 20, box.y + box.height / 2, { steps: 6 });
  await page.waitForTimeout(600); // longer than the rest: had it counted as a hover, it would have gone quick by now
  await expect(slideshow).toHaveAttribute('data-preview-state', 'rest');
  expect(await slideshow.evaluate(el => getComputedStyle(el.querySelector('div.absolute') as HTMLElement).transitionDuration)).toBe('0.9s');
});

test('uploaded images stay still at rest and walk through QUICKLY on hover — across the dashboard, screen rows and details', async ({ page }, info) => {
  await setup(page, false, 'images');
  await page.route('https://preview.example.test/**', route => route.fulfill({ status: 200, contentType: 'image/svg+xml', body: WEBSITE_SHOT }));
  for (const path of ['dashboard', 'screens']) {
    await page.goto(`/${TENANT}/${path}`);
    const preview = page.locator('[data-image-sequence]').first();
    await expect(preview).toHaveAttribute('data-preview-index', '0');
    // Nothing moves at rest: wait longer than a hold.
    await page.waitForTimeout(3000);
    await expect(preview).toHaveAttribute('data-preview-index', '0');
    await expect(preview.locator('img')).toHaveCount(1);
    await preview.hover();
    // At most two pictures exist while it runs (the one on show, and the next, preloaded).
    await expect(preview.locator('img')).toHaveCount(2);
    await expect(preview).toHaveAttribute('data-preview-index', '1', { timeout: QUICK_STEP_TIMEOUT });
    expect(await preview.locator('img').count()).toBeLessThanOrEqual(2);
    // The whole image, never cropped.
    await expect(preview.locator('img').first()).toHaveCSS('object-fit', 'contain');
    // Leaving puts the first picture back and stops everything.
    await page.mouse.move(0, 0);
    await expect(preview).toHaveAttribute('data-preview-index', '0');
    await expect(preview.locator('img')).toHaveCount(1);
  }
  await page.getByRole('button', { name: 'Demo display', exact: true }).click();
  const preview = page.getByTestId('screen-content-card').locator('[data-image-sequence]');
  await preview.hover();
  await expect(preview).toHaveAttribute('data-preview-index', '1', { timeout: QUICK_STEP_TIMEOUT });
  await page.screenshot({ path: info.outputPath('image-hover-screen.png'), fullPage: true });
});

/**
 * Watch one hover sequence from inside the page: every inline `style` the
 * browser serialises on its pictures, and the real (computed) opacity of the
 * SECOND picture every 20 ms. Reading the DOM is the only honest way to see a fade.
 *
 * Not the computed transition-duration: the app's reduced-motion baseline
 * (globals.css) clamps EVERY element to 0.001 ms, so it reads `1e-06s` whatever the
 * component asked for. What the component asked for is its inline style.
 */
const recordSequence = (preview: Locator) => preview.evaluate(root => {
  const w = window as unknown as { __sequence: { styles: string[]; opacity: Array<{ at: number; value: number }> } };
  w.__sequence = { styles: [], opacity: [] };
  setInterval(() => {
    const images = Array.from(root.querySelectorAll('img'));
    for (const image of images) {
      const style = image.getAttribute('style') || '';
      if (style && !w.__sequence.styles.includes(style)) w.__sequence.styles.push(style);
    }
    const second = images.find(image => image.src.endsWith('/b.svg'));
    if (second) w.__sequence.opacity.push({ at: performance.now(), value: Number(getComputedStyle(second).opacity) });
  }, 20);
});
const readSequence = (preview: Locator) => preview.evaluate(() => (window as unknown as { __sequence: { styles: string[]; opacity: Array<{ at: number; value: number }> } }).__sequence);

for (const reduced of [false, true]) {
  test(reduced ? 'with reduced motion the images still step on hover — with no fade' : 'with normal motion the images cross-fade over about 250 ms on hover', async ({ page }) => {
    if (reduced) await page.emulateMedia({ reducedMotion: 'reduce' });
    await setup(page, false, 'images');
    await page.route('https://preview.example.test/**', route => route.fulfill({ status: 200, contentType: 'image/svg+xml', body: WEBSITE_SHOT }));
    await page.goto(`/${TENANT}/dashboard`);
    const preview = page.locator('[data-image-sequence]').first();
    await preview.scrollIntoViewIfNeeded();
    await recordSequence(preview);
    await preview.hover();
    await expect(preview).toHaveAttribute('data-preview-index', '1', { timeout: QUICK_STEP_TIMEOUT });
    await page.waitForTimeout(200);
    const { styles, opacity } = await readSequence(preview);
    const anyFade = styles.some(style => /transition:\s*opacity/.test(style));
    const fadeOf250ms = styles.some(style => /transition:\s*opacity\s+(0\.25s|250ms)/.test(style));
    const midway = opacity.filter(sample => sample.value > 0.05 && sample.value < 0.95);
    if (reduced) {
      // It stepped (index 1, above) — and the component never asked for ANY fade: its standby says `transition: none`.
      expect(anyFade).toBe(false);
      expect(styles.some(style => /transition:\s*none/.test(style))).toBe(true);
      expect(midway).toHaveLength(0);
    } else {
      // The control that makes the reduced-motion case mean something: with normal motion the same
      // observation DOES see the fade — a 250 ms one, really passing through the middle opacities…
      expect(fadeOf250ms).toBe(true);
      expect(midway.length).toBeGreaterThan(3);
      // …taking about 250 ms from the first trace of the second picture to (nearly) all of it.
      const begins = opacity.find(sample => sample.value > 0.02)!.at;
      const done = opacity.find(sample => sample.at > begins && sample.value >= 0.98)!.at;
      expect(done - begins).toBeGreaterThan(100);
      expect(done - begins).toBeLessThan(650);
    }
  });
}

// ── Templates: the saved artwork at rest, live on top while hovered ─────────

/** Tag the saved picture so a later check can prove it is the very same element. */
const markArtwork = (poster: Locator) => poster.evaluate(img => { (img as HTMLElement).dataset.savedArtwork = 'kept'; });

test('a template’s saved artwork stays under the live frame while it runs, and is all that is left after hover', async ({ page }, info) => {
  await setup(page, false, 'template');
  for (const path of ['playlists', 'dashboard', 'screens']) {
    await page.goto(`/${TENANT}/${path}`);
    const preview = page.locator('[data-template-preview]').first();
    // ScaledTemplateThumbnail mounts a board only within ~600 px of the viewport (so a long list never
    // mounts a hundred of them), and the dashboard's thumbnail is below the fold. An operator can only
    // hover what is on screen: look at it the way they do.
    await preview.scrollIntoViewIfNeeded();
    const poster = preview.locator('[data-tpl-poster] img');
    await expect(preview).toHaveAttribute('data-template-preview', 'rest');
    await expect(poster).toBeVisible();
    await expect(preview.locator('iframe')).toHaveCount(0); // at rest: a picture, not a document
    await markArtwork(poster);

    await preview.hover();
    await expect(preview).toHaveAttribute('data-template-preview', 'live');
    // The first live render pulls the widget catalog chunk in: give a cold dev server room.
    await expect(preview.locator('[data-template-live] iframe')).toHaveCount(1, { timeout: 20000 });
    await expect(preview.locator('[data-template-live] iframe')).not.toHaveAttribute('src', /freeze=1/);
    // The saved picture was never replaced: it is the same element, still on the page, outside the live layer.
    await expect(preview.locator('[data-tpl-poster] img[data-saved-artwork="kept"]')).toHaveCount(1);
    if (path === 'screens') await page.screenshot({ path: info.outputPath('template-hover-poster.png'), fullPage: true });

    await page.mouse.move(0, 0);
    await expect(preview).toHaveAttribute('data-template-preview', 'rest');
    await expect(preview.locator('iframe')).toHaveCount(0);
    await expect(preview.locator('[data-tpl-poster] img[data-saved-artwork="kept"]')).toHaveCount(1);
  }
});

test('template photo carousels run their saved settings on hover and freeze when the cursor leaves', async ({ page }, info) => {
  await setup(page, false, 'carousel');
  for (const path of ['playlists', 'dashboard', 'screens']) {
    await page.goto(`/${TENANT}/${path}`);
    const preview = page.locator('[data-template-preview]').first();
    // The frozen frame only exists once the thumbnail is near the viewport (ScaledTemplateThumbnail's
    // mount gate) — and the dashboard's is below the fold. Look at it the way an operator does.
    await preview.scrollIntoViewIfNeeded();
    await expect(preview).toHaveAttribute('data-template-preview', 'rest');
    // A customised board has no pristine poster, so its saved artwork at rest is a frozen frame.
    const frozen = preview.locator('iframe').first();
    await expect(frozen).toHaveAttribute('src', /freeze=1/);

    await preview.hover();
    await expect(preview).toHaveAttribute('data-template-preview', 'live');
    const layer = preview.locator('[data-template-live] iframe');
    await expect(layer).toHaveCount(1, { timeout: 20000 }); // the first live render pulls the widget catalog chunk in
    await expect(layer).not.toHaveAttribute('src', /freeze=1/);
    await expect(layer).toHaveAttribute('sandbox', 'allow-scripts');
    // The frozen frame stays in place under it — nothing was reloaded to make way.
    await expect(preview.locator('iframe')).toHaveCount(2);
    await expect(frozen).toHaveAttribute('src', /freeze=1/);

    const carousel = layer.contentFrame().locator('[data-imgslot="tour.image"] [data-native-image-carousel]');
    await expect(carousel).toBeVisible();
    const first = await carousel.locator('img').first().getAttribute('src');
    await expect.poll(async () => carousel.locator('img').first().getAttribute('src'), { timeout: 10000 }).not.toBe(first);
    if (path === 'screens') await page.screenshot({ path: info.outputPath('template-hover-screen.png'), fullPage: true });

    await page.mouse.move(0, 0);
    await expect(preview).toHaveAttribute('data-template-preview', 'rest');
    await expect(preview.locator('iframe')).toHaveCount(1);
    await expect(preview.locator('iframe').first()).toHaveAttribute('src', /freeze=1/);
  }
});
