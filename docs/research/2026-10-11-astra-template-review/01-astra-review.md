| Standard Audit Surface | Design | UX | Functionality | Review scope / limitation |
|---|---|---|---|---|
| 1. Real-time + signed pub/sub | Deferred | Deferred | Deferred | Outside template visual review; no emergency/realtime code touched |
| 2. Storage + content pipeline | Partial | Partial | Deferred | Media editor screenshots and handoff reviewed; no live upload/storage run |
| 3. AI providers | Deferred | Deferred | Deferred | No provider audit |
| 4. AI feature surfaces | Deferred | Deferred | Deferred | Exemplar freshness reported in handoff, not independently tested |
| 5. AI-tool comparative scan | Deferred | Deferred | Deferred | Canva is a quality/ease benchmark here; no current competitive product audit |
| 6. Streaming integrations | Deferred | Deferred | Deferred | Outside scope |
| 7. Sports score/data integrations | Covered* | Partial | Deferred | All 24 changed celebrations viewed, both capture orientations; live feeds untested |
| 8. POS / commerce integrations | Covered* | Partial | Deferred | Refreshed menu images reviewed; POS preservation evidence read, not rerun |
| 9. Communications integrations | Deferred | Deferred | Deferred | Outside scope |
| 10. Auth + identity | Deferred | Deferred | Deferred | Outside scope |
| 11. Billing + commerce | Deferred | Deferred | Deferred | Outside scope |
| 12. Design import integrations | Deferred | Deferred | Deferred | Outside scope |
| 13. Public alert integrations | Deferred | Deferred | Deferred | Outside scope; no emergency design changes proposed |
| 14. Multi-vertical surface | Covered* | Partial | Deferred | 57 refreshed sources + 3 new sources; not the entire 453-preset offered library |
| 15. Cross-browser + Chromium 83 | Partial | Deferred | Deferred | Existing browser screenshots; no fresh run or hardware qualification |
| 16. Forensic / audit coverage | Partial | N/A | Deferred | Durable review and screenshot manifest; no audit-log audit |
| 17. Operational + DX | Partial | N/A | Deferred | Read-only code review, external report; no app/build run |
| 18. Accessibility + a11y | Partial | Partial | Deferred | Visual hierarchy, readable type, crop and contrast; no measured full a11y audit |
| 19. Template + Widget Editability | Partial | Partial | Deferred | Controls screenshots, shared source and preservation audit read; interactions not rerun |
| 20. Design + UX + Functionality lenses | Covered* | Partial | Deferred | Independent visual review plus evidence-based UX recommendations |
| 21. Verification Before Claim | Covered | Covered | Deferred | Findings distinguish current posters, earlier captures, reported tests and untested possibilities |

# Astra review — 2026-10-11

**Verdict: a substantial improvement with several professional exemplars, but not yet a consistently world-class, Canva-like collection. I recommend a small follow-up quality pass, not another wholesale rebuild.** The 60 source designs are mostly organized, readable and useful. Fashion has the strongest art direction. Operational queue/pickup boards have clear hierarchy. Several dense lists still look like styled documents; sports celebrations remain visibly below the quality of the best HTML boards. Two school schedules have concrete visible layout defects in the current gallery posters.

`Covered*` means visual coverage of the named release scope, not a quality pass for every design. This is an independent read-only assessment of the release through `e48e44ff`, using preserved screenshots and current packaged posters. No app, browser, build, deployment or test was run. No template or code was edited. CI status is not evaluated here; the lead reports that the corrected full run was cancelled by later pushes, so this report does not call it green.

## What was inspected

