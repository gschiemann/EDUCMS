// AUTO-GENERATED catalog of the self-contained signage / HS templates.
// Regenerate by re-running the extraction in scripts after adding
// templates. Backs the "Industry Signage Template" widget picker tile
// and its template dropdown in the builder Properties panel.

import { QUARANTINED_BOARD_URLS } from '@cms/api-types';

export interface SignageTemplate {
  /** matches the system-presets.ts preset id */
  id: string;
  /** display name, emoji stripped */
  name: string;
  /** industry / level group, for the dropdown optgroups */
  group: string;
  /** /public path served same-origin */
  url: string;
}

export const SIGNAGE_TEMPLATES: SignageTemplate[] = [
  { id: "preset-school-hs-campus-pulse-01", name: "Campus Pulse · Campus Magazine", group: "High School · Campus Pulse", url: "/templates/school/campus-pulse/01-campus-magazine.html" },
  { id: "preset-school-hs-campus-pulse-02", name: "Campus Pulse · Digital Signal", group: "High School · Campus Pulse", url: "/templates/school/campus-pulse/02-digital-signal.html" },
  { id: "preset-school-hs-campus-pulse-03", name: "Campus Pulse · Neo Yearbook", group: "High School · Campus Pulse", url: "/templates/school/campus-pulse/03-neo-yearbook.html" },
  { id: "preset-school-hs-campus-pulse-04", name: "Campus Pulse · Varsity Broadcast", group: "High School · Campus Pulse", url: "/templates/school/campus-pulse/04-varsity-broadcast.html" },
  { id: "preset-school-hs-campus-pulse-05", name: "Campus Pulse · Metro Wayfinding", group: "High School · Campus Pulse", url: "/templates/school/campus-pulse/05-metro-wayfinding.html" },
  { id: "preset-school-hs-campus-pulse-06", name: "Campus Pulse · Aurora Fold", group: "High School · Campus Pulse", url: "/templates/school/campus-pulse/06-aurora-fold.html" },
  { id: "preset-school-hs-campus-pulse-01-portrait", name: "Campus Pulse · Campus Magazine — Portrait", group: "High School · Campus Pulse", url: "/templates/school/campus-pulse/01-campus-magazine.html?o=portrait" },
  { id: "preset-school-hs-campus-pulse-02-portrait", name: "Campus Pulse · Digital Signal — Portrait", group: "High School · Campus Pulse", url: "/templates/school/campus-pulse/02-digital-signal.html?o=portrait" },
  { id: "preset-school-hs-campus-pulse-03-portrait", name: "Campus Pulse · Neo Yearbook — Portrait", group: "High School · Campus Pulse", url: "/templates/school/campus-pulse/03-neo-yearbook.html?o=portrait" },
  { id: "preset-school-hs-campus-pulse-04-portrait", name: "Campus Pulse · Varsity Broadcast — Portrait", group: "High School · Campus Pulse", url: "/templates/school/campus-pulse/04-varsity-broadcast.html?o=portrait" },
  { id: "preset-school-hs-campus-pulse-05-portrait", name: "Campus Pulse · Metro Wayfinding — Portrait", group: "High School · Campus Pulse", url: "/templates/school/campus-pulse/05-metro-wayfinding.html?o=portrait" },
  { id: "preset-school-hs-campus-pulse-06-portrait", name: "Campus Pulse · Aurora Fold — Portrait", group: "High School · Campus Pulse", url: "/templates/school/campus-pulse/06-aurora-fold.html?o=portrait" },
  { id: "preset-hs-ath-gameday", name: "Athletics — Game Day Hub", group: "High School", url: "/templates/hs/ath-gameday.html" },
  { id: "preset-hs-ath-standings", name: "Athletics — Standings & AOTW", group: "High School", url: "/templates/hs/ath-standings.html" },
  { id: "preset-hs-ath-broadcast", name: "Athletics — Broadcast Desk", group: "High School", url: "/templates/hs/ath-broadcast.html" },
  { id: "preset-hs-caf-today", name: "Cafeteria — Today + Tomorrow", group: "High School", url: "/templates/hs/caf-today.html" },
  { id: "preset-hs-caf-counter", name: "Cafeteria — Counter Plate", group: "High School", url: "/templates/hs/caf-counter.html" },
  { id: "preset-hs-caf-market", name: "Cafeteria — Food-Hall Market", group: "High School", url: "/templates/hs/caf-market.html" },
  { id: "preset-hs-class-nownext", name: "Classroom — Now / Next Agenda", group: "High School", url: "/templates/hs/class-nownext.html" },
  { id: "preset-hs-class-subday", name: "Classroom — Substitute Self-Running Plan", group: "High School", url: "/templates/hs/class-subday.html" },
  { id: "preset-hs-hall-bulletin", name: "Bulletin Board · Hallway", group: "High School", url: "/templates/hs/hall-bulletin.html" },
  { id: "preset-hs-hall-wayfinder", name: "Wayfinder — Colorline", group: "High School", url: "/templates/hs/hall-wayfinder.html" },
  { id: "preset-hs-wayfinder-signal-stack", name: "Wayfinder — Signal Stack", group: "High School", url: "/templates/hs/hall-wayfinder-signal-stack.html" },
  { id: "preset-hs-ath-biggame", name: "Athletics — Big Game", group: "High School", url: "/templates/hs/ath-biggame.html" },
  { id: "preset-hs-caf-week", name: "Cafeteria — This Week", group: "High School", url: "/templates/hs/caf-week.html" },
  { id: "preset-hs-varsity", name: "Varsity — Athletic Department", group: "High School", url: "/templates/hs/varsity.html" },
  { id: "preset-hs-broadcast", name: "Broadcast — Campus News Desk", group: "High School", url: "/templates/hs/broadcast.html" },
  { id: "preset-hs-yearbook", name: "Yearbook — Editorial Magazine", group: "High School", url: "/templates/hs/yearbook.html" },
  { id: "preset-hs-terminal", name: "Terminal — CRT / Phosphor", group: "High School", url: "/templates/hs/terminal.html" },
  { id: "preset-hs-transit", name: "Wayfinder — Campus Grid", group: "High School", url: "/templates/hs/hall-wayfinder-campus-grid.html" },
  { id: "preset-hs-gallery", name: "Gallery — Museum Wall Labels", group: "High School", url: "/templates/hs/gallery.html" },
  { id: "preset-hs-blueprint", name: "Blueprint — Technical Drawing", group: "High School", url: "/templates/hs/blueprint.html" },
  { id: "preset-hs-zine", name: "Zine — Cut & Paste Student Rag", group: "High School", url: "/templates/hs/zine.html" },
  // React→EXTERNAL_HTML conversions (2026-06-08 designer batch) — universal school
  // boards rebuilt as flagship single-file HTML (live schedule engine + photo slots).
  { id: "preset-bell-schedule", name: "Bell Schedule — Pulse Rail", group: "School", url: "/templates/hs/bell-schedule.html" },
  { id: "preset-morning-news", name: "Morning News — Headline Split", group: "School", url: "/templates/hs/morning-news.html" },
  { id: "preset-hs-news-rundown-desk", name: "Morning News — Rundown Desk", group: "School", url: "/templates/hs/morning-news-rundown-desk.html" },
  { id: "preset-hs-news-daily-cut", name: "Morning News — Daily Cut", group: "School", url: "/templates/hs/morning-news-daily-cut.html" },
  { id: "preset-achievement-showcase", name: "Achievement Showcase — Honor Cover", group: "School", url: "/templates/hs/achievement.html" },
  { id: "preset-sig-bar-01", name: "Bar · Tap List", group: "Bar", url: "/templates/signage/bar/01-tap-list-flagship.html" },
  { id: "preset-sig-bar-02", name: "Bar · Cocktails", group: "Bar", url: "/templates/signage/bar/02-cocktail-menu.html" },
  { id: "preset-sig-bar-03", name: "Bar · Bottle List", group: "Bar", url: "/templates/signage/bar/03-bottle-list.html" },
  { id: "preset-sig-bar-04", name: "Bar · Happy Hour", group: "Bar", url: "/templates/signage/bar/04-happy-hour.html" },
  { id: "preset-sig-bar-05", name: "Bar · Now Pouring", group: "Bar", url: "/templates/signage/bar/05-now-pouring.html" },
  { id: "preset-sig-bar-06", name: "Bar · Tonight", group: "Bar", url: "/templates/signage/bar/06-tonight-live.html" },
  { id: "preset-sig-bar-07", name: "Bar · Bottle Service", group: "Bar", url: "/templates/signage/bar/07-bottle-service.html" },
  { id: "preset-sig-bar-08", name: "Bar · Game Day", group: "Bar", url: "/templates/signage/bar/08-game-day.html" },
  { id: "preset-sig-bar-09", name: "Bar · Hours", group: "Bar", url: "/templates/signage/bar/09-hours-location.html" },
  { id: "preset-sig-bar-10", name: "Bar · Hiring", group: "Bar", url: "/templates/signage/bar/10-now-hiring.html" },
  { id: "preset-sig-corporate-01", name: "Corporate · Lobby", group: "Corporate", url: "/templates/signage/corporate/01-lobby-welcome-flagship.html" },
  { id: "preset-sig-corporate-02", name: "Corporate · Conference", group: "Corporate", url: "/templates/signage/corporate/02-conference-room.html" },
  { id: "preset-sig-corporate-03", name: "Corporate · KPI Dashboard", group: "Corporate", url: "/templates/signage/corporate/03-kpi-dashboard.html" },
  { id: "preset-sig-corporate-04", name: "Corporate · New Hires", group: "Corporate", url: "/templates/signage/corporate/04-new-hires.html" },
  { id: "preset-sig-corporate-05", name: "Corporate · Floor Directory", group: "Corporate", url: "/templates/signage/corporate/05-floor-directory.html" },
  { id: "preset-sig-corporate-06", name: "Corporate · All Hands", group: "Corporate", url: "/templates/signage/corporate/06-all-hands.html" },
  { id: "preset-sig-corporate-07", name: "Corporate · Cafeteria", group: "Corporate", url: "/templates/signage/corporate/07-cafeteria.html" },
  { id: "preset-sig-corporate-08", name: "Corporate · Shuttle", group: "Corporate", url: "/templates/signage/corporate/08-shuttle-board.html" },
  { id: "preset-sig-corporate-09", name: "Corporate · Events", group: "Corporate", url: "/templates/signage/corporate/09-events-week.html" },
  { id: "preset-sig-corporate-10", name: "Corporate · Emergency", group: "Corporate", url: "/templates/signage/corporate/10-emergency-info.html" },
  { id: "preset-sig-corporate-11", name: "Corporate · Signal", group: "Corporate", url: "/templates/signage/corporate/11-corporate-signal.html" },
  { id: "preset-sig-fashion-01", name: "Fashion · Lookbook", group: "Fashion", url: "/templates/signage/fashion/01-lookbook-flagship.html" },
  { id: "preset-sig-fashion-02", name: "Fashion · Editorial", group: "Fashion", url: "/templates/signage/fashion/02-editorial.html" },
  { id: "preset-sig-fashion-03", name: "Fashion · Sale", group: "Fashion", url: "/templates/signage/fashion/03-sale.html" },
  { id: "preset-sig-fashion-04", name: "Fashion · New Arrivals", group: "Fashion", url: "/templates/signage/fashion/04-new-arrivals.html" },
  { id: "preset-sig-fashion-05", name: "Fashion · Event", group: "Fashion", url: "/templates/signage/fashion/05-event-trunkshow.html" },
  { id: "preset-sig-fashion-06", name: "Fashion · Fitting", group: "Fashion", url: "/templates/signage/fashion/06-fitting-room.html" },
  { id: "preset-sig-fashion-07", name: "Fashion · Window", group: "Fashion", url: "/templates/signage/fashion/07-shoppable-window.html" },
  { id: "preset-sig-fashion-08", name: "Fashion · Campaign", group: "Fashion", url: "/templates/signage/fashion/08-campaign.html" },
  { id: "preset-sig-fashion-09", name: "Fashion · Hours", group: "Fashion", url: "/templates/signage/fashion/09-hours-story.html" },
  { id: "preset-sig-fashion-10", name: "Fashion · Members", group: "Fashion", url: "/templates/signage/fashion/10-loyalty-member.html" },
  { id: "preset-sig-healthcare-01", name: "Healthcare · Waiting Room", group: "Healthcare", url: "/templates/signage/healthcare/01-waiting-room-flagship.html" },
  { id: "preset-sig-healthcare-02", name: "Healthcare · Physicians", group: "Healthcare", url: "/templates/signage/healthcare/02-physician-directory.html" },
  { id: "preset-sig-healthcare-03", name: "Healthcare · Now Serving", group: "Healthcare", url: "/templates/signage/healthcare/03-now-serving.html" },
  { id: "preset-sig-healthcare-04", name: "Healthcare · Vaccines", group: "Healthcare", url: "/templates/signage/healthcare/04-vaccine-clinic.html" },
  { id: "preset-sig-healthcare-05", name: "Healthcare · Hours", group: "Healthcare", url: "/templates/signage/healthcare/05-hours-closures.html" },
  { id: "preset-sig-healthcare-06", name: "Healthcare · Patient Education", group: "Healthcare", url: "/templates/signage/healthcare/06-patient-education.html" },
  { id: "preset-sig-healthcare-07", name: "Healthcare · MyChart", group: "Healthcare", url: "/templates/signage/healthcare/07-mychart-signup.html" },
  { id: "preset-sig-healthcare-08", name: "Healthcare · Pharmacy", group: "Healthcare", url: "/templates/signage/healthcare/08-pharmacy-pickup.html" },
  { id: "preset-sig-healthcare-09", name: "Healthcare · Clinical Trial", group: "Healthcare", url: "/templates/signage/healthcare/09-clinical-trial.html" },
  { id: "preset-sig-healthcare-10", name: "Healthcare · Thanks", group: "Healthcare", url: "/templates/signage/healthcare/10-thanks-leave.html" },
  { id: "preset-sig-hospitality-01", name: "Hospitality · Lobby · Welcome", group: "Hospitality", url: "/templates/signage/hospitality/01-lobby-welcome-flagship.html" },
  { id: "preset-sig-hospitality-02", name: "Hospitality · Concierge · Tonight in town", group: "Hospitality", url: "/templates/signage/hospitality/02-concierge-board.html" },
  { id: "preset-sig-hospitality-03", name: "Hospitality · Today's Events", group: "Hospitality", url: "/templates/signage/hospitality/03-events-board.html" },
  { id: "preset-sig-hospitality-04", name: "Hospitality · Pool · Spa · Today", group: "Hospitality", url: "/templates/signage/hospitality/04-pool-spa-day.html" },
  { id: "preset-sig-hospitality-05", name: "Hospitality · Dining Tonight", group: "Hospitality", url: "/templates/signage/hospitality/05-dining-tonight.html" },
  { id: "preset-sig-hospitality-06", name: "Hospitality · Wayfinder", group: "Hospitality", url: "/templates/signage/hospitality/06-wayfinder.html" },
  { id: "preset-sig-hospitality-07", name: "Hospitality · Group Welcome", group: "Hospitality", url: "/templates/signage/hospitality/07-group-welcome.html" },
  { id: "preset-sig-hospitality-08", name: "Hospitality · Check-in", group: "Hospitality", url: "/templates/signage/hospitality/08-checkin-status.html" },
  { id: "preset-sig-hospitality-09", name: "Hospitality · Outlook", group: "Hospitality", url: "/templates/signage/hospitality/09-outlook.html" },
  { id: "preset-sig-hospitality-10", name: "Hospitality · Brand Story", group: "Hospitality", url: "/templates/signage/hospitality/10-brand-story.html" },
  { id: "preset-sig-menus-pos-01", name: "Menu · Menu", group: "Menus & POS", url: "/templates/signage/menus-pos/01-fullservice-menu.html" },
  { id: "preset-sig-menus-pos-02", name: "Menu · Wine List", group: "Menus & POS", url: "/templates/signage/menus-pos/02-wine-list.html" },
  { id: "preset-sig-menus-pos-03", name: "Menu · Daily Specials", group: "Menus & POS", url: "/templates/signage/menus-pos/03-daily-special.html" },
  { id: "preset-sig-menus-pos-04", name: "Menu · Cocktails", group: "Menus & POS", url: "/templates/signage/menus-pos/04-cocktail-program.html" },
  { id: "preset-sig-menus-pos-05", name: "Menu · POS 86 Board", group: "Menus & POS", url: "/templates/signage/menus-pos/05-86-board.html" },
  { id: "preset-sig-menus-pos-06", name: "Menu · Brunch Menu", group: "Menus & POS", url: "/templates/signage/menus-pos/06-brunch.html" },
  { id: "preset-sig-menus-pos-07", name: "Menu · Prix Fixe", group: "Menus & POS", url: "/templates/signage/menus-pos/07-prix-fixe.html" },
  { id: "preset-sig-menus-pos-08", name: "Menu · Tasting Progress", group: "Menus & POS", url: "/templates/signage/menus-pos/08-tasting-progress.html" },
  { id: "preset-sig-menus-pos-09", name: "Menu · Reservations", group: "Menus & POS", url: "/templates/signage/menus-pos/09-reservations.html" },
  { id: "preset-sig-menus-pos-10", name: "Menu · Takeaway", group: "Menus & POS", url: "/templates/signage/menus-pos/10-takeaway-pickup.html" },
  { id: "preset-sig-qsr-01", name: "QSR · Drive-Thru · Menu Board", group: "QSR", url: "/templates/signage/qsr/01-drive-thru-flagship.html" },
  { id: "preset-sig-qsr-24-super-taco", name: "Super Taco · Flagship Mexican Menu", group: "QSR", url: "/templates/signage/qsr/24-super-taco-flagship.html" },
  { id: "preset-sig-qsr-24-super-taco-portrait", name: "Super Taco · Flagship Mexican Menu · Portrait", group: "QSR", url: "/templates/signage/qsr/24-super-taco-flagship.html?orientation=portrait" },
  { id: "preset-sig-qsr-25-super-taco-tacos", name: "Super Taco · Menu Wall 1 · Tacos", group: "QSR", url: "/templates/signage/qsr/25-super-taco-tacos.html" },
  { id: "preset-sig-qsr-26-super-taco-burritos", name: "Super Taco · Menu Wall 2 · Burritos & More", group: "QSR", url: "/templates/signage/qsr/26-super-taco-burritos.html" },
  { id: "preset-sig-qsr-27-super-taco-combos", name: "Super Taco · Menu Wall 3 · Combo Spotlight", group: "QSR", url: "/templates/signage/qsr/27-super-taco-combos.html" },
  { id: "preset-sig-qsr-02", name: "QSR · Counter Menu", group: "QSR", url: "/templates/signage/qsr/02-counter-menu.html" },
  { id: "preset-sig-qsr-03", name: "QSR · Order Ready", group: "QSR", url: "/templates/signage/qsr/03-order-ready.html" },
  { id: "preset-sig-qsr-04", name: "QSR · LTO Promo", group: "QSR", url: "/templates/signage/qsr/04-lto-promo.html" },
  { id: "preset-sig-qsr-05", name: "QSR · Combos & Deals", group: "QSR", url: "/templates/signage/qsr/05-combos-deals.html" },
  { id: "preset-sig-qsr-06", name: "QSR · Beverages", group: "QSR", url: "/templates/signage/qsr/06-beverages.html" },
  { id: "preset-sig-qsr-07", name: "QSR · Mobile Pickup", group: "QSR", url: "/templates/signage/qsr/07-mobile-pickup.html" },
  { id: "preset-sig-qsr-08", name: "QSR · Rewards", group: "QSR", url: "/templates/signage/qsr/08-rewards.html" },
  { id: "preset-sig-qsr-09", name: "QSR · Hours", group: "QSR", url: "/templates/signage/qsr/09-hours-location.html" },
  { id: "preset-sig-qsr-10", name: "QSR · Now Hiring", group: "QSR", url: "/templates/signage/qsr/10-now-hiring.html" },
  // New industry signage (2026-06-08 designer handoff) — veterinary, gym,
  // real-estate, museum, office, clinic. Single-file EXTERNAL_HTML with the
  // V6 click-to-edit shim, Taurus-safe (inset→longhand), landscape + portrait.
  //
  // 2026-06-27 — the 10 `preset-sig-church-*` EXTERNAL_HTML worship boards were
  // REMOVED from this builder dropdown. WORSHIP now ships the fully-editable
  // React-zone pack (worship-presets.ts → WORSHIP gallery), so the un-editable
  // sandboxed-iframe church costumes are retired everywhere an operator could
  // land on them — gallery AND this "switch template" picker — to keep WORSHIP a
  // single editable pack (beta finding P1 #2 + #10). The `/templates/signage/
  // church/*.html` files stay on disk (legacy playlists / existing rows render
  // them) but are no longer offered as a new choice.
  { id: "preset-sig-veterinary-01", name: "Veterinary · Waiting Room", group: "Veterinary", url: "/templates/signage/veterinary/01-waiting-room-flagship.html" },
  { id: "preset-sig-veterinary-02", name: "Veterinary · Adoptable Pets", group: "Veterinary", url: "/templates/signage/veterinary/02-adopt-gallery.html" },
  { id: "preset-sig-gym-01", name: "Gym · Floor Board", group: "Gym", url: "/templates/signage/gym/01-floor-board-flagship.html" },
  { id: "preset-sig-gym-02", name: "Gym · Leaderboard", group: "Gym", url: "/templates/signage/gym/02-leaderboard.html" },
  // New-member welcome boards (2026-07-02 approved gym-welcome batch) — APPROVED
  // by Greg, matches docs/design/approved/2026-07-02-gym-welcome/. DO NOT regress.
  { id: "preset-sig-gym-03", name: "Gym · Welcome Poster", group: "Gym", url: "/templates/signage/gym/03-welcome-poster.html" },
  { id: "preset-sig-gym-04", name: "Gym · Welcome Split-Duo", group: "Gym", url: "/templates/signage/gym/04-welcome-split-duo.html" },
  { id: "preset-sig-gym-05", name: "Gym · Welcome Locker Room", group: "Gym", url: "/templates/signage/gym/05-welcome-locker-room.html" },
  { id: "preset-sig-real-estate-01", name: "Real Estate · Availability", group: "Real Estate", url: "/templates/signage/real-estate/01-availability-flagship.html" },
  { id: "preset-sig-museum-01", name: "Museum · Today", group: "Museum", url: "/templates/signage/museum/01-today-flagship.html" },
  { id: "preset-sig-office-01", name: "Office · Room Grid", group: "Office", url: "/templates/signage/office/01-room-grid-flagship.html" },
  { id: "preset-sig-clinic-01", name: "Clinic · Campaign", group: "Clinic", url: "/templates/signage/clinic/01-campaign-flagship.html" },
  // Modern K-12 school boards (2026-06-07) — EXTERNAL_HTML rebuilds of the
  // legacy skeuomorphic themed widgets. Big type, 60px floor, click-to-edit.
  { id: "preset-school-elem-schedule-1", name: "Elementary · Daily Schedule — Color Blocks", group: "Elementary", url: "/templates/school/elem-schedule-v1.html" },
  { id: "preset-school-elem-schedule-2", name: "Elementary · Daily Schedule — Soft Cards", group: "Elementary", url: "/templates/school/elem-schedule-v2.html" },
  { id: "preset-school-elem-schedule-3", name: "Elementary · Daily Schedule — Editorial Rail", group: "Elementary", url: "/templates/school/elem-schedule-v3.html" },
  { id: "preset-school-elem-lunch-1", name: "Elementary · Today's Lunch — Confetti Pop 2.0", group: "Elementary", url: "/templates/school/elem-lunch-v1.html" },
  { id: "preset-school-elem-lunch-2", name: "Elementary · Today's Lunch — Color Route", group: "Elementary", url: "/templates/school/elem-lunch-v2.html" },
  { id: "preset-school-elem-lunch-3", name: "Elementary · Today's Lunch — Lunch Edition", group: "Elementary", url: "/templates/school/elem-lunch-v3.html" },
  { id: "preset-school-elem-lunch-4", name: "Elementary · Today's Lunch — Service Ticket", group: "Elementary", url: "/templates/school/elem-lunch-v4-service-ticket.html" },
  { id: "preset-school-elem-lunch-5", name: "Elementary · Today's Lunch — Fresh Counter", group: "Elementary", url: "/templates/school/elem-lunch-v5-fresh-counter.html" },
  { id: "preset-school-elem-lunch-6", name: "Elementary · Today's Lunch — Menu Lab", group: "Elementary", url: "/templates/school/elem-lunch-v6-menu-lab.html" },
  { id: "preset-school-elem-lunch-7", name: "Elementary · Today's Lunch — Counter Windows", group: "Elementary", url: "/templates/school/elem-lunch-v7-counter-windows.html" },
  { id: "preset-hs-bell-ledger", name: "Bell Schedule — Bell Ledger", group: "High School", url: "/templates/hs/bell-schedule-ledger.html" },
  { id: "preset-hs-bell-orbit", name: "Bell Schedule — Signal Orbit", group: "High School", url: "/templates/hs/bell-schedule-orbit.html" },
  { id: "preset-hs-achievement-victory-wall", name: "Achievement Showcase — Victory Wall", group: "High School", url: "/templates/hs/achievement-victory-wall.html" },
  { id: "preset-hs-achievement-stage-call", name: "Achievement Showcase — Stage Call", group: "High School", url: "/templates/hs/achievement-stage-call.html" },
  { id: "preset-school-ms-bell-1", name: "Middle School · Bell Schedule — Locker Line", group: "Middle School", url: "/templates/school/ms-bell-locker-line.html" },
  { id: "preset-school-ms-bell-2", name: "Middle School · Bell Schedule — Agenda Flip", group: "Middle School", url: "/templates/school/ms-bell-agenda-flip.html" },
  { id: "preset-school-ms-bell-3", name: "Middle School · Bell Schedule — Rotation Radar", group: "Middle School", url: "/templates/school/ms-bell-rotation-radar.html" },
  { id: "preset-school-ms-news-1", name: "Middle School · Morning News — Locker Channel", group: "Middle School", url: "/templates/school/ms-news-locker-channel.html" },
  { id: "preset-school-ms-news-2", name: "Middle School · Morning News — Studio Switcher", group: "Middle School", url: "/templates/school/ms-news-studio-switcher.html" },
  { id: "preset-school-ms-news-3", name: "Middle School · Morning News — Notebook Cut", group: "Middle School", url: "/templates/school/ms-news-notebook-cut.html" },
  { id: "preset-school-ms-wayfinder-1", name: "Middle School · Wayfinder — Locker Compass", group: "Middle School", url: "/templates/school/ms-wayfinder-locker-compass.html" },
  { id: "preset-school-ms-wayfinder-2", name: "Middle School · Wayfinder — Campus Patchboard", group: "Middle School", url: "/templates/school/ms-wayfinder-patchboard.html" },
  { id: "preset-school-ms-wayfinder-3", name: "Middle School · Wayfinder — Courtline Routes", group: "Middle School", url: "/templates/school/ms-wayfinder-courtline.html" },
  { id: "preset-school-elem-bell-1", name: "Elementary · Daily Schedule — Color Hop", group: "Elementary", url: "/templates/school/elem-bell-color-hop.html" },
  { id: "preset-school-elem-bell-2", name: "Elementary · Daily Schedule — Classroom Daybook", group: "Elementary", url: "/templates/school/elem-bell-daybook.html" },
  { id: "preset-school-elem-bell-3", name: "Elementary · Daily Schedule — Sun Clock", group: "Elementary", url: "/templates/school/elem-bell-sun-clock.html" },
  { id: "preset-school-elem-news-1", name: "Elementary · Morning News — Storybook Broadcast", group: "Elementary", url: "/templates/school/elem-news-storybook.html" },
  { id: "preset-school-elem-news-2", name: "Elementary · Morning News — Classroom TV Cart", group: "Elementary", url: "/templates/school/elem-news-tv-cart.html" },
  { id: "preset-school-elem-news-3", name: "Elementary · Morning News — Morning Mailroom", group: "Elementary", url: "/templates/school/elem-news-mailroom.html" },
  { id: "preset-school-elem-wayfinder-1", name: "Elementary · Wayfinder — Color Trail", group: "Elementary", url: "/templates/school/elem-wayfinder-color-trail.html" },
  { id: "preset-school-elem-wayfinder-2", name: "Elementary · Wayfinder — Schoolhouse Neighborhood", group: "Elementary", url: "/templates/school/elem-wayfinder-neighborhood.html" },
  { id: "preset-school-elem-wayfinder-3", name: "Elementary · Wayfinder — Mascot Signpost", group: "Elementary", url: "/templates/school/elem-wayfinder-mascot-signpost.html" },
  { id: "preset-school-ms-lobby-1", name: "Middle School · Lobby Welcome — Bold", group: "Middle School", url: "/templates/school/ms-lobby-v1.html" },
  { id: "preset-school-ms-lobby-2", name: "Middle School · Lobby Welcome — Light", group: "Middle School", url: "/templates/school/ms-lobby-v2.html" },
  { id: "preset-school-ms-lobby-3", name: "Middle School · Lobby Welcome — Dark", group: "Middle School", url: "/templates/school/ms-lobby-v3.html" },
  { id: "preset-cafeteria-animated-middle", name: "Middle School · Campus Lineup — Route Split", group: "Middle School", url: "/templates/school/ms-lunch-campus-lineup.html" },
  { id: "preset-school-ms-lunch-signal-deck", name: "Middle School · Campus Lineup — Signal Deck", group: "Middle School", url: "/templates/school/ms-lunch-signal-deck.html" },
  { id: "preset-school-ms-lunch-poster-loop", name: "Middle School · Campus Lineup — Poster Loop", group: "Middle School", url: "/templates/school/ms-lunch-poster-loop.html" },
];

// Boards the operator may OFFER as a NEW choice in the builder's "Industry
// Signage" picker. Quarantined boards (audit W0-08 — placeholder / clipping /
// brand-licensing risk) are filtered out against the SAME shared denylist the
// API seeds ARCHIVED, so a quarantined board can never be selected and
// published to a live screen. `SIGNAGE_TEMPLATES` stays the FULL catalog on
// purpose — it's still used to resolve the display name of a board a legacy
// playlist already references, which must keep rendering. See
// `@cms/api-types` (quarantine.ts) for the single source of truth.
export const SELECTABLE_SIGNAGE_TEMPLATES: SignageTemplate[] = SIGNAGE_TEMPLATES.filter(
  (t) => !QUARANTINED_BOARD_URLS.has(t.url),
);
