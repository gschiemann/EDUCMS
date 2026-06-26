# Wave F — Cross-browser + Taurus (§15)

**Agent:** F1 · Cross-browser + NovaStar-Taurus-floor pre-launch confirmation pass
**Date:** 2026-06-26
**HEAD audited:** `06038352ce8242cb37d4d655a7d3471de59f10c2` (master)
**Mode:** READ-ONLY. Read/Grep/perl + curl against live prod. No source edits. No `pnpm dev/build/Playwright`.

## Surface + scale tier + Standard Audit Surface §§ covered

- **Surface:** Every player-shipped rendering surface — React widgets (`apps/web/src/components/widgets`), the player route (`apps/web/src/app/player`, `apps/web/src/components/player`), the sports board/ribbon/scorebug routes, the ~131 EXTERNAL_HTML signage/kiosk/hs boards (`apps/web/public/templates`), and the 50 holiday templates (`apps/web/public/holiday-templates`). Plus the authed dashboard's WebKit client-side-nav crash class.
- **Scale tier:** Taurus = the **Chromium-83 NovaStar LED floor** (worst-case; live water-polo LED is 960×1080). Plus the modern-browser matrix (Safari/WebKit, Chrome, Firefox, Edge).
- **Standard Audit Surface §§:** **§15 (Cross-browser + Chromium-83)** primary. Touches **§17 (operational/DX — CI gates)** and **§1/§2 (player-rendered emergency + content surfaces)** at the edges.

## Step-by-step what I did

1. Confirmed tree state: on `master`, HEAD `06038352`, only untracked `docs/` + `scripts/beta/` dirs dirty (no source contention).
2. **Taurus trap grep (scope item 1)** — ran the CLAUDE.md grep `grep -rnE 'inset:\s*0|inset(-x|-y)?-[0-9]'` over `widgets` + `app/player` + `components/player`. 15 hits, **every one** either a code comment referencing the rule, an intentional callsite that declares BOTH shorthand AND the four longhand sides on the same line (KioskSplash 5×, player/page.tsx:7718), or the player/layout.tsx CSS safety-net shim. Zero bare `inset:0`.
3. Read the **taurus-safety CI gate** (`apps/web/tools/check-taurus-safety.cjs`) — it is a baseline-ratchet scanner covering ALL traps in scope: `gap` (CSS + Tailwind `gap-N`), `cqUnits`, `backdrop-blur`/`backdrop-filter`, `text-wrap:balance`, `color-mix(`, `:has(`, `aspect-ratio`, `oklch(`, `inset` (CSS + Tailwind `inset-*`/`inset-[…]`). Scans `widgets/player/board/ribbon/scorebug` PLUS the EXTERNAL_HTML boards (inset-only). Ran it locally: **`OK — 171 files · gap=1196 cq=1037 (within baseline)`** → working tree has NOT regressed.
4. **WebKit head-node crash class (scope item 2)** — grepped all `.remove()`/`removeChild`/`parentNode` in `apps/web/src`. 13 hits; every one removes a **self-created** throwaway element (download `<a>`, clipboard `<textarea>`, flex-probe `<div>`) — none touch React-owned nodes. Read `BrandStyleInjector.tsx` (the 2026-06-08 favicon-fire culprit): the fix is in place — `setBrandFavicon` now **mutates other icon links in place** via `setAttribute('href', …)` instead of `.remove()`, with an explicit comment documenting the WebKit crash class. Verified no `querySelector('link|meta|title|icon').remove()` anywhere.
5. **Holiday-bridge regex-LF class (scope item 3, the 2026-05-09 Safari fire)** — perl heuristic for a raw LF byte inside a `/…/` regex literal in inline `<script>` blocks, across ALL 50 holiday templates AND all 131 EXTERNAL_HTML boards: **0 suspects**. Confirmed 49/50 holiday templates carry the bridge (only `_overhaul-gallery.html` doesn't — it's a gallery index, not a player board). Confirmed 0/131 EXTERNAL_HTML boards missing the click-to-edit shim (the 2026-06-07 invariant holds).
6. **CI wiring + green (scope item 4)** — both `Cross-Browser` (webkit-holiday-bridge + webkit-widget-render) and `Prod Smoke` (webkit-nav job) are wired on push-to-master + PR and **green on HEAD**. `webkit-nav-smoke.cjs` is committed (last touch `8d32390a`). The holiday-bridge test actually *executes* each bridge in a real WebKit engine (step 1 = `holiday:ready` fires) — so green CI is positive proof the regex-LF class can't be present in the 18 tested templates.
7. **Live prod verification** — API health on same commit `06038352` (db+redis ok). Curled live holiday template (`es-christmas.html` → 200, 23 bridge markers, 0 regex-LF), live HS board (`hs/achievement.html` → 200, shim present, 0 inset), live signage board (`signage/corporate/09-events-week.html` → 200, shim present, 0 inset, 0 regex-LF), live kiosk board (`kiosk/bar-jukebox.html` → 200, `_edit-shim` ref present).
8. **Runtime Taurus mitigation** — confirmed `apps/web/src/app/player/page.tsx` imports AND invokes `applyFlexGapPolyfill()` + `applyCqUnitPolyfill()` (both feature-detected no-ops on modern engines; convert gap→margin / cq→px on Chromium <84/<105 at runtime; re-run every 2500ms for template swaps; try/catch so they never break playback). KioskSplash renders under the player route → polyfill covers its flex gaps.
9. Confirmed all 10 CI workflows green on HEAD.

