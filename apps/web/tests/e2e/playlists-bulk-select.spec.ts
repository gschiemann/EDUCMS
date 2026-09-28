/**
 * Playlists — check several, remove them together (Greg, 2026-09-28: "the
 * ability to check multiple playlists and delete them all at once would be
 * great").
 *
 * Driven through the real dashboard route in a real browser with every API
 * call mocked — WebKit as well as Chromium, because the operator runs Safari
 * (bug telemetry: Safari 26.5 / 27, a 1325 × 758 window).
 *
 * jsdom cannot answer the two layout questions that matter here:
 *
 *   1. The table already scrolls sideways under ~1440 px, so a checkbox COLUMN
 *      would take 48 px from the Delivery column — the one the operator keeps
 *      saying he cannot read. The checkbox is a chip on each thumbnail and a
 *      box in the Playlist header, and the table gains no column.
 *   2. The confirmation's red button must sit inside its card. It ran off the
 *      edge (clipped mid-word by the card's overflow-hidden) when its label was
 *      "Delete 3 playlists and rules", and the fix that stops that has to hold.
 */
import { test, expect, type Page, type Route } from '@playwright/test';

const SCHOOL_ID = 'e2e-school';
const ORIGIN = process.env.E2E_BASE || 'http://localhost:3000';
const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': ORIGIN,
  'Access-Control-Allow-Credentials': 'true',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'authorization,content-type,x-csrf-token,x-requested-with',
};
const USER = { id: 'u1', email: 'e2e@example.com', role: 'SCHOOL_ADMIN', tenantId: SCHOOL_ID, canTriggerPanic: false };

const NAMES = ['Freese', 'Member Promotions', 'Fall Fundraiser', 'Lobby Welcome', 'Class Schedule', 'Holiday Hours'];
const PLAYLISTS = NAMES.map((name, i) => ({
  id: `p${i + 1}`,
  name,
  items: [{ id: `i${i}`, durationMs: 30_000 + i * 5_000, asset: { originalName: `${name}.jpg`, mimeType: 'image/jpeg' } }],
  updatedAt: new Date(Date.now() - (i + 1) * 3_600_000).toISOString(),
  createdBy: { id: 'u1', email: 'e2e@example.com' },
}));
const SCREENS = [{ id: 's1', name: 'G43', status: 'ONLINE', screenGroupId: null, renderHealth: 'OK', lastRenderedAt: new Date().toISOString() }];
// "Freese" is published: one rule on one screen.
const SCHEDULES = [{ id: 'sc1', playlistId: 'p1', screenId: 's1', screenGroupId: null, isActive: true, startTime: new Date(Date.now() - 86_400_000).toISOString() }];

