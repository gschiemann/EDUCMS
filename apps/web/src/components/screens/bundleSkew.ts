/**
 * bundleSkew.ts — is this panel running the page bundle we just deployed?
 * (2026-08-25, "the dashboard lied to me")
 *
 * ── Why this exists ──────────────────────────────────────────────────
 * Player fixes ship in the WEB bundle, and each panel reloads onto a new one
 * on its OWN schedule — the drift detector in `app/player/page.tsx` polls
 * `/api/build-info` every ~5 min, then DEFERS the reload while content plays
 * (up to a ~12 min staleness cap) and skips it entirely during an emergency.
 * For up to ~20 minutes after a deploy, therefore, "the fix is deployed" and
 * "the fix is on that screen" are DIFFERENT facts, and the dashboard showed
 * only the first. A freshly-fixed button looked exactly like a dead one, and
 * the only way to reason about it was to infer panel state from deploy
 * timestamps. That inference is what turned a one-line player bug into an
 * hour of the operator believing his whole fleet was broken.
 *
 * The player now reports its own bundle SHA on the render-proof POST
 * (`Screen.lastBundleSha`, surfaced by `GET /screens`). This module compares
 * it to whatever `/api/build-info` says is deployed RIGHT NOW — the same
 * authority the panel itself compares against, so the chip's verdict and the
 * panel's own reload decision can never disagree.
 *
 * ── Restraint is a feature ───────────────────────────────────────────
 * Hours before this shipped, the render-proof chip next door was graded DOWN
 * for crying wolf (operator: "why do i get these bright ass red alerts all
 * the time now"). A stale bundle is a NORMAL, SELF-HEALING state that every
 * panel passes through after every deploy — it is never an alarm, and the
 * only cases that render anything at all are the ones an operator can act on:
 *
 *   current  → renders NOTHING. The common case; a chip here would be noise
 *              on every row forever.
 *   unknown  → renders NOTHING. No SHA reported (older player build, screen
 *              that just paired, no render-proof yet) or no deployed SHA to
 *              compare against (local dev, self-hosted). Absence of evidence
 *              is not evidence — this is the same never-false-alarm rule
 *              `renderTrust.ts` follows for UNKNOWN.
 *   offline  → renders NOTHING. The OFFLINE/PENDING/REVOKED badge already
 *              owns that row's message, and a panel that isn't running can't
 *              usefully be told to refresh.
 *   stale    → the ONE actionable case: a quiet neutral chip that names the
 *              condition and points at the existing Refresh-web action.
 *
 * Pure function — no React, no network, no wall-clock dependency. Unit-tested
 * without mounting the 3k-line Screens page.
 */

/** Comparison width. Mirrors `/api/build-info` (which slices to 12) and the
 *  player's own `BUNDLE_SHA_LENGTH`. */
export const BUNDLE_SHA_COMPARE_LENGTH = 12;

/**
 * Normalize any build identifier (server or panel-reported) to the single
 * form both sides compare on.
 *
 * Mirrors `app/player/bundleSha.ts::normalizeBundleSha` EXACTLY — including
 * its deliberately permissive charset, which exists because that function
 * also gates the player's bundle-drift auto-reload and a hex-only rule would
 * switch that off for self-hosted builds. If one changes, change both in the
 * same commit: a divergence here would show a healthy panel as permanently
 * "out of date", which is a new version of the lie this feature exists to
 * kill. `app/player/__tests__/bundleSha.test.ts` asserts the two agree on
 * every shape rather than trusting this comment.
 */
export function normalizeSha(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(s)) return null;
  return s.toLowerCase().slice(0, BUNDLE_SHA_COMPARE_LENGTH);
}

export type BundleSkewVariant =
  | 'stale' // panel is on a DIFFERENT bundle than the one deployed now
  | 'current' // panel is on the deployed bundle — render nothing
  | 'unknown' // nothing to compare — render nothing, never an alarm
  | 'offline'; // screen isn't live-online — render nothing

export interface BundleSkewInput {
  /** Live-computed `Screen.status` (ONLINE / OFFLINE / PENDING / REVOKED). */
  status?: string | null;
  /** `Screen.lastBundleSha` as reported by the player's render-proof POST. */
  reportedSha?: string | null;
  /** The SHA `/api/build-info` currently reports as deployed. */
  deployedSha?: string | null;
}

/**
 * Derive the bundle-skew display variant for one screen row.
 *
 * Precedence (mirrors `renderTrust.ts::deriveRenderTrust`):
 *   1. status !== ONLINE  → 'offline'. A screen that isn't running has no
 *      opinion about bundles, and its own badge already owns the row.
 *   2. either SHA missing or unparseable → 'unknown'. NEVER guess: an older
 *      player build that doesn't report, a screen that just paired, or a
 *      deploy with no build-info env var must all stay silent rather than
 *      accuse a healthy panel.
 *   3. SHAs equal → 'current'.
 *   4. SHAs differ → 'stale' — the one actionable state.
 */
export function deriveBundleSkew(input: BundleSkewInput): BundleSkewVariant {
  if (input.status !== 'ONLINE') return 'offline';

  const mine = normalizeSha(input.reportedSha);
  const deployed = normalizeSha(input.deployedSha);
  if (!mine || !deployed) return 'unknown';

  return mine === deployed ? 'current' : 'stale';
}
