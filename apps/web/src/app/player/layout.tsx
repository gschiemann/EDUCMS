import type { Metadata, Viewport } from 'next';
import { AppDialogHost } from '@/components/ui/app-dialog';

export const metadata: Metadata = {
  title: 'VenueOS Player',
  description: 'Digital signage player for screens',
  manifest: '/player/manifest.json',
};

export const viewport: Viewport = {
  themeColor: '#000000',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function PlayerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // 2026-05-13 — Tailwind-fallback inline styles. The Player WebView
    // on a NovaStar Taurus controller was failing to load the global
    // Tailwind CSS bundle (root cause varied per device — cert/cache/
    // CDN reach), and this wrapper's "fixed inset-0 bg-black" Tailwind
    // classes were the ONLY thing keeping the body's bg-slate-50
    // (#f8fafc, near-white) from showing through behind the splash.
    // Without Tailwind: white screen, even though the page server-
    // rendered correctly and the API was happy. Operator lost an
    // evening to this. Inline `style` is bulletproof — works
    // regardless of what loads from the CSS bundle.
    <div
      className="fixed inset-0 bg-black overflow-hidden"
      style={{
        position: 'fixed',
        top: 0, left: 0, right: 0, bottom: 0,
        width: '100vw',
        height: '100vh',
        background: '#000',
        overflow: 'hidden',
      }}
    >
      {children}
      {/* Themed confirm/alert dialogs — replaces native window.confirm
          / alert so the player's settings overlay (Unpair Device, etc)
          stays inside the EduCMS visual language even on a kiosk where
          the OS chrome is hidden. */}
      <AppDialogHost />
    </div>
  );
}
