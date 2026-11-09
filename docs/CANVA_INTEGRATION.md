# Canva integration — current state, the path forward

**Last verified against code:** 2026-11-09 (Stage 1 import behaviour, the Stage 2 status, env variables). Competitor features and pricing in the comparison table, Canva API behaviour and partner-program lead times are third-party facts this repository cannot prove: unverified.

Operator (2026-05-03): "we talked about adding a full canva
integration, will that happen? import templates direct from canva and
be able to update using our toolbar and editing"

Honest answer: **yes, in two stages.** Stage 1 ships now and works
without Canva's involvement. Stage 2 needs Canva's partner program
approval and ships when that lands.

## Stage 1 — PDF / PPTX / image import (AVAILABLE NOW)

Every Canva design can be exported as a PDF or PNGs, and so can Google Slides, PowerPoint, Keynote, Figma and Adobe Express. The import flow (`apps/api/src/imports/`, controller `api/v1/imports`: `POST prepare`, `POST jobs/:id/commit`) accepts these formats, detected by file signature (`file-signature.ts`): **PDF, PPTX, PNG, JPEG, WebP and VenueOS's own export**, up to **50 MB** per file (`MAX_BYTES` in `import-jobs.controller.ts`). Keynote, Slides, Figma and Canva are reached by exporting to PDF or PPTX first; there is no direct Keynote or Slides file path.

1. Customer designs anywhere and exports a PDF (or PPTX / images).
2. Opens **Import design** in the Templates section, `/[schoolId]/templates/imports`. (The old `/[schoolId]/settings/imports` is a client-side redirect stub kept for old links; the page `apps/web/src/app/[schoolId]/templates/imports/` is canonical, see also `docs/product/CONCIERGE.md`, "Design Imports".)
3. Previews every page, then chooses **Create as Template** or **Create as Playlist**, and confirms. The parsers live in `apps/api/src/imports/parsers/` (`pdf-parser.ts`, `pptx-parser.ts`); PDF pages are rasterised by the PDF raster pipeline in `apps/api/src/proxy/pdf-raster-pipeline.ts`. The April text said PowerPoint goes through LibreOffice; that is not what the code does (PPTX has its own OOXML parser).
4. Customer drops the result on any screen.

What works in this stage (as built, not as the April plan promised):

- Multi-page PDFs and decks are previewed page by page and committed as a template or a playlist.
- The output is a regular Asset / Template / Playlist, so positioning, ad overlays, schedules and emergency takeover apply.
- To update, re-import; there is no sync with the source file. Whether a re-import replaces the earlier result in place is not verified here.

What stage 1 doesn't do:

- ❌ Faithful per-element editing is limited to what the PDF/PPTX parsers can recover; a rasterised page cannot have its text changed without re-exporting from Canva
- ❌ Auto-sync when the customer edits the original in Canva — they
  re-export + re-upload manually
- ❌ Animations / transitions / video / hyperlinks (PDF flattens those)

Use stage 1 if:

- You have an existing Canva or Slides workflow you don't want to abandon
- You need a polished design on screen TODAY without a partnership
- You're OK re-exporting on the (occasional) updates

## Stage 2 — Canva Connect (LIVE EDIT, AUTO-SYNC) — pending Canva approval

The "import templates direct from Canva and be able to update using
our toolbar and editing" path. This needs:

