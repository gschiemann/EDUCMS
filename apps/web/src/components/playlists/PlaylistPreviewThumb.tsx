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
 *   - Template playlist  → The saved artwork of the layout, framed
 *                          exactly as before; an intentional mouse/pen
 *                          hover runs the template live on top of it
 *                          (TemplateContentThumb).
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
 *                          THIS IS THE ONE PREVIEW THAT MOVES AT REST,
 *                          so at rest it is SLOW — 7 s a frame, 900 ms
 *                          fade, unchanged since the owner's 2026-09-16
 *                          headache rule (a grid shows dozens of these
 *                          at once). Nothing else moves until the
 *                          pointer is on it.
 *                          UNDER THE POINTER IT IS QUICK. Once a mouse
 *                          or pen has RESTED on a slideshow for 350 ms,
 *                          THAT thumbnail steps at once, then holds
 *                          each picture 1.2 s with a 250 ms fade —
 *                          pointing at it is asking to see what is in
 *                          it, and waiting ~8 s a picture for that was
 *                          the owner's 2026-10-04 complaint ("its
 *                          waiting the full 10 sec ... in between the
 *                          images"). The pointer rules are
 *                          `useHoverPreview`'s: mouse/pen only (a tap
 *                          never makes it quick), ONE preview on the
 *                          whole page at a time (so quick can never
 *                          become a wall of motion), stops on leave /
 *                          hidden tab / scrolled away. Leaving settles
 *                          on the picture being shown and the slow
 *                          rotation carries on from there. The quick
 *                          cadence is `ImageSequenceThumb`'s — the same
 *                          the screens page and dashboards use.
 *
 *   - Video playlist     → first video's poster frame (Asset.posterUrl)
 *                          as an <img>; a mouse hovering the tile plays
 *                          it muted, leaving brings the poster back.
 *                          Never autoplays on mount, never on touch;
 *                          no video bytes until a real hover. A video
 *                          with no poster falls back to a first-frame
 *                          <video preload="metadata">. See
 *                          VideoPreviewThumb.tsx.
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
import { TemplateContentThumb } from '@/components/templates/TemplateContentThumb';
import { PdfHoverThumb } from '@/components/assets/PdfHoverThumb';
import { transformedImageUrl } from '@/lib/asset-image';
import { VideoPreviewThumb, assetPosterUrl } from './VideoPreviewThumb';
import { WebsitePreviewThumb } from '@/components/assets/WebsitePreviewThumb';
import { templatePreviewOf } from '@/lib/template-preview';
import { useHoverPreview } from '@/lib/use-hover-preview';
import { IMAGE_PREVIEW_FADE_MS, IMAGE_PREVIEW_FIRST_STEP_MS, IMAGE_PREVIEW_HOLD_MS } from './ImageSequenceThumb';

const apiBase = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080/api/v1').replace('/api/v1', '');

// Slideshow timing AT REST. The old values claimed to feel "easy to read rather
// than rapid" at 1.4s a frame — Greg, 2026-09-16: "the carousel of images is
// like every 2 seconds, slow that way down, it makes being on this page give me
// a head ache". A grid can show dozens of these cycling at once, so the page
// reads as strobing long before any single card does. Seven seconds a frame
// with a slow cross-fade: still obviously moving, no longer flicker.
//
// That is the pace of what moves WITHOUT being asked. A slideshow a mouse/pen
// pointer has RESTED on is a different thing — pointing at it is asking to see
// what is in it — and it runs `ImageSequenceThumb`'s quick cadence instead
// (IMAGE_PREVIEW_*: 350 ms to the first step, 1.2 s a picture, 250 ms fade;
// Greg, 2026-10-04: "its waiting the full 10 sec ... in between the images").
// Only ONE slideshow on the page can be under the pointer (`useHoverPreview`),
// so the headache rule is untouched: many thumbnails never move quickly at once.
const SLIDE_HOLD_MS = 7000;
const SLIDE_FADE_MS = 900;
const MAX_SLIDESHOW_FRAMES = 5;

export type PlaylistContentLabel = 'Image' | 'Video' | 'Template' | 'Mixed content' | 'Webpage' | 'Audio' | 'Document' | 'Empty';

