import { Logger } from '@nestjs/common';
import { QUARANTINED_BOARD_URLS } from '@cms/api-types';
import type { PrismaService } from '../prisma/prisma.service';
import { SYSTEM_TEMPLATE_PRESETS } from './system-presets';
import { FITNESS_TEMPLATE_PRESETS } from './fitness-presets';
import { RESTAURANT_TEMPLATE_PRESETS } from './restaurant-presets';
import { BAR_TEMPLATE_PRESETS } from './bar-presets';
import { RETAIL_TEMPLATE_PRESETS } from './retail-presets';
import { SPORTS_TEMPLATE_PRESETS } from './sports-presets';
import { WORSHIP_TEMPLATE_PRESETS } from './worship-presets';

// Fitness presets live in their own file so the EDU pack stays
// uncontaminated. At seed time we tag each row with the vertical it
// was designed for (Template.vertical column); the templates list
// endpoint then filters by the requesting tenant's Tenant.vertical
// so a gym never sees K-12 templates and a school never sees fitness
// ones. `ALL_PRESETS` is the union we reconcile against the DB; the
// per-preset vertical is resolved via the map below.
export const ALL_PRESETS = [
  ...SYSTEM_TEMPLATE_PRESETS,
  ...FITNESS_TEMPLATE_PRESETS,
  ...RESTAURANT_TEMPLATE_PRESETS,
  ...BAR_TEMPLATE_PRESETS,
  ...RETAIL_TEMPLATE_PRESETS,
  ...SPORTS_TEMPLATE_PRESETS,
  ...WORSHIP_TEMPLATE_PRESETS,
];

// ─── Interim quarantine denylist (2026-07-13, audit W0-08) ───
// The 2026-07-12 world-class audit named these EXTERNAL_HTML boards as
// launch-blockers: visible dimension-placeholder content, confirmed clipping,
// or a demo-only brand-licensing risk (the Domino's pilot pack, marked
// "pilot-demo-only" in its CREDITS.txt). Until the real TemplateRelease
// approval pipeline (TPL-002) exists, these are QUARANTINED — seeded/kept as
// ARCHIVED so they never appear in a customer gallery, while any existing
// playlist that references one keeps rendering (ARCHIVED preserves references,
// exactly like the legacy-archive pass below). Matched by the EXTERNAL_HTML
// zone's `defaultConfig.url` so it's robust to preset-id naming.
//
// The canonical URL list now lives in `@cms/api-types` (`quarantine.ts`) so the
// web layer (builder "Industry Signage" picker + public homepage) filters
// against the EXACT same set — one source of truth that can never drift. We
// re-export it here so every existing API consumer of
// `QUARANTINED_BOARD_URLS` keeps working unchanged (byte-identical Set).
//
// Removing an entry there is a deliberate "this board passed review" decision —
// pair it with the board actually being fixed. See
// docs/research/2026-07-12-world-class-fullapp-audit/07-template-catalog-remediation.md.
export { QUARANTINED_BOARD_URLS };

/** The EXTERNAL_HTML zone url for a preset, if it is a single-scene board. */
function presetBoardUrl(preset: any): string | undefined {
  const zones = preset?.zones;
  if (!Array.isArray(zones)) return undefined;
  for (const z of zones) {
    const url = z?.defaultConfig?.url;
    if (typeof url === 'string' && url) return url;
  }
  return undefined;
}

/** True when a preset is on the interim quarantine denylist. */
function isQuarantinedPreset(preset: any): boolean {
  const url = presetBoardUrl(preset);
  return url != null && QUARANTINED_BOARD_URLS.has(url);
}

/** Preset ids that are quarantined (resolved from ALL_PRESETS at boot). */
export const QUARANTINED_PRESET_IDS: ReadonlySet<string> = new Set(
  ALL_PRESETS.filter(isQuarantinedPreset).map((p: any) => p.id as string),
);

/**
 * Presets SUPERSEDED by a newer redesign — retired from the gallery. Unlike the
 * quarantine denylist (quality/legal holds), these are intentional retirements:
 * archived (not deleted) so any playlist referencing one keeps working and they
 * can be restored by flipping status back to ACTIVE. The boot pass below archives
 * any that are still ACTIVE.
 *
 * 2026-07-24: the old emoji React-zone RETAIL presets replaced by the redesigned
 * photo HTML fashion boards. Add the remaining old retail presets (storefront /
 * endcap / wayfinding) here as their codex replacements are ported + verified.
 */
export const SUPERSEDED_PRESET_IDS: ReadonlySet<string> = new Set<string>([
  // Replaced by the redesigned photo HTML fashion boards (2026-07-24):
  'retail-sale-bogo-promo', // -> Fashion · Sale
  'retail-new-arrivals-lookbook', // -> Fashion · New Arrivals + Lookbook
  'retail-loyalty-spotlight', // -> Fashion · Members
  // Replaced by the codex Store redesign set (preset-sig-retail-01..08), shipped
  // + verified live 2026-07-24 so no gap:
  'retail-storefront-welcome', // -> Store · Storefront (Gallery/Aperture)
  'retail-window-display-portrait', // -> Store · Storefront
  'retail-endcap-featured', // -> Store · End-Cap (Kinetic/Object/Drop)
  'retail-aisle-wayfinding', // -> Store · Wayfinding (Signal/Daylight/Monolith)
  // Replaced by the church/QSR redesign set (2026-07-24), shipped + verified
  // live (72 presets seeded, verticals correct) so there is no gap:
  'worship-welcome-board', // -> Worship · Welcome (3 directions)
  'worship-service-times', // -> Worship · Service Times
  'worship-sermon-series', // -> Worship · Sermon Series
  'worship-song-board', // -> Worship · Song Board
  'worship-weekly-events', // -> Worship · Weekly Events
  'worship-giving-board', // -> Worship · Giving
  'worship-verse-of-the-day', // -> Worship · Verse of the Day
  'worship-lobby-hub', // -> Worship · Lobby Hub
  'qsr-drive-thru-menu', // -> QSR · Drive-Thru (Lane One / Market Board / Order Logic)
  'qsr-counter-order', // -> QSR · Counter Order (Pass / Mosaic / Folio)
  'qsr-coffee-shop-menu', // -> QSR · Coffee Shop (Ledger / Window / Ceramic)
  'qsr-pizza-shop-menu', // -> QSR · Pizza Shop (Slice / Oven No. 7 / House Press)
  // qsr-artisan-pizza + qsr-specialty-coffee are KEPT — different boards, not
  // part of the 4 replaced menu studies.
  // retail-holiday-seasonal is KEPT — no codex replacement (Seasonal category).
]);

/** URLs on the denylist that matched NO preset — a typo/stale-path guard for
 *  the test below. Empty in a healthy tree. */
