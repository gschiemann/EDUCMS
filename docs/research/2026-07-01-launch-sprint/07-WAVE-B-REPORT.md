# CRUSH Wave B — builder report (2026-07-02, verbatim summary)

Branch `worktree-agent-a908e0f35ba2f9e08` (base 318587cd; contains lead WIP
salvage 589716f9 — do not rebase). Status: ALL items done except B4
(canvas file-drop — Wave A's domain). Awaiting lead review + combined
merge with Wave A.

## Delivered
- B1 Pexels in-editor stock search (ca2ef6bf): StockImageService.searchMany/
  pickPhotos; AiService.searchStockPhotos/isStockConfigured/rehostStockPhoto
  (Pexels→Supabase rehost, mirrors templates.controller path; local
  isRehostablePexelsUrl copy avoids AiModule↔TemplatesModule circular import);
  GET /ai/stock-search + POST /ai/stock-rehost (Jwt+Rbac ADMIN+CONTRIBUTOR,
  @Throttle 30/min, key server-side); shared StockPhotoSearch (550ms debounce,
  cached results, attribution, invisible when unconfigured) in
  AssetLibraryModal "Stock photos" tab + BackgroundPanel "Photos" lane
  (orientation-aware). AiImageGenerateButton mounted in the stock tab (B6b).
- B2 ShapeWidget (589716f9 + f426ac5a): ONE SHAPE type, config.shape =
  rectangle/pill/circle/triangle/star/line/arrow, pure SVG (Taurus-safe),
  brand-preset ColorPickerField; 7 palette tiles.
- B3 Decorations revived (2c447f16): 8 registerVariant calls; CRITICAL FIX —
  handlePick writes registry id into config.variant which would break
  DecorationWidget bare-key dispatch → added decoration- prefix normalization
  (TouchPointWidget touch-* pattern); DECORATION added to WidgetType union.
- B5 IconWidget (f426ac5a): lucide-react/dynamic DynamicIcon (lazy per-icon
  chunks, no new dep), searchable IconPickerField; jest moduleNameMapper +
  mock because the module is ESM-only.
- B6a drop-sizes.ts resolveDropSize (variant > widgetType map > default)
  threaded through VariantPicker.handlePick + BuilderShell.handleDragEnd
  (⚠ BuilderShell also in Wave A's orbit — resolve at cherry-pick).
- Rule-#9 render proof (227db9fd): VariantPicker.elements.test.tsx mounts the
  REAL palette; variants-registry-elements drift-catcher.

## Verification (agent-run)
web tsc clean · api tsc clean (non-incremental) · jest stock 29/29 ·
web jest 335 pass / 8 fail in 2 suites PRE-EXISTING at base (proven via
stash-run + git show 318587cd) · mobile-perf clean · rule-#10 grep clean.

## Out-of-scope root causes (lead follow-ups)
1. editability-wave-rotation-opacity + editability-wave-orphans RED ON MASTER
   (NumField aria stepper buttons made getByLabelText ambiguous; fix =
   getByRole spinbutton) — and web jest is apparently NOT a CI gate.
2. constants.ts WIDGET_GROUPS still a dead decoy registry (rule-#9 trap).
3. useBuilderStore.addZone comment stale re: palette sizes.
4. lucide-react/dynamic ESM-only — mapper now required for jest importers.

## Honest unverified
No live-browser click-through (worktree has no .env) — lead eyeballs palette
+ stock tab post-merge; live Pexels needs PEXELS_API_KEY on deploy; DynamicIcon
lazy chunks on offline Taurus untested; WebKit via cross-browser CI at push.
