/**
 * FieldBuildsService against an in-memory database: arming, cancelling and
 * pushing, the audit rows each writes, support-access reach, and the gate's
 * cached read. The registry entry is the real one; only storage, Redis and
 * the signer are doubles.
 */
import { randomUUID } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import { FIELD_AUDIT, FieldBuildsService } from './field-builds.service';
import * as mirror from './field-mirror';
import { PUSH_SETTLE_MS, GATE_TTL_MS } from './field-builds.policy';
import { activeFieldWindow, setActiveFieldWindow } from '../player-ota/field-candidate';
import { FIELD_CANDIDATE_RELEASES } from '../player-ota/field-candidate-releases';
import { runWithSupportAccess } from '../support-access/support-access.context';
import { SupportAccessService } from '../support-access/support-access.service';

const CANDIDATE = '1.1.42-field.1';
const RELEASE = FIELD_CANDIDATE_RELEASES[CANDIDATE];
const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const T_CUSTOMER = '99999999-9999-4999-8999-999999999999';
const S1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const S2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const S3 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3';
const S_REVOKED = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9';
const S_CUSTOMER = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';
const T0 = Date.UTC(2026, 9, 18, 15, 0, 0);

const owner = { id: 'super-1', userId: 'super-1', role: 'SUPER_ADMIN', email: 'owner@example.test' };

// ─── a tiny Prisma stand-in: just the queries this service makes ──────────
type Row = Record<string, any>;
const val = (v: any) => (v instanceof Date ? v.getTime() : v);
function matches(row: Row, where?: Row): boolean {
  if (!where) return true;
  return Object.entries(where).every(([k, cond]) => {
    const v = row[k];
    if (cond === null) return v === null || v === undefined;
    if (cond instanceof Date) return v instanceof Date && v.getTime() === cond.getTime();
    if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
      if ('in' in cond) return cond.in.includes(v);
      if ('gt' in cond) return v != null && val(v) > val(cond.gt);
      if ('contains' in cond) return typeof v === 'string' && v.includes(cond.contains);
    }
    return v === cond;
  });
}
function order(rows: Row[], orderBy?: Row | Row[]): Row[] {
  const keys = (Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : []).map((o) => Object.entries(o)[0]);
  return [...rows].sort((a, b) => {
    for (const [k, dir] of keys) {
      if (val(a[k]) < val(b[k])) return dir === 'asc' ? -1 : 1;
      if (val(a[k]) > val(b[k])) return dir === 'asc' ? 1 : -1;
    }
    return 0;
  });
}
const pick = (row: Row, select?: Row) =>
  select ? Object.fromEntries(Object.keys(select).filter((k) => select[k]).map((k) => [k, row[k]])) : { ...row };

