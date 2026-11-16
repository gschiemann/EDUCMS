"use client";

import { Toaster } from 'sonner';
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';

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
 * so it can't trip the React-owned-<head>-node crash class (apps/web/CLAUDE.md
 * cross-browser rule 6).
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
 *
 * ── LOOK (2026-11-14) ─────────────────────────────────────────────────────
 * Owner: "the ugly alert screens in the bottom right of the dashboard … yellow
 * background and don't match any of our design". Those were `toast.warning`
 * cards painted by this file's old `warning` class (amber-50 fill, amber-200
 * border, amber-900 bold text) — the "may stutter" publish warnings, which
 * 61bdbf873 (2026-11-02) removed by deleting the CALLER and left the yellow
 * style here for the next `toast.warning`. A toast is a floating card, so it
 * now wears the dashboard's floating-card design — the notification bell's
 * panel, the "new version" card, the confirm dialog: a WHITE card, slate text,
 * the tone carried by a lucide icon (the bell's `-600` shades, which keep the
 * 3:1 non-text contrast a `-500` amber/emerald/sky icon misses on white) and a
 * `-200` outline (app-dialog's tone ring). Never a tinted fill. The dashboard
 * has no dark mode (nothing applies `.dark`, sonner's theme stays `light`), so
 * there is one theme to match. Locked by __tests__/AppToaster.design.test.tsx;
 * __tests__/corner-popups.no-yellow.test.ts keeps a new yellow corner popup out.
 *
 * Three things sonner styles itself have to be restated here: Tailwind
 * preflight — lifted above sonner's attribute selectors by the cascade-layers
 * polyfill (postcss.config.mjs) — zeroes every padding, border and button
 * radius. Measured on 2026-11-14 before this change: toast padding 0px, and
 * the close button a borderless, square white box hanging off the top-left
 * corner. Padding, the close button and the action button are explicit below.
 *
 * ── GEOMETRY ──────────────────────────────────────────────────────────────
 * The bug-report button (BugReporterButton: 36px, `md:bottom-6 md:right-6`,
 * phone `bottom-24 right-4`, `z-[70]`) shares this corner and paints ABOVE the
 * toaster, which can never pass 59 (see above) — it sat on the bottom toast's
 * text (a 36×36 overlap, measured). So the stack starts above it, 12px clear.
 * Sonner takes ONE position (no responsive variant); only `bottom` is set in
 * each offset — sonner falls back to its own default for any side left
 * undefined, so its right-edge and mobile full-width math are untouched.
 */

/** Desktop: the bug button's 24px bottom + its 36px + 12px of air. */
export const TOAST_STACK_BOTTOM_PX = 72;
/** Phone: the bug button's 96px bottom (above the 56px tab bar) + 36px + 12px. */
export const TOAST_STACK_BOTTOM_MOBILE_PX = 144;

/**
 * Keep the SHARED `toast` class free of any colour utility. Tailwind emits
 * `bg-white` and `bg-rose-50` as equal-specificity rules, so listing a colour
 * there AND on a type key would let source order — not intent — decide (which
 * is exactly how the first cut rendered a white "error" toast). Colours live
 * only on the mutually-exclusive type keys (`default` is the key sonner uses
 * for a plain `toast()`, never alongside a type).
 */
export const TOAST_CLASSNAMES = {
  toast: 'items-start gap-2.5 rounded-xl border py-3 pl-4 pr-10 shadow-[0_12px_32px_rgba(15,23,42,0.18)]',
  title: 'text-sm font-semibold leading-snug',
  description: 'text-[11px] leading-snug text-slate-500',
  icon: 'mt-0.5',
  default: 'bg-white border-slate-200 text-slate-800',
  loading: 'bg-white border-slate-200 text-slate-800',
  info: 'bg-white border-sky-200 text-slate-800',
  success: 'bg-white border-emerald-200 text-slate-800',
  error: 'bg-white border-rose-200 text-slate-800',
  warning: 'bg-white border-amber-200 text-slate-800',
  // Inside the card, top-right — where every dashboard card keeps its ×.
  closeButton:
    'left-auto right-2 top-2 h-6 w-6 rounded-lg border-0 bg-transparent text-slate-400 [transform:none] hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400',
  actionButton: 'h-7 rounded-lg px-2.5 text-xs font-bold bg-slate-900 text-white hover:bg-slate-700',
} as const;

const ICON = 'h-4 w-4';

export function AppToaster() {
  return (
    <Toaster
      position="bottom-right"
      offset={{ bottom: TOAST_STACK_BOTTOM_PX }}
      mobileOffset={{ bottom: `calc(${TOAST_STACK_BOTTOM_MOBILE_PX}px + env(safe-area-inset-bottom, 0px))` }}
      // Never let a stack of failures bury the page.
      visibleToasts={3}
      closeButton
      containerAriaLabel="Notifications"
      icons={{
        success: <CheckCircle2 className={`${ICON} text-emerald-600`} aria-hidden />,
        info: <Info className={`${ICON} text-sky-600`} aria-hidden />,
        warning: <AlertTriangle className={`${ICON} text-amber-600`} aria-hidden />,
        error: <AlertCircle className={`${ICON} text-rose-600`} aria-hidden />,
        close: <X className="h-3.5 w-3.5" aria-hidden />,
      }}
      toastOptions={{ classNames: TOAST_CLASSNAMES }}
      style={{ zIndex: 55 }}
    />
  );
}
