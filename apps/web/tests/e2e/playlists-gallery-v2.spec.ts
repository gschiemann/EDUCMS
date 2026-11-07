/**
 * Playlists gallery v2 — design preview (`?design=v2&look=a|b|c`).
 *
 * Owner on the first v2 (2026-11-02): "I want to see it with content previews
 * on it … no crazy colors". This spec drives the real route with every API
 * call mocked (fictional names only — the repo is public) and REAL pictures:
 * the repo's own template posters (`public/templates/_thumbs/**`) and sample
 * media (`public/templates/{school/menu-assets,hs/news-assets}`), mixed
 * portrait and landscape, so the previews look like a real library. With
 * PLV2_SHOTS set it writes the screenshots for each look.
 *
 *   E2E_BASE=http://localhost:3217 PLV2_SHOTS=<dir> \
 *     pnpm --filter web exec playwright test -c playwright.sandbox.config.ts \
 *     tests/e2e/playlists-gallery-v2.spec.ts --project=webkit
 *
 * The assertions hold without PLV2_SHOTS: no param → the v1 page; with it →
 * the gallery in each look, real pictures loaded, the filter menu, the
 * "playing where" popover (offline screen named), bulk select with Delete.
 */
import { test, expect, type Page, type Route } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const SCHOOL_ID = 'e2e-school';
const ORIGIN = process.env.E2E_BASE || 'http://localhost:3000';
const SHOTS = process.env.PLV2_SHOTS || '';
const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': ORIGIN,
  'Access-Control-Allow-Credentials': 'true',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'authorization,content-type,x-csrf-token,x-requested-with',
};
const USER = { id: 'u1', email: 'e2e@example.com', role: 'SCHOOL_ADMIN', tenantId: SCHOOL_ID, canTriggerPanic: false };
const IMG = 'https://img.e2e.invalid';
const PUBLIC_TEMPLATES = path.resolve(__dirname, '../../public/templates');
const HOUR = 3_600_000;
const now = Date.now();

// ── Real pictures from the repo: [path under public/templates, w, h] ─────
type Pic = [string, number, number];
const L = (p: string): Pic => [`_thumbs/${p}.png`, 800, 450];
const P = (p: string): Pic => [`_thumbs/${p}.png`, 450, 800];
const PHOTO = (p: string, w: number, h: number): Pic => [p, w, h];
/** A video item: its poster frame is a real still. */
type Item = Pic | { video: Pic };

// name, items, seconds per item
const PL: Array<[string, Item[], number]> = [
  ['Main Lobby Welcome', [L('school/ms-lobby-v1'), L('school/ms-lobby-v2'), L('school/ms-lobby-v3'), L('hs/achievement'), L('hs/morning-news')], 12],
  ['Cafeteria Menus', [L('hs/caf-today'), L('hs/caf-week'), L('hs/caf-market'), PHOTO('school/menu-assets/ms-campus-pizza.jpg', 2200, 1571)], 15],
  ['Game Day Promo', [L('hs/ath-gameday'), L('hs/ath-biggame'), L('hs/ath-standings'), L('hs/varsity')], 20],
  ['Hallway Posters', [P('school/campus-pulse/01-campus-magazine-portrait'), P('school/campus-pulse/02-digital-signal-portrait'), P('school/campus-pulse/03-neo-yearbook-portrait'), P('school/campus-pulse/04-varsity-broadcast-portrait')], 10],
  ['Lunch Line Portrait', [P('school/ms-lunch-campus-lineup-portrait'), PHOTO('school/menu-assets/ms-campus-pasta.jpg', 2200, 3300), PHOTO('school/menu-assets/teriyaki-chicken.jpg', 3840, 4800)], 12],
  ['Bus Board', [L('hs/bell-schedule')], 30],
  ['Morning Announcements', [{ video: PHOTO('hs/news-assets/student-hallway-study-poster.jpg', 1280, 720) }, L('hs/morning-news-daily-cut'), L('hs/morning-news-rundown-desk')], 15],
  ['Snow Day Plan', [L('hs/hall-bulletin')], 15],
  ['Wayfinding Portrait', [P('hs/hall-wayfinder-campus-grid-portrait'), P('school/campus-pulse/05-metro-wayfinding-portrait')], 12],
  ['Honor Roll Slides', [L('hs/achievement-stage-call'), L('hs/achievement-victory-wall'), L('hs/yearbook')], 8],
  ['Visitor Safety', [L('hs/blueprint'), L('hs/hall-wayfinder')], 20],
  ['Winter Concert', [L('hs/gallery'), L('hs/zine')], 10],
  ['Bell Schedules', [L('school/elem-bell-daybook'), L('school/ms-bell-agenda-flip'), L('school/ms-bell-locker-line'), L('school/ms-bell-rotation-radar'), L('school/elem-bell-sun-clock'), L('school/elem-bell-color-hop')], 10],
  ['Fresh Kitchen', [{ video: PHOTO('school/menu-assets/salad-prep-poster.jpg', 3840, 2160) }, PHOTO('school/menu-assets/baked-ziti.jpg', 4928, 3264), PHOTO('school/menu-assets/grilled-cheese.jpg', 3840, 2561), PHOTO('school/menu-assets/quesadilla.jpg', 6960, 3915)], 12],
  ['Commencement Guide', [P('school/commencement-guest-guide-portrait'), P('hs/achievement-portrait'), P('hs/bell-schedule-portrait')], 15],
];

