# Full agent reports — dashboard freeze investigation (2026-06-08)

Five parallel read-only agents. Full reports below. Synthesis + fix plan in `00-SYNTHESIS.md`.

---

# AGENT 2 — Switcher + Fleet Map deep-dive (ROOT CAUSE)

**Conclusion:** The data/role-scaling freeze is caused by the **fleet map (`ScreenMap`/`MarkerClusterLayer`)**, which mounts on the HQ dashboard for SUPER_ADMIN/DISTRICT_ADMIN with >1 location and does heavy synchronous DOM work over the entire fleet, rebuilt on a polling cadence. The switcher and "Control Game" go dead because the map's synchronous work blocks the shared main thread.

### Finding 1 — fleet map builds 150 markers + 150 popup HTML strings + 150 divIcons SYNCHRONOUSLY, NO chunkedLoading, rebuilds every poll (TOP suspect, confirmed by reading code)
- `apps/web/src/components/screens/ScreenMap.tsx:396-453` — rebuild effect.
- Cluster group created WITHOUT `chunkedLoading: true` — `ScreenMap.tsx:358-384` (grep `chunkedLoading` = ZERO hits app-wide).
- Mounts on HQ dashboard: `apps/web/src/app/[schoolId]/dashboard/page.tsx:53,462` (`useFleet`→`isHQ`→`<FleetRollup>`), `MobileDashboard.tsx:85,216`, `FleetRollup.tsx:313` → `<ScreenMapClient>`.
- Mechanism: per screen → `group.clearLayers()`, `buildIcon()` (SVG/HTML string → `L.divIcon({html})` parses HTML→DOM), popup HTML template string (`:438-443`), `marker.bindPopup`, `markerStatusMap.set`, `group.addLayer` (markercluster distance math per insert, `maxClusterRadius:60`). With chunkedLoading off, 150× runs in ONE uninterrupted main-thread task → starves the event loop → `getRegistrations()` promise sits unresolved, `setTimeout(…,5000)` never fires.
- Repeats: `useFleet` `refetchInterval:30_000` (`use-api.ts:1556`), `useScreens` `refetchInterval:10_000`. Each poll → new `fleet` → `FleetRollup.tsx:72-98` recomputes `mapScreens` (new array) → `ScreenMap` new `screens` → `located` memo new array → rebuild effect dep `[screens,…]` (`:453`) fires → full clearLayers + rebuild. Amplifier: `onScreenClick`=`focusStore` deps `[fleet.screens,tree]` (`FleetRollup.tsx:147-159`) → new identity each poll → rebuild dep → can't skip.
- Trigger: SUPER_ADMIN/DISTRICT_ADMIN, `/screens/fleet` returns >1 location (~50 loc/~150 screens). HQ dashboard auto-mounts map. Freeze recurs on 10s/30s poll.
- **Fix:** `chunkedLoading:true` (+`chunkInterval:150, chunkDelay:50`) at `:358` (highest leverage — yields to event loop). Diff markers by id instead of clearLayers+rebuild. Stabilize `onScreenClick` (refs). `refetchIntervalInBackground:false`. Lazy popup via `marker.on('popupopen')`.

### Finding 2 — two-click/switcher-dead is a SEPARATE bug (spatial-nav shim focus theft), already being fixed; don't let it mask Finding 1
- `webpage-spatial-nav.ts:207-217` MutationObserver re-focuses iframes on every mutation; gated off dashboard at `WidgetRenderer.tsx:~3030` (commit 30b6ae7c). Instantaneous focus theft ≠ 45s freeze. Keep the gate.

### Finding 3 — `points` recreated unmemoized every render (`ScreenMap.tsx:493`) — minor amplifier, not root. Fix: `useMemo`.

### Finding 4 — SchoolSwitcher correctly memoized (RULED OUT as cause). `SchoolSwitcher.tsx:33-49` tree build is useMemo `[tenants]`, no recursion, children mounted only when expanded, `useAccessibleTenants` stable key staleTime 60s. It's a VICTIM of the shared thread block.

### Finding 5 — "Control Game" deadness = same shared-thread victim. Sports console (`sports/[gameId]/page.tsx`, 5292 lines, many 100-250ms intervals) is a separate route; not the data-scaling root.

