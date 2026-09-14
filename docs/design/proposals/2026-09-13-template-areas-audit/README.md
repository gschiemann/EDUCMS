# Template builder: honest eight-area audit and developer handoff

Date: September 13, 2026. Code baseline: `8429c42d`.

## Scope and coverage

Use the Standard Audit Surface checklist in CLAUDE.md as the domain map. Scope is the eight mounted builder panels and their interactions, not a fresh whole-CMS security audit. **Covered means examined within this scope, not certified or defect-free.** C = covered; P = partially covered; D = deferred; N/A = outside this feature. Functionality evidence is source tracing and targeted Jest/DOM tests, not authenticated production playback.

| Standard Audit Surface | Design | UX | Functionality | Scope / limit |
|---|---|---|---|---|
| 1. Real-time + signed pub/sub | D | D | D | Emergency and device transport untouched |
| 2. Storage + content pipeline | P | P | P | Builder save/upload entry points; storage backend not re-audited |
| 3. AI providers | D | D | D | No provider execution |
| 4. AI feature surfaces | P | P | P | Brand/discovery entry points; AI generation quality deferred |
| 5. AI-tool comparison | D | D | D | Not needed to diagnose these controls |
| 6. Streaming integrations | P | P | P | Apps discovery/configuration; no live streaming qualification |
| 7. Sports integrations | D | D | D | Not a new sports-provider audit |
| 8. POS integrations | D | D | D | No POS-account tests |
| 9. Communications integrations | P | P | P | Social app entry points; live authorization deferred |
| 10. Auth + identity | D | D | D | No new auth/tenant penetration test |
| 11. Billing + commerce | N/A | N/A | N/A | Outside builder review |
| 12. Design imports | P | P | P | Apps/embedded documents entry points only |
| 13. Public alerts | D | D | D | Emergency system not changed or certified |
| 14. Multi-vertical surface | C | C | P | Current industry filtering reviewed; selected discovery tests |
| 15. Cross-browser + Chromium 83 | P | P | D | Compatibility requirements recorded; no browser/hardware run |
| 16. Forensic/audit coverage | P | P | P | Brand clear persistence/logging source examined |
| 17. Operational + DX | P | P | P | Isolated test run and preserved evidence; no CI/deployment run |
| 18. Accessibility | P | P | P | Tabs, focus and hover-only controls inspected; no full assistive-tech test |
| 19. Template/widget editability | C | C | P | Eight panels, selected structured editors; not every widget rendered |
| 20. Three-lens discipline | C | C | C | Findings distinguish design proposals from proven behavior |
| 21. Verification before claim | C | C | C | Limits, baseline, tests and unverified risks explicit |

## Bottom line

**The editor has substantial functionality. Its weakest point is that the tools do not behave like one coherent editor.** More icons, filters or widget variants will not solve selection stealing your place, unreliable stacking, misleading Review results or actions that cannot be undone.

Do not throw away the eight capabilities. Change where they live, repair the contracts between them, and make each control accurately describe its effect.

### Improvements already present — preserve them

- Widgets now opens with at most 12 curated choices, industry-aware discovery, one search and a collapsed filter panel. The original screenshot's category wall is not the current implementation.
- Adding, filling an empty placeholder, and explicitly replacing an existing widget have distinct paths.
- Recent changes address selection hiding content, hotspot dragging, zoom sizing and expired countdown starter data. These exist in source; this audit reran zoom tests, not physical-device verification of every change.
- Quick Layouts has scene-preservation regression coverage. Bulk geometry operations protect locked zones. Lock persistence has implementation and dedicated existing tests, though those persistence suites were not part of this run.
- Structured row editors exist. Bulk “Apply brand across template” is already a single undo transaction.
- Local draft recovery, save-conflict UI, version history, and “Put on a screen” already exist. Strengthen them; do not rebuild them under new names.
- Facebook, Instagram, Social Wall and Google Reviews now have implementation paths. **The September 12 recommendation based on four empty stubs is superseded.** This does not establish that production credentials, provider approvals or player playback are working.

