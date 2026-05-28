# §14 Multi-Vertical Surface Audit — VenueOS

> Opus 4.8 full-app audit, 2026-05-28. Read-only. Render-path-verified per
> CLAUDE.md rule #9. 12 verticals (verticals.ts:40): K12, GYM, RETAIL, CORPORATE,
> QSR, FASHION, BAR, HEALTHCARE, HOSPITALITY, RESTAURANT, SPORTS, WORSHIP.

## PAGE 1 — COVERAGE MATRIX (vertical × dimension)
✓=real&wired · ◐=partial · ✗=missing/falls-back

| Vertical | Copy | Signup | Brand URLs | Gallery templates | Builder palette | AI prompt | "Add a [noun]" | **Grade** |
|---|---|---|---|---|---|---|---|---|
| **K12** | ✓ | ✓ | ✓(3) | ✓ **~171** | ✓ **324 tiles** | ◐ generic | ✓ School | **A** |
| **QSR** | ✓ | ✓ | ✓ | ✓ **29** | ✗ **0 tiles** | ◐ shared | ✓ Restaurant | **B-** |
| **SPORTS** | ✓ | ✓ | ✓ | ◐ **~11 thin** | ✓ **17 SCOREBOARD** | ✗ none | ✓ Venue | **B-** |
| **RETAIL** | ✓ | ✓ | ✓ | ◐ **8 thin** | ✗ **0 tiles** | ✗ none | ✓ Store | **C+** |
| **GYM** | ✓ | ✓ | ✓ | ✓ **19** | ✗ **0 tiles** | ◐ quote only | ✓ Gym | **C+** |
| **BAR** | ✓ | ✓ | ✓ | ◐ **16** | ✗ **0 tiles** | ✗ none | ✓ Bar | **C+** |
| **RESTAURANT** | ✓ | ✓ | ✓ | ✗ **only 10 (sig)** | ✗ **0 tiles** | ◐ menu_item | ✓ Location | **C** |
| **CORPORATE** | ✓ | ✓ | ✓ | ◐ **10** | ✗ **0** | ✗ none | ✓ Office | **C** |
| **HEALTHCARE** | ✓ | ✓ | ✓ | ◐ **10** | ✗ **0** | ✗ none | ✓ Clinic | **C** |
| **HOSPITALITY** | ✓ | ✓ | ✓ | ◐ **10** | ✗ **0** | ✗ none | ✓ Property | **C** |
| **FASHION** | ✓ | ✓ | ✓ | ◐ **10** | ✗ **0** | ✗ none | ✓ Boutique | **C** |
| **WORSHIP** | ✓ | ✓ | ✓ | ✗ **0 — EMPTY** | ✗ **0** | ✗ none | ✓ Church | **F** |

## What's GENUINELY GOOD (verified, no K-12 leakage)
The **terminology layer is fully built + leak-free** for all 12 verticals:
1. `DistrictSchoolsCard` COPY (`:56-180`) — all 12 + OTHER fallback tuned; bar sees
   "Add a Bar," hotel "Add a Property." No K-12 string reaches a non-K12 tenant.
2. Signup `SIGNUP_VERTICALS` — all 12 w/ industry placeholders; FERPA/COPPA gated to
   K12 only (`:435`).
3. Branding wizard sample URLs — all 12 have real scrape-tested URLs.
4. `useTenantCopy` hook — central resolver, reads `tenantVertical`, wired correctly.
5. Billing tier names vertical-neutral (Pilot/Standard/Enterprise/Education) — no
   "EDU District" on a Sports tenant. 2026-05-25 generalization landed.
6. Role labels generalized — no "District Admin" on a gym.
7. Template vertical gate strict (`templates.controller.ts:254` — `{isSystem,
   vertical: callerVertical}`) — no cross-vertical leakage, no K-12 fallback.
8. Vertical preset packs render correctly — every vertical widgetType
   (RESTAURANT_MENU_BOARD, BAR_TAP_LIST, etc.) has a WidgetRenderer case AND a
   PropertiesPanel editor case (§19 cross-check passes for these).

## TOP 10 RANKED FIXES
1. **[CRITICAL/F] WORSHIP has ZERO templates → empty gallery.** Fully wired in
   taxonomy + signup + branding + `IndustryShowcase` marketing card (live), but
   `grep -ci worship apps/api/src/templates/*.ts` = **0**. Strict gallery gate, no
   fallback → brand-new WORSHIP tenant gets a **completely empty gallery.** Marketing
   sells a vertical the product can't deliver. **Fix:** build `worship-presets.ts`
   (service times, sermon cards, hymn board, giving thermometer) OR pull WORSHIP from
   showcase/signup until built.
