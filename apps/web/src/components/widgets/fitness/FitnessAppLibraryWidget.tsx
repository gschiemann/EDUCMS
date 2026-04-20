'use client';

/**
 * FitnessAppLibraryWidget — Smart-TV-style app-picker grid for gym signage.
 *
 * Widget type: FITNESS_APP_LIBRARY
 *
 * Renders a fullscreen catalog of every content source in `fitnessSourceCatalog.ts`
 * grouped by category, styled like a Google TV / Apple TV home screen. Intended as a
 * DISPLAY widget (visual catalog for members to see what's available on the gym's
 * screens), not an interactive widget — tiles show status but do not launch anything.
 *
 * Visual language matches FitnessMusicPlayerWidget and FitnessLiveTVWidget:
 *   • Dark charcoal backdrop + aurora drifting radial glows (#00d4ff + #ff2a4d)
 *   • Outfit 800 display type, Inter body copy
 *   • Neon accent colors threaded from each source's accentColor
 *   • Animated equalizer-style "breathing" on tiles (staggered 0.05s per tile)
 *   • Inline <style> tag pattern — no Tailwind
 *
 * Wiring note: someone else adds 'FITNESS_APP_LIBRARY' to WidgetRenderer.tsx.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CATEGORY_LABELS,
  sourcesByCategory,
  type FitnessSource,
  type SourceCategory,
} from './fitnessSourceCatalog';

/* ─────────────────────────────────────────────────────────────────
 * Config contract
 * ───────────────────────────────────────────────────────────────── */
export interface FitnessAppLibraryConfig {
  /** Header title. Default: "STREAMING LIBRARY". */
  title?: string;
  /** Which category rows to show. Defaults to all. */
  categories?: SourceCategory[];
  /** Source ids to pin to the top of their row (visual badge only). */
  highlightSourceIds?: string[];
  /** Stick connection status shown in the header pill. Default: 'unknown'. */
  stickStatus?: 'online' | 'offline' | 'unknown';
  /** Number of connected sticks shown in the pill. */
  stickCount?: number;
  /** Overall header neon accent. Default: #00d4ff. */
  accentColor?: string;
}

/* ─────────────────────────────────────────────────────────────────
 * Helpers
 * ───────────────────────────────────────────────────────────────── */
const STATUS_CHIP: Record<string, { label: string; className: string }> = {
  STICK:   { label: 'STICK',       className: 'falw-chip-stick' },
  PARTNER: { label: 'PARTNERSHIP', className: 'falw-chip-partner' },
  COMING:  { label: 'SOON',        className: 'falw-chip-coming' },
};

function useLiveClock() {
  const [time, setTime] = useState(() => formatTime(new Date()));
  useEffect(() => {
    const id = setInterval(() => setTime(formatTime(new Date())), 1000);
    return () => clearInterval(id);
  }, []);
  return time;
}

