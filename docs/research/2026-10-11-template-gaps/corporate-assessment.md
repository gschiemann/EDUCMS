# Scoped template gap assessment — corporate, retail and public venues

Date: 2026-10-11. Author: corporate_flagships. **Scope is read-only catalog and source assessment**, covering corporate, retail, restaurants/bars, real estate, museums/public venues and everyday operational signage. This is not an audit of all integration implementations or a claim that existing widgets have passed browser/editability tests. No new source, registry, injector, poster or branch changes were made.

The requested baseline/catalog.json was absent. Used the preserved lead-authoring/catalog.json (482 presets), active-catalog.json (447 offered presets, including 151 native presets), and native-catalog.json, then checked current lead source at /Users/gschiemann/.codex/worktrees/template-editor-release/EDU CMS. Counts are preserved-baseline counts, not a freshly executed registry export. Current source confirms retirement of old native retail offerings and retained native seasonal promo.

## Standard Audit Surface coverage — first-page scope declaration

Covered means covered within the source/catalog scope above; deferred means the implementation/runtime assessment remains open. N-A would mean not built/applicable; no integration was declared N-A merely because it was outside this assignment.

| # | Domain | Design | UX | Functionality | Scope/reason |
|---|---|---|---|---|---|
| 1 | Real-time + signed pub/sub | Deferred | Deferred | Deferred | No emergency or delivery-system audit; proposed notice is ordinary operator-authored signage. |
| 2 | Storage + content pipeline | Covered | Covered | Deferred | Candidate asset/edit requirements identified; upload/cache/transcoding runtime excluded. |
| 3 | AI providers | Deferred | Deferred | Deferred | Provider implementations outside catalog gap scope. |
| 4 | AI feature surfaces | Deferred | Deferred | Deferred | No AI generation required to fill proposed workflows. |
| 5 | AI-tool comparative scan | Deferred | Deferred | Deferred | No competitive/AI parity claim made; separate comparative pass needed. |
| 6 | Streaming integrations | Deferred | Deferred | Deferred | Source catalog inspected only for overlap; no streaming integration tests. |
| 7 | Sports score/data integrations | Deferred | Deferred | Deferred | Sports outside assigned domains. |
| 8 | POS/commerce integrations | Covered | Covered | Deferred | Native restaurant/retail offerings and food pickup alternatives inspected; no provider sync tested. |
| 9 | Communications integrations | Deferred | Deferred | Deferred | Candidate shows editable contact directions; no SMS/email notification claim. |
| 10 | Auth + identity | Deferred | Deferred | Deferred | Read-only local source assessment; no auth change/audit. |
| 11 | Billing + commerce | Deferred | Deferred | Deferred | Outside template workflow gap scope. |
| 12 | Design import integrations | Deferred | Deferred | Deferred | No external design-import workflow evaluated. |
| 13 | Public alert integrations | Deferred | Deferred | Deferred | Routine service updates explicitly separate from alert integrations. |
| 14 | Multi-vertical surface | Covered | Covered | Covered | Offered presets/native alternatives inspected across six assigned domains; onboarding/billing not assessed. |
| 15 | Cross-browser + Chromium-83 | Deferred | Deferred | Deferred | New design not authorized; Chromium/WebKit/compatibility checks required after authoring. |
| 16 | Forensic/audit coverage | Deferred | Deferred | Deferred | No privileged action or endpoint modified; platform audit logging excluded. |
| 17 | Operational + DX | Covered | Covered | Deferred | Findings and evidence persisted; no deployment/CI/rollback claim. |
| 18 | Accessibility + a11y | Covered | Covered | Deferred | Proposed hierarchy/floor/alternative-route criteria identified; rendered contrast/keyboard testing deferred. |
| 19 | Template + Widget Editability | Covered | Covered | Deferred | Existing source fields/native configs inspected and new editable contract specified; no comprehensive A–F grade or browser claim. |
| 20 | Design + UX + Functionality lenses | Covered | Covered | Covered | Candidate value/30-second path and honest manual-data scope described; shipped functionality remains unverified. |
| 21 | Verification Before Claim | Covered | Covered | Covered | Catalog/source evidence recorded; clearly no new design created or shipped. Browser/deploy verification follows authorization. |

