/**
 * playlistOps — every derivation behind Playlists Operations v1.
 *
 * Design contract: scratch/design/playlists-page/PLAYLISTS-V1-DESIGN-HANDOFF.md
 * (+ playlists-operations-v1.png for the default desktop library).
 *
 * PURE BY CONSTRUCTION. No React, no DOM, no network — so the truth model can
 * be unit-tested without mounting a 3k-line page. Presentation lives in
 * PlaylistLibraryV1 / PlaylistWorkspace; this file decides WHAT IS TRUE.
 *
 * ── THE ONE RULE THIS FILE EXISTS TO KEEP (§4, §10) ──────────────────
 *
 * Scheduling intent and confirmed display delivery are DIFFERENT FACTS.
 *
 *   • `ACTIVE` means a server-side schedule is eligible right now. It is not
 *     proof any player received, or painted, anything.
 *   • `Update received` (the handoff's UPDATE ACKNOWLEDGED) means a target
 *     echoed back the exact pending-refresh VALUE it was pushed. It proves the
 *     player painted AFTER the request — not that the expected revision is on
 *     the glass.
 *   • `Content confirmed` requires comparing a stored EXPECTED content
 *     signature against the player's reported rendered signature. The platform
 *     does not store an expected per-target signature today, so this module
 *     CANNOT and DOES NOT emit that claim. The mock's "Confirmed 4/4" is the
 *     destination, not today's truth (handoff §10 — the documented correction,
 *     binding). `content-confirmed` exists in the type union only so a future
 *     API that really does compare signatures has a place to land.
 *
 * Prohibited language (§4.3), enforced by a unit test over this file's own
 * output: no `LIVE`, no `Confirmed` for a mere network success, no
 * `Delivered` for a server-side copy, no `Ready` without readiness telemetry.
 */

import { isWindowOpen, type WindowFields } from '@/app/player/scheduleWindow';

// ─────────────────────────────────────────────────────────────────────
// Vocabulary (§4)
// ─────────────────────────────────────────────────────────────────────

/** §4.1 — server scheduling intent. Never a delivery claim. */
export type ScheduleState = 'ACTIVE' | 'SCHEDULED' | 'PAUSED' | 'UNASSIGNED';

/** Media playlist vs template-backed playlist. */
export type PlaylistKind = 'media' | 'template';

/** Whose playlist this row is: the tenant's own, or a copy pushed down by HQ. */
export type SourceOwnership = 'own' | 'hq';

/**
 * §4.2 — per-target delivery state.
 *
 * The first four are the API contract (`GET /playlists/:id/delivery`). The
 * last two are reachable only from the client-side derivation below, which
 * grades render-proof as well as acknowledgement:
 *   `no-picture`       — §4.2 RENDER STALE (reachable, no fresh render proof)
 *   `content-mismatch` — §4.2 CONTENT MISMATCH (never emitted today; see the
 *                        header — no expected signature is stored)
 */
export type DeliveryTargetState =
  | 'acknowledged'
  | 'not-updated'
  | 'offline'
  | 'unknown'
  | 'no-picture'
  | 'content-mismatch';

/** Row-level rollup. Adds the two states that only make sense in aggregate. */
export type DeliverySummaryState = DeliveryTargetState | 'pushing' | 'not-published';

/** Semantic tone. Green ONLY for a proved-healthy state (§24.1). */
export type DeliveryTone = 'ok' | 'warn' | 'bad' | 'muted' | 'unavailable';

/**
 * §11 — row-level precedence, worst first. "If multiple targets differ,
 * summarize the worst meaningful state" — never flatten to a generic "Partial".
 */
const TARGET_PRECEDENCE: DeliveryTargetState[] = [
  'content-mismatch',
  'no-picture',
  'not-updated',
  'offline',
  'unknown',
  'acknowledged',
];

/** Lower index = worse. Unknown states sort last (never as success). */
export function targetSeverity(state: DeliveryTargetState): number {
  const i = TARGET_PRECEDENCE.indexOf(state);
  return i === -1 ? TARGET_PRECEDENCE.length : i;
}

/** Pick the worst of a set of target states, by §11 precedence. */
export function worstTargetState(states: DeliveryTargetState[]): DeliveryTargetState | null {
  if (states.length === 0) return null;
  return states.reduce((worst, s) => (targetSeverity(s) < targetSeverity(worst) ? s : worst));
}

// ─────────────────────────────────────────────────────────────────────
// Input shapes (deliberately structural — the page passes raw API rows)
// ─────────────────────────────────────────────────────────────────────

export interface OpsScreenRef {
  id: string;
  name?: string | null;
  status?: string | null;
  screenGroupId?: string | null;
  /** Epoch-ms VALUE the operator's last push stamped on this screen. */
  pendingRefreshAt?: string | Date | null;
  /** The value the player echoed back. Equality — never a clock compare. */
  refreshAckMs?: number | string | null;
  renderHealth?: 'OK' | 'STALE' | 'UNKNOWN' | null;
  renderStale?: boolean | null;
  lastRenderedAt?: string | Date | null;
  pushChannel?: 'live' | 'stale' | 'unknown' | null;
  authState?: string | null;
  sourceTenant?: { id: string; name?: string | null } | null;
}

export interface OpsGroupRef {
  id: string;
  name?: string | null;
  screens?: Array<{ id: string }> | null;
}

export interface OpsScheduleRef extends WindowFields {
  id: string;
  playlistId: string;
  screenId?: string | null;
  screenGroupId?: string | null;
  startTime?: string | Date | null;
  endTime?: string | Date | null;
  isActive?: boolean | null;
  mode?: string | null;
  mutedOverride?: boolean | null;
  priority?: number | null;
  screen?: { id: string; name?: string | null } | null;
  screenGroup?: { id: string; name?: string | null } | null;
}

export interface OpsPlaylistRef {
  id: string;
  name?: string | null;
  templateId?: string | null;
  template?: { id: string; name?: string | null; screenWidth?: number | null; screenHeight?: number | null } | null;
  items?: Array<{ id?: string; durationMs?: number | null; asset?: { mimeType?: string | null } | null }> | null;
  createdBy?: { id?: string | null; email?: string | null } | null;
  createdAt?: string | Date | null;
  updatedAt?: string | Date | null;
  sourcePlaylistId?: string | null;
  fleetLocations?: number | null;
  fleetActiveSchedules?: number | null;
  /** `Playlist.syncPlayback` — "keep screens in sync" (2026-09-16). */
  syncPlayback?: boolean | null;
  _count?: { schedules?: number | null } | null;
}

// ─────────────────────────────────────────────────────────────────────
// Time + window helpers
// ─────────────────────────────────────────────────────────────────────

const DAY_ORDER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

function toMs(value: string | Date | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const t = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(t) ? t : null;
}

