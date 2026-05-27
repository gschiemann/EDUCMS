-- Audit P1-2 (2026-05-28): AI-generated alt-text for image assets.
-- Populated asynchronously after successful image upload by
-- AiAltTextService → OpenAI 4o-mini vision (or Anthropic Haiku
-- fallback). Operators can override or regenerate from the asset
-- detail panel.
--
-- Cap at 160 chars: WCAG screen-reader recommendation is ≤125 for
-- short alt-text; the extra 35 chars accommodate operator edits
-- without a second migration. Nullable so the column is purely
-- additive — legacy rows simply have alt_text = NULL.

ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "alt_text" VARCHAR(160);
