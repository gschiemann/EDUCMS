# Live Menu Feed — What Exists, What's a Costume, What's Missing
_Read-only investigation, 2026-05-31._

**TL;DR:** The menu **backend data model + POS sync + auto-86 + device read endpoint are REAL and reusable**. The React menu widgets already poll them live (30 s). The gap is the **71 HTML signage menu boards** — their `data-source`/`data-feed`/`data-field-path`/`data-refresh` attributes are **decorative, read by nothing**; the iframe only receives static text/brand/image overrides. A price change or 86 never reaches them.

## 1. MENU DATA MODEL — REAL (two layers)
`packages/database/prisma/schema.prisma`:
- **Layer A (POS mirror):** `PosProviderConnection` (1613, encrypted creds, `locationMap`), `PosMenuItem` (1652: `externalId,name,priceCents,salePriceCents,category,available,badges[]`), `PosCategory` (1679), `ProcessedPosEvent` (1701, webhook idempotency).
- **Layer B (design-once catalog + per-location overrides — the richer model):** `MenuCatalog` (1751), `MenuCategory` (1775), `MenuItem` (1799: `defaultPriceCents,externalId,allergens[],tags[]`), **`MenuLocationOverride` (1845: `priceCents?` null=inherit, `isAvailable` false=86, `soldOutUntil?`, `isHidden`, `source`)** ← the 86 / per-location-price piece, `PosLocation` (1872, `screens[]`, `Screen.posLocationId`), `Daypart` (1901), `MenuSyncCursor` (1921).
- **Menu state object:** `ResolvedMenu` (`apps/api/src/pos/menu.service.ts:71`) = `{ locationTenantId, generatedAt, categories[], items[] }`; each item `{ id, externalId, name, description, priceCents, priceOverridden, imageUrl, allergens[], tags[], category, categoryId, sortOrder }`. Resolution (price = override ?? default; visible = `!isHidden && isAvailable && (soldOutUntil==null||<now)`; daypart by location-local time) in `resolveMenuForLocation()` (`menu.service.ts:102`).

