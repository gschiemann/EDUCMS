import type { Metadata, Viewport } from 'next';

/**
 * VenueOS Sports — Sprint 13. Stadium ribbon-board route layout.
 *
 * A ribbon / fascia board is a long, short LED strip that wraps a
 * stadium (≈1000mm tall × 40+ feet wide). This route renders a
 * seamless horizontal scroll sized for that extreme aspect ratio —
 * full-bleed black, zoom locked, exactly like /player and /board.
 * Public route: a ribbon shows the same game data the scoreboard does.
 */
export const metadata: Metadata = {
  title: 'VenueOS Ribbon Board',
  description: 'Stadium ribbon / fascia board display',
};

export const viewport: Viewport = {
  themeColor: '#000000',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RibbonLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        background: '#000',
        overflow: 'hidden',
      }}
    >
      {children}
    </div>
  );
}
