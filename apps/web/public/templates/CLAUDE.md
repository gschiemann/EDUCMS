**Scope:** this file governs `apps/web/public/templates/` — the packaged EXTERNAL_HTML signage boards — and the preset catalogue behind them (`apps/api/src/templates/`); `/CLAUDE.md` and `/AGENTS.md` are the core it refines — where they disagree, the core wins. The text below moved here verbatim from the old single-file `CLAUDE.md` on 2026-11-01 (move map: `docs/governance/decisions/2026-11-01-rulebook-restructure-map.md`).

# Templates and boards rulebook

**Counts — produced by `scripts/check-rulebook.cjs`, never hand-kept:** presets 537 · boards 330 · shim V16. The script re-derives all three on every push and pull request (unique preset ids, board files, the shim `MARKER`) and fails CI when this file disagrees; run `node scripts/check-rulebook.cjs` to print the derived numbers. Change a count here only after the script derives the new value.

## Template System

Templates define screen layouts using **537 system presets** (re-derived 2026-11-01) plus custom operator-created templates.

⚠️ **This file said "17 system presets" until 2026-09-11 — it was wrong by 27×, and it is the
first thing every agent and every external auditor reads.** The real catalogue uses **seven
top-level preset packs** under `apps/api/src/templates/`, unioned into `ALL_PRESETS` by
`ensure-system-presets.ts`. Four additional source files are spread into the system pack —
that union, not `system-presets.ts` alone, is what seeds and what the gallery serves:

| file | export | count |
|---|---|---|
| `system-presets.ts` | `SYSTEM_TEMPLATE_PRESETS` | **425** (includes the 14 Homebuilder, 32 Directory, 12 Touch-property and 8 workflow entries below, and 3 reviewed portrait entries) |
| `homebuilder-presets.ts` | `HOMEBUILDER_TEMPLATE_PRESETS` | 14 (spread into the system pack) |
| `directory-presets.ts` | `DIRECTORY_TEMPLATE_PRESETS` | 32 (spread into the system pack) |
| `touch-property-presets.ts` | `TOUCH_PROPERTY_TEMPLATE_PRESETS` | 12 (spread into the system pack) |
| `gap-presets.ts` | `GAP_TEMPLATE_PRESETS` | 8 (four workflows × two orientations; spread into the system pack) |
| `sports-presets.ts` | `SPORTS_TEMPLATE_PRESETS` | 44 |
| `fitness-presets.ts` | `FITNESS_TEMPLATE_PRESETS` | 25 |
| `restaurant-presets.ts` | `RESTAURANT_TEMPLATE_PRESETS` | 21 |
| `retail-presets.ts` / `worship-presets.ts` | `RETAIL_` / `WORSHIP_TEMPLATE_PRESETS` | 8 each |
| `bar-presets.ts` | `BAR_TEMPLATE_PRESETS` | 6 |
| | **TOTAL (unique ids)** | **537** |