## Area-by-area decisions

| Area | Honest assessment | Keep | Add / update | Remove / relocate |
|---|---|---|---|---|
| Widgets | Discovery is much better; quality qualification is the next job | Curated industry default, search, explicit Add/Replace | Favorites/recent, real rendered previews, supported-device/source status, capability contract | Raw enum labels and duplicate routes into the same native widget; no return to a giant filter wall |
| Apps | Useful setup surface, still visually and semantically uneven | Paste detection, guided setup, validation, existing adapters | Content previews, Connected/Needs setup/Unavailable states, precise actions, industry ranking | Huge gray icon slabs, duplicate search inputs, “any website” promise; native clock/countdown/QR moved to Widgets |
| Background | Useful controls exist, but patterns have an actual encoding defect | Color picker, brand palette, gradients, uploads, stock images | Pattern repair, focal point, fit/fill, readable overlay, explicit global/scene scope | Raw CSS from everyday workflow; unnecessary duplicate background editor |
| Layers | Needs functional repair before visual polish | Lock, duplicate, delete, stacking tools | Rename, reliable ordering, current-scene + shared groups, selection that stays in Layers | Mixed unlabelled scene list, tiny hover-only actions, unsupported visibility promise |
| Scenes | Basic CRUD is real; management and state reconciliation are incomplete | New, rename, default scene and protected deletion | Thumbnails, duplicate, reorder, link-impact checks, explicit shared content, safe local/server reconciliation | “Multiple screens” wording; do not confuse interactive pages with physical screens or playlist timing |
| Properties | Powerful but sprawling, with at least one impossible instruction | Structured editors, field focus, precise geometry, existing alignment tools | Contextual inspector, content-first sections, batch common styles, valid-control capabilities | Permanent peer-tab status on desktop, raw/irrelevant settings, “rename in Layers” until implemented |
| Brand | Strong bulk operation, inconsistent smaller actions and reset promise | Per-template kit, logo insertion, one-step bulk undo | Preview scope, preserve overrides, real changed-widget count, undo per action, manual/approved-kit path | Silent changes on detection, misleading success for unsupported fields, false “revert” claim |
| Review | Currently a small layout checker, not screen-readiness assurance | Deterministic checks and undoable suggested changes | Correct scene/lock handling, content/source/target checks, explicit unchecked states, separate warnings/blockers | Broad green “Looks good,” indiscriminate thin-element resize, implication of AI/device certification |

## Confirmed findings and implementation tickets

Evidence labels: **R** = reproduced against real functions/components in this audit; **S** = directly traced in current source; **Risk** = suspicious path not reproduced end-to-end.

### T01 — Stop selection from kicking the user out of the tool they chose
Priority: P1. Evidence: S; related scene-selection behavior R.

[BuilderShell.tsx](/Users/gschiemann/Desktop/EDU CMS/apps/web/src/components/template-builder/BuilderShell.tsx:302) switches to Properties whenever a real-widget selection changes or its selection epoch advances. Layers and Review both use that same selection action. Thus selecting a row/issue is coupled to leaving its panel.

Implementation:
- Separate selection from opening the inspector: e.g. selection intent `canvas-edit | library-add | layer-select | review-locate`.
- Keep canvas click/re-click and first-widget fill opening the editor. Do not regress the recent empty-placeholder repair.
- Layers selection stays in Layers; Review's “Locate” stays in Review and highlights the relevant scene/widget.
- Preserve search/filter state and scroll position when returning to a library.
- On desktop, show an inspector alongside the current tool when room permits. On narrow screens, use a deliberate Edit action and Back path.

Accept: repeatedly select, reorder and multi-select three layers without reopening Layers. Locate issues in two scenes without losing Review. First widget remains immediately editable.

