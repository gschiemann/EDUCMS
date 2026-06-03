# Template Finalization — production review loop

**Started:** 2026-06-01 · **Owner:** Greg (feedback) + lead agent (fix/verify)

## The loop (one template at a time — NO batching, per CLAUDE.md)

For each template:
1. **Render** — lead screenshots the live render at production resolution (1920×1080, or the template's native canvas) from `https://venue-os.app/...` and posts it.
2. **Feedback** — Greg reacts: what's good, what to change.
3. **Fix** — lead fixes the template **and its corresponding widget(s)** (the widget components the template's zones render, or the inline shim for HTML templates).
4. **Verify** — re-screenshot the live render, compare to the approved direction. Match required.
5. **Approve** — stamp the template `APPROVED <date> — reviewed by Greg` (HTML: comment near top; React: comment above the component, per CLAUDE.md Template Design Workflow §"Track which templates have been approved").

Status legend: ⬜ pending · 👀 in review (awaiting feedback) · 🔧 fixing · ✅ approved for production

## Proposed order (Greg can override)
1. **QSR** (live Domino's pilot) → 2. **menus-POS** → 3. **bar** (active restaurant verticals + new live menu feed) →
4. **fashion / healthcare / hospitality / corporate** (other verticals) → 5. **high-school + fitness** HTML →
6. **React school presets** (animated set, scrapbook/storybook/bulletin, themed) → 7. **sports** scoreboards/ribbon/scorebug → 8. **holiday**.

---

## A. Customer-facing HTML templates (81) — `apps/web/public/templates/`

### QSR (11) — `signage/qsr/`
| # | File | Status |
|---|---|---|
| 1 | 11-dominos-pizza-board.html | 👀 |
| 2 | 01-drive-thru-flagship.html | ⬜ |
| 3 | 02-counter-menu.html | ⬜ |
| 4 | 03-order-ready.html | ⬜ |
| 5 | 04-lto-promo.html | ⬜ |
| 6 | 05-combos-deals.html | ⬜ |
| 7 | 06-beverages.html | ⬜ |
| 8 | 07-mobile-pickup.html | ⬜ |
| 9 | 08-rewards.html | ⬜ |
| 10 | 09-hours-location.html | ⬜ |
| 11 | 10-now-hiring.html | ⬜ |

### menus-POS (10) — `signage/menus-pos/`
01-fullservice-menu · 02-wine-list · 03-daily-special · 04-cocktail-program · 05-86-board · 06-brunch · 07-prix-fixe · 08-tasting-progress · 09-reservations · 10-takeaway-pickup — all ⬜

### bar (10) — `signage/bar/`
01-tap-list-flagship · 02-cocktail-menu · 03-bottle-list · 04-happy-hour · 05-now-pouring · 06-tonight-live · 07-bottle-service · 08-game-day · 09-hours-location · 10-now-hiring — all ⬜

### fashion (10) — `signage/fashion/`
01-lookbook-flagship · 02-editorial · 03-sale · 04-new-arrivals · 05-event-trunkshow · 06-fitting-room · 07-shoppable-window · 08-campaign · 09-hours-story · 10-loyalty-member — all ⬜

### healthcare (10) — `signage/healthcare/`
01-waiting-room-flagship · 02-physician-directory · 03-now-serving · 04-vaccine-clinic · 05-hours-closures · 06-patient-education · 07-mychart-signup · 08-pharmacy-pickup · 09-clinical-trial · 10-thanks-leave — all ⬜

### hospitality (10) — `signage/hospitality/`
01-lobby-welcome-flagship · 02-concierge-board · 03-events-board · 04-pool-spa-day · 05-dining-tonight · 06-wayfinder · 07-group-welcome · 08-checkin-status · 09-outlook · 10-brand-story — all ⬜

### corporate (10) — `signage/corporate/`
01-lobby-welcome-flagship · 02-conference-room · 03-kpi-dashboard · 04-new-hires · 05-floor-directory · 06-all-hands · 07-cafeteria · 08-shuttle-board · 09-events-week · 10-emergency-info — all ⬜

### high-school (9) — `hs/`
ath-broadcast · ath-gameday · ath-standings · caf-counter · caf-market · class-nownext · class-subday · hall-bulletin · hall-wayfinder — all ⬜

### fitness (1) — `fitness/`
01-stadium — ⬜

---

## B. React system presets (~90) — `apps/api/src/templates/system-presets.ts`
Reviewed when we reach them (need the app to render in context). Families:
- **Animated school set:** Welcome ( MS/HS/Elem ), Cafeteria (MS/HS/Chalkboard/Foodtruck/Elem), Bus Board, Main Entrance, Hallway Schedule, Bell Schedule, Morning News, Achievement Showcase (+ portrait variants of each)
- **Paper-craft set:** Scrapbook (Hallway/Caf), Storybook (Hallway/Caf), Bulletin Board (Hallway/Caf) (+ portraits)
- **Themed set:** Arcade, Atlas, Field Notes, Greenhouse, Homeroom, Paper, Playlist, Studio, Blueprint, Terminal, Transit, Gallery, Yearbook, Zine, Varsity, Broadcast (+ portraits)
- **Sports:** Main Scoreboard, Quick Scoreboard, Main Ribbon, Main Scorebug, Scoreboard HS/College/Pro
- **Holiday (12):** Halloween / Thanksgiving / Christmas / Easter × Elem/MS/HS
- **Sandbox:** Rainbow Welcome (test)

## C. Widget components (~50 files, ~60 widget types) — `apps/web/src/components/widgets/`
Fixed alongside whichever template renders them. Key families: Animated*Widget (school), Scrapbook/Storybook/Bulletin*, Holiday, MusicPlayer, HouseAdsBanner, Streaming, Decoration; sub-dirs `bar/ fitness/ hs/ ms/ restaurant/ retail/ sports/ themes/ v2/`; registry in `variants-register.ts`.

---

## Decisions / notes log
- 2026-06-01: Loop kicked off. Live render via `venue-os.app` (both `venue-os.app` and `educms-five.vercel.app` serve; venue-os.app is canonical per brand.ts). Starting with QSR Domino's board.
- 2026-06-01: **Domino's board (#1) fix pass** — still 👀 pending Greg's final eyeball, but these landed:
  - POS feed wired (`posSync:true` on the Scene zone) → board pulls live per-location prices/86 when a POS is connected; static copy otherwise. (`1892d09`)
  - Hero photo swapped crustless close-up → real Domino's pepperoni (S_PIZZA). (`235d376`)
  - 4 specialty cards → real Domino's product photos: ExtravaganZZa S_ZZ / MeatZZa S_MX / Pacific Veggie S_PIZPV / Buffalo Chicken S_BUFC. Credited Domino's-IP, pilot-demo-only in CREDITS.txt. (`a3d0871`)
  - Editor UX (`39b9827`): (1) collapse the "industry template" dropdown into a one-line "Template: … · Change" disclosure once a template is chosen; (2) suppress the full-canvas zone's selection ring + resize handles (was double-circling the canvas edge); (3) **click-to-locate** — focus/click a field or image row in the Properties panel → that element flashes (cyan→red) in the board iframe via a new `educms-highlight` postMessage handler. Flash verified in Chromium AND WebKit.
  - **Follow-ups:** hero "top-down" angle is Greg's call (Domino's CDN has no overhead shot — all 3/4 angle). `educms-highlight` shim handler currently only on the Domino's board; roll it into the other 30 menu-feed (V5) templates + reconcile the stale `inject-shim-v2.cjs` (V3) as part of #198. Live-builder visuals for the dropdown-collapse + double-ring fixes need an authed eyeball (can't screenshot an authed route from here).