## Findings table

| # | Sev | area | what | repro | evidence |
|---|-----|------|------|-------|----------|
| 1 | **P2** | CI coverage gap (holiday) | The `Cross-Browser` holiday-bridge WebKit test only enumerates the **18 base** holiday templates; the **31 variants** (`*-v2`, `*-flagship`, `*-portrait`) + `_overhaul-gallery` ship to the same player but are **not in the test's `TEMPLATES` array** → a WebKit-fatal regression in a variant would not be caught by CI. (Static re-verify shows all 31 are currently clean — 0 regex-LF, all carry the bridge — so this is a *coverage* gap, not a live defect.) | `ls apps/web/public/holiday-templates/*.html` = 50; `grep TEMPLATES apps/web/tests/cross-browser/holiday-bridge.cjs` lists 18 | holiday-bridge.cjs:46-50 (TEMPLATES array); 31 untested files enumerated in step 5 |
| 2 | **P2** | code hygiene (Taurus) | `KioskSplash.tsx` still carries **21 flex `gap`** + 4 `backdrop-filter` + 7 `inset` declarations (tracked in the baseline, task #129 "Taurus-safe rewrite" still PENDING). **Mitigated at runtime** by `applyFlexGapPolyfill()`/`applyCqUnitPolyfill()` + the player/layout.tsx inset CSS shim, so it does NOT brick the splash on Taurus — but it is the one player-chrome file relying on the runtime fallback rather than source-clean longhand. | `grep -nE 'gap:' apps/web/src/components/player/KioskSplash.tsx` | KioskSplash.tsx:775,817,887,1207,1231…; baseline shows `"KioskSplash.tsx": {gap:21, backdropFilter:4, insetCss:7}`; polyfill at player/page.tsx:1480-1485 |

**No P0. No P1. No NEW Taurus violation. No NEW WebKit violation.** Both findings are P2 (coverage/hygiene), neither is a live break on real hardware.

## Re-verification of the prior-audit high-severity classes (all CLOSED)

- **Taurus `inset` collapse** (2026-05-13/-19, P0-8 inset-[4%]) — CLOSED. Source is longhand; `insetTw` + `insetCss` patterns in the gate; player/layout.tsx CSS shim is a second net; live boards serve `inset:0`.
- **Taurus flex-gap** — CLOSED via runtime polyfill (feature-detected, idempotent, re-applied on template swap) + gate ratchet + margin-in-new-code convention.
- **WebKit favicon/head `removeChild` crash** (2026-06-08, fix `ddb64dab`) — CLOSED. `BrandStyleInjector.setBrandFavicon` mutates-in-place; no `.remove()` on any React-owned head node anywhere in `apps/web/src`.
- **Holiday-bridge regex-LF SyntaxError** (2026-05-09) — CLOSED. 0 suspects across 50 holiday + 131 EXTERNAL_HTML boards; WebKit CI executes the bridge (not just static-checks it).
- **EXTERNAL_HTML click-to-edit shim** (2026-06-07 invariant) — CLOSED. 0/131 boards missing the shim.

## Coverage — what I could NOT reach + why

- **Did not run Playwright in WebKit myself** (ground-rule: no `pnpm build`/Playwright). Compensated by (a) reading the CI test that does, (b) confirming it's green on HEAD, (c) static regex-LF/shim sweeps, (d) live curl of served bytes. The bridge test *executing* in WebKit on green CI is stronger evidence than a one-off local run.
- **Did not render on physical Taurus glass.** No hardware access from this sandbox. The live water-polo LED is the operator's, off-limits. Relied on the gate + runtime polyfill + live-served-byte inspection.
- **Firefox/Edge** are not in CI (CLAUDE.md policy intentionally keeps the WebKit canary as the high-leverage check; Chromium/Edge share the engine with Chrome which is always green). Not a gap per the documented policy.

## Grade per Greg's 3 lenses

- **DESIGN: A** — defense-in-depth is genuinely best-in-class: source convention + baseline-ratchet CI gate (board HTML included) + runtime feature-detected polyfills + a CSS attribute-selector safety net, each documented with the incident it prevents.
- **UX: A** — the operator never sees the Taurus floor: polyfills are silent no-ops on modern engines and auto-repair on the LED; the favicon fix removed the "every menu click needs two clicks" WebKit reload.
- **FUNCTIONALITY: A−** — all four high-severity classes are closed and green in prod; the only deductions are the two P2s (31 holiday variants outside the WebKit test enumeration; KioskSplash relying on the runtime polyfill rather than source-clean longhand). Neither is launch-blocking.

**Launch verdict for §15: GO.**