/** "05:00" → "5:00 AM". Returns the raw string when it isn't HH:MM. */
export function formatClock(hhmm: string | null | undefined): string {
  if (!hhmm) return '';
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return hhmm;
  const h = Number(m[1]);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m[2]} ${suffix}`;
}

/** "6 items · 1:30" needs the second half: total run time, m:ss. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * "Mon,Tue,Wed,Thu,Fri" → "Weekdays". Contiguous runs compress to a range;
 * anything else lists the days. Empty / all-seven → "Every day".
 */
export function describeDays(daysOfWeek: string | null | undefined): string {
  if (!daysOfWeek) return 'Every day';
  const picked = DAY_ORDER.filter((d) => daysOfWeek.includes(d));
  if (picked.length === 0 || picked.length === 7) return 'Every day';
  const key = picked.join(',');
  if (key === 'Mon,Tue,Wed,Thu,Fri') return 'Weekdays';
  if (key === 'Sat,Sun') return 'Weekends';
  // Contiguous run in DAY_ORDER → "Mon–Wed".
  const first = DAY_ORDER.indexOf(picked[0]);
  const last = DAY_ORDER.indexOf(picked[picked.length - 1]);
  if (picked.length > 2 && last - first === picked.length - 1) {
    return `${picked[0]}–${picked[picked.length - 1]}`;
  }
  return picked.join(', ');
}

/** "Sep 2" — the short calendar stamp the Schedule cell uses. */
export function formatShortDate(ms: number): string {
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Relative "12 min ago" for the Updated cell (exact stamp goes in the title). */
export function timeAgo(value: string | Date | null | undefined, nowMs: number = Date.now()): string {
  const ms = toMs(value);
  if (ms === null) return 'Unknown';
  const sec = Math.max(0, Math.round((nowMs - ms) / 1000));
  if (sec < 60) return 'Just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const day = Math.floor(hr / 24);
  if (day === 1) return 'Yesterday';
  if (day < 7) return `${day} days ago`;
  if (day < 14) return '1 week ago';
  if (day < 60) return `${Math.floor(day / 7)} weeks ago`;
  return formatShortDate(ms);
}

/** Exact stamp for the tooltip (§8.2 — relative in the list, exact on hover). */
export function exactStamp(value: string | Date | null | undefined): string {
  const ms = toMs(value);
  if (ms === null) return 'Unknown';
  return new Date(ms).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

/**
 * Is this schedule eligible RIGHT NOW? Date bounds (startTime/endTime) plus the
 * weekly window, evaluated with the player's own wrap-aware evaluator so the
 * dashboard and the glass never disagree about a 22:00–06:00 window.
 */
export function isScheduleEligibleNow(sched: OpsScheduleRef, now: Date): boolean {
  if (sched.isActive === false) return false;
  const start = toMs(sched.startTime);
  const end = toMs(sched.endTime);
  const nowMs = now.getTime();
  if (start !== null && nowMs < start) return false;
  if (end !== null && nowMs > end) return false;
  return isWindowOpen(
    { daysOfWeek: sched.daysOfWeek, timeStart: sched.timeStart, timeEnd: sched.timeEnd },
    now,
  );
}

/**
 * Does this schedule still have a future eligible window? True when its date
 * range has not closed — either it has not started yet, or it is inside its
 * range and its weekly window will come round again.
 */
export function hasFutureWindow(sched: OpsScheduleRef, now: Date): boolean {
  if (sched.isActive === false) return false;
  const end = toMs(sched.endTime);
  if (end !== null && now.getTime() > end) return false;
  return true;
}

// ─────────────────────────────────────────────────────────────────────
// §4.1 — schedule state
// ─────────────────────────────────────────────────────────────────────

export interface ScheduleStateResult {
  state: ScheduleState;
  /**
   * What the STATUS pill says. Usually the state itself, except for the one
   * shape §4.1's four-value union cannot name on its own: a schedule that is
   * enabled but whose date range has closed. It will never play again, so it
   * is not `SCHEDULED`; it was not switched off by anyone, so calling it
   * `Paused` would be a small lie. The pill says `ENDED`, the state stays
   * PAUSED so the API contract's union holds.
   */
  pillLabel: string;
  /** §8.2 Schedule cell. */
  summary: string;
}

/**
 * Precedence (§4.1), highest first:
 *   1. no schedules at all (and no HQ fan-out)      → UNASSIGNED
 *   2. an enabled schedule is eligible now          → ACTIVE
 *   3. an enabled schedule has a future window      → SCHEDULED
 *   4. schedules exist but none will ever play      → PAUSED (disabled/ended)
 *
 * `fleetActiveSchedules` covers the HQ case where the SOURCE playlist holds no
 * schedules of its own — the child-location copies hold them.
 */
export function deriveScheduleState(
  schedules: OpsScheduleRef[],
  now: Date,
  opts: { fleetActiveSchedules?: number | null; fleetLocations?: number | null } = {},
): ScheduleStateResult {
  const fleetActive = opts.fleetActiveSchedules ?? 0;
  const fleetLocations = opts.fleetLocations ?? 0;

  if (schedules.length === 0) {
    if (fleetActive > 0) {
      return {
        state: 'ACTIVE',
        pillLabel: 'ACTIVE',
        summary: `Running at ${fleetLocations} ${fleetLocations === 1 ? 'location' : 'locations'}`,
      };
    }
    if (fleetLocations > 0) {
      return { state: 'PAUSED', pillLabel: 'PAUSED', summary: 'Paused at every location' };
    }
    return { state: 'UNASSIGNED', pillLabel: 'UNASSIGNED', summary: 'Not scheduled' };
  }

  const enabled = schedules.filter((s) => s.isActive !== false);
  const eligible = enabled.filter((s) => isScheduleEligibleNow(s, now));
  if (eligible.length > 0 || fleetActive > 0) {
    return { state: 'ACTIVE', pillLabel: 'ACTIVE', summary: describeWindows(eligible.length > 0 ? eligible : enabled) };
  }

  const upcoming = enabled.filter((s) => hasFutureWindow(s, now));
  if (upcoming.length > 0) {
    return { state: 'SCHEDULED', pillLabel: 'SCHEDULED', summary: describeNextStart(upcoming, now) };
  }

  // Everything left is either switched off or past its end date.
  const anyEnabled = enabled.length > 0;
  if (anyEnabled) {
    const lastEnd = enabled
      .map((s) => toMs(s.endTime))
      .filter((v): v is number => v !== null)
      .sort((a, b) => b - a)[0];
    return {
      state: 'PAUSED',
      pillLabel: 'ENDED',
      summary: lastEnd ? `Ended ${formatShortDate(lastEnd)}` : 'No longer scheduled',
    };
  }
  return { state: 'PAUSED', pillLabel: 'PAUSED', summary: describeWindows(schedules) };
}

/** "Always" / "Weekdays · 5:00 AM–10:00 PM" — the shape of a running window. */
export function describeWindows(schedules: OpsScheduleRef[]): string {
  if (schedules.length === 0) return 'Not scheduled';
  const windowed = schedules.filter((s) => s.timeStart || s.timeEnd || s.daysOfWeek);
  if (windowed.length === 0) return 'Always';
  const s = windowed[0];
  const days = describeDays(s.daysOfWeek);
  const span = s.timeStart && s.timeEnd
    ? `${formatClock(s.timeStart)}–${formatClock(s.timeEnd)}`
    : s.timeStart
      ? `from ${formatClock(s.timeStart)}`
      : s.timeEnd
        ? `until ${formatClock(s.timeEnd)}`
        : '';
  const head = span ? `${days} · ${span}` : days;
  const extra = schedules.length - 1;
  return extra > 0 ? `${head} +${extra} more` : head;
}

/** "Starts Sep 2 · 4:00 PM" for a playlist whose window has not opened yet. */
export function describeNextStart(schedules: OpsScheduleRef[], now: Date): string {
  const future = schedules
    .map((s) => ({ s, start: toMs(s.startTime) }))
    .filter((x) => x.start !== null && (x.start as number) > now.getTime())
    .sort((a, b) => (a.start as number) - (b.start as number))[0];
  if (future) {
    const when = formatShortDate(future.start as number);
    const at = future.s.timeStart ? ` · ${formatClock(future.s.timeStart)}` : '';
    return `Starts ${when}${at}`;
  }
  // In range, but today's window is closed — say when it next opens.
  return describeWindows(schedules);
}

// ─────────────────────────────────────────────────────────────────────
// Reach (§8.2 Publishing cell)
// ─────────────────────────────────────────────────────────────────────

export interface PlaylistReach { screens: number; groups: number; locations: number }

/** Resolve a playlist's schedules to a screen/group/location count. */
export function deriveReach(
  schedules: OpsScheduleRef[],
  groups: OpsGroupRef[],
  screens: OpsScreenRef[],
  opts: { fleetLocations?: number | null } = {},
): PlaylistReach {
  const groupById = new Map(groups.map((g) => [g.id, g]));
  const screenById = new Map(screens.map((s) => [s.id, s]));
  const reached = new Set<string>();
  const groupIds = new Set<string>();
  for (const s of schedules) {
    if (s.screenId) reached.add(s.screenId);
    if (s.screenGroupId) {
      groupIds.add(s.screenGroupId);
      const g = groupById.get(s.screenGroupId);
      const members = g?.screens ?? screens.filter((sc) => sc.screenGroupId === s.screenGroupId);
      for (const m of members) reached.add(m.id);
    }
  }
  const locations = new Set<string>();
  for (const id of reached) {
    const sc = screenById.get(id);
    if (sc?.sourceTenant?.id) locations.add(sc.sourceTenant.id);
  }
  const fleetLocations = opts.fleetLocations ?? 0;
  return {
    screens: reached.size,
    groups: groupIds.size,
    locations: Math.max(locations.size > 1 ? locations.size : 0, fleetLocations),
  };
}

/** "4 screens · 2 groups" / "3 locations · 18 screens" / "No screens". */
export function describeReach(reach: PlaylistReach): string {
  if (reach.screens === 0 && reach.locations === 0) return 'No screens';
  const screenPart = `${reach.screens} ${reach.screens === 1 ? 'screen' : 'screens'}`;
  if (reach.locations > 1) {
    return `${reach.locations} locations · ${screenPart}`;
  }
  if (reach.groups > 0) {
    return `${screenPart} · ${reach.groups} ${reach.groups === 1 ? 'group' : 'groups'}`;
  }
  return screenPart;
}

// ─────────────────────────────────────────────────────────────────────
// Delivery (§10, §11) — the honest half of the page
// ─────────────────────────────────────────────────────────────────────

export interface DeliveryTarget {
  screenId: string;
  name: string;
  locationName: string | null;
  online: boolean;
  /** Epoch ms the player echoed back, when it matched the pending value. */
  ackAt: number | null;
  lastProofAt: string | null;
  pushChannel: 'live' | 'stale' | 'unknown';
  state: DeliveryTargetState;
}

export interface DeliveryPayload {
  latest: null | {
    id: string;
    label: string;
    createdAt: string;
    targetCount: number;
    acknowledged: number;
    targets: DeliveryTarget[];
  };
  history: Array<{ id: string; label: string; createdAt: string; targetCount: number; acknowledged: number }>;
}

export interface DeliverySummary {
  state: DeliverySummaryState;
  tone: DeliveryTone;
  /** The Delivery cell's single line. Plain language, never jargon. */
  label: string;
  /** One sentence for the workspace header's exception summary. */
  detail: string | null;
  /**
   * The same fact as a MID-SENTENCE fragment, so a caller can write
   * "Lobby Promotions is active, but {clause}".
   *
   * Authored, never derived by lowercasing `detail` — a screen is usually
   * named by a proper noun ("G43"), and a naive lower-first turned that into
   * "g43" in the banner. Two fields beat one clever function.
   */
  clause: string | null;
  acknowledged: number;
  total: number;
  /** Screens in the worst state, named — the fleet inbox lesson. */
  worstNames: string[];
}

const NOT_PUBLISHED: DeliverySummary = {
  state: 'not-published',
  tone: 'muted',
  label: 'Not published',
  detail: null,
  clause: null,
  acknowledged: 0,
  total: 0,
  worstNames: [],
};

/**
 * A playlist whose rules are all switched off is NOT on those screens any more,
 * so its targets' acknowledgements belong to whatever replaced it. Reporting
 * "Update received on 2 of 2" there would be the exact class of overclaim §4
 * exists to prevent — the screens are healthy, this playlist is simply not on
 * them.
 */
const NOT_PLAYING: DeliverySummary = {
  state: 'not-published',
  tone: 'muted',
  label: 'Not playing',
  detail: null,
  clause: null,
  acknowledged: 0,
  total: 0,
  worstNames: [],
};

/** §22.5 — a failed delivery read is never downgraded to a healthy gray. */
export const DELIVERY_UNAVAILABLE: DeliverySummary = {
  state: 'unknown',
  tone: 'unavailable',
  label: 'Delivery status unavailable',
  detail: 'Scheduling data loaded, but player confirmation could not be retrieved.',
  clause: 'its delivery status could not be retrieved.',
  acknowledged: 0,
  total: 0,
  worstNames: [],
};

/** "G43", "G43 and Lobby TV", "G43 +2" — names first, counts second. */
function nameList(names: string[]): string {
  if (names.length === 0) return '';
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names[0]} +${names.length - 1}`;
}

