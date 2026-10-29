import type { CSSProperties } from 'react';

export interface BroadcastLayout { width: number; height: number; bannerHeight: number }

/** Scale the existing canvas, including its iframes, without changing their
 * layout viewport or remounting anything. Preserve the complete content. */
export function broadcastContentStyle(layout: BroadcastLayout | null): CSSProperties {
  if (!layout || layout.width <= 0 || layout.height <= 0) return {};
  const top = Math.min(layout.height * 0.4, Math.max(0, layout.bannerHeight));
  const scale = (layout.height - top) / layout.height;
  return { top, left: (layout.width * (1 - scale)) / 2, transform: `scale(${scale})`, transformOrigin: 'top left' };
}
