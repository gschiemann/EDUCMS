/**
 * /api/build-info — exposes the currently-deployed bundle's commit SHA
 * so kiosks can detect when their loaded JS is stale.
 *
 * Sprint 11 Phase B4 — stale-bundle auto-detection.
 *
 * Flow:
 *   1. Kiosk captures `window.__BUNDLE_SHA__` (baked at build time via
 *      `NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA`) when its bundle loads.
 *   2. Every ~5 minutes the kiosk fetches THIS endpoint and reads the
 *      `sha` field — which reflects whatever bundle Vercel is CURRENTLY
 *      serving, regardless of what the kiosk's bundle was.
 *   3. If the two SHAs differ, the kiosk schedules a soft reload during
 *      the next idle window (between playlist items, no emergency
 *      active, no in-flight OTA).
 *
 * Why server-side env var works: Vercel renders the response from the
 * deployment that owns this route handler. Old kiosks running an old
 * bundle still hit the new route handler, which reports the new SHA →
 * mismatch detected.
 *
 * Falls back to `null` when not deployed on Vercel (local dev, custom
 * hosting). Kiosks treat `null` as "can't determine" and skip the
 * comparison — no false positives.
 */

import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  // VERCEL_GIT_COMMIT_SHA is auto-injected by Vercel during build +
  // runtime. The NEXT_PUBLIC_ form is inlined into client bundles;
  // the non-prefixed form is server-only. NEXT_PUBLIC_BUILD_SHA is
  // the existing in-repo convention (referenced by SoftwareInfoRow).
  // Try all three so this endpoint works on Vercel, on self-hosted
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

  return NextResponse.json(
    {
      sha: shortSha,
      shaFull: sha,
      builtAt: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_DATE || null,
      ts: new Date().toISOString(),
    },
    {
      headers: {
        // Never cache — the whole point is "what's deployed RIGHT NOW".
        // A 10-second stale-while-revalidate window is fine on the
        // CDN side but every kiosk fetch hits the origin.
        'Cache-Control': 'no-store, must-revalidate',
      },
    },
  );
}
