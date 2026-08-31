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
  /** Offline emergency tier as the screen last reported it (never-evict). */
  lastCacheReport?: { emergency?: { count?: number } } | null;
  /** Last heartbeat — the only thing that can date an offline screen. */
  lastPingAt?: string | null;
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
  /**
   * The ONE screen this row is about (screen-level kinds). Absent on a
   * location-level row and on a "+N more" aggregate — which is exactly what
   * gates the per-screen recovery button: a control that claims to fix "3
   * screens at Peak West" would be a lie, so the aggregate never gets one.
   */
  screenId?: string;
  /**
   * Compact age of the problem ("18m"), rendered as the accent in the
   * headline. ABSENT whenever we cannot date it — an undated row says
   * nothing rather than guessing, and a future-dated stamp (clock skew on a
   * signage box) is treated as no evidence, never as a negative age.
   */
  age?: string;
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
   * Screens holding emergency content locally — measured over ALL the
   * location's screens, not just the online ones, because the whole point of
   * the never-evict tier is that it survives the network going away. A screen
   * that has never reported a cache report counts as NOT cached (absence is
   * "no data", never a claim it is ready).
   */
  emergencyCached: number;
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

/**
 * Screens named individually per (kind, location) before the rest collapse
 * into one "+N more at X" row. Three is the mock's row count and the point
 * where a per-screen list stops being a to-do and starts being a wall.
 */
const ROWS_PER_KIND_PER_LOCATION = 3;

/**
 * Compact age ("42s" / "18m" / "3h" / "2d"), or undefined when there is no
 * evidence to date. A FUTURE timestamp returns undefined on purpose: signage
 * boxes run minutes of clock skew, and "-4m behind" is worse than silence.
 */
function ageLabel(atMs: number | null | undefined, now: number): string | undefined {
  if (atMs == null || !Number.isFinite(atMs)) return undefined;
  const sec = Math.floor((now - atMs) / 1000);
  if (sec < 0) return undefined;
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  return `${Math.floor(hr / 24)}d`;
}

/** The same age spelled out for a sentence ("18 minutes"). */
function ageWords(atMs: number | null | undefined, now: number): string | undefined {
  if (atMs == null || !Number.isFinite(atMs)) return undefined;
  const sec = Math.floor((now - atMs) / 1000);
  if (sec < 0) return undefined;
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;
  if (sec < 60) return plural(sec, 'second');
  const min = Math.floor(sec / 60);
  if (min < 60) return plural(min, 'minute');
  const hr = Math.floor(min / 60);
  if (hr < 24) return plural(hr, 'hour');
  return plural(Math.floor(hr / 24), 'day');
}

/** Parsed heartbeat, or null — an unparseable stamp is no evidence. */
function pingMs(s: Pick<FleetCommandScreen, 'lastPingAt'>): number | null {
  if (!s.lastPingAt) return null;
  const t = Date.parse(s.lastPingAt);
  return Number.isFinite(t) ? t : null;
}

/**
 * Render grade, called with the SAME context the district rollup uses so the
 * per-screen rows can never name a screen the rollup's own counter doesn't
 * count. (The extra fields are absent from FleetCommandScreen's declared
 * shape but present on real fleet rows; absent reads as null, which is the
 * pre-existing behavior.)
 */
function gradeOf(s: FleetCommandScreen) {
  return deriveRenderTrustGrade({
    status: s.status,
    renderHealth: s.renderHealth ?? null,
    renderStale: s.renderStale ?? null,
    lastRenderedAtMs: (s as any).lastRenderedAt ? new Date((s as any).lastRenderedAt).getTime() : null,
    lastRenderedHash: (s as any).lastRenderedHash ?? null,
    authState: (s as any).authState ?? null,
  });
}

/** Screen display name, never blank — an unnamed row is unactionable. */
function screenName(s: FleetCommandScreen): string {
  return s.name?.trim() || 'Unnamed screen';
}

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

/**
 * Does this screen hold emergency content locally? Fails closed: a missing
 * report, a missing `emergency` block, or a zero count all read as NOT cached.
 * Never infer readiness from silence.
 */
