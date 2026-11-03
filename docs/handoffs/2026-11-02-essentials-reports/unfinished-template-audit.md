# Source-level unfinished-template triage

**Scope and limits.** Read-only source audit of the EDU CMS checkout at `/Users/gschiemann/.codex/worktrees/hospitality-guest-essentials/EDU CMS`. Checked the signage picker registry, its shared quarantine denylist, the canonical brand-token standard, selected HTML sources, and the Oct. 11 gap/remediation notes. This is a prioritization aid, not a rendered quality review. Missing source hooks may indicate an editability/brand-conformance gap; they do **not** prove poor visual design. No HTML was rendered in this audit.

The shared standard expects every flagship to expose the canonical theme block and 12 token fields (`brand`, `brand2`, `accent`, `accent2`, `ink`, `bg`, `pos`, `neg`, `fDisplay`, `fBody`, `fMono`, `scale`): `docs/design/BRAND-TOKEN-SCHEMA.md`. The source counts below were obtained after stripping scripts and comments; this avoids counting attributes in injected shim code. “Selectable” means present in the builder’s filtered `SELECTABLE_SIGNAGE_TEMPLATES`; quarantine entries are catalog references only and are not offerable new choices.

## Top 12 source-review candidates

| Rank | Registry ID / business | Source | Offer status | Objective source evidence and why review it |
|---:|---|---|---|---|
| 1 | `preset-sig-qsr-01` · QSR Drive-Thru Menu Board | `apps/web/public/templates/signage/qsr/01-drive-thru-flagship.html` | **Quarantined / hidden** | Shared quarantine calls this a dimension-placeholder blocker. The builder filter removes it; the board must be fixed and reviewed before it can be offered. |
| 2 | `preset-sig-qsr-02` · QSR Counter Menu | `apps/web/public/templates/signage/qsr/02-counter-menu.html` | **Quarantined / hidden** | Explicitly listed under confirmed clipping candidates in the shared denylist. Treat as a layout/reflow review, not a visual verdict from HTML. |
| 3 | `preset-sig-hospitality-02` · Hospitality Concierge / Tonight in Town | `apps/web/public/templates/signage/hospitality/02-concierge-board.html` | **Quarantined / hidden** | Shared denylist labels it a dimension-placeholder board. It is not a customer-selectable new template. |
| 4 | `preset-sig-hospitality-04` · Hospitality Pool / Spa Today | `apps/web/public/templates/signage/hospitality/04-pool-spa-day.html` | **Quarantined / hidden** | Shared denylist labels it a dimension-placeholder board. Confirm source and current poster before any redesign decision. |
| 5 | `preset-sig-gym-01` · Gym Floor Board | `apps/web/public/templates/signage/gym/01-floor-board-flagship.html` | **Selectable** | Source has 39 visible `data-field` nodes, but no `[data-widget="theme"]`, no canonical `theme.*` fields, and no `data-imgslot`/video/poster slots. Strong audit candidate for brand/media-edit coverage; source metrics alone do not say whether it looks unfinished. |
| 6 | `preset-sig-real-estate-01` · Real Estate Availability | `apps/web/public/templates/signage/real-estate/01-availability-flagship.html` | **Selectable** | 40 visible fields, no canonical theme block/fields; one `feat.photo` slot is authored as a `.placeholder` with inline SVG and no baked default image. Review the empty default hero plus brand/edit contract. |
| 7 | `preset-sig-museum-01` · Museum Today | `apps/web/public/templates/signage/museum/01-today-flagship.html` | **Selectable** | 33 visible fields, no canonical theme block/fields; one `feat.photo` slot is authored as a `.placeholder` with inline SVG and no baked default image. Review the default exhibition image state and theme contract. |
| 8 | `preset-sig-office-01` · Office Room Grid | `apps/web/public/templates/signage/office/01-room-grid-flagship.html` | **Selectable** | 46 visible fields, no canonical theme block/fields, and no declared image/video/poster slots. Check whether visual branding is intentionally copy-only or should expose the standard shared tokens. |
| 9 | `preset-sig-bar-09` · Bar Hours | `apps/web/public/templates/signage/bar/09-hours-location.html` | **Selectable** | 24 visible fields, 5.5 KB of script-free source, no canonical theme block/fields and no media slots. Compact utility layouts can be intentional; review for theme consistency and content capacity. |
| 10 | `preset-sig-bar-10` · Bar Hiring | `apps/web/public/templates/signage/bar/10-now-hiring.html` | **Selectable** | 22 visible fields, 5.5 KB script-free source, no canonical theme block/fields and no media slots. Same source-conformance question as Bar Hours; verify its employment message is operator-editable. |
| 11 | `preset-sig-corporate-10` · Corporate Emergency | `apps/web/public/templates/signage/corporate/10-emergency-info.html` | **Selectable** | 12 visible fields, 5.6 KB script-free source, no canonical theme block/fields and no media slots. Review brand token coverage carefully while preserving the safety/instruction hierarchy. |
| 12 | `preset-sig-qsr-03` · QSR Order Ready | `apps/web/public/templates/signage/qsr/03-order-ready.html` | **Selectable** | 35 visible fields, no canonical theme block/fields and no declared image/video/poster slots. Check whether this high-traffic operational message needs the common theme contract and richer editable media. |

### Availability cross-check

The registry is `apps/web/src/components/widgets/signage-templates.ts`; the picker applies `QUARANTINED_BOARD_URLS` to form `SELECTABLE_SIGNAGE_TEMPLATES` (near the end of that file). Quarantine is centralized in `packages/api-types/src/quarantine.ts`. The four quarantined rows above are hidden from new selection; the other eight are currently customer-selectable according to that source filter. The quarantine file names 11 dimension-placeholder boards in total (8 additional to the selected rows), 3 clipping candidates in total (2 additional), and one licensing-risk board; see it directly before opening more work. The licensing-only Domino’s entry is not ranked here as a design candidate.

### Useful screenshot cohort for a parent visual pass

Capture six source-backed examples in the same 16:9 and 9:16 preview sizes (if the source advertises both), then judge the pixels separately:

1. QSR Drive-Thru (`qsr/01-drive-thru-flagship.html`) — known quarantined dimension-placeholder case.
2. QSR Counter (`qsr/02-counter-menu.html`) — known quarantined clipping case.
3. Hospitality Concierge (`hospitality/02-concierge-board.html`) — known placeholder case.
4. Gym Floor (`gym/01-floor-board-flagship.html`) — live selectable, no canonical theme/media slots.
5. Real Estate Availability (`real-estate/01-availability-flagship.html`) — selectable, empty default hero placeholder.
6. Museum Today (`museum/01-today-flagship.html`) — selectable, empty default hero placeholder.

This cohort pairs known source-review blockers with distinct selectable verticals. Do not infer screenshot quality from source markers; use the captures to determine which files actually need visual redesign versus only editability/brand-contract work.

## Source references

- Registry and offer filter: `apps/web/src/components/widgets/signage-templates.ts` (catalog around lines 130–287; filter comment and expression at 280–288).
- Shared quarantine rationale and denylist: `packages/api-types/src/quarantine.ts` (comments and URL list around lines 1–58).
- Binding token contract: `docs/design/BRAND-TOKEN-SCHEMA.md`.
- Relevant catalog history: `docs/research/2026-10-11-template-gaps/README.md`, `CHECKPOINT.md`, and assessments; `docs/research/2026-10-11-astra-template-review/02-fix-verification.md`. The Oct. 11 checkpoint records the accepted refresh state, so these source gaps should be verified against current screenshots/release state before treating as unfinished visual work.
