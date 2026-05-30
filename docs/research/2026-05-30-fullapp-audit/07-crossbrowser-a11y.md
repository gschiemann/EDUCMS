# §15 Cross-browser / Chromium-83-Taurus · §18 Accessibility

**Audit date:** 2026-05-30 · read-only, full forbidden-class sweep via the exact `check-taurus-safety.cjs` algorithm. P0-8 (`inset-[4%]`) confirmed fixed; P1-9 (desktop emergency SR) confirmed fixed.

## 1. Coverage table

| § | Domain | D | UX | F | Status |
|---|---|---|---|---|---|
| 15a | inset/inset-* sweep | — | — | **A** | P0-8 fixed; `insetTw` in gate; 0 new |
| 15b | flex gap/gap-* | — | — | **A** | 1199+93 — polyfilled + baselined |
| 15c | container-query units | — | — | **A** | 1041 — polyfilled + baselined |
| 15d | backdrop-filter/blur | C | — | **B** | 31 CSS + 9 TW baselined; transparent on Taurus; solid-bg fallback unverified for some |
| 15e | :has/oklch/color-mix/aspect-ratio/text-wrap | — | — | **B** | oklch/`:has`/color-mix ~0 in player; **aspect-ratio (12) + text-wrap:balance (8) NOT polyfilled** |
| 15f | 100vh/viewport pin | — | — | **A** | correct documentElement pin |
| 15g | WebKit canary (holiday 18 + sports 8) | — | A | **A** | green |
| 15h | WebKit React-widget coverage | — | B | **B+** | `webkit-widget-render` covers 8 families; **17 NEW families have ZERO WebKit smoke** |
| 15i | taurus-safety ratchet | — | — | **A** | push+PR, 12 patterns, down-only |
| 15j | older Android WebView floor | — | B | **B** | minSdk24; polyfills self-detect; no APK WebView floor |
| 18a | axe-core CI | — | A | **A** | 10 routes incl. emergency/panic/reviews; fails critical/serious |
| 18b | SR live regions — panic | A | A | **A** | role=status aria-live=assertive + Web Speech |
| 18c | SR live regions — desktop emergency | A | A | **A** | P1-9 FIXED — EmergencyLiveRegion in broadcast page + trigger modal |
| 18d | aria-live on hold-to-trigger | A | A | **A** | announces every phase |
| 18e | keyboard-only nav | — | B | **B** | axe per-route; no keyboard-flow E2E; hold-to-send has no onKeyDown |
| 18f | colorblind-safe map pins | A | A | **A** | distinct icon + aria-label per status |
| 18g | WCAG-AA contrast on brand palettes | A | A | **A** | `ensureContrast()` 4.5:1 + `capped` flag |

## 2. Taurus forbidden-class sweep (current vs baseline — 0 new violations)

inset CSS 17/0-new · inset-* TW 1/0 · flex gap 1199/0 (polyfilled) · gap-* 93/0 · cq 1041/0 (polyfilled) · backdrop-blur 9+31/0 · **text-wrap:balance 8/0 (NOT polyfilled)** · **aspect-ratio 12/0 (NOT polyfilled)** · color-mix 2/0 · :has 1/0 · oklch 0. **52 new/modified files checked — zero beyond baseline. 17 new widget families (Bulletin/Scrapbook/Storybook/HS/MS) all clean on the gate.**

## 3. Findings

**P0-8 + P1-9 CONFIRMED FIXED.**

| Sev | § | Finding | Fix |
|---|---|---|---|
| **P1** | 15-2 | `aspect-ratio:` in 12 baselined widgets COLLAPSES on Chromium-83/Taurus (Chrome 88+ feature) — circular cafeteria photos + product-grid + MsStudio frames become flat bars. Baselined (gate passes) but **rendering broken on Taurus today; no runtime polyfill**. Widgets: AnimatedCafeteria{Chalkboard,Elementary,foodtruck,High}, AnimatedWelcome*, FitnessReformer, MsStudio, ComboCarousel, RetailProductGrid. | replace `aspect-ratio` with padding-top % hack or explicit px height in player/widget files |
| **P1** | 15-1 | `text-wrap: balance` in 8 MS widgets (Chrome 114+) silently degrades to normal wrap on Taurus — suboptimal headlines, not invisible. | drop or guard with `@supports` |
| **P1** | 15-4 | 17 NEW widget families (Bulletin×4, Scrapbook×4, Storybook×4, HS×12, MS×16) have ZERO entry in `widget-render.spec.ts` WIDGET_CASES → untested in WebKit. They use `dangerouslySetInnerHTML` for CSS — one malformed string (the 2026-05-09 pattern) kills the widget silently in Safari. | add representative cases per family to WIDGET_CASES |
| **P2** | 15-3 | 40 `backdrop-filter` instances — solid-bg fallback unverified for AnimatedMorningNews, AnimatedAchievementShowcase, fitness/*. | per-file verify a solid bg precedes |
| **P2** | 18-1 | No keyboard-only E2E; hold-to-send uses onMouseDown/onTouchStart but NO onKeyDown (Space/Enter) → keyboard-only operator can't trigger emergency. | add onKeyDown equivalence + a keyboard-flow E2E |
| **P2** | 18-2 | axe moderate/minor warnings don't fail build + aren't counted — invisible backlog. | add a `totalWarnings > threshold` ratchet |

**Confirmed GOOD:** fleet-map pins (shape+color+aria-label), brand-palette AA enforcement (`color-utils.ts`), panic aria-live, 10-route axe sweep, holiday+sports WebKit canary green.

## 4. Biggest risk
**`aspect-ratio` silently fails on Chromium-83 (12 baselined widgets) + `text-wrap:balance` degrades (8) — both on Taurus today with no runtime polyfill, only the gate preventing further additions.** Every Taurus LED wall showing these popular widgets renders flattened images + unbalanced headlines.
