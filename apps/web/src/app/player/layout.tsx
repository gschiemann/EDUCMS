import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
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
    <>
      {/* 2026-05-13 — viewport-meta pinning for non-standard LED
          canvases. Operator (Taurus mosaic, 960×1080): splash rendered
          in the top-right area of the LED as if the layout was
          1920×1080 wide, only filling the canvas correctly once
          content played. Root cause: the WebView's CSS viewport was
          reporting whatever the Taurus board's internal frame buffer
          is (often 1920×1080 or 4K), not the LED's actual visible
          canvas. The default viewport meta uses `width=device-width`
          which inherits that wrong value.

          The Player APK passes the real canvas via ?w=...&h=... URL
          params. We rewrite the viewport meta from those BEFORE React
          renders so 100vw / 100vh resolve to the LED canvas, not the
          controller's frame buffer. Runs synchronously in head; no
          first-paint flash.

          Browser players (no URL params) keep the device-width default.
       */}
      <Script id="player-viewport-pin" strategy="beforeInteractive">
        {`(function(){try{
          var p=new URLSearchParams(location.search);
          var w=parseInt(p.get('w'),10);
          var h=parseInt(p.get('h'),10);
          if(w>0&&h>0){
            var m=document.querySelector('meta[name="viewport"]');
            if(m)m.content='width='+w+', height='+h+', initial-scale=1, user-scalable=no';
            // Also pin html/body explicit dimensions as a belt-and-
            // braces fallback: some Android WebViews ignore viewport
            // meta after page-load. Setting documentElement size
            // forces every % / vw / vh calc to use the LED canvas.
            document.documentElement.style.width=w+'px';
            document.documentElement.style.height=h+'px';
            document.documentElement.style.overflow='hidden';
          }
        }catch(e){}})();`}
      </Script>
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
            / alert so the player's settings overlay (Unpair Device,
            etc) stays inside the EduCMS visual language even on a
            kiosk where the OS chrome is hidden. */}
        <AppDialogHost />
      </div>
    </>
  );
}
