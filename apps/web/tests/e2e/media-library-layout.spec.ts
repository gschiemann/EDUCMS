/**
 * Media Library layout (2026-11-02 redesign, owner-approved): one primary
 * action, quiet secondaries, filters as tabs, the selection bar in place on
 * desktop and at the bottom on a phone — with Delete always visible.
 *
 * Runs against a fully mocked API. With `MEDIA_MOCKUP_SHOTS=1` it writes the
 * screenshots into docs/research/2026-11-02-media-redesign/ (05–11; 01–04
 * are the pre-redesign page, kept for comparison).
 *
 *   MEDIA_MOCKUP_SHOTS=1 E2E_PORT=3123 pnpm --filter web exec playwright test \
 *     tests/e2e/media-library-layout.spec.ts --project=webkit
 */
import { test, expect, type Page, type Route } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';

const TENANT = 'e2e-school';
const USER = { id: 'user', tenantId: TENANT, role: 'SCHOOL_ADMIN', email: 'test@example.test' };
const PORT = process.env.E2E_PORT || '3000';
const CORS = { 'Access-Control-Allow-Origin': `http://localhost:${PORT}`, 'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Headers': 'authorization,content-type,x-csrf-token,x-requested-with', 'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS' };
const SHOTS = process.env.MEDIA_MOCKUP_SHOTS === '1';
const OUT = process.env.MEDIA_SHOTS_DIR || path.resolve(__dirname, '../../../../docs/research/2026-11-02-media-redesign');

const PALETTES = [
  ['#0f766e', '#99f6e4'], ['#1e3a8a', '#93c5fd'], ['#9a3412', '#fdba74'], ['#581c87', '#d8b4fe'],
  ['#14532d', '#86efac'], ['#7f1d1d', '#fca5a5'], ['#1f2937', '#e5e7eb'], ['#854d0e', '#fde68a'],
  ['#155e75', '#a5f3fc'], ['#701a75', '#f5d0fe'],
];
function svg(i: number) {
  const [a, b] = PALETTES[i % PALETTES.length];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>
<rect width="1600" height="900" fill="url(#g)"/>
<circle cx="${300 + (i * 137) % 1000}" cy="${250 + (i * 71) % 400}" r="${160 + (i * 23) % 120}" fill="#fff" fill-opacity=".18"/>
<rect x="120" y="620" width="${700 + (i * 41) % 500}" height="70" rx="12" fill="#fff" fill-opacity=".85"/>
<rect x="120" y="710" width="${420 + (i * 29) % 300}" height="36" rx="10" fill="#fff" fill-opacity=".55"/>
</svg>`;
}

const NAMES = [
  'Fall open house banner.png', 'Lobby welcome photo.jpg', 'Spirit week poster.png', 'Cafeteria menu week 44.png',
  'Science fair winners.jpg', 'Holiday concert flyer.png', 'Parking lot map.png', 'Book fair promo.png',
  'Football homecoming.jpg', 'Art show gallery.jpg', 'Bus schedule.png', 'Library hours.png',
];
const ASSETS = [
  ...NAMES.map((n, i) => ({ id: `img-${i}`, tenantId: TENANT, originalName: n, mimeType: 'image/png', fileSize: 380_000 + i * 91_000, fileUrl: `https://files.example.test/img-${i}.png`, createdAt: `2026-10-${String(28 - i).padStart(2, '0')}T10:00:00Z`, folderId: null, status: 'PUBLISHED', metadata: { width: 1920, height: 1080 } })),
  { id: 'pdf-0', tenantId: TENANT, originalName: 'Board meeting agenda.pdf', mimeType: 'application/pdf', fileSize: 220_000, fileUrl: 'https://files.example.test/agenda.pdf', createdAt: '2026-10-12T10:00:00Z', folderId: null, status: 'PUBLISHED' },
  { id: 'aud-0', tenantId: TENANT, originalName: 'Morning bell chime.mp3', mimeType: 'audio/mpeg', fileSize: 120_000, fileUrl: 'https://files.example.test/bell.mp3', createdAt: '2026-10-11T10:00:00Z', folderId: null, status: 'PUBLISHED' },
];
const FOLDERS = [
  { id: 'f1', name: 'Announcements', parentId: null, updatedAt: '2026-10-27T10:00:00Z', _count: { assets: 18, children: 0 } },
  { id: 'f2', name: 'Athletics', parentId: null, updatedAt: '2026-10-24T10:00:00Z', _count: { assets: 9, children: 2 } },
  { id: 'f3', name: 'Menus', parentId: null, updatedAt: '2026-10-20T10:00:00Z', _count: { assets: 6, children: 0 } },
];