/**
 * Roll a target list up to one honest line (§11).
 *
 * The label NEVER says "Confirmed", "Delivered", "Live" or "Ready" (§4.3).
 * The strongest thing it can say is that the update was RECEIVED — the ack
 * identity — or that a screen reported a picture. Neither claims the expected
 * revision is what is on the glass.
 */
export function summarizeDelivery(
  targets: DeliveryTarget[],
  opts: { pushing?: boolean } = {},
): DeliverySummary {
  if (targets.length === 0) return NOT_PUBLISHED;

  const total = targets.length;
  const acknowledged = targets.filter((t) => t.state === 'acknowledged').length;
  const byState = new Map<DeliveryTargetState, string[]>();
  for (const t of targets) {
    const list = byState.get(t.state) ?? [];
    list.push(t.name);
    byState.set(t.state, list);
  }

  const worst = worstTargetState(targets.map((t) => t.state));
  const worstNames = worst ? (byState.get(worst) ?? []) : [];

  if (opts.pushing && worst !== 'acknowledged') {
    return {
      state: 'pushing',
      tone: 'warn',
      label: `Sending update · ${acknowledged} of ${total} received`,
      detail: 'The update has been requested; targets have not all reported back yet.',
      clause: `${total - acknowledged} of ${total} screens have not reported back yet.`,
      acknowledged, total, worstNames,
    };
  }

  switch (worst) {
    case 'content-mismatch':
      return {
        state: 'content-mismatch',
        tone: 'bad',
        label: `${nameList(worstNames)} is showing different content`,
        detail: `${nameList(worstNames)} reported content that does not match what was published.`,
        clause: `${nameList(worstNames)} reported content that does not match what was published.`,
        acknowledged, total, worstNames,
      };
    case 'no-picture':
      return {
        state: 'no-picture',
        tone: 'bad',
        label: `${nameList(worstNames)} has no confirmed picture · ${total - worstNames.length} of ${total} confirmed`,
        detail: `${nameList(worstNames)} is reachable but has not confirmed a picture recently.`,
        clause: `${nameList(worstNames)} is reachable but has not confirmed a picture recently.`,
        acknowledged, total, worstNames,
      };
    case 'not-updated':
      return {
        state: 'not-updated',
        tone: 'warn',
        label: `${nameList(worstNames)} not updated · ${acknowledged} of ${total} received`,
        detail: `${nameList(worstNames)} has not received the latest update.`,
        clause: `${nameList(worstNames)} has not received the latest update.`,
        acknowledged, total, worstNames,
      };
    case 'offline':
      return {
        state: 'offline',
        tone: 'warn',
        label: `${worstNames.length} of ${total} ${worstNames.length === 1 ? 'screen is' : 'screens are'} offline`,
        detail: `${nameList(worstNames)} cannot be reached.`,
        clause: `${nameList(worstNames)} cannot be reached.`,
        acknowledged, total, worstNames,
      };
    case 'unknown':
      return {
        state: 'unknown',
        tone: 'muted',
        label: worstNames.length === total
          ? `No update requested on ${total} ${total === 1 ? 'screen' : 'screens'}`
          : `${nameList(worstNames)} has not reported back`,
        detail: 'These screens have not reported enough to confirm the update.',
        clause: `${nameList(worstNames)} has not reported back yet.`,
        acknowledged, total, worstNames,
      };
    case 'acknowledged':
    default:
      return {
        state: 'acknowledged',
        tone: 'ok',
        label: `Update received on ${total} of ${total}`,
        detail: null,
        clause: null,
        acknowledged, total, worstNames: [],
      };
  }
}

