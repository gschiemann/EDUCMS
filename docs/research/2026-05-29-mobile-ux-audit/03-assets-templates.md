# Mobile UX Audit — Assets · Templates · Imports · Builder

**Slice 03 of the dashboard mobile-UX audit.** Senior mobile-UX + front-end review, on a phone, READ-ONLY.
**Date:** 2026-05-29 · **Auditor:** dispatched agent (lead owns merge)
**Viewports:** 390×844 (iPhone 14/15) and 360×800 (common Android / Galaxy A-series). DPR 2, touch + mobile emulation, iOS Safari UA.
**Method:** Playwright (chromium). Admin session (`SCHOOL_ADMIN`) seeded into `sessionStorage` (`edu_cms_token` / `edu_cms_user`); every `**/api/v1/**` request mocked with CORS that **echoes the request `Origin`** into `Access-Control-Allow-Origin` + `Access-Control-Allow-Credentials: true` (never `*`), OPTIONS preflight handled. Folders, files (image/video/PDF/url/audio), templates (system + custom, with backgrounds), branding=null, imports flow all populated so tabs render real content. Screenshots + DOM geometry measurements in `scratch/mobile-ux-audit/` (`assets-templates-<vp>-<NN>-*.png`, `measurements.json`).

> **Scope note (per CLAUDE.md Verification-Before-Claim):** Every claim below is backed by either a screenshot I eyeballed or a `getBoundingClientRect`/`scrollWidth` measurement captured live in the running app on port 3013 — not by reading code alone. Where I only read code, I say so.

---

## TL;DR — the one thing that matters

