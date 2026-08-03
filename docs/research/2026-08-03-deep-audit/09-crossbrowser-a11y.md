# §15 Cross-browser + §18 a11y audit — 2026-08-03

Read-only. Detectors verified write-free before running (`check-inset-serialization.cjs`, `check-brand-contrast.cjs` — no fs writes; `check-taurus-safety.cjs` writes only under the `baseline` argv, ran in `check` mode). No Playwright/Jest/build/install executed.

> **Lead reconciliation (2026-08-03, post-report):** the chromium pin in F-2 landed in commit `91702ef7` (bundled with a serviceWorker fix) **during this audit**. Master moved `a74c7894` → `ffddbdc4` mid-pass. F-2 is therefore an **active regression on master**, not a pending change. The agent's commit attribution was correct.

## Coverage table

| Bullet | Status | D | UX | F | Note |
|---|---|---|---|---|---|
| **§15** Safari/WebKit — every customer-facing surface | covered | A | A- | **B-** | Holiday bridge + celebrations + kiosk-shim + widget-render + emergency-path all run WebKit in CI. But the EXTERNAL_HTML board specs lost WebKit today (F-2). |
| §15 Chromium-83 (Taurus) — every player-shipped surface | covered | A | A | **C+** | Gate + AST detector + 2 runtime polyfills, all blocking. Polyfills mount on `/player` only; `/board` `/ribbon` `/scorebug` unpolyfilled (F-1). |
| §15 Tailwind/CSS class sweep (gap, inset, backdrop-blur, :has, container-type, oklch, color-mix, aspect-ratio, text-wrap-balance) | covered | A | A | A- | 11 pattern classes in `check-taurus-safety.cjs:60-118`; `:has`/`oklch`/`color-mix`/`aspect-ratio`/`text-wrap-balance`/`insetTw` all **0** in player/widget src. `globals.css` carries `@supports` fallbacks (`:202`, `:409`, `:490`). |
| §15 CI baseline ratchet DOWN-only | covered | A | A | A | Taurus baseline ratchets down (`check-taurus-safety.cjs:14-16, 209-216`); axe warning baseline down-only (`a11y-warning-baseline.json`); Playwright collection floor ≥30 (`ci.yml:381-390`). All blocking. |
| §15 Per-template WebKit smoke (not just 18 holiday) | **deferred / regressed** | B | B | **D** | WebKit board coverage = the 18 holiday templates in `holiday-bridge.cjs` only. The 193 `public/templates` boards had a Chromium-only pass; that pass is now the *only* one and the CLAUDE.md-prescribed WebKit run is gone (F-2). |
| §15 Older Android System WebView (kiosk APK) | covered | — | — | B+ | `minSdk = 24` / `targetSdk = 34` (`apps/player/app/build.gradle.kts:15-16`). Renderer-crash + network recovery handled (`SafePlayerWebViewClient.kt`, `NetworkRecoveryController.kt`). |
| **§18** axe-core CI baseline | covered w/ gap | A | A | **C** | `a11y.yml` blocking on push+PR, 10 routes, WCAG 2.0/2.1 A+AA, 0 errors / 1 warning. **Unauthenticated** — 6 of 10 routes render the login shell (F-4). |
| §18 SR live regions on emergency surfaces | covered | A | A | A | `EmergencyLiveRegion.tsx` (`role=status` + `aria-live=assertive` + `aria-atomic` + Web Speech), mounted on both desktop surfaces; `/panic` has its own (`panic/page.tsx:342-351`). |
| §18 aria-live on hold-to-trigger | covered | A | A | A | `panic/page.tsx:580-584` — `onKeyDown` + `aria-label` naming the 3-second hold; 7 lifecycle `announce()` calls (`:159, :196, :253, :302, :331, :337`). |
| §18 Keyboard-only navigation | partial | B | B- | **C** | jsx-a11y gate blocking but frozen at **221** errors (`.a11y-baseline`); 75 non-interactive `onClick` tags lack any keyboard affordance (F-7). |
| §18 Color-blind-safe fleet-map pins | covered | A | A | A | `ScreenMap.tsx:190-198` — distinct Lucide shape per status + `role="img" aria-label`; WCAG 1.4.1 cited in-code; Emergency owns red, Offline slate. |
| §18 Contrast on brand-injected palettes | covered (chrome) | A | A | B | `check-brand-contrast.cjs` blocking in `deploy-reliability.yml:244`; 17/17 assertions green, ≥4.5:1 vs white (symmetric ⇒ covers ink-on-primary). Player/board surfaces not asserted (see Unverified). |
| §18 Focus management in modals/sheets | partial | A- | B | B- | `sheet.tsx` delegates to Base UI Dialog (trap/restore/Esc built in). Hand-rolled `app-dialog.tsx` has `role=dialog` + `aria-modal` + Escape + initial focus + arrow-key nav, but **no focus trap and no restore** (F-10). |
| §18 prefers-reduced-motion | **deferred** | B | C | **D** | Global clamp in `globals.css:517-526` covers the dashboard, but cannot reach the null-origin sandboxed board iframes: 4/193 templates, **0/50** holiday boards honor it while 152 boards ship `@keyframes` (F-5). |