**Re-derive it rather than trusting the table** — `SYSTEM_TEMPLATE_PRESETS` is a *computed*
array (in `system-presets.ts` it filters `RAW_SYSTEM_PRESETS` for retired widget types, then
concatenates `MODERN_SCHOOL_PRESETS`, the reviewed portraits and the spread-in packs), so
grepping for `id:` overcounts. Every one of these files imports only `import type` — except
`system-presets.ts`, which imports the four packs it spreads in (a runtime import; the
command's `require.extensions` hook resolves it) — so they transpile and run with no other
runtime deps. From the repo root:

```bash
node -e '
const ts=require("typescript"),fs=require("fs"),path=require("path");
require.extensions[".ts"]=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText,f);
const dir=path.resolve("apps/api/src/templates");const ids=new Set();
for(const f of fs.readdirSync(dir).filter(f=>/-presets\.ts$/.test(f)&&!f.startsWith("ensure-")&&!/\.spec\./.test(f))){
  for(const [k,v] of Object.entries(require(path.join(dir,f)))) if(Array.isArray(v)&&/_TEMPLATE_PRESETS$/.test(k)){
    console.log(String(v.length).padStart(4),k);v.forEach(p=>ids.add(p.id));}
}
console.log(String(ids.size).padStart(4),"UNIQUE ids (the catalogue)");'
```
(Count UNIQUE ids, not the sum: the Homebuilder, Directory, Touch-property and workflow
arrays are also spread into `SYSTEM_TEMPLATE_PRESETS`, so the per-file numbers add up to 66
more than the catalogue. The
previous form of this command compiled each file in isolation and broke on 2026-10-01 when
`system-presets.ts` gained a runtime import — it printed 126.)

### EXTERNAL_HTML signage boards + click-to-edit shim (read before editing ANY board — 2026-06-07)

There are **three** template-editing architectures; do not confuse them:
1. **React-zone presets** — zones rendered by `WidgetRenderer`; edited field-by-field in `PropertiesPanel`.
2. **EXTERNAL_HTML boards** — the **330** self-contained HTML files under `apps/web/public/templates/{custom,fitness,hs,kiosk,school,signage}/`. Each is a full 3840×2160 (or 1920×1080 kiosk) document rendered in a **null-origin sandboxed `src` iframe** (`allow-scripts`, NO `allow-same-origin`). Because React **cannot reach into that iframe**, all editing must go through a **shim baked into the HTML file**.

   **This said "~107 … {hs,kiosk,signage,fitness}" until 2026-09-11** — low by 143 boards and
   missing `school/` entirely, which is exactly how the editability sweep below ended up
   skipping 59 boards. Re-derive with one command (it is just a file count — trust nothing):
   ```bash
   find apps/web/public/templates -name '*.html' -not -path '*/_*' | wc -l          # 330
   find apps/web/public/templates -name '*.html' -not -path '*/_*' | cut -d/ -f5 | sort | uniq -c
   #   14 custom · 7 fitness · 30 hs · 19 kiosk · 41 school · 219 signage
   ```
   `signage/` is itself 16 industry sub-folders (`qsr` 28, `worship` 24, `hospitality` 16, `bar`
   13, `corporate` 71, `gym` 11, `church` 10, `fashion` 10, `healthcare` 10, `menus-pos` 10,
   `retail` 9, `veterinary` 2, `clinic` 2, and `museum`/`office`/`real-estate` 1 each) — so any
   sweep must recurse, never list a fixed set of directories. `-not -path '*/_*'` skips
   `_thumbs/` and `_edit-shim.js`, the same "no `_`-prefixed path segment" rule the poster
   generator and `apps/web/tools/check-poster-freshness.cjs` use to decide what counts as a board.
3. **Holiday boards** (`public/holiday-templates/`) — a SEPARATE `holiday:*` postMessage bridge; the panel sources fields **live** from the board (see `getHolidayLiveFields` in `HolidayWidget.tsx`), not a static schema.

**The EXTERNAL_HTML shim does TWO jobs (since V5, 2026-06-07):** (a) apply overrides INBOUND (brand/text/image/styles), and (b) **report clicks OUTBOUND** — the "hot zones": click an element in the builder → the panel jumps to that element's field editor. The protocol the panel speaks: `educms-ready` (load) · `educms-edit-mode {on}` (panel→iframe, arms hover-outline + click-report; NEVER sent on the live player) · `educms-field-click {key,kind}` (iframe→panel, drives the jump). The walker keys off `data-field`/`data-imgslot`/`data-action` — so **every editable element needs one of those** (same contract as editability).

**The shim is INJECTED, never hand-written.** Existing apply/click mechanisms:
- `apps/web/scripts/inject-shim-v2.cjs` → bakes the current **EDUCMS-SHIM-V16** (apply + click-to-edit) into static boards, replacing every older marker (V15…V2, `EDUCMS-BRAND-SHIM`) in place. The version is the `MARKER` constant in `inject-shim-v2.cjs` — read it, don't trust this line (it said "V5" here until 2026-09-11, and "V15" until 2026-11-01). The subdirectory argument is **optional and scopes the walk**; with no argument it walks all of `public/templates`, which is what you normally want: `node apps/web/scripts/inject-shim-v2.cjs` (or `… school`, `… signage/qsr`, …).
- `apps/web/scripts/inject-click-shim.cjs` → an **additive** click-only shim for the 30 `signage/{qsr,menus-pos,bar}` MENU boards, whose hand-crafted V5 carries `applyMenu()` (live per-location POS price + auto-86) that must NOT be clobbered. `node apps/web/scripts/inject-click-shim.cjs signage`.
- Kiosks load the external `public/templates/kiosk/_edit-shim.js` (apply + click + kiosk engine-render hook). The injectors **skip** any file referencing it (no double-shim).

**Shared media controls (2026-10-10).** `apps/web/scripts/board-media-controls.ts` is an
additive companion, baked into all packaged boards by
`node apps/web/scripts/inject-media-controls.cjs` (`EDUCMS-MEDIA-CONTROLS-V2`). Run it
after adding a board or changing the companion; never hand-edit its generated script.
It preserves the existing generic, menu/POS and kiosk shims. The injector also
walks all 58 holiday boards; their media overrides use the same saved controls. Advertised
`educms-media-ready` slots use the editor's shared Replace / Fit / Rotate toolbar;
their saved overrides live in `defaultConfig.mediaStyles`, `imageOverrides` and
`videoOverrides`. Media changes use postMessage without reloading a kiosk's current
screen. Embedded slots retain their authored frames; separately added Image / Video
zones use the same insertion and gesture controls on blank and preset canvases.
The companion applies saved Fit after legacy source painters finish and honors
operator choices over older `!important` logo styles; clearing overrides restores
authored fits. Its font companion (`board-font-controls.ts`) loads supported web
fonts inside the sandbox for field and theme edits, including restored URL edits.
Holiday media fields are discovered from the selected grade/design/orientation's
actual source; `HolidayMediaFields` in `PropertiesPanel.tsx` exposes Replace, Remove and Restore.
Holiday text-field caches must include grade, variant, design and orientation.
Keep normal default body text at least 60px and support text at least 50px on a
3840px stage after automatic fitting; explicit operator font sizes remain absolute.
Allocate room for longer copy instead of silently shrinking below those floors.
The mounted bottom bar is **inside `BuilderShell.tsx`**, not `BottomToolbar.tsx`.
Keep Image / Video / Text quick actions above search, everyday media first in
the curated list, and Photos & video first in the full library. New media is
chosen before insertion and uses its source proportions; rotation and fit belong
in the visible selection toolbar. Preserve these paths on blank and preset canvases.
Board HTML also feeds the API's approved AI reference catalog. After changing it,
run `node apps/api/scripts/build-designer-exemplars.cjs` and its `--check`, even
when the change only adds a shim. The source hashes cover the complete HTML.
Reserve the tallest measured bottom toolbar at the current editor width; a
shorter selection toolbar must not enlarge the portrait canvas after a drag.
Reset that measurement on an actual container resize, and still allow taller
controls the room they need. Browser drag tests must wait for board fitting,
use movement inside its bounds, and check the rendered position after Undo,
Redo and reopening.
Repeating rows retain the authored group and row blueprints before removal, so a
saved one-row list can grow again and restore distinct original rows. Repeated updates
keep the reduced-list layout; returning to the authored count restores its original
layout. Newly restored rows receive click-to-edit listeners. Verify this with
`board-repeat-restoration.spec.ts`; it does not guarantee arbitrary added rows fit every
older composition. Respect each board’s `data-repeat-max` capacity.
Regenerate affected gallery posters and their provenance, then bump `POSTER_VERSION`
in `src/lib/template-poster.ts`. The behavioral coverage is
`builder-media-editing.spec.ts` and the discovered full-corpus
`board-media-compatibility.spec.ts` (Chromium + WebKit).

**⚠️ REDESIGN INVARIANT — the trap that caused the 2026-06-07 "none of the templates can be edited" fire:** when you edit/redesign an existing board, the OLD shim block stays baked in. A board left on the apply-only V4 shim is **un-editable by click**. So **after editing ANY `public/templates/**` board, re-run the injector for its subdir** (and `inject-click-shim.cjs` for menu boards). Confirm with the editability gate + the real-browser tests:
```bash
# The real gate: discovers every board by walking the tree and resolves the shim on disk.
node apps/web/tools/check-board-editability.cjs
# Quick shell check, every board: one with NEITHER a baked shim marker NOR the external kiosk shim.
# (The old `educms-field-click` form of this grep can no longer fail — see below.)
cd apps/web/public/templates && for f in $(find . -name "*.html" -not -path "*/_*"); do \
  grep -qE "EDUCMS-SHIM-V|src=[\"'][^\"']*_edit-shim" "$f" || echo "NO CLICK-TO-EDIT: ${f#./}"; done
pnpm --filter web exec playwright test tests/e2e/external-html-clickedit.spec.ts   # boards (chromium+webkit)
pnpm --filter web exec playwright test tests/e2e/holiday-hotzone.spec.ts           # holiday boards
```

Incident: `docs/incidents/2026-06-07-uneditable-templates-shim.md`

Both alternations in that `grep` are load-bearing: 311 boards carry a **baked** shim
(`EDUCMS-SHIM-V<n>`) and the 19 `kiosk/` boards instead `<script src>` the external
`_edit-shim.js` (311 + 19 = 330), so dropping either branch reports a whole class of boards as a
false failure. As of 2026-11-01 it reports **zero** violations. **The old sweep
(`grep -qE "educms-field-click|…"`) can no longer fail:** the shared media-controls companion
(`EDUCMS-MEDIA-CONTROLS-V2`, `board-media-controls.ts`) is baked into every board and itself posts
`educms-field-click`, so that string is on all 330 boards whether or not they carry a click shim.
The quick grep above is also weaker than the gate — it cannot tell an apply-only V2–V4 shim from a
V5+ one, and it does not resolve the kiosk `src` on disk. The real gate is
`apps/web/tools/check-board-editability.cjs`, run by `taurus-safety.yml`; like the other
workflows it reports and is not a required check.
Full conventions (editability contract, brand tokens, auto-fit ≥50px floor, live engines, build checklist) live in `.claude/agents/venueos-template-designer.md` + `docs/design/FLAGSHIP-TEMPLATE-STANDARDS.md` — the binding spec for any template work.

### System Presets

The catalogue is derived by the command above; it is deliberately not listed here.

Each preset has **zones** (layout regions) with widget types, percentage-based coordinates, and optional default config.

### Zones & Coordinates
- **x, y, width, height**: Percentages (0–100) of screen dimensions
- **zIndex**: Layering order (0 = back)
- **defaultConfig**: Widget-specific settings (e.g., `{ fontSize: 48, color: '#fff' }`)
- **widgetType**: See Widget Types below

### Widget Types (20+)
WidgetRenderer (`apps/web/src/components/widgets/WidgetRenderer.tsx`) supports:
- CLOCK, WEATHER, COUNTDOWN, TEXT, RICH_TEXT
- ANNOUNCEMENT, TICKER, BELL_SCHEDULE, LUNCH_MENU, CALENDAR
- STAFF_SPOTLIGHT, IMAGE, IMAGE_CAROUSEL, VIDEO, LOGO
- WEBPAGE, RSS_FEED, SOCIAL_FEED, PLAYLIST, (more)

Each widget can have a `theme` variant in config (e.g., Sunny Meadow theme for clock).

### Adding a New Preset
1. Create the preset object with its zones array in the preset file **for its vertical** —
   `system-presets.ts` is the K-12 pack, not a dumping ground; a gym board goes in
   `fitness-presets.ts`, a bar board in `bar-presets.ts`, and so on.
2. Add it to that file's `*_TEMPLATE_PRESETS` export. If you created a *new* preset file, spread
   it into `ALL_PRESETS` in `ensure-system-presets.ts` too, or it is seeded by nothing.
3. **Tag its vertical.** `ensure-system-presets.ts` maps every preset id to a `Tenant.vertical`
   (`PRESET_VERTICAL`) and the list endpoint filters on it. An untagged preset
   is not "neutral" — it leaks into every vertical's gallery, which is the bug
   `bf2a95de` had to fix for the RESTAURANT/RETAIL/WORSHIP/HEALTHCARE/HOSPITALITY/CORPORATE packs.
4. Seed script loads it on `pnpm db:seed`.
5. Operators can duplicate and customize.
