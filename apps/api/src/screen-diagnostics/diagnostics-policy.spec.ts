import {
  LOG_ROLES,
  PAGE_GRACE_MS,
  SELF_TEST_TTL_MS,
  clampMinutes,
  decodePending,
  encodePendingKind,
  gradeSelfTest,
  manifestDiagnostics,
  mayRequest,
  sanitizeNativeSelfTest,
  sanitizePageSelfTest,
  signUploadTicket,
  verifyUploadTicket,
  viewStatus,
} from './diagnostics-policy';
import { redactLogLine, redactLogText } from './diagnostics-redact';

const ID = '3f2b8c1e-9a4d-4e7b-8f10-2a3b4c5d6e7f';
const ENV = { JWT_SECRET: 'x'.repeat(32) } as NodeJS.ProcessEnv;

describe('roles', () => {
  it('self-test is for the three admin roles; logs only for organisation admins', () => {
    expect(mayRequest('SCHOOL_ADMIN', 'SELF_TEST')).toBe(true);
    expect(mayRequest('SCHOOL_ADMIN', 'LOGS')).toBe(false);
    expect(mayRequest('DISTRICT_ADMIN', 'LOGS')).toBe(true);
    expect(mayRequest('CONTRIBUTOR', 'SELF_TEST')).toBe(false);
    expect(mayRequest('RESTRICTED_VIEWER', 'SELF_TEST')).toBe(false);
    expect(mayRequest(null, 'SELF_TEST')).toBe(false);
    expect(LOG_ROLES).toEqual(['SUPER_ADMIN', 'DISTRICT_ADMIN']);
  });
});

describe('the wire', () => {
  it('encodes and decodes the pending marker; unknown text says nothing', () => {
    expect(encodePendingKind('SELF_TEST')).toBe('SELF_TEST');
    expect(encodePendingKind('LOGS', 999)).toBe('LOGS:60');
    expect(decodePending(ID, 'LOGS:15')).toEqual({ id: ID, kind: 'LOGS', minutes: 15 });
    expect(decodePending(ID, 'SELF_TEST')).toEqual({ id: ID, kind: 'SELF_TEST' });
    expect(decodePending('not-an-id', 'SELF_TEST')).toBeNull();
    expect(decodePending(ID, 'REBOOT')).toBeNull();
    expect(clampMinutes('abc')).toBe(15);
    expect(clampMinutes(1)).toBe(5);
  });

  it('the manifest spread is EMPTY when nothing is open, so the ETag of an ordinary screen is unchanged', () => {
    expect(manifestDiagnostics({ pendingDiagnosticsId: null, pendingDiagnosticsKind: null })).toEqual({});
    expect(manifestDiagnostics(undefined)).toEqual({});
    expect(manifestDiagnostics({ pendingDiagnosticsId: ID, pendingDiagnosticsKind: 'SELF_TEST' }))
      .toEqual({ diagnosticsRequest: { id: ID, kind: 'SELF_TEST' } });
  });

  it('the kill switch removes the command from the manifest', () => {
    const prev = process.env.SCREEN_DIAGNOSTICS_DISABLED;
    process.env.SCREEN_DIAGNOSTICS_DISABLED = '1';
    try {
      expect(manifestDiagnostics({ pendingDiagnosticsId: ID, pendingDiagnosticsKind: 'SELF_TEST' })).toEqual({});
    } finally {
      if (prev === undefined) delete process.env.SCREEN_DIAGNOSTICS_DISABLED; else process.env.SCREEN_DIAGNOSTICS_DISABLED = prev;
    }
  });
});

