/**
 * Synthetic emergency drill — the pure rules (design §7, unit).
 *
 * Grading fixtures are CUT FROM THE PRODUCERS, never hand-written: the page's
 * hash comes from `emergencyRenderHash` (the `@cms/api-types` copy, held
 * identical to the player's by the web parity test), the stored value and the
 * `PLAYER_EMERGENCY_*` transition rows from the render-proof handler's own
 * `emergencyRenderEvidence` and its write rule, and the identity from the
 * shared identity rule.
 */
import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import {
  BroadcastInputSchema,
  CUSTOMER_ACTIVITY,
  TriggerEmergencyInputSchema,
  emergencyPaintIdentity,
  emergencyRenderHash,
  overrideAlertPaintIdentity,
} from '@cms/api-types';
import { emergencyRenderEvidence, type EmergencyPaint } from '../../screens/emergency-proof';
import { intendedDowntime, syntheticDrillCovers, type ScreenFacts } from '../../notifications/customer-alerts/customer-alert-policy';
import {
  DRILL_BROADCAST_TEXT,
  DRILL_RESULT_ACTION,
  DRILL_RUNNER_CREATED_ACTION,
  DRILL_STARTED_ACTION,
  DRILL_SWEPT_ACTION,
  DRILL_TIMING,
  DRILL_TYPES,
  PLAYER_NO_PAINT_ACTION,
  PLAYER_PAINTED_ACTION,
  benchDistrictEligible,
  buildBroadcastDrillBody,
  buildDistrictCopyBody,
  buildOverrideDrillBody,
  canaryHoldsFromResults,
  deadManGaps,
  drillHardwareClass,
  drillRunnerEmail,
  drillTypeFor,
  drillWindowsByPane,
  dueSlots,
  evaluateDrillGuards,
  gradeRun,
  liveAlertOnPanes,
  loadCanaryDrillHolds,
  orphanRuns,
  runnerIdentityProblem,
  zonedSlotInstant,
  type GuardInput,
  type PaneSample,
  type PaneTransition,
} from './synthetic-drill.policy';
import { DRILL_ID_TTL_MS, isRunnerMintedDrillId, mintDrillOverrideId, resetSyntheticDrillRegistryForTests } from './synthetic-drill.registry';

const SEC = 1_000;
const MIN = 60 * SEC;
const T0 = Date.parse('2026-11-02T18:30:00Z');
const S1 = '1cff5eb0-0000-4000-8000-000000000001';
const S2 = '80bf9b8d-0000-4000-8000-000000000002';

// ─── the drill folder adds no trigger path ─────────────────────────────────

describe('drill/ declares no controller or route (design §1: an in-process timer only)', () => {
  const dir = __dirname;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'));

  it('no Nest controller / route / gateway / message-handler decorator in any source file', () => {
    expect(files.sort()).toEqual([
      'synthetic-drill.config.ts',
      'synthetic-drill.copy.ts',
      'synthetic-drill.policy.ts',
      'synthetic-drill.registry.ts',
      'synthetic-drill.runner.ts',
    ]);
    for (const f of files) {
      const src = fs.readFileSync(path.join(dir, f), 'utf8');
      expect(src).not.toMatch(/@(Controller|Get|Post|Put|Patch|Delete|All|Options|Head|Sse|WebSocketGateway|SubscribeMessage|MessagePattern|EventPattern)\s*\(/);
    }
  });

  it('…and no exported class carries route metadata (a second, non-textual check)', () => {
    for (const f of files) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require(path.join(dir, f)) as Record<string, unknown>;
      for (const value of Object.values(mod)) {
        if (typeof value !== 'function') continue;
        expect(Reflect.getMetadata('path', value)).toBeUndefined();
        const proto = (value as { prototype?: object }).prototype;
        for (const key of proto ? Object.getOwnPropertyNames(proto) : []) {
          const member = (proto as Record<string, unknown>)[key];
          if (typeof member === 'function') expect(Reflect.getMetadata('path', member)).toBeUndefined();
        }
      }
    }
  });
});

// ─── payloads ──────────────────────────────────────────────────────────────

