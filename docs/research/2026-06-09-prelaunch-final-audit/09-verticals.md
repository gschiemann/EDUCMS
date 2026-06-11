# §14 Multi-Vertical Surface — Pre-Launch Final Audit (2026-06-09/10)

Auditor: fresh-model deep pass. Method: diffed `packages/api-types/src/verticals.ts` (12 verticals: K12, GYM, RETAIL, CORPORATE, QSR, FASHION, BAR, HEALTHCARE, HOSPITALITY, RESTAURANT, SPORTS, WORSHIP) against every consuming surface; verified template counts against the **live production database** (read-only); verified all 33 unverified branding sample URLs against the scraper's **exact fetch fingerprint** (UA + Accept from `branding-scraper.service.ts:215-222`).

**Coverage: COVERED** (every §14 bullet explicitly below). Grades: **DESIGN B+ / UX C+ / FUNCTIONALITY B**.

Dedup notes: 2026-06-08 synthesis graded §14 A/B+/B with one open P1 (empty cold-start). Verified still open (see KNOWN-OPEN below). This pass found two NEW P1-class issues the prior audits missed: the category-tab taxonomy drift and the broken sample-URL set.

---

## 1. Bullet-by-bullet coverage

### 1a. `verticals.ts` ↔ DistrictSchoolsCard COPY — covered, but the surface is now dead code
- `apps/web/src/components/settings/DistrictSchoolsCard.tsx:44-190`: COPY map contains all 12 canonical verticals + legacy `FITNESS`/`RESTAURANT`/`OTHER`. The 2026-05-26 audit gap (BAR/HOSPITALITY/SPORTS/WORSHIP missing) is fixed.
- **However** `copyFor(_v?)` (line ~192) **ignores the vertical argument entirely** and always returns `COPY.OTHER` — per the 2026-06-01 operator decision (Greg): every account is a "Location", the top-level is "Primary", across every vertical. Same decision in `apps/web/src/hooks/use-tenant-copy.ts:72-83` (`orgSingular: 'Location'` hardcoded).
- Consequence: ~150 lines of per-vertical COPY ("Bars in this group", "Venues in this league", "Churches in this ministry") are retained-but-unreachable. Not a bug — but CLAUDE.md §14's bullets *"DistrictSchoolsCard COPY"* and *"Add a [noun] buttons match the vertical"* describe a contract that no longer exists. Future audits will keep "verifying" a dead surface.

### 1b. Default templates per vertical — covered; counts verified against live prod DB

`SELECT vertical, category, COUNT(*) FROM templates WHERE is_system AND status='ACTIVE'`:

| Vertical | Pure-tagged | Dual-tagged | + ALL kiosks | Effective gallery | Flagship content present? |
|---|---|---|---|---|---|
| K12 | 85 | — | +19 | 104 | Yes (lobby, cafeteria, hallway, holidays, HS pack) |
| SPORTS | 43 | — | +19 | 62 | **Yes — scoreboards (10), celebrations (16), gameday (5), sponsors (4), ribbon (1)** |
| GYM | 21 | — | +19 | 40 | Yes (FITNESS 19) |
| QSR | 18 | +12 (QSR\|RESTAURANT) | +19 | 49 | Yes (menus 17, promo, loyalty) |
| WORSHIP | 18 | — | +19 | 37 | Yes (service/sermon/giving) — P0-7 fix held |
| BAR | 16 | — | +19 | 35 | Yes (taps, events, sports) |
| HEALTHCARE | 13 | — | +19 | 32 | Yes (incl. 2 veterinary + 1 clinic provisional) |
| CORPORATE | 12 | — | +19 | 31 | Yes (incl. office + real-estate provisional) |
| HOSPITALITY | 11 | — | +19 | 30 | Yes (incl. museum provisional) |
| RESTAURANT | 10 | +12 | +19 | 41 | Yes (menus-pos 10 + dual menus 11) |
| FASHION | 10 | +8 (RETAIL\|FASHION) | +19 | 37 | Yes |
| **RETAIL** | **0** | **+8 (RETAIL\|FASHION)** | +19 | **27** | **Thinnest vertical — zero pure-RETAIL presets; promos=3, pricing=1, lookbook=1** |

