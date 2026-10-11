# Template gap assessment — hospitality, education, events and guest services

## Scope and Standard Audit Surface coverage

This is a short, read-only assessment of missing **offered template workflows** in hospitality, K12/higher education, holidays/events and venue guest services. It is not a full application audit, a browser quality audit of all existing templates, or an integration/security audit. No source code, registries, injectors or application state were changed. Covered below means covered within this bounded catalog/source assessment; unexamined portions of those sections remain deferred. No template has been created or claimed shipped.

| CLAUDE.md domain | Design | UX | Functionality | Scope / reason |
|---|---|---|---|---|
| 1. Real-time + signed pub/sub | Deferred | Deferred | Deferred | Emergency/realtime transport is not part of new template inventory; no alert workflow proposed. |
| 2. Storage + content pipeline | Deferred | Deferred | Deferred | Upload/cache/transcoding flow not exercised; future new art must expose slots. |
| 3. AI providers | Deferred | Deferred | Deferred | No provider/key/model changes proposed. |
| 4. AI feature surfaces | Deferred | Deferred | Deferred | AI generation/translation is not required for either candidate. |
| 5. AI-tool comparative scan | Deferred | Deferred | Deferred | Competitive research is outside this efficient repository gap scan. |
| 6. Streaming integrations | Deferred | Deferred | Deferred | Neither proposal requires video/stream integration. |
| 7. Sports score/data | Deferred | Deferred | Deferred | Event visitor guidance can serve venues without altering game data. |
| 8. POS / commerce integrations | Deferred | Deferred | Deferred | Guest information is editable copy, not POS availability or ordering. |
| 9. Communications integrations | Deferred | Deferred | Deferred | Contact instructions do not send messages or claim staff notification. |
| 10. Auth + identity | Deferred | Deferred | Deferred | No visitor authentication/check-in submission added. |
| 11. Billing + commerce | Deferred | Deferred | Deferred | No ticket sales, booking or payments added. |
| 12. Design import integrations | Deferred | Deferred | Deferred | Import tools are not counted as an offered ready-made workflow. |
| 13. Public alert integrations | Deferred | Deferred | Deferred | Emergency alerts/all-clear and safety advice remain outside this scope. |
| 14. Multi-vertical surface | Covered | Covered | Covered | Actual offered source/catalog alternatives compared for the assigned families. Broader onboarding/billing/AI copy remains deferred. |
| 15. Cross-browser / Chromium-83 | Deferred | Deferred | Deferred | No new source yet; future source must pass Chromium/WebKit orientations plus legacy-player constraints. |
| 16. Forensic / audit coverage | Deferred | Deferred | Deferred | Read-only file inspection only; no privileged operation or public PII workflow proposed. |
| 17. Operational + DX | Deferred | Deferred | Deferred | No build/deploy changes; assessment/evidence persisted for recovery. |
| 18. Accessibility | Covered | Covered | Deferred | Missing accessible-arrival/help content identified; render contrast/keyboard/browser tests await a selected source. |
| 19. Template / widget editability | Covered | Covered | Covered | Closest templates' actual field roles inspected; future all-copy/art/type/color editability specified. Full widget-by-widget grading remains deferred. |
| 20. Design / UX / functionality lenses | Covered | Covered | Covered | Candidates judged on visitor task and operator setup, rather than category counts. |
| 21. Verification before claim | Covered | Covered | Covered | Claims limited to source/catalog evidence; no live or browser validation claim. |

## Evidence basis

Requested `/Users/gschiemann/Desktop/template-flagship-audit/baseline/catalog.json` does not exist on disk. Used the existing root `catalog.json` plus `lead-authoring/current/active-catalog.json` and read-only source in `/Users/gschiemann/.codex/worktrees/template-editor-release/EDU CMS`. The active snapshot has 447 presets; that count is context, not proof of a missing workflow. Quarantined files were not counted as available alternatives. Current matching preset and HTML fields were inspected to distinguish missing workflows from renamed categories.

Selected closest-preset records are persisted at `/Users/gschiemann/Desktop/template-flagship-audit/template-gaps/hospitality-education-events-evidence.json`. The assessment is mirrored to the same folder. The existing hospitality/Christmas branch and reports are preserved unchanged.

## 1. Commencement / graduation guest programme — recommended first

**Missing task:** a family arriving for a K12 graduation or higher-education commencement needs the ceremony location, doors/start times, a readable order of events, parking/accessible entrance, where to ask for help, and the full programme link together. The operator needs a ready-made ceremony template with class/graduate imagery and those labelled fields, rather than repurposing a lobby or gallery into a ceremony guide.

**Nearest actual alternatives:**

- HS welcome/countdown widgets and senior-countdown themes already mention graduation/commencement. A graduation countdown is therefore **not** the gap.
- `preset-hs-gallery` → `/templates/hs/gallery.html` is a museum-style school feature/photo and plaques board; the actual HTML is not a ceremony programme.
- `preset-hs-blueprint` → `/templates/hs/blueprint.html` is a classroom/current-period technical-drawing composition.
- `preset-sig-hospitality-03` → `/templates/signage/hospitality/03-events-board.html` is a hotel-wide events directory. It can list a ceremony, but does not offer one ceremony's guest instructions/order of events as its primary workflow.
- Campus Grid wayfinding already has `help.title`, `help.message`, `access.notice`; accessibility content alone is therefore **not** a new-template gap.

