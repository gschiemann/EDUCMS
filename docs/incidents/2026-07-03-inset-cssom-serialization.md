# Four-sided style objects collapse into the `inset` shorthand (2026-07-03)

**Date:** 2026-07-03

## What happened

The rule records the discovery in its first sentence:

> 2026-07-03: a THIRD variant, invisible to grep — no file contains the word "inset" at all.

And where it was confirmed live:

Confirmed live in `ScorebugTicker`'s "scrolling reel" (`apps/web/src/components/ widgets/themes/scorebug.tsx`), three `Celebrations*Widgets.tsx` symmetric-margin center columns, `scrapbook.tsx`'s ruled-lines panel, and the `right:'auto', bottom:'auto'` pinning pattern in both `player/page.tsx` and `KioskSplash.tsx`.

## Root cause

The browser's CSSOM re-serializes a React inline `style` object that supplies all four physical sides into the `inset` shorthand in the element's `style` attribute; the Chromium-83 polyfill selector then force-zeroes all four sides for any non-uniform case whose `top` serializes starting with `0`. The full mechanism stays in the rule (`apps/web/CLAUDE.md` → rule 10, the 2026-07-03 paragraph), together with the decision not to harden the polyfill.

## The rule it produced

`apps/web/CLAUDE.md` → rule 10: drop to three physical sides plus an explicit `width`/`height`; omit `right`/`bottom` instead of setting them to `'auto'`.

## Evidence

- Detector: `apps/web/tools/check-inset-serialization.cjs` (AST-based, uses the TypeScript compiler API).
- Earlier incidents: `docs/incidents/2026-05-13-inset-shorthand-136-widget-files.md`, `docs/incidents/2026-05-19-tailwind-inset-utility.md`.
