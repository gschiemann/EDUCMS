import { NextResponse } from 'next/server';
import { API_URL } from '@/lib/api-url';
import { apkDownloadUrl } from '@/components/screens/connectPaths';

/**
 * GET /download/player — the stable, branded address for the Player app
 * download (2026-10-11). The Connect-a-screen card's QR code and link point
 * HERE, on the VenueOS web address, instead of at the API host, so a customer
 * (and their IT team) never sees or has to trust a raw hosting URL in a QR.
 *
 * It does one thing: 302 to the live APK endpoint
 * (`${API_URL}/player/apk/latest`, apps/api/src/player-ota). The API still
 * serves the bytes and still owns version resolution, so nothing is cached
 * here and a new release is picked up the moment it is published.
 *
 * Public by design (the binary is inert without a tenant pairing code, which
 * IS authenticated), and read-only — no cookies, no user data.
 */
export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  const target = apkDownloadUrl(API_URL);
  if (!target) {
    return new NextResponse('The Player download is not available right now.', {
      status: 503,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    });
  }
  const res = NextResponse.redirect(new URL(target, request.url), 302);
  res.headers.set('cache-control', 'no-store');
  return res;
}
