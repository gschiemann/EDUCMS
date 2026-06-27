# 01 — PLAN CRITIQUE: Stress-Test of the AI Flagship Rebuild

**Date:** 2026-06-26 · **Reviewer role:** skeptical principal design+eng reviewer
**Reviewed:** `00-FLAGSHIP-PLAN.md` against recon R1–R6 and the live codebase
(`ai.service.ts` 2716 lines, `BuilderZone.tsx`, `WidgetRenderer.tsx`,
`templates.controller.ts`, `packages/api-types/src/verticals.ts`,
`template-builder/ScenesPanel.tsx`).

---

## VERDICT (up front)

**Ship-worthy as the build blueprint — with conditions.** The core architectural
diagnosis is correct, code-verified, and matches every SOTA tool in R3. The
archetype + token + rules-engine + imagery decomposition is the right spine and
I would not rebuild it differently. The Phase-1 ordering is *mostly* right but
has one inversion that will cost a week of "looks like trash" perception. The
plan is buildable on our NestJS + Next zone/widget model **without a ground-up
rewrite** — the zone schema is the output of the new pipeline, not a thing we
throw away — but it **materially underestimates three build costs** (archetype
authoring, the `WidgetRenderer` themed-routing surface, and the LLM-output
contract migration / re-sanitize round-trip) and is **missing four things**
that separate "beats OptiSigns" from "matches it": a designer-curated archetype
*library at depth*, human-in-the-loop refine loop, motion/video backgrounds as
first-class (not Phase-3 afterthought), and data-bound-from-birth pulled forward.

Net: it beats OptiSigns/Rise on the **white-space lanes** (screen-physics,
brand, sports/safety) if executed — but as written it risks shipping a Phase 1
that is *more constrained and less varied* than OptiSigns rather than visibly
more beautiful. The fixes below close that gap.

---

## 1. Does it ACTUALLY beat OptiSigns 10x, or just match it? — Gaps vs R1/R2

