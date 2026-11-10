/**
 * Synthetic emergency drill — INTEGRATION (design §7), styled on
 * emergency.success-path.spec.ts: the runner drives the REAL
 * `EmergencyController` (trigger, all-clear, broadcast, message all-clear)
 * and the panes report through the REAL render-proof handler
 * (`ScreensController.reportRenderProof`), over one stateful in-memory
 * database. The page's side of each report is built the way the player
 * builds it: the alert object the manifest / push raises, the shared paint
 * identity (held identical to the player's by the web parity test) and
 * `emergencyRenderHash`.
 *
 * Proven: a signed OVERRIDE reaches every face of a double-sided unit; the
 * override rows say `isDrill` and carry an `expiresAt` ≤ +180 s; the trigger
 * path's own `TRIGGER_EMERGENCY_DRILL` row names the drill runner (never
 * null); no customer record copy is queued; the watcher's painted proof gives
 * PASS and a withheld paint gives FAIL (render); the pushed-message drill
 * round-trips; after `expiresAt` the manifest carries no emergency.
 */
import 'reflect-metadata';
import * as crypto from 'crypto';
import * as jwt from 'jsonwebtoken';
import { emergencyPaintIdentity, emergencyRenderHash } from '@cms/api-types';

jest.mock('../../security/required-secret', () => ({
  requireSecret: (_name: string, opts?: { devFallback?: string }) => opts?.devFallback ?? 'test_secret_32_chars_padded_here_ok',
}));
jest.mock('../../screens/manifest-hot-cache', () => {
  const actual = jest.requireActual('../../screens/manifest-hot-cache');
  return { ...actual, shouldSkipEmergencyAudit: () => true, markEmergencyAuditWritten: () => undefined };
});

import { EmergencyController } from '../emergency.controller';
import { ScreensController } from '../../screens/screens.controller';
import { CustomerAlertEmailsService } from '../../notifications/customer-alerts/customer-alert-emails.service';
import { WebsocketSignerService } from '../../security/websocket-signer.service';
import { deviceSecretKeyRing } from '../../security/key-ring';
import { verifyWsHmac } from '../../security/ws-signature';
import { resetManifestCacheForTests } from '../../screens/manifest-hot-cache';
import { resetEmergencyRevForTests } from '../../screens/emergency-rev';
import { invalidateDeviceCredentialCache } from '../../screens/device-auth';
import { clearDisplayManifestCache } from '../../display/display-manifest';
import { SyntheticDrillRunner } from './synthetic-drill.runner';
import { DRILL_APPROVAL, DRILL_APPROVED_ACTION } from './synthetic-drill.policy';
import { readDrillConfig } from './synthetic-drill.config';
import { DRILL_RESULT_ACTION, DRILL_STARTED_ACTION, buildOverrideDrillBody, runnerPrincipal } from './synthetic-drill.policy';
import { mintDrillOverrideId, resetSyntheticDrillRegistryForTests } from './synthetic-drill.registry';

const SEC = 1_000;
/** 10:31 Los Angeles (PST), Monday 2026-11-02. */
const T0 = Date.parse('2026-11-02T18:31:00Z');
type Row = Record<string, any>;

function matches(r: Row, w: Row | undefined): boolean {
  if (!w) return true;
  for (const [k, c] of Object.entries(w)) {
    if (k === 'OR') {
      if (!(c as Row[]).some((o) => matches(r, o))) return false;
      continue;
    }
    if (k === 'AND') {
      if (!(c as Row[]).every((o) => matches(r, o))) return false;
      continue;
    }
    if (c && typeof c === 'object' && !(c instanceof Date) && !Array.isArray(c)) {
      if ('in' in c && !(c.in as unknown[]).includes(r[k])) return false;
      if ('not' in c && r[k] === c.not) return false;
      if ('gte' in c && !(r[k] >= c.gte)) return false;
      if ('gt' in c && !(r[k] > c.gt)) return false;
      if ('lte' in c && !(r[k] <= c.lte)) return false;
      continue;
    }
    if (c === null ? r[k] != null : r[k] !== c) return false;
  }
  return true;
}

