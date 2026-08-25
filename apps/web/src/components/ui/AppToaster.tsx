"use client";

import { Toaster } from 'sonner';

/**
 * The app's single toast host (operator-trust wave). Mounted once in
 * `providers.tsx` so every surface — dashboard, login, marketing, the
 * onboarding wizard — shares one stack.
 *
 * Why sonner: it ships the accessibility work we'd otherwise hand-roll —
 * an `aria-live="polite"` region, a focusable toast list reachable with the
 * hotkey, and a `@media (prefers-reduced-motion)` block that kills every
 * transition/animation on the toast (verified in its bundled stylesheet).
 * It injects its own <style> tag rather than mutating one React rendered,
 * so it can't trip the React-owned-<head>-node crash class (CLAUDE.md
 * cross-browser rule #6).
 *
 * ⚠️ LIFE-SAFETY LAYERING — `zIndex: 55`. The dashboard EmergencyOverlay
 * (components/layout/EmergencyOverlay.tsx) is `z-[60]`, and because its
 * parent in DashboardLayout is `position: relative` with NO z-index, that 60
 * competes in the ROOT stacking context — exactly where this fixed toaster
 * lives. Sonner's own default is 999999, which would paint "That change
 * didn't save" over an active lockdown screen. 55 keeps every toast strictly
 * BELOW the overlay, so the all-clear control always owns the screen.
 * Do not raise this above 59 without re-reading that overlay.
 *
 * Known trade-off of that ceiling: a toast raised while a full-screen modal
 * (z-[9999]/z-[10000]) is open renders behind it. Those surfaces should pass
 * `meta: { suppressGlobalError: true }` and show their failure inline.
 */
export function AppToaster() {
  return (
    <Toaster
      // Sonner takes ONE position (no responsive variant), so we keep its
      // default corner and instead lift the phone stack clear of the fixed
      // MobileTabBar (56px + safe-area) with mobileOffset. Only `bottom` is
      // overridden — sonner falls back to its own default for any side left
      // undefined, so its mobile full-width math is untouched.
      position="bottom-right"
      mobileOffset={{ bottom: 'calc(72px + env(safe-area-inset-bottom, 0px))' }}
      // Never let a stack of failures bury the page.
      visibleToasts={3}
      closeButton
      containerAriaLabel="Notifications"
      toastOptions={{
        // Keep the SHARED class free of any color utility. Tailwind emits
        // `bg-white` and `bg-red-50` as equal-specificity rules, so listing
        // both would let source order — not intent — decide the background
        // (which is exactly how the first cut rendered a white "error"
        // toast). Colors live only on the mutually-exclusive per-type keys.
        classNames: {
          toast: 'rounded-xl border shadow-[0_12px_32px_rgba(15,23,42,0.18)]',
          title: 'text-sm font-bold',
          description: 'text-[11px] opacity-80 leading-snug',
          default: 'bg-white border-slate-200 text-slate-800',
          error: 'bg-red-50 border-red-200 text-red-900',
          success: 'bg-emerald-50 border-emerald-200 text-emerald-900',
          info: 'bg-white border-slate-200 text-slate-800',
          warning: 'bg-amber-50 border-amber-200 text-amber-900',
          closeButton: 'bg-white border-slate-200 text-slate-500',
        },
      }}
      style={{ zIndex: 55 }}
    />
  );
}
