# Section 12 — Design Imports (Import 2.0)
**Audit date:** 2026-06-10  
**Auditor:** Sonnet 4.6 subagent  
**Commit audited:** ab8e0da0 (Import 2.0) + cf5772ae (audit fixes batch)  
**Status:** covered

---

## Coverage Table

| Sub-area | Coverage | Design | UX | Functionality |
|---|---|---|---|---|
| PPTX parser (EMU→%, font, media) | covered | A | A | A |
| PDF parser (pdfjs-dist, text zones) | covered | B | B | B |
| Import builder (ParsedDoc→Template) | covered | — | — | A |
| Malformed file handling | covered | — | — | B |
| Size caps (50 MB frontend + backend) | covered | — | — | A |
| ZIP bomb protection | covered | — | — | **D** |
| 0-byte / corrupt OOXML / corrupt PDF | covered | — | — | B |
| Encrypted PDF | covered | — | — | B |
| 200-slide deck cap | covered | — | — | A |
| UX at /[schoolId]/templates/imports | covered | A | A | A |
| /settings/imports redirect | covered | A | A | A |
| Brand shell on import page | covered | A | — | A |
| Page previews before submit | covered | B | B | B |
| Create-as-Template landing | covered | A | A | A |
| Create-as-Playlist landing | covered | A | A | A |
| Canva Connect / Google Slides / Figma honesty | covered | — | A | A |
| Imported templates editable in builder | covered | — | — | A |
| AuditLog on import | covered | — | — | A |
| CONTRIBUTOR RBAC on import-as-template | covered | — | — | **C** |
| Error copy after PPTX re-enable | covered | — | UX **D** | — |

---

## What Ships in Import 2.0

The Import 2.0 commit (ab8e0da0) delivers a genuine structural parser:

**PPTX path:** JSZip opens the archive, `pptx-parser.ts` walks `p:sld → p:cSld → p:spTree`, extracts every `<p:sp>` (text) and `<p:pic>` (image), converts EMU coordinates to %-of-canvas, maps `sz` hundredths-of-a-point to px fontSize, and resolves embedded `ppt/media/*` pictures to uploaded Assets. The math is correct (EMU_PER_INCH=914400, PX_PER_INCH=96, 12192000 EMU = 1280px). Caps: MAX_SLIDES=60, MAX_ZONES_PER_SLIDE=80, MAX_TEXT_LEN=5000.

**PDF path:** pdfjs-dist legacy build (headless Node, no canvas), `page.getTextContent()` → baseline-grouped TEXT zones. PDF visual fidelity is preserved in the auto-created Playlist (the PDF file itself) while text zones are editable in the template. The `pageBackgroundUrl` hook exists for a future rasterizer. Cap: MAX_PDF_PAGES=40.

**Import builder:** pure, side-effect-free `buildTemplates(doc, {resolveMedia})` maps `ParsedDocument → BuiltTemplate[]`. IMAGE zones without a resolved media URL are dropped rather than persisted broken.

**Graceful fallback:** ALL structured paths are wrapped in try/catch. Any throw or empty-pages result falls to the legacy single-IMAGE (for images/PDFs) or single-WEBPAGE (for PDFs in legacy mode) template. Import is never worse than before.

**Unit tests:** `imports-parsers.spec.ts` covers EMU conversions, a real JSZip round-trip (2-slide fixture), graceful fallback, and the pageBackgroundUrl background-prepend path.

**AuditLog:** every import writes an `IMPORT_DESIGN` AuditLog row (best-effort, non-blocking) with importSource, structuredPages, fileName, fileSize, mimeType.

---

## Malformed-File Behavior (traced to real callers)

| Input | Parser behavior | Controller behavior |
|---|---|---|
| Non-ZIP buffer (e.g. "this is not a zip") | JSZip.loadAsync throws | Caught, falls back to single-image template |
| Valid ZIP, no `ppt/slides/` files | parsePptx returns `{pages:[], media:[]}` | buildTemplates returns [] → falls back |
| Valid ZIP, all slides have corrupt XML | Each slide's xml.parse throws, skip → all slides skipped, pages=[] | Falls back |
| Valid ZIP, some slides corrupt | Corrupt slides skipped, good slides survive | Partial result, still useful |
| Encrypted / password-protected PDF | pdfjs.getDocument({data:...}).promise rejects with PasswordException | Caught, falls back |
| 0-byte file | multer passes (0 ≤ 50MB limit); JSZip throws "Bad magic number" or pdfjs throws "Invalid PDF structure" | Caught, falls back |
| 200-slide deck | MAX_SLIDES=60 hard cap enforced in pptx-parser.ts:394 | Controller creates 60 templates (each has name suffix "— Slide N") |

All malformed inputs fall back gracefully. **No server crash, no 500, no data leak.** The fallback always produces at least the asset + playlist.

---

## Findings

### P2-1: ZIP Bomb — No Decompressed-Size Cap

