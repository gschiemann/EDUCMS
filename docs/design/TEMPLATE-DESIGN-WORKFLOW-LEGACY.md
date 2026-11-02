> **Superseded by `docs/design/FLAGSHIP-TEMPLATE-STANDARDS.md` (the binding spec); kept for history.**

This is the "Template Design Workflow" section of the old single-file `CLAUDE.md`. Two versions follow, in this order: first the pointer version that stood in `CLAUDE.md` after the truth-fix pull request (#208) collapsed the section earlier on 2026-11-01; then the original text, from before that pull request, unchanged.

# Template Design Workflow (legacy)

**As it stood after the truth-fix pull request (2026-11-01):**

## Template Design Workflow

The binding spec for any template work is `docs/design/FLAGSHIP-TEMPLATE-STANDARDS.md` and `.claude/agents/venueos-template-designer.md` (its always-loaded operating manual) — EXTERNAL_HTML boards on a 3840 stage, the editability contract, 20 ft legibility with a 50 px floor. Read both before building or committing any template.
Where this file and either of them disagree about template design, they win.
The mockup-then-port-to-React loop that used to be written here (a 1920 canvas, `scratch/design/`, an `APPROVED` comment citing `scratch/`) is retired: it contradicted that spec.

---

**The original section, unchanged:**

## Template Design Workflow (load-bearing — read every time)

We've built ~60 templates and only the ones we iterated on look good
(Rainbow Ribbon, Animated Rainbow). Batch-built templates regress to
"rounded rectangle with shadow" every time. **Stop batching.** Use this
workflow for every template from now on.

### The 4-step loop (do not skip steps)

1. **HTML mockups in `scratch/design/<name>-vN.html`** — build 3-5
   variations of the SAME template idea, each as a standalone HTML
   file. Open `scratch/design/index.html` to navigate them. Use:
   - **Fixed pixel sizes** sized for a 1920x1080 canvas (logo 150px,
     title 88px, etc.). Never `vw`/`%` for sizing in mockups — they
     read the browser viewport, not the widget container, and the
     port to React breaks.
   - Real Google Fonts loaded via `<link>` (no system stacks).
   - Real shadows, real textures, real CSS shapes. No placeholders.
   - Every widget is a SHAPE (cloud, sun, polaroid, balloon cluster,
     ribbon banner, starburst). Never a rounded rectangle with a
     shadow. If you can't think of a shape for a widget, ask the user
     for a reference image first.
2. **User picks the winner** — they screenshot back, point at what
   they like and what to redo. Iterate until they say "ship it." Do
   NOT move to React until they explicitly approve.
3. **Port to React using the transform:scale pattern** — wrap the
   entire scene in a fixed-size 1920x1080 div, then wrap THAT in a
   container that measures its parent and applies `transform: scale(N)`
   to fit. This is the same pattern `ScaledTemplateThumbnail` uses
   for gallery thumbs. Never use `vw`/`%` for sizing inside the scene
   — keep every pixel size from the HTML mockup intact.
4. **Verify the live React render** — screenshot the deployed page,
   compare it side-by-side with the approved HTML mockup. They must
   match. If they don't, the port is broken — fix the port, don't
   redesign. Common port failures:
   - Mixed pixel + percentage units → drift between elements
   - Missing the transform:scale wrapper → text wraps weird at 4K
   - Dropped CSS keyframes during refactor → animations stop
   - Lost `dangerouslySetInnerHTML` for inline SVG logos → blank tiles

### Why batch design fails for me

When I batch-build 5+ templates in one pass, every one of them gets
the lowest-common-denominator treatment:
- Rectangle backgrounds with rounded corners
- Title font 32px (too small for 8-foot viewing distance)
- Generic emoji + grey text instead of themed shapes
- No shadow / texture variation between themes

The user has called this out repeatedly. Don't do it. **One template
at a time, with a real iteration loop, no exceptions.**

### When designing for a specific theme

Push the metaphor as far as it will go. A "Storybook" theme is not a
serif font on a beige rectangle — it's an open-book spread with a
center spine, illuminated drop caps, page numbers in roman, double
border frames, parchment texture. A "Bulletin Board" is not a brown
background with a list — it's cork texture with pinned index cards
and washi tape. If the metaphor is invisible at a glance, redo it.

### Reference-driven design

I do not have visual taste from training; I have patterns. **Ask the
user for 2-3 reference images** (Pinterest, Dribbble, real signage
photos) before starting any new theme. Without references, default
to copying a known-good template (Rainbow Ribbon is the gold standard).

### Track which templates have been approved

Every approved template gets a comment in the React component:

```tsx
// APPROVED 2026-04-19 — matches scratch/design/animated-rainbow-v3.html
// Reviewed by user, ported via transform:scale pattern. DO NOT
// regress to vw/% units.
```

Without this comment, the template is unverified. Future agents
should treat unverified templates as candidates for rebuild.
