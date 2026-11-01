/**
 * SYNTHETIC EMERGENCY DRILL — the pure rules (2026-11-01).
 *
 * Design: docs/governance/decisions/2026-10-31-synthetic-emergency-drill-design.md
 * §1–§8, as modified by the lead's §9 and the owner's §10 (those win where they
 * differ). Everything the runner DECIDES is decided here — guards, the type
 * rotation, the frozen payloads, the three evidence links, the verdict, the
 * dead-man gaps, the canary hold, the customer-alert defer window, the local
 * slots — so each is a microsecond unit test and the runner only gathers facts.
 *
 * PURE: no Prisma, no Redis, no clock of its own (every `nowMs` is passed in).
 *
 * WHAT A RUN PROVES, per pane of the bench display (both faces of a
 * double-sided unit), from the evidence the render-proof handler already
 * records for every screen in the fleet — `Screen.lastRenderedHash` /
 * `lastRenderedAt` and its `PLAYER_EMERGENCY_*` audit rows:
 *   1. DELIVERY + PAINT — by +5 s the pane painted the alert's identity
 *      (`em:<identity>`; the player's rule, copied to `@cms/api-types` and
 *      held identical by a parity test). Raised but not painted names RENDER;
 *      nothing at all names DELIVERY.
 *   2. PERSISTENCE — from first paint until the all-clear the pane never
 *      reports anything else (the ~24 s drop class of 2026-07 → 10-22), and it
 *      posts a painted proof dated ≥ +60 s.
 *   3. RELEASE — after the all-clear the pane leaves every `em:` form, with a
 *      proof dated after the clear, within 150 s.
 * PASS needs all three; FAIL names the first failed link; INCONCLUSIVE means
 * the evidence could not be read. "In doubt: never trigger, always clear."
 */
import { z } from 'zod';
import {
  TriggerEmergencyInputSchema,
  BroadcastInputSchema,
  isEmergencyRenderHash,
  playbackDeviceClass,
  type TriggerEmergencyInput,
  type BroadcastInput,
  type PlaybackBuildInfo,
} from '@cms/api-types';
import { entriesOfRow, isEntryExpired } from '../alert-stack';
import { deviceScopeScreenIds } from '../../screens/screen-faces';
import type { DrillMode, DrillSlot } from './synthetic-drill.config';

const SEC = 1_000;
const MIN = 60 * SEC;

// ─── Timing ────────────────────────────────────────────────────────────────

export const DRILL_TIMING = Object.freeze({
  /** The payload's own expiry — the first of the three releases. */
  EXPIRES_AFTER_S: 180,
  /** Link 1: delivery + paint deadline. */
  LINK1_DEADLINE_MS: 5 * SEC,
  LINK1_POLL_MS: 1 * SEC,
  /** Link 2: a painted proof dated at least this long after dispatch. */
  LINK2_FROM_MS: 60 * SEC,
  /** Link 2: give up waiting for that proof here. */
  LINK2_UNTIL_MS: 135 * SEC,
  /** The all-clear goes out by here at the latest (and in `finally`). */
  CLEAR_BY_MS: 150 * SEC,
  /** Link 3: release window after the all-clear. */
  LINK3_WINDOW_MS: 150 * SEC,
  POLL_MS: 5 * SEC,
  /** A trigger / clear call that has not returned by now is treated as "maybe sent". */
  CALL_TIMEOUT_MS: 20 * SEC,
  /** A single evidence read that has not returned by now counts as unreadable. */
  READ_TIMEOUT_MS: 4 * SEC,
  /** Two PAINTED rows of the same identity this close together are one paint (two posts raced). */
  REPAINT_DEDUPE_MS: 3 * SEC,
  /** Longest a run can last (dispatch → end of link 3, plus slack) — the orphan sweep waits this long. */
  MAX_RUN_MS: 8 * MIN,
  /** Guard 3: checked in this recently. */
  PING_FRESH_MS: 2 * MIN,
  /** Guard 4: a `pl:` proof this recent. */
  CONTENT_PROOF_FRESH_MS: 2 * MIN,
  /** A due slot that could not run by this long after its time is missed (the dead-man reports it). */
  SLOT_GRACE_MS: 3 * 60 * MIN,
  /** Dead-man: no PASS in this long. */
  DEAD_MAN_MS: 36 * 60 * MIN,
  /** Customer alert emails defer a screen's problem for the run + this long. */
  CUSTOMER_ALERT_TAIL_MS: 10 * MIN,
  /** The canary hold reads verdicts this far back (a later PASS releases it sooner). */
  CANARY_LOOKBACK_MS: 7 * 24 * 60 * MIN,
});

// ─── Audit actions (append-only `audit_logs` rows; no new table) ───────────

export const DRILL_STARTED_ACTION = 'EMERGENCY_DRILL_STARTED';
export const DRILL_RESULT_ACTION = 'EMERGENCY_DRILL_RESULT';
/** The orphan sweep's one all-clear for a run that never wrote its result. */
export const DRILL_SWEPT_ACTION = 'EMERGENCY_DRILL_SWEPT';
/** The service identity was created (once per bench location). */
export const DRILL_RUNNER_CREATED_ACTION = 'EMERGENCY_DRILL_RUNNER_CREATED';

export const PLAYER_PAINTED_ACTION = 'PLAYER_EMERGENCY_PAINTED';
export const PLAYER_NO_PAINT_ACTION = 'PLAYER_EMERGENCY_NO_PAINT_PROOF';

export type DrillKind = 'override' | 'broadcast' | 'district-copy';
export const DRILL_KINDS: readonly DrillKind[] = ['override', 'broadcast', 'district-copy'];
/** The kinds every listed display must PASS daily (exit from shadow: §9.2). */
export const DAILY_SCREEN_KINDS: readonly DrillKind[] = ['override', 'broadcast'];

export type DrillVerdict = 'PASS' | 'FAIL' | 'INCONCLUSIVE' | 'SKIPPED' | 'ABORTED';
export type FailedLink = 'delivery' | 'render' | 'persistence' | 'release';
const LINK_ORDER: readonly FailedLink[] = ['delivery', 'render', 'persistence', 'release'];

// ─── The service identity (§9.1) ────────────────────────────────────────────