export const QUARANTINED_URLS_WITHOUT_PRESET: ReadonlyArray<string> = [
  ...QUARANTINED_BOARD_URLS,
].filter((url) => !ALL_PRESETS.some((p: any) => presetBoardUrl(p) === url));
const PRESET_VERTICAL: Map<string, string> = new Map();
SYSTEM_TEMPLATE_PRESETS.forEach((p) => PRESET_VERTICAL.set(p.id, 'K12'));
// 2026-05-02 — VenueOS launch verticals are K12 / GYM / RETAIL /
// CORPORATE / QSR / FASHION (per packages/api-types/src/verticals.ts).
// The earlier sprint-plan name 'FITNESS' is unified to 'GYM' so the
// templates show up for tenants with Tenant.vertical = 'GYM'. The
// fitness-presets.ts file keeps its own internal name + category
// strings as 'FITNESS' for backward-compat in any dashboard chrome
// that already references that label; only the per-template VERTICAL
// flag below is what gates visibility per tenant. Existing tenants
// with Tenant.vertical = 'FITNESS' (if any) keep working — adding
// 'GYM' is purely additive on the seed side.
FITNESS_TEMPLATE_PRESETS.forEach((p) => PRESET_VERTICAL.set(p.id, 'GYM'));
// Restaurant / QSR vertical (2026-05-02 launch). Quick-service menu
// boards, drive-thru displays, loyalty boards, wait-time displays.
// Tagged with vertical='QSR' so QSR-tenant catalogs surface them and
// no other vertical does. RESTAURANT remains valid as a forward-
// compat tag per verticals.ts comment but QSR is the canonical
// launch vertical (per packages/api-types/src/verticals.ts).
RESTAURANT_TEMPLATE_PRESETS.forEach((p) => PRESET_VERTICAL.set(p.id, 'QSR'));
// Bar / nightlife / sports-pub vertical (2026-05-02 launch). Taproom +
// cocktail menu + game day + happy hour + live event + trivia. Tagged
// 'BAR' so bar tenants see this catalog and no other vertical does.
BAR_TEMPLATE_PRESETS.forEach((p) => PRESET_VERTICAL.set(p.id, 'BAR'));
// Retail vertical (2026-05-02 launch). Editorial / boutique /
// department-store visual DNA — kept separate from the K12 + GYM
// packs so each vertical can ship templates without crosstalk.
RETAIL_TEMPLATE_PRESETS.forEach((p) => PRESET_VERTICAL.set(p.id, 'RETAIL'));
// Sports vertical (2026-05-17). Starter set of full-screen celebration
// scenes + a game-day countdown. Tagged 'SPORTS' so VenueOS Sports
// tenants finally have a non-empty template gallery; scoreboard +
// ribbon templates follow once their widget set lands.
SPORTS_TEMPLATE_PRESETS.forEach((p) => PRESET_VERTICAL.set(p.id, 'SPORTS'));
// Worship vertical (2026-05-28). Houses of worship: welcome/greeting
// board, service times, sermon-series card, song/hymn board, weekly
// events, giving/tithe board, verse of the day, lobby hub. Tagged
// 'WORSHIP' so a church tenant finally has a non-empty gallery and
// these never bleed into a school / restaurant / sports palette. Built
// entirely from pre-existing render-verified widgets (TEXT / ANNOUNCEMENT
// / COUNTDOWN / TICKER / CLOCK / CALENDAR / BELL_SCHEDULE / IMAGE) so
// every field is editable in PropertiesPanel out of the box. Closes
// P0-7: WORSHIP was sold on the marketing page but shipped 0 templates.
WORSHIP_TEMPLATE_PRESETS.forEach((p) => PRESET_VERTICAL.set(p.id, 'WORSHIP'));

// 2026-05-19 — the Main Scoreboard preset lives in the GENERAL
// SYSTEM_TEMPLATE_PRESETS array (it's a multi-vertical template surface,
// not part of the SPORTS_TEMPLATE_PRESETS celebration starter set), so
// the K12 default above tagged it K12 → invisible to the SPORTS-vertical
// "dodgers" tenant where the operator was testing. It is a sports
// surface; tag it SPORTS so it surfaces in the sports gallery. The
// boot-time metadata-sync pass below migrates any existing row's
// vertical to match this map, and a fresh id (preset-main-scoreboard,
// renamed from preset-std-scoreboard) guarantees a clean single-zone
// create rather than inheriting the old row's 7 stale zones.
// 2026-05-20 — scoreboard presets re-cut with fresh ids (preset-sb-main
// = element-based composable board; preset-sb-quick = one-piece monolith)
// because the boot seed can't rewrite an existing preset's MULTI-zone
// composition — only a fresh id forces a clean create. The old
// preset-main-scoreboard / preset-elements-scoreboard drop from source
// and the seed's archive pass hides them.
PRESET_VERTICAL.set('preset-sb-main', 'SPORTS');
PRESET_VERTICAL.set('preset-sb-quick', 'SPORTS');
PRESET_VERTICAL.set('preset-main-ribbon', 'SPORTS');
PRESET_VERTICAL.set('preset-main-scorebug', 'SPORTS');
// Three genuinely-different tiers (distinct layouts, not palette swaps).
PRESET_VERTICAL.set('preset-sb-hs', 'SPORTS');
PRESET_VERTICAL.set('preset-sb-college', 'SPORTS');
PRESET_VERTICAL.set('preset-sb-pro', 'SPORTS');
// Interactive touch kiosks (2026-06-03) — multi-vertical, see PRESET_VERTICALS
// below (declared after this point, so the dual-tags live there).

