'use client';
/**
 * useElementSize — measure a widget's own rendered box (width + height).
 *
 * Celebration widgets must lay out differently depending on the zone's
 * aspect ratio: a wide LED ribbon (≈16:1) wants a horizontal strip,
 * a scoreboard (≈16:9) wants a centered, stacked scene. The widget
 * attaches `ref` to its root and branches on the returned width/height.
 *
 * Measures in a layout effect (before paint) and re-measures on resize
 * via ResizeObserver — so the layout is correct on first paint and
 * stays correct if the zone is resized in the builder.
 */

import { useLayoutEffect, useRef, useState, type RefObject } from 'react';

export function useElementSize<T extends HTMLElement>(): {
  ref: RefObject<T | null>;
  width: number;
  height: number;
} {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () =>
      setSize({ width: el.offsetWidth || 0, height: el.offsetHeight || 0 });
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return { ref, width: size.width, height: size.height };
}
