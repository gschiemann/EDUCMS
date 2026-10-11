/**
 * updateCover — the cover frame's CAPTURE half (2026-10-10, off-hours update).
 *
 * Right before the player navigates onto a new bundle it takes what is on
 * the glass — the active <video> frame or the active slide — into a small
 * JPEG (≤ 480 px wide, q 0.6, a few tens of KB), writes it to sessionStorage
 * with the apply record, and navigates. The next document's inline script
 * (`updateCoverInline.ts`) paints it as its first frame; `removeUpdateCover`
 * takes it down once operator content is on the glass and hands the
 * completed record to the telemetry report.
 *
 * Where a frame cannot be captured — a cross-origin element without CORS
 * taints the canvas, an external website rides a native overlay or an
 * iframe — the cover is a solid frame of the element's dominant colour
 * (its own or an ancestor's computed background; `#000` at worst), never the
 * splash. An <img> that taints is re-fetched once with `crossorigin`
 * (Supabase storage answers CORS), bounded to ~1.5 s; a <video> is not (a
 * second decode of a 4K clip for one frame is not worth it on a signage
 * box) — its cover is the colour.
 *
 * DOM-touching, so the drawing is injectable and the decisions are tested
 * in jsdom (which has no canvas).
 */

import {
  UPDATE_COVER_KEY,
  UPDATE_EVIDENCE_KEY,
  parseUpdateAppliedRecord,
  type UpdateAppliedRecord,
} from './offHoursUpdate';
import { UPDATE_COVER_ATTR } from './updateCoverInline';

export type CoverCapture = UpdateAppliedRecord['capture'];

export interface CoverFrame {
  kind: 'image' | 'color';
  /** `data:image/jpeg;base64,…` when kind is 'image'. */
  data?: string;
  /** Always present — the fill behind the image and the whole frame when kind is 'color'. */
  color: string;
  capture: CoverCapture;
  /** Source size the frame was drawn at (0 when none). */
  w: number;
  h: number;
}

export type CoverSource = HTMLVideoElement | HTMLImageElement;

export interface CaptureOptions {
  maxWidth?: number;
  quality?: number;
  /** A data URL longer than this is refused (sessionStorage is small on old WebViews). */
  maxDataChars?: number;
  refetchBudgetMs?: number;
  fallbackColor?: string;
  /** Draw `source` at w×h and return a JPEG data URL; throw on a tainted canvas. Injectable for tests. */
  render?: (source: CanvasImageSource, w: number, h: number, quality: number) => string | null;
  /** Fetch an image URL with CORS and return a drawable, or null. Injectable for tests. */
  refetch?: (url: string, budgetMs: number) => Promise<CanvasImageSource | null>;
  nowMs?: () => number;
}

export const COVER_MAX_WIDTH = 480;
export const COVER_JPEG_QUALITY = 0.6;
export const COVER_MAX_DATA_CHARS = 400_000;
export const COVER_REFETCH_BUDGET_MS = 1_500;

function isVisible(el: Element): boolean {
  try {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') return false;
    if (cs.opacity !== '' && Number(cs.opacity) === 0) return false;
    return true;
  } catch {
    return false;
  }
}

function area(el: Element): number {
  try {
    const r = el.getBoundingClientRect();
    return r.width * r.height;
  } catch {
    return 0;
  }
}

/**
 * The element whose pixels are on the glass: a decoding <video> first (its
 * frame is what the viewer sees), else the largest visible slide <img>.
 */
export function pickCoverSource(doc: Document): CoverSource | null {
  let best: CoverSource | null = null;
  let bestArea = 0;
  const videos = doc.querySelectorAll('video');
  for (let i = 0; i < videos.length; i++) {
    const v = videos[i];
    if (v.readyState < 2 || !isVisible(v)) continue;
    const a = area(v);
    if (a > bestArea) { best = v; bestArea = a; }
  }
  if (best) return best;
  const imgs = doc.querySelectorAll('img[data-slide-id], img');
  for (let i = 0; i < imgs.length; i++) {
    const im = imgs[i] as HTMLImageElement;
    if (!im.complete || im.naturalWidth === 0 || !isVisible(im)) continue;
    const a = area(im);
    if (a > bestArea) { best = im; bestArea = a; }
  }
  return best;
}

const HEX = /^#[0-9a-fA-F]{3,8}$/;

function rgbToHex(cs: string): string | null {
  const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(cs);
  if (!m) return HEX.test(cs) ? cs : null;
  if (m[4] !== undefined && Number(m[4]) === 0) return null; // transparent
  const h = (n: string) => Number(n).toString(16).padStart(2, '0');
  return `#${h(m[1])}${h(m[2])}${h(m[3])}`;
}

/** The nearest opaque computed background colour up the tree, else the fallback. */
export function dominantColorOf(el: Element | null, fallback = '#000'): string {
  let cur: Element | null = el;
  for (let depth = 0; cur && depth < 12; depth++) {
    try {
      const hex = rgbToHex(getComputedStyle(cur).backgroundColor);
      if (hex) return hex;
    } catch { /* keep climbing */ }
    cur = cur.parentElement;
  }
  return fallback;
}

function defaultRender(source: CanvasImageSource, w: number, h: number, quality: number): string | null {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(source, 0, 0, w, h);
  // Throws SecurityError on a tainted canvas — the caller treats that as "no frame".
  return canvas.toDataURL('image/jpeg', quality);
}