**Severity: P2**

`pptx-parser.ts:326` calls `JSZip.loadAsync(buffer)` with no check on the decompressed size of the archive. JSZip inflates every part into memory before the parser reads a single byte. A 50 MB PPTX at a 20:1 deflate ratio decompresses to ~1 GB in the Railway container's heap. Node.js default heap is ~1.5 GB; a single concurrent request from a CONTRIBUTOR could OOM-kill the process.

This is not exploitable by an anonymous attacker (the endpoint requires auth at CONTRIBUTOR+), but a disgruntled insider or a mis-configured integration could abuse it. Current PPTX files from PowerPoint and Canva are typically 1–5 MB compressed / 10–50 MB decompressed, so this is not a production emergency — but it is an unguarded DoS surface.

**Evidence:** `apps/api/src/imports/parsers/pptx-parser.ts:326` — `const zip = await JSZip.loadAsync(buffer);` — no `uncompressedSize` check before or after.

**Fix:** after `JSZip.loadAsync`, sum `Object.values(zip.files).reduce((acc, f) => acc + (f._data?.uncompressedSize ?? 0), 0)` and throw if `> 200 * 1024 * 1024` (200 MB). Alternatively, switch to a streaming unzip (unzipper or yauzl) that can enforce a per-entry size cap before allocating.

---

### P2-2: Stale Error Message — PPTX No Longer Blocked

**Severity: P2** (UX / operator confusion)

`imports.controller.ts:198–199` — the `if (!file)` error message reads:

```
'No file uploaded or unsupported type. Accepted: PDF, PNG, JPG, WEBP. Max 50 MB. For PowerPoint / Slides: export to PDF first …'
```

This comment was left over from when PPTX was explicitly removed from the accepted set (2026-05-23). Import 2.0 re-adds PPTX to `ACCEPTED_MIMES`. An operator who mis-types a filename extension or drops a `.ppt` binary will see a message telling them to "export to PDF first" — which is now incorrect. The correct instruction is "Accepted: PDF, PowerPoint (.pptx), PNG, JPG, WEBP."

**Evidence:** `apps/api/src/imports/imports.controller.ts:193-203` — the no-file error and its comment are both stale post Import 2.0.

**Fix:** update the error copy: `'No file uploaded or unsupported type. Accepted: PDF, PowerPoint (.pptx), PNG, JPG, WEBP. Max 50 MB.'`

---

### P3-1: CONTRIBUTOR Role Can Create ACTIVE Templates Via Import

**Severity: P3**

A CONTRIBUTOR uploading a design as `targetType=template` results in a `Template` row with `status='ACTIVE'` visible to all operators. The intent of the CONTRIBUTOR role is that their uploads land in moderation (`Asset.status = PENDING_APPROVAL`) — and the import controller does correctly set `asset.status = PENDING_APPROVAL` for CONTRIBUTORs. However, the `template.create` at line 403–432 sets `status: 'ACTIVE'` unconditionally for all roles, bypassing the review queue.

This means a CONTRIBUTOR can publish a live template (that appears in the gallery and can be assigned to screens) without admin approval, even though their underlying assets are pending. The IMAGE zones in that template reference `PENDING_APPROVAL` assets, so the template will render broken IMAGE zones until the assets are approved — but the template itself is live.

**Evidence:** `apps/api/src/imports/imports.controller.ts:414` — `status: 'ACTIVE'` in `prisma.client.template.create` with no role check.

**Fix:** mirror the asset logic: `status: req.user.role === 'CONTRIBUTOR' ? 'DRAFT' : 'ACTIVE'` (or `PENDING_APPROVAL` if that enum value exists on Template). This aligns template moderation with asset moderation for the CONTRIBUTOR role.

---

### P3-2: PDF Import — No Visual Fidelity for Text-Over-Graphic Layouts

**Severity: P3** (known design limitation, documented)

The PDF path does NOT add a full-bleed background raster image of the PDF page — the controller comment at line 368–378 explicitly explains this: `<img src=*.pdf>` renders broken because PDF is not a raster format, and there is no server-side rasterizer. The structured PDF result is text zones only, with no background image showing the page's visual design. An operator importing a visually rich PDF (infographics, branded templates) gets a white background with floating text zones — functional but potentially confusing.

The `pageBackgroundUrl` hook in `import-builder.ts:47` is wired and tested but never called for the PDF path in the controller (line 379 uses `{resolveMedia: () => null}` with no `pageBackgroundUrl`). A future server-side rasterizer (headless Puppeteer, Playwright, or ImageMagick ghostscript) would plug directly into this hook.

This is not a regression — it is better than the previous WEBPAGE widget (broken iframe on non-Chrome). It is documented in code and in the FE "small print" at `page.tsx:327-329`. Flagged P3 as a future improvement, not a blocker.

**Evidence:** `apps/api/src/imports/imports.controller.ts:378-379` — PDF parsed without `pageBackgroundUrl`.

