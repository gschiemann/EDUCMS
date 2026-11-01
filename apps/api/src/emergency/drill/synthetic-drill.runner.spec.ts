/**
 * Synthetic emergency drill — the RUNNER on a fake clock (design §7).
 *
 * The emergency controller is replaced here by a port that records every call
 * and writes the same override / message rows the real one writes (the real
 * controller is driven in synthetic-drill.integration.spec.ts). The panes are
 * driven by a small player model whose stored hashes come from the producers'
 * own functions (`emergencyRenderHash`, the handler's `emergencyRenderEvidence`).
 *
 * Pinned: the all-clear goes out on EVERY exit (a throw, a lost lease, the
 * deadline, a live alert); one run per slot, in series; one owner email per
 * tick and never a retry; a 409 or a live alert ending the drill → ABORTED,
 * no email; the orphan sweep acts once; guard 2 (the organisation root's
 * `isInternal`, read fresh) refuses a customer screen with no row, no
 * identity and nothing sent; no Redis, no drill.
 */
import 'reflect-metadata';
import { ConflictException } from '@nestjs/common';
import { emergencyPaintIdentity, emergencyRenderHash, overrideAlertPaintIdentity } from '@cms/api-types';
import { emergencyRenderEvidence } from '../../screens/emergency-proof';
import { SyntheticDrillRunner, type DrillEmergencyPort } from './synthetic-drill.runner';
import { readDrillConfig } from './synthetic-drill.config';
import {
  DRILL_RESULT_ACTION,
  DRILL_RUNNER_CREATED_ACTION,
  DRILL_STARTED_ACTION,
  DRILL_SWEPT_ACTION,
  DRILL_TIMING,
  drillRunnerEmail,
} from './synthetic-drill.policy';
import { resetSyntheticDrillRegistryForTests } from './synthetic-drill.registry';
import { DRILL_BLOCKED_CODE } from '../emergency-drill';

const SEC = 1_000;
const MIN = 60 * SEC;
/** 10:31 Los Angeles (PST) on Monday 2026-11-02 — one minute after the default 10:30 slot. */
const SLOT_TIME = Date.parse('2026-11-02T18:31:00Z');
const FRONT = '40864836-0000-4000-8000-000000000001';
const BACK = '80bf9b8d-0000-4000-8000-000000000002';
const SOLO = '1cff5eb0-0000-4000-8000-000000000003';
const CUSTOMER = '9a9a9a9a-0000-4000-8000-000000000004';

type Row = Record<string, any>;
type PlayerMode = 'healthy' | 'dead' | 'pending-only' | 'drops' | 'frozen';

function inList(v: unknown, c: any): boolean {
  if (c === undefined) return true;
  if (c && typeof c === 'object' && Array.isArray(c.in)) return c.in.includes(v);
  if (c && typeof c === 'object' && 'not' in c) return v !== c.not;
  return v === c;
}

