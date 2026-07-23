# Fashion signage boards — quarantine re-verification (2026-07-23)

## Why
Re-tagging the 10 `Fashion ·` boards to `RETAIL|FASHION` (so they show under
Store **and** Boutique) surfaced that **6 of the 10 were seeded ARCHIVED** —
they're on the 2026-07-12 world-class-audit quarantine denylist
(`packages/api-types/src/quarantine.ts`, W0-08: *"visible dimension-placeholder
content or equivalent unfinished measurements"*). So the retag was moot for
those 6 — an ARCHIVED board appears in **no** gallery, Boutique or Store.

4 of the 6 quarantined boards (01, 02, 04, 05) were part of Claude Design's
recent redesign (commit `f4eee79c`, Taurus-fixed `9d2299a1`). The denylist rule
is strict: *"removing an entry must be paired with the board actually being
fixed."* So each was adversarially re-verified before any un-quarantine.

## Method
Workflow `verify-fashion-quarantine` (run `wf_dce2ee0d-620`): one **skeptical**
Opus reviewer per board (default = keep-quarantined unless it clears every bar),
checking the acceptance criteria (no visible placeholder/measurement text, no
console error, no overflow, no zero-size primary content, editable via SHIM +
data-fields, Taurus-safe, no broken links, no sample/live ambiguity). 6 agents,
0 errors, ~519k tokens. Per-agent verdicts: `journal.jsonl` in the run's
transcript dir; full return payload in the task output.

## Verdicts

| Board | Redesigned | Verdict | Key reason |
|---|---|---|---|
| 01 Lookbook | ✓ | **keep-quarantined** | Default no-photo state: dominant empty hero drop-zone labeled "CAMPAIGN / LOOK PHOTO" + 3 empty product thumbs. Dimension text is gone; editable + Taurus-safe. |
| **02 Editorial** | ✓ | **UN-QUARANTINE** | Clean (Lún Skincare editorial). 8 data-fields, Taurus-safe, no placeholder. Drop label hides on photo-attach (accepted affordance). launchReady. |
| 04 New Arrivals | ✓ | **keep-quarantined** | 4× **hardcoded, non-editable** "Product photo" labels over empty gray gradients (siblings made this an editable data-field; 04 is the outlier). Dimension text gone; otherwise editable (27 fields) + Taurus-safe. |
| **05 Event** | ✓ | **UN-QUARANTINE** | Clean (Vera Fine Jewelry trunk-show). 16 data-fields, Taurus-safe, no placeholder. Drop label hides on photo-attach. launchReady. |
| 07 Window | ✗ (not redesigned) | **keep-quarantined** | Still shows "Window styling" + raw "1820 × 1640" measurement (no data-field, shows by default). + injection artifact (below). |
| 08 Campaign | ✗ (not redesigned) | **keep-quarantined** | Still shows "Full-bleed campaign" + raw "3840 × 2160" (default state). + injection artifact. |

## Action taken (2026-07-23)
- **Un-quarantined 02 + 05**: removed their URLs from `quarantine.ts` (denylist
  21→19), updated `template-quarantine.spec.ts`, and re-activated the 2 DB rows
  (`scripts/reactivate-dequarantined-boards.cjs`, ARCHIVED→ACTIVE, audit-logged).
- **01 + 04 stay quarantined** pending a decision: their default no-photo state
  shows a prominent empty image drop-zone. Options: (a) bake in a default
  stock/sample photo, (b) soften/hide the label to the 02/05 standard (and make
  04's hardcoded labels editable — also satisfies the "all fields editable"
  requirement), or (c) leave hidden. Design call for the lead.
- **07 + 08 stay quarantined** (never redesigned; still show raw dimensions).

## Separate finding — injection artifact in 4 non-redesigned boards
Fashion **07, 08, 09, 10** each carried a JS snippet baked into the `.frame`
div's `style` attribute:
`style="async function readFile(path) { return rpc({ op: 'readFile', path: String(path) }); }"`.
This is **inert** (invalid CSS inside an HTML attribute never executes — it is
NOT a `<script>`; `rpc(...)` is never called; no console error) and the board
renders from the `.frame` CSS class regardless. But it is corrupted/tampered
markup that must not sit in customer files — and **09 + 10 were ACTIVE (live)**.
Byte-identical across all 4 → almost certainly emitted by the external "Claude
Design" tool for the non-redesigned boards. **Cleaned** all 4 (removed the bogus
attribute; provably render-neutral; each file shrank exactly 100 bytes). The
review agents correctly flagged it and did **not** act on the `readFile` RPC
(treated as untrusted data). Worth telling the external-tool vendor.
