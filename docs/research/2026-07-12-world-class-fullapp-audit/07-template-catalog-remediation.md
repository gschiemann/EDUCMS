# Template Catalog and Creator — World-Class Remediation Specification

## Honest verdict

The catalog is large, but size is masking quality and release-discipline problems. It contains some genuinely strong sports/high-school work, yet it is not a curated world-class library today.

- 300 unique source presets were found; 297 system presets are active in the database.
- 133 active presets are a single `EXTERNAL_HTML` zone rather than structurally editable native boards.
- 55 active boards depend on remote Google/Typekit fonts and therefore cannot promise offline visual fidelity.
- The production review ledger at `docs/template-finalization/PROGRESS.md:22-75` lists 81 customer-facing HTML templates: 80 are pending and the Domino’s board is still only “in review.” None is stamped approved.
- Fresh databases activate every source preset at `apps/api/src/templates/ensure-system-presets.ts:343-394`; release status is not connected to approval.
- Seventeen active external boards lack posters, so the gallery can fall back to live iframes at `apps/web/src/components/templates/ScaledTemplateThumbnail.tsx:87-119`, `:212-235`.
- The Domino’s asset pack explicitly says “pilot-demo-only” at `apps/web/public/templates/signage/qsr/img/dominos/CREDITS.txt:1-5` but is active in customer verticals.
- No rights owner, license, reviewer, visual-baseline hash, last-validation time, supported-data contract, or release state exists on `Template` at `packages/database/prisma/schema.prisma:1141-1225`.

The production gallery’s signed-in DOM also shows the result of catalog-first rather than task-first design: a very long scroll of repetitive cards and canvas controls with weak curation, many one-zone 3840×2160 wrappers, and no reliable distinction between “beautiful sample,” “fully editable,” and “connected live data.”

## Known weak/unfinished boards to triage first

### Dimension-placeholder boards

The following active HTML boards contain visible dimension-placeholder content or equivalent unfinished measurements and must be quarantined or repaired first:

- `signage/bar/05`
- `signage/corporate/07`
- `signage/fashion/01`, `02`, `04`, `05`, `07`, `08`
- `signage/hospitality/01`, `02`, `04`, `05`, `07`, `10`
- `signage/menus-pos/03`
- `signage/qsr/01`, `02`, `04`, `05`, `06`

### Confirmed clipping candidates

- `signage/qsr/02`
- `signage/qsr/04`
- `signage/hospitality/05`

### Truth/offline candidates

- Twenty-four active boards describe a static or unsupported source as “live.” These must be relabeled “Sample data” until an adapter test backs the claim.
- Fifty-five active boards use remote fonts; self-host licensed font files or switch to bundled fallbacks.
- Seventeen active external boards have no poster; do not ship a gallery card without an approved poster and screenshot matrix.
- The Domino’s board and asset pack require a customer/brand license before production publication. Demo/reference assets must live in a non-production catalog.

## P0 — install a release state between source code and the customer gallery

Add a versioned `TemplateRelease` or equivalent manifest:

```text
id
templateId
sourceRevision
state: DRAFT | QA | APPROVED | PUBLISHED | QUARANTINED | RETIRED
verticals[]
jobsToBeDone[]
supportedCanvases[]
supportedDataCapabilities[]
editabilityScore
offlineReady
rightsOwner
licenseType
licenseEvidenceUrl
reviewedByUserId
reviewedAt
visualBaselineHashes{}
browserResults{}
lastIntegrationCanaryAt
releaseNotes
```

Only `PUBLISHED` releases may appear in the customer gallery. `ensure-system-presets` must reconcile source metadata without silently publishing new code. A sandbox preset must never become customer-visible because it exists in an array.

**Acceptance:** a newly added preset is invisible to customers until a named reviewer approves rights, visuals, editability, offline behavior, and data truth. Quarantine removes it from new use without breaking existing customer instances.

## P0 — define the visual-quality bar

Every template needs a single scorecard with blocking thresholds:

1. **Three-second comprehension:** one obvious message hierarchy; primary content recognizable from across the room.
2. **Viewing-distance typography:** for 1920×1080 signage, default body text normally ≥32–42 px and important headlines ≥64 px; exceptions require a screenshot at target physical size. Never inherit dashboard-sized 12–16 px text.
3. **Safe area:** no critical content in the outer 5%; support overscan and LED seams.
4. **Contrast:** WCAG AA minimum for informational text; life-safety states use a stricter tested palette. Brand application must not reduce contrast below threshold.
5. **Composition:** no generic “rounded rectangle + shadow” layout as the theme. The metaphor must be visible in the structure, typography, imagery, and motion.
6. **Density:** one primary and at most two secondary messages per scene unless the job is explicitly a menu, schedule, or leaderboard.
7. **Motion:** purposeful, bounded, and reduced-motion aware; no continuous GPU-heavy animation without a measured frame budget.
8. **Truth:** no fabricated names, prices, scores, wait times, records, or “live” indicators on a player. Unbound data renders a neutral empty state.
9. **Offline fidelity:** zero unapproved runtime network dependencies; fonts, textures, posters, and media available locally.
10. **Aspect fidelity:** native layouts or approved adaptations for landscape, portrait, 4K, and LED canvases—never a blindly squeezed 16:9 scene.

**Blocking screenshot matrix:** 1920×1080, 1080×1920, 3840×2160, and the supported LED canvas such as 960×1080; current Chromium, WebKit, and Chromium 83/Taurus. Compare the player render, not only the builder thumbnail.

## P0 — make editability a release gate, not a renderer feature

Every visible element needs a stable field identity and operator control:

