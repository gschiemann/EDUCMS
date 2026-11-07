# The Tailwind `inset-*` utility class (2026-05-19)

**Date:** 2026-05-19

## What happened

2026-05-19: the SAME bug, second variant. The 2026-05-13 sweep only searched for the literal CSS property `inset: 0` — it never caught the Tailwind **`inset-0` utility class**, which Tailwind v4 compiles to `inset: …` (and `inset-x-*` / `inset-y-*` to the equally Chromium-83-incompatible `inset-inline:` / `inset-block:`). 391 such classes across 44 widget/player files were still landmines; an operator's custom template with 3 IMAGE widgets crash-looped a 960×1080 Taurus. Swept them all to physical longhand classes (`top-0 right-0 bottom-0 left-0`).

## Root cause

The 2026-05-13 sweep searched only for the literal CSS property `inset: 0`; the Tailwind `inset-0` utility class (and `inset-x-*` / `inset-y-*`) compiles to the same Chromium-83-incompatible CSS (all of this is in the record above).

## The rule it produced

`apps/web/CLAUDE.md` → rule 10: physical longhand classes only (`top-0 right-0 bottom-0 left-0`), never `inset-*`; "The grep below now catches BOTH forms."

## Evidence

- Earlier incident: `docs/incidents/2026-05-13-inset-shorthand-136-widget-files.md`.
- `apps/web/tools/check-taurus-safety.cjs` is the CI scan.