let aid = 0;
const assetFor = (item: Item) => {
  const video = !Array.isArray(item);
  const [file, w, h] = video ? item.video : item;
  const id = `a${++aid}`;
  return {
    id,
    originalName: path.basename(file).replace(/\.\w+$/, video ? '.mp4' : path.extname(file)),
    mimeType: video ? 'video/mp4' : file.endsWith('.jpg') ? 'image/jpeg' : 'image/png',
    fileUrl: video ? `${IMG}/${id}.mp4` : `${IMG}/${file}`,
    posterUrl: video ? `${IMG}/${file}` : null,
    processingMeta: { originalDimensions: { w, h } },
  };
};
const PLAYLISTS = PL.map(([name, items, sec], i) => ({
  id: `p${i + 1}`,
  name,
  items: items.map((it, j) => ({ id: `i${i}-${j}`, durationMs: sec * 1000, asset: assetFor(it) })),
  updatedAt: new Date(now - (i + 1) * 5 * HOUR).toISOString(),
  createdBy: { id: 'u1', email: 'e2e@example.com' },
}));

const ok = { status: 'ONLINE', renderHealth: 'OK', lastRenderedAt: new Date(now - 30_000).toISOString() };
const SCREENS = [
  { id: 's1', name: 'Front Entrance', screenGroupId: 'g1', resolution: '1920x1080', location: 'North Campus', ...ok },
  { id: 's2', name: 'Main Office', screenGroupId: 'g1', resolution: '1920x1080', location: 'North Campus', ...ok },
  { id: 's3', name: 'Cafeteria Left', screenGroupId: 'g2', resolution: '1920x1080', location: 'North Campus', ...ok },
  { id: 's4', name: 'Cafeteria Right', screenGroupId: 'g2', resolution: '1920x1080', location: 'North Campus', ...ok },
  { id: 's5', name: 'Hallway A Poster', screenGroupId: 'g3', resolution: '1080x1920', location: 'South Campus', ...ok },
  { id: 's6', name: 'Hallway B Poster', screenGroupId: 'g3', resolution: '1080x1920', location: 'South Campus', ...ok },
  { id: 's7', name: 'Gym Entrance', screenGroupId: null, resolution: '1920x1080', location: 'South Campus', status: 'OFFLINE', renderHealth: 'STALE', lastRenderedAt: new Date(now - 6 * HOUR).toISOString() },
  { id: 's8', name: 'Bus Loop Display', screenGroupId: null, resolution: '1920x1080', location: 'North Campus', ...ok },
  { id: 's9', name: 'Library Desk', screenGroupId: null, resolution: '1920x1080', location: 'South Campus', ...ok },
];
const GROUPS = [
  { id: 'g1', name: 'Lobby Screens', screens: [{ id: 's1' }, { id: 's2' }] },
  { id: 'g2', name: 'Cafeteria Boards', screens: [{ id: 's3' }, { id: 's4' }] },
  { id: 'g3', name: 'Hallway Posters', screens: [{ id: 's5' }, { id: 's6' }] },
];
const start = new Date(now - 7 * 24 * HOUR).toISOString();
let sid = 0;
const rule = (playlistId: string, target: { screenId?: string; screenGroupId?: string }, extra: Record<string, unknown> = {}) => ({
  id: `sc${++sid}`, playlistId, screenId: target.screenId ?? null, screenGroupId: target.screenGroupId ?? null,
  isActive: true, startTime: start, priority: 0,
  screen: target.screenId ? { id: target.screenId, name: SCREENS.find((s) => s.id === target.screenId)!.name } : null,
  screenGroup: target.screenGroupId ? { id: target.screenGroupId, name: GROUPS.find((g) => g.id === target.screenGroupId)!.name } : null,
  ...extra,
});
const SCHEDULES = [
  rule('p1', { screenGroupId: 'g1' }), rule('p1', { screenId: 's9' }),
  rule('p2', { screenGroupId: 'g2' }),
  rule('p3', { screenId: 's7' }), rule('p3', { screenId: 's8' }), // Gym Entrance is offline → named, needs attention
  rule('p4', { screenGroupId: 'g3' }),
  rule('p5', { screenGroupId: 'g3' }),
  rule('p6', { screenId: 's8' }),
  rule('p7', { screenGroupId: 'g1' }),
  rule('p13', { screenGroupId: 'g2' }), rule('p13', { screenId: 's9' }),
  rule('p8', { screenGroupId: 'g1' }, { startTime: new Date(now + 3 * 24 * HOUR).toISOString() }), // scheduled
  rule('p12', { screenGroupId: 'g1' }, { startTime: new Date(now + 9 * 24 * HOUR).toISOString() }), // scheduled
  rule('p10', { screenGroupId: 'g1' }, { isActive: false }), // paused
  rule('p11', { screenId: 's1' }, { isActive: false }), // paused
];

