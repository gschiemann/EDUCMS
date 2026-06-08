# Template intake — "EDU CMS-20" designer handoff (2026-06-08)

Source: `~/Downloads/EDU CMS-20.zip` → `delivery/claude-handoff-2026-06-08/`.
Lead intaken the batch into the EXTERNAL_HTML + shim pipeline. 23 of 24 templates
shipped; 1 kiosk blocked on a missing shared dependency (see below).

## What shipped

### Signage — 18 boards, 7 NEW industries  (commit `85a52b29`)
Placed under `apps/web/public/templates/signage/<industry>/`, registered in BOTH
`signage-templates.ts` (frontend catalog) and `system-presets.ts` (API presets),
single `EXTERNAL_HTML` zone @ 3840×2160.

| Industry | Boards | Vertical (gallery visibility) |
|---|---|---|
| church | 10 (welcome / series / this-week / next-steps+give / prayer-wall — each dark + light) | WORSHIP |
| veterinary | 2 (waiting-room, adoptable-pets) | HEALTHCARE *(provisional)* |
| gym | 2 (floor-board, leaderboard) | GYM |
| real-estate | 1 (availability) | CORPORATE *(provisional)* |
| museum | 1 (today) | HOSPITALITY *(provisional)* |
| office | 1 (room-grid) | CORPORATE |
| clinic | 1 (campaign) | HEALTHCARE |

Per-board pipeline applied:
- **Taurus-safe**: 44 `inset:` shorthands → physical longhand `top/right/bottom/left`
  (Chromium-83 LED controllers drop `inset` → 0×0 collapse). 4 `box-shadow: inset` kept.
- **Editable**: V6 click-to-edit shim injected (`inject-shim-v2.cjs`) — apply
  (brand/text/image) + click-to-edit hot-zones + gallery freeze. Every board carries
  `data-field`/`data-imgslot` (29/3 on the vet flagship, etc.). Menu boards (`applyMenu`)
  + kiosks correctly skipped by the injector.
- **Brand-apply verified compatible**: boards use `--bg/--paper/--fg/--mute/--primary/
  --accent`, which the V6 shim's `BRAND_MAP` already targets → "Apply brand" re-skins them.

### Holidays — 5 redesigned boards  (commit `b0eecafd`)
es-christmas (rainbow), ms-christmas (cinematic aurora), hs-christmas (teen "Snow Ball"),
es-valentines (editorial kinetic), es-halloween (MD-compliance). REPLACE the existing
same-named boards in `holiday-templates/` (presets already point at them).
- Taurus-swept (`inset:` → longhand).
- **Holiday bridge wired**: the new files shipped WITHOUT it; appended the canonical
  `<script id="holiday-bridge">` (holiday:ready/fieldClicked/setField — auto-derives
  fields from `[data-field]`) + `_style-bridge.js`. Without this the redesigns would
  have been un-editable via the holiday panel.

## Decisions that need your sign-off

1. **3 industries have no dedicated vertical** — veterinary / real-estate / museum.
   They're PROVISIONALLY mapped to HEALTHCARE / CORPORATE / HOSPITALITY so the boards
   surface instead of stranding invisible. To make them first-class (their own gallery,
   no crosstalk), promote to dedicated `VETERINARY` / `REAL_ESTATE` / `MUSEUM` verticals
   in `packages/api-types/src/verticals.ts` + the §14 per-vertical copy. **Want that?**
2. **Holidays replace working production boards** — please before/after review
   (`git show b0eecafd`); rollback is one revert if any redesign isn't wanted.

## Blocked

- **`kiosk-templates/vet/wellness/` (Pet Age & Wellness)** — NOT intaken. It's multi-file
  (`index/data/app/styles`) and `index.html` loads `../../shared/kiosk-core.{css,js}`,
  which **does not exist** in this repo (all repo kiosks are single-file, self-contained)
  **and is not in the zip** — the handoff's "already in the repo" note is wrong here.
  To bring it in we need the upstream `kiosk-core.{css,js}`, or a decision to port the
  shared kiosk engine / inline a self-contained single-file version.

## Follow-ups (non-blocking)

- **Posters**: the 18 new signage boards have no static gallery poster yet, so the grid
  renders them via the (slower) live-frame fallback. Run `gen-template-posters.cjs`
  against a running server to bake `_thumbs/signage/<industry>/*.png` for snappy gallery.
- Promote the 3 provisional verticals (decision #1).
- Vet wellness kiosk (blocked above).

## Verification done
- tsc clean (api + web). Static sweeps: 0 signage boards missing click-to-edit;
  0 holiday boards missing bridge; 0 `inset:` shorthand remaining across all touched files.
- Cross-browser (WebKit) holiday-bridge + external-html click-edit specs + Taurus-safety
  run in CI on push — watched to green before claiming shipped.
