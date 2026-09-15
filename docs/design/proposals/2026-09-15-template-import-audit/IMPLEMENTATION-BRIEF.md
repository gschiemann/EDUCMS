# Import Studio: implementation brief

This is a proposed implementation contract, not shipped functionality. Read README.md for scope and EVIDENCE.md for executed tests. Keep work confined to template import and the shared contracts it genuinely needs. Do not redesign the dashboard, template editor or widget library.

## 1. Product standard

“World class” means a nontechnical operator can confidently bring an existing design into VenueOS, understand what changed, edit what is actually editable and get the same approved result on a screen. It does not mean pretending every foreign document is losslessly editable.

Six release invariants:

1. Every source page is accounted for: selected, deliberately excluded, converted with disclosed limitations, or explicitly failed. No silent truncation or omission.
2. Preview, saved/reopened builder and player consume the same versioned converted template specification. No parallel approximation for preview.
3. Exact text is preserved where extraction is supported: leading zeros, punctuation, paragraph boundaries, Unicode and reading order. OCR is labelled as recognition, never exact extraction.
4. Originals remain private, moderation follows derivatives, and no import automatically assigns content to screens.
5. Retries and concurrent commits cannot duplicate results. Failures do not leave partially published templates or playlists.
6. Every privileged commit has a durable audit record. A success response describes durable outcomes, not just completed uploads.

Proposed happy-path acceptance: a teacher selects a normal five-page supported file, reviews suggested output and adds it with at most three deliberate decisions and under 30 seconds of active interaction. Measure processing time separately and show real stages. This is a target to test with users, not a measured result today.

## 2. One entry point, three honest outcomes

Keep Templates → Import design. Keep the existing branding. Reduce the hero to heading + one sentence; do not introduce a new full-page product shell.

### Input

One drop zone and explicit Browse files button. Show accepted types, byte/page limits and single-file behavior. If multiple files are dropped, explain the limit or offer a real queue; never silently take only the first.

Detect PPTX, PDF, image and native `.educms-template.json` from validated content, not just suffix. The native API already exists: reuse `/templates/import`, `useImportTemplate` and the export envelope; repair its completeness and wire it into a visible entry point. Do not add a second JSON importer.

Keep Canva/Google Slides as small “How to export” help links until their authenticated connector flows are implemented. Do not show large disabled integration tiles. Reject PPT with “This older PowerPoint format isn’t supported yet. Save a copy as .pptx or export to PDF.”

### Suggested output, chosen after inspection

| Mode | Promise | Appropriate default |
|---|---|---|
| Editable layers | Supported text/images become native editable elements; show unsupported elements | Simple PPTX whose supported structure passes render comparison |
| Preserve appearance | Page is a rendered image; text inside is not individually editable | Complex PDFs/decks, scans and image uploads |
| Native template | Recreates supported design structure, scenes/actions and authorized dependencies | VenueOS export package |

Do not offer a nonfunctional mode. Initially, if preservation rendering is not implemented, say that file cannot yet be imported reliably; do not manufacture an IMAGE pointing at a PDF/PPTX. Conversely, do not permanently give up editable import: it remains a core product capability with a narrower, truthful support contract.

Motion is a separate capability. Say “Animations and embedded video are not included in this conversion.” Offer export-to-video guidance that routes to the existing media workflow, not a claim that video becomes editable template layers.

### Review layout

- Compact header: file name, detected format, source-page count and processing state.
- Left: page thumbnails with selection, original page numbers and status badges.
- Center: Original / Imported toggle or side-by-side comparison; fit-to-view and zoom. A source reference must never be mistaken for converted output.
- Right: selected page’s mode, editable object counts, specific warnings and contextual recovery actions. Advanced aspect/font controls collapse by default.
- Footer: “6 of 8 pages selected”, unresolved issue count, Back, and “Add 6 templates”.

On a phone: page thumbnail strip → one large preview → collapsible issues → sticky primary action. Match the existing app shell. Do not squeeze two unreadable comparison canvases side by side.

Start at source aspect. Offer landscape/portrait/custom target only when needed. Preview letterboxing/cropping; never stretch by default. “Apply school branding” must be explicit because replacing source fonts/colors is a transformation, not preservation.