// 2026-05-16 — the 70-template industry signage pack (preset-sig-*)
// lives INSIDE SYSTEM_TEMPLATE_PRESETS so it shares the seeder, which
// means the K12 default above tagged every one of them 'K12'. They
// are NOT K12. Re-tag each by the industry encoded in its id
// (`preset-sig-<industry>-NN`) so a school never sees a drive-thru
// menu board and a bar never sees a bell schedule. The 8 preset-hs-*
// templates ARE high-school and correctly keep the K12 tag.
const SIG_INDUSTRY_VERTICAL: Record<string, string> = {
  bar: 'BAR',
  corporate: 'CORPORATE',
  fashion: 'FASHION',
  healthcare: 'HEALTHCARE',
  hospitality: 'HOSPITALITY',
  'menus-pos': 'RESTAURANT',
  qsr: 'QSR',
  // 2026-06-08 new-industry signage handoff. gym→GYM, office→CORPORATE,
  // clinic→HEALTHCARE map cleanly to existing launch verticals. veterinary /
  // real-estate / museum have NO dedicated vertical yet, so they are
  // PROVISIONALLY tagged to the nearest existing vertical so the boards
  // surface rather than being stranded invisible. Promote to dedicated
  // VETERINARY / REAL_ESTATE / MUSEUM verticals (verticals.ts + the
  // §14 per-vertical copy) when the product adds them.
  //
  // 2026-06-27 — `church: 'WORSHIP'` was REMOVED: the EXTERNAL_HTML
  // `preset-sig-church-*` costumes were dropped from system-presets.ts in
  // favor of the editable React-zone WORSHIP_TEMPLATE_PRESETS (spread into
  // ALL_PRESETS above + tagged WORSHIP at line ~69). No `preset-sig-church-*`
  // id remains for this map to match, so the entry is dead — removed to keep
  // the WORSHIP gallery a single, fully-editable pack (no duplicate boards).
  // 2026-07-24 — the NEW worship redesign boards (preset-sig-worship-*) are
  // self-contained AND fully editable (baked educms protocol + data-fields),
  // unlike the old preset-sig-church-* costumes that were dropped in 2026-06-27.
  // Without this entry the id regex falls through to the K12 default and a
  // church tenant would never see them.
  worship: 'WORSHIP',
  veterinary: 'HEALTHCARE',
  gym: 'GYM',
  'real-estate': 'CORPORATE',
  museum: 'HOSPITALITY',
  office: 'CORPORATE',
  clinic: 'HEALTHCARE',
};
SYSTEM_TEMPLATE_PRESETS.forEach((p) => {
  // The optional `-portrait` suffix is REQUIRED here. A portrait sibling id
  // (`preset-sig-worship-01-portrait`) doesn't end in digits, so without it the
  // match fails and the preset silently keeps the K12 default set above —
  // which both hides it from its real vertical AND leaks it into the K-12
  // gallery (a school would have seen church + QSR menu boards). Caught live
  // 2026-07-24 when all 36 new portrait boards seeded as K12.
  const m = p.id.match(/^preset-sig-(.+)-\d+(?:-portrait)?$/);
  const industry = m?.[1];
  if (industry && SIG_INDUSTRY_VERTICAL[industry]) {
    PRESET_VERTICAL.set(p.id, SIG_INDUSTRY_VERTICAL[industry]);
  }
});

// ───────────────────────────────────────────────────────────────────
// Multi-vertical tagging (P1-10, 2026-05-28).
//
// The `Template.vertical` column is a single String, and historically a
// preset lived in exactly one vertical's gallery. That walled the richer
// full-service-appropriate QSR presets (sushi/ramen, fine-dining wine,
// brunch) off from the RESTAURANT vertical — a full-service restaurant
// tenant saw only the 10 `preset-sig-menus-pos-*` boards, never the 19
// `qsr-*` boards, even though the full-service subset reads perfectly for
// a sit-down restaurant.
//
// Rather than duplicate rows (drift risk) or migrate the schema (out of
// the additive-only contract), we encode multiple verticals in the ONE
// string column as a pipe-delimited list: a single-vertical preset stays
// `"QSR"` (unchanged, backward-compatible) and a dual-tagged one becomes
// `"QSR|RESTAURANT"`. The gallery query (templates.controller.ts) matches
// a caller's single vertical against that list via `verticalListMatches`.
// Pipe was chosen because no canonical vertical name contains it.
//
// PRESET_VERTICALS overrides PRESET_VERTICAL for ids it lists — the value
// is the full set of verticals that preset should appear under.
const PRESET_VERTICALS: Map<string, string[]> = new Map();

// Full-service-appropriate QSR menu boards that should ALSO surface to
// RESTAURANT tenants. Deliberately the sit-down subset — pure
// counter-service / drive-thru boards (drive-thru, counter-order,
// loyalty, wait-time, food-truck window, live-POS) stay QSR-only.
const QSR_FULL_SERVICE_ALSO_RESTAURANT = [
  // Full menu boards
  'qsr-sushi-ramen-menu',
  // 2026-07-24 — its portrait sibling must carry the same dual tag, or a
  // full-service RESTAURANT tenant would see the landscape board but not the
  // portrait one.
  'qsr-sushi-ramen-menu-portrait',
  'qsr-fine-dining-wine',
  'qsr-brunch-spot',
  'qsr-pizza-shop-menu',
  'qsr-coffee-shop-menu',
  'qsr-daily-specials-promo',
  // Cinematic EXTERNAL_HTML pizza board (Domino's-style v4 port) —
  // a pizza menu reads as both a QSR drive-thru/carryout board AND a
  // sit-down pizzeria menu, so it surfaces in both galleries.
  'qsr-dominos-pizza-board',
  // Cuisine-themed boards that read as sit-down menus too
  'qsr-artisan-pizza',
  'qsr-ramen-fusion',
  'qsr-mexican-cantina',
  'qsr-bakery-patisserie',
  'qsr-specialty-coffee',
];
for (const id of QSR_FULL_SERVICE_ALSO_RESTAURANT) {
  PRESET_VERTICALS.set(id, ['QSR', 'RESTAURANT']);
}

// P3 fix (2026-05-30) — FASHION tenants should see the RETAIL preset
// pack in addition to their own ~10 signature fashion templates.
// The `preset-sig-fashion-*` boards are purely editorial/window-display
// content designed for fashion boutiques; the RETAIL pack
// (retail-storefront-welcome, retail-sale-bogo-promo, …) covers
// the operational signage (wayfinding, loyalty, endcap promos) that
// fashion stores equally need. Dual-tagging "FASHION|RETAIL" lets a
// FASHION tenant see BOTH galleries without duplicating rows.
//
// Mirroring the QSR_FULL_SERVICE_ALSO_RESTAURANT pattern exactly:
// a single pipe-joined string in Template.vertical; the gallery
// query's `verticalMatchOr` picks it up in either vertical's gallery.
const RETAIL_ALSO_FASHION = [
  'retail-storefront-welcome',
  'retail-sale-bogo-promo',
  'retail-new-arrivals-lookbook',
  'retail-aisle-wayfinding',
  'retail-loyalty-spotlight',
  'retail-window-display-portrait',
  'retail-endcap-featured',
  'retail-holiday-seasonal',
];
for (const id of RETAIL_ALSO_FASHION) {
  PRESET_VERTICALS.set(id, ['RETAIL', 'FASHION']);
}

// 2026-07-23 — the mirror of RETAIL_ALSO_FASHION. Operator: the 10
// `preset-sig-fashion-*` signage boards (Lookbook, Editorial, Sale, New
// Arrivals, Event, Fitting, Window, Campaign, Hours, Members) were tagged
// FASHION-only, so they surfaced under Boutique but NOT under Store — yet
// every one is general-retail content (a sale board, store hours, a loyalty
// members board, a shoppable window read for ANY store, not just apparel).
// Dual-tag them "FASHION|RETAIL" so a RETAIL (Store) tenant sees them too,
// without duplicating rows. The boot metadata-sync below migrates the
// already-seeded prod rows from "FASHION" → "FASHION|RETAIL" automatically
// (resolvePresetVerticalTag now returns the pipe-joined list for these ids).
const FASHION_ALSO_RETAIL = [
  'preset-sig-fashion-01', // Lookbook
  'preset-sig-fashion-02', // Editorial
  'preset-sig-fashion-03', // Sale
  'preset-sig-fashion-04', // New Arrivals
  'preset-sig-fashion-05', // Event
  'preset-sig-fashion-06', // Fitting
  'preset-sig-fashion-07', // Window
  'preset-sig-fashion-08', // Campaign
  'preset-sig-fashion-09', // Hours
  'preset-sig-fashion-10', // Members
];
for (const id of FASHION_ALSO_RETAIL) {
  PRESET_VERTICALS.set(id, ['FASHION', 'RETAIL']);
}

