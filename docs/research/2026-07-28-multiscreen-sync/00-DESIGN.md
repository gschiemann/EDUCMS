# Millisecond Multi-Screen Sync — Architecture & Design

**Date:** 2026-07-28
**Author:** Claude (lead), commissioned by Greg
**Status:** DESIGN → implementation in same session
**Companion docs:** `01-CODEBASE-RECON.md` (player architecture map), `02-INDUSTRY-RESEARCH.md` (competitor + browser-tech research), `README.md` (index)

---

## 1. The ask

> "I want our CMS to be able to keep two separate screens in sync playing the same content at the exact same time down to the millisecond… could be multiple screens, not just two."

This is **synchronized playback** — the feature BrightSign gates behind its premium hardware line and that almost no cloud CMS (Yodeck, OptiSigns, ScreenCloud) offers at all. It matters for: video walls of independent displays, menu-board rows in QSR, ribbon + main board in sports venues, hallway runs in schools, and any venue where two visible screens flipping at different moments reads as "cheap."

## 2. Honest physics (what we promise)

"Down to the millisecond" has a hard floor set by physics we don't control:

| Layer | Error contribution |
|---|---|
| Clock sync over internet (WS ping, min-RTT filtered) | ±2–15 ms typical; ±25 ms bad WiFi |
| Scheduler flip precision (rAF-checked boundary) | ≤ 1 frame (16.7 ms @60 Hz), ~8 ms average |
| React commit → composite on flip | 1 frame, identical on like hardware |
| Display pipeline latency (panel/controller internal) | 0–50 ms **fixed** offset per model — corrected by per-screen trim |

**What we can honestly ship:** content flips land within **~1 frame (≤16 ms) of each other** on like hardware on the same network — visually indistinguishable from perfect. Clock agreement is typically single-digit milliseconds. Different display models introduce *fixed* offsets which the per-screen **latency trim** (like an AVR's audio-sync setting) cancels manually. Audio on multiple adjacent screens will echo if unmuted (comb-filtering starts ~10–20 ms); the answer is "one screen carries sound," documented, not fought.

Marketing language: **"frame-locked sync"** / "screens flip in the same frame." Never claim "0 ms."

## 3. The core architectural decision: sync-by-schedule, not sync-by-command

Two possible designs:

1. **Command sync** ("server says GO"): server broadcasts "advance now" to all screens. Every network hiccup, throttled timer, or missed message desyncs the fleet; jitter of the *slowest* delivery is your error; late joiners need special-casing; the server becomes a metronome single-point-of-failure.

2. **Schedule sync** (broadcast-TV model): every screen shares (a) the same content timeline and (b) the same clock, and *independently* computes what should be on screen at instant T. Nothing is "sent" at flip time. Sync error = clock error, full stop. This is how broadcast television, BrightSign, and info-beamer do it.

**We build #2.** The design mantra, which every line of the implementation must respect:

> **What is on screen is a pure function of (manifest, syncedNow).**

Consequences that fall out for free:
- **Late joiners / reboots join in phase instantly** — they compute the same function.
- **Network outage ≠ desync** — a screen that can't reach the server keeps playing in phase off its drift-modeled clock (drifts ~1 ms/min worst-case after sync loss; re-locks on reconnect).
- **N screens is the same as 2** — there is no pairwise anything.
- **Playlist edits stay in sync** — all screens' timelines change identically when they pick up the new manifest (brief divergence only during the poll-propagation window, self-healing).

### 3.1 The timeline function

The player already flattens all active schedules into `combinedItems[]` with **server-row-id item identities and required `durationMs`** — identical across screens of a group (recon doc §1, §3). So:

```
D            = Σ durationMs of daypart-valid items          (loop length)
P            = (syncedNow + trimMs) mod D                    (position in loop)
item, offset = walk cumulative durations until cum > P
```

Anchor = **Unix epoch (0)** — stateless. No anchor row, no coordination, no "start" message, nothing to desync or migrate. Every screen on Earth with the same playlist computes the same slide forever. (A stored per-group anchor was considered and rejected: it adds state + propagation for zero user-visible benefit on looping signage. Revisit only if "playlist must start at item 1 at publish moment" ever becomes a real requirement. — `feedback_dont_overengineer`)

Item-level dayparting stays deterministic: the valid-item filter is evaluated against `syncedNow` (not device wall clock), so all screens recompute the same filtered set within a frame of each other at daypart boundaries. (Timezone note: filter uses the device-local TZ exactly as today; screens in one venue share a TZ. Documented limitation, not worth a setting.)

**Failure determinism:** in sync mode a failed asset must NOT `setCurrentIndex(prev+1)` (that shifts phase on one screen only). The slot is held for its full duration showing the branded fallback card; the fleet re-converges at the next boundary. Failures are reported via telemetry instead.

## 4. Shared clock — `SyncClock`

Seed exists: player captures a single-sample offset from `AUTH_OK.payload.serverTime` (page.tsx:4299-4307) for the emergency freshness gate. Single-sample-no-RTT is ±(RTT) accurate at best — nowhere near sync grade. New module, player-side:

- **Timebase:** `performance.now()` (monotonic — immune to OS/NTP steps mid-session; Android boxes NTP-step *minutes* after boot, which would wreck a `Date.now()`-based clock). `syncedNow() = perfNow() + offset`.
- **Sampling:** WS `TIME_PING {t0}` → immediate direct-socket reply `TIME_PONG {t0, serverNow}`. On receipt: `rtt = t1 - t0`, `offsetSample = serverNow + rtt/2 - t1`.
- **Filtering (Cristian + NTP practice):** keep last 24 samples; take the best-RTT 25%; offset = **median** of those. RTT-asymmetry error is bounded by ±rtt_min/2; min-RTT filtering is what crushes jitter.
- **Cadence:** burst of 10 pings @150 ms on connect/reconnect/visibility-regain → lock in <2 s; steady-state 1 ping/20 s (20 ppm crystal drift ⇒ 0.4 ms per 20 s — negligible between pings). HTTP fallback `GET /screens/time` (same math, Cristian over fetch) when WS is down.
- **Slew, don't step:** after initial lock, apply offset changes at ≤2 ms per second so content never visibly jumps; step immediately only when |error| > 250 ms (then the timeline snaps once).
- **Confidence:** exported `uncertaintyMs` (spread of best samples + rtt_min/2 + staleness-drift allowance). Telemetry + HUD surface it; sync engages when uncertainty < 80 ms (before that, legacy free-run behavior).

**Server side — one clock for all replicas:** each API replica serves `TimeSyncService.now()` = local `Date.now()` + offset-to-Redis, where the offset is refreshed every 60 s via Redis `TIME` (min-RTT of 5 tries). Two replicas answering pings therefore agree to ~±1 ms even if their containers' clocks differ (multi-replica safety, Standard Audit Surface §17). Redis down → serve local clock (matches today's behavior; realtime is already degraded then).

