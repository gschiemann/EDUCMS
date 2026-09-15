# Design import: the competitive bar

Web research, 2026-09-15. Every claim carries a URL. Support documentation is treated as truth; marketing pages are labelled as such where they disagree.

## Verdict

**To be as good as most CMS solutions, we must produce a pixel-faithful rendered page per slide/page, split it into per-page items with independent, skippable durations, and disclose per page what could not be preserved — before the operator commits.** That is the entire industry standard, and it is a rasterizer plus good plumbing. **To be better, we must keep the editable reconstruction we already have and offer it as a per-page choice beside the faithful render, with a visible diff and a live re-sync path back to the source file.** The research finding that should drive the decision is this: *no digital-signage CMS ships editable text layers from an uploaded PPTX.* Five vendors say so in their own support docs, in almost the same words. VenueOS's existing PPTX text-box extraction is therefore already past every competitor — but it is past them on an axis none of them compete on, while losing badly on the axis all of them win: the output looks like the source. Ship fidelity first, then sell editability as the differentiator; do not ship editability alone and call it import.

## The crux: editable vs rendered

| Product | Accepts | Result of import | Editable after? | Live-linked? |
|---|---|---|---|---|
| **OptiSigns** | PDF, DOC/DOCX, PPT/PPTX, XLS/XLSX, "all OpenOffice file types", JPG/PNG/BMP/GIF, MP4 | Rendered asset | **No** | Upload: no. PowerPoint Online app: **yes**, default 12 h refresh |
| **Yodeck** | PDF, Word, Excel, PPT/PPTX | "automagically converted to PDF and displayed as slideshows"; or PPTX→video on Yodeck's servers | **No** | No |
| **ScreenCloud** | PSD, AI, SVG, PDF, HTML, RTF, DOC/DOCX, PPT/PPTX, XLS/XLSX, ODT/ODP/ODS, PAGES/KEY/NUMBERS | "Documents are transcoded into **.png**" | **No** | Upload: no. Google Slides app: **yes** (publish-to-web) |
| **Rise Vision** | Canva (embedded editor), Google Slides URL | "automatically imported as a **PNG image**" | **No** in Rise Vision; re-edit via the embedded Canva editor | Slides: yes. Canva: no |
| **Appspace** | .doc/.docx, .xls/.xlsx, .ppt/.pptx, .pdf | Content Conversion card, multi-page | **No** — "the content within this card is **not editable**" | No |
| **Xibo** | ppt/pps/pptx, pdf | **No server conversion at all.** PPT `renderAs: native`; PDF `renderAs: html` via PDF.js on the player | **No** | No |
| **NoviSign** | PPT/PPTX/PPS/PPSX, PDF | "converts it to images—one image per page/slide" | **No** — "you cannot edit those files" | No |
| **Play Digital Signage** | .ppt .pptx .key .odp | "Each slide … converted to a .png image at 1920 x 1080" | **No** — "you can not edit text after importing" | No |
| **Carousel** (K-12 incumbent) | Canva, Google Slides, PowerPoint, Word, Excel | Live web view, or snapshot refreshed every 15 min | **No** — you edit in the source app | **Yes** |
| **Skykit Beam** | Google Slides, PowerPoint, Keynote, PDF | not verified | not verified | PowerPoint Auto-Publish syncs **nightly** |
| **PosterMyWall** | No documented PPTX import | Exports JPG/PNG/PDF/MP4/GIF/`.wgt` | Only its own designs | Hybrid ("Save and Recreate") |
| **Vestaboard** | — | 6×22 split-flap, 132 chars | n/a | n/a |
| **Canva itself** | pptx, pdf, ai, key, Office, OpenOffice, Affinity | **Genuinely editable slides** | **YES** | n/a |

## Limits, losses, and how loss is disclosed

