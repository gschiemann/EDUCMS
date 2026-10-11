# Corporate, bar and QSR flagship refresh — second wave

Completed source scope: ten assigned boards, seven bar and three QSR. Worktree: `/Users/gschiemann/.codex/worktrees/corporate-flagship-refresh/EDU CMS`. Branch: `codex/corporate-flagship-refresh`. Corporate first-wave commits `2e7e7ce6` and `75f2eea1` were already integrated by the lead and were not redone. This report describes the subsequent bar/QSR work. No push or deployment has been performed by this agent.

## Design and typography

| Source | Selected composition | Loaded display / body typefaces | Original → current text keys | Original → current image keys |
|---|---|---|---:|---:|
| bar/01-tap-list-flagship | Draft Registry | Space Grotesk / Hanken Grotesk | 74 → 107 | 0 → 1 |
| bar/02-cocktail-menu | Botanical Cut | Instrument Serif / Hanken Grotesk | 34 → 52 | 0 → 2 |
| bar/03-bottle-list | Cellar Folio | Instrument Serif / DM Sans | 74 → 91 | 0 → 1 |
| bar/04-happy-hour | After Work Poster | Archivo Black / DM Sans | 56 → 57 | 5 → 5 |
| bar/06-tonight-live | Marquee Set | Barlow Condensed / Hanken Grotesk | 23 → 46 | 0 → 2 |
| bar/07-bottle-service | Table Concierge | Instrument Serif / DM Sans | 91 → 91 | 5 → 5 |
| bar/08-game-day | Terrace Score | Barlow Condensed / DM Sans | 73 → 74 | 4 → 4 |
| qsr/08-rewards | Rewards Passport | Archivo Black / DM Sans | 18 → 38 | 0 → 2 |
| qsr/09-hours-location | Neighborhood Marker | Space Grotesk / DM Sans | 20 → 39 | 0 → 1 |
| qsr/10-now-hiring | Crew Call | Oswald / Hanken Grotesk | 21 → 40 | 0 → 3 |

Each board has its own hierarchy and portrait composition. JetBrains Mono is the loaded, editable default for supporting labels and numeric treatments. All boards expose canonical `theme.fDisplay`, `theme.fBody`, `theme.fMono` and `theme.scale` controls, eight canonical color tokens, plus any original theme fields. A Google Fonts stylesheet loads every selected family. The browser records confirm the selected display, body and mono families were loaded in all 40 baseline cases.

Three self-reviewed studies per board are preserved with authoring code and captures. Some studies explore palette and type treatment while others alter the layout; they are not represented as ten sets of three wholly independent compositions. The user authorized updating the poor templates directly; no user mockup approval is claimed.

## What changed

- Draft Registry: replaced a crowded tap wall with four readable landscape columns and two portrait columns. All 16 drafts, descriptions, metadata and prices remain. Clear sample status replaces an unconnected kicked-tap claim.
- Botanical Cut: a serif Old Fashioned feature with a real matching cocktail photograph and a separate seven-item signature menu. Portrait places the feature above the menu. Default media are swappable.
- Cellar Folio: a ruled whisky/wine/spirits ledger. Portrait keeps whisky and wine together, then reflows spirits into two columns; all 21 offerings remain.
- After Work Poster: a strong announcement panel, explicit weekday/time window, four photographed offers, readable prices and prior prices. The earlier blanket discount claim was made consistent with the actual offer prices. The wine and chicken-tenders images match their labels.
- Marquee Set: a performance poster and five-slot schedule with explicit AM/PM times, editable descriptions and a real stock performance photograph. The sample/stock caption explains that the fictional lineup and photograph are examples.
- Table Concierge: bottle ledger, three package treatments and a readable example table plan. Portrait uses a two-column bottle/table section and a full-width package section. Default reservation/table claims are labeled as samples; the board does not claim a live connection.
- Terrace Score: a clear sample scoreboard beside specials, with portrait score/special sections. All original broadcast labels, team abbreviations, game fields, sponsor fields and footer controls remain editable. The sample clock is operator-owned and is not a fabricated live sports feed.
- Rewards Passport: a ticket composition and three editable reward tiers. A supplied `qr.url` generates a real QR code; blank or invalid links show customer-facing counter guidance. Reward claims are explicitly a sample program.
- Neighborhood Marker: prominent arrival information, a clearly labeled schematic location marker, contacts, service hours and service channels. Static Saturday replaces a false current-day label; “see service hours” replaces an unconnected open/closed status. The schematic does not pretend to be an accurate street map.
- Crew Call: recruitment poster with a local stock workplace photograph, four editable roles/pay/meta rows and counter guidance or a real application QR. An inconsistent hourly/salary line was corrected, and the sample pay/photo note is editable.

## Editability and preserved contracts

