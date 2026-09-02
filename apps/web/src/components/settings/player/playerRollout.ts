/**
 * playerRollout.ts — the ONE derivation behind the Player & offline editor.
 *
 * Design source: scratch/design/settings-page/SETTINGS-COMMAND-CENTER-V2-DESIGN-DEV-HANDOFF.md
 * §7.6 (required status model), §11 (status vocabulary), §13.2 (a policy save
 * is not a deployment), §16 (stale/unknown states).
 *
 * ── Why a pure module ────────────────────────────────────────────────
 * Same discipline as `screens/v3/screenOps.ts`: the status pill, the rollout
 * copy, the version-distribution rail module and the index dot are four
 * drawings of ONE derivation, so they can never disagree. Nothing here
 * touches React, the network, i18n or the wall clock — `now` is injected, so
 * every age on a render is measured against one instant and every branch is
 * unit-testable.
 *
 * ── Evidence boundary (CLAUDE.md "Player Reliability" rule 10) ───────
 * Every field below is something a `Screen` row or a tenant policy row
 * actually carries. There is no invented telemetry and no inference:
 *   • A version is EVIDENCE only while the device's own report is fresh.
 *     `Screen.playerVersionAt` is stamped by the poll that reported it, so a
 *     month-old report is "last reported", never "installed".
 *   • A screen that has NEVER reported a version (a browser player has no
 *     APK at all) is `unreported` — counted, never graded, and never allowed
 *     to turn a fleet amber on its own.
 *   • `Screen.lastOtaErrorAt` is the sticky, install-truth failure signal
 *     (schema: it survives every non-ERROR state report until the install
 *     actually lands), so it is the only thing that may say "Failed".
 *   • The headline is derived from FRESH-EVIDENCE screens only. Absence of
 *     evidence reads as Unknown — never as success.
 */

// ═══════════════════════════════════════════════════════════════════
// Inputs — the subset of the live APIs this surface reads
// ═══════════════════════════════════════════════════════════════════

/** One row of `GET /screens` (apps/api/src/screens/screens.controller.ts list()). */
export interface RolloutScreen {
  id: string;
  name?: string | null;
  status?: string | null;
  lastPingAt?: string | null;
  /** `Screen.playerVersion` — the APK the device last reported. */
  playerVersion?: string | null;
  /** `Screen.playerVersionAt` — when that report arrived. Dates the evidence. */
  playerVersionAt?: string | null;
  /**
   * `Screen.lastOtaErrorAt` / `lastOtaErrorMessage` — the STICKY OTA failure.
   * Set only on a real device-reported ERROR and cleared only by a confirmed
   * install (schema comment, OTA-02). A last-writer-wins `lastOtaState` is
   * deliberately NOT read here: the player reports CHECKING at the head of
   * every cycle, which would erase a genuine failure.
   */
  lastOtaErrorAt?: string | null;
  lastOtaErrorMessage?: string | null;
  /** `Screen.forceApkUpdatePendingAt` — an operator push armed for this screen. */
  forceApkUpdatePendingAt?: string | null;
}

/** `GET /player/latest-version` — the newest published release, or unknown. */
export interface LatestRelease {
  versionName?: string | null;
  versionCode?: number | null;
  source?: string | null;
  managerVersionName?: string | null;
}

/** `GET /tenants/me/canary-rollout`. */
export interface CanaryConfig {
  percent: number;
  setAt: string | null;
  autoPromote: boolean;
  soakHours: number;
}

/** `GET /tenants/me/ota-window`. */
export interface OtaWindow {
  start: string | null;
  end: string | null;
  timezone: string | null;
}

export interface PlayerRolloutInput {
  /** Single instant every age on this render is measured against. */
  now: number;
  screens: readonly RolloutScreen[] | null | undefined;
  /** `undefined` = not loaded / not permitted. Never treated as "no update". */
  latest: LatestRelease | null | undefined;
  autoUpdateEnabled: boolean | null | undefined;
  canary: CanaryConfig | null | undefined;
  window: OtaWindow | null | undefined;
}

// ═══════════════════════════════════════════════════════════════════
// Status model (§7.6) — worst-first
// ═══════════════════════════════════════════════════════════════════

export type PlayerRolloutState =
  | 'failed'
  | 'paused'
  | 'unknown-stale'
  | 'canary-in-progress'
  | 'rollout-scheduled'
  | 'partially-deployed'
  | 'update-available'
  | 'current';

/** Per-screen grade. Exported so the affected-screens list uses the same call. */
export type ScreenRolloutGrade =
  | 'failed'
  | 'behind'
  | 'on-latest'
  | 'ungradeable' // fresh version report, but no authoritative latest to compare it to
  | 'stale' // reported a version once, but not recently enough to be evidence
  | 'unreported'; // never reported an APK version (a browser player has none)

export interface VersionBucket {
  /** `null` = the screen has never reported a version. */
  version: string | null;
  count: number;
  /** How many of `count` are older than the evidence window. */
  stale: number;
}