**The Templates gallery is unusable for content creation on a phone.** All five hero action buttons — **Apply brand, Import design, Import .json, Generate with AI, New Template** — overflow off the right edge of the screen and are physically unreachable at both 360px and 390px. An operator on a phone literally cannot start a new template, import a design, or run AI generation from the gallery. Everything *else* in this slice (Assets grid, the FolderPicker that was the historical clipping bug, asset detail, Imports, the builder's "use a desktop" guard) ranges from solid to genuinely excellent. **This is a one-line CSS fix masquerading as a launch blocker.**

---

## Per-screen coverage table (D / UX / F at phone width)

| # | Screen / state | DESIGN | UX | FUNC | One-line verdict |
|---|---|:---:|:---:|:---:|---|
| 01 | `/assets` grid | B | B− | A | Loads, legible, folders in 2-col grid; tap targets undersized |
| 02 | Assets → Upload → **FolderPicker** | A− | A− | A | **Historical clipping bug is FIXED and usable** — bottom-sheet, full-width footer, tab bar hidden |
| 03 | FolderPicker → New folder (inline) | A− | A− | A | Inline create works in-sheet |
| 04 | Asset **detail slide-over** | A− | B+ | A | Clean metadata + editable alt-text + AI regenerate; bug-chip overlaps controls |
| 05 | Assets **list view** | — | — | — | Not captured (toggle selector miss); grid covers legibility |
| 06 | `/templates` **gallery** | C | **F** | **F** | **Primary CTAs overflow off-screen — cannot create/import on a phone** |
| 07 | Templates → New Template **create sheet** | A− | B | C | Sheet itself is great; but it dead-ends into the builder's desktop wall |
| 08 | `/templates/imports` (drop) | A | A | A | Brand-aware, 3-step rail, clear |
| 09 | Imports **preview** state | A | A | A | Full-width stacked CTAs, honest copy — best surface in the slice |
| 10 | `/templates/builder/[id]` on phone | B | A− | A | **Graceful "Larger screen required" notice + Back to Templates** — not a broken canvas |

No horizontal page overflow on any screen (`document.scrollWidth === clientWidth` everywhere). The off-screen items flagged by my geometry probe on the Imports/Assets pages were the **closed mobile sidebar drawer** (translated −288px off-canvas) — correct behavior, not a defect.

---

## What's genuinely good (don't touch these)

1. **FolderPicker — the original clipping bug is dead.** This was the headline concern. Measured at both widths: the bottom-sheet anchors flush to the viewport bottom (dialog bottom = 800 / 844), footer buttons **Cancel (159–174×40)** and **Choose folder (159–174×40)** are fully on-screen — `clippedRight: false`, `clippedBottom: false`. The mobile tab bar is **hidden** while the sheet is open (`fixedBottomBars: 0` measured), via the systemic `useOverlayLock` ref-counter (`apps/web/src/hooks/use-overlay-lock.ts`). Drag handle, full-width search ("Search 7 folders…"), inline "New folder", `py-3` (~48px) tree rows for thumbs. This is a textbook mobile bottom-sheet. The 2026-05-29 comments in `FolderPicker.tsx` (lines 89–94, 240–295, 464–490) document exactly this fix and it holds up. **Confirmed fixed AND usable.**

2. **Imports flow** (`apps/web/src/app/[schoolId]/templates/imports/page.tsx`) is the most mobile-mature surface in the whole slice. Brand-aware hero (`var(--brand-primary)`), a 3-step rail (Drop → Preview → Add), and preview CTAs that stack full-width (`flex-col sm:flex-row`, measured 328–358px wide, 44–48px tall). Honest small print about multi-page PDFs. Ship-quality.

3. **Builder mobile guard is correct and graceful.** Contrary to the "verify it isn't a broken mess" concern: there is a real guard at `apps/web/src/components/layout/DashboardLayout.tsx:42–63`. `isFullscreenWorkspace` matches `/templates/builder/`, then renders a `lg:hidden` "Larger screen required — needs at least a 1024px wide display… switch to a tablet in landscape or a desktop" notice with a **Back to Templates** button, and `hidden lg:block` for the actual `BuilderShell`. No canvas leaks onto the phone; no horizontal overflow. `BuilderShell.tsx` itself has **zero** responsive breakpoints (fixed 420px tools panel + Add rail) — which is *fine* precisely because the layout-level guard means it never renders below `lg`.

4. **Asset detail slide-over** is a real product surface: image preview, metadata grid (type/size/resolution/uploaded), uploader, status, folder, and an editable alt-text field with an AI "Regenerate" button. Reads like a $$$ product.

5. **Create-template sheet** is a clean mobile bottom-sheet (drag handle, full-width inputs, 3-col resolution-preset grid that fits 360px).

---

## Problems — ranked

### 🔴 P0 — Templates gallery primary CTAs overflow off-screen (cannot create or import on a phone)

**File:** `apps/web/src/app/[schoolId]/templates/page.tsx` — hero header **lines 620–684**; the offending CTA cluster is `<div className="flex items-center gap-2">` at **line 636**, containing `ApplyBrandButton` (637), **Import design** (643–650), **Import .json** (653–660), **Generate with AI** (666–673), **New Template** (674–681). The wrapping hero is `flex items-center justify-between` (line 622) with **no `flex-wrap` and no mobile stacking**.

**Measured (both 360 and 390):** every CTA's right edge is off-screen —
`Import design` right=485, `Import .json` right=600, `Generate with AI` right=731, `New Template` right=871 — against a 360–390px viewport. All four report `offscreen: true`; `ApplyBrandButton` is pushed off too. Screenshot `…-06-templates-gallery.png` shows "Brand all template[s]" bleeding off the right edge and the rest gone entirely.

**Impact:** This is the template *home page*. On a phone an operator cannot: create a new template, import a PDF/Canva design, run AI generation, or apply their brand. The search box and filter chips below render fine — so the operator sees a browsable gallery with **no way to add anything**. For a product whose pitch is "a non-IT operator does it themselves," this is a credibility-killer on the device half your front-line staff actually carry.

**Why it scores F on UX and F on FUNC:** the task ("make a template" / "import my flyer") is not completable at phone width. Not slow — *impossible*.

**Fix (small):** make the hero a wrapping/stacking layout and let the CTAs collapse. Concretely:
- Wrap the whole hero in `flex-col gap-4 md:flex-row md:items-center md:justify-between` (line 622).
- Make the CTA cluster `flex flex-wrap gap-2 w-full md:w-auto` (line 636) and give each button `flex-1 md:flex-initial` so they tile 2-up on a phone.
- Strongly consider a mobile **primary/overflow** pattern: keep **New Template** + **Import design** as full-width primary buttons on mobile, fold **Import .json / Apply brand / Generate with AI** into a "More ▾" menu. Five 64px buttons is too many for a phone hero even when they wrap.
- Verify after: re-run the probe; every CTA must report `offscreen: false` and `width ≥` a tappable size at 360px.

This is the **same class of bug** the FolderPicker and Imports pages already solved (mobile-first stack/wrap). The fix was simply never applied to the Templates hero.

---

### 🟠 P1 — Sub-44px tap targets across Assets controls

**Files:** `apps/web/src/app/[schoolId]/assets/page.tsx`
- Header **Add URL** (line 593–600) and **Upload** (606–614): measured **96×34px** — 34px is below the 44px iOS / 48dp Android minimum.
- Grid/List **view-toggle** buttons (738–739): `p-1.5` → measured **~26×26px**. Way under minimum; two tiny icon buttons jammed together invite mis-taps.
- The 6 **filter pills** (729–733) sit in a non-wrapping `flex gap-0.5` with `px-3 py-1.5 text-[11px]` and **no horizontal scroll**; at 360px with `(N)` count suffixes they squeeze (visible in `…-01-assets-grid.png`). If a vertical ever adds a 7th filter they'll clip.
- Per-tile **quick-delete** and **select** buttons are `opacity-0 group-hover:opacity-100` (lines 957–974) — **hover-gated, so they never appear on touch** (no `:hover` on a phone). Bulk-select and quick-delete are effectively desktop-only.

**Impact:** the page is *legible* and *loads* (FUNC is fine), but it's fiddly and partly hover-locked on touch. UX = B−.

**Fix:** bump header buttons to `py-2.5`/min-h-11; give the view toggle `p-2.5` (or hide it on mobile — grid is the sane phone default); make the filter row `overflow-x-auto` with `flex-nowrap`; and replace the hover-reveal tile actions with always-visible affordances on touch (e.g. a persistent ⋯ menu, or a long-press) — gate the reveal behind `@media (hover: hover)` instead of `group-hover`.

---

### 🟠 P1 — The mobile create-template flow dead-ends

**Files:** `templates/page.tsx` create sheet (864–925) → `handleCreate` (493–504) → `openInBuilder` (373–379) → builder route → `DashboardLayout.tsx:47` "Larger screen required".

Even if you fix the P0 so the **New Template** button is reachable, tapping **"Create & Open Editor"** (line 918) creates the template and navigates straight into the builder — which on a phone shows the desktop wall. So the operator successfully creates a template, then hits a brick wall and can't lay it out. Same for **Generate with AI** (navigates to `…/builder/${newId}`, line 809) and the Imports "Open in builder" CTA (`imports/page.tsx:492`).

**Impact:** the create/AI/import-to-builder paths all terminate at the desktop guard. Not data-loss, but a confusing one-way street. UX = C.

**Fix (product call, low code):** on mobile, after create/generate/import, **don't auto-route into the builder.** Land the operator back on the Templates gallery with the new template selected + a toast: "Template created — open it on a tablet or desktop to edit the layout." Or: let the builder render a **read-only preview** on mobile (the canvas already scales) with edits gated, instead of a blank wall. At minimum, set expectations *before* the tap (e.g. disable/relabel "Create & Open Editor" → "Create (edit on desktop)" when `< lg`).

---

### 🟡 P2 — Bug-reporter chip overlaps modal/sheet footers

The floating "1 Issue" / bug-reporter chip (bottom-left, black circle) overlaps: the FolderPicker footer ("Selected: All Files (root)" is partially cut, `…-02-folderpicker.png`), the asset-detail alt-text controls (`…-04`), and the Imports preview box (`…-09`). It's a global overlay, not in this slice's files, but it degrades every bottom-anchored surface on a phone. **Flag to whoever owns the bug-reporter widget**: it should respect `useOverlayLock` like the tab bar does, or shift when a sheet/modal is open.

### 🟡 P2 — Builder "Larger screen required" notice is stark

`DashboardLayout.tsx:47–57`: vertically centered `max-w-sm`, no icon/illustration, lots of empty viewport. It's correct and honest but visually thin for a $$$ product, and it offers no mobile-appropriate alternative (e.g. "Preview this template" or "Email yourself a link to finish on desktop"). DESIGN = B. Low priority — it works.

### 🟡 P2 — Folder name truncation with no tooltip on touch

Assets folder tiles truncate aggressively at 360px ("Hallway…", "Main Lo…", "Athletic…", `…-01`). `title` attributes don't surface on touch. Minor; consider 2-line clamp instead of single-line truncate on mobile.

---

## Ranked fix list (copy/paste into a punch list)

| Rank | Fix | File:line | Effort |
|---|---|---|---|
| **P0** | Templates hero CTAs overflow → stack/wrap + mobile primary/overflow menu | `templates/page.tsx:622, 636` | S |
| P1 | Assets tap targets <44px (Add URL/Upload 34px, view toggle 26px) | `assets/page.tsx:593,606,738` | S |
| P1 | Hover-gated tile select/delete never appear on touch | `assets/page.tsx:957,967` (`group-hover`) | S |
| P1 | Filter-pill row: `overflow-x-auto flex-nowrap` | `assets/page.tsx:728` | XS |
| P1 | Create/AI/Import → builder dead-ends on mobile; don't auto-route, set expectations | `templates/page.tsx:809,918`, `imports/page.tsx:492`, `DashboardLayout.tsx:47` | S–M (product call) |
| P2 | Bug-reporter chip overlaps sheet/modal footers; honor overlay-lock | (bug-reporter widget, outside slice) | S |
| P2 | FolderPicker footer 40px → 44px; clear safe-area for "Selected:" line | `FolderPicker.tsx:479,485` | XS |
| P2 | Builder desktop-notice: add icon, offer preview/alternative | `DashboardLayout.tsx:47` | S |
| P2 | Folder-name 2-line clamp instead of truncate on mobile | `assets/page.tsx:872` | XS |

---

## Concrete redesign recommendations

**Templates gallery hero (the P0):** Adopt the exact pattern the Imports page and FolderPicker already use. On a phone the hero should be: title block on top, then a **2-button primary row** (New Template · Import design) full-width, with Apply brand / Import .json / Generate with AI behind a "More" menu or a second wrapped row. This single change moves Templates from F→A on FUNC and reuses a pattern that's already proven elsewhere in the same codebase — no new design language needed.

**Assets toolbar (P1):** On mobile, collapse the header into one primary **Upload** FAB-style button (44×44+), move **Add URL** into the upload sheet (it already routes through a picker), drop the grid/list toggle (default grid), and make filters a horizontally-scrollable chip rail. The folder grid + detail sheet are already good — leave them.

**Builder (P1/P2):** Decide the mobile story deliberately. Cleanest: builder is **desktop/tablet-landscape only** (current guard), but every path that leads into it (Create, Generate-with-AI, Import "Open in builder") should *not* auto-navigate on a phone — they should complete on the gallery and tell the operator to finish editing on a larger screen. That turns three silent dead-ends into one clear, honest handoff.

---

## Standard Audit Surface mapping (for this slice)

This slice touches a subset of the 21 domains. Reported here for traceability:
- **§19 Template + Widget Editability:** N/A at phone width — the builder (where editability lives) is intentionally desktop-gated. The *gate* is graceful (covered). Widget-level editability must be audited on desktop (other slice).
- **§20 Design/UX/Functionality lenses:** applied to all 10 screens above (table).
- **§21 Verification-before-claim:** every verdict backed by a live screenshot or measured geometry on port 3013 (covered).
- **§15 Cross-browser:** audited with iOS-Safari UA in chromium; true WebKit/Taurus passes are a separate surface (deferred — not in this slice's mandate).
- **§18 Accessibility:** noted in passing (tap-target sizes, hover-only affordances, truncation+title-on-touch) but a full a11y/axe pass is out of this slice's scope (deferred).

---

## Reproduce

```bash
# Isolated dev server on 3013 (git worktree at ./.audit-3013 with symlinked node_modules,
# launched as: PORT=3013 next dev -p 3013 — avoids the per-dir Turbopack instance lock
# held by the parallel agent's 3011 server).
node scratch/mobile-ux-audit/run-assets-templates-audit.cjs
# → screenshots + scratch/mobile-ux-audit/measurements.json
```

Mocks live in the script; CORS echoes Origin (never `*`). Auth seeded via `sessionStorage`. Real endpoint paths discovered during the run: `/users/me`, `/tenants`, `/tenants/accessible`, `/branding/me`, `/assets`, `/assets/folders` (NOT `/asset-folders`), `/assets/pending`, `/submissions`, `/templates`, `/templates/:id`, `/playlists`.
