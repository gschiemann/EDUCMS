# Template-import audit and developer handoff

## Scope and coverage

September 15, 2026. Scope: the supplied Import a design screen, its mounted page, import controller, PPTX/PDF parsers, template builder adapter, upload storage service and import help/tests. Deepened to include the native JSON template export/import path and imported-widget renderer contract. Source baseline f6675eb8; executable checks ran in an isolated worktree at f0d42376. No changes between those commits to the original audited files or CLAUDE.md. **Deep pass: 41 Jest tests + 7 real-PDF checks + 12 Chromium component checks executed.** Several checks deliberately reproduce defects: their green result is NOT product acceptance. No application code, settings, live database or storage objects changed. This is not a production penetration test or hardware qualification.

Read [EVIDENCE.md](EVIDENCE.md) for exact test scope, additional findings and corrected assumptions. Read [IMPLEMENTATION-BRIEF.md](IMPLEMENTATION-BRIEF.md) for the proposed product/engineering contract, sequencing and release gates. These extend the initial source audit below.

Required audit coverage: P = partial, scoped inspection; — = outside this request. No row implies complete app coverage.

| Domain | Design | UX | Functionality |
|---|---|---|---|
| 1. Realtime/pubsub | — | — | — |
| 2. Storage/content pipeline | P | P | P |
| 3. AI providers | — | — | — |
| 4. AI feature surfaces | — | — | — |
| 5. AI comparison | — | — | — |
| 6. Streaming | — | — | — |
| 7. Sports | — | — | — |
| 8. POS | — | — | — |
| 9. Communication | — | — | — |
| 10. Auth/identity | — | P | P |
| 11. Billing | — | — | — |
| 12. Design import | P | P | P |
| 13. Alerts | — | — | — |
| 14. Multivertical | P | P | — |
| 15. Cross-browser/player | — | P | P |
| 16. Audit coverage | — | — | P |
| 17. Operational/DX | — | P | P |
| 18. Accessibility | P | P | P |
| 19. Template/widget editability | P | P | P |
| 20. Three lenses | P | P | P |
| 21. Verification before claim | — | — | P |

## Verdict

Keep the simple Templates → Import entry point, tenant branding and short wizard. The underlying feature is a best-effort converter presented as a fidelity-preserving, fully editable importer. Fix that contract before adding integrations or decorating the page. Source-confirmed failure paths can lose content, create unusable fallback templates, or approve extracted media differently from its original document.

## Options: keep, fix, defer

| Option | Current implementation, not a live pass | Recommendation |
|---|---|---|
| PNG/JPG/WEBP | One IMAGE zone; source preview; fixed 1920×1080 fallback canvas | Keep. Label “Image template: text is not individually editable.” Detect native dimensions, offer fit/crop and target orientation. |
| PPTX | Extracts positioned text boxes and supported embedded images | Keep as best-effort editable conversion with per-slide warnings. Not “every element editable.” |
| Legacy PPT | Accepted, but sent to a ZIP/PPTX parser; parse failure falls back to IMAGE pointing at original PPT | Remove from accepted types until a real legacy converter exists. Offer resave as PPTX/PDF. |
| PDF | Editable path extracts text only; images, vectors, fills and original fonts/colors are not reconstructed | Keep, but prioritize a rendered-page preservation mode. Offer text extraction explicitly as partial conversion. |
| Scanned/image-only PDF | No OCR in this parser; empty pages dropped; if no usable page remains, one WEBPAGE referencing the original PDF | Do not call editable or promise one template per page. Add per-page rasterization; optional OCR later with accuracy warnings. |
| Canva / Google Slides exports | This page is a file uploader, not a connected design picker | Keep as compact export-help choices explaining PPTX/PDF/image tradeoffs. Do not imply account connection or automatic sync. |
| Add to Playlists | Creates one item referencing the original upload, not converted per-page items | Demote/remove from this template wizard until playlist output is explicitly built and player-tested. |
| Native CMS template package | Not offered in this screen; existing JSON API/hooks and export action found during deeper review, with an unwired gallery import handler | Reuse and complete the existing feature. Restore visible import access; preserve scenes/actions/locks and authorized media dependencies. Do not build a duplicate API. |

