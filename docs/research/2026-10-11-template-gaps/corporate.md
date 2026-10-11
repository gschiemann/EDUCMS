# Service Update — new editable operational template

2026-10-11. Scope: one new passive signage template, corporate/20-service-update.html, selected after the read-only corporate/retail/restaurant/bar/real-estate/museum/cross-industry catalog gap assessment. This report covers template source and sandbox rendering; provider integrations, emergency logic, auth/audit, production deployment and real CMS registration/save are outside this agent’s assignment. Lead owns registry/catalog/posters and real builder integration. No claim that this source is live.

## Standard Audit Surface — scoped coverage

Covered means assessed/verified within this template assignment. Deferred means the broader platform domain was not audited; none is incorrectly marked N-A just for being out of scope.

| # | Domain | Design | UX | Functionality | Scope / reason |
|---|---|---|---|---|---|
| 1 | Real-time + signed pub/sub | Deferred | Deferred | Deferred | Ordinary staff-authored notice; no emergency/delivery logic touched. |
| 2 | Storage + content pipeline | Covered | Covered | Covered | Two slots replace/clear/reload using existing assets; upload/cache pipeline deferred. |
| 3 | AI providers | Deferred | Deferred | Deferred | No AI calls or provider implementation changes. |
| 4 | AI feature surfaces | Deferred | Deferred | Deferred | No AI feature needed for this operational starting template. |
| 5 | AI comparative scan | Deferred | Deferred | Deferred | Separate competitive audit; no parity claim. |
| 6 | Streaming integrations | Deferred | Deferred | Deferred | No stream surface or integration authored. |
| 7 | Sports score/data | Deferred | Deferred | Deferred | Outside assigned domains. |
| 8 | POS/commerce integrations | Covered | Covered | Deferred | Native/menu/pickup overlap assessed; provider runtime not tested. |
| 9 | Communications integrations | Covered | Covered | Deferred | Help contact is editable copy; no SMS/email notification implementation. |
| 10 | Auth + identity | Deferred | Deferred | Deferred | No auth change or audit. |
| 11 | Billing + commerce | Deferred | Deferred | Deferred | No billing change or audit. |
| 12 | Design import | Deferred | Deferred | Deferred | No external import workflow assessed. |
| 13 | Public alerts | Deferred | Deferred | Deferred | Everyday maintenance notice, no alert integration change. |
| 14 | Multi-vertical surface | Covered | Covered | Covered | Six-domain/native source overlap assessed; lead registers both orientations and visibility. |
| 15 | Cross-browser + Chromium-83 | Covered | Covered | Covered | Actual Chromium/WebKit both orientations; companions compile for Chrome83/Safari12. Historical hardware/browser runtime deferred. |
| 16 | Forensic/audit coverage | Deferred | Deferred | Deferred | No privileged endpoint mutation/auth/AuditLog change. |
| 17 | Operational + DX | Covered | Covered | Covered | Source/authoring/report/evidence checkpointed locally, isolated branch, no push. Production CI/deploy deferred to lead. |
| 18 | Accessibility | Covered | Covered | Covered | Source type floors, default contrast, color-independent status words, route/action hierarchy tested. Whole-builder keyboard/axe audit deferred. |
| 19 | Template/widget editability | Covered | Covered | Covered | Every visible copy/font/color/logo/photo exposed; sandbox click/apply/save-param/reload verified. Existing focal-position control gap noted below. |
| 20 | Design/UX/functionality lenses | Covered | Covered | Covered | Three composition studies, chosen layout reviewed, named edit path exercised, manual data truthfulness. Real builder path awaits lead. |
| 21 | Verification before claim | Covered | Covered | Covered | Four actual browser/orientation cases and screenshot inspection, clear local/source-only delivery scope. |

## What was added and why

A reusable Service Update board answers: what is affected, what to do instead, when the change applies, when reopening is expected and who can help. Defaults show an atrium elevator temporarily closed for routine maintenance and the east elevator alternative. Every date/status/update is staff-authored text; there is no automatic status feed, auto-polling or emergency behavior. The source attribution is editable and names the building team.

Nearest existing alternatives: Healthcare Hours has one closure field within seven-day hours; Corporate Emergency is fixed fire/earthquake/medical/security instructions; Corporate Floor Directory and Retail Wayfinding describe normal routes; native ANNOUNCEMENT supports prose but has no offered action/timing/alternative composition. Resident Concierge is an apartment touch workflow. The board fills a practical passive-screen gap across corporate, retail, restaurants, real estate, museums and public venues.

Second candidate, retained for later: Retail Collection & Returns / Service Desk. Retail sources focus on storefront/endcap/wayfinding and one native seasonal promo. Food pickup boards/native restaurant wait widgets and resident packages do not provide retail desk location/hours, requirements and next steps. The assessment includes full native alternatives, retirement/quarantine distinctions and domain map at Desktop/template-flagship-audit/gaps/corporate-public-retail-assessment.md. Used lead-authoring/catalog.json (482), active-catalog.json (447, including 151 native), native-catalog.json; requested baseline/catalog.json was absent. Counts are preserved baseline, verified against current lead source, not a newly executed registry snapshot.

