'use client';

/**
 * THE LAZY RENDERER ISLAND (P0-3, 2026-09-02).
 *
 * ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────
 * `/player` used to reach its `POST /screens/register` call only AFTER the
 * browser had downloaded and parsed the ENTIRE widget/template world: the
 * 5.5k-line `WidgetRenderer` plus `variants-register`'s boot-time
 * registration of every themed variant. Measured on a production build
 * (`apps/web/tools/measure-player-boot.cjs`): 33 JS chunks / 6.63 MB, all
 * of it in flight before register fired, with ONE 3.53 MB chunk that is
 * nothing but the widget catalog. On a low-memory OEM Android panel that is
 * the difference between "pairs in a second" and "sits on Connecting…".
 *
 * Registration and pairing are the only things a fresh device needs first.
 * So the renderer graph lives HERE, behind a single dynamic `import()`, and
 * `page.tsx` no longer names `WidgetRenderer`, `WidgetErrorBoundary` or
 * `variants-register` anywhere in its static import list.
 *
 * ── THE RULES THIS FILE MUST KEEP ────────────────────────────────────────
 * • Emergency stays first-class (player rule 11). The emergency OVERLAY
 *   (`EmergencyOverlay`) and the native emergency hold are statically
 *   imported by `page.tsx` and render OUTSIDE the Suspense boundary that
 *   gates this module — an alert paints with what is already loaded, never
 *   waiting on this chunk. `preloadPlayerRenderer()` is nevertheless fired
 *   on the emergency path too, so a template-shaped alert surface is warm.
 * • Offline boot stays intact. `sw-player.js` cache-first-caches every
 *   `/_next/static/**` it sees (runtime capture) and — since this wave —
 *   its shell prune KEEPS lazily-captured chunks instead of evicting them
 *   (the file's own STEP-3 GUARD, now honoured). So the first online boot
 *   pins this chunk and every later cold offline boot serves it from cache.
 *
 * Do NOT add a static import of this module anywhere. The whole point is
 * that the specifier `./rendererBundle` appears only inside `import()`.
 */

// Boot-time registration for custom themes — now paid on the LAZY chunk,
// not on the pairing path. Importing this module is what arms the registry,
// and the registry is only ever read by `WidgetPreview` below, so the two
// can never get out of order.
import '@/components/widgets/variants-register';

import { WidgetPreview } from '@/components/widgets/WidgetRenderer';
import { WidgetErrorBoundary } from '@/components/widgets/WidgetErrorBoundary';

export interface PlayerZoneWidgetProps {
  /** Zone id — doubles as the error-boundary reset key. */
  zoneId: string;
  widgetType: string;
  /** Widget config blob — shape is per-widget; `WidgetPreview` types it. */
  config: unknown;
  /** Zone width/height as canvas-relative percentages. */
  width: number;
  height: number;
}

/**
 * One template zone's live widget, error-boundary included.
 *
 * page.tsx renders exactly this — the boundary + preview pair it used to
 * spell out inline — so the lazy chunk has a single default export and the
 * page keeps ONE `import()` specifier.
 */
export default function PlayerZoneWidget({
  zoneId,
  widgetType,
  config,
  width,
  height,
}: PlayerZoneWidgetProps) {
  return (
    // Per-widget error boundary — one throwing widget can no longer crash
    // the whole player into the recovery loop. `quiet` blanks just that
    // zone on a live kiosk.
    <WidgetErrorBoundary quiet resetKey={zoneId} widgetLabel={widgetType}>
      <WidgetPreview
        widgetType={widgetType}
        config={config}
        width={width}
        height={height}
        live={true}
        // Sports Wave S2 (2026-07-02) — this IS a real screen. A sports
        // widget with no bound game (no ambient GameStateProvider, no
        // config.gameId) must render its dignified "bind a game" empty
        // state here, never the builder-only fabricated sample. See
        // GameStateContext.tsx.
        renderSurface="player"
      />
    </WidgetErrorBoundary>
  );
}

/**
 * The bare widget for `TouchNavOverlay`'s cross-template navigation zones.
 *
 * TouchOverlay.tsx used to import `WidgetPreview` statically, which put the
 * entire widget catalog back on /player's boot path through the side door —
 * the split is only real if EVERY player-side renderer entry goes through
 * this module. Deliberately NO error boundary here: that matches the
 * overlay's behaviour before the split exactly (the per-zone boundary is a
 * main-canvas feature), so this wave changes bundling only.
 */
export function TouchZoneWidget({
  widgetType,
  config,
  width,
  height,
}: Omit<PlayerZoneWidgetProps, 'zoneId'>) {
  return (
    <WidgetPreview
      widgetType={widgetType}
      config={config}
      width={width}
      height={height}
      live={true}
      // Sports Wave S2 (2026-07-02) — this is a real kiosk screen (a visitor
      // navigated here), not a builder preview. A sports widget with no
      // bound game must render its "bind a game" empty state, never a
      // fabricated sample. See GameStateContext.tsx.
      renderSurface="player"
    />
  );
}
