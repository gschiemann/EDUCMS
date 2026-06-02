# POS field-naming → template mapping + operator override (2026-06-02)

Read-only Explore-agent investigation. Goal assessed: *"Operator picks a POS
integration at the top level; our system maps the POS's native field names
onto our template/menu-widget fields with sensible defaults; the operator can
then manually override any field where our default isn't what they want —
self-serve."*

## Verdict table

| Capability | Status | Notes |
|---|---|---|
| (a) Auto-capture POS catalog | **WORKS** | All 4 providers sync → `PosMenuItem` + `PosCategory` |
| (b) Default field mapping to widget | **WORKS** | name/desc/price/category/image/allergens/tags rendered |
| (c) Operator override individual fields self-serve | **PARTIAL — price/86 only** | ✓ price per-location ✓ 86/availability ✗ name ✗ description ✗ image ✗ allergens-per-location |
| (d) Override survives re-sync | **WORKS** | `MenuLocationOverride` untouched by re-sync; `override ?? default` at render |
| (e) Choose category/catalog subset | **PARTIAL** | ✓ category filter ✓ `catalogId` binding ✗ no daypart UI ✗ no per-screen hide-category |
| (f) Rich POS fields captured | **POOR** | ✗ modifiers ✗ SKU ✗ tax-inclusive (Lightspeed reads, doesn't store) ✗ station ✗ dietary (manual only) ✗ multiple images ✗ variations |
| (g) Sensible field-name defaults | **WORKS** | clear intent across providers |

## 1. Fields captured by each connector

`NormalizedItem` (exported `apps/api/src/pos/providers/square.ts:157-178`):
`externalId, name, description?, priceCents, categoryExternalId?, imageUrl?,
available, externalUpdatedAt?, category?`. `NormalizedCategory`:
`externalId, name, sortOrder`.

Dropped on the floor by all/most providers: **modifiers/options, SKU,
tax/tax-class, station/prep-area, dietary/allergens, nutritional, multiple
images, variations/sizes, per-location price.**

- **Square** (`square.ts:157-277`): variations exploded into separate items
  (no modifier structure); no-variation items surface `priceCents: 0`
  (`:232-239`); SKU only as composite `${itemId}:${variationId}`.
- **Clover** (`clover.ts:154-251`): single `price` in cents (`:228`); category
  `sortOrder` captured (`:195`), item sort not; no modifiers/SKU/tax.
- **Shopify** (`shopify.ts:184-341`): `product_type` → free-text category, no
  stable id; sortOrder = insertion order (`:269-281`); variant title appended
  to product name; `dollarsToCents(v.price)` (`:320`), no tax; REST = global,
  no store locations.
- **Lightspeed** (`lightspeed.ts:227-360`): ONLY provider that reads both
  `price_including_tax` + `price_excluding_tax` (`:316`, uses tax-inclusive);
  `image_thumbnail_url` only (`:331`); no SKU/modifiers stored.

## 2. Where fields land (schema.prisma)

- **`PosMenuItem`** (`:1652-1677`): id, tenantId, connectionId, externalId,
  name, description?, `priceCents`, `salePriceCents?` (**exists, never
  populated**), category, imageUrl?, `badges[]` (**exists, never populated**),
  available, `locationId?`, externalUpdatedAt, syncedAt. No SKU/modifiers/tax/
  station/dietary/multi-image/sortOrder.
- **`MenuItem`** (menu platform, `:1799-1838`): externalId? (ties to POS),
  name, description, `defaultPriceCents`, imageUrl, `allergens[]` (operator-
  editable, **not POS-synced**), `tags[]` (merchandising), `variants` JSON
  (catalog-level, **not POS-auto-populated**), `sortOrder`. No salePrice.
- **`MenuLocationOverride`** (THE override layer, `:1851-1871`): locationTenantId,
  menuItemId, `priceCents?` (null = inherit), `isAvailable` (86), `soldOutUntil?`
  (temp-86), `isHidden`, `source` ('manual'|'square'|'custom-webhook'|
  'operator-import'|'auto-86'). **Only price + availability — no name/desc/image
  override columns.**

## 3. Widget consumption

`MenuBoardWidget.tsx` → `GET /screens/:id/menu` →
`MenuService.resolveMenuForLocation()` → `ResolvedMenuItem` (`menu.service.ts:45-72`):
name, description, `priceCents` (`override.priceCents ?? item.defaultPriceCents`,
`:211-212`), priceOverridden flag, imageUrl, allergens, tags, category, sortOrder,
available, soldOut, variants. **No per-location name/description/image override
is even possible — those come straight from the central `MenuItem`.**

## 4. THE KEY GAP — operator override / mapping UI

**Exists** (`apps/web/src/app/[schoolId]/menu/page.tsx`): a per-location
price + availability console — central catalog grid × per-location columns,
click-cell price override (`PUT /menu/overrides/:loc/:item`), bulk price set
(`POST /menu/overrides/bulk`), revert-to-inherited (`DELETE …`), category
filter, search, "paste your menu" self-serve import (`POST /menu/import`).

**Missing:**
- ❌ No UI to **remap which POS field → which widget slot** ("use the POS
  description as the subtitle", "skip the image"). No catalog-level field-map config.
- ❌ No per-item **display override** for name / description / image (only
  price + 86). `MenuLocationOverride` has no `*_override` columns for these.
- ❌ No daypart UI (schema exists), no per-screen hide-category.
- ❌ No allergen/dietary auto-capture (manual entry only).

## Prioritized gap list (to fully deliver "pick → auto-map → override any field")

**P0**
1. Per-item / per-location **field override** UI + columns
   (`MenuLocationOverride.nameOverride/descriptionOverride/imageUrlOverride`,
   grid cells like price, `PUT /menu/overrides` extended, merge in
   `resolveMenuForLocation`).
2. Per-catalog **field-mapping** config (`MenuCatalog.fieldMappingConfig` JSON,
   a connect-wizard mapping step, applied in resolve) — OR defer to per-item override.
3. Allergen/dietary capture via custom-webhook `{ menu:[{ allergens:[] }] }` +
   import UI column.

**P1**
4. Daypart operator UI (schema exists, no UI).
5. Promotional/sale price (`salePriceCents` populated + crossed-out render).
6. Per-screen category hide/show (`Screen.menuCategoryFilter`).

**P2**
7. SKU + tax-class storage. 8. Modifiers/options as a first-class schema +
sync + widget render.

## Conclusion

Auto-capture + default mapping **works**; the **manual-override step is
incomplete** — only price + 86 are overridable, and there's no field-remap UI.
Architecture is sound (`MenuLocationOverride` survives re-sync); the missing
piece is operator-facing UI + override columns for non-price fields.
