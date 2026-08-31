/**
 * districtRollup.ts — the district admin's command-center derivation
 * (2026-08-24).
 *
 * ── Why this file exists ─────────────────────────────────────────────
 * A district admin opening the dashboard was seeing roughly the same page a
 * single school sees: fleet KPIs, a screen-group rollup, a getting-started
 * card. None of it answers the only question they actually have at 8 AM —
 * "which of my schools needs me today?" This module turns three payloads the
 * app already has (or now has, via one bounded read-only API addition) into
 * that answer:
 *
 *   • GET /screens/fleet                  → every child school's screens,
 *                                            each row carrying the
 *                                            render-proof verdict
 *   • GET /emergency/readiness/district   → per-school "could this school run
 *                                            a lockdown right now?"
 *   • GET /submissions/pending-counts     → per-school approvals waiting
 *
 * PURE — no React, no network, no wall clock. Everything time-derived was
 * already computed server-side (`status`, `renderHealth`), so this module is
 * deterministic and unit-testable without mounting the 1,100-line dashboard.
 *
 * ── The two rules the design is built on ─────────────────────────────
 *  1. LEAD WITH WHAT NEEDS ACTION. A counter that is zero is not a row. The
 *     needs-action strip renders only nonzero counters; when every counter is
 *     zero the UI gets one calm line instead of five green zeroes.
 *  2. WORST FIRST, ALWAYS. `compareScorecards` is a strict tuple comparator,
 *     not a weighted score — a school that cannot run a lockdown outranks any
 *     number of offline screens, deterministically, with no magic constants
 *     that can silently collide at 40 schools.
 *
 * ── Never cry wolf ───────────────────────────────────────────────────
 * Readiness and approvals are separate requests that can fail or still be in
 * flight. When either is absent, its counters are suppressed entirely
 * (`coverage` says so) rather than reported as zero — the same discipline
 * `deriveRenderTrust` uses for UNKNOWN render-proof. A district admin must
 * never read "all clear" off a request that never answered.
 */

import { deriveRenderTrustGrade, type RenderHealth } from '@/components/screens/renderTrust';

/** The subset of a `GET /screens/fleet` row this module reads. */
export interface FleetScreenLike {
  id: string;
  name: string;
  status: string;
  renderHealth?: RenderHealth | null;
  renderStale?: boolean | null;
  sourceTenant: { id: string; name: string; slug: string } | null;
}

/**
 * One school as `GET /emergency/readiness/district` reports it.
 *
 * NOTE on `screensTotal` / `screensOnline`: the readiness endpoint carries its
 * own screen counts (it needs them for its verdict), but the SCORECARD numbers
 * below come from the FLEET payload instead — that is the one source that also
 * knows offline vs pending vs not-painting, and sourcing both from one payload
 * is what guarantees the district row can never disagree with the school's own
 * Screens page. The readiness copies stay in the type because they are part of
 * the API contract, not because this module displays them.
 */
export interface SchoolReadinessLike {
  tenantId: string;
  name: string;
  slug: string;
  isSelf: boolean;
  verdict: 'READY' | 'NEEDS_ATTENTION' | 'NOT_CONFIGURED';
  contentWired: number;
  contentTotal: number;
  lockdownWired: boolean;
  missingTypes: string[];
  screensTotal: number;
  screensOnline: number;
}

export type SchoolReadinessVerdict = SchoolReadinessLike['verdict'] | 'UNKNOWN';

export interface SchoolScorecard {
  tenantId: string;
  name: string;
  slug: string;
  /** True for the district's own tenant row (the district office). */
  isSelf: boolean;
  screensTotal: number;
  screensOnline: number;
  screensOffline: number;
  /** Reachable but with NO proof of a recent paint — the money signal. */
  notPainting: number;
  readiness: SchoolReadinessVerdict;
  /** Alert types with no content wired; empty when readiness is UNKNOWN. */
  missingTypes: string[];
  lockdownWired: boolean | null;
  pendingApprovals: number;
  /** True when this row has anything at all the admin should look at. */
  needsAttention: boolean;
}

export interface DistrictNeedsAction {
  offlineScreens: number;
  offlineSchools: number;
  notPaintingScreens: number;
  notPaintingSchools: number;
  emergencyNotReadySchools: number;
  /** Subset of the above that cannot run a lockdown at all — the worst case. */
  emergencyNotConfiguredSchools: number;
  pendingApprovals: number;
  pendingApprovalSchools: number;
  /** Every counter above is zero. Only trustworthy alongside `coverage`. */
  allClear: boolean;
}

