"use client";

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useAppStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import { Sidebar } from './Sidebar';
import { MobileTabBar } from './MobileTabBar';
import { InstallPromptBanner } from './InstallPromptBanner';
import { ServiceWorkerRegistrar } from './ServiceWorkerRegistrar';
import { TopToolbar } from './TopToolbar';
import { SuperAdminBanner } from './SuperAdminBanner';
import { EmergencyOverlay } from './EmergencyOverlay';
import { AuthExpirationGuard } from './AuthExpirationGuard';
import { StaleBundleWatcher } from './StaleBundleWatcher';
import { ProfileHydrator } from './ProfileHydrator';
import { useTenantStatus } from '@/hooks/use-api';
import { AppDialogHost } from '@/components/ui/app-dialog';
import { BrandStyleInjector } from '@/components/branding/BrandStyleInjector';
import { ClickDiag } from './ClickDiag';

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  const isEmergencyActive = useAppStore((state) => state.isEmergencyActive);
  const setEmergencyActive = useAppStore((state) => state.setEmergencyActive);
  const { data: tenant } = useTenantStatus();
  const pathname = usePathname() || '';

  // Universally lock the dashboard when backend reports an emergency
  // NOTE: this hook MUST run on every render (hook-rule), so it stays above
  // any conditional return.
  useEffect(() => {
    if (tenant) {
      if (tenant.emergencyStatus && tenant.emergencyStatus !== 'INACTIVE') {
        setEmergencyActive(true);
      } else {
        setEmergencyActive(false);
      }
    }
  }, [tenant, setEmergencyActive]);

  // ───────────────────────────────────────────────────────────────────
  // 2026-06-08 — THE "every button needs two clicks" FIX.
  //
  // On a fresh page load (new tab, typed URL, or any full navigation),
  // keyboard focus sits in the browser ADDRESS BAR — NOT in the document.
  // (Verified live: on the dashboard, document.activeElement was <body> and
  // document.hasFocus() was false on load.) Because of that, the operating
  // system treats the user's FIRST click on the page as a focus-transfer —
  // an "activate the window / move focus into the page" click — and SWALLOWS
  // it: the click event never reaches the button. So every control needed
  // two clicks (1st = hand the page focus, 2nd = actually act), and the
  // tenant switcher "went dead." It was global (every account, every device,
  // Chrome + Safari), never reproduced in automation (headless tools keep the
  // window focused), and a tab the operator had already clicked in worked
  // fine (it already had focus) while a brand-new tab didn't — the exact
  // tell. The /login page never had this because it autofocuses an input;
  // the dashboard never claimed focus at all.
  //
  // Fix: claim focus into the document on load + on every navigation by
  // focusing the (tabIndex=-1) main region — but ONLY when nothing in the
  // document already holds focus (activeElement is <body>/<html>, i.e. focus
  // is in the browser chrome). That guard means we NEVER steal focus from an
  // input the operator is typing in or a control they just focused.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const claimFocus = () => {
      const ae = document.activeElement;
      const somethingFocused = ae && ae !== document.body && ae !== document.documentElement;
      if (somethingFocused) return; // a real element already holds focus — leave it
      try { document.getElementById('main-content')?.focus({ preventScroll: true }); } catch { /* noop */ }
    };
    // Delay so we run AFTER the route's content mounts and after any
    // page-level autofocus (which we must not override).
    const t = setTimeout(claimFocus, 80);
    return () => clearTimeout(t);
  }, [pathname]);

  // The V2 template builder is a full-screen workspace — strip global chrome
  // (sidebar, top toolbar, decorative blobs) so it can use the entire viewport.
  const isFullscreenWorkspace = /\/templates\/builder\//.test(pathname);
  if (isFullscreenWorkspace) {
    return (
      <>
        {/* Desktop-only notice for the builder on small viewports */}
        <div className="lg:hidden fixed inset-0 z-[9999] flex items-center justify-center p-8 bg-slate-50 text-center">
          <div className="max-w-sm space-y-4">
            <h2 className="text-xl font-bold text-slate-800">Larger screen required</h2>
            <p className="text-sm text-slate-600 leading-relaxed">
              The template builder needs at least a 1024px wide display. Please switch to a tablet in landscape or a desktop to continue editing.
            </p>
            <a href={pathname.replace(/\/templates\/builder\/.*$/, '/templates')} className="inline-block px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold transition-colors">
              Back to Templates
            </a>
          </div>
        </div>
        <div className="hidden lg:block">
          {children}
          <AppDialogHost />
        </div>
      </>
    );
  }

  return (
    <div className="flex h-dvh w-full bg-slate-50 overflow-hidden text-slate-900 font-sans relative">
      {/* AuthExpirationGuard redirects to /login when the session 401s
          or the user is explicitly logged out. Mounted high in the tree
          so every dashboard page is protected. */}
      <AuthExpirationGuard />
      {/* 2026-05-12 — operator hit "still shows gschiemann" because
          their tab was on a pre-deploy bundle. StaleBundleWatcher
          polls /api/build-info every 5 min and shows a "new version
          available — reload in 30s" toast when the deployed SHA
          differs from the bundle's baked-in SHA. Auto-reloads after
          countdown; operator can Reload-now or Later. Pairs with
          the kiosk player's Phase B4 stale-bundle drift check. */}
      <StaleBundleWatcher />
      {/* Dashboard PWA service worker — Phase 1 of the mobile roadmap.
          Registers /sw.js in production only; keeps the player's own
          SW (sw-player.js) untouched. */}
      <ServiceWorkerRegistrar />
      {/* 2026-05-12 — auto-heal sessionStorage user objects that
          predate the firstName/lastName columns. Fires one GET
          /users/me on dashboard mount when the in-memory user
          has no name fields; reconciles the store + sessionStorage
          so the greeting shows the right name without operator
          action. No-op for accounts that already have names. */}
      <ProfileHydrator />
      {/* Tenant brand paint — scoped to authed dashboard only so the
          public marketing site + /login stay in the vendor palette. */}
      <BrandStyleInjector />
      {/* Skip-to-content link — visible only on focus */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[10001] focus:px-4 focus:py-2 focus:rounded-lg focus:bg-indigo-600 focus:text-white focus:text-sm focus:font-bold focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-indigo-400"
      >
        Skip to main content
      </a>

      {/* Decorative blobs — brand-aware ambient lighting.
          2026-05-26 — operator: "the gradient box is square but the
          menu is rounded, you see the gradient bleed over the outline
          of the menu box in the top menu." Two problems with the
          previous version:
            1. Hard-coded `bg-indigo-100/50` (K-12 default) and
               `bg-emerald-50/50` (school-y green) — wrong color for
               every non-K-12 tenant. A branded Dodgers tenant saw
               indigo blobs bleeding through the topbar's semi-
               transparent backdrop, fighting the Dodger-blue chrome.
            2. The top-right blob sat AT top-0 — directly BEHIND the
               h-[73px] TopToolbar. The topbar's `bg-white/60
               backdrop-blur-xl` revealed the blob as a soft halo
               around the rounded "Dodgers" pill / bell / avatar,
               making the rectangular topbar visually leak past its
               own rounded children.
          Fixes:
            • Both blobs now read `var(--brand-primary)` via
              color-mix toward white at low opacity — picks up the
              tenant's color, falls back to indigo when no brand.
            • Top blob pushed to `top-[100px]` so it sits BELOW the
              73px topbar, no more bleed into the menu zone. */}
      <div
        className="absolute top-[100px] right-0 w-96 h-96 rounded-full blur-[100px] pointer-events-none -z-0"
        style={{
          background: 'color-mix(in srgb, var(--brand-primary, #6366f1) 12%, transparent)',
        }}
      />
      <div
        className="absolute bottom-0 left-64 w-[500px] h-[500px] rounded-full blur-[120px] pointer-events-none -z-0"
        style={{
          background: 'color-mix(in srgb, var(--brand-primary, #10b981) 8%, transparent)',
        }}
      />
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 relative">
        <SuperAdminBanner />
        <TopToolbar />
        <main
          id="main-content"
          tabIndex={-1}
          className={cn(
            // pb-24 on mobile reserves room for MobileTabBar's 56px height
            // + safe-area-inset. md:pb-8 drops the extra padding once the
            // sidebar takes over and the tab bar is hidden.
            //
            // z-index intentionally NOT set here (was z-10). Setting a
            // z-index on <main> creates a stacking context which traps
            // every fixed/absolute modal inside it — those modals'
            // z-index values are then compared only within main's context
            // (z-10) against TopToolbar's z-20, so all in-page modals
            // lose to the toolbar no matter how high their own z-index is.
            // Removing z-10 lets fixed modals (z-50 picker, z-[10000]
            // dialogs) compete at the parent stacking-context level where
            // they correctly win over TopToolbar (z-20). The decorative
            // blobs use -z-0 and still paint behind page content via DOM
            // order (they precede main in the tree) so nothing regresses.
            "flex-1 overflow-y-auto p-4 sm:p-6 md:p-8 pb-24 md:pb-8 transition-all duration-300 relative",
            // outline-none: we programmatically focus #main-content on load/nav
            // (the two-click-bug fix) — never show a focus ring for that.
            "outline-none focus:outline-none",
            isEmergencyActive ? "pointer-events-none opacity-50 blur-sm" : ""
          )}
        >
          <div className="max-w-7xl mx-auto space-y-6 md:space-y-8">
            {children}
          </div>
        </main>
      </div>

      {/* Mobile-only bottom tabs. Hidden via internal md:hidden class
          (kept inside the component so we don't have to think about
          when to render here). */}
      <MobileTabBar />
      {/* "Install to Home Screen" prompt — appears once per user, mobile-
          only, after a 12s warm-up so it doesn't pop on first touch. */}
      <InstallPromptBanner />

      {isEmergencyActive && <EmergencyOverlay />}
      <AppDialogHost />
      {/* Temporary click diagnostic — enable with ?clickdiag=1 (2026-06-08). */}
      <ClickDiag />
    </div>
  );
}