- `verticalMatchOr()` (`ensure-system-presets.ts:280-289`) is correct: pipe-bounded patterns, `RETAIL` can never substring-match `RESTAURANT`; `ALL` sentinel surfaces the 19 touch kiosks to every vertical. Crosstalk isolation verified (gallery `where` at `templates.controller.ts:276-302`).
- Sports gets scoreboards ✔, Worship gets its pack ✔ (P0-7 closed), Retail gets promos — but only 3, all borrowed from the FASHION dual-tag set. See finding V-3.

### 1c. **NEW P1 — category-tab taxonomy drift: 14 dead tabs, ~120 boards invisible to tab navigation**

`VERTICAL_TEMPLATE_CATEGORIES` (verticals.ts) defines the gallery tabs; the gallery filters by **exact match** (`apps/web/src/app/[schoolId]/templates/page.tsx:480` — `t.category !== activeCategory → hide`); tabs render **unconditionally** (page.tsx:1143-1172, no hide-if-empty). The seeded `Template.category` values don't line up with the tab keys:

| Vertical | Dead tabs (0 templates on click) | Boards stranded under "All" only (category ∉ tab keys) |
|---|---|---|
| **CORPORATE** | **Welcome, Conference rooms, Internal comms — ALL 3 industry tabs dead** | CORPORATE(10), OFFICE(1), REAL_ESTATE(1) = 12/12 |
| **HEALTHCARE** | **Waiting room, Directory, Patient info — ALL 3 dead** | HEALTHCARE(10), VETERINARY(2), CLINIC(1) = 13/13 |
| **HOSPITALITY** | **Lobby, Events, Wayfinding, Amenities — ALL 4 dead** | HOSPITALITY(10), MUSEUM(1) = 11/11 |
| **K12 (the pilot!)** | **Athletics dead** | LOBBY_WELCOME(23!), CAFETERIA_MENU(4), EVENTS(4), HALLWAY_DISPLAY(2), INFO(2), ENTRY(2), CLASSROOM(2) = 39/85 |
| **GYM** | Welcome, Promo dead | GYM(2) |
| **RESTAURANT** | Specials, Wine & bar dead | MENUS_POS(10) |
| QSR | — | QSR(10) |
| BAR | — | BAR(10) |
| FASHION | — | FASHION(10) + PRICING(1)/HOLIDAYS(1) from dual set |
| SPORTS | — | EVENTS(7) — no EVENTS tab in SPORTS |
| WORSHIP | — | WORSHIP(10) |
| RETAIL | — (tabs populated but thin: 1-3 each) | — |

Aggravator: the **public marketing page advertises these exact tab names as the vertical's template types** (`apps/web/src/components/marketing/IndustryShowcase.tsx:258` renders `VERTICAL_TEMPLATE_CATEGORIES[active.vertical]`). A hotel operator is sold "Wayfinding" on venue-os.app, signs up, clicks the Wayfinding tab → empty grid. Default tab is "All" so content isn't lost — but every industry-specific tab in 3 sold verticals is an empty-grid click, and 23 of K12's flagship welcome boards never appear under "Welcome".

Fix is mechanical, either side: (a) re-map seeded categories at boot (extend the metadata-sync pass in ensure-system-presets.ts: LOBBY_WELCOME→LOBBY, CAFETERIA_MENU→CAFETERIA, CORPORATE→INTERNAL/LOBBY split, HEALTHCARE→WAITING, HOSPITALITY→LOBBY, MENUS_POS→MENU, BAR→TAPS/PROMO, etc.), or (b) derive tabs from the live category distribution. (a) preserves the curated tab copy.

