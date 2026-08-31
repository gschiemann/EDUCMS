/**
 * fleetCommand.ts — Fleet Command derivation (2026-08-31, Phase 1).
 *
 * Turns the SAME three payloads the classic district command center reads
 * (fleet / district readiness / pending approvals) plus the deployed bundle
 * SHA into the Fleet Command surface: five independent assurance signals, a
 * prioritized exception inbox, a live convergence summary, and a dense
 * per-location table.
 *
 * ── The five truths (design README, 2026-08-31) ──────────────────────
 * "Online" is ONE signal of five, never a synonym for healthy:
 *   1. CONTENT CURRENT — on the deployed bundle AND no unacknowledged
 *      refresh command outstanding. Ack is VALUE-identity (refreshAckMs
 *      echoes pendingRefreshAtMs) — never clock comparison.
 *   2. DEVICE ONLINE   — heartbeat within the liveness window (server-graded).
 *   3. PUSH LIVE       — realtime channel stamped live (vs polling backstop).
 *   4. EMERGENCY READY — the per-vertical readiness verdict, its own state,
 *      never inferred from ordinary content health.
 *   5. SHOWING CONTENT — render-proof: confirmed picture (grade 'painting').
 *
 * ── Never cry wolf (inherited from districtRollup) ───────────────────
 * A signal whose input never answered reports state 'unknown' and its pill
 * renders gray — counters are suppressed, not zeroed. Bundle skew with no
 * deployed SHA grades every screen 'unknown' (deriveBundleSkew fails closed).
 *
 * PURE — no React, no network, no wall clock. Unit-tested without mounting
 * the dashboard.
 */

import { deriveRenderTrustGrade } from '@/components/screens/renderTrust';
import { deriveBundleSkew } from '@/components/screens/bundleSkew';
import {
  buildDistrictRollup,
  compareScorecards,
  type BuildDistrictRollupInput,
  type SchoolScorecard,
} from './districtRollup';

/** The fleet-row subset this module reads (superset of FleetScreenLike). */
export interface FleetCommandScreen {
  id: string;
  name: string;
  status: string;
  renderHealth?: 'OK' | 'STALE' | 'UNKNOWN' | null;
  renderStale?: boolean | null;
  pushChannel?: 'live' | 'stale' | 'unknown' | null;
  lastBundleSha?: string | null;
  pendingRefreshAtMs?: number | null;
  refreshAckMs?: number | null;
  sourceTenant: { id: string; name: string; slug: string } | null;
}

export type AssuranceState = 'ok' | 'warn' | 'bad' | 'unknown';

export interface AssurancePill {
  /** Numerator — screens (or locations) satisfying the signal. */
  n: number;
  /** Denominator the numerator is measured against. */
  total: number;
  state: AssuranceState;
}

export interface ExceptionRow {
  /** Worst-first order is the array order — no client re-sorting. */
  kind: 'emergency' | 'not-painting' | 'offline' | 'content-behind' | 'push-stale' | 'approvals' | 'setup';
  /** Location this exception belongs to (switch target). */
  tenantId: string;
  tenantName: string;
  slug: string;
  /** One plain-English line, already worded for a standard user. */
  headline: string;
  detail: string;
  /** Where the fix lives inside that location. */
  path: string;
  /** Number of screens/items implicated (badge). */
  count: number;
}

export interface ConvergenceSummary {
  /** Screens confirmed on current content (among gradeable online screens). */
  confirmed: number;
  /** Screens with an update still propagating (behind bundle or unacked refresh). */
  propagating: number;
  /** Online screens whose content state could actually be graded. */
  gradeable: number;
  /** True when nothing is propagating and at least one screen was gradeable. */
  settled: boolean;
}

export interface LocationRow extends SchoolScorecard {
  /** Screens behind on content (bundle stale or unacked refresh), online only. */
  contentBehind: number;
  /** Online screens on the polling backstop (no live push channel). */
  pushStale: number;
  /**
   * False when the location has no screens paired at all. A screenless
   * location can't display ANYTHING — its one actionable truth is "set up
   * a screen", so it gets a single calm 'setup' inbox row instead of an
   * emergency alarm, is excluded from the emergency-ready denominator,
   * and sorts to the bottom of the table (2026-08-31 operator feedback).
   */
  hasScreens: boolean;
}

export interface FleetCommand {
  assurance: {
    contentCurrent: AssurancePill;
    online: AssurancePill;
    pushLive: AssurancePill;
    emergencyReady: AssurancePill;
    showingContent: AssurancePill;
  };
  inbox: ExceptionRow[];
  /** Rows beyond the inbox cap (rendered as "+N more"). */
  inboxOverflow: number;
  convergence: ConvergenceSummary;
  locations: LocationRow[];
  coverage: { readiness: boolean; approvals: boolean };
  allClear: boolean;
}

