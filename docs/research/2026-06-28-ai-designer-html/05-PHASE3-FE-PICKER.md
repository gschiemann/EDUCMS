# AI Designer — Phase 3 (FE picker) shipped (2026-06-29 ~02:00)

Wired the AI Designer into the Templates AI-generate flow so an operator can
pick from 3 designer boards in the app (not just via API).

## Commits
- `70472678` — Designer mode in the modal:
  - `use-api.ts`: `useGenerateDesignerCandidates` + `useCreateDesigner`;
    `AiTemplateCandidate._designerHtml` carries the raw HTML.
  - `templates/page.tsx`: `aiDesignerMode` state + "✨ Designer (HTML)" toggle
    (4th option beside Touch/Display/Build-a-set); `runGenerateCandidatesCore`
    branches to generate-designer and maps each board → a one-zone
    EXTERNAL_HTML candidate; `pickCandidate` branches to create-designer
    (base64); combined `aiBusy` flag drives the spinners.
- `f16a39c5` — preview fix (see below).

## Live verification (prod Vercel)
- "✨ Designer (HTML)" toggle renders + stays active (`dgActive:true`). ✓
- Generated via the advanced path → `generate-designer` was called
  (`__designerCalled=true`), 3 "Use this" cards rendered. ✓ (end-to-end wiring works)
- BUG found live: the 3 cards showed a "1 element" PLACEHOLDER, not the board
  (0 iframes). Root cause: `ScaledTemplateThumbnail` routes a posterless
  EXTERNAL_HTML board through an IntersectionObserver-gated live frame that
  doesn't mount inside the modal → blank designer previews (the exact
  "previews should be the updated samples" issue).
  FIX (`f16a39c5`): in the candidate grid, a designer candidate
  (`_designerHtml`) now renders its authored HTML directly as a srcdoc iframe
  (pointer-events-none; the board's self-scale fits it to the card). Each
  option shows its REAL distinct design.

## Pending verify (this wake, after Vercel deploys f16a39c5)
- Reopen modal → Designer → generate → confirm 3 previews show the actual
  distinct boards (screenshot), then pick one → builder renders it.

## Next phases
- Phase 4: editability — postMessage shim applies brand/text/img edits to the
  srcdoc board (data-field/data-imgslot hooks already baked into every board).
- Phase 5: make AI-Designer the premium DEFAULT; art-director engine = fallback.