| Product | Size / page limits | Explicitly lost | How the loss is surfaced | Per-page durations |
|---|---|---|---|---|
| OptiSigns | 1 GB per file (liftable); playlists 2 GB | "uploaded PowerPoint presentation will be played without transition or animation effect"; PowerPoint Online: "Videos will not play and will only show the thumbnail" | KB article only — **nothing at upload time** | **No.** One duration for the whole document, divided across pages (min 4 s/page) |
| Yodeck | not verified | Embedded video "will not be displayed"; YouTube in PPT unsupported | FAQ article | **Yes, best in class**: default 10 s, per-page override, duration `0` skips the page |
| ScreenCloud | 5 GB general, **1 GB documents**, 200 files/batch | Slides app: "Embedded videos to autoplay", "Animation images (.GIF)", "Special effects and transitions between slides"; ≤10 slides recommended; 16:9 only | Help article; upload fails outright on hidden/skipped slides or password protection | Slides app: total duration **divided** across slides |
| Rise Vision | not verified | not verified | — | Slides: per-slide duration |
| Appspace | **30 pages max**; filenames must be alphanumeric or upload fails | not verified | Docs state non-editability plainly | not verified |
| Xibo | — | "A Preview for PowerPoint files is not available in the CMS"; cannot advance slides (file must carry its own timings); "error capture and reporting is outside the control of Xibo" | Manual, bluntly | PDF: "Set a duration to apply to each page" |
| NoviSign | **10 file conversions/month per license**, pooled | animations, transitions, videos | Support doc | Splits into separate items ("MyDoc – 1/2/3") |
| Play | — | "animation effects are lost because our software is not a PowerPoint playback tool" | Support doc | not verified |
| Carousel | — | Animations hazardous; you hand-enter load time in a Page Duration field | Support doc | Page Duration field |
| Canva | **1,400 elements/images per file** | "charts, SmartArt, 3D objects, and WordArt aren't supported and will be ignored"; animations and embedded videos unsupported; a scan is processed as "a flat or merged image" | Help Center | n/a |

**Nobody shows the operator a per-page preview of what was lost at import time.** Every vendor documents the loss in a support article the operator will never read. That is a real, unclaimed UX position.

## A. What is the realistic industry standard?

Rasterize. Universally. Strongest evidence, all from vendor support docs:

