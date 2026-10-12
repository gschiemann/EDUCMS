# Industry template coverage and next design contract — 2026-10-11

**The weak-industry work is not complete.** This inventory distinguishes existing designs refreshed, genuinely new workflows, and sectors still needing an audit. It does not label uninspected boards good or bad.

The live offered catalog contains 453 presets out of 488 registry entries: 19 superseded and 16 quarantined are excluded. Six newly offered presets represent three workflows in two orientations: Service Update, Care Services/Booking, and Commencement Guest Guide. Service Update is tagged to all 12 industries; that reusable workflow does not constitute 12 dedicated industry redesigns.

Source: `ensure-system-presets.ts`, its current vertical resolver, and the exact Astra coverage manifest. Inventory commit: `36aea68995458289c1c83913e6612f7b58de93dc`. [Machine-readable catalog and preset names](2026-10-11-industry-template-coverage/catalog.json).

| Industry | Offered presets | Refreshed HTML designs / available HTML designs | Remaining work |
|---|---:|---:|---|
| K12 | 201 | 8 / 77 | New Commencement guide; broader remaining school/seasonal catalog needs review. |
| GYM | 41 | 1 / 20 | No dedicated refresh in this batch. Audit member arrival, first class, changing facilities and trainer/session information against existing offers. |
| RETAIL | 20 | 5 / 17 | Confirmed new gap: Service Counter for collection, returns/exchanges, requirements and desk help. |
| CORPORATE | 37 | 9 / 35 | Shared Service Update added. Review remaining lobbies/visitor information; accessible public-visit guide remains a candidate. |
| QSR | 60 | 4 / 27 | Review untouched boards. Astra recommends a fuller workplace photo for Hiring; retain POS behavior. |
| FASHION | 20 | 5 / 17 | Four existing source designs refreshed. Service Counter also applies to fashion retail. |
| BAR | 26 | 8 / 15 | Astra recommends a hierarchy pass for Bottle Service, preserving all slots and POS adapters. |
| HEALTHCARE | 20 | 15 / 17 | New Care Services/Booking guide. Confirmed new gap: passive First Visit/Arrival guidance; avoid clinical advice or fake appointment feeds. |
| HOSPITALITY | 20 | 5 / 18 | Confirmed new gap: Guest Essentials. Astra also recommends stronger hierarchy for Events. |
| RESTAURANT | 58 | 10 / 31 | Nine source designs refreshed. Review remaining native/menu variants without adding duplicate menu workflows. |
| SPORTS | 54 | 1 / 1 | 24 native celebration variants received contrast changes. Three flagship studies remain: Touchdown, Three Pointer, Home Run; verify portrait intent and motion. |
| WORSHIP | 51 | 1 / 25 | No dedicated refresh in this batch. Audit visitor arrival, service flow, families/accessibility and volunteer information against existing offers. |

Counts overlap because presets can have multiple industry tags; landscape and portrait presets can share one source. The HTML column counts distinct sources, including the shared Service Update, rather than counting orientations as new designs. It excludes native React sports and separate holiday boards. The earlier 57 rebuilt sources comprise 54 regular boards plus three Christmas boards; the three new sources are additional. Offered quantities measure coverage, not quality.

## Next confirmed gaps, one composition at a time

1. **Retail Service Counter:** collection and returns/exchanges lanes; two-step instructions; operator-authored requirements; desk location/hours/help; replaceable logo and purposeful desk/parcel image. Apply also to fashion retail. Existing promotion, wayfinding, food pickup and resident-package kiosks do not fill this workflow.
2. **Hospitality Guest Essentials:** arrival/departure instructions, Wi-Fi guidance, breakfast/amenity hours, shuttle pickup/help, optional accessible-route map and real supplied guide link/QR. Existing wayfinding and room-readiness boards do not combine these public guest instructions.
3. **First Visit / Arrival Guide:** passive administrative check-in location, booking paperwork/instructions and assistance. Existing queues, member welcomes and interactive check-in kiosks do not fill the non-touch arrival workflow. Care is the confirmed gap; gym use must be checked against its existing class/member onboarding catalog before adding tags.

These are queued proposals, not newly shipped templates. Fitness and worship are the largest dedicated review omissions from this wave, not established catalog-wide quality verdicts. Inspect their actual offered sources before claiming new gaps or retiring anything. A further accessible-visit guide for public venues is lower priority.

## Astra requirements carried into new templates

The binding [flagship standards](../design/FLAGSHIP-TEMPLATE-STANDARDS.md) now include an Astra acceptance section: real text-bound containment and neighbor collisions; a deliberate primary action/hierarchy; complete subject crops in both orientations; declared repeat capacity; saved source/style edits and authored reset; click-to-edit; both Chromium and WebKit; honest operator-managed data. Keep body at least 60px and supporting copy at least 50px on the 3840px stage after fitting, with multiple loaded/editable typefaces. Preserve every visible text, image, color and font as editable content.

Shared Crop/Reposition and inline text-capacity feedback are separate editor implementation work. The new-template checklist acknowledges them explicitly and does not claim authored defaults implement those features. Dense Bottle Service/Events and the three sports studies are also open Astra recommendations, separate from filling missing workflows.

## Execution and cost policy

The user explicitly authorized low-cost agents on 2026-10-11. Use Luna for bounded catalog inspection, source checks and drafts; use Astra only where visual judgment warrants it. The lead owns final integration, browser verification, commits, pushes and CI. Agents that write or run the app require isolated worktrees; preserve every report immediately. Do not remove active worktrees belonging to other chats.

Current release: Astra's concrete schedule containment and care photo-crop fixes are pushed in `36aea689`. Live source/poster bytes were verified against that commit. Full CI is being watched on the containing master descendant; pending or cancelled runs are not green. Durable runtime checkpoint: `/Users/gschiemann/Desktop/template-flagship-audit/astra-polish/RELEASE-CHECKPOINT.json`.
