'use client';

/**
 * CustomScoreboardScene — renders an operator-built Template instead
 * of the legacy hardcoded /board layout.
 *
 * Triggered when Game.scoreboardTemplateId is non-null. Fetches the
 * Template + its zones, computes scale to fit the template's NATIVE
 * canvas into the viewport, renders each zone via WidgetPreview, and
 * wraps the whole thing in <GameStateProvider> so the embedded
 * SCORE_HOME / GAME_CLOCK / etc. primitives read live game state.
 *
 * Cross-browser / Chromium-83 safe — long-hand top/right/bottom/left,
 * no flex `gap`, no `inset` shorthand. Same pattern the existing
 * scaled BoardScene uses, just with the template's canvas size
 * instead of hardcoded 1920×1080.
 */

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { GameStateProvider, type GameSnapshot } from '@/components/widgets/sports/GameStateContext';
import { API_URL } from '@/lib/api-url';

const WidgetPreview = dynamic(
  () => import('@/components/widgets/WidgetRenderer').then((m) => ({ default: m.WidgetPreview })),
  { ssr: false, loading: () => null },
);

interface Zone {
  id: string;
  widgetType: string;
  x: number; y: number; width: number; height: number;
  zIndex?: number | null;
  defaultConfig?: Record<string, unknown> | null;
}

interface Template {
  id: string;
  screenWidth: number;
  screenHeight: number;
  bgColor?: string | null;
  bgImage?: string | null;
  bgGradient?: string | null;
  zones: Zone[];
}

function bgStyle(t: Template): React.CSSProperties {
  const s: React.CSSProperties = {
    position: 'absolute',
    top: 0, right: 0, bottom: 0, left: 0,
    backgroundColor: t.bgColor || '#000000',
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    // Explicit z-index so an operator's custom zone with zIndex: 0
    // can't accidentally render BEHIND the background. Zones use
    // zIndex: z.zIndex ?? 1 below, so 0 is reserved for the bg.
    zIndex: 0,
  };
  if (t.bgImage) {
    s.backgroundImage = t.bgImage.trim().startsWith('url(') ? t.bgImage : `url(${t.bgImage})`;
  } else if (t.bgGradient) {
    s.backgroundImage = t.bgGradient;
  }
  return s;
}

export function CustomScoreboardScene({
  templateId,
  gameId,
  initial,
}: {
  templateId: string;
  gameId: string;
  initial?: GameSnapshot | null;
}) {
  const [template, setTemplate] = useState<Template | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [vp, setVp] = useState({ w: 1920, h: 1080 });

  // Fetch the template. Re-fetch every 5min so a hot-swapped layout
  // reaches the board without a manual reload. Same idea as the
  // scoreboard 750ms poll for live state, just slower for static
  // structural changes.
  useEffect(() => {
    if (!templateId) return;
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch(`${API_URL}/templates/${encodeURIComponent(templateId)}`, {
          cache: 'no-store',
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json: Template = await res.json();
        if (!alive) return;
        setTemplate(json);
        setError(null);
      } catch (e) {
        if (alive) setError((e as Error).message || 'Failed to load template');
      }
    };
    load();
    const id = setInterval(load, 5 * 60 * 1000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [templateId]);

  // Measure viewport for fit-to-screen scaling.
  useEffect(() => {
    const measure = () =>
      setVp({ w: window.innerWidth || 1920, h: window.innerHeight || 1080 });
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  const scale = useMemo(() => {
    if (!template) return 1;
    return Math.min(vp.w / template.screenWidth, vp.h / template.screenHeight);
  }, [vp, template]);

  if (error) {
    return (
      <div
        style={{
          position: 'absolute', top: 0, right: 0, bottom: 0, left: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#64748b', fontFamily: 'Inter, system-ui, sans-serif',
          fontSize: 28, fontWeight: 700,
        }}
      >
        Template error: {error}
      </div>
    );
  }

  if (!template) {
    return (
      <div
        style={{
          position: 'absolute', top: 0, right: 0, bottom: 0, left: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#334155', fontFamily: 'Inter, system-ui, sans-serif',
          fontSize: 26, fontWeight: 700, letterSpacing: 3,
        }}
      >
        LOADING SCOREBOARD…
      </div>
    );
  }

  // Sort zones by zIndex so painters' order is stable across renders.
  const sortedZones = [...(template.zones ?? [])].sort(
    (a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0),
  );

  return (
    <GameStateProvider gameId={gameId} initial={initial ?? null}>
      <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}>
        <div
          style={{
            position: 'absolute',
            width: template.screenWidth,
            height: template.screenHeight,
            left: '50%',
            top: '50%',
            transform: `translate(-50%, -50%) scale(${scale})`,
            transformOrigin: 'center center',
          }}
        >
          <div style={bgStyle(template)} />
          {sortedZones.map((z) => (
            <div
              key={z.id}
              style={{
                position: 'absolute',
                left: `${z.x}%`,
                top: `${z.y}%`,
                width: `${z.width}%`,
                height: `${z.height}%`,
                zIndex: z.zIndex ?? 1,
                overflow: 'hidden',
              }}
            >
              <WidgetPreview
                widgetType={z.widgetType}
                config={z.defaultConfig || {}}
                width={z.width}
                height={z.height}
                live
              />
            </div>
          ))}
        </div>
      </div>
    </GameStateProvider>
  );
}