## Findings and priorities

Paths below are repository-relative for developer navigation. Line anchors refer to the inspected source.

### P1 — Original documents are sent to public assets storage

`apps/api/src/imports/imports.controller.ts:219` uploads the original before parsing. `apps/api/src/storage/supabase-storage.service.ts:121` configures the assets bucket public; `:308` routes upload there; `:416` returns a public URL. This includes originals whose Asset row is PENDING_APPROVAL. A random object name is not authorization. Actual deployed bucket settings and anonymous retrieval were not tested.

For schools, originals may contain student details, hidden slides, speaker notes or other material never intended for a display. Use a private import-staging bucket, authorized short-lived access, retention/cleanup and separate approved display derivatives. Preserve established player delivery while designing the migration; do not simply make the shared assets bucket private and break existing screens. Supabase documents that public retrieval bypasses access control: https://supabase.com/docs/guides/storage/buckets/fundamentals

### P1 — Contributor approval policy changes during extraction

Controller `:262` marks a contributor's original PENDING_APPROVAL, but `uploadExtractedMedia` at `:626` unconditionally writes APPROVED; generated templates at `:417`/`:464` are ACTIVE. The parent/derivative inconsistency is confirmed. Whether every publishing route subsequently permits display needs end-to-end testing; do not claim that entire bypass was exercised.

Carry actor role and moderation state through all derivatives and enforce it at publishing. Never upgrade approval simply because media was extracted from a document. Add contributor/admin tests spanning import → approval → assignment → manifest/player output.

### P1 — Unsupported PowerPoint fallback is not a rendered image

Controller `:386` catches any parse error; `:449` selects IMAGE for non-PDF inputs and points it to the original file. No PPT/PPTX rasterizer runs. A presentation file URL is not an image. This affects legacy PPT, corrupt PPTX and decks with no surviving supported zones. Resource-limit rejections also enter this fallback.

Reject unsupported/corrupt/unsafe files with an actionable error and no successful template commit. Only use “Import as image” after producing a valid raster derivative. Never turn a security rejection into successful fallback.

### P1 — Missing pages and content can be reported as success

`parsers/pdf-parser.ts:180` caps at 40 pages; `pptx-parser.ts:415` caps at 60 slides; both cap zones at 80 and text at 5,000 characters. `import-builder.ts:92` drops pages with zero usable zones. Unresolved images are dropped at `:114`. The controller reports the surviving template count, without a source-page count or returned warning list. Mixed text/scanned PDFs can therefore omit scanned pages while reporting editable import success.

Keep protective limits, but expose them before commit. Preserve source page IDs/order. Every source page must have a disposition: editable, rendered, intentionally excluded or failed. Offer explicit page selection or batch splitting instead of silently clipping. Show each failed image and retry option.

### P1 — Preview is the source, not the conversion

`apps/web/src/app/[schoolId]/templates/imports/page.tsx:125` creates a local blob URL. Actual conversion starts only inside submit at `:140`. `FilePreview` at `:416` displays a static PowerPoint readiness card; PDF preview is the browser's original-file iframe. The user cannot inspect converted output before Add.

Split preparation from commit. Show source and converted output side by side with thumbnails, page selection and per-page fidelity/editability warnings. The same template specification and renderer used for the preview must be used for final persistence. Do not promise native PDF preview behaves identically on all browsers.

### P1 — PDF conversion is text recovery, not design preservation

`pdf-parser.ts` only calls getTextContent; returns media: []; the controller at `:382` supplies neither resolved media nor raster backgrounds. Text styling does not reconstruct font family, color or rich formatting. Line grouping uses vertical proximity without the horizontal-adjacency check described in its comment: separate columns sharing a baseline are merged. Rotation/crop transforms are not fully applied.

First deliver per-page raster output with native aspect ratio for dependable display, then improve editable extraction. Do not place extracted text over an unchanged raster containing the same text: that creates duplicate glyphs and leaves old words visible when edited. Hybrid mode needs text-free artwork or an explicit reference layer excluded from output.

