# Audit — §14 Multi-vertical · §18 Accessibility · §19 Widget Editability · §20 Lenses · §21 Verify-Before-Claim

_Agent a578d50850768763a · read-only, file:line-traced · 2026-05-30_

## Coverage (D/UX/F)
| Section | D | UX | F |
|---|---|---|---|
| §14 Multi-vertical | B | B | B+ |
| §18 Accessibility/a11y | C | C | C |
| §19 Template + Widget Editability | A− | A− | B+ |
| §20 Design/UX/Functionality lenses | (rolled into §14/§18/§19) | | |
| §21 Verification-Before-Claim | N/A | B | B |

## §14 Multi-vertical — B/B/B+
12 verticals (K12, GYM, RETAIL, CORPORATE, QSR, FASHION, BAR, HEALTHCARE, HOSPITALITY, RESTAURANT, SPORTS, WORSHIP). **All 12 covered** in VERTICAL_LABELS / GROUP_NOUN / ROLE_LABELS / TEMPLATE_CATEGORIES / EMERGENCY_TYPES; DistrictSchoolsCard "Add a [noun]" copy complete (BAR/HOSPITALITY/SPORTS/WORSHIP added 2026-05-26); per-vertical AI prompts (`ai.service.ts:122-147` VERTICAL_VOICE) all 12; sample data seeded by vertical class (menu/retail/stream).
- P2 — Terms page hard-coded K12 ("schools and districts", "your district", "school day", "state drill requirements") `terms/page.tsx:9,21-28,53,75,105,113`. (chip spawned)
- P3 — WORSHIP not in STREAM_VERTICALS → churches get no broadcaster-stream sample (`sample-data.service.ts:33`). P3 — no code asserts every VERTICAL_TEMPLATE_CATEGORIES tab has ≥1 seeded template (deferred — needs live DB query).

## §18 Accessibility — C/C/C (weakest section)
**Working:** axe-core CI (`a11y.yml`) on 10 routes, fails on critical/serious; SR live regions on panic (`panic/page.tsx:304` role=status aria-live=assertive) + desktop emergency (`EmergencyLiveRegion.tsx`); fleet-map pins color-blind-safe (distinct Lucide shape + role=img aria-label, WCAG 1.4.1); templates-gallery keyboard nav.
- **P0 — a11y warning ratchet NEVER set.** `a11y-warning-baseline.json` = `{"warningBaseline":999}` — the explicit "permissive ceiling" bootstrap value. CI passes anything ≤999 → **zero regression protection** for moderate/minor violations. No `pnpm a11y:ci` run has locked a real count. Fix: run it against live app, record actual, lower from 999.
- P1 — a11y audit skips the **builder** route (`a11y-audit.ts:44`) — the most complex interactive surface isn't audited at all. Fix: add `/[schoolId]/templates/builder/[id]`.
- P2 — VariantPicker widget-palette tiles are drag-only, no `tabIndex/role=button/onKeyDown` (keyboard operators can't add a widget). P2 — no WCAG-AA contrast warning when an operator picks a failing brand palette (`color-picker.tsx`).

## §19 Widget Editability — A−/A−/B+ ("can't edit a word" is FIXED)
Per-widget A–F table built for ~120 widget types. **NO widget below B — the prior D-F state is remediated.** Architecture: `ColorPickerField` brand swatches emit `var(--brand-primary)` (not frozen hex); BackgroundPanel solid/gradient/image + brand gradients; zone position/size/rotation/opacity all wired (2026-05-28); **universal text-style footer** (`PropertiesPanel.tsx:5969-6033`) appends Font/Size/Color/B/I/U/S to EVERY non-media widget lacking a font field. Grades: TEXT/CLOCK/TICKER/LUNCH_MENU/SCOREBOARD/ANIMATED_WELCOME/HALLWAY_SCHEDULE = **A**; the long tail (themed/MS/Fitness/HS/Retail/Bar/Restaurant/v2-industry) = **A−/B+**; media-only (IMAGE/VIDEO/STREAMING/HOLIDAY) intentionally **B**.
- P2 — `lineHeight` missing from universal footer (only TEXT/RICH_TEXT + HS StyleableField have it) `PropertiesPanel.tsx:6023`. P2 — ANNOUNCEMENT/QUOTE lack a bgColor field. P2 — v2 Healthcare/Corporate/Hospitality/Worship widgets have no APPROVED comment (batch-built → unverified per §21). P3 — z-index is up/down arrows only, no numeric input.

## §21 Verify-Before-Claim — B
**Verified (APPROVED comments w/ scratch/design refs):** MS pack (`MsAtlasWidget.tsx:6` etc.), AnimatedWelcome (`:7` "signed off commit dc80f51"), sports HS scoreboard (2026-05-29), retail pack (2026-05-19).
**Unverified (no APPROVED comment — rebuild candidates per CLAUDE.md):** v2 Healthcare/Corporate/Hospitality/Worship/Charts widgets; universal Calendar/Announcement/Clock/Countdown v2 widgets; `AnimatedWelcomePortraitWidget.tsx:7` still "APPROVED-PENDING" since 2026-04-20; the entire a11y baseline (999, never run).

## Prioritized
- **P0** — §18 a11y ratchet never set (baseline=999, CI blind). **P1** — §18 builder route not audited. **P2** — §19 lineHeight + ANNOUNCEMENT/QUOTE bgColor; §18 VariantPicker keyboard + brand-contrast checker; §14 terms page; §21 v2-widget verification. **P3** — WORSHIP stream sample; AnimatedWelcomePortrait APPROVED upgrade; z-index numeric.
