'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';

/**
 * useHoverPreview — the ONE definition of "this thumbnail is being previewed".
 *
 * A thumbnail that does something on hover (steps through a playlist's images,
 * runs a template's own carousel) is a small animation the operator did not
 * ask for until they pointed at it. The owner reads these pages all day and
 * gets headaches from motion, so the rules are not per-component taste — they
 * are here once, and both previews use them:
 *
 *   - MOUSE OR PEN ONLY. A finger tap arrives as `pointerType: 'touch'` and is
 *     ignored: a phone keeps the saved picture and the tap does whatever the
 *     tile does (open it, select it).
 *   - ONE AT A TIME, EVERYWHERE. Previews share a single lease. When a second
 *     thumbnail starts, the first is stopped — even if its `pointerleave` was
 *     lost (a window switch, a row re-rendered under a still cursor). A table
 *     of forty thumbnails can therefore never have two running.
 *   - IT STOPS. On leaving, when the tab is hidden, and when the thumbnail
 *     scrolls out of view while the cursor is parked on it.
 *   - NOTHING RUNS AT REST. No timer, no observer, no document listener exists
 *     until a hover begins: an idle page costs two element listeners per
 *     thumbnail and nothing else. (The one timer that can exist is the optional
 *     hover-intent delay below, and it only exists while the pointer is on the
 *     thumbnail.)
 *   - OPTIONAL HOVER INTENT (`intentMs`). A preview that is expensive to start
 *     (a live template render is a whole document) should not start for a
 *     cursor that is merely crossing the row on its way to a button. The
 *     pointer must rest for `intentMs` first. The same wait is also how a
 *     preview that CHANGES what is on show tells pointing from crossing: the
 *     playlist library's image slideshow (quick under a resting pointer, slow at
 *     rest) uses it so a pointer crossing the tile leaves no trace — nothing
 *     starts, no state changes, not even the slow rotation's clock. A touch
 *     never starts the wait, a new entry restarts it, and a tab that went hidden
 *     during it starts nothing.
 *
 * Returns whether the preview is running. `onChange` fires on every start and
 * stop, for a consumer that keeps its own state machine (reset on stop).
 */

export interface HoverPreviewOptions {
  /** How long the pointer must rest on the thumbnail before the preview starts. Default 0. */
  intentMs?: number;
  /** Called with `true` when the preview starts and `false` when it stops. */
  onChange?: (active: boolean) => void;
}

interface Lease {
  stop: () => void;
}

/** The single running preview, if any. Module state on purpose: it is a page-wide rule. */
let holder: Lease | null = null;

function claim(next: Lease) {
  if (holder && holder !== next) holder.stop();
  holder = next;
}

function release(lease: Lease) {
  if (holder === lease) holder = null;
}

export function useHoverPreview(
  ref: RefObject<HTMLElement | null>,
  { intentMs = 0, onChange }: HoverPreviewOptions = {},
): boolean {
  const [active, setActive] = useState(false);
  // The latest callback, without re-subscribing every listener when it changes.
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let on = false;
    let intent: ReturnType<typeof setTimeout> | undefined;
    let observer: IntersectionObserver | undefined;

    const lease: Lease = { stop: () => stop() };

    const set = (next: boolean) => {
      if (on === next) return;
      on = next;
      setActive(next);
      onChangeRef.current?.(next);
    };

    const onVisibility = () => { if (document.hidden) stop(); };

    function stop() {
      if (intent !== undefined) { clearTimeout(intent); intent = undefined; }
      observer?.disconnect();
      observer = undefined;
      document.removeEventListener('visibilitychange', onVisibility);
      release(lease);
      set(false);
    }

    const begin = () => {
      intent = undefined;
      if (document.hidden) return;
      claim(lease);
      document.addEventListener('visibilitychange', onVisibility);
      if (typeof IntersectionObserver !== 'undefined') {
        observer = new IntersectionObserver((entries) => {
          // The latest entry is the current truth; an earlier one may be stale.
          const latest = entries[entries.length - 1];
          if (latest && !latest.isIntersecting) stop();
        });
        observer.observe(el);
      }
      set(true);
    };

    const enter = (event: PointerEvent) => {
      // A tap is not a hover. (An empty pointerType — some old WebViews — is let through.)
      if (event.pointerType === 'touch') return;
      if (on || intent !== undefined) return;
      if (intentMs > 0) intent = setTimeout(begin, intentMs);
      else begin();
    };

    el.addEventListener('pointerenter', enter);
    el.addEventListener('pointerleave', stop);
    el.addEventListener('pointercancel', stop);
    return () => {
      el.removeEventListener('pointerenter', enter);
      el.removeEventListener('pointerleave', stop);
      el.removeEventListener('pointercancel', stop);
      stop();
    };
  }, [ref, intentMs]);

  return active;
}
