import { test, expect, type Page } from '@playwright/test';
import path from 'path';

/**
 * Diagnostics in the screen drawer (2026-11-08; API: apps/api/src/screen-diagnostics/,
 * player: diagnostics/ + screenDiagnostics.ts).
 *
 * Proves the section is reachable from the /screens route (drawer → Actions),
 * renders the verdict card in its pass / warn / fail states and the logs flow,
 * sends exactly one POST per click, and fits a phone without horizontal
 * scrolling. Screenshots land in docs/research/2026-11-08-manager-waves/wave-2/
 * when DIAG_SHOTS=1 (gitignored), else in the test output dir.
 */

const USER = { id: 'diag-user', email: 'screens@example.com', role: 'DISTRICT_ADMIN', tenantId: 'e2e-diag', canTriggerPanic: false };
const token = `e30.${Buffer.from(JSON.stringify({ sub: USER.id, exp: 4102444800 })).toString('base64url')}.test`;
const GROUP = { id: 'group-one', name: 'Front office', address: null };
const SCREEN = {
  id: 'LOBBY1', name: 'Lobby 1', status: 'ONLINE', screenGroupId: GROUP.id, screenGroup: GROUP,
  osInfo: 'Android 11', hardwareModel: 'unknown', playerVersion: '1.1.66', managerVersion: '1.1.66',
  lastPingAt: new Date().toISOString(), authState: 'PROVEN',
  forceApkUpdatePendingAt: null, forceApkUpdateHold: null, lastOtaState: null, lastOtaAt: null,
};
const RID = '3f2b8c1e-9a4d-4e7b-8f10-2a3b4c5d6e7f';

type Check = { id: string; group: string; status: string; values: Record<string, unknown> };
const c = (id: string, group: string, status: string, values: Record<string, unknown> = {}): Check => ({ id, group, status, values });
const PASS: Check[] = [
  c('storage', 'device', 'pass', { freeBytes: 6.1e9, totalBytes: 8e9, writeMs: 4 }),
  c('clock', 'device', 'pass', { skewSec: 1 }),
  c('certs', 'device', 'pass', { chainLength: 3, leafDaysLeft: 61 }),
  c('network', 'network', 'pass', { transport: 'ethernet' }),
  c('link', 'network', 'pass', { transport: 'ethernet', linkMbps: 100 }),
  c('dns', 'network', 'pass', { ms: 24, count: 2 }),
  c('api', 'network', 'pass', { ms: 182, status: 200 }),
  c('address', 'network', 'pass', { ipKind: 'private', ip: '10.20.x.x', gateway: '10.20.x.x' }),
  c('webview', 'player', 'pass', { major: 124 }),
  c('heartbeat', 'player', 'pass', { ageSec: 12 }),
  c('manifest', 'player', 'pass', { ageSec: 41 }),
  c('origin', 'player', 'pass', { usage: 2.1e7, quota: 1.6e8, percent: 13 }),
  c('emergency', 'player', 'pass', { entries: 12, bytes: 4.2e6 }),
];
const swap = (list: Check[], repl: Check[]) => list.map((x) => repl.find((r) => r.id === x.id) ?? x);
const WARN = swap(PASS, [
  c('link', 'network', 'warn', { transport: 'wifi', rssi: -79, linkMbps: 39 }),
  c('webview', 'player', 'warn', { major: 66, legacyPolyfills: true }),
  c('origin', 'player', 'warn', { usage: 1.38e8, quota: 1.6e8, percent: 86 }),
  c('network', 'network', 'pass', { transport: 'wifi' }),
]);
const FAIL = swap(PASS, [
  c('network', 'network', 'fail', { captivePortal: true }),
  c('dns', 'network', 'fail', { ms: 6000, error: 'UnknownHostException' }),
  c('api', 'network', 'fail', { error: 'timeout' }),
  c('clock', 'device', 'fail', { skewSec: -3720 }),
  c('certs', 'device', 'fail', { error: 'SSLHandshakeException' }),
]);