/** §22.5 host — the API's own payload, mapped through the same rollup. */
export function summarizeDeliveryPayload(payload: DeliveryPayload | null | undefined): DeliverySummary {
  if (!payload) return DELIVERY_UNAVAILABLE;
  if (!payload.latest) return NOT_PUBLISHED;
  const pushing = payload.latest.acknowledged < payload.latest.targetCount
    && Date.now() - new Date(payload.latest.createdAt).getTime() < PUSH_GRACE_MS;
  return summarizeDelivery(payload.latest.targets, { pushing });
}

/**
 * How long after a push a target is still "sending" rather than "not updated".
 * A player polls its manifest every few seconds and a REFRESH_WEB command also
 * rides the manifest, so two minutes is generous — long enough that a normal
 * reload is never called a failure, short enough that a real one surfaces on
 * the same visit (§27's "define the timeout").
 */
export const PUSH_GRACE_MS = 2 * 60_000;

/** A render proof older than this stops counting as a confirmed picture. */
export const PICTURE_STALE_MS = 5 * 60_000;

/**
 * DEGRADATION PATH (mandatory — the delivery endpoint may not exist yet).
 *
 * Grade a playlist's own targets from the screens payload the page already
 * loads. One read for the whole library, never one request per row (§26).
 *
 * What each verdict is actually built on:
 *   offline        — the screen's live status is not ONLINE (ping-derived)
 *   not-updated    — a pending push VALUE is stamped and the player has not
 *                    echoed that exact value back (identity, never a clock
 *                    compare — signage boxes run minutes of skew)
 *   acknowledged   — the echoed value equals the pending value
 *   no-picture     — reachable, no pending push, and the render proof is stale
 *                    or the server already graded renderHealth STALE
 *   unknown        — reachable, nothing pushed, and no render proof has ever
 *                    arrived. Never styled as success (§4.2).
 */
export function deriveTargetsFromScreens(
  screens: OpsScreenRef[],
  nowMs: number = Date.now(),
): DeliveryTarget[] {
  return screens.map((s) => {
    const name = s.name || s.id;
    const locationName = s.sourceTenant?.name ?? null;
    const online = s.status === 'ONLINE';
    const pending = toMs(s.pendingRefreshAt);
    const ackRaw = s.refreshAckMs;
    const ack = typeof ackRaw === 'number'
      ? ackRaw
      : typeof ackRaw === 'string' && ackRaw.trim() !== '' && Number.isFinite(Number(ackRaw))
        ? Number(ackRaw)
        : null;
    const proofMs = toMs(s.lastRenderedAt);
    const pushChannel = s.pushChannel ?? 'unknown';
    const lastProofAt = proofMs === null ? null : new Date(proofMs).toISOString();

    let state: DeliveryTargetState;
    if (!online) {
      state = 'offline';
    } else if (pending !== null) {
      // VALUE identity. Equal → the player painted after the request.
      state = ack !== null && ack === pending ? 'acknowledged' : 'not-updated';
    } else if (s.renderHealth === 'STALE' || s.renderStale === true) {
      state = 'no-picture';
    } else if (proofMs !== null) {
      state = nowMs - proofMs <= PICTURE_STALE_MS ? 'acknowledged' : 'no-picture';
    } else {
      state = 'unknown';
    }

    return {
      screenId: s.id,
      name,
      locationName,
      online,
      ackAt: state === 'acknowledged' && ack !== null ? ack : null,
      lastProofAt,
      pushChannel,
      state,
    };
  });
}

