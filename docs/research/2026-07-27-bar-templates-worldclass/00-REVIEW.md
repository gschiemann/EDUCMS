# Bar templates — world-class review + redesign program (2026-07-27)

Operator ask: *"all of the bar templates look like fucking trash, can you review and
update them to meet our world class standards?"*

Scope: the 10 registered bar boards under `apps/web/public/templates/signage/bar/`
(`preset-sig-bar-01` … `preset-sig-bar-10` in `signage-templates.ts`), graded against
`docs/design/FLAGSHIP-TEMPLATE-STANDARDS.md` + `.claude/agents/venueos-template-designer.md`.

## Review verdict: all 10 fail the flagship standard

Fleet-wide scan (grep + live-DOM render, before-screenshots in the session scratchpad
`bar-before/`):

| Defect | Boards affected |
|---|---|
| No Google Fonts — `"Didot"`/`"Arial Narrow"` system stacks; players fall back to Georgia/Arial | all 10 |
| No canonical `[data-widget="theme"]` token block (re-skin only via shim var aliases) | all 10 |
| No `data-fit` auto-fit anywhere | all 10 |
| **Zero** `data-imgslot` in the live DOM (not even a bar-logo slot) | all 10 |
| No portrait orientation support | all 10 |
| Sub-50px text on the 3840 stage (22–28px meta/labels — illegible at 20 ft) | all 10 |
| Static, non-ticking clock (`clock.hhmm` is dead text) | all with clocks |
| Flat "list on a dark rectangle" design; 40–60% dead canvas | all 10 |
| `data-stock="0"` KICKED `::after` has `position:absolute` with no offsets (broken overlay) | 01 |
| **Quarantined** (audit W0-08): default state renders literal "3680 × 2000 · CASK PORTRAIT" placeholder + empty image void | 05-now-pouring |

What they DO have (must be preserved through redesign):
- The hand-crafted `/*EDUCMS-SHIM-V5*/` block with `applyMenu()` — live per-location POS
  prices + auto-86. **No injector regenerates this**; `inject-shim-v2.cjs` would clobber it.
- `/*EDUCMS-CLICK-V2*/` click-to-edit + gallery-freeze shim (additive, `inject-click-shim.cjs`).
- Full `data-field` coverage with applyMenu-compatible key leaves (`t.N.n` / `t.N.p`), bound
  by commit `916f2257`.

## Traps verified before dispatch (each decides a hard rule in the agent brief)

1. **Field discovery is static** — `ExternalHtmlTextEditor` (PropertiesPanel.tsx ~6975)
   fetches the file and parses with DOMParser; scripts never execute. Every editable element
   must exist in static markup. The July-25 tap-list redesign candidates
   (`redesign-tap-list-v{1,2,3}-*.html`) generate rows via JS → their fields are invisible
   to the panel; they also lack the applyMenu V5 shim. Used as the visual quality bar only.
2. **taurus-safety scans public/templates** — HTML pass (added 2026-06-09) bans
   `inset:`/`inset-*` ONLY (gap/backdrop/color-mix are fine on boards). The designer-agent
   file's "public/templates is exempt" line is stale.
3. **Dual var vocabulary** — the V5 shim's BRAND_MAP writes legacy names
   (`--primary`, `--font-grotesk`, …), the canonical theme block writes `--brand`, `--f-*`.
   New boards dual-write both so BOTH re-skin paths work.
4. **De-quarantine for 05** is a deliberate two-step: remove URL from
   `packages/api-types/src/quarantine.ts` (deploy FIRST), then add `preset-sig-bar-05` to
   `scripts/reactivate-dequarantined-boards.cjs` REACTIVATE and run `--apply` (seeder is a
   one-way ratchet).

## Program

- Workflow `bar-templates-worldclass` (run `wf_f191bb7f-3e0`): 10 worktree-isolated
  `venueos-template-designer` agents, one per board, each self-verifying in WebKit +
  Chromium (both orientations, theme re-skin, shim brand path, applyMenu overlay via
  postMessage).
- Lead merge gates: key-preservation diff (old keys ⊆ new), shim byte-carryover grep,
  no-inset grep, `inject-click-shim.cjs signage` re-run, click-to-edit sweep,
  `check-taurus-safety.cjs`, Playwright `external-html-clickedit.spec.ts`, own
  render-verify + after-screenshots, preflight, push, CI watch to green.
- 05: pair the fix with quarantine.ts removal + reactivation (after deploy).
- Deliverable: before/after artifact for Greg.

Agent reports land in this folder as `01-agent-reports.md` when the fleet returns.
