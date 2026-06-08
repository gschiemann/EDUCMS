# Performance / Page-Load Audit — VenueOS (EDU CMS)

**Date:** 2026-06-08 · Read-only static analysis · Agent: a192be6794e917814

## Summary

**The just-shipped gallery freeze+unmount fix (88479b3e) is solid and correctly wired end-to-end.** The `freeze` prop flows from the grid call site → `ScaledTemplateThumbnail` → `WidgetPreview` → `ExternalHtmlWidget`, where it appends `?freeze=1` to the iframe `src`; all 107 baked boards (hs/signage/fitness + kiosk) carry a freeze handler that monkey-patches and clears all timers/rAF + injects `animation:none` at ~1400ms. Combined with a hysteresis IntersectionObserver that *unmounts* off-screen tiles, the live-iframe count is bounded and frozen. **The biggest remaining risk is that the SAME unfrozen-iframe pattern lives on two other surfaces that did NOT get the `freeze` flag — the Playlists page and the Playlist Create Wizard — so a template-playlist (or wizard filter) full of EXTERNAL_HTML boards can still mount live, animating 4K iframes.** Secondary risks: the Assets and Screens lists are unbounded/un-virtualized at 50-location scale, and several React Query hooks poll heavy unpaginated endpoints every 10s *in the background*.

## Gallery freeze+unmount verification

**VERDICT: EFFECTIVE, not regressed.** Traced to reality at every hop:

1. **Grid call site passes `freeze`** — `apps/web/src/app/[schoolId]/templates/page.tsx:1769-1781` renders `<ScaledTemplateThumbnail … freeze />`. The preview modal correctly leaves it live: `:1350-1360` passes `freeze={false}`.
2. **Both system + custom templates render through the same frozen card** — `:1183` (`systemTemplates.map`) and `:1215` (`customTemplates.map`) both use `<GalleryCard>`, which renders the frozen thumbnail.
3. **`freeze` reaches the iframe** — `ScaledTemplateThumbnail.tsx:219-226` forwards `freeze` into `<WidgetPreview … freeze={freeze} />`; `WidgetRenderer.tsx:492` routes `EXTERNAL_HTML` to `<ExternalHtmlWidget config={cfg} freeze={freeze} />`; `WidgetRenderer.tsx:2837-2839` appends `freeze=1` to the iframe URL; the iframe uses `src=` (not srcDoc) at `:2897`, so the param is actually consumed by the sandboxed document.
4. **The baked shim honors `freeze=1`** — `apps/web/scripts/inject-shim-v2.cjs:107-119`: reads `freeze` from `location.search`, records every `setInterval`/`setTimeout`/`requestAnimationFrame` id, and at `_st(freezeNow,1400)` calls `freezeNow()` which restores native timer fns, clears all recorded ids, brute-clears the integer-id range, and appends a `*{animation:none!important;transition:none!important}` style. Kiosk boards get the equivalent from `public/templates/kiosk/_edit-shim.js:32-56`.
5. **Coverage is complete** — swept all 107 boards under `public/templates/{hs,signage,fitness,kiosk}`: **0 boards missing freeze support**. No stale V4 apply-only boards remain.
6. **Off-screen tiles actually unmount** — `ScaledTemplateThumbnail.tsx:109-136`: `isVisible` defaults `false`; a 600px-margin observer mounts, a 1600px-margin observer unmounts (1000px hysteresis prevents thrash). `:206` gates the whole zone subtree (incl. iframe) on `isVisible`, so scrolled-past iframes are torn down rather than accumulating — this is the actual fix for the "accumulating animating iframes" pathology.

**One nuance (not a bug):** mounting is bounded by the 600px IO margin, so only near-viewport tiles ever mount — but freeze fires at 1400ms *after each mount*, so during fast scroll a band of tiles can be briefly live (≤1.4s each) before freezing. Acceptable and self-limiting; no action needed.

## Findings — ranked

### P1 — Playlists page renders EXTERNAL_HTML template thumbnails WITHOUT freeze
**Severity: P1** (same bug *class* as the sev-1, different page; most likely "next page unresponsive").
**Evidence:** `apps/web/src/components/playlists/PlaylistPreviewThumb.tsx:444-452` (tile mode) and `:464-472` (list mode) render `<ScaledTemplateThumbnail … />` with **no `freeze` prop** (defaults to `false`). When a playlist's template contains an `EXTERNAL_HTML` zone, every visible playlist tile mounts a *live* 4K board iframe (live clock + keyframe anims + ticker).
**Blast radius:** `/[schoolId]/playlists` (`page.tsx:481`, `:634`). A district that built playlists on top of the signage boards (the common case now that ~107 boards are the flagship templates) gets N live unfrozen iframes. ScaledTemplateThumbnail IO-unmount caps *off-screen* count, but on-screen tiles run hot; a 3-column grid of board-backed playlists = 6-9 live 4K iframes pegging the main thread.
**Fix:** add `freeze` to both `<ScaledTemplateThumbnail>` calls in `PlaylistPreviewThumb.tsx`. Static previews — should never be live. One-line change per call site, mirrors the gallery fix exactly.

### P1 — Playlist Create Wizard maps ALL templates as live (unfrozen) thumbnails
**Severity: P1.**
**Evidence:** `apps/web/src/components/playlists/PlaylistCreateWizard.tsx:1837-1869` — `templates.map(...)` over the full filtered template set, each rendering `<ScaledTemplateThumbnail … maxHeight={110} />` with **no `freeze`**. Step 2 of the wizard is a full template picker grid.
**Blast radius:** The "Create playlist → choose template" wizard. With ~107 EXTERNAL_HTML system templates, filtering to a board-heavy category mounts dozens of live 4K iframes in a modal grid — the exact original fire, inside a modal.
**Fix:** add `freeze` to the `<ScaledTemplateThumbnail>` at `:1858`.