export interface DistrictRollup {
  schools: SchoolScorecard[];
  needsAction: DistrictNeedsAction;
  /** How many schools have nothing needing attention. */
  healthyCount: number;
  /**
   * Which inputs actually answered. A false flag means that domain's counters
   * are SUPPRESSED (not zero) — the UI must not claim all-clear on it.
   */
  coverage: { readiness: boolean; approvals: boolean };
}

export interface BuildDistrictRollupInput {
  /** Every school the district runs, incl. its own row — from fleet.locations. */
  locations: Array<{ id: string; name: string; slug: string }>;
  /** The district's own tenant id, so its row can be labelled. */
  rootId?: string | null;
  screens: FleetScreenLike[];
  readiness?: { schools: SchoolReadinessLike[] } | null;
  approvals?: { byTenant: Array<{ tenantId: string; pending: number }> } | null;
}

/**
 * Worst-first ordering. A STRICT TUPLE comparator, deliberately not a
 * weighted score: with 40 schools any additive score eventually lets three
 * offline screens outrank a school that literally cannot run a lockdown.
 *
 * Precedence, highest first:
 *   1. Cannot run a lockdown at all (NOT_CONFIGURED).
 *   2. Screens reachable but NOT painting — they look fine on every other
 *      dashboard in the industry, which is exactly why they rank this high.
 *   3. Screens offline.
 *   4. Emergency readiness needs attention (content gaps, partial fleet).
 *   5. Approvals waiting on a human.
 *   6. Name, so the order is stable across polls.
 */
export function compareScorecards(a: SchoolScorecard, b: SchoolScorecard): number {
  const crit = (s: SchoolScorecard) => (s.readiness === 'NOT_CONFIGURED' ? 1 : 0);
  const warn = (s: SchoolScorecard) => (s.readiness === 'NEEDS_ATTENTION' ? 1 : 0);
  return (
    crit(b) - crit(a) ||
    b.notPainting - a.notPainting ||
    b.screensOffline - a.screensOffline ||
    warn(b) - warn(a) ||
    b.pendingApprovals - a.pendingApprovals ||
    a.name.localeCompare(b.name)
  );
}

/**
 * Fold fleet + readiness + approvals into per-school scorecards and the
 * district-level needs-action counters.
 *
 * The school LIST comes from `locations` (every school the district runs,
 * including ones with zero screens — a school with no screens paired is
 * exactly the kind of thing that must not silently vanish from the rollup).
 * Readiness and approvals only annotate that roster — see the roster note
 * below for why they must never add to it.
 */
