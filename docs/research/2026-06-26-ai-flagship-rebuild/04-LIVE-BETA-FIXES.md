# AI Flagship — Live Authed Beta Test + Fixes (2026-06-27)

Greg: *"ok your logged in so please do the full beta test of everything … i
noticed your sales add up is not centered in the page, that might be a bug but
not sure … test everything."*

Live authed test driven through the real dashboard (Los Angeles Dodgers tenant,
SUPER_ADMIN). Two real, user-visible defects in the AI flagship found and fixed,
both verified on the live deployed React render.

---

## BUG 1 — AI signage boards rendered catastrophically (THE "garbage" bug)

**Live repro.** Templates → "Generate with AI" → Display (no touch) → prompt
"Tonight's game: Dodgers vs Giants, 7:10 PM …". The candidate thumbnail looked
clean, but opening it in the builder showed the title **"Dodgers vs Giants" at
153px wrapping to 3 lines, overflowing its zone and overlapping the CTA pill**.
At 25% zoom only the middle word "vs" was visible (the wrap centered "vs" and
clipped "Dodgers"/"Giants" at the zone edges).

**Root cause (two parts), confirmed against the saved DB row:**
1. The engine assigns real typefaces (headline `fontFamily:"Oswald"`,
   `fontSize:153`). **The `SignageText` render path loaded NONE of the engine
   fonts** (Oswald/Poppins/Montserrat/Playfair/Sora/Barlow/Cormorant/Space
   Grotesk) — every themed widget loads its own via inline `@import`, but the
   engine path loaded nothing. The browser fell back to a wide serif (Times),
   so the 153px that fits one line in *condensed* Oswald overflowed to 3 lines.
2. `SignageText` honored the px size **verbatim** with `overflow-hidden` and no
   fit guarantee → any oversize just clipped/overlapped.

**Fix** (`apps/web/src/components/widgets/WidgetRenderer.tsx`, commit `dea4ed38`):
- `useSignageFonts()` injects the full engine font set once into `<head>` (own
  `<link>`, never removed — safe under React 19 rule #6).
- `FitScaler` wraps all four `SignageText` layouts (plain / button / card /
  row): measures content vs its zone (padding-aware) and applies
  `transform:scale` **down only**, re-measuring on resize + once webfonts load.
  Scale 1 (full intended size) is the common case once the right font is loaded,
  so a correctly-sized board renders at full premium size; a long headline,
  un-loaded font, or odd canvas can never overflow again. Also fixes QA
  finding #3 (CTA pill overflow). Taurus-safe (ResizeObserver Chrome 64+,
  FontFaceSet.ready Chrome 35+, longhand inset, no gap).

**Verified:** standalone harness with the exact DB config, THEN the live
deployed builder — the same template now renders "Dodgers vs Giants" as one
clean condensed-Oswald line with the CTA pill fitting below. (Screenshot in
session.)

---

## BUG 2 — "Three takes" picker showed only ONE card, left-hugging ("not centered")

This is almost certainly the *"sales add up is not centered in the page"* Greg
flagged: the AI "Pick your favorite" modal promises **"Three takes on your
idea"** and lays out a 3-column grid, but the engine (Display/no-touch) branch
returned `candidates:[oneBoard]`. The single card sat in the **left column** of
the 3-col grid → reads as "not centered." The operator also never got the 3
options the credit copy ("uses up to 3 of your monthly AI credits") promised.
(Ruled out as the culprit first: marketing homepage, /pricing, and
Settings → Monetize — all correctly centered.)

**Fix** (commit `ba5cef96`):
- `AiService.generateSignageBoardCandidates()` — fans out up to `count`
  (default 3) art-director boards in parallel, each biased toward a distinct
  archetype family (`SIGNAGE_CANDIDATE_DIRECTIVES` → Balanced / Bold /
  Detailed) so the takes actually differ. Mirrors the proven touch-candidate
  fan-out: `Promise.allSettled` (one bad spec can't sink the batch), spend
  recorded per **successful** candidate (honest 3-tier accounting), single
  `AI_SIGNAGE_BOARD_CANDIDATES` audit row, real error surfaced only when ALL
  fail. Image-free — the chosen board pays the image cost on accept.
- Extracted `buildSignageBoardCore()` (dispatch→parse→map→sanitize) so the
  single-shot `generateSignageBoard` and the fan-out share one code path — zero
  behavioral drift.
- `templates.controller.ts` engine branch now calls it with `body.count` and
  returns all candidates.
- FE picker grid (`templates/page.tsx`) centers gracefully on partial results:
  1 → `max-w-xs mx-auto`, 2 → 2-col `max-w-2xl`, 3 → full 3-col. A sub-3 batch
  is never left-hugging again.

**Verification:** API + web `tsc` clean; 117 ai/templates jest tests green.
Live 3-candidate render pending the `ba5cef96` Vercel deploy.

---

## Status
- `dea4ed38` (font + fit) — CI green, **live-verified** on the deployed builder.
- `ba5cef96` (3 takes + grid centering) — CI watch + Vercel deploy in progress.
- Both are the highest-leverage fixes for "make the AI templates the prize."
