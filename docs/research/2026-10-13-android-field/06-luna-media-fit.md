# Android/player whole-media fit — 2026-10-13

Implemented the default full-screen playlist media policy as `object-fit: contain`, centered. This preserves the complete image or video frame for near-match, mismatched, and unknown aspect ratios. The prior `cover` default cropped the edge of the reported 1080×1668 source on a 1080×1920 panel, including edge logos/faces. Explicit `cover` and `fill` fit helpers remain supported.

Emergency playlist policy remains `contain`; no emergency endpoints, payload validation, auth-bypass, audit logging, or alert flow changed. Native protocol 2 now reports `transform.fit: contain`, matching the web path. The protocol 1 shared-video descriptor remains `fill` because its wire contract does not support `contain`; that legacy path remains a separate coverage gap.

Changed files:
- `apps/web/src/app/player/mediaFit.ts`
- `apps/web/src/app/player/__tests__/mediaFit.test.ts`
- `apps/web/src/app/player/__tests__/shapeAwareFit.test.ts`
- `apps/web/tests/e2e/player-media-fit.spec.ts`
- `apps/api/src/screens/native-video.ts`
- `apps/api/src/screens/native-video.spec.ts`

Validation:
- Web focused Jest: 2 suites, 14 tests passed.
- API focused Jest: 1 suite, 29 tests passed.
- Playwright E2E was not run in this isolated implementation pass; parent agent will run integrated browser verification.
