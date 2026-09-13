/**
 * The builder canvas frame: how big the design box is inside the canvas area.
 *
 * `zoom` is a deviation from the FIT baseline (1 = fill the area, 0.5 = half,
 * 2 = double). Landscape designs are width-driven, portrait ones height-driven
 * (a 320×1080 strip sized off width overflowed the area — 2026-05-14).
 *
 * 2026-09-13 (template-maker audit): at zoom > 1 the box used to keep
 * `maxWidth/maxHeight: 100%`, so "Zoom in" changed the label to 125 % and the
 * canvas not at all — a control that lied. Above the fit baseline the clamps
 * come off and the box overflows its `overflow-auto` parent; `margin: auto`
 * keeps it centred while it fits and start-aligned (fully scrollable) once it
 * does not — `justify-content: center` alone would clip the top-left edge of an
 * overflowing flex item.
 */
import type { CSSProperties } from 'react';

export function canvasFrameStyle(aspectRatio: number, zoom: number): CSSProperties {
  const size = zoom === 1 ? '100%' : `${100 * zoom}%`;
  const style: CSSProperties = {
    ...(aspectRatio < 1 ? { height: size } : { width: size }),
    aspectRatio: `${aspectRatio}`,
    margin: 'auto',
    // The frame is a flex item; the default `flex-shrink: 1` silently shrank a
    // 125% width back to the container — the second reason "Zoom in" was a no-op.
    flexShrink: 0,
  };
  if (zoom <= 1) {
    style.maxWidth = '100%';
    style.maxHeight = '100%';
  }
  return style;
}
