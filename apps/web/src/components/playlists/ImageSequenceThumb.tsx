"use client";

import { useCallback, useEffect, useReducer, useRef, type SyntheticEvent } from 'react';
import { useTranslations } from 'next-intl';
import { transformedImageUrl } from '@/lib/asset-image';
import { useHoverPreview } from '@/lib/use-hover-preview';

export interface ImagePreviewFrame { url: string }

/**
 * How long each picture is held while the operator hovers. The owner gets
 * headaches from fast-moving thumbnails: long enough to actually read the
 * picture, never a flicker.
 */
export const IMAGE_PREVIEW_HOLD_MS = 2500;
/** The soft hand-off between two pictures. Under prefers-reduced-motion there is no fade at all. */
export const IMAGE_PREVIEW_FADE_MS = 300;
export const MAX_PREVIEW_FRAMES = 5;

/**
 * ImageSequenceThumb — a playlist's first image at rest; on an intentional
 * mouse/pen hover, a short walk through its images.
 *
 * What it promises (the owner's standing rules for previews):
 *   - NOTHING MOVES AT REST. No timer or observer, and no listener beyond the
 *     hover listeners themselves: see `useHoverPreview` for the rest (mouse/pen
 *     only, one preview on the page at a time, stops on leave / hidden tab /
 *     scrolled away).
 *   - THE WHOLE IMAGE. `object-contain`, letterboxed — never cropped to fill.
 *   - CALM. 2.5 s on each picture, a 300 ms cross-fade (none under
 *     prefers-reduced-motion — it still steps).
 *   - AT MOST TWO <img> AT A TIME: the picture on show, and the next one,
 *     preloaded invisibly so the step never waits on the network. A picture
 *     that fails to load is skipped for the rest of this mount; it is never
 *     retried in a loop.
 *   - LEAVING RESETS to the first picture.
 *   - NOTHING DRAWN OVER THE PICTURE. No count badge: these thumbnails can be
 *     28 px wide, and a "+3" chip would hide a third of the image the owner
 *     wants to see whole. (The playlist library's slideshow, which has room for
 *     one, keeps its own "+N".)
 *
 * One image (or none): a plain still, with no listeners at all.
 */
export function ImageSequenceThumb({ frames, name, className = '' }: { frames: ImagePreviewFrame[]; name?: string | null; className?: string }) {
  const t = useTranslations('playlistsPage');
  const usable = frames.filter((frame) => !!frame.url);
  const shown = usable.slice(0, MAX_PREVIEW_FRAMES).map((frame) => ({ ...frame, url: transformedImageUrl(frame.url, { width: 320, quality: 60 }) }));
  const label = name ? t('imageSequenceOf', { name }) : t('imageSequence');
  // A different set of pictures is a different thumbnail: start over, with no
  // run, hover state or failure memory carried across.
  const signature = shown.map((frame) => frame.url).join('|');
  if (shown.length < 2) return <Still key={signature} url={shown[0]?.url} label={label} className={className} />;
  return <Sequence key={signature} frames={shown} label={label} className={className} />;
}

const BASE = 'relative block overflow-hidden bg-slate-100';

/**
 * Is this `error` only the cue for the app-wide thumbnail fallback?
 *
 * `installThumbTransformFallback` (asset-image.ts, mounted in providers.tsx)
 * listens for image errors in the CAPTURE phase and, for a failed Supabase
 * transform URL, points the same element back at the original file — so by the
 * time our own handler runs, a retry is already under way. Treating that first
 * error as the end would hide, or skip, a picture that is about to load. Only a
 * SECOND error — the original failed too — is a real failure.
 */
function transformRetryUnderway(img: HTMLImageElement): boolean {
  if (img.dataset.thumbFallback === '1' && !img.dataset.sequenceRetry) {
    img.dataset.sequenceRetry = '1';
    return true;
  }
  return false;
}