// 2026-07-24 — codex Store redesign set (preset-sig-retail-01..08: storefront /
// end-cap / wayfinding). Their id industry token ("retail") isn't in
// SIG_INDUSTRY_VERTICAL, so tag them here. Dual RETAIL|FASHION so a boutique
// (a store too) sees them under Boutique as well, matching the fashion boards.
const STORE_RETAIL_REDESIGN = [
  'preset-sig-retail-01', // Storefront — Gallery
  'preset-sig-retail-02', // Storefront — Aperture
  'preset-sig-retail-03', // End-Cap — Kinetic
  'preset-sig-retail-04', // End-Cap — Object Study
  'preset-sig-retail-05', // End-Cap — Drop Signal
  'preset-sig-retail-06', // Wayfinding — Signal
  'preset-sig-retail-07', // Wayfinding — Daylight
  'preset-sig-retail-08', // Wayfinding — Monolith
];
for (const id of STORE_RETAIL_REDESIGN) {
  PRESET_VERTICALS.set(id, ['RETAIL', 'FASHION']);
}

// The QSR menu boards (preset-sig-qsr-12..23, the Super Taco flagship, and
// their portrait siblings). The OLD boards the redesigns replace
// (qsr-coffee-shop-menu, qsr-pizza-shop-menu) were dual-tagged
// QSR|RESTAURANT, so tag the replacements the same way. Otherwise retiring
// the old ones would strip a full-service RESTAURANT tenant of those boards.
// (RESTAURANT is now
// merged into the single "Restaurant/QSR" picker entry, but legacy tenants on
// the RESTAURANT vertical must keep working.)
const QSR_REDESIGN_ALSO_RESTAURANT = [
  'preset-sig-qsr-12',
  'preset-sig-qsr-12-portrait',
  'preset-sig-qsr-13',
  'preset-sig-qsr-13-portrait',
  'preset-sig-qsr-14',
  'preset-sig-qsr-14-portrait',
  'preset-sig-qsr-15',
  'preset-sig-qsr-15-portrait',
  'preset-sig-qsr-16',
  'preset-sig-qsr-16-portrait',
  'preset-sig-qsr-17',
  'preset-sig-qsr-17-portrait',
  'preset-sig-qsr-18',
  'preset-sig-qsr-18-portrait',
  'preset-sig-qsr-19',
  'preset-sig-qsr-19-portrait',
  'preset-sig-qsr-20',
  'preset-sig-qsr-20-portrait',
  'preset-sig-qsr-21',
  'preset-sig-qsr-21-portrait',
  'preset-sig-qsr-22',
  'preset-sig-qsr-22-portrait',
  'preset-sig-qsr-23',
  'preset-sig-qsr-23-portrait',
  'preset-sig-qsr-24-super-taco',
  'preset-sig-qsr-24-super-taco-portrait',
  'preset-sig-qsr-25-super-taco-tacos',
  'preset-sig-qsr-26-super-taco-burritos',
  'preset-sig-qsr-27-super-taco-combos',
];
for (const id of QSR_REDESIGN_ALSO_RESTAURANT) {
  PRESET_VERTICALS.set(id, ['QSR', 'RESTAURANT']);
}

// Interactive touch kiosks — retagged per-vertical for launch (2026-08-16).
// These shipped as 'ALL' in 2026-06-03 "for testing ease", which put a Bar &
// Tap House kiosk, a Fast-Food Self-Order kiosk, and a Veterinary Check-In
// inside every K-12 school's Touch Kiosks tab (operator: "i saw incorrect
// templates in k-12"). Each kiosk now carries its natural vertical(s); the
// boot seeder re-syncs Template.vertical from this map on every deploy, so
// existing DB rows migrate automatically. K-12 keeps the kiosks a school
// would actually deploy: Campus Hub, Front Office Check-In, the museum/
// exhibit pair (science fairs, open houses), and Nutrition & Allergens
// (cafeteria allergen boards are a real K-12 need).
PRESET_VERTICALS.set('preset-kiosk-food', ['QSR', 'RESTAURANT']);
PRESET_VERTICALS.set('preset-kiosk-realestate', ['CORPORATE', 'HOSPITALITY']);
PRESET_VERTICALS.set('preset-kiosk-museum', ['HOSPITALITY', 'CORPORATE', 'K12']);
PRESET_VERTICALS.set('preset-kiosk-office', ['CORPORATE']);
PRESET_VERTICALS.set('preset-kiosk-gym', ['GYM']);
PRESET_VERTICALS.set('preset-kiosk-school', ['K12']);
PRESET_VERTICALS.set('preset-kiosk-qsr', ['QSR']);
PRESET_VERTICALS.set('preset-kiosk-bar', ['BAR']);
PRESET_VERTICALS.set('preset-kiosk-clinic', ['HEALTHCARE']);
PRESET_VERTICALS.set('preset-kiosk-qsr-pickup', ['QSR', 'RESTAURANT']);
PRESET_VERTICALS.set('preset-kiosk-office-room', ['CORPORATE']);
PRESET_VERTICALS.set('preset-kiosk-realestate-models', ['CORPORATE', 'HOSPITALITY']);
PRESET_VERTICALS.set('preset-kiosk-realestate-resident', ['CORPORATE', 'HOSPITALITY']);
PRESET_VERTICALS.set('preset-kiosk-food-nutrition', ['QSR', 'RESTAURANT', 'K12']);
PRESET_VERTICALS.set('preset-kiosk-museum-quest', ['HOSPITALITY', 'CORPORATE', 'K12']);
PRESET_VERTICALS.set('preset-kiosk-gym-workout', ['GYM']);
PRESET_VERTICALS.set('preset-kiosk-bar-jukebox', ['BAR', 'RESTAURANT']);
PRESET_VERTICALS.set('preset-kiosk-school-frontoffice', ['K12']);
PRESET_VERTICALS.set('preset-kiosk-vet', ['HEALTHCARE']);

/**
 * Resolve the stored `Template.vertical` tag for a preset id. Returns a
 * single value (`"QSR"`) for single-vertical presets and a pipe-joined
 * list (`"QSR|RESTAURANT"`) for multi-vertical ones. The multi-map wins
 * over the single map; the single map falls back to K12.
 */
