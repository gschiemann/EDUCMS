'use client';

import { useEffect, useRef } from 'react';

/**
 * How close an alert or a pin click brings the map: street level, tight
 * enough that the place is unmistakable, wide enough to keep its block in
 * view. Never zooms OUT — an operator already closer keeps their frame.
 */
export const FOCUS_ZOOM = 14;

/**
 * Move keyboard focus (and the scroll) onto the fix block each time `nonce`
 * advances — after the card has rendered it. A ref that is null (nothing to
 * fix at that place) is a no-op.
 */
export function useFocusOnNonce<T extends HTMLElement>(nonce: number) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (nonce === 0) return;
    const id = requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.focus({ preventScroll: true });
      el.scrollIntoView?.({ block: 'nearest' });
    });
    return () => cancelAnimationFrame(id);
  }, [nonce]);
  return ref;
}
