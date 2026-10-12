/**
 * Fleet map alerts — ONE path for every map (2026-10-12).
 *
 * Owner, twice in one morning:
 *   1. "says 1 screen needs update but then shows multiple that need it and im
 *      pretty sure houston is behind as well … the goal is an actionable alert
 *      takes you to fix the issue"
 *   2. "on the fleet map make sure parent accounts and just standard account
 *      maps have the same alerts and action items"
 *
 * Two maps exist: the organisation dashboard's Atlas (a pin per LOCATION —
 * FleetCommandCenter) and the Screens page map a standard account sees (a pin
 * per ADDRESS inside the one location — ScreenLocationAtlas). Both now build
 * `MapPlace`s from screens graded by `gradeMapScreen`, and both feed the SAME
 * functions below into the SAME summary card, chips and fix panel. A "place"
 * is whatever the map draws a pin for; nothing below cares which.
 *
 * Pure: no React, no clock (callers pass `now`), no fetch.
 */
import {
  gradeMapScreen,
  type FleetCommandScreen,
  type MapScreenGrade,
} from '@/components/dashboard/district/fleetCommand';
import type { OpsScreen } from '@/components/screens/v3/screenOps';

export interface MapAlertScreen {
  id: string;
  name: string;
  status: string;
  lastPingAt: string | null;
  lastRenderedAt: string | null;
  grade: MapScreenGrade;
}

export interface MapPlace {
  id: string;
  name: string;
  screens: MapAlertScreen[];
  /** Screens on the ~10 s polling backstop (no live push channel). */
  pushStale: number;
  /**
   * The location this place belongs to cannot fully show an emergency alert:
   * 'not-configured' (no alert content at all — red) or 'needs-attention'
   * (gaps — the chip and the summary, not the ring). Only for a place with
   * screens, and never on UNKNOWN: a check that has not answered is not a gap.
   */
  emergencyGap: 'not-configured' | 'needs-attention' | null;
}

/** Readiness verdict → gap, the one translation both maps use. */
export function emergencyGapOf(
  readiness: string | null | undefined,
  hasScreens: boolean,
): MapPlace['emergencyGap'] {
  if (!hasScreens) return null;
  if (readiness === 'NOT_CONFIGURED') return 'not-configured';
  if (readiness === 'NEEDS_ATTENTION') return 'needs-attention';
  return null;
}

export interface PlaceCounts {
  total: number;
  playing: number;
  syncing: number;
  behind: number;
  offline: number;
  noPicture: number;
  unconfirmed: number;
  /** Of the playing screens, those on the previous web player (self-healing). */
  appUpdating: number;
}

/** Grade one fleet/screens-page row for the map. The only adapter. */
export function toMapAlertScreen(
  s: FleetCommandScreen,
  deployedSha: string | null,
  deployedBundleId: string | null | undefined,
  now: number,
): MapAlertScreen {
  return {
    id: s.id,
    name: s.name?.trim() || 'Unnamed screen',
    status: s.status,
    lastPingAt: s.lastPingAt ?? null,
    lastRenderedAt: s.lastRenderedAt ?? null,
    grade: gradeMapScreen(s, deployedSha, deployedBundleId, now),
  };
}

/**
 * A Screens-page row as the fleet grader reads it. That payload carries the
 * outstanding push as an ISO `pendingRefreshAt` and has no ack column — a
 * cleared `pendingRefreshAt` IS the ack — which is exactly what
 * `refreshAckMs: null` means to `contentBehindCause`.
 */
export function fromOpsScreen(s: OpsScreen): FleetCommandScreen {
  const pending = s.pendingRefreshAt ? Date.parse(s.pendingRefreshAt) : NaN;
  return {
    id: s.id,
    name: s.name ?? '',
    status: s.status || 'PENDING',
    renderHealth: (s.renderHealth ?? null) as FleetCommandScreen['renderHealth'],
    renderStale: s.renderStale ?? null,
    lastRenderedAt: s.lastRenderedAt ?? null,
    lastRenderedHash: s.lastRenderedHash ?? null,
    pushChannel: s.pushChannel ?? null,
    lastBundleSha: s.lastBundleSha ?? null,
    lastBundleId: s.lastBundleId ?? null,
    pendingRefreshAtMs: Number.isFinite(pending) ? pending : null,
    refreshAckMs: null,
    authState: s.authState ?? null,
    lastPingAt: s.lastPingAt ?? null,
    sourceTenant: s.sourceTenant ?? null,
  };
}

export function countPlace(screens: MapAlertScreen[]): PlaceCounts {
  const c: PlaceCounts = { total: 0, playing: 0, syncing: 0, behind: 0, offline: 0, noPicture: 0, unconfirmed: 0, appUpdating: 0 };
  for (const s of screens) {
    c.total += 1;
    switch (s.grade.state) {
      case 'playing': c.playing += 1; if (s.grade.appUpdating) c.appUpdating += 1; break;
      case 'syncing': c.syncing += 1; break;
      case 'behind': c.behind += 1; break;
      case 'offline': c.offline += 1; break;
      case 'no-picture': c.noPicture += 1; break;
      case 'unconfirmed': c.unconfirmed += 1; break;
    }
  }
  return c;
}