export function resolvePresetVerticalTag(id: string): string {
  const multi = PRESET_VERTICALS.get(id);
  if (multi && multi.length > 0) {
    // De-dupe (the source list above intentionally repeats a couple ids
    // for readability) + keep deterministic order.
    return Array.from(new Set(multi)).join('|');
  }
  return PRESET_VERTICAL.get(id) ?? 'K12';
}

/**
 * True when a single caller vertical belongs to a stored (possibly
 * pipe-delimited) `Template.vertical` tag. Used by the gallery query so a
 * dual-tagged preset surfaces in BOTH verticals' galleries. Exact match
 * for the common single-value case; pipe-delimited membership otherwise.
 */
export function verticalTagIncludes(tag: string | null | undefined, vertical: string): boolean {
  if (!tag) return false;
  if (tag === 'ALL') return true; // universal "Touch Templates"/showcase tier — every vertical sees it
  if (tag === vertical) return true;
  if (tag.indexOf('|') === -1) return false;
  return tag.split('|').includes(vertical);
}

/**
 * Build the Prisma `OR` clause that matches a system template whose
 * (possibly pipe-delimited) `vertical` tag includes `vertical`. Prisma
 * can't run a JS predicate inside `where`, so we express the four cases
 * the pipe-list encoding can take:
 *   - `"QSR"`            → exact equals
 *   - `"QSR|RESTAURANT"` → startsWith "QSR|"   (first member)
 *   - `"BAR|QSR"`        → endsWith   "|QSR"    (last member)
 *   - `"A|QSR|B"`        → contains   "|QSR|"   (middle member)
 * Pipe delimiters bound each pattern so no vertical name can substring-
 * match another (e.g. RETAIL never matches inside RESTAURANT).
 */
export function verticalMatchOr(vertical: string): any[] {
  return [
    { vertical: 'ALL' }, // universal "Touch Templates"/showcase tier — surfaces in every vertical's gallery
    { vertical },
    { vertical: { startsWith: `${vertical}|` } },
    { vertical: { endsWith: `|${vertical}` } },
    { vertical: { contains: `|${vertical}|` } },
  ];
}

// ─── Cross-replica seed lock (see ensureSystemPresets) ───
// Advisory-lock key. Deliberately the same key the old SESSION lock used:
// session and transaction advisory locks on one key exclude each other, so
// during the rolling deploy that ships this, new code still waits for a
// replica running the old code.
const SEED_LOCK_KEY = 424242;
// How long a booting replica waits for another replica's seed before seeding
// anyway. The production seed took 152 s on 2026-09-22 (~460 presets, several
// round trips each), so this is about two seeds' worth.
const SEED_LOCK_WAIT_MS = 5 * 60_000;
// Ceiling on the lock-holding transaction: the wait plus a seed, with room to
// spare. Prisma's default is FIVE SECONDS, and when it expires Prisma rolls
// the holder back — releasing the lock in the middle of the seed.
const SEED_LOCK_HOLD_MS = 20 * 60_000;
// Boot is the pool's busiest moment (the whole fleet reconnects at once), so
// allow more than Prisma's 2 s default to get a connection to hold the lock on.
const SEED_LOCK_CONNECT_WAIT_MS = 30_000;

/** A Prisma error on one log line (its messages span several). */
function oneLine(e: unknown): string {
  const code = (e as { code?: unknown })?.code;
  const message = String((e as Error)?.message ?? e)
    .replace(/\s+/g, ' ')
    .trim();
  return typeof code === 'string' && !message.includes(code)
    ? `${code}: ${message}`
    : message;
}

/**
 * Idempotent system-preset seeder. Runs once on API startup.
 *
 * When we add a new preset to system-presets.ts (e.g. the 2026-04-19
 * middle/high-school animated welcome scenes), the in-memory catalog
 * picks it up immediately — but the templates gallery fetches from the
 * DB (GET /templates with isSystem:true), so nothing shows up until
 * somebody re-runs the seed script. Nobody remembers to do that.
 *
 * This function reconciles the two on every boot:
 *
 *   1. Find every preset in SYSTEM_TEMPLATE_PRESETS that does NOT have
 *      a matching Template row (match by id).
 *   2. Create those rows + zones in a single transaction.
 *
 * It does NOT touch existing presets — we never silently rewrite a
 * customer-visible template just because the source changed. If we
 * deliberately want to update an existing preset we'd cut a separate
 * migration for it. This is purely additive.
 *
 * Called from main.ts after the Prisma pool warms up. Non-blocking —
 * failures are logged and swallowed so a broken preset can't wedge the
 * container. Boot health is gated on /health, not on seed success.
 *
 * ─── Cross-replica lock (rebuilt 2026-09-22) ───
 * Two replicas booting together would both see "missing preset X", both
 * create it (P2002), and both run every pass, so the seed runs under a
 * Postgres advisory lock. HOW it is taken matters, and until 2026-09-22 it
 * was taken wrong:
 *   - `pg_advisory_lock()` returns `void`, which Prisma 5.22's `$queryRaw`
 *     cannot deserialize. It threw ("Failed to deserialize column of type
 *     'void'", in every production boot log) AFTER the statement had run: the
 *     lock WAS held, the code believed it was not, skipped the unlock, and the
 *     lock sat on a pooled connection until the pool recycled it. A second
 *     replica's identical call waited on it indefinitely.
 *   - a SESSION lock belongs to one connection, and the pool never promised
 *     that the unlock would land on the connection that took it.
 * Now a dedicated interactive transaction holds a TRANSACTION-scoped lock for
 * as long as the seed runs:
 *   - `pg_advisory_xact_lock` goes through `$executeRaw`, which returns a row
 *     count and never deserializes a column;
 *   - the lock is released by that transaction's COMMIT or ROLLBACK, on the
 *     connection that took it — however the seed ends, and if the process dies;
 *   - the seed's own queries still run on the pool as separate autocommit
 *     statements, NOT inside that transaction: inside it, the first failed
 *     write (a P2002 from another pod) would abort every statement after it,
 *     and one bad preset must never stop the rest;
 *   - the wait for another replica is bounded (`lock_timeout`). A replica
 *     that cannot get the lock — it waited too long, or had no connection to
 *     hold it on — seeds without it, exactly as it always could: every pass is
 *     idempotent and P2002 is handled.
 * Reproduced and verified on Postgres 16 + Prisma 5.22; pinned by
 * ensure-system-presets-lock.spec.ts.
 */