const selfTest = (verdict: string, checks: Check[]) => ({
  id: RID, kind: 'SELF_TEST', status: 'complete', verdict, createdAt: new Date(Date.now() - 60_000).toISOString(),
  completedAt: new Date(Date.now() - 39_000).toISOString(), checks, answered: { native: true, page: true },
});

function shotPath(info: { outputPath: (n: string) => string }, name: string) {
  if (process.env.DIAG_SHOTS === '1') {
    return path.resolve(__dirname, '../../../../docs/research/2026-11-08-manager-waves/wave-2', name);
  }
  return info.outputPath(name);
}

async function openScreens(page: Page, state: { view: Record<string, unknown>; posts: unknown[] }) {
  await page.addInitScript(({ user, token }) => {
    sessionStorage.setItem('edu_cms_token', token);
    sessionStorage.setItem('edu_cms_user', JSON.stringify(user));
    localStorage.setItem('edu_cms_eula_accepted_v1.0', '1');
  }, { user: USER, token });
  await page.route(/^http:\/\/api\.invalid\//, async (route) => {
    const req = route.request();
    const p = new URL(req.url()).pathname.replace('/api/v1', '');
    const headers = {
      'Access-Control-Allow-Origin': new URL(page.url()).origin,
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Headers': 'authorization,content-type,x-csrf-token,x-requested-with',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (p === '/screens/LOBBY1/diagnostics') {
      if (req.method() === 'POST') {
        const body = JSON.parse(req.postData() || '{}');
        state.posts.push(body);
        const row = { id: '00000000-0000-4000-8000-00000000000' + state.posts.length, kind: body.kind, status: 'pending', verdict: null,
          createdAt: new Date().toISOString(), completedAt: null, checks: [], minutes: body.minutes ?? null };
        if (body.kind === 'LOGS') {
          // The screen answers by the next read: the bundle is ready.
          (state.view.logs as unknown[]).unshift({ ...row, status: 'complete', completedAt: new Date().toISOString(), logBytes: 412_000, logAvailable: true });
        }
        return route.fulfill({ status: 201, contentType: 'application/json', headers, body: JSON.stringify(row) });
      }
      return route.fulfill({ contentType: 'application/json', headers, body: JSON.stringify(state.view) });
    }
    if (p.startsWith('/screens/LOBBY1/diagnostics/') && p.endsWith('/logs-url')) {
      return route.fulfill({ contentType: 'application/json', headers, body: JSON.stringify({ url: 'about:blank', expiresInSeconds: 300 }) });
    }
    const bodies: Record<string, unknown> = {
      '/auth/me': USER, '/users/me': USER, '/branding/me': {},
      '/tenants': [{ id: USER.tenantId, name: 'Diagnostics', slug: USER.tenantId }],
      '/tenants/accessible': [{ id: USER.tenantId, name: 'Diagnostics', slug: USER.tenantId }],
      '/screens': [SCREEN], '/screen-groups': [GROUP], '/schedules': [], '/playlists': [],
      '/emergency/readiness/district': { schools: [], notReadyCount: 0, computedAt: new Date().toISOString() },
      '/player/latest-version': { versionName: '1.1.66', versionCode: 10166, managerVersionName: '1.1.66' },
      '/screens/hardware-catalog': { models: [] }, '/screens/hardware': { models: [] },
    };
    const body = p.endsWith('/device-inventory') ? { report: null, reportedAt: null }
      : p.endsWith('/events') ? { events: [] }
        : p.endsWith('/faces') ? { faces: [] }
          : p.endsWith('/playback-capability') ? {
            screenId: p.split('/')[2], summary: 'unknown', declared: null, files: [], demotions: [],
            capability: {
              deviceClass: null, maxShortEdge: null, stuttersAtShortEdge: null, maxFps: null, maxUnitConcurrentVideos: null,
              evidence: 'unknown', concurrencyEvidence: 'unknown', evidenceAt: null, classScreens: 0, stale: false,
            },
          }
          : p.endsWith('/device-settings') ? { screenId: 'LOBBY1', faceOfScreenId: null, revision: 0, desired: {}, report: null, reportChangedAt: null, reportedAt: null }
            : bodies[p] ?? [];
    return route.fulfill({ contentType: 'application/json', headers, body: JSON.stringify(body) });
  });
  await page.goto('/e2e-diag/screens');
  await expect(page.locator(':text-is("Lobby 1"):visible').first()).toBeVisible();
}