function makeWorld() {
  const clock = { now: SLOT_TIME };
  const tenants = new Map<string, Row>();
  const screens = new Map<string, Row>();
  const overrides = new Map<string, Row>();
  const audit: Row[] = [];
  const users: Row[] = [];
  const messages: Row[] = [];
  const player = new Map<string, { mode: PlayerMode; seenAt: number | null; paintedAt: number | null; lastPost: number; identity: string | null }>();
  const redisStore = new Map<string, { v: string; exp: number | null }>();
  const failures = { screenRead: false };

  const tenant = (id: string, over: Row = {}) =>
    tenants.set(id, { id, name: id, parentId: null, archivedAt: null, isInternal: true, emergencyStatus: 'INACTIVE', emergencyIsDrill: false, ...over });
  const screen = (id: string, tenantId: string, over: Row = {}) =>
    screens.set(id, {
      id,
      name: id === FRONT ? 'DH43' : id === BACK ? 'DH43 — Back' : id === SOLO ? 'GUQ55' : id,
      tenantId,
      status: 'ONLINE',
      pairedAt: new Date(SLOT_TIME - 30 * 24 * 3600_000),
      lastPingAt: new Date(clock.now - 10 * SEC),
      lastRenderedHash: 'pl:sig',
      lastRenderedAt: new Date(clock.now - 20 * SEC),
      faceOfScreenId: null,
      screenGroupId: null,
      hardwareModel: null,
      displayCapabilities: { build: { manufacturer: 'Goodview', model: id === SOLO ? 'M55GUQ' : 'DH43', device: 'rk', sdk: 30 } },
      playerVersion: '1.1.58',
      timezone: 'America/Los_Angeles',
      latitude: null,
      longitude: null,
      ...over,
    });

  const where = (r: Row, w: Row | undefined): boolean => {
    if (!w) return true;
    if (Array.isArray(w.OR) && !w.OR.some((o: Row) => where(r, o))) return false;
    for (const [k, c] of Object.entries(w)) {
      if (k === 'OR') continue;
      if (k === 'createdAt') {
        if (c?.gte && !(r.createdAt >= c.gte)) return false;
        continue;
      }
      if (!inList(r[k], c)) return false;
    }
    return true;
  };

  const withRelations = (s: Row) => ({ ...s, screenGroup: null, tenant: { timezone: null, latitude: null, longitude: null } });

  const client: Row = {
    screen: {
      findMany: jest.fn(async ({ where: w }: Row) => {
        if (failures.screenRead) throw new Error('db stall');
        return [...screens.values()].filter((s) => where(s, w)).map(withRelations);
      }),
    },
    tenant: {
      findMany: jest.fn(async ({ where: w }: Row) => [...tenants.values()].filter((t) => where(t, w))),
      findUnique: jest.fn(async ({ where: w }: Row) => tenants.get(w.id) ?? null),
    },
    screenEmergencyOverride: {
      findMany: jest.fn(async ({ where: w }: Row) => [...overrides.values()].filter((o) => where(o, w))),
    },
    auditLog: {
      create: jest.fn(async ({ data }: Row) => {
        audit.push({ ...data, createdAt: new Date(clock.now) });
        return data;
      }),
      findMany: jest.fn(async ({ where: w }: Row) => audit.filter((a) => where(a, w))),
    },
    user: {
      findFirst: jest.fn(async ({ where: w }: Row) => users.find((u) => where(u, w)) ?? null),
      create: jest.fn(async ({ data }: Row) => {
        if (users.some((u) => u.email === data.email)) throw new Error('P2002 unique');
        users.push({ deletedAt: null, ...data });
        return data;
      }),
    },
    emergencyMessage: {
      findMany: jest.fn(async ({ where: w }: Row) => messages.filter((m) => where(m, w))),
    },
    $transaction: jest.fn(async (ops: unknown[]) => Promise.all(ops)),
  };

  // ── The player: posts through the handler's own rule ──
  const post = (id: string, hash: string, proof?: { identity: string; documentId: string; frames: number; painted: boolean }) => {
    const s = screens.get(id)!;
    const evidence = emergencyRenderEvidence(hash, proof, undefined);
    const confirmed = !evidence || evidence.painted;
    if (evidence && s.lastRenderedHash !== evidence.hash) {
      audit.push({
        tenantId: s.tenantId,
        userId: null,
        action: confirmed ? 'PLAYER_EMERGENCY_PAINTED' : 'PLAYER_EMERGENCY_NO_PAINT_PROOF',
        targetType: 'Screen',
        targetId: id,
        details: JSON.stringify({ identity: proof?.identity ?? null }),
        createdAt: new Date(clock.now),
      });
    }
    s.lastRenderedHash = evidence ? evidence.hash : hash;
    if (confirmed) s.lastRenderedAt = new Date(clock.now);
    s.lastPingAt = new Date(clock.now);
  };
  const activeIdentity = (id: string): string | null => {
    const o = overrides.get(id);
    if (o && (!o.expiresAt || new Date(o.expiresAt).getTime() > clock.now)) {
      return overrideAlertPaintIdentity({ type: o.type, severity: o.severity, isDrill: o.isDrill === true });
    }
    const m = messages.find((x) => !x.clearedAt && (x.screenIds ?? []).includes(id) && (!x.expiresAt || x.expiresAt.getTime() > clock.now));
    return m ? emergencyPaintIdentity({ id: m.id, type: m.type, severity: m.severity, textBlob: m.textBlob, mediaUrls: [], audioUrl: null, expiresAt: 1, createdAt: 'push' }) : null;
  };
  const step = () => {
    for (const id of screens.keys()) {
      const p = player.get(id) ?? { mode: 'healthy' as PlayerMode, seenAt: null, paintedAt: null, lastPost: 0, identity: null };
      player.set(id, p);
      const s = screens.get(id)!;
      // 'frozen' = the page stopped posting anything (still on whatever it showed).
      if (p.mode === 'frozen') continue;
      s.lastPingAt = new Date(clock.now);
      // 'dead' = the alert never reaches this pane (it keeps posting its content).
      const identity = p.mode === 'dead' ? null : activeIdentity(id);
      if (identity) {
        const proof = (painted: boolean) => ({ identity, documentId: `doc-${id}`, frames: painted ? 2 : 0, painted });
        if (p.seenAt === null || p.identity !== identity) {
          p.seenAt = clock.now;
          p.identity = identity;
          p.paintedAt = null;
          post(id, emergencyRenderHash(proof(false), clock.now, clock.now), proof(false));
        } else if (p.mode !== 'pending-only' && p.paintedAt === null && clock.now - p.seenAt >= 800) {
          p.paintedAt = clock.now;
          p.lastPost = clock.now;
          post(id, emergencyRenderHash(proof(true), clock.now, clock.now), proof(true));
        } else if (p.paintedAt !== null && p.mode === 'drops' && clock.now - p.paintedAt >= 24 * SEC) {
          post(id, 'pl:sig');
        } else if (p.paintedAt !== null && clock.now - p.lastPost >= 30 * SEC) {
          p.lastPost = clock.now;
          post(id, emergencyRenderHash(proof(true), clock.now, clock.now), proof(true));
        }
      } else if (p.seenAt !== null || clock.now - p.lastPost >= 30 * SEC) {
        p.seenAt = null;
        p.paintedAt = null;
        p.identity = null;
        p.lastPost = clock.now;
        post(id, 'pl:sig');
      }
    }
  };

  // ── The controller port: records calls, writes the rows the real one writes ──
  const calls: Array<{ method: string; args: unknown[]; at: number }> = [];
  const behaviour: { trigger?: (body: Row) => Promise<unknown> | unknown; broadcast?: (body: Row) => Promise<unknown> | unknown; onClear?: () => void } = {};
  const unitOf = (id: string) => {
    const s = screens.get(id)!;
    const root = s.faceOfScreenId || s.id;
    return [...screens.values()].filter((x) => x.id === root || x.faceOfScreenId === root).map((x) => x.id);
  };
  const port: DrillEmergencyPort = {
    triggerEmergency: jest.fn(async (body: any, req: any) => {
      calls.push({ method: 'trigger', args: [body, req], at: clock.now });
      if (behaviour.trigger) {
        const r = await behaviour.trigger(body);
        if (r !== undefined) return r;
      }
      for (const id of unitOf(body.scopeId)) {
        overrides.set(id, {
          screenId: id,
          tenantId: screens.get(id)!.tenantId,
          alertId: body.overridePayload.overrideId,
          scopeType: 'device',
          scopeId: body.scopeId,
          type: String(body.overridePayload.type).toUpperCase(),
          severity: body.overridePayload.severity,
          isDrill: true,
          triggeredByUserId: req.user.id,
          triggeredAt: new Date(clock.now).toISOString(),
          expiresAt: new Date(body.overridePayload.expiresAt * 1000).toISOString(),
          displaced: null,
        });
      }
      audit.push({ tenantId: screens.get(body.scopeId)!.tenantId, userId: req.user.id, action: 'TRIGGER_EMERGENCY_DRILL', targetType: 'device', targetId: body.scopeId, details: '{}', createdAt: new Date(clock.now) });
      return { success: true, overrideId: body.overridePayload.overrideId, isDrill: true };
    }),
    clearEmergency: jest.fn(async (overrideId: string, body: any, req: any) => {
      calls.push({ method: 'clear', args: [overrideId, body, req], at: clock.now });
      behaviour.onClear?.();
      for (const [k, o] of overrides) if (o.alertId === overrideId && o.isDrill) overrides.delete(k);
      return { success: true };
    }),
    broadcastText: jest.fn(async (body: any, req: any) => {
      calls.push({ method: 'broadcast', args: [body, req], at: clock.now });
      if (behaviour.broadcast) {
        const r = await behaviour.broadcast(body);
        if (r !== undefined) return r;
      }
      const id = `bcast_${calls.length}`;
      const unit = unitOf(body.screenIds[0]);
      messages.push({ id, tenantId: screens.get(unit[0])!.tenantId, triggeredByUserId: req.user.id, type: 'TEXT_BROADCAST', severity: body.severity, textBlob: body.text, scopeType: 'devices', scopeId: id, screenIds: unit, expiresAt: new Date(body.expiresAt * 1000), createdAt: new Date(clock.now), clearedAt: null });
      return { success: true, messageId: id };
    }),
    clearMessage: jest.fn(async (messageId: string, req: any) => {
      calls.push({ method: 'clearMessage', args: [messageId, req], at: clock.now });
      for (const m of messages) if (m.id === messageId || m.scopeId === messageId) m.clearedAt = new Date(clock.now);
      return { success: true };
    }),
  };

  const redis = {
    connected: true,
    isConnected() {
      return this.connected;
    },
    publisher: {
      get: jest.fn(async (k: string) => {
        const e = redisStore.get(k);
        if (!e || (e.exp !== null && e.exp <= clock.now)) return null;
        return e.v;
      }),
      set: jest.fn(async (k: string, v: string, ...rest: Array<string | number>) => {
        const ex = rest.indexOf('EX');
        const nx = rest.includes('NX');
        const e = redisStore.get(k);
        const live = e && (e.exp === null || e.exp > clock.now);
        if (nx && live) return null;
        redisStore.set(k, { v: String(v), exp: ex >= 0 ? clock.now + Number(rest[ex + 1]) * SEC : null });
        return 'OK';
      }),
    },
  };
  const lease = { held: true, degraded: false, tryAcquire: jest.fn(async (name: string) => ({ name, leader: true, degraded: lease.degraded, fence: 7 })), holdsFence: jest.fn(() => lease.held) };
  const mailer = { sendAlert: jest.fn(async (..._args: unknown[]) => undefined) };
  const facts = (id: string) => ({
    id, status: 'ONLINE', tenantId: screens.get(id)?.tenantId ?? null, pairedAt: new Date(SLOT_TIME - 30 * 24 * 3600_000), lastPingAt: new Date(clock.now - 10 * SEC),
    nativeRuntimeReport: null, nativeRuntimeReportAt: null, credentialEpochRotatedAt: null, lastOtaAt: null, lastOtaState: null,
    forceApkUpdatePendingAt: null, forceApkUpdateHold: null, displayWindows: [], otaWindow: null, lastPowerCommand: null, lastMaintenanceAt: null,
  });
  const alerts = {
    loadTenants: jest.fn(async () => new Map()),
    loadFacts: jest.fn(async (problems: Array<{ screenId: string }>) => new Map(problems.map((p) => [p.screenId, { row: {}, facts: facts(p.screenId) }]))),
  };

  const runner = new SyntheticDrillRunner({ client } as any, { get: () => port } as any, redis as any, lease as any, mailer as any, alerts as any);
  runner.now = () => clock.now;
  runner.sleep = async (ms: number) => {
    const until = clock.now + ms;
    while (clock.now < until) {
      clock.now = Math.min(until, clock.now + 200);
      step();
    }
  };
  const setEnv = (over: Record<string, string> = {}) => {
    runner.config = () => readDrillConfig({ NODE_ENV: 'production', EMERGENCY_DRILL_SCREENS: [FRONT, BACK, SOLO].join(','), ...over } as NodeJS.ProcessEnv);
  };
  setEnv();

  tenant('bench', { isInternal: true, name: 'Bench' });
  screen(FRONT, 'bench');
  screen(BACK, 'bench', { faceOfScreenId: FRONT });
  screen(SOLO, 'bench');

  return { clock, tenants, screens, overrides, audit, users, messages, player, port, calls, behaviour, redis, lease, mailer, alerts, runner, client, failures, setEnv, tenant, screen, step };
}

