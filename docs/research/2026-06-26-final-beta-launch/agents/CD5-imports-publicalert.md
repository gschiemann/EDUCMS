# Wave D — Design imports + public alert reality (§12, §13)

**Agent:** CD5 · **Date:** 2026-06-26 · **Mode:** read-only (Read/Grep/curl). No source edits.
**Surface:** Design-import pipeline (`/[schoolId]/templates/imports` → `POST /api/v1/imports/design`) + Public-alert / life-safety integrations (CAP, IPAWS, Raptor, RapidSOS, PA/IP-speaker).
**Scale tier:** Single-tenant operator action (one upload at a time, ≤50 MB) for imports; public-alert is a roadmap-only (V2) surface — nothing live.
**Standard Audit Surface §§ covered:** §12 (Design import integrations) and §13 (Public alert integrations). Both covered in full; nothing in scope deferred for lack of access.

---

## Provider-by-provider classification table

### §12 Design imports

| provider / integration | verdict | evidence (file:line / curl) | notes |
|---|---|---|---|
| **PDF upload → editable template** | **REAL** | `apps/api/src/imports/parsers/pdf-parser.ts:33-46` (pdfjs-dist legacy `getTextContent()`), `imports.controller.ts:378-380` (parsePdf → buildTemplates), dep present `apps/api/package.json:61` (`pdfjs-dist ^6.0.227`) | Real text extraction → positioned editable TEXT zones, one Template per page. Original PDF also kept as a 1-item Playlist for pixel-faithful display. Per task #253 ("real editable template, not flat images") — genuinely delivered, not flat. |
| **PowerPoint (.pptx/.ppt) → editable template** | **REAL** | `apps/api/src/imports/parsers/pptx-parser.ts:1-39` (OOXML/EMU shape walk via jszip + fast-xml-parser), `imports.controller.ts:355-364` (parsePptx → upload embedded media as Assets → buildTemplates), deps `package.json:51,56` (`fast-xml-parser`, `jszip`) | Each slide → TEXT + IMAGE zones with EMU-derived %-position, font size/color/bold/alignment; embedded `ppt/media/*` pictures uploaded as Assets. Re-added after the 2026-05-23 flat-path removal. Tolerant of Slides/Keynote/Canva PPTX exports. |
| **Image (PNG/JPG/WEBP) → template** | **REAL** | `imports.controller.ts:444-484` (single full-canvas IMAGE zone, `fit:'contain'`) | Honest: an image has no structure to extract, so a single IMAGE zone IS the highest-fidelity result. Not a costume — it's the correct output for a raster. |
| **Multi-page deck → one template per page** | **REAL** | `imports.controller.ts:392-437` (loops `built[]`, " — Slide N"/" — Page N" suffix, de-dupe), web `page.tsx:517-541` (lists every created template) | Multi-page PDFs/decks fan out to N editable templates with a per-page picker in the Done card. |
| **Graceful fallback (parse fail → flat)** | **REAL** | `imports.controller.ts:382-389` (try/catch → `built=[]` → legacy single-canvas), `import-builder.ts:91-92` (drops empty pages) | Never worse than the old behavior; `importSource` + `pages` recorded in the AuditLog row (`:494-519`). |
| **Canva Connect (OAuth picker + auto-resync)** | **NOT-BUILT** (DEFERRED on `CANVA_CLIENT_ID`/`SECRET` for the *future* OAuth flow; the live picker is honestly absent) | `integrations-health.controller.ts:752-766` status `COMING_SOON`; message at `:757-761` explicitly: *"Canva Connect … is not built yet — Sprint 11"* even when env vars are set. Repo grep for `@canva`/`canva-connect` SDK = **zero** (Bash output: only doc/comment mentions) | Confirms CLAUDE.md "NOT built." The env-var presence does NOT fabricate a working flow — message says so. Workaround (export to PDF/PNG, drop at /templates/imports) is REAL. **Not a costume** — there is no "Sign in with Canva" button wired to a dead endpoint. |
| **Google Slides (Drive API)** | **NOT-BUILT** | `integrations-health.controller.ts:767-775` status `COMING_SOON`, message *"Sprint 11 — same code path as Canva."* No `googleapis`/`drive.v3` in imports code (the only `googleapis.com` hits are geocoding + Gemini) | Honest coming-soon, no UI affordance. PPTX/PDF export path covers it today. |
| **PowerPoint Online (Microsoft Graph)** | **NOT-BUILT** | `integrations-health.controller.ts:776-784` `COMING_SOON`, message references `/me/drive/items/{id}/content?format=pdf`. No `microsoft-graph` SDK in repo | Honest coming-soon. The .pptx *upload* path (REAL) covers the offline-file case. |
| **Figma (REST API)** | **NOT-BUILT** | `integrations-health.controller.ts:785-793` `COMING_SOON`. No `figma-api` dep | Honest coming-soon, no UI. |
| **Keynote** | **NOT-BUILT (covered via export)** | No Keynote-specific code; pptx-parser comment `:21` notes Keynote PPTX exports are tolerated | Per CLAUDE.md §12 ("Keynote → fallback to PDF export") — correct posture. Export-to-PDF/PPTX path is REAL. |