describe('the frozen payloads', () => {
  it('every type: a device-scoped DRILL, default severity, no words, expiring within 180 s, that parses', () => {
    for (const type of DRILL_TYPES) {
      const body = buildOverrideDrillBody({ screenId: S1, type, overrideId: 'ovr_drill_x', nowMs: T0 });
      expect(TriggerEmergencyInputSchema.parse(body)).toEqual(body);
      expect(body.scopeType).toBe('device');
      expect(body.scopeId).toBe(S1);
      expect(body.overridePayload.isDrill).toBe(true);
      expect(body.overridePayload.severity).toBe('CRITICAL');
      expect(body.overridePayload.type).toBe(type);
      expect(body.overridePayload.textBlob).toBeUndefined();
      expect(body.overridePayload.mediaUrl).toBeUndefined();
      expect(body.overridePayload.playlistId).toBeUndefined();
      const exp = body.overridePayload.expiresAt as number;
      expect(exp).toBeGreaterThan(T0 / 1000);
      expect(exp).toBeLessThanOrEqual(T0 / 1000 + 180);
      expect(Object.isFrozen(body)).toBe(true);
      expect(Object.isFrozen(body.overridePayload)).toBe(true);
    }
  });

  it('the pushed-message and district-copy drills parse, say DRILL on the glass and expire within 180 s', () => {
    const b = buildBroadcastDrillBody({ screenId: S1, nowMs: T0 });
    expect(BroadcastInputSchema.parse(b)).toEqual(b);
    expect(b.screenIds).toEqual([S1]);
    expect(b.text.startsWith('DRILL — ')).toBe(true);
    expect(b.expiresAt).toBeLessThanOrEqual(T0 / 1000 + 180);
    const d = buildDistrictCopyBody({ rootTenantId: 'district-root', nowMs: T0 });
    expect(BroadcastInputSchema.parse(d)).toEqual(d);
    expect(d).toMatchObject({ scopeType: 'tenant', scopeId: 'district-root', text: DRILL_BROADCAST_TEXT });
    expect(d.screenIds).toBeUndefined();
  });

  it('the type rotates through all six', () => {
    const one = new Set(Array.from({ length: 6 }, (_, day) => drillTypeFor(20_000 + day, 0, 1)));
    expect(one.size).toBe(6);
    const two = Array.from({ length: 6 }, (_, day) => [drillTypeFor(30_000 + day, 0, 2), drillTypeFor(30_000 + day, 1, 2)]).flat();
    expect(new Set(two).size).toBe(6);
  });
});

// ─── guards ────────────────────────────────────────────────────────────────

function guardInput(over: Partial<GuardInput> = {}): GuardInput {
  const pane = {
    id: S1,
    tenantId: 'bench',
    status: 'ONLINE',
    pairedAt: new Date(T0 - 30 * 24 * 60 * MIN),
    lastPingAt: new Date(T0 - 20 * SEC),
    lastRenderedHash: 'pl:abc',
    lastRenderedAt: new Date(T0 - 30 * SEC),
  };
  return {
    nowMs: T0,
    allowlist: [S1, S2],
    panes: [pane, { ...pane, id: S2 }],
    roots: [{ id: 'bench', isInternal: true }],
    overrideRows: [],
    tenants: [{ id: 'bench', emergencyStatus: 'INACTIVE' }],
    downtime: new Map([
      [S1, null],
      [S2, null],
    ]),
    redisConnected: true,
    degradedComponents: [],
    ...over,
  };
}

describe('the five guards (each one skips without dispatching)', () => {
  it('all clear → ok', () => {
    expect(evaluateDrillGuards(guardInput())).toEqual({ ok: true });
  });

  const paneOver = (over: Record<string, unknown>) => {
    const g = guardInput();
    return { ...g, panes: [{ ...g.panes[0], ...over }, g.panes[1]] };
  };

  it.each([
    ['1 · a face of the unit is not listed', { allowlist: [S1] }, 1],
    ['2 · the organisation root is not internal', { roots: [{ id: 'bench', isInternal: false }] }, 2],
    ['2 · the root could not be read', { roots: [{ id: 'bench', isInternal: null }] }, 2],
    ['2 · no root at all', { roots: [] }, 2],
    ['3 · revoked', paneOver({ status: 'REVOKED' }), 3],
    ['3 · never paired', paneOver({ status: 'PENDING' }), 3],
    ['3 · silent for 3 minutes', paneOver({ lastPingAt: new Date(T0 - 3 * MIN) }), 3],
    ['3 · meant to be off (its on/off schedule)', { downtime: new Map([[S1, 'display-schedule-off'], [S2, null]]) }, 3],
    ['3 · downtime facts unreadable', { downtime: new Map([[S2, null]]) }, 3],
    ['4 · an override entry on a pane', { overrideRows: [{ screenId: S2, alertId: 'ovr_live', type: 'LOCKDOWN', severity: 'CRITICAL', isDrill: false, triggeredByUserId: 'u', triggeredAt: new Date(T0).toISOString(), expiresAt: null }] }, 4],
    ['4 · the location is in an alert', { tenants: [{ id: 'bench', emergencyStatus: 'CRITICAL' }] }, 4],
    ['4 · no operator content proof (idle)', paneOver({ lastRenderedHash: 'idle:playing' }), 4],
    ['4 · already showing an alert', paneOver({ lastRenderedHash: 'em:abcdef01' }), 4],
    ['4 · content proof older than 2 min', paneOver({ lastRenderedAt: new Date(T0 - 3 * MIN) }), 4],
    ['5 · Redis not connected', { redisConnected: false }, 5],
    ['5 · a platform:critical component', { degradedComponents: ['platform:critical:db:down'] }, 5],
  ] as Array<[string, Partial<GuardInput>, number]>)('guard %s', (_name, over, guard) => {
    const v = evaluateDrillGuards(guardInput(over));
    expect(v.ok).toBe(false);
    expect(v.ok === false && v.guard).toBe(guard);
  });

  it('an EXPIRED leftover override row is not on any glass and does not block', () => {
    const expired = { screenId: S1, alertId: 'old', type: 'HOLD', severity: 'HIGH', isDrill: true, triggeredByUserId: 'u', triggeredAt: new Date(T0 - 2 * 3600_000).toISOString(), expiresAt: new Date(T0 - 3600_000).toISOString() };
    expect(evaluateDrillGuards(guardInput({ overrideRows: [expired] }))).toEqual({ ok: true });
  });

  it('a stalled-video proof is still operator content', () => {
    const g = guardInput();
    expect(evaluateDrillGuards({ ...g, panes: g.panes.map((p) => ({ ...p, lastRenderedHash: 'stall|pl:abc' })) })).toEqual({ ok: true });
  });
});

