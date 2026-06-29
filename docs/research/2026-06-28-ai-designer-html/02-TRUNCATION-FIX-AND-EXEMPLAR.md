# AI Designer — truncation fix + prompt hardening (2026-06-28, overnight)

## The blocker (found + fixed)
The AI Designer board rendered as "a blurred photo + a tiny title, no menu."
Root cause was NOT the model or the prompt — it was **persistence truncation**:
an 11,445-char AI board persisted as a 3,022-char unstyled fragment.

The global **`SanitizationPipe`** (`APP_PIPE` in `apps/api/src/app.module.ts`)
runs `sanitize-html` on **every string in every request body**. Its default
`allowedTags` excludes `html/head/style/script/body/!doctype`, so a raw `html`
field in `create-designer` was gutted — CSS + JS + doctype stripped — BEFORE
`sanitizeDesignerHtml` ever ran. Proven locally: a 152-char doc → 24 chars,
losing `<style>` + `<script>`.

### Fix (`f73f668f`)
`create-designer` now accepts **`htmlBase64`** (raw `html` kept as a fallback).
A base64 payload contains no HTML tags, so the global sanitizer passes it
through **untouched**; the route decodes it then runs `sanitizeDesignerHtml`
(the real XSS guard for this surface — strips remote scripts/iframes; the board
also renders in a null-origin sandboxed iframe). 2 regression tests lock in the
invariant (raw html is gutted by the pipe; base64 survives).

### Proven on glass
`POST create-designer` with a 4,340-char designer board (base64) →
read back from DB: **htmlLen 4339, hasStyle ✓, hasScript ✓, hasDoctype ✓,
menu content ✓** (was 3,022 gutted). Template id `8ee86be0-...` on the dodgers
tenant. Rendered the exact persisted bytes headlessly (Playwright) →
`scratchpad/chrome-coffee-render.png` — genuinely designer-grade
(graphite gradient, latte-art duotone + scrim, Fraunces wordmark w/ coral
period, dotted-leader menu, tabular coral prices, footer). This is the quality
bar Greg approved.

## Prompt hardening (`06b61399`)
Two levers added to `designer-prompt.ts`:
1. **CONTENT IS THE HERO** rule — the menu/offer/headline must be the largest,
   sharpest element; photography supports it (panel or scrim), never a full-bleed
   wash that buries the content. Targets the photo-dominant failure mode.
2. **`DESIGNER_EXEMPLAR`** — a worked, Taurus-safe board baked into the system
   prompt as a few-shot anchor (fixed stage + self-scale script, fonts link,
   photo-with-scrim, eyebrow, characterful wordmark, dotted-leader rows, tabular
   prices, data-field/data-imgslot hooks, NO inset/gap). Model told to MATCH the
   quality, not copy it. Tests assert it's itself Taurus-clean + loaded-fonts-only.

CI green on both commits (Deploy Reliability + Taurus + Mobile Perf + Prod Smoke
+ Cross-Browser + Emergency Path). AI suite 215, tsc clean. Railway live on
`f73f668f`.

## NEXT (when AI cap resets ~00:50)
- Generate REAL 3-candidate AI boards (`generate-designer/candidates`) with the
  hardened prompt + fixed pipeline; judge against the exemplar bar; iterate.
- Phase 3: FE picker (the templates AI flow calls generate-designer, shows the 3
  srcdoc boards, persists the pick via create-designer **base64**).
- Phase 4 editability (data-field + postMessage shim), Phase 5 make-default.

## Cleanup owed
Delete my broken/superseded test templates (9dca9257 gutted, plus the earlier
2f758b93 / ccd3af02 coffee tests). KEEP 8ee86be0 (the working proof demo) +
97b6eee7 (Greg's bar board). NEVER delete Greg's templates.