export function buildDistrictRollup(input: BuildDistrictRollupInput): DistrictRollup {
  const readinessKnown = !!input.readiness && Array.isArray(input.readiness.schools);
  const approvalsKnown = !!input.approvals && Array.isArray(input.approvals.byTenant);

  const readinessById = new Map<string, SchoolReadinessLike>(
    (input.readiness?.schools ?? []).map((s) => [s.tenantId, s]),
  );
  const approvalsById = new Map<string, number>(
    (input.approvals?.byTenant ?? []).map((r) => [r.tenantId, r.pending]),
  );

  // Base roster: the FLEET payload alone decides which locations exist —
  // readiness/approvals ANNOTATE locations, they never create them. This
  // used to union in readiness-only schools "in case the two payloads
  // drift", but both reads share one scope and one source table, so the
  // drift is hypothetical — while the union had a real failure mode
  // (2026-08-31, child-location mode): a cached multi-location readiness
  // payload rendered alongside a single-location fleet painted OTHER
  // locations' rows onto a child's dashboard.
  const roster = new Map<string, { id: string; name: string; slug: string }>();
  for (const loc of input.locations) roster.set(loc.id, loc);

  // Screens, bucketed by owning school in ONE pass.
  type Bucket = { total: number; online: number; offline: number; notPainting: number };
  const byTenant = new Map<string, Bucket>();
  const bucket = (id: string): Bucket => {
    let b = byTenant.get(id);
    if (!b) { b = { total: 0, online: 0, offline: 0, notPainting: 0 }; byTenant.set(id, b); }
    return b;
  };
  for (const s of input.screens) {
    const ownerId = s.sourceTenant?.id;
    if (!ownerId || !roster.has(ownerId)) continue;
    const b = bucket(ownerId);
    b.total += 1;
    if (s.status === 'ONLINE') b.online += 1;
    // PENDING (never paired) is not "offline" — it has never been up. Only a
    // screen that is expected to be live and isn't counts against the school,
    // matching the fleet endpoint's own ONLINE/OFFLINE split.
    else if (s.status === 'OFFLINE') b.offline += 1;
    // Reuse the Screens list's own GRADED precedence rather than the raw
    // variant, so the district number can never disagree with the per-screen
    // chip. (2026-08-30, audit P1-2: this used to call the ungraded
    // deriveRenderTrust with no timestamp/hash context, so the HQ rollup
    // alarmed at 90 s — during every reload/OTA window — and counted idle
    // waiting-screen proofs as painting, while the Screens list right next
    // to it said "checking" / "no content yet". Same inputs, same verdict,
    // one derivation.)
    if (
      deriveRenderTrustGrade({
        status: s.status,
        renderHealth: s.renderHealth,
        renderStale: s.renderStale,
        lastRenderedAtMs: (s as any).lastRenderedAt ? new Date((s as any).lastRenderedAt).getTime() : null,
        lastRenderedHash: (s as any).lastRenderedHash ?? null,
        authState: (s as any).authState ?? null,
      }) === 'not-painting'
    ) {
      b.notPainting += 1;
    }
  }

  const schools: SchoolScorecard[] = Array.from(roster.values()).map((loc) => {
    const b = byTenant.get(loc.id) ?? { total: 0, online: 0, offline: 0, notPainting: 0 };
    const r = readinessById.get(loc.id);
    const pendingApprovals = approvalsById.get(loc.id) ?? 0;
    const readiness: SchoolReadinessVerdict = r ? r.verdict : 'UNKNOWN';
    return {
      tenantId: loc.id,
      name: loc.name,
      slug: loc.slug,
      isSelf: r ? r.isSelf : loc.id === input.rootId,
      screensTotal: b.total,
      screensOnline: b.online,
      screensOffline: b.offline,
      notPainting: b.notPainting,
      readiness,
      missingTypes: r?.missingTypes ?? [],
      lockdownWired: r ? r.lockdownWired : null,
      pendingApprovals,
      needsAttention:
        b.offline > 0 ||
        b.notPainting > 0 ||
        readiness === 'NOT_CONFIGURED' ||
        readiness === 'NEEDS_ATTENTION' ||
        pendingApprovals > 0,
    };
  });

  schools.sort(compareScorecards);

  const needsAction: DistrictNeedsAction = {
    offlineScreens: schools.reduce((n, s) => n + s.screensOffline, 0),
    offlineSchools: schools.filter((s) => s.screensOffline > 0).length,
    notPaintingScreens: schools.reduce((n, s) => n + s.notPainting, 0),
    notPaintingSchools: schools.filter((s) => s.notPainting > 0).length,
    emergencyNotReadySchools: readinessKnown
      ? schools.filter((s) => s.readiness === 'NOT_CONFIGURED' || s.readiness === 'NEEDS_ATTENTION').length
      : 0,
    emergencyNotConfiguredSchools: readinessKnown
      ? schools.filter((s) => s.readiness === 'NOT_CONFIGURED').length
      : 0,
    pendingApprovals: approvalsKnown ? schools.reduce((n, s) => n + s.pendingApprovals, 0) : 0,
    pendingApprovalSchools: approvalsKnown ? schools.filter((s) => s.pendingApprovals > 0).length : 0,
    allClear: false,
  };
  needsAction.allClear =
    needsAction.offlineScreens === 0 &&
    needsAction.notPaintingScreens === 0 &&
    needsAction.emergencyNotReadySchools === 0 &&
    needsAction.pendingApprovals === 0;

  return {
    schools,
    needsAction,
    healthyCount: schools.filter((s) => !s.needsAttention).length,
    coverage: { readiness: readinessKnown, approvals: approvalsKnown },
  };
}

/** Case-insensitive name/slug filter for the search box (>8 schools). */
export function filterScorecards(rows: SchoolScorecard[], query: string): SchoolScorecard[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((r) => r.name.toLowerCase().includes(q) || r.slug.toLowerCase().includes(q));
}
