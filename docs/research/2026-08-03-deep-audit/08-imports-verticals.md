# §12 Imports + §14 Multi-vertical audit — 2026-08-03

Scope as assigned: §12 Design import integrations, §14 Multi-vertical surface. No scope-down. Read-only; every claim below is code-verified. Two claims are explicitly labelled UNVERIFIED.

## Coverage table

| Bullet | Status | D | UX | F | Note |
|---|---|---|---|---|---|
| §12 PDF/PPTX upload → Template *or* Playlist (Sprint 10) | covered | A− | A− | B+ | REAL. Structural parse → per-page editable zones (`imports.controller.ts:349-488`). PPTX path solid; PDF path at risk (F-2) |
| §12 Canva Connect OAuth (Sprint 11) | N-A (not built) | — | — | N-A | Still true. No controller/token exchange/model. UI does **not** over-promise (F-9 is a wording nit only) |
| §12 Google Slides via Drive API | N-A | — | — | N-A | `integrations-health.controller.ts:792-799` COMING_SOON, honest |
| §12 PowerPoint Online via Graph | N-A | — | — | N-A | `integrations-health.controller.ts:801-808` COMING_SOON. Note: local `.pptx` upload IS built, which is the useful 90% |
| §12 Figma | N-A | — | — | N-A | `integrations-health.controller.ts:810-817` COMING_SOON |
| §12 Keynote (PDF-export fallback) | covered-implicitly | C | C | B | Works (Keynote→PDF→import; `pptx-parser.ts:20-22` explicitly tolerates Keynote exports) but Keynote is named **nowhere** in operator UI or health rows |
| §12 Route is `/[schoolId]/templates/imports` + permanent redirect | covered | A | A | A | `settings/imports/page.tsx:44` `router.replace`; inbound link kept at `settings/developer/page.tsx:203` |
| §12 Templates page primary "Import design" button | covered | A | A | A | `templates/page.tsx:1512`, viewer-disabled with tooltip |
| §12 Brand shell (not stranded slate) | covered | A | A | A | Hero + every CTA read `var(--brand-primary)` (`imports/page.tsx:168-360`) |
| §12 File-type validation + size caps | covered | — | A− | B+ | Dual-gate: `fileFilter` mime allowlist + octet-stream only when `/\.pptx?$/` (`imports.controller.ts:176-186`); 50 MB both sides |
| §12 Malicious-file handling | covered | — | — | B | pdfjs `isEvalSupported:false / disableFontFace / useSystemFonts:false` (`pdf-parser.ts:172-174`), zip-bomb ceiling 250 MB (`pptx-parser.ts:337-345`), filename NFC + bidi-strip (`imports.controller.ts:128-153`). Gaps: F-6 |
| §14 Copy in DistrictSchoolsCard | covered (deliberately unified) | B | A | A | See F-8 — spec-vs-code contradiction, not a bug |
| §14 Vertical-specific default templates | covered 12/12 | A− | A | A− | Every vertical has a non-empty gallery; see parity table |
| §14 Sample data per vertical | covered 12/12 | — | A | A | `sample-data.service.ts:26-39` |
| §14 Vertical-aware billing tier names | **gap** | C | C | D | F-1 — worst finding in scope |
| §14 Per-vertical AI prompts | covered 12/12 | A | A | A | `verticals.ts:497-668` chips + `ai.service.ts:218-282` voice + `verticals.ts:717-730` design affinity, all wired |
| §14 Per-vertical brand-wizard sample URLs | covered 12/12, drifted | B | B+ | B | F-3 |
| §14 brand-applyToTemplates covers vertical widget sets | covered | — | B− | B | Controller does cover it (accentColor + EXTERNAL_HTML `brand` tokens); see F-4, F-5 |
| §14 "Add a [noun]" matches vertical | deliberately N-A | — | A | A | Unified to "Location"/"Primary" by operator 2026-06-01 |

## Per-vertical parity table

Counts are seedable presets (kiosks = 18 tagged `['ALL']`, `ensure-system-presets.ts:413-430`, included in every row). Quarantine = `packages/api-types/src/quarantine.ts:25-54`.

