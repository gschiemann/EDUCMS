# Photo-forward by default + auto-photo on the kept board (2026-06-28)

**Agent:** worktree `worktree-agent-a66be6c0d2127b240` → merged to master as
`c1775a5d` (feat) + `fb9ff502` (docs). Lead reviewed the diff, cherry-picked,
ran tsc + jest, pushed. Worktree removed same turn.

**Why:** We proved live that a real PHOTO background + the taste-tier engine =
a world-class board (a bar "happy hour" board with an AI beer-pour/wings photo
looked stunning). The gap: the customer-facing 3-candidate concierge flow
defaulted to a GRADIENT (photo only fired for image archetypes with a stock key
set), so customers got the "lame black-background + text" look. Goal — make
photo-rich the DEFAULT outcome for every board a customer KEEPS, cost-controlled.

## What shipped

### 1. Photo-forward by DEFAULT (engine)
- `ART_DIRECTOR_SYSTEM_PROMPT` rewritten: a real photo is now the DEFAULT for
  photo-appropriate archetypes (`hero-fullbleed`, `lower-third-banner`,
  `poster-promo`, `split-50`), always emitting a vivid text-free `image.query`;
  gradient is the graceful fallback. Text-/data-dense archetypes
  (stat/grid/menu/quote/title-cta) stay on a gradient.
- New `PHOTO_DEFAULT_ARCHETYPES` set + `parseArtImage(raw, archetype)`: a
  missing/garbled/explicit-`none` plan from the model is upgraded to
  `mode:'stock'` for those archetypes (a `stock` plan no longer needs a query —
  the engine derives one). An explicit `generate` is left intact; an explicit
  operator non-photo background is still honored upstream.
- `art-director.ts` `mapImageConfig`: the **split-50 image half** now accepts the
  resolved stock photo too (not just full-bleed `background` zones).

### 2. Auto-photo on the kept board — THE key change
- New public `AiService.attachKeptBoardPhoto(...)`. Fallback order, cost-bounded
  to **one image per kept board**:
  1. Skip if the board already has a real photo (no double-spend).
  2. Skip if not a photo-appropriate archetype.
  3. **STOCK first** (free): `StockImageService.search(deriveStockQuery(spec))`
     when `PEXELS_API_KEY` is set.
  4. **AI fallback** (BYOK only): `generateBoardBackground` — Anthropic/platform
     tenants return `undefined`, so the platform Tier-1 key is **never** spent on
     an image; the existing image hourly cap + audit apply.
  5. Any miss/cap/timeout/error → keeps the rich gradient. **Never throws.**
- Lands in `templates.controller.createFromCandidate`, **before**
  `rehostStockImages`, so a stock URL it attaches is mirrored into Supabase.
  Mutates `parsed.zones` (via `injectBackgroundImage`) and sets
  `background.bgImage` so `Template.bgImage` persists.
- Candidate previews stay image-free (the 3-candidate fan-out is untouched — no
  AI image per candidate). So previews are fast/cheap; only the KEPT board spends.

### 3. Concierge default
Prompt now tells the concierge to **leave `background` unset** for
photo-appropriate purposes (engine then defaults to a photo), and only set
solid/gradient/textured when the operator clearly wants a flat look — explicit
choice stays authoritative.

### 4. Docs
`CLAUDE.md` `PEXELS_API_KEY` row documents photo-forward default + auto-photo-on-
accept (stock-first, AI-fallback, one image, never the platform key, graceful
gradient when nothing's available).

## Verification
- `tsconfig.build.json` tsc: clean. AI jest: 191 (5 new `attachKeptBoardPhoto`
  tests: stock-when-key, AI-fallback, graceful-none, skip-when-already-photo,
  skip-non-photo-archetype). Full API suite: 1089 passed.
- After lead merge alongside the LUNCH_MENU theme fix: AI jest 192, clean tsc.

## Deferred (with reason)
- `title-cta` / `quote-spotlight` photo backgrounds: these archetypes have no
  image zone and no scrim in the engine, so a full-bleed photo would risk
  illegible text. Kept on their rich gradient. Would need an engine archetype
  change (add a scrimmed background slot) — out of scope for an additive,
  zero-regression change.
- Vertical isn't available at accept time (the FE candidate doesn't carry it),
  so `deriveStockQuery` at accept uses the model's `image.query` then headline.
  Minor; could be threaded through the create-from-candidate payload later.

## OWED
- **Greg must add a free `PEXELS_API_KEY`** to the API env (Railway) for the
  free per-candidate + kept-board stock path. Until then, kept boards get an AI
  photo via the tenant's BYOK image provider (metered), or the rich gradient.