// ─── grading, over sequences cut from the producers ────────────────────────

const IDENTITY = overrideAlertPaintIdentity({ type: 'lockdown', severity: 'CRITICAL', isDrill: true });

/** One pane as the render-proof handler stores it, driven by what the page posts. */
class HandlerModel {
  hash: string | null = 'pl:sig';
  renderedAtMs: number | null;
  readonly transitions: PaneTransition[] = [];
  constructor(atMs: number) {
    this.renderedAtMs = atMs;
  }
  /** The page's emergency post: `emergencyRenderHash(proof, manifestOkAt, now)` + the proof. */
  postEmergency(atMs: number, painted: boolean, identity = IDENTITY, manifestOkAtMs = atMs) {
    const proof: EmergencyPaint = { identity, documentId: 'doc-1', frames: painted ? 2 : 0, painted };
    this.store(atMs, emergencyRenderHash(proof, manifestOkAtMs, atMs), proof);
  }
  /** The page's content post. */
  postContent(atMs: number, sig = 'pl:sig') {
    this.store(atMs, sig, undefined);
  }
  /** The handler's own rule (screens.controller.ts reportRenderProof). */
  private store(atMs: number, hash: string, proof: EmergencyPaint | undefined) {
    const evidence = emergencyRenderEvidence(hash, proof, undefined);
    const confirmedPaint = !evidence || evidence.painted;
    if (evidence && this.hash !== evidence.hash) {
      this.transitions.push({ atMs, action: confirmedPaint ? PLAYER_PAINTED_ACTION : PLAYER_NO_PAINT_ACTION, identity: proof?.identity ?? null });
    }
    if (confirmedPaint) this.renderedAtMs = atMs;
    this.hash = evidence ? evidence.hash : hash;
  }
  read(atMs: number): PaneSample {
    return { atMs, hash: this.hash, renderedAtMs: this.renderedAtMs };
  }
}

interface Script {
  /** (pane, t ms after dispatch) → what the page posts at that time. */
  at: Array<[number, (pane: HandlerModel, atMs: number) => void]>;
}

/** Run a script against a pane and read it the way the runner does (1 s to +5 s, then every 5 s). */
function observe(script: Script, opts: { clearAt?: number | null; endAt?: number } = {}) {
  const D = T0;
  const pane = new HandlerModel(D - 20 * SEC);
  const clearAt = opts.clearAt === undefined ? D + 125 * SEC : opts.clearAt;
  const reads: number[] = [];
  for (let t = 0; t <= 5 * SEC; t += SEC) reads.push(D + t);
  for (let t = 10 * SEC; t <= (opts.endAt ?? 280 * SEC); t += 5 * SEC) reads.push(D + t);
  const events = script.at.map(([t, f]) => ({ at: D + t, f })).sort((a, b) => a.at - b.at);
  const samples: PaneSample[] = [];
  let i = 0;
  for (const r of reads) {
    while (i < events.length && events[i].at <= r) events[i].f(pane, events[i++].at);
    samples.push(pane.read(r));
  }
  while (i < events.length) events[i].f(pane, events[i++].at);
  return { pane, samples, D, clearAt };
}

function grade(o: ReturnType<typeof observe>, extra: { transitionsReadable?: boolean; cleared?: boolean; expected?: 'identity' | 'first-painted' } = {}) {
  return gradeRun({
    paneIds: ['p1'],
    expected: extra.expected === 'first-painted' ? { rule: 'first-painted' } : { rule: 'identity', identity: IDENTITY },
    dispatchAtMs: o.D,
    clearAtMs: o.clearAt,
    samples: new Map([['p1', o.samples]]),
    transitions: extra.transitionsReadable === false ? null : new Map([['p1', o.pane.transitions]]),
    cleared: extra.cleared ?? true,
  });
}

/** A healthy pane: raise, paint, the 60 s re-proof, the clear, content again. */
const healthy: Script['at'] = [
  [400, (p, at) => p.postEmergency(at, false)],
  [1_200, (p, at) => p.postEmergency(at, true)],
  [61_000, (p, at) => p.postEmergency(at, true)],
  [121_000, (p, at) => p.postEmergency(at, true)],
  [150_000, (p, at) => p.postContent(at)],
];