## Highest-value candidate 1 — Service Update / Temporary Closure

**Recommend first.** An everyday non-emergency service change must answer: what is affected, what should I do, when does the change apply, where do I go instead, and who can help. One reusable offered board serves a closed elevator, relocated reception, café closure, changed gallery entrance, unavailable amenity, retail checkout relocation or restaurant service interruption.

Nearest alternatives and why they are inadequate:

- Healthcare · Hours, source apps/web/public/templates/signage/healthcare/05-hours-closures.html; registered in system-presets.ts:2749. Fields cl.label/cl show one upcoming closure within a seven-day hours schedule. It does not dedicate the hierarchy to affected service, actionable alternate route/service, effective window and operator-set update stamp. Clinical appointment/urgent-care/ER copy also adds irrelevant conversion work outside healthcare.
- Corporate · Emergency, corporate/10-emergency-info.html. Four em.N.t/em.N.b instruction blocks (fire, earthquake, medical, security) and sec contact. A routine repair notice should have its own composition; adapting emergency instructions is a poor default and must not involve emergency endpoints or overrides.
- Corporate · Floor Directory, corporate/05-floor-directory.html, fl.N.num/name/way, rr and directory.help: normal destination listing, not a changed-service notice with timing/action.
- Store · Wayfinding — Signal/Monolith, retail/06-wayfinding-signal.html and 08-wayfinding-monolith.html: location/destination/action/route/distance/access/help fields give a normal route. They lack a purpose-built affected-service/effective-window/reopening hierarchy.
- Native ANNOUNCEMENT exists in active bar-trivia-night (Next Up/Round Prize) and church/education presets. It can hold title/message but no offered cross-industry operational notice has the required structured composition. Creating several widgets manually is capability, not a ready-to-use template.
- Resident Concierge touch kiosk (system-presets.ts:3325–3328) includes maintenance and notice content, but requires interactive navigation and is apartment-specific; a passive screen needs immediate action at a glance.

Proposed flagship direction: **Service Bulletin**, bold typographic status masthead, dominant affected-location headline, large single action/alternate destination rail, clear effective/reopening details, help and operator-set updated time. Deep ink + warm paper + orange accent, with color-independent status words. Distinct editorial sans/mono pairing exposed as theme.font.display/body/mono. Landscape uses a large status/action spread; portrait becomes a true vertical notice with its own spacing. No tiny footnotes, generic soft-card dashboard or simulated live feed.

Editable contract: every label/value; brand name/logo; status title, affected service/location, reason, next step, alternative destination, effective date/time, expected reopening, updated timestamp, help label/contact; optional QR destination with real generated code or editable manual link; display/body/mono fonts; all palette/background fields; media slot replacement/fit/position/rotation; text style and absolute operator font overrides. Body >=60px/support >=50px after automatic fitting at 3840 design dimension. Notice data stays manual unless a separately implemented source integration is selected.

Named happy path to prove after build: choose Service Update, click affected service and next step, replace two values, save. Under 30 seconds with a handful of clicks. Browser proof must include saved edits, explicit 72px + theme.scale, image replacement, colors/fonts, Chromium/WebKit at 1280×720 and 720×1280, long copy, no clipping/uneditable visible text.

## Highest-value candidate 2 — Retail Service Desk / Collection & Returns

An offered retail service board should direct shoppers to online collection, returns/exchanges and customer help without food-order language. It reduces repeated desk questions with concise requirements and one actionable location.

Nearest alternatives:

