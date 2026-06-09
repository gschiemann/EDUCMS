# Dashboard "every button needs two clicks / Control Game won't launch / refresh fixes it" — ROOT CAUSE SYNTHESIS

**Date:** 2026-06-08
**Lead:** Opus 4.8 (1M)
**Method:** 5 parallel read-only investigation agents + live forensics on the production site (Claude-in-Chrome MCP).
**Customer impact:** launch-blocking. Operator is a SUPER_ADMIN viewing ~150 screens / ~50 locations + a Dodgers sports tenant. ~6 prior "fixes" failed because they targeted symptoms.

## The bug, restated precisely

A **multi-second synchronous main-thread block** on the dashboard that:
- **scales with fleet size** (only heavy admin sessions; a light single-school account is perfectly responsive — verified live: 0ms main-thread drift, single-click nav, React fully hydrated), and
- **recurs on the React Query poll cadence** (every 10s / 30s),

so while the thread is blocked the browser **queues clicks and dispatches none** (→ "click does nothing / needs two clicks / switcher dead / Control Game won't launch"), a `setTimeout(…,5000)` never fires and `navigator.serviceWorker.getRegistrations()` hangs ~45s (both observe the starved event loop — verified live), and a **hard refresh** tears down the busy JS so the target "loads."

## What it is NOT (previously chased, now ruled out)

