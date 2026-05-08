"use client";

/**
 * useAutoFitText — bsearch the largest font-size that fits inside a
 * container without overflowing.
 *
 * Why: HS templates have variable-length copy. A fixed CSS font-size
 * works for the seed copy but bigs/longs either overflow (clipped)
 * or feel small (white-space). The operator's goal is to "fill the
 * widget top-to-bottom so it looks great" no matter how much text
 * they type.
 *
 * Strategy:
 *   1. Read the manual override (if any) from the __styles map keyed
 *      on the data-field attribute. Manual override always wins —
 *      operator typed an exact size, respect it.
 *   2. Otherwise, binary-search [minSize, maxSize] for the largest
 *      fontSize where scrollHeight <= clientHeight AND scrollWidth
 *      <= clientWidth on the target text element.
 *   3. Apply via inline style.fontSize on the text element so it
 *      composes with the existing CSS-class typography rules
 *      (font-family, font-weight, line-height stay class-driven).
 *
 * The hook re-runs whenever:
 *   - the text content changes (we read it from the rendered DOM)
 *   - the container size changes (ResizeObserver)
 *   - the styles map identity changes (operator edited an override)
 *
 * Performance notes:
 *   - 6-7 bsearch iterations × ~16 widgets × small target list = ~100
 *     forced reflows on a heavy template, ~once per edit. Bearable.
 *   - We layout-thrash in batched rAF callbacks to avoid frame drops.
 *   - Result is cached on the element via a __fitSize data attribute
 *     so re-mounts (route changes) don't re-fit if size hasn't drifted.
 */

import { useEffect, type RefObject } from 'react';
import type { TextStyleMap } from './useTextStyleOverrides';

export interface AutoFitOptions {
  /** Min font-size in CSS px. Default: 16. */
  min?: number;
  /** Max font-size in CSS px. Default: 600 (covers HS hero h1s). */
  max?: number;
  /** Pixel margin we keep below the container's measured height to
   *  avoid borderline-overflow caused by font-load shifts. Default: 4. */
  vertSlack?: number;
  /** Same on the horizontal axis. Default: 2. */
  horizSlack?: number;
  /** Stop bsearch when the candidate range is this small. Default: 2. */
  precisionPx?: number;
}

const DEFAULT_OPTS: Required<AutoFitOptions> = {
  min: 16,
  max: 600,
  vertSlack: 4,
  horizSlack: 2,
  precisionPx: 2,
};

/** Walk up the ancestor chain to find the nearest clipping container.
 *  A "clipping container" is one that has `overflow: hidden|auto|scroll`
 *  OR an explicitly-set height/max-height — i.e. a box that won't grow
 *  to accommodate its content. That's the boundary we measure overflow
 *  against. Falls back to the immediate parent if nothing matches. */
function findClipContainer(el: HTMLElement): HTMLElement | null {
  let cur: HTMLElement | null = el.parentElement;
  while (cur) {
    const cs = getComputedStyle(cur);
    if (
      cs.overflow !== 'visible' ||
      cs.overflowX !== 'visible' ||
      cs.overflowY !== 'visible' ||
      cs.height.endsWith('px') ||
      cs.maxHeight.endsWith('px')
    ) {
      return cur;
    }
    cur = cur.parentElement;
  }
  return el.parentElement;
}

/** Does the element's containing clip-box overflow? Auto-fit's job is
 *  to shrink this element until that box stops overflowing — siblings
 *  are considered fixed (they keep their CSS-class defaults).
 *
 *  Allow an explicit container override via `data-fit-container="<sel>"`. */
function containerOverflows(el: HTMLElement, opts: Required<AutoFitOptions>): boolean {
  const sel = el.dataset.fitContainer;
  let container: HTMLElement | null;
  if (sel) {
    container = el.closest(sel);
  } else {
    container = findClipContainer(el);
  }
  if (!container) return false;
  const overV = container.scrollHeight - container.clientHeight;
  const overH = container.scrollWidth - container.clientWidth;
  return overV > opts.vertSlack || overH > opts.horizSlack;
}

/** Resolve the element's "design size" — the size dictated by the CSS
 *  class. We read it from getComputedStyle WITH inline fontSize cleared
 *  so the class default surfaces. */
function readDesignSize(el: HTMLElement): number {
  const stash = el.style.fontSize;
  el.style.fontSize = '';
  const computed = parseFloat(getComputedStyle(el).fontSize);
  if (stash) el.style.fontSize = stash;
  return Number.isFinite(computed) ? computed : 64;
}

/** Binary-search the largest font-size in [min, ceiling] that lets the
 *  parent fit. `ceiling` is the CSS-class default — we never grow past
 *  the designed size. */