/**
 * A login-disabled `drill-runner` user per bench location, created only where
 * the organisation's ROOT is internal. It exists so every row a drill writes —
 * ours and the trigger path's own `TRIGGER_EMERGENCY_DRILL` — names who fired
 * it (Article 37). It can never sign in: status DISABLED (login-eligibility
 * refuses every non-ACTIVE row on the password AND passkey paths), a password
 * hash that is not a PHC string (argon2 rejects every attempt), an address on
 * the reserved `.invalid` TLD, alert emails off.
 */
export const DRILL_RUNNER_ROLE = 'SCHOOL_ADMIN';
export const DRILL_RUNNER_STATUS = 'DISABLED';
export const DRILL_RUNNER_NO_PASSWORD = 'synthetic-drill-runner-no-password';
export const DRILL_RUNNER_FIRST_NAME = 'Drill runner';
export const DRILL_RUNNER_LAST_NAME = '(automated)';

export function drillRunnerEmail(tenantId: string): string {
  return `drill-runner+${tenantId.toLowerCase()}@synthetic-drill.venueos.invalid`;
}

export interface RunnerUserRow {
  id: string;
  tenantId: string;
  email: string;
  role: string;
  status: string | null;
  passwordHash: string | null;
  canTriggerPanic: boolean;
  deletedAt: Date | null;
}

/**
 * Null when the row is exactly the service identity; otherwise why it may not
 * be used. A row someone turned into a login-capable account (ACTIVE, a real
 * password, another role) is never used to fire anything — the run is skipped
 * and the owner told.
 */
export function runnerIdentityProblem(u: RunnerUserRow | null, tenantId: string): string | null {
  if (!u) return 'missing';
  if (u.tenantId !== tenantId) return 'wrong-location';
  if (u.email !== drillRunnerEmail(tenantId)) return 'wrong-email';
  if (u.deletedAt) return 'deleted';
  if (u.role !== DRILL_RUNNER_ROLE) return 'role-changed';
  if (u.status !== DRILL_RUNNER_STATUS) return 'login-enabled';
  if (typeof u.passwordHash === 'string' && u.passwordHash.startsWith('$argon2')) return 'password-set';
  if (!u.canTriggerPanic) return 'panic-capability-removed';
  return null;
}

/** The in-memory principal the controller methods read (`req.user`). */
export function runnerPrincipal(userId: string, tenantId: string): {
  id: string;
  sub: string;
  role: string;
  tenantId: string;
  canTriggerPanic: true;
  kind: 'user';
} {
  return { id: userId, sub: userId, role: DRILL_RUNNER_ROLE, tenantId, canTriggerPanic: true, kind: 'user' };
}

// ─── The type rotation and the frozen payloads ──────────────────────────────

/** The six incident types, in the order a bench rotates through them. */
export const DRILL_TYPES = Object.freeze(['lockdown', 'evacuate', 'weather', 'hold', 'secure', 'medical'] as const);
export type DrillType = (typeof DRILL_TYPES)[number];
/** The default severity (`OverridePayloadSchema`'s own default). */
export const DRILL_SEVERITY = 'CRITICAL';

/** Day `localDayNumber` (days since 1970-01-01 in the screen's zone), slot index → type. */
export function drillTypeFor(localDayNumber: number, slotIndex: number, slotsPerDay: number): DrillType {
  const n = Math.max(1, slotsPerDay);
  const i = (((localDayNumber * n + slotIndex) % DRILL_TYPES.length) + DRILL_TYPES.length) % DRILL_TYPES.length;
  return DRILL_TYPES[i];
}

/**
 * THE one device-scoped drill trigger the runner can send: `isDrill: true`,
 * the default severity, no words (nothing to translate, and a predictable
 * paint identity), `expiresAt` ≤ +180 s. Frozen and parsed with the trigger's
 * own schema, because the in-process call skips the HTTP validation pipe.
 */
export function buildOverrideDrillBody(input: {
  screenId: string;
  type: DrillType;
  overrideId: string;
  nowMs: number;
}): Readonly<TriggerEmergencyInput> {
  const body = TriggerEmergencyInputSchema.parse({
    scopeType: 'device',
    scopeId: input.screenId,
    overridePayload: {
      overrideId: input.overrideId,
      type: input.type,
      isDrill: true,
      expiresAt: Math.floor(input.nowMs / 1000) + DRILL_TIMING.EXPIRES_AFTER_S,
    },
  });
  return Object.freeze({ ...body, overridePayload: Object.freeze({ ...body.overridePayload }) });
}

/**
 * The words of the pushed-message drill. A broadcast has no `isDrill` flag
 * (the column does not exist and the controller is out of bounds for this
 * change), so the words carry the drill mark on the glass, like the trigger's
 * own "DRILL — " prefix does for an old bundle. Shown on bench glass only.
 */
export const DRILL_BROADCAST_TEXT = 'DRILL — Automated test of emergency messages on this screen. No action is needed.';
export const DRILL_BROADCAST_SEVERITY = 'WARN';

/** The pushed-message drill aimed at one bench display (`screenIds` reaches every face). */
export function buildBroadcastDrillBody(input: { screenId: string; nowMs: number }): Readonly<BroadcastInput> {
  return Object.freeze(
    BroadcastInputSchema.parse({
      scopeType: 'device',
      scopeId: input.screenId,
      screenIds: [input.screenId],
      text: DRILL_BROADCAST_TEXT,
      severity: DRILL_BROADCAST_SEVERITY,
      expiresAt: Math.floor(input.nowMs / 1000) + DRILL_TIMING.EXPIRES_AFTER_S,
    }),
  );
}

/** The district-copy drill: a tenant-scoped send at the bench district's ROOT (one copy per location). */
export function buildDistrictCopyBody(input: { rootTenantId: string; nowMs: number }): Readonly<BroadcastInput> {
  return Object.freeze(
    BroadcastInputSchema.parse({
      scopeType: 'tenant',
      scopeId: input.rootTenantId,
      text: DRILL_BROADCAST_TEXT,
      severity: DRILL_BROADCAST_SEVERITY,
      expiresAt: Math.floor(input.nowMs / 1000) + DRILL_TIMING.EXPIRES_AFTER_S,
    }),
  );
}

// ─── Guards (§1) — all five, re-checked right before dispatch ──────────────

export interface GuardPane {
  id: string;
  tenantId: string | null;
  status: string | null;
  pairedAt: Date | null;
  lastPingAt: Date | null;
  lastRenderedHash: string | null;
  lastRenderedAt: Date | null;
}

