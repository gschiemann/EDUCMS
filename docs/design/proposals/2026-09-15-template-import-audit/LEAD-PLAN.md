# Template import — the plan (2026-09-15)

Companion to `00-VERIFICATION.md` (what I checked myself). Sources: Codex's audit at
`docs/design/proposals/2026-09-15-template-import-audit/`, an independent adversarial
re-verification of that audit, and competitive research at
`…/2026-09-15-template-import-audit/RESEARCH-COMPETITIVE.md` (49 cited vendor docs).

## Verdict

Codex's audit is substantially correct and worth acting on; a re-verification pass re-ran all
60 of its checks green and confirmed every P1 and P2, with only citation-line drift to
correct. But three things nobody had change what to do about it.

**One.** The feature has **never been used in production** — zero `IMPORT_DESIGN` audit rows
and zero importer-created templates, against 23,828 audit rows over 151 days. So there is no
migration burden, no live exposure, and no reason to preserve the current contract.

**Two.** The server-side renderer the brief says we need is **already in the image**. Chromium,
`puppeteer-core`, `sharp`, `pdfjs-dist` and a hardened forked render worker all ship today. I
proved per-page PDF rasterization end to end with exactly those pieces: 3/3 pages in 207 ms,
41/41 pages at 35 ms/page. No new dependency, no new licence.

**Three, and most urgent.** Conversion runs inside the API request, on a `numReplicas: 1`
service, and the decompression guard trusts sizes the archive *declares*. A sub-1 MB upload
that passes that guard was measured inflating to hundreds of MB of Buffers — external memory a
heap ceiling never sees. There was no throttle and no concurrency budget on the route. That is
a path from an authenticated contributor to OOM-killing the process that serves
`/emergency/trigger`. **Fixed and shipped today** (`f8f22818`); see §"Already done".

## What "as good as" and "better than" mean, from the evidence

The competitive read is unambiguous: **no digital-signage CMS ships editable text from an
uploaded PowerPoint. Everyone rasterizes**, and they say so in their own support docs —
ScreenCloud "documents are transcoded into .png", Appspace "the content within this card is not
editable", NoviSign "you cannot edit those files", Play "you can not edit text after
importing", Rise Vision "automatically imported as a PNG image". OptiSigns' own recommended
Canva path is "export a PNG and upload it". Xibo doesn't convert at all — it requires
PowerPoint installed on each Windows player. The one counter-example is Canva itself, a design
tool, not a CMS.

So:

- **As good as most** = a pixel-faithful rendered page per slide, split into per-page items with
  independent durations, and the losses disclosed. That is the whole industry standard, and it
  is a rasterizer plus good plumbing. **We currently deliver none of it** — a 3-page PDF
  becomes two white rectangles.
- **Better than most** has three unclaimed positions, and we can hold all three:
  1. **Both outcomes from one upload, chosen per page.** Everyone else picks one architecture
     and lives with it. We already have the editable reconstruction; we are missing the
     faithful render that makes it safe to offer.
  2. **Show the loss before commit.** Every vendor documents what was dropped in a support
     article the operator will never read. Nobody shows it on the page at import time.
  3. **Make it live.** This is the one nobody can copy: every competitor's import ends at
     pixels. We have 385 widget variants and a brand kit underneath. Promote the "TODAY:
     TUESDAY" text box the operator retypes weekly into a real CLOCK; the menu block into
     LUNCH_MENU. A 30-second demo, and it turns a one-time import into a reason to stay.

Two smaller gaps worth taking: per-page durations are bad almost everywhere (only Yodeck does
it properly — per-page override, `0` skips), and Appspace caps at 30 pages while we already
handle 40.

## Already done, today

Shipped in `f8f22818`, tests with a negative control, CI watched:

- PPTX media bounded by **actual decompressed bytes** (64 MB) and part count (300), closing the
  liar-zip hole the old guard's own comment admitted.
- Each media buffer released as soon as it uploads, instead of the whole deck's imagery being
  held across every sequential storage round trip.
- A per-process conversion slot (3 total, 1 per tenant) answering 429, behind `@Throttle`
  10/min.

This is a stop-gap. It removes the measured path to the emergency bus; it does not make import
good.

## Packages, in dependency order

### A — Stop claiming more than we do (small, no new infrastructure)
- Copy matches outcome on the page, the success screen, the errors and `import-designs.md`.
  Today a 3-page PDF yields the message "2 editable templates (one per page)".