async function openPlaylists(page: Page, query: string, viewport: { width: number; height: number }) {
  const cors = (route: Route, fn: () => unknown) =>
    route.request().method() === 'OPTIONS' ? route.fulfill({ status: 204, headers: CORS, body: '' }) : fn();
  const json = (route: Route, body: unknown) =>
    cors(route, () => route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify(body) }));
  await page.route(/http:\/\/api\.invalid\/.*/, (r) => cors(r, () => r.fulfill({ status: 204, headers: CORS, body: '' })));
  await page.route('**/api/v1/**', (r) => cors(r, () => r.fulfill({ status: 204, headers: CORS, body: '' })));
  await page.route('**/api/v1/auth/me', (r) => json(r, USER));
  await page.route('**/api/v1/tenants', (r) => json(r, [{ id: SCHOOL_ID, name: 'Maple Ridge Middle', slug: SCHOOL_ID, vertical: 'K12' }]));
  await page.route('**/api/v1/tenants/accessible', (r) => json(r, [{ id: SCHOOL_ID, name: 'Maple Ridge Middle', slug: SCHOOL_ID }]));
  await page.route('**/api/v1/branding/me', (r) => json(r, {}));
  await page.route('**/api/v1/screens', (r) => json(r, SCREENS));
  await page.route('**/api/v1/schedules', (r) => json(r, SCHEDULES));
  await page.route('**/api/v1/screen-groups', (r) => json(r, GROUPS));
  await page.route('**/api/v1/templates', (r) => json(r, []));
  await page.route('**/api/v1/assets**', (r) => json(r, []));
  await page.route('**/api/v1/playlists', (r) => json(r, PLAYLISTS));
  // The pictures: real files from the repo's public/templates.
  await page.route(`${IMG}/**`, (r) => {
    const rel = decodeURIComponent(new URL(r.request().url()).pathname).replace(/^\/+/, '');
    const file = path.resolve(PUBLIC_TEMPLATES, rel);
    if (!file.startsWith(PUBLIC_TEMPLATES) || !fs.existsSync(file)) return r.fulfill({ status: 404, body: '' });
    return r.fulfill({ status: 200, contentType: file.endsWith('.jpg') ? 'image/jpeg' : 'image/png', body: fs.readFileSync(file) });
  });
  await page.addInitScript((user) => {
    try { localStorage.setItem('edu_cms_eula_accepted_v1.0', '1'); } catch { /* ignore */ }
    try {
      const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
      const token = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: user.id, tenantId: user.tenantId, role: user.role, exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
      sessionStorage.setItem('edu_cms_token', token);
      sessionStorage.setItem('edu_cms_user', JSON.stringify(user));
    } catch { /* ignore */ }
  }, USER);
  await page.setViewportSize(viewport);
  await page.goto(`/${SCHOOL_ID}/playlists${query}`, { waitUntil: 'domcontentloaded' });
}

/** Every picture in the first screenful has decoded (no blank tiles in a screenshot). */
async function picturesLoaded(page: Page) {
  await expect.poll(async () => page.evaluate(() => {
    const imgs = Array.from(document.querySelectorAll('[data-testid="playlist-card-v2"] img')) as HTMLImageElement[];
    const inView = imgs.filter((i) => { const r = i.getBoundingClientRect(); return r.top < window.innerHeight && r.bottom > 0; });
    return inView.length > 0 && inView.every((i) => i.complete && i.naturalWidth > 0);
  }), { timeout: 30_000 }).toBe(true);
}