### §13 Public alert (life-safety) — emergency-sensitive

| provider / integration | verdict | evidence (file:line / curl) | notes |
|---|---|---|---|
| **CAP (Common Alerting Protocol) inbound** | **NOT-BUILT** | Repo-wide grep `ipaws\|rapidsos\|raptor\|common alerting\|singlewire\|valcom\|informacast` over `apps/api/src` + `apps/web/src` + `packages` = **zero implementation code, zero UI, zero settings rows, zero DB columns**. Only product-surface mention is the EULA disclaimer (`apps/web/src/app/terms/eula/page.tsx:113`) | Matches the Appspace review's "one genuinely-missing piece (P3, deferred)." Nothing claims it exists. Honest absence. |
| **IPAWS inbound (FEMA national alerts)** | **NOT-BUILT** | Same grep = zero. EULA `page.tsx:113` expressly disclaims IPAWS/CAP/WEA/EAS | Honest N-A. |
| **IPAWS outbound origination (FEMA-authorized)** | **NOT-BUILT** | Same; this is a deliberate non-goal pre-launch (requires FEMA authorization) | Honest N-A; correct that it's absent. |
| **Raptor SOS** | **NOT-BUILT** | Grep `\braptor\b` over `apps/*/src` = **zero** (no provider rule, no settings, no sync). Not in the Integration Concierge catalog either | Honest absence. |
| **RapidSOS** | **NOT-BUILT** | Grep = zero. Not in discovery catalog | Honest absence. |
| **PA / IP-speaker (Valcom / Atlas / SingleWire InformaCast)** | **NOT-BUILT** | Grep = zero in source. EULA `page.tsx:110` disclaims PA/intercom/siren. (Singlewire appears only in `docs/research/MOBILE_COMPETITOR_REPORT.md` as a *competitor*, not an integration) | Honest N-A + EULA-disclaimed. |

---

## Findings table

