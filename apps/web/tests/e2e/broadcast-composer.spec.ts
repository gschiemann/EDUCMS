import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// Real page, picker and upload client; external services are intercepted.
const TENANT = '00000000-0000-4000-8000-000000000001';
const SLUG = 'northwind';
const IMAGE = 'https://media.example.test/alert-instructions.png';
const USER = { id: 'u1', firstName: 'Pat', lastName: 'Lee', email: 'pat@example.test', role: 'SCHOOL_ADMIN', tenantId: TENANT, termsAcceptedVersion: '1.0' };
const PNG = readFileSync(path.resolve(__dirname, '../../public/panic-icon.png'));

async function setup(page: Page) {
  const calls: { path: string; body: Record<string, unknown> }[] = [];
  let active: unknown[] = [];
  let uploaded = false;
  await page.addInitScript((user) => {
    const b64 = (v: unknown) => btoa(JSON.stringify(v)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
    sessionStorage.setItem('edu_cms_token', `${b64({ alg: 'none' })}.${b64({ sub: user.id, role: user.role, tenantId: user.tenantId, exp: Math.floor(Date.now() / 1000) + 3600 })}.test`);
    sessionStorage.setItem('edu_cms_user', JSON.stringify(user));
    localStorage.setItem('edu_cms_eula_accepted_v1.0', '1');
  }, USER);
  await page.route('https://media.example.test/**', r => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await page.route('https://uploads.example.test/**', r => {
    // WebKit does not expose a file-backed XHR body through postDataBuffer.
    if (r.request().method() === 'PUT') uploaded = r.request().headers()['content-type'] === 'image/png';
    return r.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'PUT, OPTIONS', 'Access-Control-Allow-Headers': '*' }, body: '' });
  });
  await page.route('**/api/v1/**', async r => {
    const request = r.request();
    const url = new URL(request.url());
    const p = url.pathname.replace(/^.*\/api\/v1/, '');
    const headers = { 'Access-Control-Allow-Origin': new URL(page.url() === 'about:blank' ? process.env.E2E_BASE! : page.url()).origin, 'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
    if (request.method() === 'OPTIONS') return r.fulfill({ status: 204, headers, body: '' });
    let body: unknown = p.endsWith('s') ? [] : {};
    if (p === '/auth/me' || p === '/users/me') body = USER;
    if (p === '/tenants') body = { id: TENANT, name: 'Northwind', slug: SLUG, emergencyStatus: 'INACTIVE', vertical: 'CORPORATE', emergencyEnabled: true };
    if (p === '/tenants/accessible') body = [{ id: TENANT, name: 'Northwind', slug: SLUG }];
    if (p === '/security/csrf') body = { token: 'test-csrf' };
    if (p === '/assets' || p === '/assets/folders') body = [];
    if (p === '/assets/presign') body = { storagePath: 'northwind/map.png', fileUrl: IMAGE, uploadUrl: 'https://uploads.example.test/map.png', mimeType: 'image/png', maxFileSize: 52428800 };
    if (p === '/assets/complete-upload') {
      expect(uploaded).toBe(true);
      expect(request.postDataJSON().size).toBe(PNG.length);
      body = { id: 'asset-map', fileUrl: IMAGE, mimeType: 'image/png' };
    }
    if (p === '/emergency/status') {
      expect(url.searchParams.get('tenantId')).toBe(TENANT);
      body = { active };
    }
    if (p === '/emergency/broadcast' || p === '/emergency/media-alert') {
      const data = request.postDataJSON();
      calls.push({ path: p, body: data });
      active = [{ id: 'broadcast-1', type: p.endsWith('media-alert') ? 'MEDIA_ALERT' : 'TEXT_BROADCAST', severity: data.severity, textBlob: data.textBlob || data.text, mediaUrls: data.mediaUrls || [], audioUrl: null, createdAt: new Date().toISOString(), expiresAt: Math.floor(Date.now() / 1000) + 300 }];
      body = { success: true, messageId: 'broadcast-1' };
    }
    if (p === '/emergency/messages/broadcast-1/all-clear') { active = []; body = { success: true }; }
    return r.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.route('**/api/build-info', r => r.fulfill({ contentType: 'application/json', body: '{}' }));
  return calls;
}

for (const width of [1440, 390]) {
  test(`broadcast image upload, preview, held send and clear at ${width}px`, async ({ page, browserName }) => {
    test.setTimeout(180000);
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1050 });
    const calls = await setup(page);
    await page.goto(`/${SLUG}/emergency/broadcast`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Create a broadcast' })).toBeVisible({ timeout: 120000 });
    const main = page.getByTestId('broadcast-page');
    await expect(main.getByText('No active broadcasts', { exact: true })).toBeVisible();
    if (process.env.BROADCAST_SHOTS) await page.screenshot({ path: `${process.env.BROADCAST_SHOTS}/broadcast-${width}-${browserName}.png` });
    await page.getByLabel('Message', { exact: true }).fill('Please use the north entrance while maintenance is in progress.');
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Add image', exact: true }).click();
    const picker = page.getByRole('dialog', { name: 'Choose or upload an image' });
    await expect(picker).toBeVisible();
    await picker.locator('input[type=file]').setInputFiles({ name: 'alert-instructions.png', mimeType: 'image/png', buffer: PNG });
    await expect(picker).not.toBeVisible({ timeout: 15000 });
    await expect(main.getByText('alert-instructions.png', { exact: true })).toBeVisible();
    await expect(main.getByTestId('broadcast-preview').getByRole('img')).toBeVisible();
    const send = page.getByRole('button', { name: /Broadcast emergency message/ });
    // Short keyboard holds do not send.
    await send.focus();
    await page.keyboard.down('Space');
    await page.waitForTimeout(300);
    await page.keyboard.up('Space');
    expect(calls).toHaveLength(0);
    await page.keyboard.down('Space');
    await expect.poll(() => calls.length, { timeout: 6000 }).toBe(1);
    await page.keyboard.up('Space');
    expect(calls[0].body).toMatchObject({ scopeId: TENANT, mediaUrls: [IMAGE] });
    await expect(main.getByText('Broadcast sent.', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'End broadcast', exact: true }).click();
    await expect(main.getByText('No active broadcasts', { exact: true })).toBeVisible();
    const dimensions = await main.evaluate(el => ({ client: el.clientWidth, scroll: el.scrollWidth }));
    expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client);
  });
}