**Ruled out:** SchoolSwitcher, service worker (45s hang is symptom not cause), useAccessibleTenants storm, BrandStyleInjector, dashboard aggregate stats (memoized O(n)), FitBounds loop (didFit ref guarded), per-screen iframes on dashboard (none — plain cards), MapContainer recreation (react-leaflet reads center/zoom at mount only).

**Open:** need a live CPU profile on the ~150-screen HQ account to convert hypothesis→confirmed (expect a multi-second task: `MarkerClusterLayer` effect → addLayer/_animationAddLayer/L.DivIcon).

---

# AGENT 1 — Render-loop / main-thread hunter (shell is CLEAN)

**Conclusion:** The global dashboard shell contains NO infinite render loop, NO unguarded setState-in-effect, NO new-object Zustand selector, NO O(n²) sync work. Dashboard aggregates over ~150 screens are correctly useMemo'd O(n). The one genuine data-scaling main-thread hazard (the WEBPAGE spatial-nav shim MutationObserver+focus loop) is ALREADY gated off dashboard routes at HEAD (`WidgetRenderer.tsx:3052-3054`). So either the customer is on a stale bundle, or the freeze has a different root than the focus theft the lead fixed.

- **Finding 1:** spatial-nav shim (`webpage-spatial-nav.ts:207-217` observer; `:61-72` injected `*:focus` box-shadow) is a self-perpetuating focus loop on animated pages — but gated off dashboard at HEAD. If live-persisting, it's a STALE-BUNDLE problem.
- **Finding 2 (strong skeptical read):** focus theft does NOT stall `setTimeout`/`getRegistrations`. The lead may have conflated the two-click bug with the freeze. A stalled timer queue = (a) sync busy-loop, or (b) wedged SW. Clue 3 ("SW removed, still broken") is NOT evidence the SW is innocent — removal only helps once the client loads the new build AND the old SW relinquishes control. **The render-loop theory is NOT supported by the code — the shell is clean.** Get a Performance profile of the frozen state: solid scripting block = JS loop (read the stack); idle thread + pending getRegistrations/fetch = SW/network wedge.
- **Finding 3:** `isEmergencyActive` stuck-true would disable `<main>` clicks (`DashboardLayout.tsx:201`) — low likelihood, only blanks `<main>` not sidebar; cheap DB check of `Tenant.emergencyStatus`.
- **Finding 4:** `api-client.ts:62-64` subscribes to a never-emitted `login-success` auth event — dead code, cosmetic, not the bug.

**Ruled out (verified clean):** DashboardLayout effects, Zustand store (all primitive/stable selectors — no render-storm footgun), providers/QueryClient (no global refetchInterval), ProfileHydrator (one-shot), BrandStyleInjector (lastAppliedRef guard), BrandingProvider, SchoolSwitcher/useTenantSwitch (stable memos), Sidebar/TopToolbar/NotificationsBell, StaleBundleWatcher/ServiceWorkerRegistrar/AuthExpirationGuard (bounded), api-client (401-storm guarded, retries yield), bug-ringbuffers (FIFO cap 50), FleetRollup (useMemo O(n) tree), dashboard aggregates (useMemo O(n)), MobileDashboard (no live iframes), polling hooks (poll ≠ freeze).

**Bottom line:** shell clean; spatial-nav hazard already gated; get the bundle SHA + one Performance profile before more fixes.

---

# AGENT 3 — Click-path + lead's recent commits

**Conclusion:** Nothing in the shell swallows real clicks; `isEmergencyActive` can't be wrongly true. The bug is a MAIN-THREAD STALL (the lead has misdiagnosed it as focus/SW for 6 commits). Two of the lead's commits ADD per-nav/per-focus async work on top of the stall.

**Part A — no click interceptor:** decorative orbs `pointer-events-none -z-0` (`DashboardLayout.tsx:162-173`); `<main>` pointer-events-none only when emergency (`:201`); EmergencyOverlay/AppDialogHost listeners only when mounted/open; MobileTabBar/InstallPromptBanner not full-viewport eaters; ClickDiag panel `pointerEvents:none`, listeners only with `?clickdiag=1`; no global stopPropagation; **no WebSocket/EventSource on dashboard** (only player route).

