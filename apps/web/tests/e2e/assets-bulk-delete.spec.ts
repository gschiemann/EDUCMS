import { test, expect, type Page, type Route } from '@playwright/test';

const TENANT = 'e2e-school';
const USER = { id: 'user', tenantId: TENANT, role: 'SCHOOL_ADMIN', email: 'test@example.test' };
const CORS = { 'Access-Control-Allow-Origin': 'http://localhost:3000', 'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Headers': 'authorization,content-type,x-csrf-token,x-requested-with', 'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS' };
const ASSETS = Array.from({ length: 60 }, (_, index) => ({ id: `asset-${index}`, tenantId: TENANT, originalName: `Demo photo ${index}.png`, mimeType: 'image/png', fileSize: 1000, fileUrl: 'https://files.example.test/image.png', createdAt: '2026-10-01T10:00:00Z', folderId: index >= 50 ? 'folder' : null }));
const FOLDERS = [{ id: 'folder', name: 'Demo folder', parentId: null, _count: { assets: 2, children: 1 } }, { id: 'child', name: 'Nested folder', parentId: 'folder', _count: { assets: 1 } }];
async function setup(page: Page, opts: { gate?: Promise<void>; protectedId?: string } = {}) {
  const batches: string[][] = [], folderDeletes: string[] = [], singleDeletes: string[] = [];
  const removed = new Set<string>();
  const folderIds = ['asset-50', 'asset-51', 'asset-59'];
  await page.addInitScript(user => {
    sessionStorage.setItem('edu_cms_token', 'e2e-token'); sessionStorage.setItem('edu_cms_user', JSON.stringify(user)); localStorage.setItem('edu_cms_eula_accepted_v1.0', '1');
  }, USER);
  const json = (route: Route, body: unknown) => route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('https://files.example.test/**', route => route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64') }));
  await page.route('**/api/v1/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname.replace(/^.*\/api\/v1/, '');
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    if (path === '/auth/me') return json(route, USER);
    if (path === '/assets/storage-summary') return json(route, { totalBytes: 60000, totalFiles: 60, images: { bytes: 60000, files: 60 }, videos: { bytes: 0, files: 0 }, other: { bytes: 0, files: 0 } });
    if (path === '/tenants' || path === '/tenants/accessible') return json(route, [{ id: TENANT, slug: TENANT, name: 'Demo' }]);
    if (path === '/asset-folders' || path === '/assets/folders') return json(route, FOLDERS);
    if (path === '/assets/folders/folder/deletion-summary') return json(route, { name: 'Demo folder', assetIds: folderIds, folders: 2 });
    if (path === '/assets/bulk-delete') {
      expect(url.searchParams.get('confirm')).toBe('in-use');
      const ids = request.postDataJSON().ids as string[]; batches.push(ids);
      await opts.gate;
      return json(route, { results: ids.map(id => {
        if (id === opts.protectedId) return { id, deleted: false, code: 'ASSET_IN_EMERGENCY_CONTENT', message: 'Protected emergency content was kept.' };
        removed.add(id); return { id, deleted: true };
      }) });
    }
    if (path === '/assets/folders/folder' && request.method() === 'DELETE') { folderDeletes.push(url.searchParams.get('mode') || 'keep-files'); return json(route, { deleted: true }); }
    if (path.startsWith('/assets/') && request.method() === 'DELETE') { singleDeletes.push(path); return json(route, { deleted: true }); }
    if (path === '/assets') {
      const visible = ASSETS.filter(asset => !removed.has(asset.id));
      const take = Number(url.searchParams.get('take') || 50), skip = Number(url.searchParams.get('skip') || 0);
      return json(route, { assets: take === 1000 ? visible.slice(skip, skip + take) : visible.slice(0, 3), total: visible.length });
    }
    return json(route, path.endsWith('s') ? [] : {});
  });
  await page.setViewportSize({ width: 1325, height: 900 });
  await page.goto(`/${TENANT}/assets`);
  await expect(page.getByRole('button', { name: 'Select all', exact: true })).toBeVisible();
  return { batches, folderDeletes, singleDeletes };
}
async function folderDialog(page: Page) {
  await page.getByRole('button', { name: 'Folder actions for Demo folder' }).click();
  await page.getByRole('menuitem', { name: 'Delete folder', exact: true }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('3 files · 1 subfolder');
  return dialog;
}

test('Select all includes unloaded files; deletion removes the selection together while browsing remains available', async ({ page }, info) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const calls = await setup(page, { gate });
  await page.getByRole('button', { name: 'Select all', exact: true }).click();
  await expect(page.getByTestId('asset-bulk-bar')).toContainText('60');
  await page.getByTestId('asset-bulk-bar').getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Deleting 60 files' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Select Demo photo 0.png' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Open folder Demo folder' }).click();
  await page.screenshot({ path: info.outputPath('bulk-delete-browsing.png'), fullPage: true });
  release();
  await expect.poll(() => calls.batches.length).toBe(3);
  await expect(page.getByRole('status').filter({ hasText: 'Deleting 60 files' })).toHaveCount(0);
  expect(calls.batches.map(ids => ids.length)).toEqual([20, 20, 20]);
  expect(calls.singleDeletes).toEqual([]);
});

test('folder confirmation keeps files by default with one final Delete', async ({ page }, info) => {
  const calls = await setup(page);
  const dialog = await folderDialog(page);
  await expect(dialog.getByRole('checkbox', { name: /Also delete all files/ })).not.toBeChecked();
  await page.screenshot({ path: info.outputPath('folder-delete-choices.png'), fullPage: true });
  await dialog.getByRole('button', { name: 'Delete folder, keep files' }).click();
  await expect.poll(() => calls.folderDeletes).toEqual(['keep-files']);
  expect(calls.batches).toEqual([]);
});

test('delete contents includes unloaded descendants, then removes only the empty tree', async ({ page }) => {
  const calls = await setup(page);
  const dialog = await folderDialog(page);
  await dialog.getByRole('checkbox', { name: /Also delete all files/ }).check();
  await expect(dialog).toContainText('Empty playlists stop playing. Protected emergency files are kept');
  await dialog.getByRole('button', { name: 'Delete folder and contents' }).click();
  await expect.poll(() => calls.folderDeletes).toEqual(['empty-tree']);
  expect(calls.batches).toEqual([['asset-50', 'asset-51', 'asset-59']]);
});

test('protected content keeps its folder and is explained without a second Delete', async ({ page }) => {
  const calls = await setup(page, { protectedId: 'asset-51' });
  const dialog = await folderDialog(page);
  await dialog.getByRole('checkbox', { name: /Also delete all files/ }).check();
  await dialog.getByRole('button', { name: 'Delete folder and contents' }).click();
  await expect(page.getByRole('dialog')).toContainText('2 files deleted. 1 file was kept');
  expect(calls.folderDeletes).toEqual([]);
  await expect(page.getByRole('dialog').getByRole('button', { name: /Delete/ })).toHaveCount(0);
});

test('cancelling folder deletion changes nothing', async ({ page }) => {
  const calls = await setup(page);
  const dialog = await folderDialog(page);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(calls.batches).toEqual([]); expect(calls.folderDeletes).toEqual([]);
});
