# Section 12 — Design Imports (Import 2.0) — Pre-launch Final Audit

**Auditor:** Fable 5 (fresh frontier pass)
**Date:** 2026-06-10
**Scope:** Standard Audit Surface §12 (Design import integrations) — Import 2.0 (commit `ab8e0da0`): PPTX/PDF structural parse → editable templates, IMAGE fallback, the `/[schoolId]/templates/imports` UX, `/settings/imports` redirect, Canva/Slides/Figma honesty, and post-import editability.
**Verdict:** Genuinely good v2 — the PPTX path is real, structured, tested, and graceful. Three substantive gaps: a **decompression-bomb DoS (no uncompressed cap)**, a **PDF structured import that silently drops all graphics/images** (promise mismatch), and **zero automated coverage of the PDF parser**. No P0.

| Lens | Grade | One-line |
|---|---|---|
| DESIGN | A- | Brand-shell hero (`var(--brand-primary)`), 3-step rail, honest small-print, clean done-card with per-page edit list. |
| UX | A- | Drop → Preview → Add to Templates/Playlists in <30s; PDF inline preview; PPTX friendly card; no marketing wall. |
| FUNCTIONALITY | B | PPTX → real editable zones works end-to-end (tested). PDF structured = text-on-white (loses all graphics). Bomb/rate-limit gaps. |

**Coverage:** §12 **covered**. Sub-bullets: PDF/PPTX upload → template **covered**; Canva Connect / Google Slides (Drive) / PowerPoint Online (Graph) / Figma / Keynote — **N-A (honest future, no costume)**.

---

## What I verified against reality (not intentions)

- **Live endpoint deployed + guarded:** `curl -X POST https://venue-os.app/api/v1/imports/design` → **HTTP 403** (auth/CSRF reject of anon POST), not 404. Endpoint exists on the deployed `cf5772ae` build.
- **`pdfjs-dist@6.0.227` IS declared + installed** — `apps/api/package.json:61`, symlinked via `node_modules/.pnpm/pdfjs-dist@6.0.227`. (My first root-`node_modules` check missed the pnpm symlink — corrected.)
- **PDF ESM-import is runtime-viable, NOT dead:** `apps/api/tsconfig.json:3` = `"module": "nodenext"` and `apps/api/nest-cli.json` has **no** `"webpack": true` → NestJS builds with tsc, which **preserves dynamic `import()` verbatim** (not down-leveled to `require()`). Node 20 (`Dockerfile:2` `node:20-alpine`) supports native `import()` of ESM from CommonJS. So `await import('pdfjs-dist/legacy/build/pdf.mjs')` in `pdf-parser.ts:35` works at runtime. (Had this been `module: commonjs`, it would have been an `ERR_REQUIRE_ESM` → silent always-fallback; it is not.)
- **Canva/Slides/Figma honesty — CLEAN:** grep for `sign in with canva|connect canva|oauth|/auth/canva` across the imports UI + controller returns only **two doc-comment mentions** of "stage 2 Canva Connect" — **no OAuth button, no costume**. Hero copy frames it as "Drop a PowerPoint, PDF, Canva, or Slides **export**" (i.e. export-to-PDF/PPTX), which is honest. Matches the CLAUDE.md env-table note that Canva OAuth is unbuilt.
- **PPTX round-trip is genuinely tested:** `imports-parsers.spec.ts` synthesizes a real 2-slide .pptx with jszip and asserts EMU→%, `sz`→px, color, bold, font, image-zone media resolution, and the empty-parse → `[]` fallback. Solid.

---

## Findings

