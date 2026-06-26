# A4 — Template Creation Surface (Structure Level / S1)

**Wave:** A — Final Beta Launch
**Agent:** A4
**Date:** 2026-06-26
**Surface:** Signage template creation surface — gallery → preview → duplicate → builder/touch editor → EXTERNAL_HTML click-to-edit → Import design. (Deep AI generation is a later wave; sports console redesign is out of scope.)
**Scale tier:** S1 — structure / reality check (does it open, render, edit, save). Not a pixel-perfect design pass.
**Target:** LIVE PROD — web `https://venue-os.app`, API `https://api-production-39a1.up.railway.app/api/v1`. Isolated throwaway K12 tenants self-provisioned via `POST /signup` (4 fresh tenants, `beta-a4*` slugs). Zero contact with Greg's Dodgers tenant or physical LED.

---

## What I did (step by step)

All work via Playwright (chromium, installed) driving the logged-in app as a real operator, plus API-level probes for persistence. Harnesses run from `apps/web/scripts/beta/` (temp copies, removed after).

1. **Provisioned** a fresh K12 tenant, seeded auth, navigated to `/{tenant}/templates`. API `GET /templates` returns **104 templates**.
2. **Gallery** — screenshotted top/mid/bottom; confirmed the "READY-MADE TEMPLATES" section, per-vertical header ("Screen Templates / Pick a ready-made template…"), search box, school-level chips (Elementary/Middle/High), and category tabs (All / Touch Kiosks / Welcome / Hallway / Cafeteria / Athletics / Holidays).
3. **Category tabs** — clicked Athletics, Cafeteria, Touch Kiosks, Holidays; counted preview tiles per tab.
4. **Search** — typed "rainbow" (matches), then a no-match string ("zzzznotemplate"), on the **All** category.
5. **Preview modal** — opened a board preview; confirmed it renders a real, high-fidelity board (not a thumbnail placeholder).
6. **Duplicate + open builder (regular zone template)** — duplicated "Animated Rainbow · Welcome" via API (`POST /templates/:id/duplicate` → 201), opened `/templates/builder/:id`; confirmed the React-zone builder loads with a live decorated scene + a left properties panel with editable fields.
7. **Duplicate + open builder (EXTERNAL_HTML board)** — same for "Animated Achievement Showcase"; confirmed the board renders in the sandboxed iframe and the left panel shows TEXT / IMAGES / STYLES tabs with a RICH TEXT editor + "Browse Media."
8. **EXTERNAL_HTML editability** — counted **61 `data-field` + 2 `data-imgslot`** elements inside the live board iframe; typed into the panel's TEXT field (visible update in panel); verified the click-to-edit protocol in source (panel handler + 131/131 boards carrying the shim).
9. **Edit persistence** — via API: duplicated an EXTERNAL_HTML preset, `PUT /templates/:id/zones` and `PUT /templates/:id` to set a `textOverrides.title`, then re-`GET` — confirmed it round-trips and persists.
10. **Import design** — navigated `/templates/imports`; confirmed the 3-step wizard renders inside the brand shell.
11. **AI generate** (degradation only, not deep AI) — clicked "Generate with AI" on a tenant with no AI key; confirmed honest graceful-degradation message.

Console/network during the full walk: **0 server 5xx**, **0 failed requests**. Console noise was benign (a 404 on a non-blocking resource + a handful of SVG `transform`/`width` attribute warnings from a decorative inline-SVG — cosmetic, not functional).

---

## Findings

| # | Severity | Area | What | Repro | Evidence |
|---|----------|------|------|-------|----------|
| 1 | **P2** | Gallery — category tabs | The **"Athletics" category tab is a dead tab for K12**: zero system presets are tagged `ATHLETICS`, so clicking it hides the READY-MADE grid entirely and shows only "No custom templates yet." A new operator sees an empty page under a tab the app itself surfaces. | `/{tenant}/templates` → click **Athletics**. Gallery shows only "YOUR TEMPLATES / No custom templates yet"; no presets. | Live category counts: `{LOBBY:10, CAFETERIA:12, HALLWAY:6, LOBBY_WELCOME:23, …, KIOSK:19, HOLIDAYS:18}` — **ATHLETICS:0**. Tab defined `page.tsx:71` (`{key:'ATHLETICS',label:'Athletics'}`). Screenshot `a4i-*/t1-athletics.png`. |
| 2 | **P2** | Gallery — search/filter empty state | **No "no results" empty state.** When a search (or an empty category) matches **0 system presets**, the READY-MADE section silently vanishes (`page.tsx:1376` gates on `systemTemplates.length>0`) and the only thing left is the unrelated "No custom templates yet" custom-section message. Operator gets no "No templates match 'X' — try a different search" affordance. | `/{tenant}/templates`, All category, search `zzzznotemplate`. | `page.tsx:1376` (`{systemTemplates.length>0 && …}`) + `:1404` (custom empty state). Screenshot `a4s-*/search-nomatch.png`. |
| 3 | **P2 (test-only, NOT a product defect)** | EXTERNAL_HTML click-to-edit | Could not **programmatically** mouse-click an element *inside* the board to fire the jump — the board is a null-origin sandboxed iframe, so Playwright cross-origin blocks `boundingBox()`/synthetic clicks. This is a harness limitation. The feature itself is verified present and correct by other means (see Verified, below). | Run `[data-field]`.first().click() against the board iframe → TimeoutError (no bbox). | Harness log "no boundingBox for data-field"; protocol verified in `PropertiesPanel.tsx:6861-6907`. |

