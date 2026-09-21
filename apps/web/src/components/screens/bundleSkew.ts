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
 * The player reports its own bundle identity on the telemetry POST
 * (`Screen.lastBundleSha` / `Screen.lastBundleId`, surfaced by `GET /screens`).
 * This module compares it to whatever `/api/build-info` says is deployed RIGHT
 * NOW — the same authority the panel itself compares against, so the chip's
 * verdict and the panel's own reload decision can never disagree.
 *
 * ⚠️ 2026-09-21 — "can never disagree" was ASPIRATIONAL until this date, and
 * the gap was the whole bug. The panel reloads on `bundleId`; this module
 * graded on the commit SHA. See `deriveBundleSkew` for what that cost.
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
  /**
   * `Screen.lastBundleId` — the identity the player actually decides to
   * RELOAD on, as reported by its telemetry POST (2026-09-21). Null on any
   * screen that has not reported since this shipped, and on a build that
   * never stamped one.
   */
  reportedBundleId?: string | null;
  /** The `bundleId` `/api/build-info` currently reports as deployed. */
  deployedBundleId?: string | null;
}

/**
 * Derive the bundle-skew display variant for one screen row.
 *
 * Precedence (mirrors `renderTrust.ts::deriveRenderTrust`):
 *   1. status !== ONLINE  → 'offline'. A screen that isn't running has no
 *      opinion about bundles, and its own badge already owns the row.
 *   2. BOTH sides report a bundleId → compare THOSE (see below).
 *   3. otherwise either SHA missing or unparseable → 'unknown'. NEVER guess:
 *      an older player build that doesn't report, a screen that just paired,
 *      or a deploy with no build-info env var must all stay silent rather
 *      than accuse a healthy panel.
 *   4. SHAs equal → 'current'.
 *   5. SHAs differ → 'stale' — the one actionable state.
 *
 * ── WHY bundleId WINS WHEN IT IS AVAILABLE (2026-09-21) ──────────────────
 * Greg: "why does every screen say resync on it…our app needs to self heal."
 *
 * This module graded skew by GIT SHA equality, but since the 2026-09-02
 * efficiency work the player does not reload on the SHA. It reloads when
 * `bundleId` moves — a hash of the client-bundle build inputs — precisely so
 * that an API-only, docs, APK or test commit, which cannot change a single
 * downloaded byte, reloads nobody.
 *
 * Those two facts together were the bug. After any such commit the deployed
 * SHA moved, every player correctly did NOT reload, and every online screen
 * therefore graded `stale` — forever, until the next bundle-changing deploy.
 * "App current 5/18" on a completely healthy fleet. And Resync could not
 * clear it: the screen reloads the identical bundle and reports the identical
 * SHA, so the accusation survives the only remedy offered for it.
 *
 * Comparing the identity the reload decision is actually made on makes
 * `current` mean what the operator reads it to mean: THIS SCREEN WILL NOT
 * RELOAD — there is nothing newer for it to pick up.
 *
 * ── TRANSITIONAL BEHAVIOUR, AND WHY IT IS CORRECT ───────────────────────
 * Immediately after this ships, no screen has reported a bundleId yet, so
 * every row falls back to the SHA comparison and grades `stale`. That is
 * TRUE, not a regression: this change edits `apps/web/src`, so it changes
 * the bundle inputs, so it moves `bundleId` — those screens really are on an
 * older bundle and really will reload onto this one on their own. They start
 * reporting a bundleId as soon as they do. From the NEXT deploy onward, a
 * commit that leaves the client bundle untouched leaves them `current`,
 * which is the whole point. Pinned by `bundleSkew.test.ts`.
 *
 * The fallback is deliberately kept rather than replaced: a self-hosted
 * build that never runs the prebuild step stamps no bundleId at all, and a
 * one-sided value (new dashboard, old player, or vice versa) is not evidence
 * of anything. Never a verdict off a value only one side can see.
 */
export function deriveBundleSkew(input: BundleSkewInput): BundleSkewVariant {
  if (input.status !== 'ONLINE') return 'offline';

  // Prefer the identity the player actually reloads on — but only when BOTH
  // sides have one. A one-sided bundleId is silence, not a verdict, so it
  // falls through to the SHA comparison rather than grading off half an
  // answer.
  const mineId = normalizeSha(input.reportedBundleId);
  const deployedId = normalizeSha(input.deployedBundleId);
  if (mineId && deployedId) return mineId === deployedId ? 'current' : 'stale';

  const mine = normalizeSha(input.reportedSha);
  const deployed = normalizeSha(input.deployedSha);
  if (!mine || !deployed) return 'unknown';

  return mine === deployed ? 'current' : 'stale';
}
