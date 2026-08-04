import type { Metadata } from 'next';
// Chromium-83/95/101 (NovaStar Taurus) runtime fixes — flex `gap` +
// container-query units. See the /board layout note. The scorebug is usually
// an OBS/vMix browser source on a modern engine (where this installs nothing),
// but the route is in the taurus-safety gate's SCAN_DIRS alongside /board and
// /ribbon because the same overlay is also driven onto in-venue LED, so it
// gets the same treatment rather than a third behaviour.
import { TaurusPolyfills } from '@/components/player/TaurusPolyfills';

/**
 * VenueOS Sports — Sprint 13 Phase 2. Broadcast scorebug overlay.
 *
 * A transparent-background score bug for livestream production —
 * drop the route URL into an OBS / vMix / Streamlabs "browser source"
 * and the same game that drives the in-venue scoreboard also drives
 * the broadcast overlay. One operator console, two surfaces.
 *
 * The page itself injects the CSS that makes the document transparent
 * (so the video shows through) — a layout can't reach the root <body>.
 */
export const metadata: Metadata = {
  title: 'VenueOS Stream Overlay',
  description: 'Broadcast scorebug overlay for livestream production',
};

export default function ScorebugLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <TaurusPolyfills />
      {children}
    </>
  );
}