2. **[HIGH] Builder palette has ZERO tiles for 10 of 12 verticals.** Of 341
   `registerVariant()` calls, **324 K-12, only 17 SPORTS, 0** for QSR/RESTAURANT/
   RETAIL/BAR/GYM/CORPORATE/HEALTHCARE/HOSPITALITY/FASHION/WORSHIP. Restaurant widget
   files exist but are only imported by WidgetRenderer, **never registered as palette
   variants.** A QSR/Retail/Bar operator opening the builder can't drag a fresh Menu
   Board / Tap List / Price Callout — only start from a preset, can't add a second.
   Directly contradicts §19 "can't build." **Fix:** register existing widgets as
   `registerVariant({vertical:'QSR',...})`. **Single highest-leverage fix — unblocks
   10 verticals at once, widgets already exist + render.**
3. **[HIGH] QSR/RESTAURANT split starves full-service.** All 19 `qsr-*` presets
   tagged QSR; the 10 `preset-sig-menus-*` tagged RESTAURANT (a separate signup
   vertical). A full-service RESTAURANT tenant sees only 10; the richer 19
   (sushi/ramen, fine-dining-wine, brunch) walled off to QSR. **Fix:** dual-tag.
4. **[HIGH] SPORTS template surface dangerously thin** — ~11 system templates (4 in
   sports-presets.ts + 7 sb-tagged) vs K-12's 171. Sprint 13 promises 6 flagship
   sports × 6 category tabs; most tabs render near-empty. Palette has 17 tiles (good)
   but gallery depth doesn't match ambition. **Fix:** build per-sport scoreboard +
   celebration + sponsor presets.
5. **[MED] AI prompts not per-vertical for most intents.** `ai.service.ts:84-97` —
   6 intents; `announcement` crams all verticals into one generic prompt. Sparkle
   passes `vertical` into the *user* prompt but the *system* prompt for announcement/
   ticker/promo is shared. No sports/healthcare/corporate/hospitality tone. **Fix:**
   branch system prompts on vertical.
6. **[MED-HIGH] No sample data seeded on signup for ANY vertical.**
   `onboarding.service.ts:133-176` creates only Tenant+User+AuditLog. Sample data
   exists only behind manual SUPER_ADMIN buttons (`sample-data.controller.ts`). A QSR
   operator signs up to an empty dashboard. **Fix:** auto-seed vertical-appropriate
   starter playlist + sample data on first login.
7. **[MED] Brand apply-to-templates doesn't target vertical widget configs.**
   `apply-brand-to-zone.ts` recolors generic keys but is widgetType-agnostic — a
   scoreboard's team colors / menu board header band aren't in the key map. **Fix:**
   per-widgetType brand hooks.
8. **[MED] RETAIL thinnest non-empty** — only 8 templates, no `preset-sig-retail-*`
   pack (the SIG map has bar/corporate/fashion/healthcare/hospitality/menus/qsr but
   no retail). Greg named RETAIL a target. **Fix:** add a retail sig pack.
9. **[LOW] FASHION⊂RETAIL overlap unexploited** — boutique can't see retail
   price-callout/sale-countdown templates. **Fix:** `verticals:[FASHION,RETAIL]`
   cross-tag (needs multi-vertical seeder, same as #3).
10. **[LOW] Legacy FITNESS/OTHER string drift** — `DistrictSchoolsCard` COPY carries
    FITNESS+OTHER keys not in canonical VERTICALS; seeder remaps FITNESS→GYM.
    Cosmetic/forward-compat. **Fix:** document deprecated-but-supported.

## Readiness ranking for Greg's named targets (QSR + Sports + Retail)
1. **QSR — B-, most ready.** Best depth (29), correct render+edit, AI menu_item
   prompt, sample-data loader. Blockers: no palette tiles (#2), QSR/RESTAURANT split
   (#3), no auto-seed (#6).
2. **Sports — B-, ambitious but thin.** Strong palette (17 tiles + CTS), leak-free.
   Blockers: gallery depth ~11 vs 6-category ambition (#4), no sports AI tone (#5),
   no sample game/sponsor data.
3. **Retail — C+, weakest.** Terminology perfect, 13 widgetTypes render. Blockers:
   thinnest gallery (8, no sig pack #8), no palette tiles (#2), no retail AI (#5),
   no auto-seed (#6).

**Net:** vertical *plumbing* (copy/labels/nouns/branding/billing/routing) is
A-grade + genuinely leak-free. Vertical *content* (palette tiles, gallery depth, AI
tone, starter data) is C-grade + uneven, WORSHIP an outright F (sold but empty).
Highest-leverage fix is #2 — register vertical widgets as palette tiles.
