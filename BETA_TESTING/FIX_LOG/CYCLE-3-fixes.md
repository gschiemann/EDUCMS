# CYCLE-3 Fix Log

## editor-BUG-004 — 6 RETAIL widgets missing editor case

**Severity:** Medium (UX gap — retail pilot tenants forced into JSON-only
editing for the daily-driver widgets in the retail pack).

**Carry-over from cycle-2:**
editor-BUG-002 fixed 9 RESTAURANT_/BAR_ widgets but deferred the 6
RETAIL widgets that also fall through to the Advanced JSON default
in PropertiesPanel.tsx. This cycle-3 fix closes that gap. After this
batch, the only widgets in the retail/restaurant/bar packs still
falling through to JSON-only Advanced are BAR_TAP_LIST and
BAR_COCKTAIL_MENU (each have a minimal title+posSync case already;
not extended in this batch per task scope).

**Fixed (6):**
- RETAIL_LOOKBOOK_CAROUSEL — rotationMs, fadeMs, ink, accent, slides
  JSON array of `{ eyebrow, headline, subhead, price, imageUrl,
  swatchColor, emoji }`
- RETAIL_STOREFRONT_HOURS — eyebrow, headline, subhead, statusOverride
  (auto/open/closed select), bg/ink/accent colors, openHours JSON
  object keyed by sun-sat
- RETAIL_PRICE_CALLOUT — eyebrow, headline, subhead, salePrice,
  originalPrice, discountLabel override, image (AssetPickerField),
  emoji + swatchColor fallback, bg/ink/accent colors, sellingPoints
  JSON array (max 3)
- RETAIL_SALE_COUNTDOWN — eyebrow, headline, endsAt ISO timestamp,
  finishedMessage, fineprint, bg/ink/accent colors
- RETAIL_LOYALTY_QR — eyebrow, headline, subhead, ctaText,
  qrFootnote, qrImageUrl (AssetPickerField), bg/ink/accent colors,
  perks JSON array (max 3)
- RETAIL_WAYFINDING_MAP — heading, subheading, bg/ink/accent colors,
  youAreHere `{ x, y }` JSON, departments JSON array of `{ name, x,
  y, width, height, color, emoji, highlight }`

Each case reads the matching Widget.tsx Config interface
(`apps/web/src/components/widgets/retail/Retail*Widget.tsx`) and emits
the right primitive: TextField for strings/numbers, ColorPickerField
for hex color fields, SelectField for typed enums (statusOverride),
AssetPickerField for image URLs, TextAreaField with safe JSON parse
for array/object fields. Catch blocks follow the editor-BUG-003
pattern (no setField inside catch — preserve previous valid value
while user is mid-typing).

Inserted right after the existing `case 'RETAIL_PRODUCT_GRID':`
block (around line 2356) so all 7 retail-pack cases sit together.
Existing cases were not refactored.

**Files changed:**
- `apps/web/src/components/template-builder/PropertiesPanel.tsx:2357-2454` —
  six new RETAIL_* case blocks.

**TypeScript check:**
`cd apps/web && npx tsc --noEmit | grep -v test | grep error` —
zero new errors in production code. Pre-existing test-file errors
in `RoleGate.test.tsx` and `touch-widgets.test.tsx` (missing
@testing-library/react types) unchanged.

**Acceptance test:**
All 6 RETAIL widgets now have explicit editor cases that emit real
form controls instead of falling through to JSON-only Advanced mode.
Open the template builder, drop a RETAIL_LOOKBOOK_CAROUSEL /
RETAIL_STOREFRONT_HOURS / RETAIL_PRICE_CALLOUT / RETAIL_SALE_COUNTDOWN
/ RETAIL_LOYALTY_QR / RETAIL_WAYFINDING_MAP zone, click it — the
Properties panel shows labeled TextField / SelectField / ColorPicker
/ AssetPicker / TextAreaField controls bound to the real Config
interface fields. Mid-typing in JSON textareas does not crash the
renderer (safe-parse pattern preserves the last valid array/object
on parse failure).
