'use client';

/**
 * VenueOS Sports — Sprint 13. The broadcast stream-overlay (full canvas).
 *
 * PUBLIC route (no auth). Add the URL as a "browser source" in OBS /
 * vMix / Hudl at a 1920×1080 source size and the live game state — the
 * SAME poll-cached /sports/board/:id payload the in-venue board, ribbon,
 * and corner scorebug read — composites over the livestream video.
 * Because the board and the stream overlay share one source of truth,
 * they can never disagree: no double entry, no "the bug says 14 but the
 * board says 13" drift.
 *
 * Why this exists alongside /scorebug: the corner-bug route docks to the
 * live VIEWPORT edges, so it shifts position/size when the producer's
 * output resolution isn't exactly 1080p. THIS route pins the bug inside
 * a fixed 1920×1080 broadcast canvas and transform:scales the whole
 * canvas to the browser-source size — the same pattern the in-venue
 * /board page uses — so the overlay looks identical at 720p, 1080p, or
 * 4K. That's the surface a real broadcast (NFHS Network / Hudl) wants.
 *
 * Query params (all optional):
 *   ?surface=stream   marks the broadcast-overlay surface role (default;
 *                     accepted + reserved for future per-surface tuning).
 *   ?pos=tl|tr|bl|br  corner to dock the bug into       (default br —
 *                     lower-right is the broadcast scorebug convention).
 *   ?scale=1.4        size multiplier on the bug         (default 1).
 *   ?theme=<token>    brand-shim theme token             (reserved).
 *   ?home=LIN ?away=CEN  override team codes             (default: first
 *                     word of each team name).
 *
 * Query params are read from window.location (NOT useSearchParams) so
 * this public route needs no Suspense boundary and stays clean in the
 * Next production build — the same pattern the sibling /ribbon page uses.
 *
 * Cross-browser: renders in OBS/vMix's embedded CEF (modern Chromium),
 * so the NovaStar-Taurus Chromium-83 constraint doesn't strictly apply
 * — but the shared bug is built to the Taurus-safe baseline anyway
 * (long-hand top/right/bottom/left, no flex `gap`).
 */

import { useParams } from 'next/navigation';
import {
  BroadcastOverlay,
  useScorebugQuery,
} from '@/components/sports/ScorebugSurface';

export default function StreamOverlayPage() {
  const params = useParams();
  const gameId = String(params?.gameId || '');

  // Lower-right is the standard broadcast scorebug corner; default to
  // it (the corner-bug route defaults to lower-left). ?pos= overrides.
  const { pos, scale, homeOverride, awayOverride, theme } = useScorebugQuery('br');

  return (
    <BroadcastOverlay
      gameId={gameId}
      pos={pos}
      scale={scale}
      homeOverride={homeOverride}
      awayOverride={awayOverride}
      accent={theme}
    />
  );
}
