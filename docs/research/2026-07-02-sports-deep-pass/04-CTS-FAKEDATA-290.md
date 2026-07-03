# Task #290 — CTS widgets fake-data guard (2026-07-03, compact)

CtsScoreboard.tsx / CtsRibbonWidgets.tsx keyed their sample-vs-live guard off
the generic `live` prop (which also gates video autoplay), so a builder
preview (TemplatePreviewModal, live=true) could paint the fabricated SAMPLE
(1-0/7:42/Q3; ribbon 4-3/shot-clock/#7 exclusion) as if real. Fix mirrors
Sports S2 exactly: isLiveSurface now requires BOTH useRenderSurface()==='player'
(RenderSurfaceContext, set only by player/page.tsx + TouchOverlay.tsx) AND the
`live` prop. CtsRibbon centralized in useCtsGameState() so all 10 call sites
fixed from one edit. TemplatePreviewModal/AppConfigForm unchanged (correctly
omit renderSurface) + guardrail comments. 15 new tests
(cts-widgets-render-surface.test.tsx); parity 45/45; mobile-perf + rule-#10
clean. Commits a25db977 + 1c50bf21.
