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
 *  • Right edge aligned to the trigger's right edge, clamped inside the
 *    viewport with an 8px margin.
 *  • Opens BELOW the trigger; flips ABOVE when the panel would cross the
 *    bottom of the viewport and there is room above.
 *  • First paint is measured invisibly (visibility: hidden at 0,0), so the
 *    flip decision uses the panel's real height — no estimate, no jump.
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
  anchor: { top: number; bottom: number; right: number },
  panel: { width: number; height: number },
  viewport: { width: number; height: number },
): Placement {
  const below = anchor.bottom + GAP;
  const above = anchor.top - GAP - panel.height;
  const fitsBelow = below + panel.height <= viewport.height - VIEWPORT_MARGIN;
  const top = fitsBelow || above < VIEWPORT_MARGIN ? below : above;
  const left = Math.max(
    VIEWPORT_MARGIN,
    Math.min(anchor.right - panel.width, viewport.width - panel.width - VIEWPORT_MARGIN),
  );
  return { top, left };
}

export function AnchoredMenu({ anchorRef, open, width = 208, ariaLabel, className, children }: AnchoredMenuProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);

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
      setPlacement(
        placeAnchoredMenu(
          { top: r.top, bottom: r.bottom, right: r.right },
          { width, height: panel.offsetHeight },
          { width: window.innerWidth, height: window.innerHeight },
        ),
      );
    };
    compute();
    window.addEventListener('resize', compute);
    window.addEventListener('scroll', compute, true);
    return () => {
      window.removeEventListener('resize', compute);
      window.removeEventListener('scroll', compute, true);
    };
  }, [open, anchorRef, width]);

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