### T02 — Repair Review's false positives and false reassurance
Priority: P1. Evidence: R/S.

[suggestions.ts](/Users/gschiemann/Desktop/EDU CMS/apps/web/src/components/template-builder/suggestions.ts:64) receives all zones without scene context. Text in two different scenes triggers an overlap warning. Locked zones are skipped entirely, so a locked off-screen widget returns no issues. A deliberate 1%-high divider is offered a 6%-high resize. These three behaviors were reproduced.

[SuggestionsPanel.tsx](/Users/gschiemann/Desktop/EDU CMS/apps/web/src/components/template-builder/SuggestionsPanel.tsx:61) nevertheless says “Looks good” and promises to flag anything off-screen or hard to use.

Implementation:
- Immediately rename the clean state to “No layout issues detected by these checks.” List what was checked and what was not.
- Evaluate each scene together with its shared zones. Never compare two mutually exclusive scenes; deduplicate repeated shared-zone findings.
- Diagnose locked elements, but require explicit unlock before applying geometry changes.
- Add type-aware decorative exemptions and per-issue intentional-overlap acknowledgement, invalidated when relevant content changes.
- Read actual interaction capabilities, not just `zone.touchAction`; nested controls and widget-owned actions need their own evaluation.
- Account for rotation before claiming bounds are safe.
- Keep suggestions advisory until their correctness is established. Add hard publishing blockers only for validated unsafe/unrenderable configurations, not subjective layout taste.

Accept: separate-scene overlap passes; same-scene overlap warns; shared text is evaluated correctly; locked off-screen warns without auto-unlocking; decorative lines are not enlarged.

### T03 — Fix Layers rename, stacking and scene context
Priority: P1. Evidence: R/S.

[LayersPanel.tsx](/Users/gschiemann/Desktop/EDU CMS/apps/web/src/components/template-builder/LayersPanel.tsx:68) sorts every scene's zones together. There is no rename control in this panel, while [PropertiesPanel.tsx](/Users/gschiemann/Desktop/EDU CMS/apps/web/src/components/template-builder/PropertiesPanel.tsx:950) explicitly tells users to rename there.

[useBuilderStore.ts](/Users/gschiemann/Desktop/EDU CMS/apps/web/src/components/template-builder/useBuilderStore.ts:933) implements Bring forward as `zIndex + 1`. Bringing index 1 forward against index 2 produces two index-2 layers, not a reliable adjacent swap. Selecting an off-scene zone does not switch the active scene.

Implementation:
- Show current-scene layers and a distinct Shared group. Offer an explicit All scenes view, grouped by scene.
- Add inline rename: Enter commits, Escape cancels, blank rejected, one undo step.
- Reorder against the actual neighboring stack entry; define a stable tie-breaker and normalize indexes when required.
- Preserve shared/local compositing order when reordering. Never silently reorder another scene's local content.
- Add eye visibility only with a defined persistence/rendering contract: distinguish editor-only hide from “exclude from playback.”
- Use visible or accessible overflow actions rather than tiny hover-only buttons. Reflect existing groups rather than introducing a competing group model.

Accept: forward/backward/top/bottom each changes actual rendered overlap; save/reload preserves it. Renaming persists. Off-scene selection is either unavailable in current-scene view or explicitly navigates to that scene.

### T04 — Reconcile Scenes without losing local edits or shared context
Priority: P1. Evidence: R/S; production deletion consequence not exercised.

[setScenes](/Users/gschiemann/Desktop/EDU CMS/apps/web/src/components/template-builder/useBuilderStore.ts:559) converts an explicitly selected Shared view (`null`) to the default scene on refresh. It also leaves local zones pointing at a deleted scene. Both are reproduced.