/** One picture (or none): no hover, no observer, nothing to run. */
function Still({ url, label, className }: { url?: string; label: string; className: string }) {
  return (
    <span className={`${BASE} ${className}`} role="img" aria-label={label}>
      {url && (
        // load/error are the image's own lifecycle events, not a user
        // interaction with a non-interactive element — the a11y rule's premise.
        // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/no-noninteractive-element-interactions
        <img
          src={url}
          alt=""
          className="absolute top-0 right-0 bottom-0 left-0 w-full h-full object-contain"
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={(event) => { if (!transformRetryUnderway(event.currentTarget)) event.currentTarget.style.visibility = 'hidden'; }}
        />
      )}
    </span>
  );
}

// ── The state machine ───────────────────────────────────────────────────────
// Pure and exported so the awkward cases (a picture that never loads, a hold
// that ends before the next picture is ready) are tested without a browser.

export interface SequenceState {
  running: boolean;
  count: number;
  /** The picture on show, and the element that draws it. */
  active: number;
  activeKey: string;
  /** The standby picture (null = nothing left that can be shown), preloading invisibly. */
  next: number | null;
  nextKey: string | null;
  nextReady: boolean;
  /** The current picture has been held for the full hold. */
  holdDone: boolean;
  /** The standby is cross-fading in. */
  fading: boolean;
  /** Pictures that would not load. Skipped for the life of this mount. */
  failed: readonly number[];
  /** Makes every standby a FRESH element: a reused element whose src did not
   *  change fires no new `load`, and the sequence would wait on it forever. */
  serial: number;
}

export type SequenceEvent =
  | { type: 'start' }
  | { type: 'stop' }
  | { type: 'holdElapsed'; reduced: boolean }
  | { type: 'loaded'; key: string; reduced: boolean }
  | { type: 'failed'; key: string }
  | { type: 'faded' };

export function initialSequence(count: number): SequenceState {
  return { running: false, count, active: 0, activeKey: '0.0', next: null, nextKey: null, nextReady: false, holdDone: false, fading: false, failed: [], serial: 0 };
}

/** The next picture that has not failed, walking forward from `from` and wrapping; null when none is left. */
export function pickNext(from: number, count: number, failed: readonly number[]): number | null {
  for (let step = 1; step < count; step++) {
    const candidate = (from + step) % count;
    if (!failed.includes(candidate)) return candidate;
  }
  return null;
}

const indexOfKey = (key: string) => Number(key.split('.')[0]);

/** The standby becomes the picture on show; a fresh standby is chosen. */
function swap(state: SequenceState): SequenceState {
  if (state.next === null || state.nextKey === null) return state;
  const serial = state.serial + 1;
  const next = pickNext(state.next, state.count, state.failed);
  return {
    ...state,
    active: state.next,
    activeKey: state.nextKey,
    next,
    nextKey: next === null ? null : `${next}.${serial}`,
    nextReady: false,
    holdDone: false,
    fading: false,
    serial,
  };
}

/** Both conditions are met (held long enough, next picture ready): step. */
function advance(state: SequenceState, reduced: boolean): SequenceState {
  if (!state.running || state.next === null || state.fading) return state;
  return reduced ? swap(state) : { ...state, fading: true };
}

