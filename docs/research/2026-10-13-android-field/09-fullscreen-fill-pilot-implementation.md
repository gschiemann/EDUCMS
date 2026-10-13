# Full-screen fill pilot implementation

Date: 2026-10-13
Branch: `codex/player-fullscreen-fill-pilot`
Commit: `18af1b0e` (`Add exact-screen full-screen fill pilot`)

## Scope and behavior

Added `PLAYER_FULLSCREEN_FILL_SCREEN_IDS` as an opt-in comma-separated list of exact UUID screen IDs. Only valid exact IDs receive the optional `playback.mediaFit: "fill"` manifest field. Unset/empty values, `all`, wildcard forms, malformed IDs, and all other screens omit the field, preserving their previous manifest response. The API's existing emergency manifest branches return before this normal playback configuration is constructed.

The protocol-2 native video descriptor uses `fill` only when the verified manifest field is exactly `fill`; otherwise it remains `contain`. Because the transform is part of the descriptor revision hash, opting in changes the revision. The descriptor still refuses emergency content.

The web player validates the manifest value strictly, applies it to full-screen normal image/video and video-loop rendering paths, and clears it whenever the next manifest does not carry the pilot value. Emergency playlist/media state forces `contain` even when the manifest previously carried `fill`. Authored template widgets retain their own fit settings.

Added a browser E2E proof using a mismatched-ratio SVG with distinct corner markers. It checks the rendered image fills a 540×960 viewport with `object-fit: fill` and samples all four corner markers from the browser screenshot. Video assertions cover the regular video element and two-deck loop path. The existing nonpilot contain scenarios remain in the same spec.

## Verification

- `pnpm --filter api test -- --runInBand src/screens/playback-config.spec.ts src/screens/native-video.spec.ts` — 2 suites, 50 tests passed.
- `pnpm --filter web exec jest --runInBand src/app/player/__tests__/mediaFit.test.ts` — 1 suite, 10 tests passed.
- `git diff --check` — passed.
- The Playwright E2E was added but not executed here; browser/build integration is left for the lead's audit.
- No hardware video scaling result is claimed. The Goodview APK evidence establishes `fitXY` for image/GIF rendering; its video decoder behavior remains a separate hardware question.

Full agent return: Pilot18af1b0e committed in assigned isolated worktree, clean. Exact UUID allowlist PLAYER_FULLSCREEN_FILL_SCREEN_IDS; omitted/malformed/all/wildcard/nonmatching preserve old manifest output. Web state per manifest clears on absent/invalid override, emergency forcedcontain. NativeP2 exact playback.mediaFit fill changestransform+revision. API2suites50passed, web1suite10passed, diffcheckclean. BrowserE2E edgecornerpixelproof andsingle/twodeckfitassertionsadded but NOT RUN byagent; root owns integration. No pushes/deploys/other source edits.
