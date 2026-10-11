# Care and service template gaps — scoped assessment and build record

2026-10-11. Scope: read-only offered-template discovery across healthcare, veterinary, clinic, fitness/gym and adjacent care/service workflows, followed by one authorized new Care Services & Booking Guide. This is not a full-app integration, runtime, database, security or competitive audit. Prior healthcare/fashion/veterinary branches remain preserved. New branch: codex/clinic-service-gap from 327b5621. Lead owns catalog registration, frontend entries, poster manifests, integration and deployment. No source design is claimed live.

## First-page Standard Audit Surface coverage

Covered means covered within this narrowly stated template-discovery/build scope; it does not certify the corresponding full app subsystem. Deferred domains require a separate system audit or the lead's integration check.

| # | Domain | Design | UX | Functionality | Reason / limit |
| --- | --- | --- | --- | --- | --- |
| 1 | Real-time and signed pub/sub | Deferred | Deferred | Deferred | No emergency, feed or transport changes; new values are operator-authored. |
| 2 | Storage and content pipeline | Deferred | Deferred | Deferred | Reuse credited local stock asset; upload/offline/transcode pipeline outside scope. |
| 3 | AI providers | Deferred | Deferred | Deferred | No generation providers or key handling changed. |
| 4 | AI feature surfaces | Deferred | Deferred | Deferred | Hand-authored template; AI runtime outside scope. |
| 5 | AI comparative scan | Deferred | Deferred | Deferred | Internal catalog gap discovery only; no competitor benchmark requested. |
| 6 | Streaming integrations | Deferred | Deferred | Deferred | New guide has no stream. |
| 7 | Sports integrations | Deferred | Deferred | Deferred | Outside care/service workflow. |
| 8 | POS integrations | Deferred | Deferred | Deferred | Fees are manually configured, with no payment/POS connection. |
| 9 | Communications | Deferred | Deferred | Deferred | Displayed phone/booking instructions only; no messages sent. |
| 10 | Auth and identity | Deferred | Deferred | Deferred | No authentication changes or patient identity displayed. |
| 11 | Billing and commerce | Deferred | Deferred | Deferred | No checkout/billing integration; displayed fees are operator values. |
| 12 | Design imports | Deferred | Deferred | Deferred | No import pipeline change. |
| 13 | Public alerts | Deferred | Deferred | Deferred | Outside scope; no emergency changes. |
| 14 | Multi-vertical surface | Covered | Covered | Covered | Offered catalog and native presets compared for actual workflow coverage; runtime onboarding/billing deferred. |
| 15 | Browsers and Chromium83 | Covered | Covered | Covered | Actual Chromium and WebKit sandboxed orientation/edit/reload checks; physical Chromium 83 and fleet qualification deferred to lead. |
| 16 | Forensic/audit coverage | Deferred | Deferred | Deferred | No privileged mutation or tenant/database changes. |
| 17 | Operational/DX | Deferred | Deferred | Deferred | Work preserved on disk; deployment/CI/rollback remain lead-owned. |
| 18 | Accessibility | Covered | Covered | Covered | Rendered body/support floors, large labeled booking instructions and absence of clipped copy verified; full editor keyboard/accessibility audit deferred. |
| 19 | Template editability | Covered | Covered | Covered | All 33 visible text fields, 13 theme fields and 2 media slots; real click, message, saved-URL/reload proof. Inherited 1-row repeater regrowth gap documented below. |
| 20 | Three lenses | Covered | Covered | Covered | Visual purpose, 30-second operator path and actual capability separated throughout. |
| 21 | Verification before claim | Covered | Covered | Covered | Repository/catalog evidence cited; no live or untested behavior claim. |

## Discovery evidence and actual gaps

The provided baseline/catalog.json path was absent. Used equivalent current snapshots at `/Users/gschiemann/Desktop/template-flagship-audit/lead-authoring/current/active-catalog.json` (447 offered preset entries) and `native-catalog.json` (151 native presets), cross-checked against lead source `/Users/gschiemann/.codex/worktrees/template-editor-release/EDU CMS`. Relevant categories contain 49 offered entries: Healthcare 10, Veterinary 2, Clinic 1, Gym 11 and Fitness 25. Fitness includes 19 native presets and 6 external-media entries. Counts are offered preset IDs, including orientation variants, not HTML file counts. Adjacent touch kiosks and non-care wayfinders were also reviewed as alternatives.

**Candidate 1 — Care Services & Booking Guide (authorized).** Public service names, durations, fees/price qualifiers and a clear reception/phone/booking next step, reusable for veterinary care, clinics, dental/therapy offices and other appointment-based services. Nearest offered alternatives: `preset-sig-clinic-01` Clinic · Campaign; `preset-sig-healthcare-02` Healthcare · Physicians; `preset-sig-healthcare-06` Healthcare · Patient Education; native `fitness-lobby` Lobby — Premium Concierge. Campaign/education/directory boards explain a campaign, topics or people. The native fitness lobby contains personal greeting, recovery-room time slots/credits and concierge cards; it does not provide a general public service-menu-to-booking workflow. Restaurant/retail menu templates have price lists but require replacing the food/product structure and booking flow. This is an absent workflow, not a claim that a native fitness schedule is missing.