export interface PlayerRolloutCounts {
  total: number;
  /** Screens whose version report is inside the evidence window. */
  reported: number;
  stale: number;
  unreported: number;
  onLatest: number;
  behind: number;
  failed: number;
  /** Screens with an operator push armed inside the server's 30-min gate. */
  pushArmed: number;
}

export interface PlayerRolloutResult {
  state: PlayerRolloutState;
  /** §11 pill tone for `<StatusPill kind=…>`. Text always accompanies it. */
  pill: 'ready' | 'attention' | 'degraded' | 'blocked' | 'unknown' | 'notConfigured';
  /** Index dot (`setSectionStatus`). */
  sectionStatus: 'attention' | 'error' | null;
  counts: PlayerRolloutCounts;
  /** Every reported version, most-installed first; the `null` bucket last. */
  distribution: VersionBucket[];
  grades: Record<string, ScreenRolloutGrade>;
  /** The version we are rolling TOWARD, or null when the API could not say. */
  targetVersion: string | null;
  /** True only when a published version is known. */
  latestKnown: boolean;
  /** 0 < percent < 100 — a staged cohort is live. */
  canaryActive: boolean;
  /** ms of soak left, or null when no soak is running / no `setAt`. */
  soakRemainingMs: number | null;
  windowConfigured: boolean;
  /** Screens the operator would want to open, worst-first. */
  attentionScreenIds: string[];
}

/**
 * A version report older than this is no longer evidence of what is installed.
 * The player reports its version on boot and on every 6-hour OTA check
 * (schema: `playerVersionAt` = "last poll that reported it"), so 24h is four
 * missed cycles — long past "the device is telling us".
 */
export const VERSION_EVIDENCE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * The server's per-screen push gate: `forceApkUpdatePendingAt` only unlocks
 * the latest APK for 30 minutes (schema comment on the column). After that the
 * field is history, so we stop calling it an armed push.
 */
export const PUSH_ARMED_WINDOW_MS = 30 * 60 * 1000;

/**
 * Is an installed APK at or past the latest published one?
 *
 * `null` = UNKNOWN whenever either side is missing — a device that never
 * reported, and an API that could not name a latest version, must both read as
 * "we do not know", never as "up to date" and never as "stale".
 *
 * Mirrors `components/screens/ScreenSettingsMenu.tsx :: compareInstalledVersion`
 * byte-for-byte in behaviour (see this module's test, which re-runs that
 * function's own cases). It is duplicated rather than imported because this
 * module must stay pure — the original lives inside a large client component.
 * If it is ever hoisted into a shared lib, delete this copy and import it.
 */
export function compareInstalledVersion(
  installed: string | null | undefined,
  latest: string | null | undefined,
): boolean | null {
  if (!installed || !latest) return null;
  const norm = (v: string) => v.trim().replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  const a = norm(installed);
  const b = norm(latest);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x < y) return false;
    if (x > y) return true;
  }
  return true;
}

function ageMs(iso: string | null | undefined, now: number): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return now - t;
}

/**
 * Grade one screen. Order matters: a sticky install ERROR outranks everything
 * except the absence of a version report, because a device that told us the
 * install failed is stronger evidence than a version string.
 */
export function gradeScreen(
  screen: RolloutScreen,
  latestVersion: string | null,
  now: number,
): ScreenRolloutGrade {
  const reportAge = ageMs(screen.playerVersionAt ?? null, now);
  const hasVersion = !!screen.playerVersion;
  // Fresh when the report itself is dated inside the window. A version with no
  // date at all is not datable evidence — it reads stale, never fresh.
  const fresh = hasVersion && reportAge !== null && reportAge <= VERSION_EVIDENCE_MAX_AGE_MS;
  const onLatest = compareInstalledVersion(screen.playerVersion, latestVersion);

  if (screen.lastOtaErrorAt && onLatest !== true) return 'failed';
  if (!hasVersion) return 'unreported';
  if (!fresh) return 'stale';
  if (onLatest === null) return 'ungradeable';
  return onLatest ? 'on-latest' : 'behind';
}

/**
 * Collapse fleet telemetry + tenant policy into the ONE state §7.6 requires.
 *
 * Precedence (worst-first), and the evidence each branch stands on:
 *   failed             ≥1 screen carries a sticky `lastOtaErrorAt` and is not
 *                      proven to be on the latest version.
 *   paused             canary percent === 0 — nobody is eligible, by policy.
 *   unknown-stale      no authoritative latest version, or NO screen has a
 *                      fresh version report. We cannot grade anything.
 *   current            every fresh-evidence screen is at or past the latest.
 *   canary-in-progress 0 < percent < 100 while screens are still behind.
 *   rollout-scheduled  screens are behind, delivery is armed (auto-update on,
 *                      or a push armed inside its 30-min gate) AND a
 *                      maintenance window defers the install.
 *   partially-deployed screens are behind and some are already on the latest.
 *   update-available   screens are behind and none are on the latest yet.
 *
 * Stale / unreported screens NEVER produce a green headline on their own and
 * never mask one either: they are counted, surfaced, and (for `stale`) raise
 * the index dot to `attention`.
 */