describe('the upload ticket', () => {
  const now = 1_800_000_000_000;
  it('verifies for the exact screen + request + window, and nothing else', () => {
    const t = signUploadTicket('screen-a', ID, now + 60_000, ENV)!;
    expect(verifyUploadTicket(t, 'screen-a', ID, now, ENV)).toBe(true);
    expect(verifyUploadTicket(t, 'screen-b', ID, now, ENV)).toBe(false);
    expect(verifyUploadTicket(t, 'screen-a', '00000000-0000-4000-8000-000000000000', now, ENV)).toBe(false);
    expect(verifyUploadTicket(t, 'screen-a', ID, now + 61_000, ENV)).toBe(false); // expired
    expect(verifyUploadTicket(t.replace(/.$/, 'A'), 'screen-a', ID, now, ENV)).toBe(false);
    expect(verifyUploadTicket(undefined, 'screen-a', ID, now, ENV)).toBe(false);
  });
  it('refuses a ticket claiming a window longer than the TTL', () => {
    const t = signUploadTicket('screen-a', ID, now + 60 * 60_000, ENV)!;
    expect(verifyUploadTicket(t, 'screen-a', ID, now, ENV)).toBe(false);
  });
  it('mints nothing without a signing key (fails closed)', () => {
    expect(signUploadTicket('s', ID, now, {} as NodeJS.ProcessEnv)).toBeNull();
  });
});

describe('sanitising the device', () => {
  it('drops free text, unmasked addresses and out-of-range numbers', () => {
    const n = sanitizeNativeSelfTest({
      storage: { freeBytes: 5e9, totalBytes: 8e9, writeOk: true, writeMs: 12 },
      net: { transport: 'wifi', ip: '192.168.1.44', gateway: '192.168.x.x', rssi: -60, ipKind: 'private', validated: true },
      dns: { ok: true, ms: 20, error: 'host <script>' },
      api: { ok: true, status: 200, ms: 'fast' },
    })!;
    expect(n.net!.ip).toBeNull(); // a full address is never stored
    expect(n.net!.gateway).toBe('192.168.x.x');
    expect(n.dns!.error).toBeNull();
    expect(n.api!.ms).toBeNull();
    expect(sanitizeNativeSelfTest('nope')).toBeNull();
    expect(sanitizePageSelfTest({ chromeMajor: 66, legacyPolyfills: true })!.chromeMajor).toBe(66);
  });
});

const healthyNative = sanitizeNativeSelfTest({
  storage: { freeBytes: 6e9, totalBytes: 8e9, writeOk: true, writeMs: 4 },
  clock: { skewMs: 1500 },
  tls: { ok: true, chainLength: 3, leafDaysLeft: 60 },
  dns: { ok: true, ms: 30, count: 2 },
  api: { ok: true, status: 200, ms: 180 },
  net: { transport: 'ethernet', validated: true, captivePortal: false, ipKind: 'private', ip: '10.0.x.x', gateway: '10.0.x.x', linkMbps: 100 },
  webview: { versionName: '120.0.6099.230', major: 120 },
});
const healthyPage = sanitizePageSelfTest({
  chromeMajor: 120, legacyPolyfills: false, manifestAgeMs: 30_000, apiOk: true, apiRoundTripMs: 200,
  origin: { usage: 20e6, quota: 160e6 }, emergency: { readable: true, entries: 12, bytes: 4e6 },
});

