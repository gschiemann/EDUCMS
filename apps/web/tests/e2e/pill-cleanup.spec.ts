/**
 * Pill cleanup (2026-11-02, owner-approved — the default design since the
 * `?design=v2` gate was removed) — Screens and Templates on a fully mocked
 * API with realistic demo content: 20 screens in six groups with mixed
 * states, playlists with real pictures, and the real K-12 ready-made catalog
 * (transpiled from apps/api/src/templates at test time, so every card shows
 * its real poster) plus six of "your" templates.
 *
 * What it proves on every run (Chromium + WebKit):
 *   - the main filter is a TabRow, secondaries sit behind ONE Filter button,
 *     and selecting 3 items turns the toolbar into the selection bar on
 *     desktop and a bottom dock on an iPhone;
 *   - Screens: a status picked in Filter that has a tab underlines that tab
 *     (no Filter count); one with no tab underlines none and is the count;
 *   - Templates: the category tabs share ONE row with search · Filter · Sort
 *     at 1325px, the rest under "More"; a category picked from More becomes
 *     the underlined tab; the tab still resets paging and the Holiday
 *     sub-filter appears in the Filter menu only under Holidays;
 *   - Templates on an iPhone: the Sort control fits (an icon, its full value
 *     in the accessible name), nothing scrolls sideways;
 *   - the Screens content column shows real thumbnails.
 *
 * With `PILL_SHOTS=1` it writes screenshots 03–16 the owner reviews into
 * docs/research/2026-11-02-pill-audit/screens/ (WebKit only; 01/02/09/10
 * are the "before" shots and are not retaken):
 *
 *   PILL_SHOTS=1 E2E_BASE=http://localhost:3123 pnpm --filter web exec playwright test \
 *     -c playwright.sandbox.config.ts tests/e2e/pill-cleanup.spec.ts --project=webkit
 */
import { test, expect, type Page, type Route } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';

const TENANT = 'demo-district';
const USER = { id: 'demo-admin', tenantId: TENANT, role: 'SCHOOL_ADMIN', email: 'admin@example.test', canTriggerPanic: false };
const SHOTS = process.env.PILL_SHOTS === '1';
const OUT = process.env.PILL_SHOTS_DIR || path.resolve(__dirname, '../../../../docs/research/2026-11-02-pill-audit/screens');
const DESKTOP = { width: 1325, height: 758 };
const PHONE = { width: 390, height: 844 };

