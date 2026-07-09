/**
 * asset-image.ts — Supabase image transform helpers (egress reduction).
 *
 * Background (2026-05-30):
 *   Supabase Storage serves every asset with `cache-control: no-cache`
 *   regardless of the Cache-Control we set on upload. This means every
 *   render of a thumbnail re-fetches the FULL-RESOLUTION image from
 *   origin. For a 2.4 MB banner image shown in a 320 px tile, the browser
 *   downloads 2.4 MB every time the component mounts — the root cause of
 *   the 98 MB stored → 5.79 GB egress blowout.
 *
 *   Supabase Pro has a built-in image-transform pipeline:
 *     /storage/v1/object/public/assets/<path>
 *   becomes:
 *     /storage/v1/render/image/public/assets/<path>?width=320&quality=60
 *
 *   The transform is served from Supabase's edge, is cached per-width,
 *   and reduces a 2.4 MB image to ~60 KB at 320 px (measured 2026-05-30).
 *
 * Usage:
 *   import { transformedImageUrl } from '@/lib/asset-image';
 *   const src = transformedImageUrl(asset.fileUrl, { width: 320 });
 *
 * Scope — thumbnails and tiles ONLY:
 *   Never apply to the player route or full-screen widget renders — those
 *   need the original resolution for crisp 1080p / 4K displays.
 *   This helper is safe to call unconditionally; it returns the original
 *   URL unchanged for all non-Supabase and non-image assets.
 */

/** Image mimetypes the Supabase transform endpoint handles. */
const TRANSFORMABLE_EXTS = /\.(png|jpe?g|webp|gif|avif)(\?|$)/i;

/** Matches the Supabase object-public URL segment we rewrite. */
const SUPABASE_OBJECT_RE = /\/storage\/v1\/object\/public\//;

/**
 * Converts a Supabase public object URL to a render/image transform URL.
 *
 * Behaviour:
 *   - Only rewrites URLs that are Supabase-hosted (*.supabase.co/storage/v1/object/public/)
 *   - Only rewrites IMAGE URLs (png/jpg/jpeg/webp/gif/avif by extension or inference)
 *   - Returns the original URL unchanged for:
 *       - non-Supabase hosts
 *       - video / PDF / audio / data: / blob: URLs
 *       - mshots screenshot URLs (already optimised by WordPress CDN)
 *       - empty / non-string inputs
 *   - Never throws — every error path returns the original URL.
 *
 * @param fileUrl   The raw asset URL (may be relative or absolute)
 * @param opts      width: target display width in CSS pixels; quality defaults to 60
 */
export function transformedImageUrl(
  fileUrl: string | null | undefined,
  opts: { width: number; quality?: number },
): string {
  if (!fileUrl || typeof fileUrl !== 'string') return fileUrl ?? '';

  // Leave data: / blob: URLs alone.
  if (/^(data:|blob:)/i.test(fileUrl)) return fileUrl;

  // Leave mshots screenshot URLs alone — they're already CDN-optimised
  // by WordPress and don't go through Supabase storage at all.
  if (fileUrl.includes('s.wordpress.com/mshots')) return fileUrl;

  // Only rewrite Supabase-hosted URLs.
  if (!SUPABASE_OBJECT_RE.test(fileUrl)) return fileUrl;

  // Only rewrite image URLs. Check by extension in the URL path (before
  // any query string). Fall back to "not transformable" if the path has
  // no recognisable image extension — this covers video, PDF, audio, etc.
  const pathPart = fileUrl.split('?')[0];
  if (!TRANSFORMABLE_EXTS.test(pathPart)) return fileUrl;

  try {
    const width = Math.round(opts.width);
    const quality = Math.round(opts.quality ?? 60);
    // Rewrite: /storage/v1/object/public/ → /storage/v1/render/image/public/
    const transformed = fileUrl.replace(
      '/storage/v1/object/public/',
      '/storage/v1/render/image/public/',
    );
    // Strip any existing query string and append our transform params.
    const base = transformed.split('?')[0];
    // DISTORTION FIX (2026-07-09, verified empirically against our live
    // bucket): Supabase's render endpoint with ONLY `width` does NOT
    // auto-scale height — it squeezes width and keeps the original height
    // (a 1182×1330 source at width=320 came back 320×1330: warped). Every
    // thumbnail in the app was distorted. A square width×height box with
    // resize=contain returns an ASPECT-TRUE image whose longest side is
    // `width` (same source → 284×320). Callers keep the one-number API.
    return `${base}?width=${width}&height=${width}&resize=contain&quality=${quality}`;
  } catch {
    // Defensive: if anything in the URL munging throws, return the original.
    return fileUrl;
  }
}
