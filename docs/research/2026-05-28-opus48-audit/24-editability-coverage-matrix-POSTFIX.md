# Post-Fix Editability Coverage Matrix — Template Builder

> Opus 4.8 read-only, 2026-05-28 (Wave 3), at master a3f8533. Every "editable"
> claim traced to BOTH editor (`BuilderZone.tsx`) AND player (`player/page.tsx`)
> so it means "edit shows on a real screen," not "control exists."

## Bottom line
Much closer to "every template/widget editable" than the 2026-05-26 complaint implies.
**~96% of 171 widget types are ≥B now (164/171); ~100% once W2-A's orphan cases land.**
Every preset-shipping widget across all 12 verticals is ≥B. **~70% at A** — the tail is
4 systemic styling gaps (G1–G3, G5), not broad breakage.

**Key correction for the lead:** "brand palette isn't honored" is OUTDATED — it IS,
via the color picker's brand-swatch row (113 call-sites). The gap is it stores a
**frozen hex**, not a live `var(--brand-*)`, so re-theming later doesn't reflow.
Frame next wave as "make brand colors *live* + add font-size + signage image-replace,"
NOT "add brand presets" (those exist).

## The 4-layer editability model (load-bearing)
`ContentFields()` (`PropertiesPanel.tsx:1521`) dispatch: (1) explicit `case` — 88 types;
(2) v2-variant auto-form (`default:`, `V2_BY_VARIANT_ID` `:4413`) + full Style section —
CELEBRATION/CHART/SCOREBOARD/CORPORATE/HEALTHCARE/HOSPITALITY/WORSHIP/RETAIL packs;
(3) MS/Fitness/HS-portrait auto-form (`MS_DEFAULTS_BY_TYPE` `:4609`) — 32 types;
(4) themed auto-form (`THEMED_WIDGET_FIELDS` `:4708`) — 34 Animated/Bulletin/Scrapbook/
Storybook, now with list/bell/menu/image editors (P0-3). Then a universal "Text style"
block appends Font+Color+B/I/U/S to every text widget (`:4849-4872`), except MEDIA_ONLY+v2.
**Render parity verified:** BuilderZone `:570-664` and player `:5240-5294` inject identical
`!important` rules for `cfg.fontFamily/fontSize/color/bold/italic` + per-field `_styles` + bgColor.

## Per-vertical readiness
| Vertical | Source | Editability | Grade |
|---|---|---|---|
| K12 | system-presets + MS/HS/themed + EXTERNAL_HTML | every type has case/auto-form; themed content editable post-P0-3 | **Ready** |
| RESTAURANT | restaurant-presets | 6 RESTAURANT_* rich cases w/ ListItemsEditor | **Ready** |
| QSR | restaurant (QSR-tagged) + EXTERNAL_HTML | same + signage path | **Ready** |
| BAR | bar-presets + EXTERNAL_HTML | 6 BAR_* per-item editors | **Ready** |
| RETAIL | retail-presets | 8 RETAIL_* cases; **2 JSON holdouts** (STOREFRONT_HOURS openHours, WAYFINDING youAreHere) | **Ready** (minor) |
| GYM/FITNESS | fitness-presets | 8 FITNESS_* cases + 15 scenes via MS auto-form; **no per-field size/color** | **Ready** (size gap) |
| SPORTS | sports + scoreboard | SCOREBOARD deep case; CELEBRATION v2 | **Ready** |
| WORSHIP | worship-presets | 100% standard widgets, explicit cases | **Ready** |
| CORPORATE | **no presets** — EXTERNAL_HTML(10)+v2 | text/color/font yes; **no image-replace** | **Partial** |
| FASHION | **no presets** — EXTERNAL_HTML(10) | same; image-replace gap most acute (image-heavy) | **Partial** |
| HEALTHCARE | **no presets** — EXTERNAL_HTML(10)+v2 | same | **Partial** |
| HOSPITALITY | **no presets** — EXTERNAL_HTML(10)+v2 | same | **Partial** |

**EXTERNAL_HTML path** (`ExternalHtmlTextEditor` `:5237`, render `WidgetRenderer.tsx:2708`):
robust for text/color/font — DOMParses every `[data-field]`, renders StyleableField per field
+ 5 brand colors + 3 fonts, encodes to URL params the V2 shim applies in-iframe. Verified
end-to-end. **One hole:** only `[data-field]` (text) discovered — no `[data-img]`/`?img=`, so
embedded logos/hero photos aren't operator-replaceable → B-ceiling for the 4 Partial verticals.

## Remaining gaps, ranked (excl. done/done-soon)
| # | area | missing | location |
|---|---|---|---|
| **G1** | ALL color fields | brand swatch emits frozen hex, never `var(--brand-primary)` → re-theme doesn't reflow. §19 literal miss. Systemic. | `color-picker.tsx:385-388` |
| **G2** | MS/Fitness/themed auto-form + universal fallback | **no font-SIZE control** (render path SUPPORTS `cfg.fontSize` at BuilderZone:600/player:5267 — control just missing = half-costume). Smallest fix, broadest impact. | `PropertiesPanel.tsx:4859-4860` |
| **G3** | EXTERNAL_HTML signage (4 Partial verticals + 50 industry tmpl) | no per-image replacement; only text/color/font | `:5270` queries `[data-field]` only; `WidgetRenderer.tsx:2728` no img param |
| **G4** | RETAIL_STOREFRONT_HOURS, RETAIL_WAYFINDING_MAP | 1 raw JSON textarea each (openHours object, youAreHere {x,y}) | `:4206-4208`, `:4257-4259` |
| **G5** | MS/Fitness per-field styling | only HS_* get per-field StyleableField; MS/Fitness plain TextField | `:4635` `isHsWidget` gate |
| **G6** | inline format toolbar color | raw OS `<input type=color>`, no brand swatches | `BuilderShell.tsx:1054,1141`; `BottomToolbar.tsx:194` |

Also flagged (low-pri): `BuilderShell.tsx:1058` `className="absolute inset-0"` — rule #10 violation in builder chrome (but builder isn't player-shipped, so not a Taurus risk).

## Costume check
NOT costumes (verified render parity): universal text-style, v2 Style section, EXTERNAL_HTML
text/brand, ListItemsEditor per-item. **Half-costume:** G2 — render supports `cfg.fontSize`
but no control writes it for auto-form widgets.

## Verdict + shortest path to 100% A
~96% ≥B now → ~100% once W2-A lands. ~70% at A. Recommended next-wave order (highest leverage first):
1. **G2 universal font-size** — 1 field, render already supports it, lifts every auto-form widget.
2. **G1 brand-var resolution** — sentinel value + renderer resolve; makes re-theming live. Biggest systemic win.
3. **G3 EXTERNAL_HTML image-replace** — `[data-img]` discovery + `?img=` param; closes all 4 Partial verticals to A.
4. **G5** (port per-field styling to MS/Fitness), **G4** (2 JSON holdouts), **G6** (branded inline picker) as polish.
After 1–3 all 12 verticals reach Ready and the matrix is uniformly ≥A−.

**Sequencing note (mine):** G1/G2/G4/G5 live in PropertiesPanel.tsx (serialize behind W2-A);
G3 is ExternalHtmlTextEditor+WidgetRenderer (parallelizable); G6 is BuilderShell+BottomToolbar.
