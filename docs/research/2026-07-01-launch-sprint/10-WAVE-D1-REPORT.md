# CRUSH Wave D1 — Tweak/Translate in default AI picker (2026-07-03, compact)

The default Concierge→Designer 3-candidate picker lost the Tweak(refine) +
Translate affordances that the legacy wizard had. Fix (ec6434c2): new
useRefineDesignerBoard() hook wrapping the already-shipped POST
/templates/refine-designer (same route ChatToEditBox uses), utf8-safe base64.
page.tsx refineCandidate now dispatches by shape: _designerHtml → refine-designer
(swaps returned HTML in), spec → existing refine-signage. canTweak = spec ||
_designerHtml. CandidateFullscreenPreview gained Tweak button + instruction box
+ 6 translate chips (es/fr/zh/vi/ko/ar), same handler as the grid. BOTH
candidate types got Tweak (designer HTML already had a working refine backend).
13 new tests (use-refine-designer-board 4, ai-picker-tweak-translate 9); 51
total across 5 suites green; next build passed (real render path, rule #9);
mobile-perf clean. Fence: page.tsx AI-picker region + use-ai-designer.ts only.
DEFERRED (need reviewed session): D2 designer photos, D3 brand vars in AI HTML,
D4 make-it-an-AI-photo.