/**
 * The derived rollup used by the LIST while `GET /playlists/:id/delivery` is
 * unavailable. Same shape, same precedence, same vocabulary — just built from
 * evidence the page already has instead of a per-deployment record.
 */
export function deriveDeliveryFromScreens(
  targetScreens: OpsScreenRef[],
  nowMs: number = Date.now(),
): DeliverySummary {
  if (targetScreens.length === 0) return NOT_PUBLISHED;
  const targets = deriveTargetsFromScreens(targetScreens, nowMs);
  const pushing = targets.some((t) => {
    if (t.state !== 'not-updated') return false;
    const screen = targetScreens.find((s) => s.id === t.screenId);
    const pending = toMs(screen?.pendingRefreshAt);
    return pending !== null && nowMs - pending < PUSH_GRACE_MS;
  });
  const summary = summarizeDelivery(targets, { pushing });
  if (summary.state === 'acknowledged') {
    // Nothing was pushed here — the evidence is a fresh render proof, so say
    // that and nothing more. "Update received" would claim a deployment that
    // does not exist.
    const anyPending = targetScreens.some((s) => toMs(s.pendingRefreshAt) !== null);
    if (!anyPending) {
      return {
        ...summary,
        label: `Picture confirmed on ${summary.total} of ${summary.total}`,
      };
    }
  }
  return summary;
}

// ─────────────────────────────────────────────────────────────────────
// The library row (§8) + §26's summary contract
// ─────────────────────────────────────────────────────────────────────

export interface PlaylistSummaryRow {
  id: string;
  name: string;
  kind: PlaylistKind;
  itemCount: number;
  durationMs: number;
  thumbnailUrl: string | null;
  templateSummary: string | null;
  creatorSummary: string | null;
  scheduleState: ScheduleState;
  /** What the STATUS pill prints — see ScheduleStateResult.pillLabel. */
  statusLabel: string;
  reviewState: string | null;
  reach: PlaylistReach;
  scheduleSummary: string;
  updatedAt: string;
  sourceOwnership: SourceOwnership;
  /** Populated by the page from whichever delivery source is available. */
  delivery: DeliverySummary;
  /** Every screen this playlist currently targets — the workspace drilldown. */
  targetScreenIds: string[];
  /**
   * "Keep screens in sync" (2026-09-16) — every screen playing this playlist
   * changes slides at the same instant. Moved here from the screen group,
   * which could not express it: one group carries several playlists.
   */
  syncPlayback: boolean;
  /** Kept for search (§7.4 covers asset / template / creator / target names). */
  searchText: string;
}

/** "6 items · 1:30" — the Playlist cell's second line. */
export function describeContent(row: Pick<PlaylistSummaryRow, 'kind' | 'itemCount' | 'durationMs' | 'templateSummary'>): string {
  if (row.kind === 'template') return row.templateSummary ?? 'Template';
  if (row.itemCount === 0) return 'No content yet';
  return `${row.itemCount} ${row.itemCount === 1 ? 'item' : 'items'} · ${formatDuration(row.durationMs)}`;
}

export interface BuildRowInput {
  playlist: OpsPlaylistRef;
  schedules: OpsScheduleRef[];
  screens: OpsScreenRef[];
  groups: OpsGroupRef[];
  now: Date;
  /** Provided when the delivery contract exists; otherwise derived. */
  delivery?: DeliverySummary;
  thumbnailUrl?: string | null;
  assetNames?: string[];
}

/**
 * DEGRADATION PATH for contract #1: build the exact row model
 * `GET /playlists/summary` would return, from the full playlists payload the
 * page already loads. Identical UI, just a heavier read.
 */
export function buildPlaylistRow(input: BuildRowInput): PlaylistSummaryRow {
  const { playlist, screens, groups, now } = input;
  const mine = input.schedules.filter((s) => s.playlistId === playlist.id);
  const state = deriveScheduleState(mine, now, {
    fleetActiveSchedules: playlist.fleetActiveSchedules,
    fleetLocations: playlist.fleetLocations,
  });
  const reach = deriveReach(mine, groups, screens, { fleetLocations: playlist.fleetLocations ?? 0 });

  const targetScreenIds = resolveTargetScreenIds(mine, groups, screens);
  const targetScreens = screens.filter((s) => targetScreenIds.includes(s.id));
  // Only a playlist that is ELIGIBLE to be on a screen can make a delivery
  // claim about it. A paused one is not on those screens; an unpublished one
  // has no screens at all. Neither inherits the health of the targets it used
  // to reach.
  const eligible = state.state === 'ACTIVE' || state.state === 'SCHEDULED';
  const delivery = input.delivery
    ?? (!eligible
      ? (targetScreenIds.length > 0 ? NOT_PLAYING : NOT_PUBLISHED)
      : targetScreens.length > 0
        ? deriveDeliveryFromScreens(targetScreens, now.getTime())
        : NOT_PUBLISHED);

  const items = playlist.items ?? [];
  const durationMs = items.reduce((sum, it) => sum + (it.durationMs ?? 10_000), 0);
  const kind: PlaylistKind = playlist.template || playlist.templateId ? 'template' : 'media';
  const templateSummary = playlist.template
    ? `Template · ${playlist.template.screenWidth ?? '?'}×${playlist.template.screenHeight ?? '?'}`
    : null;

  const targetNames = targetScreens.map((s) => s.name || s.id);
  const groupNames = mine
    .map((s) => s.screenGroup?.name)
    .filter((n): n is string => typeof n === 'string');

  return {
    id: playlist.id,
    name: playlist.name || 'Untitled playlist',
    kind,
    itemCount: items.length,
    durationMs,
    thumbnailUrl: input.thumbnailUrl ?? null,
    templateSummary,
    creatorSummary: playlist.createdBy?.email ?? null,
    scheduleState: state.state,
    statusLabel: state.pillLabel,
    reviewState: null,
    reach,
    scheduleSummary: state.summary,
    updatedAt: (playlist.updatedAt ? new Date(playlist.updatedAt) : new Date(0)).toISOString(),
    sourceOwnership: playlist.sourcePlaylistId ? 'hq' : 'own',
    delivery,
    targetScreenIds,
    syncPlayback: playlist.syncPlayback === true,
    searchText: [
      playlist.name ?? '',
      playlist.createdBy?.email ?? '',
      playlist.template?.name ?? '',
      ...(input.assetNames ?? []),
      ...targetNames,
      ...groupNames,
    ].join(' ').toLowerCase(),
  };
}