export interface GuardInput {
  nowMs: number;
  allowlist: readonly string[];
  /** Every pane the send will reach. */
  panes: readonly GuardPane[];
  /** The organisation root of every pane's location, read FRESH (null = unreadable). */
  roots: ReadonlyArray<{ id: string; isInternal: boolean | null }>;
  /** Every override row any pane holds. */
  overrideRows: readonly unknown[];
  /** The panes' own locations. */
  tenants: ReadonlyArray<{ id: string; emergencyStatus: string | null }>;
  /** `intendedDowntime` per pane (customer-alert-policy), `synthetic-drill` already filtered out. */
  downtime: ReadonlyMap<string, string | null>;
  redisConnected: boolean;
  degradedComponents: readonly string[];
}

export type GuardVerdict =
  | { ok: true }
  | { ok: false; guard: 1 | 2 | 3 | 4 | 5; reason: string; paneId?: string };

/** `pl:` (or a stalled `pl:` video — still operator content) is content on the glass. */
export function isContentProofHash(hash: string | null | undefined): boolean {
  return typeof hash === 'string' && /^(?:stall\|)?pl:/.test(hash);
}

/** The `screenId` of an override row, as text. */
function screenIdOf(row: unknown): string {
  const v = (row as { screenId?: unknown } | null)?.screenId;
  return typeof v === 'string' ? v : '';
}

export function evaluateDrillGuards(g: GuardInput): GuardVerdict {
  if (g.panes.length === 0) return { ok: false, guard: 1, reason: 'no-panes' };
  // 1 — every pane the send reaches is listed (a double-sided unit: both faces).
  for (const p of g.panes) {
    if (!g.allowlist.includes(p.id)) return { ok: false, guard: 1, reason: 'pane-not-listed', paneId: p.id };
  }
  // 2 — the organisation ROOT is internal, read fresh. Unknown is "no".
  if (g.roots.length === 0) return { ok: false, guard: 2, reason: 'root-unreadable' };
  for (const r of g.roots) {
    if (r.isInternal !== true) return { ok: false, guard: 2, reason: r.isInternal === null ? 'root-unreadable' : 'root-not-internal' };
  }
  // 3 — paired, not revoked, checked in within 2 min, not meant to be off.
  for (const p of g.panes) {
    if (!p.tenantId) return { ok: false, guard: 3, reason: 'unassigned', paneId: p.id };
    if (p.status === 'REVOKED') return { ok: false, guard: 3, reason: 'revoked', paneId: p.id };
    if (p.status === 'PENDING' || !p.pairedAt) return { ok: false, guard: 3, reason: 'not-paired', paneId: p.id };
    if (!p.lastPingAt || g.nowMs - p.lastPingAt.getTime() > DRILL_TIMING.PING_FRESH_MS || p.lastPingAt.getTime() > g.nowMs + MIN) {
      return { ok: false, guard: 3, reason: 'not-checked-in', paneId: p.id };
    }
    if (!g.downtime.has(p.id)) return { ok: false, guard: 3, reason: 'downtime-unreadable', paneId: p.id };
    const why = g.downtime.get(p.id);
    if (why) return { ok: false, guard: 3, reason: `intended-downtime:${why}`, paneId: p.id };
  }
  // 4 — nothing else on the glass: no override entry (shown or covered), the
  //     location not in an alert, and operator content proven in the last 2 min.
  for (const row of g.overrideRows) {
    const live = entriesOfRow(row).filter((e) => !isEntryExpired(e, g.nowMs));
    if (live.length > 0) return { ok: false, guard: 4, reason: 'override-entry-present', paneId: screenIdOf(row) };
  }
  for (const p of g.panes) {
    const t = g.tenants.find((x) => x.id === p.tenantId);
    if (!t) return { ok: false, guard: 4, reason: 'location-unreadable', paneId: p.id };
    if (t.emergencyStatus && t.emergencyStatus !== 'INACTIVE') return { ok: false, guard: 4, reason: 'location-in-alert', paneId: p.id };
    if (!isContentProofHash(p.lastRenderedHash)) return { ok: false, guard: 4, reason: 'no-content-proof', paneId: p.id };
    const at = p.lastRenderedAt?.getTime();
    if (at === undefined || g.nowMs - at > DRILL_TIMING.CONTENT_PROOF_FRESH_MS) return { ok: false, guard: 4, reason: 'content-proof-stale', paneId: p.id };
  }
  // 5 — the realtime path is up and the platform is not in trouble.
  if (!g.redisConnected) return { ok: false, guard: 5, reason: 'redis-not-connected' };
  const critical = g.degradedComponents.find((c) => c.startsWith('platform:critical'));
  if (critical) return { ok: false, guard: 5, reason: `platform-critical:${critical}` };
  return { ok: true };
}

/** The panes a device-scoped send reaches: the named screen's whole display. */
export function unitPaneIds(screenId: string, unitRows: Array<{ id: string; faceOfScreenId?: string | null }>): string[] {
  return deviceScopeScreenIds(screenId, unitRows).sort();
}

/**
 * The bench DISTRICT check (§9.2): a tenant-scoped send at an internal root
 * reaches EVERY screen below it, so the district-copy drill runs only when the
 * root has locations under it, a listed screen sits in one of them, and every
 * live (paired, not revoked) screen of the whole subtree is listed.
 */
export function benchDistrictEligible(input: {
  rootTenantId: string;
  descendantTenantIds: readonly string[];
  subtreeScreens: ReadonlyArray<{ id: string; tenantId: string | null; status: string | null }>;
  allowlist: readonly string[];
}): { eligible: boolean; reason: string; paneIds: string[] } {
  if (input.descendantTenantIds.length === 0) return { eligible: false, reason: 'no-locations-under-root', paneIds: [] };
  const live = input.subtreeScreens.filter((s) => s.status !== 'REVOKED' && s.status !== 'PENDING');
  const unlisted = live.filter((s) => !input.allowlist.includes(s.id));
  if (unlisted.length > 0) return { eligible: false, reason: 'unlisted-screens-in-subtree', paneIds: [] };
  const inLocation = live.filter((s) => s.tenantId && input.descendantTenantIds.includes(s.tenantId));
  if (inLocation.length === 0) return { eligible: false, reason: 'no-listed-screen-in-a-location', paneIds: [] };
  return { eligible: true, reason: 'ok', paneIds: live.map((s) => s.id).sort() };
}

