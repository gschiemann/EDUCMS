# Template editor media usability — handoff for Claude

Date: 2026-10-10. Implementation branch: `codex/template-editor-usability`.

The editor now puts Image, Video and Text first, inserts selected media into a frame that matches its proportions, and exposes replacement, fit and rotation directly in the bottom toolbar. The shared controls apply to blank canvases, media added over standard presets, and editable media slots in packaged HTML templates. This addresses the reported discovery, invisible-frame and buried-rotation problems. It is a focused usability repair, not a claim that every template-making workflow has received a complete Canva redesign.

## Operator-visible changes

1. **Common tools come first.** Image, Video and Text are always visible above widget search. The curated list starts with Image, Video, Text, Image Carousel, Video Carousel, Logo and Shape in every industry. “Photos & video” is the first full-library category, and its plain Image and Video appear before styled variants. The everyday list appears before Restyle; quick layouts moved below the widget categories. Search understands “images,” “pictures,” “videos,” “logos,” “shapes” and “slideshows.” All previous variants remain available. Generic Image and Video labels no longer inherit unrelated industry variant names.
2. **Choose the file before creating the element.** Image and Video open the media picker immediately. Cancel leaves the design unchanged. Choosing a file creates the actual media element in one undo step and replaces a sole unlocked empty starter placeholder. Quick Text also removes that placeholder and undoes in one step. Users can upload from their computer or search the existing library.
3. **Tight media frames.** Placement reads image dimensions or video metadata. Small files retain their original pixel size; larger files scale down proportionally to fit within 75% of the canvas, leaving room to edit. Portrait, landscape, square, logo and thin-banner proportions are retained. Several inserted files receive a small stagger so they can be selected individually.
4. **Visible rotation.** The bottom toolbar has a labelled angle input and left/right 90-degree buttons. Freely placed zones also have a rotation handle on the selection outline. Dragging supports cardinal-angle snapping; Shift gives 15-degree increments. The handle supports arrow keys and Home. Locked elements disable these controls.
5. **Understandable fit choices.** The toolbar offers “Show whole image/video” and “Fill frame (crop).” “Fit frame” removes excess space from existing standalone media frames while preserving their center. Replacing an existing file preserves its frame, styling and rotation. Sidebar and toolbar fit settings agree.
6. **Better file-drop behavior.** Dropping several files onto the canvas, including over an existing picture, adds separate images instead of repeatedly replacing one. A single-file replacement still preserves the existing layout. Metadata loads are bounded and stale asynchronous completions are guarded.
7. **Accessible picker and toolbar.** The picker has a labelled dialog, Escape close, keyboard focus trapping and focus restoration, filename labels and search. Canvas shortcuts are blocked while the picker is active. The toolbar wraps to remain reachable in portrait editing.
8. **Clearer starter guidance.** The blank canvas now says “Add an image, video, or text to get started,” replacing an existing garbled arrow. Empty and video selections no longer show the unrelated instruction to click text for styling.

## Included templates

React presets use the same insertion and standalone media controls as a blank canvas. Adding an image does not replace the existing preset background or content.

All **282 packaged HTML boards** under `public/templates/{custom,fitness,hs,kiosk,school,signage}` carry an additive `EDUCMS-MEDIA-CONTROLS-V1` companion. It advertises editable image/video slots, selects them when clicked and connects them to the same Replace / Fit / Rotate controls. Boards with no editable media advertise an empty capability list. Source-owned fitness feeds retain their existing runtime-owned behavior.

Embedded media keeps the template's authored frame. These fields have replacement, fit, rotation and deletion; they do not become independent movable/resizable zones, and do not expose the standalone “Fit frame” gesture. Media added on top of an included template remains an independent zone with the full gesture controls. This preserves the built-in composition while making the common actions consistent.

Replacement preserves other images in an existing gallery, other fields, text and board geometry. Replacing a deleted embedded image makes it visible again while retaining its fit and rotation. Delete targets the selected image rather than the entire board. An embedded image selection cannot accidentally nudge or duplicate the entire template through the ordinary zone shortcuts. Saved fit, rotation and source overrides are reapplied when a kiosk creates a new screen's DOM.

Media changes use postMessage with a stable iframe URL, so replacing or rotating a photo does not send a kiosk back to its first screen. Initial loads still encode the current media maps in the URL. Removing overrides through Undo restores authored media sources and styles.