| Vertical | Copy | Default templates (source) | Sample data | Billing tier name | AI prompts (chips/voice/affinity) | Wizard URLs | "Add a X" | Grade |
|---|---|---|---|---|---|---|---|---|
| K12 | ✅ | ~124 general + `preset-hs-*` + 18 kiosk | ✅ streams | ⚠ raw enum | ✅ / ✅ / ✅ | ✅ 3 | Location (unified) | A |
| GYM | ✅ | 19 `fitness-presets` + 5 sig-gym + 18 | ✅ streams | ⚠ | ✅ / ✅ / ✅ | ✅ 3 | Location | A |
| RETAIL | ✅ | 8 `retail-presets` + 8 sig-retail + 10 sig-fashion (dual) + 18 | ✅ retail POS | ⚠ | ✅ / ✅ / ✅ | ✅ 3 | Location | A |
| CORPORATE | ✅ | 12 sig-corporate + office + real-estate + 18 (−1 quar.) | ✅ streams | ⚠ | ✅ / ✅ / ✅ | ✅ 3 | Location | A |
| QSR | ✅ | 21 `restaurant-presets` + 34 sig-qsr + 18 (−6 quar.) | ✅ menu POS | ⚠ | ✅ / ✅ / ✅ | ✅ 3 | Location | A |
| FASHION | ✅ | 10 sig-fashion + 8 retail (dual) + 8 sig-retail (dual) + 18 (−2 quar.) | ✅ retail POS | ⚠ | ✅ / ✅ / ✅ | ✅ 3 | Location | A |
| BAR | ✅ | 6 `bar-presets` + 16 sig-bar + 18 (−1 quar.) | ✅ menu POS | ⚠ | ✅ / ✅ / ✅ | ✅ 3 | Location | A |
| HEALTHCARE | ✅ | 10 sig-healthcare + 2 vet + 1 clinic + 18 | ✅ streams | ⚠ | ✅ / ✅ / ✅ | ✅ 3 | Location | A |
| HOSPITALITY | ✅ | 10 sig-hospitality + 1 museum + 18 (−**5** quar.) | ✅ streams | ⚠ | ✅ / ✅ / ✅ | ✅ 3 | Location | B (F-10) |
| RESTAURANT | ✅ | 10 sig-menus-pos + ~18 QSR dual-tagged + 18 (−1 quar.) | ✅ menu POS | ⚠ | ✅ / ✅ / ✅ | ✅ 3 | Location | A |
| SPORTS | ✅ | 15 `sports-presets` + 7 scoreboard/ribbon/scorebug + 18 | ✅ streams | ⚠ | ✅ / ✅ / ✅ | ✅ 3 | Location | A |
| WORSHIP | ✅ | 8 `worship-presets` + 48 sig-worship + 18 | ✅ streams (added 06-27) | ⚠ | ✅ / ✅ / ✅ | ✅ 3 | Location | A |

**⚠ billing** is the *same* defect in every row (F-1), not a per-vertical variance.

**Costume-class check (2026-06-27 finding) — CLOSED.** Two independent sweeps over all 193 `public/templates/**/*.html`: (a) zero boards missing `educms-field-click` / `_edit-shim`; (b) zero boards with no `data-field`/`data-imgslot`/`data-action`. The EXTERNAL_HTML packs that constitute the entire gallery for BAR / HOSPITALITY / HEALTHCARE / CORPORATE / FASHION / WORSHIP are click-to-edit-armed. Also confirms the 2026-07-24 portrait-regex fix (`ensure-system-presets.ts:229-240`) held — no industry falls back to the K12 default.

## Findings

**[P1] F-1 — Two disjoint license-tier vocabularies; the billing page renders a raw legacy enum, including vertical-flavoured `EDU_DISTRICT` / `RESTAURANT_CHAIN`, on any tenant.** Evidence: catalog is `FREE_TRIAL|MONTHLY|ANNUAL|COMP|CUSTOM` (`packages/api-types/src/billing.ts:24-29`); the SUPER_ADMIN setter allowlist is a *disjoint* set `PILOT|STANDARD|ENTERPRISE|EDU_DISTRICT|RESTAURANT_CHAIN` (`apps/api/src/license/super-license.controller.ts:7`, enforced at `:145`); a no-license tenant defaults to `tier:'PILOT'` (`apps/api/src/license/license.service.ts:79`). `license.controller.ts:29` does `tierName: tierDef?.name || summary.tier` — `getLicenseTier('PILOT')` is `undefined`, so the raw enum passes through, and `apps/web/src/app/[schoolId]/settings/billing/page.tsx:322` renders `license?.tierName || license?.tier` verbatim. Impact: (a) every trial tenant in every vertical sees the raw token "PILOT" as their plan name; (b) an operator-comped Sports/QSR tenant can be set to `EDU_DISTRICT` and will read "EDU_DISTRICT" — the exact §14 bullet violation; (c) a SUPER_ADMIN **cannot set any tier that exists in the sold catalog**. `LicenseCard.tsx:38-44` already has the friendly map (`EDU_DISTRICT → tierEducation`) — the billing page just doesn't use it. Fix sketch: make `ALLOWED_TIERS` derive from `LICENSE_TIERS` plus an explicit legacy-accept set; give `license.controller.ts` a legacy→label map; have the billing page fall back through `TIER_LABEL_KEY` before printing a raw enum. **NEW.**