function defaultRefetch(url: string, budgetMs: number): Promise<CanvasImageSource | null> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: CanvasImageSource | null) => { if (!done) { done = true; resolve(v); } };
    try {
      const im = new Image();
      im.crossOrigin = 'anonymous';
      im.onload = () => finish(im);
      im.onerror = () => finish(null);
      // A fresh cache key: the same URL just loaded WITHOUT CORS, and the
      // browser's memory cache would answer this CORS request with that
      // header-less entry and fail it.
      const u = new URL(url, window.location.href);
      u.searchParams.set('edu_cover', '1');
      im.src = u.toString();
      setTimeout(() => finish(null), budgetMs);
    } catch {
      finish(null);
    }
  });
}

function sourceSize(source: CoverSource): { w: number; h: number } {
  if ((source as HTMLVideoElement).videoWidth !== undefined) {
    const v = source as HTMLVideoElement;
    return { w: v.videoWidth || v.clientWidth || 0, h: v.videoHeight || v.clientHeight || 0 };
  }
  const im = source as HTMLImageElement;
  return { w: im.naturalWidth || im.clientWidth || 0, h: im.naturalHeight || im.clientHeight || 0 };
}

/**
 * Capture the cover frame for the content on the glass. Never throws;
 * never takes longer than the refetch budget plus one draw.
 */
export async function captureCoverFrame(doc: Document, opts: CaptureOptions = {}): Promise<CoverFrame> {
  const maxWidth = opts.maxWidth ?? COVER_MAX_WIDTH;
  const quality = opts.quality ?? COVER_JPEG_QUALITY;
  const maxChars = opts.maxDataChars ?? COVER_MAX_DATA_CHARS;
  const render = opts.render ?? defaultRender;
  const refetch = opts.refetch ?? defaultRefetch;
  const fallback = opts.fallbackColor ?? '#000';

  const source = pickCoverSource(doc);
  const color = dominantColorOf(source ?? doc.body, fallback);
  if (!source) return { kind: 'color', color, capture: 'none', w: 0, h: 0 };

  const size = sourceSize(source);
  if (size.w < 2 || size.h < 2) return { kind: 'color', color, capture: 'color', w: 0, h: 0 };
  const scale = Math.min(1, maxWidth / size.w);
  const w = Math.max(1, Math.round(size.w * scale));
  const h = Math.max(1, Math.round(size.h * scale));

  const accept = (data: string | null, capture: 'live' | 'refetch'): CoverFrame | null => {
    if (!data || data.indexOf('data:image/') !== 0 || data.length > maxChars) return null;
    return { kind: 'image', data, color, capture, w, h };
  };

  try {
    const live = accept(render(source, w, h, quality), 'live');
    if (live) return live;
  } catch {
    // Tainted canvas (cross-origin element without CORS) — try the CORS re-fetch below.
  }

  if ((source as HTMLImageElement).naturalWidth !== undefined) {
    const url = (source as HTMLImageElement).currentSrc || (source as HTMLImageElement).src;
    if (url) {
      try {
        const again = await refetch(url, opts.refetchBudgetMs ?? COVER_REFETCH_BUDGET_MS);
        if (again) {
          const re = accept(render(again, w, h, quality), 'refetch');
          if (re) return re;
        }
      } catch {
        // fall through to the colour
      }
    }
  }
  return { kind: 'color', color, capture: 'color', w, h };
}

/** What the applying document writes; the inline script and the next document read it. */
export type UpdateCoverRecord = UpdateAppliedRecord & Pick<CoverFrame, 'kind' | 'data' | 'color' | 'w' | 'h'>;

/** Persist the cover + apply record for the next document. False when storage refused it. */
export function writeUpdateCover(storage: Pick<Storage, 'setItem' | 'removeItem'>, record: UpdateCoverRecord): boolean {
  try {
    storage.setItem(UPDATE_COVER_KEY, JSON.stringify(record));
    return true;
  } catch {
    // Quota (an old WebView's small sessionStorage): keep the record, drop the picture.
    try {
      const { data: _dropped, ...rest } = record;
      void _dropped;
      storage.setItem(UPDATE_COVER_KEY, JSON.stringify({ ...rest, kind: 'color' }));
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Take the cover down (the new document proved content on the glass).
 * Idempotent. Moves the completed record — with `contentAtMs` stamped — from
 * the cover key to the evidence key, where the telemetry tick picks it up,
 * and returns it. Returns null when there was no cover to remove.
 */
export function removeUpdateCover(doc: Document, storage: Storage | null, nowMs: number): UpdateAppliedRecord | null {
  const html = doc.documentElement;
  const hadAttr = !!html.getAttribute(UPDATE_COVER_ATTR);
  let record: UpdateAppliedRecord | null = null;
  try {
    record = parseUpdateAppliedRecord(storage?.getItem(UPDATE_COVER_KEY));
  } catch { /* storage unreadable */ }
  if (hadAttr) {
    try {
      const w = doc.defaultView as (Window & { __eduUpdateCover?: { clear?: () => void } }) | null;
      if (w?.__eduUpdateCover?.clear) w.__eduUpdateCover.clear();
    } catch { /* fall through to the direct clear */ }
    try {
      html.removeAttribute(UPDATE_COVER_ATTR);
      html.style.backgroundImage = '';
      html.style.backgroundColor = '';
      html.style.backgroundRepeat = '';
      html.style.backgroundSize = '';
      html.style.backgroundPosition = '';
    } catch { /* nothing to clear */ }
  }
  if (!record) return null;
  const { data: _picture, ...rest } = record as UpdateAppliedRecord & { data?: string };
  void _picture;
  const completed: UpdateAppliedRecord = { ...rest, contentAtMs: nowMs };
  try {
    storage?.setItem(UPDATE_EVIDENCE_KEY, JSON.stringify(completed));
    storage?.removeItem(UPDATE_COVER_KEY);
  } catch { /* best effort */ }
  return completed;
}
