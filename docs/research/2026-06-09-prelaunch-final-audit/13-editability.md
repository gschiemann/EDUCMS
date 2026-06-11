# Pre-launch Final Audit — Section 19: Template + Widget Editability

**Auditor:** fresh-pass frontier model, 2026-06-09/10
**Scope:** Standard Audit Surface §19 across all three editing architectures: React presets (PropertiesPanel), EXTERNAL_HTML boards (V5/V6 shim click-to-edit), holiday boards (`holiday:*` bridge). Plus Import 2.0 output editability.
**Method:** rendered-DOM contract counting in real chromium (not source grep), shim-version census, price-binding sweep, code-path tracing of field discovery and click resolution, both Playwright E2E suites run live.

## Coverage table

| Lens | Grade | Coverage |
|---|---|---|
| DESIGN | A− | covered |
| UX | A− | covered |
| FUNCTIONALITY | B+ | covered |

The "can't edit a single word" era is verifiably over — every architecture's edit loop works end-to-end in real browsers (28/28 + 2/2 E2E green this run). What keeps FUNCTIONALITY at B+: three shipped boards (including the Domino's pilot board) show **stale duplicate ticker text after an override**, and **8 menu boards have every visible price unbound** — not click-editable and unreachable by the POS `applyMenu()` pipeline they visually advertise.

---

## Assigned checks — results

### (a) CLAUDE.md hotzone sweep (hs/signage/fitness) — PASS, with a doc blind spot

```
cd apps/web/public/templates && for f in $(find hs signage fitness -name "*.html"); do
  grep -qE "educms-field-click|src=[\"'][^\"']*_edit-shim" "$f" || echo "NO CLICK-TO-EDIT: $f"; done
# → zero output (0 missing) across 112 boards
```

**But the sweep command itself omits `school/`** — 9 boards (`elem-lunch-v1..3`, `elem-schedule-v1..3`, `ms-lobby-v1..3`) added in 90be6ff6 live outside the documented invariant check. All 9 *do* carry EDUCMS-SHIM-V6 today (verified per-file), so this is a process gap, not a regression — yet. The injector (`inject-shim-v2.cjs:51`) accepts any subdir arg, so only CLAUDE.md's command string needs updating.

Shim census (all 140 boards):
- **EDUCMS-SHIM-V6:** 90 boards (hs 22, school 9, fitness 1, non-menu signage 58)
- **EDUCMS-SHIM-V5 + applyMenu:** 31 boards (qsr 11, menus-pos 10, bar 10)
- **External `_edit-shim.js`:** 19 kiosk boards
- **V4 or older / missing:** 0

### (b) Kiosks load `_edit-shim.js` — PASS

19/19 `kiosk/*.html` reference the external shim; none double-shim with an inline block.

### (c) 12 redesigned hs boards — contract counts (rendered DOM, chromium 1920×1080)

Counted tagged elements (`data-field|data-imgslot|data-action`) vs visible text leaves NOT covered by a tagged self-or-ancestor:

| Board | tagged | visible text els | untagged | verdict |
|---|---|---|---|---|
| terminal | 62 | 49 | 1 (`":~$"` decorative prompt) | A |
| hall-wayfinder | 65 | 51 | 0 | A |
| hall-bulletin | 61 | 40 | 0 | A |
| blueprint | 69 | 49 | 0 | A |
| zine | 37 | 16 | 0 | A |
| gallery | 58 | 45 | **4 — duplicated ticker copy, see Finding 1** | B |
| varsity | 78 | 45 | 0 | A |
| broadcast | 40 | 26 | 0 | A |
| yearbook | 43 | 25 | 0 | A |
| achievement | 62 | 35 | 0 | A |
| morning-news | 63 | 46 | 0 | A |
| bell-schedule | 57 | 43 | 0 | A |

11/12 boards are 100% on-contract; this is the strongest editability surface in the product. Zero `<img>` tags outside tagged slots on all 12.

### (d) Menu boards kept `applyMenu()` V5 — PASS (31/31), but see Finding 2

