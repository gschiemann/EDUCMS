# Safari minified-bridge crash (2026-05-09)

**Date:** 2026-05-09

## What happened

On 2026-05-09 we shipped a 2-month-old "works in Chrome, crashes in Safari" bug — every holiday template's inline minified bridge had a literal `\n` byte (real LF) inside a regex literal. V8/Chromium tolerated it; WebKit threw `SyntaxError: Unterminated regular expression literal` and killed the entire bridge script. Result: holiday hotspots, click-to-edit, and styling overrides ALL non-functional in Safari for months. Local dev was Chrome-only so we never saw it.

## Root cause

A regex literal in every holiday template's inline minified bridge held a real line feed. V8/Chromium tolerated it; WebKit threw `SyntaxError: Unterminated regular expression literal` and the entire bridge script died (all of this is in the record above).

## The rule it produced

`apps/web/CLAUDE.md` → "Cross-browser support — non-negotiable": test in WebKit before anything is `done`; no minified inline JS unless verified to parse in WebKit; avoid Chrome-specific APIs without a fallback; port the WebKit check pattern to every new DOM/postMessage surface.

## Evidence

- `apps/web/tests/cross-browser/holiday-bridge.cjs` is the WebKit canary; `.github/workflows/cross-browser.yml` runs it nightly, on every pull request and on demand.