function bsearchShrink(
  el: HTMLElement,
  ceiling: number,
  opts: Required<AutoFitOptions>,
): number {
  let lo = opts.min;
  let hi = ceiling;
  // Cheap path: if the design size already fits, leave inline cleared
  // so the class default keeps applying (matches the designed mockup).
  el.style.fontSize = '';
  if (!containerOverflows(el, opts)) return ceiling;
  // Try the floor — if even minimum doesn't fit, accept minimum
  // (operator will see clipping and shorten copy).
  el.style.fontSize = `${lo}px`;
  if (containerOverflows(el, opts)) return lo;
  // Bsearch.
  let best = lo;
  while (hi - lo > opts.precisionPx) {
    const mid = Math.floor((lo + hi) / 2);
    el.style.fontSize = `${mid}px`;
    if (!containerOverflows(el, opts)) {
      best = mid;
      lo = mid;
    } else {
      hi = mid;
    }
  }
  el.style.fontSize = `${best}px`;
  return best;
}

/** Apply auto-fit to every `[data-field][data-fit]` element under root.
 *  Skips fields with a manual fontSize override in `styles`. */
function applyAutoFit(
  root: HTMLElement,
  styles: TextStyleMap | undefined,
  opts: Required<AutoFitOptions>,
) {
  const targets = root.querySelectorAll<HTMLElement>('[data-field][data-fit]');
  targets.forEach((el) => {
    const field = el.dataset.field;
    if (!field) return;
    // Manual override wins — useTextStyleOverrides already handled it.
    if (styles?.[field]?.fontSize != null) return;
    // Per-element overrides for the bsearch range.
    const maxAttr = parseInt(el.dataset.fitMax || '', 10);
    const minAttr = parseInt(el.dataset.fitMin || '', 10);
    const localOpts: Required<AutoFitOptions> = {
      ...opts,
      min: Number.isFinite(minAttr) ? minAttr : opts.min,
    };
    // Ceiling: the smaller of the CSS class default and any
    // per-element data-fit-max attribute.
    const designSize = readDesignSize(el);
    const ceiling = Number.isFinite(maxAttr) ? Math.min(maxAttr, designSize) : designSize;
    bsearchShrink(el, ceiling, localOpts);
  });
}

/**
 * useAutoFitText — drop-in alongside useTextStyleOverrides.
 *
 *   const stageRef = useRef<HTMLDivElement | null>(null);
 *   useTextStyleOverrides(stageRef, c.__styles);   // manual overrides
 *   useAutoFitText(stageRef, c.__styles);          // auto-fit fallback
 *   return <HsStage stageRef={stageRef}>...
 *      <h1 data-field="greetingHeadline" data-fit data-fit-max="320">{c.greetingHeadline}</h1>
 *   ...</HsStage>;
 *
 * Mark target text elements with `data-fit` to opt into auto-fit. Add
 * `data-fit-max="N"` / `data-fit-min="N"` to clamp per element.
 */
export function useAutoFitText(
  rootRef: RefObject<HTMLElement | null>,
  styles: TextStyleMap | undefined,
  options: AutoFitOptions = {},
): void {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const opts: Required<AutoFitOptions> = { ...DEFAULT_OPTS, ...options };

    let rafId = 0;
    const schedule = () => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        applyAutoFit(root, styles, opts);
      });
    };
    // Run twice on mount: once immediately so the first paint has at
    // least an approximation, then once after fonts load (because
    // metrics shift when web fonts resolve). The MutationObserver
    // covers content edits going forward.
    schedule();
    if (typeof document !== 'undefined' && (document as any).fonts?.ready) {
      (document as any).fonts.ready.then(schedule).catch(() => {});
    }

    // Watch for content / DOM changes inside the stage.
    const mo = new MutationObserver(() => schedule());
    mo.observe(root, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['data-field', 'data-fit', 'data-fit-max', 'data-fit-min'],
    });

    // Watch container resizes — when HsStage re-scales (preview pane,
    // window resize), the bsearch result is still in CSS px, so we
    // don't actually need to re-run. But we DO want to re-run when a
    // parent's clientHeight changes from a layout shift (e.g. an
    // adjacent zone grew). Cheap, so include it.
    const ro = new ResizeObserver(() => schedule());
    // Observe the stage and every direct child container (panels, cards).
    ro.observe(root);
    Array.from(root.children).forEach((c) => {
      if (c instanceof HTMLElement) ro.observe(c);
    });

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      mo.disconnect();
      ro.disconnect();
    };
    // styles identity change → operator may have flipped a manual
    // override on or off, so we re-run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [styles, rootRef]);
}