// ─── The evidence and the three links ───────────────────────────────────────

/** One point read of a pane's `Screen` row. */
export interface PaneSample {
  atMs: number;
  hash: string | null;
  renderedAtMs: number | null;
}

/** One `PLAYER_EMERGENCY_*` audit row the render-proof handler wrote for a pane. */
export interface PaneTransition {
  atMs: number;
  action: string;
  identity: string | null;
}

export type ExpectedIdentity =
  /** The OVERRIDE: the identity is known before dispatch. */
  | { rule: 'identity'; identity: string }
  /**
   * A pushed message is hashed WHOLE by the player, including the receipt
   * time it stamps on a push, so its identity cannot be known in advance.
   * The first identity the pane PAINTS after dispatch is latched as expected.
   */
  | { rule: 'first-painted' };

/** `em:X` / `pending|em:X` / `unconfirmed|em:X` → its form and identity. */
export function parseEmergencyHash(hash: string | null | undefined): { form: 'painted' | 'pending' | 'unconfirmed'; identity: string } | null {
  if (!isEmergencyRenderHash(hash)) return null;
  const h = hash as string;
  if (h.startsWith('pending|em:')) return { form: 'pending', identity: h.slice('pending|em:'.length) };
  if (h.startsWith('unconfirmed|em:')) return { form: 'unconfirmed', identity: h.slice('unconfirmed|em:'.length) };
  return { form: 'painted', identity: h.slice('em:'.length) };
}

export interface PaneGrade {
  id: string;
  expectedIdentity: string | null;
  raisedAtMs: number | null;
  paintedAtMs: number | null;
  persistedAtMs: number | null;
  releasedAtMs: number | null;
  violation: { atMs: number; hash: string | null; why: string } | null;
  lastHash: string | null;
  lastRenderedAtMs: number | null;
  /** First link this pane failed, `null` when it passed every link. */
  failedLink: FailedLink | null;
  /** True when a link could not be judged (no readable evidence). */
  unreadable: boolean;
  reason: string;
}

export interface GradeInput {
  paneIds: readonly string[];
  expected: ExpectedIdentity;
  dispatchAtMs: number;
  /** When the all-clear call started; null when it never went out. */
  clearAtMs: number | null;
  /** Point reads per pane, in time order (failed reads are simply absent). */
  samples: ReadonlyMap<string, readonly PaneSample[]>;
  /** The handler's transition rows per pane; null when the read failed. */
  transitions: ReadonlyMap<string, readonly PaneTransition[]> | null;
}

/** Grade one pane against the three links. */
export function gradePane(id: string, input: GradeInput): PaneGrade {
  const { dispatchAtMs, clearAtMs, expected } = input;
  const samples = [...(input.samples.get(id) ?? [])].filter((s) => s.atMs >= dispatchAtMs).sort((a, b) => a.atMs - b.atMs);
  const transitions = input.transitions
    ? [...(input.transitions.get(id) ?? [])].filter((t) => t.atMs >= dispatchAtMs - SEC).sort((a, b) => a.atMs - b.atMs)
    : [];
  // A read taken at the very instant the all-clear call starts was taken before it went out.
  const preClear = (at: number) => clearAtMs === null || at <= clearAtMs;
  const last = samples[samples.length - 1];

  // Expected identity: known, or latched from the first PAINT (either source).
  let identity: string | null = expected.rule === 'identity' ? expected.identity : null;
  if (identity === null) {
    const paintedSample = samples.find((s) => preClear(s.atMs) && parseEmergencyHash(s.hash)?.form !== 'pending' && !!parseEmergencyHash(s.hash));
    const paintedRow = transitions.find((t) => preClear(t.atMs) && t.action === PLAYER_PAINTED_ACTION && !!t.identity);
    const candidates = [
      paintedSample ? { at: paintedSample.atMs, id: parseEmergencyHash(paintedSample.hash)!.identity } : null,
      paintedRow ? { at: paintedRow.atMs, id: paintedRow.identity as string } : null,
    ].filter((c): c is { at: number; id: string } => !!c).sort((a, b) => a.at - b.at);
    identity = candidates[0]?.id ?? null;
  }

  // Link 1 — raise and paint times, from both sources (the earlier wins).
  const firstOf = (xs: number[]) => (xs.length ? Math.min(...xs) : null);
  const raisedAtMs = firstOf([
    ...samples.filter((s) => preClear(s.atMs) && !!parseEmergencyHash(s.hash)).map((s) => s.atMs),
    ...transitions.filter((t) => preClear(t.atMs) && (t.action === PLAYER_PAINTED_ACTION || t.action === PLAYER_NO_PAINT_ACTION)).map((t) => t.atMs),
  ]);
  const paintsExpected = (h: string | null) => {
    const p = parseEmergencyHash(h);
    return !!p && p.form !== 'pending' && p.identity === identity;
  };
  const paintedAtMs = identity === null ? null : firstOf([
    ...samples.filter((s) => preClear(s.atMs) && paintsExpected(s.hash)).map((s) => s.atMs),
    ...transitions.filter((t) => preClear(t.atMs) && t.action === PLAYER_PAINTED_ACTION && t.identity === identity).map((t) => t.atMs),
  ]);

  // Link 2 — nothing but `em:<identity>` from first paint until the clear.
  let violation: PaneGrade['violation'] = null;
  if (paintedAtMs !== null) {
    for (const s of samples) {
      if (s.atMs <= paintedAtMs || !preClear(s.atMs)) continue;
      if (s.hash !== `em:${identity}`) {
        violation = { atMs: s.atMs, hash: s.hash, why: isEmergencyRenderHash(s.hash) ? 'changed' : 'dropped' };
        break;
      }
    }
    const firstPaintRow = transitions.find((t) => t.action === PLAYER_PAINTED_ACTION && t.identity === identity);
    for (const t of transitions) {
      if (t.atMs <= paintedAtMs || !preClear(t.atMs) || t === firstPaintRow) continue;
      // Two posts racing the same first paint write two identical rows: one paint.
      if (t.action === PLAYER_PAINTED_ACTION && t.identity === identity && firstPaintRow && t.atMs - firstPaintRow.atMs <= DRILL_TIMING.REPAINT_DEDUPE_MS) continue;
      if (!violation || t.atMs < violation.atMs) {
        violation = { atMs: t.atMs, hash: null, why: t.action === PLAYER_NO_PAINT_ACTION ? 'paint-lost' : 'repainted' };
      }
      break;
    }
  }
  const persisted = samples.find(
    (s) => preClear(s.atMs) && s.hash === `em:${identity}` && s.renderedAtMs !== null && s.renderedAtMs >= dispatchAtMs + DRILL_TIMING.LINK2_FROM_MS,
  );
  const persistedAtMs = identity !== null && persisted ? persisted.atMs : null;

  // Link 3 — left every `em:` form with a proof dated after the clear.
  const released = clearAtMs === null
    ? undefined
    : samples.find((s) => s.atMs >= clearAtMs && !isEmergencyRenderHash(s.hash) && s.hash !== null && s.renderedAtMs !== null && s.renderedAtMs > clearAtMs);
  const releasedAtMs = released ? released.atMs : null;

  const base = {
    id,
    expectedIdentity: identity,
    raisedAtMs,
    paintedAtMs,
    persistedAtMs,
    releasedAtMs,
    violation,
    lastHash: last?.hash ?? null,
    lastRenderedAtMs: last?.renderedAtMs ?? null,
  };
  const deadline = dispatchAtMs + DRILL_TIMING.LINK1_DEADLINE_MS;
  const readAfter = (t: number) => samples.some((s) => s.atMs >= t);

  // Link 1.
  if (paintedAtMs === null || paintedAtMs > deadline) {
    if (raisedAtMs !== null && raisedAtMs <= deadline) {
      return { ...base, failedLink: 'render', unreadable: false, reason: paintedAtMs === null ? 'raised-never-painted' : 'painted-after-5s' };
    }
    if (input.transitions !== null || readAfter(deadline)) {
      return { ...base, failedLink: 'delivery', unreadable: false, reason: raisedAtMs === null ? 'never-raised' : 'raised-after-5s' };
    }
    return { ...base, failedLink: null, unreadable: true, reason: 'link1-unreadable' };
  }
  // Link 2.
  if (violation) return { ...base, failedLink: 'persistence', unreadable: false, reason: `after-first-paint:${violation.why}` };
  if (persistedAtMs === null) {
    const upTo = clearAtMs ?? Number.POSITIVE_INFINITY;
    const judged = samples.some((s) => s.atMs >= dispatchAtMs + DRILL_TIMING.LINK2_FROM_MS && s.atMs < upTo);
    if (judged) return { ...base, failedLink: 'persistence', unreadable: false, reason: 'no-painted-proof-after-60s' };
    return { ...base, failedLink: null, unreadable: true, reason: 'link2-unreadable' };
  }
  // Link 3.
  if (clearAtMs === null) return { ...base, failedLink: null, unreadable: true, reason: 'not-cleared' };
  if (releasedAtMs === null) {
    if (readAfter(clearAtMs)) return { ...base, failedLink: 'release', unreadable: false, reason: 'still-on-alert-150s-after-clear' };
    return { ...base, failedLink: null, unreadable: true, reason: 'link3-unreadable' };
  }
  return { ...base, failedLink: null, unreadable: false, reason: 'ok' };
}