All 31 qsr/menus-pos/bar boards retain the hand-crafted V5 with `applyMenu()` (name-matched POS item → price/desc/sold-out via `data-field` groups, `<prefix>.price` leaves). The V5 click walker selector is `[data-field],[data-imgslot],[data-img],[data-slot],[data-action]` (qsr/02-counter-menu inline shim) — wider than CLAUDE.md documents, and photo `data-slot`s ARE click-reportable + apply-targetable (`applyImages` accepts `data-img` OR `data-slot`).

### (e) React widget editability — no new families since last sweep; standard holds

Every widget-directory commit since 2026-06-07 is EXTERNAL_HTML intake (`signage-templates.ts`) or a renderer fix (WEBPAGE focus-steal 20f0502a, kiosk spatial-nav gate 30b6ae7c, thumbnail freeze 88479b3e) — **no new React widget family shipped unaudited**. Verified the base `TextWidget` (WidgetRenderer.tsx:1201) meets the §19 standard: `content/fontSize/fontFamily/alignment/color/bgColor/bold/italic/underline/strikethrough/lineHeight(0.5–2.5 clamp)`, and all ~33 themed text renderers receive `onConfigChange` (the prop-drop class from the earlier "inline editing doesnt work" bug is annotated and closed). Prior-audit P0-3 (17 themed widgets array/image editors) confirmed fixed per dedup synthesis — not re-verified field-by-field.

### (f) Import 2.0 output IS genuinely editable — PASS

Traced the full chain:
- **PPTX structured path:** `pptx-parser` → `import-builder.ts` emits positioned `TEXT`/`IMAGE` zones; controller persists them as real `TemplateZone`s (imports.controller.ts:417-428).
- **Key match verified:** parser emits `{content, fontSize, alignment, bold, color, fontFamily}` (asserted in imports-parsers.spec.ts:165-172) and `TextWidget` reads **exactly those keys** (WidgetRenderer.tsx:1240-1248) — no silent `text`-vs-`content` or `textAlign`-vs-`alignment` mismatch. Imported text renders styled and is PropertiesPanel/inline editable like any TEXT zone.
- **IMAGE zones:** `{assetUrl, fit:'contain'}` with unresolved-media zones dropped rather than persisted broken (import-builder.ts:108-118).
- **PDF structured:** baseline-grouped TEXT zones + optional full-bleed page-background IMAGE (zIndex 0 under content).
- **Fallback (any parse failure):** legacy single IMAGE/WEBPAGE zone — intentionally non-text-editable, honestly a fallback, never worse than the old behavior (controller comment + try/catch verified).

### E2E baselines — both green this run

```
pnpm --filter web exec playwright test tests/e2e/external-html-clickedit.spec.ts  → 28 passed (16.5s, chromium+webkit)
pnpm --filter web exec playwright test tests/e2e/holiday-hotzone.spec.ts          → 2 passed (12.4s, chromium+webkit)
```

### Architecture trace (the safeguard → real caller discipline)

- Board click → inline shim posts `educms-field-click {key,kind}` → PropertiesPanel.tsx:6803 resolves `[data-edit-field|img|action="key"]` row, scrolls + focuses + outlines it.
- The panel's row list is **discovered live** from the board source — it walks "every `[data-field]` to discover its key + default text" (PropertiesPanel.tsx:6556, `discoveredFields`/`discoveredImages`/`discoveredActions` state at :6644-6659) — so a tagged element can never be click-dead from a stale static schema. Holiday boards use the parallel `getHolidayLiveFields` live-sourcing (525b0cf5), covered by its own spec.
- Edit-mode arming handles the remount race (re-sent on `educms-ready` + 400ms/1200ms retries) and is never sent on the player.

---

## Findings

### Finding 1 (P1) — Duplicated ticker track untagged: override shows OLD text on the live player

The seamless-scroll tickers hand-duplicate the message spans for loop continuity, but only the FIRST copy carries `data-field`. The shim's apply loop iterates `querySelectorAll('[data-field]')`, so an operator override updates copy 1 while the untagged copy 2 keeps the shipped default — the live ticker alternates new text / stale default every loop cycle.