### 1d. Sample data per vertical (signup + onboarding) — covered; KNOWN-OPEN P1 confirmed
- Signup picker: `apps/web/src/app/signup/page.tsx:47` — `Record<Vertical, VerticalSignup>` typed over `VERTICALS`, compile-enforced 12/12; picker iterates `VERTICALS` (line 284).
- Seeding: `apps/api/src/sample-data/sample-data.service.ts:27-33` — menus (QSR/RESTAURANT/BAR), retail SKUs (RETAIL/FASHION), public broadcaster streams (GYM/K12/SPORTS/CORPORATE/HEALTHCARE/HOSPITALITY), house ads (all 12).
- **KNOWN-OPEN (synthesis P1-4):** still no demo Screen / starter Playlist / template seeded for ANY vertical; `onboarding.service.ts:187` is still `void this.sampleData.seedForNewTenant(...)` (fire-and-forget, un-awaited). **WORSHIP is in none of the three seed sets** — a church tenant cold-starts with house ads only, the emptiest first-run of all 12.

### 1e. Vertical-aware billing tier names — covered, PASS by design
- `packages/api-types/src/billing.ts:62-132`: tiers are "Free trial / Monthly / Annual / Comp / Custom" — vertical-neutral; `recommendedTiersForVertical(_vertical)` (line 150) deliberately ignores vertical ("tier is universal"). No "EDU District" string anywhere in billing (`grep` of `apps/api/src/billing`, `apps/web .../settings/billing/page.tsx` clean). The §14 requirement ("no EDU District on a Sports tenant") is satisfied via neutrality. Per-vertical pricing SKUs remain a verticals.ts "later" note — not a launch gap.

### 1f. Per-vertical AI prompts — covered, PASS (best-in-class surface here)
- `apps/api/src/ai/ai.service.ts:122-145`: `VERTICAL_VOICE` has a system-role voice clause for **all 12 verticals** (K12 warm/safe-for-all-ages → SPORTS hype → HEALTHCARE calm/never-jokey → BAR 21+ cheeky). Composed via `composeSystemPrompt()` (line 157) and also used by the template-synthesis path (line 770-772). Unknown vertical → neutral fallback, never an error. Vertical string whitelisted before prompt interpolation (line 435-444 — injection-safe).

### 1g. **NEW P1 — branding sample URLs (task #51): 9 of 36 chips are broken on first click**
Replicated `branding-scraper.service.ts` fetch exactly (UA `Mozilla/5.0 ... Chrome/124.0.0.0`, Accept `text/html,...`, redirects followed, block-signature regex from line 230-236). Results for all 33 never-verified URLs (3 K12 ones were verified 2026-05-25):

| Status | URL (vertical) |
|---|---|
| **403 BLOCKED** | warbyparker.com (RETAIL) |
| **000 unreachable** (12s timeout/TLS reset) | rei.com (RETAIL) |
| **403 BLOCKED** | shakeshack.com (QSR) |
| **403 BLOCKED** | madewell.com (FASHION) |
| **403 BLOCKED** | hopkinsmedicine.org (HEALTHCARE) — *the URL swapped IN on 2026-05-25 as the "lighter WAF" replacement for Mayo* |
| **403 BLOCKED** | hyatt.com (HOSPITALITY) |
| **403 BLOCKED** | kimptonhotels.com (HOSPITALITY) — *also a 2026-05-25 "lighter WAF" swap-in* |
| **403 BLOCKED** | texasroadhouse.com (RESTAURANT) |
| 200 OK | the other 24 (equinox, crunch, corepoweryoga, patagonia*, ibm, salesforce, hubspot, chipotle, fiveguys, everlane, bonobos, samueladams, stonebrewing, dogfish, clevelandclinic, onemedical, wyndham, olivegarden, crackerbarrel, mlb, nba, ncaa, life.church, saddleback, thepottershouse) |

\* patagonia.com returned 200 but only 14 KB — likely a JS shell; palette extraction quality unverified.

Per-vertical first-impression damage: **RETAIL 2/3 sample chips fail, HOSPITALITY 2/3 fail**; QSR, FASHION, HEALTHCARE, RESTAURANT 1/3 each. The wizard does show the graceful BotProtectionError copy, but the file's own comment (`BrandingWizard.tsx:115`) names the standard: *"silent-fail URLs make the feature feel broken at first impression."* The two 2026-05-25 "spot-check swaps" were themselves never run through `POST /branding/demo/scrape` and are blocked. Fix: swap the 8 (e.g. RETAIL→target.com/llbean.com-class lighter-WAF sites), and add a weekly CI smoke that curls each sample with the scraper UA so rot is caught (WAF behavior drifts).

