/**
 * Deployment identity for the dashboard and idle-only player activation.
 * Legacy players treat sha/bundleId drift as permission to interrupt live
 * content. Return no automatic trigger to those callers; keep shaFull for
 * diagnosis and leave explicit authenticated refresh/recovery untouched.
 */

import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

// Legacy players use these identities as a live-reload trigger. The response
// now depends on the caller, so never share it through a static/CDN cache.
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
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

  // Stop already-running older players from treating this deployment as a
  // command to reload live content. Updated players explicitly request the
  // idle-only policy. Dashboard/default callers still get the real identity.
  let legacyPlayer = false;
  try {
    const caller = new URL(request.headers.get('referer') || '');
    const current = new URL(request.url);
    legacyPlayer = caller.origin === current.origin &&
      (caller.pathname === '/player' || caller.pathname.startsWith('/player/')) &&
      current.searchParams.get('playerPolicy') !== 'idle';
  } catch { /* No player referrer: preserve the public diagnostic response. */ }

  return NextResponse.json({
    sha: legacyPlayer ? null : shortSha,
    shaFull: sha,
    bundleId: legacyPlayer ? null : bundleId,
    playerActivation: 'idle-or-operator',
    builtAt: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_DATE || null,
    // Diagnostic timestamp only; no player compares clocks against it.
    ts: new Date().toISOString(),
  }, { headers: { 'Cache-Control': 'private, no-store' } });
}
