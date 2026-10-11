# Template quality refresh — Claude handoff

Scope: a full template-library inventory and visual baseline, followed by a verified first release batch. This is not a claim that all 447 offered presets have been rebuilt. Real infrastructure, emergency, identity and billing audits are outside this template-design task. Use the Standard Audit Surface checklist in CLAUDE.md as the domain map; coverage below distinguishes the design, UX and functionality lenses.

## Audit surface coverage

C = covered within this template batch. D = deferred because the domain is outside this task. P = partial; scope is stated below.

| Standard Audit Surface | Design | UX | Functionality | Scope / reason |
|---|---|---|---|---|
| 1 Real-time / signed pub-sub | D | D | D | No emergency or realtime changes |
| 2 Storage / content pipeline | P | C | C | Editor asset selection/replacement; no storage infrastructure change |
| 3 AI providers | D | D | D | No provider calls or key changes |
| 4 AI feature surfaces | P | P | C | Approved exemplar freshness and 133 catalog tests; generation unchanged |
| 5 AI comparative scan | D | D | D | Outside template redesign |
| 6 Streaming integrations | D | D | D | No connector changes |
| 7 Sports data | P | P | P | 24 celebration contrast defaults; live feeds unchanged |
| 8 POS / commerce | C | C | C | Preserved menu adapters; price / sold-out / restock checks |
| 9 Communications | D | D | D | No communications work |
| 10 Auth / identity | D | D | D | Browser editor fixtures use mocked sessions |
| 11 Billing | D | D | D | Existing upstream work integrated, not authored here |
| 12 Design imports | D | D | D | No import changes |
| 13 Public alerts | D | D | D | No alert changes |
| 14 Multi-vertical templates | C | C | C | All catalog families inventoried; 57 HTML boards rebuilt |
| 15 Browsers / Chromium 83 | C | C | P | Chromium/WebKit; compatible companion build, no physical hardware qualification |
| 16 Forensic / audit | P | P | P | Durable reports and evidence; no privileged endpoint changes |
| 17 Operations / DX | C | C | C | Worktree isolation, checkpoint commits, preview provenance and build checks |
| 18 Accessibility | P | P | P | Readable type, contrast, existing keyboard controls; no full app accessibility audit |
| 19 Template / widget editability | C | C | C | Preserved keys, media, fonts, saved edits and click bridges |
| 20 Design / UX / functionality | C | C | C | Individual rendered design review and browser checks |
| 21 Verification before claim | C | C | P | Local checks recorded below; final deployment state appended after release |

## Delivered designs

Rebuilt **57 existing HTML boards** at their existing URLs. Their defaults reach both newly selected standard templates and saved instances that reference those URLs. No customer template zones or saved text/image/style overrides were overwritten.

| Family | Boards | Main improvements |
|---|---:|---|
| School | 6 | Three distinct middle-school welcomes and elementary agendas, real food photos, readable completed periods, portrait room for longer school names |
| Corporate | 8 | Lobby, staff feature, directory, KPI, events and transport compositions with readable type and editable photo slots |
| Healthcare | 10 | Waiting room, physicians, queue, vaccine, hours, education, portal, pharmacy, clinical and departure layouts |
| Hospitality | 4 | Events, directions, check-in and outlook with purpose-built portrait compositions |
| Fashion | 4 | Editorial, sale, event invitation and fitting-room layouts |
| Veterinary | 2 | Pet-of-the-day waiting room and adoption portraits |
| Clinic | 1 | Campaign and queue composition |
| Restaurant menus | 9 | Full service, wine, cocktails, 86 board, brunch, prix fixe, tasting progress, reservations and pickup |
| Bar | 7 | Taps, cocktails, bottles, happy hour, performance, bottle service and game day |
| QSR | 3 | Rewards, hours/location and recruitment; real QR generation from supplied links |
| Christmas | 3 | Separate elementary, middle and high-school designs, real calendar counters and editable artwork |