function makeWorld() {
  const id = () => crypto.randomUUID();
  const FRONT = id();
  const BACK = id();
  const tenants = new Map<string, Row>();
  const screens = new Map<string, Row>();
  const overrides = new Map<string, Row>();
  const audit: Row[] = [];
  const users: Row[] = [];
  /** The approving SUPER_ADMIN — apart from `users`, which the attribution cases index. */
  const owners: Row[] = [];
  const messages: Row[] = [];
  const published: Array<{ channel: string; message: Row; at: number }> = [];

  tenants.set('bench', {
    id: 'bench', name: 'Bench', slug: 'bench', parentId: null, archivedAt: null, isInternal: true,
    emergencyStatus: 'INACTIVE', emergencyIsDrill: false, emergencyType: null, locationBasedEmergencyEnabled: false,
    posterStandardW: null, posterStandardH: null, otaWindowStart: null, otaWindowEnd: null, otaWindowTimezone: null,
  });
  const pane = (sid: string, over: Row = {}) =>
    screens.set(sid, {
      id: sid, name: sid === FRONT ? 'DH43' : 'DH43 — Back', tenantId: 'bench', screenGroupId: null, status: 'ONLINE',
      pairedAt: new Date(T0 - 30 * 24 * 3600_000), lastPingAt: new Date(T0 - 5 * SEC), lastRenderedHash: 'pl:sig',
      lastRenderedAt: new Date(T0 - 10 * SEC), faceOfScreenId: null, faceIndex: null, hardwareModel: null,
      displayCapabilities: { build: { manufacturer: 'rockchip', model: 'DH43', device: 'rk3288', sdk: 25 } },
      playerVersion: '1.1.58', timezone: 'America/Los_Angeles', latitude: null, longitude: null, resolution: '1920x1080',
      orientation: 'LANDSCAPE', pendingRefreshAt: null, nativeRuntimeReport: null, credentialEpoch: 0, ...over,
    });
  pane(FRONT);
  pane(BACK, { faceOfScreenId: FRONT, faceIndex: 1 });

  const withRelations = (s: Row) => ({ ...s, tenant: tenants.get(s.tenantId) ?? null, screenGroup: null });
  const client: Row = {
    screen: {
      findUnique: jest.fn(async ({ where }: Row) => {
        const s = screens.get(where.id);
        return s ? withRelations(s) : null;
      }),
      findMany: jest.fn(async ({ where }: Row) => [...screens.values()].filter((s) => matches(s, where)).map(withRelations)),
      update: jest.fn(async ({ where, data }: Row) => {
        Object.assign(screens.get(where.id)!, data);
        return { id: where.id };
      }),
      count: jest.fn(async () => screens.size),
    },
    tenant: {
      findUnique: jest.fn(async ({ where }: Row) => tenants.get(where.id) ?? null),
      findMany: jest.fn(async ({ where }: Row) => [...tenants.values()].filter((t) => matches(t, where))),
    },
    screenEmergencyOverride: {
      findUnique: jest.fn(async ({ where }: Row) => overrides.get(where.screenId) ?? null),
      findMany: jest.fn(async ({ where }: Row) => [...overrides.values()].filter((o) => matches(o, where))),
      upsert: jest.fn(async ({ where, create, update }: Row) => {
        const ex = overrides.get(where.screenId);
        const row = ex ? { ...ex, ...update } : { id: id(), screenId: where.screenId, ...create };
        for (const k of ['triggeredAt', 'expiresAt']) if (typeof row[k] === 'string') row[k] = new Date(row[k]);
        overrides.set(where.screenId, row);
        return row;
      }),
      updateMany: jest.fn(async () => ({ count: 0 })),
      deleteMany: jest.fn(async ({ where }: Row) => {
        let count = 0;
        for (const clause of where.OR ?? []) if (overrides.delete(clause.screenId)) count++;
        return { count };
      }),
    },
    auditLog: {
      create: jest.fn(async ({ data }: Row) => {
        audit.push({ ...data, createdAt: new Date(Date.now()) });
        return data;
      }),
      findMany: jest.fn(async ({ where }: Row) => audit.filter((a) => matches(a, where))),
    },
    user: {
      findFirst: jest.fn(async ({ where }: Row) => [...users, ...owners].find((u) => matches(u, where)) ?? null),
      findMany: jest.fn(async ({ where }: Row) => users.filter((u) => matches(u, where))),
      create: jest.fn(async ({ data }: Row) => {
        users.push({ deletedAt: null, ...data });
        return data;
      }),
    },
    emergencyMessage: {
      create: jest.fn(async ({ data }: Row) => {
        messages.push({ createdAt: new Date(Date.now()), clearedAt: null, clearedByUserId: null, mediaUrls: null, audioUrl: null, screenIds: [], ...data });
        return data;
      }),
      findUnique: jest.fn(async ({ where }: Row) => messages.find((m) => m.id === where.id) ?? null),
      findMany: jest.fn(async ({ where }: Row) => messages.filter((m) => matches(m, where))),
      updateMany: jest.fn(async ({ where, data }: Row) => {
        const hit = messages.filter((m) => matches(m, where));
        for (const m of hit) Object.assign(m, data);
        return { count: hit.length };
      }),
    },
    playlistItem: { count: jest.fn(async () => 0) },
    playlist: { findFirst: jest.fn(async () => null), findUnique: jest.fn(async () => null) },
    displaySchedule: { findMany: jest.fn(async () => []) },
    screenEvent: { findMany: jest.fn(async () => []) },
    screenAlertIncident: { findMany: jest.fn(async () => []) },
    license: { findMany: jest.fn(async () => []) },
    $transaction: jest.fn(async (ops: unknown) => (Array.isArray(ops) ? Promise.all(ops) : (ops as (c: Row) => unknown)(client))),
  };
  const prisma = { client } as any;

  const redisKv = new Map<string, string>();
  const redis: Row = {
    isConnected: () => true,
    publish: jest.fn(async (channel: string, message: Row) => {
      published.push({ channel, message, at: Date.now() });
      return true;
    }),
    getString: jest.fn(async () => null),
    setString: jest.fn(async () => true),
    delKey: jest.fn(async () => true),
    sismember: jest.fn(async () => false),
    publisher: {
      get: jest.fn(async (k: string) => redisKv.get(k) ?? null),
      set: jest.fn(async (k: string, v: string, ...rest: unknown[]) => {
        if (rest.includes('NX') && redisKv.has(k)) return null;
        redisKv.set(k, String(v));
        return 'OK';
      }),
    },
  };

  const alerts = new CustomerAlertEmailsService(prisma, undefined, undefined);
  const recordSpy = jest.spyOn(alerts, 'sendEmergencyRecord');
  const emergency = new EmergencyController(
    redis as any,
    prisma,
    new WebsocketSignerService(),
    { dispatch: jest.fn() } as any,
    { driveStatusLampForEmergency: jest.fn(async () => undefined) } as any,
    undefined,
    alerts,
  );
  const screensController = new ScreensController(prisma, {} as never, {} as never, {} as never, {} as never, {} as never);
  (screensController as any).deviceAuth = jest.fn(async () => ({ ok: true }));
  const moduleRef = { get: jest.fn((cls: unknown) => (cls === EmergencyController ? emergency : null)) };
  const lease = { tryAcquire: jest.fn(async (name: string) => ({ name, leader: true, degraded: false, fence: 1 })), holdsFence: () => true };
  const mailer = { sendAlert: jest.fn(async () => undefined) };
  const runner = new SyntheticDrillRunner(prisma, moduleRef as any, redis as any, lease as any, mailer as any, alerts);
  runner.config = () =>
    readDrillConfig({ NODE_ENV: 'production', EMERGENCY_DRILL_SCREENS: `${FRONT},${BACK}` } as NodeJS.ProcessEnv);
  runner.now = () => Date.now();
  // The owner's permission (guard 0), as the approval route writes it.
  owners.push({ id: 'owner-1', tenantId: 'hq', email: 'owner@hq.test', role: 'SUPER_ADMIN', status: 'ACTIVE', passwordHash: '$argon2id$x', canTriggerPanic: false, deletedAt: null });
  audit.push({
    tenantId: 'bench',
    userId: 'owner-1',
    action: DRILL_APPROVED_ACTION,
    targetType: 'Tenant',
    targetId: 'bench',
    details: JSON.stringify({ v: 1, approvalId: 'apr-1', runAtMs: Date.now() - 1_000, expiresAtMs: Date.now() - 1_000 + DRILL_APPROVAL.WINDOW_MS, screenIds: [FRONT, BACK], approverUserId: 'owner-1', approverTenantId: 'hq' }),
    createdAt: new Date(Date.now()),
  });

  // ── The page, per pane: what it raises, and what it reports through the handler ──
  type PageMode = 'paints' | 'withholds';
  const page = new Map<string, { mode: PageMode; identity: string | null; seenAt: number; paintedAt: number | null; lastPost: number; frames: number }>();
  const overrideRowsSeen: Row[] = [];
  /** The alert the page would raise right now: its manifest's override row, else a pushed message. */
  const raisedIdentity = (sid: string): string | null => {
    const o = overrides.get(sid);
    if (o && !(o.expiresAt && new Date(o.expiresAt).getTime() < Date.now())) {
      overrideRowsSeen.push({ ...o });
      // applyManifest's `em` (the manifest's flat emergency fields).
      return emergencyPaintIdentity({ active: true, type: o.type, severity: o.severity, scopeNote: o.scopeNote || null, scope: 'screen', expiresAt: new Date(o.expiresAt).getTime(), isDrill: o.isDrill === true });
    }
    const cleared = new Set(published.filter((p) => p.channel === `device:${sid}` && p.message.type === 'ALL_CLEAR_MESSAGE').map((p) => p.message.payload.messageId));
    const push = [...published].reverse().find((p) => p.channel === `device:${sid}` && p.message.type === 'TEXT_BROADCAST' && !cleared.has(p.message.payload.messageId));
    if (push) {
      // pushedEmergencyFromPayload's shape (receipt time stands in for createdAt).
      const q = push.message.payload;
      return emergencyPaintIdentity({ id: q.messageId, type: 'TEXT_BROADCAST', severity: q.severity, textBlob: q.text, mediaUrls: [], audioUrl: null, expiresAt: q.expiresAt, createdAt: new Date(push.at).toISOString() });
    }
    return null;
  };
  const report = (sid: string, body: Row) => screensController.reportRenderProof(sid, {} as never, body as never);
  const stepPage = async () => {
    const now = Date.now();
    for (const sid of screens.keys()) {
      const p = page.get(sid) ?? { mode: 'paints' as PageMode, identity: null, seenAt: 0, paintedAt: null, lastPost: 0, frames: 100 };
      page.set(sid, p);
      screens.get(sid)!.lastPingAt = new Date(now);
      p.frames += 12;
      const identity = raisedIdentity(sid);
      const proof = (painted: boolean) => ({ identity: identity as string, documentId: `doc-${sid}`, frames: painted ? p.frames : 0, painted });
      const post = (painted: boolean) =>
        report(sid, { frames: p.frames, hash: emergencyRenderHash(proof(painted), now, now), contentKind: 'emergency', emergencyProof: proof(painted) });
      if (identity) {
        if (p.identity !== identity) {
          Object.assign(p, { identity, seenAt: now, paintedAt: null, lastPost: now });
          await post(false);
        } else if (p.mode === 'paints' && p.paintedAt === null && now - p.seenAt >= 800) {
          Object.assign(p, { paintedAt: now, lastPost: now });
          await post(true);
        } else if (now - p.lastPost >= 30 * SEC) {
          p.lastPost = now;
          await post(p.mode === 'paints' && p.paintedAt !== null);
        }
      } else if (p.identity !== null || now - p.lastPost >= 30 * SEC) {
        Object.assign(p, { identity: null, paintedAt: null, lastPost: now });
        await report(sid, { frames: p.frames, hash: 'pl:sig', contentKind: 'playlist' });
      }
    }
  };
  runner.sleep = async (ms: number) => {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      jest.setSystemTime(Math.min(until, Date.now() + 200));
      await stepPage();
    }
  };

  return { FRONT, BACK, tenants, screens, overrides, audit, users, messages, published, client, prisma, emergency, screensController, runner, recordSpy, alerts, page, overrideRowsSeen, moduleRef, mailer, redis };
}

