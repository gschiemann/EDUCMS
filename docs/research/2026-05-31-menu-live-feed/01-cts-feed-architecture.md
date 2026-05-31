# CTS / Sports Live-Feed Architecture — End-to-End Blueprint
_Read-only investigation, 2026-05-31. Source for replicating the live-feed pattern on restaurant/QSR menu boards._

## Executive summary: it's a POLL, not a push
The sports integration does **NOT** push live score data over the signed-WebSocket/Redis bus. There is a legacy WS path (`GAME_STATE`) but the **production source-of-truth path is HTTP-poll-based**: every source writes to one Postgres JSON column (`Game.stats.cts`), and every display surface polls a public endpoint (`GET /api/v1/sports/board/:id`) every **750 ms**. A render-time overlay (`applyCtsOverlay`) decides whether the live feed or operator input wins. This poll-and-overlay pattern is the reusable mechanism — transport-agnostic, no device auth, and exactly what the menu side should re-use.

## 1. SOURCE
- CTS/Daktronics serial bridge: `apps/web/src/components/player/CtsBridge.tsx` (Web Serial / native bridge) → `packages/scoreboard-cts/src/parser.ts` (`CtsParser`) / `daktronics/parser.ts`. Throttled POST at 5 Hz.
- Emulator: `packages/scoreboard-cts/src/mock.ts` + `apps/web/src/app/super/cts-simulator/page.tsx` — feeds the SAME parser → SAME POST.
- Manual cue / Stream Deck: `CtsBridge.parseStreamDeckLine` → `POST /sports/games/:id/cue`, `PATCH /sports/games/:id/score` (same endpoints as the dashboard operator console).
- Ingest endpoints: `POST /sports/board/:id/cts-snapshot` (HMAC feed token), `POST /sports/board/:id/feed` (external boxes), `POST /sports/games/:id/cue`, `PATCH /sports/games/:id/score`, legacy `POST /screens/:id/game-state`.

## 2. NORMALIZATION / STATE
- Server: `SportsService.ingestCtsSnapshot()` (`apps/api/src/sports/sports.service.ts:3799`) → `cleanCtsSnapshot()` → writes `Game.stats.cts = { ...cleaned, lastUpdateAt: <ISO> }`.
- **Design rule: NEVER overwrite the authoritative operator columns** (`Game.homeScore/awayScore/clockMs/...`). `stats.cts` is a separate "live feed" namespace; operator columns are the manual layer. This lets the operator take over when the console dies.
- Models: `Game` (`schema.prisma:2032`, has `stats Json`), `GameEvent` (`:2124`, append-only log). **No `ScoreSource` model exists** — "source" is just a string on payloads. Live state = `Game.stats.cts` JSON, not Redis, not a dedicated table.

## 3. TRANSPORT / PUBLISH
- **Primary (gameId mode) — HTTP poll, NOT pub/sub.** After ingest: `invalidateBoardCache(gameId)`; board read memoized 1 s (`BOARD_CACHE_TTL_MS`). Surfaces poll `GET /sports/board/:id` (`getBoardFresh`) every 750 ms (`GameStateContext.tsx` `POLL_MS`). Response = flat board JSON + `serverTime: Date.now()`. **Endpoint is public/un-guarded** (the gameId UUID is the capability); defense = HMAC feed token on writes + rate-limit (40/10s/game) + tenant-scoped template resolution.
- **Legacy (screen-scoped) — the signed-WS bus.** Only when bridge has no gameId. `POST /screens/:id/game-state` → `signMessage('GAME_STATE', …)` → Redis channel `device:<screenId>`. Channel convention = `${scopeType}:${scopeId}`, scopeType ∈ `tenant|group|device`. HMAC gate: `RedisService.handleRedisMessage` → `verifyWsHmac` (`apps/api/src/security/ws-signature.ts`) on every message before broadcast. `GAME_STATE`/`CTS_MANUAL_CUE` are free-string types (not in the `ws-events` enum, which is emergency/ops only). Envelope: `{ type, payload, signature, timestamp, idempotencyKey }`.