- **NOT the service worker.** The 45s `getRegistrations()` hang was a *symptom* (its promise callback starved by the long task), not the cause. Removing the SW (commit 78005423) did not fix it. Keep the SW removal (it's good hygiene + kills the stale-bundle class) but it is not the cure.
- **NOT a focus/"first-click-swallow" bug.** That was a *separate* defect (the WEBPAGE spatial-nav shim stealing focus into preview iframes) — already correctly gated off dashboard routes by commit 30b6ae7c. Keep that gate.
- **NOT the account switcher.** It is correctly memoized (O(n), stable query key, children lazy-mounted). It goes "non-responsive" as a **victim** of the shared frozen main thread, not a cause.
- **NOT a render loop in the dashboard shell.** Agent 1 audited the entire shell + providers + store + api-client and found no infinite loop, no setState-in-effect, no new-object Zustand selector. The shell is clean. (So reverting the chrome won't fix it.)
- **NOT the lead's device / browser / OS / mouse / iOS.** Verified live: example.com runs instantly in the same browser; a light VenueOS account is responsive. It is our code, triggered by data volume.

## ROOT CAUSE (high confidence — code-traced by Agent 2, corroborated by elimination)

**The fleet map `ScreenMap` / `MarkerClusterLayer` builds the entire fleet synchronously in one task and rebuilds it on every poll.**

- `apps/web/src/components/screens/ScreenMap.tsx:358` — `L.markerClusterGroup(...)` is created **without `chunkedLoading: true`** (confirmed: grep for `chunkedLoading` returns **zero** hits in the whole web app). So all marker insertion runs in one uninterrupted main-thread task.
- `apps/web/src/components/screens/ScreenMap.tsx:396-453` — the rebuild effect calls `group.clearLayers()` then, **for every located screen**, synchronously: `buildIcon()` (assembles an SVG+HTML string → `L.divIcon({html})` → Leaflet parses HTML into a DOM node), builds a multi-line **popup HTML string** (`:438-443`), `marker.bindPopup(...)`, `markerStatusMap.set(...)`, `group.addLayer(marker)` (markercluster runs O(clustering) distance math per insert). 150 screens × (HTML parse + divIcon + popup string + cluster insert) = one multi-second task.
- **Mounts on the HQ dashboard for exactly this operator:** `apps/web/src/app/[schoolId]/dashboard/page.tsx` (isHQ → `<FleetRollup>`), `FleetRollup.tsx:313` → `<ScreenMapClient>`; also `MobileDashboard.tsx`.
- **Rebuilds every poll:** `use-api.ts` `useFleet` `refetchInterval: 30_000, refetchIntervalInBackground: true` (line ~1556/15-16); `useScreens` `refetchInterval: 10_000, refetchIntervalInBackground: true` (line ~137/33-34). Each poll → new `fleet`/`screens` object → `FleetRollup.tsx:72-98` recomputes `mapScreens` (new array identity) → `ScreenMap` `screens` prop changes → `located` memo (`[screens]`) new array → the rebuild effect dep `[screens, …]` (`ScreenMap.tsx:453`) fires → **full clearLayers + rebuild of all 150 markers again.** Amplifier: `onScreenClick` = `FleetRollup`'s `focusStore` with deps `[fleet.screens, tree]` (`FleetRollup.tsx:147-159`) → new identity every poll → also a rebuild-effect dep → rebuild can't be skipped.

**Why it fits every clue:** data-scaling (150 markers = multi-second; 1 marker = <16ms); main-thread freeze (one sync task); recurs every 10–30s (poll) including when backgrounded (`refetchIntervalInBackground:true`); HQ-dashboard + >1 location only (Greg's profile); switcher/Control Game are victims of the shared thread.

## THE FIX (primary)

In `apps/web/src/components/screens/ScreenMap.tsx`:
1. **`chunkedLoading: true`** (+ `chunkInterval: 150, chunkDelay: 50`) on `L.markerClusterGroup(...)` — markercluster then time-slices marker insertion and **yields to the event loop**, so the switcher/nav/Control Game stay responsive even mid-build. Single highest-leverage change.
2. **Stop rebuilding all markers on every poll.** Diff by screen id (add/remove/update only changed markers) instead of `clearLayers()` + full rebuild. At minimum, stabilize `onScreenClick` (read `fleet`/`tree` from refs so its identity is stable) and drop it from the rebuild-effect deps.
3. **Stop re-clustering a backgrounded tab:** set `refetchIntervalInBackground: false` on `useFleet`/`useScreens` (or lower the fleet interval).
4. **Lazy popup HTML:** build popup content in a `marker.on('popupopen')` handler, not eagerly ×150.
5. Memoize `points` (`ScreenMap.tsx:493`) with `useMemo([located])` (minor churn amplifier).

## CONTRIBUTING HAZARDS (fix alongside — belt and suspenders, since I cannot profile the operator's exact account remotely)

- **Global `window.fetch` monkey-patch in production on the RSC navigation path** (Agents 3 + 4). `apps/web/src/lib/bug-ringbuffers.ts:311-359` `installFetchWrapper()` reassigns `window.fetch`, installed from `BugCaptureProviders.tsx` mounted in the **root** `app/layout.tsx` with **no NODE_ENV gate**. On any response `>=400` it does `res.clone(); await clone.text()` **before returning to the router** — on a streamed RSC payload this buffers inline and adds main-thread cost on every nav, heavier on a heavy account. **Fix:** skip wrapping `/_next/`/RSC requests; never `await clone.text()` synchronously on the return path (capture fire-and-forget); consider gating the install behind a flag.
- **`1e0b0314` "claim document focus on load + nav" — REVERT** (Agent 3). `DashboardLayout.tsx:64-76` focuses `#main-content` 80ms after every nav whenever `activeElement` is body. It treats a symptom of a misdiagnosis, adds per-nav focus theft, and can't fix a frozen thread (its own timer is the kind that "never fires"). Remove it.
- **`ServiceWorkerRegistrar` calls `getRegistrations()` on every `[pathname]` change** (Agent 3) — if a wedged worker still exists these hang 45s per nav (async, not the freeze, but pure overhead). **Fix:** run the unregister once (`deps: []`), not per-nav.
- **Builder-launch buttons use `window.location.href` (full reload by design)** (Agent 4): `templates/page.tsx:399,586`, `playlists/page.tsx:1659`, `templates/imports/page.tsx:493`. Convert to `router.push()` so they don't full-reload + lose state. (Keep `window.location.href` only for genuine cross-origin Stripe/OAuth redirects.)
- **StaleBundleWatcher SHA-mismatch / ChunkLoadError auto-reload** (Agent 4, Findings 2/3): can reload the page out from under a click after a deploy. Lower risk; compare full SHAs and back off.

## VERIFICATION PLAN (the discipline that was missing)

The operator's heavy account cannot be reproduced remotely without their credentials (and SUPER_ADMIN login on live is forbidden). Therefore verify the **mechanism + fix** directly:
- Standalone headless-browser repro (Playwright): mount Leaflet + markercluster with 150 `divIcon`+popup markers, measure the longest main-thread task **without** `chunkedLoading` (expected: hundreds of ms to seconds) vs **with** `chunkedLoading` (expected: no single long task — sliced). This proves the fix empirically, account-independent.
- After deploy, re-run live forensics on a heavy-enough surface and confirm `getRegistrations()` no longer hangs and there are no recurring long tasks.

## Reconciling Agent 2 (CPU block) vs Agent 5 (I/O starvation) — BOTH are right, and they are complementary

Agent 5 argued the dashboard has no 45s synchronous CPU loop and that the hang is I/O starvation from a still-wedged OLD service worker in the operator's browser (the kill-switch hasn't reached them). Agent 2 argued it's the fleet-map CPU block.

**Live evidence resolves it:** during my probe, a `setTimeout(…, 5000)` **never fired within 45s**. A stuck SW stalls `fetch()`/`getRegistrations()` (which await the SW) but it does **NOT** block `setTimeout` — only a **blocked main thread (CPU)** prevents a timer callback from running. Therefore a real CPU block exists → Agent 2's fleet-map mechanism is supported. (The "45s" is the CDP eval ceiling, not necessarily one 45s task — likely multi-second rebuilds recurring every 10s so the page is never idle.)

**BUT Agent 5's delivery-gap point is independently true and critical:** if the operator never hard-refreshed, their browser is still controlled by the OLD caching `sw.js` (network-first, no fetch timeout) AND still running the OLD bundle (no fleet-map fix). The old SW can stall chunk fetches under heavy polling AND can delay the browser from ever picking up the new `sw.js`/bundle. So **deploying the fleet-map fix alone will not reach an already-wedged client.**

### Therefore the fix must be BOTH:
1. **Fix the fleet-map CPU block** (the actual freeze for heavy accounts). Without it, a clean SW + fresh bundle STILL freezes on 150 markers.
2. **Force-shed the old SW + bundle before any chunk loads** — an inline `<script>` in the document `<head>` (`app/layout.tsx`) that synchronously unregisters any `/sw.js` registration and reloads once if it removed one. `ServiceWorkerRegistrar` runs too late (it is itself a lazy chunk the wedged SW may stall). This guarantees already-broken clients actually receive the fix on next open.

Other contributors (global fetch monkey-patch, focus-claim revert, per-nav getRegistrations) are fixed alongside as defense-in-depth, since the operator's exact heavy account cannot be profiled remotely.

Agent 5 also positively **ruled out**: any dashboard WebSocket/SSE (none exists — only the player route), a Next 16/React 19 regression window (present since the first commit; only a 16.2.6 minor bump), and live WEBPAGE iframes on the dashboard (`ScaledTemplateThumbnail` passes `live={false}`).

## Agent reports (full text, this folder)
- `01-fleet-map-switcher.md` — Agent 2 (ROOT CAUSE).
- `02-render-loop-shell.md` — Agent 1 (shell is clean; profile recommended).
- `03-click-path-my-commits.md` — Agent 3 (no interceptor; revert focus-claim; fetch monkey-patch).
- `04-approuter-rsc.md` — Agent 4 (Links are real; window.location.href launches; fetch monkey-patch; reload mechanisms).
- `05-regression-globals.md` — Agent 5 (pending).
