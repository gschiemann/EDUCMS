# Kiosk Editability — "Dominos parity" build spec (2026-06-04)

Goal: make the 6 touch kiosks editable in the builder like the Dominos board —
click text to edit, swap images, recolor/brand — chosen by operator 2026-06-04.

## How the EXTERNAL_HTML editor actually works (verified)
- **Field discovery** (`ExternalHtmlTextEditor`, PropertiesPanel.tsx:6565):
  `fetch(url)` → `DOMParser` → `querySelectorAll('[data-field]')` (text) and
  `[data-img],[data-widget="image-slot"]`/`data-slot` (images), reading default
  text from the first text node. Grouped by `sectionKey` = key before first `.`.
  **⇒ discovery is a STATIC parse of the HTML file. It does NOT run the kiosk JS.**
- **Apply** (shim `apps/web/scripts/inject-shim-v2.cjs`): reads base64url URL
  params `brand|text|textStyles|img` (and `educms-overrides` postMessage) and
  applies to `[data-field]`/`[data-img]`/`[data-slot]`/`:root` vars. One-shot at
  DOMContentLoaded + on postMessage.
- **Click-to-jump** (PropertiesPanel.tsx:6686): editor posts `educms-edit-mode
  {on:true}`; board posts `educms-ready` (re-arm) and `educms-field-click
  {key,kind}` on click; editor scrolls to `[data-edit-field="key"]`.
- **Brand**: `BRAND_MAP` maps background→`--bg`, surface→`--surface`,
  text→`--text`, primary→`--primary`, accent→`--accent`, fontDisplay→
  `--font-display`, fontBody→`--font-body`. **These EXACTLY match the kiosk
  theme vars — brand recolor/fonts work for free.**

## Why the kiosks need extra work
Kiosks build their DOM in JS (Kiosk engine renders screens, swaps on nav). So:
1. Static parse finds **no** `[data-field]` (they'd be in `<script>` strings) →
   discovery needs a **static, hidden field manifest** in the `<body>`.
2. The one-shot shim misses JS-rendered + screen-swapped content → need an
   **edit-shim that re-applies after every render** (wrap `Kiosk._render`).

## The pattern (per template)
1. **Live markers** in `app.js` render output: `data-field="<key>"` on editable
   text, `data-img="<key>"` (or `data-slot`) on `.media` image placeholders.
   Keys are dot-grouped by screen/section, e.g. `home.title`, `menu.0.name`,
   `menu.0.price`, `suite.1801.rate`.
2. **Static hidden manifest** in `<body>`: `<div id="venueos-fields" hidden>`
   containing one `<span data-field="<key>">DEFAULT TEXT</span>` per editable
   field + `<div data-img="<key>"></div>` per image slot, mirroring every key in
   (1) with its default copy. This is what discovery parses.
3. **Edit-shim** (shared, inlined after the engine): reads URL-param overrides +
   `educms-overrides`/`educms-edit-mode` postMessage; monkeypatches
   `Kiosk._render` (and sheet open) to re-apply brand/text/styles/img after every
   render; in edit mode adds hover outline + posts `educms-field-click`; posts
   `educms-ready`. Logic ported from inject-shim-v2.cjs + the re-apply hook.
4. **Brand**: nothing to do — var names already align.

## Rollout
- Build shim once; prove the FULL loop on `food` (discovery lists fields, brand
  recolors, edit a field → applies in preview + player). Verify live in builder.
- Then parallelize the other 5 (real-estate, museum, office, gym, school) as
  worktree agents following the proven `food` reference; lead reviews + merges +
  verifies each.
