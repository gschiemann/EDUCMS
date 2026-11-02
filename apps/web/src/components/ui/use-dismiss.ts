'use client';

import { useEffect, type RefObject } from 'react';

/**
 * Close an AnchoredMenu on an outside press or Escape — the rule every "⋯"
 * menu in the dashboard already used (a press inside `[data-popover-panel]`
 * or on the trigger counts as inside, because the panel is a portal).
 */
export function useDismiss(open: boolean, anchor: RefObject<HTMLElement | null>, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      const el = e.target as Element | null;
      if (el?.closest?.('[data-popover-panel]') || anchor.current?.contains(el as Node)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { close(); anchor.current?.focus(); }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown, { passive: true });
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, anchor, close]);
}
