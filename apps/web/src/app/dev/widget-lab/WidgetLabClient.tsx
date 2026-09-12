'use client';

/**
 * WIDGET LAB — render ONE widget at a REAL canvas size, in a REAL browser.
 *
 * ── WHY THIS EXISTS (2026-09-11) ──────────────────────────────────────
 * Every previous attempt to grade widget layout was done in jsdom, and jsdom
 * has no layout engine: `getBoundingClientRect()` is all zeros, so any widget
 * that measures its own box (`useScaleToFit` and friends) renders NOTHING and
 * every assertion about it passes vacuously. A jsdom sweep of all 702 variants
 * reported 230 of them "blank" — every one of those was the harness, not the
 * widget. CLAUDE.md rule #9 is the same lesson in a different costume: a green
 * check against a surface nobody renders proves nothing.
 *
 * So: a page that mounts a widget through the SAME `WidgetPreview` path the
 * builder canvas and the player use, inside a stage of exactly the requested
 * pixel size, with the widget families warmed first. `apps/web/tools/
 * widget-legibility/measure.mjs` drives it with Playwright and measures what is
 * actually painted — computed font sizes, overlapping text boxes, content
 * escaping the zone.
 *
 * ── NOT SHIPPED ───────────────────────────────────────────────────────
 * Dev-only. In a production build this renders a 404-ish stub and mounts
 * nothing: it is an unauthenticated widget renderer, which is fine on a
 * developer's laptop and not something to expose on venue-os.app.
 *
 * Query params: ?id=<variantId>&w=3840&h=2160[&live=1][&surface=player]
 *               ?tile=1&id=<variantId>  — render the PICKER THUMBNAIL instead
 *
 * ── TILE MODE (2026-09-12) ────────────────────────────────────────────
 * The picker does NOT render a widget the way the canvas does: it calls the
 * variant's own `render` with `{...defaultConfig, _thumb: true}` inside a 16:10
 * box at a fixed `fontSize: 14px` (VariantPicker.tsx — `data-tile-preview`).
 * Measuring the canvas path and calling it a thumbnail check would grade a
 * surface the operator never sees, so tile mode reproduces the picker's box
 * exactly, `_thumb` included. Operator, 2026-09-12: *"the MJ one is over
 * lapping the widget and the confetti one isnt vidsible."*
 */

import { useEffect, useState } from 'react';
import { WidgetPreview, warmVariantRegistry } from '@/components/widgets/WidgetRenderer';
import { WidgetErrorBoundary } from '@/components/widgets/WidgetErrorBoundary';
import { warmAllWidgetFamilies } from '@/components/widgets/widget-families';
import { getVariant, listVariants } from '@/components/widgets/variants';
import '@/components/widgets/variants-register';

const ENABLED = process.env.NODE_ENV !== 'production';

export default function WidgetLabClient() {
  const [ready, setReady] = useState(false);
  const [params, setParams] = useState<URLSearchParams | null>(null);

  useEffect(() => {
    if (!ENABLED) return;
    setParams(new URLSearchParams(window.location.search));
    let alive = true;
    // Warm BEFORE painting. A lazy family proxy renders null until its chunk
    // resolves, and a measurer that screenshots first would grade an empty box.
    Promise.all([warmAllWidgetFamilies(), warmVariantRegistry()]).then(() => {
      if (alive) setReady(true);
    });
    return () => { alive = false; };
  }, []);

  if (!ENABLED) return <div>Not available.</div>;
  if (!ready || !params) return <div data-lab-state="warming">warming…</div>;

  const id = params.get('id') || '';
  const w = Math.max(80, Number(params.get('w') || 3840));
  const h = Math.max(80, Number(params.get('h') || 2160));
  const live = params.get('live') === '1';

  // ?list=1 — the measurer reads the roster from the running app rather than
  // from a second, drifting copy of the registry.
  if (params.get('list') === '1') {
    return (
      <pre data-lab-state="list">
        {JSON.stringify(listVariants().map((v) => ({ id: v.id, type: String(v.widgetType) })))}
      </pre>
    );
  }

  // ?type=RSS_FEED — render a bare widget TYPE with no variant. This is how
  // the 106 renderer-supported types that have NO picker tile get measured at
  // all; they are unreachable through `getVariant`.
  const bareType = params.get('type');
  const v = bareType ? { id: bareType, widgetType: bareType, defaultConfig: {} } : getVariant(id);
  if (!v) return <div data-lab-state="unknown-variant">no variant {id}</div>;

  // ?tile=1 — the picker thumbnail, byte-for-byte the same mount VariantPicker
  // uses. `w` is the box width; the height follows the 16:10 the picker sets.
  if (params.get('tile') === '1') {
    const full = getVariant(id);
    if (!full || typeof full.render !== 'function') {
      return <div data-lab-state="unknown-variant">no tile {id}</div>;
    }
    const TileRender = full.render as (p: { config: Record<string, unknown>; compact: boolean }) => React.ReactNode;
    const tw = Math.max(80, Number(params.get('w') || 185));
    const th = Math.round((tw * 10) / 16);
    return (
      <div data-lab-state="ready" style={{ margin: 0, background: '#ffffff' }}>
        {/* No `overflow: hidden` here ON PURPOSE — the picker clips, but a tile
            that needs the clip is still drawing outside its frame, and that is
            exactly what this harness exists to catch. The measurer compares
            painted rects against the stage. */}
        <div
          data-lab-stage="1"
          data-tile-preview
          style={{ position: 'relative', width: tw, height: th, fontSize: '14px', background: '#f1f5f9' }}
        >
          <div className="absolute top-0 right-0 bottom-0 left-0">
            <WidgetErrorBoundary resetKey={full.id} widgetLabel={String(full.name || full.id)}>
              <TileRender config={{ ...(full.defaultConfig || {}), _thumb: true }} compact={false} />
            </WidgetErrorBoundary>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div data-lab-state="ready" style={{ margin: 0, background: '#000' }}>
      <div
        data-lab-stage="1"
        style={{ position: 'relative', width: w, height: h, overflow: 'hidden' }}
      >
        <WidgetPreview
          widgetType={String(v.widgetType)}
          config={bareType ? {} : { ...(v.defaultConfig || {}), variant: v.id }}
          width={100}
          height={100}
          live={live}
        />
      </div>
    </div>
  );
}
