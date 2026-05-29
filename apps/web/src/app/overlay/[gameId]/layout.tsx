import type { Metadata } from 'next';

/**
 * VenueOS Sports — Sprint 13. Broadcast stream-overlay (full canvas).
 *
 * A transparent-background broadcast overlay for livestream production
 * — drop the route URL into an OBS / vMix / Hudl "browser source" and
 * the same game that drives the in-venue scoreboard also drives the
 * broadcast overlay. One operator console, two surfaces; the bug and
 * the board can never disagree because both read the same game state.
 *
 * Unlike /scorebug (which docks to the live viewport edges), this
 * route pins the bug inside a fixed 1920×1080 canvas and scales the
 * canvas to the browser-source size, so it renders pixel-identically
 * at any output resolution.
 *
 * The page itself injects the CSS that makes the document transparent
 * (so the video shows through) — a layout can't reach the root <body>.
 */
export const metadata: Metadata = {
  title: 'VenueOS Stream Overlay',
  description: 'Broadcast scorebug overlay for livestream production',
};

export default function OverlayLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