type World = ReturnType<typeof makeWorld>;
const rows = (w: World, action: string): Row[] => w.audit.filter((a) => a.action === action).map((a): Row => ({ ...a, d: JSON.parse(a.details) }));
const setPlayer = (w: World, id: string, mode: PlayerMode) => w.player.set(id, { mode, seenAt: null, paintedAt: null, lastPost: 0, identity: null });

let w: World;
beforeEach(() => {
  resetSyntheticDrillRegistryForTests();
  w = makeWorld();
});

describe('a normal pass', () => {
  it('tick: each display once per slot (the double-sided unit ONCE, both faces graded), OVERRIDE then pushed message, in series — all PASS', async () => {
    const r = await w.runner.tick();
    expect(r.status).toBe('ran');
    expect(r.results.map((x) => `${x.label}:${x.kind}:${x.verdict}`)).toEqual([
      'DH43:override:PASS',
      'DH43:broadcast:PASS',
      'GUQ55:override:PASS',
      'GUQ55:broadcast:PASS',
    ]);
    const unitRun = r.results[0];
    expect(unitRun.paneIds.sort()).toEqual([BACK, FRONT].sort());
    expect(unitRun.panes.map((p) => p.failedLink)).toEqual([null, null]);
    // In series: no call starts before the previous run's all-clear.
    const order = w.calls.map((c) => c.method);
    expect(order).toEqual(['trigger', 'clear', 'broadcast', 'clearMessage', 'trigger', 'clear', 'broadcast', 'clearMessage']);
    // Every clear by +150 s of its dispatch.
    for (let i = 0; i < w.calls.length; i += 2) expect(w.calls[i + 1].at - w.calls[i].at).toBeLessThanOrEqual(DRILL_TIMING.CLEAR_BY_MS);
    // The OVERRIDE payload: device scope, drill, expiring ≤ +180 s.
    const body = (w.port.triggerEmergency as jest.Mock).mock.calls[0][0];
    expect(body).toMatchObject({ scopeType: 'device', scopeId: FRONT, overridePayload: { isDrill: true, severity: 'CRITICAL' } });
    expect(body.overridePayload.expiresAt * 1000 - w.calls[0].at).toBeLessThanOrEqual(180 * SEC);
    // Rows: STARTED + RESULT per run, all attributed to the runner identity — never null.
    const started = rows(w, DRILL_STARTED_ACTION);
    const results = rows(w, DRILL_RESULT_ACTION);
    expect(started).toHaveLength(4);
    expect(results).toHaveLength(4);
    const runnerId = w.users[0].id;
    for (const x of [...started, ...results]) expect(x.userId).toBe(runnerId);
    expect(results.every((x) => x.d.v === 1 && x.d.verdict === 'PASS' && x.d.mode === 'shadow')).toBe(true);
    // Shadow: no email.
    expect(w.mailer.sendAlert).not.toHaveBeenCalled();
    // A second tick in the same slot runs nothing.
    const again = await w.runner.tick();
    expect(again.results).toEqual([]);
    expect(w.calls).toHaveLength(8);
  });

  it('the service identity: one login-disabled user per bench location, created once, audited', async () => {
    await w.runner.tick();
    expect(w.users).toHaveLength(1);
    expect(w.users[0]).toMatchObject({
      tenantId: 'bench',
      email: drillRunnerEmail('bench'),
      role: 'SCHOOL_ADMIN',
      status: 'DISABLED',
      canTriggerPanic: true,
      alertEmailsEnabled: false,
    });
    expect(String(w.users[0].passwordHash).startsWith('$argon2')).toBe(false);
    expect(rows(w, DRILL_RUNNER_CREATED_ACTION)).toHaveLength(1);
    // The principal the controller saw is that user, scoped to the screen's location.
    const req = (w.port.triggerEmergency as jest.Mock).mock.calls[0][1];
    expect(req.user).toMatchObject({ id: w.users[0].id, role: 'SCHOOL_ADMIN', tenantId: 'bench' });
  });

  it('nothing runs before the local slot; a screen with no time zone is never drilled', async () => {
    w.clock.now = Date.parse('2026-11-02T18:29:00Z'); // 10:29 PST
    expect((await w.runner.tick()).results).toEqual([]);
    w.clock.now = SLOT_TIME;
    for (const s of w.screens.values()) s.timezone = null;
    expect((await w.runner.tick()).results).toEqual([]);
    expect(w.calls).toEqual([]);
  });
});