// ── Screens ──────────────────────────────────────────────────────────────
const NOW = Date.now();
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();
const GROUPS = [
  { id: 'g-lobby', tenantId: TENANT, name: 'Main Lobby', address: '1200 Maple Ridge Rd' },
  { id: 'g-cafe', tenantId: TENANT, name: 'Cafeteria', address: '1200 Maple Ridge Rd' },
  { id: 'g-gym', tenantId: TENANT, name: 'Gymnasium', address: '1200 Maple Ridge Rd' },
  { id: 'g-library', tenantId: TENANT, name: 'Library & Media Center', address: '1200 Maple Ridge Rd' },
  { id: 'g-office', tenantId: TENANT, name: 'Front Office', address: '1200 Maple Ridge Rd' },
  { id: 'g-hall', tenantId: TENANT, name: 'Hallway B · Science Wing', address: '1200 Maple Ridge Rd' },
];
type State = 'ok' | 'offline' | 'offline-days' | 'paused' | 'updating' | 'behind' | 'push' | 'pending' | 'idle';
const SCREEN_SPECS: Array<[string, string, string, State]> = [
  ['s01', 'Lobby Welcome Wall', 'g-lobby', 'ok'],
  ['s02', 'Lobby Events Portrait', 'g-lobby', 'ok'],
  ['s03', 'Visitor Check-in Kiosk', 'g-lobby', 'updating'],
  ['s04', 'Lunch Line Menu A', 'g-cafe', 'ok'],
  ['s05', 'Lunch Line Menu B', 'g-cafe', 'behind'],
  ['s06', 'Cafeteria Announcements', 'g-cafe', 'ok'],
  ['s07', 'Gym Scoreboard Ribbon', 'g-gym', 'offline'],
  ['s08', 'Gym Entrance Display', 'g-gym', 'ok'],
  ['s09', 'Concessions Menu', 'g-gym', 'paused'],
  ['s10', 'Library Reading Corner', 'g-library', 'ok'],
  ['s11', 'Media Center Schedule', 'g-library', 'push'],
  ['s12', 'Book Fair Promo', 'g-library', 'idle'],
  ['s13', 'Front Office Bulletin', 'g-office', 'ok'],
  ['s14', 'Attendance Desk', 'g-office', 'offline-days'],
  ['s15', 'Bell Schedule Board', 'g-hall', 'ok'],
  ['s16', 'Science Wing Spotlight', 'g-hall', 'ok'],
  ['s17', 'Chem Lab Safety Board', 'g-hall', 'pending'],
  ['s18', 'STEM Club Display', 'g-hall', 'updating'],
  ['s19', 'Hallway Countdown', 'g-hall', 'ok'],
  ['s20', 'Bus Loop Departures', null as unknown as string, 'offline'],
];
const img = (id: string, fileUrl: string, i: number) => ({ id, sequenceOrder: i, durationMs: 10_000, asset: { fileUrl, mimeType: 'image/jpeg' } });
const PLAYLISTS = [
  { id: 'pl-welcome', name: 'Morning Welcome Loop', tenantId: TENANT, isActive: true, items: [
    img('it-w1', '/templates/hs/news-assets/student-hallway-study-poster.jpg', 0), img('it-w2', '/demo/templates/rainbow.jpg', 1)] },
  { id: 'pl-lunch', name: 'Lunch Menu · Week 45', tenantId: TENANT, isActive: true, items: [
    img('it-l1', '/demo/templates/qsr-morning-window.jpg', 0), img('it-l2', '/demo/templates/qsr-coffee.jpg', 1)] },
  { id: 'pl-athletics', name: 'Friday Night Lights', tenantId: TENANT, isActive: true, items: [
    img('it-a1', '/templates/hs/assets/hs-biggame-under-the-lights-v1.jpg', 0), img('it-a2', '/demo/templates/sports-gameday.jpg', 1)] },
];
const SCHEDULES = [
  { id: 'sc-1', tenantId: TENANT, playlistId: 'pl-welcome', playlist: PLAYLISTS[0], screenGroupId: 'g-lobby', isActive: true, priority: 1, startTime: ago(60 * 24 * 7) },
  { id: 'sc-2', tenantId: TENANT, playlistId: 'pl-lunch', playlist: PLAYLISTS[1], screenGroupId: 'g-cafe', isActive: true, priority: 1, startTime: ago(60 * 24 * 7) },
  { id: 'sc-3', tenantId: TENANT, playlistId: 'pl-athletics', playlist: PLAYLISTS[2], screenGroupId: 'g-gym', isActive: true, priority: 1, startTime: ago(60 * 24 * 7) },
  ...['g-library', 'g-office', 'g-hall'].map((g, i) => ({ id: `sc-${4 + i}`, tenantId: TENANT, playlistId: 'pl-welcome', playlist: PLAYLISTS[0], screenGroupId: g, isActive: true, priority: 1, startTime: ago(60 * 24 * 7) })),
];
function screen([id, name, groupId, state]: [string, string, string, State], i: number) {
  const group = GROUPS.find((g) => g.id === groupId) ?? null;
  const base = {
    id, name, tenantId: TENANT, status: 'ONLINE', screenGroupId: group?.id ?? null, screenGroup: group,
    hardwareModel: i % 3 === 0 ? 'Goodview GUQ 55"' : i % 3 === 1 ? 'Samsung QM55C' : 'Android player 4K',
    resolution: i % 4 === 1 ? '2160x3840' : '3840x2160', deviceFingerprint: `fp-${id}`,
    lastPingAt: ago(0.3), renderHealth: 'OK', renderStale: false, lastRenderedAt: ago(0.5),
    lastRenderedHash: 'pl:pl-welcome:7c1e', pushChannel: 'live', authState: 'PROVEN',
    playerVersion: '1.1.62', pairedAt: ago(60 * 24 * 40),
  };
  switch (state) {
    case 'offline': return { ...base, status: 'OFFLINE', lastPingAt: ago(190), lastRenderedAt: ago(192) };
    case 'offline-days': return { ...base, status: 'OFFLINE', lastPingAt: ago(60 * 24 * 3), lastRenderedAt: ago(60 * 24 * 3) };
    case 'paused': return { ...base, lastRenderedHash: 'paused:pl-athletics' };
    case 'updating': return { ...base, pendingRefreshAt: ago(0.4) };
    case 'behind': return { ...base, pendingRefreshAt: ago(130) };
    case 'push': return { ...base, pushChannel: 'stale' };
    case 'pending': return { ...base, status: 'PENDING', lastPingAt: null, lastRenderedAt: null, lastRenderedHash: null };
    case 'idle': return { ...base, lastRenderedHash: 'idle:no-content' };
    default: return base;
  }
}
const SCREENS = SCREEN_SPECS.map(screen);