For warnings, use concrete language: “Page 4: chart imported as an image”, “Page 6: one picture could not be loaded”, “Font Acme Sans is unavailable; using Arial.” Never present arbitrary “98% fidelity” scores as fact. Block commit on omitted/unaccounted pages, unsafe content and missing essential resources. For recoverable differences require a clear acknowledged choice per page or an explicit batch action.

### Completion

Show actual created thumbnails and names, Open in builder and Import another. Persist an import report reachable from the result/template metadata. A playlist is opt-in and contains only selected playable derivatives in source order, with editable durations. Never call it “queued onto screens” unless an actual separately authorized assignment occurred.

## 3. Conversion architecture

Retain the existing parsers as extraction adapters, but stop treating their best-effort output as a complete design.

Pipeline: private upload → validate/quarantine → inspect → convert → preview → explicit commit.

Separate jobs from the synchronous API request. Conversion belongs in a bounded isolated worker, not the shared API’s event loop. A worker failure must not degrade the emergency/control-plane workload.

### Suggested additive API

These route names are proposals. Reuse existing queue/job infrastructure where suitable after inspection; do not create a new platform merely for this feature.

| Operation | Contract |
|---|---|
| `POST /imports/jobs` | Create tenant/actor-scoped staging job; validate metadata and issue tightly scoped upload capability if using direct upload |
| `POST /imports/jobs/:id/prepare` | Verify the staged object, inspection limits and checksum; enqueue once |
| `GET /imports/jobs/:id` | Return durable status, progress, page manifests, warnings, selected modes and expiring preview access |
| `PATCH /imports/jobs/:id/selection` | Save selected source-page IDs/output modes against expected job revision; validate available artifacts |
| `POST /imports/jobs/:id/commit` | Idempotent, permission-checked creation from a specific prepared revision |
| `POST /imports/jobs/:id/cancel` | Mark cancelled; prevent commit and stop queued/in-progress work safely |

Tenant ownership checks apply to every job, page, artifact, commit and cancel operation, including signed preview minting. Read actor role/approval authority at commit, not only at upload. A status poll must not leak another tenant’s original file name or warnings.

Job states: awaiting-upload, validating, converting, ready, committing, completed, failed, cancel-requested, cancelled, expired. Warnings are separate from state. A ready job may have warnings but cannot have unexplained missing pages. Once committing wins its atomic state transition, cancellation must not claim rollback if commit has already completed; return the real durable state and results.

### Minimal manifest

Persist at least:

- Job ID, tenant ID, actor ID, creation/expiry times, state/revision, source SHA-256, normalized detected MIME, source page count and converter version.
- Each original page’s stable source ID/number, inclusion flag, dimensions, chosen output mode, converted-spec hash, preview/derivative artifact references, warning codes and editable object counts.
- Source-object provenance and exact text for supported elements; flags distinguishing extraction, rendering and OCR. Do not log source text.
- Font substitutions and unsupported features; explicit exclusion reasons; moderation state; created template/asset/playlist IDs after commit.
- Idempotency key plus request payload hash. Same key/same payload returns the same result; same key/different payload is a conflict. Content deduplication is separate: an operator may intentionally import two copies of the same file.

Store object keys, not expiring signed URLs, as durable artifact references. Mint authorized access on read. The rendering/player adapter must handle derivative delivery without relying on expired staging links.

### Commit and rollback

Resolve and validate all required artifacts before final DB commit. In a short transaction, atomically claim the prepared revision and create the selected records plus immutable AuditLog. No network conversion/storage calls inside this transaction. For large decks, use an unpublished staged batch with atomic visibility if a single transaction is too large; never quietly expose partial batches.

Storage and DB are not a distributed transaction. Track staged object ownership and use a compensating cleanup process. Cleanup must prove an object is unreferenced before deleting it, especially with deduplicated/shared derivatives. Committed objects must not expire with the staging job. Failed/cancelled/expired jobs have a documented retention window and bounded cleanup retries.

The current endpoint remains compatible for old callers during migration. Gate the new UI behind a feature flag. Do not silently reinterpret legacy targetType defaults; migrate deliberately and retire raw-PPTX playlist creation.