### P1 — Decompression-bomb (zip bomb): no uncompressed-size cap on PPTX parse
**Area:** `apps/api/src/imports/parsers/pptx-parser.ts`
The only input-size guard is the **compressed** 50 MB cap (`MAX_BYTES`, multer `limits.fileSize` at `imports.controller.ts:175`, also client-side). `parsePptx` then does `JSZip.loadAsync(buffer)` (`pptx-parser.ts:326`) and decompresses every part with `.async()` — slide XML (`:333,:395`) and **every referenced media file** (`:377` `f.async('nodebuffer')`) — with **no per-file or total uncompressed-byte ceiling**. A 50 MB OOXML zip trivially inflates to multiple GB (XML/PNG compress 100-1000×), OOMing the shared API pod. The `MAX_SLIDES=60` cap does **not** protect: the media loop iterates `allMediaPaths` (every media referenced by any slide) and decompresses each *before* the 60-slide limit applies, and per-slide XML decompression itself is unbounded. With `memoryStorage`, the full 50 MB is already resident, then the parser multiplies it.
**Severity rationale:** Auth-gated to ADMIN/CONTRIBUTOR (mitigates random-internet abuse), but a malicious/compromised contributor — or even a genuinely pathological legit deck — can take down the multi-tenant API for everyone. Not a P0 only because it requires an authenticated role.
**Fix:** Before decompressing, sum `zip.files[*]._data.uncompressedSize` and reject if total > a cap (e.g. 250 MB); and/or cap each `.async()` part and abort the whole import past a running budget. Add a unit test with a high-ratio fixture.

### P2 — PDF "Add to Templates" silently drops ALL graphics/images → text-on-white (promise mismatch)
**Area:** `imports.controller.ts:378-380`, `pdf-parser.ts` (`media: []`)
The PDF parser extracts **text only** (`page.getTextContent()`), returns `media: []`, and the controller builds with `resolveMedia: () => null` and **no `pageBackgroundUrl`** — the code comment at `:366-377` deliberately omits a background image because `<img src=*.pdf>` renders broken. Net result: an imported PDF *template* is **naked TEXT zones (`bgColor: 'transparent'`) on the template's `#ffffff` background** — every logo, photo, color block, and layout graphic from the original flyer is gone. The hero copy promises *"text **and images** come through as editable layers, not a flat picture."* For PDF that is **false** — images never come through, and a text-heavy flyer arguably looks **worse** than the old flat-image template. The small-print hedge ("anything we can't parse falls back to the page as a single image") does **not** save it: the fallback only fires when `built.length === 0`; any PDF with extractable text produces a structured text-only template and never falls back. (The original PDF *is* preserved pixel-faithfully in the always-created Playlist, so display-on-screen is fine — but the "Add to Templates" deliverable is degraded and over-promised.)
**Fix (pick one):** (a) rasterize each PDF page server-side to PNG and wire it as the `pageBackgroundUrl` z-0 layer (the builder already supports this — `import-builder.ts:65-80` is built + tested, just unused for PDF); or (b) make the PDF default land as the flat full-bleed template and offer "extract editable text" as an opt-in; or (c) at minimum, change the UI copy so PDF doesn't promise images come through. `pageBackgroundUrl` being fully wired-and-tested but never passed is the tell that this was a known cut.

### P2 — PDF parser has zero automated test coverage; full PDF runtime path unverified end-to-end
**Area:** `apps/api/src/imports/parsers/imports-parsers.spec.ts`
The spec exercises `parsePptx` with a real round-trip but **never invokes `parsePdf`** (grep: no `parsePdf` in any `*.spec.ts`). The PDF path depends on (a) an ESM dynamic-import of `pdfjs-dist/legacy/build/pdf.mjs` resolving under nest's tsc/CJS build on Node 20, and (b) the bottom-left→top-left transform + baseline line-grouping math in `groupItemsIntoZones`. Both are runtime-viable per the static analysis above, but **nothing proves the PDF→zones output is correct or that the ESM import resolves in the production container**. Graceful: any failure is caught (`imports.controller.ts:382`) and degrades to the flat WEBPAGE template, so it can't crash — but a regression (pdfjs major bump, Docker layout change) would silently turn every PDF import into a flat fallback with no test or alert.
**Fix:** Add a `parsePdf` round-trip test against a tiny generated/committed PDF asserting page count + at least one positioned TEXT zone; assert `loadPdfjs()` returns non-null in the test env.

### P3 — No rate limit / abuse cap on the import endpoint
**Area:** `imports.controller.ts` (`@Post('design')`)
No `@Throttle`/rate-limit decorator (grep confirms none on the controller). Each call uploads up to 50 MB to Supabase + creates Asset/Playlist/Template (+ per-slide media uploads for PPTX). A loop of large uploads = storage bloat + egress cost + DB row spam. Auth-gated, so lower risk, but combined with the bomb finding it's the same "expensive authenticated endpoint with no governor" class. **Fix:** add a modest per-tenant throttle (e.g. N imports/min) and consider a daily import-bytes budget.

