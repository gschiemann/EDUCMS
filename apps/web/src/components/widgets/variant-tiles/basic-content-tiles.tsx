/**
 * Tiny preview tiles for the basic content widget variants
 * (Video, VideoCarousel, Webpage, Image, ImageCarousel).
 *
 * These render INSIDE the Widget Library picker as the variant
 * thumbnail. When the operator drops one onto the canvas, the actual
 * canvas zone is rendered by WidgetRenderer's case for the matching
 * widgetType (e.g. VIDEO → VideoWidget) — these tiles are picker-
 * preview-only.
 *
 * Why a separate file: variants-register.ts is `.ts` (no JSX). Moving
 * the JSX into a `.tsx` keeps the registration file lint-clean while
 * giving us readable preview components.
 */
import { Play as PlayIcon, Image as ImageIcon, Globe as GlobeIcon } from 'lucide-react';

export function VideoBasicTile() {
  return (
    <div
      className="absolute inset-0 flex flex-col items-center justify-center gap-1.5"
      style={{ background: 'linear-gradient(135deg, #1e1b4b, #312e81)' }}
    >
      <div
        style={{
          width: '2.2em', height: '2.2em', borderRadius: 999,
          background: 'rgba(255,255,255,0.15)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <PlayIcon style={{ width: '1em', height: '1em', color: 'white', marginLeft: '0.1em' }} />
      </div>
      <div style={{ fontSize: '0.45em', color: 'rgba(255,255,255,0.8)', fontWeight: 600, letterSpacing: '0.05em' }}>
        Video
      </div>
    </div>
  );
}

export function VideoCarouselTile() {
  return (
    <div
      className="absolute inset-0 flex flex-col items-center justify-center gap-1.5"
      style={{ background: 'linear-gradient(135deg, #4c1d95, #6d28d9)' }}
    >
      <div style={{ display: 'flex', gap: 4 }}>
        <div style={{ width: '1.4em', height: '1em', borderRadius: 4, background: 'rgba(255,255,255,0.15)' }} />
        <div style={{ width: '1.4em', height: '1em', borderRadius: 4, background: 'rgba(255,255,255,0.30)' }} />
        <div style={{ width: '1.4em', height: '1em', borderRadius: 4, background: 'rgba(255,255,255,0.15)' }} />
      </div>
      <div style={{ fontSize: '0.45em', color: 'rgba(255,255,255,0.8)', fontWeight: 600, letterSpacing: '0.05em' }}>
        Video Carousel
      </div>
    </div>
  );
}

export function WebpageTile() {
  return (
    <div
      className="absolute inset-0 flex flex-col items-center justify-center gap-1"
      style={{ background: 'linear-gradient(135deg, #f1f5f9, #e2e8f0)', padding: '0.4em' }}
    >
      <div style={{ width: '70%', height: '0.4em', borderRadius: 2, background: 'rgba(99,102,241,0.6)' }} />
      <div style={{ width: '90%', height: '0.25em', borderRadius: 2, background: '#cbd5e1' }} />
      <div style={{ width: '85%', height: '0.25em', borderRadius: 2, background: '#cbd5e1' }} />
      <GlobeIcon style={{ width: '0.9em', height: '0.9em', color: '#6366f1', marginTop: '0.15em' }} />
      <div style={{ fontSize: '0.4em', color: '#475569', fontWeight: 600 }}>Web Page</div>
    </div>
  );
}

export function ImageBasicTile() {
  return (
    <div
      className="absolute inset-0 flex flex-col items-center justify-center gap-1.5"
      style={{ background: 'linear-gradient(135deg, #ecfdf5, #d1fae5)' }}
    >
      <div
        style={{
          width: '2.2em', height: '2.2em', borderRadius: 8,
          background: 'rgba(16,185,129,0.20)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <ImageIcon style={{ width: '1em', height: '1em', color: '#059669' }} />
      </div>
      <div style={{ fontSize: '0.45em', color: '#047857', fontWeight: 600, letterSpacing: '0.05em' }}>
        Image
      </div>
    </div>
  );
}

export function ImageCarouselBasicTile() {
  return (
    <div
      className="absolute inset-0 flex flex-col items-center justify-center gap-1.5"
      style={{ background: 'linear-gradient(135deg, #fef3c7, #fde68a)' }}
    >
      <div style={{ display: 'flex', gap: 4 }}>
        <div style={{ width: '1.4em', height: '1em', borderRadius: 4, background: 'rgba(180,83,9,0.20)' }} />
        <div style={{ width: '1.4em', height: '1em', borderRadius: 4, background: 'rgba(180,83,9,0.40)' }} />
        <div style={{ width: '1.4em', height: '1em', borderRadius: 4, background: 'rgba(180,83,9,0.20)' }} />
      </div>
      <div style={{ fontSize: '0.45em', color: '#92400e', fontWeight: 600, letterSpacing: '0.05em' }}>
        Photo Slideshow
      </div>
    </div>
  );
}
