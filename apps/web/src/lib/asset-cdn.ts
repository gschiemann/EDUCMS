/**
 * Asset CDN URL helper — feature-flagged, default OFF.
 *
 * When `NEXT_PUBLIC_ASSET_CDN` is set to the deployed Cloudflare Worker URL
 * (e.g. https://edu-cms-edge.<account>.workers.dev), any Supabase Storage
 * asset URL is rewritten to flow through the edge CDN proxy, which:
 *
 *   - Overrides the upstream `cache-control: no-cache` with
 *     `public, max-age=31536000, immutable`.
 *   - Serves repeat fetches entirely from the Cloudflare edge (HIT),
 *     eliminating Supabase egress for every subsequent kiosk/player load.
 *   - Passes HTTP Range requests through correctly so video/audio seeking
 *     works without touching origin.
 *
 * When `NEXT_PUBLIC_ASSET_CDN` is NOT set (default, dev, CI), this helper
 * is a no-op: it returns the original URL unchanged. Nothing breaks.
 *
 * ## How to enable
 *
 * 1. Deploy the Cloudflare Worker (see apps/edge/README.md — "Asset CDN
 *    deploy runbook" section).
 * 2. Set `ASSET_ORIGIN` on the worker to your Supabase Storage base URL.
 * 3. In Vercel, add environment variable:
 *      NEXT_PUBLIC_ASSET_CDN = https://edu-cms-edge.<handle>.workers.dev
 *    (or your custom route, e.g. https://cdn.educms.app)
 * 4. Redeploy the Next.js app. Asset URLs rewrite automatically.
 * 5. Verify: open DevTools → Network, pick any asset request, confirm
 *    `x-edu-asset-cache: HIT` on the second load.
 *
 * ## URL mapping
 *
 * Supabase URL:  https://<proj>.supabase.co/storage/v1/object/public/assets/<path>
 * Worker URL:    ${NEXT_PUBLIC_ASSET_CDN}/cdn/assets/<path>
 *
 * The worker strips everything up to and including `/assets/` from the
 * Supabase path and re-fetches `${ASSET_ORIGIN}/<path>` on the first miss.
 *
 * ## What this helper does NOT do
 *
 * It does NOT rewrite every asset URL call-site automatically. It is a
 * single helper that callers opt into. As of 2026-05-30 it is wired into:
 *   - (none yet — ready to wire in when the worker is deployed and verified)
 *
 * Wire it in by replacing raw `fileUrl` / `assetUrl` references:
 *   import { resolveAssetUrl } from '@/lib/asset-cdn';
 *   const src = resolveAssetUrl(asset.fileUrl);
 */

/**
 * Supabase Storage path segment that separates the project base from the
 * per-object path. The worker's CDN path is `/cdn/assets/<everything after
 * this marker>`.
 */
const SUPABASE_STORAGE_MARKER = '/storage/v1/object/public/assets/';

/**
 * The CDN worker base URL baked in at build time.
 * undefined → feature is off → resolveAssetUrl is a no-op passthrough.
 */
const CDN_BASE: string | undefined = process.env.NEXT_PUBLIC_ASSET_CDN
  ? process.env.NEXT_PUBLIC_ASSET_CDN.replace(/\/+$/, '')
  : undefined;

/**
 * Rewrite a Supabase Storage URL to go through the Cloudflare edge CDN.
 *
 * Returns the original URL unchanged when:
 *   - NEXT_PUBLIC_ASSET_CDN is not set
 *   - The URL is not a Supabase Storage URL (non-Supabase hosts pass through)
 *   - The input is falsy / not a string
 *
 * @param url - The raw asset URL (usually `asset.fileUrl` from the API)
 * @returns CDN-rewritten URL, or the original if CDN is disabled / not applicable
 */
export function resolveAssetUrl(url: string | null | undefined): string {
  if (!url || typeof url !== 'string') return url ?? '';

  // Feature flag — CDN not configured.
  if (!CDN_BASE) return url;

  // Only rewrite Supabase Storage public asset URLs.
  const idx = url.indexOf(SUPABASE_STORAGE_MARKER);
  if (idx === -1) return url;

  // Strip query string from Supabase signed URLs — public-bucket objects
  // don't need tokens, and tokens would make every cache key unique.
  const pathStart = idx + SUPABASE_STORAGE_MARKER.length;
  const rawPath = url.slice(pathStart);
  const assetPath = rawPath.split('?')[0]; // drop ?token=... if present

  return `${CDN_BASE}/cdn/assets/${assetPath}`;
}

/**
 * True when the asset CDN is active for this build.
 * Useful for diagnostic UI (e.g., showing a "CDN active" badge in dev tools).
 */
export const assetCdnEnabled: boolean = CDN_BASE !== undefined;
