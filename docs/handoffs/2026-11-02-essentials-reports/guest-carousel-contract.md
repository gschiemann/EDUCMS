# Guest Essentials carousel and editability contract

Read-only audit of `/Users/gschiemann/.codex/worktrees/hospitality-guest-essentials/EDU CMS`.

## Recommended smallest pattern

Use one existing `data-imgslot="hero.image"` (or similarly stable semantic key) as the framed hero, and supply its authored fallback through `data-img="/templates/.../fallback.jpg"`. Keep the slot itself visible and poster-like when no carousel list exists. Add hidden controls inside `<div data-controls hidden>`:

```html
<span data-field="carousel.autoplay">yes</span>
<span data-field="carousel.transition">fade</span>
<p data-field="carousel.intervalSeconds">7</p>
<p data-field="media.hero.image.fit">cover</p>
<p data-field="media.hero.image.position">center</p>
<p data-field="media.hero.image.alt">Guest arrival</p>
<p data-field="media.hero.image.mode">carousel</p>
<p data-field="media.hero.image.slides">["/templates/.../hero-a.jpg", "/templates/.../hero-b.jpg"]</p>
```

The native carousel adapter observes these controls and renders only when the parsed slides array is nonempty. Therefore, the adapter alone does **not** guarantee a fixed-image fallback for an empty list: its empty-list path removes the carousel host, clears the inline background and `has-img`. Preserve authored fallback by either keeping the fixed `data-img` painter active when no slides are supplied, or using the shim's single-image behavior as fallback and only enabling the adapter when a nonempty list / carousel mode is active. The homebuilder reference currently lacks a correct empty-list fallback in its adapter path; treat it as evidence for control names and wiring, not as a fully correct fallback implementation.

`FLAGSHIP-TEMPLATE-STANDARDS.md` §1–3 requires every photo and every copy item to be editable (`data-imgslot`, `data-field`), every color/font/scale token exposed in hidden `[data-widget="theme"]`, and uploaded media represented via `data-img`. For these 3 templates, keep each authored fallback fixed per template and use an optional carousel list as an override. Every editable text node should have `data-field` and `data-fit` with `data-fit-min` at least 50; normal body/support copy should be sized to 60px/50px minimum on the 3840 stage.

## Evidence and exact locations

- `docs/design/FLAGSHIP-TEMPLATE-STANDARDS.md` §§1–3: universal slot/field/theme requirements and `data-img` image contract.
- `apps/web/public/templates/CLAUDE.md` section “EXTERNAL_HTML boards + click-to-edit shim”: EXTERNAL_HTML runs in a null-origin sandboxed iframe; shim handles inbound overrides plus outbound click messages. It also gives the freshness requirements and validation commands.
- `apps/web/public/templates/signage/corporate/homebuilder/portrait/02-welcome-editorial.html:254`: canonical hidden `data-widget="theme"`, hidden media/carousel controls, and `data-imgslot="hero.image"` with authored fallback at line 257. Its controls use the exact `media.<slot>.slides`, `.mode`, `.fit`, `.position`, `.alt`, `carousel.autoplay`, `.transition`, and `.intervalSeconds` field names.
- Same file, lines 263–268: tokens copied into CSS vars; image slots painted from `data-img`; autofit recalculates after edits and `document.fonts.ready`.
- Same file, lines 2770 onward (minified generated companion): adapter reads `.slides`, defaults interval to 7s, honors fit/position/alt/mode and global autoplay/transition, updates on `educms-overrides`, hidden-controls mutation, stage `data-img` changes, fonts ready. In particular, empty slides removes host and clears background; document this fallback gap to implementation.
- `apps/web/src/components/template-builder/__tests__/image-carousel.test.tsx:19–22,42–82`: builder contract accepts `data-imgslot`; empty slot has no list controls; one image serializes as scalar, 2+ as list; QR carousel is suppressed. This is the specific UI data-model coverage.
- `apps/web/scripts/inject-shim-v2.cjs:45–66,227 onward,261,269–270,378–382`: target directory scoping, V16 marker, `educms-overrides` handler; text updates resolve exact `data-field`, image updates resolve exact `data-imgslot`; click handler posts `{type:'educms-field-click',key,kind}`.
- `apps/web/scripts/inject-media-controls.cjs:1–9,26–42`: companion is additive and preserves existing carousel/click shims. Unlike the shim injector, its optional arguments are *individual HTML paths relative to `apps/web/public`*, not a directory.
- `apps/web/tests/e2e/builder-media-editing.spec.ts:279–327`: existing full editor persistence hook for built-in media: open board with `imageOverrides`, click slot and replace/fit/rotate, save, inspect saved `defaultConfig`, reload, and assert source/fit/rotation survive. It includes hospitality-adjacent board cases, and is a reusable test pattern, but is not text/theme-specific.
- `apps/web/public/templates/signage/hospitality/01-lobby-welcome-flagship.html:647–651`: existing hospitality fixed poster pattern: `data-imgslot`, authored `data-img` URL, accessible label, placeholder child.

## PostMessage/editability round-trip checks

