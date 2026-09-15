# Template import — what I verified myself (2026-09-15)

Lead's own pass over Codex's audit (`docs/design/proposals/2026-09-15-template-import-audit/`).
Everything below is something I ran or read directly, not a restatement of that audit.
Baseline `f0d42376`. Sandbox = web 3100 / api 8081 / local Postgres. Production was read
ONLY (two SELECTs against `audit_logs` / `templates`). No application code changed.

## 1. The feature has never been used in production

Two independent checks, per the absence-claim rule:

| check | result |
|---|---|
| `audit_logs` rows with `action='IMPORT_DESIGN'` | **0**, all time, all tenants |
| `templates` with the importer's own `description LIKE 'Imported from%'` | **0** |
| control: total `audit_logs` rows / distinct actions / oldest | 23,828 · 113 actions · 151 days |

The audit log is demonstrably working and captures 113 other action types. Eight PDF/PPTX
assets exist, all uploaded through the normal asset library, none through import.

**Why it matters.** Codex's brief spends significant design on migration safety: keeping the
old endpoint compatible, not reinterpreting legacy `targetType` defaults, idempotency for
retries of in-flight legacy calls. There are no callers to protect. We can change the
contract outright, which removes a whole package of work. It also reframes severity: the
public-bucket P1 has **zero** live exposure today, because no original has ever been stored
by this path. It is a launch blocker, not an incident.

## 2. The headline defect, reproduced live through the real UI

Not a mock: the running sandbox, the real browser, the real endpoint. Fixture is the audit's
3-page `mixed-layout.pdf` (page 1 text + artwork, page 2 artwork only, page 3 text).

- The importer produced **two** templates: `— Page 1` and `— Page 3`. Page 2 is gone.
- The success screen read: *"Imported into 2 editable templates (one per page) — every text
  box and image is editable."* It says "one per page" while dropping a third of the document.
- Opening the result in the builder: an **800×450 white canvas with one text zone**. The
  source page's background colour, heading treatment and artwork are all absent.
- The Preview step rendered **nothing at all** — a blank white box where the browser's PDF
  iframe failed. So preview is not merely "the source instead of the conversion"; it is
  frequently empty.

Screenshots: `evidence/import-02-preview.png`, `import-03-done.png`, `import-05-builder.png`.

## 3. The rasterizer we supposedly do not have is already in the image

`imports.controller.ts` says rasterizing "would need a canvas/native renderer we
intentionally avoid." That comment is stale. The API already ships, in production:

| capability | where |
|---|---|
| Chromium + fonts (`ttf-freefont`, `font-noto`) | `Dockerfile` runner stage, `/usr/bin/chromium-browser` |
| `puppeteer-core` | `apps/api/package.json`, with a Dockerfile assertion that it is in the prod closure |
| A hardened, forked, one-job-then-exit render worker | `apps/api/src/proxy/render-worker.ts` (SEC-006) with its own protocol, env allowlist, crash handling and concurrency cap |
| `sharp` (resize/encode) | already used by branding, assets and media optimisation |
| `pdfjs-dist` | already an API dependency, already used for text extraction |

The Dockerfile comment even says "the renderer and the **poster/PDF paths** run in THIS image."

**Proof of concept** (`evidence/raster-poc.cjs`), using only those dependencies — pdf.js
rendering to a canvas inside a headless Chromium page, no network, module and worker injected
as blobs:

| fixture | result |
|---|---|
| 3-page `mixed-layout.pdf` | **3/3 pages** rendered, 207 ms total, 1600×900 each. Page 2 — the one the importer drops — renders perfectly. |
| 41-page `forty-one-pages.pdf` | **41/41 pages**, 1,435 ms (35 ms/page), ~259 KB total as WebP |

So the single biggest fix — real per-page rasterization, giving us honest previews,
preservation mode, thumbnails and scanned-PDF support — needs **no new dependency, no new
licence and no new attack surface**. It needs a second job kind on a worker that already
exists. That changes this from a procurement question into a week of work.

## 4. Conversion must leave the API process — and the pattern is already established

`railway.json` sets `"numReplicas": 1`. Conversion currently runs inside the API request,
holding a 50 MB upload in memory with a 250 MB inflation ceiling, in the **same single
process** that publishes lockdown alerts. SEC-006 already moved Chromium out of that process
for exactly this reason: *"before this file existed, Chromium ran inside the NestJS process
that publishes lockdown alerts. A renderer-process exploit landed in the emergency bus."*

The same argument applies to parsing hostile PPTX/PDF bytes. The fix and the rasterizer are
the same piece of work: run conversion in the forked worker.

## 5. A hybrid "fidelity backdrop + editable text" is not cheap. Ship two honest modes.

The attractive idea is a rendered page underneath real editable text. It only works if the
backdrop has no text in it, or you get duplicate glyphs and stale words behind edits. I tested
whether we can render artwork without its text:

| attempt | result |
|---|---|
| Proxy the canvas 2D context, suppress `fillText`/`strokeText` | **0** intercepted calls, 0 pixels changed |
| Same, with pdf.js `standard_fonts` + `cmaps` packaged and served | **0** intercepted, 0 pixels changed |

pdf.js paints glyphs as **paths**, so at the canvas there is no difference between a letter
and a logo. The operator list does name the text cleanly (`beginText`/`showText`/`endText`),
so a filtered re-render is theoretically possible — but pdf.js's public API will not render a
modified operator list, so it means depending on internals of a library we upgrade.

**Conclusion: do not promise a hybrid in v1.** Two clean modes — *Preserve appearance*
(rendered page, text not individually editable) and *Editable layers* (extracted objects, no
raster) — are honest, achievable now, and match what the audit recommended. This finding gives
that recommendation an empirical basis rather than a preference.

## 6. The private-bucket fix has a precedent in this repo

`supabase-storage.service.ts` creates the assets bucket `public: true` and its own comment
says "The bucket is PUBLIC and serves inline." The import pipeline explicitly added the
PowerPoint MIME types to that public bucket's allowlist.

But the same file already implements the fix pattern: the **floor-plan bucket is
`public: false`**, reachable only through short-TTL signed URLs minted server-side from
RBAC-gated endpoints, re-enforced on every boot. Staging imports privately is a copy of an
existing, working pattern — not a new design.

Related, and confirming the audit's MIME finding has a real consequence: the storage
allowlist does **not** include `application/octet-stream`, while the import filter
deliberately accepts it for `.pptx`. A PPTX arriving with a generic MIME is accepted by the
API and then rejected by the bucket. That is a broken upload, not a security hole.

## 7. Confirmed by reading, worth stating plainly

- `.ppt` (legacy binary) is accepted by both the MIME filter and `isPptxUpload`, is not a ZIP,
  fails the parse, and lands in the fallback that creates an **IMAGE zone whose `assetUrl` is
  the `.ppt` file** — an `<img src="deck.ppt">`, which renders nothing. Confirmed in source.
- The PDF fallback differs: it creates a `WEBPAGE` zone (an iframe of the PDF), which at least
  renders in a browser. The audit read both as IMAGE; only the PPTX branch is.
- The UI's own copy — "anything we can't parse falls back to the page as a single image" — is
  false for exactly the PPTX case, where the fallback is the broken image above.
