# Frame-Locked Multi-Screen Sync — Research & Design (2026-07-28)

Greg's ask: *"keep two separate screens in sync playing the same content at the
exact same time down to the millisecond… could be multiple screens, not just two."*

| Doc | What it is |
|---|---|
| [`00-DESIGN.md`](00-DESIGN.md) | The architecture + design decisions (lead-authored). Read this first. |
| [`01-CODEBASE-RECON.md`](01-CODEBASE-RECON.md) | Exhaustive map of the player / realtime / manifest architecture with file:line citations — rotation engine, WS layer, clock-skew seed, telemetry channels, schedule resolution, patterns to follow, 15 gotchas. |
| [`02-INDUSTRY-RESEARCH.md`](02-INDUSTRY-RESEARCH.md) | Source-cited competitor landscape (BrightSign/info-beamer/Xibo/Navori/signageOS + absence-confirmed cloud rivals), browser clock-sync + video-servo literature with measured numbers, design cheat-sheet of tuning constants. |

## The one-paragraph summary

We build **schedule-based sync** (the broadcast-TV model used by BrightSign,
info-beamer, GStreamer, and the W3C timing research): every screen shares one
server-anchored clock (Cristian's algorithm over the existing device WebSocket,
min-RTT filtered, slewed) and independently evaluates a **deterministic,
epoch-anchored playlist timeline** — *what is on screen is a pure function of
(manifest, syncedNow)*. No "GO" commands, no leader, nothing to desync: reboots
and late joiners land in phase by construction. Videos are servo-locked
(seek + playbackRate chase) to their timeline slot; measured browser prior art
holds ±7 ms. Per-screen latency trim cancels display-pipeline differences.
Everything is gated behind `ScreenGroup.syncMode = 'locked'` — the fleet is
byte-for-byte unchanged until an operator flips a group on.

## Honest numbers (research-backed)

- Clock agreement: typically single-digit ms over ordinary internet (0–1 ms desktop-class measured in prior art).
- Content flips: within ~1 frame (≤16.7 ms) on like hardware; that is the physical floor for anything that renders through a browser (only HDMI-clock hardware like BrightSign/Pi3 can beat it).
- Video: ±1 frame promised, echoless-class (±10 ms) typical after ~3 s convergence.
- Cloud competitors (ScreenCloud/OptiSigns/Yodeck/Rise Vision) do NOT have this — several confirmed from their own docs. Closest cloud rival (Navori) claims 33–50 ms. This is a genuine wedge.

## Implementation (same session)

Shipped behind the flag: `TimeSyncService` (Redis-aligned replica clock) +
`TIME_PING`/`TIME_PONG` on the gateway + `GET /realtime/time` fallback;
`SyncClock` + `syncTimeline` pure modules in the player + rAF conductor +
video servo + `?synchud=1` HUD; `sync` block on the manifest; group toggle,
per-screen trim, and telemetry badge in the dashboard; Jest + Playwright
coverage. See the session commit(s) dated 2026-07-28.

## Self-calibration wave (same day — "test the hardware, auto-adjust")

Three tiers on top of the base feature:

1. **Self-measuring pipeline** — SyncClock gained a crystal skew-rate model
   (GStreamer-netclientclock-style regression; coasting tracks the crystal
   instead of freezing) and adaptive ping cadence (30s wired / 5s jittery
   WiFi). The conductor measures each device's decision→paint latency
   (double-rAF EWMA, persisted) and auto-leads flips by it; videos preroll
   hidden before their boundary with an rVFC-measured start-lead. Telemetry
   gains `renderLeadMs` + `skewPpm`; badge tooltip coaches "wire this
   screen" on chronic jitter.
2. **Fleet-learned trims** — `GET /screens/sync-trim-suggestions` aggregates
   the median operator trim per hardware model across the whole platform
   (anonymized numbers only, ten-ok annotated); untrimmed screens of a known
   model get a one-tap "Model preset: +40ms · Apply" chip.
3. **Camera auto-calibration** — the only honest way to measure the glass:
   `POST /screen-groups/:id/calibrate-flash` arms a signed, auto-expiring
   full-screen synced flash on every group screen (suppressed during
   emergencies); the phone wizard at `/[schoolId]/screens/sync-calibrate`
   films the wall, tags screens by tap, detects flash onsets with sub-frame
   interpolation, reduces them to circular phases (`lib/sync-calibration.ts`,
   15 unit tests incl. a synthetic 3-screen end-to-end recovering glass
   deltas within ±12ms from 30fps captures), and one-tap-writes the trims.
   AVR-mic-calibration for video walls — no signage vendor, cloud or
   hardware, ships this.
