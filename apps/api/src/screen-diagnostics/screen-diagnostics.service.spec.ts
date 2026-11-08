/**
 * ScreenDiagnosticsService — commands, device auth, tenant isolation, audit,
 * the upload ticket, retention and the storage warning, against an in-memory
 * Prisma double. The device verifier is replaced: it is pinned by its own
 * specs (device-auth.spec.ts); here only its verdict matters.
 */
jest.mock('../screens/device-auth', () => ({
  verifyDeviceForScreen: jest.fn(),
}));
jest.mock('../support-access/support-access.context', () => ({ assertSupportReach: jest.fn(async () => undefined) }));

import { verifyDeviceForScreen } from '../screens/device-auth';
import { ScreenDiagnosticsService } from './screen-diagnostics.service';
import { ScreenDiagnosticsRetentionCron } from './screen-diagnostics-retention.cron';
import { diagnosticsHeartbeat } from './diagnostics-heartbeat';
import { DIAGNOSTICS_AUDIT, manifestDiagnostics } from './diagnostics-policy';
import { STORAGE_HEADER, registerStorageNotifier } from './storage-health';

type Rec = Record<string, any>;

function matches(row: Rec, where: Rec | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([k, v]) => {
    if (k === 'OR') return (v as Rec[]).some((w) => matches(row, w));
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      if ('in' in v) return (v.in as unknown[]).includes(row[k]);
      if ('not' in v) return v.not === null ? row[k] !== null && row[k] !== undefined : row[k] !== v.not;
      if ('lt' in v) return row[k] instanceof Date && row[k].getTime() < v.lt.getTime();
      return false;
    }
    return (row[k] ?? null) === v;
  });
}

function table(rows: Rec[] = []) {
  return {
    rows,
    findFirst: jest.fn(async ({ where }: any) => rows.find((r) => matches(r, where)) ?? null),
    findMany: jest.fn(async ({ where, take }: any = {}) => rows.filter((r) => matches(r, where)).slice(0, take ?? 1e9)
      .sort((a, b) => (b.createdAt?.getTime?.() ?? 0) - (a.createdAt?.getTime?.() ?? 0))),
    create: jest.fn(async ({ data }: any) => {
      const row = { id: data.id ?? `00000000-0000-4000-8000-${String(rows.length + 1).padStart(12, '0')}`, status: 'PENDING',
        deliveredAt: null, completedAt: null, nativeAt: null, pageAt: null, nativeResult: null, pageResult: null,
        verdict: null, failureReason: null, logObjectKey: null, logBytes: null, logPurgedAt: null, ...data };
      rows.push(row);
      return row;
    }),
    updateMany: jest.fn(async ({ where, data }: any) => {
      let count = 0;
      for (const r of rows) if (matches(r, where)) { Object.assign(r, data); count += 1; }
      return { count };
    }),
    upsert: jest.fn(async ({ where, create, update }: any) => {
      const r = rows.find((x) => matches(x, where));
      if (r) { Object.assign(r, update); return r; }
      rows.push({ ...create }); return create;
    }),
    deleteMany: jest.fn(async ({ where }: any) => {
      const keep = rows.filter((r) => !matches(r, where));
      const n = rows.length - keep.length;
      rows.splice(0, rows.length, ...keep);
      return { count: n };
    }),
  };
}

const T1 = 'tenant-1';
const T2 = 'tenant-2';

function setup() {
  const screens = table([
    { id: 'scr-1', tenantId: T1, name: 'Lobby', faceOfScreenId: null, lastPingAt: new Date(), pendingDiagnosticsId: null, pendingDiagnosticsKind: null, pendingDiagnosticsAt: null },
    { id: 'scr-2', tenantId: T2, name: 'Gym', faceOfScreenId: null, lastPingAt: new Date(), pendingDiagnosticsId: null, pendingDiagnosticsKind: null, pendingDiagnosticsAt: null },
  ]);
  const requests = table();
  const audit = table();
  const health = table();
  const tenants = table([]);
  const prisma: any = {
    client: {
      screen: screens, screenDiagnosticsRequest: requests, auditLog: audit,
      screenStorageHealth: health, tenant: tenants,
    },
  };
  const redis: any = { publish: jest.fn(async () => 1) };
  const signer: any = { signMessage: jest.fn((type: string, payload: any) => ({ type, payload, sig: 'x' })) };
  const storage: any = {
    uploadToBucket: jest.fn(async () => 'ok'),
    createSignedUrl: jest.fn(async () => 'https://signed.example/x'),
    deleteManyFromBucket: jest.fn(async (_b: string, keys: string[]) => keys.length),
  };
  const notifications: any = { notify: jest.fn(async () => ({})) };
  const svc = new ScreenDiagnosticsService(prisma, redis, signer, storage, notifications);
  return { svc, prisma, screens, requests, audit, health, redis, signer, storage, notifications };
}

