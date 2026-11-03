# Older template worktree publication audit

**Basis:** `work/worktree-publication-audit.json` plus read-only Git/source inspection of the three requested branches against their refreshed `origin/master`, `4e95889ea77dd8842a61a148082f719f054a13ed` (2026-11-02). No worktree, ref, or app was changed or run.

## Findings

`merged: false` in the JSON and `git cherry` output do not by themselves mean source work is unpublished. These branches have non-ancestor commits, and `git cherry` marks those commits `+` when their patch IDs do not match. Source paths, registrations, and the branch handoffs provide the better evidence: some previously accepted template work has an equivalent in the refreshed master; other refinements remain branch-only.

### `codex/astra-template-quality-finish` and `codex/template-astra-polish`

| Work | Refreshed `origin/master` | Assessment |
|---|---|---|
| Retail Service Counter (`signage/retail/09-service-counter.html`) and landscape/portrait registration | Present. The path, registration, portraits, and posters are in upstream commit `8bd4aa647` (“publish four verified designs and their portrait layouts”), which is part of refreshed `origin/master`. The saved checkpoint also calls this accepted work integrated. | **Integrated equivalent.** The branch being unmerged does not indicate this template is missing. |
| Corporate New Hires, Healthcare Patient Education, MyChart | Their source paths and landscape/portrait registrations are present in `origin/master`, including `8bd4aa647`. The branch shutdown notes classify these as accepted. | **Integrated equivalent.** The branch snapshot has small source diffs from master; no missing catalog entry or orientation was found. |
| Bottle Service (`signage/bar/07-bottle-service.html`) | The board exists upstream from the earlier flagship refresh. The later branch re-composition is absent: the branch has about 153 added CSS lines including a two-column menu and separate reservation rail. | **Outstanding, incomplete refinement.** The saved checkpoint says it was not accepted/integrated. Its recorded verification still found a long-description collision in landscape, unresolved header/footer containment, and portrait table-name containment. This work is preserved on the branch, not lost, and is not ready to describe as finished. |
| Christmas ES/MS/HS, Hospitality Events and Check-in, QSR Now Hiring | Base boards exist upstream from the Oct 11 refreshes. Branch-only deltas add typography/copy or layout refinements: 7–9 lines per Christmas board, 17 lines for Events, 16 for Check-in, and 12 for QSR Hiring in the compared source diffs. | **Candidate unfinished refinements.** The Astra source report initially marked these boards for revision; the shutdown checkpoint still lists them as next work. No completion evidence in the inspected handoff establishes these branch edits as accepted or release-ready. |
| Additive editor elements (tables, charts, photo frames/collages) in the Astra branch | `DesignDataFields.tsx`, `PhotoDesignFields.tsx`, `DesignDataWidgets.tsx`, `PhotoDesignWidgets.tsx`, `DesignElementStage.tsx`, and `builder-design-elements.spec.ts` are absent from `origin/master`. | **Separate unintegrated feature work.** This is outside the focused template-source review, but it is distinct work carried by the Astra branch rather than an already integrated equivalent in the current tree. |

The `template-astra-polish` saved handoff explicitly distinguishes the accepted Retail Service Counter and healthcare/corporate work from Bottle Service, which was still pending. It also says the pending batch was not pushed. The source-level state above agrees with that distinction.

### `codex/jll-portrait-reach`

The branch is at `8a02b2f0`; the JSON records only an untracked `node_modules` directory. Its three commits are not ancestors of refreshed master. The branch handoffs describe two review deliverables and explicitly say neither changed a live tenant, database, or deployment:

- The **JLL / Meridian commercial-real-estate pack** has eight property designs with landscape and portrait layouts: Property Overview, Amenities, Floor Plans & Availability, Location & Connectivity, Industrial Specifications, Investment Offering, Guided Property Tour, and Property Finder & Compare. Its install notes describe 32 records backed by 16 responsive HTML files, with JLL-specific records scoped to a confirmed customer tenant. The documented installer defaults to dry-run; applying it is a separate approved installation step.
- The later **JLL and generic touch/signage directions** review contains 12 HTML templates / 24 orientation formats, including JLL-branded signage and matching interactive property experiences. Its handoff says these are review assets, with JLL versions absent from global registries and generic versions eligible for registration after design review.

Those branch source paths and the `commercial-real-estate-presets.ts` catalog are absent from `origin/master`. The current tree does contain Corporate directory templates and six commercial-touch designs in landscape and portrait. They are related in category and provide existing generic corporate/property-touch choices, but they do not match the JLL source paths or its eight-design package; in particular, the dedicated Guided Property Tour and Property Finder flows are absent. **The JLL work is saved review/install work, not evidence of publication to a customer tenant or production.**

## Practical readout

- No basis to treat every unmerged commit as missing: the Retail Service Counter, New Hires, Patient Education, and MyChart work has upstream equivalents.
- The clearest genuinely missing source refinement is Bottle Service, with the stated visual issues still unresolved. Christmas, Hospitality Events/Check-in, and QSR Hiring contain branch-only follow-up edits that their own handoff still treats as pending.
- The JLL packs are not in the refreshed master tree. Their handoffs describe review preparation and customer-scoped installation requirements; they do not claim a live install.
- The Astra editor-element files are also absent from master and merit a separate disposition if the audit is expanded beyond template source work.
- This audit establishes repository contents and saved worktree state only. It did not check deployed assets or a production screen, so `origin/master` presence is not a deployment claim.
