# AI Designer — progress log

## 2026-06-28 (late night, pre-12:50am)
Shipped to master (all CI-green):
- **Phase 1** `3a7db39e` — `ExternalHtmlWidget` renders inline HTML via `<iframe srcdoc>` (sandboxed). The render foundation.
- **Phase 2 core** `149dbab3` — `apps/api/src/ai/designer-prompt.ts`: `DESIGNER_SYSTEM_PROMPT` (world-class-designer, full-HTML output, real craft, venue palette/content, data-field hooks, Taurus-safe, loaded fonts only) + `buildDesignerUserPrompt` + `DESIGNER_ART_DIRECTIONS` (3 distinct) + `sanitizeDesignerHtml` + `auditDesignerHtmlTaurus`. 9 tests.
- **Phase 2 wire** `91f7413c` — `AiService.generateDesignerBoardCandidates` (fan out 3 art directions → top-model full-HTML boards → sanitize; caps/spend/audit) + `POST /templates/generate-designer/candidates` + `POST /templates/create-designer` (persists ONE EXTERNAL_HTML zone via persistGeneratedTemplate, re-sanitized; bypasses the touch sanitizer that strips EXTERNAL_HTML + truncates html@4000). 2 service tests. AI suite 211.

The path is end-to-end: generate-designer/candidates → pick → create-designer → renders via srcdoc.

### NEXT (the live-iteration loop — needs AI cap, resets ~12:50am)
1. Live-test: `POST /templates/generate-designer/candidates` for Chrome Coffee (palette `#23282f,#4a5464,#c1c8d1,#f0523d`, content = the real menu, vertical qsr) via the authed Chrome tab (page-context fetch, `Bearer localStorage.edu_cms_token`, async-stash pattern — the gen exceeds the 45s CDP eval limit). Then `create-designer` the best, open the builder, screenshot.
2. Iterate `DESIGNER_SYSTEM_PROMPT` against the screenshots until 3/3 come back designer-level (the bar = the hand-authored Chrome proof). Tune: imagery quality, type pairing, layout variety, no-overflow, Taurus-safe.
3. Also test a bar, a retail store, a gym, a restaurant.
4. Then: FE picker (generate-designer in the templates AI flow + show the 3 srcdoc boards), Phase 4 editability (data-field + postMessage shim), Phase 5 make-default.

### Traps / notes
- create-from-candidate's sanitizeTouchTemplate would DESTROY a designer board (drops EXTERNAL_HTML, truncates html). Always use create-designer.
- applyBrandToZoneConfig runs in persistGeneratedTemplate — it adds brand keys but leaves config.html intact (verify on first live persist).
- The 3-candidate designer fan-out = 3 big model calls — slow + costs more. Fine for the premium path; gate/tier later.
- Model: uses the tenant's configured BYOK model (Greg = GPT-5). Big maxTokens (16000) for a full doc.
