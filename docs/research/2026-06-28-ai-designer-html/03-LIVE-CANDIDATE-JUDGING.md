# AI Designer — first live 3-candidate judging + layout fixes (2026-06-29 ~01:15)

## What happened
With the truncation fix + hardened prompt live (`06b61399`), generated 3
real designer candidates for Chrome Coffee via `generate-designer/candidates`
(GPT-5 BYOK, 43s, 201). All 3 came back as full HTML docs, **0 Taurus
warnings**, style+script intact (6.1–7.3KB each). Persisted via create-designer
(base64), pulled from DB, rendered headless (Playwright), eyeballed.

## Verdict (screenshots in scratchpad cand1/2/3.png)
- **Cand 1 — FAIL**: full-bleed busy espresso-machine photo, weak scrim → the
  menu sat over the bright photo, unreadable; rows overflowed the bottom.
- **Cand 2 — strong design** (graphite, two-tone "Chrome Coffee" wordmark,
  clean menu, coffee photo strip) BUT the absolute footer **overlapped** the
  Brown Sugar / Nitro rows, and 7 items were near vertical overflow.
- **Cand 3 — strong design** (stacked wordmark, coral leaders) BUT **same
  footer overlap**, and only 5 of 7 items fit (Nitro + Matcha dropped).

## Root causes (both are auto-fit failures the model can't eyeball)
1. Absolute footer placed at a fixed offset that the flowing menu grows into.
2. Item count overflows the canvas at the chosen type sizes → clip/collide.
3. Cand 1: full-bleed photo behind dense text (art direction invited it).

## Fixes shipped (`28770a45`) — prompt-craft, no model change
- **Rewrote `DESIGNER_EXEMPLAR`** to the bulletproof pattern: a RESERVED footer
  band the content never enters + a **content auto-fit script** (`fitCol`) that
  scales the content column to fit above the footer and re-runs on
  `document.fonts.ready` + a setTimeout (fonts load late and change height).
  Photo CONFINED to a right panel with a scrim. Verified the exemplar renders
  flawless headless (scratchpad/exemplar.png).
- **LAYOUT CONTRACT** added to the system prompt: think in bands; reserve the
  footer; count items and fit ALL (two columns at 7+); REQUIRED auto-fit safety
  net; final self-check (every item present, nothing clipped, footer clear).
- Softened the imagery rule + art direction 0 away from full-bleed-behind-text
  toward confined panels/bands (kills the cand-1 failure).

## NEXT (this wake, once 28770a45 deploys)
- Regenerate Chrome Coffee ×3 and confirm 3/3 now fit (no footer overlap, all
  items present, content the hero). Then test a bar / retail / gym / restaurant.
- If 3/3 clean → Phase 3 (FE picker) + Phase 4 (editability shim).
- Cleanup: delete remaining test templates (2f758b93 + ccd3af02 already
  deleted); keep one labeled demo. NEVER delete Greg's (97b6eee7 bar board).

## RESULT — v2 (after `28770a45`): 3/3 DESIGNER-LEVEL, bugs FIXED ✅
Regenerated Chrome Coffee ×3 with the bulletproof prompt (live on Railway).
All 3 came back 201, 0 Taurus warnings, AND each included the auto-fit script
(learned from the exemplar). Rendered headless (scratchpad/v2a/v2b/v2c.png):
- **v2a** — editorial: confined left photo panel (cup + plant) with a vertical
  BRENTWOOD tab, "Chrome.Coffee" wordmark, ALL 7 items + descriptions + dotted
  leaders + coral tabular prices, footer in its own band. No overlap. ⭐
- **v2b** — clean & premium: minimal, two-tone wordmark, all 7 items, faded
  chair photo on the right, footer clean. No overlap.
- **v2c** — vibrant: coral-bordered right photo block (chair + plant) with a
  BRENTWOOD CA badge, all 7 items, "ORDER AT THE COUNTER" pill footer. No overlap.

Three genuinely DISTINCT directions, all on-brand, all designer-grade, all 7
items present, zero footer collisions, zero overflow. The two systemic layout
bugs are dead. This is the quality bar Greg approved ("3 options with that
quality"). The core overnight goal — AI Designer reliably makes designer-level
boards — is MET and verified on glass.

Next: confirm on a 2nd vertical (bar — firing), then Phase 3 (FE picker) +
Phase 4 (editability shim). Cleanup all CC test templates, keep one demo.
