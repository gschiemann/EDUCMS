# Healthcare flagship refresh

Completed source refresh: 2026-10-11. Branch `codex/healthcare-flagship-refresh`, base `25cb9af4`.
Managed checkout: `/Users/gschiemann/.codex/worktrees/healthcare-flagship-refresh/EDU CMS`.

This wave rebuilds the ten existing healthcare boards. The lead owns shared shim upgrades, gallery metadata, API exemplars, generated posters, integration tests and deployment. This report records source and browser verification, not a production release or user approval.

## What changed

The original boards were mostly landscape-only, used supporting text around 28–44px, had repeated soft panels and empty provider imagery, and lacked canonical editable theme blocks. Static queues displayed live indicators without a working feed; MyChart and research used decorative checkerboards that could be mistaken for usable QR codes. Some headlines and supporting labels could not be edited.

Each board now has a deliberate landscape and portrait composition, real CSS font defaults, editable visible copy, canonical color/font/scale tokens, photo/logo slots and automatic text fitting. The clinic family uses cream, deep teal, lime and warm coral with strong typography and thin editorial rules. Individual information structures differ: arrival ticket, provider directory, window call, clinic poster, weekly ledger, guide index, app invitation, pharmacy ledger, research invitation and departure message.

| Existing file | Final design and behavior |
| --- | --- |
| 01-waiting-room-flagship.html | Large B-247 arrival ticket, consultation photo, six-number up-next queue and clear check-in footer. Portrait places the ticket above a photo and vertical queue. |
| 02-physician-directory.html | Six real replaceable stock portraits, full provider names, specialty/room details and editable status. Three-by-two editorial directory in landscape; six horizontal entries in portrait. Added dr.0.photo through dr.5.photo. |
| 03-now-serving.html | Cut-corner window-call panel with a very large ticket, directional arrow and eight-ticket coming-up ledger. Static content no longer claims a connected live feed. |
| 04-vaccine-clinic.html | Warm coral clinic poster, authored headline and clinical copy retained, outline hours oval, price and unusually large queue/wait values. |
| 05-hours-closures.html | Seven-row weekly hours ledger and a prominent upcoming closure panel. Today follows the local day rather than always marking Wednesday. Removed an unsupported always-open indicator. Existing example closure copy remains editable. |
| 06-patient-education.html | Care-guide introduction and four numbered folded guide panels. Every title, topic, number and action label is editable; original clinical topic copy retained. |
| 07-mychart-signup.html | Large app introduction, phone-shaped frame and an actual operator-supplied mc.qr image slot. Empty state says to ask at reception; no fake QR or fictional text-to-join instruction. Added editable mc.title. |
| 08-pharmacy-pickup.html | Distinct ready-to-collect and in-progress ledgers, per-row editable status and wait values, clear window header, no unsupported live badge. |
| 09-clinical-trial.html | Research invitation, compensation ribbon, study facts and contact details. ct.qr is a real optional upload slot with a neutral cross fallback. Existing study example, compensation and IRB copy retained. |
| 10-thanks-leave.html | Large departure message, arched provider portrait and clear visit-summary/pharmacy/follow-up steps. Portrait rearranges the photo and next steps vertically. |

All 174 original data-field keys in the original serialized HTML are retained, including existing advanced media controls; no old key was removed. The final files contain 429 field keys across the ten documents, including hidden theme/media fields, and 30 image/media slots including existing hidden advanced controls. The authored layouts account for 379 text/theme fields and 20 visible image/logo/QR slots. Clinical copy was reused from the existing examples rather than rewritten as new medical advice. Queues and study facts remain operator-configured examples, not fabricated connected records.

## Runtime / editor compatibility

The existing EDUCMS-SHIM-V14 and media-controls companion remain intact. The scoped injector reports ten up-to-date files; the lead will apply the shared V15 upgrade during integration.