/**
 * A place's ring colour — the same precedence as `locationTone`
 * (fleetCommand.ts; a test pins the two together): no alert content or a
 * screen with no confirmed picture is red; offline, an unconfirmed update or
 * slow updates is amber; otherwise green.
 */
export function placeTone(place: MapPlace): 'ok' | 'warn' | 'bad' {
  const c = countPlace(place.screens);
  if (place.emergencyGap === 'not-configured' || c.noPicture > 0) return 'bad';
  if (c.offline > 0 || c.behind > 0 || place.pushStale > 0) return 'warn';
  return 'ok';
}

/**
 * The map's chips. 'dark' and 'attention' have no chip of their own — the
 * summary's "no picture" count and the "Need attention" stat card are their
 * ways in.
 */
export type MapFilterKey = 'all' | 'healthy' | 'offline' | 'drift' | 'push' | 'emergency' | 'dark' | 'attention';
export const MAP_FILTER_CHIPS: Array<{ key: MapFilterKey; dot?: string; shield?: true }> = [
  { key: 'all' },
  { key: 'healthy', dot: '#10b981' },
  { key: 'offline', dot: '#f43f5e' },
  { key: 'drift', dot: '#f59e0b' },
  { key: 'push', dot: '#f43f5e' },
  { key: 'emergency', shield: true },
];

export function matchesMapFilter(place: MapPlace, key: MapFilterKey): boolean {
  const c = countPlace(place.screens);
  switch (key) {
    case 'all': return true;
    case 'healthy': return placeTone(place) === 'ok';
    case 'offline': return c.offline > 0;
    case 'drift': return c.behind > 0;
    case 'push': return place.pushStale > 0;
    case 'dark': return c.noPicture > 0;
    case 'emergency': return place.emergencyGap != null;
    case 'attention':
      return place.emergencyGap != null || place.pushStale > 0 || c.offline + c.noPicture + c.behind + c.unconfirmed > 0;
  }
}

export type MapAlertKind = 'offline' | 'dark' | 'drift' | 'emergency';

/** Which chip a summary alert switches the map to, so its place stays drawn. */
export const ALERT_FILTER: Record<MapAlertKind, MapFilterKey> = {
  offline: 'offline',
  dark: 'dark',
  drift: 'drift',
  emergency: 'emergency',
};

export interface MapAlert {
  kind: MapAlertKind;
  /** Screens with the problem (emergency: places). */
  count: number;
  /** Every place with this problem, worst first. Never truncated here. */
  places: Array<{ id: string; name: string; count: number }>;
}

export interface LiveSummary extends PlaceCounts {
  /** Oldest last heartbeat among the offline screens (ms), when any is dated. */
  offlineSinceMs: number | null;
  /** The single most important problem, everywhere in scope, or null. */
  action: MapAlert | null;
}

/**
 * The summary for EVERY place in scope — never the chip-filtered subset. The
 * old card summarised only what the chip left on the map, so with "Content
 * drift" on it could never mention another location (RIOT Houston).
 *
 * Priority: offline > no picture > emergency gap > update not confirmed —
 * a screen that cannot answer outranks one that has not confirmed.
 */
export function summarizeMapAlerts(places: MapPlace[]): LiveSummary {
  const all = places.flatMap((p) => p.screens);
  const counts = countPlace(all);
  let offlineSinceMs: number | null = null;
  for (const s of all) {
    if (s.grade.state !== 'offline' || !s.lastPingAt) continue;
    const at = Date.parse(s.lastPingAt);
    if (Number.isFinite(at) && (offlineSinceMs == null || at < offlineSinceMs)) offlineSinceMs = at;
  }
  const pick = (n: (c: PlaceCounts, p: MapPlace) => number) =>
    places
      .map((p) => ({ id: p.id, name: p.name, count: n(countPlace(p.screens), p) }))
      .filter((p) => p.count > 0)
      // Stable: equal counts keep the caller's (worst-first) order.
      .sort((a, b) => b.count - a.count);
  const candidates: Array<{ kind: MapAlertKind; places: MapAlert['places']; count: number }> = [];
  const off = pick((c) => c.offline);
  candidates.push({ kind: 'offline', places: off, count: counts.offline });
  const dark = pick((c) => c.noPicture);
  candidates.push({ kind: 'dark', places: dark, count: counts.noPicture });
  const gaps = pick((_c, p) => (p.emergencyGap != null ? 1 : 0));
  candidates.push({ kind: 'emergency', places: gaps, count: gaps.length });
  const drift = pick((c) => c.behind);
  candidates.push({ kind: 'drift', places: drift, count: counts.behind });
  const first = candidates.find((c) => c.places.length > 0) ?? null;
  return { ...counts, offlineSinceMs, action: first ? { kind: first.kind, count: first.count, places: first.places } : null };
}
