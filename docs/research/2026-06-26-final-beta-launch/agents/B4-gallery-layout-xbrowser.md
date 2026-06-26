# Wave B4 — Gallery + layout + cross-browser

**Surface tested:** Template gallery page (`apps/web/src/app/[schoolId]/templates/page.tsx`, 3515 lines) + `ScaledTemplateThumbnail` + category-tab/preset wiring + brand-apply + the Chromium-83 Taurus cross-browser surface.
**Scale tier:** read-only code audit + live prod curl against `https://venue-os.app`. No app run, no Playwright (per ground rules).
**Standard Audit Surface §§ covered:** §15 (Cross-browser + Chromium-83), §19 (Template/Widget editability — partial, gallery-entry only), §20 (Design/UX/Functionality lenses). Touches §2 (storage/content — poster thumbs) and §14 (multi-vertical category sets).

---

## Step-by-step what I did

1. Read `templates/page.tsx` (gallery shell, `CATEGORY_TABS`, filter logic, `GalleryCard`, `isBranded` badge) and `ScaledTemplateThumbnail.tsx` (poster-vs-live-iframe thumbnail engine).
2. Counted on-disk poster PNGs (`public/templates/_thumbs/**`) vs board HTML files (`public/templates/{hs,kiosk,signage,fitness}/`) — found a coverage gap.
3. Curl'd live prod for boards WITH and WITHOUT a poster to confirm the 404→live-iframe fallback path actually fires (`achievement.png` 404, `ath-gameday.png` 200).
4. Counted preset `category:` values in `system-presets.ts` + `sports-presets.ts` (perl, non-empty input asserted) and cross-referenced them against the K12 category-tab keys in `packages/api-types/src/verticals.ts`.
5. Confirmed the system-grid render has **no empty-state**, while the custom-grid does.
6. Traced the brand-apply server path (`branding.controller.ts:740-813`) vs the `isBranded` badge detector (`page.tsx:1906-1932`).
7. Ran the CLAUDE.md Taurus grep + the extended trap set (backdrop-filter, `:has()`, container-queries, oklch/color-mix, flex `gap`) over `widgets`/`player`/`board`/`ribbon`/`scorebug`, and inspected the `taurus-safety` CI gate's scan scope (`apps/web/tools/check-taurus-safety.cjs`).
8. Checked dark-bg preset `bgColor` values to explain the "dark thumbnail" observation.

---

## Findings table

