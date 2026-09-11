'use client';

/**
 * RenderSurface — "am I the builder canvas, or a real screen?"
 *
 * ── WHY THIS FILE EXISTS (2026-09-11) ─────────────────────────────────
 * This context was born inside `sports/GameStateContext.tsx` (Sports Wave
 * S2, 2026-07-02) to stop sport widgets rendering fabricated athletes and
 * scores on a real screen with no game bound. Read that file's header for
 * the original rationale — it is still the canonical write-up.
 *
 * It was never sports-specific. The same question — "is anyone actually
 * looking at this, or is an operator laying it out?" — decides what EVERY
 * widget should do when it has no content configured. The fitness /
 * restaurant / retail / bar packs need the identical signal, and importing
 * `sports/GameStateContext` to get it would drag `board-poll`,
 * `cts-merge` and `@cms/api-types` into every one of those chunks for a
 * 6-line context.
 *
 * So the context moved HERE and `sports/GameStateContext.tsx` re-exports
 * it. That is deliberately a MOVE, not a copy: there is exactly one
 * `RenderSurfaceContext` object in the app, so a `<RenderSurfaceProvider>`
 * mounted by the player is seen by sport widgets and vertical-pack widgets
 * alike. Two contexts would silently give one of the two packs the wrong
 * answer, which is the entire bug class this guards.
 *
 * ── THE CONTRACT ──────────────────────────────────────────────────────
 *   'builder' (the DEFAULT — set nowhere)
 *       The builder canvas, the gallery thumbnail, the preview modal, the
 *       App Library config preview, and every test that renders a widget
 *       directly. An OPERATOR is looking at it. A widget with nothing
 *       configured must say so, in the operator's words, and name the next
 *       action ("Add your first creative").
 *
 *   'player' (set ONLY by `apps/web/src/app/player/rendererBundle.tsx`,
 *       which is what `apps/web/src/app/player/page.tsx` and
 *       `components/player/TouchOverlay.tsx` render through)
 *       A REAL screen on a wall. The PUBLIC is looking at it. A widget
 *       with nothing configured must render neither fabricated content nor
 *       an authoring prompt — it holds its zone quietly and says nothing.
 *
 * See `WidgetEmptyState.tsx` for the component that implements both sides
 * of that contract, and CLAUDE.md §19 for why it is a launch blocker.
 */

import { createContext, useContext, type ReactNode } from 'react';

export type RenderSurface = 'builder' | 'player';

const RenderSurfaceContext = createContext<RenderSurface>('builder');

export function RenderSurfaceProvider({
  surface,
  children,
}: {
  surface: RenderSurface;
  children: ReactNode;
}) {
  return (
    <RenderSurfaceContext.Provider value={surface}>
      {children}
    </RenderSurfaceContext.Provider>
  );
}

export function useRenderSurface(): RenderSurface {
  return useContext(RenderSurfaceContext);
}
