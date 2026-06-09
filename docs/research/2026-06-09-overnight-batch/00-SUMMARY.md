# Overnight batch — 2026-06-09 (RBAC reviewer loop, templates header, 12 redesigned boards, Import 2.0)

Operator went to sleep with: "5 buttons up here is crazy, get rid of json import and brand all
templates ... our import needs to be version 2.0 and actually take the content and make it like a
real template ... if no AI enabled tell the user to contact their admin ... go ahead and finish up
the templates you updated and replace the old ones but dont forget to make everything editable with
hotzones, double check everything ... knock it all out."

All shipped to master, each verified (tsc + tests + Playwright/live where applicable), CI watched to green.

## RBAC / reviewer workflow (earlier in the session, all verified live)
- **Viewer (RESTRICTED_VIEWER) reads content** but can't reach the builder; Customize/Edit hidden for them. (`57be987d`, `81456318`, `68d4a46f`)
- **Editor (CONTRIBUTOR) can create + save templates** — `PUT /templates/:id` + `POST /templates` were admin-only → 403'd every save. (`2056e12b`) Verified live: create 201 / save 200.
- **Editor's playlist wizard → Submit-for-Review** instead of a dead-end publish 403. `POST /schedules` now lets CONTRIBUTOR stage DRAFT (isActive=false) schedules; admin approval flips them live. CTA reads "Create & Send for Review." Submission defaults to notifying all tenant admins. RBAC error no longer leaks raw K-12 role enums. (`686da969`) Verified live: `FULL EDITOR REVIEW CHAIN WORKS ✓` (create→draft schedule→submission).
- **Sports locked to admin + Editor** — viewer fully out (hub, console, sponsors, nav). (`1b33ce3b`) Verified live: `LOCKED OUT ✓`.

## Templates header + AI (`3ba48704`, verified live)
- Header trimmed to 3 buttons: **Import design / Generate with AI / New Template** (removed "Brand all templates" + "Import .json"). Live: `HEADER = 3 BUTTONS ✓`.
- **Generate with AI** now checks `getAiStatusSource()`; when no provider is configured it tells the user to ask their administrator (Settings → AI) instead of opening a generator that 503s.

## 12 redesigned HS boards — replaced the olds, all editable with hotzones
Three design-agent worktrees, lead-merged + verified on master.
- **batch-1 + Gallery** (`45f35169`): Terminal (CRT), Transit (split-flap), Bulletin (cork), Blueprint, Zine, Gallery (museum — fuller frame-filling pass).
- **batch-2** (`c4b0f04e`, cherry-picked, catalog conflict resolved to keep both batches): Varsity (jumbotron), Broadcast (graphics package), Yearbook (magazine spread), Achievement (wall of fame), Morning News (TV rundown), Bell Schedule (live board). Achievement/MorningNews/BellSchedule converted React→EXTERNAL_HTML, presets repointed.
- **Hotzone verification:** shim re-baked (EDUCMS-SHIM-V6, 22/22 hs boards), CLAUDE.md sweep 0 missing, `external-html-clickedit` Playwright **28/28** (chromium+webkit), clean API+web tsc, **live-served 200 + shim present** on all 10 board URLs.
- Live schedule engine uses `attributeFilter:['data-time']` (no auto-fit↔schedule feedback loop).

## Import 2.0 (`3ea5ecc9` cherry-picked → pushed; CI docker-build is the new-dep gate)
Parser module `apps/api/src/imports/parsers/` (types, units, pptx-parser, pdf-parser, import-builder + 12 tests).
- **PPTX** (high-fidelity): unzip + OOXML; each shape → positioned TEXT/IMAGE zone (EMU→%, sz→fontSize, srgbClr→hex, bold/align/font); embedded media → tenant Assets; one Template per slide. Re-adds .pptx (structured, not blank).
- **PDF** (best-effort editable): pdfjs-dist legacy/headless `getTextContent` → baseline-grouped TEXT zones; one Template per page; real PDF still rides the auto-playlist for faithful display.
- **Graceful fallback (non-negotiable):** structured path wrapped in try/catch + empty-guard → ANY failure falls to today's single-IMAGE template. Never worse than before.
- Safety: ≤50MB, mime-validated, text sanitized + capped, zones ≤80/page, slides ≤60, tenant-scoped, CONTRIBUTOR allowed, AuditLog records pages/templateIds. New deps fast-xml-parser + pdfjs-dist (pure JS, no native build). Verified: clean API tsc, 12/12 tests, web tsc clean, `--frozen-lockfile` passes.
- Caveat: PPTX uses the first run's style per text box (pragmatic, genuinely editable; not glyph-perfect mixed-run). Legacy binary `.ppt` falls back to flat.

## Hygiene
All 4 design/import agent worktrees + 1 stale leftover removed after merge; only main + (until CI green) the Import worktree remain. Main tree clean throughout.
