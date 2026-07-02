# CRUSH-Canva Plan — lead-authored ranked execution map (2026-07-02)

Source: 65 verified findings across 7 lenses ([05-EDITOR-CRUSH-LENSES.md](05-EDITOR-CRUSH-LENSES.md)),
every one grounded in file:line. Greg's mandate: *"i dont feel like our template
editor is easier than canva and i want to crush our competition...what are we missing."*

## The verdict (canva-benchmark lens, verified against 5 competitors)

**We already out-edit every signage rival on raw canvas mechanics** (marquee
multi-select, labeled snap guides, 8 handles, 50-deep undo, on-canvas text
editing, 400+ live-preview widget tiles — Yodeck/OptiSigns/ScreenCloud have
none of that depth). What makes it *feel* worse than Canva is not missing
machinery — it's (a) defaults that fight the operator, (b) a thin safety net
around save/undo, (c) three template architectures wearing one chrome with
silently different capabilities, and (d) our two real moats (live-data
widgets, publish-to-fleet) buried where nobody sees them. Win condition =
4 parity fills + 3 moat promotions, NOT a rewrite.

## Wave A — "Feels like Canva" (all default-behavior + modifier keys, NO new settings)

The tactile fixes. Domain: `apps/web/src/components/template-builder/` + `snap-engine.ts` + `useBuilderStore.ts`.

| # | Fix | Sev | Effort |
|---|---|---|---|
| A1 | Decouple grid-visible from movement-quantized — 1:1 pointer drag, element/canvas snap on RAW position, grid lines become snap TARGETS (snap-engine.ts:49-52, BuilderCanvas.tsx:390-394) | P0 | S |
| A2 | Coalesce per-keystroke undo snapshots — typing one headline = ONE undo step (stops 50-deep history eviction) | P0 | S |
| A3 | Group resize: bounding box + corner handles scale whole multi-selection (store already ready via selectedIds[]/updateZones; fix onResizePointerDown collapse at BuilderCanvas.tsx:355-363) | P1 | M |
| A4 | Alt-drag duplicates (duplicateZone exists — wire the gesture) | P1 | S |
| A5 | Resize modifiers: corner = aspect-lock by default on IMAGE/LOGO/VIDEO, shift toggles, alt = from-center (BuilderCanvas.tsx:402-418) | P1 | S |
| A6 | Right-click context menu — pure re-exposure of shipped store actions (duplicate/copy/paste/delete/layer/lock/copy-style) | P1 | M |
| A7 | Snap upgrades: canvas thirds + equal-gap badges + real-pixel distance labels (convert % via meta.screenWidth) | P1 | M |
| A8 | Distribute-evenly action + surface align buttons out of collapsed section | P1 | S |
| A9 | Brand-apply becomes ONE undoable history step | P1 | S |

## Wave B — Content at fingertips (unbury what's already built)

Domain: palette/pickers (`VariantPicker`, `variants-register.ts`, asset picker, background panel).

| # | Fix | Sev | Effort |
|---|---|---|---|
| B1 | **Pexels in-editor stock-photo search** — service is FULLY BUILT server-side (stock-image.service.ts), zero-cost, invisible to operators. Expose as a photo tab in the image picker + background panel | P0 | S |
| B2 | SHAPE widget: rect/circle/line/arrow/divider primitives | P1 | M |
| B3 | Un-dead the 8 Decoration elements (built + editable, dead palette registration — the WidgetPalette bug class, CLAUDE.md rule #9) | P1 | S |
| B4 | Canvas-level file drop (today a missed drop NAVIGATES THE TAB to the file and unmounts the builder) | P1 | S |
| B5 | Icon library (searchable, not type-an-emoji) | P1 | M |
| B6 | Palette drops use the shipped smart-size map; AI image-gen entry inside the picker; stock photos in background panel | P2 | S×3 |

## Wave C — Safety net (the meta-loop where we trail Canva most)

Domain: `useBuilderStore.ts` save path + templates API.

| # | Fix | Sev | Effort |
|---|---|---|---|
| C1 | Autosave + draft recovery (crash/killed tab currently loses EVERYTHING since manual Save) | P0 | M |
| C2 | Staleness guard on Save (today: blind delete-all-and-recreate; two tabs silently clobber) | P1 | S |
| C3 | Version history (even last-5 snapshots kills the "one bad Save is unrecoverable" class) | P1 | M |
| C4 | Undo coverage sweep: touch mode / idle-reset / scene ops currently skip history | P2 | S |

## Wave D — AI flow completion (finish what's 90% shipped)

Domain: AI picker + `ai.service.ts` + shim.

| # | Fix | Sev | Effort |
|---|---|---|---|
| D1 | Tweak + Translate in the DEFAULT Concierge→Designer picker + full-screen preview (the refine loop exists in the legacy path and silently vanished from the default one) | P0 | S |
| D2 | AI-Designer boards get real photos — extend attachKeptBoardPhoto to designer HTML via `data-photo-query` slots | P1 | M |
| D3 | Brand tokens on AI HTML: emit the CSS vars the shim maps (today Apply-brand is a silent no-op on AI boards) | P1 | M |
| D4 | One-tap "Make it an AI photo" reachable from the V2 builder | P1 | S |

## Wave E — Seams + moats (the strategic wave; E5 needs Greg sign-off)

| # | Fix | Sev | Effort |
|---|---|---|---|
| E1 | Capability badges per template kind in gallery/editor ("Live-data canvas" / "Designed board") — kill the silent 3-way capability lottery | P0 | M |
| E2 | Chat-to-edit on the 107 packaged EXTERNAL_HTML boards (works on the other 2 architectures; silently fails on the middle one) — MOAT | P0 | M |
| E3 | **Publish-to-screen from INSIDE the editor** — the single biggest moat, hidden at the moment of highest intent; also fixes the builder dead-end after editing a kept AI board — MOAT | P1 | S |
| E4 | Promote live-data binding into the editor chrome (the one thing NO competitor can do, currently buried in the no-selection panel) — MOAT | P1 | M |
| E5 | STRATEGIC (Greg decision): converge NEW static content on the AI-designer HTML architecture (shim V6), keep React zones exclusively as the live-data engine; de-leak "Designer (HTML)" wording from the 4-way type toggle | P1 | S |
| E6 | Element delete/blank on HTML boards (clearing a field currently resurrects default copy) | P1 | S |

## Deferred (L-effort, post-launch)

Canva Connect OAuth (Sprint 11, #260), word-level RICH_TEXT, image-editing
suite (crop/flip/BG-removal), group/ungroup persistence, TRUE magic-resize
reflow (today = % stretch; competitors' Magic Switch re-typesets), font
self-hosting for the 13 phantom fonts (quick partial: prune unloaded fonts
from pickers — S).

## Sequencing + fences

A ∥ B are disjoint domains (canvas engine vs palette/pickers) — safe parallel.
C touches the store's save path — run AFTER A merges (both edit useBuilderStore).
D is API+picker — parallel-safe with A/B. E after A-D (touches chrome + gallery).
Every fix lands with its regression test; A1/A2/C1 get explicit specs (the
drift-catcher discipline). Mobile-perf guard + taurus-safety on everything
(builder is desktop-first but shares components).