function fakeDb() {
  const db = {
    windows: [] as Row[],
    tenants: [
      { id: T1, name: 'Bench' },
      { id: T2, name: 'Demo' },
      { id: T_CUSTOMER, name: 'Customer' },
    ] as Row[],
    screens: [
      { id: S1, tenantId: T1, name: 'Lobby', status: 'ONLINE', lastPingAt: new Date(T0 - 5_000), playerVersion: '1.1.29', playerVersionCode: 10129, playerVersionAt: new Date(T0 - 60_000), forceApkUpdatePendingAt: null, forceApkUpdateOverrideWindow: false, forceApkUpdateOfferCount: 0 },
      { id: S2, tenantId: T1, name: 'Gym', status: 'ONLINE', lastPingAt: new Date(T0 - 900_000), playerVersion: '1.1.41-field.1', playerVersionCode: 10141, playerVersionAt: null, forceApkUpdatePendingAt: null, forceApkUpdateOverrideWindow: false, forceApkUpdateOfferCount: 0 },
      { id: S3, tenantId: T2, name: 'Wall', status: 'ONLINE', lastPingAt: null, playerVersion: null, playerVersionCode: null, playerVersionAt: null, forceApkUpdatePendingAt: null, forceApkUpdateOverrideWindow: false, forceApkUpdateOfferCount: 0 },
      { id: S_REVOKED, tenantId: T1, name: 'Old', status: 'REVOKED', lastPingAt: null, forceApkUpdatePendingAt: null, forceApkUpdateOfferCount: 0 },
      { id: S_CUSTOMER, tenantId: T_CUSTOMER, name: 'Theirs', status: 'ONLINE', lastPingAt: null, forceApkUpdatePendingAt: null, forceApkUpdateOfferCount: 0 },
    ] as Row[],
    audit: [] as Row[],
    log: [] as string[],
  };
  const reads = { windowFindFirst: 0 };
  const failNext = { windowRead: false, audit: false };
  const model = (rows: () => Row[]) => ({
    findFirst: async ({ where, orderBy, select }: any = {}) => {
      const r = order(rows().filter((x) => matches(x, where)), orderBy)[0];
      return r ? pick(r, select) : null;
    },
    findMany: async ({ where, orderBy, select, take }: any = {}) =>
      order(rows().filter((x) => matches(x, where)), orderBy)
        .slice(0, take ?? Infinity)
        .map((r) => pick(r, select)),
    findUnique: async ({ where, select }: any) => {
      const r = rows().find((x) => matches(x, where));
      return r ? pick(r, select) : null;
    },
  });
  const windows = model(() => db.windows);
  const client: any = {
    fieldBuildWindow: {
      ...windows,
      findFirst: async (args: any) => {
        reads.windowFindFirst++;
        if (failNext.windowRead) {
          failNext.windowRead = false;
          throw new Error('db unavailable');
        }
        return windows.findFirst(args);
      },
      create: async ({ data, select }: any) => {
        // The migration's CHECK: at most 24 h from arming.
        if (!(data.expiresAt > data.armedAt) || data.expiresAt - data.armedAt > 24 * 3_600_000) throw new Error('check violation');
        const row = {
          id: randomUUID(),
          screenIds: [],
          allScreens: false,
          armedByUserId: null,
          armedByEmail: null,
          cancelledAt: null,
          cancelledByUserId: null,
          cancelledByEmail: null,
          note: null,
          ...data,
        };
        db.windows.push(row);
        return pick(row, select);
      },
      updateMany: async ({ where, data }: any) => {
        const hit = db.windows.filter((x) => matches(x, where));
        hit.forEach((x) => Object.assign(x, data));
        return { count: hit.length };
      },
    },
    tenant: model(() => db.tenants),
    screen: {
      ...model(() => db.screens),
      update: async ({ where, data }: any) => {
        const r = db.screens.find((x) => matches(x, where));
        if (!r) throw new Error('P2025');
        db.log.push(`screen.update:${r.id}`);
        Object.assign(r, data);
        return r;
      },
      updateMany: async ({ where, data }: any) => {
        const hit = db.screens.filter((x) => matches(x, where));
        hit.forEach((x) => Object.assign(x, data));
        return { count: hit.length };
      },
    },
    auditLog: {
      ...model(() => db.audit),
      create: async ({ data }: any) => {
        if (failNext.audit) {
          failNext.audit = false;
          throw new Error('audit unavailable');
        }
        db.log.push(`audit:${data.action}:${data.targetId}`);
        const row = { id: randomUUID(), ...data };
        db.audit.push(row);
        return row;
      },
    },
    $executeRaw: async () => 1,
    $transaction: async (fn: (tx: any) => Promise<any>) => {
      const snap = { windows: db.windows.map((r) => ({ ...r })), audit: [...db.audit] };
      try {
        return await fn(client);
      } catch (e) {
        db.windows.splice(0, db.windows.length, ...snap.windows);
        db.audit.splice(0, db.audit.length, ...snap.audit);
        throw e;
      }
    },
  };
  return { db, reads, failNext, prisma: { client } as any };
}

function harness() {
  const f = fakeDb();
  const redis = { publish: jest.fn(async () => 1) };
  const signer = { signMessage: jest.fn((type: string, payload: unknown) => JSON.stringify({ type, payload })) };
  const svc = new FieldBuildsService(f.prisma, redis as any, signer as any);
  return { ...f, svc, redis, signer };
}

const codeOf = async (p: Promise<unknown>): Promise<{ status: number; code: string; body: any }> => {
  try {
    await p;
  } catch (e) {
    if (e instanceof HttpException) {
      const body = e.getResponse() as any;
      return { status: e.getStatus(), code: body?.code, body };
    }
    throw e;
  }
  throw new Error('expected a refusal');
};