**[P1] F-2 — Structured PDF import may be a silent costume on the production runtime, and its failure mode is indistinguishable from success.** `apps/api/package.json:64` pins `pdfjs-dist: ^6.0.227`; the lockfile records `engines: {node: '>=22.13.0 || >=24'}`. Both `Dockerfile:2` and `Dockerfile:65` are `node:20-alpine`. `pdf-parser.ts:33-46` swallows *every* import error and returns `null`; `imports.controller.ts:385-392` catches and sets `built = []`; the operator then gets `imports.controller.ts:545-546` — a cheerful "Imported … as PDF. A new template is in your Templates gallery" — for what is actually a non-editable full-canvas `WEBPAGE` iframe (`:449-452`). The only trace is `importSource:'flat-fallback'` buried in the AuditLog JSON (`:519`). **Whether the dynamic import actually throws on Node 20 is UNVERIFIED** (cannot build or run in this pass); the *silence* is fully verified and is the real defect either way. Fix sketch: log-and-surface a distinct `importSource` in the response so the UI can say "we couldn't read the text layer — imported as a page image"; add a boot-time smoke import of pdfjs; align the Docker base with the declared engine. **NEW.**

**[P2] F-3 — BrandingWizard never converged on the canonical per-vertical sample map, and its unknown-vertical fallback is K12.** `packages/api-types/src/verticals.ts:326-329` states `VERTICAL_SAMPLE` exists so "the three UI surfaces that previously hard-coded their own copies (BrandingWizard `EXAMPLES_BY_VERTICAL` + `PLACEHOLDER_BY_VERTICAL`, DistrictSchoolsCard COPY) can converge on one map and never drift again." DistrictSchoolsCard did converge (`DistrictSchoolsCard.tsx:21,249`). BrandingWizard did not: it still owns both maps (`BrandingWizard.tsx:120-192`, `:201-214`) and imports nothing from `@cms/api-types` (verified against its full import block, `:16-41`). Both local maps happen to cover 12/12 today, so this is drift-risk not a live hole — except that `examplesForVertical` (`:193-196`) and `placeholderForVertical` (`:215-218`) both default the *unknown/unset* vertical to `K12`, so a tenant with no vertical is shown Harvard/Stanford and `yourschool.org`. `NEUTRAL_SAMPLE` (`verticals.ts:367-372`) exists precisely for this and is unused here. **KNOWN(2026-06-27 per-vertical beta finding) — partially closed.**

**[P2] F-4 — `apply-brand-to-zone.ts` is a stale partial fork of the shipped brand-apply logic; its tests validate code that never runs.** The file's header claims "the controller … owns the transaction + audit-log; this file owns the math" (`apply-brand-to-zone.ts:5-7`), but `patchZoneForBrand` (`:71-91`) only patches `color` + `fontFamily`. The live path (`branding.controller.ts:800-833`) additionally patches `accentColor` — the key "60+ widgets across restaurant / retail / sports / fitness packs consume directly" — and, for `EXTERNAL_HTML` zones, builds the whole `cfg.brand` token map the baked shim reads. Only importer of the helper is its own spec (verified by repo-wide grep). Impact: the regression suite protects the wrong implementation; a future refactor "back onto the helper" would silently un-brand every vertical's signage pack. Fix sketch: delete the helper and test the controller path, or port the two missing branches into it and make the controller call it.

**[P2] F-5 — Apply-brand is a no-op for a fresh tenant in any vertical.** `branding.controller.ts:760` filters `where: { tenantId, isSystem: false }`, and `:766` returns "No custom templates to re-skin. System presets are intentionally left alone." A brand-new tenant's gallery is 100% system presets, so the branding wizard's headline action reports zero. Mitigated (not fixed) by `POST templates/from-preset/:presetId` (`templates.controller.ts:2012`) cloning a preset into a tenant-owned row. Fix sketch: when count is 0, return copy that names the next step ("Use a template first, then re-run") rather than an internal rationale.