describe('the three links', () => {
  it('PASS: painted by +5 s, a painted proof dated ≥ +60 s and nothing else until the clear, released after it', () => {
    const g = grade(observe({ at: healthy }));
    expect(g.verdict).toBe('PASS');
    expect(g.panes[0]).toMatchObject({ failedLink: null, expectedIdentity: IDENTITY });
    expect(g.panes[0].raisedAtMs).toBe(T0 + 400);
    expect(g.panes[0].paintedAtMs).toBe(T0 + 1_200);
  });

  it('FAIL delivery: the pane never raised the alert', () => {
    const g = grade(observe({ at: [] }));
    expect(g).toMatchObject({ verdict: 'FAIL', failedLink: 'delivery' });
    expect(g.panes[0].reason).toBe('never-raised');
  });

  it('FAIL render: raised (pending) but no paint proof within 5 s', () => {
    const g = grade(observe({ at: [[400, (p, at) => p.postEmergency(at, false)]] }));
    expect(g).toMatchObject({ verdict: 'FAIL', failedLink: 'render' });
  });

  it('FAIL render: painted, but only at +8 s', () => {
    const g = grade(observe({ at: [[400, (p, at) => p.postEmergency(at, false)], [8_000, (p, at) => p.postEmergency(at, true)]] }));
    expect(g).toMatchObject({ verdict: 'FAIL', failedLink: 'render' });
    expect(g.panes[0].reason).toBe('painted-after-5s');
  });

  it('FAIL render: painted the WRONG identity (a live alert, not the drill)', () => {
    const live = overrideAlertPaintIdentity({ type: 'lockdown', severity: 'CRITICAL', isDrill: false });
    const g = grade(observe({ at: [[1_000, (p, at) => p.postEmergency(at, true, live)]] }));
    expect(g).toMatchObject({ verdict: 'FAIL', failedLink: 'render' });
  });

  it('FAIL persistence — the ~24 s drop class: painted, then content again at +24 s', () => {
    const g = grade(observe({ at: [...healthy.slice(0, 2), [24_000, (p, at) => p.postContent(at)]] }));
    expect(g).toMatchObject({ verdict: 'FAIL', failedLink: 'persistence' });
    expect(g.panes[0].violation?.why).toBe('dropped');
  });

  it('FAIL persistence: a drop between two reads is still caught by the handler’s transition rows', () => {
    // Content at +22 s and the alert back at +23 s: no 5-second read sees `pl:`.
    const g = grade(observe({ at: [...healthy, [22_000, (p, at) => p.postContent(at)], [23_000, (p, at) => p.postEmergency(at, true)]] }));
    expect(g).toMatchObject({ verdict: 'FAIL', failedLink: 'persistence' });
    expect(g.panes[0].violation?.why).toBe('repainted');
  });

  it('FAIL persistence: the screen stopped posting after its first paint (no proof dated ≥ +60 s)', () => {
    const g = grade(observe({ at: [...healthy.slice(0, 2), [150_000, (p, at) => p.postContent(at)]] }));
    expect(g).toMatchObject({ verdict: 'FAIL', failedLink: 'persistence' });
    expect(g.panes[0].reason).toBe('no-painted-proof-after-60s');
  });

  it('FAIL persistence: the alert went "unconfirmed" (no live manifest for 2 min) after it painted', () => {
    const g = grade(observe({ at: [...healthy.slice(0, 2), [61_000, (p, at) => p.postEmergency(at, true, IDENTITY, at - 3 * MIN)]] }));
    expect(g).toMatchObject({ verdict: 'FAIL', failedLink: 'persistence' });
  });

  it('FAIL release: still on the alert 150 s after the all-clear', () => {
    const g = grade(observe({ at: healthy.slice(0, 4) }));
    expect(g).toMatchObject({ verdict: 'FAIL', failedLink: 'release' });
  });

  it('two posts racing the same first paint write two rows: one paint, not a drop', () => {
    const g = grade(observe({ at: [...healthy] }));
    const pane = observe({ at: healthy }).pane;
    const raced = [...pane.transitions, { atMs: T0 + 1_900, action: PLAYER_PAINTED_ACTION, identity: IDENTITY }];
    const g2 = gradeRun({
      paneIds: ['p1'],
      expected: { rule: 'identity', identity: IDENTITY },
      dispatchAtMs: T0,
      clearAtMs: T0 + 125 * SEC,
      samples: new Map([['p1', observe({ at: healthy }).samples]]),
      transitions: new Map([['p1', raced]]),
      cleared: true,
    });
    expect(g.verdict).toBe('PASS');
    expect(g2.verdict).toBe('PASS');
  });

  it('the earliest failed link across panes is named (delivery before render)', () => {
    const a = observe({ at: [[400, (p, at) => p.postEmergency(at, false)]] });
    const b = observe({ at: [] });
    const g = gradeRun({
      paneIds: ['front', 'back'],
      expected: { rule: 'identity', identity: IDENTITY },
      dispatchAtMs: T0,
      clearAtMs: T0 + 125 * SEC,
      samples: new Map([
        ['front', a.samples],
        ['back', b.samples],
      ]),
      transitions: new Map([
        ['front', a.pane.transitions],
        ['back', b.pane.transitions],
      ]),
      cleared: true,
    });
    expect(g).toMatchObject({ verdict: 'FAIL', failedLink: 'delivery' });
    expect(g.reason.startsWith('back:')).toBe(true);
  });

  it('INCONCLUSIVE when the evidence cannot be read', () => {
    const o = observe({ at: [] });
    const g = gradeRun({
      paneIds: ['p1'],
      expected: { rule: 'identity', identity: IDENTITY },
      dispatchAtMs: o.D,
      clearAtMs: o.clearAt,
      samples: new Map([['p1', []]]),
      transitions: null,
      cleared: true,
    });
    expect(g.verdict).toBe('INCONCLUSIVE');
  });

  it('never a PASS when our own all-clear did not go out cleanly (the expiry released it, not the path under test)', () => {
    expect(grade(observe({ at: healthy }), { cleared: false }).verdict).toBe('INCONCLUSIVE');
  });

  it('a pushed message: the first painted identity is latched; a later different identity is a FAIL (persistence)', () => {
    const msg = emergencyPaintIdentity({ id: 'bcast_1', type: 'TEXT_BROADCAST', severity: 'WARN', textBlob: 'DRILL — x', mediaUrls: [], audioUrl: null, expiresAt: 1, createdAt: 'c1' });
    const polled = emergencyPaintIdentity({ id: 'bcast_1', type: 'TEXT_BROADCAST', severity: 'WARN', textBlob: 'DRILL — x', mediaUrls: [], audioUrl: null, expiresAt: 1, createdAt: 'c2' });
    const ok: Script['at'] = [
      [500, (p, at) => p.postEmergency(at, false, msg)],
      [1_500, (p, at) => p.postEmergency(at, true, msg)],
      [62_000, (p, at) => p.postEmergency(at, true, msg)],
      [150_000, (p, at) => p.postContent(at)],
    ];
    expect(grade(observe({ at: ok }), { expected: 'first-painted' })).toMatchObject({ verdict: 'PASS' });
    const swapped = grade(observe({ at: [...ok.slice(0, 2), [30_000, (p, at) => p.postEmergency(at, true, polled)]] }), { expected: 'first-painted' });
    expect(swapped).toMatchObject({ verdict: 'FAIL', failedLink: 'persistence' });
  });
});

