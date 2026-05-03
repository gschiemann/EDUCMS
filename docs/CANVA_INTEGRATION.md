# Canva integration — current state, the path forward

Operator (2026-05-03): "we talked about adding a full canva
integration, will that happen? import templates direct from canva and
be able to update using our toolbar and editing"

Honest answer: **yes, in two stages.** Stage 1 ships now and works
without Canva's involvement. Stage 2 needs Canva's partner program
approval and ships when that lands.

## Stage 1 — PDF / PPTX / Slides import (AVAILABLE NOW)

Every Canva design can be exported as a PDF or a set of PNGs. So can
Google Slides, PowerPoint, Keynote, Figma, Adobe Express. We accept
all of them through one import flow:

1. Customer designs anywhere (Canva, Slides, Figma, etc.)
2. Hits **Download → PDF** in the source tool
3. Drags the PDF into VenueOS at `/[schoolId]/settings/imports`
4. We split it into per-page PNG / JPG assets, auto-create a Playlist
   named after the file, set per-page duration to 8s
5. Customer drops the playlist on any screen — done

What works in this stage:

- ✅ Multi-page PDFs become multi-asset playlists
- ✅ Single-page PDFs become a single image asset, droppable as an
  IMAGE widget
- ✅ PowerPoint (.pptx) / Keynote / Slides routed through the same
  pipeline (LibreOffice → PDF → PNG)
- ✅ Editable in our editor: positioning, ad overlays, schedules,
  emergency-content takeover all work because the output is a regular
  Asset / Playlist
- ✅ Re-upload to update — drop a new export over the old one and
  every screen pulls the new pages in their next sync

What stage 1 doesn't do:

- ❌ Per-element editing of the imported design's text — once it's a
  PNG we can't change the text without re-exporting from Canva
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
- Track approval status by emailing partners@canva.com
- Once approved, set `CANVA_CLIENT_ID` and `CANVA_CLIENT_SECRET` env
  vars on Railway and the integration page lights up automatically

## The roadmap commitment

Stage 1: shipping in this commit (page + upload endpoint scaffold).
Multi-page PDF render to image is on a follow-up — we land the
upload + asset creation now, the page-split worker behind a feature
flag on the next commit so the import button is functional but
multi-page PDFs warn "split into single-page exports for now" until
the worker ships. **Single-page PDFs / PNGs / JPGs work end-to-end
today.**

Stage 2: blocked on Canva approval. We can apply this week. Realistic
ship date is 30–45 days from approval. The schema + UI scaffold I'm
shipping in this commit makes the cutover a one-file change once the
client id + secret arrive.