- Active retail baseline: eight HTML sources (two storefront, three endcap, three wayfinding), plus native retail-holiday-seasonal. These are promotions/products/routes rather than a collection/returns workflow. Preserved count is nine landscape offered records. Existing old retail-storefront-welcome, retail-aisle-wayfinding and five other native retail records are intentionally retired (ensure-system-presets.ts:85–111); they cannot be counted as active gap coverage.
- QSR · Mobile Pickup, qsr/07-mobile-pickup.html (system-presets.ts:3121): ready.N.num/name/items and prep.N.num/eta plus wait.minutes create a food-order queue. No return/exchange requirements, service desk hours or proof-of-purchase guidance.
- Menu · Takeaway, menus-pos/10-takeaway-pickup.html (system-presets.ts:3001): rd order records and nx kitchen records remain restaurant-specific, not a shopper service guide.
- Resident Concierge kiosk package records pkg.* address apartment packages, touch selection and lockers rather than retail collection/returns.
- Native RESTAURANT_WAIT_TIME in qsr-wait-time-display provides estimateMins/partiesAhead/smsNumber/smsKeyword/venueName. It is useful queue capability but not a retail desk composition, and should not imply unimplemented retail SMS/order integrations.

Proposed direction: **The Service Counter**, restrained store editorial layout with giant COLLECTION / RETURNS lanes, large two-step instructions, proof-of-purchase note, desk location/hours/help and optional swappable desk/parcel photo. Different loaded/editable serif + sans + mono pairing from Service Bulletin. Manual content by default; no fake order-sync or unsupported queue connection. Both orientations authored. Operator happy path: choose Service Counter, replace location/hours, replace required item, save under 30 seconds.

Editable contract: all visible copy/status/source labels, logo/photo slots, fonts, palette/backgrounds, instructions, service labels, proof/eligibility copy authored by operator, contact and optional URL/QR. No hardcoded policy promises. Floor and saved-edit verification same as candidate 1.

## Six-domain gap map and lower-priority findings

| Domain | Existing coverage inspected | Remaining gap / priority |
|---|---|---|
| Corporate | Lobby, conference, KPI, hires, floor directory, all hands, shuttle, events, emergency, Signal/ribbon, seven homebuilder layouts × two orientations (25 baseline offered records) | Routine service change highest priority. Visitor instruction board lower priority because office kiosk already has visitor welcome/wayfinding. |
| Retail | Eight HTML design studies + native seasonal promo; retired native merchandising layouts explicitly accounted for | Service desk/collection/returns second priority; routine service change also useful. All nine baseline records labeled landscape, so new true portrait adds practical breadth. |
| Restaurants/bars | 21 bar records incl native tap/cocktail/game/event/happy-hour/trivia; 62 QSR/menu-pos records incl native menus/wait/rewards/POS and HTML pickup | Menu, promotion and pickup are well represented. Routine interruption/changed entrance/service window remains broadly reusable; avoid another duplicate menu. |
| Real estate | One Availability signage record; fourteen homebuilder records; commercial leasing/model homes/resident concierge kiosks | Non-touch resident service/amenity interruption lacks a dedicated board. Open-house/property sales themes overlap existing homebuilder welcome/tour sources, so lower priority. |
| Museum/public venues | One Museum · Today record with exhibition hero/program timeline; museum exhibit and explorer-quest touch kiosks; school Gallery native portrait | Dedicated passive accessible-visit guide is a further gap (quiet space, accessible entrance/lift, step-free route, assistance). Routine service/gallery closure is higher shared value. |
| Cross-industry operations | Generic announcement capability, fixed emergency instruction board, per-vertical hours/directory/status templates | Service Bulletin supplies a purpose-built everyday action notice without platform integration work. |

Museum Today evidence: feat.name/meta/where exhibition, prog.N.time/name/loc program, mem.text member preview, cafe.value and wifi.value; not a complete accessible-visit guide. Real Estate Availability evidence: feat suite/stats/price, avail.N residence/price/status, tour.value and contact.value; not resident operational signage. Existing kiosks can support interactive tasks but do not substitute for passive screen compositions.

## Implementation boundaries and next step

No code yet. Lead chooses one candidate. On authorization create a new codex branch from requested lead commit 327b5621 in existing managed corporate worktree, preserving codex/corporate-flagship-refresh and all prior reports. New source only in assigned new template directory/assets; no shared injector, API preset registry or poster manifest edits. Lead registers the sources and two offered orientations. Load binding standards/brand schema before authoring, inject current shared runtime via lead-owned process, render and inspect one composition at a time, persist evidence and commit verified source. Existing refresh remains at d4bf0a561f7b5fe2eaf988d62a9e8c3ab129f0ec.