/** A support-access frame in which `refused` tenants are out of reach. */
const withReach = <T>(refused: string[], fn: () => Promise<T>) =>
  runWithSupportAccess(
    {
      service: {
        assertReach: async (_u: unknown, tenantId: string) => {
          if (refused.includes(tenantId)) throw SupportAccessService.refusal();
          return { allowed: true, basis: 'internal', grantId: null, rootTenantId: tenantId };
        },
      } as any,
      workspace: null,
    },
    fn,
  );

let now = T0;
const setNow = (t: number) => {
  now = t;
  jest.setSystemTime(t);
};

beforeEach(() => {
  jest.useFakeTimers({
    doNotFake: ['hrtime', 'nextTick', 'performance', 'queueMicrotask', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'],
  });
  setNow(T0);
  setActiveFieldWindow(null);
  jest.spyOn(mirror, 'fieldMirrorStatus').mockResolvedValue({ state: 'present', httpStatus: 200, checkedAt: new Date(T0).toISOString() });
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
  setActiveFieldWindow(null);
  delete process.env.PLAYER_APK_QUARANTINE;
});

const armBody = (patch: Record<string, unknown> = {}) => ({
  candidate: CANDIDATE,
  tenantIds: [T1, T2],
  screens: [S1, S3],
  durationMinutes: 120,
  note: 'pacing soak',
  ...patch,
});

describe('arm', () => {
  it('stores the window with the registry digest, audits every organisation, and the gate sees it at once', async () => {
    const h = harness();
    const view = await h.svc.arm(owner, armBody());
    expect(h.db.windows).toHaveLength(1);
    const row = h.db.windows[0];
    expect(row).toMatchObject({
      candidate: CANDIDATE,
      candidateSha256: RELEASE.sha256,
      tenantIds: [T1, T2],
      screenIds: [S1, S3],
      allScreens: false,
      armedByUserId: 'super-1',
      armedByEmail: 'owner@example.test',
      note: 'pacing soak',
    });
    expect(row.armedAt.getTime()).toBe(T0);
    expect(row.expiresAt.getTime()).toBe(T0 + 120 * 60_000);
    expect(view).toMatchObject({ state: 'active', versionCode: RELEASE.versionCode, tenants: [{ id: T1, name: 'Bench' }, { id: T2, name: 'Demo' }] });

    const rows = h.db.audit.filter((a) => a.action === FIELD_AUDIT.ARM);
    expect(rows.map((a) => a.tenantId)).toEqual([T1, T2]);
    for (const a of rows) {
      expect(a).toMatchObject({ userId: 'super-1', targetType: 'field_build_window', targetId: row.id });
      expect(JSON.parse(a.details)).toMatchObject({
        candidate: CANDIDATE,
        sha256: RELEASE.sha256,
        screens: [S1, S3],
        tenantIds: [T1, T2],
        expiresAt: new Date(T0 + 120 * 60_000).toISOString(),
        actorEmail: 'owner@example.test',
      });
    }
    // The update check reads it through field-candidate.ts's default argument.
    expect(activeFieldWindow()).toMatchObject({ id: row.id, candidate: CANDIDATE, candidateSha256: RELEASE.sha256 });
  });

  it('`all` screens is stored as a flag with no list, and audited as "all"', async () => {
    const h = harness();
    await h.svc.arm(owner, armBody({ screens: 'all', tenantIds: [T1] }));
    expect(h.db.windows[0]).toMatchObject({ allScreens: true, screenIds: [] });
    expect(JSON.parse(h.db.audit[0].details).screens).toBe('all');
  });

  it('one window at a time: a second arm is 409 and writes nothing', async () => {
    const h = harness();
    await h.svc.arm(owner, armBody());
    const before = h.db.audit.length;
    expect(await codeOf(h.svc.arm(owner, armBody({ durationMinutes: 60 })))).toMatchObject({ status: 409, code: 'FIELD_BUILD_WINDOW_ACTIVE' });
    expect(h.db.windows).toHaveLength(1);
    expect(h.db.audit).toHaveLength(before);
  });

  it('expiry above 24 h is refused before anything is read', async () => {
    const h = harness();
    expect(await codeOf(h.svc.arm(owner, armBody({ durationMinutes: 24 * 60 + 1 })))).toMatchObject({ status: 400, code: 'FIELD_BUILD_DURATION_INVALID' });
    expect(h.db.windows).toHaveLength(0);
  });

  it('an unregistered or quarantined candidate is refused', async () => {
    const h = harness();
    expect(await codeOf(h.svc.arm(owner, armBody({ candidate: '1.1.99-field.1' })))).toMatchObject({ status: 422, code: 'FIELD_BUILD_CANDIDATE_UNAVAILABLE' });
    process.env.PLAYER_APK_QUARANTINE = CANDIDATE;
    expect(await codeOf(h.svc.arm(owner, armBody()))).toMatchObject({ status: 422, code: 'FIELD_BUILD_CANDIDATE_UNAVAILABLE' });
    expect(h.db.windows).toHaveLength(0);
  });

  it('every screen must belong to a listed organisation and not be revoked; organisations must exist', async () => {
    const h = harness();
    expect(await codeOf(h.svc.arm(owner, armBody({ tenantIds: [T1], screens: [S1, S3] })))).toMatchObject({ code: 'FIELD_BUILD_SCREEN_NOT_IN_TENANTS' });
    expect(await codeOf(h.svc.arm(owner, armBody({ tenantIds: [T1], screens: [S_REVOKED] })))).toMatchObject({ code: 'FIELD_BUILD_SCREEN_REVOKED' });
    expect(await codeOf(h.svc.arm(owner, armBody({ tenantIds: [T1, '12345678-1234-4234-8234-123456789012'] })))).toMatchObject({ code: 'FIELD_BUILD_TENANT_NOT_FOUND' });
    expect(h.db.windows).toHaveLength(0);
    expect(h.db.audit).toHaveLength(0);
  });

  it('needs support-access reach to every organisation it names', async () => {
    const h = harness();
    const r = await codeOf(withReach([T_CUSTOMER], () => h.svc.arm(owner, armBody({ tenantIds: [T1, T_CUSTOMER], screens: 'all' }))));
    expect(r).toMatchObject({ status: 403, code: 'SUPPORT_ACCESS_REQUIRED' });
    expect(h.db.windows).toHaveLength(0);
    await withReach([T_CUSTOMER], () => h.svc.arm(owner, armBody({ tenantIds: [T1] , screens: [S1] })));
    expect(h.db.windows).toHaveLength(1);
  });
});

describe('cancel', () => {
  it('closes the window, audits every organisation, and the gate drops it at once; a second cancel writes nothing', async () => {
    const h = harness();
    const w = await h.svc.arm(owner, armBody());
    setNow(T0 + 60_000);
    const out = await h.svc.cancel(owner, w.id, { reason: 'regression on the M43' });
    expect(out).toMatchObject({ cancelled: true, window: { state: 'cancelled', cancelledBy: { userId: 'super-1' } } });
    expect(h.db.windows[0].cancelledAt.getTime()).toBe(T0 + 60_000);
    const rows = h.db.audit.filter((a) => a.action === FIELD_AUDIT.CANCEL);
    expect(rows.map((a) => a.tenantId)).toEqual([T1, T2]);
    expect(JSON.parse(rows[0].details)).toMatchObject({
      candidate: CANDIDATE,
      sha256: RELEASE.sha256,
      screens: [S1, S3],
      reason: 'regression on the M43',
      actorEmail: 'owner@example.test',
    });
    expect(activeFieldWindow()).toBeNull();
    const again = await h.svc.cancel(owner, w.id, {});
    expect(again.cancelled).toBe(false);
    expect(h.db.audit.filter((a) => a.action === FIELD_AUDIT.CANCEL)).toHaveLength(2);
  });

  it('cancels exactly the pushes this window armed that are still waiting — never a later push', async () => {
    const h = harness();
    const w = await h.svc.arm(owner, armBody());
    setNow(T0 + PUSH_SETTLE_MS);
    await h.svc.push(owner, w.id, { screenIds: [S1] });
    await h.svc.push(owner, w.id, { screenIds: [S3] });
    // Someone re-pushes S3 from the dashboard afterwards: that push is theirs.
    const theirs = new Date(T0 + PUSH_SETTLE_MS + 5_000);
    h.db.screens.find((s) => s.id === S3)!.forceApkUpdatePendingAt = theirs;
    setNow(T0 + PUSH_SETTLE_MS + 10_000);
    const out = await h.svc.cancel(owner, w.id, {});
    expect(out.pushesCancelled).toEqual([S1]);
    expect(h.db.screens.find((s) => s.id === S1)!.forceApkUpdatePendingAt).toBeNull();
    expect(h.db.screens.find((s) => s.id === S3)!.forceApkUpdatePendingAt).toEqual(theirs);
    const cancelRows = h.db.audit.filter((a) => a.action === FIELD_AUDIT.PUSH_CANCEL);
    expect(cancelRows).toHaveLength(1);
    expect(cancelRows[0]).toMatchObject({ targetId: S1, tenantId: T1, userId: 'super-1' });
    expect(JSON.parse(cancelRows[0].details)).toMatchObject({ windowId: w.id, candidate: CANDIDATE, sha256: RELEASE.sha256, reason: 'window-cancelled' });
  });

  it('cancelling needs no reach (stopping an offer is always allowed); an unknown window is 404', async () => {
    const h = harness();
    const w = await h.svc.arm(owner, armBody());
    const out = await withReach([T1, T2], () => h.svc.cancel(owner, w.id, {}));
    expect(out.cancelled).toBe(true);
    expect(await codeOf(h.svc.cancel(owner, randomUUID(), {}))).toMatchObject({ status: 404, code: 'FIELD_BUILD_WINDOW_NOT_FOUND' });
  });
});

describe('push now', () => {
  async function armed(patch: Record<string, unknown> = {}) {
    const h = harness();
    const w = await h.svc.arm(owner, armBody(patch));
    return { h, w };
  }

  it('waits until every replica has seen the window', async () => {
    const { h, w } = await armed();
    setNow(T0 + PUSH_SETTLE_MS - 1_000);
    expect(await codeOf(h.svc.push(owner, w.id, { screenIds: [S1] }))).toMatchObject({
      status: 409,
      code: 'FIELD_BUILD_WINDOW_SETTLING',
      body: { retryAfterMs: 1_000 },
    });
    expect(h.db.log.filter((l) => l.startsWith('screen.update'))).toHaveLength(0);
  });

  it('audits, THEN arms the same push the dashboard does, and nudges the screen', async () => {
    const { h, w } = await armed();
    setNow(T0 + PUSH_SETTLE_MS);
    const out = await h.svc.push(owner, w.id, { screenIds: [S1], overrideWindow: true });
    expect(out.results).toEqual([
      expect.objectContaining({ screenId: S1, name: 'Lobby', armed: true, published: true, pushAt: new Date(T0 + PUSH_SETTLE_MS).toISOString() }),
    ]);
    // Order: the audit row exists before the screen is touched.
    expect(h.db.log.filter((l) => l.includes(S1))).toEqual([`audit:${FIELD_AUDIT.PUSH}:${S1}`, `screen.update:${S1}`]);
    const row = h.db.audit.find((a) => a.action === FIELD_AUDIT.PUSH)!;
    expect(row).toMatchObject({ tenantId: T1, userId: 'super-1', targetType: 'screen', targetId: S1 });
    const d = JSON.parse(row.details);
    expect(d).toMatchObject({ windowId: w.id, candidate: CANDIDATE, sha256: RELEASE.sha256, overrideWindow: true, actorEmail: 'owner@example.test' });
    // The screen carries exactly the push identity the row recorded.
    const s = h.db.screens.find((x) => x.id === S1)!;
    expect(s.forceApkUpdatePendingAt.toISOString()).toBe(d.pushAt);
    expect(s.forceApkUpdateOverrideWindow).toBe(true);
    expect(s.forceApkUpdateOfferCount).toBe(0);
    expect(h.signer.signMessage).toHaveBeenCalledWith('CHECK_FOR_UPDATES', expect.objectContaining({ scopeId: S1, tenantId: T1, corrId: d.corrId }));
    expect(h.redis.publish).toHaveBeenCalledWith(`tenant:${T1}`, expect.any(String));
  });

  it('only screens inside the window: not named, another organisation, or revoked is 422 and nothing is armed', async () => {
    const { h, w } = await armed({ tenantIds: [T1], screens: [S1] });
    setNow(T0 + PUSH_SETTLE_MS);
    for (const screenIds of [[S2], [S3], [S_CUSTOMER], [S1, S2]]) {
      expect(await codeOf(h.svc.push(owner, w.id, { screenIds }))).toMatchObject({ status: 422, code: 'FIELD_BUILD_SCREEN_OUTSIDE_WINDOW' });
    }
    expect(h.db.audit.filter((a) => a.action === FIELD_AUDIT.PUSH)).toHaveLength(0);
    expect(h.db.log.filter((l) => l.startsWith('screen.update'))).toHaveLength(0);
  });

  it('`all` covers every screen of the listed organisations, never a revoked one', async () => {
    const { h, w } = await armed({ tenantIds: [T1], screens: 'all' });
    setNow(T0 + PUSH_SETTLE_MS);
    const out = await h.svc.push(owner, w.id, { screenIds: [S2] });
    expect(out.results[0]).toMatchObject({ screenId: S2, armed: true });
    expect(await codeOf(h.svc.push(owner, w.id, { screenIds: [S_REVOKED] }))).toMatchObject({ code: 'FIELD_BUILD_SCREEN_OUTSIDE_WINDOW' });
  });

  it('refuses when the private copy is missing (a screen would just stay put)', async () => {
    const { h, w } = await armed();
    setNow(T0 + PUSH_SETTLE_MS);
    for (const state of ['missing', 'size-mismatch', 'unconfigured'] as const) {
      jest.mocked(mirror.fieldMirrorStatus).mockResolvedValueOnce({ state, checkedAt: new Date(now).toISOString() });
      expect(await codeOf(h.svc.push(owner, w.id, { screenIds: [S1] }))).toMatchObject({ status: 409, code: 'FIELD_BUILD_MIRROR_MISSING' });
    }
    // A probe that could not run does not block: the offer path verifies the bytes anyway.
    jest.mocked(mirror.fieldMirrorStatus).mockResolvedValueOnce({ state: 'unknown', checkedAt: new Date(now).toISOString() });
    expect((await h.svc.push(owner, w.id, { screenIds: [S1] })).results[0].armed).toBe(true);
  });

  it('a cancelled or expired window, or one quarantined since arming, cannot push', async () => {
    const { h, w } = await armed();
    setNow(T0 + PUSH_SETTLE_MS);
    process.env.PLAYER_APK_QUARANTINE = CANDIDATE;
    expect(await codeOf(h.svc.push(owner, w.id, { screenIds: [S1] }))).toMatchObject({ code: 'FIELD_BUILD_CANDIDATE_UNAVAILABLE' });
    delete process.env.PLAYER_APK_QUARANTINE;
    setNow(T0 + 120 * 60_000);
    expect(await codeOf(h.svc.push(owner, w.id, { screenIds: [S1] }))).toMatchObject({ code: 'FIELD_BUILD_WINDOW_ENDED' });
    const h2 = harness();
    setNow(T0);
    const w2 = await h2.svc.arm(owner, armBody());
    await h2.svc.cancel(owner, w2.id, {});
    setNow(T0 + PUSH_SETTLE_MS);
    expect(await codeOf(h2.svc.push(owner, w2.id, { screenIds: [S1] }))).toMatchObject({ code: 'FIELD_BUILD_WINDOW_ENDED' });
  });

  it('needs reach to the screen’s organisation', async () => {
    const { h, w } = await armed();
    setNow(T0 + PUSH_SETTLE_MS);
    expect(await codeOf(withReach([T2], () => h.svc.push(owner, w.id, { screenIds: [S3] })))).toMatchObject({ status: 403, code: 'SUPPORT_ACCESS_REQUIRED' });
    expect(h.db.audit.filter((a) => a.action === FIELD_AUDIT.PUSH)).toHaveLength(0);
  });

  it('no audit row, no push', async () => {
    const { h, w } = await armed();
    setNow(T0 + PUSH_SETTLE_MS);
    h.failNext.audit = true;
    await expect(h.svc.push(owner, w.id, { screenIds: [S1] })).rejects.toThrow('audit unavailable');
    expect(h.db.screens.find((s) => s.id === S1)!.forceApkUpdatePendingAt).toBeNull();
    expect(h.redis.publish).not.toHaveBeenCalled();
  });
});

describe('the gate’s cached read', () => {
  it('one read per 10 s however many update checks arrive; a write refreshes at once', async () => {
    const h = harness();
    await Promise.all([h.svc.refreshGateWindow(), h.svc.refreshGateWindow(), h.svc.refreshGateWindow()]);
    expect(h.reads.windowFindFirst).toBe(1);
    setNow(T0 + GATE_TTL_MS - 1);
    await h.svc.refreshGateWindow();
    expect(h.reads.windowFindFirst).toBe(1);
    setNow(T0 + GATE_TTL_MS);
    await h.svc.refreshGateWindow();
    expect(h.reads.windowFindFirst).toBe(2);
    const w = await h.svc.arm(owner, armBody());
    expect(activeFieldWindow()?.id).toBe(w.id);
  });

  it('a failed read keeps the last window read and is retried after two seconds, not on every check', async () => {
    const h = harness();
    const w = await h.svc.arm(owner, armBody());
    setNow(T0 + GATE_TTL_MS);
    h.failNext.windowRead = true;
    await h.svc.refreshGateWindow();
    expect(activeFieldWindow()?.id).toBe(w.id);
    const reads = h.reads.windowFindFirst;
    await h.svc.refreshGateWindow();
    expect(h.reads.windowFindFirst).toBe(reads);
    setNow(T0 + GATE_TTL_MS + 2_000);
    await h.svc.refreshGateWindow();
    expect(h.reads.windowFindFirst).toBe(reads + 1);
  });
});

describe('reads for the panel', () => {
  it('screens: versions and push state for reachable organisations; the others are named, not shown', async () => {
    const h = harness();
    const out = await withReach([T_CUSTOMER], () => h.svc.listScreens(owner, `${T1},${T_CUSTOMER}`));
    expect(out.unreachable).toEqual([T_CUSTOMER]);
    expect(out.screens.map((s) => s.id).sort()).toEqual([S1, S2, S_REVOKED].sort());
    expect(out.screens.find((s) => s.id === S1)).toMatchObject({
      tenantName: 'Bench',
      online: true,
      playerVersion: '1.1.29',
      playerVersionCode: 10129,
      push: { pendingAt: null, hold: null, offers: 0 },
    });
    expect(out.screens.find((s) => s.id === S2)!.online).toBe(false);
    expect(await codeOf(h.svc.listScreens(owner, 'not-a-uuid'))).toMatchObject({ status: 400, code: 'FIELD_BUILD_TENANTS_INVALID' });
  });

  it('windows: says which source the gate follows', async () => {
    const h = harness();
    const saved = { ...process.env };
    try {
      for (const k of Object.keys(process.env)) if (k.startsWith('PLAYER_APK_FIELD_')) delete process.env[k];
      expect((await h.svc.listWindows()).effective).toBe('none');
      process.env.PLAYER_APK_FIELD_CANDIDATE = '1.1.41-field.1';
      process.env.PLAYER_APK_FIELD_TENANT_ID = T1;
      process.env.PLAYER_APK_FIELD_SCREEN_IDS = S1;
      process.env.PLAYER_APK_FIELD_EXPIRES_AT = new Date(T0 + 3_600_000).toISOString();
      expect((await h.svc.listWindows()).effective).toBe('variables');
      const w = await h.svc.arm(owner, armBody());
      const view = await h.svc.listWindows();
      expect(view.effective).toBe('window');
      expect(view.active).toMatchObject({ id: w.id, state: 'active', pushReadyAt: new Date(T0 + PUSH_SETTLE_MS).toISOString() });
      expect(view.windows).toHaveLength(1);
      expect(view.limits).toMatchObject({ maxMinutes: 1440, pushSettleMs: PUSH_SETTLE_MS });
    } finally {
      process.env = saved;
    }
  });

  it('candidates: the registry, newest first, with mirror presence and fleet policy', async () => {
    const h = harness();
    process.env.PLAYER_APK_QUARANTINE = CANDIDATE;
    const { candidates } = await h.svc.listCandidates();
    expect(candidates.length).toBe(Object.keys(FIELD_CANDIDATE_RELEASES).length);
    expect(candidates.map((c) => c.versionCode)).toEqual([...candidates.map((c) => c.versionCode)].sort((a, b) => b - a));
    const q = candidates.find((c) => c.versionName === CANDIDATE)!;
    expect(q).toMatchObject({ allowed: false, blockedReason: `version-quarantined:${CANDIDATE}`, sha256: RELEASE.sha256, mirror: { state: 'present' } });
    expect(candidates.find((c) => c.versionName === '1.1.41-field.1')).toMatchObject({ allowed: true, blockedReason: null });
  });
});
