# AI-board typography hardening — 2026-06-30

Greg's verdict on a generated ARC/e-arc.com board: *"looks like trash… i look
like a serial killer with this template,"* and **"ensuring our text and font is
perfect needs to be a number 1 priority."**

Root cause of the "serial killer" look: the AI was rendering per-row **values**
(Same Day / Monthly / By Project) as **solid white pill boxes** on the saturated
red field, plus a **white highlighter box** behind one headline word. Solid-fill
boxes dropped behind individual words read as **censorship/redaction bars** — the
single biggest amateur tell. (Plus a separately-fixed text-overlap bug.)

## What this folder holds

- `synthesis.json` — the merged output of a 6-critic adversarial design
  workflow (lenses: redaction-boxes · collision-robustness · contrast-legibility
  · hierarchy/pairing · spacing/rhythm · premium-benchmark) → a synthesizer that
  produced: `bannedPatterns` (12), `typographyPriorityBlock` (13 rules),
  `exemplarCssChanges` (6), `contractAdditions` (10), `rankedRisks` (8).

## What shipped from it (`apps/api/src/ai/designer-prompt.ts`)

1. **TYPOGRAPHY IS PRIORITY ONE** block inserted at the TOP of
   `DESIGNER_SYSTEM_PROMPT` (leads before composition/color/imagery; the #1 LAW =
   no redaction bars; emphasize with color/weight, not boxes; contrast-by-color
   ladder; contrast + size floors; font-pairing-by-mood; type scale; tracking law;
   leader-row anti-collision; single-max-filled-element; palette/signature
   discipline; a pre-output self-check).
2. **Exemplar CSS** made the anti-redaction pattern explicit: `.pr` is
   `background:none;border:0;border-radius:0;padding:0` (accent-color + weight 800
   only), `.wordmark span{background:none}`, eyebrow bumped to the 26px floor, and
   a single correctly-modeled accent **`.cta`** button added so the model knows
   what the ONE allowed filled element looks like.
3. **LAYOUT CONTRACT / QUALITY BAR** additions: one 8px spacing grid, symmetric
   safe-area frame, photo-panel gutter, reserved-footer clearance (JS==CSS),
   grid-locked columns, even row rhythm, focal hierarchy + intentional asymmetry,
   layered depth, brand-literate copy (no generic "Same Day" filler).
4. **Taurus audit** now flags `box-decoration-break` (Chromium-83-unsafe).

The earlier collision fix (`.nm` flex / `.dots` / `.pr` flex-shrink) landed in
`1138fa6d`; this pass makes the exemplar's value box-free and bakes the full
typography law into the prompt.