The [delete API](/Users/gschiemann/Desktop/EDU CMS/apps/api/src/templates/templates.controller.ts:1093) reassigns saved zones to the default scene, but [scene hooks](/Users/gschiemann/Desktop/EDU CMS/apps/web/src/hooks/use-api.ts:2382) only invalidate queries. Builder initialization intentionally ignores same-template refetches to protect unsaved work. Simply calling `init()` on refresh would reintroduce a previous data-loss bug.

Implementation:
- Preserve explicit Shared selection across ordinary refreshes.
- On successful deletion, reconcile the affected local zone assignments and selected IDs without replacing unrelated unsaved content.
- Include locally added, unsaved zones in the deletion decision. Define what happens to dirty scene content before server mutation.
- Check and repair/confirm inbound Go-to-scene actions.
- Add duplicate (new IDs + internal-link remapping), reorder, thumbnail, and clear default/Shared labels.
- State which operations save immediately and what Undo can reverse; avoid pretending server scene CRUD is local draft history.
- Explain scenes as views/pages within a template. Timed playlist rotation is a separate concept.

Accept: delete a nondefault scene containing saved and unsaved widgets; nothing vanishes locally, no orphan IDs remain, shared widgets remain shared, links are handled, unrelated draft edits survive, reload agrees with the editor.

### T05 — Make every Brand action truthful and undoable
Priority: P1. Evidence: R/S.

A mounted Brand swatch click changed the selected widget's color but created no history entry; Undo could not restore it. [Color/font handlers](/Users/gschiemann/Desktop/EDU CMS/apps/web/src/components/template-builder/BrandKitPanel.tsx:468) call `updateZone` without a committed gesture. Bulk apply already has correct transaction coverage; preserve that.

The [clear confirmation](/Users/gschiemann/Desktop/EDU CMS/apps/web/src/components/template-builder/BrandKitPanel.tsx:434) promises to revert to system defaults, but the [endpoint](/Users/gschiemann/Desktop/EDU CMS/apps/api/src/branding/branding.controller.ts:558) clears only `brandKit`; applied widget colors/fonts/background values remain.

Implementation:
- Commit each discrete swatch/font/logo replacement as one undo step.
- Replace Shift+click-only targeting with explicit Text / Background / Accent options based on supported widget capabilities.
- Report actual supported fields/widgets changed; no success toast when a widget ignores that field.
- Change Clear copy to “Remove brand kit; keep applied appearance,” or implement a genuine snapshot-backed restore as a separate action.
- Separate Detect from Apply with a lightweight preview. Offer colors/fonts/logo/background scope and preserve custom image backgrounds by default.
- Reuse approved kits/manual logo-palette-font input rather than making website scraping the only acquisition path.
- Keep template branding separate from the global dashboard theme.

Additional reliability issue: this endpoint swallows AuditLog failure with `.catch(() => {})`. Do not report a fully audited privileged change when its log failed. Use an atomic mutation+audit transaction or an approved durable failure-handling mechanism.

Accept: swatch, font, logo replacement and bulk apply each undo independently; Clear matches its description; unsupported styles never report success; injected audit failure does not silently produce an unaudited successful operation.

### T06 — Repair backgrounds and make image composition practical
Priority: P1 for pattern defect; P2 for new controls. Evidence: R/S.

[BackgroundPanel.tsx](/Users/gschiemann/Desktop/EDU CMS/apps/web/src/components/template-builder/BackgroundPanel.tsx:75) stores already escaped SVG colors such as `%23cbd5e1`, then encodes the SVG again. Clicking Dots produces an SVG whose once-decoded fill is still `%23cbd5e1`, not a valid hex color. This was reproduced through the mounted control. Browser appearance of each pattern remains to be verified.