### P3 — 0-byte / empty uploads create junk Asset+Playlist+Template rows
**Area:** `imports.controller.ts:193` (only `!file` is rejected)
A 0-byte file with an accepted mime/extension passes `fileFilter`, uploads an empty object, and creates a 0-byte Asset, a 1-item Playlist, and (for `template`) a flat template — then the parse throws and falls back. No crash, but junk rows accumulate and a blank board can reach a screen. **Fix:** reject `file.size === 0` (and arguably a tiny floor like <100 bytes) up front with a clear message.

### P3 — `/settings/imports` redirect is client-side JS, documented as "permanent redirect"
**Area:** `apps/web/src/app/[schoolId]/settings/imports/page.tsx:42`
The stub does `router.replace()` in a `useEffect` (client-side, requires JS). CLAUDE.md / controller comments call it a "permanent redirect for muscle memory." It is **not** a 301 — fine for an authed SPA (bookmarks/training links resolve), but it won't behave like a true permanent redirect for crawlers/no-JS. Functionally adequate; flagged only for doc accuracy. No action required pre-launch.

---

## Malformed-file behavior matrix (traced, not assumed)

| Input | Behavior | Verdict |
|---|---|---|
| Non-zip / garbage bytes | `JSZip.loadAsync` throws → controller `catch` (`:382`) → flat fallback template | HANDLED (tested: `spec` line 220) |
| Corrupt OOXML (bad slide XML) | per-slide `try/catch` (`pptx-parser.ts:398`) skips the slide, rest survive | HANDLED |
| Encrypted PDF | pdfjs `getDocument` throws (PasswordException) → `catch` → flat WEBPAGE-iframe fallback | HANDLED (degrades to PDF-in-iframe; acceptable) |
| 0-byte file | passes filter → empty Asset/Playlist/Template, parse throws → flat fallback | WEAK (junk rows — P3 above) |
| 200-slide deck | `MAX_SLIDES=60` / `MAX_PDF_PAGES=40` cap template count; `MAX_ZONES_PER_SLIDE/PAGE=80` cap zones | HANDLED (but media decompresses before slide cap — see P1) |
| Zip bomb (high-ratio) | **NOT capped** — unbounded decompression | **NOT HANDLED (P1)** |
| Oversized (>50 MB) | rejected client (`page.tsx:110`) + server (multer `limits.fileSize`) | HANDLED |

---

## Editability of imported templates afterwards — YES (the core promise holds for PPTX)

- **Structured path:** imports persist real `TemplateZone` rows with `widgetType: 'TEXT' | 'IMAGE'` and a `defaultConfig` (content/fontSize/color/bold/alignment/fontFamily for TEXT; assetUrl/fit for IMAGE) — **identical in shape to system-preset zones**. The V2 builder (`BuilderShell` → zones → `PropertiesPanel`/`StyleableField`) edits these as first-class widgets. So an imported PPTX yields zones the operator can click and edit field-by-field — this is the headline fix vs. the old "flat image in assets" and it is real.
- **Flat fallback path:** single IMAGE zone (`assetUrl`, swappable) or WEBPAGE zone (`url`, editable) — also editable, just one zone.
- The PPTX dedup/naming (`uniqueTemplateName`), multi-page "— Slide N" labels, per-page edit list in the done-card (`page.tsx:514`), and AuditLog row (`IMPORT_DESIGN`, `:495`) are all correct and complete.

---

## Out of scope but observed
Live `GET /api/v1/health` reports `status: degraded`, `db: degraded` (redis ok) on the `cf5772ae` deploy at audit time. Not a design-imports issue — flagging for whoever owns §17/ops (possible pooler hiccup; CLAUDE.md `connection_limit` note is the usual root cause).

## Solid / verified-good (do not re-report)
- PPTX structured parse → editable zones: real, tested round-trip; EMU/sz/color math correct; graceful empty-parse + non-zip fallback.
- pdfjs-dist declared + installed; ESM dynamic-import runtime-viable under nodenext + tsc (no webpack) on Node 20.
- Filename sanitization (control chars, bidi/zero-width strip, NFC, 200-char cap), Supabase-error redaction, playlist/template `(N)` dedup, AuditLog write, CONTRIBUTOR→PENDING_APPROVAL gating — all present and correct.
- Brand-shell UX, honest 3-step copy, no Canva/Slides/Figma OAuth costume.
- 50 MB cap enforced client + server.
