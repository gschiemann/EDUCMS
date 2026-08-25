# Accessibility compliance documentation

This folder holds VenueOS's Accessibility Conformance Report (ACR) and the
evidence trail behind it. Start here.

## What's in this folder

| File | What it is |
|---|---|
| [`ACR-DRAFT.md`](./ACR-DRAFT.md) | The draft ACR itself — a WCAG 2.1 A/AA conformance table, structured like a VPAT 2.5 WCAG-edition report, with a per-criterion remark and evidence citation. **DRAFT — see status below.** |

## Status (as of 2026-08-25)

**Not ready to send to a customer or procurement office.** This is a first
pass, assembled by an AI coding agent from the repo's own automated a11y
tooling plus direct source-code reading. Nobody has run a screen reader
against the product for this report. The draft is explicit about this on its
own front page and lists exactly which surfaces need a human
assistive-technology (AT) pass before issuance (`ACR-DRAFT.md` §8).

Headline numbers from the current draft (50 WCAG 2.1 A+AA criteria):

- **10 Supports**, **22 Partially Supports**, **0 Does Not Support**,
  **6 Not Applicable**, **12 Not Evaluated**.
- The 12 "Not Evaluated" rows are not a pass — they mean nobody has checked
  yet. Every one of them has to become a real level before this ships to a
  customer.
- Even the "Supports"/"Partially Supports" ratings are code-review
  judgments, not verified AT-session outcomes.

## Why this exists

Public school districts are increasingly asking VenueOS (and every other
signage/CMS vendor) for a WCAG 2.1 AA conformance report as part of their own
DOJ Title II obligations (28 CFR §35.200/§35.201). **Note — verified via web
search 2026-08-25, correcting the framing this task started with:** the
rule's compliance dates were extended by one year in a DOJ Interim Final
Rule published April 20, 2026. Current dates are **April 26, 2027** for
districts serving populations ≥50,000 (not April 2026 — that was the
original date before the extension) and **April 26, 2028** for smaller
districts and special district governments. Neither deadline has passed yet.
See `ACR-DRAFT.md` §1 for the source citation. Having a real, honest answer
ready — instead of either silence or an aspirational document that doesn't
survive a district's own testing — is still the point of this folder; it's
just not up against the wall it was thought to be when this draft was
started.

## How to move this from DRAFT to something issuable

In roughly the order that unblocks the most:

1. **Fill in the itemized `.a11y-baseline` breakdown.** Unlike the axe
   baseline (`apps/web/scripts/a11y-warning-baseline.json`, which names every
   violation by file/rule/reason), the jsx-a11y ESLint baseline
   (`.a11y-baseline` = 93) is a bare integer. Run:
   ```bash
   pnpm --filter web lint 2>&1 | tee /tmp/lint.txt
   grep -E "error[[:space:]]+.*jsx-a11y/" /tmp/lint.txt | sed -E 's/.*(jsx-a11y\/[a-z-]+).*/\1/' | sort | uniq -c | sort -rn
   ```
   and commit the resulting per-rule breakdown somewhere durable (a sibling
   JSON file next to `.a11y-baseline`, following the same pattern
   `a11y-warning-baseline.json` already uses). This session could not run
   this — `apps/web/node_modules` isn't installed in the isolated worktree
   used to write this draft.
2. **Run a real NVDA/JAWS/VoiceOver pass** against the priority list in
   `ACR-DRAFT.md` §8, starting with `/panic` and
   `/{tenant}/emergency/broadcast` (life-safety surfaces, highest stakes).
   Update the affected rows' conformance level and remark with what the
   human tester actually found — don't just delete the "code-review only"
   caveat, replace it with a real result.
3. **Fix the two cheapest, highest-value gaps named in the draft:**
   - The floor-plan screen-placement drag handle
     (`apps/web/src/components/floor-plans/EmbeddedFloorPlanView.tsx`,
     `DraggableScreenCard`) has zero keyboard path. Even a minimal fix
     (arrow-key nudge once focused + Enter to drop, or a "place at center /
     enter coordinates" fallback) resolves a confirmed 2.1.1 failure.
   - The `weather`/"Shelter" label mismatch on `/panic`
     (`apps/web/src/app/panic/page.tsx`'s `TYPES` array) is a one-line
     `aria-label` fix — change the label text to include "Shelter", or add
     it as a first-class synonym.
4. **Resolve the "Not Evaluated" rows.** `ACR-DRAFT.md` §8 lists the specific
   tests each one needs (320px reflow, text-spacing override, non-text
   contrast measurement, a full flashing/strobe sweep of the widget theme
   catalog, etc.). None of these require new tooling — they're manual
   checks against the existing running app.
5. **Turn on the Lighthouse accessibility gate.** Remove
   `continue-on-error: true` from the relevant step in
   `.github/workflows/lighthouse.yml`, per `docs/ACCESSIBILITY.md`'s own
   long-standing "Tightening the gate" TODO.
6. **Either build or delete the documented jest-axe pattern.**
   `docs/ACCESSIBILITY.md` tells developers to import
   `expectNoA11yViolations` from `@/test-utils/axe` — that file doesn't
   exist and the helper has zero call sites anywhere in the repo. Either
   write it (there's a real, listed `jest-axe` dependency ready to use) and
   start using it on new components, or correct the doc so it stops sending
   the next developer looking for a file that isn't there.
7. **Get a named human owner and a real "prepared by."** The draft
   deliberately does not put a fabricated evaluator name on the front page.
   Before this is issued, a real person needs to own the report, sign off on
   every row, and be the actual contact for the (currently placeholder)
   accessibility-feedback address.

## How to regenerate the evidence this draft is based on

```bash
# 1. Automated axe-core scan (10 authenticated + public routes).
#    Full recipe (ephemeral Postgres + seeded admin + built API + built web)
#    is in apps/web/scripts/a11y-audit.ts's header comment; short version:
pnpm db:push && pnpm db:seed
pnpm --filter api build && pnpm --filter api run start:prod &
pnpm --filter web build && pnpm --filter web start &
A11Y_REQUIRE_LOGIN=1 pnpm a11y:ci

# 2. jsx-a11y ESLint sweep (no DB/server needed).
pnpm --filter web lint 2>&1 | grep "jsx-a11y/"

# 3. Brand-contrast math gate (no DB/server needed).
node apps/web/tools/check-brand-contrast.cjs

# 4. Dev-only live axe overlay (manual, visual — watch the browser console).
pnpm dev:web   # NODE_ENV=development is the default for `next dev`
```

To re-verify a specific claim in `ACR-DRAFT.md`, grep the file/line cited in
that row's remark — every claim in the draft is meant to be independently
re-checkable that way. If a claim can't be traced back to a specific file,
commit, or CI artifact, it shouldn't be in the report (that's the standard
this draft was held to; hold any update to it).

## Keeping this current

Accessibility conformance drifts as the app changes — a new widget, a new
form, a new route can silently regress a criterion that was previously
"Supports." Re-run the checks above periodically (a quarterly pass is a
reasonable cadence for a pre-revenue/early-growth product; tighten to
per-release once the CI gates in step 5/6 above are real) and update
`ACR-DRAFT.md` in place rather than letting it go stale — a wrong ACR is
worse than no ACR at all when a district relies on it.
