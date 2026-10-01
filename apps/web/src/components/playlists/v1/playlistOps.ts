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
import { deriveRenderTrustGrade, RENDER_STALE_AFTER_MS } from '@/components/screens/renderTrust';
import { deriveVideoPlayback, type OpsScreen } from '@/components/screens/v3/screenOps';
import {
  copy,
  deriveContentDownload,
  fmtSize,
  liveDownload,
  type ContentDownload,
  type OpsMessage,
} from '@/components/screens/contentDownload';

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
 *   `downloading`      — 2026-09-27: the screen is downloading new content —
 *                        nothing of it on glass yet, or the previous content
 *                        held there meanwhile (player rule 17: a large file
 *                        plays only once it is whole on the screen)
 */
export type DeliveryTargetState =
  | 'acknowledged'
  | 'not-updated'
  | 'offline'
  | 'unknown'
  | 'no-picture'
  | 'playback-issue'
  | 'content-mismatch'
  | 'downloading';

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
  'playback-issue',
  'no-picture',
  'not-updated',
  'offline',
  'unknown',
  // In progress, not a problem: every real problem or doubt above outranks
  // it, and it outranks the healthy state — "Playback reported" would be
  // false while the new content is still downloading.
  'downloading',
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
  resolution?: string | null;
  status?: string | null;
  screenGroupId?: string | null;
  /** Epoch-ms VALUE the operator's last push stamped on this screen. */
  pendingRefreshAt?: string | Date | null;
  /** The value the player echoed back. Equality — never a clock compare. */
  refreshAckMs?: number | string | null;
  renderHealth?: 'OK' | 'STALE' | 'UNKNOWN' | null;
  renderStale?: boolean | null;
  lastRenderedAt?: string | Date | null;
  lastRenderedHash?: string | null;
  lastVideoReport?: OpsScreen['lastVideoReport'];
  lastVideoReportAt?: string | null;
  pushChannel?: 'live' | 'stale' | 'unknown' | null;
  authState?: string | null;
  sourceTenant?: { id: string; name?: string | null } | null;
  /** The cache report, for its `downloading` snapshot (2026-09-27) — read
   *  only through `deriveContentDownload`, which grades its freshness. */
  lastCacheReport?: unknown;
  lastCacheReportAt?: string | Date | null;
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
  pendingMedia?: boolean | null;
  pendingMediaError?: string | null;
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

  const failedMedia = schedules.find((s) => s.pendingMedia && s.pendingMediaError);
  if (failedMedia) {
    return { state: 'PAUSED', pillLabel: 'MEDIA FAILED', summary: failedMedia.pendingMediaError! };
  }
  if (schedules.some((s) => s.pendingMedia)) {
    return { state: 'SCHEDULED', pillLabel: 'PREPARING 1080P', summary: 'Preparing a playback copy; publishing starts automatically afterward' };
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
  /** Current screen health, independent of whether an update was received. */
  pictureState?: 'reported' | 'issue' | 'stale' | 'unknown' | 'offline' | 'downloading';
  pushChannel: 'live' | 'stale' | 'unknown';
  state: DeliveryTargetState;
  /**
   * The FRESH download this screen reported, if any (2026-09-27) — on a
   * 'downloading' target it is the story; on one reporting playback it is a
   * file still downloading behind content that plays. Never a stale one.
   */
  download?: ContentDownload | null;
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
  /**
   * The Delivery cell's FIRST line — the state, and nothing else.
   *
   * 2026-09-16, Greg: "still cant read shit on the delivery of each
   * playlist...i said shift that shit to the left so we can read it" and then
   * "make the text less, do two lines with it if needed". It used to carry the
   * state AND the count in one ~50-character string
   * ("FUH43-L has no confirmed picture · 2 of 3 confirmed"), which wrapped to
   * four lines in the column and then clipped. Split: state here, count in
   * `sub`, two short lines instead of one long one.
   */
  label: string;
  /** The count, as the cell's quieter second line. Null when there isn't one. */
  sub?: string | null;
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
  /**
   * `label` / `sub` as catalogue references (2026-09-27, the downloading
   * summary). Components render `t(key, values)` when present.
   */
  messages?: { label?: OpsMessage; sub?: OpsMessage };
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

  const problems = opts.pushing ? targets.filter(t => t.state === 'offline' || t.state === 'playback-issue' || t.state === 'no-picture' || t.state === 'content-mismatch') : [];
  const worst = worstTargetState((problems.length ? problems : targets).map((t) => t.state));
  const worstNames = worst ? (byState.get(worst) ?? []) : [];

  if (opts.pushing && (worst === 'not-updated' || worst === 'unknown')) {
    return {
      state: 'pushing',
      tone: 'muted',
      label: 'Sending update',
      sub: `${acknowledged} of ${total} received`,
      detail: null,
      clause: null,
      acknowledged, total, worstNames,
    };
  }

  switch (worst) {
    case 'playback-issue':
      return {
        state: 'playback-issue', tone: 'bad',
        label: `${nameList(worstNames)}: playback problem`,
        sub: null,
        detail: `${nameList(worstNames)} is reachable, but its latest report shows missing or choppy content.`,
        clause: `${nameList(worstNames)} reported a playback problem.`,
        acknowledged, total, worstNames,
      };
    case 'content-mismatch':
      return {
        state: 'content-mismatch',
        tone: 'bad',
        label: `${nameList(worstNames)}: different content`,
        sub: null,
        detail: `${nameList(worstNames)} reported content that does not match what was published.`,
        clause: `${nameList(worstNames)} reported content that does not match what was published.`,
        acknowledged, total, worstNames,
      };
    case 'no-picture':
      return {
        state: 'no-picture',
        tone: 'bad',
        label: `${nameList(worstNames)}: no picture`,
        sub: `${total - worstNames.length} of ${total} reporting playback`,
        detail: `${nameList(worstNames)} is reachable but has not reported playback recently.`,
        clause: `${nameList(worstNames)} has not reported playback recently.`,
        acknowledged, total, worstNames,
      };
    case 'not-updated':
      return {
        state: 'not-updated',
        tone: 'warn',
        label: `${nameList(worstNames)}: not updated`,
        sub: `${acknowledged} of ${total} received`,
        detail: `${nameList(worstNames)} has not received the latest update.`,
        clause: `${nameList(worstNames)} has not received the latest update.`,
        acknowledged, total, worstNames,
      };
    case 'offline':
      return {
        state: 'offline',
        tone: 'warn',
        label: `${worstNames.length} of ${total} offline`,
        sub: null,
        detail: `${nameList(worstNames)} cannot be reached.`,
        clause: `${nameList(worstNames)} cannot be reached.`,
        acknowledged, total, worstNames,
      };
    case 'unknown':
      return {
        state: 'unknown',
        tone: 'muted',
        label: worstNames.length === total
          ? 'Waiting for playback report'
          : `${nameList(worstNames)} has not reported back`,
        detail: 'These screens have not reported enough to confirm the update.',
        clause: `${nameList(worstNames)} has not reported back yet.`,
        acknowledged, total, worstNames,
      };
    case 'downloading':
      return summarizeDownloading(targets, { acknowledged, total, worstNames });
    case 'acknowledged':
    default:
      return {
        state: 'acknowledged',
        tone: 'ok',
        label: 'Update received',
        sub: `on ${total} of ${total}`,
        detail: null,
        clause: null,
        acknowledged, total, worstNames: [],
      };
  }
}