const admin = (role = 'DISTRICT_ADMIN', tenantId = T1) => ({ id: 'user-1', role, tenantId });
const deviceOk = (screenId: string, tenantId: string) =>
  (verifyDeviceForScreen as jest.Mock).mockResolvedValue({ ok: true, sub: screenId, tenantId, screen: {}, token: 't' });

beforeEach(() => {
  process.env.JWT_SECRET = 'y'.repeat(40);
  delete process.env.SCREEN_DIAGNOSTICS_DISABLED;
  delete process.env.SCREEN_STORAGE_WARNINGS_DISABLED;
  (verifyDeviceForScreen as jest.Mock).mockReset();
});

describe('requesting a self-test', () => {
  it('arms the screen marker (manifest + heartbeat), publishes signed on the device channel and audits who asked', async () => {
    const { svc, screens, redis, signer, audit } = setup();
    const v = await svc.request(admin('SCHOOL_ADMIN'), 'scr-1', { kind: 'SELF_TEST' }, '203.0.113.9');
    expect(v.status).toBe('pending');
    const s = screens.rows[0];
    expect(s.pendingDiagnosticsId).toBe(v.id);
    expect(s.pendingDiagnosticsKind).toBe('SELF_TEST');
    expect(manifestDiagnostics(s)).toEqual({ diagnosticsRequest: { id: v.id, kind: 'SELF_TEST' } });
    expect(signer.signMessage).toHaveBeenCalledWith('DIAGNOSTICS_REQUEST', expect.objectContaining({ screenId: 'scr-1', requestId: v.id }));
    expect(redis.publish).toHaveBeenCalledWith('device:scr-1', expect.anything());
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]).toMatchObject({ action: DIAGNOSTICS_AUDIT.REQUESTED, tenantId: T1, userId: 'user-1', targetId: 'scr-1' });
    expect(JSON.parse(audit.rows[0].details)).toMatchObject({ kind: 'SELF_TEST', ip: '203.0.113.9', role: 'SCHOOL_ADMIN' });
  });

  it('a dead fan-out does not fail the click (the durable rides still reach the screen)', async () => {
    const { svc, redis, screens } = setup();
    redis.publish.mockRejectedValue(new Error('redis down'));
    const v = await svc.request(admin(), 'scr-1', { kind: 'SELF_TEST' }, null);
    expect(screens.rows[0].pendingDiagnosticsId).toBe(v.id);
  });

  it('one open request per screen', async () => {
    const { svc } = setup();
    await svc.request(admin(), 'scr-1', { kind: 'SELF_TEST' }, null);
    await expect(svc.request(admin(), 'scr-1', { kind: 'SELF_TEST' }, null)).rejects.toMatchObject({ status: 409 });
  });

  it('logs are refused to a school admin and allowed to a district admin', async () => {
    const { svc } = setup();
    await expect(svc.request(admin('SCHOOL_ADMIN'), 'scr-1', { kind: 'LOGS' }, null)).rejects.toMatchObject({ status: 403 });
    const v = await svc.request(admin('DISTRICT_ADMIN'), 'scr-1', { kind: 'LOGS', minutes: 30 }, null);
    expect(v.kind).toBe('LOGS');
    expect(v.minutes).toBe(30);
  });

  it('a logs request whose audit row cannot be written is refused and never reaches the screen', async () => {
    const { svc, audit, screens, redis } = setup();
    audit.create.mockRejectedValue(new Error('db'));
    await expect(svc.request(admin(), 'scr-1', { kind: 'LOGS' }, null)).rejects.toMatchObject({ status: 503 });
    expect(screens.rows[0].pendingDiagnosticsId).toBeNull();
    expect(redis.publish).not.toHaveBeenCalled();
  });

  it('TENANT ISOLATION: another organisation’s screen is not found', async () => {
    const { svc } = setup();
    await expect(svc.request(admin('DISTRICT_ADMIN', T1), 'scr-2', { kind: 'SELF_TEST' }, null)).rejects.toMatchObject({ status: 404 });
    await expect(svc.view(admin('DISTRICT_ADMIN', T1), 'scr-2')).rejects.toMatchObject({ status: 404 });
  });

  it('the kill switch refuses new requests', async () => {
    const { svc } = setup();
    process.env.SCREEN_DIAGNOSTICS_DISABLED = '1';
    await expect(svc.request(admin(), 'scr-1', { kind: 'SELF_TEST' }, null)).rejects.toMatchObject({ status: 503 });
  });
});