- ScreenCloud: **"Documents are transcoded into .png"** ([help](https://help.screencloud.com/en/articles/10120839-screencloud-content-management-supported-file-types-how-content-is-converted))
- Appspace: **"Unlike other Appspace cards, the content within this card is not editable."** ([docs](https://docs.appspace.com/latest/how-to/convert-transcode-content/))
- Play Digital Signage: **"you can not edit text after importing"** ([support](https://playsignage.com/support/office-documents/))
- NoviSign: **"you cannot edit those files, since they are all image items in your Media Center"** ([help](https://www.novisign.com/help-center/studio/creative/converting-files/))
- Rise Vision: **"your design will be automatically imported as a PNG image"** ([help](https://help.risevision.com/hc/en-us/articles/27304751470484-How-do-I-add-content-to-Rise-Vision-using-Canva))
- OptiSigns' *own recommended* Canva path is export a PNG/MP4 and upload it as a static asset ([KB](https://support.optisigns.com/hc/en-us/articles/1500005888781-How-to-Best-Use-Canva-with-OptiSigns))
- Xibo doesn't even rasterize — it demands **"a full copy of Microsoft PowerPoint installed on each Windows Player"** ([manual](https://xibosignage.com/manual/en/media_module_powerpoint))

The single counter-example is **Canva itself**, which does produce editable slides from PPTX — with hard edges: 1,400 elements per file, and charts/SmartArt/3D/WordArt silently dropped ([help](https://www.canva.com/help/powerpoint-import/)). Canva is a design tool, not a signage CMS. So the honest framing is: *editable PPTX import is technically proven but commercially unclaimed in signage.* The reason is not difficulty — it is that a rasterized slide always looks right, and a reconstructed one sometimes doesn't. That asymmetry is the whole competitive lesson.

## B. Genuine white space

1. **Both outcomes from one upload, chosen per page.** Faithful render *and* editable reconstruction, side by side with a visible diff. No vendor offers a choice; each picks one architecture and lives with it.
2. **Loss disclosed at import, per page.** Currently 100% support-article, 0% in-product.
3. **Per-page duration and skip.** Only Yodeck does this properly. OptiSigns divides one duration across pages — a daily papercut for a school with a 12-page deck.
4. **Live re-sync for an uploaded file.** Carousel (15-min snapshots), Skykit (nightly) and OptiSigns' PowerPoint Online prove demand. Everyone else's upload is a dead copy, and "I have to re-upload it every time" is the actual operator complaint.
5. **Canva via the official Connect API.** Rise Vision and NoviSign both use the Canva *Button* and get a PNG back. The Connect API exports **pptx** ([docs](https://www.canva.dev/docs/connect/api-reference/exports/create-design-export-job/)) — which we could convert to editable zones. Nobody takes that path.
6. **Vertical-specific**: brand-token reconciliation on import, and proving an emergency overlay stays legible over an imported board. Nobody in this market has an emergency layer to protect.

## C. What rendering technology they appear to use

| Product | Evidence | Confidence |
|---|---|---|
| **Appspace** | **Documented**: the on-prem PowerPoint Transcoder requires Microsoft Office/PowerPoint installed on the Appspace server, incl. Visual Basic for Applications and .NET Programmability Support ([docs](https://docs.appspace.com/appspace/5.4/admin/appspace-administration/general-configuration/powerpoint-transcoder/)) | **Stated** |
| **Xibo** | **Proven from source**: `modules/powerpoint.xml` = `renderAs: native`, empty stencil; `modules/pdf.xml` = `renderAs: html`, rendered client-side by **PDF.js** on canvas; the CMS Dockerfile installs **no** LibreOffice/unoconv/Ghostscript/ImageMagick ([Dockerfile](https://raw.githubusercontent.com/xibosignage/xibo-cms/develop/Dockerfile)) | **Stated** |
| **Yodeck** | Docs: PPT/PPTX "automagically converted to **PDF**" then displayed as a slideshow, plus a separate PPTX→video conversion "on Yodeck's servers". PPTX→PDF→raster is LibreOffice's signature pipeline | **Inference** |
| **ScreenCloud** | Accepts ODT/ODP/ODS **and** PAGES/KEY/NUMBERS and emits `.png` — that import matrix is essentially LibreOffice's | **Inference** |
| **OptiSigns** | Supported list includes "all OpenOffice file types" — same tell | **Inference** |
| **Rise Vision / NoviSign** | Canva Button/SDK returning a PNG; no server conversion implied | **Inference** |

No vendor except Appspace publishes its stack. The inferences above are labelled as such and should not be quoted as fact. I found **no** job posting or public engineering statement naming a converter — that is a *not verified* result, not a negative finding.

## D. Licensing reality check (Docker on Railway)

### Rasterizing / conversion engines

| Tool | License (verified) | Railway/Docker | Cost | The gotcha |
|---|---|---|---|---|
| **LibreOffice headless** | `MPL-2.0 OR LGPL-3.0-or-later` ([licenses](https://www.libreoffice.org/about-us/licenses/)) | Yes. Subprocess — no linking, no copyleft reach. **~285 MB compressed / 600 MB–1 GB uncompressed**; ~512 MB–1 GB RAM per conversion; 2–5 s cold spawn | Free | **Fonts.** The container ships almost none → silent Arial/Calibri→Liberation substitution and reflowed geometry. Also one profile = one instance: use `-env:UserInstallation=file:///tmp/$UUID` or concurrent spawns collide. Reap zombie `soffice.bin` |
| **Gotenberg** | `MIT` ([repo](https://github.com/gotenberg/gotenberg)) | **Best fit**: separate Railway service, HTTP API, zero linking. Docs: min 512 Mi / 0.2 CPU, recommend 1024 MB | Free | Docs warn LibreOffice "is more prone to memory drift than Chromium"; raising concurrency without watching RSS = OOM kill. Same font trap |
| **unoconv** | `GPL-2.0` — **ARCHIVED 2025-03-31**, upstream says migrate to unoserver | via LibreOffice | Free | Upstream's own words: the listener "is not handling multiple requests at the same time." Don't start here in 2026 |
| **Poppler** (`pdftoppm`) | `GPL-2.0-only OR GPL-3.0-only` | Yes, ~20 MB, fast | Free | **PDF only.** GPL has **no §13 network clause** — shelling out to the CLI is safe. Never link `libpoppler` |
| **PDFium / `@hyzyla/pdfium`** | PDFium `BSD-3-Clause`; wrapper `MIT` (prebuilt WASM) | Excellent — WASM, no native deps, no image bloat | Free | **PDF only.** Returns raw bitmaps; pair with `sharp` |
| **MuPDF / mupdf.js** | `AGPL-3.0-or-later` | Technically fine | Commercial price **not verified** (quote-only) | ⛔ **AGPL §13 trap** |
| **Ghostscript** | `AGPL-3.0-or-later`, licensing "handled exclusively by Artifex" | Fine, ~50 MB | **Not verified** | ⛔ **AGPL §13 trap** |
| **Aspose.Slides** (Node via Java) | Commercial perpetual | Dev Small Business **$999**; **Developer OEM $2,997** (unlimited locations); metered from $1,999/mo ([pricing](https://purchase.aspose.com/pricing/slides/java/)) | — | Needs a **JDK in the container** (JVM + Node = heavy). "1 Deployment Location" does **not** cover multi-replica cloud — Railway scaling pushes you to OEM |
| **CloudConvert** | Commercial ToS | Credit-based; **Office→PDF = 2 credits**, 1 credit ≈ 1 min ([pricing](https://cloudconvert.com/pricing)). USD figures not verified on their own site | — | Credits scale with *duration* — a 60-slide deck costs more than a 3-slide one |
| **ConvertAPI** | Commercial ToS | $10/mo annual = 12,000 conv (~$0.010 ea); $30/mo = 60,000 (~$0.006) ([prices](https://www.convertapi.com/prices)) | — | No self-host. Uploading student-facing PPTX to a third party is a **K-12 DPA/PII question** |

### Extract text + positions (no rasterizing) — the editable path

| Lib | License | Note |
|---|---|---|
| **pdf.js** (`pdfjs-dist`) | `Apache-2.0` | Per-item `transform` matrices = real x/y. Safe. Node needs a canvas polyfill to render |
| **pdf-lib** | `MIT` | **Creates/modifies only — does not rasterize or extract text.** Common misconception |
| **officeparser** | `MIT` | PPTX → typed AST (paragraphs, tables, notes) |
| **JSZip + raw DrawingML XML** | `MIT OR GPL-3.0` — **elect MIT** | The only path to true **EMU coordinates** per shape. EMU→px is ÷9525; inherited layout/master placeholder geometry must be resolved or half the shapes come back unpositioned |

**Safe for a closed-source SaaS:** Gotenberg (MIT), LibreOffice as a subprocess, Poppler CLI, PDFium, pdf.js, pdf-lib, officeparser, JSZip-under-MIT, and the commercial SaaS/Aspose options.

**Legal landmines: Ghostscript and MuPDF.** Both are AGPL-3.0-or-later. Artifex states it plainly: you "cannot deploy our open-source as part of a server-based application or service, without disclosing your own application's full source code under AGPL to any users interacting with it" ([artifex.com/licensing](https://artifex.com/licensing/)). That is **§13** — "we never distribute a binary, it's SaaS" is **not** a defense, and Artifex enforces (*Artifex v. Hancom*). Treat both as no-go unless someone buys a commercial license first.

**Recommended shape:** Gotenberg as a sidecar service for the fidelity render (keeps LibreOffice's ~600 MB and its zombie processes out of the API image), plus JSZip/officeparser in-process for the editable text+position path we already have. Neither carries copyleft risk.

## Verification limits

- **help.risevision.com, canva.com/help and support.carouselsignage.com return 403/Cloudflare to direct fetch.** Their quotes here come from the search index of those exact official articles, not a direct read. Treated as strong but second-hand.
- **yodeck.com/docs** renders client-side; its quotes likewise come via search of the official pages plus the WordPress `academy/` and `use-cases/` mirrors, which fetched cleanly.
- **ScreenCloud's Canva app FAQ answers are collapsed client-side and could not be read.** The marketing page claims multi-slide display "complete with animated transitions", while the same page's FAQ list contains "I don't see the transitions from my Canva design playing on screen, how come?" — a marketing/support tension worth noting, but **the answer text is not verified**.
- Several cells are marked **not verified** rather than inferred: Yodeck size limits, Rise Vision limits/losses, Appspace losses, Play per-slide durations, Skykit conversion format and durations, Aspose.Slides Cloud pricing, CloudConvert USD pricing, ConvertAPI overage rates, Artifex commercial pricing.
- **No public engineering statement naming any vendor's converter was found.** Absence of evidence only; the Section C inferences are labelled.

## Sources by product

Every claim in the tables above traces to one of these. Support/help documentation unless marked *(marketing)*.

**OptiSigns** — [supported file types + 1 GB limit](https://support.optisigns.com/hc/en-us/articles/360016342373-What-types-of-files-are-supported) · [PowerPoint slides: duration for the entire document, min 4 s/page](https://support.optisigns.com/hc/en-us/articles/360016371154-How-to-use-PowerPoint-slides-with-OptiSigns) · [three PowerPoint options; PowerPoint Online live-link, 12 h default; "Videos will not play and will only show the thumbnail"](https://support.optisigns.com/hc/en-us/articles/4414355658899-How-to-Use-Microsoft-PowerPoint-with-OptiSigns) · ["played without transition or animation effect"](https://support.optisigns.com/hc/en-us/articles/360034219593-PowerPoint-Transition-and-Animation-effect) · [PDF: one duration split across pages, not split into playlist items](https://support.optisigns.com/hc/en-us/articles/360024310813-How-to-use-a-PDF-with-OptiSigns) · [Canva: export PNG/MP4 and upload is the *recommended* path](https://support.optisigns.com/hc/en-us/articles/1500005888781-How-to-Best-Use-Canva-with-OptiSigns)

**Yodeck** — ["automagically converted to PDF and displayed as slideshows"](https://www.yodeck.com/docs/user-manual/what-types-of-documents-does-yodeck-support/) · [document vs server-side video conversion](https://www.yodeck.com/use-cases/how-to-use-powerpoint-for-digital-signage/) · [per-page durations, "Set duration for another page", 0 = skip](https://www.yodeck.com/academy/how-to-upload-documents/) · [embedded video in PPT will not display](https://www.yodeck.com/docs/user-manual/can-i-use-powerpoint-slides-with-videos/)

**ScreenCloud** — ["Documents are transcoded into .png"; 5 GB / 1 GB doc / 200-file limits](https://help.screencloud.com/en/articles/10120839-screencloud-content-management-supported-file-types-how-content-is-converted) · [Google Slides: live-linked, no PowerPoint, transitions/GIF/embedded video lost, ≤10 slides, duration divided](https://help.screencloud.com/en/articles/10115619-google-slides-app-troubleshooting-and-optimizing-your-presentations-with-screencloud) · [PowerPoint upload troubleshooting: embedded fonts, hidden slides, password protection](https://help.screencloud.com/en/articles/13558587-how-can-i-resolve-powerpoint-upload-issues-in-screencloud) · [Canva app *(marketing)* "complete with animated transitions"](https://screencloud.com/apps/canva)

**Rise Vision** — [Canva → "automatically imported as a PNG image"; content "can only be edited in Rise Vision"](https://help.risevision.com/hc/en-us/articles/27304751470484-How-do-I-add-content-to-Rise-Vision-using-Canva) · [Google Slides via publish-to-web URL with per-slide duration](https://help.risevision.com/hc/en-us/articles/360029722492-Google-Slides) *(both 403 to direct fetch — via search index)*

**Appspace** — ["not more than 30 pages", alphanumeric filenames, "the content within this card is not editable"](https://docs.appspace.com/latest/how-to/convert-transcode-content/) · [PowerPoint Transcoder requires Microsoft Office/PowerPoint on the server, incl. VBA + .NET Programmability](https://docs.appspace.com/appspace/5.4/admin/appspace-administration/general-configuration/powerpoint-transcoder/)

**Xibo** — ["a full copy of Microsoft PowerPoint installed on each Windows Player"; no CMS preview; cannot advance slides](https://xibosignage.com/manual/en/media_module_powerpoint) · [PDF module, per-page duration](https://account.xibosignage.com/manual/en/media_module_pdf.html) · [`powerpoint.xml` renderAs native](https://raw.githubusercontent.com/xibosignage/xibo-cms/develop/modules/powerpoint.xml) · [`pdf.xml` renderAs html / PDF.js](https://raw.githubusercontent.com/xibosignage/xibo-cms/develop/modules/pdf.xml) · [Dockerfile — no LibreOffice/Ghostscript/ImageMagick](https://raw.githubusercontent.com/xibosignage/xibo-cms/develop/Dockerfile)

**NoviSign** — ["one image per page/slide"; "you cannot edit those files"; 10 conversions/month/license](https://www.novisign.com/help-center/studio/creative/converting-files/) · [upload ppt/pptx/pdf](http://www.novisign.com/tech/upload-ppt-pptx-pdf/) · [Canva integration *(marketing)*](https://www.novisign.com/software-old/integrations/canva/)

**Play Digital Signage** — ["converted to a .png image at 1920 x 1080"; "you can not edit text after importing"; "animation effects are lost"](https://playsignage.com/support/office-documents/) · [library](https://playsignage.com/support/library/) · [slides](https://playsignage.com/support/slides/)

**Carousel** — [Canva](https://support.carouselsignage.com/hc/en-us/articles/26482063007764-Carousel-Cloud-and-Canva) · [PowerPoint dynamic bulletin](https://support.carouselsignage.com/hc/en-us/articles/27236007245972-Carousel-Cloud-and-Microsoft-Powerpoint) · [Google Slides](https://www.carouselsignage.com/features/google-slides) · [public-URL integrations *(press release)*](https://www.carouselsignage.com/press/carousel-digital-signage-introduces-integrations-with-common-content-creation-tools) *(Zendesk 403 to direct fetch — via search index)*

**Skykit** — [content types](https://support.skykit.com/docs/content-types-in-skykit-beam) · [slideshow upload](https://support.skykit.com/docs/uploading-a-slideshow-into-skykit-beam) · [PowerPoint Auto-Publish, nightly](https://support.skykit.com/docs/microsoft-powerpoint-auto-publish)

**PosterMyWall** — [digital signage output](https://www.postermywall.com/index.php/m/digital-signage) · [Signagelive `.wgt` partner path](https://www.postermywall.com/index.php/partner/signagelive)

**Vestaboard** — [VBML](https://docs.vestaboard.com/docs/vbml/) · [132-character limit](https://www.vestaboard.com/help/character-limit)

**Canva** — [PPTX import: editable, 1,400 elements, charts/SmartArt/3D/WordArt ignored, scans flattened](https://www.canva.com/help/powerpoint-import/) *(403 to direct fetch — via search index)* · [Connect API export formats incl. pptx, html_bundle, html_standalone](https://www.canva.dev/docs/connect/api-reference/exports/create-design-export-job/) · [Design Import API accepts pptx/pdf/ai/key](https://www.canva.dev/docs/connect/api-reference/design-imports/)
