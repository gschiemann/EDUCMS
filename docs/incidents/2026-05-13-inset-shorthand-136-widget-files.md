# The `inset` shorthand in 136 widget files (2026-05-13)

**Date:** 2026-05-13

## What happened

2026-05-13: 136 widget files (68 inline-style + 98 CSS-rule) had `inset: 0` and the operator's Rainbow Animated Portrait template was unrenderable on the Taurus until we mass-replaced them.

## Root cause

Same bug pattern as the 2026-05-09 Safari minified-bridge regression (Cross-browser support, above) — modern Chromium tolerates Web platform features ahead of spec; older Chromium forks (Android System WebView on locked-firmware controllers, Smart TVs, Tizen, WebOS) do not.

The mechanism (Chromium 83 drops the `inset` shorthand; a positioned box with no `top/right/bottom/left` collapses to 0×0 and `transform: scale(0)` hides it) stays in the rule.

## The rule it produced

`apps/web/CLAUDE.md` → rule 10, "NEVER use the `inset` shorthand in widget or player styles", with the scope clarification of 2026-05-29 (Taurus-shipped code only).

## Evidence

- `.husky/pre-commit` blocks `inset: 0` in staged player and widget files; `apps/web/tools/check-taurus-safety.cjs` is the CI scan.
- Follow-ups: `docs/incidents/2026-05-19-tailwind-inset-utility.md`, `docs/incidents/2026-07-03-inset-cssom-serialization.md`.
