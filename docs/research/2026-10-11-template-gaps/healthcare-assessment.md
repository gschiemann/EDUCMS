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
| 15 | Browsers and Chromium83 | Deferred | Deferred | Deferred | Build verification will be recorded below; hardware qualification remains lead-owned. |
| 16 | Forensic/audit coverage | Deferred | Deferred | Deferred | No privileged mutation or tenant/database changes. |
| 17 | Operational/DX | Deferred | Deferred | Deferred | Work preserved on disk; deployment/CI/rollback remain lead-owned. |
| 18 | Accessibility | Covered | Covered | Deferred | Large type, clear contrast and redundant labels planned; browser/keyboard verification pending. |
| 19 | Template editability | Covered | Covered | Deferred | All-copy/theme/media schema planned; saved-edit verification pending. |
| 20 | Three lenses | Covered | Covered | Covered | Visual purpose, 30-second operator path and actual capability separated throughout. |
| 21 | Verification before claim | Covered | Covered | Covered | Repository/catalog evidence cited; no live or untested behavior claim. |

## Discovery evidence and actual gaps

The provided baseline/catalog.json path was absent. Used equivalent current snapshots at `/Users/gschiemann/Desktop/template-flagship-audit/lead-authoring/current/active-catalog.json` (447 offered preset entries) and `native-catalog.json` (151 native presets), cross-checked against lead source `/Users/gschiemann/.codex/worktrees/template-editor-release/EDU CMS`. Relevant categories contain 49 offered entries: Healthcare10, Veterinary2, Clinic1, Gym11 and Fitness25. Fitness includes19 native presets and6 external-media entries. Counts are offered preset IDs, including orientation variants, not HTML file counts. Adjacent touch kiosks and non-care wayfinders were also reviewed as alternatives.

**Candidate1 — Care Services & Booking Guide (authorized).** Public service names, durations, fees/price qualifiers and a clear reception/phone/booking next step, reusable for veterinary care, clinics, dental/therapy offices and other appointment-based services. Nearest offered alternatives: `preset-sig-clinic-01` Clinic · Campaign; `preset-sig-healthcare-02` Healthcare · Physicians; `preset-sig-healthcare-06` Healthcare · Patient Education; native `fitness-lobby` Lobby — Premium Concierge. Campaign/education/directory boards explain a campaign, topics or people. The native fitness lobby contains personal greeting, recovery-room time slots/credits and concierge cards; it does not provide a general public service-menu-to-booking workflow. Restaurant/retail menu templates have price lists but require replacing the food/product structure and booking flow. This is an absent workflow, not a claim that a native fitness schedule is missing.

**Candidate2 — First Visit / Appointment Arrival Guide (deferred).** Non-touch administrative checklist: where to check in, what booking paperwork to have ready and how to request assistance. Nearest: `preset-sig-healthcare-01` Waiting Room, `preset-sig-healthcare-10` Thanks, `preset-sig-gym-03` Welcome Poster, native `fitness-lobby-welcome` Lobby Welcome, plus `preset-kiosk-clinic` Patient Check-In and `preset-kiosk-vet` Veterinary Check-In. Those cover queues, exit steps, member onboarding/class schedules or interactive lookup. A passive public appointment-preparation guide remains a distinct missing care/service workflow. Broad wayfinding was not selected: corporate, hospitality, retail and school directories already cover that use case, and care kiosks expose department navigation.

## Authorized build contract and operator happy path

One new source: `apps/web/public/templates/signage/clinic/02-services-booking-guide.html`. Lead will register `preset-sig-clinic-02` and `-portrait` under CLINIC/HEALTHCARE, frontend entries and posters. Administrative copy only, no medical promises, patient identities, synthetic availability or backend booking integration. Phone, reception and booking instructions are visible operator-configured values.

Happy path target: choose Services & Booking, click a service/fee and replace it, click phone/booking instruction and replace it, save; reopen the same saved content and styling. Fonts, all colors and scale use canonical theme fields. Logo and hero are replaceable image slots. Supporting type floors at50px and body at60px on the3840canvas, including after fitting. Three distinct studies and real Chromium/WebKit landscape/portrait saved-edit proof are required before the final source commit.

## Build and verification checkpoint

Assessment persisted before code. Authoring, studies and verification will be saved under `/Users/gschiemann/Desktop/template-flagship-audit/clinic-service-gap/`; this report is updated at each milestone. No shared injectors, registry, API, poster or manifest source is assigned to this agent.
