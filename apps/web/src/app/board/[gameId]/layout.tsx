import type { Metadata, Viewport } from 'next';

/**
 * VenueOS Sports — Sprint 13. The scoreboard board route layout.
 *
 * A scoreboard display lives on a stadium screen / video processor
 * feed, so this route is full-bleed black with zoom locked, exactly
 * like the /player route. It is a PUBLIC route — no auth — because
 * scoreboard data is public information shown to a crowd.
 *
 * The page itself renders a fixed 1920×1080 scene and scales it to
 * fit whatever canvas it lands on (transform:scale pattern), so the
 * board reads correctly on a 1080p TV, a 4K processor, or a wide LED
 * ribbon crop.
 */
export const metadata: Metadata = {
  title: 'VenueOS Scoreboard',
  description: 'Live scoreboard display',
};

export const viewport: Viewport = {
  themeColor: '#000000',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function BoardLayout({
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
