# Client navigation crashed in Safari (2026-06-08)

**Date:** 2026-06-08

## What happened

This was the multi-day "every menu click needs two clicks / it just reloads" bug (2026-06-08, `BrandStyleInjector` deleting the Next-emitted favicon links — fix `ddb64dab`).

On 2026-06-08 that one row (Safari 27, `/assets`, 0 console errors, all data loaded) is what finally cracked a bug I'd chased ~7 times in Chrome.

## Root cause

From the rule that stays in `apps/web/CLAUDE.md` (cross-browser rule 6):

> `document.querySelector('link[rel=icon]').remove()` / `parentNode.removeChild(reactNode)` leaves React holding a fiber whose `stateNode.parentNode` is now `null`; the **next client navigation** runs React `commitDeletion` → `node.parentNode.removeChild(node)` → `TypeError: null is not an object (… parentNode.removeChild)`, which unmounts the **whole root** and the app hard-reloads.

## The rule it produced

`apps/web/CLAUDE.md` → "Cross-browser support — non-negotiable", rule 6 (never imperatively detach a DOM node that React rendered; mutate it in place or render your own node) and rule 7 (when a UI bug cannot be reproduced in Chrome, switch to WebKit immediately and read the in-app bug telemetry first, through a read-only role in a sub-agent).

## Evidence

- Fix commit `ddb64dab`.
- `pnpm --filter web run test:webkit-nav` logs into the live deploy in WebKit and fails on any `removeChild`/`parentNode` crash; it runs from `.github/workflows/prod-smoke.yml`.