The original HTML and existing V14, menu/POS, kiosk and native-carousel shims were preserved **byte for byte across all 282 boards** when the single added script was removed for comparison. No existing shim was replaced. The iframe sandbox remains `allow-scripts` without `allow-same-origin`. The companion compiles for Chromium 83 and Safari 12 and adds no `inset` styling.

Holiday boards and arbitrary inline AI-generated HTML retain their separate internal editing bridges. The new standalone Image/Video insertion works over their canvases; this change does not claim to rebuild every internal media editor in those architectures.

## Implementation map

| Area | Files |
| --- | --- |
| Discovery and mounted toolbar | `VariantPicker.tsx`, `widget-catalog.ts`, `constants.ts`, **`BuilderShell.tsx`** |
| File picking, sizing and source assignment | New `MediaInsertPicker.tsx`, `media-sizing.ts`, `media-source.ts`; `PropertiesPanel.tsx`, `BuilderZone.tsx` |
| Shared fit/rotation controls | New `SelectionControls.tsx`; `SelectionChrome.tsx`, `BuilderCanvas.tsx`, `zone-geometry.ts` |
| Store, placement, undo and selection | `useBuilderStore.ts`, `types.ts` |
| Embedded board media | New `board-media.ts`; `ExternalBoardFieldBridge.tsx` |
| Packaged companion and generation | New `apps/web/scripts/board-media-controls.ts`, `inject-media-controls.cjs`; all 282 board HTML files |
| Approved AI reference freshness | Regenerated `apps/api/src/ai/designer-exemplars.generated.ts` with the existing `build-designer-exemplars.cjs` |
| Initial media and live updates | `apps/web/src/components/widgets/WidgetRenderer.tsx` — `ExternalHtmlWidget` |
| Gallery freshness | `src/lib/template-poster.ts`, `_thumbs/poster-manifest.json`, freshly captured posters |
| Guards and documentation | `tools/check-board-editability.cjs`, `CLAUDE.md`, this report |

Paths in the first five rows are under `apps/web/src/components/template-builder/`. **The mounted bottom bar is inside `BuilderShell.tsx`; `BottomToolbar.tsx` is not mounted and was left alone.** Render-tree reachability was verified from the actual Next entrypoints.

Persisted configuration:

- Standalone rotation: `defaultConfig._zoneRotation`.
- Standalone source metadata: `_mediaWidth` / `_mediaHeight`; `fit` and `fitMode` are synchronized.
- Embedded styles: `defaultConfig.mediaStyles[fieldKey] = { fit, rotation, hidden }`.
- Embedded sources: existing `imageOverrides` / `videoOverrides` maps.
- `activeMediaField` is transient selection state, cleared on scene/template/selection changes.

No schema migration, API contract change or real database operation was required. Emergency, authentication, tenant isolation and audit-log paths were not modified.

## Verification

The real Next editor and actual board HTML were rendered in Chromium and WebKit. API/auth/upload/save responses were mocked; real PNG and MP4 fixtures supplied image and video metadata. This proves the browser behavior and serialized save/reopen contract, not production storage or a live database round trip.

| Check | Result |
| --- | --- |
| Builder Jest suites plus affected HTML renderer and poster suites | **76 suites / 705 tests passed** |
| Approved AI reference freshness, sanitization and selection suite | **133 tests passed** after reference regeneration |
| Media editing and existing palette click/keyboard/drag browser tests | **28 tests passed** across Chromium and WebKit |
| Discovered 282-board media compatibility sweep | **564 tests passed** across both engines |
| Existing board click-to-edit and family-coverage tests | **106 tests passed** across both engines |
| Web TypeScript, `tsc --noEmit --incremental false` | Passed |
| Full `pnpm preflight` on latest local master plus this change | Passed: frozen lockfile, workspace packages, API build and production web build |
| ESLint on new source/test files | Passed |
| Added lines in modified legacy components | No new lint findings; existing file-wide lint errors/warnings remain |
| Board editability guard | Passed, all 282 boards |
| Inset serialization guard | Passed, no confirmed landmines; existing conservative review flags remain |
| Companion regeneration repeated unchanged | Idempotent: updated 0 boards |
| Original board markup and shim comparison | 282/282 identical after removing companion |
| Poster freshness guard against integration base `47f9b8ff` | Passed for all 282 changed boards |
| `git diff --check` | Passed |