/** Every screen id a set of schedules reaches, groups expanded. */
export function resolveTargetScreenIds(
  schedules: OpsScheduleRef[],
  groups: OpsGroupRef[],
  screens: OpsScreenRef[],
): string[] {
  const groupById = new Map(groups.map((g) => [g.id, g]));
  const out = new Set<string>();
  for (const s of schedules) {
    if (s.screenId) out.add(s.screenId);
    if (s.screenGroupId) {
      const g = groupById.get(s.screenGroupId);
      const members = g?.screens ?? screens.filter((sc) => sc.screenGroupId === s.screenGroupId);
      for (const m of members) out.add(m.id);
    }
  }
  return Array.from(out);
}

// ─────────────────────────────────────────────────────────────────────
// One screen, two playlists — the conflict warning (2026-09-16)
// ─────────────────────────────────────────────────────────────────────

/**
 * Greg, after adding screens to a playlist: "the playlist allowed me to add
 * screens that already had an active playlist...it needs to warn that those
 * screens have an active playlist and if i agree it disables those screens in
 * the other playlist."
 *
 * WHY THIS IS AN EXTRACTION, NOT A NEW FEATURE. The classic page's playlist
 * toggle has done exactly this since 2026-05-04, and it took THREE takes to get
 * right — take 1 produced false positives, take 2 produced false negatives and
 * replaced far too much. The wording that survived is his:
 *
 *   "when i turn on another playlist it auto turns off the active playlist even
 *    if it for different screens, it need to allow playing multiple playlists
 *    just not two on the same screen"
 *   "tell me what screens its playing that will be replaced, also we are right
 *    back to where we were, it turned off the new url playlist as well for a
 *    screen that isnt included"
 *
 * So the level of the check is THE SCHEDULE, never the playlist. Each schedule
 * binds (playlist, screen OR group). A conflict exists only where another
 * playlist's ACTIVE schedule resolves onto a screen we are about to occupy.
 * Another schedule of that same playlist, on screens we are NOT touching, is
 * left alone — that is the take-2 regression and it is the whole point.
 *
 * Lifting it here rather than re-deriving it in the Add-screens dialog is
 * deliberate: two hand-rolled copies of one rule is how one of them silently
 * goes wrong, and this one cost three rounds of the operator's time already.
 *
 * MIRRORS THE SERVER. apps/api/src/schedules/schedule-displacement.ts resolves
 * the same target set — a per-screen rule covers that screenId; a group rule
 * covers that screenGroupId AND the per-screen pins on every member screen
 * (the 2026-06-26 "publish reaches only 1 of N posters" fix). Expanding groups
 * to members here is what keeps the warning honest about what the server will
 * actually switch off.
 */
export interface ScreenConflict {
  playlistId: string;
  playlistName: string;
  /** That playlist's ACTIVE rules which land on screens we want. Only these. */
  scheduleIds: string[];
  /** The overlapping screens, named, in the order encountered. */
  screenNames: string[];
}

/* ── window overlap ───────────────────────────────────────────────────
   Moved here from PlaylistDialogs (2026-09-16) so the conflict rule can use
   it. It was written for "two schedules on ONE playlist must not overlap";
   the question across playlists is identical, and a second copy of a
   day/time intersection is exactly the kind of near-duplicate that drifts. */

const ALL_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const toMin = (hhmm: string | null | undefined, fallback: number) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : fallback;
};

const daysOf = (d: string | null | undefined) =>
  !d ? ALL_DAYS : d.split(',').map((x) => x.trim()).filter(Boolean);

/**
 * Do two windows land on the same day at the same time?
 *
 * An empty daysOfWeek means EVERY day and an empty time means ALL day — so
 * "Always" collides with everything, which is the case worth getting right:
 * treating a missing field as "no constraint" rather than "no overlap" is what
 * would let a second always-on rule slip in beside the first.
 *
 * Touching edges do not collide: 08:00–12:00 and 12:00–17:00 are back to back.
 */
export function windowsCollide(
  a: { daysOfWeek?: string | null; timeStart?: string | null; timeEnd?: string | null },
  b: { daysOfWeek?: string | null; timeStart?: string | null; timeEnd?: string | null },
): boolean {
  const da = daysOf(a.daysOfWeek);
  const db = daysOf(b.daysOfWeek);
  if (!da.some((d) => db.includes(d))) return false;
  const as = toMin(a.timeStart, 0), ae = toMin(a.timeEnd, 24 * 60);
  const bs = toMin(b.timeStart, 0), be = toMin(b.timeEnd, 24 * 60);
  return as < be && bs < ae;
}

/**
 * Which other playlists are currently playing on the screens we are about to
 * take? Pure: no clock, no React, no network.
 *
 * `targetScreenIds` is the RESOLVED screen set (groups already expanded) that
 * the caller is about to occupy — resolveTargetScreenIds() produces it from a
 * rule set, and the Add-screens dialog produces it from the operator's picks.
 */