- Read the authoritative template/editability, design workflow, audit and dispatch sections of `CLAUDE.md`, both design standards documents, both release handoffs and the original-key preservation audit.
- Viewed all 57 refreshed sources in saved landscape and portrait evidence, then all 54 regular sources again in current `_thumbs` landscape posters. Three Christmas designs were viewed from `christmas-after` captures. The report's `astra-sheets/coverage.json` maps exact source paths to saved screenshot paths. `current-1.jpg` through `current-6.jpg` show all 54 current regular posters. `01.jpg` through `10.jpg` are initial evidence contact sheets; use the manifest/current posters over an initial sheet when they differ.
- Viewed all 24 sports variants in both captured orientations, 48 Chromium images, in `astra-sheets/sports-1.jpg` through `sports-4.jpg`.
- Viewed all three new designs in both orientations in `template-gaps/final-gallery-previews.png`, plus full portrait captures for each and the commencement review HTML source.
- Viewed editor evidence: `blank-editor.png`, `three-images-rotated.png`, `portrait-video-editor.png`, `school-media-edited.png` in `/Users/gschiemann/Desktop/template-editor-claude-handoff/evidence/`.
- Important evidence correction: earlier veterinary evidence includes an obsolete rounded-card version and outdated care-tip copy; current poster has the rebuilt editorial composition and corrected copy. Earlier QSR hiring screenshots include a broken QR layout, but the current poster has the correct no-link fallback. Neither is reported as a current defect. Initial automatic sheet matching confused the similarly named healthcare/veterinary waiting-room sources; the coverage manifest was corrected and the final veterinary portrait explicitly viewed. Saved captures are historical evidence, not proof that every pixel equals the current source.

## Best exemplars to preserve

1. **Fashion `02-editorial.html` and `05-event-trunkshow.html`:** deliberate serif typography, restrained palettes, large photographic focal points and convincing portrait reflow. These feel closest to professional editorial templates. They have enough empty space to look intentional without wasting the screen.
2. **Healthcare `03-now-serving.html` and menus-pos `10-takeaway-pickup.html`:** strong, immediately scannable primary information, clear secondary hierarchy and effective dark/light contrast. Utility is the correct design objective here; decorative complexity would make them worse.
3. **School `ms-lobby-v2.html`:** identifiable campus editorial character, balanced photo/copy and useful portrait arrangement. The three middle-school welcomes have meaningful stylistic variety.
4. **New Service Update:** the clearest new workflow. Affected service, alternative, timing and help are easy to locate. Portrait is a real composition, not a reduced landscape. Keep its strong condensed type and restrained safety-adjacent color use without turning it into an emergency template.
5. **New Commencement:** warm burgundy/cream palette, good programme hierarchy, readable portrait composition. It is an elegant guest guide, although the everyday hallway photo makes it less celebratory than its subject warrants. A graduation/ceremony image in the existing slot would improve it without altering the structure.

Evidence: current poster sheets 1–6, `service-update/20-service-update-portrait-chromium.png`, `commencement-after/chromium-portrait-default.png`.

## Prioritized findings

### 1. Fix the two school schedule layouts first — verified current defect

Files: `apps/web/public/templates/school/elem-schedule-v1.html` and `elem-schedule-v3.html`.

In the **current landscape posters**, room/teacher metadata touches or crosses row rules. V1 visibly loses the bottom of repeated metadata beneath the next row and the final ticker. V3 rules run through metadata. V1's attendance caption also runs beyond the right-hand tile/screen. This is present with authored default copy, so it cannot be dismissed as arbitrary long-copy input. The text-floor repair has not been matched by sufficient layout space here.

**Edit:** give each landscape row a genuine two-line content box, or place metadata in a dedicated aligned right column as V2 already does. Reclaim height from the header/hero before lowering type. Keep all six original rows and keys. Let the small attendance tile caption wrap within its box or widen the tile; no ellipsis, hiding, or below-floor fitting. Portrait can retain its present stacked approach, but verify it after the change.

Evidence: `/Users/gschiemann/Desktop/EDU CMS/apps/web/public/templates/_thumbs/school/elem-schedule-v1.png` and `elem-schedule-v3.png`; full images were inspected individually. The lead-after images show the same issue. Check actual descendant bounds versus each row, not only each text node's own scroll size; that is the meaningful missing regression assertion.

### 2. Correct the Care Services portrait photograph — verified visual weakness

File: `apps/web/public/templates/signage/clinic/02-services-booking-guide.html`.

The portrait photo cuts the clinician at the mouth and devotes much of the frame to the back of the other person's head and window. That is especially unfortunate directly above “Friendly help. Clear choices.” The surrounding layout is competent but feels like a fee sheet, with duration and qualifier columns competing for attention.

**Edit now:** use an orientation-specific authored crop/focal position that shows a complete face, or enlarge the image's vertical allocation by reducing the caption block. Keep the same editable slot and source override contract. Give service name and price a shared row baseline, duration a quiet but readable secondary position, and the booking footer one stronger accent/CTA region. Preserve all descriptions and qualifier keys. Do not reduce body/support floors.