const MANY = [
  ...ASSETS,
  ...Array.from({ length: 36 }, (_, i) => ({ ...ASSETS[i % 12], id: `more-${i}`, originalName: `Extra asset ${i}.png`, fileUrl: `https://files.example.test/img-${i % 12}.png` })),
];

async function open(page: Page, opts: { mobile: boolean; many?: boolean; size?: { width: number; height: number } }) {
  const list = opts.many ? MANY : ASSETS;
  await page.addInitScript(user => {
    sessionStorage.setItem('edu_cms_token', 'e2e-token'); sessionStorage.setItem('edu_cms_user', JSON.stringify(user)); localStorage.setItem('edu_cms_eula_accepted_v1.0', '1');
  }, USER);
  const json = (route: Route, body: unknown) => route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('https://files.example.test/**', route => {
    const m = /img-(\d+)/.exec(route.request().url());
    if (m) return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: svg(Number(m[1])) });
    return route.fulfill({ status: 404, body: '' });
  });
  await page.route('**/api/v1/**', async route => {
    const request = route.request(), url = new URL(request.url()), p = url.pathname.replace(/^.*\/api\/v1/, '');
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    if (p === '/auth/me') return json(route, USER);
    if (p === '/assets/storage-summary') return json(route, { totalBytes: 9_800_000, totalFiles: ASSETS.length, images: { bytes: 9_000_000, files: 12 }, videos: { bytes: 0, files: 0 }, other: { bytes: 800_000, files: 2 } });
    if (p === '/assets/storage') return json(route, { usedBytes: 2_400_000_000, includedBytes: 50_000_000_000, screens: 10, percent: 5, warn: false });
    if (p === '/tenants' || p === '/tenants/accessible') return json(route, [{ id: TENANT, slug: TENANT, name: 'Demo School' }]);
    if (p === '/asset-folders' || p === '/assets/folders') return json(route, FOLDERS);
    if (p === '/assets') return json(route, { assets: list, total: list.length });
    return json(route, p.endsWith('s') ? [] : {});
  });
  await page.setViewportSize(opts.size ?? (opts.mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 }));
  await page.goto(`/${TENANT}/assets`);
  await expect(page.getByRole('checkbox', { name: `Select ${NAMES[0]}` })).toBeAttached();
  // Let the on-screen thumbnails paint (lazy ones below the fold never load).
  await page.waitForFunction(() => Array.from(document.images)
    .filter(i => i.src.includes('files.example.test') && i.getBoundingClientRect().top < window.innerHeight)
    .every(i => i.complete));
}

async function selectThree(page: Page) {
  for (const n of NAMES.slice(0, 3)) {
    const box = page.getByRole('checkbox', { name: `Select ${n}` });
    // A real tap would scroll the tile above the bottom bar first; click the
    // control directly so the fixed bar can never intercept the pointer.
    await box.evaluate((el: HTMLElement) => el.click());
    await expect(box).toBeChecked();
  }
  await page.evaluate(() => document.getElementById('main-content')?.scrollTo(0, 0));
}

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  fs.mkdirSync(OUT, { recursive: true });
  await page.waitForTimeout(350); // slide-in / fade-in animations settle
  await page.screenshot({ path: path.join(OUT, name) });
}

