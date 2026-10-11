# Fashion, adoption and clinic flagship refresh

Second wave source report, 2026-10-11. Branch: `codex/healthcare-flagship-refresh`.
Managed tree: `/Users/gschiemann/.codex/worktrees/healthcare-flagship-refresh/EDU CMS`.
Dependency: healthcare source/assets from `4aa5a486`.

The first second-wave commit contains six existing boards: fashion02/03/05/06, veterinary02 and clinic01. A seventh board, veterinary01, was added by the lead after a read-only audit demonstrated small type, overflow, empty photography and a wide stage in portrait; that board is now complete in the separate verified follow-up described below. The newer retail/fashion boards and quarantined fashion07/08 have not been edited. Lead owns shared injectors, API exemplars/registration, generated posters, integration and deployment.

## Six rebuilt designs

| Path | Design | Changes and preserved behavior |
| --- | --- | --- |
| fashion/02-editorial.html | Sage skincare journal | Large italic serif editorial headline, real product photo in an arched frame, quoted authored copy and a replaceable stock formulator portrait. Product moves above the story in portrait. Existing ed.photo and all seven original DOM text keys retained. Added a replaceable wordmark/logo slot and author photo. |
| fashion/03-sale.html | Ochre outdoor campaign poster | Large 40% offer, real outdoor apparel photo, oversized secondary headline, clear shopping hours and Trail Club code. Portrait places the offer above the campaign image and stacks hours/club details. All 21 original DOM text keys and ed.photo/brand.logo preserved; local clock respects operator pins. |
| fashion/05-event-trunkshow.html | Plum jewelry invitation | Refined serif invitation, real gold-ring campaign photo, replaceable jeweler portrait, date/location/designer details and an editable RSVP address. Portrait reflows the image above the invitation. All 16 original DOM keys and ev.photo retained. |
| fashion/06-fitting-room.html | Boutique room wayfinding | Six arched room plaques, a prominent available-room count and large editable status/wait labels. Portrait changes from three-by-two to two-by-three rooms and moves the count above them. All 23 original DOM keys retained. Unsupported tap-the-screen and scan-any-room instructions now direct visitors to the staff; no fake touch action or QR. Added a replaceable wordmark/logo slot. |
| veterinary/02-adopt-gallery.html | Find-your-friend gallery | Four large real stock animal photos with ages, prominent names, breed and readable full descriptions. The bonded pair gets one photo with two adult dogs. Portrait is a deliberate two-by-two gallery. No truncated notes, hearts-as-buttons or unsupported live feed. All 29 original DOM text keys and four original pet photo slots retained; logo gains a swap slot. |
| clinic/01-campaign-flagship.html | Community clinic campaign | Large authored flu-shot campaign, real consultation photo, clear hours/location/check-in details and an easy-to-read queue strip. Portrait places the photo beneath the campaign and uses two-by-two queue details. All 22 original DOM text keys retained; nested campaign details are now atomic editable fields. Clinical claim copy retained. The check-in instruction now points to the actual front desk. Unsupported always-open/live-feed decoration removed; local clock and standard override updates retained. |

An HTML parser, excluding script selector strings, confirms 118/118 original real DOM data-field keys are retained. The six final documents have 197 real text/theme fields and 16 image/logo slots; every original photo slot is preserved.

## Type and editability

All 13 canonical theme fields are present in every board, including bg/ink/brand/brand2/accent/accent2/pos/neg, fDisplay/fHead/fBody/fMono and scale. Display, headline, body and mono faces are editable, as are the scale, all designed copy, colors, photos and logos. Every added text block has data-field and automatic fitting. Every photo and logo/wordmark has data-imgslot, a default/fallback and a has-img hiding rule. The sample addresses, stock identities and queue/adoption details remain operator-configured examples rather than connected records.

Font pairings vary by purpose: Cormorant Garamond with Hanken Grotesk for the skincare journal, jewelry invitation and boutique wayfinding; Hanken Grotesk for the bold sale poster; DM Sans display with Hanken Grotesk body for adoption and clinic. IBM Plex Mono is the editable mono face used for clocks/codes. Each family is requested explicitly in the font stylesheet; no template relies on an undeclared system display face. A separate 12/12 Chromium/WebKit font and editability sweep confirmed that the declared display and body families actually loaded and found zero visible text nodes outside editable fields or intentional decorative placeholders. The physician/formulator/designer and product photos are replaceable stock examples, not assertions of the sample identities or product ownership.

Body-copy fitting floors at 60px; supporting text floors at 50px on the 3840 canvas. Neither orientation hides overflow behind ellipses. The table below records actual CSS defaults and rendered Chromium sizes, not just the minimum diagnostic. WebKit has equivalent measured values within small font metrics differences.