// ─── live alerts win ───────────────────────────────────────────────────────

describe('a live alert mid-run aborts (and a drill never hides it)', () => {
  const entry = (over: Record<string, unknown>) => ({
    screenId: S1,
    alertId: 'ovr_drill_1',
    type: 'LOCKDOWN',
    severity: 'CRITICAL',
    isDrill: true,
    triggeredByUserId: 'runner',
    triggeredAt: new Date(T0).toISOString(),
    expiresAt: new Date(T0 + 180 * SEC).toISOString(),
    ...over,
  });
  const base = { nowMs: T0 + 10 * SEC, tenants: [{ id: 'bench', emergencyStatus: 'INACTIVE', emergencyIsDrill: false }], drillOverrideId: 'ovr_drill_1', paneIds: [S1] };
  it('our drill on the pane → carry on', () => {
    expect(liveAlertOnPanes({ ...base, overrideRows: [entry({})] })).toBeNull();
  });
  it('a live entry on the pane → abort', () => {
    expect(liveAlertOnPanes({ ...base, overrideRows: [entry({ alertId: 'ovr_live', isDrill: false })] })).toMatch(/^live-alert-on-screen/);
  });
  it('a live tenant-wide alert → abort', () => {
    expect(liveAlertOnPanes({ ...base, overrideRows: [entry({})], tenants: [{ id: 'bench', emergencyStatus: 'CRITICAL', emergencyIsDrill: false }] })).toMatch(/^live-alert-on-location/);
  });
  it('our drill entry gone before our all-clear (a live alert ended it) → abort', () => {
    expect(liveAlertOnPanes({ ...base, overrideRows: [] })).toMatch(/^drill-ended-externally/);
  });
});

// ─── registry: only ids this process minted, only with isDrill ─────────────

describe('runner-minted ids', () => {
  beforeEach(() => resetSyntheticDrillRegistryForTests());
  it('a minted id is recognised for 15 minutes; the prefix alone never is', () => {
    const id = mintDrillOverrideId(T0);
    expect(id.startsWith('ovr_drill_')).toBe(true);
    expect(isRunnerMintedDrillId(id, T0 + DRILL_ID_TTL_MS)).toBe(true);
    expect(isRunnerMintedDrillId(id, T0 + DRILL_ID_TTL_MS + 1)).toBe(false);
    expect(isRunnerMintedDrillId('ovr_drill_00000000-0000-4000-8000-000000000000', T0)).toBe(false);
    expect(isRunnerMintedDrillId(`ovr_${id.slice('ovr_drill_'.length)}`, T0)).toBe(false);
  });
});