## 4. Format implementation requirements

### PPTX

Preserve document order, not shape-type order. Resolve slide layout/master geometry and theme values. Apply nested group coordinate transformations. Respect crop, rotation, clipping and aspect ratio. Preserve rich text runs, whitespace and exact strings; configure XML parsing so text nodes such as `00123` do not become numbers. Record unsupported shapes/tables/charts/media rather than omitting them.

Translate extracted formatting to a shared source-faithful text contract. The default TEXT widget currently adds 5% padding, centers vertically and uses weight 600 for non-bold text. Do not globally change legacy widget defaults and regress existing templates. Add an explicit import layout/style mode or adapt to an existing suitable mode after checking its renderer and editor behavior. The builder/player already apply a shared pixel-size override; do not “fix” a nonexistent universal 48px cap there.

### PDF

Build a real page renderer for preservation mode and preview. Review candidate rendering engines against the fixture corpus, runtime constraints, update cadence, licensing and security before choosing; this brief does not certify a particular engine. Package required font/CMap resources rather than relying on uncontrolled runtime downloads. Current Node extraction emitted standardFontDataUrl warnings in the synthetic tests.

Text extraction must apply viewport/rotation/crop transforms and maintain column/block boundaries. Do not join all runs sharing a baseline. Extracting text alone is not proof that design fidelity survived. Scans need rendered output; optional OCR must disclose uncertainty and allow correction.

Never overlay new editable text on a raster that still contains the old text. Safe hybrid output needs separately rendered non-text artwork, a reviewed removal process, or a clearly labelled reference-only layer not included in published output. Do not introduce AI inpainting as an undisclosed fidelity mechanism.

### Images

Decode verified bytes, respect orientation metadata, inspect pixel dimensions and reject excessive decoded-image budgets. Keep intrinsic aspect, show crop/fit explicitly and create one replaceable IMAGE layer. Animated inputs, if added later, need separate declared playback behavior. No OCR or automatic segmentation promise for ordinary PNG/JPG/WEBP imports.

### Native VenueOS templates

Extend/version the existing envelope rather than replacing it. Preserve scenes, scene order/timing, shared versus scene-local zones, touch mode/actions, idle reset, zone locks and all supported metadata. Generate fresh destination IDs and remap internal references as one operation. Revalidate URLs and actions against the destination tenant and supported schema.

Current export copies media URLs, not an independently portable media bundle. Offer “Copy authorized media into this account” with an asset manifest and hashes; keep external dependencies explicit. Never carry source account secrets, signed tokens, integration credentials or unauthorized tenant IDs inside defaultConfig. Use a schema-aware allowlist/export transformation rather than trusting arbitrary config wholesale. Do not connect a destination tenant to the source tenant’s private data by accident.

Version 1 imports should remain accepted with a disclosed capability report. Reject unsupported future versions safely. Round-trip equality tests should compare supported semantics, not volatile IDs/timestamps.

## 5. School-ready safety requirements

- Originals and previews stay private until explicit approved derivative creation. Moderation follows every extracted asset and template.
- Uploaded file MIME/header/extension must agree with actual decoded structure. Use per-format structural validators and server-chosen MIME; reject unsupported active content and macro-enabled formats explicitly.
- Bound compressed bytes, actual expanded bytes, archive entries, recursion depth, XML/text length, decoded image pixels, page count, CPU time and memory. Current declared ZIP-size checks are useful but not sufficient isolation.
- Do not fetch external file relationships during conversion. If an approved connector later needs external fetching, use the existing hardened fetch path, deny private/metadata networks, revalidate redirects and bind access to the authenticated connector.
- Run scanner/renderer jobs with no production DB credentials, minimum temporary object access and no unrestricted network egress. Unsafe files fail closed, not via “successful” flat fallback.
- Define source/preview/failed-job retention and deletion behavior, including caches and backups. Do not tell schools that an upload consent checkbox substitutes for access control or retention policy.
- If OCR or external conversion is added, expose the processor/data destination and obtain the appropriate product/security/privacy review first. Do not silently send school documents to an AI provider.

These are engineering requirements, not a legal compliance opinion or proof that current production is compromised.