Confirmed members (source-verified, not heuristic):
- `apps/web/public/templates/hs/gallery.html:267` — 4 fields (`ticker.message`..`message4`) each duplicated untagged.
- `apps/web/public/templates/signage/qsr/11-dominos-pizza-board.html` — `<span data-field="ticker.0">🔥 NOW BAKING FRESH…` + untagged `<span>🔥 NOW BAKING FRESH…` (4 messages). **This is the Domino's pilot board (task #197)** — a pilot operator changing "MIX & MATCH $6.99" will see the old price keep scrolling past.
- `apps/web/public/templates/hs/caf-today.html` — the `ticker.message` marquee string duplicated untagged (menu prices in it: "smash burger today $4.50").

Heuristic also flagged corporate/05-floor-directory and healthcare/03-now-serving (1 each) — inspected samples are repeated chrome labels, false positives.

**Fix (mechanical):** put the SAME `data-field` on the duplicate span (apply already targets all matching nodes), or generate the loop copy via JS clone after apply. Add a sweep assertion to the clickedit spec: no visible text node may equal a `data-field` element's default text while untagged.

### Finding 2 (P1) — 8 menu boards: every visible price unbound — not click-editable AND the advertised POS sync can't touch them

`applyMenu()` only updates price elements tagged `data-field="<prefix>.price|p|price_sm/md/lg"`. Sweep of all 31 menu boards (price-fields vs visible dollar amounts):

| Board | price fields | $ marks | status |
|---|---|---|---|
| qsr/02-counter-menu | **0** | 9 | all 9 item prices dead; board literally declares `data-source="toast" data-feed="/menu/full" data-refresh="60s"` |
| qsr/06-beverages | **0** | 17 | all prices dead |
| menus-pos/02-wine-list | 1 | 13 | 12 wine prices dead |
| menus-pos/04-cocktail-program | **0** | 4 | dead |
| menus-pos/06-brunch | **0** | 7 | dead |
| bar/03-bottle-list | **0** | 22 | whole bottle list dead (names/descs ARE tagged — only prices skipped) |
| bar/04-happy-hour | **0** | 5 | a HAPPY HOUR board whose prices can't change; includes `<del>$7–9</del>` strike-through originals |
| bar/07-bottle-service | **0** | 7 | dead |

Flagships are correctly bound: dominos 31/31, bar/01 tap-list 16/16, menus-pos/01 fullservice 15/16, bar/02 7/8, qsr/01 5/6 — so the pattern (and the fix) is known; the non-flagship batch skipped it. Price changes are the single most frequent menu-board edit; on these 8 boards the operator's only path is "ask support to edit HTML." Same class, smaller: qsr/05-combos-deals has the inverse hole — 4 prices tagged but combo NAMES + descriptions untagged ("Smoked Brisket Double Stack" etc., 22 untagged text els).

### Finding 3 (P2) — Older signage batches carry untagged real content (not just chrome)

Rendered-DOM sweep of all 121 non-kiosk boards: 80 have ≥1 untagged visible text element. Most are defensible fixed chrome ("Live", "Hours", section labels) — but a meaningful subset is venue-specific content an operator WILL need to change, e.g.:
- healthcare/05-hours-closures: "Open now · until 6 PM", "Closed", "Northside Hospital · 911" — the hours board's hours.
- healthcare/07-mychart-signup: "Or text JOIN to 24824 — your patient ID is on…" (a phone shortcode!).
- corporate/02: "Slack #book-rooms"; corporate/04: "careers@northstar.co"; corporate/08: "Front entrance · Pier 12".
- fashion/07: "Scan to shop online · eternel.com/window".
- hospitality/02-concierge-board: 15 untagged including reservation/walk info.