Evidence: `clinic-service-gap/default/chromium-portrait.png` and the final gallery preview. The latter also confirms this is reflected in the final preview, not just an abandoned concept.

### 3. Upgrade dense hospitality/bar layouts selectively — verified design judgment

First files: `apps/web/public/templates/signage/bar/07-bottle-service.html` and `apps/web/public/templates/signage/hospitality/03-events-board.html`.

Bottle Service combines three dense columns, small competing headings, repeated tiny package pictures and a faint background image; the result reads more like a busy price sheet than a premium bottle-service offer. The events board has correct information but nearly equal visual weight across every row and metadata line. Thin high-contrast serif details look refined close up but lose presence in a gallery or at signage distance. This is a visual hierarchy judgment, not a claim that measured font floors fail.

**Edit:** Bottle Service should have one clear package focal area, a quieter structured price list, and a separately grouped table-status column; use a solid background and one meaningful photo instead of ghosted scenery/repeated thumbnails. Preserve every original slot (reposition them purposefully rather than deleting them) and every POS key/adapter. Events should use stronger time numerals, more row separation and a distinct location column; preserve all six events, without inventing a live highlight. A modest increase in typographic weight is more valuable than adding decoration.

Evidence: current poster sheet 2 (Bottle Service), sheet 5 (Events), plus saved portrait counterparts in the coverage manifest. Keep elegant serif identity; do not apply a generic bold sans-serif makeover to every venue.

### 4. Sports need art direction beyond the headline-contrast fix — verified visuals, portrait limitation partly unverified

Files: `apps/web/src/components/widgets/v2/CelebrationsFootballWidgets.tsx`, `CelebrationsBasketballWidgets.tsx`, `CelebrationsBaseballWidgets.tsx`.

The white principal words are easier to read, but many scenes still use thin generic-looking display type, centered text stacks and glows. Red supporting copy on near-black in Pick Six/Sack and dark green/purple support in several scenes are visibly weaker than the white hero text. Diagonal red/black stripe scenes compete with the words. These are not at the same design level as the better refreshed HTML boards.

**Bounded follow-up:** redesign one flagship scene per sport first: Touchdown, Three Pointer, Home Run. Use a loaded condensed display face, larger event word/score, a controlled team-color backdrop with a stable text surface, and pale high-contrast support tokens. Keep all operator text/style overrides. Then propagate only proven typography/contrast rules to the other 21 scenes. Do not touch score triggers, CTS wiring or runtime semantics.

Every preserved portrait sports capture shows a landscape scene centered between large dark bands. This is verified in the images, but **not established as a production portrait regression**: it may be the capture harness retaining the landscape preset aspect ratio. Verify actual portrait-zone dimensions and intended offering before changing geometry or claiming portrait support. No motion-quality judgment is possible from these stills; heavy glow/stripe concerns need a moving preview before final art direction.

Evidence: `sports-after/cel-football-picksix-landscape-chromium.png`, `cel-football-sack-landscape-chromium.png`, all four sports contact sheets.

### 5. Finish the next layer of Canva-like editing — evidence-based UX recommendation

The quick Image/Video/Text actions, natural media dimensions and visible Replace/Fit/Rotate are tangible improvements. The saved editor evidence shows a understandable selection outline and accessible common controls. Handoff tests report broad Undo/reopen coverage; those results were read, not independently rerun.

The biggest remaining gap is **Crop / Reposition**. Fit versus Fill cannot rescue a face cut by a fixed slot, as the care guide illustrates. Add one labelled crop action beside Fit. On entry, drag the image within its fixed frame; show a simple zoom control, Reset, Done and Cancel. Escape cancels. Keyboard arrows move the focal point. Commit it as one undo operation, store normalized focal coordinates, and restore the authored crop when overrides clear. Support embedded and standalone images through the same UI.

Likely implementation files (verified existing): `apps/web/src/components/template-builder/SelectionControls.tsx`, `BuilderShell.tsx`, `board-media.ts`, `types.ts`, `useBuilderStore.ts`, `ExternalBoardFieldBridge.tsx`, `apps/web/scripts/board-media-controls.ts`, `apps/web/src/components/widgets/WidgetRenderer.tsx`. The current `patchBoardMedia` accepts fit/rotation/hidden, not focal position. This is an implementation proposal, not a completed design or test.