type World = ReturnType<typeof makeWorld>;
const actions = (w: World, action: string) => w.audit.filter((a) => a.action === action);
const flushImmediates = () => new Promise((r) => setImmediate(r));

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'], now: T0 });
  resetSyntheticDrillRegistryForTests();
  resetManifestCacheForTests();
  resetEmergencyRevForTests();
  invalidateDeviceCredentialCache();
  clearDisplayManifestCache();
});
afterEach(() => jest.useRealTimers());

describe('the device-scoped OVERRIDE drill through the real controller and the real render-proof handler', () => {
  it('PASS: a signed OVERRIDE on every face, isDrill rows with expiresAt, the trigger path’s own row names the runner, no record copy', async () => {
    const w = makeWorld();
    const r = await w.runner.runOnce(w.FRONT, { kind: 'override', slot: '2026-11-02@10:30', type: 'evacuate' });
    expect(r.verdict).toBe('PASS');
    expect(r.paneIds.sort()).toEqual([w.FRONT, w.BACK].sort());
    expect(w.moduleRef.get).toHaveBeenCalledWith(EmergencyController, { strict: false });

    // A signed OVERRIDE on every face's own device channel.
    const secret = deviceSecretKeyRing().primary;
    for (const sid of [w.FRONT, w.BACK]) {
      const env = w.published.find((p) => p.channel === `device:${sid}` && p.message.type === 'OVERRIDE');
      expect(env).toBeDefined();
      jest.setSystemTime(env!.at);
      expect(verifyWsHmac(env!.message, secret).ok).toBe(true);
      expect(env!.message.payload).toMatchObject({ overrideId: r.overrideId, isDrill: true, type: 'evacuate', severity: 'CRITICAL' });
      expect(env!.message.payload.expiresAt * 1000 - (r.dispatchAtMs as number)).toBeLessThanOrEqual(180 * SEC);
    }
    // The rows the polling backstop reads: a drill, expiring ≤ +180 s, on both faces.
    const seen = w.overrideRowsSeen.filter((o) => o.alertId === r.overrideId);
    expect(new Set(seen.map((o) => o.screenId))).toEqual(new Set([w.FRONT, w.BACK]));
    for (const o of seen) {
      expect(o.isDrill).toBe(true);
      expect(new Date(o.expiresAt).getTime() - (r.dispatchAtMs as number)).toBeLessThanOrEqual(180 * SEC);
    }
    // Attribution: the trigger path's own audit rows name the runner, never null.
    const runnerId = w.users[0].id;
    expect(w.users[0]).toMatchObject({ status: 'DISABLED', role: 'SCHOOL_ADMIN', canTriggerPanic: true });
    const trig = actions(w, 'TRIGGER_EMERGENCY_DRILL');
    expect(trig).toHaveLength(1);
    expect(trig[0].userId).toBe(runnerId);
    expect(JSON.parse(trig[0].details)).toMatchObject({ overrideId: r.overrideId, isDrill: true, affectedScreenIds: expect.arrayContaining([w.FRONT, w.BACK]) });
    const clr = actions(w, 'CLEAR_EMERGENCY_DRILL');
    expect(clr).toHaveLength(1);
    expect(clr[0].userId).toBe(runnerId);
    for (const a of [...actions(w, DRILL_STARTED_ACTION), ...actions(w, DRILL_RESULT_ACTION)]) expect(a.userId).toBe(runnerId);
    // The handler's own paint rows, for both faces.
    expect(new Set(actions(w, 'PLAYER_EMERGENCY_PAINTED').map((a) => a.targetId))).toEqual(new Set([w.FRONT, w.BACK]));
    // Released: no override row left, the panes back on content.
    expect(w.overrides.size).toBe(0);
    for (const sid of [w.FRONT, w.BACK]) expect(w.screens.get(sid)!.lastRenderedHash).toBe('pl:sig');
    // No customer record copy for the runner's own drill (trigger or clear).
    await flushImmediates();
    expect(w.recordSpy).not.toHaveBeenCalled();
  });

  it('withheld paint (the page never proves two visible frames) → FAIL (render), still cleared', async () => {
    const w = makeWorld();
    w.page.set(w.BACK, { mode: 'withholds', identity: null, seenAt: 0, paintedAt: null, lastPost: 0, frames: 100 });
    const r = await w.runner.runOnce(w.FRONT, { kind: 'override', slot: 's', type: 'lockdown' });
    expect(r).toMatchObject({ verdict: 'FAIL', failedLink: 'render', cleared: true });
    expect(r.panes.find((p) => p.id === w.BACK)).toMatchObject({ failedLink: 'render', paintedAtMs: null });
    expect(r.panes.find((p) => p.id === w.FRONT)?.failedLink).toBeNull();
    expect(actions(w, 'PLAYER_EMERGENCY_NO_PAINT_PROOF').some((a) => a.targetId === w.BACK)).toBe(true);
    expect(w.overrides.size).toBe(0);
  });

  it('the pushed-message drill (TEXT_BROADCAST to the unit) round-trips through the real controller → PASS, cleared', async () => {
    const w = makeWorld();
    const r = await w.runner.runOnce(w.FRONT, { kind: 'broadcast', slot: 's' });
    expect(r.verdict).toBe('PASS');
    expect(w.messages).toHaveLength(1);
    expect(w.messages[0]).toMatchObject({ scopeType: 'devices', triggeredByUserId: w.users[0].id, textBlob: expect.stringMatching(/^DRILL — /) });
    expect(w.messages[0].screenIds.sort()).toEqual([w.FRONT, w.BACK].sort());
    expect(w.messages[0].clearedAt).toBeInstanceOf(Date);
    expect(w.messages[0].expiresAt.getTime() - (r.dispatchAtMs as number)).toBeLessThanOrEqual(180 * SEC);
    for (const sid of [w.FRONT, w.BACK]) {
      expect(w.published.some((p) => p.channel === `device:${sid}` && p.message.type === 'TEXT_BROADCAST')).toBe(true);
      expect(w.published.some((p) => p.channel === `device:${sid}` && p.message.type === 'ALL_CLEAR_MESSAGE')).toBe(true);
    }
    expect(actions(w, 'BROADCAST_TEXT')[0].userId).toBe(w.users[0].id);
  });
});