// ─── the drill's own audit rows are machine rows: owner view only ──────────

describe('the drill\'s audit actions never reach a customer feed', () => {
  it('STARTED / RESULT / SWEPT / RUNNER_CREATED are not on the customer activity allowlist', () => {
    for (const action of [DRILL_STARTED_ACTION, DRILL_RESULT_ACTION, DRILL_SWEPT_ACTION, DRILL_RUNNER_CREATED_ACTION]) {
      expect(action.startsWith('EMERGENCY_DRILL_')).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(CUSTOMER_ACTIVITY, action)).toBe(false);
    }
  });
});

// ─── customer alert emails: the synthetic-drill defer ──────────────────────

describe('customer alert emails: a drill is not an incident', () => {
  const started = (runId: string, paneIds: string[], at: number) => ({
    action: DRILL_STARTED_ACTION,
    createdAt: new Date(at),
    details: JSON.stringify({
      v: 1, runId, kind: 'override', overrideId: 'ovr_drill_a', slot: '2026-11-02@10:30', mode: 'shadow', type: 'lockdown', screenId: paneIds[0], paneIds,
      hardwareModel: null, deviceClass: null, playerVersion: null, dispatchAt: new Date(at).toISOString(), expiresAt: new Date(at + 180_000).toISOString(),
      runnerUserId: 'runner', rootTenantId: 'bench',
    }),
  });
  const resultRow = (runId: string, at: number) => ({ action: DRILL_RESULT_ACTION, createdAt: new Date(at), details: JSON.stringify(resultDetails({ runId })) });

  it('window = run + 10 min, every pane of the unit; a run still going counts to its longest length', () => {
    const w = drillWindowsByPane([started('r1', [S1, S2], T0), resultRow('r1', T0 + 4 * MIN), started('r2', ['x'], T0)]);
    expect(w.get(S1)).toEqual({ startMs: T0, untilMs: T0 + 14 * MIN });
    expect(w.get(S2)).toEqual({ startMs: T0, untilMs: T0 + 14 * MIN });
    expect(w.get('x')).toEqual({ startMs: T0, untilMs: T0 + DRILL_TIMING.MAX_RUN_MS + 10 * MIN });
  });

  const facts = (over: Partial<ScreenFacts> = {}): ScreenFacts => ({
    id: S1, status: 'ONLINE', tenantId: 'bench', pairedAt: new Date(T0 - 30 * 24 * 3600_000), lastPingAt: new Date(T0 - MIN),
    nativeRuntimeReport: null, nativeRuntimeReportAt: null, credentialEpochRotatedAt: null, lastOtaAt: null, lastOtaState: null,
    forceApkUpdatePendingAt: null, forceApkUpdateHold: null, displayWindows: [], otaWindow: null, lastPowerCommand: null,
    lastMaintenanceAt: null, ...over,
  });

  it('a problem that began inside the window is deferred as `synthetic-drill` while it lasts — and only then', () => {
    const win = { startMs: T0, untilMs: T0 + 14 * MIN };
    expect(intendedDowntime(facts({ syntheticDrill: win }), 'OFFLINE', T0 - MIN, T0 + 13 * MIN)).toBe('synthetic-drill');
    expect(intendedDowntime(facts({ syntheticDrill: win }), 'NO_CONTENT', T0 + 3 * MIN, T0 + 10 * MIN)).toBe('synthetic-drill');
    // After the window, judged like anything else.
    expect(intendedDowntime(facts({ syntheticDrill: win }), 'OFFLINE', T0 - MIN, T0 + 15 * MIN)).toBeNull();
    // A problem that predates the drill (by more than the guard's 2 min) is not the drill's.
    expect(intendedDowntime(facts({ syntheticDrill: win }), 'OFFLINE', T0 - 5 * MIN, T0 + 10 * MIN)).toBeNull();
    expect(syntheticDrillCovers(null, T0, T0)).toBe(false);
  });
});

// ─── dead-man, canary hold ─────────────────────────────────────────────────

function resultDetails(over: Record<string, unknown>) {
  return {
    v: 1, runId: 'r', kind: 'override', verdict: 'PASS', reason: 'ok', failedLink: null, mode: 'on', slot: 's', type: 'lockdown',
    overrideId: null, messageId: null, expected: null, dispatchAtMs: null, clearAtMs: null, cleared: true, paneIds: [S1], panes: [],
    screenId: S1, rootTenantId: 'bench', hardwareModel: null, deviceClass: 'goodview/m55guq/t982/sdk30', playerVersion: '1.1.58',
    alerted: false, runnerUserId: 'runner', ...over,
  };
}
const row = (at: number, over: Record<string, unknown>) => ({ createdAt: new Date(at), details: JSON.stringify(resultDetails(over)) });

