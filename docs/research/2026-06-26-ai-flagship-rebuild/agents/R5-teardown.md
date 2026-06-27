# R5 — "Why our AI templates + images look like trash" teardown

**Scope:** code-verified diagnosis of the AI template generator + AI image
generator. This is the *why it's garbage* document. Every claim is cited to a
file:line in our own repo. No web. The rebuild plan (R-synthesis) builds from
this.

**Files read:**
- `apps/api/src/ai/ai.service.ts` (prompts, sanitizer, image gen)
- `apps/api/src/templates/templates.controller.ts` (`applyBrandToZoneConfig`, persist path)
- `apps/web/src/components/widgets/WidgetRenderer.tsx` (`TextWidget`, dispatch, defaults)
- `apps/web/src/components/template-builder/BuilderZone.tsx` / `BuilderCanvas.tsx` (render + scaling + background)

---

## TL;DR — the root cause in one sentence

The AI is asked to emit **only a flat list of free-floating, percentage-positioned
boxes with a widget type and a sentence of copy** — and nothing else. It has **no
grid, no design system, no theme, no palette, no typography scale, no background,
no per-industry intelligence, and no orientation awareness**. The renderer then
drops those boxes onto a **white `#ffffff` canvas** with **600-weight slate-grey
text in the browser default font**. That is structurally incapable of producing a
designed board — it produces a Word document with floating text boxes. Our
hand-built themed widgets (Rainbow Ribbon, HS Varsity, etc.) look great *precisely
because the AI path can never reach them* — the AI is restricted to ~18 generic
primitives (`TOUCH_GEN_ALLOWED_WIDGETS`), none of which are the designed scenes.

---

## GAP 1 — Free-form %-coordinate placement, no grid/layout system → overlap, no hierarchy, no alignment

**Where:** `TOUCH_TEMPLATE_SYSTEM_PROMPT` (ai.service.ts:1993–2097) and
`SIGNAGE_TEMPLATE_SYSTEM_PROMPT` (ai.service.ts:2121–2165). Each zone is
`{ x:0–100, y:0–100, width:3–100, height:3–100 }` raw percentages
(ai.service.ts:2009–2012). The renderer applies them verbatim as CSS:
`left: ${zone.x}%; top: ${zone.y}%; width: ${zone.width}%; height: ${zone.height}%`
(BuilderZone.tsx:360–363).

**Why it's trash:**
- An LLM emitting raw floats has **no concept of a baseline grid, gutters, or
  alignment**. Two zones at `x:10,width:45` and `x:52,width:45` look "aligned" to
  the model but are 3% (≈115px at 4K) misaligned on screen — visible as ragged
  edges. There is nothing snapping them to a column.
- The **only** overlap guard is a *prose instruction* — "No two zones should
  overlap by more than 10%" (ai.service.ts:2047, 2156) — which is **not
  enforced anywhere**. `sanitizeTouchTemplate` (ai.service.ts:2491–2666) clamps
  each zone to `[0,100]` and shrinks zones that overflow the canvas
  (ai.service.ts:2619–2621) but does **zero** collision detection between zones.
  Overlapping boxes ship straight to the DB.
- There is **no hierarchy primitive**. The prompt says "make headline/title zones
  large" (ai.service.ts:2157) but nothing computes a type scale or a focal point.
  The model guesses sizes per-zone with no relationship between them.
- `TOUCH_CANDIDATE_DIRECTIVES` (ai.service.ts:2106–2110) are the *only* gesture at
  hierarchy — three English sentences ("hero-led", "grid", "balanced"). They are
  appended to the user prompt and the model is free to ignore them; nothing in the
  schema or sanitizer makes "hero-led" actually produce one dominant element.

**World-class instead:** a real layout engine, not free floats. Options, in order
of leverage:
1. **Constraint/template-slot system** — the AI picks a named *layout archetype*
   (e.g. `hero-left`, `thirds`, `sidebar-rail`, `centered-stack`, `grid-2x2`) from
   a curated set, and the server resolves that archetype into pixel-perfect,
   gutter-aware, grid-snapped zone rects. The AI chooses *which* layout + *what*
   goes in each slot; it never emits raw coordinates. (This is how Canva "Magic
   Design", Beautiful.ai, and Gamma work — the model fills slots, humans/engineers
   designed the slots.)