export interface RunGrade {
  verdict: 'PASS' | 'FAIL' | 'INCONCLUSIVE';
  failedLink: FailedLink | null;
  reason: string;
  panes: PaneGrade[];
}

/** PASS needs every link on every pane; FAIL names the earliest failed link; else INCONCLUSIVE. */
export function gradeRun(input: GradeInput & { cleared: boolean | null }): RunGrade {
  const panes = input.paneIds.map((id) => gradePane(id, input));
  const failed = panes.filter((p) => p.failedLink !== null);
  if (failed.length > 0) {
    const link = LINK_ORDER.find((l) => failed.some((p) => p.failedLink === l)) as FailedLink;
    const first = failed.find((p) => p.failedLink === link)!;
    return { verdict: 'FAIL', failedLink: link, reason: `${first.id}:${first.reason}`, panes };
  }
  const unreadable = panes.find((p) => p.unreadable);
  if (unreadable) return { verdict: 'INCONCLUSIVE', failedLink: null, reason: `${unreadable.id}:${unreadable.reason}`, panes };
  // Every pane released, but our own all-clear did not go out cleanly: the
  // release we meant to test was not the one that happened (the payload's
  // expiry was). Never a PASS.
  if (input.cleared !== true) return { verdict: 'INCONCLUSIVE', failedLink: null, reason: 'all-clear-not-confirmed', panes };
  return { verdict: 'PASS', failedLink: null, reason: 'ok', panes };
}

/** Is every pane done with link 1 (painted its identity)? The link-1 loop stops early on this. */
export function link1Settled(input: GradeInput): boolean {
  return input.paneIds.every((id) => {
    const g = gradePane(id, { ...input, clearAtMs: null });
    return g.paintedAtMs !== null;
  });
}

/** Link 2 is decided (every pane persisted, or one already violated): clear now. */
export function link2Settled(input: GradeInput): boolean {
  const grades = input.paneIds.map((id) => gradePane(id, { ...input, clearAtMs: null }));
  if (grades.some((g) => g.violation)) return true;
  return grades.every((g) => g.persistedAtMs !== null);
}

/** Every pane released: the link-3 loop stops early on this. */
export function link3Settled(input: GradeInput): boolean {
  return input.paneIds.every((id) => gradePane(id, input).releasedAtMs !== null);
}

/**
 * A LIVE alert reached the drill's panes mid-run ("real emergencies win" —
 * the run is ABORTED, no email, and the drill's all-clear can never end it).
 * Also true when OUR drill entry vanished from a pane before our all-clear:
 * a live alert in the organisation ended it (`DRILL_ENDED_BY_LIVE_ALERT`).
 */