**Where it genuinely 10x's (real, defensible, uncontested per R2 white-space):**
- **Screen-physics-correct generation + auto-reflow** (R2 #1, R1 #4). OptiSigns
  makes the user pick orientation up front and has *no confirmed magic-resize*.
  We already solve the canvas/Taurus problem in rendering. Archetype-based
  reflow is a real moat. ✅ Strongest claim in the plan.
- **Sports + life-safety AI** (R2 #2) — uncontested. Daktronics has the data,
  zero generative AI; OptiSigns/Rise have AI, zero sports. We have both. ✅
- **Brand-as-full-theme** vs OptiSigns' "add your brand images" (R1 #6). ✅ if
  `deriveThemeFromBrand` actually wins (see §2 risk).

**Where it only MATCHES (the honest gaps the plan soft-pedals):**

1. **Library depth.** R1/R2 are blunt: OptiSigns ships **1,000+ templates / 15
   verticals**, Raydiant 150k, Yodeck 700–800, Rise 750+. The plan ships **~12–16
   archetypes × ~12–16 themes**. Combinatorially that's ~200 looks, but a buyer
   *browsing a gallery* sees 16 layouts, not 1,000 designs. **"Generate" beating
   "browse" is unproven for the buyer who was dazzled by a deep gallery.** The
   plan never states a library-depth target or a "generated designs also populate
   a browsable gallery" story. This is the single biggest *perception* gap vs R1.
   → See change #1.

2. **Candidate variety.** OptiSigns/Canva show **8–12** candidates; Rise shows 3.
   The plan ships **3** (matches Rise, under OptiSigns). With a *constrained*
   archetype set, 3 candidates from 16 archetypes can feel samey fast. The plan
   leans on "constrained space makes all 3 land well" — true for *quality*, but
   it trades away the *variety* that made the OptiSigns demo feel "amazing." 3 is
   the floor, not a 10x. → consider 4–6 with forced archetype+theme diversity.

3. **OptiDev (prompt → interactive app) and Revel Smart Scheduling** are the two
   genuinely novel competitor moves (R1 #8, R2 differentiated #1/#2). The plan
   correctly parks these in Phase 4 — but should *say plainly* that at Phase 1–3
   we are **behind** OptiDev on the "prompt → live app" frontier. The win is
   beauty + every-screen + brand + safety, **not** app-generation. Make that
   explicit so nobody over-claims "10x everything."

4. **Editing-after-generation** (R1 #2, OptiSigns' #1 review complaint). The plan
   leans on "our existing click-to-edit hot-zones." That's correct *for zones* —
   but the new pipeline introduces **archetype-locked geometry**. R3 §4c even
   says editing "stays inside the archetype's rules — they cannot break the
   design." Good for quality, but operators who want to *move a box* will hit a
   wall OptiSigns' free editor doesn't have. The plan needs an explicit answer to
   "can I nudge this?" (constrained handles + "unlock to free-edit" escape hatch).
   → See missing item, §5.

**Bottom line on the question:** It beats OptiSigns **on the four white-space
lanes** and matches-or-trails on **library depth, candidate count, and
app-generation**. That is a credible 10x *on the lanes that matter for our
verticals* — but the plan oversells "best the world has seen" without naming
where we're still second. Name it.

---

## 2. Is constrained-archetype the right architecture? Risks?

**Yes — this is correct and not a close call.** R3 verified it across Canva,
Gamma, Beautiful.ai, Framer, Durable, Uizard, Adobe Express: *not one* lets the
model free-place. R5 code-proved our failure is exactly free-float `{x,y,w,h}`
(`ai.service.ts:2009–2012` → `BuilderZone.tsx:360–363`, verified) with a *prose*
overlap guard nothing enforces and a security-only sanitizer. The fix is right.

**But the architecture carries five real risks the plan under-weights:**

1. **The "constraint ceiling."** Beautiful.ai is *correct* but also widely called
   *rigid* — its constraint is its #1 complaint. A 16-archetype library is a hard
   ceiling on expressiveness. If a customer's idea doesn't map to an archetype,
   the LLM force-fits it and output looks generic — the *exact* "rounded
   rectangle" regression CLAUDE.md warns about, just relocated from the LLM to a
   too-small archetype set. **Mitigation:** ship archetypes at *depth* (24–32, not
   12–16) and per-orientation, and add the free-edit escape hatch. The plan's
   "12–16" is too few to beat a 1,000-template gallery.

2. **Archetype authoring is the long pole and is badly underestimated.** The plan
   lists "~12–16 archetypes" as if it's a config file. But CLAUDE.md's own
   Template Design Workflow is *law* here: **"one template at a time, HTML mockup
   → user approval → React port → screenshot-verify; batch-building regresses to
   rounded-rectangle-with-shadow every time."** Each archetype × each orientation
   variant (landscape/portrait/ribbon) is effectively a hand-designed template
   that must pass that loop. 16 archetypes × ~3 orientations = ~48 designed
   artifacts under a no-batching rule the plan itself cites in §9. **This is the
   real schedule risk, not the LLM contract.** The plan's "~1–2 sprints" for the
   full archetype/orientation system (Phase 2) is optimistic by a factor; budget
   for it explicitly or the archetypes will be the thing that looks cheap.

3. **`deriveThemeFromBrand` is hand-waved and is make-or-break.** "Material-3-style
   tonal ramp with guaranteed-contrast text tokens" is one bullet
   (`themes.ts:deriveThemeFromBrand`). This is genuinely hard: a single brand
   primary → a 5-token palette that (a) hits 7:1/4.5:1 on every surface pairing,
   (b) doesn't look muddy, (c) survives a garish brand color (safety-orange,
   neon). If this is mediocre, *every brand-applied board* is mediocre — and
   brand-application is claimed as a decisive win over OptiSigns. This deserves
   its own spike, not a sub-bullet. Material 3's HCT algorithm exists; wire a real
   one, don't roll your own naive HSL ramp.

4. **The LLM may not reliably emit the new contract.** The plan assumes the model
   cleanly returns `{archetype, theme, copy, image, accentSlot, scenes[]}`. But
   our generation runs on **tenant-chosen models** (verified: `resolved.model`,
   BYOK Anthropic/OpenAI/Google, plus a platform Haiku-class key per CLAUDE.md).
   A cheap/weak tenant model picking a *valid archetype enum* and producing *good
   copy that fits the 3×5 cap* is not guaranteed. The recent commit history
   (`f3deced6`, `eb05d070`, `12d9430e` — "AI must generate CONTENT for every
   scene, not empty shells," "preserve scene assignment across the candidate
   re-sanitize round-trip") proves multi-scene structured output is *already
   fragile today*. Constraining harder helps validity but the **scene round-trip
   re-sanitize is exactly where this just broke** — and the plan layers more
   structure onto it. → Treat the contract migration + scene round-trip as a
   tested, defended surface with golden-output fixtures, not a prompt swap.

5. **Validator auto-correct can fight the LLM and the archetype.** Three systems
   now own geometry/size/color: archetype resolver, theme tokens, validator. When
   the validator flips a text token or drops a scrim to hit 7:1, it can override a
   *deliberate* theme choice and make a third thing nobody designed. Auto-correct
   precedence (archetype > theme > validator? or validator always wins?) must be
   specified or you get the "third unintended look" failure. The plan says
   "auto-correct where possible, flag otherwise" but not the precedence.

**Is there a better approach?** No fundamentally different one — every SOTA tool
converged here. The only *variant* worth considering: a **hybrid** where archetypes
expose a small number of *parametric knobs* (e.g. split ratio 40/50/60, focal
corner) the LLM can nudge within bounds, giving more variety without free-float
chaos. That's strictly better than fixed rects for variety-vs-quality and costs
little. Recommend folding it in (it's how Framer/Beautiful.ai actually behave —
"reflow," not "fixed").

---

## 3. Buildable on our stack without a ground-up rewrite? What's underestimated?

**Buildable — confirmed against code.** The new pipeline *produces* the existing
`zones[]`/`TemplateZone` shape as its output (resolver emits rects → same persist
path → same `WidgetRenderer`/`BuilderZone`). Nothing about the zone/widget model
is thrown away; we change *who computes the rects* (server resolver, not LLM) and
*what styling rides along* (theme tokens). The shared `packages/signage-design/`
fits our monorepo (verified: `packages/` already has api-types/auth-core/ws-events
with the `dist/index.js` + tsconfig pattern the plan correctly flags). Good.

**Underestimated / risky:**

- **`WidgetRenderer.tsx` themed-routing is bigger than "expand the allowlist."**
  Verified the file has **396 `theme` references** and a 30+ theme switch. The
  current AI allowlist is **18 generic primitives** (verified: `TEXT, RICH_TEXT,
  ANNOUNCEMENT, TICKER, CLOCK, WEATHER, COUNTDOWN, CALENDAR, IMAGE, …, DECORATION`).
  Phase-1A says "route AI copy into THEMED widgets." But the designed themed
  widgets (RainbowRibbon, HsVarsity, Storybook) have **bespoke content contracts**
  — they're not drop-in for arbitrary generated copy. Mapping `copy.headline` into
  each themed renderer's expected props is per-widget integration work, and some
  themed widgets are *too specific* (HS Varsity) to be generic AI targets. The
  "biggest before/after, smallest build" framing of 1A is **half right**: the win
  is real, the build is medium-to-large, not small. Don't promise 1A as a quick
  win across *all* themed widgets — pick the 5–6 that are genuinely generic.

- **Auto-fit ≥50px floor interacts with 3×5 copy cap and archetype rects.** Three
  constraints can be mutually unsatisfiable: a fixed archetype headline slot + a
  derived 6.5%-of-canvas type floor + the operator's actual words. If copy is too
  long, *something* gives (truncate / shrink below floor / overflow). The plan
  says "auto-fit + flag" but the resolution order across these three isn't
  specified. This is precisely the class of bug that ships looking broken at 4K.

- **Image-gen cost + latency at "3 candidates with generated backgrounds."** Phase
  2 demo = "branded hero with a *generated* food background." 3 candidates ×
  Imagen 4 Fast (~2.7s, $0.02) = ~8s added latency and $0.06/generation *just for
  preview backgrounds*, before the Ultra final. The plan's 30-second happy path
  survives that, barely — but multi-scene SET gen (4–6 images) blows the 30s
  budget. Need an async "backgrounds fill in progressively" UX, not a blocking
  wait. Also: Tier-1 platform-key budget (CLAUDE.md: ≤50 calls/tenant lifetime
  for setup AI) will be *shredded* by image gen if it routes to Tier-1. Decide
  the economic tier for image-gen explicitly — it almost certainly must be BYOK /
  metered, not platform-free.

- **New env keys + graceful-degrade matrix.** Adding Imagen/Ideogram/Recraft/
  Firefly each needs the `ANTHROPIC_API_KEY`-style "unset → degrade" handling,
  per-provider error mapping, and the Standard Audit Surface §3 treatment
  (every status code, AuditLog on success+failure, AbortSignal timeout). That's
  the audit floor for *each* provider — meaningful work the plan lists as one
  table row (§6 "Env / config").

- **Not underestimated, credit where due:** the plan correctly maps every change
  to real file:line, flags the Taurus longhand-sides requirement for the resolver,
  cites the connection between scene round-trip and the recent fix commits, and
  respects the Tier-1/BYOK model. The codebase grounding is genuinely good.

---

## 4. Are the Phase-1 quick wins the highest-leverage fastest "garbage → beautiful"? Reorder.

The plan's Phase-1 order is **1A (themed widgets) → 1B (kill white canvas) →
1C (theme tokens) → 1D (contrast/scrim) → 1E (archetypes, flagged)**.

**Two problems:**

1. **1A is mis-scoped as the "single biggest before/after, smallest build."**
   Per §3, themed-widget routing is medium-large and only some themed widgets are
   generic. Worse: routing grey text into a pretty *widget* while it still floats
   on a **white canvas with free-float overlap** does NOT read as "beautiful" — it
   reads as "nicer text boxes, still ragged, still on white." The *layout* and the
   *background* are what scream "amateur" from 8 feet, not the text widget skin.

2. **1E (archetypes) is the actual root-cause fix and it's last + behind a flag.**
   R3 §3 and R5 GAP 1 both say free-float placement is *the* structural cause.
   Putting the root-cause fix last means Phases 1A–1D polish output that is still
   structurally ragged. You can't make a board "beautiful" while boxes still
   overlap on a grid-less canvas.

**Recommended reorder (fastest visible garbage→beautiful):**

- **NEW 1 (was 1E + 1B): Archetype resolver for 4–6 landscape archetypes +
  kill the white canvas, together, NOT flagged for the demo path.** Grid-locked
  alignment + a real background (gradient/token surface) is the single biggest
  visible jump. This alone converts "Word doc with floating boxes" → "designed
  board." Do these two as one unit because an archetype with no background is
  still half the problem.
- **NEW 2 (was 1C + 1D): Theme tokens + brand-derived palette + contrast/scrim
  guard.** Now the aligned board on a real background gets coherent color + a
  font pair + guaranteed legibility. This is the second-biggest jump.
- **NEW 3 (was 1A): Route copy into the 5–6 genuinely-generic themed widgets.**
  Now that layout + background + palette are right, *upgrading the box contents*
  from token-default to designed widget is the cherry on top — and it's safe
  because the rules engine already guarantees the frame.

Rationale: fix structure (layout+bg) → fix system (palette+contrast) → fix
surface (widget skins). The plan does surface→system→structure, which polishes a
broken frame first. The before/after screenshot that "wins the room" needs the
*frame* fixed, and that's archetypes+background, not themed text widgets.

(1B's "require a background decision" should be *merged into the archetype
contract* anyway — every archetype declares its background mode, so "kill white
canvas" isn't a separate step, it's an archetype invariant.)

---

## 5. What's MISSING entirely

1. **A designer-curated archetype LIBRARY at depth + a browsable gallery story.**
   (Biggest gap.) 12–16 archetypes is an engine, not a product that out-demos a
   1,000-template gallery. Missing: (a) a target count (recommend 24–32 archetypes
   × per-orientation), (b) a plan to *populate a browsable gallery* from generated
   designs so the buyer who wants to "browse" isn't told "just type a prompt,"
   (c) the no-batching authoring schedule this implies. Without this, R1's
   library-depth advantage is unanswered.

2. **Human-in-the-loop REFINE loop** (R1 #2, the OptiSigns #1 complaint). The plan
   has "Reshuffle theme / Try another layout / Regenerate background" (good) but
   **no conversational refine** ("make the headline bigger," "warmer colors," "use
   our other logo," "move the focal point left"). Canva/Gamma/Beautiful.ai all let
   you *talk* to the design after generation. We already have a chat-to-edit
   surface in the builder (memory: chat-edit shipped). **Wire the existing
   chat-to-edit into the archetype/theme contract** so refine = adjust archetype
   params + theme tokens + copy, not free-edit. This is the difference between
   "generate-then-restart" and "generate-then-converse" — and it directly attacks
   the competitor's worst review. Pull to Phase 2.

3. **Motion + video backgrounds as first-class, not Phase-3.** R1 #5 names motion
   as a lane OptiSigns *has none of* (static effects + uploaded video only) — a
   clean beat-them win we already have the engine for (celebration cinematics).
   R6 §10.F gives the exact enforceable motion rules. Parking *all* motion in
   Phase 3 forfeits an easy, visible differentiator. At minimum: archetype-level
   tasteful entrance transitions (300–500ms ease-out, one element) belong in
   Phase 2, and **video/animated backgrounds** (we have `ANIMATED_BACKGROUND` and
   `VIDEO` widgets — verified neither is offered to the AI) are a bigger visual
   upgrade than a static generated image for many boards. The plan treats
   imagery=static; "beautiful by construction" on a passive board often means
   *subtle motion*, which we can do and they can't.

4. **Data-bound-from-birth pulled at least partially forward** (R2 white-space #4,
   the most defensible long-term moat). It's entirely in Phase 4. But the *menu
   board* archetype is meaningless without live price/auto-86 (we have the POS
   connector registry — task #224 completed, #201/#208 menu platform). A QSR
   demo with a generated menu board showing **fake prices** undercuts the whole
   pitch. At least the menu-list / score-strip archetypes should bind to the
   existing live sources in Phase 3, not Phase 4. "Generated and already wired"
   is the kill-shot nobody else has — don't bury it.

5. **Smaller but real omissions:**
   - **No eval/quality harness.** "Beautiful by construction" needs a measurable
     definition. Add a golden-set of prompts × verticals × canvases, rendered and
     scored against the R6 validator (contrast pass %, overlap=0, type-scale
     ratio, safe-margin) on every change — a regression gate, like the
     cross-browser/taurus CI gates. Otherwise "garbage → beautiful" is vibes.
   - **No free-edit escape hatch** (per §2). Constrained-by-default is right;
     *no* unlock is a complaint generator. Offer "unlock layout" for power users.
   - **Accessibility of the generated output beyond contrast** — R6 covers
     contrast/seizure, but Standard Audit Surface §18 (screen-reader, etc.)
     isn't addressed for AI output. Minor for signage, note it.
   - **Stock-imagery tier.** R3/R1 both note competitors lean on Unsplash. The
     plan's imagery is generate-or-brand; a curated stock fallback (cheaper,
     instant, zero AI cost) is missing and is the *cheap* default for the
     budget-conscious or AI-unconfigured tenant.

---

## The 3–5 most important changes to make it world-class

1. **Reorder Phase 1 to fix structure first: archetypes + background together
   (un-flagged), THEN palette/contrast, THEN themed-widget routing.** The
   root-cause fix (free-float → grid) must lead, not trail. Merge "kill white
   canvas" into the archetype contract (every archetype declares its background
   mode). This is what makes the before/after screenshot actually land.

2. **Commit to archetype DEPTH (24–32, per-orientation) + a populated browsable
   gallery, and budget the no-batching authoring loop honestly.** 12–16 is an
   engine that *matches* Beautiful.ai's rigidity, not a product that *beats* a
   1,000-template gallery. Add parametric knobs to archetypes (split ratio, focal
   corner) for variety without free-float, and bump candidates to 4–6 with forced
   archetype+theme diversity. This closes the only lane (library/variety) where
   the plan trails OptiSigns.

3. **Treat `deriveThemeFromBrand` + the validator auto-correct precedence + the
   LLM-contract/scene round-trip as three explicit, tested spikes — not
   sub-bullets.** Use a real HCT/Material-3 palette algorithm; define
   archetype > theme > validator precedence so auto-correct never invents a third
   look; add golden-output fixtures for the structured contract (the scene
   round-trip is *where this already broke*, commits `f3deced6`/`eb05d070`). These
   three are the make-or-break quality surfaces and are currently hand-waved.

4. **Pull human-in-the-loop conversational REFINE into Phase 2 by wiring the
   existing chat-to-edit into the archetype/theme/copy contract.** "Make it
   warmer / bigger / move the focal point" — adjusting params + tokens, not free
   geometry. This directly kills OptiSigns' #1 review complaint (editing) and is
   the difference between generate-then-restart and generate-then-converse.

5. **Promote motion/video backgrounds and (partial) data-binding out of Phase
   3/4.** Tasteful archetype entrance motion + offering our existing
   `ANIMATED_BACKGROUND`/`VIDEO` to the AI is an easy, visible beat-them win
   (competitors have no motion engine; we do). And bind the menu-list/score-strip
   archetypes to the live POS/score sources we already shipped, so the QSR/sports
   demos show *real* prices/scores — "generated and already wired" is the
   uncontested moat; a generated board with fake prices undercuts the pitch.

**Plus, throughout:** add a golden-set quality eval as a CI gate (the measurable
definition of "beautiful by construction"), keep a free-edit escape hatch for
power users, and in §1/§8 state plainly where we still trail (OptiDev
app-generation, raw gallery depth) so "10x" isn't over-claimed past the lanes we
actually own (screen-physics, brand, sports + safety).