describe('the grader', () => {
  it('a healthy screen passes every check', () => {
    const g = gradeSelfTest({ native: healthyNative, page: healthyPage, heartbeatAgeMs: 20_000 });
    expect(g.verdict).toBe('pass');
    expect(g.checks.every((c) => c.status === 'pass')).toBe(true);
    expect(g.checks.map((c) => c.id)).toEqual(['storage', 'clock', 'certs', 'network', 'link', 'dns', 'api', 'address', 'webview', 'heartbeat', 'manifest', 'origin', 'emergency']);
  });

  it('warns: weak Wi-Fi, old engine, origin 85% full, clock 3 min off', () => {
    const n = sanitizeNativeSelfTest({ ...healthyNative, clock: { skewMs: -180_000 }, net: { ...healthyNative!.net, transport: 'wifi', rssi: -78 } });
    const p = sanitizePageSelfTest({ ...healthyPage, chromeMajor: 66, legacyPolyfills: true, origin: { usage: 136e6, quota: 160e6 } });
    const g = gradeSelfTest({ native: n, page: p, heartbeatAgeMs: 20_000 });
    expect(g.verdict).toBe('warn');
    const by = Object.fromEntries(g.checks.map((c) => [c.id, c]));
    expect(by.link.status).toBe('warn');
    expect(by.webview.status).toBe('warn');
    expect(by.webview.values.legacyPolyfills).toBe(true);
    expect(by.origin.status).toBe('warn');
    expect(by.clock.status).toBe('warn');
  });

  it('fails: captive portal, DNS down, TLS refused, write test failed, stale heartbeat', () => {
    const n = sanitizeNativeSelfTest({
      ...healthyNative,
      storage: { freeBytes: 6e9, totalBytes: 8e9, writeOk: false },
      tls: { ok: false, error: 'SSLHandshakeException' },
      dns: { ok: false, ms: 3000, error: 'UnknownHostException' },
      net: { ...healthyNative!.net, captivePortal: true },
    });
    const g = gradeSelfTest({ native: n, page: healthyPage, heartbeatAgeMs: 20 * 60_000 });
    expect(g.verdict).toBe('fail');
    const by = Object.fromEntries(g.checks.map((c) => [c.id, c.status]));
    expect(by).toMatchObject({ storage: 'fail', certs: 'fail', network: 'fail', dns: 'fail', heartbeat: 'fail' });
  });

  it('a silent page is a warning on the manifest check, never a pass', () => {
    const g = gradeSelfTest({ native: healthyNative, page: null, heartbeatAgeMs: 10_000 });
    const m = g.checks.find((c) => c.id === 'manifest')!;
    expect(m.status).toBe('warn');
    expect(m.values.pageSilent).toBe(true);
    expect(g.verdict).toBe('warn');
  });

  it('nothing known at all is a warning, never a pass', () => {
    const g = gradeSelfTest({ native: null, page: null, heartbeatAgeMs: 1_000 });
    expect(g.verdict).not.toBe('pass');
  });
});

describe('read-time life cycle (value identity, no clock comparison on the device)', () => {
  const created = new Date(1_800_000_000_000);
  const base = { kind: 'SELF_TEST', status: 'PENDING', expiresAt: new Date(created.getTime() + SELF_TEST_TTL_MS) };
  it('pending → running → complete', () => {
    expect(viewStatus({ ...base }, created.getTime())).toBe('pending');
    expect(viewStatus({ ...base, deliveredAt: created }, created.getTime())).toBe('running');
    const nativeAt = new Date(created.getTime() + 5_000);
    expect(viewStatus({ ...base, nativeAt }, nativeAt.getTime() + 1_000)).toBe('running');
    expect(viewStatus({ ...base, nativeAt }, nativeAt.getTime() + PAGE_GRACE_MS + 1)).toBe('complete');
    expect(viewStatus({ ...base, nativeAt, pageAt: nativeAt }, nativeAt.getTime())).toBe('complete');
  });
  it('expires with no answer; a stored status wins', () => {
    expect(viewStatus({ ...base }, base.expiresAt.getTime() + 1)).toBe('expired');
    expect(viewStatus({ ...base, status: 'FAILED' }, created.getTime())).toBe('failed');
    expect(viewStatus({ ...base, kind: 'LOGS', deliveredAt: created }, created.getTime())).toBe('running');
  });
});

describe('server-side log redaction', () => {
  it('removes tokens, Wi-Fi credentials, e-mail addresses and URL secrets', () => {
    const line = 'I/Wifi: connect ssid="Staff-WiFi" psk=hunter2hunter2 by admin@school.example.org Authorization: Bearer eyJhbGciOi.abc.def https://api.example.com/x?token=abc';
    const out = redactLogLine(line);
    expect(out).not.toMatch(/hunter2/);
    expect(out).not.toMatch(/Staff-WiFi/);
    expect(out).not.toMatch(/admin@school/);
    expect(out).not.toMatch(/eyJhbGciOi/);
    expect(out).not.toMatch(/token=abc/);
    expect(out).toMatch(/\[email\]/);
  });
  it('bounds every line', () => {
    const out = redactLogText('a'.repeat(10_000) + '\nshort');
    expect(out.split('\n')[0].length).toBeLessThan(5_000);
    expect(out.split('\n')[1]).toBe('short');
  });
});