Caveat: tested from a residential/dev IP; Railway egress IPs may fare *worse* (datacenter ranges score higher on bot heuristics) — 403s here are a floor, not a ceiling.

### 1h. Brand applyToTemplates × vertical widget sets — covered, PASS with a scoping note
- `apps/api/src/branding/branding.controller.ts:673-810`: paints universal `color`/`fontFamily`, plus `accentColor` ("consumed directly by 60+ widgets across restaurant/retail/sports/fitness packs" — the 2026-05-26 fix), plus the 2026-06-08 EXTERNAL_HTML fix stamping `cfg.brand` tokens (primary/accent/text/surface/background/muted/fontDisplay/fontBody) that the baked shim's `applyBrand()` maps to `--brand-*` vars. That chain covers every vertical's widget architecture (React zones + EXTERNAL_HTML boards).
- Scope note (by design, message says so): only `isSystem: false` templates are touched — system presets re-skin per-render via brand passthrough instead. Holiday boards use the separate `holiday:*` bridge (K12-only surface, out of §14 scope).

### 1i. "Add a [noun]" buttons — covered; superseded by design
Universal "+ Location" everywhere per 2026-06-01 operator decision (see 1a). Not a defect; CLAUDE.md §14 text is stale (finding V-5).

### Adjacent verifications
- `normalizeVertical()` + `VERTICAL_ALIASES` (FITNESS→GYM) prevents legacy rows rendering as "school" — present and used by `useTenantCopy`.
- Per-vertical emergency type sets (`VERTICAL_EMERGENCY_TYPES`) — sane: K12 keeps full 6-type panic set; SPORTS adds lockdown to the mass-gathering set; everyone has evacuate/weather/medical.
- Role labels unified to one canonical set across all 12 (operator ask 2026-05-25) — consistent.
- Marketing `IndustryShowcase` lists all 12 verticals (lines 41-236) — parity with verticals.ts.
- Provisional industries (veterinary/real-estate/museum, 2026-06-08 signage handoff) are tagged to nearest verticals per the documented TODO in `ensure-system-presets.ts:115-122`; their categories are part of the dead-category class in 1c.

---

## 2. Findings

| ID | Sev | Title | Evidence | Fix |
|---|---|---|---|---|
| V-1 | **P1** | Category-tab drift: 14 dead gallery tabs across 6 verticals; ~120 active boards reachable only via "All". CORPORATE/HEALTHCARE/HOSPITALITY have **every** industry tab empty; K12's Athletics tab dead and 23 LOBBY_WELCOME boards hidden from "Welcome". Marketing page advertises the dead tab names. | Live DB category counts vs `VERTICAL_TEMPLATE_CATEGORIES`; exact-match filter `templates/page.tsx:480`; unconditional tab render :1143; `IndustryShowcase.tsx:258`. | Boot-time category re-map in ensure-system-presets.ts metadata sync (LOBBY_WELCOME→LOBBY, CORPORATE→INTERNAL, HEALTHCARE→WAITING, HOSPITALITY→LOBBY, MENUS_POS→MENU, …) or add the missing tab keys. |
| V-2 | **P1** | 8 of 33 never-verified branding sample URLs hard-fail with the scraper's exact fetch (7×403 + REI unreachable); RETAIL and HOSPITALITY each have 2/3 chips broken; two were the 2026-05-25 "lighter-WAF" swap-ins. Task #51 evidence. | curl with UA/Accept from `branding-scraper.service.ts:215-222`: warbyparker 403, rei 000, shakeshack 403, madewell 403, hopkinsmedicine 403, hyatt 403, kimptonhotels 403, texasroadhouse 403. | Swap the 8 for scrape-verified picks (run each through `POST /branding/demo/scrape` per the file's own rule, `BrandingWizard.tsx:112-116`); add periodic CI smoke with the scraper UA. |
| V-3 | P2 | RETAIL is the thinnest sold vertical: **zero** pure-RETAIL system presets; gallery = 8 borrowed RETAIL\|FASHION boards (promo 3, lobby 2, pricing 1, lookbook 1, holidays 1) + 19 universal kiosks. K12=85, SPORTS=43 by comparison. "Retail gets promos" is barely true. | Live DB: no `vertical='RETAIL'` rows; only `RETAIL\|FASHION`(8). | Ship a retail pack (sale/endcap/price-grid/inventory boards) on par with the BAR(16)/GYM(21) packs, or dual-tag suitable QSR promo boards. |
| V-4 | KNOWN-OPEN P1 | Empty cold-start (synthesis P1-4): no demo Screen/Playlist/template per vertical; seed is fire-and-forget. **New detail this pass: WORSHIP is in none of the POS/retail/stream seed sets — house ads only, emptiest cold-start of all 12.** | `onboarding.service.ts:187` (`void this.sampleData...`); `sample-data.service.ts:27-33` seed-set membership. | Await the seed; add WORSHIP to a seed set; seed one PENDING screen + starter playlist per vertical. |
| V-5 | P3 | CLAUDE.md §14 bullets ("DistrictSchoolsCard COPY", "Add a [noun] matches vertical") describe a superseded contract; the 12-vertical COPY map (~150 lines) is dead code since the 2026-06-01 universal "Location/Primary" decision. Future audits will re-verify a dead surface. | `DistrictSchoolsCard.tsx` `copyFor(_v?)` returns `COPY.OTHER` unconditionally; `use-tenant-copy.ts:72-83`. | Update CLAUDE.md §14 to the universal-noun contract; delete or comment-out the unreachable COPY entries. |
| V-6 | P3 | SPORTS seeds 7 boards with category EVENTS but SPORTS has no EVENTS tab; WORSHIP(10)/QSR(10)/BAR(10)/FASHION(10)/GYM(2) self-named categories have no tabs — same class as V-1, listed for completeness of the sweep. | Live DB counts vs `VERTICAL_TEMPLATE_CATEGORIES`. | Fold into the V-1 re-map. |