async function shot(page: Page, name: string, scrollPx = 0) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  if (scrollPx) { await page.mouse.wheel(0, scrollPx); await page.waitForTimeout(500); await picturesLoaded(page); }
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(SHOTS, name) });
  if (scrollPx) { await page.mouse.wheel(0, -scrollPx * 2); await page.waitForTimeout(300); }
}

const DESKTOP = { width: 1325, height: 758 };
const PHONE = { width: 390, height: 844 };
const LOOKS = [['a', 'album'], ['b', 'filmstrip'], ['c', 'rows']] as const;

test.describe('playlists gallery v2 (design preview)', () => {
  test.setTimeout(180_000);

  test('without the param the page is v1, unchanged', async ({ page }) => {
    await openPlaylists(page, '', DESKTOP);
    await page.getByTestId('playlist-row').first().waitFor({ state: 'visible', timeout: 120_000 });
    await expect(page.getByTestId('playlists-v2')).toHaveCount(0);
  });

  for (const [look, name] of LOOKS) {
    test(`look ${look} (${name}) — desktop`, async ({ page }) => {
      await openPlaylists(page, `?design=v2&look=${look}`, DESKTOP);
      const cards = page.getByTestId('playlist-card-v2');
      await cards.first().waitFor({ state: 'visible', timeout: 120_000 });
      await expect(page.getByTestId('playlists-v2')).toHaveAttribute('data-look', look);
      await expect(cards).toHaveCount(15);
      await expect(page.getByRole('heading', { name: /Playing now/ })).toBeVisible();
      await expect(page.locator('[data-testid="playlist-card-v2"][data-orientation="portrait"]').first()).toBeAttached();
      // The offline screen is named on the card's "playing where" line.
      await expect(cards.filter({ hasText: 'Game Day Promo' }).getByTestId('where-offline')).toContainText('Gym Entrance');
      await page.mouse.move(5, 5);
      await picturesLoaded(page);
      await shot(page, `look-${look}-${name}-desktop.png`);
      await page.mouse.move(700, 400);
      await shot(page, `look-${look}-${name}-desktop-scrolled.png`, 640);

      // Hover: the card cross-fades to its next item after ~3 s.
      const lobby = cards.filter({ hasText: 'Main Lobby Welcome' });
      await lobby.hover();
      await page.waitForTimeout(3600);
      await expect(lobby.getByTestId('card-crossfade')).toBeVisible();
      await shot(page, `look-${look}-${name}-desktop-hover.png`);

      // "Playing where" popover.
      await lobby.getByTestId('where-button').click();
      await expect(page.getByTestId('where-panel')).toContainText('Lobby Screens');
      await page.keyboard.press('Escape');

      // Bulk select → the shared SelectionToolbar with Delete visible.
      await lobby.hover();
      await lobby.getByTestId('card-select').click();
      await cards.filter({ hasText: 'Cafeteria Menus' }).getByTestId('card-select').click();
      await expect(page.getByTestId('bulk-count')).toContainText('2');
      await expect(page.getByTestId('bulk-delete')).toBeVisible();
      await page.mouse.move(5, 5);
      await shot(page, `look-${look}-${name}-desktop-select.png`);
    });

    test(`look ${look} (${name}) — iPhone`, async ({ page }) => {
      await openPlaylists(page, `?design=v2&look=${look}`, PHONE);
      const cards = page.getByTestId('playlist-card-v2');
      await cards.first().waitFor({ state: 'visible', timeout: 120_000 });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      await picturesLoaded(page);
      await shot(page, `look-${look}-${name}-iphone.png`);
      await shot(page, `look-${look}-${name}-iphone-scrolled.png`, 1400);
      await cards.first().getByTestId('card-select').click();
      await expect(page.locator('[data-testid="playlists-selection"][data-placement="dock"]')).toBeVisible();
      await expect(page.getByTestId('bulk-delete')).toBeVisible();
      await shot(page, `look-${look}-${name}-iphone-select.png`);
    });
  }

  test('filter menu narrows by orientation', async ({ page }) => {
    await openPlaylists(page, '?design=v2', DESKTOP);
    const cards = page.getByTestId('playlist-card-v2');
    await cards.first().waitFor({ state: 'visible', timeout: 120_000 });
    await page.getByTestId('playlists-filter-menu').click();
    await page.getByRole('radio', { name: /Portrait/ }).click();
    await page.keyboard.press('Escape');
    await expect(cards.first()).toHaveAttribute('data-orientation', 'portrait');
    await expect(cards).toHaveCount(4);
  });
});