describe('dead-man: no PASS in 36 h', () => {
  it('names each display × kind (and bench district) with no PASS in 36 h', () => {
    const gaps = deadManGaps({
      displays: [{ screenId: S1, label: 'GUQ55' }],
      districtRoots: [{ rootTenantId: 'dist', label: 'Bench district' }],
      rows: [row(T0 - 10 * 3600_000, { kind: 'override' }), row(T0 - 40 * 3600_000, { kind: 'broadcast' }), row(T0 - 3600_000, { kind: 'broadcast', verdict: 'FAIL' })],
      nowMs: T0,
    });
    expect(gaps.map((g) => `${g.label}:${g.kind}:${g.lastVerdict}`)).toEqual(['GUQ55:broadcast:FAIL', 'Bench district:district-copy:null']);
  });
});

describe('canary hold (§9.4): a FAIL holds that hardware class until a PASS — mode `on` only', () => {
  const cls = 'goodview/m55guq/t982/sdk30';
  it('latest judged verdict FAIL → held; a later PASS releases; ABORTED / SKIPPED never count', () => {
    const held = canaryHoldsFromResults({ mode: 'on', enabled: true, nowMs: T0, rows: [row(T0 - 2 * 3600_000, { verdict: 'PASS' }), row(T0 - 3600_000, { verdict: 'FAIL', runId: 'bad' }), row(T0 - 60_000, { verdict: 'ABORTED' })] });
    expect([...held.keys()]).toEqual([cls]);
    expect(held.get(cls)?.runId).toBe('bad');
    const released = canaryHoldsFromResults({ mode: 'on', enabled: true, nowMs: T0, rows: [row(T0 - 2 * 3600_000, { verdict: 'FAIL' }), row(T0 - 3600_000, { verdict: 'PASS' })] });
    expect(released.size).toBe(0);
  });
  it('shadow / alert / the kill switch hold nothing', () => {
    const rows = [row(T0 - 3600_000, { verdict: 'FAIL' })];
    expect(canaryHoldsFromResults({ mode: 'shadow', enabled: true, nowMs: T0, rows }).size).toBe(0);
    expect(canaryHoldsFromResults({ mode: 'alert', enabled: true, nowMs: T0, rows }).size).toBe(0);
    expect(canaryHoldsFromResults({ mode: 'on', enabled: false, nowMs: T0, rows }).size).toBe(0);
  });
  it('the loader reads nothing at all unless enabled in mode `on`', async () => {
    const db = { screen: { findMany: jest.fn(async () => [{ tenantId: 'bench' }]) }, auditLog: { findMany: jest.fn(async () => [row(T0 - 60_000, { verdict: 'FAIL' })]) } };
    expect((await loadCanaryDrillHolds(db, { enabled: true, mode: 'shadow', screenIds: [S1] }, T0)).size).toBe(0);
    expect(db.screen.findMany).not.toHaveBeenCalled();
    expect((await loadCanaryDrillHolds(db, { enabled: true, mode: 'on', screenIds: [S1] }, T0)).size).toBe(1);
  });
  it('the class: the reviewed playback class from the unit’s build, else the hardware model', () => {
    expect(drillHardwareClass({ displayCapabilities: { build: { manufacturer: 'Goodview', model: 'M55GUQ', device: 't982', sdk: 30 } } })).toMatch(/m55guq/);
    expect(drillHardwareClass({ hardwareModel: 'novastar-taurus' })).toBe('model:novastar-taurus');
    expect(drillHardwareClass({ hardwareModel: 'unknown' })).toBeNull();
  });
});

// ─── orphans ───────────────────────────────────────────────────────────────

describe('orphan runs', () => {
  const st = (runId: string, at: number) => ({ tenantId: 'bench', action: DRILL_STARTED_ACTION, createdAt: new Date(at), details: JSON.stringify({
    v: 1, runId, kind: 'override', overrideId: `ovr_drill_${runId}`, slot: 's', mode: 'shadow', type: 'hold', screenId: S1, paneIds: [S1],
    hardwareModel: null, deviceClass: null, playerVersion: null, dispatchAt: new Date(at).toISOString(), expiresAt: new Date(at + 180_000).toISOString(),
    runnerUserId: 'runner', rootTenantId: 'bench' }) });
  it('a STARTED run with no RESULT and no SWEPT, older than the longest run, not driven here → one sweep', () => {
    const old = T0 - DRILL_TIMING.MAX_RUN_MS - MIN;
    const rows = [
      st('orphan', old),
      st('done', old),
      { tenantId: 'bench', action: DRILL_RESULT_ACTION, createdAt: new Date(old + 4 * MIN), details: JSON.stringify(resultDetails({ runId: 'done' })) },
      st('swept', old),
      { tenantId: 'bench', action: DRILL_SWEPT_ACTION, createdAt: new Date(old + 9 * MIN), details: JSON.stringify({ v: 1, runId: 'swept', kind: 'override', outcome: 'cleared', clearedIds: [], runnerUserId: 'runner' }) },
      st('young', T0 - MIN),
      st('mine', old),
    ];
    const out = orphanRuns({ rows, nowMs: T0, inFlightHere: (id) => id === 'mine' });
    expect(out.map((o) => o.runId)).toEqual(['orphan']);
    expect(out[0]).toMatchObject({ tenantId: 'bench', overrideId: 'ovr_drill_orphan', screenId: S1, runnerUserId: 'runner' });
  });
});