- Reject legacy `.ppt`. It is accepted, is not a ZIP, fails the parse, and produces an
  `<img src="deck.ppt">` that renders nothing.
- Delete the catch-all fallback. A file we cannot convert is a failure, not a success — today
  even a bomb-guard rejection returns 200 with a template.
- Account for every source page; surface truncation (40 pages / 60 slides / 80 zones / 5,000
  chars) before commit, never after.
- One capability contract across UI, API and storage; normalise MIME server-side from the file
  signature. Today the API accepts a generic `octet-stream` PPTX the bucket then rejects.
- Audit row inside the commit. Template import stops creating a playlist as a side effect.
- Private staging bucket — copy the floor-plan pattern already in this repo (`public: false`,
  short-TTL signed URLs). Note the assets bucket is re-asserted `public: true` on **every
  boot**, so flipping it in the Supabase console is silently reverted.
- Carry moderation to derivatives: an extracted image from a contributor upload is written
  APPROVED today.
- One-line, high-value: `parseTagValue: false` in the PPTX XML parser. Without it `00123`
  becomes `123` — room numbers and identifiers change meaning.
- Also one-line-ish: read slide background from `p:bgRef` and `a:schemeClr`, not only a literal
  `srgbClr`. PowerPoint, Slides and Canva all emit the former, so **real dark-themed decks
  import as white text on a white canvas** today.

### B — Render for real (the unlock)
A `rasterize` job kind on the render worker that already exists. Proven feasible above.
- PDF per-page WebP at native aspect, inside the worker's Chromium, no network.
- Conversion moves out of the API request — the same move SEC-006 already made for Chromium,
  for the same reason.
- Real bounds in the worker: decompressed bytes, entries, depth, decoded pixels, CPU, memory,
  wall clock.
- Unlocks honest previews, preservation mode, thumbnails, scanned PDFs and playable per-page
  playlist items with independent durations.

### C — Review before commit
- Job lifecycle create → prepare → review → commit, tenant-scoped throughout, idempotent
  commit, real cancel. **Reuse what exists**: `WebhookDelivery` + `webhook-retry.worker.ts` is
  already a DB-backed queue with `FOR UPDATE SKIP LOCKED` claims, attempt counters, backoff and
  a heartbeat lease, and `leader-lease.service.ts` has 18 consumers. Do not build a platform.
- The review step shows the **converted** output. Per page: thumbnail, mode, editable object
  counts, specific warnings. Page selection and target aspect.
- Two modes only, and only modes we can produce: *Preserve appearance* and *Editable layers*.
  **No hybrid.** I tested twice whether artwork can be rendered without its text; pdf.js paints
  glyphs as paths, so a text-free backdrop is not cheaply available.

### D — Make it live (the differentiator)
- "Make this live" on an extracted text zone, mapping to the widget library. The builder has
  385 variants registered but no affordance to change a zone's widget type; that control is the
  missing piece and it is contained.
- Brand-kit application as an explicit, reversible choice.

### Deferred, deliberately
- **PPTX pixel fidelity.** Needs LibreOffice. Do **not** reach for Ghostscript or MuPDF — both
  are AGPL-3.0, and "it's SaaS, we never distribute a binary" is not a defence under §13;
  Artifex enforces. The safe path is **Gotenberg (MIT) as a separate Railway service**, which
  also keeps LibreOffice's ~600 MB and its zombie `soffice.bin` processes out of the API image.
  Watch the font trap: a bare container substitutes Liberation for Arial/Calibri and reflows
  geometry. Until then: editable extraction from PPTX, and point people at PDF for fidelity —
  every authoring tool exports one in a click.
- **Native `.educms-template.json` import.** The route, hook, file picker and error handling all
  exist; `handleImportClick` in the gallery has exactly one repo-wide reference — its own
  definition. Wiring one menu item is most of the work. Its export also drops scenes, touch
  actions and zone locks, which is the rest.
- **Connected sources, OCR, reimport.** Not before A–D. Note the K-12 incumbent, Carousel, is
  live-linked (snapshot refreshed every 15 minutes) — that is the shape to beat eventually.

## What I cut from the brief

- **Migration and legacy-caller compatibility.** No callers exist. The `/settings/imports` page
  is now a 53-line redirect stub.
- **A bespoke job platform.** Reuse the webhook worker's pattern; do not add a queue library.
- **Idempotency keys as a v1 requirement.** Right idea, wrong order — it protects against a
  retry storm that cannot happen yet.
- **Fidelity percentages.** Never ship a "98% fidelity" number. Name the specific thing that
  changed.

## Release gates

