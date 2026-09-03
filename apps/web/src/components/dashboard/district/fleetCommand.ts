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
  /** Last render proof, as the API sends it. `deriveRenderTrustGrade` reads
   *  the hash's `idle:` prefix to tell "nothing scheduled" from "should be
   *  painting and isn't"; before 2026-09-03 the row carried neither and
   *  `gradeOf`'s `as any` reads were always undefined, so every idle screen
   *  graded `not-painting` and opened an incident. */
  lastRenderedAt?: string | null;
  lastRenderedHash?: string | null;
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
   * That screen's display name, carried alongside the id so a surface that
   * lays the row out as LOCATION-then-screen (the Network Atlas inbox) never
   * has to re-parse it back out of `headline`.
   */
  screenName?: string;
  /** True on a "+N more at X" row — it names a count, never one screen. */
  aggregate?: boolean;
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
  /**
   * The SAME rows, uncapped, in the same worst-first order. The dashboard
   * card shows the top six; the Network Atlas groups the whole list by
   * category with real per-category counts, and a category whose rows were
   * silently truncated to six would report a lie in its own header.
   */
  inboxAll: ExceptionRow[];
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
    lastRenderedAtMs: s.lastRenderedAt ? new Date(s.lastRenderedAt).getTime() : null,
    lastRenderedHash: s.lastRenderedHash ?? null,
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
          path: 'screens', count: 1, screenId: b.s.id, screenName: screenName(b.s),
        });
      }
      const extra = built.length - ROWS_PER_KIND_PER_LOCATION;
      if (extra > 0) {
        inbox.push({
          kind, tenantId: sc.tenantId, tenantName: sc.name, slug: sc.slug,
          headline: `+${extra} more at ${sc.name}`,
          detail: aggregateDetail,
          path: 'screens', count: extra, aggregate: true,
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
      detail: 'Answering, but no confirmed picture for 5+ minutes.',
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
      detail: 'No instant connection — updates arrive every ~10s.',
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
    inboxAll: inbox,
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

// ═══════════════════════════════════════════════════════════════════
// Network Atlas derivation (design source:
// scratch/design/multi-location-dashboard/network-atlas-v1.png)
//
// Everything below is PURE and unit-tested. The Atlas component stays
// presentational: it never counts, never grades and never re-words — so the
// map, the grouped inbox and the selected-location panel are three drawings
// of ONE derivation and can never disagree with each other or with the
// table.
// ═══════════════════════════════════════════════════════════════════

/**
 * Category headings, in STANDARD-USER language.
 *
 * The mock's own heading for the render-proof bucket is engineer vocabulary
 * ("Not painting") — this product does not put the wire word in front of an
 * operator, so it reads "No picture confirmed" instead. Every other heading
 * is the mock's, verbatim.
 */
export const INBOX_GROUP_LABEL: Record<ExceptionRow['kind'], string> = {
  emergency: 'Emergency gaps',
  'not-painting': 'No picture confirmed',
  offline: 'Offline',
  'content-behind': 'Behind on content',
  'push-stale': 'Push disconnected',
  approvals: 'Waiting on review',
  setup: 'Needs setup',
};

/** The dot beside a category heading — semantic severity, never brand. */
export const INBOX_GROUP_TONE: Record<ExceptionRow['kind'], 'bad' | 'warn' | 'muted'> = {
  emergency: 'bad',
  'not-painting': 'bad',
  offline: 'warn',
  'content-behind': 'warn',
  'push-stale': 'warn',
  approvals: 'muted',
  setup: 'muted',
};

/**
 * The one-phrase restatement of a row's kind, for a layout that puts the
 * LOCATION on the bold line and the screen underneath ("G43 · 18m behind" in
 * the mock). The headline already carries the same fact in sentence form;
 * this is the compact twin, so both surfaces stay one vocabulary.
 */
const INBOX_SHORT_DETAIL: Record<ExceptionRow['kind'], string> = {
  emergency: 'No alert content wired',
  'not-painting': 'No picture confirmed',
  offline: 'Offline',
  'content-behind': 'Behind on content',
  'push-stale': 'Push disconnected',
  approvals: 'Waiting on review',
  setup: 'No screens set up yet',
};

/** Worst-first, matching the order `buildFleetCommand` emits rows in. */
const INBOX_GROUP_ORDER: ExceptionRow['kind'][] = [
  'emergency', 'not-painting', 'offline', 'content-behind', 'push-stale', 'approvals', 'setup',
];

export interface InboxGroup {
  kind: ExceptionRow['kind'];
  label: string;
  tone: 'bad' | 'warn' | 'muted';
  /** Rows to draw — capped for layout. */
  rows: ExceptionRow[];
  /** The TRUE row count, which is what the header badge reports. */
  count: number;
  /** count − rows.length: how many this group is not drawing. */
  hidden: number;
}

/**
 * Bucket the inbox by category, worst-first, preserving the within-category
 * order the derivation already ranked (oldest problem first).
 *
 * `perGroupCap` bounds how many rows a single category DRAWS; `count` always
 * reports the real total, so a capped group can say "+2 more" instead of
 * quietly under-reporting itself.
 */
export function groupInbox(rows: ExceptionRow[], perGroupCap = 6): InboxGroup[] {
  const byKind = new Map<ExceptionRow['kind'], ExceptionRow[]>();
  for (const r of rows) {
    const bucket = byKind.get(r.kind);
    if (bucket) bucket.push(r);
    else byKind.set(r.kind, [r]);
  }
  const groups: InboxGroup[] = [];
  for (const kind of INBOX_GROUP_ORDER) {
    const mine = byKind.get(kind);
    if (!mine?.length) continue;
    groups.push({
      kind,
      label: INBOX_GROUP_LABEL[kind],
      tone: INBOX_GROUP_TONE[kind],
      rows: mine.slice(0, perGroupCap),
      count: mine.length,
      hidden: Math.max(0, mine.length - perGroupCap),
    });
  }
  return groups;
}

/**
 * The two lines the Atlas inbox draws for one row: the LOCATION on top (that
 * is what a map reader is looking for) and the screen + its one-phrase
 * problem underneath. An aggregate row has no screen to name, so it leads
 * with its own "+N more" headline instead.
 */
export function atlasRowLines(row: ExceptionRow): { title: string; sub: string; age?: string } {
  if (row.aggregate) return { title: row.headline, sub: row.detail, age: row.age };
  if (row.screenName) {
    return { title: row.tenantName, sub: `${row.screenName} · ${INBOX_SHORT_DETAIL[row.kind]}`, age: row.age };
  }
  return { title: row.tenantName, sub: row.detail, age: row.age };
}

/** One arc of a pin's ring — the location's screen mix, drawn as a donut. */
export interface DonutSegment {
  tone: 'ok' | 'warn' | 'bad';
  count: number;
}

/**
 * The pin ring's segments: how this location's screens actually split.
 *
 *   bad  — answering with no confirmed picture (the money signal)
 *   warn — offline, behind on the published content, or on the ~10s polling
 *          backstop. The backstop belongs here so a location whose RING tone
 *          is amber for that reason alone still draws an amber arc: a pin
 *          that graded warn but rendered all-green would be the map
 *          contradicting itself.
 *   ok   — everything left over
 *
 * The two problem buckets are CLAMPED to the screen total rather than summed
 * blindly: a screen can be both behind on content and showing no picture, and
 * a ring whose arcs added up to more than the fleet would be a drawing, not a
 * count. A location with no screens returns no segments at all — there is no
 * mix to draw, and a full grey ring would read as "all fine".
 */
export function donutSegments(row: LocationRow): DonutSegment[] {
  const total = Math.max(0, row.screensTotal);
  if (total === 0) return [];
  const bad = Math.min(total, Math.max(0, row.notPainting));
  const warn = Math.min(
    total - bad,
    Math.max(0, row.screensOffline) + Math.max(0, row.contentBehind) + Math.max(0, row.pushStale),
  );
  const ok = Math.max(0, total - bad - warn);
  return [
    { tone: 'ok' as const, count: ok },
    { tone: 'warn' as const, count: warn },
    { tone: 'bad' as const, count: bad },
  ].filter((s) => s.count > 0);
}

export interface LocationPanelStats {
  screensTotal: number;
  screensOnline: number;
  screensOffline: number;
  /** Online and confirmed on the published content. */
  screensCurrent: number;
  screensBehind: number;
  /** Live channel vs the ~10s polling backstop vs nothing to grade. */
  push: 'live' | 'slow' | 'unknown';
  emergencyCached: number;
  readiness: LocationRow['readiness'];
  statusLabel: string;
  statusTone: 'ok' | 'warn' | 'bad';
}

/** Ring/label vocabulary — the map's own three words, in one place. */
export const LOCATION_STATUS_LABEL: Record<'ok' | 'warn' | 'bad', string> = {
  ok: 'Healthy',
  warn: 'Needs a look',
  bad: 'Needs attention',
};

/**
 * THE FIVE ASSURANCE LABELS, in one place, because two surfaces draw them.
 *
 * Every one of these words was chosen to be exactly as strong as the evidence
 * behind it, and three of them were WEAKENED on 2026-09-01 after the truth
 * audit found them overclaiming: "Content current" became `App current`
 * (the comparison is a build SHA, not a content revision) and "Emergency
 * ready" became `Emergency setup ready` (the district check verifies wiring
 * and connectivity, not that alert media is cached on each device).
 *
 * A phone that re-typed these labels locally would be one careless edit away
 * from re-making the claim the audit just retracted — on the surface nobody
 * re-reads. So the label lives here and both surfaces import it. Changing a
 * claim now means changing it everywhere, which is the point.
 */
export const ASSURANCE_LABEL: Record<keyof FleetCommand['assurance'], string> = {
  contentCurrent: 'App current',
  online: 'Devices online',
  pushLive: 'Push live',
  emergencyReady: 'Emergency setup ready',
  showingContent: 'Showing content',
};

const WORST_TONE_CLS: Record<'muted' | 'warn' | 'bad', string> = {
  muted: 'text-slate-400',
  warn: 'text-amber-600',
  bad: 'text-rose-600',
};

/**
 * The single worst thing true about a location, worst-first — null when the
 * location is calm.
 *
 * Shared by the desktop table row, the map's selected-location card, the
 * atlas pin ring AND the phone's location list, so those surfaces can never
 * word (or color) the same location differently. It lived inside
 * FleetCommandCenter.tsx until 2026-09-01, when the phone build copied it and
 * the copy immediately drifted: the duplicate graded a location with no
 * screens `warn`, which is amber on a phone and gray on a laptop for the same
 * venue on the same fleet. Moved here rather than re-copied.
 */
export function worstLine(
  row: LocationRow,
): { text: string; cls: string; tone: 'muted' | 'warn' | 'bad' } | null {
  const line = (tone: 'muted' | 'warn' | 'bad', text: string) => ({ text, tone, cls: WORST_TONE_CLS[tone] });
  if (!row.hasScreens) return line('muted', 'No screens set up yet');
  if (row.readiness === 'NOT_CONFIGURED') return line('bad', 'Can’t display an emergency alert');
  if (row.notPainting > 0) return line('bad', `${row.notPainting} no picture confirmed`);
  if (row.screensOffline > 0) return line('warn', `${row.screensOffline} offline`);
  if (row.contentBehind > 0) return line('warn', `${row.contentBehind} behind on content`);
  return null;
}

/**
 * A location's ring color — the SAME precedence the table prints, plus the one
 * state the worst-line deliberately doesn't spend a whole row on (screens on
 * the ~10s polling backstop), which the table's own Push column grades amber.
 */
export function locationTone(row: LocationRow): 'ok' | 'warn' | 'bad' {
  const worst = worstLine(row);
  if (worst?.tone === 'bad') return 'bad';
  if (worst?.tone === 'warn') return 'warn';
  if (row.pushStale > 0) return 'warn';
  return 'ok';
}

/** Where a click on this location lands — keyed off the SAME precedence. */
export function worstPath(row: LocationRow): string {
  if (!row.hasScreens) return 'screens';
  if (row.readiness === 'NOT_CONFIGURED') return 'settings/emergency';
  return worstLine(row) ? 'screens' : 'dashboard';
}

/**
 * Every number the selected-location panel prints, off the SAME LocationRow
 * the table and the pin ring read. `tone` is injected rather than re-derived
 * so the panel's status line can never disagree with the ring beside it.
 */
export function buildLocationPanel(row: LocationRow, tone: 'ok' | 'warn' | 'bad'): LocationPanelStats {
  const behind = Math.min(row.screensOnline, Math.max(0, row.contentBehind));
  return {
    screensTotal: row.screensTotal,
    screensOnline: row.screensOnline,
    screensOffline: row.screensOffline,
    screensCurrent: Math.max(0, row.screensOnline - behind),
    screensBehind: behind,
    push: !row.hasScreens || row.screensOnline === 0 ? 'unknown' : row.pushStale > 0 ? 'slow' : 'live',
    emergencyCached: row.emergencyCached,
    readiness: row.readiness,
    statusLabel: LOCATION_STATUS_LABEL[tone],
    statusTone: tone,
  };
}

/**
 * "Sacramento, CA" out of a formatted address, or null.
 *
 * BEST-EFFORT BY DESIGN: it returns a city line only when the address really
 * looks like it ends with one — `…, <City>, <ST> <zip>` or `…, <City>, <ST>`.
 * Anything else (a bare street line, an international format, a typed
 * free-text address) returns null and the panel simply omits the line rather
 * than printing a guess under the location's name.
 */
export function parseCityState(address: string | null | undefined): string | null {
  if (!address) return null;
  const parts = address
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
    .filter((p) => !/^(usa|u\.s\.a\.|united states)\.?$/i.test(p));
  if (parts.length < 2) return null;
  const tail = parts[parts.length - 1];
  // "CA" or "CA 95814" — a two-letter state, optionally with a ZIP.
  const m = tail.match(/^([A-Za-z]{2})(?:\s+\d{5}(?:-\d{4})?)?$/);
  if (!m) return null;
  const city = parts[parts.length - 2];
  // A street line ("1200 K St") is not a city; require a non-numeric start.
  if (!city || /^\d/.test(city)) return null;
  return `${city}, ${m[1].toUpperCase()}`;
}
