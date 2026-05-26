"use client";

/**
 * PlaylistPreviewThumb — single source of truth for "what does this
 * playlist look like" thumbnails on the playlists dashboard.
 *
 * Operator's ask (2026-05-25):
 *   "playlists should all have a preview, even a custom template
 *    should give a preview in the playlist...and if its multiple
 *    images, a slow scroll thru them would be really nice....and
 *    also add mini previews when we switch it from tile mode to
 *    list mode"
 *
 * What this component renders, per playlist type:
 *
 *   - Template playlist  → ScaledTemplateThumbnail of the layout
 *                          (zones come from the templates list query
 *                          via the lookup map prop). Falls back to a
 *                          LayoutTemplate icon when the template
 *                          isn't in the lookup (custom template not
 *                          loaded yet, or system template that the
 *                          gallery's vertical filter excluded).
 *
 *   - Image playlist     → first image as the static frame. If ≥2
 *                          images and the preview is in-viewport AND
 *                          the user hasn't asked for reduced motion,
 *                          slow-cross-fade through up to 5 frames.
 *                          Pauses when the element scrolls offscreen
 *                          (IntersectionObserver) to avoid burning
 *                          CPU on a list scrolled past.
 *
 *   - Video playlist     → first video, preloaded with metadata and
 *                          seeked to 0.1s so the browser paints a
 *                          real first frame. NO autoplay — that
 *                          would be noisy and burn bandwidth.
 *
 *   - Mixed playlist     → 2×2 grid of the first up-to-4 items.
 *                          Same rendering as a single tile per cell.
 *                          The grid uses absolute positioning rather
 *                          than CSS Grid `gap-*` so Chromium 83
 *                          (NovaStar Taurus) renders identically to
 *                          modern browsers — see CLAUDE.md rule #10.
 *
 *   - Webpage playlist   → mshots screenshot of the first URL,
 *                          same source the asset library uses.
 *
 *   - Empty playlist     → generic playlist icon. Nothing to show.
 *
 * `size` controls the layout:
 *   - 'tile'  → aspect-video, fills its container width.
 *   - 'list'  → fixed 56×40 thumb for the list-mode left column.
 *
 * Why this is a separate component (and not inlined in the playlist
 * card): the slideshow logic (IntersectionObserver, prefers-reduced-
 * motion, frame-cycle timer cleanup) is finicky enough that we want
 * a single tested implementation, and it needs to render in BOTH
 * tile mode AND list mode without duplication. The previous tile
 * mode rendered a 4-thumb strip with no animation; list mode showed
 * a colored vertical accent bar instead of any thumbnail. Operators
 * couldn't tell two image playlists apart in list mode without
 * clicking each one.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { LayoutTemplate, Image as ImageIcon, Video, Globe, Music, Layers, Play, File, FileText } from 'lucide-react';
import { ScaledTemplateThumbnail } from '@/components/templates/ScaledTemplateThumbnail';

const apiBase = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080/api/v1').replace('/api/v1', '');

// Slideshow timing — picked to feel "easy to read" rather than rapid.
// Per spec: ~1.4s per frame with ~250ms cross-fade overlap.
const SLIDE_HOLD_MS = 1400;
const SLIDE_FADE_MS = 250;
const MAX_SLIDESHOW_FRAMES = 5;

export type PlaylistContentLabel = 'Image' | 'Video' | 'Template' | 'Mixed content' | 'Webpage' | 'Audio' | 'Document' | 'Empty';

// 2026-05-26 — operator: PDF import shows no preview. Cause: PDFs
// land as Asset rows with mimeType `application/pdf`, which fell
// through every (image/video/html/audio) bucket and hit the generic
// Layers icon fallback. Recognize PDF + PPTX + DOCX as 'Document'
// and render a real iframe-of-the-PDF preview below.
function isDocumentMime(m: string): boolean {
  return (
    m === 'application/pdf' ||
    m === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
    m === 'application/vnd.ms-powerpoint' ||
    m === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    m === 'application/msword'
  );
}

/** Returns the content-type label for a playlist. */
export function derivePlaylistContentLabel(playlist: any): PlaylistContentLabel {
  if (!playlist) return 'Empty';
  if (playlist.template) return 'Template';

  const items: any[] = playlist.items || [];
  if (items.length === 0) return 'Empty';

  const kinds = new Set<string>();
  for (const it of items) {
    const mime = it?.asset?.mimeType || '';
    if (mime.startsWith('image/')) kinds.add('image');
    else if (mime.startsWith('video/')) kinds.add('video');
    else if (mime.startsWith('audio/')) kinds.add('audio');
    else if (mime === 'text/html') kinds.add('webpage');
    else if (isDocumentMime(mime)) kinds.add('document');
    else kinds.add('other');
  }

  if (kinds.size === 0) return 'Empty';
  if (kinds.size > 1) return 'Mixed content';
  const only = [...kinds][0];
  if (only === 'image') return 'Image';
  if (only === 'video') return 'Video';
  if (only === 'audio') return 'Audio';
  if (only === 'webpage') return 'Webpage';
  if (only === 'document') return 'Document';
  // Single unknown mime — treat as mixed content rather than guessing.
  return 'Mixed content';
}