## Three studies and final composition

- Depot Bulletin: dark operational status column, large alternative action on warm paper, explicit timing/help/update bands. Selected through agent self-review; no user mockup approval claimed.
- Public Notice: serif civic notice with central rule and announcement-led spread. Rejected because action/timing density was weaker at viewing size.
- Access Route: green guide-line metaphor with right-hand alternate-route panel. Rejected because subordinate timing fields were more crowded.

Each is a distinct composition with a different font pairing, not a palette-only alternate. Full studies and author.py are preserved under Desktop/template-flagship-audit/service-update/authoring/studies. Only Depot Bulletin is the offered source.

Landscape uses a two-column operational notice. Portrait becomes a vertically authored status/action/timing/help sequence on a 2160×3840 canvas; no scaled landscape layout. Inspected actual 1280×720 and 720×1280 screenshots. Spacing was revised after visual inspection found route/timing overlap that individual field overflow checks missed; pairwise field-box intersections were added. Alternative font metrics and 1.25× global scale required larger labels/notes; space increased while font floors remained intact.

## Editable coverage and typography

41 unique fields: 28 visible copy fields plus 13 theme fields. No duplicate keys. Every visible brand/reference/status/service/reason/action/route/timing/help/update/source label and value, including the fallback initials and arrow, is a data-field. Every visible field has auto-fit and a real CSS default size. Body has a 60px floor and supporting copy a 50px floor; 0.6× scale never lowers those floors. Explicit numeric 72px operator text stays absolute after message callbacks, theme changes and persisted reload.

Default loaded fonts: Barlow Condensed display, Manrope heading/body, IBM Plex Mono labels. Editable theme.fDisplay/fHead/fBody/fMono and theme.scale. Saved alternate Bebas Neue / IBM Plex Sans / DM Mono were confirmed loaded inside the sandbox rather than silently falling back. Canonical theme fields brand/brand2/accent/accent2/ink/bg/pos/neg plus all fonts/scale are exposed. Status fill follows brand; route/help fills accent2; action rule accent; paper bg; body/rules ink; emphasis neg. Individual color/font/size/weight/line-height styles also pass.

Image keys: **brand.logo** and **hero.photo**. hero.photo is the clearly visible route/optional location-photo area, with an editable arrow fallback. Replace/Fit/Rotate, placeholder hiding, saved reload and clearing back to arrow/initials passed in both engines and orientations. A stock person/product photo would be misleading for an operational route, so default is a native wayfinding arrow, not an unrelated photo. Operator can insert the actual site photo. Default panel/placeholder colors are editable theme colors.

Shared limitation discovered: current MediaStyle supports fit/rotation/hidden but resets image focal positioning to center. No arbitrary background-position option is wired in the companion. This is documented rather than patched outside assignment. Lead has been informed; Replace/Fit/Rotate work. Broader add/remove/reorder of sections is the generic builder/template contract rather than a new local list UI.

## Verification and practical limits

Four sandbox cases: Chromium/WebKit × landscape/portrait. Default and representative longer edits have zero page errors, subfloor text, scrolling/clipping, offstage fields, uneditable visible text or pairwise field-box intersections. Five text hot zones (status, location, alternative, updated, reopening) and both image hot zones report correct keys/kinds. Saved photo/styles/fonts/colors/global scale reload through actual base64 EXTERNAL_HTML query parameters. theme.scale 1.25 and 0.6 both pass; 72px survives and theme updates preserve API brand colors. Clearing both media slots restores initials/arrow. Updated/reopening copy remains operator-set through reload.

Named happy path: select Service Update, click affected location and alternative destination, change two values, save. The sandbox click/apply part measured 121–139ms of automation; it simulates persistence via the real board URL contract. This is not a measured human end-to-end CMS save time. Lead verifies actual Properties-panel edit/save/reload integration, gallery registration and shared vertical visibility.

Default contrast ratios (WCAG formula):

- paper text: 14.22:1
- status text: 13.13:1
- status accent: 8.7:1
- closed/action emphasis: 6.7:1
- route/help text: 12.8:1

Evidence: /Users/gschiemann/Desktop/template-flagship-audit/service-update/

- final-defaults.json and four default screenshots;
- sandbox-saved-edit-verification.json with all four complete cases;
- copy/long-copy/saved/media-cleared screenshots per case;
- source-contract.json with source hash, field keys, slots and companion markers;
- default-contrast.json;
- all three study sources, author.py, capture.cjs, verify.cjs and scoped inject.cjs in authoring/.

Shared generic V15 injected via unmodified inject-shim-v2.cjs scoped to the three studies. V2/font companion injected by a local wrapper that scopes the unmodified inject-media-controls.cjs walk; no shared injector source changed. Final selected file retains both companions. No API preset registry, shared scripts, posters/manifests, emergency/auth/AuditLog or older template changes.

Branch codex/service-update-gap starts at 327b5621. Previous codex/corporate-flagship-refresh remains preserved at d4bf0a561f7b5fe2eaf988d62a9e8c3ab129f0ec. No push. Lead owns integration and managed-worktree cleanup after preserving evidence.
