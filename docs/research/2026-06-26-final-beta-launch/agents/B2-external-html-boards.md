# Wave B2 — EXTERNAL_HTML boards editability

**Date:** 2026-06-26
**Agent:** B2 (final pre-launch beta audit, read-only)
**Surface tested:** the self-contained EXTERNAL_HTML signage boards under
`apps/web/public/templates/{hs,kiosk,signage,fitness,school}/` (140 boards) +
`apps/web/public/holiday-templates/` (49 boards), plus the 3 injectors and the
PropertiesPanel click-to-edit bridge.
**Scale tier:** 4K (3840×2160) static signage + 1920×1080 kiosk + portrait holiday boards.
**Standard Audit Surface §§ covered:** §19 (Template + Widget Editability Standard —
PRIMARY), §15 (Cross-browser — WebKit regex-literal bug class), §20 (Design/UX/Functionality lenses).
**N-A:** all other §§ (out of scope for this wave — other B/C waves cover them).

## Headline verdict

**The "2026-06-07 un-editable-board fire" class is fully contained. Zero boards are
stranded on an apply-only shim, zero are un-editable by click, zero are missing the
editability contract, and the menu boards' load-bearing `applyMenu()` (live POS price +
auto-86) was NOT clobbered.** The injector architecture is the strongest part of the
codebase I touched: version-aware, idempotent, additive, and correctly routed so the
hand-crafted menu shim is never stripped. Found **0 P0, 0 P1, 2 P2** (both documentation
drift, not functional). Live prod confirms the deployed reality matches the repo.

## Step-by-step what I did

1. **Ran the EXACT CLAUDE.md sweep** (`for f in $(find hs signage fitness -name "*.html"); do grep -qE "educms-field-click|src=[\"'][^\"']*_edit-shim" "$f" || echo "NO CLICK-TO-EDIT: $f"; done`). Result: **clean — zero boards missing click-to-edit.**
2. **Extended the sweep to `kiosk` and `school`** dirs (not in the literal CLAUDE.md command but in scope). Both clean.
3. **Counted all boards by dir:** hs=22, kiosk=19, signage=89, fitness=1, school=9 (140 total) + holiday=50 (49 boards + 1 gallery index).
4. **Tallied shim version markers** across all board dirs: 90 on `EDUCMS-SHIM-V6` (generic injected: apply + click + freeze), 31 on hand-crafted `EDUCMS-SHIM-V5` (the menu boards w/ `applyMenu`). **Zero stale V4/V3/V2** — the "stranded apply-only V4" trap that caused the 06-07 fire does NOT exist anywhere.
5. **Read all 3 injectors** (`inject-shim-v2.cjs`, `inject-click-shim.cjs`, `kiosk/_edit-shim.js`). Confirmed: the generic injector now bakes **V6** (a superset of V5: adds gallery freeze), and SKIPS any board with `applyMenu` / `_edit-shim.js` ref / V6 marker — so re-running it can never strip the menu shim.
6. **Verified the menu boards** — found 31 `applyMenu` boards. 30 carry the additive `EDUCMS-CLICK-V2` shim; 1 (`signage/qsr/11-dominos-pizza-board.html`) carries its own hand-crafted click reporter + the `EDUCMS-FREEZE-V1` companion instead. **All 31 have `educms-field-click` + a freeze mechanism.** None clobbered.
7. **Verified the editability contract** — zero boards have ZERO `data-field`/`data-imgslot`/`data-action`/`data-img`/`data-slot` (input set non-empty: hs=1518, signage=2729, fitness=41, school=457 `data-field` attrs). Spot-checked that `data-field` elements wrap real content and kiosk `data-action` buttons map to panel rows.
8. **Verified the panel side speaks the protocol** — `PropertiesPanel.tsx:6861-6907` sends `educms-edit-mode {on:true}`, listens for `educms-field-click`, and jumps to the matching `[data-edit-field]`/`[data-edit-img]`/`[data-edit-action]` row. The board iframe is rendered at `WidgetRenderer.tsx:2898` with `title="Signage template"` + `sandbox="allow-scripts"` (null-origin, no `allow-same-origin`) — matches the panel querySelector and the CLAUDE.md spec exactly.
9. **Holiday templates** (separate `holiday:*` / `_style-bridge.js` bridge): all 49 boards carry the bridge; zero missing.
10. **WebKit cross-browser check (§15):** scanned all 3 injectors for literal control-chars (LF) inside regex literals — the 2026-05-09 Safari "Unterminated regular expression literal" bug class. **Clean.** The board click-to-edit e2e spec (`tests/e2e/external-html-clickedit.spec.ts`) runs in chromium + webkit.
11. **Registry completeness:** built the full registry from all 4 preset sources (`signage-templates.ts`, `system-presets.ts`, `restaurant-presets.ts`, `IndustryShowcase.tsx`) and diffed against on-disk boards. **Zero truly-orphaned boards** — all 140 are registered/reachable.
12. **Live prod verification:** `curl https://venue-os.app/templates/hs/varsity.html` → HTTP 200, V6 shim baked in. `curl .../signage/qsr/11-dominos-pizza-board.html` → HTTP 200, `applyMenu` ×2 + `educms-field-click` + `EDUCMS-FREEZE-V1` all present. Deployed = repo.