Implementation:
- Store raw SVG with literal `#` colors and URL-encode exactly once. Do not unescape hashes inside a data URL afterward.
- Retest all six pattern presets, including the same value through save → renderer → player.
- Add fit/fill, image focal point, and a controllable contrast overlay; show the actual crop in the preview.
- Make scope explicit: currently the panel edits template-level background metadata. Scene-specific overrides need an explicit model, not a misleading toggle.
- Keep raw CSS in Advanced, validate it against supported playback targets, and consolidate duplicate backdrop UI onto one reusable control.
- Remove unsupported comments/claims that every preset guarantees white-text readability. A gradient's appearance alone cannot establish readability of arbitrary overlaid content.

Accept: every pattern renders intended colors in editor and player; portrait/landscape crop is predictable; background edits and clear undo; incompatible target styles are warned about.

### T07 — Turn Properties into a contextual editor, not a miscellaneous settings dump
Priority: P2, with misleading controls repaired in P1. Evidence: S.

The current [PropertiesPanel.tsx](/Users/gschiemann/Desktop/EDU CMS/apps/web/src/components/template-builder/PropertiesPanel.tsx:900) is roughly 12,400 lines. Size alone is not a defect, but one large conditional editor makes capability drift easy. Multi-select currently exposes alignment and AI editing rather than a consistent common-style inspector.

Implementation:
- Inspector heading: selected widget's human name, scene, content/source state.
- Sections: Content, Design, Data (only when relevant), Interaction (when supported), Layout.
- No selection shows Canvas settings; multi-select shows only supported common values with an explicit Mixed state.
- Extract one editor/capability definition at a time; avoid a giant rewrite. Share field capabilities with Brand and Review.
- Correct Fit Height at [line 1087](/Users/gschiemann/Desktop/EDU CMS/apps/web/src/components/template-builder/PropertiesPanel.tsx:1087): its width uses old height × canvas aspect and ignores old width. If aspect preservation is intended, derive from the current zone's width/height; define cropping when the result exceeds the canvas. This is source-identified, not a visual reproduction.
- Preserve structured row editors, direct field targeting, keyboard input, data bindings and existing precision controls.

Accept: each visible control changes what its label promises, survives reload and undoes correctly. At least one representative widget per editor family is verified with actual typed content, not only component existence.

### T08 — Apps: better cards, fewer duplicate destinations, honest setup state
Priority: P2; unsafe/false source claims P1. Evidence: S plus existing source-validation tests rerun.

[AppCard](/Users/gschiemann/Desktop/EDU CMS/apps/web/src/components/apps/AppLibraryPanel.tsx:451) still gives most of the card to a gray icon area. [Google Sheets/Web Page copy](/Users/gschiemann/Desktop/EDU CMS/apps/web/src/components/apps/app-registry.ts:636) still suggests rosters and “any website.”

Implementation:
- One “Search apps or paste a link” input. Suggested/Connected/All views; compact categories in a filter control. Rank by industry and actual availability, not only friction tier.
- Cards: a real illustrative output thumbnail, provider identity, one-sentence outcome, setup status, and one clear action. Label demo data as sample.
- Action contract: “Set up” opens configuration; “Connect account” authorizes; “Choose source” selects a connected resource; “Preview” verifies available output; “Add to canvas” adds exactly one configured widget.
- Distinguish platform configuration missing, account disconnected, source not selected, preview failed, and unsupported target. Never treat “no login” as proof it works.
- Move native Clock/Countdown/QR discovery into Widgets while keeping saved app-backed content compatible. Do not delete renderer types or migrate existing templates just to simplify navigation.
- Keep Facebook/Instagram/Google Reviews implementation, but require configured-service and live-provider evidence before promoting them as ready. Google Reviews' current login-tier badge should say Admin setup where that is the real requirement.
- Social Wall is an external-provider workflow; state provider-account/moderation requirements.
- Replace “any website” with “supported embeddable pages.” Sites can block framing through their own policies; do not bypass those protections. [MDN frame-ancestors documentation](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/frame-ancestors).
- Remove student-roster suggestions from public spreadsheet onboarding. Offer clear public-display warnings and a reviewed, non-sensitive publishing workflow; do not imply teacher-uploaded data is safe merely because a teacher supplied it.