**Candidate 2 — First Visit / Appointment Arrival Guide (deferred).** Non-touch administrative checklist: where to check in, what booking paperwork to have ready and how to request assistance. Nearest: `preset-sig-healthcare-01` Waiting Room, `preset-sig-healthcare-10` Thanks, `preset-sig-gym-03` Welcome Poster, native `fitness-lobby-welcome` Lobby Welcome, plus `preset-kiosk-clinic` Patient Check-In and `preset-kiosk-vet` Veterinary Check-In. Those cover queues, exit steps, member onboarding/class schedules or interactive lookup. A passive public appointment-preparation guide remains a distinct missing care/service workflow. Broad wayfinding was not selected: corporate, hospitality, retail and school directories already cover that use case, and care kiosks expose department navigation.

## Authorized build contract and operator happy path

One new source: `apps/web/public/templates/signage/clinic/02-services-booking-guide.html`. Lead will register `preset-sig-clinic-02` and `-portrait` under CLINIC/HEALTHCARE, frontend entries and posters. Administrative copy only, no medical promises, patient identities, synthetic availability or backend booking integration. Phone, reception and booking instructions are visible operator-configured values.

Happy path target: choose Services & Booking, click a service/fee and replace it, click phone/booking instruction and replace it, save; reopen the same saved content and styling. Fonts, all colors and scale use canonical theme fields. Logo and hero are replaceable image slots. Supporting type floors at 50px and body at 60px on the 3840 canvas, including after fitting. Three distinct studies and real Chromium/WebKit landscape/portrait saved-edit proof are required before the final source commit.

## Three concepts and selected design

Three authored HTML studies and rendered screenshots were reviewed individually before choosing the final layout. These are self-reviewed concepts, not user-approved designs.

1. **Reception ledger (selected).** One large consultation photo alongside aligned service, visit-length and fee columns; all three booking channels sit below the comparison. It makes service-to-booking the reading order and retains both service descriptions and fee qualifiers.
2. **Booking ticket.** Mirrored information order, arch-shaped photo and dark booking strip. Clear contact emphasis, but the dark footer draws attention before the service comparison.
3. **Appointment poster.** Wide welcome strip above three horizontally arranged service blocks. Stronger promotion emphasis, but less efficient comparison and a less useful photo crop for this informational use case.

Final portrait is deliberately composed: compact photo/welcome region, service comparison, reception and phone in two columns, then a full-width online address. Visual review found a narrow URL column and an overly cropped photo; the footer was recomposed and the default photo position adjusted. Chromium's Manrope glyph bounds required more vertical room during longer-copy and 1.15-scale tests; fields were enlarged rather than shrinking below the specified floors. No 5-card generic batch or fabricated feed was introduced.

## Final source and complete editability

Assigned source: `apps/web/public/templates/signage/clinic/02-services-booking-guide.html`.

- **33 visible editable text fields**, including all service names, descriptions, durations, fees and fee qualifiers; column labels; brand/tagline; welcome/title; reception, phone and online booking instructions. Every visible designed word is inside a `data-field`. The decorative empty-logo plus is an image placeholder.
- **13 canonical theme fields**: `theme.bg`, `ink`, `brand`, `brand2`, `accent`, `accent2`, `pos`, `neg`, `fDisplay`, `fHead`, `fBody`, `fMono` and `scale`. Every authored palette color and font family comes from these variables. Scaling applies to defaults and auto-fit limits; explicit operator font sizes remain absolute.
- **2 replaceable slots**: `brand.logo` and `hero.photo`. Default hero is the existing local consultation photograph `healthcare/assets/pexels-5215008.jpg`, credited to Antoni Shkraba in the existing assets README, with source https://www.pexels.com/photo/woman-consulting-a-doctor-5215008/ and Pexels license reference there. Stock models do not identify the sample clinic or real patients. No new asset was downloaded or added.
- Service repeat group **service** is intentionally capped at **3** (`data-repeat-max="3"`) for distance reading. Keys are `service.0`, `.1`, `.2`, each with `.name`, `.description`, `.duration`, `.fee`, `.qualifier`. Fields are direct children of each service article, conforming to the generic repeater detector.
- No clock, dated availability, QR code, patient identity, clinical outcome assertion, payment or booking integration. Default fees and contact instructions are administrative example values that the operator replaces; the online address uses a reserved example domain.
- Canonical V15 and media V2 were injected using the unchanged repository scripts through a wrapper restricting the filesystem walk/write to this new source. Font89 is included. Shared injector, API, registration and poster source files were not edited.

## Font pairings and actual body sizes

