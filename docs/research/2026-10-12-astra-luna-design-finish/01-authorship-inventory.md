# Luna authorship inventory — 2026-10-12

## Scope and attribution

This is a bounded inventory of the template refresh waves and additive editor work documented in the supplied handoffs/reports; it is not an audit of all 453 offered presets. Standard Audit Surface 1–21 is scored below across Design / UX / Functionality. This was a pure read-only evidence review: no app, build, browser, tests, or repository edits were performed.

The durable source reports identify commits, branches, and assigned worktrees, but do not consistently identify the model that authored each change. Therefore the refresh sources below are **Luna-attributed by wave context, not independently proven authorship**. Exact original-model attribution is uncertain. The Oct 12 editor handoff explicitly says Luna components were merged, but attributes the final fixes to the lead. Astra’s retail service counter is explicitly Astra-authored and excluded from Luna scope.

## Refresh sources in scope

The refresh reports describe 57 existing HTML source refreshes (54 regular + 3 Christmas) and three new workflows. Exact paths are grouped by report; source naming is retained as in the repo.

- School (6): `apps/web/public/templates/school/elem-schedule-v1.html`, `elem-schedule-v2.html`, `elem-schedule-v3.html`, `ms-lobby-v1.html`, `ms-lobby-v2.html`, `ms-lobby-v3.html`.
- Corporate (8): `apps/web/public/templates/signage/corporate/{01-lobby-welcome-flagship,02-conference-room,03-kpi-dashboard,04-new-hires,05-floor-directory,06-all-hands,08-shuttle-board,09-events-week}.html`.
- Healthcare (10): `apps/web/public/templates/signage/healthcare/{01-waiting-room-flagship,02-physician-directory,03-now-serving,04-vaccine-clinic,05-hours-closures,06-patient-education,07-mychart-signup,08-pharmacy-pickup,09-clinical-trial,10-thanks-leave}.html`.
- Hospitality (4): `apps/web/public/templates/signage/hospitality/{03-events-board,06-wayfinder,08-checkin-status,09-outlook}.html`.
- Fashion (4): `apps/web/public/templates/signage/fashion/{02-editorial,03-sale,05-event-trunkshow,06-fitting-room}.html`.
- Veterinary (2): `apps/web/public/templates/signage/veterinary/{01-waiting-room-flagship,02-adopt-gallery}.html`.
- Clinic (1): `apps/web/public/templates/signage/clinic/01-campaign-flagship.html`.
- Restaurant menus (9): `apps/web/public/templates/signage/menus-pos/{01-fullservice-menu,02-wine-list,04-cocktail-program,05-86-board,06-brunch,07-prix-fixe,08-tasting-progress,09-reservations,10-takeaway-pickup}.html`.
- Bar (7): `apps/web/public/templates/signage/bar/{01-tap-list-flagship,02-cocktail-menu,03-bottle-list,04-happy-hour,06-tonight-live,07-bottle-service,08-game-day}.html`.
- QSR (3): `apps/web/public/templates/signage/qsr/{08-rewards,09-hours-location,10-now-hiring}.html`.
- Christmas (3): `apps/web/public/holiday-templates/{es-christmas,ms-christmas,hs-christmas}.html`.

New workflow sources: `apps/web/public/templates/signage/corporate/20-service-update.html` (all-industry Service Update), `apps/web/public/templates/signage/clinic/02-services-booking-guide.html` (Care Services & Booking), and `apps/web/public/templates/school/commencement-guest-guide.html` (Commencement Guest Guide). These were separate Oct 11 source assignments; model attribution is not stated in their reports. Retail Service Counter `apps/web/public/templates/signage/retail/09-service-counter.html` is **Astra**, redesigned in commits `750b2f91` / `b0f3f9a6` and integrated by `87d97b82`; it is not counted as Luna work.

### Astra coverage versus individual work

The Oct 11 Astra review says it viewed all 57 refreshed sources with saved landscape/portrait evidence and current posters, plus all three new designs in both orientations. This is representative/library visual review coverage, not 60 individual Astra redesign approvals. Individually fixed and final-render reviewed: `apps/web/public/templates/school/elem-schedule-v1.html`, `elem-schedule-v3.html`, and `apps/web/public/templates/signage/clinic/02-services-booking-guide.html`. Final screenshot directory: `/Users/gschiemann/Desktop/template-flagship-audit/astra-polish/final/` (12 PNGs: each of the three sources × Chromium/WebKit × landscape/portrait). The reports say the care photo crop was corrected; optional booking hierarchy polish remains open.