- Text: content, font family, size, weight, color, alignment, line-height, letter spacing, and overflow behavior.
- Image/video: asset picker or URL, fit, position, focal point, crop, mute/loop where relevant, and alt/caption metadata.
- Background: solid, two-stop gradient minimum, image, opacity/overlay, and brand tokens.
- Lists/menus/charts: add, remove, reorder, import, bind, and empty-state controls.
- Geometry: x/y/w/h, rotation, z-index, opacity, lock, group, duplicate, and safe-area guides.
- Live data: exact connection/capability binding, refresh time, fallback mode, last good value, and “sample vs live” state.
- Brand: every color field offers brand-primary/accent/neutral tokens, not only a raw hex value.

Native primitives currently land around A-/B+; native lists/menus B+; V2/sports widgets around B; packaged HTML ranges B-/C; AI inline HTML is D/C-. A release below B in any required editability category must stay out of the production catalog.

## P0 — replace raw AI HTML with a structured design document

The Designer currently persists one `EXTERNAL_HTML` zone at `apps/api/src/templates/templates.controller.ts:1324`. This prevents Canva-class structural editing and creates the script/action security boundary documented in embedded Part II.B of the consolidated brief.

Define `BoardDocumentV2` as a versioned AST with trusted node types:

```text
BoardDocument
  canvas + safeArea + scenes
  tokens: brand, typography, spacing, motion
  nodes:
    Text | RichText | Image | Video | Shape | Group
    List | Menu | Table | Chart
    Clock | Countdown | Weather
    LiveBinding | Conditional | Repeater
    TrustedAnimation | ApprovedAction
```

The model emits JSON matching a strict schema; the server validates size, nesting, URLs, bindings, contrast, overflow risk, action policy, and data provenance; a trusted renderer compiles it. Raw HTML remains a quarantined legacy import format with limited-editability labeling.

## P1 — redesign the gallery around operator jobs

Replace the giant preset scroll with a task-first flow:

1. Ask: “What are you putting on a screen?”—welcome, menu, score, schedule, promo, wayfinding, emergency, live stream, kiosk.
2. Auto-filter by tenant vertical, screen orientation/resolution, connected integrations, and audience.
3. Show 5–8 curated recommendations, not hundreds of equal-weight cards.
4. Every card displays:
   - approved poster—not a live iframe;
   - “Fully editable,” “Limited HTML editing,” or “Image-only”;
   - “Live with Square connection” versus “Sample data”;
   - orientation/canvas support;
   - offline-ready status;
   - last verified date;
   - accessibility/editability score.
5. Preview with real tenant brand and either connected tenant data or an unmistakable demo-data banner.
6. Primary CTA is contextual: “Use for tonight’s game,” “Connect your menu,” or “Schedule on Lobby TV”—not a generic “Open builder.”

**Acceptance:** a new nontechnical operator finds, brands, edits, and schedules the right board in under 30 seconds with no documentation.

## P1 — use the mandated one-template iteration loop

Do not batch-redesign the 297 active presets. For each flagship:

1. Produce 3–5 1920×1080 HTML mockups using fixed scene pixels and real fonts/assets.
2. Obtain explicit visual approval.
3. Port the approved scene through the fixed-canvas `transform: scale()` renderer.
4. Screenshot the live React/player version next to the approved mockup.
5. Stamp approval in code and in `TemplateRelease`.

Start with five jobs that create most commercial value per vertical; retire or hide long-tail variants until reviewed. A smaller catalog of 50 excellent, truthful, editable templates is far stronger than 297 uneven ones.

## P1 — self-host and preflight all template assets

- Bundle licensed font subsets and declare fallbacks; no remote Google/Typekit dependency on player surfaces.
- Generate an `offlineAssetManifest` per release and have the service worker verify every hash.
- Reject missing assets, 404 posters, remote script tags, unapproved network origins, and oversized animation/media.
- Track rights/license provenance for every photo, logo, font, icon, and stock asset.

## P1 — atomic template document persistence

Current Save writes metadata and zones separately at `apps/web/src/components/template-builder/BuilderShell.tsx:288-355`; Save As can silently collapse scenes and omit data-source/touch fields at `:561-677`.

Add:

- `PUT /templates/:id/document`—transactionally writes document, metadata, scenes, actions, bindings, revision, and version snapshot with `expectedRevision`.
- `POST /templates/:id/duplicate`—server-side deep copy preserving the same complete contract.
- idempotency keys, optimistic revision checks, conflict UI, and durable autosave revisions.

**Acceptance:** inject a failure at every internal write boundary; either the old complete document or new complete document remains—never a hybrid. Duplicate/Save As round-trips byte-equivalent semantics.

## Automated QA pipeline

For every candidate `TemplateRelease`:

1. Validate schema, field census, action allowlist, bindings, asset rights, and local asset hashes.
2. Render every supported canvas in current Chromium, WebKit, and Chromium 83.
3. Fail on console error, uncaught exception, placeholder text, overflow, zero-size primary content, remote network miss, missing font, invalid link, or sample/live ambiguity.
4. Run contrast, keyboard, reduced-motion, and screen-reader checks where interactive.
5. Run a binding contract fixture for each declared integration.
6. Produce posters and signed visual artifacts from the same release commit.
7. Require human visual approval after automation passes.

## Definition of done for one world-class template

- Approved design reference and owner.
- Rights/license record complete.
- ≥B in every editability category.
- No model-authored executable code.
- No unbound fabricated live data.
- All assets hash-verified and offline-capable.
- All target canvases/browsers pass screenshot and overflow gates.
- Brand injection passes contrast and visual review.
- Connected-data and disconnected/fallback states both pass.
- Gallery poster and metadata accurately describe capability.
- Nontechnical create/edit/publish happy path is recorded and under 30 seconds.