export function findScreenConflicts(input: {
  targetScreenIds: Iterable<string>;
  /**
   * The windows about to become active on those screens. THE RULE, in Greg's
   * words (2026-09-16):
   *
   *   "you cant have a screen active in two playlist at the same time unless
   *    its scheduled...example, i could have a playlist for breakfast, another
   *    for lunch, and another for dinner with different schedules but they
   *    cant be on at the same time"
   *
   * So sharing a screen is NOT the conflict — sharing a screen AT THE SAME
   * TIME is. Breakfast 06:00–10:00 and lunch 11:00–14:00 on one screen are a
   * deliberate, correct setup and must pass in silence; warning about them
   * would be the same false-positive failure as the May "take 1", arrived at
   * from the other direction.
   *
   * An omitted/empty window means ALWAYS, and `windowsCollide` makes always
   * collide with everything — which is the case that matters, because two
   * always-on playlists really cannot share a screen.
   *
   * Several windows because turning a PLAYLIST on activates every rule it
   * owns, and those can carry different windows. Empty array ⇒ treated as one
   * always-on window, since something is going live either way.
   */
  windows?: Array<{ daysOfWeek?: string | null; timeStart?: string | null; timeEnd?: string | null }>;
  /** The playlist doing the taking — never conflicts with itself. */
  excludePlaylistId: string;
  playlists: OpsPlaylistRef[];
  /** EVERY playlist's schedules, not just this one's. */
  schedules: OpsScheduleRef[];
  screens: OpsScreenRef[];
  groups: OpsGroupRef[];
}): ScreenConflict[] {
  const { excludePlaylistId, playlists, schedules, screens, groups } = input;
  const mine = new Set(input.targetScreenIds);
  if (mine.size === 0) return [];
  const incoming = input.windows?.length ? input.windows : [{}];

  const screenById = new Map(screens.map((s) => [s.id, s]));
  const groupById = new Map(groups.map((g) => [g.id, g]));
  // Only ACTIVE rules can be playing on anything. A paused or draft rule is a
  // plan, not an occupant, and warning about one would be a false positive.
  const live = schedules.filter((s) => s.isActive);

  const out: ScreenConflict[] = [];
  for (const other of playlists) {
    if (other.id === excludePlaylistId) continue;
    const otherLive = live.filter((s) => s.playlistId === other.id);
    if (otherLive.length === 0) continue;

    const scheduleIds: string[] = [];
    const names = new Set<string>();
    for (const sched of otherLive) {
      // Different hours on the same screen is the SUPPORTED setup, not a
      // clash. Skip before resolving screens — a rule that can never be on at
      // the same moment as ours is simply not our business.
      if (!incoming.some((w) => windowsCollide(w, sched))) continue;
      // Resolve this ONE rule's effective screens, the same way the server
      // does. The embedded `screen`/`screenGroup` are fallbacks for a payload
      // that did not join the live lists.
      const reached: Array<{ id: string; name: string }> = [];
      if (sched.screenId) {
        const sc = screenById.get(sched.screenId) ?? sched.screen ?? null;
        if (sc) reached.push({ id: sc.id, name: sc.name || sc.id });
      }
      if (sched.screenGroupId) {
        const grp = groupById.get(sched.screenGroupId) ?? sched.screenGroup ?? null;
        const members =
          (grp as OpsGroupRef | null)?.screens ??
          screens.filter((sc) => sc.screenGroupId === sched.screenGroupId);
        for (const m of members) {
          const full = screenById.get(m.id);
          reached.push({ id: m.id, name: full?.name || (m as { name?: string }).name || m.id });
        }
      }

      const hits = reached.filter((r) => mine.has(r.id));
      if (hits.length === 0) continue;
      scheduleIds.push(sched.id);
      for (const h of hits) names.add(h.name);
    }

    if (scheduleIds.length > 0) {
      out.push({
        playlistId: other.id,
        playlistName: other.name || other.id,
        scheduleIds,
        screenNames: Array.from(names),
      });
    }
  }
  return out;
}

/** How many screens a conflict set actually displaces. */
export function conflictScreenCount(conflicts: ScreenConflict[]): number {
  const all = new Set<string>();
  for (const c of conflicts) for (const n of c.screenNames) all.add(n);
  return all.size;
}

export interface ConflictPrompt {
  title: string;
  message: string;
  confirmLabel: string;
  screenCount: number;
}

/**
 * The confirmation copy. Lifted from the classic toggle so both surfaces say
 * the same thing — his third-take wording, which is specific about WHICH
 * screens move and explicit that the other playlist's remaining screens do not.
 *
 * `verb` differs only because the two entry points are different sentences:
 * turning a playlist on ("Switching X on"), versus adding screens to one
 * ("Adding these screens").
 */
