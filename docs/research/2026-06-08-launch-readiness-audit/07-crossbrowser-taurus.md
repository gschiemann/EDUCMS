# Cross-Browser / Chromium-83 (Taurus) / WebKit-Safari Audit — VenueOS (EDU CMS)

**Date:** 2026-06-08 · Read-only · player/widget + EXTERNAL_HTML boards · Agent: aa4ffaaf732dd2f2e

## Summary

**No NEW regression will break a real LED wall or a Safari customer this week.** The recurring `inset`-shorthand killer is fully contained (zero real regressions on player/widget paths; the prior `high-school-athletics.tsx inset-[4%]` P1 is fixed and now caught by the gate's `insetTw` pattern). The load-bearing player `EmergencyOverlay` is 100% clean of every Chromium-83 trap, and the WebKit-killer (literal-LF-in-regex) is **absent from all 117 EXTERNAL_HTML boards and the shim**.

**Two structural gaps remain that ship degraded (not fatal) pixels to a Taurus today** (pre-existing, baseline-frozen debt):
1. **The taurus-safety CI gate does not scan `apps/web/public/templates/**`** — the 117 EXTERNAL_HTML boards (which render in iframes ON THE PLAYER, `player/page.tsx:4428`) are unguarded. 40 boards use `color-mix()`/`oklch()` (declaration *dropped* on 83), 31 `text-wrap:balance`, 27 `backdrop-filter`, 19 `aspect-ratio`. The **9 new K-12 boards** (commit 90be6ff6, new `school/` subdir) are the freshest instance.
2. **The React-widget baseline tracks a large frozen Chromium-83 debt** that ships to the player: 1196 `gap`, 1037 cq-units (~815 inside `clamp()` → whole declaration invalid on 83), 31 `backdrop-filter`. Gate is GREEN and only blocks *new* additions — not proof existing widgets render on a real Taurus.

The `backdrop-filter` solid-bg fallback (prior "unverified" P1) is **verified PRESENT** — every sampled site carries an `rgba()`/gradient `background` on the same rule.

## inset sweep
`grep -rnE 'inset:[[:space:]]*0|inset(-x|-y)?-[0-9]|inset-\[' apps/web/src/components/widgets apps/web/src/app/player apps/web/src/components/player`
**Real regressions: 0.** Every hit is a comment, the player/layout remediation `<style>` block, or an intentional dual-declaration (KioskSplash.tsx:1055/1125/1134/1159/1272, player/page.tsx:7678). The prior `high-school-athletics.tsx:37 inset-[4%]` is **GONE**; the gate now has `insetTw: /\binset-(?:x-|y-)?(?:px|\d|\[)/g` catching the bracket form.

## aspect-ratio sweep
**On the React-widget surface: 0 live uses of the `aspect-ratio` property.** All 16 hits are comments documenting removal, or `aspect-square` class refs. The 12 prior-named widgets were all remediated to explicit-px/padding-hack boxes (Cafeteria ×4, AnimatedWelcome ×4, RetailProductGrid, MsStudio, sports/v2 confirmed clean). Live `aspect-ratio` survives ONLY in the EXTERNAL_HTML boards (19 boards — see below).

## Other Chromium-83 traps (player/widget React paths)

| Trap | Support | Count (live) | Fallback? |
|---|---|---|---|
| flex `gap` | 84+ | ~1196 `gap:` (many on flex, e.g. MsStudioWidget.tsx:707-912) | **NO** — collapse to 0 on 83. EmergencyOverlay uses negative-margin instead (clean) |
| container-query units (cqh/cqw/cqi/cqmin) | 105+ | ~1037 (~815 in clamp, ~151 bare) | **PARTIAL** — invalid cqh term makes whole `clamp()` invalid → property unset on 83. Bare (lobby-welcome.tsx:23) compute to 0 |
| backdrop-filter / backdrop-blur-* | 76+ (flaky <88) | 31+9 | **YES** — verified solid rgba()/gradient bg on same rule. Prior "unverified" → OK |
| :has() | 105+ | 1 | tracked, low blast |
| color-mix() | 111+ | 2 (React src) | globals.css @supports fallback |
| oklch() | 111+ | 0 live (2 comments) | @supports fallback |
| text-wrap: balance | 114+ | 0 live (8 MS widgets show "dropped" comments) | **fixed** — prior P1 resolved |
| 100vh | — | 16 | **YES** — player/layout.tsx:134 pins documentElement height |
| inset-inline/inset-block | 87+ | 0 | clean |

## EXTERNAL_HTML board spot-check (117 boards, render on the player)
- **WebKit-parse risk (LF-in-regex): NONE.** Python scan for regex literals with a raw LF returned 0 across all 117 boards; the injected shim + kiosk `_edit-shim.js` emit only single-line regexes. WebKit-safe.
- **Chromium-83 CSS in baked boards (UNGUARDED — gate doesn't scan here):** `gap:` 117/117; `color-mix()`/`oklch()` **40 boards** (dropped on 83); `text-wrap:balance` 31; `backdrop-filter` 27; `aspect-ratio` 19; `:has()`/`@container`/cq-units 0 (good).
- **9 new K-12 `school/` boards (90be6ff6):** `elem-lunch-v1` 11× color-mix (lines 32-87, no fallback) + aspect-ratio:1/1 (`.hero .burst:79`, has explicit width so width survives, height collapses); `elem-lunch-v2/v3`, `elem-schedule-v2`, `ms-lobby-v1/v2/v3` 1-10× color-mix each; `ms-lobby` 2× text-wrap:balance each. **Degraded but legible** (core text uses solid var() colors).
- **Holiday boards (separate path, 50):** 39 color-mix, 6 backdrop-filter, 1 aspect-ratio. holiday-bridge.cjs tests WebKit *parse*, not Chromium-83 *render* — so the color-mix degradation is unguarded.

## WebKit smoke coverage gaps
- **Prior "17 new families untested" P1 → FIXED.** `widget-render.spec.ts` added one rep per family (Bulletin, Scrapbook, Storybook, HS pack, MS pack) in `[chromium, webkit]` matrix via `cross-browser.yml → webkit-widget-render`. Sports celebration pack COVERED (`celebrations-bridge.cjs` + scorebug).
- **Remaining gaps:** (1) EXTERNAL_HTML boards have NO per-board WebKit/Chromium-83 paint canary (only holiday/celebrations/kiosk-shim exist); the 9 new school boards appear only in a perf spec. (2) No Chromium-83-emulation test anywhere — all "Taurus safety" is static grep; WebKit ≠ Chromium 83, so the WebKit job does NOT catch gap/cqh/color-mix collapse.

## taurus-safety CI gate assessment
`apps/web/tools/check-taurus-safety.cjs` (GREEN, 171 files).
**Catches:** `gap:` CSS + `gap-N` TW, cqUnits, backdrop-blur/filter, text-wrap:balance, color-mix(, :has(, aspect-ratio:, oklch(, inset: CSS, **and `inset-[`/`inset-N` TW** (closes the 2026-05-13/19 miss). Strips comments. Baseline-ratchet per-file.
**Misses:** (1) **does not scan `public/templates/**`** — the 117 player-rendered boards are unguarded (biggest gap); (2) doesn't distinguish flex gap from grid gap (baseline overstates safety); (3) baseline is frozen-debt amnesty, not clean state; (4) can't detect missing solid-bg fallback on backdrop.

## Findings ranked

### P1-1 — taurus-safety gate blind spot: 117 EXTERNAL_HTML boards (player-rendered) unscanned
`check-taurus-safety.cjs:28-36` SCAN_DIRS omits `public/templates`; boards render at `player/page.tsx:4428`. 40 color-mix/oklch, 31 text-wrap:balance, 27 backdrop-filter, 19 aspect-ratio. Blast radius: Taurus walls running any board lose gradients/shadows/balanced text. **Fix:** add `public/templates` (excl. `kiosk/_edit-shim.js`) to SCAN_DIRS with an HTML-aware variant; baseline + ratchet. At minimum scan color-mix/aspect-ratio (whole-declaration drops).

### P1-2 — 9 new K-12 `school/` boards ship color-mix/aspect-ratio/text-wrap:balance with no fallback
`school/elem-lunch-v1.html:32-87` (11× color-mix), `:79` aspect-ratio; `ms-lobby-v1/v2/v3.html` color-mix + 2× text-wrap:balance. **Fix:** solid-color fallback declaration BEFORE each `color-mix()` (`background:#fff6dd; background:linear-gradient(...color-mix())`); drop `text-wrap:balance`; give `.hero .burst` explicit `height`.

### P1-3 — EXTERNAL_HTML boards have no per-board WebKit (or Chromium-83) paint canary
`tests/cross-browser/` covers only holiday/celebrations/kiosk-shim/prod-smoke; the 117 boards get no render check; new school boards only in a perf spec. Blast radius: a future LF-in-regex or malformed baked CSS ships uncaught — the exact 2026-05-09 gap. **Fix:** extend the WebKit canary to load each board in an iframe, assert `educms-ready` + non-zero body box. One rep per subdir + all 9 school boards.

### P2-1 — Large frozen Chromium-83 debt in React widgets (flex gap, cqh-in-clamp)
baseline gap=1196 / cq=1037; MsStudioWidget.tsx:707-912 (flex gap), lobby-welcome.tsx:23-127 (bare cqh/cqi), reachable from WidgetRenderer/variants-register. **Fix:** flex gap → per-child margin; `clamp(px,Ncqh,px)` → drop cqh term (rely on transform:scale) or `@supports (height:1cqh)` progressive enhancement. Real work — schedule, verify on Chromium-83 emulation.

### P2-2 — 39 holiday boards use color-mix() with no fallback; WebKit test doesn't catch it. Same solid-fallback-first pattern as P1-2.

### P3-1 — No actual old-Chromium render test exists (all static grep). Consider a periodic Playwright run pinned to old Chromium for top-10 player templates. Low urgency.
### P3-2 — taurus-safety baseline overstates safety (conflates safe grid gap with breaking flex gap). Document that the number is a ratchet, not a clean-state assertion.

**Net:** recurring high-severity killers (inset, LF-in-regex, emergency-surface traps, aspect-ratio/text-wrap on React widgets) all closed and gated. Open exposure: the 117 EXTERNAL_HTML boards rendering on the player with zero taurus-safety scanning (P1-1/2/3) + frozen React debt (P2-1) — all pre-existing, degraded-not-fatal, none a new this-week regression.