Security note: TIME_PONG is an unsigned direct-socket control reply exactly like AUTH_OK today; it rides the device-authenticated TLS socket, is never fanned out through Redis (HMAC gate not applicable), and can't trigger content — worst case a poisoned clock delays emergency-freshness acceptance, same blast radius as today's AUTH_OK serverTime. No new attack surface.

## 5. Frame-accurate flips

The existing rotation heartbeat is a 500 ms `setInterval` checking `Date.now() - slideStartedAt >= duration` (±500 ms flip precision, free-running phase). Sync mode replaces the *decision*, not the render:

- A **rAF loop** (already proven alive on players — the render-proof paint counter is rAF-driven) computes `resolveTimeline(items, syncedNow)` every frame; when the resolved index ≠ current, `setCurrentIndex(resolved)` fires *on the frame containing the boundary* → flip lands within 1 frame on every screen. rAF throttling is a non-issue on an always-visible kiosk, and any stall self-corrects to the *correct current* slide (same recovery property the 500 ms heartbeat has, but stronger — it can also *rewind* a screen that ran ahead).
- The 500 ms heartbeat stays untouched for non-sync screens; in sync mode it stands down (its advance branch is gated off).
- **Preload is already right:** images all stay mounted (decoded), next video mounts hidden with `preload=auto`. In sync mode "next" = timeline-next, same math. CSS transitions (1 s fades) run identically on all screens — start instants match, so fades match.

## 6. Video: servo lock, not hope

Videos currently free-run (`onEnded` advances — recon §2). In sync mode a video item is a **fixed `durationMs` slot** on the timeline, and the media element is *servo-locked* to it:

```
target   = offsetInItem (mod videoDuration if file shorter than slot — loops)
error    = target - video.currentTime            (measured each rVFC / 250 ms poll)
|error| > 400 ms  → hard seek to target + measured seek-lead, remeasure
40–400 ms         → playbackRate = 1 + clamp(error/2000, ±0.06)   (chase over ~2 s)
< 40 ms           → fine servo: rate = 1 + error/10000; deadband ±10 ms → rate 1.0
```

- Measurement uses `requestVideoFrameCallback` (`mediaTime` = the frame actually presented; shipped in Chromium 83 = our Taurus floor) with a `timeupdate`/poll fallback behind feature-detection.
- Signage videos are muted by default (schema default `muted=true`) so playbackRate pitch artifacts are moot; ±6 % is invisible for motion.
- `onEnded` no longer advances in sync mode (the timeline owns advancement); solo-video playlists keep native `loop` but get the same servo (loop phase = `P mod videoDuration` — deterministic).
- First-frame latency (`play()` → paint, typically 30–120 ms on kiosk hardware) is measured per device via rVFC on each start and fed back (EWMA, persisted in localStorage) as a start-lead so videos *begin* on the boundary, not after it.

