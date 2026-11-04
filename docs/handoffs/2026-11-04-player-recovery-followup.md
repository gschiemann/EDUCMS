# Player recovery follow-up — 2026-11-04

## SAR55 remote recovery menu
Owner photo shows the existing pre-content Screen options menu over the pairing surface. Owner reports no D-pad control after loss of connectivity. Source evidence: preContentEscapeOverlay used only button autoFocus and assumed OEM spatial navigation; the APK forwards D-pad keys, but its spatial-navigation shim is not injected into the player document. Existing RemoteDialog already implements explicit remote keys for confirmations.

Repair: keep the existing menu and buttons; RemoteOptions reuses remoteConfirm key decoding, parks focus on Keep waiting, moves with arrows/Tab, skips disabled buttons, traps focus, and displays the player's amber selection ring. OK answers on release; opening releases and held OK cannot activate a control. The release is consumed before closing, preventing activation of a newly focused pairing control. Back remains with the page's existing authority. No pairing, unpair, emergency, credential, or native bridge change is part of this web repair.

Validation: 43 remote unit tests passed; diagnostics/storage 20 tests passed. Full production web build passed. Real player register-down test passed in Chromium and WebKit using fake API and mocked realtime only; tests verify focus, arrows, disabled OEM spatial-nav independence, visible amber outline, held OK, Space dismiss, and Back. Screenshots saved under apps/web/test-results/player-remote-escape-*/offline-remote-menu.png; Chromium visually reviewed. Inset serialization guard passed; targeted eslint passed. Physical SAR55 remote result remains UNVERIFIED until deployed and tested onsite.

Why the system missed it: existing browser regression only asserted that Back exposed buttons, then closed the menu. It never drove arrows or OK on this pre-content branch. Those assertions now run against the actual player page, not a miniature harness.

Deployment/rollback: web-only change; connected players must load the newer web bundle. Revert the web repair PR to roll back. No APK or fleet action required by the source change. Do not claim live before merge, green checks, and newer deployment verification.

## Continuing FUH work — separate, not a field claim
Android store enrolment bootstrap repair remains on codex/fuh-store-enrollment-repair. Current local Android unit tests: 1551 tests, 2 skipped, zero failures/errors; lint passed. Source/API producer fixture passed. This does not establish on-glass video restoration. Review the persisted-source 304 bootstrap case before publishing/building. A new APK must retain the field .63 bridge repair from draft PR252 (cd2213a0c), which master does not yet include. Do not build from this branch and accidentally regress .63.

FUH-L-only PLAYER_CONTENT_STORE trial remains enabled, unqualified, with rollback and deployment evidence in the primary checkout's 2026-11-04-fuh-post-clear-store-trial.md. No broadening, cache wipe, production alert or all-clear was performed. Owner's small-image test displayed correctly on L while its original video stayed unavailable; recovery is not proved fixed.
