import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

// Drive the real media library against an actual cross-origin file response.
// WebKit does not emit downloads for route.fulfill attachments (Playwright
// #22691), so the legacy API file route goes to a local HTTP fixture instead.
// Storage URL selection is also covered by unit tests and a live header check.
const NAME = 'Welcome café.png';
const FILE = 'http://api.invalid/api/v1/assets/file/welcome.png';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aC9sAAAAASUVORK5CYII=', 'base64');
const USER = { id: 'u-download', email: 'download@example.com', role: 'SCHOOL_ADMIN', tenantId: 'e2e-download', canTriggerPanic: false };
const ASSET = { id: 'a-download', originalName: NAME, mimeType: 'image/png', fileUrl: FILE, fileSize: PNG.length, status: 'PUBLISHED', createdAt: '2026-09-29T00:00:00Z' };
const token = `e30.${Buffer.from(JSON.stringify({ sub: USER.id, exp: 4102444800 })).toString('base64url')}.test`;
let files: Server;
let fileOrigin: string;

test.beforeAll(async () => {
  files = createServer((req, res) => {
    const download = new URL(req.url!, 'http://localhost').searchParams.get('download');
    res.setHeader('Content-Type', 'image/png');
    if (download !== null) res.setHeader('Content-Disposition', `attachment; filename="welcome.png"; filename*=UTF-8''${encodeURIComponent(download)}`);
    res.end(PNG);
  });
  await new Promise<void>((resolve) => files.listen(0, '127.0.0.1', resolve));
  fileOrigin = `http://127.0.0.1:${(files.address() as AddressInfo).port}`;
});

test.afterAll(async () => {
  await new Promise<void>((resolve, reject) => files.close((error) => error ? reject(error) : resolve()));
});

async function openLibrary(page: Page) {
  await page.addInitScript(({ user, token }) => {
    sessionStorage.setItem('edu_cms_token', token);
    sessionStorage.setItem('edu_cms_user', JSON.stringify(user));
    localStorage.setItem('edu_cms_eula_accepted_v1.0', '1');
  }, { user: USER, token });
  await page.route(/^http:\/\/api\.invalid\//, async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace('/api/v1', '');
    if (path === '/assets/file/welcome.png') {
      return route.continue({ url: `${fileOrigin}${url.pathname}${url.search}` });
    }
    const bodies: Record<string, unknown> = {
      '/auth/me': USER,
      '/users/me': USER,
      '/tenants': [{ id: USER.tenantId, name: 'Download test', slug: USER.tenantId }],
      '/tenants/accessible': [{ id: USER.tenantId, name: 'Download test', slug: USER.tenantId }],
      '/assets': { assets: [ASSET], total: 1 },
      '/assets/folders': [],
      '/assets/storage-summary': { totalBytes: PNG.length, totalFiles: 1, videos: { bytes: 0, files: 0 }, images: { bytes: PNG.length, files: 1 }, other: { bytes: 0, files: 0 } },
      '/assets/storage': { usedBytes: PNG.length, includedBytes: 10737418240, screens: 1, percent: 0, warn: false },
      '/assets/a-download/usage': { playlists: [], totals: { playlists: 0, screensReached: 0, locations: 0 }, protectedEmergency: false },
    };
    const headers = {
      'Access-Control-Allow-Origin': new URL(page.url()).origin,
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Headers': 'authorization,content-type,x-csrf-token,x-requested-with',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    return route.fulfill({ contentType: 'application/json', headers, body: JSON.stringify(bodies[path] ?? []) });
  });
  await page.goto('/e2e-download/assets');
  await expect(page.getByRole('button', { name: `More actions for ${NAME}` })).toBeVisible();
}

for (const source of ['details', 'menu', 'bulk'] as const) {
  test(`${source} Download saves the file and keeps the library open`, async ({ page, context }) => {
    await openLibrary(page);
    let button;
    if (source === 'bulk') {
      await page.getByRole('button', { name: `Select ${NAME}`, exact: true }).click();
      button = page.getByRole('button', { name: 'Download', exact: true });
    } else {
      await page.getByRole('button', { name: `More actions for ${NAME}` }).click();
      if (source === 'details') {
        await page.getByRole('menuitem', { name: 'View details' }).click();
        button = page.getByRole('dialog').getByRole('button', { name: 'Download', exact: true });
      } else {
        button = page.getByRole('menuitem', { name: 'Download', exact: true });
      }
    }
    const pending = page.waitForEvent('download');
    await button.click();
    const download = await pending;
    // macOS WebKit returns decomposed Unicode for filenames on disk.
    expect(download.suggestedFilename().normalize('NFC')).toBe(NAME);
    expect(await download.failure()).toBeNull();
    const path = await download.path();
    expect(path).not.toBeNull();
    expect(await readFile(path!)).toEqual(PNG);
    await expect(page).toHaveURL(/\/e2e-download\/assets$/);
    expect(context.pages()).toHaveLength(1);
  });
}