function formatTime(d: Date) {
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/* ─────────────────────────────────────────────────────────────────
 * Component
 * ───────────────────────────────────────────────────────────────── */
export function FitnessAppLibraryWidget({
  config,
  live,
}: {
  config?: FitnessAppLibraryConfig;
  live?: boolean;
}) {
  const c: FitnessAppLibraryConfig = config ?? {};
  const accent        = c.accentColor ?? '#00d4ff';
  const title         = c.title       ?? 'STREAMING LIBRARY';
  const stickStatus   = c.stickStatus ?? 'unknown';
  const stickCount    = c.stickCount  ?? 0;
  const highlightIds  = useMemo(() => new Set(c.highlightSourceIds ?? []), [c.highlightSourceIds]);

  const clock = useLiveClock();

  // Build category rows — stable reference so the tile animation
  // delays don't randomize on every render.
  const byCategory = useMemo(() => sourcesByCategory(), []);

  const visibleCategories: SourceCategory[] = useMemo(() => {
    const allCats: SourceCategory[] = [
      'free-fast',
      'streaming-apps',
      'live-tv',
      'news-sports',
      'music',
      'fitness-content',
      'social',
    ];
    const allowed = c.categories ?? allCats;
    return allCats.filter((cat) => allowed.includes(cat) && byCategory[cat].length > 0);
  }, [c.categories, byCategory]);

  // Assign a global tile index for staggered animation delays.
  // Flattened once, memoised.
  const tileIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    let i = 0;
    for (const cat of visibleCategories) {
      for (const src of byCategory[cat]) {
        map.set(src.id, i++);
      }
    }
    return map;
  }, [visibleCategories, byCategory]);

  // Derive the accent color from the first source in a row for the
  // category label's neon thread.
  const categoryAccent = (cat: SourceCategory): string => {
    const first = byCategory[cat]?.[0];
    return first?.accentColor ?? accent;
  };

  // Stick status pill rendering data.
  const stickPill = useMemo(() => {
    if (stickStatus === 'online') {
      return {
        dot: 'falw-stick-dot-online',
        text: stickCount > 0 ? `${stickCount} STICK${stickCount > 1 ? 'S' : ''} ONLINE` : '● STICK ONLINE',
        className: 'falw-stick-pill-online',
      };
    }
    if (stickStatus === 'offline') {
      return { dot: 'falw-stick-dot-offline', text: '○ NO STICK CONNECTED', className: 'falw-stick-pill-offline' };
    }
    return { dot: 'falw-stick-dot-unknown', text: '○ STICK STATUS UNKNOWN', className: 'falw-stick-pill-unknown' };
  }, [stickStatus, stickCount]);

  return (
    <div
      className="falw-root"
      style={{ '--falw-accent': accent } as React.CSSProperties}
      aria-label={title}
    >
      <style>{CSS}</style>

      {/* ── Background: charcoal + dual aurora radial glows ── */}
      <div className="falw-bg" aria-hidden />
      <div className="falw-glow-a" aria-hidden />
      <div className="falw-glow-b" aria-hidden />
      <div className="falw-grain" aria-hidden />

      {/* ── Top header ── */}
      <header className="falw-header">
        <div className="falw-header-left">
          <span className="falw-header-bar" aria-hidden />
          <h1 className="falw-title">{title}</h1>
        </div>
        <div className="falw-header-right">
          <div className={`falw-stick-pill ${stickPill.className}`}>
            <span className={`falw-stick-dot ${stickPill.dot}`} aria-hidden />
            <span className="falw-stick-text">{stickPill.text}</span>
          </div>
          <time className="falw-clock" dateTime="">
            {clock}
          </time>
        </div>
      </header>

      {/* ── Category rows ── */}
      <main className="falw-main">
        {visibleCategories.map((cat) => {
          const catAccent = categoryAccent(cat);
          const sources   = byCategory[cat];
          return (
            <section className="falw-category" key={cat}>
              {/* Category label + animated beam */}
              <div
                className="falw-cat-header"
                style={{ '--falw-cat-accent': catAccent } as React.CSSProperties}
              >
                <span className="falw-cat-label">{CATEGORY_LABELS[cat]}</span>
                <span className="falw-cat-beam" aria-hidden />
              </div>

              {/* Horizontally-scrollable tile strip */}
              <div className="falw-tile-strip" role="list">
                {sources.map((src) => {
                  const tileIndex   = tileIndexMap.get(src.id) ?? 0;
                  const chip        = STATUS_CHIP[src.status];
                  const isHighlight = highlightIds.has(src.id);
                  return (
                    <Tile
                      key={src.id}
                      source={src}
                      tileIndex={tileIndex}
                      chip={chip}
                      isHighlight={isHighlight}
                    />
                  );
                })}
              </div>
            </section>
          );
        })}
      </main>

      {/* ── Bottom hint bar ── */}
      <footer className="falw-footer" aria-label="Navigation hint">
        Press SELECT to launch · Use arrow keys to navigate
      </footer>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
 * Tile sub-component — pure display, no click handlers
 * ───────────────────────────────────────────────────────────────── */
function Tile({
  source,
  tileIndex,
  chip,
  isHighlight,
}: {
  source: FitnessSource;
  tileIndex: number;
  chip?: { label: string; className: string };
  isHighlight: boolean;
}) {
  const ac = source.accentColor;
  // tabIndex so the grid is keyboard-navigable for preview purposes;
  // no click handler — pure display.
  return (
    <article
      className={`falw-tile${isHighlight ? ' falw-tile-highlight' : ''}${source.status === 'COMING' ? ' falw-tile-coming' : ''}`}
      style={{
        '--falw-tile-accent': ac,
        animationDelay: `${tileIndex * 0.05}s`,
      } as React.CSSProperties}
      role="listitem"
      tabIndex={0}
      aria-label={`${source.name}${source.status === 'COMING' ? ' — coming soon' : ''}`}
    >
      {/* Status chip — top-right, only for non-READY */}
      {chip && (
        <div
          className={`falw-chip ${chip.className}`}
          title={
            source.status === 'STICK'
              ? 'Launches on connected stick'
              : source.status === 'PARTNER'
              ? 'Requires partnership contract'
              : 'Coming soon'
          }
          aria-label={chip.label}
        >
          {chip.label}
        </div>
      )}

      {/* READY: subtle green dot only */}
      {source.status === 'READY' && (
        <span className="falw-ready-dot" aria-label="Ready" title="Available now" />
      )}

      {/* Icon badge */}
      <div className="falw-tile-icon" aria-hidden>
        {source.icon}
      </div>

      {/* Text stack */}
      <div className="falw-tile-text">
        <div className="falw-tile-name">{source.name}</div>
        <div className="falw-tile-tagline">{source.tagline}</div>
      </div>
    </article>
  );
}

/* ─────────────────────────────────────────────────────────────────
 * Styles — inline pattern matching the other fitness widgets.
 * Container-query-based sizing; no Tailwind; no vw/vh.
 * ───────────────────────────────────────────────────────────────── */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@500;600&display=swap');

/* ── Root ── */
.falw-root {
  position: absolute; inset: 0;
  overflow: hidden;
  color: #f1f5f9;
  font-family: 'Inter', system-ui, sans-serif;
  container-type: size;
  display: flex;
  flex-direction: column;
}

/* ── Background layers ── */
.falw-bg {
  position: absolute; inset: 0; z-index: 0;
  background: linear-gradient(145deg, #0a0a10 0%, #12121c 55%, #0b0b12 100%);
}
.falw-glow-a {
  position: absolute; z-index: 1; pointer-events: none;
  width: 70cqw; height: 70cqh;
  top: -20cqh; left: -10cqw;
  background: radial-gradient(ellipse at 50% 50%, #00d4ff 0%, transparent 65%);
  opacity: 0.08;
  filter: blur(80px);
  animation: falw-drift-a 18s ease-in-out infinite alternate;
}
.falw-glow-b {
  position: absolute; z-index: 1; pointer-events: none;
  width: 60cqw; height: 60cqh;
  bottom: -15cqh; right: -8cqw;
  background: radial-gradient(ellipse at 50% 50%, #ff2a4d 0%, transparent 65%);
  opacity: 0.07;
  filter: blur(90px);
  animation: falw-drift-b 22s ease-in-out infinite alternate;
}
@keyframes falw-drift-a {
  from { transform: translate(0, 0) scale(1); }
  to   { transform: translate(8cqw, 6cqh) scale(1.12); }
}
@keyframes falw-drift-b {
  from { transform: translate(0, 0) scale(1); }
  to   { transform: translate(-6cqw, -5cqh) scale(1.08); }
}
.falw-grain {
  position: absolute; inset: 0; z-index: 2;
  pointer-events: none;
  opacity: 0.04;
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/></filter><rect width='100%25' height='100%25' filter='url(%23n)' opacity='0.6'/></svg>");
  mix-blend-mode: overlay;
}

/* ── Header ── */
.falw-header {
  position: relative; z-index: 20;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: clamp(10px, 2cqh, 22px) clamp(16px, 3cqw, 40px);
  border-bottom: 1px solid rgba(255,255,255,0.06);
  background: rgba(0,0,0,0.25);
  backdrop-filter: blur(12px);
}
.falw-header-left {
  display: flex; align-items: center; gap: clamp(10px, 1.5cqw, 20px);
}
.falw-header-bar {
  display: block;
  width: 4px;
  height: clamp(22px, 4cqh, 44px);
  border-radius: 2px;
  background: var(--falw-accent, #00d4ff);
  box-shadow: 0 0 18px var(--falw-accent, #00d4ff);
}
.falw-title {
  font-family: 'Outfit', sans-serif;
  font-weight: 800;
  font-size: clamp(18px, 4cqh, 42px);
  letter-spacing: 0.08em;
  color: #ffffff;
  text-shadow:
    0 0 40px var(--falw-accent, #00d4ff),
    0 0 80px rgba(0, 212, 255, 0.15);
  margin: 0;
}
.falw-header-right {
  display: flex; align-items: center; gap: clamp(10px, 1.5cqw, 20px);
}

/* Stick status pill */
.falw-stick-pill {
  display: inline-flex; align-items: center; gap: 8px;
  padding: clamp(4px, 0.8cqh, 8px) clamp(10px, 1.5cqw, 16px);
  border-radius: 999px;
  border: 1px solid transparent;
  font-family: 'JetBrains Mono', monospace;
  font-size: clamp(9px, 1.5cqh, 12px);
  font-weight: 600;
  letter-spacing: 0.12em;
}
.falw-stick-pill-online {
  background: rgba(0, 212, 100, 0.12);
  border-color: rgba(0, 212, 100, 0.35);
  color: #4ade80;
}
.falw-stick-pill-offline {
  background: rgba(255,42,77,0.1);
  border-color: rgba(255,42,77,0.3);
  color: #f87171;
}
.falw-stick-pill-unknown {
  background: rgba(148,163,184,0.08);
  border-color: rgba(148,163,184,0.2);
  color: #94a3b8;
}
.falw-stick-dot {
  width: 7px; height: 7px; border-radius: 50%;
}
.falw-stick-dot-online {
  background: #4ade80;
  box-shadow: 0 0 10px #4ade80;
  animation: falw-blink 1.8s ease-in-out infinite;
}
.falw-stick-dot-offline,
.falw-stick-dot-unknown {
  background: currentColor;
  opacity: 0.5;
}
@keyframes falw-blink {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.45; }
}
.falw-stick-text { white-space: nowrap; }

/* Clock */
.falw-clock {
  font-family: 'JetBrains Mono', monospace;
  font-size: clamp(14px, 2.5cqh, 26px);
  font-weight: 600;
  color: #ffffff;
  letter-spacing: 0.06em;
  text-shadow: 0 0 20px var(--falw-accent, #00d4ff);
}

/* ── Main scrollable area ── */
.falw-main {
  position: relative; z-index: 10;
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: clamp(10px, 1.5cqh, 20px) clamp(16px, 3cqw, 36px);
  display: flex;
  flex-direction: column;
  gap: clamp(12px, 2cqh, 24px);
  /* Hide scrollbar visually — content scrolls on deploy via kiosk controls. */
  scrollbar-width: none;
}
.falw-main::-webkit-scrollbar { display: none; }

/* ── Category section ── */
.falw-category {
  display: flex;
  flex-direction: column;
  gap: clamp(6px, 1cqh, 12px);
}

/* Category label + beam underline */
.falw-cat-header {
  position: relative;
  display: inline-flex;
  flex-direction: column;
  gap: 4px;
  align-self: flex-start;
}
.falw-cat-label {
  font-family: 'Outfit', sans-serif;
  font-weight: 700;
  font-size: clamp(11px, 1.8cqh, 18px);
  letter-spacing: 0.25em;
  text-transform: uppercase;
  color: var(--falw-cat-accent, #00d4ff);
  text-shadow: 0 0 16px var(--falw-cat-accent, #00d4ff);
}
/* Animated beam underline */
.falw-cat-beam {
  display: block;
  height: 2px;
  border-radius: 1px;
  background: linear-gradient(90deg, var(--falw-cat-accent, #00d4ff), transparent 80%);
  box-shadow: 0 0 10px var(--falw-cat-accent, #00d4ff);
  animation: falw-beam-pulse 3s ease-in-out infinite;
}
@keyframes falw-beam-pulse {
  0%, 100% { opacity: 0.6; width: 80%; }
  50%       { opacity: 1;   width: 100%; }
}

/* ── Tile strip ── */
.falw-tile-strip {
  display: flex;
  flex-direction: row;
  gap: clamp(8px, 1.2cqw, 16px);
  overflow-x: auto;
  overflow-y: visible;
  padding-bottom: 6px;
  scrollbar-width: none;
}
.falw-tile-strip::-webkit-scrollbar { display: none; }

/* ── Individual tile ── */
.falw-tile {
  flex-shrink: 0;
  position: relative;
  width: clamp(110px, 15cqw, 200px);
  /* Height follows width at roughly 2:3 so tiles look like app icons. */
  padding: clamp(10px, 1.5cqw, 18px) clamp(8px, 1.2cqw, 14px) clamp(8px, 1.2cqw, 14px);
  border-radius: 12px;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.08);
  cursor: default;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: clamp(6px, 1cqh, 10px);
  /* Staggered bob animation — index delay injected via style prop */
  animation: falw-tile-bob 4s ease-in-out infinite;
  outline: none;
  transition:
    transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1),
    background 0.18s ease,
    border-color 0.18s ease,
    box-shadow 0.22s ease;
}
/* Bob — breathes very subtly so the grid feels alive */
@keyframes falw-tile-bob {
  0%, 100% { transform: translateY(0px); }
  50%       { transform: translateY(-2px); }
}
/* Hover lift + neon glow */
.falw-tile:hover,
.falw-tile:focus {
  transform: translateY(-4px) scale(1.05);
  background: rgba(255,255,255,0.08);
  border-color: var(--falw-tile-accent, #00d4ff);
  box-shadow:
    0 8px 32px rgba(0,0,0,0.5),
    0 0 0 2px var(--falw-tile-accent, #00d4ff),
    0 0 24px var(--falw-tile-accent, #00d4ff);
  /* Pause the bob during hover so the lift doesn't fight it */
  animation-play-state: paused;
}
/* Coming-soon tiles: dimmed */
.falw-tile-coming {
  opacity: 0.52;
  filter: grayscale(0.35);
}
/* Highlight tiles: subtle gold inner glow */
.falw-tile-highlight {
  border-color: rgba(255,215,0,0.3);
  box-shadow: inset 0 0 20px rgba(255,215,0,0.06);
}

/* Status chips */
.falw-chip {
  position: absolute;
  top: 7px; right: 7px;
  font-family: 'JetBrains Mono', monospace;
  font-size: clamp(7px, 1.1cqh, 10px);
  font-weight: 600;
  letter-spacing: 0.08em;
  padding: 2px 6px;
  border-radius: 4px;
  white-space: nowrap;
}
.falw-chip-stick {
  background: rgba(251,191,36,0.18);
  border: 1px solid rgba(251,191,36,0.45);
  color: #fbbf24;
}
.falw-chip-partner {
  background: rgba(167,139,250,0.18);
  border: 1px solid rgba(167,139,250,0.4);
  color: #a78bfa;
}
.falw-chip-coming {
  background: rgba(100,116,139,0.18);
  border: 1px solid rgba(100,116,139,0.3);
  color: #64748b;
}
/* READY: just a small green dot, no chip */
.falw-ready-dot {
  position: absolute; top: 8px; right: 8px;
  width: 7px; height: 7px; border-radius: 50%;
  background: #4ade80;
  box-shadow: 0 0 8px #4ade80;
}

/* Tile icon badge */
.falw-tile-icon {
  width: clamp(44px, 7cqw, 80px);
  height: clamp(44px, 7cqw, 80px);
  border-radius: 14px;
  background: var(--falw-tile-accent, #00d4ff);
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: 'Outfit', sans-serif;
  font-weight: 800;
  font-size: clamp(14px, 2.4cqw, 28px);
  color: #fff;
  letter-spacing: -0.02em;
  box-shadow:
    0 4px 16px rgba(0,0,0,0.4),
    0 0 0 1px rgba(255,255,255,0.1) inset;
  flex-shrink: 0;
  /* Slight mix so text-icon combos (N, M, etc.) read as brand */
  text-shadow: 0 1px 4px rgba(0,0,0,0.4);
}

/* Tile text stack */
.falw-tile-text {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}
.falw-tile-name {
  font-family: 'Outfit', sans-serif;
  font-weight: 700;
  font-size: clamp(10px, 1.6cqh, 17px);
  color: #f8fafc;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}
.falw-tile-tagline {
  font-family: 'Inter', sans-serif;
  font-size: clamp(8px, 1.2cqh, 12px);
  color: #64748b;
  text-align: center;
  line-height: 1.3;
  /* Up to 2 lines — long taglines clip gracefully */
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  max-width: 100%;
}

/* ── Footer hint bar ── */
.falw-footer {
  position: relative; z-index: 20;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: clamp(5px, 1cqh, 10px) clamp(16px, 3cqw, 36px);
  border-top: 1px solid rgba(255,255,255,0.05);
  background: rgba(0,0,0,0.3);
  font-family: 'Inter', sans-serif;
  font-size: clamp(9px, 1.4cqh, 13px);
  color: #475569;
  letter-spacing: 0.06em;
}
`;