export function sequenceReducer(state: SequenceState, event: SequenceEvent): SequenceState {
  switch (event.type) {
    case 'start': {
      if (state.running) return state;
      const serial = state.serial + 1;
      const next = pickNext(state.active, state.count, state.failed);
      return { ...state, running: true, next, nextKey: next === null ? null : `${next}.${serial}`, nextReady: false, holdDone: false, fading: false, serial };
    }
    case 'stop': {
      // Back to the first picture. If it is already on show, keep its element.
      const serial = state.active === 0 ? state.serial : state.serial + 1;
      return {
        ...initialSequence(state.count),
        failed: state.failed,
        serial,
        activeKey: state.active === 0 ? state.activeKey : `0.${serial}`,
      };
    }
    case 'holdElapsed': {
      if (!state.running || state.holdDone) return state;
      const held = { ...state, holdDone: true };
      return state.nextReady ? advance(held, event.reduced) : held;
    }
    case 'loaded': {
      if (!state.running || event.key !== state.nextKey || state.nextReady) return state;
      const ready = { ...state, nextReady: true };
      return state.holdDone ? advance(ready, event.reduced) : ready;
    }
    case 'failed': {
      const index = indexOfKey(event.key);
      if (Number.isNaN(index) || state.failed.includes(index)) return state;
      const failed = [...state.failed, index];
      if (event.key === state.activeKey) return { ...state, failed };
      if (event.key !== state.nextKey) return state;
      // The standby will not load: skip it for good and take the one after.
      const serial = state.serial + 1;
      const next = pickNext(state.active, state.count, failed);
      return { ...state, failed, next, nextKey: next === null ? null : `${next}.${serial}`, nextReady: false, serial };
    }
    case 'faded':
      return state.fading ? swap(state) : state;
  }
}

function prefersReducedMotion(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

function Sequence({ frames, label, className }: { frames: ImagePreviewFrame[]; label: string; className: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [state, dispatch] = useReducer(sequenceReducer, frames.length, initialSequence);
  const onHover = useCallback((on: boolean) => dispatch({ type: on ? 'start' : 'stop' }), []);
  useHoverPreview(ref, { onChange: onHover });

  // Hold the picture on show. The timer runs only while a hover is running and
  // there is a standby to step to. A STEP restarts it — `activeKey` is in the
  // deps for exactly that: under reduced motion a step goes straight from
  // "holding" to "holding the next picture" with every other dependency
  // unchanged, and without it the hold of the second picture would never start.
  // A standby swapped for another after a failure does NOT restart it (the
  // picture on show has been held that long already).
  const hasNext = state.next !== null;
  useEffect(() => {
    if (!state.running || !hasNext || state.holdDone || state.fading) return;
    const timer = setTimeout(() => dispatch({ type: 'holdElapsed', reduced: prefersReducedMotion() }), IMAGE_PREVIEW_HOLD_MS);
    return () => clearTimeout(timer);
  }, [state.running, state.activeKey, hasNext, state.holdDone, state.fading]);

  // The cross-fade is over: the standby is the picture on show.
  useEffect(() => {
    if (!state.fading) return;
    const timer = setTimeout(() => dispatch({ type: 'faded' }), IMAGE_PREVIEW_FADE_MS);
    return () => clearTimeout(timer);
  }, [state.fading]);

  const onLoad = (key: string) => dispatch({ type: 'loaded', key, reduced: prefersReducedMotion() });
  const onError = (key: string, event: SyntheticEvent<HTMLImageElement>) => {
    if (transformRetryUnderway(event.currentTarget)) return;
    dispatch({ type: 'failed', key });
  };

  const shown: Array<{ key: string; index: number; standby: boolean }> = [];
  if (!state.failed.includes(state.active)) shown.push({ key: state.activeKey, index: state.active, standby: false });
  if (state.next !== null && state.nextKey !== null) shown.push({ key: state.nextKey, index: state.next, standby: true });

  return (
    <span
      ref={ref}
      className={`${BASE} ${className}`}
      role="img"
      aria-label={label}
      data-image-sequence
      data-preview-index={state.active}
      data-preview-state={state.running ? 'running' : 'rest'}
    >
      {shown.map(({ key, index, standby }) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={key}
          src={frames[index].url}
          alt=""
          draggable={false}
          decoding="async"
          loading={standby ? 'eager' : 'lazy'}
          className="absolute top-0 right-0 bottom-0 left-0 w-full h-full object-contain pointer-events-none"
          style={standby ? { opacity: state.fading ? 1 : 0, transition: state.fading ? `opacity ${IMAGE_PREVIEW_FADE_MS}ms ease-in-out` : 'none' } : undefined}
          aria-hidden={standby ? true : undefined}
          onLoad={() => onLoad(key)}
          onError={(event) => onError(key, event)}
        />
      ))}
    </span>
  );
}