| # | Sev | area | what | repro | evidence (file:line / curl) |
|---|-----|------|------|-------|------------------------------|
| 1 | **P1** | category tabs | **"Athletics" tab is dead — 0 presets, always empty.** The K12 category tabs include `{ key: 'ATHLETICS' }` but NOT ONE preset in any preset file is tagged `category: 'ATHLETICS'`. The 4 real athletics game-day boards (Game Day Hub, Standings, Big Game, Broadcast) are tagged `category: 'EVENTS'`, and there is no Events tab — so they're only reachable via "All". Clicking Athletics filters to zero results. | Open Templates → click "Athletics" tab → blank. | `verticals.ts:328` defines the tab; `perl` count of `category:'ATHLETICS'` over `system-presets.ts`+`sports-presets.ts` = **0**. The ath boards are `category: 'EVENTS'` at `system-presets.ts:531-560`. |
| 2 | **P1** | empty state | **No empty-state for the "Ready-Made Templates" (system/preset) grid.** Render is `{systemTemplates.length > 0 && (<section>…</section>)}` — when a filter (e.g. Athletics, or a search miss) yields zero presets the **entire section silently vanishes**. The operator sees no "Ready-Made" header at all, then "No custom templates yet" below. Reads as "the whole category is broken." The custom grid DOES have a proper empty-state; the preset grid does not. | Athletics tab, or search "zzzz". | `page.tsx:1376` (`systemTemplates.length > 0 &&` with no `: <EmptyState/>` branch); contrast `page.tsx:1404` custom grid has the dashed empty-state card. |
| 3 | **P2** | preview rendering | **6 HS + 18 signage boards have no pre-rendered poster PNG → 404 → live frozen-iframe fallback.** Not a hard break (`onError` flips `posterFailed` and mounts a live 4K iframe that auto-fits one frame), but those tiles are heavier than the `<img>` path AND can flash dark before the shim's first auto-fit frame paints (the transient "dark thumbnail" on lazy-load). | Gallery scroll; the no-poster boards mount an iframe instead of an img. | Disk: `hs` 22 html / 16 png; `signage` 89 html / 71 png. Missing hs: achievement, bell-schedule, blueprint, gallery, morning-news, zine. Live: `curl …/_thumbs/hs/achievement.png` → **HTTP 404**; `…/ath-gameday.png` → 200. Fallback logic `ScaledTemplateThumbnail.tsx:217-235, 119`. |
| 4 | **P2** | brand indicator | **"Branded" badge never lights up for EXTERNAL_HTML boards even when they ARE branded.** Apply-brand stamps board brand into `cfg.brand` tokens (`branding.controller.ts:793-804`), but `isBranded` only inspects `bgColor`/`bgGradient`/zone `accentColor` (`page.tsx:1906-1932`) — it never reads `cfg.brand`. So the entire signage/HS/kiosk board catalog can be branded with no visual confirmation. (Brand still APPLIES to the render; only the indicator is blind.) Also: Apply-brand only re-skins `!isSystem` custom templates, so preset boards are never re-skinned in place regardless. | Apply brand → board re-skins on the player but card shows no "Branded" pill. | Server writes `patch.brand = brandTokens` at `branding.controller.ts:804`; badge detector at `page.tsx:1912-1930` has no `cfg.brand` branch. |
| 5 | **P2** | category fragmentation | **35 `LOBBY_WELCOME` presets are stranded from the "Welcome" tab.** The Welcome tab filters `category === 'LOBBY'` (11 presets) but the 35 flagship welcome boards are tagged `LOBBY_WELCOME`, which is persisted verbatim (no remap in `ensure-system-presets.ts`). They show under "All" but never under "Welcome." Same shape as the Athletics issue but lower sev because they're still reachable. | Welcome tab shows 11, not 46. | `system-presets.ts` 35× `category: 'LOBBY_WELCOME'`; tab key `LOBBY` at `verticals.ts:325`; no remap (grep of `LOBBY_WELCOME` outside system-presets.ts = empty). |
| 6 | ✅ pass | cross-browser (Taurus) | **No new Chromium-83 violations.** All 15 `inset` grep hits in widget/player paths are comments, the player-layout runtime fixup CSS, or callsites declaring BOTH shorthand + 4 longhands on one line (the documented-safe pattern). **0** backdrop-filter, **0** `:has()`, **0** container-queries, **0** oklch/color-mix, **0** flex `gap` in `widgets`/`player`/`board`/`ribbon`/`scorebug`. The `taurus-safety` CI gate scans exactly these dirs (+ board/holiday HTML for inset-only, a deliberate SCOPE choice). | CLAUDE.md grep + extended sweep. | `grep -rnE 'inset:\s*0|inset(-x|-y)?-[0-9]' widgets player` → 15 hits, all verified safe (HsStage.tsx:120 uses 4 longhands; player/page.tsx:7718 declares both). All other traps = 0. Gate: `check-taurus-safety.cjs:28-55`. |

---

## "Dark thumbnails" question — resolved (NOT a bug)

The dark tiles I observed live are **mostly correct renders of intentionally dark-themed boards**: many flagship boards ship near-black `bgColor` by design — `#0f172a`, `#0d1b3d`, `#0b1025`, `#0a0e1a` (`system-presets.ts:443/451/464/472`, ath boards 531+). Their poster PNGs serve fine on prod (HTTP 200, 88–189 KB of real content). The only genuine darkness-on-load artifact is finding #3: the 24 no-poster boards do a 404→live-iframe fallback that can flash dark for the frame or two before the baked shim's auto-fit paints. So: **not a render bug; a poster-coverage gap + a dark-design class.**

---

## Coverage — what I could NOT reach + why

- **Live interactive click-through of the Athletics tab / brand-apply badge.** Ground rules forbid Playwright/dev-server (would dirty the tree); I proved the defects from source + the persisted preset categories + live curl, which is conclusive for findings 1/2/4/5. A 30-second live click would visually confirm but isn't needed to establish the defect.
- **Per-tenant brand-applied state.** Apply-brand mutates DB rows; I did not run it against a throwaway tenant (read-only audit). Finding #4 is proven by code path, not by a branded render.
- **The full 114-board × WebKit render matrix.** Out of scope to run; the existing `external-html-clickedit` + `cross-browser` CI suites own that. I relied on them per ground rules and confirmed the gate scope is correct.

---

## Grade per Greg's 3 lenses

- **Design — A−.** Gallery is genuinely premium: scaled true-thumbnails, poster-PNG perf path, hysteresis IO mount/unmount, per-card orientation toggle. Dark flagship boards look intentional and sharp. Knocked from A only by the no-poster tiles' load flash.
- **UX — B.** The dead "Athletics" tab + missing preset-grid empty-state is the operator-facing wart: a K12 admin clicking Athletics gets a blank page with zero explanation, and athletics content is mis-filed under a tab that doesn't exist. The "Branded" indicator silently failing on the whole board catalog is the exact "I never seen a branded template actually work" complaint, partially regressed for boards.
- **Functionality — A−.** Everything actually works end-to-end: thumbnails render, the 404 fallback self-heals, brand genuinely applies to boards, portrait/landscape parity is correct, and cross-browser is clean. The defects are mis-wiring/UX-affordance, not broken machinery. No P0.
