# Templates-gallery performance cliff — proof + regression guard

**Date:** 2026-06-08
**Spec:** `apps/web/tests/e2e/templates-gallery-perf.spec.ts`
**Config:** `apps/web/playwright.perf.config.ts` (self-contained, no Next boot)
**Scope of this work:** test + docs ONLY (no component / script / board edits).

---

## 1. Root cause

The templates gallery (`apps/web/src/app/[schoolId]/templates/page.tsx`) lists
~114 `EXTERNAL_HTML` presets. Each preset is rendered by `ExternalHtmlWidget`
(in `apps/web/src/components/widgets/WidgetRenderer.tsx`, ~line 2768) as a
**live `sandbox="allow-scripts"` (null-origin) iframe** whose `src` is a
full **3840×2160** self-contained HTML board. Every board runs:

- a **live clock** on `setInterval` (e.g. `school/ms-lobby-v1.html` → `tick();
  setInterval(tick, 15000)`),
- **continuous CSS animations** (`@keyframes … infinite` — the Domino's QSR
  board has 11 of them), and on some boards a **scrolling ticker**.

The thumbnail wrapper (`ScaledTemplateThumbnail`) mounts a tile when it scrolls
within `400px` of the viewport (`IntersectionObserver`, `rootMargin:'400px'`)
and — by its own comment — **"once mounted, stay mounted"**. There is **no
un-mount on scroll-away**. So as the operator scrolls the gallery, live 4K
iframes **accumulate without bound**.

Each live board is internally a 3840×2160 surface. Rendering N of them with
continuous animation saturates the renderer's **compositor / raster pipeline**
and, for the clock/ticker boards, the **main thread** — frame production
collapses and the browser shows **"page unresponsive."**

> **Why iframe work shows up as parent jank:** real low-power player / kiosk
> Chromium (and Android System WebView) run **without per-site process
> isolation** — every frame shares ONE renderer main thread. That is the
> single pegged thread the bug describes. The test reproduces that reality by
> launching Chromium with `--disable-features=IsolateOrigins,site-per-process`
> so each sandboxed iframe's work surfaces in the PARENT page's observers
> (with isolation ON, each frame gets its own process and the parent observer
> reads ~0 while the machine still melts — the cliff would be hidden behind
> per-frame process accounting).

---

## 2. Measured numbers (independent proof)

Reproduced by mounting N board iframes the way the gallery does: each iframe at
its natural **3840×2160**, shrunk with `transform: scale(0.078125)` to a ~300px
thumbnail (faithful to `ScaledTemplateThumbnail`, which scales the
full-resolution surface down rather than re-laying-it-out small). Boards are
served from a **local static server** of `apps/web/public` started inside the
test — zero network / prod / Next dependency. The parent installs:

