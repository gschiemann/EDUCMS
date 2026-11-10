# Player stability functions: what we have, what is missing (2026-11-09)

**Asked by the owner:** "make sure our player is the best in the business and we have all the functions to ensure it's stable all the time."

**What this is:** a function-by-function inventory of the player (Kotlin APK + web player) on `origin/master` at 58ec24c2, against the list of stability functions the leading signage players advertise. It is a read of our code, not a side-by-side test on hardware against any competitor, so it cannot prove "best in the business". It shows where we are complete and where we are not.

**Who did it:** a read-only inventory agent (Sonnet, routine code search) graded 30 functions; the lead (claude-fable-5-2, Claude Code desktop) re-checked the "absent" lines by search and corrected two of them (marked below). The agent's full report was returned in-session; this file is the condensed record with the corrections applied.

**Nothing here is built.** Every item under "Gaps" is a proposal for the owner to pick from.

**Update 2026-11-10:** the owner asked for all of it ("Build it all"). Built on the branch `claude/player-stability-train`, unmerged: gaps 1, 2, 4 (record only, no restart rung), 5, 6 (as an unpair PIN), 7, 8 (ANR traces) and 9. **Gap 3, the remote picture of the glass, is not built.** Not attempted: captive-portal handling, lock-task kiosk mode (needs device owner, ruled out), on-hardware proof of seamless preload. The review log is `2026-11-09-player-stability/README.md`.

## Score

| Grade | Count | Functions |
|---|---|---|
| Present | 17 | auto-start at boot · crash restart (15-minute alarm tick) · renderer-crash recovery · offline playback · verified resumable downloads · storage management · black/frozen screen detection · unplayable-content fallback · multi-screen sync · reconnect + polling backstop · heartbeat/telemetry · remote log upload · staged OTA with integrity check and rollback · display power control · atomic state writes · credential lifecycle · on-device self-test |
| Partial | 11 | ANR (frozen app) detection · seamless preload · captive-portal handling · clock/time-zone handling · remote commands · scheduled restart · proof-of-play · customer alerts · crash reporting · thermal/hardware health · kiosk lockdown |
| Absent | 2 | memory-pressure handling · remote screenshot of the glass |

## Gaps, worst first

1. **No memory-pressure handling.** No `onTrimMemory` / `onLowMemory` handler anywhere in `apps/player` (search: `grep -rn -E 'onTrimMemory|onLowMemory|ComponentCallbacks2' apps/player --include='*.kt'`, zero hits). A WebView that grows for days is the classic cause of a signage box dying at 3 a.m.; today we only find out after Android kills the app. *Proposal:* on a memory warning, drop caches that can be rebuilt and record it in the heartbeat; on a critical warning outside playback-sensitive moments, do a controlled page reload.

2. **Scheduled restart exists on the server but restarts nothing today.** *(Correction: the agent graded this "absent".)* PR #272 added opt-in scheduled restarts per screen group (`apps/api/src/scheduled-reboot/`, kill switch `SCHEDULED_REBOOTS_DISABLED`). It sends a device REBOOT, and the service's own header says every screen class currently reports `reboot: 'none'`, because a device reboot needs device-owner rights, which the owner has ruled out for good. *Proposal:* a restart of the **app process** (not the device) in the same quiet window. It needs no special rights, the 15-minute alarm tick already brings the app back, and it clears the same leaks. The existing policy, audit and UI can drive it.

3. **No remote picture of the glass.** No screenshot capture in the player or the manager. Support cannot see what a customer sees; render proof tells us "something painted", not what. *Proposal:* an on-demand capture of the app's own window (no device-owner rights needed), short-lived, tenant-scoped, audited. Needs a privacy decision first (K-12 screens can show student names and photos) and a hardware test (native video surfaces may capture black).

4. **A frozen app is only noticed afterwards.** ANR evidence is read after the process has already died (`ProcessExitDiagnostics.kt`). *Proposal:* a small main-thread watchdog: if the UI thread does not answer for N seconds, record it and restart the app, instead of waiting for Android's dialog on an unattended screen.

5. **Customer alerts cover two cases** (offline, no content). Not alerted: storage nearly full, credential needs re-pairing, stuck on an old version, render proof failing. *(The agent did not search for alerts outside `notifications/`; treat the list as "at least".)* 

6. **Kiosk lockdown depends on device owner.** Lock-task mode only engages with device-owner rights; `OperatorPinGate.kt` exists but is not wired in. *Proposal:* wire the PIN gate so leaving the player needs a PIN on every device, without device owner.

7. **Proof-of-play is a server-side sample** about every 10 minutes, not a device-side play log. Enough for health, not enough for a customer who must prove an ad or a notice ran.

8. **Native crashes and ANRs are not uploaded.** Web errors reach Sentry; a native crash is only in the on-device diagnostics and the next heartbeat.

9. **Remote commands:** reload and clear-cache work; REBOOT exists in the API but is refused for every class today (see 2). No "restart the app" command.

Smaller partials: seamless preload is built but not proven on every class; a captive portal is detected but not handled; thermal and hardware health is thin; clock handling improves with PR #295 (a clock step no longer makes the player refuse every push).

## Not checked

- The exact heartbeat field list.
- Whether a wrong device clock shifts the on/off schedule.
- Customer alerts outside `apps/api/src/notifications/`.
- No function was exercised on hardware for this inventory.

## Related work from the same day

- PR #294: iframe content can no longer release the native emergency hold on every-frame-bridge devices; heartbeat proofs gated the same way (audit findings A + B). Open, not merged.
- PR #295: a push refused as stale asks the manifest and re-learns the server clock; the player asks for persistent storage (findings C + D). Open, not merged.
- Audits: `2026-11-09-fable-player-audit.md`, `2026-11-09-fable-5.2-player-audit.md`.