**No P0 / P1 found.** No template failed to open, no blank preview, no "rounded-rectangle-with-shadow" low-effort board encountered in the sampled set.

---

## Verified working (reality, not spec)

- **Gallery renders, 104 templates, real previews.** Tiles show real rendered boards, not gray placeholders. Per-vertical header copy resolves (K12 → "Screen Templates / your … from scratch"). `READY-MADE TEMPLATES` + `YOUR TEMPLATES` two-tier layout. Design is premium — gradient hero, school-level chips, category tabs. (`a4-*/01-gallery-top.png`)
- **Preview modal** opens a full-fidelity board — e.g. a "Spring Break" countdown board showing a live "9 DAYS OFF" computed countdown, themed typography, sponsor-style cards. Not a flat image. (`a4-*/04-preview-modal.png`)
- **Search works** — "rainbow" on All returns the Animated Rainbow preset (+ a description/category match), READY-MADE header stays. (`a4s-*/search-rainbow-clean.png`)
- **Category + level filters** apply to both system and custom templates via one predicate (`page.tsx:589-627`); Cafeteria shows its presets, Touch Kiosks correctly isolates KIOSK-only (per the 2026-06-06 operator fix `:605`).
- **Duplicate → builder (regular zone template):** `POST /templates/:id/duplicate` → 201; builder loads a live decorated scene (sun, clouds, rainbow, polaroid, balloons — themed shapes, not rectangles) with a left properties panel exposing editable fields (Welcome message, Brand, fonts). No "larger screen required" wall at 1440px. (`a4-*/05-builder-regular.png`)
- **Duplicate → builder (EXTERNAL_HTML board):** board renders in the iframe; left panel = TEXT / IMAGES / STYLES tabs + a RICH TEXT field + "Browse Media." Typing into the panel field updates it. (`a4-*/06-builder-exthtml.png`, `a4i-*/t2-panel-typed.png`)
- **EXTERNAL_HTML editability contract is fully satisfied:** **131/131** deployed boards under `public/templates/{hs,signage,fitness,kiosk}` carry the click-to-edit shim (`educms-field-click` or `_edit-shim`), 0 missing. The live Achievement Showcase board exposes **61 `data-field` + 2 `data-imgslot`** addressable elements.
- **Click-to-edit jump handler is wired and correct** (`PropertiesPanel.tsx:6861-6907`): on `educms-field-click` it resolves the matching `[data-edit-field|img|action]` row, `scrollIntoView` center-smooth, focuses the input, and flashes a 1.5s cyan outline; re-arms edit-mode on `educms-ready` remount; never sends edit-mode on the player.
- **Edit persistence:** `PUT /templates/:id/zones` (and `PUT /templates/:id`) → 200; a `textOverrides.title` set on an EXTERNAL_HTML zone round-trips on re-GET. Save loop is real, not optimistic-only.
- **Import design** (`/templates/imports`): clean 3-step wizard (Drop your file → Preview → Add), inside the brand shell, accepts PowerPoint/PDF/PNG/JPG/WEBP ≤50MB, promises "editable layers, not a flat picture." This matches the operator's "imports = a feature, not a setting" directive (lives under `/templates`, not `/settings`). (`a4-*/08-imports.png`)
- **AI generate degrades honestly** on a no-key tenant: "AI isn't enabled yet … Ask your administrator to enable it in Settings → AI." No silent platform-key spend, no fake spinner. (`a4-*/09-ai-generate.png`)

---

## Coverage gaps + why

- **Programmatic click *inside* the sandboxed board** (firing the actual jump end-to-end through a synthetic click) — blocked by null-origin iframe cross-origin in Playwright. Mitigated by verifying the full protocol in source + confirming 131/131 shim coverage + 61 addressable fields in the live board. A human (or computer-use on real glass) clicking a board element is the only way to exercise the literal click; I did not have that path here.
- **Deep AI generation quality** (3-candidate, brand-voice, magic-resize) — explicitly a later wave; only verified the no-key degradation.
- **Sports console redesign** — explicitly out of scope (this tenant was K12; sports is a different surface/agent).
- **Non-K12 vertical galleries** (Retail/QSR/Worship category depth) — sampled K12 only; per-vertical preset depth for other verticals not exhaustively counted here.
- **Holiday postMessage bridge** (`holiday:*`) — the separate holiday boards use a different bridge; I confirmed the Holidays tab populates but did not drive a holiday-board edit.

---

## Grades

- **Design: A−** — Gallery, preview modal, both builders, and the Import wizard look like a paid product (gradient hero, themed boards with real shapes/countdowns/typography, consistent brand shell). The two dead-end empty states (Athletics tab, no-match search) are the only things keeping it off an A.
- **UX: B+** — Pick → duplicate → edit → save is smooth and well-signposted; honest AI degradation; click-to-edit "hot zones" are a genuinely good operator affordance. Docked for the dead "Athletics" tab and the missing "no results" message — both make a new operator briefly think the catalog is empty.
- **Functionality: A** — Everything in scope works end-to-end on live prod: gallery loads (104 templates), previews render, duplicate (201), both builders open, EXTERNAL_HTML fields are addressable (61) and editable, edits persist (PUT→GET round-trip), imports wizard renders, 0 server 5xx / 0 failed requests across the whole walk.

**Overall: A− / strong launch-ready.** No P0/P1. Two P2 polish items (dead Athletics tab, no-results empty state) worth a quick fix before beta but not blockers.