## Findings

**[P1] `/board`, `/ribbon`, `/scorebug` render Taurus-bound widget code with neither Chromium-83 polyfill mounted — NEW**
Evidence: `apps/web/src/lib/flex-gap-polyfill.ts` and `cq-unit-polyfill.ts` are imported and invoked in exactly one place — `apps/web/src/app/player/page.tsx:39-40` and `:2288-2289`. Two independent methods (import-graph grep across `apps/web/src`; per-file grep of the three route `layout.tsx`/`page.tsx`) return zero polyfill references under `app/board`, `app/ribbon`, `app/scorebug`, `app/overlay`. Those routes import the shared widget tree — `board/[gameId]/page.tsx:28,52,61` pulls `widgets/v2/_shared/sports-situational`, `widgets/sports/SwimDiveWidgets`, `widgets/v2/CelebrationsOtherSportsWidgets`. The taurus baseline attributes **gap=1171, cqUnits=1037** to `components/widgets`, and `check-taurus-safety.cjs:33-36` declares these routes in-scope: *"Lane-6 P0: sports surfaces also render on Taurus."*
Impact: on a Chromium-83 LED wall, a scoreboard reached via the standalone `/board/:gameId` URL loses every flex gap (children butt together) and every `clamp(…, Ncqmin, …)` (declaration dropped → text collapses) — exactly the failure class the player polyfills exist to prevent. `/player` is immune; the sports surfaces are not.
Fix sketch: hoist both polyfill invocations into a shared client effect (or a tiny `<TaurusPolyfills/>` mounted from `board|ribbon|scorebug/[gameId]/layout.tsx`), mirroring the player's `needsGap`/`needsCq` feature-detect + try/catch. Both are hard no-ops on modern engines, so this is zero-regression.

