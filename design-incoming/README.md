# `design-incoming/` — Claude Design → Claude Code template drop-zone

Commit new template batches **here** (instead of zipping + uploading). Claude Code
picks them up from git, wires them into the app, and verifies them.

## How to drop a batch

1. Create a folder: `design-incoming/<vertical>-<batch>/`
   e.g. `hs-flagship-batch2/`, `ms-cafeteria-batch1/`, `bar-batch3/`.
2. Put the self-contained `*.html` template files in it.
3. Add a **`REPLACE-MANIFEST.md`** with a table: `file | replaces (app path) | what changed`.
   If a file is brand-new (no same-named file in the app), say "NEW".
4. Commit + push. Ping Claude Code: "batch-N is in design-incoming".

Claude Code then runs the intake (copy → shim → register → verify) and reports back
with before/after screenshots. After intake the files live in
`apps/web/public/templates/<vertical>/`; the `design-incoming/` copy stays as the
source-of-record.

## The editability contract (so a batch is "ready" with zero rework)

These were the gaps in batch-1 — bake them in and intake is instant:

- **Text** → every editable string is `data-field="namespace.key"` (e.g.
  `data-field="us.name"`). A field MAY wrap child `data-field` elements (nested is
  fine — the shim only replaces the parent's own text node).
- **Images** → mark each replaceable photo `data-imgslot="key"`; the element paints
  its own `data-img` URL as a background (your template's `applyImgs()` is great).
  The operator's chosen URL is written to `data-img` + painted automatically.
- **Theme** → expose colors/fonts/scale in a `<div data-widget="theme" hidden>` block
  of `data-field="theme.cX"` / `theme.fX` / `theme.scale` spans wired to CSS vars,
  with a `MutationObserver` that re-applies on change. (batch-1 did this — keep it.)
- **Do NOT inline an edit bridge.** The app injects `EDUCMS-SHIM-V4` automatically
  (`apps/web/scripts/inject-shim-v2.cjs`) — it reads `?brand/text/textStyles/img`
  URL params AND `postMessage({type:'educms-overrides',…})`, and maps brand tokens
  to both the legacy `--brand-*`/`--bg`/`--ink` vars and the flagship
  `--c-*`/`--f-*` vars. So your CSS-var names can be either; brand will drive them.

## Other standards (also from batch-1)

- **Auto-fit text** (`data-fit` / `data-fit="single"` + `data-fit-min/max`) — keep it.
- **Orientation** — one file does landscape (3840×2160) AND portrait (2160×3840),
  auto-detected by viewport, overridable with `?o=portrait` / `?o=landscape`.
- **20-ft legibility / no clipping** in both orientations.
- **Chromium-83 / NovaStar Taurus**: only matters for LED-wall *player* surfaces, NOT
  standard LCD/TV signage. HS signage may use `inset`/`gap`/`color-mix` freely. (If a
  template is ever targeted at a Taurus LED wall, use longhand `top/right/bottom/left`
  instead of `inset`, per CLAUDE.md rule #10.)
- **Fonts** via Google `<link>` is fine for online panels; self-host for offline ones.

## What Claude Code does on intake (for reference)

```
cp design-incoming/<batch>/*.html  apps/web/public/templates/<vertical>/
node apps/web/scripts/inject-shim-v2.cjs <vertical>      # injects EDUCMS-SHIM-V4
# register any NEW file in:
#   apps/web/src/components/widgets/signage-templates.ts   (gallery)
#   apps/api/src/templates/system-presets.ts               (DB preset)
# verify: render land+port + an edit smoke (text+brand+img), screenshot, ship.
```
