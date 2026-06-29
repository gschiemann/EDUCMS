# AI Designer — multi-vertical generalization test (2026-06-29 ~02:30)

Tested 3 NEW verticals (3 candidates each = 9 boards) to confirm the designer
quality generalizes beyond coffee + bar. Rendered all 9 headless (Playwright).

## Verdict: STRONG generalization — coffee, bar, retail, gym, restaurant all
produce DISTINCT, designer-level boards on their own brand.

- **Retail — Maison Verde** (plant boutique, sage/terracotta): 3 distinct —
  (1) photo-panel editorial, (2) clean gradient minimal, (3) horizontal wordmark
  + vineyard photo. All designer-grade. BUT variant (1) loaded a MISMATCHED
  Unsplash photo (a stethoscope) — the model guessed a photo id that didn't
  depict plants.
- **Gym — Iron Pulse** (black/volt-yellow): excellent + fully on-brand —
  condensed wordmark, full class schedule w/ coaches, "BOOK YOUR SPOT" button,
  AND a relevant barbell photo. Industrial, high-energy.
- **Restaurant — Saffron & Smoke** (brown/saffron-gold): gorgeous — elegant
  serif w/ gold ampersand, chef-signatures menu w/ descriptions + gold prices,
  "Reserve a table" pill, opulent gradient (no photo, tasteful).

## The one recurring weakness: intermittent PHOTO RELEVANCE
8 of 9 boards were flawless; 1 (retail variant 1) embedded a real-but-wrong
Unsplash photo. Root cause: the model guesses specific Unsplash photo ids from
memory, which sometimes don't match the subject. Layout/type/brand/content were
perfect on every board — only the photo subject missed.

### Fix shipped (`54ed0b08`): photo-relevance rule
Strengthened DESIGNER_SYSTEM_PROMPT: only use a photo when confident it CLEARLY
matches the subject; otherwise compose a refined on-palette gradient/texture
(a wrong photo reads as broken; a gradient always reads as intentional). Several
boards already nailed gradients, so this steers to the safe path when uncertain.
Re-verify retail after deploy.

### Proper follow-up (future poke): Pexels-on-persist for the designer path
The engine path already does this (`AiService.attachKeptBoardPhoto` fetches a
real, topically-relevant Pexels photo on accept + re-hosts it). The designer
path could do the same on create-designer: detect data-imgslot, fetch a relevant
Pexels photo by venue/topic keywords, swap the <img src>. That GUARANTEES photo
relevance (keyword search vs. guessed id). Bigger build; deferred.

### Photo-relevance fix VERIFIED (`54ed0b08`, deployed)
Regenerated retail ×3 after the fix. All 3 now have relevant imagery:
B1 = a real rubber-plant photo, B2 = a tasteful sage gradient (no photo),
B3 = a plant photo + diagonal color-block. The stethoscope-type mismatch is
gone — 3/3 relevant. (One tiny nit on B2: the italic tagline crowds the
section label — minor flowing-header spacing, varies by gen; not worth a cycle.)

## Cleanup
All 9 + 3 retail-retest test templates deleted. Demo `580f0c7c` kept; Greg's
`97b6eee7` untouched.

## Status: the AI Designer reliably makes designer-level boards across every
vertical tested (coffee, bar, retail, gym, restaurant) — distinct, on-brand,
no overflow/collisions, relevant imagery. The core overnight goal is MET.
Remaining polish (future pokes): Phase 4 editability (click-to-edit shim),
Pexels-keyword photo on persist (guaranteed relevance), Phase 5 make-default.