| Body content | Landscape default / measured | Portrait default / measured |
| --- | --- | --- |
| Skincare quotation | 100px / 100px | 110px / 110px |
| Sale product line | 82px / 82px | 85px / 85px |
| Jewelry invitation description | 95px / 91px | 95px / 91px |
| Fitting-room assistance | 100px / 100px | 105px / 102px |
| Fitting-room introduction | 82px / 82px | 82px / 82px |
| Pet descriptions | 70px / 70px | 75px / 75px |
| Adoption meet-and-greet instruction | 86px / 86px | 80px / 72px |
| Clinic campaign paragraph | 94px / 83px | 94px / 94px |

The scale token changes both CSS font defaults and fitting limits. The local runtime preserves explicit message/query fontSize, clock pins and brand colors using the verified healthcare implementation. Source keeps the existing V14 and media companion; lead will centrally regenerate V15 during integration.

## Verification

The six-board final sweep passed 24/24 combinations: Chromium and WebKit, each at full 3840×2160 landscape and 2160×3840 portrait resolution, using the editor's real null-origin sandbox iframe. It asserts default and longer text, 1.15 type scale, ≥60px body after fitting, ≥50px support, zero text clipping, no fields beyond the stage, frozen preview typography parity, field-click messages, explicit 72px font from messages and queries, brand primary/accent changes, pinned clocks, image replacement and 15-degree rotation. Three tight enlarged-type cases were fixed by allocating more room rather than reducing the body floor. The sale percentage's final spacing is covered by a subsequent four-case targeted run.

All six default landscape and portrait screenshots were opened and visually inspected. Three authored studies per board were rendered (18 total) and compared, including alternate editorial/image ordering, sale poster/sticker direction, invitation framing, door plaques/arches, pet portrait/ribbon framing and clinic poster/archway layouts. The selected layouts differ by information structure and brand purpose. This is design exploration and rendered inspection, not user approval.

Evidence: `/Users/gschiemann/Desktop/template-flagship-audit/healthcare/second-wave/`.
Final full-resolution screenshots and metrics: `final/`.
Combined six-board metrics: `final/all-six-results.json`; latest targeted metrics: `final/results.json` (4/4 sale checks passed). Loaded-font and visible-copy coverage: `final/font-edit-results.json`.
Studies: `studies/`, including two inspected contact sheets.
Authoring and test harness: `scratch/design/fashion-veterinary/`, copied to evidence before managed-worktree cleanup.
Source passes git diff --check. No TypeScript/application code or database was edited; the lead must run the combined app integration checks and verify deployment before reporting these designs live.

## Assets and exact modified files

Eight local Pexels photos are included, with individual primary-source credits and license references in the two assets/README.md files. The clinic consultation and editorial formulator also reuse licensed healthcare assets from the first commit.

- apps/web/public/templates/signage/fashion/02-editorial.html
- apps/web/public/templates/signage/fashion/03-sale.html
- apps/web/public/templates/signage/fashion/05-event-trunkshow.html
- apps/web/public/templates/signage/fashion/06-fitting-room.html
- apps/web/public/templates/signage/veterinary/02-adopt-gallery.html
- apps/web/public/templates/signage/clinic/01-campaign-flagship.html
- apps/web/public/templates/signage/fashion/assets/README.md
- apps/web/public/templates/signage/fashion/assets/pexels-29675497.jpg
- apps/web/public/templates/signage/fashion/assets/pexels-16244563.jpg
- apps/web/public/templates/signage/fashion/assets/pexels-8433597.jpg
- apps/web/public/templates/signage/fashion/assets/pexels-6263068.jpg
- apps/web/public/templates/signage/veterinary/assets/README.md
- apps/web/public/templates/signage/veterinary/assets/pexels-15265096.jpg
- apps/web/public/templates/signage/veterinary/assets/pexels-21419180.jpg
- apps/web/public/templates/signage/veterinary/assets/pexels-1750542.jpg
- apps/web/public/templates/signage/veterinary/assets/pexels-30810872.jpg
- docs/research/2026-10-10-template-flagship-refresh/healthcare-fashion-veterinary.md
- docs/research/2026-10-10-template-flagship-refresh/healthcare.md (corrected DOM counts; the earlier regex included script selector strings)

Existing board paths/IDs/classifications are retained. API metadata, poster generation, V15 shim injection, CI, deployment and worktree cleanup remain with the lead.


## Veterinary01 follow-up — Pet of the Day waiting room

The lead added `apps/web/public/templates/signage/veterinary/01-waiting-room-flagship.html` after the read-only audit found 16 supporting fields below the 50px floor, 15 overflowing text boxes, an empty pet-photo default and the landscape canvas incorrectly retained in portrait. The rebuild preserves all 28 original real DOM text keys and the original `pod.photo` slot. It adds 13 canonical theme fields and a replaceable `brand.logo` slot: 41 real fields, two image/logo slots, zero lost keys. The sample pet and queue text remains manually editable; unsupported Live and nonexistent `/api/vet/...` feed decoration has been removed.