Accept: invalid source cannot Add; unavailable service gives a useful reason before setup; connected source survives save/reload; revoked access and offline playback have visible, non-sensitive fallbacks. Test with real authorized provider accounts separately.

### T09 — Widgets: qualify the flagship set rather than adding more noise
Priority: P2. Evidence: S and discovery tests.

[VariantPicker.tsx](/Users/gschiemann/Desktop/EDU CMS/apps/web/src/components/template-builder/VariantPicker.tsx:269) already has a curated default. Keep it.

Implementation:
- Recommended for your industry first; add Favorites and Recently used without expanding the initial catalog.
- Offer explicit “Browse other industries” for discovery where permitted. Tenant industry is a relevance preference, not automatically an authorization boundary; actual access restrictions must remain separate.
- Every promoted widget needs: accurate thumbnail, useful starter content, editable primary fields, supported styles, valid source state, tested sizing, save/reload/undo and target-device evidence.
- Use one insertion contract for library, Apps, quick layouts and AI-added content.
- Quarantine unqualified variants from the recommended shelf while preserving existing templates. Do not delete a widget solely because its editor or preview needs repair.
- Track add → edit → save → preview success to decide what deserves flagship placement. Collect behavior metrics without logging entered student/customer content.

Accept: known-industry defaults are relevant; unknown industry does not invent school-specific labels; no dead-end filters; recommended widgets are tested from tile click through meaningful edit and playback.

### T10 — Harden Save before treating Review as a release gate
Priority: P1 investigation/hardening. Evidence: S/Risk, not a reproduced production-loss incident.

[handleSave](/Users/gschiemann/Desktop/EDU CMS/apps/web/src/components/template-builder/BuilderShell.tsx:333) captures a store snapshot, writes metadata with a version guard, then replaces zones without a guard, then unconditionally marks the current state clean and clears the local draft. There is an inter-request concurrency window and a possible edit-during-save dirty-state race.

Implementation:
- Prefer one server transaction for metadata + zones with one version comparison and a returned revision.
- Independently track the client edit revision. Mark clean/clear the matching draft only if no newer local edits exist when the request completes.
- Keep newer edits dirty, disable duplicate in-flight saves or serialize them, and prevent publish from racing ahead of a complete saved revision.
- Test partial failure, two tabs saving between the two existing requests, edit during latency, interrupted network, and stale restore.
- Preserve draft recovery/conflict/version history. Do not “fix” this by resetting the whole store on every refetch.

The builder's Put-on-screen handoff does not call this Review engine. Do not label the current Review badge a publishing gate. This observation is limited to this builder path, not a claim that no downstream publishing validations exist.

## Recommended navigation and button design

Replace eight equally prominent peer tabs with task-oriented placement, retaining every useful capability:

| Placement | Controls | Behavior |
|---|---|---|
| Left content rail | Widgets, Apps, Background, Brand | Choose what to add or style; preserve browsing context |
| Canvas organization | Layers drawer; Scenes thumbnail strip/drawer | Organize existing content and navigate views |
| Contextual inspector | Properties | Edit selection without hiding the current organizing tool |
| Header | Save, Preview, Review & publish | Draft status, target preview, declared readiness checks and existing screen destination flow |

On narrow screens, use one drawer at a time with an explicit Back action. Do not force a three-column desktop layout onto a phone.

- Use readable labels and compact consistent icons; larger gray icon cards are not a redesign.
- Give each content card an actual preview. Reserve the primary accent for the active tool and main next action.
- Keep selected, hover, keyboard-focus, loading, error and unavailable states visually distinct.
- Make common touch actions comfortably sized (44px product target), with keyboard equivalents; no critical hover-only menus.
- If tabs remain, implement the complete keyboard and labeling pattern, not just `role="tab"`. Current rail lacks explicit tab/panel associations and arrow-key tab behavior. [W3C tabs pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/).
- Do not claim an accessibility conformance level from this source inspection.