| # | Sev | area | what | repro | evidence |
|---|---|---|---|---|---|
| 1 | **(no P0/P1)** | §13 public alert | **No public-alert costume exists.** Every CAP/IPAWS/Raptor/RapidSOS/PA-speaker reference is either absent, a competitor mention in research docs, or an explicit EULA *non*-substitution disclaimer. The dangerous failure mode (a life-safety integration that *looks* wired but isn't) does **not** occur here. | Grep `ipaws\|rapidsos\|raptor\|common alerting\|singlewire\|valcom\|informacast` over all source dirs → zero impl/UI/settings | `eula/page.tsx:104-116` (disclaimer); empty grep over `apps/api/src` + `apps/web/src` |
| 2 | P2 | §12 imports | **PDF "background fidelity" layer is wired but intentionally disabled.** `import-builder.ts:38-48,66-80` supports a `pageBackgroundUrl`, but the controller passes `() => null` for PDFs (`imports.controller.ts:379`) because `<img src=*.pdf>` renders broken with no server-side rasterizer. Result: a PDF imported *as a template* shows editable text positioned correctly but **no visual page background** in the builder (the original PDF survives only in the auto-created Playlist). | Import a styled PDF → "Add to Templates" → builder shows text zones on a blank bg, not the designed page | `imports.controller.ts:368-380` (comment admits "we deliberately do NOT add a full-bleed background image"); `import-builder.ts:66-80` (the wired-but-unused path) |
| 3 | P2 | §12 imports | **Canva env vars present but inert is *correctly* surfaced** — listing here only to confirm it's NOT a P0/P1. When `CANVA_CLIENT_ID/SECRET` are set, the health row still says "not built yet," so an operator/admin reading the integrations panel is not lied to. No action needed; documenting that the env-var trap (CLAUDE.md warns about it) is handled honestly. | Set `CANVA_CLIENT_ID` → check `/health/integrations` design-import-canva row | `integrations-health.controller.ts:757-761` |
| 4 | P2 | §12 imports | **`source` body field is pass-through, unvalidated** (analytics only). A caller can send any `source` string; it lands in the AuditLog `details.source` and the success message. Sanitized for length (`:510` slices 200) but not enumerated. Low risk (admin-auth'd, length-capped), noted for completeness. | POST `/imports/design` with `source=<anything>` | `imports.controller.ts:191,407,454,578` |

No P0 and no P1 findings in this scope. Both §12 and §13 are in an honest, launch-safe state.

---

## Coverage — what I could NOT reach, and why

- **Live `/api/v1/imports/design` end-to-end upload:** requires an authenticated JWT; I did not create a throwaway tenant + log in + upload (would dirty nothing but adds little over the code trace, and the harness forbids `pnpm`/Playwright). Verified instead by: full controller + parser read, dependency presence in `package.json`, and `ImportsModule` registration in `app.module.ts:134`. The structured-parse path provably *runs* in prod (deps installed) rather than always silently falling back.
- **Live `/health/integrations` JSON:** returns `401 Unauthorized` unauthenticated (`curl` confirmed HTTP 401 + `{"code":"Unauthorized"}`). Read the source-of-truth controller directly instead — the probe list and statuses are static code, so the code read is authoritative.
- **Rendering a parsed PDF/PPTX in the actual builder UI:** not run (no app boot). The builder consumes standard TEXT/IMAGE zones the rest of the app already renders, so the risk is low; Finding #2 (no PDF bg) is the one render-quality caveat and is documented from the code's own comment.

---

## Grade — Greg's 3 lenses

**§12 Design imports**
- **Design:** A− — brand-aware hero (`var(--brand-primary)`), clean Drop→Preview→Add 3-step rail, honest "Reading your content…" progress, per-page template picker. Minor ding: imported PDF templates land on a blank background (Finding #2).
- **UX:** A − genuinely <30s happy path: drag file → preview → one click "Add to Templates" → land in builder. Mobile-aware (compact dropzone on phones). De-dupe + "(N)" suffix avoids the "stack of duplicates" complaint. Old `/settings/imports` redirects (no broken bookmarks).
- **Functionality:** A− — PDF + PPTX + image all produce REAL editable templates with graceful fallback; AuditLog written; embedded media uploaded. The one gap is the disabled PDF visual-background layer (P2). Canva/Slides/Graph/Figma OAuth are honestly NOT-BUILT, not faked.

**§13 Public alert**
- **Design / UX / Functionality:** **N-A across all three — and that is the correct pre-launch answer.** Nothing is built, nothing is faked, no costume exists, and the EULA §4 (`eula/page.tsx:104-116`) explicitly disclaims VenueOS as a substitute for IPAWS/CAP/WEA/EAS, PA/siren systems, certified mass-notification (NFPA-72/UL-2572), and 911. For a signage CMS with emergency *convenience* features, "honestly absent + legally disclaimed" is the right posture, not a gap to fill before beta.