// ── Templates: the real K-12 ready-made catalog + six of "your" templates ──
function loadPresets(): any[] {
  // Transpile the API's preset modules on the fly (they only `import type`).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ts = require('typescript');
  const key = '.ts';
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Module = require('module');
  const prev = Module._extensions[key];
  Module._extensions[key] = (m: any, f: string) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText, f);
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(path.resolve(__dirname, '../../../api/src/templates/system-presets.ts'));
    return mod.SYSTEM_TEMPLATE_PRESETS as any[];
  } finally {
    Module._extensions[key] = prev;
  }
}
let TEMPLATES: any[] | null = null;
function templates() {
  if (TEMPLATES) return TEMPLATES;
  const K12 = new Set(['LOBBY', 'LOBBY_WELCOME', 'CAFETERIA', 'CAFETERIA_MENU', 'HALLWAY', 'HALLWAY_DISPLAY', 'HOLIDAYS', 'KIOSK', 'EVENTS', 'INFO', 'CLASSROOM', 'ENTRY']);
  const toRow = (p: any, over: Record<string, unknown> = {}) => ({
    ...p,
    tenantId: null,
    isSystem: true,
    zones: (p.zones || []).map((z: any, i: number) => ({ id: `${p.id}-z${i}`, ...z, defaultConfig: typeof z.defaultConfig === 'string' ? z.defaultConfig : JSON.stringify(z.defaultConfig ?? {}) })),
    createdAt: ago(60 * 24 * 90), updatedAt: ago(60 * 24 * 30),
    ...over,
  });
  const presets = loadPresets().filter((p) => K12.has(p.category) && (!p.vertical || /K12/.test(String(p.vertical))));
  const boards = presets.filter((p) => p.zones?.length === 1 && p.zones[0].widgetType === 'EXTERNAL_HTML' && !String(p.id).endsWith('-portrait'));
  const OWN = ['Spirit Week Lobby', 'Homecoming Countdown', 'Lunch Specials · Fall', 'Science Fair Winners', 'Parent Night Welcome', 'Library Book Fair'];
  const own = OWN.map((name, i) => toRow(boards[(i * 7) % boards.length], {
    id: `tpl-own-${i}`, name, tenantId: TENANT, isSystem: false, updatedAt: ago(60 * (i + 2) * 9),
  }));
  TEMPLATES = [...own, ...presets.map((p) => toRow(p))];
  return TEMPLATES;
}

