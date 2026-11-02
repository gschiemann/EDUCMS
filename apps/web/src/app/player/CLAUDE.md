**Scope:** this file governs `apps/web/src/app/player/` — the web player that runs on the screens (inside the APK's WebView and in kiosk browsers); `/CLAUDE.md` and `/AGENTS.md` are the core it refines — where they disagree, the core wins. The text below moved here verbatim from the old single-file `CLAUDE.md` on 2026-11-01 (move map: `docs/governance/decisions/2026-11-01-rulebook-restructure-map.md`). Rules 9, 11, 13 and 15, part (f) of rule 17 and sync rule 7 live in the nested rulebook where that work happens; their numbers stay here so "rule N" keeps its meaning.

# Web player rulebook

## Player Reliability — non-negotiable (2026-08-30)

A reliable player continuously proves FOUR SEPARATE FACTS — never let one stand in for another:
(1) the Android process is alive; (2) the device credential is valid or proactively renewing;
(3) the latest assigned manifest was fetched and applied; (4) that content is visibly loaded.
Incident: `docs/incidents/2026-08-28-player-1-1-6-fleet-failure.md`

**Binding rules for any player / manifest / recovery change:**

1. **The credential is a lifecycle, not a boot step.** The web player proactively re-registers
   while its token is still valid (`deviceCredential.ts` — 10-min timer). `requiresRePair` is a
   real persisted state (`Screen.authState`, server-stamped): content keeps playing on renewed
   1-hour tokens, the dashboard says "re-pair required". Never make an expired/unproven token
   long-lived to stop a 401; never let fingerprint knowledge upgrade a credential (DEVAUTH-01
   `unproven` claim + epoch checks stay exactly as they are).
2. **A device-token 401 gets ONE controlled recovery** (`attemptCredentialRecovery`: single-flight,
   60 s cooldown), counts as a REAL failure, and never silently decrements any counter.
3. **One token store per side.** Web: localStorage, written only by server-accepted mints; a
   URL `?token=` is adopted ONLY when storage is empty (`trustGuards.resolveDeviceToken` —
   stored-wins is what ended the downgrade loop). Native: `edu_player`/`device_token` (the
   `setDeviceToken` bridge), with the legacy DataStore migrated then cleared. Never add a
   second writer to either.
4. **Every `fetchContent` trigger goes through the single-flight `manifestGate`.** Never add a
   raw call/timer that bypasses it — overlapping reconciles are how stale responses win. And
   every await a serialized chain depends on is bounded **ACROSS THE BODY READ**
   (`fetchJsonBounded`) — `fetch()` resolves at headers, so a timeout cleared there still lets a
   200-then-stalled-body proxy wedge the chain (deep-audit F1: the first fix bounded only
   headers and its own test codified the hole). Emergency triggers (OVERRIDE/ALL_CLEAR) use the
   preempt lane (`preemptReconcile`) so a slow normal fetch can never queue an alert.
5. **Never equate signals:** TCP `open` ≠ realtime connected (only AUTH_OK resets the WS failure
   counter / stands down SSE-HTTP fallbacks); `onPageFinished` ≠ page success (error documents
   don't count — `LoadOutcomeTracker`); a bridge heartbeat ≠ content health (`heartbeatV2`
   carries `syncOk`; the content watchdog is dormant for old bundles); document rAF ≠ proof the
   assigned media is advancing; `lastPingAt` ≠ content-ready (the fleet UI grades via
   `deriveRenderTrustGrade`, which also carries `authState`).
6. **Recovery commands must survive a dead push channel.** REFRESH_WEB rides BOTH Redis pub/sub
   AND the manifest (`pendingRefreshAt` → `refreshRequestedAt`), acknowledged by VALUE identity
   (`refreshAckMs`), never by clock comparison — signage boxes run minutes of skew and a
   timestamp inequality reload-loops them.
   Explicit POWER_ON also rides the authenticated native status heartbeat, because an asleep
   WebView cannot consume Redis or a manifest. Its five-minute server TTL and persisted bounded
   attempts use one identity shared with the live displayApply path. A later physical OFF
   suppresses retries of that old identity. Native ACK requires observed Android interactive
   AND Player foreground; it never stamps content render/cache proof. This requires the new
   native implementation (`heartbeat/NativePowerOnPolicy.kt`); a build without it — Player 1.1.23 was one when this rule was written — has no such unattended wake command transport.
7. **Manifest schedule order is deterministic** (`effective-schedule.ts`: screen-pin > group,
   priority desc, newest startTime, stable id) and the player applies the first window-open
   replace winner — "any template wins" must never come back. Template apply signatures include
   `contentRev`; template identity alone is not a content version.
8. **Escalation math must be provably reachable**: any N-fires-in-window rule needs
   window ≥ (N-1)×cooldown + generous jitter slack, with a test using realistic sweep
   timestamps (`screen-wedge-detector.spec.ts`). 230 fires / 0 escalations was the live proof
   of the old broken math.

9. Moved to `apps/player/CLAUDE.md` (rule 9 — the APK, the bridge contract and the hardware qualification gate).

10. **Copy states what the evidence proves** — "no render proof for N minutes", never "showing a
    frozen frame" from a system that cannot see the glass.

11. Moved to `apps/api/src/emergency/CLAUDE.md` (rule 11 — emergency logic runs first; protective caches never clear on absence).

12. **New enforcement semantics never ride in silently on a reliability wave** (deep audit
    B-P0-1/2/3): the ranked-winner change switched on schedule-window enforcement for the first
    time ever with latching bugs. If a fix activates behavior operators could observe, it ships
    deliberately — named, tested per shape (`scheduleWindow.ts`), with edge-refetch for anything
    the ETag can't see.

13. Moved to `apps/player/CLAUDE.md` (rule 13 — the player release).

14. **Player e2e harness rules** (each cost a real debug cycle): never replace
    `window.WebSocket` wholesale (Next dev HMR uses it — a dead stub stalls the entire page
    boot with no errors; delegate non-`/realtime` URLs); StrictMode double-fires mount effects
    in dev, so mocks key on STATE, never call counts; splash text must not read
    window/navigator inline (`bootMounted` two-pass gate — the inline reads hydration-failed
    every kiosk boot for months); before dispatching a synthetic remote event, wait on a
    bootMounted-gated element (SSR paints the splash text BEFORE listeners attach — webkit
    caught the race).

15. Moved to `apps/player/CLAUDE.md` (rule 15 — every operator-facing surface is remote-operable).

16. **Screen-sized publication is a staged delivery, not a database boolean**
    The repair lives in
    `schedules/media-publication.service.ts`: publish queues a 1080p video
    rendition (or prepares a 1080p image copy), keeps the previous schedule
    active while video encodes, records `Schedule.pendingMedia` and an explicit
    error if preparation fails, then atomically displaces the old schedule,
    audits and sends signed SYNC. `screens/video-rendition.ts` picks a URL,
    hash and byte size as one unit from validated `Asset.processingMeta.renditions`
    for 1080p screens; 4K screens keep the original 4K file. Normal manifest
    resolution uses this selection; do not alter the emergency branch as part
    of signage optimization. The image upload cap is 3840px so 4K photos retain
    detail, with a 1920px copy made when publishing to 1080p. The player apply
    signature includes media URL/hash, so a replacement under one playlist item
    id re-applies. Render proof reports `idle:content-unavailable` while its
    fallback page is visible; fresh `lastRenderedAt` alone never means a
    picture is confirmed. A completed rendition wakes the legacy schedule
    sweep immediately; if an already-active 1080p screen still reports the
    old 4K URL, it gets an audited, durable, screen-scoped `REFRESH_WEB` so
    an older player bundle cannot hold that URL until its 15-minute bundle
    check. Do not broadcast a tenant-wide reload for one asset. Delivery UI
    distinguishes playback reports, stalls,
    and publish intent. Manifest cache revision MUST advance after a mutation
    commits; advancing before it allowed an old snapshot under a fresh revision
    for up to the cache TTL. Keep the pending-media migration with any schema
    changes; production runs `prisma migrate deploy` before API boot. Verify
    this end-to-end on a physical 1080p unit and a 4K unit before claiming
    fleet-ready: manifest URL/hash/size, no Content Unavailable interval,
    dropped-frame telemetry, and truthful delivery label.
    Incident: `docs/incidents/2026-09-24-4k-to-1080p-playback.md`

    The same incident also corrected Media Library wording: an Asset's
    `PUBLISHED` database status means approved for use, not sent to a screen;
    the upload card may say "Optimizing for screens" only while work is active,
    with completed optimization facts in file details, and encode warnings
    must name the actual missing spec (for example fast-start index), not
    repeat properties the file already has. `PlaylistEncodeBanner.tsx` names
    per-file fixes. Canva's 4K MP4 export is suitable source material; the
    CMS, not the operator, owns screen-specific playback preparation.

    Follow-up (2026-09-25): the 1080p rendition is metadata on the original
    Asset (`processingMeta.renditions['1080p']`), not a second library row.
    Media Library details show its verified size and dimensions; queued jobs
    show their actual percentage. Publishing copy is a short information note,
    upload diagnostics sit behind Technical details, and a playlist with
    `pendingMedia` shows PREPARING 1080P rather than a stale delivery receipt.
    Once the copy exists, the resolution warning is suppressed for 1080p
    screens. Do not invent a countdown or call a pending playlist delivered;
    only the player's own playback report can confirm that.

    The generic `PUT /playlists/:id/active` must never turn a pending rule on:
    it rejects an active-true request while `pendingMedia` exists and filters
    activation by `pendingMedia: false` against a concurrent queue. Turning
    the playlist off cancels pending publication so the sweep cannot silently
    reactivate it afterward. Its fleet-copy cascade follows the same rule.
    Per-screen rule changes also refuse while a copy is pending, and their
    writes guard against a concurrent pending transition.

    Field follow-up (2026-09-25, 4K Android screen): The web player's playlist
    precache previously marked a URL set sent BEFORE the service worker
    confirmed any bytes, so one failed attempt could leave the screen
    streaming indefinitely. It now waits for a worker acknowledgement,
    retries failures (including an old service worker that never acknowledges
    the new request), keys the cache push by the actual media URL (not stable
    playlist item id), and supplies known size to avoid re-reading a large
    video body. A timed-out cache status is UNKNOWN, not "0 files"; an old
    report is labeled unavailable. Do not claim the field device is fixed
    until its live cache report shows the file and a fresh video sample is
    smooth; format compatibility alone cannot prove device decode quality.
    Incident: `docs/incidents/2026-09-25-4k-field-follow-ups.md`

    Deletion follow-up (2026-09-25): operators may confirm deletion of an
    in-use Asset or a published regular Playlist. Asset deletion removes its
    playlist items, retires rules for playlists left empty, applies screen
    fallback, audits the action, and cleans storage after the database commit.
    Playlist deletion removes its rules and direct fleet copies, applies
    fallback per tenant, audits each tenant, then signals SYNC. Protected
    emergency content still cannot be deleted through these regular actions.
    The warning is enforced by the SERVER (2026-09-26): an in-use asset or a
    published playlist (any rule, paused too, or a location copy) is deleted only
    with `?confirm=in-use`, which the dashboard sends only from the warning the
    operator confirmed; without it the API answers 409 `ASSET_IN_USE` /
    `PLAYLIST_PUBLISHED` with the usage (`common/in-use-delete.ts`), so an old
    open tab or an API client can never delete live content silently. The flag
    never overrides an emergency refusal.

    Compatibility-before-size follow-up (2026-10-04): "support as many files as possible, but they must
    work 100% of the time." A video the players cannot all decode (`screenCompatibilityIssues`,
    `storage/video-transcode/transcode-profile.ts`: codec, 10-bit, HDR, container, interlaced, anamorphic,
    rotation tag, > 30 fps …) is CONVERTED and the copy replaces the original at ANY size; "swap only when
    smaller" applies to screen-safe files alone. Delivered video is ≤ 30 fps. `processingMeta.screen`
    (`{ ready, issues?, convertedFrom?, error? }`) is the verdict on the file an asset serves: honour
    `ready: false`. The colour chain (`scale=out_transfer=…`) needs ffmpeg ≥ 8 — the Dockerfile fails the
    build without it. A converted file is never converted again (the spec sweeps 4,000 output shapes).