## 2. MENU-MANAGEMENT BACKEND — REAL CRUD + auto-86, **NO realtime push**
`apps/api/src/pos/`:
- `pos.controller.ts` — `GET /pos/providers|connections|items|categories`, `POST /connections`, `POST /connections/:id/sync`.
- `menu-admin.controller.ts` — `GET /menu/catalog|locations|overrides`, `PUT/DELETE /menu/overrides/:loc/:item`, **`POST /menu/overrides/bulk`** (50-location one-tx), `POST /menu/import` (paste-your-menu).
- `pos-oauth.controller.ts` — Square OAuth, **`POST /pos/webhook/square`**, **`POST /pos/webhook/:providerId`** (custom webhook: `{menu}` / `{availability}|{eightySix}` / legacy `{items}`).
- **Device read (the single board endpoint): `GET /api/v1/screens/:id/menu`** (`screens.controller.ts:3504` `getMenu`, device-token authed) → resolves screen→location→catalog → returns `ResolvedMenu`.
- **Auto-86 REAL:** `menu.service.ts:566 applyAutoEightySix()`, `:676 applySquareInventoryCounts()`; Square webhook `inventory.count.updated` → sub-second flip.
- **Realtime push (tasks #201/#208): DOES NOT EXIST.** grep of `apps/api/src/pos/` for `redis|publish|broadcast` = zero. A price/86 change writes Postgres and stops. "Realtime push" was aspirational. Only freshness = the player's client poll.

## 3. POS CONNECTORS — Square REAL; rest are honest costumes
- **Square** `pos/providers/square.ts` — real OAuth, real catalog pull (`squareFetchCatalog`), real HMAC webhook verify. Lands in `PosMenuItem`/`PosCategory` via `PosService.syncSquare()`.
- **Toast/Clover/Lightspeed/Shopify/etc. = costumes, honestly gated:** no provider files exist; `triggerSync()` returns "not yet implemented"; `createConnection()` 403s PARTNER-tier (no dead rows). A real connector would mirror `syncSquare` (Layer A) or write `MenuItem`+`MenuLocationOverride` (Layer B). The custom-webhook `{menu}` path (`menu.service.ts:310 ingestCustomWebhookMenu`) is the working BYO-POS lander.

## 4. TEMPLATE FEED HOOKS — the decisive gap (two render paths; only React is wired)
**(a) HTML signage templates (`public/templates/signage/qsr/`, `menus-pos/`) — INERT.** 71 files, identical `EDUCMS-SHIM-V3` inline script (e.g. `qsr/11-dominos-pizza-board.html:179`). The shim does only: `readParams()` (base64url `?brand=&text=&textStyles=&img=`), `applyTextAndStyles()` (`data-field` text), `applyImages()` (`data-img`/`data-slot`), and a **`educms-overrides` postMessage** listener carrying the same static `{brand,text,textStyles,img}`. **`data-source`/`data-feed`/`data-refresh`/`data-field-path` are 100% decorative** — grep of all 71 files = zero `fetch`/`EventSource`/`XHR`, zero JS reading those attributes. (Counts: 1787 `data-field`, 146 `data-source`, 71 `data-feed`, 45 `data-refresh`, 2 `data-field-path`.)
**(b) How the iframe gets data — static only.** `WidgetRenderer.tsx:2767 ExternalHtmlWidget` renders `<iframe sandbox="allow-scripts" src={url + base64url params}>` assembling `brand/text/textStyles/img` from saved `config`. No `screenId`, no menu fetch, no postMessage loop. `sandbox="allow-scripts"` (null origin) → the iframe **cannot** fetch our API itself.
**(c) React widgets — the ONLY live path (poll).** `restaurant/MenuBoardWidget.tsx` (`RESTAURANT_MENU_BOARD`), `bar/TapListWidget.tsx`, `bar/CocktailMenuWidget.tsx` → `usePosMenuItems(config.posSync, config.posCategory)` (`lib/menu/use-pos-menu-items.ts:44`) → `fetchDeviceMenu()` (`lib/menu/device-menu.ts:172`) → `GET /screens/:id/menu` (device JWT) re-polled every **30 s** (`MENU_POLL_INTERVAL_MS=30_000`). Toggle via PropertiesPanel "Driven by: POS" (`config.posSync=true`).

## 5. THE GAP (to mirror "a score change hits every scoreboard")
Reframe: CTS is also a poll (750 ms + cache-bust), not a true push (its old `game:<id>` publish "landed on the bus and died"). Measured against that bar, menu is missing:
1. **A feed loop for the HTML boards (biggest gap).** Either build the feed engine in the V3 shim driven by a **parent→iframe `educms-overrides` postMessage** (React parent polls `/screens/:id/menu`, pushes resolved fields in; sandbox blocks the iframe from fetching directly), OR standardize live menus on the React widgets.
2. **Tighter latency (optional):** React path is 30 s vs sports 750 ms.
3. **Real pub/sub push (optional; sports lacks it too):** wire `applyAutoEightySix`/`setOverride` to `RedisService.publish` a signed `MENU_CHANGED` on `device:<screenId>`/`tenant:<tenantId>`; player re-fetches on receipt. Plumbing exists; POS just never calls it. Use tenant/group/device channel (player only psubscribes those).
4. **Cache + per-write invalidation for `/screens/:id/menu`** (sports has it for the board).
5. **Toast/Clover real connectors** if the pilot POS isn't Square (custom-webhook is the stopgap).

## Status table
| Piece | Status | Location |
|---|---|---|
| Menu data model (catalog + per-location price-book + 86 + dayparts) | REAL | `schema.prisma:1751-1928` |
| Menu CRUD + bulk overrides + paste-import | REAL | `pos/menu-admin.*` |
| Auto-86 (custom-webhook + Square inventory) | REAL | `pos/menu.service.ts:566,676` |
| Square connector | REAL | `pos/providers/square.ts` |
| Toast/Clover/etc connectors | COSTUME (gated 403) | `pos.service.ts:98,238` |
| Device read `/screens/:id/menu` | REAL | `screens.controller.ts:3504` |
| React menu widgets live-poll (30 s) | REAL | `MenuBoardWidget.tsx` + `use-pos-menu-items.ts` + `device-menu.ts` |
| HTML `data-source`/`data-feed`/`data-refresh` | COSTUME (decorative) | all 71 `public/templates/signage/` files |
| HTML iframe live-data wiring | MISSING | `ExternalHtmlWidget` (WidgetRenderer.tsx:2767) static params only |
| Realtime push on menu change | MISSING (absent from sports too) | nothing in `pos/` publishes |