describe('the device answers by value', () => {
  const native = {
    storage: { freeBytes: 6e9, totalBytes: 8e9, writeOk: true, writeMs: 3 },
    clock: { skewMs: 100 }, tls: { ok: true, chainLength: 3, leafDaysLeft: 50 },
    dns: { ok: true, ms: 10, count: 1 }, api: { ok: true, status: 200, ms: 90 },
    net: { transport: 'ethernet', validated: true, captivePortal: false, ipKind: 'private', ip: '10.0.x.x', gateway: '10.0.x.x' },
    webview: { major: 120, versionName: '120.0' },
  };
  const page = { chromeMajor: 120, legacyPolyfills: false, manifestAgeMs: 5_000, apiOk: true, apiRoundTripMs: 90,
    origin: { usage: 1e6, quota: 160e6 }, emergency: { readable: true, entries: 3, bytes: 1e6 } };

  it('both halves → COMPLETE with a verdict, and the marker is cleared only for THIS id', async () => {
    const { svc, screens, requests } = setup();
    const v = await svc.request(admin(), 'scr-1', { kind: 'SELF_TEST' }, null);
    deviceOk('scr-1', T1);
    await svc.acceptNative({} as any, 'scr-1', v.id, native);
    expect(screens.rows[0].pendingDiagnosticsId).toBe(v.id); // page may still answer
    await svc.acceptPage({} as any, 'scr-1', v.id, page);
    expect(requests.rows[0].status).toBe('COMPLETE');
    expect(requests.rows[0].verdict).toBe('pass');
    expect(screens.rows[0].pendingDiagnosticsId).toBeNull();
    const view = await svc.view(admin(), 'scr-1');
    expect(view.selfTest!.verdict).toBe('pass');
    expect(view.selfTest!.checks).toHaveLength(13);
  });

  it('a second answer for a closed request is refused (410), never re-applied', async () => {
    const { svc } = setup();
    const v = await svc.request(admin(), 'scr-1', { kind: 'SELF_TEST' }, null);
    deviceOk('scr-1', T1);
    await svc.acceptNative({} as any, 'scr-1', v.id, native);
    await svc.acceptPage({} as any, 'scr-1', v.id, page);
    await expect(svc.acceptNative({} as any, 'scr-1', v.id, native)).rejects.toMatchObject({ status: 410 });
  });

  it('an unauthenticated device is refused', async () => {
    const { svc } = setup();
    const v = await svc.request(admin(), 'scr-1', { kind: 'SELF_TEST' }, null);
    (verifyDeviceForScreen as jest.Mock).mockResolvedValue({ ok: false, reason: 'no-token' });
    await expect(svc.acceptNative({} as any, 'scr-1', v.id, native)).rejects.toMatchObject({ status: 401 });
  });

  it('TENANT ISOLATION: a device of another tenant cannot answer this request', async () => {
    const { svc, requests } = setup();
    const v = await svc.request(admin(), 'scr-1', { kind: 'SELF_TEST' }, null);
    deviceOk('scr-2', T2);
    await expect(svc.acceptNative({} as any, 'scr-2', v.id, native)).rejects.toMatchObject({ status: 404 });
    expect(requests.rows[0].nativeAt).toBeNull();
  });
});