export function describeScreenConflicts(
  conflicts: ScreenConflict[],
  playlistName: string,
  verb: 'switch-on' | 'add-screens' = 'switch-on',
): ConflictPrompt | null {
  if (conflicts.length === 0) return null;
  const screenCount = conflictScreenCount(conflicts);
  const lead =
    verb === 'add-screens'
      ? `Adding ${screenCount === 1 ? 'that screen' : 'those screens'} to “${playlistName}”`
      : `Switching “${playlistName}” on`;

  const message =
    conflicts.length === 1
      ? `“${conflicts[0].playlistName}” is currently playing on ${conflicts[0].screenNames.join(', ')}. ${lead} will replace it on ${conflicts[0].screenNames.length === 1 ? 'that screen' : 'those screens'} only — its other screens stay untouched.`
      : `These playlists overlap “${playlistName}” on the listed screens:\n\n${conflicts
          .map((c) => `• “${c.playlistName}” on ${c.screenNames.join(', ')}`)
          .join('\n')}\n\n${lead} will replace them on those screens only.`;

  return {
    title: `Replace on ${screenCount} screen${screenCount === 1 ? '' : 's'}?`,
    message,
    confirmLabel: 'Replace',
    screenCount,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Status navigation, filters, sorting (§7.3, §21)
// ─────────────────────────────────────────────────────────────────────

export type StatusTab = 'all' | 'active' | 'scheduled' | 'unassigned' | 'attention';

/**
 * §7.3 — an exception is actionable when a playlist the operator believes is
 * running has a delivery problem. A paused or unpublished playlist has no
 * delivery expectation, so it never lands here (and its gray delivery cell is
 * labelled, not colour-only).
 */
export function needsAttention(row: PlaylistSummaryRow): boolean {
  if (row.scheduleState !== 'ACTIVE') return false;
  return row.delivery.tone === 'warn' || row.delivery.tone === 'bad' || row.delivery.tone === 'unavailable';
}

export interface StatusCounts {
  all: number; active: number; scheduled: number; unassigned: number; attention: number;
}

/**
 * §7.3 — counts do not need to sum to `all`: `attention` deliberately overlaps
 * the schedule states.
 */
export function countByStatus(rows: PlaylistSummaryRow[]): StatusCounts {
  return {
    all: rows.length,
    active: rows.filter((r) => r.scheduleState === 'ACTIVE').length,
    scheduled: rows.filter((r) => r.scheduleState === 'SCHEDULED').length,
    unassigned: rows.filter((r) => r.scheduleState === 'UNASSIGNED').length,
    attention: rows.filter(needsAttention).length,
  };
}

export function matchesStatusTab(row: PlaylistSummaryRow, tab: StatusTab): boolean {
  switch (tab) {
    case 'active': return row.scheduleState === 'ACTIVE';
    case 'scheduled': return row.scheduleState === 'SCHEDULED';
    case 'unassigned': return row.scheduleState === 'UNASSIGNED';
    case 'attention': return needsAttention(row);
    case 'all':
    default: return true;
  }
}

/** §21.2 — progressive disclosure. Every field is optional/off by default. */
export interface LibraryFilters {
  contentType: 'all' | PlaylistKind;
  deliveryHealth: 'all' | 'ok' | 'attention' | 'not-published';
  creatorId: 'all' | string;
  screenId: 'all' | string;
  groupId: 'all' | string;
  ownership: 'all' | SourceOwnership;
}

export const EMPTY_FILTERS: LibraryFilters = {
  contentType: 'all',
  deliveryHealth: 'all',
  creatorId: 'all',
  screenId: 'all',
  groupId: 'all',
  ownership: 'all',
};

export function activeFilterCount(f: LibraryFilters): number {
  return (Object.keys(EMPTY_FILTERS) as Array<keyof LibraryFilters>)
    .filter((k) => f[k] !== EMPTY_FILTERS[k]).length;
}

export type LibrarySort = 'updated' | 'name' | 'attention' | 'screens' | 'next' | 'creator';

export const SORT_LABELS: Record<LibrarySort, string> = {
  updated: 'Recently updated',
  name: 'Name A–Z',
  attention: 'Needs attention first',
  screens: 'Most screens',
  next: 'Next scheduled',
  creator: 'Creator',
};

export interface ApplyLibraryInput {
  rows: PlaylistSummaryRow[];
  tab: StatusTab;
  search: string;
  filters: LibraryFilters;
  sort: LibrarySort;
  /** Screen id → the group it belongs to, for the group filter. */
  groupOfScreen?: Map<string, string | null>;
}

/** One pass: status tab → search → filters → sort. Pure, order-stable. */
export function applyLibrary(input: ApplyLibraryInput): PlaylistSummaryRow[] {
  const q = input.search.trim().toLowerCase();
  const f = input.filters;
  const out = input.rows.filter((row) => {
    if (!matchesStatusTab(row, input.tab)) return false;
    if (q && !row.searchText.includes(q)) return false;
    if (f.contentType !== 'all' && row.kind !== f.contentType) return false;
    if (f.ownership !== 'all' && row.sourceOwnership !== f.ownership) return false;
    if (f.creatorId !== 'all' && row.creatorSummary !== f.creatorId) return false;
    if (f.screenId !== 'all' && !row.targetScreenIds.includes(f.screenId)) return false;
    if (f.groupId !== 'all') {
      const map = input.groupOfScreen;
      const hit = map
        ? row.targetScreenIds.some((id) => map.get(id) === f.groupId)
        : false;
      if (!hit) return false;
    }
    if (f.deliveryHealth === 'ok' && row.delivery.tone !== 'ok') return false;
    if (f.deliveryHealth === 'attention' && !needsAttention(row)) return false;
    if (f.deliveryHealth === 'not-published' && row.delivery.state !== 'not-published') return false;
    return true;
  });

  const byName = (a: PlaylistSummaryRow, b: PlaylistSummaryRow) => a.name.localeCompare(b.name);
  const sorted = [...out];
  switch (input.sort) {
    case 'name':
      sorted.sort(byName);
      break;
    case 'attention':
      sorted.sort((a, b) => {
        const d = Number(needsAttention(b)) - Number(needsAttention(a));
        if (d !== 0) return d;
        const t = a.delivery.tone === b.delivery.tone ? 0 : a.delivery.tone === 'bad' ? -1 : b.delivery.tone === 'bad' ? 1 : 0;
        return t !== 0 ? t : byName(a, b);
      });
      break;
    case 'screens':
      sorted.sort((a, b) => (b.reach.screens - a.reach.screens) || byName(a, b));
      break;
    case 'next':
      sorted.sort((a, b) => {
        const rank = (r: PlaylistSummaryRow) =>
          r.scheduleState === 'ACTIVE' ? 0 : r.scheduleState === 'SCHEDULED' ? 1 : r.scheduleState === 'PAUSED' ? 2 : 3;
        return (rank(a) - rank(b)) || byName(a, b);
      });
      break;
    case 'creator':
      sorted.sort((a, b) => (a.creatorSummary ?? '').localeCompare(b.creatorSummary ?? '') || byName(a, b));
      break;
    case 'updated':
    default:
      sorted.sort((a, b) => (Date.parse(b.updatedAt) - Date.parse(a.updatedAt)) || byName(a, b));
      break;
  }
  return sorted;
}

/**
 * §7.5 — the exception banner. Renders only when something is actionable, says
 * WHICH playlist and WHICH screen, and links straight at the problem.
 */
export interface ExceptionBanner {
  count: number;
  headline: string;
  detail: string;
  /** The playlist to open on "Review delivery". */
  playlistId: string;
}

export function buildExceptionBanner(rows: PlaylistSummaryRow[]): ExceptionBanner | null {
  const flagged = rows.filter(needsAttention);
  if (flagged.length === 0) return null;
  const worst = [...flagged].sort(
    (a, b) => targetSeverity(a.delivery.state as DeliveryTargetState) - targetSeverity(b.delivery.state as DeliveryTargetState),
  )[0];
  return {
    count: flagged.length,
    headline: `${flagged.length} ${flagged.length === 1 ? 'playlist needs' : 'playlists need'} attention`,
    detail: worst.delivery.clause
      ? `${worst.name} is active, but ${worst.delivery.clause}`
      : `${worst.name} is active, but its delivery status is unknown.`,
    playlistId: worst.id,
  };
}

/**
 * §19.2 — the Pause everywhere confirmation must state the exact consequence
 * before it is committed. Numbers come from the rules themselves, never a
 * rounded "several screens".
 */
export function pauseEverywhereCopy(
  name: string,
  reach: PlaylistReach,
  ruleCount: number,
): { title: string; message: string; confirmLabel: string } {
  const rules = `${ruleCount} publishing ${ruleCount === 1 ? 'rule' : 'rules'}`;
  const screens = `${reach.screens} ${reach.screens === 1 ? 'screen' : 'screens'}`;
  const where = reach.locations > 1
    ? `${screens} and ${reach.locations} locations`
    : screens;
  return {
    title: `Pause “${name}” everywhere?`,
    message: `This disables ${rules} across ${where}. Screens will fall back according to their schedule priority.`,
    confirmLabel: 'Pause everywhere',
  };
}

/**
 * §20 — moving a playlist to trash. The backend has no trash today, so the
 * unpublished copy never promises restoration (§20.3): it says exactly what
 * the server does. A published playlist is BLOCKED with "Review publishing"
 * as the primary path (§20.2) — the safe route is resolving usage, not
 * emphasising "delete anyway".
 */
export interface RemoveDecision {
  blocked: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  /** Rendered as the primary button when blocked. */
  primaryLabel?: string;
}

export function removePlaylistCopy(row: PlaylistSummaryRow, ruleCount: number): RemoveDecision {
  if (ruleCount > 0 || row.reach.screens > 0) {
    const bits = [
      `${ruleCount} ${ruleCount === 1 ? 'rule' : 'rules'}`,
      `${row.reach.screens} ${row.reach.screens === 1 ? 'screen' : 'screens'}`,
    ];
    if (row.reach.locations > 1) bits.push(`${row.reach.locations} locations`);
    return {
      blocked: true,
      title: `“${row.name}” is currently published`,
      message: `${bits.join(' · ')}\n\nResolve or reassign its publishing rules before removing it.`,
      confirmLabel: 'Cancel',
      primaryLabel: 'Review publishing',
    };
  }
  return {
    blocked: false,
    title: `Remove “${row.name}”?`,
    // No trash exists server-side — never promise a 30-day restore (§20.3).
    message: 'This playlist is not published anywhere. Removing it deletes it permanently — it cannot be restored.',
    confirmLabel: 'Remove permanently',
  };
}
