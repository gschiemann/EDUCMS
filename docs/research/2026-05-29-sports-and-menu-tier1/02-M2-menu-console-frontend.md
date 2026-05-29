# M2 — operator-facing 50-location menu platform (web)

**Commit:** `e54d8f7` · **Scope:** `apps/web` only (10 files, +2320 LOC) ·
web tsc 0 errors · verified via Playwright/Chromium static repros.

## Key discovery (why it builds against M1's *contract*)
M2's worktree base was `2319212`; M1's backend landed one commit later
(`f993faa`). So M2 verified M1's **shipped contract on master** and built
against it. Zero file overlap with master's advance → conflict-free
cherry-pick (confirmed: cherry-picked clean as `e54d8f7`).

M1 shipped `GET /screens/:id/menu` (device-auth) + `menu.service.ts`
(`resolveMenuForLocation`, `isItemVisible`, `ingestCustomWebhookMenu`,
`applyAutoEightySix`) + the Prisma migration. M1 did **NOT** ship the
console admin endpoints (`/menu/overrides`, `/bulk`, `/catalog`,
`/import`) — those are M3's domain. M2's console **degrades gracefully**:
catalog falls back to live `/pos/items`; overrides default to all-inherit
so the grid renders; mutations surface an honest "menu service syncing"
toast (NOT a fake success). It lights up automatically when M3 ships.

## What was built (all 4 tasks)
1. **MenuBoardWidget → device endpoint + live poll** (`device-menu.ts`,
   rewired `usePosMenuItems`). Was calling session-authed `/pos/items` →
   403 → DEMO_ITEMS on every real Pi. Now reads device-authed
   `GET /screens/:id/menu` on the player (resolves `screenId` from cached
   manifest / URL — **zero player-file edit**), falls back to `/pos/items`
   only for the dashboard preview, and **re-renders on a 30s poll** (was
   one-shot). Keeps last-good list on transient failure (ref-based, no
   stale-closure bug). Payload mapping matches M1's exact
   `{items:[{priceCents,badges,...}]}` shape. **Taurus-safe** (player-shipped;
   pure fetch+JSON, no `inset`/flex-`gap`).
2. **Bulk price-book console** at `/[schoolId]/menu` (page + `MenuPriceCell`
   + `BulkPriceBar`). Items × locations grid (locations = child tenants via
   `Tenant.parentId`); **inherit-by-default** (central price greyed); click
   cell → type → tab creates a flagged override; one-click revert; one-click
   86 (per cell + per-item "set all / 86 all" across all or a scoped
   region). `resolveCell` replicates M1's `isItemVisible` rule exactly.
   Vertical-gated nav (RESTAURANT/RETAIL) in Sidebar + MobileTabBar.
3. **BYO field-binding** in `PropertiesPanel.tsx` — per-ITEM POS picker on
   `EXTERNAL_HTML` data-fields → writes
   `{{pos.item:<externalId>.price|name|available}}` into the existing
   `?text=` transport (server resolves per location). New
   `PosItemBindField` / `PosItemBindControls`.
4. **Self-serve onboarding** (`ConnectMenuPanel`) — "Connect your POS /
   paste your menu"; pastes text OR JSON → parses → imports via
   `POST /menu/import` (`{menu:[]}`) → auto-seeds a Menu Board template
   (posSync on). Honest degradation until `/menu/import` is live.

## Verification (Playwright/Chromium static repros)
- `01-console-desktop.png` — grid with inherited (grey), overridden
  (orange + revert), and 86'd (rose + badge) cells; bulk row actions.
- `02-console-390.png` — mobile reflow (hero stacks, toolbar wraps, grid
  h-scrolls with sticky Item column); desktop untouched.
- `03-menuboard-widget.png` — MenuBoardWidget against mocked
  `/screens/:id/menu`: shows the $10.49 Downtown override (not $8.99
  central), dietary chips from `badges`, 86'd item correctly absent.

## Files
New: `apps/web/src/lib/menu/{device-menu,menu-console-api}.ts`,
`apps/web/src/components/menu/{MenuPriceCell,BulkPriceBar,ConnectMenuPanel}.tsx`,
`apps/web/src/app/[schoolId]/menu/page.tsx`. Modified:
`MenuBoardWidget.tsx`, `PropertiesPanel.tsx`, `Sidebar.tsx`,
`MobileTabBar.tsx`.

## Follow-up (= M3)
The console's mutation/catalog endpoints (`/menu/overrides*`,
`/menu/import`, `/menu/catalog`, `/menu/locations`) need the API agent.
`menu-console-api.ts` is the exact contract M3 must match. Until M3 ships,
the console is wired + honest but read-mostly.