describe('logs on demand', () => {
  it('ticket → upload → redacted bundle in the private bucket, audited; download URL audited', async () => {
    const { svc, storage, audit, requests, screens } = setup();
    const v = await svc.request(admin(), 'scr-1', { kind: 'LOGS', minutes: 10 }, null);
    deviceOk('scr-1', T1);
    const t = await svc.issueTicket({} as any, 'scr-1', v.id);
    expect(t.minutes).toBe(10);
    await expect(svc.acceptLogs({} as any, 'scr-1', v.id, 'forged.ticket', { player: 'x' })).rejects.toMatchObject({ status: 403 });
    const out = await svc.acceptLogs({} as any, 'scr-1', v.id, t.ticket, {
      player: 'D/Net: Bearer eyJabc.def.ghi wifi psk=secretpass user ops@example.org',
      manager: 'I/Mgr: watchdog ok',
    });
    expect(out.ok).toBe(true);
    const [bucket, key, buf] = storage.uploadToBucket.mock.calls[0];
    expect(bucket).toBe('device-logs-private');
    expect(key).toBe(`${T1}/scr-1/${v.id}.txt`);
    const text = (buf as Buffer).toString('utf8');
    expect(text).not.toMatch(/eyJabc|secretpass|ops@example/);
    expect(text).toMatch(/watchdog ok/);
    expect(requests.rows[0].status).toBe('COMPLETE');
    expect(screens.rows[0].pendingDiagnosticsId).toBeNull();
    expect(audit.rows.map((r) => r.action)).toEqual([DIAGNOSTICS_AUDIT.REQUESTED, DIAGNOSTICS_AUDIT.LOGS_UPLOADED]);

    await expect(svc.logsUrl(admin('SCHOOL_ADMIN'), 'scr-1', v.id, null)).rejects.toMatchObject({ status: 403 });
    const url = await svc.logsUrl(admin(), 'scr-1', v.id, '198.51.100.1');
    expect(url.expiresInSeconds).toBe(300);
    expect(storage.createSignedUrl).toHaveBeenCalledWith(key, 300, 'device-logs-private');
    expect(audit.rows[2].action).toBe(DIAGNOSTICS_AUDIT.LOGS_DOWNLOADED);
  });

  it('TENANT ISOLATION: another organisation cannot download the bundle', async () => {
    const { svc } = setup();
    const v = await svc.request(admin(), 'scr-1', { kind: 'LOGS' }, null);
    await expect(svc.logsUrl(admin('DISTRICT_ADMIN', T2), 'scr-1', v.id, null)).rejects.toMatchObject({ status: 404 });
  });

  it('the device can report it could not collect logs', async () => {
    const { svc, requests } = setup();
    const v = await svc.request(admin(), 'scr-1', { kind: 'LOGS' }, null);
    deviceOk('scr-1', T1);
    await svc.acceptNative({} as any, 'scr-1', v.id, { kind: 'LOGS', error: 'logcat-unavailable' });
    expect(requests.rows[0]).toMatchObject({ status: 'FAILED', failureReason: 'logcat-unavailable' });
  });
});

describe('retention', () => {
  it('purges bundles past the window, audits each, then deletes old rows whose bundle is gone', async () => {
    const { prisma, storage, requests, audit } = setup();
    const now = new Date('2026-12-01T00:00:00Z');
    const old = new Date(now.getTime() - 8 * 86_400_000);
    const ancient = new Date(now.getTime() - 100 * 86_400_000);
    requests.rows.push(
      { id: 'a', tenantId: T1, screenId: 'scr-1', kind: 'LOGS', createdAt: old, logObjectKey: 'k/a.txt', logPurgedAt: null },
      { id: 'b', tenantId: T1, screenId: 'scr-1', kind: 'LOGS', createdAt: now, logObjectKey: 'k/b.txt', logPurgedAt: null },
      { id: 'c', tenantId: T2, screenId: 'scr-2', kind: 'SELF_TEST', createdAt: ancient, logObjectKey: null, logPurgedAt: null },
    );
    const cron = new ScreenDiagnosticsRetentionCron(prisma, storage);
    const r = await cron.sweep(now);
    expect(r).toEqual({ purged: 1, deleted: 1 });
    expect(storage.deleteManyFromBucket).toHaveBeenCalledWith('device-logs-private', ['k/a.txt']);
    expect(requests.rows.find((x) => x.id === 'a')!.logPurgedAt).toEqual(now);
    expect(requests.rows.find((x) => x.id === 'b')!.logPurgedAt).toBeNull();
    expect(requests.rows.find((x) => x.id === 'c')).toBeUndefined();
    expect(audit.rows).toEqual([expect.objectContaining({ action: DIAGNOSTICS_AUDIT.LOGS_PURGED, tenantId: T1, targetId: 'scr-1' })]);
  });
});

