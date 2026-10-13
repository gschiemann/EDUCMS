# Full-screen fill rollout implementation

Date: 2026-10-13
Branch: `codex/player-fullscreen-fit-verified`
Commit: `7ed36e47` (`Use full-screen fill for normal playlist media`)

## Change

Normal full-screen playlist images and videos now use `object-fit: fill` by default. Both axes scale to the full playback surface, leaving every source edge visible without letterboxing or crop; differing source and screen proportions can stretch. Emergency playlist media remains `contain`. Authored template and widget fit settings are unchanged.

The native protocol-2 descriptor now defaults to `fit: "fill"`, matching browser playback. Native enrollment, protocol selection, asset hashing, and descriptor SHA-256 validation are unchanged. The exact-ID pilot selector and all associated config, manifest state, and test scaffolding have been removed.

The browser spec has four cases: near-portrait bitmap corner markers on a portrait viewport, mismatched video on the single-element path, mismatched video on the two-deck path, and portrait bitmap corner markers on a landscape viewport. The bitmap checks use the committed PNG fixture, exact RGB corner samples, and CSS-to-device-pixel normalization. The E2E test code was not run in this implementation turn; browser/build integration remains with the lead.

## Verification

- API focused tests: 2 suites, 40 tests passed (`playback-config.spec.ts`, `native-video.spec.ts`).
- Web focused tests: 3 suites, 27 tests passed (`mediaFit`, `shapeAwareFit`, `ContinuousLoopVideo`). The ContinuousLoopVideo suite emits its existing expected fallback `console.warn` diagnostics while passing.
- `git diff --check` passed; worktree was clean after the commit.
- The owner reported physical confirmation on L55VEC and M43: full fill with all edges intact, no white; native telemetry output `2160x3840`. Those hardware checks were performed by the owner, not by this agent.

Full substantive agent return:7ed36e47 oncodex/player-fullscreen-fit-verified committed clean inassignedisolatedtree. Normalweb/nativeP2 fullscreenfitfill, emergencycontain, authoredwidget/template choicesunchanged. Temporaryallowlist/config/state removed. Browserfourconcisetests realPNGexactfourcornerRGB withDPRnormalization onportraitandlandscape andseparatewrongshapevideopathsingle/twodeck. FocusedAPI2suites40 andweb3suites27 PASS,diffcheckclean; browser/build NOT RUN byagent, root owns verification.