The browser flows cover picker cancellation, three image proportions, video metadata, direct upload, multi-file drop, legacy-frame repair, toolbar/sidebar agreement, replacement without layout changes, deletion and replacement of embedded pictures, rotation drag and keyboard input, resize proportions, lock behavior, Undo/Redo, serialized saves and actual rendered images after reopening. Representative built-in editor flows use school news, a QSR drive-through board, a school kiosk directory and a custom homebuilder board. A standard React welcome preset is also covered. The full-corpus test checks load and fit/rotation on advertised slots; it does not replace the representative save/reopen tests with 282 separate application-editor runs.

Visual review of the captured editor screenshots caught a kiosk source that was saved correctly but disappeared after its screen DOM was recreated. The companion now reapplies sources to new media nodes, and the regression test verifies the actual image after reopening. It avoids resetting existing carousel slides on unrelated DOM updates.

The existing hot-zone test's event observer was moved from document capture to window capture so it can observe the actual click before the new media selection handler stops propagation. Media key expectations follow the slot key. The corpus test ignores the fitness source runtime's separate `educms-media-ready` notification without a slot payload. These changes retain actual rendered click assertions.

## Reproduction and maintenance

```bash
# Against a running isolated Next server with the mocked API base:
E2E_BASE=http://localhost:3119 pnpm --filter web exec playwright test \
  -c playwright.sandbox.config.ts \
  tests/e2e/builder-media-editing.spec.ts \
  tests/e2e/builder-tile-click-adds-widget.spec.ts --workers=1

# Against a static server serving apps/web/public:
E2E_BASE=http://127.0.0.1:3121 pnpm --filter web exec playwright test \
  -c playwright.sandbox.config.ts \
  tests/e2e/board-media-compatibility.spec.ts \
  tests/e2e/external-html-clickedit.spec.ts --workers=4

pnpm --filter web exec jest --runInBand \
  src/components/template-builder/__tests__ \
  src/components/widgets/__tests__/external-html-pos-bindings.test.tsx \
  src/components/widgets/__tests__/external-html-text-style-sender.test.tsx \
  src/lib/__tests__/template-poster.test.ts

node apps/web/scripts/inject-media-controls.cjs
node apps/web/tools/check-board-editability.cjs
node apps/web/tools/check-inset-serialization.cjs
node apps/web/tools/check-poster-freshness.cjs
node apps/api/scripts/build-designer-exemplars.cjs
node apps/api/scripts/build-designer-exemplars.cjs --check
pnpm preflight
```

Never hand-edit the baked companion. Change its TypeScript source and rerun the injector. Regenerate posters from the final HTML, record their real capture provenance and bump `POSTER_VERSION`; do not merely rehash the manifest. Poster capture preserves the existing generator's 800×450 workflow and fitness `freeze=1` preview rule. Customized media/video templates use a live preview rather than the pristine packaged poster.

All 282 posters were captured again from the final HTML. The manifest records the captured HTML hashes; 163 PNG files changed and the other captures were byte-identical. `POSTER_VERSION` is now `20261010a`. The capture log and generator used for this run are preserved with the Desktop handoff evidence.

The first production push exposed an additional freshness dependency in CI: the API's approved AI exemplar catalog hashes the complete source HTML, including editing shims. Regenerating its 11 references changed only `sourceSha256` and `strippedRuntimes`; every HTML payload remained identical. The correction preserves the existing freshness gate. `CLAUDE.md` now requires this regeneration and `--check` after board changes, including shim-only changes. The final release status and CI results are recorded in the Desktop handoff's `STATUS.md`.

## Delivery limits and next step

This report distinguishes local implementation from production release. The accompanying handoff status records the final commit and local integration. The implementation was rebased onto local master `47f9b8ff` and passed the full local preflight. No production push, CI run or deployment is claimed here. A release still requires post-push CI watch, deployed editor verification, and the applicable physical-player qualification before a fleet-ready claim. Browser rendering is not evidence of physical Taurus or Android playback.

Further usability work can build on these shared controls, especially internal holiday/AI-board media, richer cropping and independent positioning of embedded board elements. Those are separate product changes; the reported basic media workflow is implemented and browser-verified.
