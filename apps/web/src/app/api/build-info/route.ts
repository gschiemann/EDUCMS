/**
 * /api/build-info — what bundle is this deployment serving right now?
 * Consumed by the kiosk's stale-bundle detector (`player/page.tsx`).
 *
 * Sprint 11 Phase B4 — stale-bundle auto-detection.
 *
 * Flow:
 *   1. Kiosk captures its own identity when its bundle loads — the build's
 *      `bundleId` when one was stamped, else the commit SHA.
 *   2. Every 15 minutes the kiosk fetches THIS endpoint and compares.
 *   3. On mismatch it schedules a soft reload during the next idle window
 *      (no emergency on screen, no OTA install in flight).
 *
 * Why a server-side read works: Vercel serves this route from the
 * deployment that owns it. An old kiosk running an old bundle still hits
 * the CURRENT deployment's route, which reports the CURRENT identity →
 * mismatch detected. That property is unchanged by everything below.
 *
 * ── 2026-09-02, efficiency program. TWO CHANGES, BOTH COST FIXES ────────
 *
 * 1. IT IS NO LONGER A PER-REQUEST FUNCTION. This route was
 *    `force-dynamic` + `no-store`, which made it the single busiest route
 *    on the Vercel project at 0 % cached — every screen, every 5 minutes,
 *    invoking a Node function to read four environment variables that
 *    cannot change for the life of the deployment. At 50 always-on screens
 *    that alone was ~432 k function calls a month. `revalidate` opts the
 *    handler into Next's cache, so the fleet is served from the edge and
 *    the function renders at most once per window no matter how large the
 *    fleet gets. The kiosk keeps `cache: 'no-store'` on its side, so it
 *    always ASKS — the answer just no longer costs an invocation.
 *
 * 2. `bundleId` — AN IDENTITY THAT ONLY MOVES WHEN THE BUNDLE DOES.
 *    `sha` is the git commit, and EVERY commit changes it: an API-only fix,
 *    an APK change, a docs or test commit still triggers a Vercel build and
 *    therefore still told every kiosk in the fleet it was stale. The result
 *    was a fleet-wide soft reload and shell re-download per deploy, for
 *    bundles whose bytes were identical. `bundleId` is a hash of the
 *    client-bundle build inputs (see `scripts/build-info.cjs`), so those
 *    deploys are correctly silent.
 *
 * `sha`/`shaFull` are UNCHANGED and still returned: bundles deployed before
 * this change compare on them, and they remain the right value for the
 * dashboard's page-bundle chip (which reports what the player is running,
 * not what it should reload to). New bundles prefer `bundleId` and fall
 * back to `sha` whenever either side lacks one — so a build that never ran
 * the prebuild step behaves exactly as it did before.
 */

import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

/**
 * Cache window, in seconds. Everything this route returns is fixed for the
 * life of the deployment, so the only reason this is not `false` (cache
 * forever) is to let a self-hosted `next start` pick up an env var that was
 * absent at build time. Vercel purges the cache on a new production
 * deployment, so a deploy is still visible to the fleet immediately.
 */
export const revalidate = 300;

export async function GET() {
  // VERCEL_GIT_COMMIT_SHA is auto-injected by Vercel during build +
  // runtime. The NEXT_PUBLIC_ form is inlined into client bundles;
  // the non-prefixed form is server-only. NEXT_PUBLIC_BUILD_SHA is
  // the existing in-repo convention (referenced by SoftwareInfoRow).
  // Try all four so this endpoint works on Vercel, on self-hosted
  // builds, and during local development.
  const sha =
    process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.NEXT_PUBLIC_BUILD_SHA ||
    process.env.BUILD_SHA ||
    null;

  // Short form (first 12 chars) is enough for comparison and friendlier
  // in logs. Full SHA stays available in `shaFull` if a caller wants it.
  const shortSha = sha ? sha.slice(0, 12) : null;

  // Stamped by `scripts/build-info.cjs` into `.env.production.local` before
  // `next build`, so it is inlined here AND into the client bundle the
  // kiosk is running — the two values are comparable by construction. Null
  // when the prebuild step did not run (a bare `next build`, some
  // self-hosted setups); the kiosk then falls back to the SHA comparison.
  const bundleId = process.env.NEXT_PUBLIC_BUNDLE_ID || null;

  return NextResponse.json({
    sha: shortSha,
    shaFull: sha,
    bundleId,
    builtAt: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_DATE || null,
    // Render time, not request time — this response is cached. Kept for
    // human debugging only; nothing compares it.
    ts: new Date().toISOString(),
  });
}