describe('customer alert record copies: only the runner’s own drill is skipped', () => {
  it('a minted id + isDrill → skipped; the same id sent LIVE, or an unminted drill-looking id → always copied', async () => {
    const w = makeWorld();
    const minted = mintDrillOverrideId(Date.now());
    w.alerts.recordEmergency({ event: 'TRIGGERED', overrideId: minted, isDrill: true, tenantIds: ['bench'] });
    await flushImmediates();
    expect(w.recordSpy).not.toHaveBeenCalled();
    w.alerts.recordEmergency({ event: 'TRIGGERED', overrideId: minted, isDrill: false, tenantIds: ['bench'] });
    w.alerts.recordEmergency({ event: 'TRIGGERED', overrideId: 'ovr_drill_not-minted-here', isDrill: true, tenantIds: ['bench'] });
    await flushImmediates();
    expect(w.recordSpy.mock.calls.map((c) => [c[0].overrideId, c[0].isDrill])).toEqual([
      [minted, false],
      ['ovr_drill_not-minted-here', true],
    ]);
  });
});

describe('after expiresAt the manifest has no emergency (the payload’s own release)', () => {
  it('the real manifest: the drill while it lasts, nothing after +180 s', async () => {
    const w = makeWorld();
    // The runner's frozen body, through the real controller, as the runner principal.
    const identity = await w.runner.ensureRunnerIdentity('bench');
    if (!identity.ok) throw new Error(identity.problem);
    const body = buildOverrideDrillBody({ screenId: w.FRONT, type: 'hold', overrideId: mintDrillOverrideId(Date.now()), nowMs: Date.now() });
    await w.emergency.triggerEmergency(body, { user: runnerPrincipal(identity.user.id, 'bench') });
    const row = w.overrides.get(w.FRONT)!;
    expect(row).toMatchObject({ isDrill: true, type: 'HOLD' });

    const tenant = w.tenants.get('bench')!;
    const screen = { ...w.screens.get(w.FRONT)!, tenant, credentialEpochRotatedAt: null, faceContentMode: null, activeBoardGameId: null, syncOffsetMs: 0, canvasW: null, canvasH: null, repeats: 1, config: null };
    const client = {
      screen: { findUnique: jest.fn(async () => screen), update: jest.fn(async () => ({ id: 'x' })), findMany: jest.fn(async () => []) },
      screenGroup: { findUnique: jest.fn(async () => null) },
      tenant: { findUnique: jest.fn(async () => tenant) },
      screenEmergencyOverride: { findUnique: jest.fn(async () => row) },
      game: { findFirst: jest.fn(async () => null) },
      playlist: { findUnique: jest.fn(async () => null), findMany: jest.fn(async () => []) },
      asset: { findMany: jest.fn(async () => []) },
      schedule: { findMany: jest.fn(async () => []), findFirst: jest.fn(async () => null) },
      displaySchedule: { findMany: jest.fn(async () => []) },
      displayVendorRecipe: { findMany: jest.fn(async () => []) },
      auditLog: { create: jest.fn(async () => ({})) },
    };
    const redis = { isConnected: () => false, getString: jest.fn(async () => null), setString: jest.fn(async () => true), delKey: jest.fn(async () => true), publish: jest.fn(async () => undefined) };
    const manifestController = new ScreensController({ client } as any, redis as any, {} as any, {} as any, {} as any, {} as any);
    const manifest = async () => {
      const res: any = { statusCode: null, body: undefined, headers: {} };
      res.setHeader = (k: string, v: string) => ((res.headers[k.toLowerCase()] = v), res);
      res.status = (c: number) => ((res.statusCode = c), res);
      res.json = (p: unknown) => ((res.body = p), res);
      res.send = () => res;
      res.end = () => res;
      const token = jwt.sign({ sub: w.FRONT, kind: 'device', ep: 0, fp: 'fp-test' }, 'dev_only_device_jwt_secret_CHANGE_ME', { expiresIn: '180d' });
      await manifestController.getManifest(w.FRONT, { headers: { authorization: `Bearer ${token}` }, ip: '10.0.0.1', socket: { remoteAddress: '10.0.0.1' }, user: { id: w.FRONT, sub: w.FRONT, kind: 'device', tenantId: 'bench' } } as any, res);
      return res.body;
    };
    const during = await manifest();
    expect(during).toMatchObject({ isEmergency: true, isDrill: true });
    jest.setSystemTime(new Date(row.expiresAt).getTime() + SEC);
    resetManifestCacheForTests();
    resetEmergencyRevForTests();
    const after = await manifest();
    expect(after?.isEmergency).not.toBe(true);
  });
});