## Build order and release acceptance

1. **Integrity pass:** T01–T06 defects, audit-log failure handling, T10 save investigation. Correct misleading copy immediately.
2. **Coherent editor pass:** contextual inspector, Layers/Scenes management, source-aware Apps cards, background composition. Migrate gradually behind a reversible rollout flag if your existing release process supports it.
3. **Flagship qualification pass:** promote only widgets and connectors with complete user-flow evidence. Add advanced Review checks only as their coverage is established.

For each change, require a focused regression test plus a rendered, authenticated user-flow test:
- Start blank → add → edit → style → arrange → create scene → Review → save → reload → preview → selected screen.
- Repeat with a previously saved multi-scene template, a locked element and a disconnected source.
- Verify desktop Chrome and Safari/WebKit, narrow viewport, keyboard-only use, and applicable physical playback targets.
- Keep Chromium-83 restrictions scoped to code actually delivered to those devices. Do not weaken emergency playback, tenant checks, provider sandboxing or URL safeguards to make a preview pass.
- Run relevant CI to completion when fixes are pushed. This audit made no push or deployment.

## Evidence and reproduction

[Machine-readable test results](/Users/gschiemann/Desktop/EDU CMS/docs/design/proposals/2026-09-13-template-areas-audit/evidence/test-results.json)
and [audit reproduction test source](/Users/gschiemann/Desktop/EDU CMS/docs/design/proposals/2026-09-13-template-areas-audit/evidence/template-areas-audit.test.tsx).

Eight suites passed: **105 existing regression tests + 9 audit reproductions = 114 tests**. The nine reproduction tests assert the current defective behavior on purpose. Their passing is evidence of the problem, not a release gate to retain unchanged after fixing it.

Existing suites: VariantPicker.discovery, m0-6-apply-layout-scenes, m0-7-zone-lock, a9-brand-apply-one-undo, canvas-frame-style, add-button-rejects-broken-sources, structured-row-editing. Existing discovery tests emitted React asynchronous `act(...)` warnings; this was not a clean browser-console run.

To rerun, create an isolated worktree at the baseline, provide its dependencies, and copy the preserved reproduction file into `apps/web/src/components/template-builder/__tests__/template-areas-audit.test.tsx`. From that worktree's web package run:

```sh
node node_modules/jest/bin/jest.js --runInBand --watchman=false --runTestsByPath \
  src/components/template-builder/__tests__/template-areas-audit.test.tsx \
  src/components/template-builder/__tests__/VariantPicker.discovery.test.tsx \
  src/components/template-builder/__tests__/m0-6-apply-layout-scenes.test.ts \
  src/components/template-builder/__tests__/m0-7-zone-lock.test.ts \
  src/components/template-builder/__tests__/a9-brand-apply-one-undo.test.tsx \
  src/components/template-builder/__tests__/canvas-frame-style.test.ts \
  src/components/apps/__tests__/add-button-rejects-broken-sources.test.tsx \
  src/components/template-builder/__tests__/structured-row-editing.test.tsx
```

Network hooks and heavyweight unrelated UI were mocked in the new mounted-control probes. Scene deletion was simulated at the local-store boundary; the actual API reassignment was read in source, not executed. No production account, real provider login, hardware, full security scan or every-widget visual sweep was tested in this run. Unrelated live workspace edits were preserved.

Workspace housekeeping: the isolated audit worktree remains at `/private/tmp/venueos-template-areas-audit-20260913`. Automatic review rejected its forced cleanup because that would delete untracked contents and requires explicit user approval. No workaround was attempted. The reproduction source is preserved byte-for-byte above; the summarized results preserve all 114 assertion names and outcomes. The original full Jest JSON also remains in that temporary worktree. No production files were changed by this audit.