**Part B — verdicts on lead's commits:**
- `78005423` (disable SW): NOT harmful, but does NOT fix the freeze (async hang ≠ main-thread block). Keep. **New concern:** `ServiceWorkerRegistrar.tsx:89-105` calls `getRegistrations()` on every `[pathname]` change (`:106`) + `getRegistration().then(update())` on every focus/visibility — if a wedged worker exists these hang 45s per nav. Fix: run unregister ONCE (`deps:[]`).
- `1e0b0314` (claim-focus): **HARMFUL / REVERT.** `DashboardLayout.tsx:64-76` focuses `#main-content` 80ms after every nav when activeElement is body. Treats a symptom of a misdiagnosis, adds per-nav focus theft, can't fix a frozen thread (its 80ms timer is the kind that "never fires"). Remove.
- `30b6ae7c` (spatial-nav gate + ClickDiag): GATE is correct, KEEP. ClickDiag harmless, remove after. The shim (`webpage-spatial-nav.ts:207`) forces sync layout (`getBoundingClientRect`+`getComputedStyle` on every focusable on each mutation) — real jank, correctly removed from dashboard.
- `4c82e98c` (logout hard-redirect): NOT harmful, keep.
- `f6ce08e3`: mostly superseded by SW kill; keep, prune redundant SW-update-on-focus later.
- `20f0502a`: superseded by 30b6ae7c.

**Ranked:** (1, highest) a heavy page renders one expensive node per screen/location + forced sync layout (`getBoundingClientRect`/`getComputedStyle`/auto-fit: `useAutoFitText.ts`, `FitText.tsx`, `FitOneLine.tsx`, `ScaledTemplateThumbnail.tsx`) 150× per 10s poll = recurring multi-second block. (2) residual live WEBPAGE previews. (3, ruled out) SW/focus.

**Recommend:** REVERT 1e0b0314; keep 30b6ae7c gate + 4c82e98c + SW kill (make unregister once); PROFILE the heavy account.

---

# AGENT 4 — App Router / RSC navigation

**Conclusion:** Nav links ARE real `next/link` `<Link>` (`Sidebar.tsx:552`). Two distinct symptoms: "two clicks/dead" = focus theft (Finding 1, gated at HEAD); "full reload" = a `window.location` reload firing (Findings 2/3/4).