describe('the all-clear goes out on every exit', () => {
  it('the deadline: a pane that never paints → FAIL (delivery), cleared by +150 s', async () => {
    setPlayer(w, SOLO, 'dead');
    const r = await w.runner.runOnce(SOLO, { kind: 'override', slot: 's', type: 'hold' });
    expect(r).toMatchObject({ verdict: 'FAIL', failedLink: 'delivery', cleared: true });
    const trig = w.calls.find((c) => c.method === 'trigger')!;
    const clear = w.calls.find((c) => c.method === 'clear')!;
    expect(clear.at - trig.at).toBeLessThanOrEqual(DRILL_TIMING.CLEAR_BY_MS);
    expect(clear.args[1]).toEqual({ scopeType: 'device', scopeId: SOLO, isDrill: true });
  });

  it('a throw mid-run (the trigger answered with a server error after the push went out) → cleared, INCONCLUSIVE', async () => {
    w.behaviour.trigger = () => {
      throw new Error('connection reset during commit');
    };
    const r = await w.runner.runOnce(SOLO, { kind: 'override', slot: 's', type: 'hold' });
    expect(r.verdict).toBe('INCONCLUSIVE');
    expect(r.reason).toMatch(/^dispatch-failed/);
    expect(w.calls.map((c) => c.method)).toEqual(['trigger', 'clear']);
  });

  it('a throw inside the observation loop → cleared, INCONCLUSIVE', async () => {
    let sleeps = 0;
    const real = w.runner.sleep;
    w.runner.sleep = async (ms) => {
      if (++sleeps === 3) throw new Error('unexpected');
      return real(ms);
    };
    const r = await w.runner.runOnce(SOLO, { kind: 'override', slot: 's', type: 'hold' });
    expect(r.verdict).toBe('INCONCLUSIVE');
    expect(r.reason).toMatch(/^run-error/);
    expect(w.calls.map((c) => c.method)).toEqual(['trigger', 'clear']);
  });

  it('a lost lease mid-run → cleared, ABORTED (no email)', async () => {
    w.setEnv({ EMERGENCY_DRILL_MODE: 'alert' });
    let sleeps = 0;
    const real = w.runner.sleep;
    w.runner.sleep = async (ms) => {
      if (++sleeps === 4) w.lease.held = false;
      return real(ms);
    };
    const r = await w.runner.tick();
    expect(r.results[0]).toMatchObject({ verdict: 'ABORTED', reason: 'lease-lost', cleared: true });
    expect(w.calls.map((c) => c.method)).toEqual(['trigger', 'clear']); // and nothing after: the term ended
    expect(w.mailer.sendAlert).not.toHaveBeenCalled(); // no drill email, and no dead-man from a replica that lost the lease
  });

  it('the trigger hangs past its budget → treated as maybe-sent: cleared, INCONCLUSIVE', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });
    try {
      w.behaviour.trigger = () => new Promise(() => undefined);
      const p = w.runner.runOnce(SOLO, { kind: 'override', slot: 's', type: 'hold' });
      await jest.advanceTimersByTimeAsync(DRILL_TIMING.CALL_TIMEOUT_MS + DRILL_TIMING.CLEAR_BY_MS + 10 * SEC);
      const r = await p;
      expect(r).toMatchObject({ verdict: 'INCONCLUSIVE', reason: 'dispatch-timed-out' });
      expect(w.calls.map((c) => c.method)).toEqual(['trigger', 'clear']);
    } finally {
      jest.useRealTimers();
    }
  });

  it('…and when the slow trigger finally lands, the all-clear goes out AGAIN', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });
    try {
      w.behaviour.trigger = () => new Promise((resolve) => setTimeout(() => resolve({ success: true }), DRILL_TIMING.CALL_TIMEOUT_MS + 10 * SEC));
      const p = w.runner.runOnce(SOLO, { kind: 'override', slot: 's', type: 'hold' });
      await jest.advanceTimersByTimeAsync(DRILL_TIMING.CALL_TIMEOUT_MS + DRILL_TIMING.CLEAR_BY_MS + 10 * SEC);
      const r = await p;
      expect(r.verdict).toBe('INCONCLUSIVE');
      expect(w.calls.map((c) => c.method)).toEqual(['trigger', 'clear', 'clear']);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('real emergencies win', () => {
  it('a 409 (a live alert in the organisation) → ABORTED, nothing was sent so nothing to clear, no email', async () => {
    w.setEnv({ EMERGENCY_DRILL_MODE: 'alert' });
    w.behaviour.trigger = () => {
      throw new ConflictException({ code: DRILL_BLOCKED_CODE, message: 'live' });
    };
    const r = await w.runner.tick();
    expect(r.results[0]).toMatchObject({ kind: 'override', verdict: 'ABORTED' });
    expect(w.calls.filter((c) => c.method === 'clear')).toHaveLength(0);
    expect(w.mailer.sendAlert.mock.calls.filter((c: any[]) => c[2] === 'ALERT_EMERGENCY_DRILL')).toHaveLength(0);
  });

  it('a live alert that ends the drill mid-run → ABORTED, our drill all-clear still sent (it can only end drill state), no email', async () => {
    w.setEnv({ EMERGENCY_DRILL_MODE: 'alert' });
    let sleeps = 0;
    const real = w.runner.sleep;
    w.runner.sleep = async (ms) => {
      if (++sleeps === 8) {
        // The live trigger replaced the drill on the unit (DRILL_ENDED_BY_LIVE_ALERT).
        for (const [k, o] of w.overrides) w.overrides.set(k, { ...o, alertId: 'ovr_live', isDrill: false, expiresAt: null });
      }
      return real(ms);
    };
    const r = await w.runner.runOnce(FRONT, { kind: 'override', slot: 's', type: 'lockdown' });
    expect(r.verdict).toBe('ABORTED');
    expect(r.reason).toMatch(/^live-alert-on-screen/);
    const clear = w.calls.find((c) => c.method === 'clear')!;
    expect(clear.args[1]).toMatchObject({ isDrill: true });
    expect(w.overrides.get(FRONT)?.alertId).toBe('ovr_live'); // the live alert stands
  });

  it('a live pushed message (an operator’s broadcast) mid-run → ABORTED, never graded as the drill’s paint', async () => {
    let sleeps = 0;
    const real = w.runner.sleep;
    w.runner.sleep = async (ms) => {
      if (++sleeps === 6) {
        w.messages.push({ id: 'bcast_live', tenantId: 'bench', triggeredByUserId: 'principal', type: 'TEXT_BROADCAST', severity: 'CRITICAL', textBlob: 'Shelter now', scopeType: 'tenant', scopeId: 'bench', screenIds: [], expiresAt: new Date(w.clock.now + 3600_000), createdAt: new Date(w.clock.now), clearedAt: null });
      }
      return real(ms);
    };
    const r = await w.runner.runOnce(SOLO, { kind: 'override', slot: 's', type: 'hold' });
    expect(r).toMatchObject({ verdict: 'ABORTED', reason: 'live-message:bcast_live', cleared: true });
  });
});

describe('owner email: one per tick, never a retry', () => {
  it('mode alert: every FAIL of the pass in ONE email; a failed send is not retried; the next tick does not resend', async () => {
    w.setEnv({ EMERGENCY_DRILL_MODE: 'alert' });
    setPlayer(w, SOLO, 'dead');
    w.mailer.sendAlert.mockRejectedValueOnce(new Error('resend 500'));
    const r = await w.runner.tick();
    expect(r.results.filter((x) => x.verdict === 'FAIL').map((x) => `${x.label}:${x.kind}`)).toEqual(['GUQ55:override', 'GUQ55:broadcast']);
    const drillEmails = w.mailer.sendAlert.mock.calls.filter((c: any[]) => c[2] === 'ALERT_EMERGENCY_DRILL');
    expect(drillEmails).toHaveLength(1);
    expect(drillEmails[0][0]).toMatch(/2 FAILs/);
    expect(drillEmails[0][1]).toMatch(/DELIVERY/);
    expect(rows(w, DRILL_RESULT_ACTION).filter((x) => x.d.verdict === 'FAIL').every((x) => x.d.alerted === true)).toBe(true);
    await w.runner.tick();
    expect(w.mailer.sendAlert.mock.calls.filter((c: any[]) => c[2] === 'ALERT_EMERGENCY_DRILL')).toHaveLength(1);
  });

  it('shadow: the same FAILs are recorded, nobody is emailed', async () => {
    setPlayer(w, SOLO, 'dead');
    await w.runner.tick();
    expect(rows(w, DRILL_RESULT_ACTION).filter((x) => x.d.verdict === 'FAIL')).toHaveLength(2);
    expect(w.mailer.sendAlert).not.toHaveBeenCalled();
  });

  it('the ~24 s drop names PERSISTENCE; a pane stuck on the alert names RELEASE', async () => {
    setPlayer(w, SOLO, 'drops');
    expect((await w.runner.runOnce(SOLO, { kind: 'override', slot: 'a', type: 'hold' })).failedLink).toBe('persistence');
    resetSyntheticDrillRegistryForTests();
    setPlayer(w, SOLO, 'healthy');
    w.behaviour.onClear = () => setPlayer(w, SOLO, 'frozen'); // the screen never posts again after the clear
    expect((await w.runner.runOnce(SOLO, { kind: 'override', slot: 'b', type: 'hold' })).failedLink).toBe('release');
  });
});

describe('the orphan sweep', () => {
  it('a STARTED run with no RESULT gets ONE all-clear and a SWEPT row — once', async () => {
    const runnerId = 'runner-1';
    w.users.push({ id: runnerId, tenantId: 'bench', email: drillRunnerEmail('bench'), role: 'SCHOOL_ADMIN', status: 'DISABLED', passwordHash: 'synthetic-drill-runner-no-password', canTriggerPanic: true, deletedAt: null });
    const at = SLOT_TIME - 30 * MIN;
    w.audit.push({
      tenantId: 'bench',
      userId: runnerId,
      action: DRILL_STARTED_ACTION,
      targetType: 'Screen',
      targetId: SOLO,
      createdAt: new Date(at),
      details: JSON.stringify({
        v: 1, runId: 'dead-process', kind: 'override', overrideId: 'ovr_drill_dead', slot: 's', mode: 'shadow', type: 'hold', screenId: SOLO,
        paneIds: [SOLO], hardwareModel: null, deviceClass: null, playerVersion: null, dispatchAt: new Date(at).toISOString(),
        expiresAt: new Date(at + 180 * SEC).toISOString(), runnerUserId: runnerId, rootTenantId: 'bench',
      }),
    });
    w.clock.now = Date.parse('2026-11-02T22:00:00Z'); // past the slot's grace: no drills, only the sweep
    const first = await w.runner.tick();
    expect(first.swept).toBe(1);
    expect(w.calls).toEqual([expect.objectContaining({ method: 'clear', args: ['ovr_drill_dead', { scopeType: 'device', scopeId: SOLO, isDrill: true }, expect.anything()] })]);
    expect(rows(w, DRILL_SWEPT_ACTION)).toEqual([expect.objectContaining({ userId: runnerId, d: expect.objectContaining({ runId: 'dead-process', outcome: 'cleared' }) })]);
    const second = await w.runner.tick();
    expect(second.swept).toBe(0);
    expect(w.calls).toHaveLength(1);
  });
});

describe('guards that must never be routed around', () => {
  it('guard 2: a listed screen whose organisation root is NOT internal — no identity, no row, nothing sent, one owner email per boot', async () => {
    w.tenant('customer-org', { isInternal: false, name: 'Paying Customer' });
    w.screen(CUSTOMER, 'customer-org');
    w.setEnv({ EMERGENCY_DRILL_SCREENS: CUSTOMER });
    const r = await w.runner.tick();
    expect(r.results.map((x) => `${x.verdict}:${x.reason}`)).toEqual(['SKIPPED:guard2:root-not-internal', 'SKIPPED:guard2:root-not-internal']);
    expect(w.calls).toEqual([]);
    expect(w.users).toEqual([]);
    expect(w.audit.filter((a) => a.tenantId === 'customer-org')).toEqual([]);
    expect(w.mailer.sendAlert.mock.calls.filter((c: any[]) => c[2] === 'ALERT_EMERGENCY_DRILL_REFUSED')).toHaveLength(1);
  });

  it('guard 2 reads the ROOT fresh: a bench location under a customer organisation is refused', async () => {
    w.tenant('customer-root', { isInternal: false });
    w.tenants.get('bench')!.parentId = 'customer-root';
    const r = await w.runner.runOnce(SOLO, { kind: 'override', slot: 's', type: 'hold' });
    expect(r).toMatchObject({ verdict: 'SKIPPED', reason: 'guard2:root-not-internal' });
    expect(w.calls).toEqual([]);
  });

  it('guard 1 lives inside runOnce: an unlisted id is refused before anything is read', async () => {
    const r = await w.runner.runOnce(CUSTOMER, { kind: 'override', slot: 's' });
    expect(r).toMatchObject({ verdict: 'SKIPPED', reason: 'guard1:not-listed' });
    expect(w.client.screen.findMany).not.toHaveBeenCalled();
    expect(w.calls).toEqual([]);
  });

  it('a pane in its on/off schedule OFF window (guard 3) → SKIPPED row (attributed), nothing sent; retried 30 min later in the slot', async () => {
    w.alerts.loadFacts.mockImplementation((async (problems: Array<{ screenId: string }>) =>
      new Map(problems.map((p) => [p.screenId, { row: {}, facts: { id: p.screenId, status: 'ONLINE', tenantId: 'bench', pairedAt: new Date(0), lastPingAt: new Date(w.clock.now), nativeRuntimeReport: null, nativeRuntimeReportAt: null, credentialEpochRotatedAt: null, lastOtaAt: null, lastOtaState: null, forceApkUpdatePendingAt: null, forceApkUpdateHold: null, displayWindows: [], otaWindow: null, lastPowerCommand: { state: 'off' as const, at: new Date(w.clock.now - MIN) }, lastMaintenanceAt: null } }]))) as any,
    );
    w.setEnv({ EMERGENCY_DRILL_SCREENS: SOLO });
    const r = await w.runner.tick();
    expect(r.results.map((x) => x.reason)).toEqual(['guard3:intended-downtime:remote-power-off:' + SOLO, 'guard3:intended-downtime:remote-power-off:' + SOLO]);
    expect(w.calls).toEqual([]);
    expect(rows(w, DRILL_RESULT_ACTION).every((x) => x.d.verdict === 'SKIPPED' && x.userId === w.users[0].id)).toBe(true);
    // A minute later: the attempt is held. Thirty minutes later it may try again.
    w.clock.now += MIN;
    expect((await w.runner.tick()).results).toEqual([]);
    w.clock.now += 30 * MIN;
    expect((await w.runner.tick()).results).toHaveLength(2);
  });

  it('a tampered identity (someone made it ACTIVE) is never used: SKIPPED, nothing sent, the owner told', async () => {
    w.users.push({ id: 'tampered', tenantId: 'bench', email: drillRunnerEmail('bench'), role: 'SCHOOL_ADMIN', status: 'ACTIVE', passwordHash: 'x', canTriggerPanic: true, deletedAt: null });
    const r = await w.runner.runOnce(SOLO, { kind: 'override', slot: 's' });
    expect(r).toMatchObject({ verdict: 'SKIPPED', reason: 'runner-identity:login-enabled' });
    expect(w.calls).toEqual([]);
    expect(w.mailer.sendAlert.mock.calls.filter((c: any[]) => c[2] === 'ALERT_EMERGENCY_DRILL_IDENTITY')).toHaveLength(1);
  });
});

describe('subtractive switches', () => {
  it('no Redis, no drill — and a DEGRADED lease is no Redis', async () => {
    w.redis.connected = false;
    expect((await w.runner.tick()).status).toBe('no-redis');
    w.redis.connected = true;
    w.lease.degraded = true;
    expect((await w.runner.tick()).status).toBe('no-redis');
    expect(w.calls).toEqual([]);
  });

  it('the kill switch beats everything; unset screens do nothing; NODE_ENV=test is off', async () => {
    w.setEnv({ EMERGENCY_DRILL_CRON_DISABLED: '1', EMERGENCY_DRILL_MODE: 'on' });
    expect((await w.runner.tick()).status).toBe('disabled');
    w.runner.config = () => readDrillConfig({ NODE_ENV: 'production' } as NodeJS.ProcessEnv);
    expect((await w.runner.tick()).status).toBe('disabled');
    w.runner.config = () => readDrillConfig({ NODE_ENV: 'test', EMERGENCY_DRILL_SCREENS: SOLO } as NodeJS.ProcessEnv);
    expect((await w.runner.tick()).status).toBe('disabled');
    expect(w.calls).toEqual([]);
    expect(w.client.screen.findMany).not.toHaveBeenCalled();
  });

  it('onModuleInit under NODE_ENV=test starts no timer', () => {
    const r = new SyntheticDrillRunner({ client: {} } as any, { get: () => null } as any);
    const spy = jest.spyOn(global, 'setInterval');
    r.onModuleInit();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('dead-man (alert / on): a display with no PASS in 36 h, once a day', () => {
  it('emails the gaps once per UTC day', async () => {
    w.setEnv({ EMERGENCY_DRILL_MODE: 'alert', EMERGENCY_DRILL_SCREENS: SOLO });
    w.clock.now = Date.parse('2026-11-02T22:00:00Z'); // past the slot's grace: no drill this tick
    await w.runner.tick();
    const dm = w.mailer.sendAlert.mock.calls.filter((c: any[]) => c[2] === 'ALERT_EMERGENCY_DRILL_DEAD_MAN');
    expect(dm).toHaveLength(1);
    expect(dm[0][1]).toMatch(/GUQ55 — device alert/);
    w.clock.now += 3600_000; // a new hour, the same UTC day
    await w.runner.tick();
    expect(w.mailer.sendAlert.mock.calls.filter((c: any[]) => c[2] === 'ALERT_EMERGENCY_DRILL_DEAD_MAN')).toHaveLength(1);
  });
});
