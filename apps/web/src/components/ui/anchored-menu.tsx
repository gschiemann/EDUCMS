'use client';

import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';

/**
 * A menu panel that can never be clipped by its container.
 *
 * 2026-09-02 (Screens page, operator report): the row "⋮" menu near the
 * bottom of the list lost its lower items under the card's rounded edge.
 * Cause: the panel was a `position: absolute` child of the row, and the
 * table lives inside a `rounded-2xl … overflow-hidden` card — anything
 * past the card's bottom edge is cut off. Any menu rendered INSIDE a
 * scrolling or overflow-clipped ancestor has this problem; the only
 * position immune to every clipping and stacking ancestor is a portal into
 * `document.body` with `position: fixed` coordinates taken from the
 * trigger's bounding rect (the pattern `ui/color-picker.tsx` already uses).
 *
 * Behaviour:
 *  • Right edge aligned to the trigger's right edge (or the LEFT edges, with
 *    `align="left"`), clamped inside the viewport with an 8px margin.
 *  • Opens BELOW the trigger; flips ABOVE when the panel would cross the
 *    bottom of the viewport and there is room above.
 *  • First paint is measured invisibly (visibility: hidden at 0,0), so the
 *    flip decision uses the panel's real height — no estimate, no jump.
 *    ⚠️ That MUST stay `visibility: hidden`, never `display: none`. A
 *    visibility-hidden box still has layout, which is both how the height is
 *    measurable here and why a caller can set `scrollTop` on panel content
 *    during this phase (TimeField centres its 96-row list that way, in every
 *    engine). What visibility-hidden does NOT allow is FOCUS — hence
 *    `onPlaced` below.
 *  • Re-positions on scroll (captured, so any scrolling ancestor counts)
 *    and on resize while open.
 *  • Carries `data-popover-panel` so the callers' existing outside-click
 *    rule (`event.target.closest('[data-popover-panel]')`) still treats a
 *    click inside the panel as inside — `closest` walks the PORTAL's DOM,
 *    where the attribute lives, not the React tree.
 *
 * The caller owns open state, the trigger (`data-popover-trigger`,
 * `aria-expanded`) and the items; this component owns nothing but the
 * panel's placement.
 */
export interface AnchoredMenuProps {
  /** The element the panel hangs from — usually the "⋮" button. */
  anchorRef: RefObject<HTMLElement | null>;
  open: boolean;
  /** Panel width in px. Default 208 (Tailwind w-52). */
  width?: number;
  /**
   * Which edge the panel lines up with. Default `'right'` — the "⋮" menus
   * this was built for hang off the right of a narrow trigger. A panel that
   * drops from a FULL-WIDTH field (TimeField / DateField) wants `'left'`, so
   * it starts where the field starts instead of ending where the field ends.
   */
  align?: 'right' | 'left';
  /**
   * Fired ONCE per open, after the measured placement has actually been
   * committed to the DOM.
   *
   * 2026-09-21: the first paint is deliberately `visibility: hidden` at 0,0
   * so the flip decision can measure the panel's real height — and an element
   * inside a `visibility: hidden` ancestor CANNOT take focus. A caller that
   * focuses panel content when `open` flips true therefore calls `.focus()`
   * into a silent no-op, with nothing retrying once the panel lands (the
   * DateField keyboard-entry bug, reproduced in Chromium and Firefox). Focus
   * panel content from here instead of from `open`, and never with a timer.
   *
   * Not fired again on a scroll/resize re-place — only on the next open.
   */
  onPlaced?: () => void;
  /** Accessible name for the panel (`role="group"`). */
  ariaLabel?: string;
  /** Extra classes on the panel (the base look is the shared card style). */
  className?: string;
  children: ReactNode;
}

interface Placement {
  top: number;
  left: number;
}

const VIEWPORT_MARGIN = 8;
const GAP = 4;

/** Pure placement rule — exported for the unit test. */
export function placeAnchoredMenu(
  anchor: { top: number; bottom: number; right: number; left?: number },
  panel: { width: number; height: number },
  viewport: { width: number; height: number },
  align: 'right' | 'left' = 'right',
): Placement {
  const below = anchor.bottom + GAP;
  const above = anchor.top - GAP - panel.height;
  const fitsBelow = below + panel.height <= viewport.height - VIEWPORT_MARGIN;
  const top = fitsBelow || above < VIEWPORT_MARGIN ? below : above;
  // `left` is optional so the two existing right-aligned callers keep their
  // three-key anchor object; it is only read when align === 'left'.
  const wanted = align === 'left' ? anchor.left ?? anchor.right - panel.width : anchor.right - panel.width;
  const left = Math.max(
    VIEWPORT_MARGIN,
    Math.min(wanted, viewport.width - panel.width - VIEWPORT_MARGIN),
  );
  return { top, left };
}

export function AnchoredMenu({ anchorRef, open, width = 208, align = 'right', onPlaced, ariaLabel, className, children }: AnchoredMenuProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const placedRef = useRef(false);

  useLayoutEffect(() => {
    if (!open) {
      setPlacement(null);
      return;
    }
    const compute = () => {
      const anchor = anchorRef.current;
      const panel = panelRef.current;
      if (!anchor || !panel) return;
      const r = anchor.getBoundingClientRect();
      const next = placeAnchoredMenu(
        { top: r.top, bottom: r.bottom, right: r.right, left: r.left },
        { width, height: panel.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight },
        align,
      );
      // Bail out when nothing moved. The captured scroll listener fires for
      // scrolls INSIDE the panel too (TimeField's 96-row list scrolls), and
      // a fresh object every wheel tick would re-render the whole menu per
      // event. Identity-stable state keeps that free.
      setPlacement((prev) => (prev && prev.top === next.top && prev.left === next.left ? prev : next));
    };
    compute();
    window.addEventListener('resize', compute);
    window.addEventListener('scroll', compute, true);
    return () => {
      window.removeEventListener('resize', compute);
      window.removeEventListener('scroll', compute, true);
    };
  }, [open, anchorRef, width, align]);

  // Announce "the panel is now where it belongs, and visible". This runs in a
  // SEPARATE layout effect on purpose: the one above computes the placement,
  // and the style that drops `visibility: hidden` is only on the DOM after
  // that state lands — so firing from inside `compute()` would still be too
  // early for a caller that wants to focus something.
  useLayoutEffect(() => {
    if (!open) {
      placedRef.current = false;
      return;
    }
    if (!placement || placedRef.current) return;
    placedRef.current = true;
    onPlaced?.();
  }, [open, placement, onPlaced]);

  if (!open || typeof document === 'undefined') return null;

  const style: CSSProperties = placement
    ? { position: 'fixed', top: placement.top, left: placement.left, width }
    : { position: 'fixed', top: 0, left: 0, width, visibility: 'hidden' };

  return createPortal(
    <div
      ref={panelRef}
      // `group`, not `menu`: a WAI-ARIA menu must contain menuitems and the
      // callers' items are plain buttons/links (the a11y ratchet would flag
      // aria-required-children). The callers keep their own roles.
      role="group"
      aria-label={ariaLabel}
      data-popover-panel
      data-anchored-menu
      style={style}
      className={`z-[10000] bg-white rounded-xl border border-slate-200 shadow-lg overflow-hidden text-left ${className ?? ''}`}
    >
      {children}
    </div>,
    document.body,
  );
}