describe('the native heartbeat ride', () => {
  it('carries the open request, records delivery once, and closes an expired one', async () => {
    const { svc, prisma, screens, requests } = setup();
    const v = await svc.request(admin(), 'scr-1', { kind: 'SELF_TEST' }, null);
    const out = await diagnosticsHeartbeat({ prisma }, screens.rows[0] as any, {});
    expect(out).toEqual({ diagnostics: { id: v.id, kind: 'SELF_TEST' } });
    expect(requests.rows[0].deliveredAt).toBeInstanceOf(Date);
    const late = new Date(Date.now() + 11 * 60_000);
    const gone = await diagnosticsHeartbeat({ prisma }, { ...screens.rows[0] } as any, {}, late);
    expect(gone).toEqual({});
    expect(screens.rows[0].pendingDiagnosticsId).toBeNull();
    expect(requests.rows[0].status).toBe('EXPIRED');
  });

  it('an idle screen with no header costs no query', async () => {
    const { prisma, screens, health, requests } = setup();
    await diagnosticsHeartbeat({ prisma }, screens.rows[0] as any, {});
    expect(health.findFirst).not.toHaveBeenCalled();
    expect(requests.updateMany).not.toHaveBeenCalled();
  });
});

describe('storage health and the pre-degradation warning', () => {
  it('a near-full disk raises "almost full" once (bell, deduped per day), never an email', async () => {
    const { prisma, screens, health, notifications } = setup();
    registerStorageNotifier(notifications);
    const hdr = JSON.stringify({ schema: 1, freeBytes: 600 * 1024 * 1024, totalBytes: 8 * 1024 ** 3, writeOk: true, writeMs: 5 });
    await diagnosticsHeartbeat({ prisma }, screens.rows[0] as any, { [STORAGE_HEADER]: hdr });
    expect(health.rows[0]).toMatchObject({ screenId: 'scr-1', tenantId: T1, warning: 'almost-full' });
    expect(notifications.notify).toHaveBeenCalledTimes(1);
    expect(notifications.notify.mock.calls[0][0]).toMatchObject({ kind: 'INFO', title: 'Storage almost full: Lobby', tenantId: T1 });
    expect(notifications.notify.mock.calls[0][0].dedupeKey).toMatch(/^storage-low:scr-1:\d{4}-\d{2}-\d{2}$/);
    await diagnosticsHeartbeat({ prisma }, screens.rows[0] as any, { [STORAGE_HEADER]: hdr });
    expect(notifications.notify).toHaveBeenCalledTimes(1); // no repeat while it stays low
    registerStorageNotifier(null);
  });

  it('the page half (origin quota) also grades; the kill switch silences grade and bell', async () => {
    const { svc, health, notifications } = setup();
    deviceOk('scr-1', T1);
    process.env.SCREEN_STORAGE_WARNINGS_DISABLED = '1';
    const r = await svc.acceptPageStorage({} as any, 'scr-1', { origin: { usage: 158e6, quota: 160e6 }, emergency: { readable: true, entries: 4, bytes: 9e6 } });
    expect(r.warning).toBeNull();
    expect(notifications.notify).not.toHaveBeenCalled();
    delete process.env.SCREEN_STORAGE_WARNINGS_DISABLED;
    const r2 = await svc.acceptPageStorage({} as any, 'scr-1', { origin: { usage: 158e6, quota: 160e6 } });
    expect(r2.warning).toBe('critical');
    expect(health.rows[0].page.origin.usage).toBe(158e6);
  });

  it('an unreadable header says nothing', async () => {
    const { prisma, screens, health } = setup();
    await diagnosticsHeartbeat({ prisma }, screens.rows[0] as any, { [STORAGE_HEADER]: '{"schema":2}' });
    await diagnosticsHeartbeat({ prisma }, screens.rows[0] as any, { [STORAGE_HEADER]: 'garbage' });
    expect(health.rows).toHaveLength(0);
  });
});
