# Section 14 — Multi-vertical Surface Audit

**Date:** 2026-06-10
**Auditor:** Final pre-launch audit agent (Sonnet 4.6)
**Sections covered:** 14 (Multi-vertical)
**Prior audit dedup refs:** docs/research/2026-06-09-full-audit/REPORT.md, docs/research/2026-06-08-launch-readiness-audit/00-MASTER-SYNTHESIS.md

---

## Coverage Table

| Section | DESIGN | UX | FUNCTIONALITY | Notes |
|---------|--------|----|---------------|-------|
| 14. Multi-vertical | B | B- | B | See findings below for the remaining gaps |

---

## Executive Summary

The multi-vertical system is architecturally solid: a single canonical `VERTICALS` array in `packages/api-types/src/verticals.ts` drives 12 verticals, all with per-vertical labels, group nouns, emergency types, role labels, template categories, branding sample URLs, AI voice prompts, and template galleries. Most of the launch P0 (WORSHIP ships zero templates) was fixed. However several gaps remain that degrade the non-K12 experience.

**Key findings (new):**

1. **P1 — DistrictSchoolsCard COPY is dead code** (all verticals get "Location / Locations" regardless of vertical)
2. **P2 — LicenseTier.bestFor type is stale** (missing SPORTS, WORSHIP, HEALTHCARE, HOSPITALITY, RESTAURANT)
3. **P2 — WORSHIP gets no sample data at signup** (not in MENU_, RETAIL_, or STREAM_VERTICALS)
4. **P2 — CORPORATE/HEALTHCARE/HOSPITALITY/FASHION templates all from signage pack only** (10 preset-sig-* boards each; no native preset file unlike GYM, QSR, BAR, RETAIL)
5. **P2 — GYM signage pack thin** (only 2 `preset-sig-gym-*` boards, vs 10 for corporate/healthcare/hospitality)
6. **P3 — 31 branding sample URLs unverified** (task #51 still pending)
7. **P3 — billing.ts bestFor type union is stale** (7 original launch verticals hardcoded, 5 new verticals missing from type)

---

## Vertical-by-Vertical Matrix

### K12 (beachhead vertical)

| Dimension | Status | Evidence |
|-----------|--------|----------|
| COPY (DistrictSchoolsCard) | BROKEN — returns `OTHER` | `DistrictSchoolsCard.tsx:188` `copyFor()` returns `COPY.OTHER` for all verticals including K12 |
| Default templates | A — deep coverage | `SYSTEM_TEMPLATE_PRESETS` + 17 K12 presets + 1200+ line HS boards in `system-presets.ts` |
| Per-vertical sample data | B — seeds public broadcasters (streams) | `sample-data.service.ts:33` STREAM_VERTICALS includes K12 |
| Billing tier names | B — generic "Monthly" / "Annual" | universal tiers, no "EDU District" label (correct per operator decision) |
| Per-vertical AI prompts | A | `ai.service.ts:123` K12 voice clause present |
| Branding sample URLs | A — 3 verified (lcsnc.org, harvard.edu, stanford.edu) | `BrandingWizard.tsx:121-125` |
| Add-a-noun copy | BROKEN — shows "Location" | `copyFor()` returns `COPY.OTHER` always |
| Signup picker | A | `signup/page.tsx:49` "K-12 school or district" |

---

### GYM (fitness clubs, studios, athletic facilities)

| Dimension | Status | Evidence |
|-----------|--------|----------|
| COPY (DistrictSchoolsCard) | BROKEN — returns "Location" | same `copyFor()` issue |
| Default templates | C | `fitness-presets.ts` has 19 templates (large file); `preset-sig-gym-*` only 2 boards in signage pack |
| Per-vertical sample data | B | STREAM_VERTICALS includes GYM — seeds public broadcaster streams |
| Billing tier names | B | universal tiers; no GYM-specific tier copy |
| Per-vertical AI prompts | A | `ai.service.ts:127` GYM voice clause present |
| Branding sample URLs | B-unverified | `BrandingWizard.tsx:126-130` Equinox, Crunch, CorePower — task #51 |
| Add-a-noun copy | BROKEN — shows "Location" | all verticals get OTHER |
| Signup picker | A | "Gym, fitness club, or athletic facility" |

Gap: only 2 `preset-sig-gym-*` boards versus 10 each for corporate/healthcare/hospitality. Fitness-presets.ts covers it partially but the signage-pack category tab "Fitness / Class & training" will be thin on variety.

---

### RETAIL

| Dimension | Status | Evidence |
|-----------|--------|----------|
| COPY (DistrictSchoolsCard) | BROKEN — returns "Location" | same `copyFor()` issue |
| Default templates | B | `retail-presets.ts` 8 entries; 10 `preset-sig-fashion-*` boards dual-tagged RETAIL|FASHION |
| Per-vertical sample data | B | RETAIL_VERTICALS — seeds retail SKU sample POS data |
| Billing tier names | B | universal tiers |
| Per-vertical AI prompts | A | `ai.service.ts:135` RETAIL voice present |
| Branding sample URLs | B-unverified | Patagonia, REI, Warby Parker — task #51 |
| Add-a-noun copy | BROKEN | shows "Location" not "Store" |
| Signup picker | A | "Retail store or chain" |

---

### CORPORATE

| Dimension | Status | Evidence |
|-----------|--------|----------|
| COPY (DistrictSchoolsCard) | BROKEN — returns "Location" | COPY.CORPORATE entry exists in file but dead |
| Default templates | C | 10 `preset-sig-corporate-*` signage boards + 1 `preset-sig-office-*` board; no dedicated corporate-presets.ts file |
| Per-vertical sample data | B | STREAM_VERTICALS includes CORPORATE — seeds public broadcaster streams |
| Billing tier names | B | universal tiers |
| Per-vertical AI prompts | A | `ai.service.ts:139` CORPORATE voice present |
| Branding sample URLs | B-unverified | IBM, Salesforce, HubSpot — task #51 |
| Add-a-noun copy | BROKEN | shows "Location" not "Office" |
| Signup picker | A | "Corporate office or enterprise" |

Gap: no dedicated corporate-presets.ts. The 10 signage boards cover basic needs but differ from the rich per-vertical presets GYM/QSR/BAR have.

---

### QSR (quick-service restaurants)

| Dimension | Status | Evidence |
|-----------|--------|----------|
| COPY (DistrictSchoolsCard) | BROKEN — returns "Location" | COPY.QSR entry exists but dead |
| Default templates | A | `restaurant-presets.ts` 20 entries; 10 `preset-sig-qsr-*` boards; many dual-tagged QSR\|RESTAURANT |
| Per-vertical sample data | A | MENU_VERTICALS — seeds full restaurant POS menu (16 items) |
| Billing tier names | B | universal tiers |
| Per-vertical AI prompts | A | `ai.service.ts:132` QSR voice present |
| Branding sample URLs | B-unverified | Chipotle, Five Guys, Shake Shack — task #51 |
| Add-a-noun copy | BROKEN | shows "Location" not "Restaurant" |
| Signup picker | A | "Quick-service restaurant" |

---

### FASHION (boutique apparel)

| Dimension | Status | Evidence |
|-----------|--------|----------|
| COPY (DistrictSchoolsCard) | BROKEN — returns "Location" | COPY.FASHION exists but dead |
| Default templates | B | 10 `preset-sig-fashion-*` boards; 8 RETAIL boards dual-tagged RETAIL\|FASHION (`ensure-system-presets.ts:198`) |
| Per-vertical sample data | B | RETAIL_VERTICALS includes FASHION — seeds retail SKU sample data |
| Billing tier names | B | universal tiers |
| Per-vertical AI prompts | A | `ai.service.ts:138` FASHION voice present |
| Branding sample URLs | B-unverified | Madewell, Everlane, Bonobos — task #51 |
| Add-a-noun copy | BROKEN | shows "Location" not "Boutique" |
| Signup picker | A | "Fashion boutique or apparel" |

---

### BAR (bars, taprooms, nightclubs)

| Dimension | Status | Evidence |
|-----------|--------|----------|
| COPY (DistrictSchoolsCard) | BROKEN — returns "Location" | COPY.BAR exists but dead |
| Default templates | B | `bar-presets.ts` 6 entries; also `preset-sig-bar-*` boards (10) via signage pack |
| Per-vertical sample data | B | MENU_VERTICALS includes BAR — seeds restaurant/menu POS sample data |
| Billing tier names | B | universal tiers |
| Per-vertical AI prompts | A | `ai.service.ts:133` BAR voice present |
| Branding sample URLs | B-unverified | Sam Adams, Stone Brewing, Dogfish Head — task #51 |
| Add-a-noun copy | BROKEN | shows "Location" not "Bar" |
| Signup picker | A | "Bar, taproom, or nightclub" |

---

### HEALTHCARE (clinics, hospitals, practices)

| Dimension | Status | Evidence |
|-----------|--------|----------|
| COPY (DistrictSchoolsCard) | BROKEN — returns "Location" | COPY.HEALTHCARE exists but dead |
| Default templates | C | 10 `preset-sig-healthcare-*` boards + 1 `preset-sig-clinic-*` + 2 `preset-sig-veterinary-*` (provisionally HEALTHCARE); no dedicated healthcare-presets.ts |
| Per-vertical sample data | B | STREAM_VERTICALS includes HEALTHCARE — seeds public broadcaster streams |
| Billing tier names | B | universal tiers |
| Per-vertical AI prompts | A | `ai.service.ts:141` HEALTHCARE voice present |
| Branding sample URLs | B-unverified | Johns Hopkins, Cleveland Clinic, One Medical — task #51 |
| Add-a-noun copy | BROKEN | shows "Location" not "Clinic" |
| Signup picker | A | "Clinic, practice, or hospital" |

---

### HOSPITALITY (hotels, resorts)

| Dimension | Status | Evidence |
|-----------|--------|----------|
| COPY (DistrictSchoolsCard) | BROKEN — returns "Location" | COPY.HOSPITALITY exists but dead |
| Default templates | C | 10 `preset-sig-hospitality-*` boards + 1 `preset-sig-museum-*` (provisionally HOSPITALITY); no dedicated hospitality-presets.ts |
| Per-vertical sample data | B | STREAM_VERTICALS includes HOSPITALITY — seeds public broadcaster streams |
| Billing tier names | B | universal tiers |
| Per-vertical AI prompts | A | `ai.service.ts:143` HOSPITALITY voice present |
| Branding sample URLs | B-unverified | Hyatt, Wyndham, Kimpton — task #51 |
| Add-a-noun copy | BROKEN | shows "Location" not "Property" |
| Signup picker | A | "Hotel, resort, or property" |

---

### RESTAURANT (full-service)

| Dimension | Status | Evidence |
|-----------|--------|----------|
| COPY (DistrictSchoolsCard) | BROKEN — returns "Location" | COPY.RESTAURANT exists but dead |
| Default templates | B | 10 `preset-sig-menus-pos-*` boards + QSR boards dual-tagged QSR\|RESTAURANT (12 boards via PRESET_VERTICALS map) |
| Per-vertical sample data | B | MENU_VERTICALS includes RESTAURANT — seeds restaurant POS menu items |
| Billing tier names | B | universal tiers |
| Per-vertical AI prompts | A | `ai.service.ts:129` RESTAURANT voice present |
| Branding sample URLs | B-unverified | Olive Garden, Texas Roadhouse, Cracker Barrel — task #51 |
| Add-a-noun copy | BROKEN | shows "Location" not "Location" (these actually match for RESTAURANT — but context heading says "Locations" not "Restaurants in this group") |
| Signup picker | A | "Full-service restaurant" |

---

### SPORTS (stadiums, arenas, athletic programs)

| Dimension | Status | Evidence |
|-----------|--------|----------|
| COPY (DistrictSchoolsCard) | BROKEN — returns "Location" | COPY.SPORTS exists but dead; should show "Venue" |
| Default templates | A | `sports-presets.ts` 7 entries (celebration decks); 3 composable scoreboard variants (hs/college/pro); scorebug, ribbon; full game-control console. The Sports template gallery is the best-stocked non-K12 vertical. |
| Per-vertical sample data | B | STREAM_VERTICALS includes SPORTS — seeds public broadcaster streams |
| Billing tier names | B | universal tiers; no sports-specific tier names |
| Per-vertical AI prompts | A | `ai.service.ts:125` SPORTS voice present and distinct (crowd hype, rally, bold) |
| Branding sample URLs | B-unverified | MLB, NBA, NCAA — task #51 |
| Add-a-noun copy | BROKEN | shows "Location" not "Venue" |
| Signup picker | A | "Sports venue, stadium, or athletic program" |
| Vertical gate (Sports menu) | A — FIXED | task #10 completed: Sports sidebar menu only shows for SPORTS vertical tenants |

---

### WORSHIP (churches, ministries)

| Dimension | Status | Evidence |
|-----------|--------|----------|
| COPY (DistrictSchoolsCard) | BROKEN — returns "Location" | COPY.WORSHIP exists but dead; should show "Church" |
| Default templates | B | `worship-presets.ts` 8 entries (service times, sermon, hymn, giving, verse, events, hub, welcome); 10 `preset-sig-church-*` boards from signage pack |
| Per-vertical sample data | **MISSING** | WORSHIP not in MENU_VERTICALS, RETAIL_VERTICALS, or STREAM_VERTICALS. New WORSHIP tenant gets only house-ads. No streams, no menus, no content sample. |
| Billing tier names | B | universal tiers |
| Per-vertical AI prompts | A | `ai.service.ts:145` WORSHIP voice present and distinct (warm, sincere, inclusive, community-minded) |
| Branding sample URLs | B-unverified | Life.Church, Saddleback, The Potter's House — task #51 |
| Add-a-noun copy | BROKEN | shows "Location" not "Church" |
| Signup picker | A | "Church, ministry, or house of worship" |

---

## Findings

### Finding 1 (P1): DistrictSchoolsCard per-vertical COPY is complete dead code

**File:** `apps/web/src/components/settings/DistrictSchoolsCard.tsx:188`

**Evidence:** `copyFor(_v?: string): Copy { return COPY.OTHER; }` — the argument is intentionally ignored. The comment at line 105-108 says this was a deliberate 2026-06-01 change: "The vertical arg is ignored now that the account-hierarchy nouns are unified to Location."

**Impact:** Every non-K12 operator sees "Locations" in the settings card heading and "+ Location" for the add button, instead of the vertical-tuned copy that was implemented for all 12 verticals. A SPORTS operator adding a venue sees "Add a Location" and "No locations yet" — not "Add a Venue" and "No venues yet." This is a UX regression — the per-vertical copy for BAR, HOSPITALITY, SPORTS, WORSHIP, CORPORATE, HEALTHCARE was explicitly added to fix a prior audit gap (2026-05-26) and is now dead.

**Severity:** P1 — degrades multi-vertical promise but not a crash. The card still works; it just says "Location" for every industry.

**Fix:** Either (a) restore vertical-aware routing in `copyFor(v)` — the per-vertical COPY entries are already correct, just unreachable; or (b) if "Location" was a deliberate operator decision, remove the dead COPY entries for every non-K12 vertical and update the doc comment to say this is intentional.

---

### Finding 2 (P2): LicenseTier.bestFor type union is stale — 5 new verticals missing

**File:** `packages/api-types/src/billing.ts:42`

**Evidence:**
```typescript
bestFor: ReadonlyArray<'K12' | 'GYM' | 'RETAIL' | 'CORPORATE' | 'QSR' | 'FASHION' | 'BAR'>;
```
The type union lists only the original 7 launch verticals. SPORTS, WORSHIP, HEALTHCARE, HOSPITALITY, RESTAURANT are all missing. All tiers currently have `bestFor: []` so this is not a runtime bug, but if any tier is ever populated with a `bestFor` value for the newer verticals, TypeScript will reject it at compile time.

**Severity:** P2 — type correctness issue, not a runtime problem today since all tiers use `[]`. Fix is trivially adding the 5 missing verticals to the type union.

**Fix:** Add `'SPORTS' | 'WORSHIP' | 'HEALTHCARE' | 'HOSPITALITY' | 'RESTAURANT'` to the union in `billing.ts:42`.

---

### Finding 3 (P2): WORSHIP vertical gets zero sample data at new-tenant signup

**File:** `apps/api/src/sample-data/sample-data.service.ts:27-33`

**Evidence:**
```typescript
const MENU_VERTICALS    = new Set(['QSR', 'RESTAURANT', 'BAR']);
const RETAIL_VERTICALS  = new Set(['RETAIL', 'FASHION']);
const STREAM_VERTICALS  = new Set(['GYM', 'K12', 'SPORTS', 'CORPORATE', 'HEALTHCARE', 'HOSPITALITY']);
```
WORSHIP appears in none of the three sets. A new WORSHIP tenant gets only house-ads seeded (line 90), which are blank placeholder ads — no streams, no sample content boards. Every other vertical gets at least public broadcaster streams or menu/retail data.

**Impact:** A church admin signs up and sees a fully empty dashboard with no streams to demo and no hint of what the platform can do for them. The WORSHIP template gallery has 8+ templates but there is nothing in the playlists, nothing to put on a screen.

**Fix:** Add `'WORSHIP'` to `STREAM_VERTICALS` (public broadcaster streams like PBS, news channels are universally neutral content for a church lobby screen).

---

### Finding 4 (P2): CORPORATE, HEALTHCARE, HOSPITALITY have no dedicated preset file — only signage-pack boards

**Files:** `apps/api/src/templates/` — no `corporate-presets.ts`, `healthcare-presets.ts`, `hospitality-presets.ts`

**Evidence:** Template count per vertical from `ensure-system-presets.ts` + preset files:
- GYM: 19 `fitness-presets` + 2 `preset-sig-gym-*` = 21 total
- QSR: 20 `restaurant-presets` + 10 `preset-sig-qsr-*` = 30 total  
- BAR: 6 `bar-presets` + 10 `preset-sig-bar-*` = 16 total
- RETAIL: 8 `retail-presets` + 10 `preset-sig-fashion-*` (dual-tagged) = 18 total
- WORSHIP: 8 `worship-presets` + 10 `preset-sig-church-*` = 18 total
- SPORTS: 7 `sports-presets` + 6 scoreboard/ribbon/scorebug presets = 13 total
- CORPORATE: 0 preset file + 10 `preset-sig-corporate-*` + 1 `preset-sig-office-*` = 11 total
- HEALTHCARE: 0 preset file + 10 `preset-sig-healthcare-*` + 1 `preset-sig-clinic-*` + 2 `preset-sig-veterinary-*` = 13 total
- HOSPITALITY: 0 preset file + 10 `preset-sig-hospitality-*` + 1 `preset-sig-museum-*` + 1 `preset-sig-real-estate-*` = 12 total

CORPORATE/HEALTHCARE/HOSPITALITY are entirely reliant on the generic signage-pack boards. These are EXTERNAL_HTML boards (good quality) but they are not the same depth as the verticals that have dedicated React preset files with widget-based layouts.

**Severity:** P2 — the signage boards are usable, but these three verticals ship only 11-13 templates vs 16-30 for the better-stocked verticals.

---

### Finding 5 (P2): GYM signage pack is thin — only 2 preset-sig-gym-* boards

**File:** `apps/api/src/templates/system-presets.ts`

**Evidence:** `grep -c "preset-sig-gym-[0-9]"` returns 2, vs 10 for corporate/healthcare/hospitality/fashion. GYM has 19 fitness-presets.ts boards as compensation, but the "Class & training" category tab in the GYM gallery will have far fewer EXTERNAL_HTML-style boards than comparable verticals. The signage pack was clearly built at 10 boards per industry but GYM only got 2.

**Severity:** P2 — functional gap for GYM operators who want polished signage-pack boards.

---

### Finding 6 (P3): 31 branding sample URLs remain unverified (task #51)

**File:** `apps/web/src/components/branding/BrandingWizard.tsx:120-191`

**Evidence:** Comment at lines 108-117 says "Other entries are best-effort picks... if one is blocked the operator sees the BRANDING_BLOCKED error." Task #51 in the task list is marked [pending]. The comment notes that only 3 K12 URLs were verified on 2026-05-25. The other 9 verticals × 3 URLs = 27 additional URLs (plus the 4 Cloudflare replacements for HEALTHCARE + HOSPITALITY = ~31 total) are unverified.

Specifically risky: QSR (Chipotle, Five Guys, Shake Shack — major chains with Akamai/Cloudflare); BAR (Sam Adams — regional brand, may block); SPORTS (NBA, MLB, NCAA — enterprise media companies with aggressive bot protection).

**Severity:** P3 — the failure mode is graceful (BRANDING_BLOCKED message with actionable copy), but a first-impression demo that immediately blocks on the first sample click is a UX problem.

---

## Solid (items previously flagged, now fixed)

- **WORSHIP ships zero templates** (P0-7) — fixed: `worship-presets.ts` has 8 templates + 10 `preset-sig-church-*` boards. Closed.
- **BAR/HOSPITALITY/SPORTS/WORSHIP missing from DistrictSchoolsCard COPY** (2026-05-26 audit) — the COPY entries were added and are correct. The remaining bug is that `copyFor()` ignores the vertical entirely (Finding 1), but the COPY data itself is present.
- **Per-vertical AI voice prompts missing** — all 12 verticals have `VERTICAL_VOICE` entries in `ai.service.ts:122-147`. Fixed.
- **FASHION sees no templates** (P3 2026-05-30) — fixed via `RETAIL_ALSO_FASHION` dual-tagging in `ensure-system-presets.ts:198`.
- **QSR/RESTAURANT template cross-visibility** (P1-10/P1-11) — fixed via `QSR_FULL_SERVICE_ALSO_RESTAURANT` dual-tagging.
- **Sports gallery was empty** (P0-7 equivalent for SPORTS) — fixed via `sports-presets.ts` and full scoreboard preset set.

---

## Missing Features (multi-vertical gaps not yet built)

1. **Per-vertical onboarding sample Screen + Playlist** — `seedForNewTenant` seeds POS/stream connections but not actual demo screens or playlists. Every new tenant lands on an all-zero dashboard. The 2026-06-08 audit (M7) flagged this. WORSHIP is worst-affected because it also has no stream sample data.

2. **WORSHIP has no stream sample data** — missing from `STREAM_VERTICALS`.

3. **Vertical-specific billing feature copy** — the `billing.ts` tier `features` array is identical across all tiers ("Emergency alerts", "Full template library"). A SPORTS operator cannot tell from the billing page that their plan includes scoreboards and ribbon board. Feature copy is not vertical-aware.

4. **Veterinary / Real Estate / Museum provisionally tagged** — `ensure-system-presets.ts:119-127` explicitly notes these 3 sub-industries have no dedicated vertical yet, tagged to nearest proxy. This is a known deferral, not a gap.

5. **Per-vertical POS connector defaults** — the Integration Concierge discovery service (`POST /integrations/discover`) was re-created (task #82) but there is no per-vertical ordering/ranking of suggested integrations visible in the frontend. A new HEALTHCARE tenant sees the same integration grid as a QSR tenant. Low severity.

---

## Scoped-Down Declaration

This audit covers Section 14 (Multi-vertical) only. It does not cover Sections 1-13 or 15-21. Within Section 14, the following were deferred:
- Live scrape verification of the 31 branding sample URLs (task #51 — network-dependent, not audited here)
- Live API call to verify vertical-filtered template galleries return correct counts per tenant (would require DB access with per-tenant JWTs — read from source only)
- Per-vertical integration concierge ranking correctness (frontend not auditable from source alone)