## 7. Data model + API surface (additive only — V1 pilot rules)

Schema (nullable columns, zero behavior change until set):
- `ScreenGroup.syncMode String?` — `null`/`'off'` = today's behavior; `'locked'` = synchronized playback for every screen in the group.
- `Screen.syncOffsetMs Int?` — per-screen latency trim (±ms), operator-set, for display-pipeline differences.
- `Screen.lastSyncReport Json?` + `Screen.lastSyncReportAt DateTime?` — telemetry (mirrors the `lastCacheReport` pattern).

Manifest (per-screen, rides the existing response — group is already `include`d in the query): a `sync` block `{ enabled, groupId, trimMs, serverNowMs }`. `serverNowMs` gives a coarse first-fix before the WS burst locks.

WS gateway: `TIME_PING` case → direct `TIME_PONG` reply (no Redis, no signature — control message like AUTH_OK). `AUTH_OK.serverTime` upgraded to `TimeSyncService.now()` too (strictly better for the emergency freshness gate).

Telemetry: the existing `POST /screens/:id/render-proof` body (already posted every ~30 s while rendering) gains optional `sync { errMs, clockUncertaintyMs, rttMs, locked, contentSig }`; controller stores it in `lastSyncReport`. Fleet endpoint surfaces it → dashboard badge.

## 8. Operator UX (30-second happy path)

1. Screens page → group card → **"Frame-lock this group"** toggle (one toggle, no sub-settings — `feedback_dont_overengineer`). Explainer sentence + "screens in this group play the same schedule in perfect sync."
2. Publish the same playlist to the group (already the normal flow — group schedules).
3. Badge per screen: **IN SYNC ±Xms** (green) / **LOCKING…** (amber) / **CONTENT MISMATCH** (grey — screen resolved different content, e.g. a per-screen schedule overrides the group's) / no badge when off.
4. Per-screen **trim** field in the screen diagnostics drawer (next to canvas picker) for the one-in-five venue mixing display models: point phone camera at both screens, nudge until aligned.
5. Player HUD `?synchud=1` (and via the existing diagnostics long-press): big beat-bar flashing on the synced second + clock/uncertainty/error readouts — filmable proof, Greg-style verification.

## 9. Failure modes & the answer built in

| Failure | Behavior |
|---|---|
| WS down | HTTP time fallback (coarser but live); clock coasts on drift model; sync holds within a few ms for hours |
| Server unreachable entirely | Clock coasts; screens stay mutually locked (they share the last-locked timebase); telemetry flags stale |
| One screen reboots | Rejoins in phase on first lock (<2 s after WS connect) — no operator action |
| Playlist edited | All screens converge as manifests propagate (≤1 poll interval); brief mismatch is visible in telemetry, self-heals |
| Asset fails on one screen | Slot held with fallback card, phase preserved, re-converges next boundary; failure reported |
| Clock poisoned / big skew | >250 ms error steps once + re-locks; uncertainty gate prevents engaging sync on garbage clock |
| Mixed display models | Fixed offset — per-screen trim cancels it |
| Emergency trigger | Overrides are push-based full-screen takeovers ABOVE the rotation layer — unchanged, arrive near-simultaneous as today; rotation underneath stays on-clock so ALL-CLEAR resumes in perfect phase automatically |

## 10. Rollout safety

- Everything is gated on `syncMode === 'locked'` from the manifest; **null = byte-for-byte today's code path**. The pilot fleet sees zero change until a group is explicitly flipped.
- No emergency-path semantics touched (the freshness gate only gets a *better* clock).
- Taurus/Chromium-83 rules honored: no `inset` shorthand anywhere in new code, rVFC feature-detected, `gap` avoided in player surfaces, plain rAF + setInterval only.
- Tests: Jest on the pure resolver + clock filter math; Playwright two-context harness with a mocked time endpoint asserting cross-page flip skew; HUD for physical verification.

## 11. What this unlocks later (not built now)

- **Video-wall spanning** (each screen renders a crop of one canvas) — the hard part (shared clock + timeline) is this feature; spanning is "add a viewport transform."
- Synced widget boards (clock/countdown widgets driven off `syncedNow`).
- Tenant-wide sync scope (all groups locked to the same phase) — trivial under epoch anchoring, it's already the case for identical playlists.
- PoP/ad-proof: "these N screens provably showed sponsor X at the same instant" from `lastSyncReport` history.