---

## What Is Solid

1. **PPTX parser is production-quality.** EMU→px→% math is correct and tested. Font size (sz hundredths-of-pt), bold, color, alignment, fontFamily all round-trip correctly. Group shapes recurse. Corrupted/absent slides are individually skipped without failing the whole import.

2. **Graceful fallback is non-negotiable and implemented.** Every structured parse path is in try/catch; empty result also triggers fallback. The operator never gets a 500 for a malformed file.

3. **TEXT widget field compatibility confirmed.** `WidgetRenderer.tsx:1240-1248` reads `content`, `fontSize`, `fontFamily`, `alignment`, `color`, `bold` directly from `config` for theme-less TEXT zones — exactly what the PPTX parser emits.

4. **UX is excellent.** Three-step flow (Drop → Preview → Add) with brand-aware shell. PPTX shows a friendly "PowerPoint ready to import" card (no inline preview is possible). PDF renders inline via `<iframe>`. Post-import the operator lands directly on the builder or template gallery. The `/settings/imports` redirect (router.replace, back-nav safe) works correctly.

5. **Route placement is correct.** Import lives at `/[schoolId]/templates/imports` not under Settings. The `/settings/imports` stub redirects silently with `router.replace`.

6. **Canva/Slides/Figma honesty is adequate.** The page copy says "Drop a PowerPoint, PDF, Canva, or Slides export" — Canva and Slides export to PDF/PPTX, which IS accepted. There is no fake "Connect to Canva" OAuth button. Stage-2 (actual Canva Connect OAuth) is mentioned briefly at the bottom with no fake UI. This is honest.

7. **Embedded media dedup.** A logo reused on 10 slides uploads once (globally deduped by zip path via `allMediaPaths` Set). The `prunedMedia` step drops unreferenced images.

8. **Filename sanitization.** Control chars, bidi RTL controls, zero-width chars, Windows reserved chars, and BOM are all stripped. NFC normalization prevents invisible collisions. Names capped at 200 chars.

9. **Duplicate name handling.** Both playlists and templates get `(N)` suffix when a name collision is detected, preventing accidental overwrites on re-import.

10. **Size cap enforced at two layers.** Frontend: `MAX_BYTES = 50 * 1024 * 1024`. Backend: multer `limits: { fileSize: MAX_BYTES }`. The frontend check also provides immediate feedback before any upload begins.

11. **AuditLog on every import.** `IMPORT_DESIGN` action with importSource (`structured-pptx` | `structured-pdf` | `flat-image` | `flat-fallback`) and structuredPages count. Best-effort (non-blocking) so a log write failure does not break the import.

12. **CONTRIBUTOR asset moderation works correctly for assets.** `asset.status = 'PENDING_APPROVAL'` for CONTRIBUTORs at line 259. Only the Template creation path is inconsistent (P3-1 above).

---

## Deferred / N-A Items (per Standard Audit Surface section 12)

| Item | Status |
|---|---|
| Canva Connect OAuth (Sprint 11) | N-A — not built; no fake button; honest copy |
| Google Slides via Drive API (Sprint 11) | N-A — not built; users export to PDF/PPTX |
| Microsoft PowerPoint Online via Graph (Sprint 11) | N-A — not built |
| Figma (Sprint 11) | N-A — not built |
| Keynote (fallback to PDF) | N-A — users export to PDF; works today |
| PDF page rasterizer for visual fidelity | Deferred — `pageBackgroundUrl` hook exists, rasterizer not implemented; P3-2 above |
| Rate limiting on `/api/v1/imports/design` | Deferred — no per-tenant throttle; auth gate limits to CONTRIBUTOR+ only (not public) |

---

## Verification Evidence

- `curl -s -o /dev/null -w "%{http_code}" -X POST https://venue-os.app/api/v1/imports/design` → `403` (auth enforced; NestJS RBAC guard returns 403 for missing/invalid JWT, consistent with other endpoints)
- `pptx-parser.ts:44-45`: `MAX_SLIDES=60`, `MAX_ZONES_PER_SLIDE=80`
- `pdf-parser.ts:25-26`: `MAX_PDF_PAGES=40`, `MAX_ZONES_PER_PAGE=80`
- `imports.controller.ts:111`: `MAX_BYTES = 50 * 1024 * 1024`
- `page.tsx:417-432`: PPTX shows friendly card, not blank or error; PDF shows `<iframe>` preview; images show `<img>` preview
- `settings/imports/page.tsx`: `router.replace(/${schoolId}/templates/imports)` on mount
- `WidgetRenderer.tsx:1240-1248`: TEXT widget reads `content`, `fontSize`, `fontFamily`, `alignment`, `color`, `bold` from config — full round-trip compatibility
- `import-builder.ts:87-103`: IMAGE zones with unresolved media are dropped; pages with zero zones after drop are skipped

---

*Report written 2026-06-10. Auditor: Sonnet 4.6 subagent.*