/**
 * The rollup while new content is still downloading (2026-09-27). Calm —
 * muted, never green and never an exception: the screens are doing exactly
 * what they should (player rule 17 plays a large file only once it is whole
 * on the screen). One screen: its name and live progress. Several: how many.
 * Progress only ever comes from a FRESH snapshot (`target.download`); with
 * none the line names the screen and claims no number. No ETA.
 */
function summarizeDownloading(
  targets: DeliveryTarget[],
  counts: { acknowledged: number; total: number; worstNames: string[] },
): DeliverySummary {
  const dl = targets.filter((t) => t.state === 'downloading');
  const allHeld = dl.length > 0 && dl.every((t) => t.download?.state === 'held');
  const label = copy(allHeld ? 'screens.contentState.showingPrevious' : 'screens.contentState.downloading');
  let sub: { en: string; message?: OpsMessage } | null = null;
  if (dl.length === 1) {
    const one = dl[0];
    const d = one.download ?? null;
    const held = d?.state === 'held';
    if (d && d.percent !== null && d.bytesTotal !== null) {
      sub = copy(held ? 'playlistsPage.deliveryHeldOne' : 'playlistsPage.deliveryDownloadOne', {
        name: one.name, percent: d.percent, size: fmtSize(d.bytesTotal),
      });
    } else if (d) {
      sub = copy(held ? 'playlistsPage.deliveryHeldOneSoFar' : 'playlistsPage.deliveryDownloadOneSoFar', {
        name: one.name, loaded: fmtSize(d.bytesLoaded),
      });
    } else {
      sub = { en: one.name }; // the proof says "downloading"; no number to claim
    }
  } else if (dl.length > 1) {
    sub = copy('playlistsPage.deliveryDownloadMany', { count: dl.length, screens: counts.total });
  }
  return {
    state: 'downloading',
    tone: 'muted',
    label: label.en,
    sub: sub?.en ?? null,
    // Muted: no exception banner reads these. Nothing is wrong.
    detail: null,
    clause: null,
    ...counts,
    messages: { label: label.message, ...(sub?.message ? { sub: sub.message } : {}) },
  };
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

type CurrentPictureState = NonNullable<DeliveryTarget['pictureState']>;

/** Grade only current, content-bearing render proof as a healthy report. */
export function deriveCurrentPictureState(screen: OpsScreenRef, nowMs: number): CurrentPictureState {
  if (screen.status === 'CONTENT_UNAVAILABLE') return 'issue';
  if (screen.status !== 'ONLINE') return 'offline';

  const proofMs = toMs(screen.lastRenderedAt);
  const grade = deriveRenderTrustGrade({
    status: screen.status,
    renderHealth: screen.renderHealth,
    renderStale: screen.renderStale,
    lastRenderedAtMs: proofMs,
    lastRenderedHash: screen.lastRenderedHash,
    authState: screen.authState,
    nowMs,
  });

  // ── New content downloading (2026-09-27) ─────────────────────────────
  // Read BEFORE the 90 s check below: that check judges every proof by the
  // playing window, and the download splash proves on the idle lane (every
  // five minutes), so it would call a screen that is downloading "no
  // picture". The grade uses the server's own verdict, which knows the idle
  // window. A fresh snapshot counts only over a FRESH proof (the grades
  // below) or none at all — it is liveness, never a picture (player rule 5),
  // so it can never talk a stale proof out of its "no picture".
  if (grade === 'downloading') return 'downloading';
  const download = liveDownload(deriveContentDownload(screen, nowMs));
  const idleFamily = grade === 'idle' || grade === 'connecting' || grade === 'content-loading' || grade === 'unknown';
  if (download && (idleFamily || (download.state === 'held' && grade === 'painting'))) return 'downloading';

  // A first frame has not arrived yet. These proofs describe startup, not a
  // failed video. An outstanding request that exceeds its grace period is
  // handled by the delivery deadline below; never invent a picture here.
  if (grade === 'idle' || grade === 'connecting' || grade === 'content-loading') return 'unknown';

  if (proofMs === null || nowMs < proofMs) return 'unknown';
  if (nowMs - proofMs >= RENDER_STALE_AFTER_MS) return 'stale';

  // The player's own states are not this playlist playing. 'connecting' and
  // 'content-loading' were one 'idle' grade until 2026-09-27; they keep its
  // reading here, and "Content unavailable" is exactly a playback problem.
  if (
    grade === 'content-unavailable' ||
    grade === 'paused' || grade === 'repair-required' || grade === 'media-stalled' || grade === 'alert-unconfirmed'
  ) {
    return 'issue';
  }
  if (grade === 'not-painting' || grade === 'checking' || grade === 'stale-chronic') return 'stale';
  if (grade !== 'painting') return 'unknown';

  const playback = deriveVideoPlayback({
    id: screen.id,
    status: screen.status,
    lastVideoReport: screen.lastVideoReport,
    lastVideoReportAt: screen.lastVideoReportAt,
  } as OpsScreen, nowMs);
  const reportAt = toMs(screen.lastVideoReportAt ?? screen.lastVideoReport?.at);
  const reportAge = reportAt === null ? Infinity : nowMs - reportAt;
  if (playback && reportAge >= 0 && reportAge < RENDER_STALE_AFTER_MS &&
      (playback.grade === 'hitching' || playback.grade === 'stuttering')) {
    return 'issue';
  }

  if (typeof screen.lastRenderedHash !== 'string' || !screen.lastRenderedHash.startsWith('pl:')) {
    return screen.lastRenderedHash?.startsWith('em:') ? 'issue' : 'unknown';
  }
  return 'reported';
}

/** Apply live screen health over a stored delivery receipt. */
export function overlayCurrentScreenHealth(
  targets: DeliveryTarget[],
  screens: OpsScreenRef[],
  nowMs: number = Date.now(),
): DeliveryTarget[] {
  const current = new Map(deriveTargetsFromScreens(screens, nowMs).map((target) => [target.screenId, target]));
  return targets.map((target) => {
    const live = current.get(target.screenId);
    if (!live) return { ...target, state: target.state === 'acknowledged' ? 'unknown' : target.state, pictureState: 'unknown' };
    const pictureState = live.pictureState ?? 'unknown';
    const state = pictureState === 'offline' ? 'offline'
      : pictureState === 'issue' ? 'playback-issue'
        : pictureState === 'stale' ? 'no-picture'
          // Fresh evidence the new content is still downloading outranks an
          // older receipt, whatever it said.
          : pictureState === 'downloading' ? 'downloading'
            : pictureState === 'unknown' && target.state === 'acknowledged' ? 'unknown'
              : target.state;
    return {
      ...target,
      online: live.online,
      lastProofAt: live.lastProofAt,
      pictureState,
      state,
      ...(live.download ? { download: live.download } : {}),
    };
  });
}

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

    let pictureState = deriveCurrentPictureState(s, nowMs);
    // Reports from before a new request cannot diagnose that new content.
    // Keep offline/credential faults visible and expire this grace normally.
    const awaitingFirstReport = online && s.authState !== 'REPAIR_REQUIRED' && pending !== null
      && nowMs >= pending && nowMs - pending < PUSH_GRACE_MS
      && (proofMs === null || proofMs < pending)
      && (!s.lastRenderedHash || s.lastRenderedHash.startsWith('pl:') || s.lastRenderedHash.startsWith('idle:'));
    if (awaitingFirstReport) pictureState = 'unknown';
    const download = liveDownload(deriveContentDownload(s, nowMs));
    let state: DeliveryTargetState;
    if (pictureState === 'offline') {
      state = 'offline';
    } else if (pictureState === 'issue') {
      state = 'playback-issue';
    } else if (pictureState === 'stale') {
      state = 'no-picture';
    } else if (pictureState === 'downloading') {
      // New content is still downloading to this screen (2026-09-27). That is
      // the fresher, more specific fact than an unechoed push: the screen is
      // alive and working toward the content, and the operator's move is to
      // wait for it, not to push again.
      state = 'downloading';
    } else if (pictureState === 'unknown') {
      state = pending !== null ? 'not-updated' : 'unknown';
    } else if (pending !== null) {
      // VALUE identity. Equal → the player painted after the request.
      state = ack !== null && ack === pending ? 'acknowledged' : 'not-updated';
    } else {
      state = 'acknowledged';
    }

    return {
      screenId: s.id,
      name,
      locationName,
      online,
      ackAt: pending !== null && ack !== null && ack === pending ? ack : null,
      lastProofAt,
      pictureState,
      pushChannel,
      state,
      ...(download ? { download } : {}),
    };
  });
}