**[P1] WebKit coverage silently dropped for every EXTERNAL_HTML board + holiday hotzone spec — NEW**
Evidence: `ci.yml:401` runs `playwright test … --project=chromium`. Two methods confirm no other workflow picks them up: (a) grep each spec name across `.github/workflows/` → `external-html-clickedit`, `external-html-hide-field`, `holiday-hotzone`, `multiscreen-sync`, `inset-serialization-regression`, `url-asset-ledfit` all return **empty**; (b) enumerating every `playwright test` / `test:e2e*` invocation in CI yields only `ci.yml:401` (chromium-pinned), `cross-browser.yml:174` (widget-render), `emergency-path.yml:92` (matrix). The pin landed in `91702ef7` (2026-08-03, **during this audit**). The in-file justification at `ci.yml:394-400` claims *"webkit coverage is not lost — it is owned by … cross-browser.yml (widget-render + holiday bridge) and emergency-path.yml"* — true for those two specs, false for the six above. CLAUDE.md's REDESIGN INVARIANT explicitly prescribes `external-html-clickedit.spec.ts` and `holiday-hotzone.spec.ts` as **"(chromium+webkit)"**.
Impact: the shim click-to-edit protocol across ~40 boards, the holiday hotzone bridge, and the multi-screen sync harness now run on V8 only. This is the exact blind spot that let the 2026-05-09 WebKit regex-literal bug live for two months.
Fix sketch: add a second CI step running just those specs with `--project=webkit` (fast; doesn't need the 92-test full sweep), or restore the matrix for that spec subset. Keep the 30-min cap.

**[P1] Lighthouse accessibility gate is decorative — NEW**
Evidence: `apps/web/lighthouserc.json` asserts `"categories:accessibility": ["error", { "minScore": 0.95 }]` over 5 routes, but `.github/workflows/lighthouse.yml:43` sets `continue-on-error: true` on the `pnpm lhci` step. A score below 0.95 cannot turn the workflow red.
Impact: false-green. Same class as the 2026-05-31 `continue-on-error` API-Jest incident called out in `ci.yml:47-53`. Only the axe job actually blocks, and it is unauthenticated (F-4), so between them nothing enforces a11y on a signed-in page.
Fix sketch: drop `continue-on-error`, or lower `minScore` to the measured value first and ratchet up.

**[P1] axe-core CI never authenticates — the operator's real surface is unaudited — KNOWN** (authed-axe DEFERRED, 2026-07-16)
Evidence: `a11y.yml` boots `pnpm --filter web start` with no DB seed and no login; `a11y-audit.ts:44-55` lists 10 routes of which 6 are tenant-scoped (`/dashboard`, `/screens`, `/{seed}/templates`, `/{seed}/emergency/broadcast`, `/{seed}/reviews`, `/{seed}/screens?view=map`). The baseline file states it verbatim: *"the CI harness runs UNAUTHENTICATED … authed tenant routes render their login/shell state."* The template **builder** route is absent from `ROUTES` entirely.
Impact: "0 errors, 1 warning" measures ~4 public pages, not the dashboard, the builder, the fleet map, or the emergency console. Still open after two audit cycles.
Fix sketch: reuse the `PLAYWRIGHT_ADMIN_TOKEN` / `PLAYWRIGHT_TENANT_ID` secrets already wired into `ci.yml:404-406` to seed `localStorage`/cookie before `page.goto`, then re-lock the baseline and add the builder route.

**[P2] prefers-reduced-motion does not reach the animated boards — NEW**
Evidence: `globals.css:517-526` clamps `animation-duration`/`iteration-count`/`transition-duration` app-wide — but boards render in a **null-origin sandboxed iframe**, a separate document that never loads `globals.css`. In-board coverage: 4 of 193 `public/templates` boards, **0 of 50** `holiday-templates`, 1 of 225 widget files contain `prefers-reduced-motion`; 152 boards ship `@keyframes`.
Impact: WCAG 2.3.3 / vestibular risk in the operator-facing preview and gallery surfaces. (On a wall-mounted kiosk the preference is moot; the preview path is the exposure.)
Fix sketch: append a `@media (prefers-reduced-motion: reduce)` clamp to the injected shim block (`inject-shim-v2.cjs` / `_edit-shim.js`) so it lands in every board on the next injector run — one edit, 243 files.

**[P2] `<html lang>` flips to es/zh while the emergency surfaces stay hardcoded English — NEW**
Evidence: `I18nProvider.tsx:57` sets `document.documentElement.lang = LOCALE_HTML_LANG[l]` (`config.ts:31-35` → `en`/`es`/`zh-CN`), and `providers.tsx:54` mounts it at the root. `useTranslations` count is **0** in each of `app/panic/page.tsx`, `components/emergency/EmergencyTriggerModal.tsx`, `app/[schoolId]/emergency/broadcast/page.tsx`. The `announce()` strings are English literals (`panic/page.tsx:159,196,253,302,331,337`) and both speech utterances hardcode `u.lang = 'en-US'` (`panic/page.tsx:114`, `EmergencyLiveRegion.tsx:55`).
Impact: WCAG 3.1.1 failure — a Spanish-locale operator gets `lang="es"` on English text, so a screen reader applies Spanish phonemes to English words on the life-safety surface. Independently, the whole emergency console is untranslated despite es/zh shipping.
Fix sketch: route the emergency copy through `useTranslations` (correct), or set `lang="en"` on the emergency subtree until it is (cheap, honest).

**[P2] jsx-a11y baseline frozen at 221; 75 keyboard-inaccessible click targets — KNOWN** (99→221 after the 2026-07-13 false-green fix)
Evidence: `.a11y-baseline` = `221`; the gate (`ci.yml:87-130`) blocks *increases* only and has no burn-down. A precise linear-scan of `apps/web/src/**/*.tsx` (tag-scoped, brace/quote-aware) finds 86 non-interactive tags (`div|span|li|td|tr|section|article|p|img|label`) carrying `onClick`, of which **75** have neither a key handler nor `role`+`tabIndex`. Concentration: `[schoolId]/sports/[gameId]/page.tsx` (16), `settings/streaming/page.tsx` (10), then a long tail across sports panels, `PublishToLocationsModal`, `TemplatePreviewModal`, `BuilderShell`, `AiGenerateButton`.
Fix sketch: burn down by file, ratcheting `.a11y-baseline` after each — the gate already rewards that (`ci.yml:128`).

**[P2] Boards carry 4 Chromium-83-forbidden pattern classes the gate deliberately doesn't scan, with no operator-visible Taurus-safety signal — NEW**
Evidence: `check-taurus-safety.cjs:47-51,120-124` restricts `HTML_PATTERNS` to inset only, reasoning that boards target standard LCD. Sweep of `public/templates` + `holiday-templates`: `color-mix(` **891 hits / 88 files** (Chromium 111+), `gap:` **2369 / 226**, `backdrop-filter` **120 / 46**, `aspect-ratio` **54 / 18**. Zero `oklch`, `cq*`, `container-type`, `text-wrap: balance`, `inset-inline/block`, `position: sticky`. The `globals.css` `@supports` fallbacks do not reach a sandboxed iframe, and neither runtime polyfill can either.
Impact: a board pushed to a Taurus wall silently loses color-mix'd colors and every flex gap. This is an accepted scope decision, not a bug — but nothing tells the operator which boards are Taurus-safe.
Fix sketch: annotate boards with a `data-taurus-safe` marker the screen-assign UI reads, or add color-mix/gap to `HTML_PATTERNS` at current counts so the number can only fall.

**[P2] `app-dialog.tsx` has no focus trap and no focus restore — NEW**
Evidence: `apps/web/src/components/ui/app-dialog.tsx` (345 LOC) has `role="dialog"` (`:253`), `aria-modal="true"` (`:254`), Escape (`:181`), initial focus via rAF (`:178`) and D-pad arrow nav (`:221-231`) — but nothing constrains Tab, and nothing re-focuses the trigger on close. Repo-wide, focus restore exists in exactly 2 components (`AiGenerateButton.tsx:275,314`; `AiImageGenerateButton.tsx:144,166`); `FocusTrap`/`useFocusTrap`/`restoreFocus` return 0 hits.
Impact: WCAG 2.4.3 — Tab walks a keyboard user out of the modal into the inert page behind it, and closing dumps focus at `<body>`. `sheet.tsx` is unaffected (Base UI Dialog handles both).
Fix sketch: add a Tab-cycling handler + `previouslyFocused?.focus?.()` on unmount to `app-dialog.tsx` — one edit covers every consumer.

**[P2] 4 holiday boards ship no `<html lang>` — NEW**
Evidence: 239/243 boards declare it; missing in `holiday-templates/es-{stpatricks,thanksgiving,easter,halloween}.html` (line 3 in each: bare `<html>`). ("es-" = Elementary School, not Spanish.) WCAG 3.1.1. One-line fix per file, then re-run the injector for the subdir.

### Clean — verified, no finding
- **inset, all three variants.** CLAUDE.md grep over `widgets`/`app/player`/`components/player`: every hit is a comment, the layout polyfill itself, or one of the documented shorthand-AND-longhand callsites (`KioskSplash.tsx:1067,1137,1146,1171,1284`; `player/page.tsx:9567`). AST detector: **0 confirmed landmines** across 292 files (92 non-uniform-but-safe, 5 conservative manual-review flags: `field-day.tsx:667`, `scrapbook.tsx:65`, `CelebrationsOtherSportsWidgets.tsx:2437,2552`, `RetailWidgets.tsx:65`). HTML board inset count is **exactly 0** across 243 boards. Both detectors wired as hard gates in `taurus-safety.yml`.
- **2026-05-09 WebKit regex-LF class.** A char-state JS tokenizer (string/template/comment/char-class aware) over every inline `<script>` in 245 board + bridge files: **0** raw LFs inside a regex literal. Second method (regex opened and unterminated at EOL): **0**.
- **Chrome-only APIs.** `startViewTransition`, `body.tee(`, `structuredClone`, `showOpenFilePicker`, `CSS.registerProperty`, `WebTransport`, `computedStyleMap`: **0 hits** across `apps/web/src` + both template trees. Only `ResizeObserver` (101), `IntersectionObserver` (23), `OffscreenCanvas` (2) — all Chromium ≤69, Taurus-safe.
- **React-owned `<head>` detachment (2026-06-08 favicon crash).** Fresh two-method sweep: every `.remove()`/`removeChild` in `apps/web/src` targets a node the code itself created (download `<a>`, clipboard `<textarea>`, the flex-gap probe `<div>`). `BrandStyleInjector.tsx:190-196` now mutates the Next-emitted icon links in place, exactly as CLAUDE.md rule 6 requires. `webkit-nav` canary blocking in `prod-smoke.yml:97-134`.
- **Brand-contrast gate.** 17/17 assertions green, blocking in `deploy-reliability.yml:244`.
- **Fleet-map pins.** Shape + label redundancy, WCAG 1.4.1 explicitly handled.

## Unverified / open questions

1. **Does the board shim inject raw `--brand-primary` or the derived `-strong` shade?** `check-brand-contrast.cjs` asserts only the dashboard-chrome (on-white) contract. Whether a board rendering brand-primary as a background under authored light text clears AA is **UNVERIFIED**.
2. **Do `/board` `/ribbon` `/scorebug` ever get assigned to a physical Taurus screen in practice?** The repo asserts they do (`check-taurus-safety.cjs:33-36`), and `sports.service.ts:621` calls `/ribbon/[gameId]` a public page — but no manifest path was found that points a `Screen` at those URLs. F-1's severity depends on this.
3. **The 5 conservative AST flags** (esp. `scrapbook.tsx:65`, a helper taking all four sides from props) need a caller trace to prove no call site passes a zero-leading non-uniform `top`.
4. **`ci.yml:389` comments the chromium pin as "2026-08-04"** — a date one day in the future. Cosmetic, but it makes `git log` archaeology misleading.
5. **Actual jsx-a11y rule breakdown of the 221** — `eslint` was not run (outside read-only ground rules); the 75-site figure is an independent static scan, not a subset of the 221.