No active preset name/description targets graduation or commencement guest programmes, and existing mentions in source are countdown labels or general calendars. There is no claim that graduates, attendance or programme timing can be pulled from an SIS/event feed.

**One-source proposal:** one fully editable Commencement / Ceremony Programme HTML with a strong class/ceremony identity, replaceable class/graduate photograph and logo, doors/start/date/venue fields, four programme rows, concise parking/accessible-arrival/help panel and uploaded programme QR or supplied programme-link field. Planned programme times should be labelled as planned; elapsed clock time must not pretend a speech actually began. Any countdown uses a configured real date and preserves manual pinning. No student/attendee names are required publicly.

**Operator happy path to prove:** choose the offered ceremony preset; edit ceremony/date/location; replace class photo/logo; enter the programme URL or upload the real QR; publish. Target under 30 seconds for the primary headline/date/location edit, with meaningful defaults for the rest. Additional feed, QR generation and dynamic participant-list work are outside this source-only proposal.

**Why first:** fills K12, highered and special-event visitor guidance with one source; it adds a task rather than another decorative lobby skin, and needs no new integration.

## 2. Public Guest Essentials — hotel / venue arrival guide

**Missing task:** a newly arriving guest needs a public, at-a-glance card covering Wi-Fi instructions, check-out/departure arrangements, breakfast/service hours, shuttle pickup location, accessibility/help and the full guest-guide link. These instructions should be readable on a lobby LCD without exposing guest names/room-readiness operations or requiring a touch kiosk.

**Nearest actual alternatives:**

- `preset-sig-hospitality-06` → `/templates/signage/hospitality/06-wayfinder.html` already covers destinations/floors and concierge/front desk/valet. Its `foot.wf` is a Wi-Fi **network label**, not a network/instructions + departure/service guide workflow.
- `preset-sig-hospitality-12` → `lobby-v2-resort-current-landscape.html` has arrival counts, events, amenity statuses and a shuttle time. It lacks the combined arrival/departure essentials card.
- `preset-sig-hospitality-13` → `lobby-v3-grand-grid-landscape.html` is convention-hotel operations: groups, event directory, totals, coach and dining status.
- `preset-sig-hospitality-08` → `/templates/signage/hospitality/08-checkin-status.html` is a front-desk operations list of example guests/rooms/readiness/departures. It is not a public self-service guest instruction template.
- Touch Kiosk — Workplace / Lobby and Touch Kiosk — Campus Hub offer multi-screen interactive navigation; neither is a purpose-built non-touch guest-essentials signage preset. Quarantined hospitality/02-concierge-board.html is not an available alternative.

**One-source proposal:** one editable Guest Essentials HTML, with replaceable property/venue image and logo; four or five prominent information groups and a compact map/accessible-route upload slot; staff-managed hours/instructions; a supplied guide link or uploaded real QR. Its labels should adapt across hotel, conference venue or campus visitor lounge. No Wi-Fi auto-discovery, PMS synchronization, ticketing, booking, guest lookup or invented live status is implied.

**Operator happy path to prove:** choose the offered guest-guide preset; set property name, Wi-Fi/arrival/departure instructions and help location; replace branding; publish. Under 30 seconds for the name + core guest instructions edit. A map or guide upload can be optional.

**Why second:** frequent daily guest task and clear replacement for reconstructing several existing boards. It has more overlap with the already improved hotel wayfinder/lobbies than the ceremony programme, so commencement should lead this wave.

## Existing workflows deliberately not proposed as new

- School bus routes: `preset-bus-board` and portrait equivalent already show routes, ETAs, late warnings and next-bus countdown. A second bus-route template would need a narrower proven dismissal gap.
- School visitor sign-in / early dismissal: `preset-kiosk-school-frontoffice` already covers this interactive workflow. Creating another signage template must not pretend it performs actual sign-in or guardian approval.
- Campus navigation and daily events: school wayfinders, Campus Pulse Metro Wayfinding, Campus Hub kiosk and hotel events directories already offer these tasks.
- Six seasonal holiday families: seasonal artwork can improve, but the newly completed canonical Christmas source is not missing. New major school/event occasions should be added intentionally; commencement is the strongest identified occasion here.
- Meeting-room Now/Next: Corporate Conference and Meeting Room Panel kiosk already exist; not recommended without a specific missing event-room workflow.

## If selected

Create only ONE new source in this wave, plus three distinct scratch studies and browser evidence. Keep old branch/source/reports intact; create a new codex branch from 327b5621 in the existing clean worktree when coding is authorized. The lead owns registration/API categories/posters/shared injectors; a standalone unregistered HTML does not count as an offered template. Every visible word, image, logo, font and color must be editable; body ≥60px and supporting copy ≥50px on 3840 stage. Verify both orientations in Chromium/WebKit, authored defaults, saved content/styles/media, and truthful dates. Persist all report/authoring/evidence before the remaining usage window is exhausted.