/** Build a URL the browser can render an inline preview from. Returns
 * null when the asset's mime type doesn't have a thumbnail (e.g. raw
 * binary). Mirrors the asset library's existing source-of-truth so
 * preview parity stays automatic.
 */
function thumbUrlFor(asset: any): string | null {
  if (!asset) return null;
  if (asset.mimeType === 'text/html' && asset.fileUrl) {
    return `https://s.wordpress.com/mshots/v1/${encodeURIComponent(asset.fileUrl)}?w=640&h=360`;
  }
  if (
    !asset.mimeType?.startsWith('image/') &&
    !asset.mimeType?.startsWith('video/')
  ) return null;
  return asset.fileUrl?.startsWith('http') ? asset.fileUrl : `${apiBase}${asset.fileUrl}`;
}

/** Static (non-animated) inline preview for ONE asset. Mirrors the
 * playlists page's AssetThumb component pattern so video frames
 * decode reliably and mshots' "warming" placeholder retries
 * transparently. */
function StaticAssetFrame({ asset, className }: { asset: any; className?: string }) {
  const url = thumbUrlFor(asset);
  if (!url) {
    // Render a generic icon so the cell isn't blank.
    const mime = asset?.mimeType || '';
    let Icon: any = File;
    let color = 'text-slate-400';
    if (mime.startsWith('audio/')) { Icon = Music; color = 'text-amber-500'; }
    else if (mime === 'text/html') { Icon = Globe; color = 'text-emerald-500'; }
    else if (mime.startsWith('video/')) { Icon = Video; color = 'text-violet-500'; }
    else if (mime.startsWith('image/')) { Icon = ImageIcon; color = 'text-sky-500'; }
    return (
      <div className={`flex items-center justify-center bg-slate-50 ${className || ''}`}>
        <Icon className={`w-4 h-4 ${color}`} aria-hidden="true" />
      </div>
    );
  }
  if (asset?.mimeType?.startsWith('video/')) {
    return (
      // eslint-disable-next-line jsx-a11y/media-has-caption
      <video
        src={url}
        muted
        playsInline
        preload="metadata"
        className={className}
        onLoadedMetadata={(e) => {
          try { (e.currentTarget as HTMLVideoElement).currentTime = 0.1; } catch { /* ignore */ }
        }}
      />
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return (
    <img
      src={url}
      alt=""
      className={className}
      onError={(e) => {
        // mshots first-hit warming retry, same as AssetThumb in
        // the playlists page.
        const img = e.currentTarget;
        const tries = Number(img.dataset.tries || 0);
        if (tries < 3) {
          img.dataset.tries = String(tries + 1);
          setTimeout(() => {
            img.src = url + (url.includes('?') ? '&' : '?') + 'retry=' + tries;
          }, 1500 * (tries + 1));
        } else {
          img.style.display = 'none';
        }
      }}
    />
  );
}

/** Lazy-mounted PDF preview. The iframe is heavy (browser-native
 * PDF renderer spins up on mount) so we gate it on IntersectionObserver
 * — the iframe doesn't exist until the tile scrolls into view. PDF
 * viewer chrome (toolbar / nav-panes / scrollbar) is stripped via
 * the #view URL fragment so the tile reads as a thumbnail, not a
 * mini PDF reader. The iframe is sandboxed (no scripts, no top
 * navigation) — even a malicious PDF rendered via the browser
 * cannot escape the tile.
 */
function LazyPdfThumb({ url }: { url: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      // Old browser (or test env) — just mount eagerly.
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true);
            io.disconnect();
            return;
          }
        }
      },
      { threshold: 0.1 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Append the viewer-chrome stripping fragment if the URL doesn't
  // already have one. `#view=Fit` scales the page to fit the iframe
  // dimensions; `toolbar=0`, `navpanes=0`, `scrollbar=0` hide every
  // bit of viewer UI. Browser support: Chrome, Edge, Firefox, Safari
  // all honor these PDF.js / native-viewer parameters.
  const src = url + (url.includes('#') ? '&' : '#') + 'view=Fit&toolbar=0&navpanes=0&scrollbar=0';

  return (
    <div ref={containerRef} className="absolute top-0 right-0 bottom-0 left-0 bg-slate-100 overflow-hidden">
      {visible ? (
        <iframe
          src={src}
          title="PDF preview"
          // Sandbox: no scripts, no popups, no top navigation, no
          // form submission. Pretty much "render this, that's it."
          sandbox=""
          loading="lazy"
          // pointer-events:none so the tile click goes through to
          // the playlist row underneath (don't steal interaction).
          style={{ width: '100%', height: '100%', border: 0, pointerEvents: 'none' }}
          // Some browsers fire onError on PDF iframes if the URL
          // 404s — fall back to the file-icon card. We re-use the
          // tile container so the layout doesn't shift.
        />
      ) : (
        <div className="absolute top-0 right-0 bottom-0 left-0 flex flex-col items-center justify-center bg-gradient-to-br from-rose-50 to-rose-100">
          <FileText className="w-8 h-8 text-rose-500" aria-hidden="true" />
          <span className="mt-1 text-[10px] font-bold text-rose-700/80 uppercase tracking-wider">PDF</span>
        </div>
      )}
    </div>
  );
}