Authored defaults: **Lora** display, **Manrope** headings/body, **IBM Plex Mono** duration/guide/address. All three families were actually loaded in both browsers, rather than only declared as CSS names. Saved-edit verification changed all four theme roles to **Fraunces / Inter / DM Sans / JetBrains Mono** and one field to **Playfair Display**; all five replacements actually loaded, applied and survived reload. This pairing is distinct from the existing clinic campaign and veterinary/healthcare layouts.

Sizes below are physical pixels on the fixed 3840×2160 / 2160×3840 canvas, before viewport downscaling. Declared sizes are meaningful CSS defaults even when gallery freeze is active; fitting does not invent the hierarchy.

| Body field | Landscape declared | Landscape rendered | Portrait declared | Portrait rendered |
| --- | ---: | ---: | ---: | ---: |
| Welcome caption | 86 | 82.98 | 88 | 85.59–88 |
| Service descriptions | 75 | 75 | 82 | 82 |
| Fee qualifiers | 70 | 70 | 75 | 75 |
| Booking explanation | 78 | 78 | 65 | 65 |
| Reception instruction | 86 | 86 | 80 | 80 |
| Telephone | 96 | 96 | 80 | 80 |
| Online address | 88 | 88 | 80 | 80 |

Default rendered body minimum: **70px landscape / 65px portrait**. Default supporting minimum: **61.8–64px landscape / 56px portrait**. At normal scale every body fit floors at 60px and support at 50px. Scale 1.15 raises those fit floors proportionally, and longer-copy checks retained the floors with no clipping. Service display defaults are 110–125px, duration 105–110px, and principal title 165px.

## Real browser proof and measured limits

**4/4 complete browser/orientation cases passed** in real null-origin `sandbox="allow-scripts"` iframes: Chromium and WebKit, 3840×2160 landscape and 2160×3840 portrait. Each complete case checks default, longer copy, longer copy + 1.15 scale, gallery freeze, live edits, saved query edits, reopen and restore from two to three rows. Across these states there were zero JavaScript errors, fields below their configured floors, field overflow, clipping by hidden parent frames, copy outside the stage, or visible words missing edit keys. Current final default captures were separately refreshed after photo positioning.

Verified interactions and persistence:

- Click service text and hero photo: correct `educms-field-click` key arrives at the parent.
- Longer service names/descriptions/qualifiers, reception copy, telephone and a real-looking long reserved-domain address: `booking.oakandwillow.example/appointments`.
- Explicit brand font size 72px, bold, italic, underline, color, alignment and font family survive automatic fitting.
- All four theme font roles, scale, primary/accent/background and secondary accent apply; changing scale does not overwrite supplied brand colors.
- Both logo and hero source changes combined with **contain + rotation** in one message. WebKit normalizes -10 degrees to 350 degrees, which is equivalent. The saved replacement images were also loaded and checked for nonzero natural dimensions.
- All edits restored from base64 query parameters and survived a second load; template source continues to contain the authored defaults.
- Three → two → three repeat updates pass with stable group keys and no clipping. The guide sets the shared repeat gap to zero because its own row rules supply the separation.
- `freeze=1` keeps the same default font hierarchy, with no measured font drift beyond the 0.6px check tolerance.

**Inherited shared repeater gap, escalated to lead:** three → one → three stays at one. Exact parent messages: `{type:'educms-overrides', repeat:{service:1}}`, followed by `{type:'educms-overrides', repeat:{service:3}}`. Actual `.services .service` count is 1, then 1. Initial URL equivalent: `?repeat=eyJzZXJ2aWNlIjoxfQ` followed by the live three-row payload. V15 `_rpGroups` ignores groups with fewer than two indexed rows, so it loses its group blueprint after reducing to one. No shared script was changed by this agent. Two-to-three and fresh saved URL counts work; unlimited repeat growth is not claimed. The lead owns the bounded central correction.

This agent's sandbox protocol verification does not prove authenticated builder saves, gallery registration, final posters, backend persistence, production delivery or physical hardware qualification. The lead owns those integration checks and the final offered-preset IDs (`preset-sig-clinic-02` and `-portrait`). No live deployment claim is made.

## Preserved evidence and handoff

Evidence root: `/Users/gschiemann/Desktop/template-flagship-audit/clinic-service-gap/`.

- `studies/`: all three rendered concepts.
- `default/`: full-resolution final default screenshots in both engines/orientations.
- `long-copy/`, `saved/`: full-resolution interaction/saved examples.
- `default-results.json`, `full-results.json`: per-field physical sizes, loaded fonts, keys, media state, query URLs, errors and geometry checks.
- `authoring/`: build script, exact studies, scoped injection wrapper and verification helpers, copied before cleanup.
- `source-checkpoint.html`, `healthcare.md`: current source and full report backup.

Two files belong in the agent commit: the new clinic HTML and this force-added research report. All prior branches and completed healthcare/fashion/veterinary work remain intact. Lead handles catalog/API/gallery/posters/shared repeater, reviews the diff, runs integration/preflight/CI, and archives the managed worktree after salvaging needed ignored evidence.
