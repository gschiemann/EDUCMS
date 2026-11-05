/**
 * Playlists gallery v2 — design preview (`?design=v2`, 2026-11-02).
 *
 * Greg: "the playlist tiles is a ugly ass design ... make it easy to find
 * what is playing where". He wants to SEE it with content before approving,
 * so this spec drives the real route with every API call mocked (fictional
 * names only — the repo is public) and, when PLV2_SHOTS is set, writes the
 * before/after screenshots for the review.
 *
 *   E2E_BASE=http://localhost:3217 PLV2_SHOTS=<dir> \
 *     pnpm --filter web exec playwright test -c playwright.sandbox.config.ts \
 *     tests/e2e/playlists-gallery-v2.spec.ts --project=webkit
 *
 * The assertions hold without PLV2_SHOTS: no param → the v1 page; with it →
 * the gallery, its tabs, the filter menu and the "playing where" popover.
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
const HOUR = 3_600_000;
const now = Date.now();

// ── Fictional signage content, drawn as SVG posters ─────────────────────
type Poster = { key: string; title: string; sub: string; a: string; b: string; ink?: string; portrait?: boolean };
const POSTERS: Poster[] = [
  { key: 'welcome', title: 'Welcome to Maple Ridge', sub: 'Home of the Foxes', a: '#1e3a8a', b: '#7c3aed' },
  { key: 'menu', title: "Today's Lunch", sub: 'Tacos · Rice · Fresh fruit', a: '#f59e0b', b: '#dc2626' },
  { key: 'gameday', title: 'Game Day Friday', sub: 'Foxes vs. Eagles · 7 PM', a: '#065f46', b: '#10b981', portrait: true },
  { key: 'fundraiser', title: 'Fall Fundraiser', sub: 'Goal: $12,000', a: '#9a3412', b: '#fb923c', portrait: true },
  { key: 'library', title: 'Library Week', sub: 'Read 20 minutes a day', a: '#0f766e', b: '#38bdf8' },
  { key: 'bus', title: 'Bus Departures', sub: 'Route 4 · 3:15 PM', a: '#111827', b: '#374151' },
  { key: 'art', title: 'Student Art Show', sub: 'Gallery Hall · Nov 14', a: '#be185d', b: '#f472b6', portrait: true },
  { key: 'weather', title: 'Snow Day Plan', sub: 'Check the app by 6 AM', a: '#0369a1', b: '#93c5fd' },
  { key: 'clubs', title: 'Join a Club', sub: 'Robotics · Chess · Drama', a: '#4338ca', b: '#22d3ee', portrait: true },
  { key: 'honor', title: 'Honor Roll', sub: 'Congratulations, Foxes!', a: '#a16207', b: '#fde047', ink: '#1f2937' },
  { key: 'safety', title: 'Safety First', sub: 'Badges visible at all times', a: '#991b1b', b: '#f87171' },
  { key: 'concert', title: 'Winter Concert', sub: 'Auditorium · Dec 12', a: '#1e1b4b', b: '#6366f1', portrait: true },
  { key: 'staff', title: 'Staff Spotlight', sub: 'Ms. Rivera · Science', a: '#14532d', b: '#84cc16' },
  { key: 'menu2', title: 'Smoothie Bar', sub: 'Open 7:30 – 8:15 AM', a: '#7e22ce', b: '#f0abfc', portrait: true },
  { key: 'gym', title: 'Fitness Challenge', sub: '10,000 steps this week', a: '#0c4a6e', b: '#f97316' },
];

function posterSvg(p: Poster): string {
  const [w, h] = p.portrait ? [1080, 1920] : [1920, 1080];
  const ink = p.ink ?? '#ffffff';
  const t = p.portrait ? 120 : 132;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${p.a}"/><stop offset="1" stop-color="${p.b}"/></linearGradient></defs>
  <rect width="${w}" height="${h}" fill="url(#g)"/>
  <circle cx="${w * 0.82}" cy="${h * 0.2}" r="${Math.min(w, h) * 0.32}" fill="#ffffff" opacity="0.12"/>
  <circle cx="${w * 0.1}" cy="${h * 0.92}" r="${Math.min(w, h) * 0.45}" fill="#000000" opacity="0.12"/>
  <rect x="${w * 0.08}" y="${h * (p.portrait ? 0.56 : 0.52)}" width="${w * 0.18}" height="14" rx="7" fill="${ink}" opacity="0.8"/>
  <text x="${w * 0.08}" y="${h * (p.portrait ? 0.66 : 0.68)}" font-family="Helvetica, Arial, sans-serif" font-weight="800" font-size="${t}" fill="${ink}">${p.title.length > 16 && p.portrait ? p.title.split(' ').slice(0, 2).join(' ') : p.title}</text>
  ${p.title.length > 16 && p.portrait ? `<text x="${w * 0.08}" y="${h * 0.66 + t * 1.1}" font-family="Helvetica, Arial, sans-serif" font-weight="800" font-size="${t}" fill="${ink}">${p.title.split(' ').slice(2).join(' ')}</text>` : ''}
  <text x="${w * 0.08}" y="${h * (p.portrait ? 0.8 : 0.82)}" font-family="Helvetica, Arial, sans-serif" font-weight="500" font-size="${t * 0.45}" fill="${ink}" opacity="0.9">${p.sub}</text>
</svg>`;
}

const asset = (p: Poster, video = false) => ({
  id: `a-${p.key}`,
  originalName: `${p.key}.${video ? 'mp4' : 'jpg'}`,
  mimeType: video ? 'video/mp4' : 'image/jpeg',
  fileUrl: `${IMG}/${p.key}.${video ? 'mp4' : 'svg'}`,
  posterUrl: video ? `${IMG}/${p.key}.svg` : null,
});
const byKey = (k: string) => POSTERS.find((p) => p.key === k)!;

// name, poster keys, item duration, video?
const PL: Array<[string, string[], number, boolean?]> = [
  ['Main Lobby Welcome', ['welcome', 'honor', 'staff'], 12_000],
  ['Cafeteria Menus', ['menu', 'menu2'], 15_000],
  ['Game Day Promo', ['gameday'], 20_000, true],
  ['Fall Fundraiser', ['fundraiser', 'art'], 10_000],
  ['Library Week', ['library'], 12_000],
  ['Bus Board', ['bus'], 30_000],
  ['Art Show Posters', ['art', 'clubs'], 10_000],
  ['Snow Day Plan', ['weather'], 15_000],
  ['Club Fair Portrait', ['clubs'], 12_000],
  ['Honor Roll Slides', ['honor', 'staff'], 8_000],
  ['Visitor Safety', ['safety'], 20_000],
  ['Winter Concert', ['concert'], 10_000],
  ['Staff Spotlight', ['staff', 'welcome'], 12_000],
  ['Smoothie Bar Portrait', ['menu2'], 10_000],
  ['Fitness Challenge', ['gym'], 15_000, true],
];
const PLAYLISTS = PL.map(([name, keys, dur, video], i) => ({
  id: `p${i + 1}`,
  name,
  items: keys.map((k, j) => ({ id: `i${i}-${j}`, durationMs: dur, asset: asset(byKey(k), !!video && j === 0) })),
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
  { id: 's7', name: 'Gym Entrance', screenGroupId: null, resolution: '1080x1920', location: 'South Campus', status: 'OFFLINE', renderHealth: 'STALE', lastRenderedAt: new Date(now - 6 * HOUR).toISOString() },
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
  rule('p3', { screenId: 's7' }), // Gym Entrance is offline → needs attention
  rule('p4', { screenGroupId: 'g3' }),
  rule('p6', { screenId: 's8' }),
  rule('p5', { screenId: 's9' }, { startTime: new Date(now + 3 * 24 * HOUR).toISOString() }), // scheduled
  rule('p12', { screenGroupId: 'g1' }, { startTime: new Date(now + 9 * 24 * HOUR).toISOString() }), // scheduled
  rule('p8', { screenGroupId: 'g1' }, { isActive: false }), // paused
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
  await page.route(`${IMG}/**`, (r) => {
    const key = path.basename(new URL(r.request().url()).pathname).replace(/\.\w+$/, '');
    const p = POSTERS.find((x) => x.key === key);
    return p ? r.fulfill({ status: 200, contentType: 'image/svg+xml', body: posterSvg(p) }) : r.fulfill({ status: 404, body: '' });
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

async function shot(page: Page, name: string, scrollPx = 0) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.waitForTimeout(600); // images decode + the menu's enter
  if (scrollPx) { await page.mouse.move(700, 600); await page.mouse.wheel(0, scrollPx); await page.waitForTimeout(800); }
  await page.screenshot({ path: path.join(SHOTS, name) });
  if (scrollPx) { await page.mouse.wheel(0, -scrollPx * 2); await page.waitForTimeout(300); }
}

const DESKTOP = { width: 1325, height: 758 };
const PHONE = { width: 390, height: 844 };

test.describe('playlists gallery v2 (design preview)', () => {
  test.setTimeout(180_000);

  test('without the param the page is v1, unchanged', async ({ page }) => {
    await openPlaylists(page, '', DESKTOP);
    await page.getByTestId('playlist-row').first().waitFor({ state: 'visible', timeout: 120_000 });
    await expect(page.getByTestId('playlists-v2')).toHaveCount(0);
    const grid = page.getByRole('button', { name: 'Grid view' });
    if (await grid.isVisible()) await grid.click();
    await shot(page, '01-before-desktop-grid.png');
  });

  test('before, iPhone', async ({ page }) => {
    await openPlaylists(page, '', PHONE);
    await page.getByText('Main Lobby Welcome').first().waitFor({ state: 'attached', timeout: 120_000 });
    await page.waitForTimeout(1500);
    await shot(page, '02-before-iphone.png');
  });

  test('v2 desktop: gallery, filter menu, playing-where popover', async ({ page }) => {
    await openPlaylists(page, '?design=v2', DESKTOP);
    const cards = page.getByTestId('playlist-card-v2');
    await cards.first().waitFor({ state: 'visible', timeout: 120_000 });
    await expect(cards).toHaveCount(15);
    await expect(page.getByRole('heading', { name: /Playing now/ })).toBeVisible();
    // A portrait playlist is drawn portrait.
    await expect(page.locator('[data-testid="playlist-card-v2"][data-orientation="portrait"]').first()).toBeVisible();
    await page.mouse.move(5, 5);
    await shot(page, '03-after-desktop.png');
    await shot(page, '04-after-desktop-scrolled.png', 700);

    await page.getByTestId('playlists-filter-menu').click();
    await expect(page.getByTestId('playlists-filter-menu-panel')).toBeVisible();
    await shot(page, '05-after-filter-menu.png');
    await page.getByRole('radio', { name: /Portrait/ }).click();
    await page.keyboard.press('Escape');
    await expect(cards.first()).toHaveAttribute('data-orientation', 'portrait');
    await page.getByTestId('playlists-filter-menu').click();
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await page.keyboard.press('Escape');

    const lobby = cards.filter({ hasText: 'Main Lobby Welcome' });
    await lobby.getByTestId('where-button').click();
    const panel = page.getByTestId('where-panel');
    await expect(panel).toContainText('Lobby Screens');
    await expect(panel).toContainText('Library Desk');
    await shot(page, '06-after-playing-where-popover.png');
    await page.keyboard.press('Escape');

    const attentionTab = page.getByTestId('playlists-tabs').getByRole('tab', { name: /Needs attention/ });
    await expect(attentionTab).toBeVisible(); // on the line at the operator's width, not behind More
    await attentionTab.click();
    await expect(cards).toHaveCount(1);
    await expect(cards.first().getByTestId('card-attention')).toBeVisible();
    await shot(page, '07-after-needs-attention-tab.png');
  });

  test('v2 iPhone: one column', async ({ page }) => {
    await openPlaylists(page, '?design=v2', PHONE);
    const cards = page.getByTestId('playlist-card-v2');
    await cards.first().waitFor({ state: 'visible', timeout: 120_000 });
    const [a, b] = await Promise.all([cards.nth(0).boundingBox(), cards.nth(1).boundingBox()]);
    expect(Math.abs((a?.x ?? 0) - (b?.x ?? 1))).toBeLessThan(1); // stacked, not side by side
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await shot(page, '08-after-iphone.png');
    await shot(page, '09-after-iphone-scrolled.png', 2600);
  });
});