// ── Mock API ─────────────────────────────────────────────────────────────
async function open(page: Page, route: string, size: { width: number; height: number }) {
  await page.route('**/api/v1/**', async (r: Route) => {
    const req = r.request();
    const headers = {
      'Access-Control-Allow-Origin': new URL(page.url() || 'http://localhost').origin,
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Headers': 'authorization,content-type,x-csrf-token,x-requested-with',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    };
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers, body: '' });
    const p = new URL(req.url()).pathname.replace(/^.*\/api\/v1/, '');
    let body: unknown = [];
    if (p === '/auth/me') body = USER;
    else if (p === '/tenants') body = { id: TENANT, name: 'Maple Ridge High School', slug: TENANT, vertical: 'K12' };
    else if (p === '/tenants/accessible') body = { current: TENANT, tenants: [{ id: TENANT, slug: TENANT, name: 'Maple Ridge High School' }] };
    else if (p === '/branding/me') body = { displayName: 'Maple Ridge High School', primaryColor: '#4f46e5' };
    else if (p === '/screens') body = SCREENS;
    else if (p === '/screen-groups') body = GROUPS;
    else if (p === '/schedules') body = SCHEDULES;
    else if (p === '/playlists') body = PLAYLISTS;
    else if (p === '/templates') body = templates();
    else if (p === '/templates/usage-summary') body = {};
    else if (p === '/emergency/readiness/district') body = { schools: [], totals: {} };
    else if (/^\/screens\/[^/]+\/events/.test(p)) body = { screenId: p.split('/')[2], events: [], summary: { total: 0, byKind: {} } };
    else if (p.endsWith('/usage')) body = { playlists: [], total: 0, screensReached: 0, locations: 0 };
    else if (!p.endsWith('s')) body = {};
    return r.fulfill({ status: 200, contentType: 'application/json', headers, body: JSON.stringify(body) });
  });
  await page.route('**/api/build-info', (r) => r.fulfill({ contentType: 'application/json', body: '{}' }));
  await page.addInitScript((user) => {
    localStorage.setItem('edu_cms_eula_accepted_v1.0', '1');
    const b64 = (v: unknown) => btoa(JSON.stringify(v)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
    sessionStorage.setItem('edu_cms_token', `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: user.id, tenantId: user.tenantId, role: user.role, exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`);
    sessionStorage.setItem('edu_cms_user', JSON.stringify(user));
  }, USER);
  await page.setViewportSize(size);
  await page.goto(`/${TENANT}/${route}`, { waitUntil: 'domcontentloaded' });
}

async function shot(page: Page, name: string, browserName: string) {
  if (!SHOTS || browserName !== 'webkit') return;
  fs.mkdirSync(OUT, { recursive: true });
  await page.waitForTimeout(500);
  // Hide the dev-server "N issues" badge (it is not part of the product, and
  // the same one shows on the unchanged pages) and drop keyboard focus rings
  // left by Escape so each shot reads as a person would see it.
  await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' }).catch(() => {});
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  await page.screenshot({ path: path.join(OUT, name) });
}

async function postersLoaded(page: Page) {
  await page.waitForFunction(() => Array.from(document.images)
    .filter((i) => i.getBoundingClientRect().top < window.innerHeight && i.getBoundingClientRect().bottom > 0)
    .every((i) => i.complete), undefined, { timeout: 30_000 }).catch(() => {});
}

const mainTop = (page: Page) => page.evaluate(() => { document.getElementById('main-content')?.scrollTo(0, 0); window.scrollTo(0, 0); });

test.describe.configure({ mode: 'serial' });
test.setTimeout(180_000);

/** Click a Templates category whether it is on the line or under "More". */
async function pickCategory(page: Page, name: RegExp) {
  const tabs = page.getByTestId('templates-category-tabs');
  const tab = tabs.getByRole('tab', { name });
  if (await tab.count()) return tab.click();
  await page.getByTestId('templates-category-tabs-more').click();
  await page.getByTestId('templates-category-tabs-more-menu').getByRole('menuitemradio', { name }).click();
}