/** A new request is still within its bounded, neutral delivery period. */
export function isUpdateInFlight(screen: OpsScreenRef | undefined, nowMs: number = Date.now()): boolean {
  if (!screen || screen.status !== 'ONLINE' || screen.authState === 'REPAIR_REQUIRED') return false;
  const pending = toMs(screen.pendingRefreshAt);
  return pending !== null && nowMs >= pending && nowMs - pending < PUSH_GRACE_MS;
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
  const waiting = targets.filter(t => t.state === 'not-updated');
  const pushing = waiting.length > 0 && waiting.every((t) =>
    isUpdateInFlight(targetScreens.find((s) => s.id === t.screenId), nowMs));
  const summary = summarizeDelivery(targets, { pushing });
  if (summary.state === 'acknowledged') {
    // Nothing was pushed here — the evidence is a fresh render proof, so say
    // that and nothing more. "Update received" would claim a deployment that
    // does not exist.
    const anyPending = targetScreens.some((s) => toMs(s.pendingRefreshAt) !== null);
    if (!anyPending) {
      return {
        ...summary,
        // The player reports that its current carousel is rendering. We have
        // not compared that carousel's version with this playlist's expected
        // version, so no confirmation claim is justified here.
        label: 'Playback reported',
        sub: `on ${summary.total} of ${summary.total}`,
        tone: 'muted',
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
  const eligible = state.state === 'ACTIVE';
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

// ─────────────────────────────────────────────────────────────────────
// 1080p playback copies (rule 16) — what each screen's switch may do
// ─────────────────────────────────────────────────────────────────────

/**
 * Why a screen's rule is not simply on or off:
 *   • `preparing`       — its own rule is held for a 1080p copy. The switch is
 *                         the per-screen "Stop and cancel publish"; ON is what
 *                         the server refuses (409 PLAYBACK_COPY_PENDING).
 *   • `failed`          — the copy could not be prepared; the rule is inert.
 *                         ON is a fresh attempt through the gate.
 *   • `group-preparing` — the screen is reached only through a GROUP rule that
 *                         is preparing. Any change would split that rule, which
 *                         the server refuses; both buttons wait.
 */
export type PlaybackCopyState = 'preparing' | 'failed' | 'group-preparing';

export interface ScreenPlaybackCopy {
  state: PlaybackCopyState;
  /** The server's own words for a failed copy; null otherwise. */
  error: string | null;
  /** The group whose rule is preparing, for the label. */
  groupName: string | null;
}

const isPreparing = (s: OpsScheduleRef) => s.pendingMedia === true && !s.pendingMediaError;
const isFailed = (s: OpsScheduleRef) => s.pendingMedia === true && !!s.pendingMediaError;

/**
 * One entry per screen whose switch is NOT a plain on/off right now. A screen's
 * own rule speaks first (a pin outranks a group rule everywhere else too); a
 * screen with no rule of its own inherits the state of the group rule reaching
 * it. Screens with nothing pending are simply absent.
 */
export function derivePlaybackCopyStates(
  schedules: OpsScheduleRef[],
  groups: OpsGroupRef[],
  screens: OpsScreenRef[],
): Map<string, ScreenPlaybackCopy> {
  const out = new Map<string, ScreenPlaybackCopy>();
  const groupById = new Map(groups.map((g) => [g.id, g]));
  const own = new Set<string>();
  for (const s of schedules) if (s.screenId) own.add(s.screenId);
  // Own rules: preparing beats failed on the same screen (a fresh attempt
  // supersedes the old failure the moment it is queued).
  for (const s of schedules) {
    if (!s.screenId) continue;
    if (isPreparing(s)) out.set(s.screenId, { state: 'preparing', error: null, groupName: null });
    else if (isFailed(s) && out.get(s.screenId)?.state !== 'preparing') {
      out.set(s.screenId, { state: 'failed', error: s.pendingMediaError ?? null, groupName: null });
    }
  }
  for (const s of schedules) {
    if (!s.screenGroupId || (!isPreparing(s) && !isFailed(s))) continue;
    const g = groupById.get(s.screenGroupId);
    const members = g?.screens ?? screens.filter((sc) => sc.screenGroupId === s.screenGroupId);
    for (const m of members) {
      if (!m?.id || own.has(m.id) || out.has(m.id)) continue;
      out.set(m.id, isPreparing(s)
        ? { state: 'group-preparing', error: null, groupName: g?.name || s.screenGroup?.name || null }
        : { state: 'failed', error: s.pendingMediaError ?? null, groupName: g?.name || s.screenGroup?.name || null });
    }
  }
  return out;
}

/**
 * A failed copy is retried with a FRESH publish (POST /schedules) carrying the
 * failed rule's own window and target: the server collapses the failed row
 * (it is inert since bdb3f59a) and runs the gate again — held if the copy is
 * still missing, live at once if it has since landed.
 */
export function retryPublishPayload(rule: OpsScheduleRef): Record<string, unknown> {
  const start = rule.startTime ? new Date(rule.startTime) : new Date();
  return {
    playlistId: rule.playlistId,
    ...(rule.screenId ? { screenId: rule.screenId } : {}),
    ...(rule.screenGroupId ? { screenGroupId: rule.screenGroupId } : {}),
    startTime: (Number.isFinite(start.getTime()) ? start : new Date()).toISOString(),
    ...(rule.endTime ? { endTime: new Date(rule.endTime).toISOString() } : {}),
    ...(rule.daysOfWeek ? { daysOfWeek: rule.daysOfWeek } : {}),
    ...(rule.timeStart ? { timeStart: rule.timeStart } : {}),
    ...(rule.timeEnd ? { timeEnd: rule.timeEnd } : {}),
    priority: rule.priority ?? 0,
    mode: rule.mode === 'append' ? 'append' : 'replace',
    mutedOverride: rule.mutedOverride ?? null,
  };
}

/** Confirmation copy for permanent playlist deletion. */
export interface RemoveDecision {
  title: string;
  message: string;
  confirmLabel: string;
  /**
   * The copy said the playlist is published (rules, screens or copies).
   * Confirming THIS dialog is what lets the caller send `?confirm=in-use`;
   * the server refuses a published delete without it (2026-09-26).
   */
  inUse: boolean;
}

export function removePlaylistCopy(
  row: PlaylistSummaryRow,
  ruleCount: number,
  /**
   * The server's exact count of other locations holding a copy (from a 409
   * PLAYLIST_PUBLISHED `reach.copies`). Without it the count is inferred from
   * `reach.locations`, which is all the library knows.
   */
  opts: { copies?: number } = {},
): RemoveDecision {
  // Copies at other locations count as published (2026-09-26 review finding):
  // the server deletes every location's copy and its rules along with the
  // parent, and `ruleCount` / `reach.screens` only see THIS tenant's rows — a
  // district playlist published only to its schools used to read "not
  // published anywhere" right before taking 12 school screens off air.
  const otherLocations = opts.copies ?? (row.reach.locations > 1 ? row.reach.locations - 1 : 0);
  if (ruleCount > 0 || row.reach.screens > 0 || otherLocations > 0) {
    const bits = [
      `${ruleCount} ${ruleCount === 1 ? 'rule' : 'rules'}`,
      `${row.reach.screens} ${row.reach.screens === 1 ? 'screen' : 'screens'}`,
    ];
    if (row.reach.locations > 1) bits.push(`${row.reach.locations} locations`);
    const copies = otherLocations > 0
      ? ` It also deletes the copies at ${otherLocations} other ${otherLocations === 1 ? 'location' : 'locations'}, including any rules those locations added.`
      : '';
    return {
      title: `Delete published playlist “${row.name}”?`,
      message: `${bits.join(' · ')}\n\nDeleting it also removes its publishing rules.${copies} Affected screens use another available schedule or their default content. This cannot be undone.`,
      confirmLabel: 'Delete playlist and rules',
      inUse: true,
    };
  }
  return {
    title: `Remove “${row.name}”?`,
    // No trash exists server-side — never promise a 30-day restore (§20.3).
    message: 'This playlist is not published anywhere. Removing it deletes it permanently — it cannot be restored.',
    confirmLabel: 'Remove permanently',
    inUse: false,
  };
}

/**
 * The published warning rebuilt from a 409 PLAYLIST_PUBLISHED `reach`
 * (`{ rules, screens, locations, copies }`) — the server saw publishing this
 * page did not (rules not loaded yet, copies at other locations). Null when
 * the answer carries no usable reach, or reach that does not add up to
 * "published": then there is nothing honest to confirm, and the caller must
 * not send `?confirm=in-use`.
 */
export function removePlaylistCopyFromServer(
  row: PlaylistSummaryRow,
  ruleCount: number,
  reach: unknown,
): RemoveDecision | null {
  if (!reach || typeof reach !== 'object') return null;
  const r = reach as Record<string, unknown>;
  const count = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null);
  const decision = removePlaylistCopy(
    {
      ...row,
      reach: {
        ...row.reach,
        screens: count(r.screens) ?? row.reach.screens,
        locations: count(r.locations) ?? row.reach.locations,
      },
    },
    count(r.rules) ?? ruleCount,
    { copies: count(r.copies) ?? undefined },
  );
  return decision.inUse ? decision : null;
}

// ─────────────────────────────────────────────────────────────────────
// Removing SEVERAL playlists at once (2026-09-28)
// ─────────────────────────────────────────────────────────────────────

export interface RemoveManyDecision {
  title: string;
  message: string;
  confirmLabel: string;
  /**
   * The ids this confirmation told the operator are PUBLISHED. Only these are
   * sent `?confirm=in-use` (the server refuses to delete a published playlist
   * without it), so a playlist the operator was told was unpublished can never
   * be deleted as a published one — it comes back 409 and is reported instead.
   */
  inUseIds: Set<string>;
  publishedCount: number;
}

/** How many names the confirmation lists before "…and N more". */
export const REMOVE_MANY_NAMES_SHOWN = 6;

/**
 * The confirmation for removing several playlists in one go. Says what is about
 * to happen with real numbers — and, like the single-playlist dialog, never
 * promises a way back (there is no trash server-side).
 *
 * Published playlists are counted with the SAME test `removePlaylistCopy` uses,
 * so one playlist reads the same whether it is removed alone or in a batch. The
 * screen count is the UNION of the published playlists' screens — two playlists
 * on the same screen are one screen affected, not two.
 */
export function removePlaylistsCopy(
  rows: PlaylistSummaryRow[],
  ruleCountOf: (id: string) => number,
): RemoveManyDecision {
  const inUseIds = new Set<string>();
  const screens = new Set<string>();
  let rules = 0;
  for (const row of rows) {
    const ruleCount = ruleCountOf(row.id);
    if (!removePlaylistCopy(row, ruleCount).inUse) continue;
    inUseIds.add(row.id);
    rules += ruleCount;
    for (const id of row.targetScreenIds ?? []) screens.add(id);
  }
  const n = rows.length;
  const p = inUseIds.size;

  const shown = rows.slice(0, REMOVE_MANY_NAMES_SHOWN).map((r) => `• ${r.name}`);
  const more = n > REMOVE_MANY_NAMES_SHOWN ? [`…and ${n - REMOVE_MANY_NAMES_SHOWN} more`] : [];

  const published =
    p === 0
      ? 'None of them is published anywhere.'
      : `${p === n ? (n === 2 ? 'Both are' : `All ${n} are`) : `${p} of them ${p === 1 ? 'is' : 'are'}`} published` +
        ` (${rules} ${rules === 1 ? 'rule' : 'rules'}${screens.size > 0 ? ` · ${screens.size} ${screens.size === 1 ? 'screen' : 'screens'}` : ''}).` +
        ' Removing a published playlist also removes its publishing rules; the screens it was on use another available schedule or their default content.';

  return {
    title: `Remove ${n} playlists?`,
    message: `${[...shown, ...more].join('\n')}\n\n${published}\n\nThis deletes them permanently — it cannot be restored.`,
    confirmLabel: p > 0 ? `Delete ${n} playlists` : `Remove ${n} permanently`,
    inUseIds,
    publishedCount: p,
  };
}

export interface RemoveManyFailure {
  id: string;
  name: string;
  /** Why, in words an operator can act on. */
  reason: string;
  /** The server saw publishing this page did not — it must be reviewed on its own. */
  becamePublished: boolean;
}

export interface RemoveManyResult {
  removed: string[];
  failed: RemoveManyFailure[];
}

/**
 * Delete playlists ONE AT A TIME, in order, and keep going when one fails — a
 * bad row must not strand the ones behind it, and the operator must hear about
 * every one that did not go. Sequential on purpose: each delete re-applies
 * screen fallback and signals a sync server-side, and a burst of parallel
 * deletes racing those would be a needless way to find out they conflict.
 *
 * `deleteOne` is injected so this is testable without a network; the page hands
 * it the real request.
 */
export async function removePlaylistsSequentially(
  rows: PlaylistSummaryRow[],
  inUseIds: ReadonlySet<string>,
  deleteOne: (id: string, confirmInUse: boolean) => Promise<unknown>,
): Promise<RemoveManyResult> {
  const removed: string[] = [];
  const failed: RemoveManyFailure[] = [];
  for (const row of rows) {
    try {
      await deleteOne(row.id, inUseIds.has(row.id));
      removed.push(row.id);
    } catch (err) {
      const e = err as { code?: string; message?: string } | null;
      const becamePublished = e?.code === 'PLAYLIST_PUBLISHED';
      failed.push({
        id: row.id,
        name: row.name,
        becamePublished,
        reason: becamePublished
          ? 'it turned out to be published — remove it on its own to see what it affects'
          : e?.message || 'the server rejected the request',
      });
    }
  }
  return { removed, failed };
}

/** The follow-up the operator reads when not everything went. Null when all went. */
export function describeRemoveManyOutcome(
  total: number,
  result: RemoveManyResult,
): { title: string; message: string } | null {
  if (result.failed.length === 0) return null;
  const lines = result.failed.slice(0, 6).map((f) => `• ${f.name} — ${f.reason}`);
  if (result.failed.length > 6) lines.push(`…and ${result.failed.length - 6} more`);
  return {
    title: `Removed ${result.removed.length} of ${total} playlists`,
    message:
      `${result.failed.length} ${result.failed.length === 1 ? 'was' : 'were'} not removed and ${result.failed.length === 1 ? 'is' : 'are'} still in your library:\n\n${lines.join('\n')}`,
  };
}