/** A signed-in operator, and every request the page makes answered here (no real ids or tokens — the repo is public). */
async function openLibrary(page: Page, deleteRequests: Array<{ id: string; confirm: string | null }>) {
  const cors = (route: Route, fn: () => unknown) =>
    route.request().method() === 'OPTIONS' ? route.fulfill({ status: 204, headers: CORS, body: '' }) : fn();
  const json = (route: Route, body: unknown, status = 200) =>
    cors(route, () => route.fulfill({ status, contentType: 'application/json', headers: CORS, body: JSON.stringify(body) }));
  const removed = new Set<string>();

  // Catch-alls FIRST (Playwright matches the last-registered route first). Every
  // route is scoped to /api/v1 — a bare `**/playlists` would also answer the
  // page's own navigation to /<school>/playlists.
  await page.route(/http:\/\/api\.invalid\/.*/, (r) => cors(r, () => r.fulfill({ status: 204, headers: CORS, body: '' })));
  await page.route('**/api/v1/**', (r) => cors(r, () => r.fulfill({ status: 204, headers: CORS, body: '' })));
  await page.route('**/api/v1/auth/me', (r) => json(r, USER));
  await page.route('**/api/v1/tenants', (r) => json(r, [{ id: SCHOOL_ID, name: 'E2E School', slug: SCHOOL_ID, vertical: 'K12' }]));
  await page.route('**/api/v1/tenants/accessible', (r) => json(r, [{ id: SCHOOL_ID, name: 'E2E School', slug: SCHOOL_ID }]));
  await page.route('**/api/v1/branding/me', (r) => json(r, {}));
  await page.route('**/api/v1/screens', (r) => json(r, SCREENS));
  await page.route('**/api/v1/schedules', (r) => json(r, SCHEDULES));
  await page.route('**/api/v1/screen-groups', (r) => json(r, []));
  await page.route('**/api/v1/templates', (r) => json(r, []));
  await page.route('**/api/v1/assets**', (r) => json(r, []));
  await page.route('**/api/v1/playlists', (r) => json(r, PLAYLISTS.filter((p) => !removed.has(p.id))));
  await page.route(/\/api\/v1\/playlists\/p\d+(\?.*)?$/, (r) => {
    if (r.request().method() !== 'DELETE') return json(r, {});
    const url = new URL(r.request().url());
    const id = url.pathname.split('/').pop()!;
    deleteRequests.push({ id, confirm: url.searchParams.get('confirm') });
    removed.add(id);
    return json(r, { deleted: true });
  });

  await page.addInitScript((user) => {
    try { localStorage.setItem('edu_cms_eula_accepted_v1.0', '1'); } catch { /* ignore */ }
    try {
      // The dashboard reads its session from sessionStorage (ui-store.ts): a JWT-shaped token that has not expired.
      const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
      const token = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: user.id, tenantId: user.tenantId, role: user.role, exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
      sessionStorage.setItem('edu_cms_token', token);
      sessionStorage.setItem('edu_cms_user', JSON.stringify(user));
    } catch { /* ignore */ }
  }, USER);

  await page.setViewportSize({ width: 1325, height: 758 }); // the operator's own Safari window
  await page.goto(`/${SCHOOL_ID}/playlists`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('playlist-row').first().waitFor({ state: 'visible', timeout: 90_000 });
}

test.describe('playlists library — bulk select and remove', () => {
  test('the table gains no column for the checkboxes (Delivery keeps its width)', async ({ page }) => {
    test.setTimeout(120_000);
    await openLibrary(page, []);
    const headers = await page.locator('[data-testid="playlist-table"] thead th').allTextContents();
    // Playlist · Status · Publishing · Schedule · Delivery · Updated · (Actions, screen-reader only).
    expect(headers.map((h) => h.trim())).toEqual(['Playlist', 'Status', 'Publishing', 'Schedule', 'Delivery', 'Updated', 'Actions']);
    // The header checkbox lives INSIDE the Playlist header, and every row's checkbox inside its Playlist cell.
    await expect(page.locator('[data-testid="playlist-table"] thead th').first().getByTestId('select-page')).toHaveCount(1);
    const firstRow = page.getByTestId('playlist-row').first();
    await expect(firstRow.locator('td').first().getByRole('checkbox')).toHaveCount(1);
  });

  test('check three, remove them: one confirmation that fits its card, one delete each in list order, selection cleared', async ({ page }) => {
    test.setTimeout(120_000);
    const deletes: Array<{ id: string; confirm: string | null }> = [];
    await openLibrary(page, deletes);

    const rows = page.getByTestId('playlist-row');
    const box = (name: string) => rows.filter({ hasText: name }).first().getByRole('checkbox', { name: `Select ${name}` });
    // Checked out of list order on purpose: the removals still run in list order.
    await box('Class Schedule').check();
    await box('Freese').check();
    await box('Fall Fundraiser').check();
    await expect(page.getByTestId('bulk-count')).toHaveText('3 selected');

    await page.getByTestId('bulk-remove').click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor({ state: 'visible', timeout: 10_000 });
    await expect(dialog.getByRole('heading', { name: 'Remove 3 playlists?' })).toBeVisible();
    await expect(dialog).toContainText('1 of them is published (1 rule · 1 screen)');
    await page.waitForTimeout(400); // the enter animation

    // Every button sits inside the card (the label once ran off its right edge).
    const clipped = await page.evaluate(() => {
      const card = document.querySelector('[role="dialog"] > div.relative') as HTMLElement;
      const c = card.getBoundingClientRect();
      return Array.from(card.querySelectorAll('button'))
        .map((b) => ({ t: (b.textContent || b.getAttribute('aria-label') || '').trim(), r: b.getBoundingClientRect().right }))
        .filter((b) => b.r > c.right + 0.5)
        .map((b) => b.t);
    });
    expect(clipped).toEqual([]);

    await dialog.getByRole('button', { name: 'Delete 3 playlists' }).click();
    await expect.poll(() => deletes.length, { timeout: 10_000 }).toBe(3);
    expect(deletes.map((d) => d.id)).toEqual(['p1', 'p3', 'p5']); // Freese, Fall Fundraiser, Class Schedule — list order
    // Only the published one is sent with the server's in-use confirmation.
    expect(deletes.map((d) => [d.id, d.confirm])).toEqual([['p1', 'in-use'], ['p3', null], ['p5', null]]);

    await expect(page.getByTestId('bulk-bar')).toHaveCount(0);
    await expect(rows).toHaveCount(3);
    for (const gone of ['Freese', 'Fall Fundraiser', 'Class Schedule']) {
      await expect(rows.filter({ hasText: gone })).toHaveCount(0);
    }
  });

  test('cancelling the confirmation removes nothing and keeps the selection', async ({ page }) => {
    test.setTimeout(120_000);
    const deletes: Array<{ id: string; confirm: string | null }> = [];
    await openLibrary(page, deletes);
    const rows = page.getByTestId('playlist-row');
    await rows.filter({ hasText: 'Lobby Welcome' }).first().getByRole('checkbox', { name: 'Select Lobby Welcome' }).check();
    await rows.filter({ hasText: 'Holiday Hours' }).first().getByRole('checkbox', { name: 'Select Holiday Hours' }).check();
    await page.getByTestId('bulk-remove').click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor({ state: 'visible', timeout: 10_000 });
    await dialog.getByRole('button', { name: 'Cancel' }).last().click();
    await dialog.waitFor({ state: 'detached', timeout: 10_000 });
    expect(deletes).toEqual([]);
    await expect(page.getByTestId('bulk-count')).toHaveText('2 selected');
    await expect(rows).toHaveCount(6);
  });
});