async function openDiagnostics(page: Page) {
  await page.getByRole('button', { name: /^Lobby 1\b/ }).first().click();
  const drawer = page.getByRole('dialog').first();
  const tabs = drawer.getByRole('tab');
  const names = await tabs.allTextContents();
  const actions = names.findIndex((n) => /settings|actions/i.test(n));
  await tabs.nth(actions >= 0 ? actions : 1).click();
  const section = drawer.getByTestId('screen-diagnostics');
  await expect(section).toBeVisible();
  return section;
}

const VIEWS = {
  pass: { storage: { warning: null, native: { freeBytes: 6.1e9, totalBytes: 8e9, writeOk: true, at: new Date().toISOString() }, page: { origin: { usage: 2.1e7, quota: 1.6e8 }, emergency: { readable: true, entries: 12 }, at: new Date().toISOString() } }, selfTest: selfTest('pass', PASS) },
  warn: { storage: { warning: 'almost-full', native: { freeBytes: 6.4e8, totalBytes: 8e9, writeOk: true, at: new Date().toISOString() }, page: { origin: { usage: 1.38e8, quota: 1.6e8 }, emergency: { readable: true, entries: 12 }, at: new Date().toISOString() } }, selfTest: selfTest('warn', WARN) },
  fail: { storage: { warning: 'critical', native: { freeBytes: 1.5e8, totalBytes: 8e9, writeOk: true, at: new Date().toISOString() }, page: null }, selfTest: selfTest('fail', FAIL) },
};

for (const verdict of ['pass', 'warn', 'fail'] as const) {
  test(`verdict card — ${verdict}`, async ({ page, browserName }, info) => {
    const state = { view: { enabled: true, canRequestLogs: true, retentionDays: 7, logs: [], ...VIEWS[verdict] } as Record<string, unknown>, posts: [] as unknown[] };
    await page.setViewportSize({ width: 1325, height: 758 });
    await openScreens(page, state);
    const section = await openDiagnostics(page);
    await expect(section.getByTestId('diag-verdict')).toHaveAttribute('data-verdict', verdict);
    if (verdict !== 'pass') await expect(section.getByTestId('diag-storage-warning')).toBeVisible();
    await section.getByTestId('diag-verdict').scrollIntoViewIfNeeded();
    await section.screenshot({ path: shotPath(info, `verdict-${verdict}-1325-${browserName}.png`) });

    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await section.getByTestId('diag-verdict').scrollIntoViewIfNeeded();
    await page.screenshot({ path: shotPath(info, `verdict-${verdict}-390-${browserName}.png`) });
  });
}

test('logs flow: one POST with the chosen minutes, the bundle offers Download', async ({ page, browserName }, info) => {
  const state = { view: { enabled: true, canRequestLogs: true, retentionDays: 7, storage: VIEWS.pass.storage, selfTest: null, logs: [] as unknown[] } as Record<string, unknown>, posts: [] as unknown[] };
  await page.setViewportSize({ width: 1325, height: 758 });
  await openScreens(page, state);
  const section = await openDiagnostics(page);
  const logs = section.getByTestId('diag-logs');
  await logs.getByLabel('Last').selectOption('30');
  await logs.getByTestId('diag-get-logs').click();
  await expect.poll(() => state.posts).toEqual([{ kind: 'LOGS', minutes: 30 }]);
  await expect(logs.getByTestId('diag-log-download')).toBeVisible();
  await logs.scrollIntoViewIfNeeded();
  await section.screenshot({ path: shotPath(info, `logs-1325-${browserName}.png`) });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await logs.scrollIntoViewIfNeeded();
  await page.screenshot({ path: shotPath(info, `logs-390-${browserName}.png`) });
});