/** Slow cross-fade slideshow through up to 5 image frames. Pauses on
 * offscreen + prefers-reduced-motion. */
function ImageSlideshow({ assets, className }: { assets: any[]; className?: string }) {
  // Cap to MAX_SLIDESHOW_FRAMES for perf — a 50-image playlist would
  // otherwise mount 50 <img> tags per row.
  const frames = useMemo(() => assets.slice(0, MAX_SLIDESHOW_FRAMES), [assets]);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState(0);
  const [running, setRunning] = useState(false);
  // Track prefers-reduced-motion. Only need to read once; the media
  // query rarely changes during a session and we don't ship a settings
  // toggle that flips it. Fall back to "motion is OK" on SSR.
  const reducedMotion = useMemo(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, []);

  // Start/stop based on viewport visibility. Avoids a tab with 100
  // playlists chewing through CPU on a 20-frame slideshow timer per
  // card. Listen until unmount; cheap.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setRunning(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          // Only animate while we have at least 25% of the element
          // visible — saves a frame on heavily-scrolled lists.
          setRunning(e.isIntersecting && e.intersectionRatio > 0.25);
        }
      },
      { threshold: [0, 0.25, 0.5, 1] },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Frame advance timer. Only schedules when running, motion is OK,
  // and there's more than one frame to cycle. The interval includes
  // both the hold time AND the fade overlap so the next frame is
  // mid-fade when it becomes the "active" layer.
  useEffect(() => {
    if (!running) return;
    if (reducedMotion) return;
    if (frames.length < 2) return;
    const interval = window.setInterval(() => {
      setActive((prev) => (prev + 1) % frames.length);
    }, SLIDE_HOLD_MS);
    return () => window.clearInterval(interval);
  }, [running, reducedMotion, frames.length]);

  if (frames.length === 0) return null;

  return (
    <div ref={containerRef} className={`relative overflow-hidden bg-slate-50 ${className || ''}`}>
      {frames.map((asset, idx) => (
        <div
          key={asset?.id || idx}
          className="absolute top-0 right-0 bottom-0 left-0"
          style={{
            opacity: idx === active ? 1 : 0,
            transition: `opacity ${SLIDE_FADE_MS}ms ease-in-out`,
            // Only the active frame should receive pointer events,
            // not strictly necessary for non-interactive previews
            // but keeps a11y trees clean.
            pointerEvents: idx === active ? 'auto' : 'none',
          }}
        >
          <StaticAssetFrame asset={asset} className="w-full h-full object-cover" />
        </div>
      ))}
      {/* +N indicator for playlists longer than the slideshow cap. */}
      {assets.length > frames.length && (
        <div
          className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded-md bg-black/50 text-white text-[9px] font-bold leading-none"
          aria-hidden="true"
        >
          +{assets.length - frames.length}
        </div>
      )}
    </div>
  );
}