## 6. Reliability, observability and release gates

Record operational events by job ID, tenant ID, converter version, format, file-size band, source/output counts and warning codes. Exclude source text, full file names where unnecessary, credentials and signed URLs. Measure stage durations, success/partial/failure rates, missing-artifact rates, retries, commit duplicates, cleanup backlog and converter crashes. “HTTP 200 rate” is not import success.

Set and verify performance budgets on representative deployment hardware. Suggested initial test target: typical five-page/10-MB documents ready for review within 30 seconds at p95, with bounded per-tenant concurrency and a documented hard timeout. This is a proposed SLO, not benchmarked capacity. Never raise upload limits just to match a competitor without load testing.

Release gates:

1. Convert the audit reproductions into desired-behavior regression tests after implementation; do not merge tests that bless known defects as acceptance criteria.
2. Build a version-controlled, synthetic/authorized golden corpus with normal and adversarial edge cases. Each fixture has expected pages, exact text, object positions, editability and screenshots. Start with the supplied fixtures, then add real authorized exports from source tools.
3. Compare source → converted preview → saved/reopened builder → supported player. Require human review of visual differences; a pixel metric alone can miss semantic changes such as prices/dates/identifiers.
4. Verify text editing, image replacement, move/resize, undo/redo, save/reload, scene transitions and native-package cross-tenant portability. No original text remains behind edited text.
5. Fault-inject worker death, object upload failure, audit failure, DB failure, retry after uncertain timeout, duplicate/concurrent commit, cancellation and expired signed URLs. Assert complete results or explicit recoverable failure.
6. Prove contributor approval, anonymous-original denial and cross-tenant isolation end to end. Test non-production infrastructure; do not infer live safety from mocks.
7. Verify keyboard, screen reader, mobile upload and supported desktop browsers. Qualify output on the required display hardware; modern headless Chromium is not Taurus/OEM certification.
8. Run preflight, review security/tenant gates, watch CI green, deploy staged, verify the deployed feature and monitor warning/failure rates before wider enablement.

## 7. Implementation packages in dependency order

| Package | Main ownership | Acceptance condition |
|---|---|---|
| A. Truth and safety | Import controller, format contract, copy/help | No unsupported PPT success, no silent losses, normalized MIME, approval/audit policy fixed |
| B. Durable staging | Job API/worker/storage adapter | Private originals, bounded jobs, idempotent commit and safe cleanup under fault tests |
| C. Fidelity foundation | PDF renderer + PPTX adapters + text contract | Every page accounted for; reliable preserved-appearance option; golden-corpus results |
| D. Review UI | Existing templates/imports route | Actual converted preview, selected pages, actionable warnings, clear output counts |
| E. Native portability | Existing templates export/import API and entry point | Scenes/actions/locks survive; authorized assets remapped; no copied secrets |
| F. Playback qualification | Existing player pipeline + test harness | Selected pages rotate correctly; preview/save/player agree; offline and hardware checks |
| G. Convenience | Authorized source connectors, opt-in OCR/reimport | Separate capability/security review; source refresh never silently overwrites local edits |

Do not treat these as permission to modify unrelated files or deploy. This document is a handoff; implementation still requires reviewed changes and the release evidence above.

## 8. Competitive calibration, not a feature-count contest

OptiSigns explicitly distinguishes uploaded presentations, connected Microsoft files and embedded presentations, and discloses missing animation/video support and embed limitations. The useful benchmark is clear output semantics and predictable playback, not importing the largest number of extensions. [Official PowerPoint guide](https://support.optisigns.com/hc/en-us/articles/4414355658899-How-to-Use-Microsoft-PowerPoint-with-OptiSigns).

Its broader file support and larger published upload limit are competitive context, not evidence VenueOS should immediately match that limit inside a synchronous API. [Official supported-file guide](https://support.optisigns.com/hc/en-us/articles/360016342373-What-types-of-files-are-supported).

VenueOS’s worthwhile differentiator is a trustworthy bridge from existing school/business designs into genuinely editable, approved, device-ready templates—with a transparent report of anything that could not be preserved. Demonstrate that end to end before calling this world class.