- **Finding 1 (confirmed root of two-click):** spatial-nav shim steals focus from preview iframes (`webpage-spatial-nav.ts:207-217,224-230`; injected `WidgetRenderer.tsx:3028-3065`). Fix landed (`:3052-3054`) but fragile (gate checked once at iframe onLoad vs client nav; shim has NO teardown; stale bundle still injects). Fix: tear down observer on unmount; gate via prop not `window.location.pathname`; don't re-focus without user engagement.
- **Finding 2 (hypothesis, high):** StaleBundleWatcher auto-reload (`StaleBundleWatcher.tsx:75-81,99-107,126-134`, `freshReload :49-68`) — if client `mySha` (`NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA`, not set in repo) and `/api/build-info` server SHA differ structurally, reloads every tab every ~5min. Explains FULL-RELOAD-loses-marker. Fix: compare full SHAs, only reload on real git SHA, guard mid-interaction.
- **Finding 3 (hypothesis, med-high):** ChunkLoadError auto-reload (`ServiceWorkerRegistrar.tsx:32-59`, `[schoolId]/error.tsx:32-42`) — post-deploy chunk skew → reload every 30s indefinitely. Fix: cache-bypass reload + exponential backoff.
- **Finding 4 (confirmed):** builder-launch buttons are `window.location.href=` hard navs: `templates/page.tsx:399,586`, `playlists/page.tsx:1659`, `templates/imports/page.tsx:493`. Full reload by design. Fix: `router.push()`. (No literal "Control Game" string in apps/web/src — composed at runtime / sports route.)
- **Finding 5 (confirmed patch, hypothesis impact):** `window.fetch` globally monkey-patched in PROD on the RSC nav path. `bug-ringbuffers.ts:311-359` `installFetchWrapper` reassigns `window.fetch`, from `BugCaptureProviders.tsx:33-35` → root `app/layout.tsx:134`, NO NODE_ENV gate. On any `>=400` it does `res.clone(); await clone.text()` (`:330-332`) before returning to router → buffers RSC error bodies inline, adds latency/stall on nav. Independent of SW. Fix: skip `/_next/`/RSC; never await clone.text() sync.
- **Finding 6 (hypothesis, med):** heavy-account main-thread saturation (iframes + per-fetch/per-console interception + switcher) starves router microtask. Profile.
- **Finding 7 (hypothesis, low-med):** hydration mismatch detaches `<Link>` handlers → browser-default full reload (`[schoolId]/layout.tsx:71-83` mounted gate for React #418; `Sidebar.tsx:504-547` documented prior double-render/one-inert-link bugs). More user-data components on heavy dashboard = higher mismatch odds.

**Ruled out:** plain `<a>` nav (it's `<Link>`); middleware (none exists in apps/web); api-client touching RSC (cross-origin Railway only, no fetch patch — that's bug-ringbuffers); staleTimes misconfig (not set); SW (self-destructs at HEAD); CSP framing.

---

# AGENT 5 — Regression archaeology + globals (DELIVERY-GAP dissent)

**Conclusion:** The signature (45s getRegistrations hang, dead 5s timer, no exception, refresh fixes, two-click, every browser, scales with data) is the textbook signature of **a stuck/unresponsive Service Worker stalling fetches**. The dashboard code in HEAD does NOT contain a 45s synchronous CPU loop; a 45s getRegistrations hang + dead timer is I/O starvation (stuck SW), not CPU spin. "SW ruled out" = "disabling SW in HEAD didn't fix the live operator" — because the operator's browser is **still running the OLD controlling SW from a prior build**, and the kill-switch can't reach them.
> NOTE (lead): live evidence shows the `setTimeout(5000)` ALSO never fired → main thread WAS blocked → a CPU block exists too (fleet map). Agent 5's delivery-gap point stands as a complementary second problem. Both fixed.

- **Suspect #1 (root-cause CLASS): the dashboard SW.** Introduced `95966a03` (2026-05-14). Pre-disable `public/sw.js` intercepts HTML navs + `/_next/static/*` with network-first `await fetch(req)` and **no timeout** (`:124-187`). Under heavy-fleet polling the HTTP/1.1 pool saturates → a chunk fetch stalls → `respondWith` never settles → SW thread blocked → subsequent navs + lazy chunks wedge → `getRegistrations()` hangs. Refresh routes around it. **Delivery gap:** HEAD's `78005423` stub + `f6ce08e3` no-store only help once the browser fetches the new `/sw.js` (spec: re-check at most once/24h on navigation, and the wedged SW can stall even that). **Fix:** an inline `<script>` in document `<head>` (`app/layout.tsx`, before any chunk) that unconditionally `getRegistrations().then(rs=>rs.forEach(r=>/\/sw\.js/.test(r.active?.scriptURL||'')&&r.unregister()))` + one `location.reload()` if it unregistered — `ServiceWorkerRegistrar` runs too late (it's itself a chunk).
- **Suspect #2 (contributing, scales with role):** fleet-map marker rebuild every poll (`ScreenMap.tsx:396`, `beae7f05`) — hundreds-of-ms spikes every 10-30s; real but periodic, not a continuous 45s block by itself. Fix: diff markers by id.
- **Suspect #3 (amplifier, every page):** bug-ringbuffer interceptors (`bug-ringbuffers.ts:139-390`, root `app/layout.tsx:134`) monkey-patch fetch/console/history + global capture click; sync `new Error().stack` capture per console.error/warn (`:281-307`). Multiplies cost of any error/re-render storm.
- **Suspect #4 (RULED OUT, but lead fixing wrong layer):** focus-theft commits. `ScaledTemplateThumbnail.tsx:277` passes `live={false}`; only the explicitly-opened TemplatePreviewModal + `/demo/*` are live. So no live proxied WEBPAGE iframe mounts on the dashboard by default.

**Globals audit — all CLEAN except noted:** React Query defaults (no global interval); **NO WebSocket/SSE on dashboard** (only `player/page.tsx:3769,3649`); Zustand (no persist, single bootstrap); AuthExpirationGuard (ejecting latch); ProfileHydrator (one-shot); BrandStyleInjector (lastAppliedRef); polling hooks (heavy collectively but none blocks thread); no heavy global listeners; instrumentation server-only; bug-ringbuffers = amplifier. `next.config.ts:100` stale `optimizePackageImports` entry for removed `isomorphic-dompurify` (cleanup smell).

**Ruled out:** dashboard WS reconnect loop (no WS), Next/React major bump (present since 2026-04-13, only 16.2.6 minor on 2026-05-29), global refetchInterval storm, Zustand rehydrate loop, live WEBPAGE focus theft on dashboard, sync CPU loop in always-on shell.

**Recommended definitive delivery fix:** inline `<head>` SW-unregister script (Suspect #1 open question #3).