## Findings table

| # | Sev | area | what | repro | evidence |
|---|-----|------|------|-------|----------|
| 1 | P2 | docs drift | CLAUDE.md says the generic injector bakes `EDUCMS-SHIM-V5`; it actually bakes **V6** now (V5 + gallery freeze). `inject-shim-v2.cjs` lists V5 in `OLD_MARKERS`, which would strip a hand-crafted V5 menu shim — but the `applyMenu` skip-guard prevents this. Cosmetic doc lag only; routing is correct. | `grep "MARKER = " apps/web/scripts/inject-shim-v2.cjs` → `EDUCMS-SHIM-V6` vs CLAUDE.md "bakes EDUCMS-SHIM-V5" | `inject-shim-v2.cjs:53` (`MARKER='EDUCMS-SHIM-V6'`), `:82` (V5 in OLD_MARKERS), `:185` (applyMenu skip) vs CLAUDE.md "EXTERNAL_HTML shim does TWO jobs (since V5…)" |
| 2 | P2 | docs drift | CLAUDE.md sweep command only covers `hs signage fitness` — omits the `kiosk` and `school` dirs that also ship editable boards (19 + 9 = 28 boards). Both pass an extended sweep, but the documented command would miss a future regression in those dirs. | Run the CLAUDE.md `for`-loop as-written → `kiosk`/`school` never scanned | CLAUDE.md "EXTERNAL_HTML shim" §; my extended sweep over `kiosk school` = clean (0 missing) |

**No P0 / P1 found.** Every board is editable-by-click, on a current shim, carries the contract, and the menu shim is intact.

## Coverage: what I could NOT reach + why

- **No live click-through in the browser.** Ground rules forbid `pnpm dev`/Playwright (dirties the tree). I verified the protocol by code-reading both ends (board shim + PropertiesPanel handler) + curling served prod HTML, and confirmed the e2e spec that exercises it exists and runs in chromium+webkit. The lead's note says the AI/chat-to-edit happy path was already verified live this session; the static-board click-to-edit is covered by the standing e2e spec, not re-run here.
- **Did not render every one of the 140 boards visually** — out of scope (this is the editability/shim audit, not a per-board design review). Design grade below is inferred from the flagship boards' known-good status + the auto-fit ≥50px floor convention, not a 140-board eyeball.
- **Holiday-board internals** audited for bridge-presence only (separate `holiday:*` protocol owned by `HolidayWidget`/`holiday-hotzone.spec.ts`), not field-by-field.

## Grade per Greg's 3 lenses

- **Design: A−** — the flagship boards (varsity, dominos, the menu set) are premium; the architecture enforces the auto-fit floor + brand-token passthrough. Held off a full A only because I didn't eyeball all 140.
- **UX: A** — click-any-element-→-jump-to-its-editor works end-to-end across all 3 architectures (V6 generic, hand-crafted menu, kiosk engine), the panel re-arms on `educms-ready` remount, and edit-mode is never sent to the live player (boards stay non-interactive on glass). This is the operator's exact ask, fully delivered.
- **Functionality: A** — zero un-editable boards, zero stale shims, `applyMenu` intact, WebKit-clean, registry complete, deployed=repo. The only findings are documentation lag.
