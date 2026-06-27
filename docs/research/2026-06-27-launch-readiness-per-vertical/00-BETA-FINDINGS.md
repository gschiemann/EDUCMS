# Launch-Readiness Beta — All 12 Business Lines (2026-06-27)

Source: Workflow `wf_ba757586-f7b` — 13 agents, 1358400 tokens. One agent per vertical flipped the whole product to that business line and reality-tested AI generation, templates, widgets, integrations, sample data + competitive gaps. (RESTAURANT agent did not return structured output — re-run needed.) Run alongside the LIVE camera-circle test (see 01-CAMERA-CIRCLE.md).

## Grades (A–F)

| Vertical | AI gen | Templates | Widgets | Integrations | Sample data | Blockers |
|---|---|---|---|---|---|---|
| K12 | A | B | A | C | A | 4 |
| SPORTS | A | A | A | D | A | 2 |
| QSR (Quick-Service Restaurant) | A | B | B | A | B | 4 |
| BAR | A | A | A | B | A | 1 |
| GYM | A | C | B | B | B | 4 |
| RETAIL | A | A | A | B+ | A | 0 |
| FASHION | A | A | B+ | A | B | 3 |
| HEALTHCARE | A | A | B+ | D | B | 4 |
| HOSPITALITY | A | A | A | D | A | 1 |
| CORPORATE | A | C | F | D | B | 3 |
| WORSHIP | A | B+ | B | C | D | 4 |

## Synthesis verdict

**P0: 0 · P1: 17**  
**Launch-strong:** RETAIL, BAR, FASHION, SPORTS, QSR  
**Weakest (hold/beta):** CORPORATE, WORSHIP, HEALTHCARE, GYM, HOSPITALITY

CONDITIONAL LAUNCH — ship 5 strong verticals now, gate 7. Across all 12 business lines, AI generation is uniformly world-class (12/12 A) and the architectural spine (vertical voice, design affinity, archetypes, onboarding taxonomy) is sound. But the product is NOT uniformly launch-ready: it is two products wearing one skin. The verticals built on REAL React widgets + editable zones (RETAIL, BAR, FASHION, SPORTS, QSR-core) are genuinely premium and shippable; the verticals served by EXTERNAL_HTML static-iframe presets (CORPORATE, WORSHIP, HEALTHCARE, HOSPITALITY, and partially K12) are visual mockups an operator cannot edit a single word of. CORPORATE is the worst — widgets render a literal 'Pick a style' placeholder (verified WidgetRenderer.tsx:665-668). The single most damaging defect CLASS is 'EXTERNAL_HTML costume = un-editable' which recurs across 5+ verticals and directly re-triggers the operator's historic 'none of the templates are even editable' complaint that is a stated launch blocker. The second class is 'integration costumes' — POS/SIS/PMS/score-feed/giving connectors marked DIRECT or null-href that have no working sync (K12 Clever, SPORTS Daktronics, HEALTHCARE Epic, HOSPITALITY Opera/Mews, GYM Mindbody, WORSHIP Tithe.ly). The 'live data' promise is hollow in 6 verticals. VERDICT: Launch RETAIL/BAR/FASHION now (zero or trivial blockers). Launch SPORTS/QSR/K12 with honest 'integrations coming soon' messaging. HOLD CORPORATE/WORSHIP/HEALTHCARE/GYM/HOSPITALITY behind a 'beta' flag until template-editability + at least static-content parity lands. There are no security/safety P0s — every blocker is content/editability/integration-honesty. The fastest path to credibly launching all 12 is to fix the EXTERNAL_HTML editability class once (a shared port to editable zones) and to flip every costume integration to honest COMING_SOON status — both are leverage moves that clear the majority of the punch-list.

## Cross-vertical defect classes (fix-once leverage)

- **[P1] EXTERNAL_HTML static-iframe presets are un-editable costumes — operator cannot change text/colors/fonts/dates inline, must fork+hand-edit HTML. Directly re-triggers the operator's standing 'none of the templates are even editable' launch blocker. This is the single highest-leverage defect class.**  
  _Affects:_ CORPORATE, WORSHIP, HEALTHCARE, HOSPITALITY, K12, QSR  
  _Fix:_ Port flagship presets per vertical from EXTERNAL_HTML to React zone templates with PropertiesPanel editability (CORPORATE/WORSHIP/HEALTHCARE already have *-presets.ts React equivalents partly modeled — wire those zones into system-presets.ts). Build a shared EXTERNAL_HTML→editable-zone port once; apply across all affected verticals. Keep EXTERNAL_HTML only as a lightweight legacy fallback.
- **[P1] Integration costumes — POS/SIS/PMS/score-feed/giving providers presented as available (DIRECT tier or null connectHref dead button) with no working sync endpoint. Makes the 'live data' promise hollow and surfaces as 'connector in development' only at connect-time.**  
  _Affects:_ K12, SPORTS, HEALTHCARE, HOSPITALITY, GYM, WORSHIP, BAR, QSR, RETAIL  
  _Fix:_ Single sweep of discovery.service.ts: every provider without a real sync endpoint gets an explicit COMING_SOON status + honest blurb (never a dead null-href button or DIRECT label). Add integrationTier filtering so PARTNER/COMING_SOON providers don't appear as 'available' at discover stage. Build at minimum ONE real feed per data-dependent vertical (Clever roster for K12, one score feed for SPORTS, PMS for HOSPITALITY) before claiming the vertical is data-driven.
- **[P1] Vertical-specific widget set missing or unregistered — declared widget types never wired into variants-register.ts, so operators get placeholders or EXTERNAL_HTML instead of native editable widgets.**  
  _Affects:_ CORPORATE, HEALTHCARE, WORSHIP, GYM, QSR  
  _Fix:_ Register real React widget variants in variants-register.ts tagged with the vertical, mirroring the SPORTS/fitness build-out pattern: CORPORATE (TEXT/ANNOUNCEMENT/CLOCK/CALENDAR), HEALTHCARE (WaitTimeDisplay/PhysicianDirectory/NowServingBoard), WORSHIP (PrayerRequest/GivingThermometer/SermonSeries/ServiceTimes), GYM (Occupancy/TrainerSpotlight/ClassSignup/MembershipCard), QSR (RESTAURANT_MENU_BOARD/COMBO_CAROUSEL/WAIT_TIME/etc which are declared in restaurant-presets.ts but never registered). Each field must be editable in PropertiesPanel.
- **[P2] Per-vertical sample/branding data missing — new tenants fall back to generic 'VenueOS' brand, no sample URLs, no on-vertical onboarding copy ('Add a School/Restaurant/Store' shown to clinics/churches/boutiques), no seed data on signup.**  
  _Affects:_ K12, QSR, FASHION, HEALTHCARE, WORSHIP, CORPORATE  
  _Fix:_ Add a VERTICAL_BRANDING_SAMPLES map (logo URL, palette, example business names, sample scrape URLs) in verticals.ts and wire into the branding wizard; add per-vertical onboarding CTA copy; add WORSHIP to STREAM_VERTICALS and add a sample-event seed so church/clinic/boutique tenants land on populated demo content like every other vertical.
- **[P1] Thin template/widget library for newer verticals vs the beachhead — GYM ships 2 signage presets, CORPORATE/WORSHIP/HEALTHCARE/HOSPITALITY ship ~8-10 but un-editable; gallery looks empty/premium-marketing-vs-empty-shelf.**  
  _Affects:_ GYM, K12, FASHION, CORPORATE  
  _Fix:_ Build out the editable template library to a credible floor (8-12 per vertical) starting with GYM (membership/class-schedule/occupancy/trainer) and K12 signage (port best system presets to signage/school/ — currently zero K12 signage templates exist despite K12 being the beachhead). Add missing kiosk templates (FASHION has zero).