function hasEmergencyCache(s: Pick<FleetCommandScreen, 'lastCacheReport'>): boolean {
  const count = s.lastCacheReport?.emergency?.count;
  return typeof count === 'number' && count > 0;
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
  /**
   * The ONE clock read this module makes, injected so it stays testable and
   * so every age on a single render is measured against the same instant.
   * Only the inbox's age labels depend on it — every assurance count, the
   * convergence summary and the location table are clock-free.
   */
  now?: number;
}): FleetCommand {
  const { screens, deployedSha } = input;
  const now = input.now ?? Date.now();
  const rollup = buildDistrictRollup(input.rollupInput);

  const online = screens.filter((s) => s.status === 'ONLINE');
  const offline = screens.filter((s) => s.status === 'OFFLINE');

  // ── per-screen truths ────────────────────────────────────────────
  const behind = online.filter((s) => isContentBehind(s, deployedSha));
  const gradeable = online.filter((s) => isContentGradeable(s, deployedSha));
  const pushStale = online.filter((s) => s.pushChannel === 'stale');
  const painting = online.filter((s) => gradeOf(s) === 'painting');
  // The SCREENS behind the rollup's not-painting counter — same grade call,
  // so a named row and the counter can never disagree.
  const notPaintingScreens = screens.filter((s) => gradeOf(s) === 'not-painting');
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
  // Emergency cache is counted over EVERY screen (see LocationRow) — an
  // offline screen with the alert media already stored is the case this
  // column exists to prove.
  const cachedByTenant = new Map<string, number>();
  for (const s of screens) {
    const t = s.sourceTenant?.id;
    if (t && hasEmergencyCache(s)) cachedByTenant.set(t, (cachedByTenant.get(t) ?? 0) + 1);
  }
  const locations: LocationRow[] = rollup.schools
    .map((sc) => ({
      ...sc,
      contentBehind: behindByTenant.get(sc.tenantId) ?? 0,
      pushStale: pushStaleByTenant.get(sc.tenantId) ?? 0,
      emergencyCached: cachedByTenant.get(sc.tenantId) ?? 0,
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
  // content-behind > push-stale > approvals.
  //
  // GRANULARITY (2026-08-31, design-mock parity): the four SCREEN-level kinds
  // emit ONE ROW PER SCREEN — the mock's "G43 · Behind on content · 18m", not
  // "Peak West · 3 screens behind". A row that names a screen can carry a
  // recovery button for that screen; a row that counts screens cannot, which
  // is why the aggregate tail row deliberately has no screenId. The three
  // LOCATION-level kinds (emergency, approvals, setup) stay one row per
  // location: they are properties of the location, not of any screen.
  const inbox: ExceptionRow[] = [];

  /** Screens of one kind, bucketed by owning location. */
  const bucketByTenant = (rows: FleetCommandScreen[]) => {
    const m = new Map<string, FleetCommandScreen[]>();
    for (const s of rows) {
      const t = s.sourceTenant?.id;
      if (!t) continue; // an unowned screen has no location to switch into
      const bucket = m.get(t);
      if (bucket) bucket.push(s);
      else m.set(t, [s]);
    }
    return m;
  };

  /**
   * Emit up to ROWS_PER_KIND_PER_LOCATION named rows for one kind, walking
   * locations in the already worst-first order, then one "+N more at X" row
   * per location that overflowed.
   *
   * `since` dates the problem: it drives both the age label and the row order
   * (OLDEST first, undated last), so the longest-running failure is the one
   * that survives the cap. Deterministic on ties via screen id — two screens
   * that broke in the same second must not swap places between renders.
   */
  const emitPerScreen = (
    kind: ExceptionRow['kind'],
    rows: FleetCommandScreen[],
    since: (s: FleetCommandScreen) => number | null,
    line: (s: FleetCommandScreen, age: string | undefined, words: string | undefined) =>
      { headline: string; detail: string },
    aggregateDetail: string,
  ) => {
    const byTenant = bucketByTenant(rows);
    for (const sc of locations) {
      const mine = byTenant.get(sc.tenantId);
      if (!mine?.length) continue;
      const built = mine
        .map((s) => {
          const at = since(s);
          const age = ageLabel(at, now);
          // A future stamp yields no age; it must also not sort as "newest".
          return { s, at: age === undefined ? null : at, age, ...line(s, age, ageWords(at, now)) };
        })
        .sort((a, b) =>
          (a.at == null ? 1 : 0) - (b.at == null ? 1 : 0) ||
          (a.at ?? 0) - (b.at ?? 0) ||
          a.s.id.localeCompare(b.s.id),
        );
      for (const b of built.slice(0, ROWS_PER_KIND_PER_LOCATION)) {
        inbox.push({
          kind, tenantId: sc.tenantId, tenantName: sc.name, slug: sc.slug,
          headline: b.headline, detail: b.detail, age: b.age,
          path: 'screens', count: 1, screenId: b.s.id,
        });
      }
      const extra = built.length - ROWS_PER_KIND_PER_LOCATION;
      if (extra > 0) {
        inbox.push({
          kind, tenantId: sc.tenantId, tenantName: sc.name, slug: sc.slug,
          headline: `+${extra} more at ${sc.name}`,
          detail: aggregateDetail,
          path: 'screens', count: extra,
        });
      }
    }
  };

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
  // No picture confirmed. Nothing dates it — the render-proof age is not on
  // the fleet row — so these rows carry no age rather than a guessed one.
  emitPerScreen(
    'not-painting',
    notPaintingScreens,
    () => null,
    (s) => ({
      headline: `${screenName(s)} · No picture confirmed`,
      detail: 'Connected and answering, but no confirmed picture for 5+ minutes.',
    }),
    'Also showing no confirmed picture.',
  );
  // Offline — the last heartbeat is the age, when there is one.
  emitPerScreen(
    'offline',
    offline,
    (s) => pingMs(s),
    (s, _age, words) => ({
      headline: `${screenName(s)} · Offline`,
      detail: words ? `Last seen ${words} ago.` : 'Not answering heartbeats.',
    }),
    'Also offline.',
  );
  // Behind on content — dated from the outstanding push this screen has not
  // confirmed. A bundle-skew screen with no pending push simply has no age.
  emitPerScreen(
    'content-behind',
    behind,
    (s) => (s.pendingRefreshAtMs != null && s.refreshAckMs !== s.pendingRefreshAtMs ? s.pendingRefreshAtMs : null),
    (s, _age, words) => ({
      headline: `${screenName(s)} · Behind on content`,
      detail: words
        ? `Content update published ${words} ago.`
        : 'An update is published but not confirmed on this screen yet.',
    }),
    'Also behind on content.',
  );
  // On the polling backstop. Not a failure — content still arrives — so the
  // wording stays calm and it ranks below everything above it.
  emitPerScreen(
    'push-stale',
    pushStale,
    () => null,
    (s) => ({
      headline: `${screenName(s)} · On slow updates`,
      detail: 'No instant connection — content still arrives via ~10s check-ins.',
    }),
    'Also on slow updates.',
  );
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