/** Type for the templates lookup map this component accepts. Built
 * by the caller from `useTemplates()` data; we receive just the
 * fields ScaledTemplateThumbnail needs, so the playlist card doesn't
 * have to refetch a full template per row. */
export type TemplateLookupEntry = {
  zones: any[];
  screenWidth: number;
  screenHeight: number;
  bgImage?: string | null;
  bgGradient?: string | null;
  bgColor?: string | null;
};

interface Props {
  playlist: any;
  templateLookup?: Record<string, TemplateLookupEntry | undefined>;
  size?: 'tile' | 'list';
  /** Optional extra classes. The component sets aspect/size itself
   * for predictable layout. */
  className?: string;
}

/** Visual envelope shared by every variant — rounded corners, soft
 * border, slight surface so empty cells don't look broken. */
function shellClasses(size: 'tile' | 'list', className?: string): string {
  if (size === 'list') {
    return `relative shrink-0 w-14 h-10 rounded-md border border-slate-200 overflow-hidden bg-slate-50 ${className || ''}`;
  }
  return `relative w-full overflow-hidden rounded-lg border border-slate-100 bg-slate-50 ${className || ''}`;
}

export function PlaylistPreviewThumb({ playlist, templateLookup, size = 'tile', className }: Props) {
  const isTemplate = !!playlist?.template;
  const items: any[] = playlist?.items || [];

  // ── Template playlist ─────────────────────────────────────────
  if (isTemplate) {
    const tid = playlist.template?.id;
    const entry = tid ? templateLookup?.[tid] : undefined;

    // Tile mode at full quality — render the actual layout zones
    // via ScaledTemplateThumbnail. The component IO-gates its own
    // mount so we don't spin up 100 widget trees at once.
    if (entry && size === 'tile') {
      // 2026-05-26 — operator (round 8): "the playlist tiles are
      // massive, they would all be a set size like before, we just
      // added a preview". Pre-fix used the template's own aspect
      // ratio (e.g. 9:16 portrait → super-tall tile breaking the
      // uniform grid). Force every tile to 16:9 regardless of source
      // and let ScaledTemplateThumbnail letterbox inside. Tile grid
      // stays uniform; portrait templates show a portrait card
      // letterboxed in a 16:9 box (recognizable, not enormous).
      return (
        <div
          className={shellClasses(size, className)}
          style={{ aspectRatio: '16 / 9' }}
        >
          <div className="absolute top-0 right-0 bottom-0 left-0 flex items-center justify-center">
            <ScaledTemplateThumbnail
              zones={entry.zones as any}
              screenWidth={entry.screenWidth}
              screenHeight={entry.screenHeight}
              bgImage={entry.bgImage}
              bgGradient={entry.bgGradient}
              bgColor={entry.bgColor}
              maxHeight={180}
            />
          </div>
        </div>
      );
    }

    // List mode — render a tiny static thumbnail too. Same widget
    // tree but capped at 40px height so it fits the row strip.
    if (entry && size === 'list') {
      return (
        <div className={shellClasses(size, className)}>
          <div className="absolute top-0 right-0 bottom-0 left-0 flex items-center justify-center">
            <ScaledTemplateThumbnail
              zones={entry.zones as any}
              screenWidth={entry.screenWidth}
              screenHeight={entry.screenHeight}
              bgImage={entry.bgImage}
              bgGradient={entry.bgGradient}
              bgColor={entry.bgColor}
              maxHeight={40}
            />
          </div>
        </div>
      );
    }

    // No template-lookup hit (system template the gallery excluded,
    // or the templates list is still loading). Fall back to a
    // recognizable icon + label so the cell isn't blank.
    return (
      <div
        className={shellClasses(size, className)}
        style={size === 'tile' ? { aspectRatio: '16 / 9' } : undefined}
      >
        <div className="absolute top-0 right-0 bottom-0 left-0 flex flex-col items-center justify-center bg-gradient-to-br from-violet-50 to-purple-100">
          <LayoutTemplate
            className={size === 'list' ? 'w-4 h-4 text-violet-600' : 'w-8 h-8 text-violet-600'}
            aria-hidden="true"
          />
          {size === 'tile' && (
            <span className="mt-1 text-[10px] font-bold text-violet-700/80 uppercase tracking-wider">Template</span>
          )}
        </div>
      </div>
    );
  }

  // ── Asset playlist ────────────────────────────────────────────
  const previewAssets = items
    .map((it: any) => it?.asset)
    .filter(Boolean) as any[];

  // Bucket items by mime kind so we can decide rendering strategy.
  const imageAssets = previewAssets.filter((a) => a.mimeType?.startsWith('image/'));
  const videoAssets = previewAssets.filter((a) => a.mimeType?.startsWith('video/'));
  const htmlAssets = previewAssets.filter((a) => a.mimeType === 'text/html');
  const audioAssets = previewAssets.filter((a) => a.mimeType?.startsWith('audio/'));
  const documentAssets = previewAssets.filter((a) => isDocumentMime(a.mimeType || ''));

  // ── Empty playlist ───────────────────────────────────────────
  if (previewAssets.length === 0) {
    return (
      <div
        className={shellClasses(size, className)}
        style={size === 'tile' ? { aspectRatio: '16 / 9' } : undefined}
      >
        <div className="absolute top-0 right-0 bottom-0 left-0 flex items-center justify-center">
          <ImageIcon
            className={size === 'list' ? 'w-4 h-4 text-slate-300' : 'w-8 h-8 text-slate-200'}
            aria-hidden="true"
          />
        </div>
      </div>
    );
  }

  // ── Mixed content (>1 kind) — 2×2 grid of first 4 items ──────
  const kinds = [
    imageAssets.length > 0 ? 'image' : null,
    videoAssets.length > 0 ? 'video' : null,
    htmlAssets.length > 0 ? 'webpage' : null,
    audioAssets.length > 0 ? 'audio' : null,
    documentAssets.length > 0 ? 'document' : null,
  ].filter(Boolean);

  if (kinds.length > 1) {
    const cells = previewAssets.slice(0, 4);
    return (
      <div
        className={shellClasses(size, className)}
        style={size === 'tile' ? { aspectRatio: '16 / 9' } : undefined}
      >
        {/* 2×2 grid using absolute positioning to avoid Tailwind
            `gap-*` (CLAUDE.md rule #10 — gap-* on flex is Chromium 84+
            and this component MAY render on Chromium-83 contexts).
            Each cell is exactly 50% by 50% and they share a 1px
            slate divider. */}
        <div className="absolute top-0 right-0 bottom-0 left-0">
          {[0, 1, 2, 3].map((idx) => {
            const a = cells[idx];
            const top = idx < 2 ? '0%' : '50%';
            const left = idx % 2 === 0 ? '0%' : '50%';
            return (
              <div
                key={idx}
                className="absolute bg-slate-50"
                style={{ top, left, width: '50%', height: '50%' }}
              >
                {a ? (
                  <StaticAssetFrame asset={a} className="w-full h-full object-cover" />
                ) : null}
              </div>
            );
          })}
        </div>
        {/* Inner cross divider */}
        <div className="absolute top-0 bottom-0 bg-white/70" style={{ left: '50%', width: 1, marginLeft: -0.5 }} aria-hidden="true" />
        <div className="absolute left-0 right-0 bg-white/70" style={{ top: '50%', height: 1, marginTop: -0.5 }} aria-hidden="true" />
        {/* +N indicator if there were more items than cells. */}
        {previewAssets.length > 4 && (
          <div
            className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded-md bg-black/50 text-white text-[9px] font-bold leading-none"
            aria-hidden="true"
          >
            +{previewAssets.length - 4}
          </div>
        )}
      </div>
    );
  }

  // ── All-images playlist ─────────────────────────────────────
  if (imageAssets.length === previewAssets.length && imageAssets.length > 0) {
    return (
      <div
        className={shellClasses(size, className)}
        style={size === 'tile' ? { aspectRatio: '16 / 9' } : undefined}
      >
        {imageAssets.length === 1 ? (
          <StaticAssetFrame asset={imageAssets[0]} className="w-full h-full object-cover" />
        ) : (
          <ImageSlideshow assets={imageAssets} className="w-full h-full" />
        )}
      </div>
    );
  }

  // ── All-videos playlist ─────────────────────────────────────
  if (videoAssets.length === previewAssets.length && videoAssets.length > 0) {
    return (
      <div
        className={shellClasses(size, className)}
        style={size === 'tile' ? { aspectRatio: '16 / 9' } : undefined}
      >
        <StaticAssetFrame asset={videoAssets[0]} className="w-full h-full object-cover" />
        {/* Play badge so it reads as "video" at a glance. */}
        <div className="absolute top-0 right-0 bottom-0 left-0 flex items-center justify-center pointer-events-none">
          <div className="rounded-full bg-black/45 p-1.5">
            <Play
              className={size === 'list' ? 'w-3 h-3 text-white' : 'w-5 h-5 text-white'}
              fill="white"
              aria-hidden="true"
            />
          </div>
        </div>
        {videoAssets.length > 1 && (
          <div
            className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded-md bg-black/50 text-white text-[9px] font-bold leading-none"
            aria-hidden="true"
          >
            +{videoAssets.length - 1}
          </div>
        )}
      </div>
    );
  }

  // ── All-webpages playlist ───────────────────────────────────
  if (htmlAssets.length === previewAssets.length && htmlAssets.length > 0) {
    return (
      <div
        className={shellClasses(size, className)}
        style={size === 'tile' ? { aspectRatio: '16 / 9' } : undefined}
      >
        <StaticAssetFrame asset={htmlAssets[0]} className="w-full h-full object-cover" />
        {htmlAssets.length > 1 && (
          <div
            className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded-md bg-black/50 text-white text-[9px] font-bold leading-none"
            aria-hidden="true"
          >
            +{htmlAssets.length - 1}
          </div>
        )}
      </div>
    );
  }

  // ── All-document playlist (PDF / PPTX / DOCX) ───────────────
  // Browsers render PDFs natively via <iframe>. PPTX/DOCX don't —
  // they get a styled card with the filename. The iframe is gated
  // on in-viewport (IntersectionObserver) to avoid spawning N PDF
  // renderers in a 100-tile grid. Toolbar / nav-panes / scrollbar
  // chrome is hidden via the #view PDF-viewer fragment so the
  // thumbnail looks like a thumbnail, not a mini reader.
  if (documentAssets.length === previewAssets.length && documentAssets.length > 0) {
    const first = documentAssets[0];
    const isPdf = first.mimeType === 'application/pdf';
    return (
      <div
        className={shellClasses(size, className)}
        style={size === 'tile' ? { aspectRatio: '16 / 9' } : undefined}
      >
        {isPdf && size === 'tile' ? (
          <LazyPdfThumb url={first.fileUrl?.startsWith('http') ? first.fileUrl : `${apiBase}${first.fileUrl}`} />
        ) : (
          <div className="absolute top-0 right-0 bottom-0 left-0 flex flex-col items-center justify-center bg-gradient-to-br from-rose-50 to-rose-100">
            <FileText
              className={size === 'list' ? 'w-4 h-4 text-rose-500' : 'w-8 h-8 text-rose-500'}
              aria-hidden="true"
            />
            {size === 'tile' && (
              <span className="mt-1 text-[10px] font-bold text-rose-700/80 uppercase tracking-wider">
                {isPdf ? 'PDF' : 'Document'}
              </span>
            )}
          </div>
        )}
        {documentAssets.length > 1 && (
          <div
            className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded-md bg-black/60 text-white text-[9px] font-bold leading-none"
            aria-hidden="true"
          >
            +{documentAssets.length - 1}
          </div>
        )}
      </div>
    );
  }

  // ── All-audio playlist ──────────────────────────────────────
  if (audioAssets.length === previewAssets.length && audioAssets.length > 0) {
    return (
      <div
        className={shellClasses(size, className)}
        style={size === 'tile' ? { aspectRatio: '16 / 9' } : undefined}
      >
        <div className="absolute top-0 right-0 bottom-0 left-0 flex flex-col items-center justify-center bg-gradient-to-br from-amber-50 to-amber-100">
          <Music
            className={size === 'list' ? 'w-4 h-4 text-amber-500' : 'w-8 h-8 text-amber-500'}
            aria-hidden="true"
          />
          {size === 'tile' && (
            <span className="mt-1 text-[10px] font-bold text-amber-700/80 uppercase tracking-wider">Audio</span>
          )}
        </div>
      </div>
    );
  }

  // ── Fallback (shouldn't reach here given the early return on
  //     `kinds.length > 1`) — show a generic icon. ──────────────
  return (
    <div
      className={shellClasses(size, className)}
      style={size === 'tile' ? { aspectRatio: '16 / 9' } : undefined}
    >
      <div className="absolute top-0 right-0 bottom-0 left-0 flex items-center justify-center">
        <Layers
          className={size === 'list' ? 'w-4 h-4 text-slate-300' : 'w-8 h-8 text-slate-200'}
          aria-hidden="true"
        />
      </div>
    </div>
  );
}

export default PlaylistPreviewThumb;