// ── Screens ──────────────────────────────────────────────────────────────
test('Screens — tabs + Filter (tab sync), real thumbnails, 3 selected', async ({ page, browserName }) => {
  await open(page, 'screens', DESKTOP);
  const tabs = page.getByTestId('screens-filter-tabs');
  await expect(tabs).toBeVisible({ timeout: 120_000 });
  await expect(tabs.getByRole('tab', { name: /All/ })).toHaveAttribute('aria-selected', 'true');
  // Content thumbnails are real pictures, not blank tiles.
  const thumb = page.locator('td img').first();
  await expect(thumb).toBeVisible();
  await expect.poll(() => thumb.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth)).toBeGreaterThan(0);
  await shot(page, '03-screens-after-desktop.png', browserName);

  // Filter menu lists every status.
  const filterBtn = page.getByTestId('screens-filter-menu');
  await filterBtn.click();
  const panel = page.getByTestId('screens-filter-menu-panel');
  await expect(panel.getByRole('radio', { name: /Content behind/ })).toBeVisible();
  await expect(panel.getByRole('radio', { name: /^Offline/ })).toBeVisible();
  await shot(page, '04-screens-after-desktop-filter-open.png', browserName);

  // A status WITH a tab: the tab underlines, the Filter button adds no count.
  await panel.getByRole('radio', { name: /^Offline/ }).click();
  await expect(tabs.getByRole('tab', { name: /^Offline/ })).toHaveAttribute('aria-selected', 'true');
  await expect(filterBtn).toHaveAccessibleName(/none active/);
  // A status with NO tab: no tab underlined, the Filter button counts it.
  await panel.getByRole('radio', { name: /Content behind/ }).click();
  await expect(page.getByRole('button', { name: 'Lunch Line Menu B', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Lobby Welcome Wall', exact: true })).toHaveCount(0);
  await expect(tabs.getByRole('tab', { selected: true })).toHaveCount(0);
  await expect(filterBtn).toHaveAccessibleName(/1 active/);
  await page.keyboard.press('Escape');
  await tabs.getByRole('tab', { name: /All/ }).click();
  await expect(filterBtn).toHaveAccessibleName(/none active/);
  await expect(page.getByRole('button', { name: 'Lobby Welcome Wall', exact: true })).toBeVisible();

  // Select 3 → the toolbar becomes the selection bar in place.
  for (const name of ['Lobby Welcome Wall', 'Lunch Line Menu A', 'Gym Entrance Display']) {
    await page.getByRole('checkbox', { name: new RegExp(`^Select ${name}`) }).first().evaluate((el: HTMLElement) => el.click());
  }
  const bar = page.locator('[data-testid="screens-bulk-bar"][data-placement="toolbar"]');
  await expect(bar).toContainText('3 screens selected');
  await expect(tabs).toHaveCount(0);
  await expect(bar.getByRole('button', { name: 'Resync' })).toBeVisible();
  await mainTop(page);
  await shot(page, '05-screens-after-desktop-3-selected.png', browserName);
});

test('Screens on iPhone: dock + Filter open', async ({ page, browserName }) => {
  await open(page, 'screens', PHONE);
  await expect(page.getByTestId('screens-filter-tabs')).toBeVisible({ timeout: 120_000 });
  await shot(page, '06-screens-after-iphone.png', browserName);
  await page.getByTestId('screens-filter-menu').click();
  await expect(page.getByTestId('screens-filter-menu-panel')).toBeVisible();
  await shot(page, '07-screens-after-iphone-filter-open.png', browserName);
  await page.keyboard.press('Escape');
  for (const name of ['Lobby Welcome Wall', 'Lobby Events Portrait', 'Visitor Check-in Kiosk']) {
    await page.getByRole('checkbox', { name: new RegExp(`^Select ${name}`) }).first().evaluate((el: HTMLElement) => el.click());
  }
  const dock = page.locator('[data-testid="screens-bulk-bar"][data-placement="dock"]');
  await expect(dock).toContainText('3 screens selected');
  await expect(dock.getByRole('button', { name: 'Resync' })).toBeVisible();
  await mainTop(page);
  await shot(page, '08-screens-after-iphone-3-selected.png', browserName);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

// ── Templates ────────────────────────────────────────────────────────────
test('Templates — one toolbar row with More, Filter, holiday sub-filter, 3 selected', async ({ page, browserName }) => {
  await open(page, 'templates', DESKTOP);
  const tabs = page.getByTestId('templates-category-tabs');
  await expect(tabs).toBeVisible({ timeout: 120_000 });
  await expect(page.getByRole('group', { name: 'Filter by category' })).toHaveCount(0);
  // ONE row: the tabs share a line with search, Filter and Sort.
  const rowOf = (l: ReturnType<Page['locator']>) => l.evaluate((el) => { const r = el.getBoundingClientRect(); return Math.round(r.top + r.height / 2); });
  const tabsMid = await rowOf(tabs);
  for (const l of [page.getByLabel('Search templates'), page.getByTestId('templates-filter-menu'), page.getByTestId('templates-sort')]) {
    expect(Math.abs((await rowOf(l)) - tabsMid)).toBeLessThanOrEqual(6);
  }
  // The tabs that do not fit are under More, and no tab is clipped.
  await expect(page.getByTestId('templates-category-tabs-more')).toBeVisible();
  const clipped = await tabs.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(clipped).toBeLessThanOrEqual(0);
  await postersLoaded(page);
  await shot(page, '11-templates-after-desktop.png', browserName);

  // Filter menu (school level), then Holidays (from More) adds the holiday group.
  await page.getByTestId('templates-filter-menu').click();
  const panel = page.getByTestId('templates-filter-menu-panel');
  await expect(panel.getByRole('radio', { name: 'High School' })).toBeVisible();
  await expect(panel.getByRole('radiogroup', { name: 'Holiday' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await pickCategory(page, /Holidays/);
  // Picked from More, it is now an underlined tab on the line.
  await expect(tabs.getByRole('tab', { name: /Holidays/ })).toHaveAttribute('aria-selected', 'true');
  await page.getByTestId('templates-filter-menu').click();
  await expect(panel.getByRole('radio', { name: 'Halloween' })).toBeVisible();
  await shot(page, '12-templates-after-desktop-filter-open.png', browserName);
  await panel.getByRole('radio', { name: 'Halloween' }).click();
  await expect(page.getByTestId('templates-filter-menu')).toHaveAccessibleName(/1 active/);
  await page.keyboard.press('Escape');
  // Leaving Holidays clears the holiday sub-filter.
  await tabs.getByRole('tab', { name: /^All/ }).click();
  await expect(page.getByTestId('templates-filter-menu')).toHaveAccessibleName(/none active/);

  // Paging reset: "Show more" then a new category starts at page one again.
  const more = page.getByRole('button', { name: /Show \d+ more/ }).last();
  if (await more.count()) {
    const before = await page.locator('section[aria-labelledby="ready-made-heading"] img').count();
    await more.click();
    await expect.poll(() => page.locator('section[aria-labelledby="ready-made-heading"] img').count()).toBeGreaterThan(before);
    await pickCategory(page, /Welcome/);
    await tabs.getByRole('tab', { name: /^All/ }).click();
    await expect.poll(() => page.locator('section[aria-labelledby="ready-made-heading"] img').count()).toBe(before);
  }

  await mainTop(page);
  for (const name of ['Spirit Week Lobby', 'Homecoming Countdown', 'Lunch Specials · Fall']) {
    await page.getByRole('checkbox', { name: `Select ${name}` }).evaluate((el: HTMLElement) => el.click());
  }
  const bar = page.locator('[data-testid="templates-bulk-bar"][data-placement="toolbar"]');
  await expect(bar).toContainText('3 selected');
  await expect(bar.getByRole('button', { name: 'Delete' })).toBeVisible();
  await mainTop(page);
  await postersLoaded(page);
  await shot(page, '13-templates-after-desktop-3-selected.png', browserName);
});

test('Templates on iPhone: Sort fits, Filter open + dock', async ({ page, browserName }) => {
  await open(page, 'templates', PHONE);
  await expect(page.getByTestId('templates-category-tabs')).toBeVisible({ timeout: 120_000 });
  // Sort is an icon whose accessible name carries the whole choice; it sits
  // inside the viewport, beside Filter.
  const sort = page.getByTestId('templates-sort');
  await expect(sort).toHaveAccessibleName(/Recently edited/);
  const box = await sort.boundingBox();
  expect(box && box.x + box.width).toBeLessThanOrEqual(PHONE.width);
  await postersLoaded(page);
  await shot(page, '14-templates-after-iphone.png', browserName);
  await page.getByTestId('templates-filter-menu').click();
  await expect(page.getByTestId('templates-filter-menu-panel')).toBeVisible();
  await shot(page, '15-templates-after-iphone-filter-open.png', browserName);
  await page.keyboard.press('Escape');
  for (const name of ['Spirit Week Lobby', 'Homecoming Countdown', 'Lunch Specials · Fall']) {
    await page.getByRole('checkbox', { name: `Select ${name}` }).evaluate((el: HTMLElement) => el.click());
  }
  const dock = page.locator('[data-testid="templates-bulk-bar"][data-placement="dock"]');
  await expect(dock).toContainText('3 selected');
  await expect(dock.getByRole('button', { name: 'Delete' })).toBeVisible();
  await mainTop(page);
  await postersLoaded(page);
  await shot(page, '16-templates-after-iphone-3-selected.png', browserName);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