// 2026-05-26 — operator: PDF import shows no preview. Cause: PDFs
// land as Asset rows with mimeType `application/pdf`, which fell
// through every (image/video/html/audio) bucket and hit the generic
// Layers icon fallback. Recognize PDF + PPTX + DOCX as 'Document'
// and render a real iframe-of-the-PDF preview below.
//
// 2026-05-26 round 2 — operator reports still no preview. Widened the
// detection: also catch `application/octet-stream` + `.pdf` filename
// (some browsers / file pickers send PDFs as octet-stream when the
// OS file-type registry doesn't recognize the extension), and check
// the fileUrl for `.pdf` / `.pptx` / `.docx` suffixes as fallback.
function isDocumentMime(m: string, fileUrl?: string): boolean {
  if (
    m === 'application/pdf' ||
    m === 'application/x-pdf' || // non-standard but observed in the wild
    m === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
    m === 'application/vnd.ms-powerpoint' ||
    m === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    m === 'application/msword'
  ) {
    return true;
  }
  // octet-stream fallback only when filename gives us a confident extension.
  if (typeof fileUrl === 'string' && fileUrl.length > 0) {
    const clean = fileUrl.split('?')[0].split('#')[0].toLowerCase();
    if (/\.(pdf|pptx?|docx?)$/.test(clean)) return true;
  }
  return false;
}