// ─── slots in each screen's own zone (§9.3) ────────────────────────────────

describe('slots in each screen’s own time zone (never UTC)', () => {
  const slots = [{ label: '10:30', minuteOfDay: 630 }];
  it('10:30 local in Los Angeles is 17:30 UTC in November (PST) and 17:30 → due for 3 h', () => {
    const at = Date.parse('2026-11-02T18:30:00Z'); // 10:30 PST
    expect(zonedSlotInstant('America/Los_Angeles', at, 630)).toBe(at);
    expect(dueSlots('America/Los_Angeles', slots, at - 1)).toEqual([]);
    expect(dueSlots('America/Los_Angeles', slots, at)[0]).toMatchObject({ key: '2026-11-02@10:30', localDate: '2026-11-02', atMs: at });
    expect(dueSlots('America/Los_Angeles', slots, at + 3 * 3600_000 - 1)).toHaveLength(1);
    expect(dueSlots('America/Los_Angeles', slots, at + 3 * 3600_000)).toEqual([]);
  });
  it('the same wall time moves with daylight saving (PDT in October)', () => {
    expect(zonedSlotInstant('America/Los_Angeles', Date.parse('2026-10-20T12:00:00Z'), 630)).toBe(Date.parse('2026-10-20T17:30:00Z'));
    expect(zonedSlotInstant('Europe/London', Date.parse('2026-07-01T12:00:00Z'), 630)).toBe(Date.parse('2026-07-01T09:30:00Z'));
  });
  it('a screen whose zone is unknown has no slots at all — never a guessed clock', () => {
    expect(dueSlots(null, slots, T0)).toEqual([]);
    expect(dueSlots('Not/AZone', slots, T0)).toEqual([]);
  });
});

// ─── the service identity (§9.1) ───────────────────────────────────────────

describe('the drill-runner service identity', () => {
  const ok = { id: 'u', tenantId: 'bench', email: drillRunnerEmail('bench'), role: 'SCHOOL_ADMIN', status: 'DISABLED', passwordHash: 'synthetic-drill-runner-no-password', canTriggerPanic: true, deletedAt: null };
  it('exactly the login-disabled shape is usable; anything made login-capable is not', () => {
    expect(runnerIdentityProblem(ok, 'bench')).toBeNull();
    expect(drillRunnerEmail('bench')).toMatch(/\.invalid$/);
    expect(runnerIdentityProblem({ ...ok, status: 'ACTIVE' }, 'bench')).toBe('login-enabled');
    expect(runnerIdentityProblem({ ...ok, passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$abc$def' }, 'bench')).toBe('password-set');
    expect(runnerIdentityProblem({ ...ok, role: 'SUPER_ADMIN' }, 'bench')).toBe('role-changed');
    expect(runnerIdentityProblem({ ...ok, canTriggerPanic: false }, 'bench')).toBe('panic-capability-removed');
    expect(runnerIdentityProblem({ ...ok, deletedAt: new Date() }, 'bench')).toBe('deleted');
    expect(runnerIdentityProblem({ ...ok, tenantId: 'other' }, 'bench')).toBe('wrong-location');
    expect(runnerIdentityProblem(null, 'bench')).toBe('missing');
  });
});

// ─── the bench district (§9.2) ─────────────────────────────────────────────

describe('a bench district exists only when a tenant-scoped send reaches listed glass alone', () => {
  const s = (id: string, tenantId: string, status = 'ONLINE') => ({ id, tenantId, status });
  it('eligible: locations under the root, a listed screen in one, every live screen listed', () => {
    expect(benchDistrictEligible({ rootTenantId: 'd', descendantTenantIds: ['l1'], subtreeScreens: [s('a', 'l1'), s('b', 'd'), s('c', 'l1', 'PENDING')], allowlist: ['a', 'b'] })).toMatchObject({ eligible: true, paneIds: ['a', 'b'] });
  });
  it('not eligible: no locations; an unlisted live screen anywhere in the subtree; nothing listed in a location', () => {
    expect(benchDistrictEligible({ rootTenantId: 'd', descendantTenantIds: [], subtreeScreens: [s('a', 'd')], allowlist: ['a'] }).eligible).toBe(false);
    expect(benchDistrictEligible({ rootTenantId: 'd', descendantTenantIds: ['l1'], subtreeScreens: [s('a', 'l1'), s('z', 'l1')], allowlist: ['a'] })).toMatchObject({ eligible: false, reason: 'unlisted-screens-in-subtree' });
    expect(benchDistrictEligible({ rootTenantId: 'd', descendantTenantIds: ['l1'], subtreeScreens: [s('a', 'd')], allowlist: ['a'] })).toMatchObject({ eligible: false, reason: 'no-listed-screen-in-a-location' });
  });
});
