"use client";

import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { API_URL } from '@/lib/api-url';

/**
 * VideoPreviewThumb — the ONE way a video asset is drawn as a thumbnail on
 * the playlist surfaces: the editor's content rows, its Add Media picker,
 * and the library card / list tile (via PlaylistPreviewThumb). One
 * implementation, one test file — two copies of a hover trick is how one
 * of them goes stale.
 *
 * Greg, 2026-09-24, on an iPad: the first row's thumbnail "is a blank grey
 * box"; on the library: "playlist videos also arent showing and previews of
 * the content". Every one of those tiles was a `<video preload="none">`
 * that painted nothing until a hover-load trick fired — and a touch screen
 * has no hover, so on a phone or tablet every video was an empty box, for
 * months, because desktop Chrome never showed it. Then: "it should be like
 * the asset preview, i hold the mouse over the asset and the video starts
 * playing".
 *
 * ── AT REST ────────────────────────────────────────────────────────────
 * The poster frame (`Asset.posterUrl`, a ≤640px JPEG the API extracts at
 * upload — apps/api/src/storage/video-poster.service.ts) as a plain <img>.
 * It paints in every browser on every input, costs a few KB, and the video
 * element behind it is `preload="none"`, so the 2026-05-30 egress rule
 * holds: not one byte of video is fetched until the operator hovers.
 *
 * NULL is a first-class value for the poster (external-URL videos,
 * containers ffmpeg cannot decode, uploads older than the column until the
 * backfill runs). Without one the tile is the asset library's first-frame
 * approach: `<video preload="metadata" src="…#t=0.1">`. Chromium paints a
 * real first frame for a small fetch (metadata + one frame, never the
 * file); WebKit may leave it blank. Acceptable — the poster is the fix,
 * this is the floor.
 *
 * ── ON HOVER ───────────────────────────────────────────────────────────
 * A mouse (or pen) entering the tile loads and plays the muted, inline
 * <video>, which fades in over the poster only once frames are actually
 * rendering (`playing`), so there is never a black flash. Leaving pauses
 * it, rewinds it, and brings the poster back; the element stays mounted
 * between hovers so what it buffered is reused. It never autoplays on
 * mount, never plays with sound, and never reacts to touch: a tap arrives
 * as `pointerType: 'touch'` and is ignored, so a phone keeps the poster and
 * the tap does whatever the tile does (open the preview, select the asset).
 */

/** Where the no-poster fallback parks the playhead so a first frame paints. */
export const FIRST_FRAME_SECONDS = 0.1;

const apiBase = API_URL.replace('/api/v1', '');

/**
 * `Asset.posterUrl` as an absolute URL, or null when the asset is not a
 * video or carries no poster. Relative paths resolve against the API origin
 * exactly as the surfaces resolve `fileUrl` itself.
 */
export function assetPosterUrl(
  asset: { mimeType?: string | null; posterUrl?: string | null } | null | undefined,
): string | null {
  if (!asset?.mimeType?.startsWith('video/')) return null;
  const poster = asset.posterUrl;
  if (typeof poster !== 'string' || !poster.trim()) return null;
  return /^https?:\/\//i.test(poster) ? poster : `${apiBase}${poster}`;
}

export interface VideoPreviewThumbProps {
  /** The video file's URL (absolute — the caller has already resolved it). */
  src: string;
  /** The poster frame's URL from `assetPosterUrl()`, or null when there is none. */
  posterUrl?: string | null;
  /** Sizing + object-fit for the media, e.g. "w-full h-full object-contain". */
  className?: string;
  /** Fired once the picture's pixel size is known (poster load, or the
   *  fallback video's metadata) — the pickers tag each tile's orientation. */
  onDimensions?: (width: number, height: number) => void;
}

export function VideoPreviewThumb({ src, posterUrl, className, onDimensions }: VideoPreviewThumbProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  // A poster that fails to load (object gone, storage hiccup) hands the tile
  // to the first-frame fallback instead of leaving a broken-image glyph.
  const [posterFailed, setPosterFailed] = useState(false);
  // True only while the video is really rendering frames under the pointer.
  const [showing, setShowing] = useState(false);
  const poster = !posterFailed && typeof posterUrl === 'string' && posterUrl.trim() ? posterUrl : null;
  const media = className || '';

  const enter = (e: ReactPointerEvent<HTMLElement>) => {
    if (e.pointerType === 'touch') return;
    const v = videoRef.current;
    if (!v) return;
    // play() returns a promise in every browser we ship to, but not in jsdom
    // and not in the oldest Android WebViews — never chain on it blindly. A
    // rejection here is a leave-before-play AbortError or an autoplay
    // refusal; either way the poster is still on screen and nothing is owed.
    let outcome: unknown;
    try { outcome = v.play(); } catch { return; }
    if (outcome && typeof (outcome as Promise<void>).catch === 'function') {
      (outcome as Promise<void>).catch(() => undefined);
    }
  };

  const leave = (e: ReactPointerEvent<HTMLElement>) => {
    // A tap's pointerleave has nothing to undo — enter ignored it too.
    if (e.pointerType === 'touch') return;
    setShowing(false);
    const v = videoRef.current;
    if (!v) return;
    try { v.pause(); } catch { /* ignore */ }
    // Rewind so the next hover starts from the frame the poster shows, and
    // the no-poster fallback lands back on its painted first frame.
    try { v.currentTime = poster ? 0 : FIRST_FRAME_SECONDS; } catch { /* not loaded yet, or jsdom */ }
  };

  return (
    <span
      className="relative block w-full h-full"
      data-video-preview={poster ? 'poster' : 'first-frame'}
      data-preview-state={showing ? 'playing' : 'rest'}
      onPointerEnter={enter}
      onPointerLeave={leave}
    >
      {poster && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={poster}
          alt=""
          className={media}
          loading="lazy"
          decoding="async"
          draggable={false}
          onLoad={(e) => onDimensions?.(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)}
          onError={() => setPosterFailed(true)}
        />
      )}
      <video
        ref={videoRef}
        src={poster ? src : `${src}#t=${FIRST_FRAME_SECONDS}`}
        muted
        playsInline
        preload={poster ? 'none' : 'metadata'}
        aria-hidden
        tabIndex={-1}
        className={
          poster
            ? `${media} absolute top-0 left-0 transition-opacity duration-200 ${showing ? 'opacity-100' : 'opacity-0'}`
            : media
        }
        onPlaying={() => setShowing(true)}
        // A `playing` task the browser had already queued can land after a
        // fast leave; the `pause` that follows puts the poster back.
        onPause={() => setShowing(false)}
        onLoadedMetadata={
          poster
            ? undefined
            : (e) => onDimensions?.(e.currentTarget.videoWidth, e.currentTarget.videoHeight)
        }
      />
    </span>
  );
}
