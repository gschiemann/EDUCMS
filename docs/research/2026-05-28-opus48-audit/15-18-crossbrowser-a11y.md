# AUDIT — §15 Cross-browser/Chromium-83 · §18 Accessibility

> Opus 4.8 full-app audit, 2026-05-28. Read-only. Every Chromium-83 claim
> grep-verified against the tree (BSD-grep trap avoided via `find -print0 | xargs -0
> grep -oE` — first-pass regexes returned FALSE zeros).

## Page 1 — Coverage (D / UX / F)
| # | Domain | D | UX | F | Notes |
|---|---|---|---|---|---|
| 15a | `inset`/`inset-0` sweep | — | — | **B** | 1 ungated live regression (`inset-[4%]`); runtime patcher + static gate cover the rest |
| 15b | flex `gap` | — | — | **A** | 411 rules — all covered by runtime `flex-gap-polyfill.ts` + baseline gate |
| 15c | container-query units | — | — | **A** | 1084 occurrences/61 files — covered by `cq-unit-polyfill.ts` + CI gate |
| 15d | `backdrop-filter`/`backdrop-blur` | C | — | **B** | 40 baselined instances render transparent on Taurus; most have solid-bg fallback, some don't |
| 15e | `:has()`/`oklch()`/`color-mix()`/`aspect-ratio`/`text-wrap:balance` | — | — | **A** | ZERO in player/widget surfaces; CI gate blocks new |
| 15f | `100vh`-after-meta-pin | — | — | **A** | zero raw 100vh; correct documentElement.style.height pin |
| 15g | Safari/WebKit canary (holiday-bridge) | — | A | **A** | green-gating, push+PR |
| 15h | WebKit coverage of NEW surfaces (sports/CTS/themed) | — | **D** | **D** | **GAP** — canary tests only 18 static holiday HTMLs; React widgets + celebration HTML pack have NO WebKit check |
| 15i | CI baseline ratchet | — | — | **A** | taurus-safety ratchets DOWN only; cross-browser binary all-pass |
| 15j | Older Android WebView (kiosk) | — | B | **B** | minSdk=24 (Android 7); polyfills self-detect; dashboard warns on chromiumMajor<105; no WebView floor in APK |
| 18a | axe-core CI baseline | — | A | **A** | 10 routes incl life-safety; fails on critical/serious; push+PR |
| 18b | SR live regions — panic page | A | A | **A** | proper role=status aria-live=assertive sr-only |
| 18c | SR live regions — **desktop** emergency console | **D** | **D** | **D** | **GAP** — `/emergency/broadcast` + EmergencyTriggerModal have ZERO aria-live/role=alert |
| 18d | aria-live on hold-to-trigger | B | B | **B** | panic announces phase; desktop hold silent |
| 18e | Keyboard-only nav | — | B | **B** | axe per-route; no dedicated keyboard-flow E2E |
| 18f | Color-blind-safe fleet-map pins | A | A | **A** | distinct icon shape per status + aria-label; cites WCAG 1.4.1 |
| 18g | WCAG AA contrast on brand-injected palettes | A | A | **A** | `derivePalette` auto-clamps via `ensureContrast` to 4.5:1 before deriving ramp |

## LIVE GREP RESULTS (concrete, file:line)
Mandated `inset` grep: all hits SAFE — comments, the layout.tsx runtime patcher, 2
documented dual-declaration callsites (`KioskSplash.tsx:1055,1125,1134,1159,1272`;
`player/page.tsx:7352` — each declares `inset:0; top:0;right:0;bottom:0;left:0` on
one line; `player/layout.tsx:209-210` attribute-selector patcher). All intentional.

**THE ONE CONCRETE REGRESSION (Tailwind `inset-[…]` — caught by neither gate):**
- **`apps/web/src/components/widgets/themes/high-school-athletics.tsx:37`** —
  `className="absolute inset-[4%] …"` compiles to `.inset-\[4\%\]{inset:4%}`, which
  (a) the layout.tsx patcher MISSES (only matches inline `style="inset…"` attrs, not
  stylesheet rules) and (b) `taurus-safety` MISSES (no `inset` pattern). `AthleticsLogo`
  is registered (`variants-register.ts:341`) + dispatched (`WidgetRenderer.tsx:1732/2181`)
  → **ships to player.** On Taurus the inner hexagonal badge plate collapses to 0×0
  top-left → logo/initials disappear. The 2026-05-19 second-variant bug recurring.

**`backdrop-filter` — 40 instances on player surfaces** (baselined, render transparent
on Taurus): `player/page.tsx`(6), `KioskSplash.tsx`(4), `TouchOverlay.tsx`(3, has solid
fallback), + widgets `MsPlaylistWidget`, `AnimatedMorningNewsWidget`,
`AnimatedAchievementShowcaseWidget`, `fitness/*` — widget instances need per-file
solid-bg verification.