All 484 original text keys and 14 original image keys are preserved. The rebuilt sources contain 635 text keys and 26 image keys. Every visible text node is inside an editable `data-field`; this includes section labels, captions, sample indicators, logo-letter fallbacks, team/sponsor abbreviations and tier numbers. Header logo letters and QR guidance are siblings of their image slots, so the text click target is not swallowed by an image ancestor. Visible photos/logos are registered slots. Added QR foreground/background colors are editable `qr.dark` and `qr.light` fields; the URL and colors are available to the override panel.

Original `EDUCMS-SHIM-V5` (including `applyMenu`), `EDUCMS-CLICK-V2`, and `EDUCMS-MEDIA-CONTROLS-V1` scripts compare byte-for-byte against the originals on all ten boards. Only the additive click injector was run: 0 injections, 0 freeze additions, all bar 13 and QSR 28 sources skipped idempotently. No shared injector, API, preset metadata, poster or quarantine file was edited.

The local fitting engine honors explicit numeric/px font sizes from query snapshots and messages. It caches unchanged theme values so scale edits preserve API brand overrides. Clock query/message overrides become pinned values. Font fitting has an absolute 60 px floor for body/primary fields and 50 px for supporting labels on the 3840 source canvas; fonts have real CSS defaults before fitting. Increasing or reducing theme scale never moves a fitted field below its declared floor. Labels at 50 px become about 16.7 px and body at 60 px about 20 px on the actual 1280 × 720 and 720 × 1280 screenshots.

The original menu behavior still matches prices by name and preserves sold-out/restock handling. Its original description mapping remains `.d`/`.desc`; tap/cocktail `.r` fields remain manually editable as before. An additive CSS treatment makes sold-out labels at least 50 px, places them in the price area, and reveals the updated price when restocked. The original menu row dimming (0.4 opacity and grayscale) remains in effect for unavailable items. The source overlay code itself is unchanged.

## Verification and evidence

Evidence folder: `/Users/gschiemann/Desktop/template-flagship-audit/bar-qsr/`.

- `sandbox-saved-edit-final.json`: 40 cases, ten boards × Chromium/WebKit × landscape/portrait, with real `sandbox="allow-scripts"` iframes. Default and representative longer edits produced no JS errors, sub-floor fonts, scroll clipping, offstage field boxes or uneditable visible text nodes. Actual text/image clicks returned the expected keys. Explicit 72 px text survived theme.scale changes, API brand colors remained, clocks stayed pinned, and image replacement/contain/rotation survived message and saved URL snapshot reloads.
- `qr-verification.json`: 8 cases, two QR boards × both engines × both orientations. Rendered 720 px QR canvas pixels matched every module from the local encoder for the supplied URL, with 0 mismatches. Blank/invalid URL fallback, editable guidance click, image replacement, image clear and return to generated QR were checked. The QR encoder is bundled inline for saved standalone templates.
- `pos-layout-verification.json`: focused sold-out rendering for six menu boards in both engines and orientations. Every status label is at least 50 px and its parent name field stays unclipped. The complete saved-edit pass also tested menu price, supported description, sold-out and restock messages.
- `source-contract.json`: original/current key sets and exact retained script comparisons.
- All 44 inline scripts parse successfully. `git diff --check` passes. Selected local images were opened to verify the depicted subject. Sources were checked for scope drift after the additive injector run.
- Before files were copied from the lead’s original audit under `boards/`. Full after renders are named `<board>-<orientation>-<browser>.png`; representative saved edits, QR and sold-out renders have separate suffixes. Before/after comparisons and overview sheets are saved beside them.

Every selected composition was inspected as a full 1280 × 720 landscape and 720 × 1280 portrait image. WebKit examples were also inspected, including the final bottle-service portrait, QR and POS views. Browser metrics are evidence for bounded default/representative copy; they do not guarantee an arbitrary essay will fit a short menu field. Explicit operator font overrides are honored even when they exceed a layout’s capacity. Photos, theme colors and all copy can be replaced for the actual venue.

## Assets and integration boundaries

New local bar photographs: beer, cocktails, Old Fashioned, wine, performance stage and bar-room context, with Unsplash source endpoints and license link in `bar/assets/README.md`. An existing repository chicken-tenders asset is reused. QSR adds a stock workplace photograph and the browser bundle of qrcode 1.5.4; provenance is in `qsr/assets/refresh-assets-README.md` and the exact MIT license in `rewards-qr-LICENSE.txt`. Example photos are not presented as actual fictional venue staff or performers.

The lead owns centralized media/shim regeneration, posters/API references, application-level type checks, final combined browser verification, deployment and worktree cleanup. This source worktree remains preserved until the lead integrates the final commit. Local authoring/checkpoint artifacts are also copied to the Desktop evidence folder to survive context or usage interruptions.
