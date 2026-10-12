# Photo frame and collage elements

This branch adds static photo compositions that show one framed image or several collage images at once. There are no intervals, rotations, external image catalogs, or remote dependencies. Empty sources use an inline vector placeholder; an image load failure replaces the failed image with a labeled placeholder.

## Renderer contract

`apps/web/src/components/widgets/PhotoDesignWidgets.tsx` exports `PhotoFrameWidget`, `PhotoFrameCircleWidget`, `PhotoFrameArchWidget`, and `PhotoCollageWidget` with the existing `ThemeWidgetProps` contract. The circle and arch exports are optional direct renderers; the lead can register the same frame renderer with `frameShape` defaults or use the dedicated exports.

Frame config accepts `assetUrl` or `imageUrl`, `fit`/`fitMode`, `caption`, `frameShape`, `borderRadius`, `borderWidth`, `borderColor`, `opacity` (0–100), `focalX`/`focalY` (0–100), and `zoom` (1–3). `fit` values are `cover` and `contain`.

Collage config accepts `photos: [{url, caption, focalX, focalY, zoom, fit}]`, `layout` (`pair`, `featured`, or `grid`), `spacing`, `backgroundColor`, `showCaptions`, `captionFont`, and `captionColor`. Legacy `urls` is promoted in order, including when saved photos and legacy URLs coexist. All entries render and remain editable if a saved list exceeds four; four is the add limit for new collages, not a display limit.

## Editor integration contract

`PhotoDesignFields` accepts `config`, `onChange(patch)`, optional `mode` (`frame` or `collage`), optional `frameShape`, and two injected render callbacks:

- `renderAssetPicker({label, value, onChange, photoIndex?})` for the existing asset library control.
- `renderFontPicker({label, value, onChange})` for the existing shared font picker.

Both callbacks return a React node. The lead can pass the existing `AssetPickerField`/asset-library and `FontFamilyField` renderers without this component importing private PropertiesPanel implementations. The picker callback is provided for every image, so each collage item can be replaced independently. When a collage already contains more than four saved photos, the full list stays visible, can be edited/reordered/removed, and new-photo additions are disabled with a capacity message.

Suggested registration defaults for the six palette variants:

| Variant | Canonical type | Defaults |
|---|---|---|
| `photo-frame-rounded` | `IMAGE` | `frameShape: "rounded"` |
| `photo-frame-circle` | `IMAGE` | `frameShape: "circle"` |
| `photo-frame-arch` | `IMAGE` | `frameShape: "arch"` |
| `photo-collage-pair` | `IMAGE_CAROUSEL` | `layout: "pair"`, two empty photo objects |
| `photo-collage-featured` | `IMAGE_CAROUSEL` | `layout: "featured"`, three empty photo objects |
| `photo-collage-grid` | `IMAGE_CAROUSEL` | `layout: "grid"`, four empty photo objects |

The editor can pass `mode="frame"` or `mode="collage"`; empty collage defaults otherwise look like frame configs to inference. Registering the image toolbar behavior and wiring these controls in `PropertiesPanel.tsx` remain with the lead.

## Verification

`photo-design-widgets.test.tsx` covers source/caption/focal controls and reset, simultaneous photo counts, layout changes retaining sources, legacy URLs, five-photo overflow visibility/editability, the empty vector placeholder, and injected library/font callbacks.
