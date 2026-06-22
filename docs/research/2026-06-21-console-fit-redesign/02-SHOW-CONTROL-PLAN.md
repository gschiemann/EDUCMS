# Sports Show Control — scene launcher with auto-revert (2026-06-22)

> Greg: "I see a halftime template but how would I even trigger that during halftime? … the template
> workflow might not be properly setup for ease of use." → chose the **Full Show Control launcher**.
> Design from a 6-agent workflow (board-flow + render + pro show-control research → 2 designs → synthesis).
> Raw: `showcontrol-raw-workflow.json`.

## Chosen architecture — `SCENE` GameEvent (ZERO migration)
Both designs scored 82; the decisive factor is the live-pilot "additive only" rule. The winner stores the
active scene as a **latest-wins `SCENE` GameEvent** — NOT new Game columns, NOT a stats key — because
`GameEvent.type` is a free-form String (schema.prisma:2200) and the **T2-5 `LIVE_OVERLAY` feature already
ships this exact pattern**: a latest-wins event resolved in `getBoardFresh`, surfaced on the public
`/sports/board/:id` payload, picked up by the board's 750ms poll, auto-cleared server-side. So Show Control
needs **no schema change at all** — the lowest-risk path.

**Server-authoritative auto-revert:** `recallScene` records a `SCENE` event with `expiresAt = now + holdMs`.
`getBoardFresh` returns `scene = null` once `expiresAt` passes (the board never even sees an expired scene),
so a closed laptop / dead operator can't strand the board. Client countdown chip is a courtesy safety-net.

## Slice order (each independently CI-greenable, ships incrementally)
1. **API** — `recallScene`/`clearScene`/`extendScene` (mirror `fireLiveOverlay`/`clearLiveOverlay`), resolve
   latest `SCENE` in `getBoardFresh` (server-authoritative expiry + tenant-scoped template validation +
   AuditLog), 3 controller routes, `scene?` on the api-types board shape. Backend-only; board ignores `scene`
   until Slice 2. Verifiable by curl (board route is PUBLIC — sidesteps task #205).
2. **Board render** — ONE branch ABOVE the `scoreboardTemplateId` check (board/page.tsx:4162) rendering
   `CustomScoreboardScene` with the scene template + `CueOverlay`. When `scene` is null (every game until a
   console emits one) the board is byte-identical to today. **MUST verify the EmergencyOverlay still renders
   ABOVE this early-return branch** (emergency invariant — render-ordering check, no logic change).
3. **Console** — `ShowControlPanel` (gameday scene tiles + always-visible RED "Back to Live" + on-air
   countdown chip + Hold/Extend), `ctl.scene/sceneClear/sceneExtend` mutations, mount in Run mode, number-key
   shortcuts. The operator happy path.
4. **Auto-clear on status transition** — one `record(id,'SCENE',{kind:'clear'})` in `setStatus` so a quarter
   change can't leave a scene stranded. Belt-and-suspenders.

## Recallable gameday scenes (sports-presets.ts)
`sports-gameday-lineup` (Starting Lineup) · `sports-gameday-tonight` (Tonight's Game) · `sports-gameday-schedule`
(This Week) · `sports-gameday-halftime` (⏸️ Halftime Board) · `sports-gameday-countdown`. All category GAMEDAY,
full-bleed 1920×1080 → render via the existing `CustomScoreboardScene`.

## Verification (per slice)
`pnpm db:generate` must produce NO migration (the whole point). API: curl the public board route (scene null →
set → resolves → expires→null → foreign templateId 400 → AuditLog row). Board: Playwright the PUBLIC /board
route in chromium+webkit, pixel-diff vs master when scene null (non-regression), then with a scene. Console:
production build / `next start` (NOT `next dev` — task #205). `pnpm mobile-perf-guard` (countdown is a
visible-only 500ms timer). Watch CI green before declaring shipped.
