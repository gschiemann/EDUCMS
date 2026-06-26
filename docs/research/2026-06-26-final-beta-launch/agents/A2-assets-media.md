# A2 — Asset Library + Media Pipeline (S1)

**Surface:** `/[schoolId]/assets` (Media Library) — live prod `https://venue-os.app`, API `https://api-production-39a1.up.railway.app/api/v1`
**Scale tier:** Desktop (1440×900) + Mobile (390×844, iPhone-class). Cross-browser engine: Chromium (Playwright). Did NOT run WebKit/Firefox this pass — see coverage gaps.
**Tenant:** self-provisioned throwaway K12 tenants (`a2vis-*`, `a2det-*`, `a2assets-194092746`) via `POST /signup`. Greg's Dodgers tenant + LED never touched.
**Date:** 2026-06-26

## What I did (step by step)

1. **Read the spec from source first** — `apps/web/src/app/[schoolId]/assets/page.tsx` (1527 lines), `apps/web/src/components/ai/AiImageGenerateButton.tsx`, `apps/web/src/components/ai/AiGenerateButton.tsx` (`getAiStatusSource`), `apps/web/src/lib/asset-image.ts` (`transformedImageUrl`), and `apps/api/src/assets/assets.controller.ts` (routes + optimization).
2. **Provisioned my own tenant** via `POST /signup` (auto-login JWT, DISTRICT_ADMIN). Confirmed clean: `GET /assets` → `[]`, `GET /assets/folders` → `[]`.
3. **Generated real test files** in scratchpad: a 64×64 PNG, a valid 1-page PDF, and a real H.264 MP4 (ffmpeg).
4. **Ran the full upload flow per type** (the exact 3-step path the UI uses): `POST /assets/presign` → `PUT` to the Supabase signed URL (with the immutable `Cache-Control` header) → `POST /assets/complete-upload`. Image, video, PDF all returned **HTTP 201, status `PUBLISHED`**.
5. **Verified served bytes + headers** — fetched each `fileUrl`: image 200 `image/png` (decodes, 64×64), video 200 `video/mp4`, PDF 200 `application/pdf`. `Cache-Control: public, max-age=31536000` present on all (egress fix live). Verified the Supabase render-transform thumbnail (`/render/image/public/...?width=320&quality=60`) returns **200** (the grid-tile path works).
6. **Folders:** created `Promo Banners`, nested `Q1` under it, moved the image in via `PUT /assets/:id/move`. `GET /assets/folders` returns correct `_count` rollup (`{assets:1, children:1}`).
7. **URL asset:** `POST /assets/url {url:"https://example.com"}` → 201, `mimeType text/html`.
8. **Delete:** `DELETE /assets/:id` → `{deleted:true}`, confirmed gone from list.
9. **Approval status:** `GET /assets/pending` → `[]` (admin uploads auto-`PUBLISHED`; correct — pending queue is for CONTRIBUTOR uploads).
10. **AI image gating:** `POST /ai/image` with no provider key → **HTTP 503, clear message** ("AI is not configured. Add your provider API key in Settings → AI provider, or contact your admin."). Confirmed in the rendered UI the **"Generate with AI" button is absent** when no key is set (count = 0 desktop + mobile) — matches spec (`AiImageGenerateButton` returns `null` for `source === 'none'`).
11. **Rendered-UI screenshots** (Playwright, real prod, populated library): desktop grid, list, image detail, PDF detail; mobile grid, list, selection toolbar. **0 console errors / 0 5xx across every load.**

## Findings

| Sev | Area | What | Repro | Evidence |
|-----|------|------|-------|----------|
| P2 | PDF preview (detail panel) | The asset **detail slide-over** shows a generic FileText icon + "Preview not available" for PDFs — it never renders the first page, even though the grid tile (PdfHoverThumb), the playlist tile, and the wizard picker all render PDF previews. A menu/document operator opens the PDF to verify content and sees nothing. | Upload a PDF → click the tile → "View details". | Screenshot `…/a2-detail-1782503622434/pdf-detail.png`; source `apps/web/src/app/[schoolId]/assets/page.tsx:1267-1269` (fall-through `else` has no `isPdf` branch — only image/video/audio/text-html are handled). |
| P2 | Mobile bulk-select ergonomics | Selecting an item on mobile injects a tall 4-button bulk-action block (Create playlist / Move to folder / Delete / Add URL) **inline in document flow**, pushing the entire file grid down. After selecting, the operator must scroll past the button block to see their files. It's a wrapped block, not a sticky bottom action bar. No clipping, all 44px targets hit — purely an ergonomic/scroll-jump cost. | Mobile 390px → tap a tile's select checkbox. | Screenshot `…/a2-shots-mobile-1782503660294/03-image-detail.png` (selection state); header buttons at `page.tsx:605-639`. |
| P3 | URL-tile screenshot warm-up | URL assets render a WordPress mshots homepage screenshot; on a brand-new URL it returns a placeholder (blue/white) until the CDN warms, so the first paint of a just-added URL tile looks like a flat color block rather than a site preview. Self-heals on next load; `onError` already falls back to the globe. Cosmetic only. | Add a URL asset, view tile immediately. | Grid screenshot `…/a2-shots-1782503539697/01-grid.png` (nytimes tile blue/white); source `page.tsx:540-542`. |