const INBOX_CAP = 6;

/** Is this screen behind on content? Fails closed to `false` on no evidence. */
export function isContentBehind(
  s: Pick<FleetCommandScreen, 'status' | 'lastBundleSha' | 'pendingRefreshAtMs' | 'refreshAckMs'>,
  deployedSha: string | null,
): boolean {
  if (s.status !== 'ONLINE') return false;
  const skew = deriveBundleSkew({ status: s.status, reportedSha: s.lastBundleSha, deployedSha });
  if (skew === 'stale') return true;
  // Durable refresh outstanding: pendingRefreshAt set and NOT value-acked.
  if (s.pendingRefreshAtMs != null && s.refreshAckMs !== s.pendingRefreshAtMs) return true;
  return false;
}

/** Can this screen's content state be graded at all? (online + any evidence) */
function isContentGradeable(
  s: Pick<FleetCommandScreen, 'status' | 'lastBundleSha' | 'pendingRefreshAtMs'>,
  deployedSha: string | null,
): boolean {
  if (s.status !== 'ONLINE') return false;
  const skewKnown = !!deployedSha && !!s.lastBundleSha;
  return skewKnown || s.pendingRefreshAtMs != null;
}

export function buildFleetCommand(input: {
  screens: FleetCommandScreen[];
  rollupInput: BuildDistrictRollupInput;
  deployedSha: string | null;
}): FleetCommand {
  const { screens, deployedSha } = input;
  const rollup = buildDistrictRollup(input.rollupInput);

  const online = screens.filter((s) => s.status === 'ONLINE');

  // ── per-screen truths ────────────────────────────────────────────
  const behind = online.filter((s) => isContentBehind(s, deployedSha));
  const gradeable = online.filter((s) => isContentGradeable(s, deployedSha));
  const pushStale = online.filter((s) => s.pushChannel === 'stale');
  const painting = online.filter(
    (s) =>
      deriveRenderTrustGrade({
        status: s.status,
        renderHealth: s.renderHealth ?? null,
        renderStale: s.renderStale ?? null,
      }) === 'painting',
  );
  const notPainting = rollup.needsAction.notPaintingScreens;

  // ── per-location extension of the scorecards ─────────────────────
  const behindByTenant = new Map<string, number>();
  for (const s of behind) {
    const t = s.sourceTenant?.id;
    if (t) behindByTenant.set(t, (behindByTenant.get(t) ?? 0) + 1);
  }
  const pushStaleByTenant = new Map<string, number>();
  for (const s of pushStale) {
    const t = s.sourceTenant?.id;
    if (t) pushStaleByTenant.set(t, (pushStaleByTenant.get(t) ?? 0) + 1);
  }
  const locations: LocationRow[] = rollup.schools
    .map((sc) => ({
      ...sc,
      contentBehind: behindByTenant.get(sc.tenantId) ?? 0,
      pushStale: pushStaleByTenant.get(sc.tenantId) ?? 0,
      hasScreens: sc.screensTotal > 0,
    }))
    .sort((a, b) =>
      // Screenless locations park at the bottom — they have nothing to
      // alarm about and nothing to rank; within each half, worst first.
      Number(b.hasScreens) - Number(a.hasScreens) || compareScorecards(a, b),
    );

  // ── the five pills ───────────────────────────────────────────────
  const readinessKnown = rollup.coverage.readiness;
  // Emergency readiness is measured over locations that HAVE screens — a
  // screenless location can't display an alert (or anything else); it is
  // a setup task, not an emergency gap (2026-08-31 operator feedback).
  const screenful = rollup.schools.filter((s) => s.screensTotal > 0);
  const readyLocations = readinessKnown
    ? screenful.filter((s) => s.readiness === 'READY').length
    : 0;

  const assurance: FleetCommand['assurance'] = {
    contentCurrent: {
      n: gradeable.length - behind.length,
      total: gradeable.length,
      state:
        gradeable.length === 0 ? 'unknown' : behind.length === 0 ? 'ok' : 'warn',
    },
    online: {
      n: online.length,
      total: screens.length,
      state:
        screens.length === 0 ? 'unknown'
        : online.length === screens.length ? 'ok'
        : online.length === 0 ? 'bad'
        : 'warn',
    },
    pushLive: {
      n: online.filter((s) => s.pushChannel === 'live').length,
      total: online.length,
      state:
        online.length === 0 ? 'unknown' : pushStale.length === 0 ? 'ok' : 'warn',
    },
    emergencyReady: {
      n: readyLocations,
      total: screenful.length,
      state:
        !readinessKnown || screenful.length === 0 ? 'unknown'
        : screenful.some((s) => s.readiness === 'NOT_CONFIGURED') ? 'bad'
        : screenful.some((s) => s.readiness === 'NEEDS_ATTENTION') ? 'warn'
        : 'ok',
    },
    showingContent: {
      n: painting.length,
      total: online.length,
      state:
        online.length === 0 ? 'unknown' : notPainting > 0 ? 'bad' : 'ok',
    },
  };

  // ── exception inbox, worst first ─────────────────────────────────
  // Order mirrors compareScorecards: emergency > not-painting > offline >
  // content-behind > push-stale > approvals. One row per (kind, location).
  const inbox: ExceptionRow[] = [];
  for (const sc of locations) {
    if (!sc.hasScreens) continue; // screenless → single 'setup' row below
    if (sc.readiness === 'NOT_CONFIGURED') {
      inbox.push({
        kind: 'emergency', tenantId: sc.tenantId, tenantName: sc.name, slug: sc.slug,
        headline: `${sc.name} can’t display an emergency alert`,
        detail: sc.missingTypes.length
          ? `No content wired for: ${sc.missingTypes.join(', ')}.`
          : 'No alert content wired.',
        path: 'settings/emergency', count: 1,
      });
    }
  }
  for (const sc of locations) {
    if (sc.notPainting > 0) {
      inbox.push({
        kind: 'not-painting', tenantId: sc.tenantId, tenantName: sc.name, slug: sc.slug,
        headline: `${sc.name} · ${sc.notPainting} screen${sc.notPainting === 1 ? '' : 's'} — no picture confirmed`,
        detail: 'Connected and answering, but no confirmed picture for 5+ minutes.',
        path: 'screens', count: sc.notPainting,
      });
    }
  }
  for (const sc of locations) {
    if (sc.screensOffline > 0) {
      inbox.push({
        kind: 'offline', tenantId: sc.tenantId, tenantName: sc.name, slug: sc.slug,
        headline: `${sc.name} · ${sc.screensOffline} screen${sc.screensOffline === 1 ? '' : 's'} offline`,
        detail: 'Not answering heartbeats.',
        path: 'screens', count: sc.screensOffline,
      });
    }
  }
  for (const sc of locations) {
    if (sc.contentBehind > 0) {
      inbox.push({
        kind: 'content-behind', tenantId: sc.tenantId, tenantName: sc.name, slug: sc.slug,
        headline: `${sc.name} · ${sc.contentBehind} screen${sc.contentBehind === 1 ? '' : 's'} behind on content`,
        detail: 'An update is published but not confirmed on these screens yet.',
        path: 'screens', count: sc.contentBehind,
      });
    }
  }
  for (const sc of locations) {
    if (sc.pushStale > 0) {
      inbox.push({
        kind: 'push-stale', tenantId: sc.tenantId, tenantName: sc.name, slug: sc.slug,
        headline: `${sc.name} · ${sc.pushStale} screen${sc.pushStale === 1 ? '' : 's'} on slow updates`,
        detail: 'No instant connection — content still arrives via ~10s check-ins.',
        path: 'screens', count: sc.pushStale,
      });
    }
  }
  for (const sc of locations) {
    if (sc.pendingApprovals > 0) {
      inbox.push({
        kind: 'approvals', tenantId: sc.tenantId, tenantName: sc.name, slug: sc.slug,
        headline: `${sc.name} · ${sc.pendingApprovals} upload${sc.pendingApprovals === 1 ? '' : 's'} waiting for review`,
        detail: 'Submitted content is waiting on an approval.',
        path: 'reviews', count: sc.pendingApprovals,
      });
    }
  }
  // Screenless locations LAST and CALM: one setup row, never an alarm.
  for (const sc of locations) {
    if (!sc.hasScreens) {
      inbox.push({
        kind: 'setup', tenantId: sc.tenantId, tenantName: sc.name, slug: sc.slug,
        headline: `${sc.name} has no screens set up yet`,
        detail: 'Add its first screen to start showing content — alerts need a screen too.',
        path: 'screens', count: 1,
      });
    }
  }

  const convergence: ConvergenceSummary = {
    confirmed: gradeable.length - behind.length,
    propagating: behind.length,
    gradeable: gradeable.length,
    settled: gradeable.length > 0 && behind.length === 0,
  };

  return {
    assurance,
    inbox: inbox.slice(0, INBOX_CAP),
    inboxOverflow: Math.max(0, inbox.length - INBOX_CAP),
    convergence,
    locations,
    coverage: rollup.coverage,
    // All-clear requires every input to have ANSWERED (never cry wolf):
    // zeroed counters off a request that never returned are not calm.
    allClear:
      rollup.needsAction.allClear &&
      rollup.coverage.readiness &&
      rollup.coverage.approvals &&
      behind.length === 0 &&
      inbox.length === 0,
  };
}
