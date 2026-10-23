/**
 * USB made simple (2026-10-22, Greg: "wherever you choose where a playlist
 * goes … add USB drive … open any existing playlist and Download to USB …
 * get rid of all those crazy settings").
 *
 * The real dashboard, in a real browser, every API call mocked (no real ids or
 * tokens — the repo is public):
 *   1. creating a playlist with "USB drive" on downloads the package (.zip);
 *   2. "Export to USB" on an existing playlist downloads it (Safari / no
 *      folder picker) or writes it straight into the picked folder (Chrome);
 *   3. the old USB settings URL lands on Playlists.
 * Nothing on any path asks for a key, a PIN or a setting.
 */
import { test, expect, type Page, type Route } from '@playwright/test';
import JSZip from 'jszip';

const SCHOOL_ID = 'usb-school';
const USER = { id: 'usb-operator', email: 'operator@example.test', role: 'SCHOOL_ADMIN', tenantId: SCHOOL_ID };
const asset = { id: 'usb-asset', originalName: 'Welcome.png', mimeType: 'image/png', fileUrl: '/usb-welcome.png', folderId: null };
const PLAYLISTS = [{
  id: 'pl-lobby', name: 'Lobby Welcome',
  items: [{ id: 'i1', durationMs: 10_000, asset: { originalName: 'Welcome.png', mimeType: 'image/png' } }],
  updatedAt: new Date().toISOString(), createdBy: { id: USER.id, email: USER.email },
}];
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWZkAAAAASUVORK5CYII=', 'base64');

async function packageZip(): Promise<Buffer> {
  const zip = new JSZip();
  const root = zip.folder('edu-cms-content')!;
  root.file('manifest.json', JSON.stringify({ schema: 'edu-cms-usb-bundle/v1', bundleVersion: '1', tenantId: SCHOOL_ID, playlists: [], assets: [] }));
  root.file('manifest.sig', 'ab'.repeat(32));
  root.folder('assets')!.file('x.png', PNG);
  return zip.generateAsync({ type: 'nodebuffer' });
}