Worst offenders by count: qsr/02 (32, incl. category names "Sandwiches"/"Burgers"), qsr/05 (22), hospitality/02+05 (15), corporate/07 (14), healthcare/08 (13). The 12 redesigned hs boards + school batch prove the team's current contract discipline; the gap is the older intake batches. Also blocks i18n: fixed English chrome can't be translated per-tenant. Recommend a ratchet: per-board untagged-visible-text budget asserted in CI (the rendered-DOM counter from this audit is reusable).

### Finding 4 (P2/P3 docs) — CLAUDE.md sweep command + protocol doc drift

1. The binding sweep command enumerates `hs signage fitness` only — `school/` (9 boards) and any future subdir silently escape the post-edit invariant check (the exact trap class that caused the 2026-06-07 fire). One-line fix in CLAUDE.md (and add school to the E2E spec's board list if absent).
2. CLAUDE.md says the walker keys off `data-field/data-imgslot/data-action`; the real V5/V6 walkers also accept `data-img`/`data-slot` (menu photo slots depend on this). Update the doc so future boards don't get "fixed" off the narrower contract.

### Finding 5 (P3) — Placeholder dimension chips render on live players

`qsr/02-counter-menu` (9×"1190 × 240") and `corporate/07-cafeteria` (2×"900 × 280") show `ph-mini` dimension-hint chips in their DEFAULT render — helpful in the builder, but a screen deployed before the operator sets photos shows raw dimension labels to customers. Hide `.ph-mini-label` outside edit mode (shim knows edit state).

### Finding 6 (P3) — Internal review page publicly served

`apps/web/public/templates/_hs-audit.html` ("HS School Signage — Pick the Worst 10", an internal design-triage page) is live: `curl https://venue-os.app/templates/_hs-audit.html` → **200**. No secrets (repo is public anyway), but it's an unprofessional artifact one URL-guess away from a customer. cf5772ae's junk de-tracking missed it. Delete or move to `scratch/`.

---

## Solid (verified, not vibes)

- Hotzone sweep: 0/112 missing (hs+signage+fitness); school 9/9 on V6; kiosk 19/19 external shim; menu 31/31 kept applyMenu V5; V4-or-older count: 0.
- `external-html-clickedit.spec.ts` 28/28 and `holiday-hotzone.spec.ts` 2/2, chromium+webkit, run live this audit.
- 11/12 redesigned hs boards at 100% visible-text tag coverage in rendered DOM (37–78 tagged els each).
- Panel field discovery is LIVE from board source (PropertiesPanel.tsx:6556 + 6644-6659) — tagged elements cannot be click-dead via stale schema; click handler at :6803 traced to row scroll/focus/outline.
- Import 2.0: parser→TextWidget config keys match exactly (content/fontSize/alignment/bold/color/fontFamily); broken-media zones dropped; fallback path honest.
- Base TextWidget meets the §19 field standard incl. line-height clamp + themed `onConfigChange` pass-through (the prop-drop regression class is closed).
- Prior-audit editability P0-3 ("17 themed widgets array/image editors") confirmed present per 2026-06-09 REPORT.md trace — KNOWN-FIXED, not re-opened.

## Missing-feature notes (competitive, §19-adjacent)

- No per-board untagged-content CI ratchet (the contract is enforced by convention + a 28-board spec sample, not a census gate). The rendered-DOM counter built for this audit is a ready-made gate.
- No bulk find-and-replace across a board's fields (operators editing 22 prices one row at a time); Canva-class editors offer multi-select/style-copy.
- Menu boards: no UI affordance distinguishing "this price is POS-synced" vs "manually editable" — operators can't tell why some fields update themselves.

## Scoped down / deferred

- Did not re-grade all ~33 themed React text renderers field-by-field (P0-3 verified via dedup trace only).
- Kiosk scene-engine internal editability (multi-scene flows, button wiring) sampled via shim presence + prior 28/28 spec, not per-kiosk DOM census (kiosk engine needs the CMS wrapper to render).
- Holiday boards verified via their dedicated E2E spec + live-fields code path, not a per-board hotspot census (18 boards covered by `test:cross-browser` protocol checks).