export function liveAlertOnPanes(input: {
  nowMs: number;
  overrideRows: readonly unknown[];
  tenants: ReadonlyArray<{ id: string; emergencyStatus: string | null; emergencyIsDrill: boolean | null }>;
  drillOverrideId: string | null;
  paneIds: readonly string[];
  /**
   * Uncleared pushed messages (SOS / broadcast / media alert) in the panes'
   * locations that the drill runner did NOT send. A pushed message has no
   * drill flag, so any such message counts as live — over-aborting a drill
   * costs one run; grading a real alert as the drill's would be a false FAIL.
   */
  foreignMessages?: ReadonlyArray<{ id: string; expiresAt: Date | null }>;
}): string | null {
  for (const m of input.foreignMessages ?? []) {
    if (!m.expiresAt || m.expiresAt.getTime() > input.nowMs) return `live-message:${m.id}`;
  }
  for (const t of input.tenants) {
    if (t.emergencyStatus && t.emergencyStatus !== 'INACTIVE' && t.emergencyIsDrill !== true) return `live-alert-on-location:${t.id}`;
  }
  for (const row of input.overrideRows) {
    const live = entriesOfRow(row).find((e) => !e.isDrill && !isEntryExpired(e, input.nowMs));
    if (live) return `live-alert-on-screen:${screenIdOf(row)}`;
  }
  if (input.drillOverrideId) {
    const holding = new Set(
      input.overrideRows
        .filter((row) => entriesOfRow(row).some((e) => e.alertId === input.drillOverrideId))
        .map((row) => screenIdOf(row)),
    );
    const missing = input.paneIds.filter((id) => !holding.has(id));
    if (missing.length > 0) return `drill-ended-externally:${missing.join(',')}`;
  }
  return null;
}

// ─── Audit details (Zod-checked, `v: 1`) ────────────────────────────────────

const iso = z.string().max(40);
const id = z.string().min(1).max(160);

export const DrillStartedDetailsSchema = z.object({
  v: z.literal(1),
  runId: id,
  kind: z.enum(['override', 'broadcast', 'district-copy']),
  overrideId: id.nullable(),
  slot: z.string().max(80),
  mode: z.enum(['shadow', 'alert', 'on', 'off']),
  type: z.enum(DRILL_TYPES).nullable(),
  /** The display the send names (the device scope); null for a district-copy run. */
  screenId: id.nullable(),
  paneIds: z.array(id).max(64),
  hardwareModel: z.string().max(80).nullable(),
  deviceClass: z.string().max(160).nullable(),
  playerVersion: z.string().max(40).nullable(),
  dispatchAt: iso,
  expiresAt: iso,
  runnerUserId: id,
  rootTenantId: id,
});
export type DrillStartedDetails = z.infer<typeof DrillStartedDetailsSchema>;

export const DrillPaneResultSchema = z.object({
  id,
  expectedIdentity: z.string().max(80).nullable(),
  raisedAtMs: z.number().nullable(),
  paintedAtMs: z.number().nullable(),
  persistedAtMs: z.number().nullable(),
  releasedAtMs: z.number().nullable(),
  violation: z.object({ atMs: z.number(), hash: z.string().max(140).nullable(), why: z.string().max(40) }).nullable(),
  lastHash: z.string().max(140).nullable(),
  lastRenderedAtMs: z.number().nullable(),
  failedLink: z.enum(['delivery', 'render', 'persistence', 'release']).nullable(),
  unreadable: z.boolean(),
  reason: z.string().max(120),
});

export const DrillResultDetailsSchema = z.object({
  v: z.literal(1),
  runId: id,
  kind: z.enum(['override', 'broadcast', 'district-copy']),
  verdict: z.enum(['PASS', 'FAIL', 'INCONCLUSIVE', 'SKIPPED', 'ABORTED']),
  reason: z.string().max(240),
  failedLink: z.enum(['delivery', 'render', 'persistence', 'release']).nullable(),
  mode: z.enum(['shadow', 'alert', 'on', 'off']),
  slot: z.string().max(80),
  type: z.enum(DRILL_TYPES).nullable(),
  overrideId: id.nullable(),
  messageId: id.nullable(),
  /** The rule the panes were judged on and, for the override, the identity itself. */
  expected: z.object({ rule: z.enum(['identity', 'first-painted']), identity: z.string().max(80).nullable() }).nullable(),
  dispatchAtMs: z.number().nullable(),
  clearAtMs: z.number().nullable(),
  cleared: z.boolean().nullable(),
  paneIds: z.array(id).max(64),
  panes: z.array(DrillPaneResultSchema).max(64),
  /** The display the run was about (override / broadcast); null for a district-copy run. */
  screenId: id.nullable(),
  /** The organisation root (the district, for a district-copy run). */
  rootTenantId: id.nullable(),
  hardwareModel: z.string().max(80).nullable(),
  deviceClass: z.string().max(160).nullable(),
  playerVersion: z.string().max(40).nullable(),
  /** Queued for the owner's per-tick email (mode alert / on, FAIL or INCONCLUSIVE). */
  alerted: z.boolean(),
  runnerUserId: id,
});
export type DrillResultDetails = z.infer<typeof DrillResultDetailsSchema>;

export const DrillSweptDetailsSchema = z.object({
  v: z.literal(1),
  runId: id,
  kind: z.enum(['override', 'broadcast', 'district-copy']),
  outcome: z.enum(['cleared', 'nothing-to-clear', 'clear-failed']),
  clearedIds: z.array(id).max(64),
  runnerUserId: id,
});
export type DrillSweptDetails = z.infer<typeof DrillSweptDetailsSchema>;