- Stage dimensions are 3840×2160 and 2160×3840. Orientation auto-detects and honors o=landscape / o=portrait.
- Visible text uses real CSS defaults based on --type and theme.scale, then fits within its authored box. The minimum is 50px at scale 1; body copy defaults are at least 60px. The fit minimum and maximum scale together.
- Explicit query-string textStyles.fontSize initializes a skip map. Incoming educms-overrides updates the same map and reapplies explicit font sizes before fitting the remaining fields. This handles the mutation-observer checkpoint between window message listeners that otherwise lets auto-fit overwrite a just-applied manual size.
- Local clock.hhmm updates every 15 seconds, respects a query or message override, keeps the pin for a partial image-only update, and resumes after an explicit empty text map.
- The canonical theme writer caches unchanged token values. A scale-only edit does not reset API brand primary/accent colors. Changing theme.brand updates the primary alias.
- Default imagery initializes from local data-img sources; editor image replacement, rotation and fit continue through the standard media companion. Empty QR slots use neutral placeholders, not decorative machine-readable patterns.
- Freeze previews retain the same typography hierarchy and layout as normal playback. No field depends solely on timers to receive its default font size.

## Verification and evidence

A real null-origin sandbox iframe was used to match the editor preview, with Chromium and WebKit, each in landscape and portrait. The final sweep covers 40 combinations (10 boards × 2 engines × 2 orientations), default layouts, representative longer copy, 1.15 type scale, frozen gallery previews, field click messages, editor-supplied 72px typography, brand colors, pinned clocks, image replacement and 15-degree image rotation. The verification script asserts failures rather than merely logging them.

Final result: all 40 combinations passed with zero page errors, zero clipped fields, no text below the minimum, matching frozen font sizes, successful click-to-edit messages, 72px explicit fonts, pinned clocks, image replacement and rotation.

The separate query/theme sweep passed for all ten boards and covers, including query font size, query pinned clocks, partial image updates, API brand colors surviving a scale change, and a subsequent canonical brand token change. Field preservation and visible editability were audited separately. The final landscape and portrait contact sheets were opened and visually inspected. Original boards and three studies per board were retained for comparison; the selected compositions were rendered and inspected individually. Alternative dark/coral studies were rejected where they weakened contrast or portrait image balance.

The source code passes git diff --check. No TypeScript or application components were edited in this wave; the lead must run integration checks against the combined changes. No deployment has been performed by this agent.

Evidence root: `/Users/gschiemann/Desktop/template-flagship-audit/healthcare/`.
Final screenshots and machine-readable outcomes: `final/` (40 screenshots, results.json, theme-results.json, field-audit.json, contact-landscape.jpg, contact-portrait.jpg).
Live before/after reference: `before-after.html`, using the saved original files and the worktree static server.
Authored studies and test harness: `scratch/design/healthcare/` in the managed tree, copied to the evidence folder before cleanup.

## Photography provenance

Seven local Pexels stock photos are included under healthcare/assets. License and individual source/photographer references are recorded in assets/README.md. They are replaceable stock models for template examples; they do not assert the identities of the sample physician names. The consultation image and every provider portrait are image slots.

## Exact source files

- apps/web/public/templates/signage/healthcare/01-waiting-room-flagship.html
- apps/web/public/templates/signage/healthcare/02-physician-directory.html
- apps/web/public/templates/signage/healthcare/03-now-serving.html
- apps/web/public/templates/signage/healthcare/04-vaccine-clinic.html
- apps/web/public/templates/signage/healthcare/05-hours-closures.html
- apps/web/public/templates/signage/healthcare/06-patient-education.html
- apps/web/public/templates/signage/healthcare/07-mychart-signup.html
- apps/web/public/templates/signage/healthcare/08-pharmacy-pickup.html
- apps/web/public/templates/signage/healthcare/09-clinical-trial.html
- apps/web/public/templates/signage/healthcare/10-thanks-leave.html
- apps/web/public/templates/signage/healthcare/assets/README.md
- apps/web/public/templates/signage/healthcare/assets/pexels-5722163.jpg
- apps/web/public/templates/signage/healthcare/assets/pexels-3714743.jpg
- apps/web/public/templates/signage/healthcare/assets/pexels-14438785.jpg
- apps/web/public/templates/signage/healthcare/assets/pexels-15752232.jpg
- apps/web/public/templates/signage/healthcare/assets/pexels-8460094.jpg
- apps/web/public/templates/signage/healthcare/assets/pexels-17829429.jpg
- apps/web/public/templates/signage/healthcare/assets/pexels-5215008.jpg
- docs/research/2026-10-10-template-flagship-refresh/healthcare.md

Existing board paths, IDs and HEALTHCARE classifications are retained. Parent integration is required for metadata/posters, the shared injector upgrade, CI, deployment verification and managed-worktree cleanup.