async function openDashboard(page: Page, opts: { folderPicker: boolean }) {
  const bundles: Array<Record<string, unknown>> = [];
  const writes: string[] = [];
  const zip = await packageZip();
  await page.route('**/usb-welcome.png', (r) => r.fulfill({ contentType: 'image/png', body: PNG }));
  await page.route('**/api/build-info', (r) => r.fulfill({ contentType: 'application/json', body: '{}' }));
  await page.route(/http:\/\/api\.invalid\/.*/, (route: Route) => {
    const req = route.request();
    const headers = {
      'Access-Control-Allow-Origin': new URL(page.url()).origin,
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Headers': 'authorization,content-type,x-csrf-token,x-requested-with',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers, body: '' });
    const path = new URL(req.url()).pathname.replace('/api/v1', '');
    if (path === '/usb-export/bundle') {
      bundles.push(req.postDataJSON() ?? {});
      return route.fulfill({ status: 200, headers, contentType: 'application/zip', body: zip });
    }
    let body: unknown = [];
    if (req.method() !== 'GET') {
      writes.push(path);
      body = { id: 'new-playlist', name: 'Gym Offline' };
    } else {
      if (path === '/auth/me') body = USER;
      if (path === '/tenants') body = { id: SCHOOL_ID, name: 'USB School', slug: SCHOOL_ID, vertical: 'K12' };
      if (path === '/tenants/accessible') body = { current: SCHOOL_ID, tenants: [{ id: SCHOOL_ID, name: 'USB School', slug: SCHOOL_ID }] };
      if (path === '/branding/me') body = {};
      if (path === '/playlists') body = PLAYLISTS;
      if (path === '/assets') body = [{ ...asset, fileUrl: new URL('/usb-welcome.png', page.url()).href }];
      if (path === '/submissions/pending-counts') body = { byTenant: [], total: 0 };
      if (path === '/notifications') body = { items: [], unreadCount: 0 };
    }
    return route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.addInitScript(({ user, folderPicker }) => {
    localStorage.setItem('edu_cms_eula_accepted_v1.0', '1');
    const b64 = (v: unknown) => btoa(JSON.stringify(v)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
    sessionStorage.setItem('edu_cms_token', `${b64({ alg: 'none' })}.${b64({ sub: user.id, tenantId: user.tenantId, role: user.role, exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`);
    sessionStorage.setItem('edu_cms_user', JSON.stringify(user));
    const w = window as unknown as { showDirectoryPicker?: unknown };
    if (folderPicker) {
      // "The USB drive" = the browser's private file system, so the test can read back what was written.
      w.showDirectoryPicker = async () => (navigator.storage as unknown as { getDirectory: () => Promise<unknown> }).getDirectory();
    } else {
      delete w.showDirectoryPicker; // Safari / Firefox: plain download
    }
  }, { user: USER, folderPicker: opts.folderPicker });
  await page.setViewportSize({ width: 1325, height: 758 });
  return { bundles, writes };
}

test.describe('USB — download a playlist for a stick, no settings', () => {
  test('new playlist → USB drive destination → the package downloads', async ({ page }) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const { bundles, writes } = await openDashboard(page, { folderPicker: false });
    await page.goto(`/${SCHOOL_ID}/playlists?newPlaylist=1`);
    const wizard = page.getByRole('dialog', { name: 'Create new playlist' });
    await wizard.getByPlaceholder(/e\.g\.|name/i).fill('Gym Offline');
    await wizard.getByText('Media Playlist', { exact: true }).click();
    await wizard.getByRole('button', { name: /Next$/ }).click();
    await wizard.getByText('Welcome.png', { exact: true }).click();
    await wizard.getByRole('button', { name: /Next$/ }).click();

    const usb = wizard.getByTestId('wizard-usb-destination');
    await expect(usb).toContainText('USB drive');
    await usb.getByRole('switch', { name: 'USB drive' }).click();
    await expect(usb.getByRole('switch', { name: 'USB drive' })).toHaveAttribute('aria-checked', 'true');
    await expect(usb).toContainText('downloaded for USB only');
    await wizard.getByRole('button', { name: /Next$/ }).click();
    await wizard.getByRole('button', { name: /Next$/ }).click();

    const download = page.waitForEvent('download');
    await wizard.getByRole('button', { name: 'Create & download for USB' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^VenueOS-USB-Gym_Offline-.*\.zip$/);
    await expect(page.getByRole('dialog').filter({ hasText: 'Copy the file onto a USB drive' })).toBeVisible();
    expect(bundles).toEqual([{ playlistIds: ['new-playlist'], includeEmergency: true, bundleLabel: 'Gym Offline' }]);
    expect(writes).toContain('/playlists');
    expect(writes).not.toContain('/schedules'); // USB only: nothing published to screens
    expect(errors).toEqual([]);
  });

  test('existing playlist → Export to USB → .zip download (no folder picker)', async ({ page }) => {
    test.setTimeout(120_000);
    const { bundles } = await openDashboard(page, { folderPicker: false });
    await page.goto(`/${SCHOOL_ID}/playlists`);
    const row = page.getByTestId('playlist-row').filter({ hasText: 'Lobby Welcome' }).first();
    await row.waitFor({ state: 'visible', timeout: 90_000 });
    await row.getByRole('button', { name: /More actions for Lobby Welcome/ }).click();
    const download = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: /Export to USB/ }).click();
    expect((await download).suggestedFilename()).toMatch(/^VenueOS-USB-Lobby_Welcome-.*\.zip$/);
    await expect(page.getByTestId('usb-export-status')).toContainText('no unzipping needed');
    expect(bundles).toEqual([{ playlistIds: ['pl-lobby'], includeEmergency: true, bundleLabel: 'Lobby Welcome' }]);
  });

  test('existing playlist → Export to USB → written straight onto the picked drive (Chrome / Edge)', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'the folder picker is a Chromium API');
    test.setTimeout(120_000);
    await openDashboard(page, { folderPicker: true });
    await page.goto(`/${SCHOOL_ID}/playlists`);
    const row = page.getByTestId('playlist-row').filter({ hasText: 'Lobby Welcome' }).first();
    await row.waitFor({ state: 'visible', timeout: 90_000 });
    await row.getByRole('button', { name: /More actions for Lobby Welcome/ }).click();
    await page.getByRole('menuitem', { name: /Export to USB/ }).click();
    await expect(page.getByTestId('usb-export-status')).toContainText('is on the USB drive');
    const written = await page.evaluate(async () => {
      const root = await (navigator.storage as unknown as { getDirectory: () => Promise<FileSystemDirectoryHandle> }).getDirectory();
      const dir = await root.getDirectoryHandle('edu-cms-content');
      const manifest = await (await dir.getFileHandle('manifest.json')).getFile();
      return JSON.parse(await manifest.text()).schema as string;
    });
    expect(written).toBe('edu-cms-usb-bundle/v1');
  });

  test('the old USB settings page is gone — it lands on Playlists', async ({ page }) => {
    test.setTimeout(120_000);
    await openDashboard(page, { folderPicker: false });
    await page.goto(`/${SCHOOL_ID}/settings/usb`);
    await page.waitForURL(`**/${SCHOOL_ID}/playlists`, { timeout: 90_000 });
    await expect(page.getByText('USB ingest security')).toHaveCount(0);
  });
});