**Verified CLEAN (zero hits) on player/widget:** Tailwind `gap-*`,
`inset-inline`/`inset-block`, `:has()`, `oklch()`, `color-mix()`, `aspect-ratio`,
`text-wrap:balance`, raw `100vh`.

## A11y Gap List
1. **Desktop emergency console has no SR feedback** (`/emergency/broadcast/page.tsx`,
   3s hold-to-confirm; `EmergencyTriggerModal.tsx`) — neither has `aria-live`/`role=alert`.
   A blind admin triggering a lockdown from desktop gets no spoken confirmation. Panic
   page does this right; desktop life-safety surface does not. axe misses it (missing
   live region is best-practice, not critical/serious → passes gate). **Highest-severity
   a11y gap — life-safety surface.**
2. No dedicated keyboard-only navigation E2E.
3. axe warnings (moderate/minor) don't fail the build + aren't ratcheted → unbounded backlog.

A11y strengths confirmed: panic-page live region, fleet-map shape+aria pins,
brand-palette AA auto-clamp — all genuinely wired.

## Does CI gate these?
- **Chromium-83: YES, strongly.** `taurus-safety.yml` → `check-taurus-safety.cjs`
  scans widgets+player+board+ribbon+scorebug for gap/cq/backdrop/text-wrap/color-mix/
  `:has`/aspect-ratio/oklch vs a DOWN-only baseline; any new instance fails push+PR.
  **One hole: no `inset` pattern** — why `inset-[4%]` slipped.
- **Safari/WebKit: YES but narrow.** holiday-bridge canary (18 static templates) +
  emergency-path E2E in `[chromium,webkit]` matrix (player emergency overlay IS
  WebKit-tested, with empty playlists). **Hole: no WebKit render check for themed/
  sports/restaurant/retail/fitness/bar widgets or `public/celebrations/*.html`.**
- **a11y: YES.** axe on 10 routes, fails on critical/serious, push+PR.

## TOP 10 RANKED FIXES
1. **Fix `high-school-athletics.tsx:37`** — `inset-[4%]` → `top-[4%] right-[4%]
   bottom-[4%] left-[4%]`. One-line, zero-regression. Live Taurus regression on a
   sports-vertical widget.
2. **Add an `inset` pattern to `check-taurus-safety.cjs`** (both `inset:` CSS + Tailwind
   `inset-(0|x-|y-|\[)`) so the runtime patcher isn't the sole (incomplete) defense.
   Baseline after #1.
3. **Add aria-live to the desktop emergency console** (`/emergency/broadcast` +
   `EmergencyTriggerModal`) — role=status aria-live=assertive sr-only, mirror the panic
   page. Life-safety + a11y.
4. **Extend the WebKit canary to `public/celebrations/*.html`** (static HTML, same
   harness — cheap). Ship to player, currently zero WebKit coverage.
5. **WebKit smoke render of representative React widgets** — `tests/e2e/widget-render.spec.ts`
   mounting ~6 widgets on `/player`, assert non-zero offsetWidth + no console errors,
   run in the `[chromium,webkit]` matrix. Closes the "only 18 holiday templates see
   Safari" gap (CLAUDE.md cross-browser rule #4).
6. **Run flex-gap + cq-unit polyfills on `/board`, `/ribbon`, `/scorebug`** (shared
   `<TaurusPolyfills/>`) — clean today but no runtime fallback if rebaselined.
7. **Verify solid-bg fallback behind the 40 `backdrop-blur` widget instances** (esp.
   AnimatedMorningNews, AnimatedAchievementShowcase, fitness/*).
8. **WebView-version floor + telemetry on the kiosk APK** (minSdk=24 allows Chromium
   ~51) — report chromiumMajor on first heartbeat, loud dashboard warning if <83.
9. **Ratchet axe warnings** — baseline the count, fail if it grows.
10. **Keyboard-only nav E2E** for emergency trigger / submission approve / branding adopt
    in the `[chromium,webkit]` matrix.

**Bottom line:** the Chromium-83 defense is genuinely strong + well-engineered (two
self-detecting runtime polyfills + a baseline-ratchet CI gate covering 9 of 10 trap
classes) — far better than past "assumed-working" theater. Two real holes, both cheap:
(1) the `inset` Tailwind-class gap that let `high-school-athletics.tsx:37` ship a live
Taurus regression, (2) WebKit coverage stops at 18 static holiday HTMLs while ~250 React
widgets + the sports celebration pack go untested in Safari. On a11y, the one real gap
is the silent desktop emergency console for SR users.
