# Mobile app performance deep-dive — bottom-nav / "More" lag (2026-06-16)

**Symptom (operator):** on the mobile app, tapping between bottom-nav tabs —
*especially the "More" button* — has major lag; the menu doesn't pop up right
away. Even the "More" sheet is a pure local-`useState` toggle (no fetch, no
navigation), so its lag means **the main thread / GPU is busy at tap time**,
i.e. app-wide contention, not the tab bar itself.

5 read-only investigation agents (polling, re-render, paint, bundle, fleet-map
freeze class) converged on two root causes, both confirmed against the code.

## Root causes (confirmed)

### A. Polling / data-fetch contention
- **`refetchOnWindowFocus: true` global default** (`providers.tsx`). Every
  app-switch (tap home → glance → tap back, constant on mobile) fired a refetch
  sweep; the burst of fetch→state-update→re-render lands as the operator taps
  the nav, queuing the tap. Flagged as a "polling storm" once before (2026-04-19).
- **`refetchIntervalInBackground: true`** on `useTenantStatus` (30s),
  `useScreenGroups` (10s), `useScreens` (10s) — these kept polling even when the
  tab/app was backgrounded; each poll changes the screens object identity →
  O(n) memo recompute over ~150 screens in `FleetRollup`/`ScreenMap` →
  recurring main-thread hiccup → taps queue.
- Explicit `refetchOnWindowFocus: true` overrides on the global-mounted
  `useNotifications` (in `MobileTabBar`) and `usePendingAssets` badge pollers.

### B. Mobile GPU / compositing cost (the "doesn't pop up right away")
- Two decorative ambient blobs in `DashboardLayout` at **`blur-[100px]` /
  `blur-[120px]`** — a blur radius that huge relative to a 390px phone viewport
  is a heavy per-frame composite, and they sit *behind* the toolbar's
  backdrop-blur, so every repaint (a tab tap, the More sheet sliding up)
  re-blurs them.
- **`backdrop-blur-xl` on the sticky TopToolbar** + **`backdrop-blur-md` on the
  fixed MobileTabBar** — backdrop-filter re-samples everything behind on every
  repaint frame; on a fixed element that's every scroll/animation frame.
- The More sheet slide-up forces a full re-composite of that blur stack on open.

## Fixes shipped this pass (low-risk, on-symptom)

**Polling hygiene** (`providers.tsx`, `hooks/use-api.ts`):
- Global `refetchOnWindowFocus` → **false** (per-hook opt-in remains).
- `refetchIntervalInBackground` → **false** on tenant-status / screen-groups /
  screens (visible = still polls at interval; backgrounded = paused; on return =
  one immediate refetch via per-hook `refetchOnWindowFocus` for fleet pills +
  emergency status). Net: no polling on a phone the operator isn't looking at.
- Dropped focus-burst on `useNotifications` + `usePendingAssets` (30s interval
  keeps them fresh while visible).

**Mobile paint cost** (`DashboardLayout.tsx`, `TopToolbar.tsx`, `MobileTabBar.tsx`):
- Decorative blobs → `hidden md:block` (gone on phones, kept on desktop).
- TopToolbar → solid `bg-white/90 backdrop-blur-none` on mobile, glass
  `md:bg-white/60 md:backdrop-blur-xl` on desktop.
- MobileTabBar → solid `bg-white`, dropped `backdrop-blur-md`.
- More sheet panel → `will-change: transform` + `contain: paint` so the slide
  animation is GPU-promoted and its repaint is isolated.

## Reviewed-but-rejected agent advice
- "Combine the 3 `useAppStore` selectors in MobileTabBar into one object" —
  **rejected**: an object-literal selector without `useShallow` returns a new
  reference every render and would *increase* re-renders. The three separate
  primitive selectors are correct.
- "Leaflet loads on every page via DashboardLayout" — **false on inspection**:
  `FleetRollup`/leaflet is imported only by the dashboard route, not the global
  layout. No change needed.

## Deferred (higher-risk; recommended follow-ups, not done here)
- **Bundle splitting / lazy-load** the heavy per-route chunks: `dnd-kit` on the
  Playlists route, `qrcode` on Screens, and the leaflet map (already a
  `dynamic({ssr:false})` wrapper, but its CSS imports execute on chunk load).
  These cost first-tap hydration time; lazy-loading needs its own testing pass.
- `FleetRollup` recomputes `tree`/`filtered`/`byStore` O(n) over ~150 screens on
  every fleet poll even when nothing visible changed — extend the `ScreenMap`
  signature-gate to the parent (dashboard/fleet only).
- Minor re-render hygiene: memoize `navItems` in `Sidebar`; replace TopToolbar's
  inline `onMouseEnter` style mutation with CSS hover (desktop-only).
- Drop `backdrop-blur` on the Sidebar mobile-drawer backdrop + ProfileEditModal
  scrim (only matters while those overlays are open).

Source: workflow `wf_c89e8a82-21a` (full structured findings in the run output).
