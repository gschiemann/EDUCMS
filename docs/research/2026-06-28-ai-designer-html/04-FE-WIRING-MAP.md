# AI Designer — Phase 3 FE wiring map (Explore agent, 2026-06-29)

## Entry UI
`apps/web/src/app/[schoolId]/templates/page.tsx` — the AI-generate modal
(`showAiGenerate`), two phases `aiPhase: 'intake' | 'pick'`, intake via
`<SignageConcierge>` (chat) or `<AiIntakeWizard>` (wizard). State (~410-450):
`aiCandidates: AiTemplateCandidate[]`, `aiCanvas {w,h}`, `aiInteractive`,
`aiPicking`. Generate handler sets `aiCandidates` + `aiPhase('pick')`.

## API hooks
`apps/web/src/hooks/use-api.ts` — `useGenerateTouchCandidates` (POST
`/templates/generate-touch/candidates`), `useCreateFromCandidate` (POST
`/templates/create-from-candidate`), `useRefineSignageBoard`. Auth via
`apiFetch` (`apps/web/src/lib/api-client.ts`) — Bearer from `useUIStore` +
`API_URL` from `lib/api-url.ts`.

## Candidate grid + pick
`templates/page.tsx` ~1197-1356: maps `aiCandidates` → `<ScaledTemplateThumbnail
zones=... bgColor=... freeze />` + "Use this" → `pickCandidate(i)` (~743-778) →
`createFromCandidate({candidate, screenWidth, screenHeight, interactive,
background})` → `openInBuilder`. `AiTemplateCandidate` = `{name, zones[],
scenes?, background?, spec?, archetype?, theme?}`.

## srcdoc render — ALREADY DONE
`WidgetRenderer.tsx` `ExternalHtmlWidget` (~3623): if `config.html` present →
`<iframe srcDoc=... sandbox="allow-scripts">`. `ScaledTemplateThumbnail` →
`WidgetPreview` → `WidgetRenderer` → `ExternalHtmlWidget`. So a candidate with a
single `{widgetType:'EXTERNAL_HTML', x:0,y:0,width:100,height:100,
defaultConfig:{html}}` zone renders in the EXISTING grid as a live srcdoc
preview — no new preview component needed. (Greg's "previews should be the
updated samples" → satisfied for free.)

## No FE refs yet to generate-designer / create-designer (confirmed 0).

## Plan (minimal, additive)
1. use-api.ts: add `useGenerateDesignerCandidates` (POST generate-designer/
   candidates → {candidates:[{name,html,screenWidth,screenHeight,taurusWarnings}]})
   + `useCreateDesigner` (POST create-designer {name, htmlBase64, w, h}).
2. templates/page.tsx: add `aiDesignerMode` state + a mode toggle. In Designer
   mode the generate handler calls the designer hook and maps each returned
   candidate → an AiTemplateCandidate with one EXTERNAL_HTML zone
   (`defaultConfig.html`) PLUS keep the raw html (e.g. `__designerHtml`) for persist.
3. pickCandidate: if the candidate is a designer board → `createDesigner({name,
   htmlBase64: btoa(unescape(encodeURIComponent(html))), screenWidth, screenHeight})`
   → openInBuilder. Else existing createFromCandidate path.
4. Verify: open modal → Designer mode → generate → 3 srcdoc previews → pick →
   builder renders the board. tsc + web build green.