Also repaired the default text contrast for **24 football/basketball/baseball celebration variants**, preserving saved user style choices.

Designs use distinct, loaded type families: editorial serif combinations such as Fraunces/DM Sans and Newsreader/Manrope; strong display faces such as Archivo Black, Barlow Condensed and Oswald; and school directions such as Fredoka/Nunito and Space Grotesk/DM Sans. Families, palette tokens, body copy, labels, photos and logos remain editable. Ordinary authored body text floors at 60px and supporting text at 50px on the 3840px canvas. The fitter honors those absolute floors as global scale changes, and explicit operator font sizes remain absolute. Where testing found tight boxes, room was added rather than shrinking type below the floor. An arbitrary essay or an explicitly oversized manual font still exceeds a short field's capacity.

All **1,802 original DOM text keys and 47 original image-slot keys** in the 57 rebuilt files were preserved. Current files expose **2,777 text keys and 110 image slots**. The complete path/key audit is `docs/research/2026-10-10-template-flagship-refresh/source-key-preservation.json`; counts exclude script selector strings. Stable IDs, URLs, retained/quarantined status and metadata-only preset synchronization are unchanged.

## Editor and shared runtime cleanup

- Image, Video and Text remain at the top of the quick actions and curated widget lists from the earlier shipped editor release. Blank and built-in templates use the same visible Replace / Fit / Rotate controls, natural source proportions, gestures, locks, Undo/Redo and save behavior.
- All 282 regular and 58 holiday HTML sources have the additive V2 media companion. Replacing an image inside a child img now changes that image. Fit/rotation reapplies after legacy painters finish, including WebKit's message-listener ordering. Saved fits override legacy important logo rules; clearing them restores authored fit declarations.
- The companion loads all 89 authored/toolbar Google-font families inside the sandbox when selected through field styles, theme edits or brand controls. Fonts loaded in the editor parent are not mistaken for iframe resources.
- Holiday image slots are discovered from the selected grade/design/orientation. They now support the same media selection and replacement controls, removal/restoration, Undo/Redo, save and reload. Holiday field caches include grade, variant, design and orientation so alternates use their actual fields.
- Generic V15 injection covers the full generic corpus, including canonical brand color aliases and local clock/date pinning. Menu/POS applyMenu and kiosk bridges are retained. Saved operator font sizes and brand colors survive local fitting/theme mutations.
- School period-status updates no longer trigger a self-sustaining MutationObserver loop. Completed periods remain readable, and default fake period highlighting is removed.
- Christmas counters use editable dates, validate actual calendar days, handle recurring leap days and local-day/DST boundaries, and honor manual pins. Older long saved ticker text gets bounded scrolling instead of tiny type or truncation.
- QSR QR codes encode supplied links. Missing links show useful counter guidance instead of a fake decorative code. Unconnected operational boards use editable sample labels instead of invented live claims.
- The veterinary sample's unverified dental-prevention assertion was replaced with an editable invitation to ask the clinical team. Saved customer text at `tip.text` is preserved.

## Preserved integration boundaries

Handcrafted menu V5 applyMenu functions remain byte-identical. Six bar menu boards and the representative full-service/wine flows retain price and supported description updates, unavailable row treatment, readable sold-out labels and restock restoration. Existing description-key dialect limits remain: old .d/.desc bindings are supported; legacy .r/.nm/.pr conventions are not represented as newly completed provider integration. No fake POS data or prices were added to live provider widgets.

Kiosk engines retain their current screen while media changes arrive through messages. Approved AI references remain the same 11 exemplars; new candidates were not registered as user-approved designs. Source hashes are regenerated after source changes. Gallery posters are regenerated from actual renders and recorded with source hashes, with a new poster cache version. The generator now recurses all six roots, including custom boards, and uses the gym runtime's documented preview mode.

## Verification

Baseline: all 151 native presets and all 340 packaged HTML sources were rendered; packaged sources were captured in both orientations. Navigation success is coverage evidence, not a visual-quality pass for every old template.

