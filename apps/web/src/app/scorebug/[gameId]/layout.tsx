import type { Metadata } from 'next';

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
  return <>{children}</>;
}
