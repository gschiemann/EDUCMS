/**
 * Bulk template delete (owner, 2026-11-23): "it should delete all not in use
 * then pop up for each one in use and ask me if I want to delete anyways".
 *
 * 30 of your templates (more than the 12-card first page), 8 used by
 * playlists, 1 used by an emergency playlist. The owner's own steps — the
 * select-all box over the tiles, then Delete — reach all 30 in one click; one
 * dialog lists the 8 (pre-checked) and the emergency one (kept, no checkbox);
 * one click deletes 29 — force only on the 8 — and the toast says exactly that.
 * Real dashboard, mocked API.
 *
 * Running it locally: the repo's pinned Playwright may look for a headless
 * shell build the box does not have; point launchOptions.executablePath at
 * the installed Chromium (docs/handoffs/2026-11-13-session-handoff.md). That
 * launch error is not a test failure.
 */
import { test, expect, type Page, type Route } from '@playwright/test';

const SCHOOL_ID = 'e2e-school';
const ORIGIN = process.env.E2E_BASE || process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000';
const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': ORIGIN,
  'Access-Control-Allow-Credentials': 'true',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'authorization,content-type,x-csrf-token,x-requested-with',
};
const USER = { id: 'u1', email: 'e2e@example.com', role: 'SCHOOL_ADMIN', tenantId: SCHOOL_ID, canTriggerPanic: false };

// The box over the tiles names the whole count, not the 12 shown.
const SELECT_ALL = 'Select all 30 of your templates';
const pad = (n: number) => String(n).padStart(2, '0');
const IN_USE = new Set([3, 6, 9, 11, 14, 17, 20, 23].map((n) => `tpl-${pad(n)}`));
const EMERGENCY = 'tpl-27';
const TEMPLATES = Array.from({ length: 30 }, (_, i) => {
  const id = `tpl-${pad(i + 1)}`;
  return {
    id,
    name: `Board ${pad(i + 1)}`,
    tenantId: SCHOOL_ID,
    isSystem: false,
    category: 'CUSTOM',
    screenWidth: 1920,
    screenHeight: 1080,
    bgColor: '#ffffff',
    zones: [],
    scenes: [],
    // Newest first under the default "Recently edited" sort: Board 01 … Board 30.
    updatedAt: new Date(Date.UTC(2026, 10, 20, 12, 0, 0) - i * 60_000).toISOString(),
    createdAt: '2026-11-01T00:00:00.000Z',
    _count: { zones: 0, playlists: IN_USE.has(id) ? 2 : id === EMERGENCY ? 1 : 0 },
  };
});

type Scenario = {
  /** A template the list shows as free that answers TEMPLATE_IN_USE to a plain delete. */
  becameInUse?: string;
  /** A template whose delete fails with a server error. */
  failing?: string;
  /** An in-use template whose playlist turned emergency after the usage read: its forced delete meets the server guard. */
  turnedEmergency?: string;
};