Completed local evidence includes:

- 75 relevant Jest suites / 720 tests, plus 133 approved-AI-reference tests.
- Chromium/WebKit default renders for the rebuilt families, loaded fonts, 60px/50px floors, editable visible copy, preserved fields and slots, and portrait/landscape geometry.
- 712 production-build browser checks passed: 680 image/fit/rotation corpus cases, 26 builder media workflows and 6 font-restoration cases. The extended 10-case font suite also passed after adding brand-role font loading/alias coverage.
- 120 lead saved-edit browser/orientation cases covering representative body edits, global type scaling, absolute 72px font choices, colors, clock pins and saved URL restoration. Targeted reruns replace the identified cocktail spacing and transient brunch-load failures; final aggregate is recorded separately.
- Corporate/bar/QSR: 40 saved-edit cases, 8 actual QR matrix checks and 24 sold-out layout cases.
- Fashion/clinic/adoption: 24 saved-edit/layout cases, plus four veterinary waiting-room and targeted font/control checks.
- Christmas: 48 live, frozen, saved-edit and restored-old-copy cases, including dates, timers, fonts, colors, every media slot and click selection.
- Holiday bridge 193 assertions, K-12 menu/backlog canaries and kiosk shim checks.
- Full corpus media replacement/fit/rotation checks and font/editor E2E against the production build; final counts and status appended below.
- Click-editability sweep: all 282 regular boards; inset serialization guard clean. Full `pnpm preflight` passes after refreshing local generated Prisma types to match upstream master and removing stale generated dev-route types from the audit fixture.

The wider repeating-list growth diagnostic reported **250 failures across 244 detected groups**. Its first 40 printed failures are in unchanged designs; the full set needs classification before attributing failures to this release. This result is retained as a library gap, and is not called a pass. This batch does not promise arbitrary extra rows will fit every layout. Default authored rows and supported field edits are the validated behavior.

## Remaining library work

The inventory is 482 source presets, 19 retired and 16 quarantined, leaving 447 offered presets: 151 native and 296 external presets using 241 distinct HTML URLs. This release targets 57 source designs plus 24 celebration contrast variants. Remaining older native layouts, other holiday variants and unreworked industry boards need subsequent individual design passes. Repeating-list growth needs a dedicated compatibility pass. Retired/quarantined templates stay excluded until their defects are rebuilt and verified. Newly created source mockups are self-reviewed candidates, not user-approved flagship exemplars.

## Durable evidence and recovery

Evidence and source authoring are copied outside the worktrees at `/Users/gschiemann/Desktop/template-flagship-audit/`. Important folders: `boards/`, `native/`, `lead-after/`, `lead-saved-edits/`, `sports-after/`, `corporate/`, `healthcare/second-wave/`, `hospitality-after/`, `bar-qsr/`, `christmas-after/`, and `reports/`.

Detailed reports are committed under `docs/research/2026-10-10-template-flagship-refresh/`: corporate.md, healthcare.md, healthcare-fashion-veterinary.md, corporate-bar-qsr.md and hospitality-holidays.md. CHECKPOINT.md records interrupted/resumed work. This directory is normally ignored, so these task reports are explicitly tracked. Usage is checked at milestones; completed integrations are committed locally. Worktree cleanup must preserve these external authoring/evidence copies and only archive this task's four owned worktrees.

## Release state

Implementation is integrated locally on `codex/template-flagship-refresh`, including upstream master `115d27b7`. Not yet pushed or verified live. Final CI, deployment, commit and test status will be appended after verification. Earlier editor usability work is already live; this design refresh is a separate release.

## Additional scope — catalog gaps (2026-10-11)

The user requested new templates for major missing workflows. Three domain assessments are underway, covering the offered native and HTML catalogs. New sources will receive both landscape and portrait preset registrations, real captures, and the same editable text/media/font contracts. This is additional work after the 57-board refresh; no new template has yet been registered.