Second UX priority: field-capacity feedback. Show a specific inline warning when copy exceeds the actual field at the allowed minimum: “This text needs more space.” Offer “Shorten text” and, where supported, “Use a roomier layout.” At repeating-list capacity, disable Add and state “3 of 3 services”; offer another scene rather than silently producing overflow. The handoff's 250 diagnostic failures require classification; they are not all release regressions. Likely files: `PropertiesPanel.tsx`, `ExternalBoardFieldBridge.tsx`, `apps/web/scripts/inject-shim-v2.cjs` plus the relevant board capacity metadata. A dedicated design is needed before changing saved behavior.

The screenshots also show a long bottom toolbar and a property panel mixing common media tasks with technical terms such as Zone, EXTERNAL_HTML and raw URLs. A later refinement should put common content actions first and technical settings behind Advanced. Avoid another major shell redesign before the two practical gaps above are solved.

## Five highest-value follow-up patches

1. **School geometry repair:** two schedule HTML files + meaningful row-bound browser assertions + refreshed posters. Small, concrete, first priority.
2. **Care-guide crop/composition polish:** one HTML file + both orientation previews and existing saved-media restoration tests. Improve the default immediately.
3. **Shared Crop/Reposition:** the bounded editor/media files listed above; save/reopen, Undo, Reset and orientation checks across blank, embedded, holiday and kiosk paths. This delivers more Canva-like control than another batch of new designs.
4. **Two dense-board art-direction passes:** Bottle Service and Hospitality Events, one at a time, with before/after landscape and portrait renders. Keep adapters and keys unchanged.
5. **Three sports flagship studies:** one scene per sport, proving stronger type/contrast before extending shared rules. First establish whether portrait is an offered layout or a harness artifact.

All board patches must preserve URLs, DOM text/image keys, customer overrides and integration hooks. Regenerate shims through their source injectors, never hand-edit baked runtimes; regenerate captured posters and provenance and approved exemplar hashes as required. Do not flatten editable content into images. Do not shrink below 60px body / 50px support on a 3840px stage. No emergency/auth/billing changes are part of this recommendation.

## Family-by-family assessment

| Family | Viewed scope | Assessment |
|---|---|---|
| School | 6 sources, landscape + portrait | Middle-school variants are distinctive; schedule V2 is the strongest functional layout. V1/V3 need the specific landscape repairs above. |
| Corporate | 8 sources, both | Clear and consistent; directory/shuttle/KPI are appropriate. New-hires landscape header has a conspicuously large gap before “team!” and tight face crops; improve on a later polish pass. Broad beige/rule repetition makes the family less distinctive than the fashion work. |
| Healthcare | 10 sources, both | Queue and pickup hierarchies work. Patient education/portal are useful but generic. Repeated consultation imagery and the repeated arch motif diminish variety. No clinical correctness review was performed. |
| Hospitality | 4 sources, both | Outlook has appealing photography; events and wayfinding have usable structure. Events/check-in remain dense and print-like, warranting heavier primary type and stronger grouping. |
| Fashion | 4 sources, both | Strongest art direction. Editorial and trunkshow meet a professional template bar; fitting room's arch geometry connects form to purpose. |
| Veterinary | 2 sources, both (corrected final evidence) | Warm, appropriate photography and legible editorial organization. Adoption portraits work well. Earlier placeholder evidence was superseded and is not a defect finding. |
| Clinic | Campaign + new care guide, both | Campaign is clear. New guide fills a real need, but portrait photo and table hierarchy need polish. |
| Restaurant menus | 9 sources, both | Cocktail, brunch, prix fixe and pickup are strongest. Full-service/wine/reservations remain dense but credible. Preserve POS behavior during visual refinement. |
| Bar | 7 sources, both | Cocktail feature is a good editorial direction. Bottle Service is the weakest density/hierarchy case. Live-night stock concert image is energetic but visually generic for the named act; replacing it is an operator-content task. |
| QSR | 3 sources, both | Clear headline/CTA structure. Rewards no-link fallback is honest. Hours map is explicitly schematic. Hiring image is an excessively thin strip; a later crop pass should show complete faces or use a less people-dependent workplace image. |
| Christmas | 3 sources, both | Grade concepts are distinct: playful ES, graphic MS, formal HS. HS has the most delicate/low-presence body typography; inspect actual-display readability before treating it as flagship. Some split phrases have large gaps (“Snow … Ball”, “Sing- … along!”); tighten spacing between fragments while preserving separate keys. |
| Sports | 24 variants, both captured orientations | Better hero contrast; still the least sophisticated visual family in this scope. Accent contrast/type and portrait intent need a separate bounded pass. |
| New service/commencement workflows | 2 sources, both | Service Update is highly effective. Commencement is composed and readable; a ceremony-specific photograph would make it feel more celebratory. |
| Gallery | Current 54 refreshed regular posters + six new previews | Captures accurately expose both strengths and the schedule flaws; refreshed previews are valuable. Full gallery filtering/discoverability was not live-tested. |