1. A golden corpus in the repo: real exported decks and PDFs with expected page counts, exact
   text (leading zeros included), and screenshots. Start from the audit's fixtures.
2. Source → converted preview → saved and reopened builder → player must agree, human-reviewed,
   on every fixture.
3. Fault injection: worker death, upload failure, audit failure, retry after timeout, concurrent
   commit, cancel. Every outcome complete or explicitly recoverable — never a partial success.
4. Contributor moderation and cross-tenant isolation proven end to end. Note TEN-001 gives
   imports **zero coverage by construction** — its `RISKY_METHODS` list is
   findUnique/findFirst/update/delete/upsert, and this controller uses only create/findMany.
5. Emergency path unaffected under a worst-case import: measure it, do not assume it.

---

# Execution log (2026-09-15)

Greg: "you are the lead on this, get everything done to make this feature a
highlight and not a non functional feature." What shipped, in order. Every
commit carries a negative control; every push was watched to green.

| # | commit | what |
|---|---|---|
| 0 | `f8f22818` | **P0.** Converter bounded by ACTUAL decompressed bytes, buffers released per part, per-tenant conversion slots + throttle. A sub-1 MB upload had a measured path to OOM-killing the single process that serves `/emergency/trigger`. |
| 1 | `b9badf53` | The audit, its evidence, the competitive read and this plan, committed so agents and future sessions can see them. |
| 2 | `912a347b` | Private `import-staging` bucket, re-asserted private on every boot. An imported original is the operator's document, not signage. |
| 3 | `f7a670ba` | `ImportJob` — the prepare-then-commit row. Deliberately not a queue. |
| 4 | `7f5f9f4f` | Format decided from BYTES. Legacy `.ppt` refused with the one-click fix instead of becoming `<img src="deck.ppt">`. |
| 5 | `6ca18004` | Staging sweep. Deletes only object keys a job row names. |
| 6 | `0b449103` | **Package D — make it live.** An imported text box can become a real clock, lunch menu or bell schedule. Six widgets, each of which actually keeps itself current. |
| 7 | `0d7ee656` `97854363` `47f40383` | **Package B — the rasterizer.** A `rasterize` job on the SEC-006 worker; 3/3 and 41/41 pages, 35 ms/page, no new dependency. Plus: anchored the worker's path containment, replaced a flaky RSS assertion with a bracket, and made a blank `PUPPETEER_EXECUTABLE_PATH` fall back. |
| 8 | (in 7) | **Package A-parsers.** Leading zeros, dark-deck backgrounds (`p:bgRef`/`schemeClr`), document order, group transforms, placeholder inheritance, PDF columns, and the page-accounting contract. |
| 9 | `c4c27dd1` | Sweep names the tenant it expires a row for — the Tenant Isolation gate caught this and was right. |
| 10 | `96638b39` | One golden corpus, one name for a page number. |
| 11 | `ff8999d8` | **Prepare then commit.** Audit inside the transaction; no playlist side effect; moderation follows derivatives; commit refuses a job prepared by a different converter. |
| 12 | `9cf5dff5` | **The sanitizer was rebuilding every uploaded file byte by byte.** 1 MB → 56 MB of heap; 8 MB → 431 MB. Affects every upload surface. Explains why `toSafeBuffer` exists. |
| 13 | `6dc726f5` | **The screen.** Shows the conversion, not the source file. Legacy `/imports/design` deleted. Closes a tenant-isolation row open since 2026-09-05. |
| 14 | `1ecb1625` | Template export carries scenes, locks and tap actions; the file has a way back in. |

## Still open, deliberately

- **PowerPoint pixel fidelity.** Needs a renderer. Gotenberg (MIT) as its own
  Railway service is the safe path; ⛔ Ghostscript and MuPDF are AGPL and SaaS
  is not a defence. Until then a deck gets editable layers and the screen says
  why, naming the one-click PDF export.
- **The corpus is thin.** `apps/api/test/fixtures/import-corpus/README.md` lists
  what is missing: a scan, a rotated page, a cropped page, a password-protected
  file, a malformed file, and real exported decks from PowerPoint, Slides and
  Canva. That is the next release gate, not a nice-to-have.
- **The real-browser raster suites skip in CI** (puppeteer-core is ESM-only and
  Jest cannot load it without a flag). They skip LOUDLY, naming themselves, and
  run locally via `pnpm --filter api run test:raster`. Worth wiring into CI.
- **Connected Canva/Slides accounts, OCR, reimport.** Unchanged from the plan.