The retail counter has its own Astra redesign and screenshots under `/Users/gschiemann/Desktop/template-flagship-audit/retail-service-counter/` (specific final image names were not present in the reviewed handoff). The Oct 12 additive-editor handoff reports it merged but says final visual rerun and Astra widget review remain pending. Do not treat that as completed Astra widget approval.

## Luna additive editor components

The Oct 11 handoff says Luna components merged in `31dcc19e`, `4c034ede`, `b32639db`. Ten registered variants use existing `IMAGE`, `IMAGE_CAROUSEL`, and `CHART` canonical types: image frames, collages, tables/charts rows (exact variant names are not enumerated in the handoff). New frames/collages and table/chart choices were promoted; icons/QR were promoted; lazy renderers and natural footprints registered. The same handoff assigns corrections for ragged table-cell edits, fit precedence, frame shape, photo spacing/featured grid, captions, saved/player font loading, standard font-picker integration, collage array synchronization and insertion proportions to the lead. Thus these are Luna component contributions with documented lead corrections, not ten pristine Luna-only end-to-end designs. Astra’s retail counter is separate.

## Standard Audit Surface coverage (this inventory only)

C = covered within the documentary inventory; P = partial; D = deferred; N/A = not applicable. Full subsystem audits are outside scope.

| Section | Design | UX | Functionality | Scope note |
|---|---|---|---|---|
| 1 Real-time + signed pub/sub | D | D | D | No emergency/realtime review. |
| 2 Storage + content pipeline | P | P | D | Reports describe editable media slots and shared media behavior; no storage pipeline audit. |
| 3 AI providers | D | D | D | No provider audit. |
| 4 AI feature surfaces | P | P | D | Template/exemplar context only; no AI feature validation. |
| 5 AI comparative scan | D | D | D | No competitive scan. |
| 6 Streaming integrations | D | D | D | Outside scope. |
| 7 Sports score/data | P | P | D | Reports mention 24 contrast fixes; feeds and sports workflows not audited here. |
| 8 POS/commerce | P | P | D | Menu boards refreshed; live POS integration not audited. |
| 9 Communications | D | D | D | Outside scope. |
| 10 Auth/identity | D | D | D | Outside scope. |
| 11 Billing/commerce | D | D | D | Outside scope. |
| 12 Design imports | D | D | D | Outside scope. |
| 13 Public alerts | D | D | D | Outside scope; emergency pathways untouched. |
| 14 Multi-vertical | P | P | D | Inventory covers 57 refreshes + 3 new workflows; not full catalog quality or onboarding. |
| 15 Cross-browser/Chromium 83 | P | P | D | Reports preserve Chromium/WebKit evidence; no fresh run or Taurus qualification. |
| 16 Forensic/audit | D | D | D | No AuditLog or tenant-scope audit. |
| 17 Operational/DX | P | P | D | Reports and handoffs inspected; no operational checks performed. |
| 18 Accessibility | P | P | D | Readability/contrast described; no full accessibility audit. |
| 19 Template/widget editability | P | P | P | Source reports and editor handoff reviewed; this inventory did not rerun interactions. |
| 20 Design/UX/functionality lenses | C | C | P | Applied to the bounded inventory and explicitly distinguished report evidence from fresh verification. |
| 21 Verification before claim | C | C | C | Attribution limits, screenshot evidence, pending Astra rerun and no-runtime review are stated. |

## Evidence consulted

- `docs/handoffs/2026-10-10-template-quality-refresh.md`
- `docs/research/2026-10-10-template-flagship-refresh/CHECKPOINT.md` and the family reports `corporate.md`, `healthcare.md`, `healthcare-fashion-veterinary.md`, `corporate-bar-qsr.md`, `hospitality-holidays.md`
- `docs/research/2026-10-11-template-gaps/CHECKPOINT.md`, `README.md`, `healthcare.md`, `hospitality.md`, `final-catalog.json`
- `docs/research/2026-10-11-astra-template-review/README.md`, `01-astra-review.md`, `02-fix-verification.md`
- `docs/handoffs/2026-10-11-additive-editor-elements.md`, `docs/handoffs/2026-10-11-industry-template-coverage.md`
- Git history for the documented commits, including `217cfcf3`, `9d38a5e2`, `3af6ea59`, `65de5c7f`, `45c13052`, `5a8a2ffe`, `ba728fff`, `9e904463`, `ebb44c4a`, `fb356d8b`, `750b2f91`, `b0f3f9a6`, `87d97b82`.
