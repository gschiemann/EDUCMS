# "None of the templates can be edited" (2026-06-07)

**Date:** 2026-06-07

## What happened

The rule records it as the trap behind the fire:

> **⚠️ REDESIGN INVARIANT — the trap that caused the 2026-06-07 "none of the templates can be edited" fire:** when you edit/redesign an existing board, the OLD shim block stays baked in. A board left on the apply-only V4 shim is **un-editable by click**.

## Root cause

When an existing board is edited or redesigned, the old shim block stays baked into the HTML. A board left on the apply-only V4 shim is un-editable by click (the record above).

## Why our system let it reach a customer

Editing or redesigning a board left the old shim block baked into the HTML, and no step forced the injector to be re-run. The editability gate named in the evidence is the check that now catches a board left on the apply-only shim.

## What pins it

- `apps/web/tools/check-board-editability.cjs`
- `.github/workflows/taurus-safety.yml`

## What worked

Not recorded.

## The rule it produced

`apps/web/public/templates/CLAUDE.md` → "REDESIGN INVARIANT": after editing any `public/templates/**` board, re-run the injector for its subdirectory (and `inject-click-shim.cjs` for menu boards), then confirm with the editability gate and the real-browser tests.

## Evidence

- `apps/web/tools/check-board-editability.cjs` is the gate; `apps/web/scripts/inject-shim-v2.cjs` is the injector.
