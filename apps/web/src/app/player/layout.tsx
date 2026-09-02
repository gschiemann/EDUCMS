import type { Metadata, Viewport } from 'next';
import { AppDialogHost } from '@/components/ui/app-dialog';

// 2026-06-27 — LAUNCH-BLOCKING root cause of "deploys never reach the kiosk".
// The /player route is a client app with no per-request data, so Next.js
// STATICALLY PRERENDERS it and Vercel serves that HTML from its edge cache.
// Live-confirmed on the production LED: `GET /player` returned
// `x-vercel-cache: HIT, age: 21170` (~6 HOURS stale), so a kiosk — even a
// freshly-restarted one — fetched old HTML that referenced the OLD JS chunk
// hashes, and never loaded shipped fixes (the emergency cut-off, etc.). The
// `Cache-Control: no-store` we set in next.config controls the BROWSER, not
// Vercel's own static-route cache, so it didn't help.
//
// `force-dynamic` makes Vercel render /player per-request (never edge-cache the
// HTML), so every kiosk fetch gets HTML pointing at the CURRENT bundle. The
// page itself is still a client component — this only affects how the shell
// HTML is served (cheap), and it's the one change that makes deploys actually
// land on the glass. Pairs with the player's cache-busting reload.
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

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
    // CDN reach), and this wrapper's "fixed top-0 right-0 bottom-0 left-0 bg-black" Tailwind
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

          2026-05-26 — switched from <Script strategy="beforeInteractive">
          to a raw inline <script dangerouslySetInnerHTML>. Per Next.js
          16 App Router docs, `beforeInteractive` is ONLY honored in the
          ROOT layout (apps/web/src/app/layout.tsx); when used in a
          NESTED layout (which this is, /app/player/layout.tsx) it
          silently falls back to `afterInteractive`, which means the
          script is queued via `__next_s.push(...)` and runs AFTER React
          hydration. By that point KioskSplash has already measured its
          viewport (1920×1080 on Taurus) and laid out — the pin's
          html/body resize comes too late to affect first paint, and the
          operator saw the splash content (logo, code, status) rendered
          centered in a 1920px-wide frame while the LED panel only
          showed the leftmost 320px = no readable content. A raw inline
          script runs synchronously at parse time, so the resize lands
          BEFORE the splash measures `vw/vh`. Verified via Playwright
          probe at 1920×1080 viewport with `?w=1920&h=1080&canvasW=320
          &canvasH=1080`: before-fix `htmlWidth=1920px`, after-fix
          `htmlWidth=320px` and `matchesMaxWidth480: true`.

          Also: when `effW > 0 && effH > 0` we set a `data-led-narrow`
          attribute on <html> for the splash's CSS to consume. This
          unlocks the narrow-stack layout EVEN when the Android WebView
          reports its viewport at the controller's frame buffer
          dimensions (1920×1080) rather than the LED canvas dimensions.
       */}
      <script
        dangerouslySetInnerHTML={{
          __html: `(function(){try{
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
          // fallback; viewport fallback when neither URL param is set.
          // 2026-05-26 — previously fell through to nothing when no
          // params were present, leaving --led-w / --led-h EMPTY.
          // Operator photo showed "LED —×—" because of that. Now we
          // ALWAYS publish a canvas to CSS — even if it's just the
          // viewport. The narrow-stack data-led-narrow heuristic only
          // fires for genuinely narrow LEDs.
          // 2026-09-01 — LED POSTER CLASS at first paint (NovaStar TB,
          // Rockchip rk356x_box on Chromium 83). These boxes show the TOP-LEFT
          // of their OS canvas, cannot report the LED module size, and the
          // controller floors the OS width at 600 (factory 1920) while a
          // single poster is 320×1080 (or another module per pixel pitch).
          // With no explicit canvas (URL / localStorage — an operator's
          // value always wins), size a single poster to the standard module
          // and a chain to the OS width the operator set in ViPlex (a clean
          // multiple of the standard). This is what makes the install status
          // and the PAIRING CODE land inside the visible column before the
          // screen has a tenant. The reference rule, unit-tested, is
          // apps/web/src/app/player/posterCanvas.ts — keep these in step.
          var posterUa=(typeof navigator!=='undefined'&&navigator.userAgent||'').toLowerCase();
          var posterClass=posterUa.indexOf('rk356x_box')!==-1||posterUa.indexOf('rk3568')!==-1||posterUa.indexOf('taurus')!==-1||posterUa.indexOf('novastar')!==-1||posterUa.indexOf('nova-star')!==-1;
          var posterAuto=false;
          if(posterClass&&!(canvasW>0)&&!(canvasH>0)){
            var stdW=320,stdH=1080;
            try{var stdRaw=localStorage.getItem('edu_posterStandard');if(stdRaw){var stdObj=JSON.parse(stdRaw);if(stdObj&&stdObj.w>=32&&stdObj.h>=32&&stdObj.w<=8192&&stdObj.h<=8192){stdW=Math.round(stdObj.w);stdH=Math.round(stdObj.h);}}}catch(e){}
            var chain=(w>stdW&&w%stdW===0&&w/stdW<=6&&w!==1920&&w!==3840);
            canvasW=chain?w:stdW;canvasH=stdH;posterAuto=true;
          }
          var effW=canvasW>0?canvasW:(w>0?w:(typeof window!=='undefined'?window.innerWidth:0));
          var effH=canvasH>0?canvasH:(h>0?h:(typeof window!=='undefined'?window.innerHeight:0));
          // Operator escape hatch: ?narrow=1 forces narrow-stack mode
          // regardless of detected dimensions. Useful when the LED is
          // narrow but you haven't run "Resize for LED" yet.
          var forceNarrow=(p.get('narrow')==='1');
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
            // Body styles applied IMMEDIATELY when body already exists
            // (this raw inline script runs after <body> opens but
            // before any siblings). Falls back to a DOMContentLoaded
            // listener if body somehow isn't ready yet.
            function pinBody(){
              if(!document.body)return false;
              document.body.style.width=effW+'px';
              document.body.style.height=effH+'px';
              document.body.style.margin='0';
              document.body.style.padding='0';
              document.body.style.background='#000';
              document.body.style.overflow='hidden';
              return true;
            }
            if(!pinBody()){
              document.addEventListener('DOMContentLoaded',pinBody);
            }
            // Expose to CSS as custom props so any layout that wants
            // to honor the canvas explicitly (instead of vw/vh) can
            // read --led-w / --led-h.
            document.documentElement.style.setProperty('--led-w',effW+'px');
            document.documentElement.style.setProperty('--led-h',effH+'px');
            // 2026-05-26 — narrow-LED hint for the splash CSS. A
            // 320×1080 portrait LED panel pinned via canvasW/canvasH
            // would set effW=320; we flag it so the splash stacks
            // vertically EVEN when (a) the operator never explicitly
            // picks a narrow layout AND (b) the Android WebView reports
            // its viewport at 1920×1080 (Taurus frame-buffer minimum)
            // so the (max-width: 480px) CSS media query never matches.
            // Threshold: < 600 px wide OR taller than 2× wide is a
            // poster shape. Matches the operator's 320×1080 install
            // and the planned 480×1920 hallway pillars.
            if(forceNarrow||effW<600||effH>effW*2){
              document.documentElement.setAttribute('data-led-narrow','1');
            }
            // Mark whether canvas params were operator-supplied vs
            // viewport-fallback. The diagnostic strip surfaces this so
            // the operator can tell at a glance whether they need to
            // run "Resize for LED". cfg=Y means configured; cfg=N
            // means we're using the WebView viewport as a best guess.
            document.documentElement.setAttribute(
              'data-led-cfg',
              (canvasW>0||canvasH>0)?'1':'0'
            );
            // The poster rule sized this paint automatically — say so, for
            // the diagnostics strip and for anything that must not mistake it
            // for an operator's value.
            if(posterAuto)document.documentElement.setAttribute('data-led-poster','auto');
          }
        }catch(e){}})();`,
        }}
      />
      {/* 2026-05-13 — Chromium-83 CSS-inset polyfill.
          NovaStar Taurus controllers ship Chromium 83. The CSS `inset`
          shorthand was added in Chrome 87, so EVERY widget that uses
          `position: absolute; inset: 0` (which is ~25+ of our themed
          widgets — AnimatedWelcomePortrait, StorybookCafeteria, etc.)
          collapses to a 0×0 element at the top-left of its parent.
          Their `useScaleToFit` hook then reads offsetWidth=0, sets
          scale=0, and the content renders invisibly — operator saw the
          template's background gradient but no actual scene content.
          This attribute-selector trick force-applies long-hand sides
          to any element with inline `inset: 0` or `inset: 0px`. Doesn't
          touch widgets that explicitly set their own top/left/right/
          bottom values (we only override side values when inset=0 was
          set, and !important so external CSS wins over the inline 0
          values that browsers normally resolve from `inset`). */}
      <style>{`
        /* Match either "inset: 0" or "inset:0" anywhere in the style
           attribute. CSS attribute selectors compare the raw HTML
           attribute string, so matching works regardless of whether
           Chromium 83 actually parsed the inset property — which it
           doesn't. The two variants cover React's CSSOM serialization
           (with-space) and any inline minified style strings (no-space).
           Sub-pixel values like "inset: 0.5em" would also match here
           and get clobbered to 0 — but we don't use fractional inset
           values anywhere in the widget pack, so the override is safe. */
        [style*="inset: 0"],
        [style*="inset:0"] {
          top: 0 !important;
          right: 0 !important;
          bottom: 0 !important;
          left: 0 !important;
        }

        /* 2026-05-26 — The player-root-wrapper (a few lines below this
           style block) uses width:var(--led-w,100vw); height:var(--led-h,
           100vh). When the pin script set --led-w/--led-h to the LED
           canvas, the wrapper resizes to match — the connected-splash
           inside it then centers in the LED canvas instead of the
           controller's frame buffer. No CSS-attribute override needed.

           Documented here so a future agent doesn't put width: 100vw
           back on the wrapper "for safety" — that's the bug that
           caused the 2026-05-26 round-3 splash regression. */
      `}</style>
      <div
        className="fixed top-0 right-0 bottom-0 left-0 bg-black overflow-hidden player-root-wrapper"
        style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          // 2026-05-26 — width/height use --led-w/--led-h when the pin
          // script set them (narrow LED canvas), falling back to 100vw/
          // 100vh on browsers (no canvas info). var(--name, fallback)
          // is the CSS spec way to do this; older Chromium honors it.
          // Without this, the wrapper sized 100vw=1920 even on a 320 ×
          // 1080 LED, anchoring `flex justify-center` content around
          // x=960 = off the LED's leftmost 320 px = invisible content.
          width: 'var(--led-w, 100vw)',
          height: 'var(--led-h, 100vh)',
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