// Convenience helper: just-the-PDF check (rendering branch uses this
// to decide between iframe vs styled card).
function isPdfAsset(asset: any): boolean {
  if (!asset) return false;
  const m = asset.mimeType || '';
  if (m === 'application/pdf' || m === 'application/x-pdf') return true;
  const url = String(asset.fileUrl || '');
  const clean = url.split('?')[0].split('#')[0].toLowerCase();
  return clean.endsWith('.pdf');
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
    const url = it?.asset?.fileUrl;
    if (mime.startsWith('image/')) kinds.add('image');
    else if (mime.startsWith('video/')) kinds.add('video');
    else if (mime.startsWith('audio/')) kinds.add('audio');
    else if (mime === 'text/html') kinds.add('webpage');
    else if (isDocumentMime(mime, url)) kinds.add('document');
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
 *
 * 2026-05-30 — image URLs are transformed to 320 px thumbnails via the
 * Supabase render/image endpoint to slash per-render egress (measured
 * 2.4 MB full-res → ~60 KB at 320 px). Videos skip transforms; the
 * browser only fetches metadata when preload="none" + poster approach
 * is used in StaticAssetFrame.
 */
function thumbUrlFor(asset: any, width = 320): string | null {
  if (!asset) return null;
  // A website (text/html) is NOT built here: StaticAssetFrame hands it to the
  // shared WebsitePreviewThumb, which owns the screenshot URL (and the refusal
  // of credential / private-network URLs) and the "warming" retry.
  if (
    !asset.mimeType?.startsWith('image/') &&
    !asset.mimeType?.startsWith('video/')
  ) return null;
  const raw = asset.fileUrl?.startsWith('http') ? asset.fileUrl : `${apiBase}${asset.fileUrl}`;
  // Apply Supabase image transform for image assets only (not video).
  if (asset.mimeType?.startsWith('image/')) {
    return transformedImageUrl(raw, { width, quality: 60 });
  }
  return raw;
}

/** Static (non-animated) inline preview for ONE asset. Mirrors the
 * playlists page's AssetThumb component pattern so video frames
 * decode reliably and mshots' "warming" placeholder retries
 * transparently. */
function StaticAssetFrame({ asset, className, onPictureLoad }: { asset: any; className?: string; onPictureLoad?: () => void }) {
  if (asset?.mimeType === 'text/html' && asset.fileUrl) {
    return <WebsitePreviewThumb url={asset.fileUrl} name={asset.originalName} className={className} />;
  }
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
    // 2026-09-24 — the poster frame at rest, hover to play. Greg: "playlist
    // videos also arent showing and previews of the content" — this cell
    // was a bare dark mat with a play glyph, deliberately, since 2026-05-30
    // (a <video preload="auto"> per tile had 60-card grids hammering
    // Supabase with full-res byte-range requests on every page load). The
    // poster keeps that win: it is a few-KB JPEG, and the video behind it
    // is preload="none" until a real pointer hovers. A video with no poster
    // falls back to the asset library's first-frame approach — see
    // VideoPreviewThumb. The mat stays underneath so a letterboxed poster
    // and the no-poster state read the same.
    return (
      <div className={`relative bg-slate-800 ${className || ''}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <VideoPreviewThumb src={url} posterUrl={assetPosterUrl(asset)} className="w-full h-full object-contain" />
        {/* Play glyph — says "video" whether the poster is there or not */}
        <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'rgba(255,255,255,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Play style={{ width: 14, height: 14, color: '#fff' }} fill="#fff" aria-hidden="true" />
          </div>
        </div>
      </div>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return (
    <img
      src={url}
      alt=""
      className={className}
      onLoad={onPictureLoad}
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
 * mini PDF reader.
 *
 * 2026-05-26 round 3 — operator: STILL no preview. Verified the
 * actual cause via a headed-Chrome iframe sandbox test (three side-by-
 * side iframes loading the same Supabase PDF: empty `sandbox=""`,
 * no `sandbox`, and `sandbox="allow-scripts allow-same-origin"`).
 * Result:
 *   - `sandbox=""`                                  → BLANK + "sad file" icon
 *   - no sandbox attribute                          → PDF renders perfectly
 *   - `sandbox="allow-scripts allow-same-origin"`   → BLANK + "sad file" icon
 *
 * Chrome's PDFium viewer is a plugin-style document, not a script-only
 * document — ANY value of the `sandbox` attribute (even allow-scripts
 * + allow-same-origin) blocks it from rendering. The previous "the
 * iframe is sandboxed for safety" comment was theater: the browser's
 * PDF viewer is already deeply sandboxed by the browser itself
 * (chrome-untrusted://, content-process isolation, PDFium's own
 * sandbox). Adding an iframe-level sandbox kills the viewer without
 * adding any real security — the browser was already protecting us.
 *
 * Fix: render the iframe with NO sandbox attribute. PointerEvents
 * stays at none so the tile click still falls through to the playlist
 * row underneath. The `referrerpolicy` is set to `no-referrer` so we
 * don't leak the operator's playlist page URL to Supabase logs.
 */
function LazyPdfThumb({ url }: { url: string }) {
  // 2026-05-26 round 3 — switched from IntersectionObserver+always-
  // mount to hover-only via PdfHoverThumb. Operator: "when you first
  // hit the assets page the stupid settings pops up on the PDF
  // files....they shouldnt auto trigger ever unless i highlight over
  // them". The IO-gate already kept off-screen tiles from mounting,
  // but ONSCREEN tiles mounted immediately AND showed Chrome's
  // PDFium toolbar fade-in on first paint. PdfHoverThumb defers the
  // iframe mount until mouse-enter / focus / tap — placeholder
  // (rose gradient + FileText icon) is what the operator sees on
  // page load. Tile only swaps to the live iframe on intentional
  // hover. Same -56px crop + no-sandbox tricks live inside the
  // shared component.
  return (
    <div className="absolute top-0 right-0 bottom-0 left-0 bg-slate-100 overflow-hidden">
      <PdfHoverThumb fileUrl={url} title="PDF preview" />
    </div>
  );
}

/**
 * The first frame after `from` (wrapping round) whose picture has arrived — what
 * the quick walk steps to. Null when none has: the walk then waits for one
 * rather than fade to a blank or half-drawn frame. A picture that never arrives
 * (a broken file) is skipped for the same reason it is never waited for.
 */
export function nextArrivedFrame(from: number, keys: readonly string[], arrived: ReadonlySet<string>): number | null {
  for (let step = 1; step < keys.length; step++) {
    const candidate = (from + step) % keys.length;
    if (arrived.has(keys[candidate])) return candidate;
  }
  return null;
}

/** How much of a SLOW fade that began at `beganAt` (epoch ms) is still to run. */
function slowFadeLeft(beganAt: number): number {
  return Math.max(0, SLIDE_FADE_MS - (Date.now() - beganAt));
}

/** Cross-fade slideshow through up to 5 image frames: SLOW at rest, QUICK under
 * a resting mouse/pen pointer (see the file header for why). Pauses at rest on
 * offscreen + prefers-reduced-motion. */
function ImageSlideshow({ assets, className }: { assets: any[]; className?: string }) {
  // Cap to MAX_SLIDESHOW_FRAMES for perf — a 50-image playlist would
  // otherwise mount 50 <img> tags per row.
  const frames = useMemo(() => assets.slice(0, MAX_SLIDESHOW_FRAMES), [assets]);
  const frameKeys = frames.map((asset, idx) => String(asset?.id || idx));
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

  // A mouse/pen pointer that has RESTED here. The 350 ms rest is the hook's own
  // hover intent: it is what tells a pointer that is pointing from one that is
  // crossing on its way elsewhere — a crossing changes nothing at all, not even
  // the slow rotation's clock (the hook starts nothing, and this thumbnail has
  // no state, until the pointer has rested). Touch never gets here.
  const hovered = useHoverPreview(containerRef, { intentMs: IMAGE_PREVIEW_FIRST_STEP_MS });

  // What the quick walk reads when its timer fires — kept here, not in its
  // effect's deps, so a re-render never re-arms the timer. (The frame keys are a
  // fresh array every render; the effect below depends on the count, not them.)
  const live = useRef({ active: 0, keys: frameKeys });
  useEffect(() => { live.current = { active, keys: frameKeys }; });
  // Which pictures have arrived, and the step the walk is holding for one, if any.
  const arrival = useRef<{ keys: Set<string>; wake: (() => void) | null }>({ keys: new Set(), wake: null });
  const pictureArrived = (key: string) => {
    arrival.current.keys.add(key);
    arrival.current.wake?.();
  };
  // When the SLOW rotation last began a fade: a pointer that lands mid-fade lets
  // it finish before the quick walk's first step, so two fades never cut across
  // each other into a three-picture blur.
  const slowFadeBeganAt = useRef(0);

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

  // THE SLOW ROTATION — what runs at rest. Only schedules when running, motion
  // is OK, there's more than one frame to cycle, and no pointer is resting on it
  // (the quick walk below has the wheel then; leaving starts this one afresh from
  // the picture on show). The interval includes both the hold time AND the fade
  // overlap so the next frame is mid-fade when it becomes the "active" layer.
  useEffect(() => {
    if (!running) return;
    if (hovered) return;
    if (reducedMotion) return;
    if (frames.length < 2) return;
    const interval = window.setInterval(() => {
      slowFadeBeganAt.current = Date.now();
      setActive((prev) => (prev + 1) % frames.length);
    }, SLIDE_HOLD_MS);
    return () => window.clearInterval(interval);
  }, [running, hovered, reducedMotion, frames.length]);

  // THE QUICK WALK — only while a pointer rests on it. It steps to the next
  // picture THAT HAS ARRIVED (never to one still loading, never a blank or
  // half-drawn frame; one that never arrives is skipped); if none has, it holds
  // on what is showing and steps the moment one does. Then every
  // HOLD + FADE (1.2 s fully shown, 250 ms fade). It runs under reduced motion
  // too — a person pointing at it asked to see it — but with no fade at all.
  useEffect(() => {
    if (!hovered || frames.length < 2) return;
    const waiting = arrival.current;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const step = () => {
      timer = undefined;
      waiting.wake = null;
      const next = nextArrivedFrame(live.current.active, live.current.keys, waiting.keys);
      if (next === null) {
        waiting.wake = step;
        return;
      }
      live.current.active = next;
      setActive(next);
      timer = setTimeout(step, IMAGE_PREVIEW_HOLD_MS + IMAGE_PREVIEW_FADE_MS);
    };
    const settleIn = slowFadeLeft(slowFadeBeganAt.current);
    if (settleIn === 0) step();
    else timer = setTimeout(step, settleIn);
    return () => {
      if (timer !== undefined) clearTimeout(timer);
      waiting.wake = null;
    };
  }, [hovered, frames.length]);

  if (frames.length === 0) return null;

  const fade = hovered ? (reducedMotion ? 'none' : `opacity ${IMAGE_PREVIEW_FADE_MS}ms ease-in-out`) : `opacity ${SLIDE_FADE_MS}ms ease-in-out`;

  return (
    <div
      ref={containerRef}
      className={`relative overflow-hidden bg-slate-50 ${className || ''}`}
      data-image-slideshow
      data-preview-state={hovered ? 'quick' : 'rest'}
      data-preview-index={active}
    >
      {frames.map((asset, idx) => (
        <div
          key={asset?.id || idx}
          className="absolute top-0 right-0 bottom-0 left-0"
          style={{
            opacity: idx === active ? 1 : 0,
            transition: fade,
            // Only the active frame should receive pointer events,
            // not strictly necessary for non-interactive previews
            // but keeps a11y trees clean.
            pointerEvents: idx === active ? 'auto' : 'none',
          }}
        >
          <StaticAssetFrame asset={asset} className="w-full h-full object-contain" onPictureLoad={() => pictureArrived(frameKeys[idx])} />
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
    const entry = templatePreviewOf(playlist.template) || (tid ? templateLookup?.[tid] : undefined);

    // Tile and list draw the same saved artwork at the heights they always
    // have (180 px in a tile, 40 px in the 56×40 list strip), in the same
    // rounded, bordered card — TemplateContentThumb adds only the hover: an
    // intentional mouse/pen hover runs the template live on top of it. The
    // widget tree is still IO-gated by ScaledTemplateThumbnail itself, so a
    // grid never spins up 100 of them at once.
    if (entry) {
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
          style={size === 'tile' ? { aspectRatio: '16 / 9' } : undefined}
        >
          <div className="absolute top-0 right-0 bottom-0 left-0 flex items-center justify-center">
            <TemplateContentThumb template={entry} name={playlist.name} maxHeight={size === 'tile' ? 180 : 40} framed />
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
  const documentAssets = previewAssets.filter((a) => isDocumentMime(a.mimeType || '', a.fileUrl));

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
                  <StaticAssetFrame asset={a} className="w-full h-full object-contain" />
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
          <StaticAssetFrame asset={imageAssets[0]} className="w-full h-full object-contain" />
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
        <StaticAssetFrame asset={videoAssets[0]} className="w-full h-full object-contain" />
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
        <StaticAssetFrame asset={htmlAssets[0]} className="w-full h-full object-contain" />
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
    // 2026-05-26 round 2 — broaden the PDF check via isPdfAsset()
    // so we catch octet-stream uploads with .pdf filename too.
    const isPdf = isPdfAsset(first);
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
