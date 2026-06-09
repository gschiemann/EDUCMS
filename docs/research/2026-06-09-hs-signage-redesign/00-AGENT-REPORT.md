# 6 "horrible" HS signage boards — redesign (agent report)

**Date:** 2026-06-09. Operator flagged 6 HS signage templates as "horrible" and asked for a redo.
**Agent:** venueos-template-designer (worktree-isolated). **Status:** complete, **NOT merged / NOT deployed.**
**Worktree branch:** `worktree-agent-a553624e36ed7da9b`
**Before/after screenshots:** `/tmp/board-verify/AFTER-{terminal,transit,bulletin,zine,blueprint,gallery}-chromium-landscape.png` (+ `*-portrait.png`); genuine "before" snaps: `/tmp/board-verify/BEFORE-{terminal,hall-bulletin}-chromium-landscape.png`.

## Title → file map (the key reconciliation)

The 6 titles were **5 React-zone widget presets + 1 EXTERNAL_HTML board**. Per the flagship-template brief (EXTERNAL_HTML under `apps/web/public/templates/hs/` + shim injector), the agent delivered all 6 as EXTERNAL_HTML boards and **repointed the presets**.

| Operator title | File | Was |
|---|---|---|
| 🖥️ Terminal — CRT / Phosphor | `apps/web/public/templates/hs/terminal.html` | EXTERNAL_HTML, wrong metaphor (amber departures) — **fully rebuilt** |
| ✈️ Transit — Airport Departure Board | `apps/web/public/templates/hs/hall-wayfinder.html` | `HS_TRANSIT` React widget — **rebuilt as HTML**, preset repointed |
| 🏛️ Gallery — Museum Wall Labels | `apps/web/public/templates/hs/gallery.html` (NEW) | `HS_GALLERY` React widget — preset repointed |
| 📐 Blueprint — Technical Drawing | `apps/web/public/templates/hs/blueprint.html` (NEW) | `HS_BLUEPRINT` React widget — preset repointed |
| ✂️ Zine — Cut & Paste Student Rag | `apps/web/public/templates/hs/zine.html` (NEW) | `HS_ZINE` React widget — preset repointed |
| 📌 Bulletin Board · Hallway | `apps/web/public/templates/hs/hall-bulletin.html` | dense newspaper layout — **fully rebuilt as cork board** |

Registration updated in BOTH `apps/api/src/templates/system-presets.ts` (presets → EXTERNAL_HTML + new descriptions/bg) and `apps/web/src/components/widgets/signage-templates.ts` (catalog).

## Per-board metaphor

- **Terminal (CRT):** phosphor-green glow + scanlines + screen-curvature vignette + flicker; giant `> now running` block; `cat ~/bell/today.log` schedule; `whoami` staff card w/ photo slot; blinking-cursor SYSLOG ticker. Monospace. 64 cramped → 62 legible fields.
- **Transit (split-flap):** true Solari board — amber-on-black flap tiles, hard center seam, classes as departures, room-as-gate (cyan), live status column (ON TIME / BOARDING / DEPARTED) driven by the wall clock, the live row flips, split-flap clock. Auto-fit so nothing wraps.
- **Gallery (museum):** cream plaster wall, EB Garamond / Cormorant italic, Roman numerals, hairline rules, big framed feature w/ photo slot + wall label, "Also on view" plaques, "Docent's Note." Restraint is the design.
- **Blueprint (technical):** cyan grid paper, white line-work, engineering title block (project/sheet A-1/scale/drawn-by/time), dimensioned current-period callout w/ leaders + corner brackets, schedule as "drawing index," revision-log ticker.
- **Zine (cut & paste):** toner-speckled photocopy paper, halftone dots, ransom-letter cut-out masthead, rotated taped panels, marker scrawl, taped grayscale polaroid w/ photo slot, highlighter blurb, xeroxwire ticker.
- **Bulletin (cork):** wooden frame, speckled cork, pinned index cards w/ push-pins + washi-tape + rotation + layered shadows, big spotlight card, photo card w/ slot, announcement note, live "Today's bells" strip, paper-banner ticker. 155-field newspaper → 60 breathing fields.

## Verification (agent-run)

- **Final gate 24/24 pass** (6 boards × chromium+webkit × landscape+portrait): `errs=0, overflow=0, minFit ≥ 54px`. Real-font captures minFit 52–78px (above the 50px floor).
- **Click-to-edit hot-zones verified on all 6 in chromium AND webkit** (posts `educms-field-click` with the clicked key).
- **Shim re-injected:** `inject-shim-v2.cjs hs` → EDUCMS-SHIM-V6 on all 6; CLAUDE.md sweep reports no board missing click-to-edit. Brand tokens, `[data-widget="theme"]`, §4a live schedule engine, live clocks, photo slot per person/feature card all present; no `data-demo-*`.
- **tsc clean:** API `tsc --noEmit` exit 0; web tsc exit 0.

## Two flags from the agent (lead must act on these)

1. **Real bug found + fixed (affects the standards' verbatim engine):** `data-fit` on elements INSIDE a `[data-schedule]` container creates an **infinite MutationObserver feedback loop** — auto-fit writes `font-size` → schedule observer (`attributes:true`) re-fires → rewrites status → re-fires auto-fit, forever. Pinned CPU, hung the transit renderer (would hurt real Pi/Android players). Fix applied: schedule observer → `attributeFilter:['data-time']`. **→ Update `docs/design/FLAGSHIP-TEMPLATE-STANDARDS.md` §4a to ship this filter by default.**
2. **Architecture fork:** the React widgets `HS_TRANSIT/HS_GALLERY/HS_BLUEPRINT/HS_ZINE/BULLETIN_HALLWAY` still exist + are reachable from the raw widget *palette* (`constants.ts`) + `WidgetRenderer`. Presets now render the new HTML; the React widgets are orphaned. Optional follow-up: retire them.

## Lead's merge gate (NOT done yet)

Per the no-batch design rule: **operator reviews screenshots + approves before ship.** Next steps for the lead:
1. Screenshot each AFTER board, present to operator for approval (one at a time / side-by-side with the "horrible" originals).
2. On approval: review `git diff master..worktree-agent-a553624e36ed7da9b`, cherry-pick/merge the 8 deliverable files, re-run the HS click-edit sweep + Playwright, push, watch CI.
3. Apply flag #1 to the standards doc.
4. Remove the worktree after merge (`pnpm worktrees:clean`).
