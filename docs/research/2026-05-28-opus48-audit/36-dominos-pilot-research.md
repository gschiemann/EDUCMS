# Domino's Pizza Pilot — Research & Template Proposal

> Opus 4.8 read-only, 2026-05-29. CLAUDE.md Template Design Workflow + QSR widgets + POS module read end-to-end.

## Bottom line
The **menu-board half** of a Domino's pilot is strong + mostly assembly. The **order-status /
Pizza-Tracker / driver / make-line half has NO data path** in our product AND Domino's offers no
realistic one to a 3rd-party signage vendor. Pitch accordingly or it's a costume.

## What we already have (verified)
- 6 restaurant widgets (`restaurant/`): MENU_BOARD (live POS when `posSync`), COMBO_CAROUSEL, SPECIALS_CALLOUT, LOYALTY_TICKER, WAIT_TIME, ALLERGY_LEGEND.
- 8 QSR presets incl. `qsr-pizza-shop-menu` (closest to Domino's).
- Static QSR signage HTML pack (10 files) incl. `03-order-ready.html` ⚠️ **whose comment claims "POS-driven via /queue/preparing & /queue/ready feeds" — those endpoints DON'T EXIST. Existing integration costume in the repo; relabel as static/demo.**
- POS framework: working `custom-webhook` BYO-POS ingest + Square. **Documented limit (`pos.ts:19-23`): syncs CATALOG (menu/price/hours), NOT orders.** No order/queue/make-line/dispatch ingest anywhere.
- Auto-branding scraper already wired with dominos.com as its example (`branding-scraper.service.ts:278`).

## Surface inventory
| Area | Screen | Live-data need |
|---|---|---|
| Lobby | Primary menu board | menu/price (static OR live catalog) |
| Lobby | Deals / Mix&Match / LTO | static |
| Lobby | **Carryout/Pie-Pass pickup-status (by name)** | 🔴 live order status — NO PATH |
| Lobby | **Pizza Tracker stages** | 🔴 live — NO PATH |
| Lobby/wall | Promo / brand video / app-download | static/scheduled |
| Lobby | Allergen/nutrition | static |
| Window | Hours / storefront / delivery | static |
| Back | **Driver dispatch board** | 🔴 live ops (Dom dispatch internal) — NO PATH |
| Kitchen | Make-line/KDS | 🔴 it IS Pulse's own KDS — not ours to replace |
| Drive-thru | Menu + order-confirm | menu static; confirm 🔴 needs POS |
| Back | Now-hiring / ops / goals | static |
→ ~7 surfaces shippable now (static/catalog); the 3-4 highest-differentiation (pickup-status, tracker, dispatch) need live order data we can't get.

## Systems + integration feasibility (brutally honest)
Domino's = proprietary vertically-integrated: **Pulse / Next Gen Pulse → Dom.OS**, consumer **Pizza Tracker**, internal make-line + **"Dom" dispatch**. In-store signage is HQ-centrally-managed (Yodeck case study: content manually managed, NOT POS-fed).
| System | 3rd-party API? | Verdict |
|---|---|---|
| Pulse POS | ❌ closed; only via Servant Systems/Pulse eConnect, partner-vetted, franchise-IT-gated | 🔴 closed (= our Aloha CLOSED tier) |
| Pizza Tracker / order status | ⚠️ unofficial reverse-engineered `pizzapi`/`node-dominos-pizza-api` = per-customer-by-phone, NOT a store feed; undocumented; ToS risk | 🔴 not viable for a lobby board |
| Make-line / KDS, Dom dispatch | ❌ internal | 🔴 closed |
| Store menu+prices | ⚠️ unofficial `Menu(storeId)` (no auth) OR our custom-webhook OR manual | 🟡 possible-but-fragile; manual = safe default |
| In-store signage control | ✅ franchisee can run own players (Yodeck/OptiSigns case studies) | 🟢 OUR LANE |

**One-sentence truth:** we can own + run a Domino's store's screens + show menu/deals/promos beautifully, but **cannot** show live order-status/tracker/dispatch — Domino's keeps order/ops data in proprietary Pulse with no 3rd-party feed (only a per-customer consumer endpoint). Any "live pickup board" pitch is a costume without a Domino's corporate partnership.
**Pilot integration path (ranked):** 1) manual menu entry (ships now, recommend); 2) custom-webhook catalog push (if franchisee IT can export); 3) unofficial Menu(storeId) poll (demo-only, ToS risk); 4) Pulse/eConnect partnership (only route to order data — V2/enterprise, corporate conversation).

## Brand
Blue `#006491` (PMS 647C) + red `#E31837` (PMS 199C) + white; domino-tile mark. Oct-2025 "Mmm" refresh = hotter red/blue + "Domino's Sans" + cravemark (no official new hex; scrape from dominos.com). ⚠️ our QSR templates use cream/caramel `#e8b94a` = OFF-BRAND; must re-skin (scraper + `var(--brand-*)` makes this easy).

## Proposed template set (build one-at-a-time per no-batch loop)
| # | Template | Maps to | Live/static |
|---|---|---|---|
| 1 | Domino's Menu Board | RESTAURANT_MENU_BOARD ×N + CLOCK (reskin qsr-pizza-shop-menu) | static (or live catalog) |
| 2 | Deals/Mix&Match/LTO | SPECIALS_CALLOUT + COMBO_CAROUSEL | static |
| 3 | Promo/video/app wall | IMAGE_CAROUSEL/VIDEO + RICH_TEXT + LOYALTY_TICKER | static/media |
| 4 | Hours/storefront/delivery | RICH_TEXT + CLOCK | static |
| 5 | Allergen/nutrition | ALLERGY_LEGEND + RICH_TEXT | static |
| 6 | Now-hiring/ops | RICH_TEXT + QR | static |
| 7 | Pickup/Order-Ready | ⚠️ NEW ORDER_STATUS widget | 🔴 live — NO PATH (manual/demo only) |
| 8 | Pizza Tracker | ⚠️ NEW PIZZA_TRACKER widget | 🔴 live — NO PATH |
| 9 | Driver dispatch | ⚠️ NEW DRIVER_DISPATCH widget | 🔴 live — NO PATH |
**MVP recommendation:** ship 1-6 (static/catalog, reskinned blue/red, zero costume risk). 7-9 = clearly-labeled "Phase 2 pending Domino's data partnership," or manual/demo-only if explicitly labeled.

## Need from Greg before building (per no-batch + reference-driven rules)
1. **Reference images (2-3)** + which brand era (current flat blue/red, or 2025 "Mmm" refresh).
2. **Integration expectation:** confirm we pitch menu/deals/promo (static/manual) + scope OUT live pickup/tracker/dispatch — OR greenlight a Domino's-corporate (Pulse/eConnect) conversation.
3. **Store profile:** which screens this store has, AND — critically — is it a **franchise that controls its own displays**? (Corporate / HQ-centralized signage = non-starter for a 3rd-party pilot regardless of template quality.)
