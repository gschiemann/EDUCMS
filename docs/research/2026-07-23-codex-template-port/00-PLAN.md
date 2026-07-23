# Codex template redesign release — port plan (2026-07-23)

Source: `scratch/handoff/template-redesign-release-2026-07-23/manifest.json`
(local handoff — nothing committed/seeded yet). **20 templates** in the queue,
1 held alternate. Canvas is **1920×1080 / 1080×1920** (NOT the 3840×2160 of the
fashion boards). Sources: `scratch/design/*.html`.

## The two work-streams

### A. 11 CORPORATE redesigns — REPLACE existing presets
Each `scratch/design/corporate-NN-*.html` replaces the current
`apps/web/public/templates/signage/corporate/NN-*.html`:

| # | source | replaces |
|---|---|---|
| 01 | corporate-01-lobby-arrival | 01-lobby-welcome-flagship |
| 02 | corporate-02-conference-pulse | 02-conference-room |
| 03 | corporate-03-kpi-command | 03-kpi-dashboard |
| 04 | corporate-04-new-hires-human-signal | 04-new-hires |
| 05 | corporate-05-floor-directory-vertical | 05-floor-directory |
| 06 | corporate-06-all-hands-broadcast | 06-all-hands |
| 07 | corporate-07-cafeteria-chef-pass | 07-cafeteria |
| 08 | corporate-08-shuttle-departures | 08-shuttle-board |
| 09 | corporate-09-events-weekline | 09-events-week |
| 10 | corporate-10-emergency-protocol | 10-emergency-info |
| 11 | corporate-11-signal-beacon | 11-corporate-signal |

**Port step (mechanical):** each source `<link rel=stylesheet href="corporate-suite-core.css">`
+ `<script src="corporate-suite-core.js">`. EXTERNAL_HTML boards run in a
null-origin sandbox → **inline** both (css into `<style>`, js into `<script>`)
so each file is self-contained. The shared runtime (`corporate-suite-core.js`)
ALREADY implements the full EDUCMS protocol (educms-ready / -field-click /
-overrides / -edit-mode / -freeze/-unfreeze, `data-fit` auto-fit ≥52px,
`data-imgslot`, auto-orientation) → **no separate shim injection needed** (do
NOT run inject-shim-v2 on these; it would double-shim). Preset ids/urls stay
the same (replacing content in place), so no system-presets.ts change for the 11.
Asset: corporate-11 references `assets/corporate-signal-ribbon-v1.png` → copy
into `public/templates/signage/corporate/_assets/` and fix the ref.

### B. 9 NEW retail/corporate presets — ADD (new files + register)
New self-contained files + NEW rows in `system-presets.ts` (unique preset ids,
EXTERNAL_HTML zone → url, category, vertical) + shim/runtime inlined:

| new preset | source | vertical/category |
|---|---|---|
| corporate-signal-ribbon-edition | corporate-signal-v4 | CORPORATE (alt; don't overwrite 11) |
| retail-storefront-gallery-threshold | retail-storefront-v1-gallery-threshold | RETAIL |
| retail-storefront-the-aperture | retail-storefront-v2-open-signal | RETAIL |
| retail-endcap-kinetic-object | retail-endcap-v1-kinetic | RETAIL |
| retail-endcap-object-study | retail-endcap-v2-object-study | RETAIL |
| retail-endcap-drop-signal | retail-endcap-v3-drop-signal | RETAIL |
| retail-wayfinding-northstar-signal | retail-wayfinding-v4a-northstar-signal | RETAIL |
| retail-wayfinding-northstar-daylight | retail-wayfinding-v4b-northstar-daylight | RETAIL (recommended universal) |
| retail-wayfinding-northstar-monolith | retail-wayfinding-v4c-northstar-monolith | RETAIL |

Assets: `retail-storefront-cobalt-gallery-v1.png`, `retail-endcap-cobalt-sneaker-v1.png`.
Check whether the retail sources also use a shared runtime or are self-contained.
Consider RETAIL|FASHION tag (mirror the fashion-boards decision) so Boutique sees them too.

**Held alternate (do NOT implement):** retail-storefront-v3-editorial-invitation.
**Rejected (excluded):** wayfinding v1-atlas, v2-store-lines, v3-compass-house.

## Port contract (from manifest — enforce on every board)
Preserve every `data-field` key, every `data-imgslot`, the brand/text/textStyles/img
query + postMessage overrides, edit-mode clicks + freeze/unfreeze. Two fixed scenes
(1920×1080 + 1080×1920), auto-orientation, uniform scale, **no vw/vh/vmin/vmax inside
a scene**, min visible editable font **52px**, type hierarchy 52/80/112/144-190,
clip editable rows/cards to their bounds, protect portrait campaign image from copy.
**Editor must NOT change.**

## Verification before commit (per board)
1. Render at native 1920×1080 AND 1080×1920; compare to `scratch/design/*-comparison.html`.
2. No editable text overlaps / crosses a boundary / drops below 52px.
3. Exercise query-hydration + `educms-overrides` postMessage; edit-mode click; freeze/unfreeze.
4. Taurus-safety gate (no `inset` shorthand/utility) + click-to-edit sweep.
5. WebKit cross-browser suite.
6. tsc (api + web) for the system-presets.ts additions; watch CI green.

## Suggested execution order
1. Read `corporate-suite-core.css/js` fully + one retail source (confirm retail runtime).
2. Script the corporate inlining (11 replace + copy asset) — deterministic; render-verify 2-3.
3. Add the 9 new presets (files + system-presets.ts rows + assets); render-verify each.
4. Full gate run (taurus, click-edit sweep, tsc, WebKit) → commit → watch CI → verify live.

This is a large, production-affecting port (replaces 11 LIVE corporate presets +
adds 9). Do it as a focused pass with per-board verification — not batched blind.