export function derivePlayerRolloutState(input: PlayerRolloutInput): PlayerRolloutResult {
  const { now } = input;
  const screens = input.screens ?? [];
  const targetVersion = input.latest?.versionName ?? null;
  const latestKnown = !!targetVersion;
  const canary = input.canary ?? null;
  const percent = canary?.percent ?? 100;
  const canaryActive = percent > 0 && percent < 100;
  const windowConfigured = !!(input.window?.start && input.window?.end && input.window?.timezone);

  const counts: PlayerRolloutCounts = {
    total: screens.length,
    reported: 0,
    stale: 0,
    unreported: 0,
    onLatest: 0,
    behind: 0,
    failed: 0,
    pushArmed: 0,
  };
  const grades: Record<string, ScreenRolloutGrade> = {};
  const bucketMap = new Map<string | null, VersionBucket>();
  const attention: Array<{ id: string; rank: number }> = [];

  for (const s of screens) {
    const grade = gradeScreen(s, targetVersion, now);
    grades[s.id] = grade;
    if (grade === 'failed') counts.failed += 1;
    if (grade === 'behind') counts.behind += 1;
    if (grade === 'on-latest') counts.onLatest += 1;
    if (grade === 'stale') counts.stale += 1;
    if (grade === 'unreported') counts.unreported += 1;
    if (grade === 'behind' || grade === 'on-latest' || grade === 'ungradeable') counts.reported += 1;

    const pushAge = ageMs(s.forceApkUpdatePendingAt ?? null, now);
    if (pushAge !== null && pushAge >= 0 && pushAge <= PUSH_ARMED_WINDOW_MS) counts.pushArmed += 1;

    const key = s.playerVersion ?? null;
    const bucket = bucketMap.get(key) ?? { version: key, count: 0, stale: 0 };
    bucket.count += 1;
    if (grade === 'stale') bucket.stale += 1;
    bucketMap.set(key, bucket);

    const rank = grade === 'failed' ? 0 : grade === 'stale' ? 1 : grade === 'behind' ? 2 : -1;
    if (rank >= 0) attention.push({ id: s.id, rank });
  }

  // A failed screen may itself be behind; `failed` is counted separately above
  // and deliberately NOT double-counted into `behind` (gradeScreen returns one
  // grade), so `behind` always means "no failure reported, just older".
  const distribution = [...bucketMap.values()].sort((a, b) => {
    if (a.version === null) return 1;
    if (b.version === null) return -1;
    if (b.count !== a.count) return b.count - a.count;
    return (b.version ?? '').localeCompare(a.version ?? '');
  });

  let state: PlayerRolloutState;
  if (counts.failed > 0) state = 'failed';
  else if (canary && percent === 0) state = 'paused';
  else if (!latestKnown || counts.reported === 0) state = 'unknown-stale';
  else if (counts.behind === 0) state = 'current';
  else if (canaryActive) state = 'canary-in-progress';
  else if (windowConfigured && (!!input.autoUpdateEnabled || counts.pushArmed > 0)) state = 'rollout-scheduled';
  else if (counts.onLatest > 0) state = 'partially-deployed';
  else state = 'update-available';

  const pill: PlayerRolloutResult['pill'] =
    state === 'failed'
      ? 'blocked'
      : state === 'unknown-stale'
        ? 'unknown'
        : state === 'paused' || state === 'partially-deployed'
          ? 'attention'
          : state === 'canary-in-progress' || state === 'rollout-scheduled' || state === 'update-available'
            ? 'notConfigured'
            : 'ready';

  const sectionStatus: PlayerRolloutResult['sectionStatus'] =
    state === 'failed'
      ? 'error'
      : state === 'paused' || state === 'partially-deployed' || state === 'unknown-stale' || counts.stale > 0
        ? 'attention'
        : null;

  const setAtAge = ageMs(canary?.setAt ?? null, now);
  const soakRemainingMs =
    canaryActive && canary && setAtAge !== null
      ? Math.max(0, canary.soakHours * 3_600_000 - setAtAge)
      : null;

  return {
    state,
    pill,
    sectionStatus,
    counts,
    distribution,
    grades,
    targetVersion,
    latestKnown,
    canaryActive,
    soakRemainingMs,
    windowConfigured,
    attentionScreenIds: attention.sort((a, b) => a.rank - b.rank).map((a) => a.id),
  };
}

/**
 * "Rollout verified on N/M screens" (§7.6) — the ONLY number allowed to speak
 * for deployment. `verified` counts screens whose OWN fresh report says they
 * are at or past the target; `of` counts the screens that reported at all.
 * Never derived from a policy response.
 */
export function rolloutVerification(result: PlayerRolloutResult): { verified: number; of: number } | null {
  if (!result.latestKnown || result.counts.reported === 0) return null;
  return { verified: result.counts.onLatest, of: result.counts.reported };
}