## 4. PLAYER / WIDGET CONSUMER + DATA BINDING
- Provider: `apps/web/src/components/widgets/sports/GameStateContext.tsx` — `GameStateProvider({gameId})` runs the 750 ms poll + a 100 ms clock projector (smooth clock between polls, drift-corrected vs `serverTime`). `useGameState()` → `{ snapshot, liveClockMs }`. Re-render is plain React `setSnapshot`.
- Freshness overlay: `apps/web/src/lib/cts-merge.ts` `applyCtsOverlay(boardData)` + `isCtsFresh(cts, serverTime)` (`CTS_FRESH_MS=5000`). Fresh feed overlays `stats.cts` onto top-level fields; stale → operator data unchanged. Called by every surface.
- **THE DATA-BINDING ENGINE (the key reusable piece):** `apps/web/src/components/widgets/sports/cts-fields.ts`:
  - `CTS_FIELDS` — catalog `{ key, label, group, source:'top'|'stat' }`.
  - `CTS_DEFAULT_FIELD` — per-widget-type/variant default binding.
  - `resolveCtsField(snapshot, liveClockMs, key, opts)` — turns `(snapshot, key)` into a display string.
  - `deriveCtsField(widgetType, cfg)` — resolves bound key: `cfg.ctsField` → legacy `cfg.statKey` → per-type default.
  - Widgets (`SportWidgets.tsx`): `const key = deriveCtsField(type, config) ?? default; const resolved = resolveCtsField(snapshot, liveClockMs, key); const display = resolved ?? config.placeholder;` — binding stored on `TemplateZone.defaultConfig.ctsField`, set via PropertiesPanel dropdown. Out-of-provider (builder/thumb) → placeholder.
- Generic template → live: `apps/web/src/app/board/[gameId]/CustomScoreboardScene.tsx` wraps ANY operator Template in `<GameStateProvider>` and renders zones through WidgetRenderer.

## 5. CUE / AUDIT / DEDUP
- Cue: `POST /sports/games/:id/cue` → `fireCue()` writes `CUE` GameEvent; board poll picks up via `cues` array (20 s window). Phone/Stream-Deck: `POST /screens/:id/cue` → signed `CTS_MANUAL_CUE`.
- Audit: `recordCueFired()` writes `CTS_CUE` GameEvent; `maybeAutoCelebrate()` writes immutable `AuditLog` (`SPORTS_CUE_FIRED`).
- Dedup: score event only when `scoreChanged`; auto-celebrate only on `delta>0` matching `autoPoints`; audit sampled (transitions or 1/60s); legacy WS 16 Hz/screen cap.

## THE REUSABLE MECHANISM (copy for menu boards)
Generic / reusable:
1. JSON "live overlay" namespace on the entity row (sports: `Game.stats.cts`; menu: `MenuLocationOverride` / resolved menu). **Never overwrite operator-authored values; merge by freshness.**
2. Public, un-authed, rate-limited, cached poll endpoint returning `{...fields, serverTime}` (menu: `GET /screens/:id/menu` already exists, device-token-authed).
3. React context provider that polls on an interval (drop the clock projector for menus).
4. Render-time freshness overlay helper (live wins when fresh, else static).
5. **The data-binding catalog pattern** (`cts-fields.ts`): a `FIELDS` catalog + per-type default map + `resolve(snapshot, key)` + widgets reading `config.<bindKey> ?? default`. → a `menu-fields.ts` equivalent.
6. HMAC stateless feed token for machine ingest (`sports-feed-token.ts`).

Sports-specific (do NOT copy): serial decoders, cadence clock heuristic + projector, water-polo semantics, celebration cinematics, the legacy `device:<screenId>` WS path.

Anchor files: `cts-fields.ts` (binding), `GameStateContext.tsx` (poll provider), `cts-merge.ts` (overlay), `sports.service.ts` getBoard/ingestCtsSnapshot (cached poll + overlay write), `sports-feed-token.ts`, `sports-board.controller.ts` (public ingest+poll).