async function open(page: Page, scenario: Scenario = {}, viewport = { width: 1325, height: 800 }) {
  const calls = { deletes: [] as string[], usage: [] as string[], peak: 0 };
  const removed = new Set<string>();
  let inFlight = 0;
  const json = (route: Route, body: unknown, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', headers: CORS, body: JSON.stringify(body) });

  await page.route(/http:\/\/api\.invalid\/.*/, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
    const url = new URL(req.url());
    const path = url.pathname.replace(/^.*\/api\/v1/, '');
    if (path === '/auth/me') return json(route, USER);
    if (path === '/tenants') return json(route, [{ id: SCHOOL_ID, name: 'E2E School', slug: SCHOOL_ID, vertical: 'K12' }]);
    if (path === '/tenants/accessible') return json(route, [{ id: SCHOOL_ID, name: 'E2E School', slug: SCHOOL_ID }]);
    if (path === '/branding/me') return json(route, {});
    if (['/screens', '/playlists', '/schedules'].includes(path) || path.startsWith('/assets')) return json(route, []);
    if (path === '/templates') return json(route, TEMPLATES.filter((t) => !removed.has(t.id)));
    if (path === '/templates/usage-summary') return json(route, {});
    const usage = path.match(/^\/templates\/([^/]+)\/usage$/);
    if (usage) {
      const id = usage[1];
      calls.usage.push(id);
      const used = IN_USE.has(id) || id === EMERGENCY || id === scenario.becameInUse;
      return json(route, {
        playlists: used ? [{ id: `pl-${id}`, name: `Loop for ${id}` }] : [],
        total: used ? (IN_USE.has(id) ? 2 : 1) : 0,
        screensReached: used ? 3 : 0,
        locations: used ? 1 : 0,
        protectedEmergency: id === EMERGENCY,
      });
    }
    const one = path.match(/^\/templates\/([^/]+)$/);
    if (one && req.method() === 'DELETE') {
      const id = one[1];
      const force = url.searchParams.get('force') === 'true';
      calls.deletes.push(force ? `${id} force` : id);
      inFlight += 1;
      calls.peak = Math.max(calls.peak, inFlight);
      await new Promise((r) => setTimeout(r, 40));
      inFlight -= 1;
      if (id === scenario.failing) return json(route, { message: 'Database busy' }, 500);
      const used = IN_USE.has(id) || id === EMERGENCY || id === scenario.becameInUse;
      if (used && !force) {
        return json(route, { code: 'TEMPLATE_IN_USE', message: 'This layout is assigned to a playlist.', playlists: [], total: 1, usage: { playlists: [], screensReached: 3, locations: 1 } }, 409);
      }
      if (id === EMERGENCY || id === scenario.turnedEmergency) {
        return json(route, { code: 'TEMPLATE_EMERGENCY_IN_USE', message: 'This layout is used by an emergency playlist.' }, 409);
      }
      removed.add(id);
      return json(route, { deleted: true });
    }
    return route.fulfill({ status: 204, headers: CORS, body: '' });
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
  await page.goto(`/${SCHOOL_ID}/templates`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('checkbox', { name: SELECT_ALL }).waitFor({ state: 'visible', timeout: 90_000 });
  return { calls, removed };
}

async function selectAllAndDelete(page: Page) {
  // The owner's steps: the select-all box, then Delete. One click reaches all 30.
  await page.getByRole('checkbox', { name: SELECT_ALL }).check();
  const bar = page.getByTestId('templates-bulk-bar');
  await expect(bar).toContainText('30 selected');
  await expect(bar.getByRole('button', { name: 'Select all 30' })).toHaveCount(0);
  await bar.getByRole('button', { name: 'Delete', exact: true }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('Delete 30 templates?');
  return dialog;
}

test.describe('bulk deleting your templates', () => {
  test('select all reaches all 30; one dialog; deletes 29 with force only on the 8 in use; the emergency one stays', async ({ page }, info) => {
    test.setTimeout(150_000);
    const { calls } = await open(page);
    const dialog = await selectAllAndDelete(page);

    const confirm = dialog.getByRole('button', { name: 'Delete 29 templates' });
    await expect(confirm).toBeEnabled();
    await expect(confirm).toBeFocused();
    const rows = dialog.getByTestId('templates-bulk-delete-rows').getByRole('listitem');
    await expect(rows).toHaveCount(9);
    // What will NOT be deleted is listed first, above the scroll fold.
    await expect(rows.first()).toContainText('Board 27');
    await expect(rows.first()).toContainText('Kept: used by an emergency playlist');
    const boxes = dialog.getByRole('checkbox');
    await expect(boxes).toHaveCount(8);
    for (let i = 0; i < 8; i += 1) await expect(boxes.nth(i)).toBeChecked();
    await expect(dialog.getByRole('checkbox', { name: /Board 03/ })).toHaveAccessibleName(/2 playlists · 3 screens/);
    await expect(dialog.getByTestId(`templates-bulk-delete-row-${EMERGENCY}`)).toContainText('Kept: used by an emergency playlist');
    await expect(dialog).toContainText('fall back to their next layout');
    // Fresh usage was read for exactly the 9 the list reported in use — never the 21 free ones.
    expect([...calls.usage].sort()).toEqual([...IN_USE, EMERGENCY].sort());
    expect(calls.deletes).toEqual([]);
    await page.screenshot({ path: info.outputPath('bulk-delete-dialog.png'), fullPage: false });

    await confirm.click();
    await expect(page.getByText('29 templates deleted · 1 kept (emergency playlist)')).toBeVisible({ timeout: 20_000 });
    await expect(dialog).toHaveCount(0);

    expect(calls.deletes).toHaveLength(29);
    expect(calls.deletes.filter((d) => d.endsWith(' force')).map((d) => d.replace(' force', '')).sort()).toEqual([...IN_USE].sort());
    expect(calls.deletes.some((d) => d.startsWith(EMERGENCY))).toBe(false);
    expect(calls.peak).toBeLessThanOrEqual(3);
    // The emergency-protected one is still in the gallery; nothing else is.
    await expect(page.getByRole('button', { name: /more actions for board 27/i }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /more actions for board 01/i })).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('bulk-delete-done.png'), fullPage: false });
  });

  test('untick keeps one; a template that came into use mid-run is asked about again; one that turned emergency is kept; a real failure says so and stays selected', async ({ page }) => {
    test.setTimeout(150_000);
    const { calls } = await open(page, { becameInUse: 'tpl-02', failing: 'tpl-04', turnedEmergency: 'tpl-06' });
    const dialog = await selectAllAndDelete(page);
    await dialog.getByRole('checkbox', { name: /Board 03/ }).uncheck();
    await dialog.getByRole('button', { name: 'Delete 28 templates' }).click();

    // Board 02 was free in the list but answered TEMPLATE_IN_USE: never forced silently.
    await expect(dialog).toContainText('1 template just came into use', { timeout: 20_000 });
    await expect(dialog.getByRole('checkbox', { name: /Board 02/ })).toBeChecked();
    expect(calls.deletes).toContain('tpl-02');
    expect(calls.deletes).not.toContain('tpl-02 force');
    await dialog.getByRole('button', { name: 'Delete 1 template' }).click();

    // Board 06's forced delete met the server's emergency guard: kept (emergency), tried once.
    await expect(page.getByText("26 templates deleted · 2 kept (emergency playlist) · 1 kept · 1 couldn't be deleted: Database busy")).toBeVisible({ timeout: 20_000 });
    expect(calls.deletes).toContain('tpl-02 force');
    expect(calls.deletes.filter((d) => d.startsWith('tpl-06'))).toEqual(['tpl-06 force']);
    expect(calls.deletes.some((d) => d.startsWith('tpl-03'))).toBe(false);
    // Only the failed one stays selected, ready to retry.
    await expect(page.getByTestId('templates-bulk-bar')).toContainText('1 selected');
    for (const n of ['03', '04', '06', '27']) {
      await expect(page.getByRole('button', { name: new RegExp(`more actions for board ${n}`, 'i') }).first()).toBeVisible();
    }
  });

  test('phone width: the dialog fits 390px, focus is on Delete, and Escape cancels without deleting', async ({ page }, info) => {
    test.setTimeout(150_000);
    const { calls } = await open(page, {}, { width: 390, height: 844 });
    const selectAll = page.getByRole('checkbox', { name: SELECT_ALL });
    await selectAll.check();
    const dock = page.getByTestId('templates-bulk-bar');
    await expect(dock).toContainText('30 selected');
    await dock.getByRole('button', { name: 'Delete', exact: true }).click();
    const dialog = page.getByRole('alertdialog');
    const confirm = dialog.getByRole('button', { name: 'Delete 29 templates' });
    await expect(confirm).toBeFocused();
    await expect(confirm).toBeInViewport();
    const box = await dialog.boundingBox();
    expect(box && box.x >= 0 && box.x + box.width <= 390).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.screenshot({ path: info.outputPath('bulk-delete-dialog-390.png'), fullPage: false });
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    expect(calls.deletes).toEqual([]);
    await expect(dock).toContainText('30 selected');
    // The same box clears all 30, including the ones past "View all".
    await selectAll.uncheck();
    await expect(dock).toHaveCount(0);
  });
});

/**
 * The owner, later: "I can't check multiple templates to delete all at once,
 * all I have is a select all but not individual selection... add that just
 * how we have the assets so I can pick multiple templates and delete".
 */
test.describe('picking several templates by their own boxes', () => {
  test('hovering a tile reveals its box; pick 3 by their own boxes; exactly those 3 are deleted', async ({ page }, info) => {
    test.setTimeout(150_000);
    const { calls } = await open(page);
    const chip = page.getByTestId('templates-select-tpl-05-chip');
    // Out of the way until the pointer is on the tile (a device that can hover)...
    await expect(chip).toHaveCSS('opacity', '0');
    await page.getByRole('button', { name: 'Preview of Board 05 template' }).hover();
    // ...and there as soon as it is, exactly as on an Assets tile.
    await expect(chip).toHaveCSS('opacity', '1');

    for (const n of ['05', '02', '08']) {
      await page.getByRole('checkbox', { name: `Select Board ${n}`, exact: true }).check();
    }
    const bar = page.getByTestId('templates-bulk-bar');
    await expect(bar).toContainText('3 selected');
    // A selected tile wears the shared selected ring.
    await expect(page.locator('[data-selected] > .ring-2.border-indigo-500')).toHaveCount(3);
    // Once anything is selected every tile shows its box, so the next pick is one click.
    await expect(page.getByTestId('templates-select-tpl-11-chip')).toHaveCSS('opacity', '1');
    await page.screenshot({ path: info.outputPath('multi-select-3.png'), fullPage: false });

    await bar.getByRole('button', { name: 'Delete', exact: true }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toContainText('Delete 3 templates?');
    await dialog.getByRole('button', { name: 'Delete 3 templates' }).click();
    await expect(page.getByText('3 templates deleted')).toBeVisible({ timeout: 20_000 });
    expect([...calls.deletes].sort()).toEqual(['tpl-02', 'tpl-05', 'tpl-08']);
    for (const n of ['02', '05', '08']) {
      await expect(page.getByRole('button', { name: new RegExp(`more actions for board ${n}`, 'i') })).toHaveCount(0);
    }
    await expect(page.getByRole('button', { name: /more actions for board 01/i }).first()).toBeVisible();
    await expect(bar).toHaveCount(0);
  });

  test('list view: pick 2 rows (one by keyboard); a grid/list toggle keeps them; exactly those 2 are deleted', async ({ page }, info) => {
    test.setTimeout(150_000);
    const { calls } = await open(page);
    await page.getByRole('radio', { name: 'List view' }).click();
    const rowBox = (n: string) => page.getByRole('checkbox', { name: `Select Board ${n}`, exact: true });
    await rowBox('04').check();
    // A real control: Tab reaches it, Space ticks it (keyboard and remote).
    await rowBox('10').focus();
    await page.keyboard.press('Space');
    await expect(rowBox('10')).toBeChecked();
    const bar = page.getByTestId('templates-bulk-bar');
    await expect(bar).toContainText('2 selected');
    await page.screenshot({ path: info.outputPath('multi-select-list-2.png'), fullPage: false });

    // The view switch stays in the selection row; switching keeps the selection.
    await page.getByRole('radio', { name: 'Grid view' }).click();
    // (The card's own menu exists only on a grid tile.)
    await expect(page.getByRole('button', { name: /more actions for board 04/i }).first()).toBeVisible();
    await expect(rowBox('04')).toBeChecked();
    await expect(rowBox('10')).toBeChecked();
    await expect(rowBox('05')).not.toBeChecked();
    await expect(bar).toContainText('2 selected');
    await page.getByRole('radio', { name: 'List view' }).click();
    await expect(rowBox('04')).toBeChecked();
    await expect(rowBox('10')).toBeChecked();
    await expect(bar).toContainText('2 selected');

    await bar.getByRole('button', { name: 'Delete', exact: true }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toContainText('Delete 2 templates?');
    await dialog.getByRole('button', { name: 'Delete 2 templates' }).click();
    await expect(page.getByText('2 templates deleted')).toBeVisible({ timeout: 20_000 });
    expect([...calls.deletes].sort()).toEqual(['tpl-04', 'tpl-10']);
    await expect(rowBox('04')).toHaveCount(0);
    await expect(rowBox('10')).toHaveCount(0);
    await expect(rowBox('01')).toBeVisible();
  });
});
