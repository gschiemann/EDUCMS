# Native power recovery candidate — 1.1.24

Version 1.1.24 was first built as a signed test candidate through manual `android-player-apk.yml` dispatch. On 2026-10-09, the operator explicitly requested publication so VisionCore can be updated from its screen. The release uses the recorded `--unqualified-override`; its OVERRIDE cells are outstanding physical qualification debt, not hardware PASS results. No fleet update command or auto-update setting change is part of this publication.

The candidate adds an authenticated native heartbeat backstop for an operator's explicit POWER_ON. A sleeping WebView cannot consume normal push commands. The backstop has a five-minute server TTL, at most three persisted attempts, exact screen and command identities, and deduplication shared with the live displayApply path. A later physical OFF cancels retries. Neither a routine heartbeat nor stale rendering creates a wake.

An ACK requires observed Android interactive and Player foreground. The existing own-package launch path may bring the player back from an OEM launcher, subject to Android's background launch restrictions. ACK does not imply content health: fresh render, cache and video frame evidence must return independently.

## Matching X80 / Android 11 qualification

Use the available VisionCore X80 before attempting an unattended Cleveland recovery. Install the candidate over 1.1.23 without clearing app data or re-pairing. Do not mark a qualification cell PASS until its physical checklist actually passes.

1. Verify signed production package identity, installation, existing pairing and normal playback.
2. Put the physical panel into standby. Confirm native heartbeat continues, native runtime reports interactive false, and normal checks do not wake it.
3. Issue explicit dashboard Turn panel on. Confirm interactive true, Player foreground and new content render/frame reports. Confirm the assigned content is visibly playing.
4. Repeat with the OEM launcher foreground and Player Activity absent. A successful dispatch alone is insufficient.
5. Turn the panel off again after the first wake attempt. Confirm a duplicate old wake does not undo that newer OFF, including after process restart.
6. Complete reboot, offline recovery, content update, real emergency trigger/all-clear, remote navigation, OTA and boot-proof checks from the hardware checklist.

API 30 does not have the API 31 silent-install hint. Self installer-of-record alone does not prove unattended installation, and the current 1.1.23 installer/relaunch paths honor standby. No guaranteed current remote wake route was found for Cleveland. Never fabricate an emergency to obtain a wake.

DH43 frame loss is a separate unresolved issue. Two simultaneous face videos caused roughly 45–59% dropped frames in field samples; a controlled single-video test reduced the front to about 2.5%. This wake candidate does not solve that shared-resource contention or justify calling those faces healthy.