## Exact source coverage

The following manifest is the durable source-to-image index, including orientations: `astra-sheets/coverage.json`. The 57 source paths follow. All are within `apps/web/public/`.

- `holiday-templates/es-christmas.html` — landscape + portrait saved evidence; Christmas after-capture evidence.
- `holiday-templates/hs-christmas.html` — landscape + portrait saved evidence; Christmas after-capture evidence.
- `holiday-templates/ms-christmas.html` — landscape + portrait saved evidence; Christmas after-capture evidence.
- `templates/school/elem-schedule-v1.html` — landscape + portrait saved evidence; current regular poster also viewed.
- `templates/school/elem-schedule-v2.html` — landscape + portrait saved evidence; current regular poster also viewed.
- `templates/school/elem-schedule-v3.html` — landscape + portrait saved evidence; current regular poster also viewed.
- `templates/school/ms-lobby-v1.html` — landscape + portrait saved evidence; current regular poster also viewed.
- `templates/school/ms-lobby-v2.html` — landscape + portrait saved evidence; current regular poster also viewed.
- `templates/school/ms-lobby-v3.html` — landscape + portrait saved evidence; current regular poster also viewed.
- `templates/signage/bar/01-tap-list-flagship.html` — landscape + portrait saved evidence; current regular poster also viewed.
- `templates/signage/bar/02-cocktail-menu.html` — landscape + portrait saved evidence; current regular poster also viewed.
- `templates/signage/bar/03-bottle-list.html` — landscape + portrait saved evidence; current regular poster also viewed.
- `templates/signage/bar/04-happy-hour.html` — landscape + portrait saved evidence; current regular poster also viewed.
- `templates/signage/bar/06-tonight-live.html` — landscape + portrait saved evidence; current regular poster also viewed.
- `templates/signage/bar/07-bottle-service.html` — landscape + portrait saved evidence; current regular poster also viewed.
- `templates/signage/bar/08-game-day.html` — landscape + portrait saved evidence; current regular poster also viewed.
- `templates/signage/clinic/01-campaign-flagship.html` — landscape + portrait saved evidence; current regular poster also viewed.
- `templates/signage/corporate/01-lobby-welcome-flagship.html` — landscape + portrait saved evidence; current regular poster also viewed.
- `templates/signage/corporate/02-conference-room.html` — landscape + portrait saved evidence; current regular poster also viewed.
- `templates/signage/corporate/03-kpi-dashboard.html` — landscape + portrait saved evidence; current regular poster also viewed.
- `templates/signage/corporate/04-new-hires.html` — landscape + portrait saved evidence; current regular poster also viewed.
- `templates/signage/corporate/05-floor-directory.html` — landscape + portrait saved evidence; current regular poster also viewed.
- `templates/signage/corporate/06-all-hands.html` — landscape + portrait saved evidence; current regular poster also viewed.
- `templates/signage/corporate/08-shuttle-board.html` — landscape + portrait saved evidence; current regular poster also viewed.
- `templates/signage/corporate/09-events-week.html` — landscape + portrait saved evidence; current regular poster also viewed.
- `templates/signage/fashion/02-editorial.html` — landscape + portrait saved evidence; current regular poster also viewed.
- `templates/signage/fashion/03-sale.html` — landscape + portrait saved evidence; current regular poster also viewed.
- `templates/signage/fashion/05-event-trunkshow.html` — landscape + portrait saved evidence; current regular poster also viewed.
- `templates/signage/fashion/06-fitting-room.html` — landscape + portrait saved evidence; current regular poster also viewed.
- `templates/signage/healthcare/01-waiting-room-flagship.html` — landscape + portrait saved evidence; current regular poster also viewed.
- `templates/signage/healthcare/02-physician-directory.html` — landscape + portrait saved evidence; current regular poster also viewed.
- `templates/signage/healthcare/03-now-serving.html` — landscape + portrait saved evidence; current regular poster also viewed.
- `templates/signage/healthcare/04-vaccine-clinic.html` — landscape + portrait saved evidence; current regular poster also viewed.
- `templates/signage/healthcare/05-hours-closures.html` — landscape + portrait saved evidence; current regular poster also viewed.
- `templates/signage/healthcare/06-patient-education.html` — landscape + portrait saved evidence; current regular poster also viewed.
- `templates/signage/healthcare/07-mychart-signup.html` — landscape + portrait saved evidence; current regular poster also viewed.
- `templates/signage/healthcare/08-pharmacy-pickup.html` — landscape + portrait saved evidence; current regular poster also viewed.
- `templates/signage/healthcare/09-clinical-trial.html` — landscape + portrait saved evidence; current regular poster also viewed.
- `templates/signage/healthcare/10-thanks-leave.html` — landscape + portrait saved evidence; current regular poster also viewed.
- `templates/signage/hospitality/03-events-board.html` — landscape + portrait saved evidence; current regular poster also viewed.
- `templates/signage/hospitality/06-wayfinder.html` — landscape + portrait saved evidence; current regular poster also viewed.
- `templates/signage/hospitality/08-checkin-status.html` — landscape + portrait saved evidence; current regular poster also viewed.
- `templates/signage/hospitality/09-outlook.html` — landscape + portrait saved evidence; current regular poster also viewed.
- `templates/signage/menus-pos/01-fullservice-menu.html` — landscape + portrait saved evidence; current regular poster also viewed.
- `templates/signage/menus-pos/02-wine-list.html` — landscape + portrait saved evidence; current regular poster also viewed.
- `templates/signage/menus-pos/04-cocktail-program.html` — landscape + portrait saved evidence; current regular poster also viewed.
- `templates/signage/menus-pos/05-86-board.html` — landscape + portrait saved evidence; current regular poster also viewed.
- `templates/signage/menus-pos/06-brunch.html` — landscape + portrait saved evidence; current regular poster also viewed.
- `templates/signage/menus-pos/07-prix-fixe.html` — landscape + portrait saved evidence; current regular poster also viewed.
- `templates/signage/menus-pos/08-tasting-progress.html` — landscape + portrait saved evidence; current regular poster also viewed.
- `templates/signage/menus-pos/09-reservations.html` — landscape + portrait saved evidence; current regular poster also viewed.
- `templates/signage/menus-pos/10-takeaway-pickup.html` — landscape + portrait saved evidence; current regular poster also viewed.
- `templates/signage/qsr/08-rewards.html` — landscape + portrait saved evidence; current regular poster also viewed.
- `templates/signage/qsr/09-hours-location.html` — landscape + portrait saved evidence; current regular poster also viewed.
- `templates/signage/qsr/10-now-hiring.html` — landscape + portrait saved evidence; current regular poster also viewed.
- `templates/signage/veterinary/01-waiting-room-flagship.html` — landscape + portrait saved evidence; current regular poster also viewed.
- `templates/signage/veterinary/02-adopt-gallery.html` — landscape + portrait saved evidence; current regular poster also viewed.

New sources: `templates/signage/corporate/20-service-update.html`, `templates/signage/clinic/02-services-booking-guide.html`, `templates/school/commencement-guest-guide.html` — both orientations viewed.

Sports: baseball doubleplay, grandslam, homerun, nohitter, stolenbase, strikeout, tripleplay, walkoff; basketball alleyoop, andone, block, buzzer, dunk, steal, three, tripledouble; football fieldgoal, firstdown, fumble, int, picksix, sack, safety, touchdown. Every named variant viewed in landscape and portrait capture.

No uninspected baseline template is assigned a design verdict here. Fresh browser verification is required before implementing or shipping the proposed patches.
