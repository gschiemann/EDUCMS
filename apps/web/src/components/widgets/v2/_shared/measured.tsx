'use client';
/**
 * withMeasuredHeight — height-prop injector for widgets that size their
 * content off a pixel `height`.
 *
 * The v2 variant render path (WidgetRenderer → registerVariant → the
 * variant `render`) only forwards `config / compact / live /
 * onConfigChange` — it never passes zone dimensions. A widget that
 * sizes its type off a `height` prop would therefore render at its
 * hard-coded default forever (the celebration widgets default to 480).
 *
 * This HOC wraps such a widget in a full-bleed container, measures the
 * real rendered height, and feeds it in — re-measuring on resize. The
 * measure happens in a layout effect (before paint), so there is no
 * flash of the un-sized state.
 */

import { useLayoutEffect, useRef, useState, type ComponentType } from 'react';

export function withMeasuredHeight<P extends { height?: number }>(
  Inner: ComponentType<P>,
): ComponentType<P> {
  function Measured(props: P) {
    const ref = useRef<HTMLDivElement>(null);
    const [h, setH] = useState(0);

    useLayoutEffect(() => {
      const el = ref.current;
      if (!el) return;
      const measure = () => setH(el.offsetHeight || 0);
      measure();
      if (typeof ResizeObserver === 'undefined') return;
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      return () => ro.disconnect();
    }, []);

    return (
      <div ref={ref} style={{ width: '100%', height: '100%' }}>
        {h > 0 ? <Inner {...props} height={h} /> : null}
      </div>
    );
  }
  Measured.displayName = `Measured(${Inner.displayName || Inner.name || 'Widget'})`;
  return Measured;
}
