# AI Template Generation — "First-Try Hit Rate" Audit (quick, lead-authored)

Date: 2026-07-01 (Fable). Scope: the AI Designer 3-candidate pipeline
(`ai.service.ts generateDesignerBoardCandidates`, `designer-prompt.ts`,
templates page). Question: how do we get customers what they want on the
FIRST generation as often as possible?

## What's already strong (verified in code)

- **Rich brand grounding**: prompt receives vertical, palette ("use boldly"),
  venue name/tagline, VERIFIED logo URL + hero photo (never guessed stock —
  `stripGuessedStockPhotos` kills hallucinated image URLs), structured
  `content`, an optional reference, and per-tenant **house style** distilled
  from previously-kept boards (`deriveTenantHouseStyle`).
- **Deterministic quality floor**: VOS-FIT-ENGINE guarantees min font size, no
  overlap, no overflow — the "text too small / broken layout" class can't ship.
- **Style-diverse candidates**: 3 candidates fan out across 3 art directions
  (full-bleed editorial / clean premium / vibrant graphic).
- **Recovery loop**: chat-to-edit refine + candidate history/resume, honest
  AI_DESIGNER_CANDIDATES / AI_DESIGNER_REFINE audit rows.

## The 6 gaps, ranked by first-try impact

1. **We hedge STYLE, not INTERPRETATION (biggest lever).** All 3 candidates
   share one identical reading of the brief — only the art direction varies
   (`directions.map(...)` around ai.service.ts:2610). If the model misreads
   WHAT the customer wants ("happy hour board" → wrong items/emphasis), all
   3 miss together. Fix: a cheap small-model **brief-extraction pass** that
   produces a structured brief (occasion, headline, items, date/time, tone),
   and/or vary content emphasis across candidates the way art direction
   already varies. One wrong-interpretation miss costs 3×16k tokens; the
   extraction pass costs ~300.

2. **First-try rate isn't measurable.** Generation is audited
   (AI_DESIGNER_CANDIDATES: requested/returned/provider) and keeps land as
   TEMPLATE_CREATED — but nothing ties a keep to **batchId + candidateIndex +
   artDirection + refine-count**. ~20-line change to the create-from-candidate
   audit details → "first-try keep rate by vertical/direction" becomes a
   query. Can't improve what we can't see. (Cheapest item here.)

3. **Learning is keep-only and coarse.** House style distills palette/fonts/
   motion from kept boards, but ignores the two strongest signals we already
   collect: (a) WHICH art direction each tenant keeps (bias the 3 slots —
   e.g. 2 diverse + 1 "your usual style"), and (b) **chat-to-edit refine
   instructions** ("bigger text", "less clutter") — recurring refines are
   standing preferences; feed the last N into houseStyle as operator-
   preference lines. Zero new UX.

4. **The fast path is still one free-text box.** FE sends `prompt: aiPrompt`
   (templates/page.tsx:864). Concierge chat intake exists but the default
   flow spends 3 expensive generations on an unconfirmed brief. Fix: a
   **brief echo** — show the extracted brief as tappable chips (headline /
   items / date / tone) for a 2-second confirm BEFORE the fan-out; or ask
   exactly ONE question when a critical slot is empty (menu board with no
   items). Not a wizard; a confirm strip.

5. **Auto-ground with the tenant's real data.** `content` exists but the
   operator has to supply it. When the brief implies it, auto-pull what we
   already have: POS menu items + prices ("happy hour" → real drinks),
   address/hours, sponsor list — same pattern as the Weather/Maps address
   prefill shipped in the App Library. "Pretty board" → "MY board" is the
   gap customers actually feel.

6. **Fixed 3-direction rotation.** Once #2 exists: if a tenant keeps
   "clean & premium" 5× in a row, spend slot 3 on a house-style-matched
   candidate instead of the never-kept direction. Also consider streaming
   candidate #1 early for perceived speed.

## Order of attack (when usage allows)
#2 (telemetry, tiny) → #1 (interpretation hedging) → #4 (brief-echo chips)
→ #3 (refine-signal learning) → #5 (auto-ground) → #6 (adaptive slots).
#2 first on purpose: it makes every later change measurable A/B-style.