/** Parse a stored details string against a schema; null when it does not match. */
export function parseDetails<T>(schema: z.ZodType<T>, raw: string | null | undefined): T | null {
  if (!raw || raw.length > 64_000) return null;
  try {
    const r = schema.safeParse(JSON.parse(raw));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

/** Should this verdict reach the owner (mode alert / on, FAIL or INCONCLUSIVE)? ABORTED / SKIPPED never do. */
export function verdictAlertsOwner(mode: DrillMode, verdict: DrillVerdict): boolean {
  return (mode === 'alert' || mode === 'on') && (verdict === 'FAIL' || verdict === 'INCONCLUSIVE');
}

// ─── Hardware class ────────────────────────────────────────────────────────

/**
 * The hardware class a verdict is about — the reviewed playback class
 * (`manufacturer/model/device/sdkN`, from the unit's own build report), else
 * the operator-picked hardware model. Null when neither is known.
 */
export function drillHardwareClass(screen: { displayCapabilities?: unknown; hardwareModel?: string | null }): string | null {
  const caps = screen.displayCapabilities;
  const build = caps && typeof caps === 'object' && !Array.isArray(caps) ? (caps as { build?: unknown }).build : null;
  const cls = build && typeof build === 'object' ? playbackDeviceClass(build as PlaybackBuildInfo) : null;
  if (cls) return cls;
  const hm = typeof screen.hardwareModel === 'string' ? screen.hardwareModel.trim().toLowerCase() : '';
  return hm && hm !== 'unknown' ? `model:${hm}` : null;
}

// ─── Canary hold (§9.4) ─────────────────────────────────────────────────────

export interface ResultRow {
  createdAt: Date;
  details: string | null;
}

/**
 * Hardware classes whose LATEST judged verdict (PASS or FAIL) inside the
 * lookback is a FAIL. A later PASS on the class releases it. Only in mode
 * `on` (§5: holding promotion is the `on` stage — a shadow verdict is still
 * being validated and must not change what an operator sees); the kill
 * switch and every other mode return nothing.
 */
export function canaryHoldsFromResults(input: {
  mode: DrillMode;
  enabled: boolean;
  rows: readonly ResultRow[];
  nowMs: number;
}): Map<string, { runId: string; at: Date; reason: string }> {
  const out = new Map<string, { runId: string; at: Date; reason: string }>();
  if (!input.enabled || input.mode !== 'on') return out;
  const latest = new Map<string, { verdict: DrillVerdict; at: Date; runId: string; reason: string }>();
  for (const r of input.rows) {
    if (input.nowMs - r.createdAt.getTime() > DRILL_TIMING.CANARY_LOOKBACK_MS) continue;
    const d = parseDetails(DrillResultDetailsSchema, r.details);
    if (!d || !d.deviceClass || (d.verdict !== 'PASS' && d.verdict !== 'FAIL')) continue;
    const prev = latest.get(d.deviceClass);
    if (!prev || r.createdAt > prev.at) latest.set(d.deviceClass, { verdict: d.verdict, at: r.createdAt, runId: d.runId, reason: d.reason });
  }
  for (const [cls, v] of latest) if (v.verdict === 'FAIL') out.set(cls, { runId: v.runId, at: v.at, reason: v.reason });
  return out;
}

/** The two reads the canary hook needs, as a narrow delegate (player-ota never imports the runner). */
export interface CanaryHoldReader {
  screen: { findMany(args: unknown): Promise<Array<{ tenantId: string | null }>> };
  auditLog: { findMany(args: unknown): Promise<ResultRow[]> };
}

/**
 * The hardware classes canary auto-promotion must hold right now. Reads
 * nothing at all unless the drill is enabled in mode `on`; any read failure
 * holds nothing (the canary gate's own evidence rules still apply) and is
 * reported by the caller's log.
 */
export async function loadCanaryDrillHolds(
  db: CanaryHoldReader,
  cfg: { enabled: boolean; mode: DrillMode; screenIds: readonly string[] },
  nowMs: number,
): Promise<Map<string, { runId: string; at: Date; reason: string }>> {
  if (!cfg.enabled || cfg.mode !== 'on' || cfg.screenIds.length === 0) return new Map();
  const screens = await db.screen.findMany({ where: { id: { in: [...cfg.screenIds] } }, select: { tenantId: true } });
  const tenantIds = [...new Set(screens.map((s) => s.tenantId).filter((t): t is string => !!t))];
  if (tenantIds.length === 0) return new Map();
  const rows = await db.auditLog.findMany({
    where: { tenantId: { in: tenantIds }, action: DRILL_RESULT_ACTION, createdAt: { gte: new Date(nowMs - DRILL_TIMING.CANARY_LOOKBACK_MS) } },
    select: { createdAt: true, details: true },
    take: 5_000,
  });
  return canaryHoldsFromResults({ mode: cfg.mode, enabled: cfg.enabled, rows, nowMs });
}

// ─── Dead-man (§2) ──────────────────────────────────────────────────────────

/** Listed displays (by named screen) and kinds with no PASS in the last 36 h. */
export function deadManGaps(input: {
  displays: ReadonlyArray<{ screenId: string; label: string }>;
  districtRoots: ReadonlyArray<{ rootTenantId: string; label: string }>;
  rows: readonly ResultRow[];
  nowMs: number;
}): Array<{ target: string; label: string; kind: DrillKind; lastPassAt: Date | null; lastVerdict: string | null }> {
  const lastPass = new Map<string, Date>();
  const lastSeen = new Map<string, { at: Date; verdict: string }>();
  for (const r of input.rows) {
    const d = parseDetails(DrillResultDetailsSchema, r.details);
    if (!d) continue;
    const key = d.kind === 'district-copy' ? `district-copy|${d.rootTenantId ?? ''}` : `${d.kind}|${d.screenId ?? ''}`;
    const seen = lastSeen.get(key);
    if (!seen || r.createdAt > seen.at) lastSeen.set(key, { at: r.createdAt, verdict: d.verdict });
    if (d.verdict === 'PASS' && input.nowMs - r.createdAt.getTime() <= DRILL_TIMING.DEAD_MAN_MS) {
      const prev = lastPass.get(key);
      if (!prev || r.createdAt > prev) lastPass.set(key, r.createdAt);
    }
  }
  const out: Array<{ target: string; label: string; kind: DrillKind; lastPassAt: Date | null; lastVerdict: string | null }> = [];
  for (const disp of input.displays) {
    for (const kind of DAILY_SCREEN_KINDS) {
      const key = `${kind}|${disp.screenId}`;
      if (!lastPass.has(key)) out.push({ target: disp.screenId, label: disp.label, kind, lastPassAt: null, lastVerdict: lastSeen.get(key)?.verdict ?? null });
    }
  }
  for (const dist of input.districtRoots) {
    const key = `district-copy|${dist.rootTenantId}`;
    if (!lastPass.has(key)) out.push({ target: dist.rootTenantId, label: dist.label, kind: 'district-copy', lastPassAt: null, lastVerdict: lastSeen.get(key)?.verdict ?? null });
  }
  return out;
}

// ─── Customer alert emails: the drill window (§9 item 7) ────────────────────

export interface DrillAuditRow {
  action: string;
  createdAt: Date;
  details: string | null;
}

/**
 * Per pane, the window a synthetic drill had the glass: from its STARTED row
 * to its RESULT (or, while it is still running, the longest a run can last),
 * plus CUSTOMER_ALERT_TAIL_MS. Customer alert emails defer a problem that
 * started inside it (`synthetic-drill`), and the platform-incident rule never
 * counts it.
 */
export function drillWindowsByPane(rows: readonly DrillAuditRow[]): Map<string, { startMs: number; untilMs: number }> {
  const results = new Map<string, number>();
  for (const r of rows) {
    if (r.action !== DRILL_RESULT_ACTION) continue;
    const d = parseDetails(DrillResultDetailsSchema, r.details);
    if (d) results.set(d.runId, Math.max(results.get(d.runId) ?? 0, r.createdAt.getTime()));
  }
  const out = new Map<string, { startMs: number; untilMs: number }>();
  for (const r of rows) {
    if (r.action !== DRILL_STARTED_ACTION) continue;
    const d = parseDetails(DrillStartedDetailsSchema, r.details);
    if (!d) continue;
    const startMs = r.createdAt.getTime();
    const endMs = results.get(d.runId) ?? startMs + DRILL_TIMING.MAX_RUN_MS;
    const untilMs = endMs + DRILL_TIMING.CUSTOMER_ALERT_TAIL_MS;
    for (const pane of d.paneIds) {
      const prev = out.get(pane);
      out.set(pane, prev ? { startMs: Math.min(prev.startMs, startMs), untilMs: Math.max(prev.untilMs, untilMs) } : { startMs, untilMs });
    }
  }
  return out;
}

// ─── Orphans (§2) ───────────────────────────────────────────────────────────

/**
 * STARTED runs with no RESULT and no SWEPT row, older than the longest a run
 * can last, and not driven by this process: each gets ONE all-clear.
 */
export function orphanRuns(input: {
  rows: ReadonlyArray<DrillAuditRow & { tenantId: string }>;
  nowMs: number;
  inFlightHere: (runId: string) => boolean;
}): Array<DrillStartedDetails & { tenantId: string; startedAt: Date }> {
  const closed = new Set<string>();
  for (const r of input.rows) {
    if (r.action === DRILL_RESULT_ACTION) {
      const d = parseDetails(DrillResultDetailsSchema, r.details);
      if (d) closed.add(d.runId);
    } else if (r.action === DRILL_SWEPT_ACTION) {
      const d = parseDetails(DrillSweptDetailsSchema, r.details);
      if (d) closed.add(d.runId);
    }
  }
  const out: Array<DrillStartedDetails & { tenantId: string; startedAt: Date }> = [];
  for (const r of input.rows) {
    if (r.action !== DRILL_STARTED_ACTION) continue;
    const d = parseDetails(DrillStartedDetailsSchema, r.details);
    if (!d || closed.has(d.runId) || input.inFlightHere(d.runId)) continue;
    if (input.nowMs - r.createdAt.getTime() < DRILL_TIMING.MAX_RUN_MS) continue;
    out.push({ ...d, tenantId: r.tenantId, startedAt: r.createdAt });
  }
  return out;
}

// ─── Slots in each screen's OWN time zone (§9.3) ────────────────────────────

const partsFormatter = new Map<string, Intl.DateTimeFormat | null>();

function formatterFor(zone: string): Intl.DateTimeFormat | null {
  if (partsFormatter.has(zone)) return partsFormatter.get(zone) ?? null;
  let f: Intl.DateTimeFormat | null = null;
  try {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
  } catch {
    f = null;
  }
  partsFormatter.set(zone, f);
  return f;
}

function localParts(zone: string, ms: number): { y: number; m: number; d: number; hh: number; mm: number; ss: number } | null {
  const f = formatterFor(zone);
  if (!f) return null;
  const parts = f.formatToParts(new Date(ms));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? NaN);
  const hh = get('hour');
  return { y: get('year'), m: get('month'), d: get('day'), hh: hh === 24 ? 0 : hh, mm: get('minute'), ss: get('second') };
}

/** The instant of local wall time `minuteOfDay` on the local day containing `ms`, in `zone`. */
export function zonedSlotInstant(zone: string, ms: number, minuteOfDay: number): number | null {
  const p = localParts(zone, ms);
  if (!p) return null;
  const wall = Date.UTC(p.y, p.m - 1, p.d, Math.floor(minuteOfDay / 60), minuteOfDay % 60, 0, 0);
  let guess = wall;
  for (let i = 0; i < 3; i++) {
    const q = localParts(zone, guess);
    if (!q) return null;
    const asUtc = Date.UTC(q.y, q.m - 1, q.d, q.hh, q.mm, q.ss, 0);
    const next = wall - (asUtc - guess);
    if (next === guess) break;
    guess = next;
  }
  return guess;
}

/** `YYYY-MM-DD` of the local day containing `ms`, and its day number since 1970-01-01. */
export function localDay(zone: string, ms: number): { key: string; dayNumber: number } | null {
  const p = localParts(zone, ms);
  if (!p) return null;
  const key = `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
  return { key, dayNumber: Math.floor(Date.UTC(p.y, p.m - 1, p.d) / (24 * 60 * MIN)) };
}

export interface DueSlot {
  slot: DrillSlot;
  slotIndex: number;
  /** `<localDate>@<HH:MM>` in the screen's zone — the claim and audit key. */
  key: string;
  localDate: string;
  dayNumber: number;
  atMs: number;
}

/**
 * The slots due NOW for a screen in `zone`: the local slot time has passed
 * today and the grace has not. A screen whose zone is unknown has NO slots —
 * it is never drilled on a guessed clock (never UTC).
 */
export function dueSlots(zone: string | null, slots: readonly DrillSlot[], nowMs: number): DueSlot[] {
  if (!zone) return [];
  const day = localDay(zone, nowMs);
  if (!day) return [];
  const out: DueSlot[] = [];
  slots.forEach((slot, slotIndex) => {
    const atMs = zonedSlotInstant(zone, nowMs, slot.minuteOfDay);
    if (atMs === null) return;
    if (nowMs >= atMs && nowMs - atMs < DRILL_TIMING.SLOT_GRACE_MS) {
      out.push({ slot, slotIndex, key: `${day.key}@${slot.label}`, localDate: day.key, dayNumber: day.dayNumber, atMs });
    }
  });
  return out;
}

/** A hash of the run ids an email reports — the per-tick Redis claim key. */
export function tickEmailKey(runIds: readonly string[]): string {
  const text = [...runIds].sort().join(',');
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16).padStart(8, '0');
}