17. **A big file downloads WHOLE, in short verified resumable steps, and only
    THEN plays — never streamed from origin, never a lower-resolution stand-in**
    Rules:
    (a) an asset ≥ 8 MiB is acked as `pending` and the PAGE drives it through
    `PRECACHE_CHUNK` (one Range request ≤ 32 MiB, aborted at 240 s, staged by
    byte range under a per-offset temp key, resume free) → `PRECACHE_VERIFY`
    (streamed SHA-256) → `PRECACHE_ASSEMBLE` (disk→disk into one entry, explicit
    target tier); no unverified byte ever lands under the real URL;
    (b) the playlist precache passes the manifest `asset_hash` for non-image
    assets — without it a video was a null-hash entry re-downloaded every 24 h;
    (c) retries run on the 15 s tick + `online` through
    `PlaylistCacheRetryPolicy`, never only on a manifest apply (unchanged polls
    are 304s); (d) **readiness-gated playback** (`mediaReadiness.ts`, pure,
    tested per shape): a LARGE item — the worker's own rule, ≥ 8 MiB or a video
    URL with no size, and the test vm-loads the worker to prove both sides agree
    — is never mounted (not even as the hidden next-up) until its native bytes
    are on disk (`CACHE_LOOKUP` `present`, or landed by the drive). Free-run: the
    monotonic counter is re-aimed at the first playable slot and every advance
    steps to the next playable one, so ready items rotate while the rest
    download; one ready item is a solo slide. Sync (`Playlist.syncPlayback`, the manifest's `sync.enabled`): the
    timeline slot is NEVER moved — an unready slot is HELD (the screen keeps its
    last shown slide) so on-screen stays f(manifest, syncedNow). A new playlist
    with nothing ready is DEFERRED while regular content is on glass
    (`decidePlaylistCommit`; its files ride `keepUrls` so the worker's prune
    cannot evict what is still playing) and goes up from the readiness effect
    when the first file lands; first boot shows the splash with the real
    download (bytes, percent, file) and proves `idle:content-downloading`,
    never `pl:`. A player with no service worker / a failed registration
    (`cacheDrive: 'unavailable'`) streams everything — never stranded; an
    emergency playlist is exempt (rule 11). Small files mount at once as before.
    (e) **adoption, never re-download**: an entry cached before digests were
    stored is `adoptable` — `PRECACHE_ADOPT` streams the CACHED bytes through
    the incremental SHA-256 in its own event (small files inline in
    `fetchAndStore`) and a match writes the meta rows; a mismatch changes
    nothing and the verified download replaces the entry on assemble. A screen
    is never taken off a file it is playing to re-verify it: a present-but-
    unverified entry counts as ready.
    (f) Moved to `apps/api/src/emergency/CLAUDE.md` — the emergency tier, large files only.
    Incident: `docs/incidents/2026-09-26-4k-cache-fill.md`

## Frame-Locked Multi-Screen Sync (2026-07-28)

Screens whose playlist has **Sync playback** on (`Playlist.syncPlayback` — the ONLY
switch since 2026-09-29, `apps/api/src/screens/screen-sync.ts`; a group's legacy
`syncMode` locks nothing) play their shared schedule in lockstep (flips land within
a frame across screens). The video servo's seek decisions live in
`apps/web/src/app/player/sync/videoServo.ts`: never seek while a seek is in flight,
a MEASURED seek lead, and hard seeks paused 10 min when they keep landing late — the
old blind 80 ms-lead seek looped forever on slow-seeking panels and froze them. Rules when
touching the player or realtime layer:

1. **THE INVARIANT: while sync is active, what is on screen is a pure function
   of (manifest, syncedNow).** Never add a free-running advance path (a
   `setCurrentIndex(prev+1)` from onEnded/onError/timers) without gating it on
   `syncActiveRef.current` — one screen advancing out-of-band breaks the whole
   group's phase. The rAF conductor in `player/page.tsx` owns advancement.
2. Pure math lives in `apps/web/src/app/player/sync/` (`syncClock.ts`,
   `syncTimeline.ts`) — unit-tested without mounting the 16k-line page (`player/page.tsx`). Keep
   it pure (no React/DOM/network).
3. Clock transport: WS `TIME_PING`→`TIME_PONG` (direct socket reply, like
   AUTH_OK) + HTTP `GET /api/v1/realtime/time` fallback. Server time comes from
   `TimeSyncService` (Redis-TIME-aligned so multi-replica agrees) — never raw
   `Date.now()` in gateway time responses. Player timebase is
   `performance.now()`, never `Date.now()` (Android NTP steps).
4. The manifest `sync` block is part of the ETag-hashed payload (toggle/trim
   changes bust the 304). **Never add a volatile per-request clock field to the
   manifest** — it would kill 304s fleet-wide; clock samples ride the dedicated
   endpoints above.
5. Tests that must stay green (CI runs them and reports; none is a required check today —
   see Deploy Reliability): `apps/web/src/app/player/sync/__tests__/` (Jest),
   `apps/web/tests/e2e/multiscreen-sync.spec.ts` (two-screen lockstep harness,
   chromium+webkit), `realtime.gateway.spec.ts` (TIME_PONG echo).
6. Diagnostics: `/player?synchud=1` renders the filmable sweep-bar/flash HUD;
   `window.__eduSyncState` / `__eduSyncFlips` expose live sync state; per-screen
   telemetry lands in `Screen.lastSyncReport` via the render-proof POST.

7. Moved to `packages/database/CLAUDE.md` (the manifest content cache — content writes go through `prisma.client`).

## Video loop behaviour

These descriptions used to sit inside rows of the environment table. The variables, tokens and defaults stay in `docs/ENVIRONMENT.md`; the behaviour is here, once.

### Continuous loop (`PLAYER_LOOP_CONTINUOUS`)

The player still requires a solo, muted, unsynced H.264 MP4, MSE/rVFC and a verified source digest. Locally fragments the verified cached source without re-encoding/downscaling, then appends repeats to one advancing timeline with bounded buffers; unsupported profiles, corruption or stalls revert once to native with a per-file 24 h block. Emergency/sync/audio/mixed playlists remain excluded. Hardware evidence is rVFC compositor timing, not an on-glass camera or full qualification matrix. See `docs/player/CONTINUOUS-VIDEO-LOOP.md`.

### Two-deck seamless loop and copy collapse (`PLAYER_LOOP_TWODECK`)

The player measures the seam either way (`lastVideoReport.loop`: `maxHoldMs`/`p95HoldMs` past one frame period, `maxSkipMs` trimmed, evidence = `requestVideoFrameCallback`) and falls back to the native loop by itself if the hand-off ever misbehaves, so this is a rollout switch, not a safety net.

**Real-hardware results (2026-09-29): it works on Amlogic T982 / Android 13 / WebView 101 (native seam 156–200 ms → hold 0 ms after the first lap, skip converging) and self-disables on T982 / Android 11 / WebView 95 (the second `<video>` never starts while the first plays: `handoff-timeout:rs4p0t0`, 24 h block, native loop keeps playing) — so leave it a named-screens switch, not `all`.** Independent of this switch, EVERY screen now collapses a playlist whose items are all the same video file to ONE item (`apps/web/src/app/player/collapseCopies.ts`): N copies are one video repeating — one decoder, no cut to black between laps.