2. If keeping coordinates: post-process through a **12-column grid snap +
   collision resolver** in `sanitizeTouchTemplate`, and a **safe-margin inset**
   (no zone may touch the 0/100 edges — boards need bleed margins). Today zones can
   sit flush at x:0,y:0 to the pixel.
3. Emit a **type scale** (title/subtitle/body as ratios off a base) so the model
   can't make the headline and body the same size.

---

## GAP 2 — No design system: no theme tokens, no type scale, no palette intelligence, no font pairing

**Where:** The generated template carries **no `theme`** on any zone. The whole
themed-widget system keys off `config.theme` (WidgetRenderer.tsx:1208–1239 is the
TextWidget theme switch — 30+ themes), but the AI prompt never mentions `theme`,
`fontFamily`, `fontSize`, color, or any token. The allowed widget list
(ai.service.ts:2004–2008) is the **generic** primitives only — `TEXT`,
`ANNOUNCEMENT`, `TICKER`, `QUOTE`, etc. — i.e. the AI is **architecturally
prevented from reaching any of the designed themes** (`rainbow-ribbon`,
`hs-varsity`, `storybook`, …). Those themes are the only thing in the app that
looks like a product.

**Why it's trash:**
- The fallback `TextWidget` renders **font-weight 600 slate-grey (`#1e293b`) in the
  browser default font** (WidgetRenderer.tsx:1240–1244). No type pairing, no
  display face, no tracking, no scale. Every AI text zone is the same grey
  semibold blob.
- There is **no palette object** in the output. The model can't express "primary /
  accent / surface / ink" or apply a coherent 3-color scheme. Color only ever
  arrives later via `applyBrandToZoneConfig` (see GAP 4), and even that only sets
  `color` + `accentColor` + `fontFamily` as *fill-the-blank* on individual zones —
  it is not a design system, just three property pokes.
- **No font pairing.** A flagship board pairs a display face (headline) with a
  legible body face. We ship one `fontFamily` (heading) at most, applied to
  everything (templates.controller.ts:182).

**World-class instead:**
- A **design-token contract** the AI fills: `{ palette:{primary,accent,surface,ink,
  muted}, type:{display,body, scaleRatio}, radius, shadow, motif }`. The renderer
  resolves tokens to CSS variables once at the template root; every zone reads
  `var(--ink)` etc. (Figma/Tailwind-tokens model.)
- A **curated theme library the AI can select from** (it already exists — 30+
  themes!). Let the AI pick a `theme` per the prompt + vertical and route generated
  copy into the *themed* widget renderers instead of the generic grey ones. This
  alone would 10× the output quality with near-zero new design work.
- **Algorithmic palette intelligence**: derive a harmonious 5-color ramp from the
  brand primary (analogous/complementary, WCAG-AA-checked contrast pairs) so text
  on surface is always readable. Nothing in the codebase computes contrast today.

---

## GAP 3 — White/empty backgrounds, no imagery, no gradients, no texture

**Where:** Neither prompt ever instructs the model to set a background, and the
schema has **no field** for `bgColor`/`bgGradient`/`bgImage` at the template level
(ai.service.ts:1998–2043, 2126–2151). The persist path therefore receives
`body.bgColor` = undefined and falls back to `brand.surface ?? null`
(templates.controller.ts:801–803). When that's null, `BuilderCanvas` renders the
canvas as **literal white**:
```
: { background: meta.bgColor || '#ffffff' }   // BuilderCanvas.tsx:483
```
And every generic `TextWidget` background is `transparent`
(WidgetRenderer.tsx:1245) — so the boxes float on white.

