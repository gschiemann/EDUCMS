# §12 Design Imports · §14 Multi-vertical · §19 Widget Editability

**Audit date:** 2026-05-30 · read-only, every "editable" claim traced to a real PropertiesPanel control + render-side read (rule #9), not a registry entry · current master ~`8eb8768`. A large fix-wave landed since 2026-05-28 — most P0/P1 editability + vertical items are now FIXED.

## 1. Coverage table

| § | Domain | D | UX | F | Status |
|---|---|---|---|---|---|
| 12 Design imports | A | A | **B** | Covered. Single-page PDF + image import real end-to-end (Asset+Playlist+optional Template). Lives at `/[schoolId]/templates/imports`; `/settings/imports` is a clean redirect. Honest UI — no costume Canva button; PPTX rejected upfront. **N-A (Sprint 10/11, not faked):** multi-page PDF split, Canva OAuth, Google Slides, PowerPoint Online, Figma. |
| 14 Multi-vertical | A (plumbing) | B+ | **B−** (content) | Covered, much improved. Plumbing (copy/labels/nouns/branding/billing/routing) A + leak-free for all 12 verticals. WORSHIP fixed (P0-7). Palette tiles fixed (P1-2). QSR/RESTAURANT dual-tag fixed (P1-10). Residual: per-vertical AI tone, signup auto-seed, thin SPORTS gallery, FASHION⊄RETAIL. |
| 19 Widget editability | A | A− | **A−** | Covered, dramatically improved. P0-3 themed widgets, 13/14 `*Json` raw-list editors → ListItemsEditor, universal font-size, rotation+opacity universal, LOGO un-MEDIA_ONLY, 7 orphans given real cases — all FIXED + render-verified. No widget below B in any shipped preset. |

## 2. §19 editability — delta vs 2026-05-28 (notable rows)

RETAIL_WAYFINDING_MAP C→**A−** (`PropertiesPanel.tsx:5172`); RETAIL_LOOKBOOK_CAROUSEL C→**A−** (per-row imageUrl); RETAIL_STOREFRONT_HOURS C+→**A−** (7-row day editor `:5115`); RESTAURANT_COMBO_CAROUSEL / ALLERGY_LEGEND C+→**A−**; BAR_HAPPY_HOUR/GAME_DAY/TRIVIA C+→**A−**; RETAIL_PRICE_CALLOUT/LOYALTY_QR C+→**A−**; FITNESS_AD_BANNER/CLASS_SCHEDULE/MOTIVATIONAL_QUOTE C+→**A−**; HOUSE_AD_BANNER C+→**A−** (per-row AssetPicker); LOGO B→**A−** (`:5900`, wordmark font/size/color); MS_*/FITNESS scenes B−/C+→**B+** (universal font-size + image upload pickers); 7 orphans **F→B/A−** (`:5328–5390`); rotation/opacity gap **closed** universally (`:831–860`, applied BuilderZone `:362` + player `:5474`).

**Still < A (the only §19 residue):** MS_*/FITNESS themed scenes (~31) **B+** — no per-field font-size/color (only HS_* get per-field StyleableField); array regions comma-joined not row-editor (`:~4635` `isHsWidget` gate). MUSIC_PLAYER **B+** — last raw-JSON `businessHoursJson` (`:4744`, scalar object). CALENDAR/STATS/HONOR_ROLL/SCHEDULE_GRID/BIRTHDAYS **B−/B** — pipe-delimited textarea (functional, no per-row UI). HOLIDAY **B** — picker only. All color fields — brand swatch emits frozen hex not live `var(--brand-primary)` (G1, `color-picker.tsx:386`, half-costume: preset works at placement, no live re-theme reflow).

## 3. Findings

**No P0s remain — all eight 2026-05-28 P0s touching §12/§14/§19 fixed + verified** (P0-3 themed content, P0-7 WORSHIP, P0-8 `inset-[4%]`→longhand `high-school-athletics.tsx:37`, taurus gate gained `insetTw`/`insetCss` patterns `check-taurus-safety.cjs:85,94`).

| Sev | § | file:line | Finding | Fix |
|---|---|---|---|---|
| P2 | 14 | `ai.service.ts:480` | Per-vertical AI tone partial — `SYSTEM_PROMPTS[opts.intent]` keyed by intent not vertical; vertical only a one-line user-prompt hint. Sports vs school announcement share base system prompt. | branch system prompt on vertical |
| P2 | 14 | `onboarding.service.ts:134-155` | No sample-data auto-seed on signup → tenant lands on empty dashboard. Sample data only behind manual SUPER_ADMIN POST. | seed a vertical-appropriate starter playlist on first login |
| P2 | 14 | `sports-presets.ts` | Only **11** seeded SPORTS templates vs the Sprint-13 6-category ambition; several category tabs near-empty (palette tiles strong at 17). | build per-sport scoreboard/celebration/sponsor presets |
| P3 | 14 | `ensure-system-presets.ts:103` | FASHION not cross-tagged to RETAIL — sees only its 10 sig-fashion templates, not the 14 retail-presets. No sig-retail pack either. | dual-tag `['RETAIL','FASHION']` like the QSR/RESTAURANT pattern |
| P3 | 19 | `color-picker.tsx:386` | G1 brand-swatch frozen-hex (no live var re-theme). Systemic, low-impact. | emit `var(--brand-*)` from the brand presets |
| P3 | 19 | `PropertiesPanel.tsx:4744` | Last raw-JSON `businessHoursJson` (MUSIC_PLAYER), scalar object. | small object editor |
| P3 | 19 | `PropertiesPanel.tsx:~4635` | MS/Fitness scenes lack per-field size/color + comma-joined arrays. B+ ceiling for ~31 4K scenes. | extend StyleableField per-field gate beyond HS_* |

**No new costumes found.** Spot-checked imports page (honest), ANIMATED_BACKGROUND (deliberately avoids fabricating fields its renderer ignores), rotation/opacity (applied both sides).

## 4. Biggest risk
**Nothing in §12/§14/§19 is a launch blocker** — the "can't edit a single word" complaint is genuinely resolved. Largest *remaining* business risk is **§14 content depth**: SPORTS ships ~11 templates against a 6-category promise and no vertical auto-seeds starter content, so a fresh non-K12 tenant still opens to a thin/empty dashboard despite correct plumbing.
