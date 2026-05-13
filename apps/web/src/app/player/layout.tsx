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
          // Two pairs of size params:
          //   w / h        — what Android reports as the controller's
          //                  display (e.g. NovaStar Taurus output =
          //                  1920×1080 even when the LED poster is
          //                  smaller).
          //   canvasW / canvasH — operator-supplied size of the LED's
          //                  actual VISIBLE pixels (e.g. 960×1080 for
          //                  a single-poster panel, 320×1080 for an
          //                  ultra-narrow tower).
          // The controller can't tell us LED dimensions — NovaStar's
          // tile mapping is hardware-level and not exposed to Android.
          // So the operator sets canvasW/canvasH once per screen via
          // the player's info overlay ("Resize for LED" button), we
          // persist to localStorage, and apply on every subsequent boot.
          var w=parseInt(p.get('w'),10);
          var h=parseInt(p.get('h'),10);
          var canvasW=parseInt(p.get('canvasW'),10);
          var canvasH=parseInt(p.get('canvasH'),10);
          // Persist URL-param values to localStorage so a manual reload
          // (without params) still applies them.
          try{
            if(canvasW>0)localStorage.setItem('edu_canvasW',String(canvasW));
            if(canvasH>0)localStorage.setItem('edu_canvasH',String(canvasH));
          }catch(e){}
          // Fall back to localStorage if URL didn't supply.
          if(!(canvasW>0)){try{canvasW=parseInt(localStorage.getItem('edu_canvasW'),10)||0;}catch(e){}}
          if(!(canvasH>0)){try{canvasH=parseInt(localStorage.getItem('edu_canvasH'),10)||0;}catch(e){}}
          // Effective canvas: operator override wins; controller size
          // fallback; nothing if neither is set (browser tab).
          var effW=canvasW>0?canvasW:(w>0?w:0);
          var effH=canvasH>0?canvasH:(h>0?h:0);
          if(effW>0&&effH>0){
            var m=document.querySelector('meta[name="viewport"]');
            if(m)m.content='width='+effW+', height='+effH+', initial-scale=1, user-scalable=no';
            // Pin documentElement + body to canvas size at top-left so
            // all our 100vw/100vh layouts resolve to the LED's actual
            // visible pixels — not to whatever the controller's frame
            // buffer happens to be. The CONTROLLER's frame buffer may
            // be larger (1920×1080 forced minimum on Taurus) — those
            // extra pixels are off-LED anyway, so we paint them black
            // via the body's bg.
            document.documentElement.style.width=effW+'px';
            document.documentElement.style.height=effH+'px';
            document.documentElement.style.overflow='hidden';
            // Body styles deferred to DOMContentLoaded — body element
            // may not exist yet when beforeInteractive runs.
            document.addEventListener('DOMContentLoaded',function(){
              if(document.body){
                document.body.style.width=effW+'px';
                document.body.style.height=effH+'px';
                document.body.style.margin='0';
                document.body.style.padding='0';
                document.body.style.background='#000';
                document.body.style.overflow='hidden';
              }
            });
            // Expose to CSS as custom props so any layout that wants
            // to honor the canvas explicitly (instead of vw/vh) can
            // read --led-w / --led-h.
            document.documentElement.style.setProperty('--led-w',effW+'px');
            document.documentElement.style.setProperty('--led-h',effH+'px');
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