export async function ensureSystemPresets(prisma: PrismaService) {
  const logger = new Logger('SystemPresetSeed');
  let started = false;
  const seed = () => {
    started = true;
    return reconcileSystemPresets(prisma, logger);
  };
  try {
    await prisma.client.$transaction(
      async (tx) => {
        // set_config(…, true) is SET LOCAL: it ends with this transaction and is
        // never left behind on the pooled connection.
        await tx.$executeRaw`SELECT set_config('lock_timeout', ${`${SEED_LOCK_WAIT_MS}ms`}, true)`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SEED_LOCK_KEY})`;
        await seed();
      },
      { maxWait: SEED_LOCK_CONNECT_WAIT_MS, timeout: SEED_LOCK_HOLD_MS },
    );
  } catch (e) {
    if (started) {
      // The seed ran under the lock; what failed is the holder's COMMIT (it
      // outlived SEED_LOCK_HOLD_MS or lost its connection). Postgres released
      // the lock with the transaction either way — nothing is left held.
      logger.warn(
        `System preset seed ran, but its lock was released early: ${oneLine(e)}`,
      );
      return;
    }
    logger.warn(
      `System preset seed lock not taken (${oneLine(e)}) — seeding without it; every pass is idempotent.`,
    );
    await seed();
  }
}

/**
 * The reconcile itself. Never throws: every pass logs and swallows its own
 * failure, so a broken preset can't wedge the boot.
 */
async function reconcileSystemPresets(
  prisma: PrismaService,
  logger: Logger,
): Promise<void> {
  try {
    const existingIds = new Set(
      (await prisma.client.template.findMany({
        where: { isSystem: true },
        select: { id: true },
      })).map((r: { id: string }) => r.id),
    );

    const missing = ALL_PRESETS.filter((p) => !existingIds.has(p.id));
    if (missing.length === 0) {
      logger.log(`All ${ALL_PRESETS.length} system presets present.`);
    } else {
      logger.log(`Seeding ${missing.length} missing system preset(s)…`);
    }
    // NOTE: do NOT early-return when missing.length===0. The archive
    // + pin passes below MUST run on every boot so deletions from
    // system-presets.ts propagate to the DB and the pin-to-top set
    // stays fresh.
    let created = 0;
    for (const preset of missing) {
      try {
        await prisma.client.template.create({
          data: {
            id: preset.id,
            name: preset.name,
            description: preset.description,
            category: preset.category as any,
            orientation: preset.orientation as any,
            // schoolLevel is optional on older presets — only pass when set
            ...(('schoolLevel' in preset && (preset as any).schoolLevel)
              ? { schoolLevel: (preset as any).schoolLevel }
              : {}),
            screenWidth: preset.screenWidth,
            screenHeight: preset.screenHeight,
            bgColor: preset.bgColor,
            bgGradient: preset.bgGradient,
            bgImage: (preset as any).bgImage ?? null,
            isSystem: true,
            // Audit W0-08: a quarantined board is seeded ARCHIVED, never
            // ACTIVE — "source exists" must not mean "published to customers."
            status: (QUARANTINED_PRESET_IDS.has(preset.id) ? 'ARCHIVED' : 'ACTIVE') as any,
            tenantId: null,
            // Tag each preset with its vertical so the templates list
            // endpoint can filter it out for tenants in other verticals.
            // resolvePresetVerticalTag returns a pipe-delimited list for
            // dual-tagged presets (e.g. "QSR|RESTAURANT").
            vertical: resolvePresetVerticalTag(preset.id),
            zones: {
              create: preset.zones.map((z: any, i: number) => ({
                name: z.name,
                widgetType: z.widgetType,
                x: z.x,
                y: z.y,
                width: z.width,
                height: z.height,
                zIndex: z.zIndex ?? 0,
                sortOrder: z.sortOrder ?? i,
                defaultConfig: z.defaultConfig ? JSON.stringify(z.defaultConfig) : null,
              })),
            },
          },
        });
        created += 1;
        logger.log(`  + ${preset.name} (${preset.id})`);
      } catch (e) {
        const code = (e as any)?.code;
        if (code === 'P2002') {
          // Another pod won the race — harmless, they inserted the same row.
          logger.log(`  = ${preset.id} already created by another pod (P2002)`);
        } else {
          // One bad preset doesn't stop the rest. Loud log so we fix it.
          logger.warn(`  ✕ Failed to seed ${preset.id}: ${(e as Error).message}`);
        }
      }
    }
    if (missing.length > 0) {
      logger.log(`System preset seed complete — ${created}/${missing.length} created.`);
    }

    // ─── Metadata sync for existing presets ───
    // The "creation only" contract above means a preset's schoolLevel
    // / category / name tag can drift from source forever once a row
    // exists. The Integration Lead reported Scrapbook + Storybook
    // (elementary aesthetic) showing up under the High School filter
    // because the DB rows are still tagged UNIVERSAL from an older
    // source version. Metadata tags ARE safe to rewrite — they only
    // affect which filter chip surfaces a preset, not what actually
    // renders — so we reconcile them here. Zones / defaultConfig /
    // screenWidth stay untouched; those are the "customer-visible
    // shape" the creation-only rule was written for.
    try {
      const presentRows = await prisma.client.template.findMany({
        where: {
          isSystem: true,
          id: { in: ALL_PRESETS.map((p) => p.id) },
        },
        select: { id: true, name: true, category: true, schoolLevel: true, description: true, vertical: true } as any,
      });
      let syncCount = 0;
      for (const row of presentRows as any[]) {
        const src: any = ALL_PRESETS.find((p) => p.id === row.id);
        if (!src) continue;
        const patch: Record<string, any> = {};
        if (src.name && src.name !== row.name) patch.name = src.name;
        if (src.category && src.category !== row.category) patch.category = src.category;
        if (src.description && src.description !== row.description) patch.description = src.description;
        const srcLevel = ('schoolLevel' in src && src.schoolLevel) ? src.schoolLevel : undefined;
        if (srcLevel && srcLevel !== row.schoolLevel) patch.schoolLevel = srcLevel;
        // 2026-05-03 — operator: "I logged in as the gym user and it's
        // all school still, I thought you loaded all the new templates
        // we created." Cause: existing fitness preset rows had been
        // seeded earlier with `vertical: 'FITNESS'`, but the templates
        // list endpoint queries by the new tag `vertical: 'GYM'` (per
        // the VenueOS rebrand). Those rows never matched the GYM
        // tenant's vertical filter so the catalog rendered empty.
        // Re-sync the vertical tag from the source map on every boot
        // so old rows migrate to the canonical vertical without
        // requiring a hand-rolled migration.
        // resolvePresetVerticalTag returns a pipe-delimited list for
        // dual-tagged presets ("QSR|RESTAURANT"); on every boot this
        // migrates an existing single-tag row up to the multi-tag value
        // so the full-service subset starts surfacing to RESTAURANT
        // tenants without a hand-rolled migration.
        const srcVertical = resolvePresetVerticalTag(src.id);
        if (srcVertical !== row.vertical) patch.vertical = srcVertical;
        if (Object.keys(patch).length > 0) {
          // ten-ok: system-preset seeder — these rows are `isSystem: true` and carry NO
          // tenant (Template.tenantId is null on the shared catalogue), so there is no
          // tenant predicate to add. `isSystem: true` is now pinned in the where itself,
          // which means a tenant-owned row can never be reached even if a preset id
          // collided with one. Boot-time only; no request actor.
          await prisma.client.template.update({ where: { id: row.id, isSystem: true }, data: patch });
          syncCount += 1;
        }
      }
      if (syncCount > 0) {
        logger.log(`Synced metadata on ${syncCount} existing system preset(s).`);
      }
    } catch (e) {
      logger.warn(`Metadata sync failed: ${(e as Error).message}`);
    }

    // ─── Zone widget-type sync ───
    // The metadata sync above only touches Template-level fields. When
    // we cut a new portrait widget (e.g. ANIMATED_HALLWAY_SCHEDULE_PORTRAIT)
    // and point the existing preset at it, the DB row's child zones
    // STILL hold the old widgetType ('ANIMATED_HALLWAY_SCHEDULE') and
    // the player keeps rendering the landscape widget.
    //
    // Rule: for every system preset whose source declares a single
    // full-canvas zone (one zone with widgetType X), force the DB
    // zone's widgetType to match the source. We only touch the FIRST
    // zone — if a preset has a multi-zone composition, hand-edits
    // there are sacred. Single-zone presets are the "themed widget"
    // class where the one widgetType is the entire thing.
    //
    // This is purely a SOURCE→DB push. If an admin somehow rewired a
    // system preset's zone via direct SQL it gets overwritten on next
    // boot — but system presets are read-only by contract so that's
    // the intended behavior.
    try {
      let zoneSyncCount = 0;
      let configSyncCount = 0;
      let zonePruneCount = 0;
      for (const src of ALL_PRESETS) {
        // Only touch single-zone presets — multi-zone compositions are
        // out of scope for this auto-sync (those would need per-zone
        // matching logic).
        if (!Array.isArray(src.zones) || src.zones.length !== 1) continue;
        const sourceWidgetType = (src.zones as any)[0]?.widgetType;
        if (!sourceWidgetType) continue;

        // 2026-07-24 — ZONE-COUNT reconciliation for single-zone BOARD presets.
        // Bug this fixes: replacing a multi-zone React preset IN PLACE with a
        // single-zone EXTERNAL_HTML board (qsr-sushi-ramen-menu -> "After Dark")
        // left the DB row with its 5 original zones. The widgetType updateMany
        // below then flipped ALL of them to EXTERNAL_HTML — despite the comment
        // above claiming "first zone only" — while only ONE got the new `url`.
        // Result: the board rendered under 4 empty url-less iframes. Source is
        // the truth for a system preset, so when the source says "one
        // full-canvas board", prune anything beyond the first zone.
        //
        // Deliberately scoped to EXTERNAL_HTML: for a board, the single zone IS
        // the whole template, so extra zones are provably drift. Multi-zone
        // React compositions never reach here (their source has >1 zone).
        // Measured before shipping: exactly ONE row in prod was affected.
        if (sourceWidgetType === 'EXTERNAL_HTML') {
          const zones = await prisma.client.templateZone.findMany({
            where: { templateId: src.id },
            select: { id: true },
            orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
          });
          if (zones.length > 1) {
            const stale = zones.slice(1).map((z) => z.id);
            const pruned = await prisma.client.templateZone.deleteMany({ where: { id: { in: stale } } });
            zonePruneCount += pruned.count;
            logger.warn(`  ↳ ${src.id}: pruned ${pruned.count} stale zone(s) — source declares a single board zone`);
          }
          // The canvas is part of a board's identity (1920x1080 vs an older
          // 3840x2160 React composition). The metadata sync above deliberately
          // leaves screenWidth/Height alone for hand-shaped presets, but for a
          // board the source dimensions ARE the scene, so reconcile them.
          // Boot-time SYSTEM-preset reconciliation, not a request path. System presets
          // are tenantId=NULL by definition, so a tenantId filter is meaningless here;
          // `src.id` comes from our own source array, never from user input.
          // ten-ok: boot-time system-preset reconciliation; system presets are tenantId=NULL
          const row = await prisma.client.template.findUnique({
            where: { id: src.id },
            select: { screenWidth: true, screenHeight: true },
          });
          if (row && (row.screenWidth !== src.screenWidth || row.screenHeight !== src.screenHeight)) {
            // Same boot-time SYSTEM-preset reconciliation — `src.id` is from our own
            // source array and system presets carry tenantId=NULL, so they cannot be scoped.
            // ten-ok: boot-time system-preset reconciliation; system presets are tenantId=NULL
            await prisma.client.template.update({
              where: { id: src.id },
              data: { screenWidth: src.screenWidth, screenHeight: src.screenHeight },
            });
            logger.log(`  ↳ ${src.id}: canvas → ${src.screenWidth}×${src.screenHeight}`);
          }
        }
        const updated = await prisma.client.templateZone.updateMany({
          where: {
            templateId: src.id,
            widgetType: { not: sourceWidgetType },
          },
          data: { widgetType: sourceWidgetType },
        });
        if (updated.count > 0) {
          zoneSyncCount += updated.count;
          logger.log(`  ↳ ${src.id}: zone widgetType → ${sourceWidgetType}`);
        }

        // 2026-05-16 — ALSO sync defaultConfig. Bug: the 8 HS presets
        // were repointed from HS_* widgets to EXTERNAL_HTML, but this
        // sync only updated widgetType — the existing zone's
        // defaultConfig stayed `{}` (the old HS presets shipped empty
        // config), so EXTERNAL_HTML rendered with no `url` → blank
        // preview. For single-zone system presets the source IS the
        // truth, so force the zone's defaultConfig to match. We
        // read-then-write only on a diff to stay idempotent + quiet.
        const wantConfig = (src.zones as any)[0]?.defaultConfig
          ? JSON.stringify((src.zones as any)[0].defaultConfig)
          : null;
        const zone = await prisma.client.templateZone.findFirst({
          where: { templateId: src.id },
          select: { id: true, defaultConfig: true },
        });
        if (zone && (zone.defaultConfig ?? null) !== wantConfig) {
          await prisma.client.templateZone.update({
            where: { id: zone.id },
            data: { defaultConfig: wantConfig },
          });
          configSyncCount += 1;
          logger.log(`  ↳ ${src.id}: zone defaultConfig synced`);
        }
      }
      if (zonePruneCount > 0) {
        logger.log(`Pruned ${zonePruneCount} stale zone(s) from single-zone board presets.`);
      }
      if (zoneSyncCount > 0) {
        logger.log(`Synced widgetType on ${zoneSyncCount} system-preset zone(s).`);
      }
      if (configSyncCount > 0) {
        logger.log(`Synced defaultConfig on ${configSyncCount} system-preset zone(s).`);
      }
    } catch (e) {
      logger.warn(`Zone widgetType/config sync failed: ${(e as Error).message}`);
    }

    // ─── Archive presets that were deleted from system-presets.ts or fitness-presets.ts ───
    // Source-of-truth is the ALL_PRESETS array. Any system
    // template row in the DB whose id no longer appears there gets
    // archived (status=ARCHIVED) so it disappears from the gallery
    // without breaking any playlist that already references it. We do
    // NOT hard-delete — a tenant playlist could still point at the old
    // template id, and the live manifest needs to keep rendering it
    // until the tenant rebuilds with the new set. Cascade-delete would
    // wipe content unexpectedly.
    const wantedIds = new Set(ALL_PRESETS.map((p) => p.id));
    try {
      const stale = await prisma.client.template.findMany({
        where: { isSystem: true, status: 'ACTIVE' as any },
        select: { id: true, name: true },
      });
      const toArchive = stale.filter((t: { id: string }) => !wantedIds.has(t.id));
      if (toArchive.length > 0) {
        await prisma.client.template.updateMany({
          where: { id: { in: toArchive.map((t: { id: string }) => t.id) } },
          data: { status: 'ARCHIVED' as any },
        });
        logger.log(`Archived ${toArchive.length} legacy system preset(s) no longer in source.`);
      }
    } catch (e) {
      logger.warn(`Archive pass failed: ${(e as Error).message}`);
    }

    // ─── Quarantine pass (audit W0-08) ───
    // Archive any board on the interim quarantine denylist that is still
    // ACTIVE in this DB (an older seed activated it before the denylist
    // existed). ARCHIVED hides it from the gallery without breaking any
    // playlist that already references it — same non-destructive contract as
    // the legacy-archive pass above.
    if (QUARANTINED_PRESET_IDS.size > 0) {
      try {
        const res = await prisma.client.template.updateMany({
          where: {
            id: { in: [...QUARANTINED_PRESET_IDS] },
            status: 'ACTIVE' as any,
          },
          data: { status: 'ARCHIVED' as any },
        });
        if (res.count > 0) {
          logger.log(`Quarantined ${res.count} audit-flagged board(s) (placeholder/clipping/brand-licensing).`);
        }
      } catch (e) {
        logger.warn(`Quarantine pass failed: ${(e as Error).message}`);
      }
    }

    // ─── Superseded-preset retirement pass ───
    // Archive any preset SUPERSEDED by a newer redesign that is still ACTIVE.
    // Same non-destructive contract as the quarantine pass: ARCHIVED hides it
    // from the gallery but keeps the id referenceable by existing playlists, and
    // it's one status flip to restore. See SUPERSEDED_PRESET_IDS.
    if (SUPERSEDED_PRESET_IDS.size > 0) {
      try {
        const res = await prisma.client.template.updateMany({
          where: {
            id: { in: [...SUPERSEDED_PRESET_IDS] },
            status: 'ACTIVE' as any,
          },
          data: { status: 'ARCHIVED' as any },
        });
        if (res.count > 0) {
          logger.log(`Retired ${res.count} superseded preset(s) (replaced by newer redesigns).`);
        }
      } catch (e) {
        logger.warn(`Superseded-retirement pass failed: ${(e as Error).message}`);
      }
    }

    // ─── Same-name duplicate cleanup ───
    // Operator reported seeing two system templates with identical
    // display names (e.g. "Varsity Athletics", "Campus Quad — Welcome")
    // in the gallery. Root cause: earlier seed runs inserted rows whose
    // ids have since been superseded by newer rewrites under different
    // ids. The archive pass above catches ids that are no longer in
    // source, but if both the old AND the new id survive in source
    // (or the operator manually created a clone), the gallery keeps
    // rendering both.
    //
    // Rule: for every (case-insensitive) duplicate name among ACTIVE
    // isSystem=true rows, keep the row whose id appears in the
    // canonical ALL_PRESETS list; if multiple match, keep the most
    // recently updated; archive the rest.
    try {
      const allActive = await prisma.client.template.findMany({
        where: { isSystem: true, status: 'ACTIVE' as any },
        select: { id: true, name: true, updatedAt: true },
      });
      const byName = new Map<string, { id: string; name: string; updatedAt: Date }[]>();
      for (const t of allActive) {
        const key = (t.name || '').trim().toLowerCase();
        if (!key) continue;
        if (!byName.has(key)) byName.set(key, []);
        byName.get(key)!.push(t);
      }
      const toArchive: string[] = [];
      for (const [name, rows] of byName) {
        if (rows.length < 2) continue;
        // Preferred winner: the row whose id is in ALL_PRESETS and has
        // the latest updatedAt. Everyone else in the group loses.
        const inSource = rows.filter((r) => wantedIds.has(r.id));
        const candidates = inSource.length > 0 ? inSource : rows;
        const keeper = candidates.slice().sort(
          (a, b) => (b.updatedAt?.getTime?.() ?? 0) - (a.updatedAt?.getTime?.() ?? 0),
        )[0];
        for (const r of rows) {
          if (r.id !== keeper.id) toArchive.push(r.id);
        }
        logger.log(
          `Dedup "${name}": keeping ${keeper.id}, archiving ${rows.length - 1} twin(s)`,
        );
      }
      if (toArchive.length > 0) {
        await prisma.client.template.updateMany({
          where: { id: { in: toArchive } },
          data: { status: 'ARCHIVED' as any },
        });
        logger.log(`Archived ${toArchive.length} duplicate-name system preset(s).`);
      }
    } catch (e) {
      logger.warn(`Duplicate-name cleanup failed: ${(e as Error).message}`);
    }

    // Pin the curated animated-welcome set to the TOP of the gallery by
    // refreshing their updatedAt. The templates list orders by
    // (isSystem desc, updatedAt desc), so touching these pushes the
    // elementary / middle / high animated scenes above every other
    // system template as a cluster. Rerun this whenever we want the
    // "featured" set to surface first — cheap UPDATE, idempotent.
    const PINNED_TO_TOP = [
      'preset-cafeteria-animated-elementary',
      'preset-lobby-animated-high',
      'preset-lobby-animated-middle',
      'preset-lobby-animated-rainbow',
    ];
    try {
      for (const id of PINNED_TO_TOP) {
        await prisma.client.template.updateMany({
          where: { id, isSystem: true },
          data: { updatedAt: new Date() },
        });
      }
      logger.log(`Pinned ${PINNED_TO_TOP.length} animated-welcome presets to top of gallery.`);
    } catch (e) {
      logger.warn(`Pin-to-top failed: ${(e as Error).message}`);
    }
  } catch (e) {
    logger.warn(`System preset seed failed (continuing anyway): ${(e as Error).message}`);
  }
}