### P1 — Template and playlist operations are conflated; failure is not atomic

Controller `:295` creates a playlist and `:307` a single original-asset item before checking targetType. Template selection still creates a playlist; playlist selection bypasses structured conversion. All later media/template writes are sequential and are not one transaction; partial errors can leave an original, playlist and some templates. Name suffixes do not provide idempotency when a request times out and is retried.

Template import must create only the selected templates unless the operator explicitly requests a playlist. A rotating deck needs playable per-page derivatives and durations, not a raw PPTX item. Use an import job ID/idempotency key, private staged objects, atomic final DB commit, and compensating cleanup for storage. Do not hold a DB transaction open while converting/uploading files.

### P1 — Audit persistence is best-effort

Controller `:498` writes AuditLog, but catches failure at `:527` and still returns success. This conflicts with the repository's privileged-action audit requirement. Include the immutable audit record in the final commit transaction or use a durable, reviewed equivalent; a console warning is not that guarantee.

### P2 — Common PPTX layout features are not faithfully handled

`pptx-parser.ts:243` processes all text shapes, then `:275` all pictures, rather than retaining interleaved document stacking order. Pictures can cover text that should be above them. `:308` explicitly ignores group-coordinate transforms. Text uses representative run styling (`:174` onward); placeholders without their own transform are skipped instead of inheriting slide layouts/masters. Tables/charts, shape fills, rotation, image crop, theme inheritance and animations are not reconstructed by this parser.

Prioritize actual document order, master/layout inheritance, group transforms, image crop/rotation and rich text. Unsupported effects should produce warnings and a reliable rendered option, not invisible losses. Verify compatibility with the existing builder and player config schema, not merely that parser JSON contains a property.

### P2 — Accepted MIME handling is inconsistent

The browser accepts extensions with missing/generic MIME; the API only makes an octet-stream exception for PPT/PPTX (`imports.controller.ts:180`). That generic MIME is passed unchanged to storage (`:227`), whose allowlist does not include octet-stream. Thus the intended PPTX generic-MIME compatibility path conflicts with configured storage policy. Error text also still tells users PowerPoint must first be exported to PDF.

Create one capability contract shared by UI/API. Inspect file signatures/container structure, normalize to a server-chosen MIME, and reject mismatches. Filename/header allowlisting alone is not file validation. No live bypass test was run. OWASP upload guidance: https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html

### P2 — Resource protection is useful but incomplete

Keep the existing 50 MB file cap, 250 MB declared ZIP expansion cap, page/zone/text limits, role guards and PDF isEvalSupported:false. Do not describe the code as lacking all upload protections. Nevertheless, conversion runs inside the API request; ZIP size checking trusts declared sizes; media discovery precedes the slide cap; no import-specific job timeout, concurrency budget or quarantine scanner appears in the inspected path. Global throttling/infrastructure limits were not audited.

Use bounded isolated workers, actual decompressed-byte/entry/depth/image-pixel limits, timeout and memory limits, controlled network egress, and tenant quotas. Scan/quarantine originals before releasing usable derivatives. Verify installed parser security advisories separately; none were assessed here.

### P2 — UI and help describe different products

Hero and PPTX card promise fully editable layers; image imports cannot offer that. Preview footer says unsupported content becomes a page image, which is not implemented for PPTX. `apps/web/src/content/help/import-designs.md:21` promises every-page previews and later says imports are images/non-editable. The success message does not disclose losses. Fixed landscape fallback distorts the canvas choice for portrait artwork.

Replace marketing claims with format-specific outcomes. Add file dimensions, page count, target aspect, output name/folder and expected editability. Keep settings progressive. Add aria-current to the stepper, announce processing/results, manage focus between steps, include PowerPoint in the upload accessible name, clean blob URLs on unmount and provide a named Browse files button. Browser accessibility was not tested.

## Recommended screen, confined to import

Keep the existing brand language; reduce the oversized hero and use the space for useful decisions. No unrelated dashboard/editor redesign.