1. **Canva Connect partner approval.** We apply at
   [canva.dev/docs/connect](https://www.canva.dev/docs/connect/),
   register VenueOS as an integration, get a client id + secret.
   Lead time: 2-4 weeks once we apply.
2. **OAuth app** — customer signs in with Canva, grants VenueOS access
   to their designs. Refresh tokens stored encrypted in the same
   `IntegrationToken` envelope-encrypted store the streaming + POS
   credentials use.
3. **Design picker** — modal that lists the customer's Canva designs
   with thumbnails (paginated via `/v1/designs`). Pick → fetch the
   design's exported render → store as an Asset.
4. **Resync cadence** — opt-in per imported design:
   - Daily check (default) — re-fetch if Canva's `updated_at` is
     newer than our last sync
   - Hourly cap (4× / hour) for high-change designs (cafeteria menus,
     daily specials)
   - Manual "sync now" button on each imported asset
5. **Toolbar editing** — *partial*. Canva's API doesn't expose
   per-element write access for arbitrary designs. What we get:
   - Read the design's text fields (titles, body, prices)
   - Surface them in our PropertiesPanel as editable text
   - On save, push back via Canva's
     [autofill API](https://www.canva.dev/docs/connect/api-reference/autofills/)
     for designs that have **template variables** declared
   - For non-templated designs: text is read-only in our editor;
     customer edits the source in Canva and we auto-resync
   - Re-render happens server-side via `/v1/designs/{id}/export`

What stage 2 will offer:

- ✅ Live two-way connection (with the autofill caveat above for
  non-templated designs)
- ✅ Customer's designs stay in Canva — we're a renderer, not a fork
- ✅ Edits in Canva show up on signage within the resync window
- ✅ Edits in our editor (where supported) push back to Canva via
  autofill

What stage 2 still won't do (Canva API limits):

- ❌ Edit elements that aren't declared as template variables — Canva
  doesn't allow it via API for IP-protection reasons
- ❌ Animation / video / interactive elements
- ❌ Realtime sync — Canva doesn't push webhooks; we poll on a budget

## Sister integrations on the same code path

The architecture (OAuth + design list + export + resync) is the same
for every cloud-design tool. Once Canva Connect is wired we add:

- **Google Slides** — Drive API + Slides API. Export as PDF.
  Customer-data scopes already common. Probably ships within a week
  of Canva.
- **Microsoft PowerPoint Online** — Microsoft Graph API.
  `/me/drive/items/{id}/content?format=pdf`. Same shape.
- **Figma** — REST API. Designers love this for kiosk hero art that
  gets iterated weekly. Same shape.
- **Adobe Express** — newest of the bunch; if their API is open by
  the time we ship Canva, we add this too.

## Why we're shipping stage 1 first

Half of the value of Canva integration is "I designed this in Canva
and now it's on my signage." Stage 1 delivers that without:

- A 2-4 week partner-approval lag
- Customers having to grant OAuth scopes to a brand they don't know yet
- A maintenance burden when Canva's API changes (their Connect API is
  still v1, expect breaking changes)

The 90% case — "I made a flyer, put it on my screen" — works the
moment a customer drags their PDF into our import page.

## Pricing positioning vs. competitors

| Vendor | Canva integration |
|---|---|
| **VenueOS — Stage 1** | PDF/PPTX/Slides import, free, all tiers |
| **VenueOS — Stage 2** | Live Canva sync, Standard tier and up |
| Yodeck | Canva Connect (live sync), Pro tier ($9/screen/mo) |
| Rise Vision | Canva Connect (live sync), all tiers |
| OptiSigns | Canva Connect (live sync), Pro tier |
| ScreenCloud | Canva Connect (live sync), all tiers |

Stage 2 keeps us on parity. Stage 1's PDF route is something every
competitor also offers — but our import pipeline auto-creates the
Playlist (others stop at "asset uploaded, build the playlist
yourself"), which is faster end-to-end.

## How to verify Canva Connect status

- Apply at [canva.dev/docs/connect](https://www.canva.dev/docs/connect/) — they have a "Become a partner" button on the developer portal
- Track approval status with Canva (contact route unverified).
- `CANVA_CLIENT_ID` and `CANVA_CLIENT_SECRET` (declared in `docs/ENVIRONMENT.md`) are read today **only** by the integrations health page (`apps/api/src/health/integrations-health.controller.ts`). Setting them does **not** light anything up: the OAuth picker and auto-resync are not built, and the health card reports `COMING_SOON` either way. The April text said the page "lights up automatically"; it does not.

## Status today

Stage 1 is built (above). Stage 2 (Canva Connect) is **not built**; the integrations health page lists it, Google Slides and PowerPoint Online as `COMING_SOON` (the code comments say "Sprint 11"). Partner-approval status is unknown to the repository: ask the owner. The April "schema + UI scaffold makes the cutover a one-file change" claim was not checked and should not be relied on.
