-- 2026-05-31 — Per-item size/option price variants on menu items.
--
-- Adds a single nullable JSONB `variants` column to menu_items. Holds a
-- catalog-level array of { label: string, priceCents: number } — e.g.
-- Small / Medium / Large or "12oz" / "16oz". The per-screen menu feed
-- (GET /api/v1/screens/:id/menu, resolved by MenuService) surfaces this
-- as the optional `variants?` field so menu boards can render size pricing.
--
-- v1: variants are catalog-level only. Per-location MenuLocationOverride
-- rows still adjust the base default_price_cents; they do NOT override
-- individual variant prices.
--
-- Purely additive (nullable JSONB). Every existing row stays untouched
-- (variants = NULL → single-price item, unchanged feed shape).

ALTER TABLE "menu_items" ADD COLUMN "variants" JSONB;
