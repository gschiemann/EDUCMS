'use client';

/**
 * VenueOS Sports — Sprint 13 Phase 2. The broadcast scorebug overlay.
 *
 * PUBLIC route (no auth). Designed to be added as a "browser source"
 * in OBS / vMix / Streamlabs: a compact, transparent-background score
 * bug that sits in a corner of the livestream. It polls the same
 * un-authed /sports/board/:id endpoint as the in-venue scoreboard, so
 * one operator console drives both the big board and the broadcast.
 *
 * Query params (all optional):
 *   ?pos=tl|tr|bl|br   corner to dock in        (default bl)
 *   ?scale=1.4         size multiplier          (default 1)
 *   ?home=LIN ?away=CEN  override team codes    (default: first word)
 *
 * This route docks the bug to the live browser-source VIEWPORT edges.
 * For a bug pinned inside a fixed 1920×1080 broadcast canvas (so it
 * renders pixel-identically at 720p / 1080p / 4K output), use the
 * /overlay/[gameId] route — same bug, same live data, canvas-scaled.
 *
 * All the polling / cue / live-clock / CTS-merge logic + the bug body
 * itself live in the shared ScorebugSurface module so this route and
 * /overlay/[gameId] can never drift apart.
 *
 * Query params are read from window.location (NOT useSearchParams) so
 * this public route needs no Suspense boundary and stays clean in the
 * Next production build — the same pattern the sibling /ribbon page uses.
 *
 * Transparency: the shared ScorebugTransparentCss clears the document
 * background + hides the dashboard's decorative gradient. OBS also
 * zeroes the body itself, so the bug composites cleanly over video.
 */

import { useParams } from 'next/navigation';
import {
  ScorebugBug,
  ScorebugTransparentCss,
  useScorebugData,
  useScorebugQuery,
} from '@/components/sports/ScorebugSurface';
// Sprint 13 — when Game.scorebugTemplateId is set, hand the entire
// scorebug overlay off to the custom-template renderer. The operator
// picks a template at a tight aspect ratio (e.g. 800×120 OBS-overlay).
import { CustomScoreboardScene } from '../../board/[gameId]/CustomScoreboardScene';

export default function ScorebugPage() {
  const params = useParams();
  const gameId = String(params?.gameId || '');

  // Corner-bug convention: dock lower-left by default. ?pos= overrides.
  const { pos, scale, homeOverride, awayOverride } = useScorebugQuery('bl');

  const { data, def, view, liveMs, activeCue } = useScorebugData(gameId);

  // Pre-data / unknown sport → render nothing. An OBS overlay must
  // never flash a loading or error box onto a live broadcast.
  if (!data || !def || !view) return ScorebugTransparentCss;

  // Sprint 13 — operator picked a custom scorebug template. The
  // template canvas can be any aspect ratio; the broadcast operator
  // typically picks a small (e.g. 800×120) overlay. Same renderer
  // as /board /ribbon; the canvas size differentiates the surface.
  if (data.scorebugTemplateId) {
    return (
      <>
        {ScorebugTransparentCss}
        <CustomScoreboardScene
          templateId={data.scorebugTemplateId}
          gameId={gameId}
          initial={view}
          embedded={(data as { scorebugTemplate?: any }).scorebugTemplate ?? null}
        />
      </>
    );
  }

  return (
    <>
      {ScorebugTransparentCss}
      <div
        style={{
          position: 'fixed',
          [pos.v]: 0,
          [pos.h]: 0,
          padding: 32,
          zIndex: 2147483000,
        }}
      >
        <ScorebugBug
          view={view}
          def={def}
          liveMs={liveMs}
          activeCue={activeCue}
          pos={pos}
          scale={scale}
          homeOverride={homeOverride}
          awayOverride={awayOverride}
        />
      </div>
    </>
  );
}
