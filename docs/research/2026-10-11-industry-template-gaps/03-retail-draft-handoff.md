# Retail Service Counter draft — 2026-10-11

## Outcome

Authored three standalone layout studies and selected **Editorial Threshold** for the clean draft at `apps/web/public/templates/signage/retail/09-service-counter.html`. This is review material only; it is not operator-approved, injected, registered, or shipped.

## Studies and selection

- `scratch/design/retail-service-counter-01-editorial-threshold.html` — editorial side rail, expressive Cormorant display face, crisp Hanken/DM Sans reading text. Selected for its calm, balanced two-lane hierarchy and compact brand rail.
- `scratch/design/retail-service-counter-02-architectural-desk.html` — wide architectural desk map with an optional parcel/detail frame and a more explicit grid.
- `scratch/design/retail-service-counter-03-counter-ledger.html` — paired ledger panels with a horizontal intro and warmer, denser structure.

The selected source has 38 `data-field` values (13 canonical theme values and 25 visible copy fields), 3 optional image slots (`store.logo`, `collection.parcel`, `returns.desk`), and auto-fit on every visible editable text field. Fonts load from Google Fonts and are exposed through editable theme tokens (`Cormorant Garamond`, `Hanken Grotesk`, `DM Sans`, `IBM Plex Mono`). The semantic groups use fixed markup for the two service lanes; no repeating-list capacity is implied.

## Scope and behavior

The board covers two steps each for Collection and Returns & Exchanges, editable operator-managed requirement wording, desk location, hours, and help contact. Copy deliberately avoids promising policy outcomes or specific eligibility. The optional parcel and desk still-life slots and logo slot begin as placeholders; the `.has-img` rule hides placeholder copy after the injected editor applies an image. No order synchronization, queue integration, QR code, or text baked into images is present. It adapts to fashion retail through its typography and neutral service language.

One authored document selects a fixed 3840×2160 landscape or 2160×3840 portrait stage, with `?o=landscape` / `?o=portrait` overrides and automatic orientation detection. Body copy defaults are 64px and supporting copy 54px on the landscape stage; portrait support values are adjusted to 48px only for narrow metadata and requirements. The draft has not been rendered to confirm the final fitted values or geometry.

## Standard Audit Surface declaration

The 21-section Standard Audit Surface was considered at the template-drafting boundary. Applicable checks here are editable text and theme tokens, image-slot reset/placeholder behavior, fixed list capacity, both stage dimensions, text hierarchy and spacing, and absence of operational integrations or policy guarantees. Security/authentication, tenant isolation, API/database behavior, emergency safeguards, audit-log writes, device/player lifecycle, realtime fan-out, secrets, deployment/rollback, performance, and all other runtime/application domains are outside this static template draft and remain deferred to the lead's applicable review. This statement is not a runtime or product audit.

## Source checks completed

- Checked the authored HTML source for the 38 field keys, three slot keys, stage dimensions, loaded font links, and absence of a baked `EDUCMS-SHIM` block.
- Confirmed all visible editable strings have `data-fit` and a 50px-or-higher minimum in markup; copy defaults are 60px or larger except concise support metadata.
- Confirmed no CSS `inset` shorthand, no dynamic repeated rows, no dependencies beyond web fonts, and no source-specific image URL that could imply an integration.

## Lead checks deferred

No app, browser, build, or screenshot QA was run. Lead should run the scoped generic and media shim injectors, register only after reviewing the rendered draft, capture the poster, and verify landscape and portrait separately in Chromium and WebKit. Use DOM Range bounds after fonts load against row/tile parents and neighboring fields, including the longest authored row and active focus/edit state. Review full image subjects and orientation framing; verify Replace/Fit/Rotate, save/reopen, and reset framing for each optional slot. Exercise copy overrides and auto-fit floors, check no overlap/clipping, test click-to-edit, and repeat the layout review after injection. Shared crop/reposition and inline repeat-capacity/overflow feedback remain editor work outside this draft.

## Registration recommendation

Category/group: **Retail / Service**. Vertical: **RETAIL**. For fashion-specific catalogs, the lead may additionally expose it under **FASHION** if the registry supports multiple verticals. Keep registration, gallery copy, ID mapping, poster capture, and the lead's broader browser verification out of this draft commit.