## 3. Solid (verified working)
- AI `VERTICAL_VOICE`: all 12 verticals, system-role anchored, injection-whitelisted, neutral fallback — the strongest §14 surface.
- Billing tier names vertical-neutral by design; zero "EDU" leakage on any non-K12 tenant.
- Signup vertical picker compile-enforced over all 12 (`Record<Vertical, VerticalSignup>`).
- Gallery vertical isolation real and substring-safe (`verticalMatchOr` pipe-bounding; QSR|RESTAURANT and RETAIL|FASHION dual-tags work; 19 ALL-kiosks surface everywhere).
- `normalizeVertical` + FITNESS→GYM alias kills the "gym shows as school" class.
- Apply-brand chain covers vertical widget packs (accentColor) AND EXTERNAL_HTML boards (cfg.brand tokens, 2026-06-08 fix).
- Per-vertical emergency-type defaults sensible (K12 full set; SPORTS mass-gathering set).
- WORSHIP P0-7 (sold with zero templates) stays closed: 18 active presets live.
- DistrictSchoolsCard COPY 12/12 complete (even if now unreached).

## 4. Grades (section 14)
- **DESIGN: B+** — taxonomy, taglines, marketing showcase, and voice clauses read like a $$$ multi-vertical product; dead tabs and a 3-promo RETAIL gallery undercut it.
- **UX: C+** — fails the 30-second test in 3 sold verticals: "find a conference-room / waiting-room / wayfinding template" → operator clicks the obvious tab → empty grid. 2/3 broken sample chips in RETAIL/HOSPITALITY on the branding first-run. Cold-start dashboard still all-zero.
- **FUNCTIONALITY: B** — plumbing is real end-to-end (filtering, dual-tags, AI voice, seeding, billing, apply-brand); the failures are content/config drift, not architecture.

## 5. Missing features (competitive scan, §14-scoped)
- Per-vertical starter content on signup (Yodeck/OptiSigns ship a demo playlist on day one) — covered by V-4 fix.
- Dedicated VETERINARY / REAL_ESTATE / MUSEUM verticals — boards already exist (tagged provisionally), the vertical entries don't (documented TODO, `ensure-system-presets.ts:115-122`).
- Per-vertical pricing SKUs — deliberately universal today; verticals.ts header still lists it as "later".
