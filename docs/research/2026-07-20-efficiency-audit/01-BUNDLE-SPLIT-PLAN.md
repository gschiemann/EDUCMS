# F3 Bundle Split — Execution Plan (deferred deliberately, 2026-07-20)

## What shipped now
The **bundle-budget ratchet gate** (`apps/web/tools/check-bundle-budget.cjs` + baseline, wired into the deploy-reliability web-build job): largest chunk and total chunk payload are locked at today's measurements as down-only ceilings. Growth reds CI immediately.

## Why the split itself is deferred (the deep-dive facts)
1. **Icons are NOT the mass.** Only one widget file imports `lucide-react` directly, and Turbopack already splits icons per-module. The 3.4 MB × 4 chunks are the **widget component world itself** — 6.9 MB of source across 51+ widget files (inline-SVG theme scenes, celebration suites, holiday variants) bundled into every entry that mounts `WidgetRenderer`.
2. **The player's offline story forbids naive lazy-loading.** `public/sw-player.js` precaches **media assets only** (playlist tier + never-evict emergency tier) — it does not cache `_next/static` JS. A lazily-imported widget chunk that was never fetched before the network dropped is unfetchable → a scene whose widget type wasn't visited yet would fail to render **on the life-safety surface**. Player-side splitting therefore requires app-shell precaching in the SW first.
3. Dashboard-side splitting (templates gallery thumbnails, builder panels) is viable without SW work, but changes visible render timing (skeletons) — per the repo's verify-before-claim rule it needs live visual verification, not a tail-of-session edit.

## The plan for the dedicated session
Order of work, each step verified before the next:
1. **SW app-shell precache tier** in `sw-player.js`: on activate + on `CHECK_FOR_UPDATES`, fetch the build manifest and precache all `_next/static` chunks into a versioned shell cache (never-evict until next version activates). This makes ANY later chunk-splitting offline-safe, and immediately hardens today's player against cold-boot-offline.
2. **Dashboard surface split**: `next/dynamic` (skeleton fallback) on the dashboard-only WidgetRenderer mount sites — templates gallery page thumbnails first, then the builder preview panels. Player + board routes stay static. Verify: gallery/browser screenshots, chunk-size delta via the ratchet gate (`UPDATE_BASELINE=1` after confirming the drop).
3. **Player long-tail lazy registry** (only after step 1 is live-verified): keep the core widget set static (TEXT/CLOCK/IMAGE/ANNOUNCEMENT/TICKER + emergency surfaces — emergency rendering must NEVER be behind a dynamic import), lazy the theme long tail (celebrations, holiday, portrait suites) with an idle-time prefetch after first paint so scene cycling never flashes. Verify on the physical LED via the webcam workflow (repo standard), including an offline drill: boot → precache → kill network → cycle every scene type.
4. Ratchet the baseline down after each verified step.

## Verification protocol (non-negotiable, from repo culture)
- WebKit + Chromium runs of the affected dashboard pages (cross-browser rule #1).
- Physical LED check for any player change (Taurus floor is Chromium 83–87 — `import()` is supported, but verify on glass).
- Offline drill before calling step 3 done.
- CI: bundle gate must show the reduction; never raise the ceiling.