1. **Choose file.** Compact heading, Browse files + drag/drop, one-file limit, clear supported types/limits. Small “Export from Canva / Google Slides” help links. Copy: “Bring in a presentation, PDF or image. Review what stays editable before adding it.”
2. **Prepare and review.** Upload/validate/convert are real job stages. Left: selected source-page thumbnails. Center: Original / Imported comparison at the target aspect ratio. Right: per-page mode, warnings and editable text/image counts. Offer “Preserve appearance” and “Editable layers — best effort”; only enable modes backed by actual output. Show accurate counts, not invented fidelity percentages.
3. **Add selected templates.** Name/folder, selected page count and issue summary. Primary button “Add 6 templates” (actual count); secondary Back. An explicit optional “Also create a rotating playlist” is allowed only once converted playback is reliable. No auto-assignment to screens.
4. **Result.** Created thumbnails, one clear Open in builder action, Import another, and a retained import report. Show partial completion honestly. “Run in background” requires a persistent job; “Cancel” must stop pending work/clean staging, not merely hide a spinner.

## Delivery order and acceptance tests

**First: protect trust and data.** Correct claims/help/errors, reject legacy PPT and broken fallback, surface truncation/loss, align moderation, make originals private, and make audit/commit durable. Test these before expanding the advertised capability set.

**Second: make the core import dependable.** Staged conversion + actual pre-commit previews, per-page rasterization, page selection, portrait/custom aspect, idempotent retries and opt-in playable playlist creation. Preserve original order and do not silently omit pages.

**Third: improve editability.** PPTX masters/groups/stacking/crops/styles, PDF columns/transforms, richer fidelity diagnostics and optional OCR. Repair the existing native-template import/export path and make it discoverable instead of creating a second implementation.

**Later: connected sources.** Consider Canva/Slides account pickers and explicit reimport/update only after reviewing provider capabilities, permissions and approval requirements. Do not promise lossless native round-tripping or automatic sync now. Reimport must not overwrite local changes without conflict review. No connector implementation was audited beyond this upload screen.

Required release checks:

- Real benign exported decks from PowerPoint, Slides and Canva; screenshot comparisons of original, converted preview, saved/reopened builder and target player.
- PPTX fixtures: master placeholders, grouped content, interleaved images/text, mixed fonts/colors, tables/charts, image crops, rotations, missing media and unsupported graphics.
- PDF fixtures: text+artwork, scans, mixed scans/text, columns, rotated/cropped pages, passwords, malformed files and 41+ pages. PPTX 61+ slides, 81+ zones and long text must warn/reject explicitly.
- MIME mismatch/generic/empty MIME, empty file, size boundaries and bounded archive-expansion fixtures. Use isolated non-production security tests; do not submit dangerous files to live school infrastructure.
- Contributor originals/derivatives stay unapproved until review; cross-tenant job reads/commit/cancel denied; private original cannot be fetched anonymously; approved display playback still works.
- Inject failures during media upload, template persistence and audit insert. Verify no misleading success, no orphan published data, safe cleanup and retry without duplicate creations.
- Confirm Template action does not implicitly create a playlist. A requested playlist has exactly the selected playable pages in order.
- Keyboard/screen-reader operation, progress/error announcements, phone file picker, browser PDF behavior and actual supported player/hardware tests.

Existing `apps/api/src/imports/parsers/imports-parsers.spec.ts` checks basic unit geometry, a synthetic two-slide PPTX and helper behavior. It explicitly expects a missing-media slide to disappear, and its optional-background test accepts an IMAGE URL ending in .pdf without rendering it. These are not proof of user-visible fidelity. Add controller/storage/role integration tests and real rendered-output tests; do not treat current helper coverage as end-to-end qualification.

## Verification limits

The initial pass was source-only; the deeper pass now includes the executions detailed in EVIDENCE.md. Public-bucket and MIME-policy findings still describe configured code, not verified live settings. No production uploads/access checks, real DB writes, CI runs or hardware tests were performed. Supabase skill informed storage/access-control review; PDF skill guided synthetic document generation and visual inspection; browser skill guided component interaction verification, using installed Playwright because agent-browser CLI was unavailable. The Supabase changelog endpoint was unavailable through the web reader; official bucket documentation was retrieved. No migrations, deployments, secret reads or application changes were made.
