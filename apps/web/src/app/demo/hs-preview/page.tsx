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

type Tile = { type: string; label: string; bg: string };

const HS_TEMPLATES: Tile[] = [
  { type: 'HS_VARSITY',   label: 'Varsity (Athletic)',     bg: '#0d1b3d' },
  { type: 'HS_BROADCAST', label: 'Broadcast (News Desk)',  bg: '#0b1025' },
  { type: 'HS_YEARBOOK',  label: 'Yearbook (Editorial)',   bg: '#f7f3ea' },
  { type: 'HS_TERMINAL',  label: 'Terminal (CRT)',         bg: '#060f06' },
  { type: 'HS_TRANSIT',   label: 'Transit (Departure)',    bg: '#0a0f1c' },
  { type: 'HS_GALLERY',   label: 'Gallery (Museum)',       bg: '#f5f1e8' },
  { type: 'HS_BLUEPRINT', label: 'Blueprint (Technical)',  bg: '#0f3a7a' },
  { type: 'HS_ZINE',      label: 'Zine (Cut & Paste)',     bg: '#f2ecd9' },
];

const MS_TEMPLATES: Tile[] = [
  { type: 'MS_ARCADE',     label: 'Arcade (Quest Log)',     bg: '#0d0d1a' },
  { type: 'MS_ATLAS',      label: 'Atlas (Subway Map)',     bg: '#f4ecd8' },
  { type: 'MS_FIELDNOTES', label: 'Field Notes (Journal)',  bg: '#efe6d2' },
  { type: 'MS_GREENHOUSE', label: 'Greenhouse (Herbarium)', bg: '#f3ead4' },
  { type: 'MS_HOMEROOM',   label: 'Homeroom (Bulletin)',    bg: '#f6f3ec' },
  { type: 'MS_PAPER',      label: 'Paper (Broadsheet)',     bg: '#f7f1e3' },
  { type: 'MS_PLAYLIST',   label: 'Playlist (Now Playing)', bg: '#0f0f12' },
  { type: 'MS_STUDIO',     label: 'Studio (On Air)',        bg: '#1b1410' },
];

const MS_PORTRAITS: Tile[] = [
  { type: 'MS_ARCADE_PORTRAIT',     label: 'Arcade — Portrait',     bg: '#0d0d1a' },
  { type: 'MS_ATLAS_PORTRAIT',      label: 'Atlas — Portrait',      bg: '#f4ecd8' },
  { type: 'MS_FIELDNOTES_PORTRAIT', label: 'Field Notes — Portrait', bg: '#efe6d2' },
  { type: 'MS_GREENHOUSE_PORTRAIT', label: 'Greenhouse — Portrait', bg: '#f3ead4' },
  { type: 'MS_HOMEROOM_PORTRAIT',   label: 'Homeroom — Portrait',   bg: '#f6f3ec' },
  { type: 'MS_PAPER_PORTRAIT',      label: 'Paper — Portrait',      bg: '#f7f1e3' },
  { type: 'MS_PLAYLIST_PORTRAIT',   label: 'Playlist — Portrait',   bg: '#0f0f12' },
  { type: 'MS_STUDIO_PORTRAIT',     label: 'Studio — Portrait',     bg: '#1b1410' },
];

const ALL_TEMPLATES: Tile[] = [...HS_TEMPLATES, ...MS_TEMPLATES, ...MS_PORTRAITS];

function PackSection({ title, sub, accent, tiles, onZoom, aspectRatio = '16 / 9', columnsMin = 380 }: { title: string; sub: string; accent: string; tiles: Tile[]; onZoom: (t: string) => void; aspectRatio?: string; columnsMin?: number }) {
  return (
    <section style={{ marginBottom: 40 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, marginBottom: 14, paddingBottom: 10, borderBottom: `2px solid ${accent}` }}>
        <h2 style={{ fontSize: 22, fontWeight: 800, margin: 0, color: '#fff', letterSpacing: '-.01em' }}>{title}</h2>
        <span style={{ fontSize: 13, color: '#94a3b8' }}>{sub}</span>
        <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 600, color: accent, padding: '4px 10px', borderRadius: 999, background: 'rgba(255,255,255,.06)' }}>
          {tiles.length} templates
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${columnsMin}px, 1fr))`, gap: 20 }}>
        {tiles.map((t) => (
          <button
            key={t.type}
            onClick={() => onZoom(t.type)}
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
                aspectRatio,
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
    </section>
  );
}

export default function HsPreviewPage() {
  const [zoom, setZoom] = useState<string | null>(null);

  return (
    <div style={{ minHeight: '100vh', background: '#0f172a', color: '#fff', padding: 32, fontFamily: 'Inter, system-ui, sans-serif' }}>
      <h1 style={{ fontSize: 28, fontWeight: 800, margin: '0 0 8px' }}>EDU CMS · Template Preview Gallery</h1>
      <p style={{ color: '#94a3b8', margin: '0 0 28px', fontSize: 14 }}>
        Every productized lobby template, rendered full-scene at 16:9. Click any tile for the full-screen preview. The MS pack and HS pack are listed in separate sections below — they are independent design systems.
      </p>

      <PackSection
        title="🎓 High School Pack"
        sub="Athletic / editorial / technical aesthetic — tagged HIGH on /templates"
        accent="#60a5fa"
        tiles={HS_TEMPLATES}
        onZoom={setZoom}
      />

      <PackSection
        title="📚 Middle School Pack — Landscape (3840×2160)"
        sub="Game-HUD / cartographic / journal aesthetic — tagged MIDDLE on /templates"
        accent="#fbbf24"
        tiles={MS_TEMPLATES}
        onZoom={setZoom}
      />

      <PackSection
        title="📱 Middle School Pack — Portrait (2160×3840)"
        sub="Same templates, redesigned for vertical 4K hallway displays"
        accent="#a78bfa"
        tiles={MS_PORTRAITS}
        onZoom={setZoom}
        aspectRatio="9 / 16"
        columnsMin={220}
      />

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
          {(() => {
            const isPortrait = zoom?.endsWith('_PORTRAIT') ?? false;
            return (
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Preview of ${zoom}`}
            style={{
              position: 'relative',
              width: isPortrait ? 'min(50vw, 800px)' : 'min(90vw, 1600px)',
              aspectRatio: isPortrait ? '9 / 16' : '16 / 9',
              background: ALL_TEMPLATES.find((t) => t.type === zoom)?.bg ?? '#000',
              boxShadow: '0 20px 80px rgba(0,0,0,.8)',
              overflow: 'hidden',
            }}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => { if (e.key === 'Escape') setZoom(null); }}
          >
            <WidgetPreview widgetType={zoom} config={{}} width={100} height={100} live={true} />
          </div>
            );
          })()}
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