## Ranked launch punch-list

1. **[P1] CORPORATE** — CORPORATE widgets render a literal 'Pick a style' placeholder costume — vertical is non-functional  
   ↳ Verified WidgetRenderer.tsx:665-668 — CORPORATE falls into the same unrendered placeholder case as HEALTHCARE/HOSPITALITY/WORSHIP; code comment confirms deliberate skip pending widget builds. Operator can see a lobby design but cannot edit a single piece, pick a text style, or generate their own board.  
   _Fix:_ Register real CORPORATE widget variants (TEXT/ANNOUNCEMENT/CLOCK/CALENDAR at minimum) in variants-register.ts with vertical:'CORPORATE' + render implementations; then decompose the 10 EXTERNAL_HTML presets into editable multi-zone React templates so AI generation + branding actually have editable zones to target.
2. **[P1] WORSHIP** — 8 church presets are static EXTERNAL_HTML shells — pastor cannot change sermon titles or giving goals without forking HTML  
   ↳ system-presets.ts routes all 8 worship presets through EXTERNAL_HTML loading hardcoded /templates/signage/church/*.html; worship-presets.ts ALREADY models the React zone equivalents (TEXT/ANNOUNCEMENT/COUNTDOWN/CALENDAR) — the component work is done but unwired.  
   _Fix:_ Replace each EXTERNAL_HTML worship preset in system-presets.ts with the existing React preset equivalents from worship-presets.ts (~40 zones to wire). Highest ROI editability fix because the React work already exists.
3. **[P1] HEALTHCARE** — All 10 healthcare templates are un-editable EXTERNAL_HTML + zero healthcare widgets exist  
   ↳ system-presets.ts: 10 healthcare templates all widgetType:'EXTERNAL_HTML' with hardcoded urls; variants-register.ts has 500+ variants but exactly zero tagged HEALTHCARE. A clinic operator can't change a headline and sees no clinic widgets in the palette.  
   _Fix:_ Port 2-3 flagship templates (waiting-room, physician-directory, now-serving) to React zone templates with PropertiesPanel editability; build 3 widget primitives (WaitTimeDisplay, PhysicianDirectory, NowServingBoard) registered with vertical:'HEALTHCARE'.
4. **[P1] QSR** — Restaurant widgets (MENU_BOARD/COMBO_CAROUSEL/WAIT_TIME/etc) declared in presets but never registered or rendered  
   ↳ restaurant-presets.ts declares RESTAURANT_MENU_BOARD/COMBO_CAROUSEL/WAIT_TIME/SPECIALS_CALLOUT/ALLERGY_LEGEND/LOYALTY_TICKER but none exist in variants-register.ts — operators get an EXTERNAL_HTML costume instead of native editable boards. QSR is highest-value commerce vertical.  
   _Fix:_ Register all six RESTAURANT_* variants in variants-register.ts with React implementations mirroring the SPORTS/fitness widget build-out; make every field editable in PropertiesPanel.
5. **[P1] GYM** — Critically thin GYM library — only 2 signage presets (both costumes) and 9 widgets vs SPORTS 100+/K12 40+  
   ↳ system-presets.ts:2114-2115 shows exactly 2 GYM presets (Floor Board, Leaderboard), both EXTERNAL_HTML with no editable zones; 9 FITNESS_* widgets registered, all core gym primitives (occupancy, trainer, class-signup, membership, waitlist) missing. Operator sees 'premium platform' marketing then an empty gallery.  
   _Fix:_ Build 8-12 editable GYM signage templates (membership/class-schedule/occupancy/trainer/welcome) + 8-10 GYM widgets (GYM_OCCUPANCY_RING/TRAINER_SPOTLIGHT/CLASS_SIGNUP/MEMBERSHIP_CARD/WAITLIST) registered with vertical:'GYM'.
6. **[P1] HOSPITALITY** — All templates assume PMS/Opera/Mews data feeds that don't exist — hotel operator sees blank amenity/arrivals boards  
   ↳ signage/hospitality/01-lobby-welcome-flagship.html lines 8-9 declare 'FEEDS: PMS (Opera/Mews) for occupancy + arrivals'; no PMS connector exists in apps/api/src/integrations; widgets are described as data-driven but no sync service is implemented.  
   _Fix:_ Ship static-only mode now: hide all data-feed placeholders so operator-entered content fills the boards cleanly. Build the Opera/Mews PMS bridge (OAuth + occupancy/arrivals polling) as a post-launch deliverable gated behind DIRECT tier with honest status.
7. **[P1] K12** — Clever shows as integrated but is SSO-button-only — no roster/class-schedule sync, the core SIS expectation  
   ↳ discovery.service.ts:316 claims Clever is 'already wired in CleverModule' but the clever/ folder has crypto/http/cron/service and no roster endpoint or controller wiring; K-12 operators expect live staff + class data, competitors (OptiSigns/Yodeck/Rise Vision) ship bidirectional SIS sync.  
   _Fix:_ Either build the roster sync endpoint (GET /clever/roster, POST /clever/sync) wired into staff/class widgets, OR flip the discovery entry to honest 'Coming soon — roster sync in development'. Do not present login-only as a synced feed.
8. **[P1] K12** — Zero K-12 signage templates exist despite K12 being the beachhead vertical  
   ↳ Verified: apps/web/public/templates/signage/ contains bar/church/clinic/corporate/fashion/gym/healthcare/hospitality/menus-pos/museum/office/qsr/real-estate/veterinary — NO 'school' folder. K12 templates exist only as kiosk + system presets, none browsable as EXTERNAL_HTML signage.  
   _Fix:_ Port the best 5-8 K-12 system presets (Animated MS/HS Welcome, Cafeteria, Hallway Ticker, Athletics Board) to editable templates in signage/school/ so school operators can browse a populated K12 gallery without generating or editing presets.
9. **[P1] BAR** — Integration discovery surfaces PARTNER-tier POS as available, then dead-ends at 'connector in development'  
   ↳ discovery.service.ts returns Toast/Stripe/Clover marked PARTNER in candidates without filtering by integrationTier; BAR operator sees Toast as available at discover stage then hits 'connector in development' at connect time.  
   _Fix:_ Add integrationTier check in RULES evaluation — filter PARTNER/CLOSED providers out of the candidate list (or read POS_PROVIDERS.integrationTier and skip non-DIRECT). This is the shared 'integration honesty' fix that also helps every other vertical.
10. **[P1] WORSHIP** — New church tenants get zero seed data — WORSHIP absent from STREAM_VERTICALS and MENU_VERTICALS  
   ↳ sample-data.service.ts:27-33 — WORSHIP is in neither MENU_VERTICALS nor STREAM_VERTICALS; a new church lands on an empty Concierge, no sample events in CALENDAR, blank slate while every other vertical pre-populates demo data.  
   _Fix:_ Add WORSHIP to STREAM_VERTICALS (seed a local NPR public broadcaster for neutral sanctuary background) + add a WORSHIP sample-event seed ('Easter sunrise service', 'Midweek bible study') populating the CALENDAR presets.
11. **[P1] WORSHIP** — No giving/donations integration category — Tithe.ly/Pushpay/Giving|Trac not discoverable  
   ↳ discovery.service.ts:34-48 IntegrationCategory has no 'giving'/'donations' category and no rules for church giving platforms; giving is the #1 church-tech expectation.  
   _Fix:_ Add 'giving' to IntegrationCategory + ProviderRules for Tithe.ly/Pushpay/Giving|Trac so the Concierge auto-discovers them on a church website; flag COMING_SOON if connector sync isn't built yet.
12. **[P1] QSR** — AI image generation pulls generic stock, not cuisine-specific appetite-inducing food shots  
   ↳ ai.service.ts VERTICAL_VOICE.QSR + VERTICAL_DESIGN_AFFINITY.QSR anchor COPY correctly, but ArtDirectorSpec.imagePlan routes to a provider-agnostic image-search backend with no vertical-aware hint — 'burger special' returns a generic stock photo.  
   _Fix:_ Add a vertical-aware imageSearchHint to ArchetypeImagePlan; pass vertical context to the image provider ('burger for a QSR drive-thru, high contrast, appetizing lighting').
13. **[P1] GYM** — fresh-fitness design affinity declared but never tested end-to-end into AI output  
   ↳ verticals.ts:647 specifies GYM themes ['fresh-fitness','neon-sports']; ai.service.ts:1778-1789 passes affinity as soft hint + fallback, but no test asserts GYM affinity themes resolve via THEMES or that buildSignageBoardCore never emits 'clean-corporate'/'warm-school' for GYM.  
   _Fix:_ Add validator + integration tests asserting VERTICAL_DESIGN_AFFINITY['GYM'].themes all resolve and that GYM generation deterministically falls back to fresh-fitness/neon-sports, never a non-fitness theme.
14. **[P1] FASHION** — Clover mislabeled as non-FASHION though it's a major apparel POS  
   ↳ packages/api-types/src/pos.ts: Clover bestFor is ['QSR','RETAIL','BAR'] — FASHION omitted; Lightspeed/Shopify correctly include FASHION.  
   _Fix:_ Add 'FASHION' to Clover's bestFor array; optionally add 2-3 fashion-vertical POS connectors (Vend, Toast Retail, Square Appointments) marked COMING_SOON/PARTNER.
15. **[P2] QSR** — No drive-thru ORDER-HERE entry-point signage board  
   ↳ restaurant-presets.ts has qsr-drive-thru-menu + combo carousel + wait-time but no dedicated 'ORDER HERE / start order' entry board; competitors ship pole-mounted entry boards with directional copy + payment icons.  
   _Fix:_ Add qsr-drive-thru-order-here template (large 'ORDER HERE' headline, payment icons, mobile-order QR, directional arrows) in portrait pole-mount dimensions.
16. **[P2] FASHION** — Zero FASHION kiosk templates  
   ↳ system-presets.ts: 19 kiosk presets, none tagged FASHION (kiosk dirs cover bar/clinic/food/gym/museum/office/qsr/real-estate/school/vet — fashion absent).  
   _Fix:_ Create 3-5 FASHION kiosk templates (lookbook-browser, style-finder, loyalty-signup, store-directory, size-guide) registered as preset-kiosk-fashion-*.
17. **[P2] SPORTS** — Score-feed integrations are costumes — system displays scores but has no real Daktronics/ESPN/league connection  
   ↳ discovery.service.ts: sports-data category exists in the enum but no real provider implementations; Audit ticket #171 marks Daktronics/Nevco/ESPN/SLC as costumes. The 'live' promise is hollow for auto-updating game data.  
   _Fix:_ Implement at least one genuine score feed end-to-end (Daktronics RS485 parser OR ESPN/SLC webhook) OR explicitly disable score-feed features in the sports console until a real feed lands, with honest COMING_SOON status.
18. **[P2] K12** — No K-12 vertical sample branding — falls back to generic 'VenueOS' default brand  
   ↳ VERTICAL_DEFAULT_BRAND maps K12 → 'VenueOS'; no sample school district URLs or branding examples in discovery/onboarding so a new K12 tenant has no polished reference.  
   _Fix:_ Add K-12 branding samples (sample school name + logo/palette) to the vertical picker/onboarding so new K12 tenants see a polished reference before signup.
19. **[P2] HEALTHCARE** — Onboarding copy + branding samples use generic school/restaurant language, never healthcare  
   ↳ ensure-system-presets.ts maps clinic/healthcare/veterinary to HEALTHCARE but signup wizard shows 'Add a School/Restaurant/Store', never 'Add a Clinic/Hospital/Practice'; no healthcare sample brand URLs.  
   _Fix:_ Add HEALTHCARE onboarding CTA copy ('Add a Clinic/Hospital/Practice') + sample brand URLs (large hospital, urgent-care chain) wired into the 'What's your business?' step.
20. **[P2] QSR** — QSR branding sample URLs + copy are generic placeholder, fall back to VenueOS  
   ↳ verticals.ts:106 QSR label/tagline correct but related sample branding (logo, palette, voice examples) missing or falls back to VERTICAL_DEFAULT_BRAND='VenueOS' (line 305).  
   _Fix:_ Add VERTICAL_BRANDING_SAMPLES QSR entries (palette + example business names) and wire into branding-wizard.tsx so new QSR tenants see on-brand palettes on first run.
21. **[P2] GYM** — Mindbody marked as integration but connector is discovery-signal-only (null connectHref)  
   ↳ discovery.service.ts:349-358 defines Mindbody with connectHref:null; gym operators expect to sync class schedules from Mindbody (industry standard) but no connector exists.  
   _Fix:_ Either build the Mindbody OAuth connector (class schedule + instructor sync) or set blurb to honest 'Coming soon: class schedule sync from Mindbody'.
22. **[P2] SPORTS** — Sample data seeds generic public broadcasters but no sports-specific feeds  
   ↳ sample-data.service.ts:33 STREAM_VERTICALS includes SPORTS but _seedPublicBroadcasters() only adds generic radio/news (PUBLIC_BROADCASTER_CHANNELS), no sports streams.  
   _Fix:_ Add sports-specific streaming sources to the SPORTS seed (ESPN+/Peacock/league placeholders) or a note that operators configure their own feed.
23. **[P2] FASHION** — FASHION has no dedicated sample/branding URLs or onboarding copy  
   ↳ verticals.ts:56 FASHION has singular/plural/tagline but no branding-sample URLs, no onboarding copy, no 'Add a Boutique' CTA variants unlike K12/GYM/SPORTS.  
   _Fix:_ Seed 3-4 real fashion lookbook URLs for scraping + add FASHION onboarding copy ('Create a Fashion Boutique', 'New Collection Board') in the discovery service.

---
## Full per-vertical detail

### K12
Grades — AI:A Templates:B Widgets:A Integrations:C SampleData:A

K-12 vertical ships with world-class AI generation (warm-school affinity + K12 voice guidance embedded), complete per-grade-level widget palette (10+ animated school-context variants), and robust system presets across all school locations (welcome, cafeteria, hallway, athletics, holidays). Clever SIS integration is wired + real. Critical gap: POS/SIS/streaming integrations marked COMING_SOON or not-implemented (Toast/Clover/Lightspeed costumes; Clever is a button to SSO settings, not a synced feed). Verdict: ready to ship for core signage use cases (announcements, schedules, celebrations). SIS roster/class-schedule sync via Clever not operational; vendors like OptiSigns/Yodeck/Rise Vision have mature SIS bidirectional sync. High-school athletics boards are production-quality; K-12-specific emergency features (lockdown/hold/secure) are fully implemented.

**Launch blockers:**
- [P1] (integrations) **Clover/Toast/Lightspeed/Shopify marked null connectHref (costumes) instead of explicitly COMING_SOON** — apps/api/src/integrations/discovery.service.ts:128, 116, 139, 150 — all POS integrations have connectHref:null with no status message → _Flip each null connectHref to a proper status object or message — search Discovery UI for how COMING_SOON integrations display, ensure operator sees 'Coming soon' not a dead button_
- [P1] (integrations) **Clever integration has no active sync endpoint or roster feed — only SSO button** — apps/api/src/integrations/clever/ folder has crypto/http/cron/service but no POST /clever/roster or equivalent endpoint wiring in controllers; discovery.service.ts line 316 says 'already wired in CleverModule' but K-12 operators expect live staff + class data, not just login → _Either (a) build the roster sync endpoint (GET /clever/roster, POST /clever/sync) + wire it into PropertiesPanel for staff/class widgets, or (b) flip discovery entry to connectHref:null with 'Coming soon — roster sync in development'_
- [P2] (templates) **No school-specific signage templates in apps/web/public/templates/signage/ — only apps/web/public/templates/school/ (kiosk-only)** — apps/web/public/templates/signage/ has 14 subdirectories (bar, church, gym, qsr, etc) but no 'school' folder; only 78 EXTERNAL_HTML templates shipped, zero K-12 signage among them → _Port the best 5-8 system presets (Animated Middle/High School Welcome, Cafeteria, Hallway Ticker, Athletics Board) to EXTERNAL_HTML format in apps/web/public/templates/signage/school/ so operators can browse them in the template picker without needing to 'generate' or edit presets_
- [P1] (sample-data) **No K-12 vertical sample URLs / branding examples in vertical configuration** — VERTICAL_DEFAULT_BRAND maps K12 → 'VenueOS' (generic, not school-branded); no sample school district URLs in discovery or onboarding UX to show operators what a real K12 tenant looks like → _Add K-12 branding samples (e.g., 'Alexander Hamilton High School' + sample logo/palette) to the vertical picker / onboarding so a new K12 tenant sees what a polished school tenant looks like before signup_

**Competitive gaps:**
- OptiSigns / Rise Vision ship live SIS roster + class schedule sync (Clever, Skyward, PowerSchool) with automatic staff photo + class list widgets — VenueOS Clever is button-only today
- Yodeck + ScreenCloud feature SIS-driven emergency notification propagation (fire alarm → all screens show evacuation info immediately) — VenueOS has emergency overlays but no SIS trigger source
- OptiSigns ships K-12-themed menu boards + food service integrations (Aladdin, MySchoolBucks) — VenueOS has no food-service sync for K-12 yet (only QSR POS)
- Rise Vision pre-built K-12 packages with curriculum-aligned content (AP test countdown, ACT prep, college fair schedules) — VenueOS offers general-purpose templates, not domain-specific packs
- All three competitors offer per-school district branding + multi-school fleet management with centralized approval workflows — VenueOS has group/location hierarchy but not district-governance-specific features (e.g. AUP + branding police per district policy)

### SPORTS
Grades — AI:A Templates:A Widgets:A Integrations:D SampleData:A

SPORTS vertical is 75% launch-ready: world-class AI generation (high-energy, on-brand hype), complete widget set (17+ SPORTS-tagged variants for every major sport), 30+ premium templates (scoreboards / ribbons / celebrations), and full onboarding copy ("Add a Venue") are all in place. Sample branding URLs (nba.com, ncaa.com) are configured. Critical gap: score-feed integrations are costumes — the system can display scores but has no real connection to Daktronics, ESPN, or league APIs, making the "live" promise hollow for customers who need auto-updating game data. Hardware control (LED ribbon, RS485 panels) is pre-production. Grade down integrationsGrade to D until at least one real score feed works end-to-end.

**Launch blockers:**
- [P2] (integrations) **Sports score feed integrations marked COMING_SOON / costume status** — apps/api/src/integrations/discovery.service.ts: sports-data category exists in IntegrationCategory enum but no actual providers (Daktronics/Nevco/ESPN/SLC) have real working implementations — Audit ticket #171 marks them as costumes → _Either implement genuine score-feed integration endpoints (Daktronics RS485 parser, ESPN/SLC webhooks) OR explicitly disable score-feed features in the sports console until real implementations land_
- [P2] (integrations) **Sample data seeding includes public broadcasters (NPR/SomaFM) but no sports-specific feeds** — apps/api/src/sample-data/sample-data.service.ts line 33: STREAM_VERTICALS includes 'SPORTS' but _seedPublicBroadcasters() only adds generic radio/news channels (PUBLIC_BROADCASTER_CHANNELS) — no ESPN/Peacock/sports league streams → _Add sports-specific streaming sources to STREAM_VERTICALS seed (ESPN+ placeholder, Peacock, league-specific streams, or a note that operators must configure their own feed)_

**Competitive gaps:**
- Live scoreboard control console lacks real third-party hardware integrations (Daktronics console parser, LED ribbon pixel-mapping UI finished but pre-production)
- No native live-streaming scorebug overlay (competitors ship OBS/broadcast-software integration out-of-box; VenueOS marks as 'Tier-1' pending work)
- Score-feed ingestion from public APIs (ESPN, SLC, team-specific stat services) not wired — templates can display scores but no auto-sync from live game data
- Mobile operator app for in-game control exists but lacks power-user features competitors ship (game-rundown scripts, mid-game template swap with auto-revert, typed GameState per sport)
- Roster/team data binding for ribbon boards is manual entry only; no integration with athletic association databases or team management systems

### QSR (Quick-Service Restaurant)
Grades — AI:A Templates:B Widgets:B Integrations:A SampleData:B

QSR is PARTIALLY LAUNCH-READY for a basic use case (menu boards, promo displays) but has critical gaps for best-in-industry positioning. AI generation is world-class (archetype + theme + voice working together), templates are premium (Domino's v4 + 13 cuisine variants), and POS integration (Square/Clover/Lightspeed) is production-grade with real sync. However: (1) restaurant-specific widgets are declared but never registered/rendered — operators get an EXTERNAL_HTML costume instead of native editable boards; (2) no drive-thru ORDER-HERE signage; (3) no real-time item availability delta from POS; (4) no KDS/back-of-house integration. For a Domino's or regional burger chain signing up day-one, the product feels unfinished in the workflow (staff sees nothing, guests order from last-hour's stale menu, out-of-stock items still display). Fix the widget registration + add one drive-thru entry template + add live-availability push from POS to clear P0 blockers. Intended for Q3 2026 launch but shipping now would embarrass us against OptiSigns in the QSR vertical.

**Launch blockers:**
- [P2] (templates) **No drive-thru order-here signage board (critical for QSR)** — /Users/gschiemann/Desktop/EDU CMS/apps/api/src/templates/restaurant-presets.ts has 'qsr-drive-thru-menu' + combo carousel + wait-time board, but no dedicated 'order here / start order' entry board commonly displayed at drive-thru windows or outside walk-in ordering areas; competitors (OptiSigns, Yodeck) ship specific entry-point boards with large directional copy → _Add 'qsr-drive-thru-order-here' template featuring large 'ORDER HERE' headline, payment method icons (card/cash), QR for mobile ordering, directional arrow graphics. ~320x1080 or 1080x1920 portrait for pole-mounted drive-thru signage._
- [P2] (widgets) **QSR-specific widgets are EXTERNAL_HTML costume boards, not natively editable** — /Users/gschiemann/Desktop/EDU CMS/apps/web/src/components/widgets/variants-register.ts line 98 shows EXTERNAL_HTML template picker for 'QSR, retail, healthcare…' but these are static IFRAMES, not composable widgets. /apps/api/src/templates/restaurant-presets.ts declares 'RESTAURANT_COMBO_CAROUSEL', 'RESTAURANT_MENU_BOARD', 'RESTAURANT_WAIT_TIME' etc. but these widget types don't exist in variants-register.ts — they are NEVER registered + rendered by WidgetRenderer → _Register 'RESTAURANT_MENU_BOARD' + 'RESTAURANT_COMBO_CAROUSEL' + 'RESTAURANT_WAIT_TIME' + 'RESTAURANT_SPECIALS_CALLOUT' + 'RESTAURANT_ALLERGY_LEGEND' + 'RESTAURANT_LOYALTY_TICKER' as real variants in variants-register.ts with React implementations in /apps/web/src/components/widgets/ (mirror the fitness/SPORTS widget build-out pattern from tasks 24-31). Make every field editable in PropertiesPanel so operators don't need the EXTERNAL_HTML costumes._
- [P1] (ai-generation) **AI template generation never uses QSR-appropriate image for menu/promo boards** — /Users/gschiemann/Desktop/EDU CMS/apps/api/src/ai/ai.service.ts defines VERTICAL_VOICE.QSR with correct tone (line 168) + buildSignageBoardCore applies VERTICAL_DESIGN_AFFINITY.QSR (archetypes=['menu-list','poster-promo','title-cta'], themes=['qsr-appetite','bold-retail']); but the ArtDirectorSpec's imagePlan field routes to generic image-search backend which pulls 'menu board' without scoping to cuisine type / lighting / plating specificity — so a QSR operator prompting 'burger special' gets a GENERIC stock photo, not a food-specific, well-lit, appetite-inducing shot. The vertical voice anchors COPY but image generation is provider-agnostic. → _Extend ArchetypeImagePlan in the mapper to include a vertical-aware imageSearchHint: string field. Pass VERTICAL context when dispatching to the image provider: 'For a [vertical] audience, search: [cuisine/product type]' so Google Lens / Anthropic vision / OpenAI DALL-E see 'burger for a QSR drive-thru, high contrast, appetizing lighting' not just 'burger menu'._
- [P2] (sample-data) **QSR branding sample URLs + copy are generic placeholder** — /Users/gschiemann/Desktop/EDU CMS/packages/api-types/src/verticals.ts line 106 shows QSR label + tagline ('Quick-service restaurants, menu boards, promotions') — correct — but related sample branding (logo URL, palette, brand-voice examples) for onboarding are missing or fall back to VERTICAL_DEFAULT_BRAND='VenueOS' (line 305). A new QSR tenant signs up and sees placeholder branding instead of Domino's-style, Chipotle-style, or Burger King visual references. → _Add VERTICAL_BRANDING_SAMPLES map in verticals.ts with QSR entries: {logoUrl: '...', palette: {primary: '#E8B94A', accent: '#7A1F1F'}, exampleBusinessNames: ['Burger Co', 'Taco Shack', 'Coffee House']} + wire into branding-wizard.tsx so new QSR tenants see on-brand color palettes on first run._

**Competitive gaps:**
- OptiSigns / Yodeck: dedicated drive-thru order-entry signage with large call-to-action typography + lane arrows + payment method icons. VenueOS has menu boards but not entry-point boards.
- Rise Vision: real-time kitchen-display-system (KDS) widget — orders push from POS → display on non-customer-facing screen. VenueOS has POS menu sync but zero KDS integration.
- ScreenCloud: employee scheduling + staff break alerts integrated into menu boards. VenueOS has no staff-workflow integration.
- OptiSigns / Yodeck: receipt-style promotional coupons + digital loyalty push-notifications native to the widget. VenueOS RESTAURANT_LOYALTY_TICKER is text-only.
- All competitors: 24/7 auto-86 (item out-of-stock hiding) from real-time POS feed. VenueOS only syncs catalog hourly or on-demand via cron; doesn't push live availability delta.
- Most competitors: multi-language menu variants by location. VenueOS has no locale-aware template system.

### BAR
Grades — AI:A Templates:A Widgets:A Integrations:B SampleData:A

BAR vertical ships world-class on-brand templates (10 premium EXTERNAL_HTML boards) + 6 dedicated widgets (tap-list, cocktail-menu, happy-hour countdown, game-day, event-tonight, trivia-scoreboard) with full editorial control. AI generation anchored to BAR-specific archetypes (poster-promo, lower-third-banner) + neon-sports theme — guaranteed not to default to cold corporate navy. POS integrations real (Square, Clover, Lightspeed, Shopify all DIRECT via OAuth + catalog sync; Custom Webhook always available). Sample data auto-seeds realistic craft-beer menu on signup. One P1: integration discovery UI doesn't filter PARTNER-tier providers from suggestions, so operator sees Toast/Stripe as available then hits 'coming soon' at connect time. Ready to launch with honest integration messaging.

**Launch blockers:**
- [P1] (integrations) **Integration discovery UI doesn't filter PARTNER-tier POS providers from suggestions** — apps/api/src/integrations/discovery.service.ts — ProviderRule[] includes Toast/Stripe/Clover marked PARTNER, but endpoint returns them in candidates without filtering by integrationTier; BAR operator sees Toast as available at discover stage, then hits 'connector in development' at connect time → _Add integrationTier check in RULES evaluation: filter out PARTNER/CLOSED providers from returned candidate list unless feature flag enabled. Or: update discovery.service to read POS_PROVIDERS.integrationTier and skip non-DIRECT providers in candidate assembly (lines 92+)._

**Competitive gaps:**
- Live sports streaming feeds (ESPN/Hulu) for sports-bar game-day boards — Rise Vision ships embedded ESPN + score overlays
- Native happy-hour timer widget with audio cue on end — operator-friendly 'happy hour ends in 15 minutes' board + sound alert
- POS revenue reconciliation dashboard (did we sell what we showed on the menu board?) — Toast/Square partners ship this
- Digital re-order / loyalty card on menu board (Clover shows 'your last order was X' for repeat customers on the register display)

### GYM
Grades — AI:A Templates:C Widgets:B Integrations:B SampleData:B

GYM vertical has EXCELLENT architecture (AI design affinity + VERTICAL_VOICE are world-class) but CRITICALLY WEAK template/widget/integration coverage. AI generation for GYM boards will be on-brand (fresh-fitness + neon-sports themes guaranteed), but an operator will find only 2 signage templates + 9 widgets vs SPORTS (100+ widgets) and K12 (40+ templates). Mindbody discovery works but connector is missing. Sample data includes public broadcaster streams. Launch is NOT READY — gym customers will see 'premium platform' marketing but find empty gallery. P1 blocker: build real editable templates + close widget gap. Once that lands, the AI engine + voice clause will carry the UX.

**Launch blockers:**
- [P1] (templates) **Critically short template library for GYM vertical — only 2 signage presets, 0 real editable templates** — apps/api/src/templates/system-presets.ts:2114-2115 shows exactly 2 GYM presets (Floor Board, Leaderboard), both are EXTERNAL_HTML costumes with no editable zones. apps/web/public/templates/signage/gym/ contains only these 2 HTML files. Compare to K12 (16+ presets), QSR (8+), SPORTS (20+). Kiosk: 2 templates (gym.html, gym-workout.html) vs K12's 6. → _Build 8-12 real editable signage templates for GYM (membership promo, class schedule, occupancy board, upcoming events, personal training spotlight, new member welcome, member testimonials, facility hours). Port existing 2 EXTERNAL_HTML boards to React-based editable templates with zone-based editor parity. Tag all GYM templates with vertical:'GYM' in presets._
- [P1] (ai-generation) **fresh-fitness theme claimed in VERTICAL_DESIGN_AFFINITY but not wired into AI prompt directives** — packages/api-types/src/verticals.ts:647 specifies VERTICAL_DESIGN_AFFINITY for GYM includes theme 'fresh-fitness'. apps/api/src/ai/ai.service.ts:1778-1789 passes affinity to buildSignageBoardCore as a SOFT HINT + deterministic fallback. However, AI_THEME_IDS (from signage-design/src/index.ts) or theme validation is never tested for GYM-specific theme coverage. fresh-fitness theme exists (packages/signage-design/src/themes.ts:155) but no GYM-specific AI prompt directives steer toward it. → _Add GYM-specific test in packages/signage-design/src/validator.spec.ts to assert VERTICAL_DESIGN_AFFINITY['GYM'].themes all resolve via THEMES. Add integration test: call buildSignageBoardCore with vertical:'GYM', confirm output theme is 'fresh-fitness' or 'neon-sports' (in affinity order), never 'clean-corporate' or 'warm-school'._
- [P1] (widgets) **Only 9 GYM widgets shipped; critical gaps vs SPORTS (100+) and K12 (40+)** — apps/web/src/components/widgets/variants-register.ts: grep 'vertical.*GYM' shows FITNESS_CLASS_SCHEDULE, FITNESS_MUSIC_PLAYER, FITNESS_LIVE_TV, FITNESS_AD_BANNER, FITNESS_TRAINING_VIDEO, FITNESS_WORKOUT_TIMER, FITNESS_MOTIVATIONAL_QUOTE, FITNESS_APP_LIBRARY, FITNESS_STICK_LAUNCHER. Missing: membership/pricing cards, occupancy ringboard, trainer bios, class sign-up, facility amenities, locker info, WiFi/parking. → _Build 8-10 additional GYM widgets (GYM_OCCUPANCY_RING, GYM_TRAINER_SPOTLIGHT, GYM_CLASS_SIGNUP, GYM_MEMBERSHIP_CARD, GYM_FACILITY_AMENITIES, GYM_LOCKER_INFO, GYM_PARKING_STATUS, GYM_WAITLIST). Register all in variants-register.ts with vertical:'GYM'._
- [P2] (integrations) **Mindbody integration marked as real but has no connector impl, only discovery rule** — apps/api/src/integrations/discovery.service.ts:349-358 defines Mindbody rule with connectHref:null (COMING_SOON). Gym operators expect to sync class schedules from Mindbody (their industry standard). No POS or streaming connector exists; the discovery signal is signal-only. → _Either: (1) build Mindbody OAuth connector with class schedule + instructor sync (high effort, real revenue); or (2) mark connectHref:null and set blurb to 'Coming soon: class schedule sync from Mindbody'._

**Competitive gaps:**
- OptiSigns Fitness: 30+ gym-specific templates (occupancy boards, class schedules, leaderboards, trainer spotlights, promo carousels). We ship 2 signage boards (both HTML costumes).
- Yodeck Fitness: Built-in Mindbody class schedule widget (live sync). We have no Mindbody connector.
- ScreenCloud Sports/Gym: Real-time member count + occupancy ring, live class updates, trainer bio carousel, facility hours countdown. We have 0 occupancy widgets.
- Rise Vision K12/Fitness: Pre-built digital signage for school gyms (PE class announcements, athletic event boards, coach spotlights). We have no school-gym hybrid templates.
- ClubOS (gym-native): Full class booking, trainer scheduling, member check-in kiosks with photo upload. We have no kiosk integration.
- Fitmix (fitness studio): Automated class waitlist board, real-time sign-up prompts, 'join this class' QR codes on every screen. We have no waitlist widget.

### RETAIL
Grades — AI:A Templates:A Widgets:A Integrations:B+ SampleData:A

RETAIL vertical ships world-class signage (8 premium templates, 7 editable widgets, on-brand design affinity, AR AI generation). POS integrations are real (Clover/Lightspeed/Shopify DIRECT tier) but lack real-time webhooks + per-location pricing. Zero launch blockers. Major gap: no multi-location operator tools (per-location pricing, auto-86, location-scoped campaigns) — core for franchise/multi-unit RETAIL customers.

**Competitive gaps:**
- Dynamic pricing per location (multi-location franchise pricing) — competitors ship this; we don't have per-location override on POS catalog items
- Auto-86 (sold-out item auto-removal) — Daktronics, OptiSigns handle this; ours requires manual catalog maintenance
- Real-time inventory sync via webhooks — Clover/Square webhooks not wired (hourly + manual cron only)
- Point-of-sale integration dashboard — order frequency, transaction heatmap, sales by display — we have zero analytics for RETAIL
- Store-specific scheduling (e.g. 'Sale A on Mon-Wed, Sale B on Thu-Fri') — we ship per-screen scheduling, not per-location campaign scheduling
- Buy-online-pickup-in-store (BOPIS) integration — Shopify BOPIS, Lightspeed BOPIS — we have no BOPIS flow
- Loyalty program revenue attribution (did the sign drive sign-ups?) — we track nothing
- Employee scheduling / shift-start alerts ("Now serving" board tied to staffing) — not in our feature set

### FASHION
Grades — AI:A Templates:A Widgets:B+ Integrations:A SampleData:B

FASHION is launch-ready with strong AI, templates, and POS coverage. The 10 premium EXTERNAL_HTML signage templates (lookbook, editorial, sale, new-arrivals, event, fitting-room, window, campaign, hours, loyalty) are fully editable with data-field bindings, and the AI system is dialed in with a chic/aspirational VERTICAL_VOICE + minimal-luxury/bold-retail design affinity (poster-promo, hero-fullbleed, quote-spotlight archetypes). Lightspeed + Shopify POS integrations are DIRECT tier and functional. The gap: zero kiosk templates (lookbook-browser, style-finder, loyalty-signup are missing), no dedicated sample branding URLs in onboarding, and Clover (a major fashion POS) is mislabeled as non-FASHION. P2 fixes required before a boutique customer has a seamless first-day experience.

**Launch blockers:**
- [P2] (templates) **FASHION vertical missing dedicated kiosk templates** — apps/api/src/templates/system-presets.ts: 19 kiosk presets total, 0 tagged FASHION. kiosk directory lists: bar, bar-jukebox, clinic, food, food-nutrition, gym, gym-workout, museum, museum-quest, office, office-room-panel, qsr, qsr-pickup, real-estate*, school*, vet. FASHION is absent. → _Create 3-5 FASHION-specific kiosk templates (lookbook-browser, style-finder, loyalty-signup, store-directory, size-guide) and register as preset-kiosk-fashion-* in system-presets.ts with category:'LOOKBOOK' or 'PROMO'._
- [P2] (sample-data) **FASHION has no dedicated sample/branding URLs** — packages/api-types/src/verticals.ts line 56 FASHION: {} shows singular:'Boutique', plural:'Boutiques', tagline:'Fashion boutiques, apparel, runway', but no branding-sample URLs, no onboarding copy, no 'Add a Boutique' CTA variants. Other verticals (K12, GYM, SPORTS) have per-vertical sample branding in discovery.service. → _Seed branding-sample URLs (3-4 real fashion brand lookbooks for scraping) + add FASHION-specific onboarding copy ('Create a Fashion Boutique', 'Add a Location', 'New Collection Board') in the discovery service._
- [P1] (integrations) **FASHION POS integrations mislabeled or missing** — packages/api-types/src/pos.ts: Lightspeed X-Series + Shopify listed as bestFor:['RETAIL','FASHION'] (good), but FASHION is NOT in Clover's bestFor (only ['QSR','RETAIL','BAR']). Clover is a major fashion POS provider (Square Register, Toast, Shopify all support apparel chains). Missing Vend (inventory-heavy), Toast Retail, Square Appointments (fitting room bookings). → _Add 'FASHION' to Clover's bestFor array. Add 2-3 fashion-vertical-only POS connectors (Vend apparel inventory, Toast Retail appointments, or Shopify advanced) marked COMING_SOON or PARTNER tier if not yet built._

**Competitive gaps:**
- Lookbook builder with drag-to-reorder, fabric/material tags, size-chart links, and outfit suggestions (OptiSigns/ScreenCloud ship robust product-carousel + tagging)
- Fitting room occupancy / availability sync (live 'Room 1 Ready' / 'Room 2 In Use') — real-time POS + IoT integration (Yodeck offers this for retail chains)
- Size/fit recommendation engine ('Show S-M recommendations', 'View XXL availability') — drives product discovery and reduces returns (Rise Vision integrates inventory depth)
- Virtual try-on via camera feed integration (AR overlay of garments) — not shipped by direct competitors but increasingly table-stakes for e-comm tie-ins
- Seasonal markdown countdown / price-drop alerts on signage (auto-pull from POS tier + markdown schedule) — OptiSigns + ScreenCloud both ship this for quick-markdown retail

### HEALTHCARE
Grades — AI:A Templates:A Widgets:B+ Integrations:D SampleData:B

HEALTHCARE vertical is ARCHITECTURALLY SOUND but OPERATIONALLY INCOMPLETE. AI generation is world-class (calm-clinic theme, affinity archetypes, reassuring voice). 10 premium signage templates exist as HTML presets. BUT: zero healthcare-specific integrations (no Epic, Cerner, wait-time feeds), templates are un-editable external HTML (not Properties Panel), no healthcare widgets (wait-time, directory, queue displays), and onboarding copy doesn't mention clinics. A real clinic operator opening VenueOS on day one would see "School / Restaurant / Store" and find templates they can't customize. Fix P1 integrations + template editability + 3 healthcare widgets + onboarding copy, then HEALTHCARE is launch-ready for tier-1 prospects (single clinic + multi-location chains).

**Launch blockers:**
- [P1] (integrations) **Zero healthcare-specific integrations (Epic, Cerner, wait-time systems)** — apps/api/src/integrations/discovery.service.ts: 23 provider rules defined (square, toast, clover, lightspeed, shopify, opentable, resy, youtube, twitch, etc.), NONE for Epic/Cerner/Medidata/athenahealth/wait-time displays. Healthcare vertical has no single patient-record, scheduling, or EHR integration. → _Add provider rules for top-3 healthcare POS/patient systems (Epic OAuth pattern; Cerner FHIR; athenahealth API). Tier as COMING_SOON if not ready; do NOT list as DIRECT. For wait-time displays, build a simple webhook + data-fetch pattern so 3rd-party hospital systems can POST queue/now-serving events._
- [P1] (templates) **Signage templates are EXTERNAL_HTML presets, not editable via Properties panel** — apps/api/src/templates/system-presets.ts: all 10 healthcare templates (01-waiting-room-flagship through 10-thanks-leave) use widgetType:'EXTERNAL_HTML' with hardcoded url:'/templates/signage/healthcare/NN.html'. No single zone is editable in-builder; operator cannot change headline text, colors, or content without exporting/reimporting HTML. → _Port 2-3 flagship templates (waiting-room, physician-directory, now-serving) to React widgets with PROPERTIES PANEL editability so operators can customize text + colors in-editor, not outside the UI. Keep EXTERNAL_HTML as a fallback for legacy/lightweight boards._
- [P2] (sample-data) **Onboarding copy + branding samples use generic school/restaurant language, not healthcare** — apps/api/src/templates/ensure-system-presets.ts maps 'clinic'/'healthcare'/'veterinary' to HEALTHCARE vertical, but has no dedicated onboarding flow copy or sample asset URLs (branding scraper samples). Signup wizard shows 'Add a School / Restaurant / Store' CTA, never 'Add a Clinic' or 'Add a Hospital'. → _Update onboarding copy for HEALTHCARE: 'Add a Clinic / Hospital / Practice'. Add sample brand URLs (large US hospital, urgent-care chain) to branding scraper for per-vertical sample imagery. Wire onboarding wizard's 'What's your business?' step to show HEALTHCARE-specific options._
- [P2] (widgets) **No healthcare-specific widgets (wait-time display, patient directory, queue now-serving)** — apps/web/src/components/widgets/variants-register.ts: 500+ widget variants registered, exactly ZERO tagged for HEALTHCARE category. No WaitTimeDisplay, PatientDirectoryCard, NowServingBoard, AppointmentReminder, ClinicHoursBoard, PharmacyPickupStatus widgets. → _Build 3 healthcare widget primitives: (1) WaitTimeDisplay (editable: patient names/EST wait mins, color-coded status); (2) PhysicianDirectory (card grid, name/specialty/room); (3) NowServingBoard (large ticket number + name + room). These unblock real clinic deployments. Defer advanced (HL7 integration, EHR sync) to Phase 2._

**Competitive gaps:**
- OptiSigns + Yodeck: pre-built connectors for Epic (patient check-in), athenahealth (schedule display), hospital queue systems. We have none.
- ScreenCloud: 'Patient Education' board type with rotating health tips + clinical guidelines from vendor libraries. We ship empty templates.
- Rise Vision: appointment reminder + no-show alerts, patient feedback capture (HCAHPS survey prompts). We have no two-way engagement.
- All competitors: wait-time / now-serving real-time feeds from hospital IP+port or API endpoint. We require manual text entry or webhook (unscalable for 50-clinic chain).
- Competitive baseline: 2-3 pre-built templates PER USE CASE (waiting room, pharmacy, directory, education, hours). We ship 10 generic external-HTML boards, not modular operator-editable widgets.

### HOSPITALITY
Grades — AI:A Templates:A Widgets:A Integrations:D SampleData:A

HOSPITALITY ships production-ready for AI generation, templates, widgets, and onboarding — the vertical has 10 premium signage templates, 5 fully-editable hospitality-specific widgets, correct design affinity (luxury + warm themes), and per-vertical voice guidance. However, integrations are a complete costume: all templates assume PMS/Opera/Mews data feeds and real-time event calendars that don't exist in the codebase. A hotel operator with no manual data entry will see blank amenity boards. The vertical is launch-ready for use-case 1 (static, operator-entered content) but P1 blocking for use-case 2 (data-driven boards that differentiate vs. Yodeck). Recommend shipping static-only mode now (hide data-feed placeholders) and PMS integration as a post-launch deliverable.

**Launch blockers:**
- [P1] (integrations) **Zero PMS/Opera/Mews integrations shipped; templates reference unavailable data feeds** — apps/web/public/templates/signage/hospitality/01-lobby-welcome-flagship.html lines 8-9: 'FEEDS: PMS (Opera/Mews) for occupancy + arrivals' — no connector exists in apps/api/src/integrations; variants-register.ts describes hospitality as data-driven but no actual sync service implemented → _Build PMS bridge (Opera/Mews OAuth + guest/occupancy feed polling), tie to DAILY_EVENTS_BOARD + HOTEL_WELCOME widgets via configurable data-binding, gate behind DIRECT tier with honest status_

**Competitive gaps:**
- Opera Cloud + Mews API integrations (both tier-1 hotel PMS systems that the templates assume) — we describe the need but ship no connectors
- Local amenity discovery + integration (Yelp/Google Places for LocalAttractionsWidget) — competitors auto-populate nearby dining/activities; we require manual entry
- Real-time event calendar sync from property management systems
- Guest preference + loyalty sync (guest is greeted by name + stored preferences auto-populate)
- Emergency room status / wait-time feeds for check-in boards
- Dining reservation system integration (OpenTable/Resy shown in templates but not implemented)
- Weather feed integration (referenced in templates but no active weather binding)

### CORPORATE
Grades — AI:A Templates:C Widgets:F Integrations:D SampleData:B

CORPORATE vertical is non-functional for core use cases. AI generation works (A grade) and templates exist (10 presets), but they are static HTML costumes that cannot be edited or broken into components. No CORPORATE-specific widget set exists — operators see a placeholder. On day-one handoff, an office operator would say: 'I can see a lobby design, but I cannot edit a single piece of it, choose a different style for my text, or generate my own boards.' The vertical ships as a visual mockup, not a working product. Requires immediate template decomposition + widget build to be launch-ready.

**Launch blockers:**
- [P1] (widgets) **CORPORATE widgets render as placeholder-only 'Pick a style' costume** — apps/web/src/components/widgets/WidgetRenderer.tsx:666 matches CORPORATE to the unrendered placeholder case alongside HEALTHCARE/WORSHIP/HOSPITALITY → _Register real CORPORATE-specific widget components (at minimum TEXT, ANNOUNCEMENT, CLOCK, CALENDAR variants) in variants-register.ts with vertical:'CORPORATE' + render implementations. Audit code comment at line 1431 confirms deliberate skip pending widget builds._
- [P1] (templates) **All 10 CORPORATE presets are static EXTERNAL_HTML (not editable composable templates)** — apps/api/src/templates/system-presets.ts lines containing 'CORPORATE' show every template as widgetType:'EXTERNAL_HTML' — a single full-canvas iframe that reads /templates/signage/corporate/*.html files. No editable TEXT/ANNOUNCEMENT/CLOCK/CALENDAR zones. → _Rebuild CORPORATE templates as composable React-based presets (split HTML monoliths into multi-zone templates with CLOCK, TEXT, ANNOUNCEMENT widgets). At minimum convert 3-4 flagship presets (Lobby, Conference, KPI Dashboard) to editable archetype-based designs that respond to branding + AI generation._
- [P2] (templates) **CORPORATE design affinity exists but is never tested end-to-end** — packages/api-types/src/verticals.ts:649 defines CORPORATE_DESIGN_AFFINITY:['split-50','stat-spotlight','title-cta'] + themes:['clean-corporate','minimal-luxury'], and ai.service.ts:1778 injects it as soft hint + fallback. But no CORPORATE operator can test it because AI generates to static HTML templates, not editable zones. → _Convert presets to composable format first (blocker above), then test AI generations against real CORPORATE templates to verify archetype/theme deterministic fallback works._

**Competitive gaps:**
- Dynamic corporate KPI board with live data feeds (Yodeck/ScreenCloud ship pre-built connectors for Salesforce, Google Sheets, Slack — VenueOS ships none)
- Lobby wayfinding + floor-plan integration (OptiSigns allows operators to drag meeting rooms onto a canvas + link to calendar; VenueOS floor-plan is a static asset, not interactive)
- Internal comms broadcast (multi-screen command + emergency styling per room type — VenueOS emergency is one global overlay, not room-specific)
- Visitor check-in kiosk template (Rise Vision + Yodeck ship pre-built, editable templates; VenueOS requires code to wire EXTERNAL_HTML)
- Stock ticker / news integration (ScreenCloud/OptiSigns integrate AP/Reuters feeds; VenueOS relies on manual POS/webhook feeds only)
- Multi-language locale switching (corporate multi-region deployments — not a VenueOS feature)

### WORSHIP
Grades — AI:A Templates:B+ Widgets:B Integrations:C SampleData:D

WORSHIP vertical is half-shipped. AI template generation is world-class (A-grade affinity + voice + archetypes), taxonomy is complete (labels, group nouns, emergency types, template categories, sample prompts all present), and 8 beautiful HTML signage presets exist in /public/templates/signage/church/. But the presets are static EXTERNAL_HTML shells, not editable zone templates — a pastor cannot change sermon titles or giving goal amounts without forking HTML. Zero WORSHIP-specific widgets exist in the builder palette. Zero giving/donations integrations are registered or discoverable. New church tenants land on a blank canvas with zero sample data, no music stream pre-seeded, no events, unlike every other vertical which gets industry-specific demo data at signup. This is a P1 launch blocker for the ministry market: the product is not customer-ready as-is.

**Launch blockers:**
- [P1] (templates) **8 HTML church presets are NOT editable — static-only EXTERNAL_HTML shells** — apps/api/src/templates/system-presets.ts:5 — all 8 worship presets (preset-sig-church-01 through -05, plus light variants) route through EXTERNAL_HTML widget, which loads hardcoded /templates/signage/church/*.html files. The HTML templates are beautifully designed but ship with no PropertiesPanel support — an operator cannot change text, colors, fonts, dates, or any content inline. They must fork/duplicate the template and manually edit the HTML source. → _Port the 8 HTML templates into the React zone system (apps/api/src/templates/worship-presets.ts already models this correctly with 8 full-featured presets using TEXT/ANNOUNCEMENT/COUNTDOWN/CALENDAR/BELL_SCHEDULE/IMAGE zones). Replace every EXTERNAL_HTML with the React preset equivalents. The component work is done; just wire the ~40 zones into system-presets.ts._
- [P1] (sample-data) **WORSHIP is not in STREAM_VERTICALS or MENU_VERTICALS — new tenants get zero seed data** — apps/api/src/sample-data/sample-data.service.ts:27-33 — WORSHIP is absent from both MENU_VERTICALS (QSR/RESTAURANT/BAR) and STREAM_VERTICALS (GYM/K12/SPORTS/etc). A new church tenant lands on an empty Integration Concierge (no sample POS or streaming connections), no sample events in the CALENDAR widget, and a blank slate that competitors pre-populate with demo data so the operator can immediately see what's possible. → _Add WORSHIP to STREAM_VERTICALS so new WORSHIP tenants auto-seed a public broadcaster (NPR local station by lat/lng is sensible for neutral background music in a sanctuary). Optionally, consider a WORSHIP-specific sample event seed (e.g. 'Easter sunrise service', 'Midweek bible study') that populates the CALENDAR widgets in the presets._
- [P1] (integrations) **No WORSHIP-specific integration for giving/donations — no Tithe.ly, Pushpay, etc.** — apps/api/src/integrations/discovery.service.ts:34-48 defines IntegrationCategory (pos, reservations, payments, streaming, music, calendar, email, identity, sis, social, fitness, sports-data, design, analytics). No 'giving' or 'donations' category. The Concierge discovery service has no rules for church-specific integrations like Tithe.ly (tithe.ly), Pushpay (pushpay.com), Giving|Trac (givingtrac.com), or ChurchCommunityBuilder. → _Add 'giving' to IntegrationCategory. Create ProviderRules for the top 3 church giving platforms (Tithe.ly, Pushpay, Giving|Trac) so the Concierge can auto-discover them on a church's website. Even if the full connector sync is not built yet, flag them as real integration candidates (tier: 'COMING_SOON' or 'DIRECT') so operators know the capability is planned._
- [P2] (widgets) **No WORSHIP-category variants registered — prayer-request widget, giving thermometer, sermon-series carousel missing** — apps/web/src/components/widgets/variants-register.ts:1 comment states 'WORSHIP have NO dedicated renderable+editable widget components'. The codebase has 500+ themed widget variants (K12, BAR, GYM, RETAIL, etc.) but zero WORSHIP-specific variants. A church operator opening the widget palette sees ZERO branded options. → _Register 3-5 WORSHIP widget variants (Prayer Request, Giving Thermometer, Sermon Series Carousel, Service Times List, Ministry Directory). Use the existing TEXT/ANNOUNCEMENT/COUNTDOWN/CALENDAR primitives as templates, reskin with sanctuary palette (worship-warm theme from verticals.ts:657), and post them with category: 'WORSHIP' so they surface in the builder for WORSHIP tenants._

**Competitive gaps:**
- Tithe.ly, Pushpay, Giving|Trac real-time giving integrations with dashboard sync (we have zero giving connectors)
- Prayer request + intercessory prayer widget suite (live prayer wall, answered prayers carousel)
- Sermon-series management with auto-sync from Sermon.cloud, Bible.com, or Vimeo livestream links
- Multi-campus service schedule with volunteer scheduling + parking lot info
- Giving campaign thermometer with dynamic goal updates + donor-wall rotating grid
- Live worship lyrics/hymn overlay tied to Propresenter, EasyWorship, ChordPro feeds (we have none)
- Member directory with groups/roles (requires SIS-like vertical permission model we don't have)