**[P2] F-6 — PPTX embedded-media extraction has no count cap, no per-image size cap, and no parse timeout.** `pptx-parser.ts:390-408` iterates every `ppt/media/*` entry with only the 250 MB inflated-total guard upstream (`:337-345`); `imports.controller.ts:595-638` then uploads each one **serially** to Supabase and creates an Asset row per image, inside the HTTP request, with no ceiling. A 50 MB deck with a few thousand tiny PNGs yields a few thousand uploads + rows in one request. Neither `parsePptx` nor `parsePdf` is wrapped in a timeout/AbortSignal. Slide/zone counts *are* capped (`MAX_SLIDES=60`, `MAX_ZONES_PER_SLIDE=80`) — media is the uncapped axis. Fix sketch: `MAX_MEDIA` cap + per-image byte cap, `Promise.all` with concurrency, and a wall-clock budget around both parsers.

**[P2] F-7 — The design-import health row still describes the pre-Import-2.0 behaviour.** `integrations-health.controller.ts:767-771` names the row "Drop a PDF / image" and says "we turn it into Asset + Playlist rows" — PPTX is missing from the name and the editable-template outcome is missing from the message. Contradicts `imports.controller.ts:530-546` and the page's own hero (`imports/page.tsx:186-189`). Truthfulness regression in the opposite direction from the usual (undersells). The adjacent Canva row (`:781-786`) is exactly right and closes the 2026-05-28 re-verify item — **KNOWN(`docs/research/2026-05-28-opus48-audit/22-…-REVERIFY.md:43`) now CLOSED.**

**[P2] F-8 — CLAUDE.md's §14 bullet contradicts shipped, operator-mandated behaviour, and 13 dead COPY entries remain.** The audit surface requires "'Add a [noun]' buttons match the vertical (School / Location / Store / Gym / …)". `DistrictSchoolsCard.tsx:187-192` hard-returns `COPY.OTHER` for every vertical per the 2026-06-01 unification ("every account is a Location, the top-level is the Primary"), echoed in `vertical-copy.ts:124-132`. So all 13 per-vertical `COPY` entries (`:59-185`) are unreachable. Any future audit will re-flag this as a gap. Fix sketch: amend the CLAUDE.md bullet to record the unification, and delete or `@deprecated`-mark the dead entries.

**[P2] F-9 — 10 orphaned worship board files.** `apps/web/public/templates/signage/church/` holds 10 HTML boards; `system-presets.ts` contains **0** references to `signage/church` and no live `preset-sig-church-*` id (the map entry was deliberately removed, `ensure-system-presets.ts:213-219`). They ship in the Next.js public bundle but are unreachable from any gallery. The replacement `signage/worship/` set (24 boards → 48 landscape+portrait presets) is live and correct.

**[P2] F-10 — HOSPITALITY lost half its signage pack to quarantine.** 5 of 10 `signage/hospitality/*` boards are on the denylist (`quarantine.ts:41-44,51`), leaving 5 industry boards + 1 borrowed museum board. It is the thinnest industry-specific gallery of the 12 (kiosks pad the count but are generic). Not a launch blocker — flagging because the remediation ticket for these boards appears unclosed while the fashion ones were fixed 2026-07-23.

**[P2] F-11 — The imports page is the only major operator flow with zero i18n.** `templates/imports/page.tsx` has **0** `useTranslations`/`next-intl` references; every string (`"Import a design"`, `"Add to Templates"`, all four error strings, all six DoneCard messages) is a hard-coded English literal. Its own deprecated redirect stub *is* translated (`settings/imports/page.tsx:34,47`). Server-side messages (`imports.controller.ts:200-202`, `:535-552`) are English-only too. Spanish/Chinese shipped 2026-07-22. **KNOWN-class** (the "literal-t() sweeps miss keys held in maps" trap) but this file was missed entirely, not partially.

## Unverified / open questions

1. **Does `import('pdfjs-dist/legacy/build/pdf.mjs')` actually succeed on Node 20?** Determines whether F-2 is "latent risk" or "PDF structured import has never worked in prod." One `node -e` on the Railway image settles it. A `SELECT details->>'importSource' FROM audit_logs WHERE action='IMPORT_DESIGN'` in prod answers it empirically — `flat-fallback` on every PDF confirms.
2. **Is `PILOT` the tier every live tenant currently carries?** Depends on whether any `License` rows exist. Would set F-1's blast radius (all tenants vs only comped ones).
3. **Multi-page PDF/PPTX truncation** (`MAX_PDF_PAGES=40`, `MAX_SLIDES=60`) is silent — the success message reports the produced count with no "we stopped at 40 of 112". Flagged as an honesty question rather than asserting a defect.
4. **Keynote** is functionally supported (via PDF/PPTX export) but named nowhere an operator would look. Product call, not a code defect.