Use a real EXTERNAL_HTML builder iframe (null-origin means parent cannot inspect board DOM directly except through the test's Playwright frame). Existing shim protocol is:

1. iframe emits `educms-ready` at load (`inject-shim-v2.cjs` around line 375); editor sends `educms-overrides` with `text`, `textStyles`, `img`, and theme/brand values.
2. Verify text by sending `{type:'educms-overrides',text:{'welcome.title':'Round trip'}}`; assert `[data-field="welcome.title"]` text changes. Theme fields follow the same `text` map; assert computed CSS variable changes for e.g. `theme.accent`.
3. Verify media by sending `{type:'educms-overrides',img:{'hero.image':'/test-a.jpg'}}`; assert slot `data-img` becomes `/test-a.jpg` and image/background updates. For carousel, send list-valued image override and assert `media.hero.image.slides` becomes JSON list and adapter changes `data-carousel-index` after interval / freezes for `?freeze` or autoplay `no`.
4. Enable `{type:'educms-edit-mode',on:true}`, click text and image slots; assert iframe emits `educms-field-click` with keys and kinds `text` / `img`. Existing `apps/web/public/templates/CLAUDE.md` names `apps/web/tests/e2e/external-html-clickedit.spec.ts` as the browser click-edit regression test.
5. Save in editor and reload as in `builder-media-editing.spec.ts:312–324`; assert persisted `defaultConfig.imageOverrides`, text and theme values, then rendered values after reload. The direct editor tests do not presently establish a complete text+theme roundtrip for these particular Guest Essentials pages, so add that coverage if implementation scope permits.

## Exact injection commands after authoring

From repo root, after modifying any files under `apps/web/public/templates/signage/hospitality/`:

```bash
node apps/web/scripts/inject-shim-v2.cjs signage/hospitality
```

That optional argument is relative to `apps/web/public/templates` (see shim script lines 50–62). Then inject the media companion into each changed HTML file; it accepts explicit file paths relative to `apps/web/public`:

```bash
node apps/web/scripts/inject-media-controls.cjs \
  templates/signage/hospitality/<template-1>.html \
  templates/signage/hospitality/<template-2>.html \
  templates/signage/hospitality/<template-3>.html
```

Then apply the template rulebook's gates: `node apps/web/tools/check-board-editability.cjs`; run `pnpm --filter web exec playwright test tests/e2e/external-html-clickedit.spec.ts` and the relevant builder media editing test. For shipping artifacts, the template rulebook also says rebuild designer exemplars and refresh affected posters/provenance; the parent implementation should account for those if the repository's release path requires them.

## Follow-up review: Guest Essentials implementation

Reviewed all 12 files under `apps/web/public/templates/signage/essentials/{hospitality,corporate,gym,healthcare}/` plus `apps/web/scripts/essentials-runtime.js`. No duplicate actual `data-field` keys or missing image-slot fallbacks were found in the 12 boards; the apparent `carousel.intervalSeconds` duplicates from grep are one JS attribute-selector string plus the actual control field. All boards have baked `EDUCMS-SHIM-V16` and `EDUCMS-MEDIA-CONTROLS-V2`; every hero and logo slot has an authored `data-img` (logo empty by design, initials fallback).

### Concrete runtime issue

`essentials-runtime.js:5–9` computes `portrait`, stage width and height once at load. Its `size()` at line 48 only updates `--stage-scale`; the resize handler at line 74 calls that function without recomputing orientation. With no forced `?o=` / `?orientation=`, the board will keep its initial orientation after the iframe viewport changes aspect ratio (e.g. rotate or resize). This breaks the standards' single-file portrait/landscape auto-detect path. If orientation is always explicitly fixed in production config, impact is limited to preview/rotation cases; otherwise move auto-detection and stage dimensions into the resize function while honoring an explicit query override.

### Fixed-photo fallback detail

The authored hero poster exists (`data-imgslot="hero.photo"` plus its `data-img` in the markup, e.g. `hospitality/easy-days.html:180–185`) and initial controls seed `media.hero.photo.slides` with that URL. The adapter from `apps/web/public/templates/_native-image-carousel.js` reads `media.<slot>.slides`; its no-slides branch unmounts/removes the carousel host, sets the slot background to `none`, and removes `has-img` (bundled file is minified on line 1). So explicit removal of every carousel slide produces the empty `.placeholder` frame, rather than restoring the authored poster. This is an edge case to decide against the intended “fixed poster fallback”; if deleting the last carousel photo should restore the fixed poster, make the adapter use authored `data-img` when `slides` is empty. If deletion is meant to clear the photo entirely, this is expected behavior.

### Existing builder text-edit test pattern

Best nearby E2E pattern is `apps/web/tests/e2e/builder-media-editing.spec.ts:675–718` (directory EXTERNAL_HTML board): construct `openEditor(...)` with a board config at lines 683–684; acquire `page.locator('[data-zone-id="directory"] iframe').contentFrame()`; click a visible field at line 687; assert the editor's text area and selected-field title; assert board element `contenteditable=true`; `fill(...)` then `press('Enter')`; assert iframe text and Properties panel value; click Save; assert `state.saved().zones[0].defaultConfig` contains new text and `_styles`; `reloadEditor(page)`; reacquire iframe and assert text and style persisted. This is the exact pattern to reuse for Guest Essentials text, replacing the selector/key with a known field such as `hero.title` and checking the persisted `defaultConfig.textOverrides` / equivalent field map used by this editor. For a theme roundtrip, use the visible theme Properties control and assert the corresponding `theme.*` field / computed CSS variable before and after Save+reload; current test around 675–718 does not cover theme tokens.