test.describe('Media Library layout (2026-11-02 redesign)', () => {
  test('desktop: one primary, tabs; the toolbar row becomes the selection bar in place, Delete visible', async ({ page }) => {
    await open(page, { mobile: false });
    await expect(page.getByTestId('upload-strip')).toHaveCount(0);
    await expect(page.getByTestId('upload-hint')).toBeVisible();
    await expect(page.getByRole('tab', { name: /All/ })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByLabel('Search the media library')).toHaveCount(1);
    const toolbar = page.getByTestId('library-toolbar');
    const before = await toolbar.boundingBox();
    await shot(page, '05-v2-desktop.png');

    await selectThree(page);
    const bar = page.locator('[data-testid="asset-bulk-bar"][data-placement="toolbar"]');
    await expect(bar).toContainText('3 selected');
    await expect(page.getByTestId('media-type-tabs')).toHaveCount(0);
    for (const name of ['Create playlist', 'Move to folder', 'Download ZIP', 'Delete']) {
      await expect(bar.getByRole('button', { name, exact: true })).toBeVisible();
    }
    await expect(bar.getByTestId('selection-more')).toHaveCount(0);
    const after = await toolbar.boundingBox();
    expect(Math.round(after!.height)).toBe(Math.round(before!.height)); // the page does not grow
    await shot(page, '06-v2-desktop-3-selected.png');

    // Delete still goes through the existing confirm.
    await bar.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await shot(page, '07-v2-desktop-delete-confirm.png');
    await page.getByRole('dialog').getByText('Cancel', { exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await page.getByRole('button', { name: 'Clear selection' }).click();
    await expect(page.getByTestId('media-type-tabs')).toBeVisible();
  });

  test('desktop: the drop overlay appears only while dragging', async ({ page }) => {
    await open(page, { mobile: false });
    await expect(page.getByTestId('drop-overlay')).toHaveCount(0);
    await page.evaluate(() => {
      const dt = new DataTransfer();
      dt.items.add(new File(['x'], 'photo.png', { type: 'image/png' }));
      document.querySelector('[data-testid="library-toolbar"]')!.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt }));
    });
    await expect(page.getByTestId('drop-overlay')).toBeVisible();
    await shot(page, '08-v2-desktop-dragging.png');
  });

  test('iPhone: bottom selection bar with Delete visible; Move/Download under ⋯', async ({ page }) => {
    await open(page, { mobile: true });
    await expect(page.getByLabel('Search the media library')).toHaveCount(1);
    await shot(page, '09-v2-iphone.png');
    await selectThree(page);
    const dock = page.locator('[data-testid="asset-bulk-bar"][data-placement="dock"]');
    await expect(dock).toContainText('3 selected');
    await expect(dock.getByRole('button', { name: 'Create playlist' })).toBeVisible();
    await expect(dock.getByRole('button', { name: 'Delete', exact: true })).toBeVisible();
    // Flush on top of the tab bar — no strip of page content between them.
    await expect.poll(() => page.evaluate(() => {
      const d = document.querySelector('[data-testid="asset-bulk-bar"][data-placement="dock"]')!.getBoundingClientRect();
      const tops = Array.from(document.querySelectorAll('nav[aria-label="Primary"]')).map(n => n.getBoundingClientRect()).filter(r => r.height > 0).map(r => r.top);
      return Math.abs(d.bottom - Math.min(...tops));
    })).toBeLessThan(2);
    // Filters stay at phone width; the selection lives in the thumb-reachable bar.
    await expect(page.getByTestId('media-type-tabs')).toBeVisible();
    await shot(page, '10-v2-iphone-3-selected.png');
    await dock.getByTestId('selection-more').click();
    const menu = page.getByTestId('selection-more-menu');
    for (const item of ['Move to folder', 'Download ZIP']) await expect(menu.getByRole('menuitem', { name: item })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Delete' })).toHaveCount(0);
    await shot(page, '11-v2-iphone-more-menu.png');
  });

  test('desktop 1325x758: the toolbar sticks while scrolled, Create playlist stays in view', async ({ page }) => {
    await open(page, { mobile: false, many: true, size: { width: 1325, height: 758 } });
    const main = page.locator('#main-content');
    await main.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await expect.poll(() => main.evaluate((el) => el.scrollTop)).toBeGreaterThan(400);
    const box = page.getByRole('checkbox', { name: 'Select Extra asset 20.png' });
    await box.evaluate((el: HTMLElement) => el.click());
    await expect(box).toBeChecked();
    const bar = page.locator('[data-testid="asset-bulk-bar"][data-placement="toolbar"]');
    const create = bar.getByRole('button', { name: 'Create playlist', exact: true });
    await expect(create).toBeVisible();
    await expect(create).toBeInViewport({ ratio: 1 });
    const sticky = page.getByTestId('library-toolbar-sticky');
    await expect(sticky).toHaveAttribute('data-stuck', 'true');
    const top = await sticky.evaluate((el) => el.getBoundingClientRect().top - document.getElementById('main-content')!.getBoundingClientRect().top);
    expect(Math.abs(top - 32)).toBeLessThan(2); // main's md:p-8 gutter; the stuck bar covers it
    await shot(page, '12-sticky-desktop-scrolled-selected.png');
    await main.evaluate((el) => el.scrollTo(0, 0));
    await expect(sticky).not.toHaveAttribute('data-stuck', 'true');
  });
});