**Why it's trash:** A premium signage board is **never** flat white. It has a
gradient/photographic/textured background with content layered on top
(see our own Storybook/Rainbow themes — the CLAUDE.md "Template Design Workflow"
section literally rails against "rounded rectangle with shadow on a white
background"). The AI path produces exactly the thing the design doctrine forbids.

**World-class instead:**
- The output contract must **require** a background decision: solid token,
  2–3-stop gradient (with angle), or generated/stock image. For a hero board the
  default should be a gradient or image, *not* white.
- Wire **AI image generation into the template generator** so a "create a board"
  call can also generate an on-theme background image (we already have
  `generateImage` — it's just not connected to template gen).
- Ship a **texture/gradient/pattern primitive** the AI can drop as a backing layer
  (we have `DECORATION` and `ANIMATED_BACKGROUND` widgets — neither is offered to
  the AI in `TOUCH_GEN_ALLOWED_WIDGETS`/the prompt).

---

## GAP 4 — Brand palette barely applied (three property pokes, fill-the-blank only)

**Where:** `applyBrandToZoneConfig` (templates.controller.ts:164–235). It does
exactly three generic things, all gated on `=== undefined` (i.e. only if the AI
left the field blank):
- `cfg.color = brand.ink` (line 181)
- `cfg.fontFamily = brand.fontHeading` (line 182)
- `cfg.accentColor = palette.accent` (line 195–197)

Everything else is **HS-widget-specific** (`widgetType.startsWith('HS_')`,
lines 203–232) — and the AI **never emits `HS_*` widgets**, so that whole block is
dead for AI output. `brandPrimary`/`brandAccent` are only set inside the HS branch
(lines 230–231), so AI-generated zones never receive a primary color at all.

**Why it's trash:**
- The brand "application" is a thin wash of one ink color + one accent on top of
  the grey defaults. There's **no brand-driven background, no brand gradient, no
  brand-tinted surfaces, no brand-shaped motif**. The board doesn't *feel* like the
  venue; it feels like a grey template with one accent line.
- It is **fill-blank only**, so the moment the AI emits its own `color`
  (it usually doesn't, but if it did), brand is ignored — there's no "brand wins"
  mode.
- `buildImageBrandHint` (ai.service.ts:1755–1784) does pass brand name + 2 hexes +
  voice into the *image* prompt as a sentence, but a hex in a prose prompt is a
  *suggestion* the image model routinely ignores — it is not enforced and there's
  no post-gen palette check.

**World-class instead:** brand should drive a **full resolved theme** (palette ramp
+ surface + on-color text + accent + font pairing + motif), applied at the template
root as tokens, not three optional per-zone property writes. The AI should *receive*
the brand tokens in its prompt and *compose with* them, and the server should
*enforce* them on the way out.

---

## GAP 5 — Generic widget styling, zero visual polish on the AI primitives

**Where:** The AI can only use `TOUCH_GEN_ALLOWED_WIDGETS` (the ~18 in
ai.service.ts:2004–2008). Their default renderers are intentionally plain:
- `TextWidget` — transparent bg, grey 600-weight, default font, centered, 5% pad
  (WidgetRenderer.tsx:1240–1289). No card, no shadow, no shape, no motif.
- `ANNOUNCEMENT`/`QUOTE`/`TICKER` default variants are similarly unstyled boxes.

Contrast with what the app *can* render: `RainbowRibbonText`, `StorybookText`,
`HsVarsityWidget`, etc. — real SVG shapes, textures, shadows. The AI path is
**locked out of all of them.**

**Why it's trash:** even with perfect layout + a background, the *contents* of each
zone are unstyled grey text. There's no elevation, no cards, no dividers, no
iconography, no shape language — the visual vocabulary CLAUDE.md's design workflow
demands ("Every widget is a SHAPE… never a rounded rectangle with a shadow").

**World-class instead:**
- Route AI copy into **themed widget variants** (cards, ribbons, callouts) selected
  by the chosen theme, not the bare generic renderers.
- Give the generic widgets a **polished default** (subtle surface card, token-driven
  radius/shadow/border, display font for headings) so even un-themed output looks
  intentional.
- Let the AI set per-zone `variant`/`theme` (the renderer already supports
  `cfg.variant` dispatch — WidgetRenderer.tsx:399–432 — the AI just isn't told it
  exists).

---

## GAP 6 — No per-industry design intelligence

**Where:** The *only* vertical signal that reaches generation is:
- A one-sentence **voice** clause prepended to the system prompt (`VERTICAL_VOICE`,
  ai.service.ts:137–162; applied via `prependVoices`, ai.service.ts:189–198).
- A single interpolated user-prompt line `Vertical: ${vertical}`
  (ai.service.ts:1448).

That clause only governs **copy tone** ("hype" vs "calm"). It has **zero** influence
on layout, palette, typography, imagery, or widget selection.

**Why it's trash:** A gym board, a QSR menu, a healthcare check-in, and a
sports-venue hype screen should look *radically* different — different layouts,
color energy, density, motion, and widget sets. Today they're the same grey
floating-box layout with slightly different sentences. There is **no per-vertical
layout archetype, no per-vertical palette, no per-vertical default theme, no
per-vertical widget preference**.

**World-class instead:** a **per-vertical design profile**: default theme(s),
palette mood, type pairing, density, preferred layout archetypes, and a curated
widget allowlist (QSR → menu/price/specials; healthcare → calm wayfinding/queue;
sports → scorebug/hype). The AI selects within that profile. (We already enumerate
verticals in `packages/api-types`; the design intelligence layer is missing.)

---

## GAP 7 — Orientation / screen-size handling is an afterthought

**Where:**
- The prompt **hardcodes landscape**: "Pick zones that fit a 1920×1080 landscape
  canvas unless told otherwise" (ai.service.ts:2073, 2163), and the worked example
  is landscape (ai.service.ts:2073).
- Orientation is passed only as one interpolated string line:
  `Canvas: ${sw} × ${sh} px (${sh > sw ? 'portrait' : 'landscape'})`
  (ai.service.ts:1449). The single-shot path doesn't even compute portrait
  (ai.service.ts:850 always says "(landscape)").
- Because coordinates are **percentages**, a layout authored for 16:9 is *stretched*
  onto a 9:16 or 6:1 LED ribbon — a centered hero at `x:10,width:80,y:40,height:20`
  becomes a squashed sliver on portrait and an unreadable smear on a ribbon. There
  is **no reflow** — the same percentages just map to a different aspect ratio.
- LED ribbon / Taurus targets (e.g. 960×1080, 320×1080 strips) get **no special
  handling at all** in the generator.

**Why it's trash:** percentage coordinates do not survive aspect-ratio changes. A
real responsive system reflows content per orientation; ours rescales the box
rectangle and prays.

**World-class instead:**
- Generate **per-orientation layout archetypes** (the model should produce a
  portrait-native stack for portrait, not a stretched landscape).
- Honor **extreme aspect ratios** (ribbon/strip) with dedicated archetypes
  (single-line ticker, score strip) rather than a scaled 16:9 grid.
- Enforce **safe margins + min legible font** per the physical canvas (CLAUDE.md
  already has an "auto-fit ≥50px floor" rule for hand-built boards — the AI path
  ignores it entirely).

---

## Secondary findings (compound the above)

- **Image gen is one-shot, unbranded-in-practice, no style system.** `generateImage`
  (ai.service.ts:1545–1733) sends `prompt + brandHint` to gpt-image-1/dall-e-3/Imagen
  with no negative prompt, no style preset, no aspect-ratio-to-layout coupling, no
  quality param, and no consistency seed. The brand "hint" is prose (a hex in text
  → ignored by the model). Result: generic stock-looking images that don't match the
  board they're (not) wired into. There is **no link from image gen → template
  background** at all.
- **The generic widgets are the only thing the AI can use, and they're the worst-
  looking widgets we ship.** The fix with the highest leverage/effort ratio:
  expand `TOUCH_GEN_ALLOWED_WIDGETS` + teach the prompt about `theme`/`variant`,
  so AI output routes into the *designed* renderers we already built.
- **No collision/alignment/contrast validation in `sanitizeTouchTemplate`.** It is
  a *security* sanitizer (XSS/SSRF/proto-pollution — ai.service.ts:2682–2713,
  2537–2605), not a *design* validator. Nothing checks overlap, alignment, contrast,
  text-fits-zone, or empty-board.
- **White-canvas default is hard-coded** at `BuilderCanvas.tsx:483` — even a
  brandless tenant should get a tasteful neutral surface, not `#ffffff`.

---

## Priority order for the rebuild (highest leverage first)

1. **Route AI output into the existing themed widgets** (pick `theme`/`variant`;
   expand the allowlist). Biggest visual win, smallest build — the good renderers
   already exist.
2. **Replace free-float coordinates with layout archetypes** resolved server-side
   to a grid (kills overlap + ragged alignment + bad hierarchy in one move).
3. **Require a background decision** (gradient/image/token) — kill the white canvas;
   wire image-gen → template background.
4. **Design-token contract + algorithmic palette/contrast** from brand (real brand
   application, AA-safe).
5. **Per-vertical design profiles** (theme + palette + density + widget set +
   archetypes).
6. **Per-orientation archetypes + ribbon/strip handling + min-font/safe-margin
   enforcement** in the sanitizer.
7. **Image-gen upgrade**: style presets, negative prompts, aspect coupling,
   enforced palette, consistency.
