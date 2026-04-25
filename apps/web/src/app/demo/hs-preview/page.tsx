"use client";

/**
 * HS template preview gallery — DEV ONLY.
 *
 * No auth needed; renders the 8 high-school lobby templates side-by-side
 * at thumbnail scale so we can verify the HsStage 3-layer scale fix
 * actually shows the full scene (not a tiny crop or top-left zoom).
 *
 * Each tile is a 16:9 box with the widget rendered inside via
 * <WidgetRenderer />. If a tile is blank or shows only a corner, the
 * HsStage scaling is broken.
 *
 * Click a tile to see it full-screen. Press Esc to close.
 *
 * Lives under /demo so it never ends up in customer navigation. Feel
 * free to delete after the pilot.
 */

import { useState } from 'react';
import { WidgetPreview } from '@/components/widgets/WidgetRenderer';

const HS_TEMPLATES: Array<{ type: string; label: string; bg: string }> = [
  { type: 'HS_VARSITY',   label: 'Varsity (Athletic)',     bg: '#0d1b3d' },
  { type: 'HS_BROADCAST', label: 'Broadcast (News Desk)',  bg: '#0b1025' },
  { type: 'HS_YEARBOOK',  label: 'Yearbook (Editorial)',   bg: '#f7f3ea' },
  { type: 'HS_TERMINAL',  label: 'Terminal (CRT)',         bg: '#060f06' },
  { type: 'HS_TRANSIT',   label: 'Transit (Departure)',    bg: '#0a0f1c' },
  { type: 'HS_GALLERY',   label: 'Gallery (Museum)',       bg: '#f5f1e8' },
  { type: 'HS_BLUEPRINT', label: 'Blueprint (Technical)',  bg: '#0f3a7a' },
  { type: 'HS_ZINE',      label: 'Zine (Cut & Paste)',     bg: '#f2ecd9' },
  { type: 'MS_ARCADE',    label: 'Arcade (Quest Log) — MS', bg: '#0d0d1a' },
  { type: 'MS_ATLAS',     label: 'Atlas (Subway Map) — MS', bg: '#f4ecd8' },
];

export default function HsPreviewPage() {
  const [zoom, setZoom] = useState<string | null>(null);

  return (
    <div style={{ minHeight: '100vh', background: '#0f172a', color: '#fff', padding: 32, fontFamily: 'Inter, system-ui, sans-serif' }}>
      <h1 style={{ fontSize: 28, fontWeight: 800, margin: '0 0 8px' }}>HS Template Preview</h1>
      <p style={{ color: '#94a3b8', margin: '0 0 24px', fontSize: 14 }}>
        Verifying the HsStage 3-layer scale pattern across all 8 high-school lobby templates.
        Each tile renders the FULL 4K scene scaled to fit the box. Click a tile to view full-screen.
      </p>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))',
          gap: 20,
        }}
      >
        {HS_TEMPLATES.map((t) => (
          <button
            key={t.type}
            onClick={() => setZoom(t.type)}
            style={{
              background: t.bg,
              border: '1px solid rgba(255,255,255,.08)',
              borderRadius: 12,
              padding: 0,
              overflow: 'hidden',
              cursor: 'pointer',
              boxShadow: '0 4px 12px rgba(0,0,0,.4)',
              textAlign: 'left',
            }}
          >
            <div
              style={{
                position: 'relative',
                width: '100%',
                aspectRatio: '16 / 9',
                overflow: 'hidden',
                background: t.bg,
              }}
            >
              <WidgetPreview widgetType={t.type} config={{}} width={100} height={100} live={false} />
            </div>
            <div
              style={{
                background: 'rgba(0,0,0,.6)',
                color: '#fff',
                padding: '8px 14px',
                fontSize: 13,
                fontWeight: 600,
                letterSpacing: '.02em',
              }}
            >
              {t.label} <span style={{ color: '#64748b', fontWeight: 400, marginLeft: 6 }}>{t.type}</span>
            </div>
          </button>
        ))}
      </div>

      {zoom && (
        <div
          role="presentation"
          onClick={() => setZoom(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,.92)',
            zIndex: 9999,
            display: 'grid',
            placeItems: 'center',
            padding: 24,
            cursor: 'zoom-out',
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Preview of ${zoom}`}
            style={{
              position: 'relative',
              width: 'min(90vw, 1600px)',
              aspectRatio: '16 / 9',
              background: HS_TEMPLATES.find((t) => t.type === zoom)?.bg ?? '#000',
              boxShadow: '0 20px 80px rgba(0,0,0,.8)',
              overflow: 'hidden',
            }}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => { if (e.key === 'Escape') setZoom(null); }}
          >
            <WidgetPreview widgetType={zoom} config={{}} width={100} height={100} live={true} />
          </div>
          <button
            onClick={() => setZoom(null)}
            style={{
              position: 'fixed',
              top: 24,
              right: 24,
              background: '#fff',
              color: '#000',
              border: 0,
              borderRadius: 999,
              padding: '8px 16px',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Close
          </button>
        </div>
      )}
    </div>
  );
}