The selected concept uses a large arched Golden Retriever portrait beside a warm editorial pet feature, a four-row care ledger, and a clear footer for authored care copy, hours and front-desk assistance. In portrait the pet feature sits above the full-width care ledger, with the care tip above a two-column hours/assistance footer. It is a real 2160×3840 stage rather than a scaled wide frame. Three actual studies were rendered and individually inspected: arched portrait, opposing-corner ticket frame and full rectangular portrait with a tinted care ledger. The arched direction was selected following visual inspection; this is not a claim of user approval.

This board adds a fourth distinct font direction to the second wave: **Fraunces** display with **DM Sans** headlines/body and **IBM Plex Mono** clock. Both Chromium and WebKit confirmed loaded Fraunces/DM Sans font faces. Every visible word is covered by an editable field; the visible-text audit found zero uncovered nodes. The four font roles remain editable canonical fields. All eight color roles and both real photo/logo slots remain editable. The supplied portrait is a locally credited stock photo by Helena Lopes, not an assertion that this model is the sample pet Biscuit. It can be replaced using the original `pod.photo` key.

The following table records actual CSS defaults and rendered Chromium body sizes at the full canvas resolution. The corresponding WebKit measurements are equivalent within font-metric differences. Supporting fields floor at 50px; all body fields floor at 60px, with the floor and ceiling both scaled by theme.scale. Longer copy and 1.15 scale remain within those floors without clipping or ellipses.

| Body field | Landscape default / measured | Portrait default / measured |
| --- | --- | --- |
| Pet age/breed/visit description (`pod.meta`) | 84px / 77.17px | 84px / 73.40px |
| Pet feature quotation (`pod.quote`) | 88px / 88px | 86px / 82.78px |
| Care-row status (`board.*.status`) | 78px / 78px | 88px / 88px |
| Authored care tip (`tip.text`) | 82px / 78.01px | 86px / 86px |
| Front-desk assistance (`cta.value`) | 96px / 96px | 96px / 96px |

The final targeted sweep passed **4/4**: Chromium and WebKit at 3840×2160 and 2160×3840, running in the real null-origin editor sandbox. It covers default copy, a longer pet name/description/quotation and clinician care note, 1.15 scale, frozen typography parity, zero text clipping/out-of-stage fields, ≥60px body/≥50px supporting copy, explicit message/query 72px font size, pinned local clock, editable-field click, primary/accent updates, image swap and rotation. Tight care-note and assistance boxes were enlarged rather than shrinking the body floor. Both full-resolution default orientations were opened and visually inspected after the final run. Two further Chromium/WebKit checks confirm loaded fonts and complete visible-copy editability. Two control checks also changed all four font roles, all eight color tokens, both image/logo slots, image rotation and contain fit, and exercised text/photo click selection. A separate fit-only message works in both engines. The extra combined image-plus-fit message exposed a shared V1 ordering defect in WebKit: the generic shim can repaint cover after the capture-phase fit listener. This is not a board CSS defect; the lead has added a coalesced setTimeout(0) reapplication to the shared V2 companion after complete message dispatch. Corpus-wide combined verification is pending with the lead; this source intentionally preserves the assigned old companion for central regeneration.

The authored dental tip's existing claim about brushing three times weekly preventing most dental disease is unchanged. It is existing sample clinical copy, not a new clinical assertion added by this design work, and is flagged for the clinical content owner rather than represented as verified medical guidance.

Follow-up evidence under `/Users/gschiemann/Desktop/template-flagship-audit/healthcare/second-wave/`:

- `final/waiting-results.json`: four successful browser/orientation cases and actual font metrics.
- `final/waiting-font-edit-results.json`: loaded font faces and zero uncovered visible text in both browsers.
- `final/waiting-edit-controls.json`: actual font/color/slot/click changes, combined-message fit defect and successful fit-only result; lead owns the central V2 correction.
- `final/waiting-field-audit.json`: 28/28 original DOM keys and the original photo slot preserved.
- `final/veterinary-01-waiting-room-flagship-*-*.png`: full-resolution final views.
- `studies/veterinary-01-waiting-room-flagship*.png`: three inspected studies.
- `harness/`: persisted authoring and test scripts, including waiting.py.

Exact follow-up source/report files:

- apps/web/public/templates/signage/veterinary/01-waiting-room-flagship.html
- apps/web/public/templates/signage/veterinary/assets/pexels-35511912.jpg
- apps/web/public/templates/signage/veterinary/assets/README.md
- docs/research/2026-10-10-template-flagship-refresh/healthcare-fashion-veterinary.md

The source retains its existing shim/media companion. Shared V15 regeneration, API exemplars, generated posters, integration, live deployment proof and managed-worktree cleanup remain with the lead. The prior six-board commit is `02aabad42a3c0472289787eed7c8124d3a9303f1`, integrated by the lead as `45c13052`; this follow-up does not redo those boards.