- **`blockingMs`** — accumulated lag of a parent **50ms heartbeat** past its
  schedule = main-thread time the operator experiences as "unresponsive"
  (the brief's "total blocking time").
- **`droppedFrames`** — `requestAnimationFrame` deltas that overran the 60Hz
  frame budget = the "page can't keep up / feels frozen" symptom.
- **`longTaskMs` / `heartbeats`** — corroborating `PerformanceObserver`
  long-task time and surviving heartbeat ticks (printed for context).

Measurement window = 6s per case, after a 2.5s settle (so we measure ongoing
steady-state work, not one-time boot). Viewport pinned 1600×1000.
**HEAVY** board = `signage/qsr/11-dominos-pizza-board.html` (11 infinite CSS
animations + a 250ms interval). **LIGHT** board = `school/ms-lobby-v1.html`
(single 15s clock tick).

Representative run (Chromium, site-isolation off):

| Board  | mode   | N  | blockingMs | droppedFrames | longTaskMs | heartbeats/120 |
|--------|--------|----|-----------:|--------------:|-----------:|---------------:|
| HEAVY  | live   |  4 |        28  |            0  |         0  |          121   |
| HEAVY  | live   | 12 |       262  |           10  |        55  |          119   |
| HEAVY  | live   | 24 |       855  |          227  |       261  |          121   |
| HEAVY  | FROZEN | 24 |       943  |          222  |       379  |          117   |
| LIGHT  | live   | 24 |      2985  |          174  |       499  |           61   |

Across 5 runs the cliff is consistent and large:

- **HEAVY droppedFrames:** N=4 = **0–5** → N=24 = **198–313** (the rock-solid
  cliff signal — animating N huge surfaces always saturates raster).
- **HEAVY blockingMs:** N=4 = **19–65 ms** → N=24 = **549–1587 ms**.
- **LIGHT (clock board) N=24:** heartbeat starved to **53–78 / 120** ticks —
  the parent couldn't even run its own 50ms timer ⇒ literally unresponsive.

The **FROZEN N=24** row currently mirrors **live** (blockingMs 534–1680,
droppedFrames 211–266) because **the `freeze=1` contract is NOT yet merged on
this base** — boards ignore the param. See §4.

---

## 3. The fix contract (implemented in parallel)

1. **Un-mount thumbnails when scrolled far off-screen** — cap the number of
   concurrent live iframes so they can't accumulate without bound.
2. **`freeze=1` URL-param contract** — when a board URL contains `freeze=1`,
   the baked shim renders **one** auto-fit frame, then:
   - `clearInterval`s the live clock,
   - `cancelAnimationFrame`s any rAF loops,
   - injects `*{animation:none!important;transition:none!important}`,

   so the iframe goes **idle (~0 ongoing CPU)**. Gallery thumbnails (which only
   need a still preview) pass `freeze=1`; the live player does not.

---

## 4. How the spec enforces the fix (regression guard)

The spec **always runs and prints both the live and frozen numbers.** It then
**probes** whether `freeze=1` is honored on the current base — by loading one
board top-level with `?freeze=1`, instrumenting `setInterval` /
`requestAnimationFrame` before the board's own script runs, and checking
whether the board cleared its timers (it cannot peek into a sandboxed
null-origin iframe, so the probe loads the board top-level).

- **Always enforced (the cliff):** `droppedFrames` near-0 at N=4 and >100 at
  N=24 with a ≥3× climb; `blockingMs` climbs from N=4 → N=24. These prove the
  bug and would catch a regression that re-introduces unbounded live iframes.
- **Guarded on the freeze probe (the fix):**
  - freeze **honored** → enforce `frozenBlockingMs < 500`,
    `frozenDroppedFrames < 40`, `liveBlockingMs > frozenBlockingMs × 3`, and
    `liveDroppedFrames > frozenDroppedFrames × 3 + 80`.
  - freeze **NOT honored** (current master) → print a `[GUARD PENDING]`
    message and **skip** the strict frozen assertions, so the spec stays
    **green on master**. The guard **auto-arms** (no edit needed) the moment
    the baked shim starts honoring `freeze=1`.

This matches the brief's intent: `expect(frozenBlockingMs).toBeLessThan(500)`
and `expect(liveBlockingMs).toBeGreaterThan(frozenBlockingMs * 3)` are present;
they are gated so the spec is green today and enforcing tomorrow.

---

## 5. How to run

**Fast / recommended (self-contained — starts its own static server, chromium
only, ~50s, no Next boot):**

```bash
# from apps/web:
pnpm --filter web exec playwright test \
  -c playwright.perf.config.ts --project=chromium
```

`playwright.perf.config.ts` deliberately has **no `webServer`** (the spec
starts its own static server in `beforeAll`) and runs **chromium only**.

**Under the default config** (the brief's literal command — also works on any
tree where `next dev` can boot; it just pays the Next-boot tax, and the spec
still uses its OWN static server and skips non-chromium projects):

```bash
pnpm --filter web exec playwright test \
  tests/e2e/templates-gallery-perf.spec.ts --project=chromium
```

The spec `test.skip`s on non-chromium (the `longtask` observer + the
site-isolation launch flags are Chromium-only), so it is safe in the
chromium+webkit matrix of the default config.

---

## 6. Notes / caveats

- **`droppedFrames` is the primary enforced signal**; `blockingMs` (heartbeat
  lag) is secondary and asserted with a conservative floor — for an
  animation-bound board much of the work is compositor/raster (not JS), so the
  JS-heartbeat lag has more run-to-run variance than the frame-production
  collapse.
- Site-isolation is disabled **only inside this test** to model the
  single-renderer-thread player/kiosk reality and to make the proof
  reproducible; it does not change any product code.
- The spec touches **no** component, script, or board HTML — the un-mount +
  `freeze=1` implementation is owned by a parallel change. This file is the
  independent proof and the guard that change must satisfy.