### P2 — Assets page: unbounded, un-virtualized grid + no lazy image loading
**Severity: P2.**
**Evidence:**
- `apps/web/src/app/[schoolId]/assets/page.tsx:152` `useAssets()` fetches `/assets` with **no pagination params**; the API caps at 500 (`assets.controller.ts:500-516`, default `take:500`, ceiling 1000) but the client never requests more pages — so it silently shows ≤500 with no infinite scroll, and renders them all in one `filtered.map` (`:992`) with **no virtualization** (the repo has *zero* virtualization libraries).
- Image tiles use a plain `<img src={thumb}>` at `:1075-1078` with **no `loading="lazy"`** — all up-to-500 thumbnails eager-fetch from Supabase on mount. (Video tiles *were* fixed with `preload="none"` at `:1050`; images were missed.)
**Blast radius:** `/[schoolId]/assets` at a media-heavy tenant. 500 simultaneous image GETs + 500 DOM nodes on mount = slow first paint, high egress, memory pressure on low-end machines.
**Fix:** (a) add `loading="lazy" decoding="async"` to the asset `<img>` (cheap, big win); (b) longer term, virtualize the grid or add infinite-scroll using the API's existing `skip`/`take`.

### P2 — Background polling of heavy unpaginated endpoints (refetchIntervalInBackground)
**Severity: P2.**
**Evidence (`apps/web/src/hooks/use-api.ts`):**
- `useScreens` → `/screens`, `refetchInterval: 10_000` + `refetchIntervalInBackground: true` (`:135-139`). `/screens` is unpaginated (`screens.controller.ts:921`, `findMany` no `take`, includes `screenGroup`). At 50-location scale this is the full fleet every 10s, **even when backgrounded**.
- `useScreenGroups` → `/screen-groups`, same 10s background poll (`:33-35`).
- `useTenantStatus` → `/tenants`, 30s background poll (`:15-16`).
**Blast radius:** Any operator with the dashboard open in a background tab hammers the API + Supabase pool every 10s. Multiply across admins → steady DB-pool load (relevant given `connection_limit` sensitivity).
**Fix:** drop `refetchIntervalInBackground: true` on `/screens` and `/screen-groups`; consider 20-30s interval and/or `take`/pagination on `/screens`.

### P3 — Heavy editor/builder routes are statically imported (bundle bloat)
**Severity: P3.** Only **3 files** in `apps/web/src` use `next/dynamic`/`React.lazy`. The builder entry `apps/web/src/app/[schoolId]/templates/builder/[id]/page.tsx:8` imports `BuilderShell` statically (pulls dnd-kit, full widget catalog, panels). Good example to extend: `ScaledTemplateThumbnail.tsx:29-32` dynamic-loads `WidgetRenderer`.
**Fix:** `dynamic(() => import('@/components/template-builder/BuilderShell'), { ssr:false })`; same for sports console / CTS simulator.

### P3 — Clever SIS sync issues one `updateMany` per user in a loop (N+1)
**Severity: P3 (N-A-ish — Sprint 2, background cron).** `apps/api/src/integrations/clever/clever.service.ts:269` `for (const u of diff.toUpdate) { await … user.updateMany(…) }` — serial per-user writes. Batch when Clever ships.

## Class sweeps (counts)

- **`ScaledTemplateThumbnail` (iframe-bearing) call sites:** 5 across 3 components — templates/page (grid ✅ freeze, modal ✅ correctly live), PlaylistPreviewThumb ×2 ❌ **no freeze** (P1), PlaylistCreateWizard ❌ **no freeze** (P1). **2 of 4 static-preview sites missing freeze.**
- **`<iframe>` surfaces in apps/web/src:** 17 files. Multi-iframe gallery surfaces: gallery (✅ fixed), playlists (❌ P1), wizard (❌ P1). Rest mount a **single** iframe (player, board, ribbon, sports preview, holiday, streaming, fitness TV, PDF imports, getting-started) — not a risk. `PdfHoverThumb` mouse-enter-gated. **No `srcDoc` anywhere.**
- **Baked-board freeze coverage:** 107/107 — **0 un-frozen boards.**
- **Widget files using setInterval/rAF:** 120 — **all 120 have cleanup.** Zero leaking timers.
- **List virtualization:** **0 virtualization libs.** Unbounded un-virtualized `.map`: assets (≤500, P2), screens (nested unpaginated). Audit log IS paginated. Templates/playlists bounded by catalog + IO-gated per-tile.
- **`findMany` in apps/api/src:** 135. Operator list endpoints: assets ✅ paginated, audit ✅ paginated (+ bounded CSV `take:10000`), screens ❌ no `take` (P2), templates bounded (heavy `zones` select but capped), playlists bounded. No true N+1 fan-out except Clever loop (P3).
- **React Query polling:** ~14 with `refetchInterval`. Hottest: sports `useGameEvents` 2s + `useGame` 4s (single live game — acceptable). Background-polling heavy: `/screens` 10s, `/screen-groups` 10s, `/tenants` 30s (P2).
- **WS/SSE reconnect:** player uses exponential backoff + full jitter capped 30s (`player/page.tsx:435-436`) — **no reconnect-storm risk.**

**Recommended launch-gate order:** fix the two P1 `freeze` omissions first (one-line each), then the P2 assets `loading="lazy"`, then P2 background-poll trims.