**No P0/P1 found.** Upload (all 3 types), folders, move, URL, delete, approval status, served bytes/headers, image transform, and AI gating all work end-to-end on live prod.

### Things verified as CORRECT (not bugs)
- **Image re-encode on upload is intentional optimization, not corruption.** My 178-byte PNG came back stored as 120 bytes at a *different* storage path UUID than the presign path. Traced to `assets.controller.ts:707-747` — `complete-upload` runs `mediaOpt.optimizeImageForUpload()` (sharp) and re-uploads the optimized buffer to a new path so the URL extension matches. The served image still decodes at 64×64. This is the egress/perf win working.
- **Grid tile previews all render correctly:** image thumb (via Supabase transform), video first-frame poster (`preload=metadata` + `#t=0.1`), PDF hover-thumb (rose gradient placeholder → iframe on hover; deliberately NOT auto-mounted to avoid the Chrome PDF-toolbar flash that bit the operator before), URL screenshot, type badges in four clean corners (☐ select TL · 🗑 delete TR · type-tag BL · res-badge BR). No tile showed a raw OS file-icon.
- **Detail slide-over (non-PDF) is $$$-grade:** dark-backdrop preview, metadata grid (Type/Size/Resolution/Uploaded), Uploader card, Status pill, Folder + "Move to root", and the AI alt-text editor (0/160 counter, Generate button, graceful `AI_QUOTA_EXHAUSTED`/`AI_ALT_TEXT_UNAVAILABLE` handling).
- **AI image button graceful-degradation matches spec exactly** — hidden entirely when no provider, and `POST /ai/image` returns a clear 503 (not a stack trace) if reached.
- **Mobile:** desktop-only drag-drop zone correctly hidden; header keeps Upload/Add URL; tiles 2-col; select+delete always-visible on touch (no hover dependency); bottom tab bar intact.

## Coverage gaps + why
- **WebKit/Firefox not run** — only Chromium. CLAUDE.md Rule #1 wants WebKit before "done"; the assets page is React-rendered (no inline minified bridge), lower-risk than the holiday boards, but a Safari pass on the detail slide-over + drag-drop is still owed. (Time-boxed to Chromium + API this pass.)
- **Live AI image generation not exercised** — no provider key on a throwaway tenant (by design per task). Verified the gating + the 503 path only, not a real DALL-E/Imagen render.
- **CONTRIBUTOR/RESTRICTED_VIEWER role behavior not tested live** — the page has extensive `isViewer` disabling + a `PENDING_APPROVAL` path; I only tested as DISTRICT_ADMIN (auto-publish). The approve/reject endpoints (`/assets/:id/approve|reject`) and the pending queue with a real pending asset are unverified live.
- **Large-file / 500MB boundary + concurrency (3-in-flight) + unsupported-format (.mov/.avi) client guard** verified by source-read only, not by live upload.
- **Drag-to-folder reorder, "Show all folders" collapse at >12 folders, and bulk-move via FolderPicker** verified by source, not clicked live.

## Grades
- **Design: A** — clean, modern, consistent four-corner tile system, polished detail slide-over, sensible empty/error/loading states. Superintendent-presentable.
- **UX: A−** — upload→see-it, folders, search, filter pills with counts, bulk actions, create-playlist-from-selection are all fast and obvious (<30s happy path). Docked from A by the mobile bulk-bar scroll-jump (P2) and the missing PDF preview in the detail panel (P2).
- **Functionality: A** — every core path works end-to-end on live prod with zero console/5xx errors: upload (image/video/PDF), folders+nesting+move, URL asset, delete, approval status, served bytes, immutable cache, image transform, and AI-image graceful gating.

**Evidence root:** `/private/tmp/claude-501/-Users-gschiemann-Desktop-EDU-CMS/4129bcd1-4636-4065-90ea-207bae54cd20/scratchpad/` — `a2-shots-1782503539697/` (desktop), `a2-shots-mobile-1782503660294/` (mobile), `a2-detail-1782503622434/` (detail panels).
