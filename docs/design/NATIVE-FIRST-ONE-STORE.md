# Native from the first frame, one verified store — design

Status: **design proposal, not built.** No code changes with this document. Written 2026-10-18 for
the player rock-solid program, from master `30cf28c2` (player 1.1.42-field.1 merged), the live
fleet database and the device logs uploaded in the last three weeks. Nothing here is
hardware-qualified; every timing below is a model with its assumptions shown (§9) until the bench
measures it.

**In one paragraph.** Today a solo video on a native-capable screen plays on the web engine first,
and the Android app's hardware engine takes over later from its own second download. This design
moves the engine decision before the first mount: when the file is verified on disk, the
hardware engine shows frame 0 and the web `<video>` is never created. The app owns one verified
content store that both engines read: one download and one copy per file. The app also owns the
playback session, so a page reload or a WebView crash no longer takes the picture off the glass.
Emergency behaviour does not change, and §7 makes that a ship gate. Rollout is a lead-only switch,
class by class, and switching it off restores today's behaviour.

## Binding rules this design is held to

| Rule | Source | What it forces here |
|---|---|---|
| A big file downloads **whole**, in short verified resumable steps, and only then plays; never streamed from origin, never a lower-resolution stand-in | CLAUDE.md player rule 17; owner 2026-09-26 | The store keeps the ≥ 8 MiB threshold and the readiness gate. The WebView interceptor refuses an unverified large content file instead of letting it reach the network (§5.8). |
| Emergency logic runs first; protective caches never clear on absence; a cached manifest may raise an alert but never release one | Rule 11 | §7 (ship gate) |
| At most one seamless takeover per content, never web ↔ native flip-flop | Owner 2026-10-12 | The target is **zero** takeovers (§3) |
| Native-first: the best engine on every class; web is the safety net | Owner 2026-10-17 | The decision defaults to native wherever the class can compose it (§3.1) |
| Engine behaviour auto-detects per device; no operator setting; env flags are lead kill switches only | Owner 2026-10-18 | The switches in §8 are lead-only. The WebView range self-test (§5.8) is automatic. |
| No device owner | Owner 2026-10-17 | Nothing here needs it |
| No new bridge method without the three-file contract | Rule 9 | No new method at all. New message versions ride the existing four (§3.5), as protocol 3 did. |
| Playback survives the page | Lead 2026-10-18 | §4 |
| Native-first must never break emergency alerting | Owner 2026-10-18 | §7, with its own test plan and ship gate |

---

## 1. What happens today (code-verified)

### 1.1 The web-first path, step by step

For a solo, muted MP4 on a face the server enrolled (`nativeVideo` descriptor,
`apps/api/src/screens/native-video.ts`) and an APK that answers protocol ≥ 2:

1. **The page applies the manifest** and pushes every playlist URL to the service worker
   (`page.tsx` ~6750, `startPlaylistPrecache`). Files ≥ 8 MiB go through the page-driven chunk
   protocol: `PRECACHE_CHUNK` / `PRECACHE_VERIFY` / `PRECACHE_ASSEMBLE` in `offline-cache.ts` and
   `sw-player.js`. VERIFY is a streamed SHA-256 written in JavaScript (`sw-player.js:1584`), and
   ASSEMBLE copies the staged chunks disk-to-disk into the playlist tier.
2. **Readiness gate.** A large item is not mounted until the worker confirms it on disk
   (`mediaReadiness.ts`, `cachedMediaKeys` from `CACHE_LOOKUP`). The gate runs before the native
   wrapper is built: `if (!ready) return null;` comes before `wrapNative` (`page.tsx` ~12523).
   **So the native engine cannot even begin until the service worker's copy is complete.**
3. **The web player mounts** inside `NativeDualVideo` (`NativeDualVideo.tsx`) and plays from the
   worker's cache. With the default continuous loop backend (`PLAYER_LOOP_CONTINUOUS` unset =
   all), `ContinuousLoopVideo` waits for its first frame and then builds a fragmented copy of the
   clip in a separate CacheStorage cache, `venueos-continuous-loop-v1`
   (`continuousLoopPackage.ts:153`). Nothing ever prunes that cache. The only delete
   (`continuousLoopPackage.ts:260`) removes a failed attempt's own namespace.
4. **In parallel, native prepares.** `sharedVideoPrepare` sends identity only, never a URL. The
   app fetches its own authenticated manifest (`SharedVideoSource.manifest`) and then downloads its
   **own** copy into `filesDir/native-video-v2/<tenant>/<sha256>.mp4` (`FaceVideoBox.kt:148`,
   `SharedVideoSource.verifiedFile`). The protocol-1 pair engine used `shared-video-v1/`, and those
   copies may still be on double-sided rk3288 units. The download is **one GET with no resume**: a partial
   file is deleted in `finally` (`SharedVideoSource.kt:98–137`), within a deadline of
   max(5 min, size ÷ 128 KiB/s). After a reboot the copy is re-hashed in full before it may play,
   because the "already verified" memo lives only in process memory (`VerifiedFiles`,
   `SharedVideoSource.kt:173`).
5. **Native reports ready.** The page then waits for the web clip's own loop point
   (`NATIVE_HANDOFF_BOUNDARY_WAIT_MS = 60_000`, `NativeDualVideo.tsx:51`), copies the last web frame
   into a canvas, releases the web decoders and commits. Native reveals its surface above the
   window (the 1.1.41 contract) and the page hides the canvas once fresh frames arrive.

### 1.2 What that costs

| Cost | Evidence |
|---|---|
| **A visible engine switch at every boot, reload and content change.** Every page load (nightly reboot, nightly bundle apply, Resync, wedge reload) plays one web lap before the takeover. A content change A → B goes native A → web B → native B, which is two switches. After an all-clear, a fresh mount goes web-first again. | Steps 2–5. The uploaded logs show surface-attach → reveal-request gaps of about 0.3 s when no loop-point wait applies and about 47 s when one does. Log uploads are batched, so these timings are indicative only. |
| **Two downloads before native**, run back to back, not in parallel. | Step 2: the gate blocks the native mount until the service worker has the file. |
| **Up to three copies on disk** of each clip, plus fragmented copies of every clip ever played on the web continuous engine. | The service worker entry, the loop package and the native copy. FaceVideoPolicy also keeps the newest *previous* native copy (`prune(keepExtra = 1)`). |
| **The first lap runs on the weaker engine.** | The web MSE engine posts 3–4 sub-100 ms waits per minute on the Android 11 launch class (2026-10-17 player audit, kept outside the public repo). |
| **The picture depends on the page.** A main-frame document change ends every native session (`MainActivity.kt:3261` → `SharedVideoHost.invalidate()` → `document-retired`). So do a page that stops polling for 10 s (`page-lease-expired`, `FaceVideoBox.kt:683`), a WebView replacement (`host-replaced`, `FaceVideoBox.kt:153`) and a page stop (`page-stopped`, `:520`). | Code |
| **Latent defect: network and storage failures are graded as file faults.** Session-ending reasons come from `FaceVideoReasons.code(e, fallback)`. An offline manifest read ends `authorization-failed`. A 5xx ends `manifest-http-5xx`, a socket timeout `timeout`, and a short download `media-incomplete` or `source-failed`. None of these is in the page's transient list (`NATIVE_VIDEO_TRANSIENT_REASONS`), so `nativeVideoNext` answers `block`: web for 24 h. **An offline boot blocks native for a day.** | Code reading. There was no field instance in 21 days of `PLAYER_RECOVERY_EVENT` rows (blocks seen: `hardware-codec-unavailable` ×10, `credential-changed` ×2), because the native screens are online. Native-first must fix this, and it can be fixed now on its own (§12, D7). |

### 1.3 What the best players do

BrightSign decodes video in hardware onto a video plane and draws HTML on a graphics plane above
it. Android signage apps built on ExoPlayer/Media3, and the panel makers' own players, start video
natively and use a web layer only for HTML content. As the owner put it, nobody starts web and then
flips to native. Our shape is historical: the page held the whole brain, and native arrived on
2026-10-12 as a takeover bolted onto it.

---

## 2. The shape in one picture

```
             authenticated manifest + emergency set (device credential, per face)
                                   │
            ┌──────────────────────┴───────────────────────┐
            ▼                                              ▼
  PAGE (WebView) — decides                      APP — stores and presents
  • applies the manifest, emergency FIRST       • ContentStore: one verified copy per file,
  • decideFaceEngine() before any mount           chunked + resumable, emergency set PINNED
  • renders HTML / templates / mixed / sync     • Playback sessions it OWNS (lease, §4);
  • renders every alert (web, always)             they survive a page reload or crash
  • asks:  sharedVideoPrepare v4 "intend"       • serves the WebView from the store through
  • reads: sharedVideoState (+ store block)       request interception (phase 2, §5.8)
            │                                   • emergency hold + native alert watch
            └────────── existing 4 bridge methods ──────────┘
```

Three sentences carry the whole design:

1. **The page decides.** It remains the only controller of what plays: schedules, dayparts,
   templates, sync, and every alert.
2. **The app stores and presents.** One verified copy per file, and a native session that lives as
   long as its intent, not as long as the page.
3. **The alert path can always stop the app.** The emergency hold removes every native surface,
   whatever state the page or the session is in (§7).

---

## 3. Native from the first frame: the decision moves before the mount

### 3.1 One pure decision per face, `decideFaceEngine`

A new pure module next to `mediaReadiness.ts`, evaluated whenever the page would mount a slide.
Inputs, all already known to the page:

| Input | Source |
|---|---|
| Content is one solo, muted MP4 with no daypart (copies collapsed) | manifest, `collapseCopies.ts`, `sharedVideoEligible` |
| The server's `nativeVideo` descriptor for this face matches the item (asset id + sha) | manifest (enrolment unchanged; planned to move from screen lists to the device-class table) |
| The app answers `protocolMax ≥ 4` and its class says `nativeSolo` and `nativeFirst` | `sharedVideoState.device` (1.1.41 class table) |
| No live native block for (sha, face, APK build) | `nativeVideoBlocked` |
| Not emergency content, no emergency hold raised, not sync, not preview | page state |
| The file is **verified in the store** | `sharedVideoState.store.ready` (§6) |

Output: `native`, `wait` or `web`, plus a reason code that is logged once per decision change.

| Case | Decision | What the glass shows |
|---|---|---|
| Native-eligible, file verified | **native** | Native frame 0. The web `<video>` is never created. |
| Native-eligible, file not yet verified | **wait** | The current content stays. At first boot, the splash shows the store's real download (name, bytes, %). Never a web lap, never streaming. |
| Not a solo muted video: template, mixed, audio, sync, canvas override | web | Web engine, as today. Protocol 3 slots inside mixed playlists keep their own `prerollOnly` rule, which is already native-or-web for the whole pass. |
| Class not native (Taurus), protocol < 4, switch off | web | Today's behaviour, byte for byte |
| Live native block (a real decoder fault of this file on this build) | web | The web engine plays the **same verified file** (served from the store in phase 2) |
| Emergency content or a hold raised | web | The alert, rendered by the page (§7, E2) |

Operator overlays (update prompt, soft blank/dim, canvas editor, touch overlay, the Back menu) are
**yields**, not engine choices. Native steps aside for them as it does today
(`canOwnWindow`/`yieldToUi`), and the same content resumes natively when they close.

### 3.2 Every transition, and what is on the glass

| From → to | Today | Designed |
|---|---|---|
| Splash (boot) → native video | Web lap, then a takeover at the loop point | The splash stays until native's first frame is composed above the window, then a hard cut to frame 0, which is what every player does at boot. Native's surface needs no hole: the WebView stays opaque black and the surface is above the window (1.1.41 contract). |
| Native A → native B | A stops, web B, then native B a download later | A keeps playing until B is verified in the store. B pre-rolls (§3.3) and swaps at A's own loop end. |
| Native A → web content (template, images) | A stops at commit | The page mounts the web content beneath A, which is invisible behind the surface, and waits for its first paint. It then sends `release at: boundary`, and A stops at its next loop end (bounded at 60 s, as today's handoff wait). |
| Web content → native B | — | The web content stays until native's first post-reveal frame (the existing confirm-by-render rule), then the page unmounts it. |
| Native A → alert | The hold removes the surface; afterwards the content comes back web-first | Same removal (§7). After the all-clear, A starts again natively (one start, never a web lap). |
| Page reload / WebView crash during native A | A ends, web lap, takeover | **A keeps presenting** (§4). The new page re-attaches and nothing happens on the glass. |

### 3.3 The native → native boundary switch

- **Pre-roll (preferred).** The next session prepares while A presents: selection, the store file,
  a surface (parked beyond the display on `static_above`, beneath the window on `dynamic_above`), a
  decoder, and a held first frame. Protocol 3 already does exactly this for slots. At A's loop
  wrap (native counts its own laps), one UI pass moves B onto the glass. On `dynamic_above`, A is
  removed once B's first post-reveal render confirms. The pass checks `DisplayEmergency.isHeld`
  first, as protocol 3's `play` does today.
- **Fallback when a second decoder is refused** (`decoderAllowed(preroll = true)` false, the
  codec's advertised instance limit, or 4K memory). A's surface keeps its last frame while A's
  decoder is released, B's decoder starts, and B is revealed on its first frame. The viewer sees
  A's last frame held for the codec start time (to be measured; expected well under a second).
  It is still native and never black or web.
- Two solo sessions on one face exist only for the length of a swap. On a double-sided unit the
  budget counts every face (`FaceZonePolicy.MAX_DECODERS = 4`, pre-roll refused one decoder early,
  so the picture on glass always wins).

### 3.4 Failure policy (replaces the `wasOnGlass` rule)

| Native end | Today (`nativeVideoNext`) | Designed |
|---|---|---|
| Transient: `emergency-held`, `activity-paused`, `operator-ui`, `content-changed` | Retry, or **stay web** once native was on glass | **Native again** on the next start. There is no web picture in between to flip from: the alert or the operator UI was on the glass. |
| Not ready: file missing, network, storage, authorization (`not-in-store`, `manifest-unreachable`, `store-full`, `credential-*`) | Many of these grade as faults → 24 h block (§1.2) | **Wait.** These are never a verdict on the file. The store retries; the current content or splash stays. |
| Real fault of a verified file: decoder or codec failure, stall | 24 h block | 24 h block, keyed by file, face and build as today. **The web engine plays the same verified file.** That is one engine for that content, not a flip. |
| Repeated transient ends (more than 5 in 10 min for one content) | 20 attempts | Settle on web for that content until it changes or the page reloads. Logged to the ledger, never a loop. |

Every reason the app emits is one of a closed set of codes. The page's transient, not-ready and
fault sets and the app's `FaceVideoPolicy` sets are generated from one table, so they cannot drift
apart (the drift is the defect in §1.2).

### 3.5 Protocol: version 4 messages on the existing four methods

No new bridge method, so the canary count in `nativeBridge.test.ts` and `KNOWN_METHODS` are
unchanged. A `version: 4` message selects the behaviour, just as `version: 3` selected slots. The
app advertises `protocolMax: 4` only when its class table and the switch allow native-first, so an
older web bundle never sees it, and a newer bundle on an older app keeps today's path.

| Method | v4 message | Meaning |
|---|---|---|
| `sharedVideoPrepare` | `{version:4, op:"intend", screenId, revision, sha256, assetId, start:"now"\|"boundary", lease}` | This face's solo intent. It replaces the previous intent. Identity only: no URL, no token. |
| `sharedVideoPrepare` | `{version:4, op:"release", lease, at:"now"\|"boundary"}` | No solo native content on this face. The page's web content is painted beneath. |
| `sharedVideoPrepare` | `{version:4, op:"sync", manifestTag, emergencySetHash?}` | A nudge: the page applied a new manifest or emergency set. The store re-reads its **own** authenticated sources only if its tag differs. Rate-limited and single-flight. |
| `sharedVideoState` | reply gains `lease`, `intent`, `sessions[].next`, `store` (§6) | Bounded under the existing 16 KB reply limit |
| `sharedVideoCommit` / `sharedVideoStop` | unchanged | Kept for v2/v3 sessions started by older bundles. A v4 intent needs no commit: its start policy replaces it. |

---

## 4. The app owns the playback session (playback survives the page)

### 4.1 Lease semantics

- **Intent belongs to the app.** Per face, the app keeps one solo *intent*: identity, start policy,
  the lease that wrote it and when. It is persisted in app-private storage on every accepted change,
  so it survives a page reload, a WebView replacement and an app process death.
- **The lease is the controller's liveness, not a condition for presenting.** Every
  `sharedVideoState` poll renews it (the page polls every 500 ms while a session matters; the bound
  stays 10 s). The lease counts as **absent** at once on a main-frame document change (a reload or
  Resync retires it) or a renderer loss, and otherwise after 10 s without renewal. An absent lease
  no longer ends the session. The session moves to **unattended** and keeps presenting its intent,
  and the app's alert watch switches to its fast cadence (§7, E4).
- **Each page document generates its own lease id.** A new document must adopt the intent before it
  can change or release it. A lease from a retired document can never act again.
- **Position.** A looping solo clip keeps its own timeline. The intent carries only the start
  policy (`now` = frame 0 when ready, `boundary` = at the current session's next loop end). After an
  alert, a restart is frame 0.

### 4.2 What ends a session

| Event | Today | Designed (v4 sessions) |
|---|---|---|
| Main-frame document change (reload, Resync, bundle apply, wedge reload) | Ends: `document-retired` | **Continues.** The lease is marked retired and a new document must attach. |
| Page stops polling for 10 s | Ends: `page-lease-expired` | **Continues unattended** |
| WebView renderer crash → WebView replaced | Ends: `host-replaced` | **Continues.** The session is re-homed to the new host. Its surface container lives in the Activity's root layout, which the replacement does not touch. If a replacement cannot keep that parent, the session ends and restarts natively from the persisted intent when the new page attaches (about 1 s of black, ledgered). |
| Page `release` / new `intend` | n/a (v2: stop / new prepare) | At the stated boundary |
| **Emergency hold** | Ends | **Ends every session at once (§7).** The intent is kept as *suspended by hold* and restored after release. |
| Operator UI (Back menu, update prompt, blank/dim, canvas editor) | Ends: `page-stopped` | Ends (`operator-ui`). Must: the surface is above the window and would cover the UI. The intent resumes when the UI closes. |
| Activity paused / destroyed, app process death | Ends | Ends, because the window and its surfaces are gone. The intent survives and the next page (or boot-resume, §4.5) restarts natively. |
| Credential no longer names this screen, or a re-pair | Ends: `credential-identity` | Ends, and the intent is discarded |
| A decoder fault or 8 s with no rendered frame | Ends | Ends: fault policy (§3.4) |

`page-stopped` today hides three different causes. The designed codes split them into
`page-requested`, `lifecycle-not-ready` and `operator-ui`, so the ledger says which one happened.

### 4.3 Re-attach and reconcile

A new page (after a reload or crash) runs `applyManifest`'s emergency step first, as today. Then,
before it mounts any content, it reads `sharedVideoState`:

| What the app reports | What the page wants (its own `decideFaceEngine`) | Action | Glass |
|---|---|---|---|
| Presenting X | native X | Adopt: `intend` X with the new lease, then poll | **Nothing happens** |
| Presenting X | native Y (Y verified) | `intend` Y, `start: boundary` | One native boundary switch |
| Presenting X | native Y (Y not verified) | Adopt X until Y is verified, then a boundary switch | X keeps playing |
| Presenting X | web content | Paint the web content beneath, then `release at: boundary` | One cut at X's loop end |
| Presenting X, but the manifest now carries an alert | — | Emergency first: the hold raises (§7) | The alert |
| Idle, intent suspended by hold | no alert | Restore: `intend` X, `start: now` | Native frame 0 |

The page's splash and first-paint code must not draw over a presenting session's area as if it
were empty. That area is covered by the surface anyway; the rule is that the page never treats
"I just booted" as "nothing is on glass". `decidePlaylistCommit`'s `regularContentOnGlass` reads the
app's presenting state.

### 4.4 When the page never comes back

- **Native keeps presenting the last intent indefinitely.** Content is local-first, and the network
  and the page are for changes, not for playback.
- **Page-level recovery runs while native presents.** Reload, then WebView replacement, on the
  existing `RendererRecovery`, `NetworkRecoveryController` and watchdog schedules. None of these
  touches the glass any more.
- **Activity-level recovery (relaunch / recreate) is allowed only when** no session is presenting
  with fresh frames, or the page has been absent for more than 30 min. It costs one native restart
  (about 1 s), ledgered. This joins the planned interruption gate, one rule for everything that may
  stop content: a screen proving native frames is "painting and advancing".
- **Proof without a page.** The app's status heartbeat carries `nativePresenting {sha8,
  uniqueFrames, ageMs}`. The wedge detector and the dashboard read it, so a dead page behind a
  playing native picture is graded "page down, glass playing" (rule 10 wording) instead of "frozen".
- **No autonomous content changes while unattended.** One controller decides content: the page. If
  the server changes the content while the page is dead, the app keeps playing the last intent, and
  the returning page reconciles. Alerts are the one exception (§7, E4).

### 4.5 Boot resume (phase B2, after phase 1 soaks)

At Activity start, before the page loads, the app may start the persisted intent. Emergency first,
in the app exactly as in `applyManifest`:

1. A persisted hold is raised → no start.
2. Online → read this face's authenticated manifest first. It carries an alert → raise the hold,
   no start. The selection no longer matches the intent → no start; the page decides.
3. Offline → start only if no hold is persisted.

This takes boot time-to-first-frame from "after the page loads" (several seconds on rk3288) to about
1 s after the Activity starts. It is a separate owner decision (D4) because it is a second place
that starts content.

---

## 5. One verified content store, owned by the app

### 5.1 Layout, naming, isolation

```
filesDir/content-store-v1/
  <tenantId>/                      UUID-validated; one directory per tenant
    <sha256>                       content-addressed, ^[a-f0-9]{64}$, verified bytes only
    u/<stableKeyHash>              the URL-keyed lane for files with no digest (§5.5, §5.6)
    .staging/<sha256>.<nonce>.part + .part.json   chunked download state
  index.json                       the store's records, fsynced (§5.4)
```

- **No path segment ever comes from a URL.** A request URL maps through the in-memory index
  (stable key → record) to a sha or a lane hash. The stable key is scheme + host + path, with the
  query stripped as the worker strips it (player-005: signed-URL token rotation). Never
  `File(dir, urlPath)`.
- **Tenant isolation.** A face is served only from its credential's tenant directory. Faces share
  the primary's tenant (`faceOfScreenId` queries are tenant-scoped), so a double-sided unit shares
  one directory and downloads once. When a credential changes tenant (re-pair), the old tenant's
  directory stops being served at once and is deleted.
- **One store per device.** Both faces read the same index. Retention and pins are the union of
  both faces' sets.

### 5.2 What may be downloaded, and with which credential

- **Only what the device's own authenticated responses name:** each face's manifest (playlist
  items: url, `asset_hash`, `asset_size`, mime) and `GET /screens/:id/emergency-assets`. Both are
  fetched by the app with that face's canonical token (`FaceTokenStore` / `edu_player/device_token`,
  read-only: rule 3), the API host allowlist and bounded requests, the same as
  `SharedVideoSource.manifest` and the native alert watch today. **The page can never add a URL to
  the store.** Its `sync` nudge carries no URL.
- **Bytes are accepted only when size and SHA-256 match** that authenticated response. The device
  token goes only to the API host, never to the storage host. Downloads follow at most 3 redirects,
  only to the allowlisted storage host (`SharedVideoSourcePolicy.allowed`).
- **Private bucket ready.** Signed `/object/sign/assets/…` URLs are already allowlisted. A future
  device-authenticated redirect route (`/api/v1/screens/:id/media/:assetId` → a short-lived signed
  URL, the APK-delivery pattern) needs no store change. A 401 there is a device authorization
  state, never a file fault.
- **Store mode uses raw asset URLs for every media type.** The image CDN rewrite (`resolveAssetUrl`)
  buys nothing when bytes are local, and it is why the page sends no digest for images today. With
  raw URLs, images are verified by sha like everything else.

### 5.3 Download: chunked, resumable, verified as stored

- **Threshold unchanged.** Files ≥ 8 MiB (`LARGE_MEDIA_BYTES`, the worker's `LARGE_ASSET_BYTES`)
  are large: readiness-gated and chunked. Smaller files are one request. A shared constant test
  keeps the page, the worker and the app agreeing.
- **Chunks** are HTTP Range requests of 8 MiB, halved on failure to a 1 MiB floor and raised up to
  32 MiB on a fast link. Each is appended to the staging file, with `bytesWritten`, the source key,
  the ETag / Last-Modified and the expected size fsynced in `.part.json`. A crash or reboot resumes
  at `bytesWritten`. Each response's `Content-Range` must match the request. A changed ETag or size
  restarts (`source-changed`). A server that ignores Range gets one whole-file attempt with today's
  generous deadline.
- **Verified as stored.** After the last chunk, the SHA-256 is computed over the bytes **read back
  from disk** after fsync. That catches write corruption too, not just transfer errors. Then an
  atomic rename into `<sha256>`. No unverified byte ever has the real name.
- **Order** is one download at a time per device: (1) the emergency set, (2) the content on the
  glass, in play order, (3) the next content. When an alert arrives, the in-flight chunk is
  aborted (resumable, so only that chunk is lost) if alert media is still missing.
- **Quarantines** carried over from the page:
  - **Checksum quarantine.** A complete download that fails verification is not fetched again for
    6 h per (stable key, sha), as `digestQuarantine.ts` does today.
  - **Crash guard.** If the app process dies twice while downloading or verifying the same sha, that
    file is set aside for 6 h (persisted), as the page's `playbackSafety` does for the WebView.
- **Politeness.** Background-priority thread, 64 KiB buffers, no whole-file buffers. The final
  verify is rate-limited (initially 50 MB/s, to be tuned on rk3288) so it never starves 4K
  playback reads.

### 5.4 Verification records, scrub, corruption

- `index.json` records, per file: sha, size, mtime, inode, verified-at and source key. A file whose
  size, mtime or inode no longer matches is unverified until it is re-hashed. **A reboot re-hashes
  nothing.** Today the native path re-reads the whole clip after every reboot (§1.1, step 4).
- **Scrub.** A background re-hash at idle, at most one file per hour and each file at least weekly,
  pinned files first. A mismatch evicts the file and queues a resumable download.
- **On any decode fault of a store file, re-hash before grading.** A mismatch means corruption:
  evict, re-download, and never block native. A match means a real decoder fault: the §3.4 fault
  policy applies.
- **The honest cost of one copy.** Today a corrupt native copy fails over to the worker's
  independent copy by accident. With one store, a corrupt *current* file means previous content (or
  the remaining playable items, or the splash with the real download) until it is re-downloaded.
  Verification at publish, persisted records, the scrub and re-hash-on-fault keep this rare, and it
  is visible when it happens (`store.lastCorruption` in the cache report extras).

### 5.5 The emergency set, pinned: identical guarantees

| Guarantee (rule 11 and the worker today) | Store mechanism |
|---|---|
| Never evicted by prune, soft cap or storage pressure | Pins are excluded from every eviction path. Space for the pinned set (plus room to replace its largest file) is reserved before any content download is admitted (§5.6). |
| **An empty list is "no data", never "wipe"** | An empty or failed `emergency-assets` answer changes no pin, writes no set-hash, and is retried on the normal schedule (F5). |
| **A null-hash emergency file is never revalidated** | It lives in the URL-keyed lane, marked emergency. Once present it is current, and only a URL change replaces it (F4: a captive portal must not be able to replace alert media). |
| **Raise-never-release** for the set: cached or stale inputs can add pins, never remove them | Pins change only on a fresh 200 from the server of record with a non-empty list. A cached manifest, an offline boot or a failed fetch never unpins. |
| The set-hash commits only when every file is present | The new set is pinned file by file as each lands. The old set is unpinned only **after** the new set is complete (commit-then-unpin). The worker today evicts before downloading, so this is stricter. |
| Alert media on disk before the screen counts as emergency-ready | The store reports `emergency.complete`, which feeds the existing emergency readiness surfaces through the cache report. Content playback is never blocked waiting for it: an alert may always stream if it must (rule 11). |
| The pin survives the migration from two copies to one | The worker's emergency tier is **not** deleted by the migration. §8.3 and decision D2 recommend keeping it permanently as a redundant copy (under 15 MB per screen today). |

### 5.6 Prune and disk accounting

- **Budget** = min(8 GiB, usable space − 512 MiB OS reserve − pinned reserve). This replaces the
  worker's 5 GiB soft cap plus its 1 GiB emergency floor with one number the app can measure.
- **Never evicted:** pinned files; files in either face's current set ("in use"); a file a session
  is decoding or the interceptor is serving (refcount).
- **Evicted first:** least-recently-used files outside every current set. The previous content
  stays while space allows, so a quick switch back costs no download, as today's `keepExtra = 1`.
- **Storage full.** If a new file cannot fit after eviction, the store refuses it (`store-full`).
  The current content stays, the cache report says so, and the dashboard shows "storage full on
  the device". Pinned and in-use files are never touched to make room.
- **Accounting** in `store` on `sharedVideoState` and in the cache report extras: used, pinned,
  budget and free bytes, file counts, and staging bytes.
- **Insufficient storage.** If the budget cannot hold the largest current file × 1.5, store mode
  stays off for that device (`insufficient-storage`) and the page keeps today's path. That is
  auto-detected, not a setting.

### 5.7 Adoption of files already on disk

| Copy | Adoption | Egress |
|---|---|---|
| `native-video-v2/<tenant>/<sha>.mp4` (per-face engine) | Verify once (SHA-256 of the stored bytes), then `rename()` into the store. Same filesystem, so it is atomic and costs no copy. | 0 |
| `shared-video-v1/<tenant>/<sha>.mp4` (old pair engine) | Same | 0 |
| USB sneakernet cache (`usb-cache/`, `UsbCacheIndex`) | Verify each file against its manifest sha, then rename into the store. The USB interceptor path becomes the store's. | 0 |
| The worker's CacheStorage copies (playlist tier, loop packages) | **Cannot be adopted.** CacheStorage is Chromium's internal on-disk format, and `shouldInterceptRequest` cannot read request bodies, so the page cannot hand bytes to the app. The store downloads its own copy once; the worker copy is dropped only after the store is proven (§8.3). | One file set per web-only screen, once, at phase 2 entry. Phase 1 screens already hold the native copy. |

Files adopted but named by no current set become least-recently-used cache, subject to prune.

### 5.8 Serving the WebView from the store (phase 2)

**Where.** The same lookup is served by two hooks:

- `SafePlayerWebViewClient.shouldInterceptRequest`, per player WebView (face 0 and the face
  Presentation WebViews), for page-context requests;
- `ServiceWorkerControllerCompat.setServiceWorkerClient(...)` for requests the player's service
  worker makes. It is registered before the first WebView is created and gated on
  `WebViewFeature.SERVICE_WORKER_SHOULD_INTERCEPT_REQUEST`.

The worker's fetch handler answers a cache miss with `fetch(req.clone())` (`sw-player.js:468`).
On Android that request goes to the `ServiceWorkerClient`, not the `WebViewClient`, so both hooks
are needed. The URL-overlay and Website Tabs WebViews have their own `WebViewClient`s, which never
consult the store. The service-worker client is process-wide, which is one more reason it serves
only exact managed URLs: the same public bytes the storage origin already serves.

**What.** Only **managed** URLs: exact stable-key matches from the authenticated sets (§5.2), with
no prefix or pattern matching.

| Request | Response |
|---|---|
| Managed, verified | Served from the store (below) |
| Managed **large content** file, not verified | **503** `X-VenueOS-Store: not-ready`, never the network. Rule 17 becomes mechanical: even a page bug cannot stream a large file from origin. |
| Managed small content file, not verified | `null` → network. Small files may mount at once (rule 17), and the store fetches its own copy. |
| Managed **emergency** file, not present | `null` → network (or the worker's emergency tier, which is checked first). **An alert may always stream** (rule 11). |
| Not managed (third-party widget images, template statics, the API) | `null` → untouched |

**The Range contract**, read from the Chromium source
(`android_webview/browser/network_service/android_stream_reader_url_loader.cc` and
`components/embedder_support/android/util/input_stream_reader.cc`):

- Chromium's intercept loader parses a single-range `Range` header itself and **skips the
  embedder's InputStream to the range start** (`InputStreamReader::Seek` →
  `SkipToRequestedRange`).
- It then replaces its own `200` status line with the embedder's status and headers
  (`InterceptResponseDelegate::AppendResponseHeaders` → `ReplaceStatusLine`).
- So the store must return **the whole-file stream from byte 0** (a `FileInputStream`, whose
  `skip()` is a seek), with `206`, `Content-Range: bytes s-e/total` and `Accept-Ranges: bytes`
  computed from the request header. A pre-sliced stream would be skipped twice and play wrong
  bytes. A non-range request gets `200` with the full file.
- This was read at one source revision. The fleet spans WebView 66 → 128.

**The range self-test (auto-detection, no setting).** At store start, and whenever the WebView
package version changes, the app runs a byte-exact self-test through the real interception path. A
synthetic 1 MiB pattern is requested by a hidden same-origin fetch with `bytes=0-`,
`bytes=4096-8191` and `bytes=-1024`, and every byte is compared. The result, `loader-slices` or
`failed`, is recorded per WebView version and reported on `sharedVideoState.store.selfTest`. On
`failed`, store serving stays off for that device and the page keeps the worker for web-served
files. Native still reads the store directly, so phase 1 is unaffected.

**Headers.** `Content-Type` comes from the manifest mime. `Access-Control-Allow-Origin: *` mirrors
the storage origin's own policy for these objects, so the continuous engine's `fetch()` stays
readable and nothing is exposed that the public origin does not already expose. Responses carry
`Cache-Control: no-store` and `X-VenueOS-Store: 1`.

**Documents keep their origin.** HTML and PDF assets are served at their **own** URL, so an iframe's
document origin stays the storage origin, exactly as today. Relative references inside an HTML
asset resolve against its own URL, as today.

**Why the original URLs and not a path on the player origin.** The brief proposed serving the store
on the player origin. This design intercepts the original asset URLs inside the player WebViews
instead, for three reasons:

1. **Security.** An HTML, PDF or SVG asset served from a player-origin path would become
   same-origin with the player page, with access to its storage (the device token) and its bridge.
2. **No consumer rewrites.** Every consumer that renders a URL keeps working: the emergency overlay
   renders `mediaUrls` verbatim, and template widgets, the sandboxed boards and protocol 3's web
   pre-mount do the same.
3. **URL identity stays put.** Apply signatures, `collapseCopies`, readiness keys and telemetry all
   key on manifest URLs and are untouched.

The player origin stays what it is: the page and its shell.

**Threading.** The hook only looks up the in-memory index and opens a file. It never waits on a
lock that a download or verify thread holds, and never touches the network.

**Failure.** A stream read error surfaces in the element as a network error. The page's existing
unplayable / retry logic handles it, and the store re-hashes the file (§5.4).

### 5.9 The service worker

- **Browser-only players (desktop, Raspberry Pi, any browser) and NovaStar Taurus: unchanged.** The
  protocol, tiers, chunk drive, emergency tier and all their tests stay as they are. Taurus stays
  web-only and keeps its worker; its app build is a separate programme.
- **Store-mode app, phase 1.** The page stops precaching **native-selected** files into the worker,
  once the store reports them verified and native has presented them for 10 min (§8.3). Everything
  else is as today.
- **Store-mode app, phase 2.** The page stops driving `PRECACHE_PLAYLIST` / `CHUNK` for media
  (the store reconciles itself). It keeps `PRECACHE_SHELL` (offline boot of the page itself) and
  keeps `PRECACHE_EMERGENCY` (the redundant alert tier, D2). After the proof window it sends
  `CLEAR_CACHE {tier:'playlist'}` and deletes `venueos-continuous-loop-v1`. The web fallback then
  loops with the element loop, so no fragmented second copy is built.
- **The worker needs no code change for store serving.** Its tiers are simply empty, and its misses
  reach the interceptor (§5.8). Same-origin opportunistic writes cannot capture store responses,
  because managed URLs are all cross-origin storage URLs.

---

## 6. Readiness: one source of truth

- **`mediaReadiness.ts` does not change.** Its inputs are `cacheDrive` and the set of on-disk keys.
  Only the source behind them changes. In store mode the page's `lookupCached` adapter answers from
  `sharedVideoState.store` instead of the worker's `CACHE_LOOKUP`, with the same
  `Record<url, {present, current}>` shape. A file is current when its sha is in `store.ready`; a
  URL-lane file is present only.
- **`store` block on `sharedVideoState`**, bounded:

  ```
  store: { mode: off|adopting|active, serve: bool, generation,
           ready: [sha…] (≤ 64, the current sets' large files that are verified),
           pending: [sha…] (≤ 64), downloading: { sha8, bytesLoaded, bytesTotal },
           emergency: { setHash, complete, count, bytes },
           accounting: { usedBytes, pinnedBytes, budgetBytes, freeBytes },
           selfTest: { webviewMajor, result } }
  ```

  `generation` increases on every change, and the page re-reads on its existing 15 s cache tick and
  on every manifest apply.
- **`cacheDrive`** is `'ready'` when `store.mode = active`, and `'unknown'` until the first answer.
  It is **never `'unavailable'` in store mode**, because `'unavailable'` means "stream everything"
  (`isItemReady`). If the store's state cannot be read, the page falls back to the worker path,
  never to streaming.
- **Both engines read the same index.** The page reads it through `sharedVideoState`. Native reads
  it directly at prepare and re-checks presence; if the file is absent it answers `not-in-store`
  (not-ready → wait).
- **The disagreement window is closed by construction.** In-use files are never evicted (§5.6), so a
  file the page saw as ready cannot vanish before the mount, except through corruption detection,
  which is a real "gone" the page handles as not-ready.
- **The cache report keeps its shape.** `{ playlist: {count, bytes}, emergency: {count, bytes} }`:
  playlist is the store's non-pinned files, emergency is the pinned set. `downloading` comes from
  `store.downloading`. One optional `source: "store"|"worker"` key is added, deployed API-first and
  held back on a 400 like the existing extras (the same rollout as the 2026-09-27 `cache.downloading`
  snapshot).
- **First boot.** Splash, then the store fetches the emergency set, then the content in play order.
  The splash shows the store's real progress (`largeDownload` from `store.downloading`). The first
  frame is native when the decision says native, otherwise web from the store. There is no web
  lap.
- **Offline boot.**
  - The shell comes from the worker (unchanged), and the cached manifest replays (unchanged).
  - The store's records are on disk, so readiness is immediate.
  - Native validates the intent against the store's **persisted last authenticated selection** for
    that face: the store's own copy of its own authenticated manifest, with its fetch time. So an
    offline boot plays natively from frame 0 instead of today's latent 24 h block (§1.2).
  - Alerts: the cached emergency raises (rule 11), and alert media comes from the pinned set or the
    worker's emergency tier.

---

## 7. Emergency: hard constraints and ship gate

> **What can and cannot change for alerts:** nothing about how an alert behaves changes. It is
> still decided first, takes the glass from native video before it draws, plays its media on the
> web layer, and ends only on the server's live all-clear; native-first changes only where content
> video comes from and when it starts.

**Ship gate.** Native-first does not leave the bench until every row below has its proof green on
every hardware class it ships on. Store serving (phase 2) also needs E3's store rows. If any row
cannot be proven, native-first does not ship until it is.

| # | Invariant | Mechanism (designed) | Proof |
|---|---|---|---|
| E1 | **Rule 11 ordering is exact.** Emergency logic runs first in `applyManifest`. On OVERRIDE the native surface is removed **before** the alert view draws, within one frame. This holds on `dynamic_above` and `static_above`, for a session that started native-first at frame 0, for a session mid-boundary (A presenting + B pre-rolled), and for an unattended session. | Unchanged chain. The page calls `signalDisplayEmergencyHold(true, true)` (synchronous bridge) **before** the preempt manifest fetch that brings the alert: on WS and SSE OVERRIDE, and before the pushed-message state of SOS, TEXT_BROADCAST and MEDIA_ALERT (`page.tsx` ~8683, ~9094, ~9118). The hold is committed (`commit()`), then `DisplayEmergency.enforceNow` → `SharedVideoHost.suppressForEmergency()` → `FaceVideoBox.suppress("emergency-held")`. That stops **every** session on every face, including pre-rolls and unattended ones. Surfaces go `GONE` and are removed on the main thread; the WebView comes back `VISIBLE` first and `BLACK` last. The removal is queued on the main looper before the alert's draw can be scheduled. The boundary-swap pass checks `isHeld` before moving anything onto the glass. | (a) `FaceVideoBoxContractTest` extended: suppression reaches v4 sessions, pre-rolls and unattended sessions; the swap pass checks the hold first; the view-pass order is unchanged. (b) A new instrumented emulator test records the surface's `GONE` time and the WebView's first draw containing the alert DOM, and asserts the order, for the native-first start, the mid-boundary swap and the unattended session. (c) Glass: a 240 fps capture of a drill over native on every class shows no frame with video after the first alert pixel, and the alert on glass ≤ 1 s from trigger. |
| E2 | **Emergency content is never played by the native engine.** The alert overlay and its media run on the web engine, which can draw at all times. | Three locks: the server builds no descriptor for emergency manifests (`buildNativeVideoDescriptor`, `isEmergency !== false` → null). The app's `begin()` refuses under a hold. `decideFaceEngine` returns web for emergency content or a raised hold. The WebView stays attached, `VISIBLE` and opaque under every native session. The `webview-invisible` experiment (default off) is restored `VISIBLE` as the first statement of the removal (1.1.41). With page survival an absent lease no longer ends a session, so that experiment's fault guard keys on the lease lapse itself, and the watch's fast cadence covers a throttled hidden page. | Existing `FaceVideoBoxContractTest` restore-order case. New `decideFaceEngine` cases. API `native-video.spec.ts` emergency case. Glass: a drill with the WebView-hidden experiment on (if it ever ships). |
| E3 | **The emergency set is pinned in the store with identical guarantees:** raise-never-release; empty list = no data; null-hash never revalidated; alert media on disk before emergency-ready; the pin survives prune, storage full and the two-copies → one migration. | §5.5. The worker's emergency tier is kept (D2), so the migration never removes alert media. | New `EmergencyPinTest` (app): one case per guarantee — empty answer, failed fetch, cached input, null-hash present, commit-then-unpin, storage full with the pin intact, prune with the pin intact, migration with the pin intact. Existing `sw-emergency-large-assets.test.ts` + `emergencyInterlock.test.ts` stay green and gain a store-mode page case: the page still drives `PRECACHE_EMERGENCY` and still commits the set-hash only on full success. |
| E4 | **Every delivery path works whatever the engine state.** Redis WS OVERRIDE/ALL_CLEAR (preempt lane), the SSE fallback, the manifest poll backstop, and the app's own native alert watch. A page that is dead, reloading or hidden cannot stop the hold. | The page paths are unchanged. **Changed (emergency-path, needs sign-off):** the native alert watch runs whenever the panel is off **or no page holds a live lease**. The lease is absent at once on a document change or renderer loss, so a quick reload is covered too. While it is absent the watch polls every 5 s (conditional GETs with ETag), with the first poll at its existing 3 s delay. It stays **raise-only**: it raises the hold, the hold removes every surface within a frame of the raise (the E1 chain, which needs no page), and the watch's existing bounded reload/relaunch escalation brings a page back to draw the alert. Detection while no page is live is ≤ 5 s; with a live page it is unchanged (WS/SSE push). Raised holds are persisted (`DisplayEmergency` contract d) and never auto-expire (its fail-closed rule). | `NativeAlertWatchEngineTest` / `NativeAlertWatchWiringTest` extended: runs when the lease lapses with the panel on, at 5 s, raise-only, escalation bounded. Glass: an alert with Redis down (manifest path), an alert over SSE, an alert with the page killed during native (renderer killed → the watch raises → the surface is gone → the page returns and draws the alert). |
| E5 | **Offline:** the alert raises from disk with no network; the all-clear restores content with at most one start. | The cached emergency raises (rule 11, unchanged). Alert media comes from the pinned set or the worker's emergency tier, served by interception or the worker without network. The all-clear needs the live server, unchanged. After the all-clear, the suspended intent restarts natively once. | Existing `offlineBoot.test.ts` + `emergencyInterlock.test.ts`. New store-mode case: offline replay raises, media served from the pinned set. Glass: network out, power-cycle during an alert, the alert returns from disk, the network returns, the all-clear brings the native picture back (one start). |
| E6 | **Boot:** an alert before any engine has started, during the store's first download, and during a web ↔ native boundary. | Before any engine: `applyManifest` raises first, and native `begin()` refuses under the hold. Boot-resume (§4.5) checks the hold and its own manifest first. During the first download: the store pre-empts to the emergency set (§5.3), and the alert streams if its media is not yet local. During a boundary: suppression reaches both sessions, and the swap pass checks the hold. | Emulator: manifest with an alert at boot (no native start); alert while the store is mid-download (chunk aborted, emergency fetched first, content resumes after); alert between B-ready and A's loop end. Glass: the same three on one unit per class. |
| E7 | **Drill vs live labels and audit rows are untouched.** | No server emergency code, no audit code and no overlay code changes. `isDrill` flows through the manifest to the overlay as today. | The existing drill-label and audit tests stay green. A diff review confirms that `apps/api/src/emergency/**` and the overlay are not in the change set. |

**All-clear while the page is gone.** The page is the alert renderer; with no page, nothing draws
the alert, and the hold guarantees only that nothing covers the screen and that the panel is lit.
The design keeps **release with the live page** (rule 11, unchanged). Restore is still the app's
job: when the watch sees a raised hold, a live manifest with no alert, and no page lease for 30 s,
it drives the existing reload/relaunch escalation. The returning page reads the live manifest,
releases the hold, and the suspended intent restarts natively. A page that can never return leaves
the screen held: lit, no native content, flagged on the dashboard. That is the "fail-closed for
risk" direction of `DisplayEmergency`. An app-side release (same confirmation rules as the page:
hold age ≥ 30 s, two live reads ≥ 15 s apart, no pending OVERRIDE window) is listed as decision D3.
It is an emergency-path change and needs explicit sign-off.

---

## 8. Rollout, migration, rollback

### 8.1 Switches (lead-only kill switches, never an operator setting)

| Switch (Railway env, carried per face in the hashed manifest, outside session identity) | Phase | Grammar |
|---|---|---|
| `PLAYER_NATIVE_FIRST` | 1: decision before mount, store for native files, lease, v4 | As `PLAYER_NATIVE_VIDEO`: `<screen uuid>`, `model:<id>`, `class:<soc>/android-<N>`, `-<uuid>` / `-model:` / `-class:` exclude (wins), `off` (wins over everything). Unset = the app's class default. |
| `PLAYER_STORE_SERVE` | 2: WebView served from the store; worker media tiers emptied after proof | Same grammar |

- **Precedence:** `off` / exclusion > inclusion > the app's class default. Class defaults start
  **false** in the class table (`DeviceClassPolicy`) and flip per class in an app release only
  after that class passes the glass. From then on the env exists only to switch a screen or class
  off (owner 2026-10-18).
- A flip changes the manifest (ETag) but never restarts a presenting session. It applies at the
  next content boundary, never mid-play: the same rule as the 1.1.41 experiment flags.
- The page treats store mode as on only when the manifest says so **and** the app reports
  `store.mode = active`. A disagreement means today's path.

### 8.2 Phases

| Phase | Ships | Glass changes | Prerequisite |
|---|---|---|---|
| 0 | The failure-grading table (§3.4, §1.2 latent defect): page and app. Independent of everything else. | None, except no false 24 h blocks | — |
| 1 | App: store (download, records, adoption, pins in shadow mode), v4 intents, lease and page survival, boundary switch; page: `decideFaceEngine`, `NativeSoloSlot` (no web child), store readiness for native-selected files; API: switch tokens, `nativePresenting` heartbeat field accepted. | Zero takeovers on native-selected solo video; playback survives reloads and crashes. Media for everything else, and every alert path's media, are unchanged. | §7 E1, E2, E4, E5, E6, E7 proven per class |
| B2 | Boot resume (§4.5) | Native about 1 s after Activity start | D4, phase 1 soaked 72 h |
| 2 | Interception serving, self-test, worker media tiers emptied after proof, pinned set authoritative for readiness | One copy for every file | Self-test passing per class; §7 E3 store rows proven |
| 3 | Class defaults flip in the app; the v2/v3 handoff path is deleted two releases later | — | Glass per class |

### 8.3 Migration for screens holding both copies

1. **Adopt.** With the switch on, the store scans `native-video-v2/`, `shared-video-v1/` and
   `usb-cache/`, verifies each file once, and renames it into the store (§5.7). Mode: `adopting`.
2. **Complete.** The store downloads what is missing: the emergency set first, then the current
   content. Mode becomes `active` once both faces' current sets are verified.
3. **Use.** The page reads readiness from the store, and native decides before mount. The worker
   copies stay and still serve web requests (their bytes are verified too).
4. **Prove, then delete the duplicate.**
   - **Per file, phase 1.** The page drops a native-selected file from the worker's set only after
     the store has it verified **and** native has presented it for 10 min (proved by playback, as
     known-good is). The file is in the `keepUrls` list until then, so the worker's prune cannot
     take it early.
   - **Per screen, phase 2.** `CLEAR_CACHE {tier:'playlist'}` and the loop-cache delete happen only
     after 24 h that include one reboot and one content change or forced reconcile, with zero
     intercept errors, zero store verification failures and `emergency.complete`.
   - The worker's **emergency tier is not deleted** (D2).
5. **Native copies.** The old namespace directories are removed once empty.

### 8.4 Rollback = the switch

`PLAYER_NATIVE_FIRST=off` (or `-class:…` / `-<uuid>`) returns the device to 1.1.42 behaviour at the
next content boundary: web first, native takeover, the worker's tiers. Store files stay on disk.
The old native path looks in the store before it downloads (a read-only lookup by sha), so native
costs no egress. The worker refills its playlist tier from the network: one download per web-served
file, with the current content kept on glass by the readiness gate meanwhile.
`PLAYER_STORE_SERVE=off` alone stops interception (every hook returns `null`) and the worker refills.
Keep the old code paths for two app releases after phase 3.

---

## 9. Numbers: egress, disk, time to first frame

### 9.1 Assumptions (all to be measured on the bench)

| Quantity | Value used | Basis |
|---|---|---|
| Clip | 141.2 MB 4K H.264, 30 fps, 30 s lap | The 4K clip of the 2026-09-26 incident. Today's live schedules: 7 videos, median 178 MiB, max 208 MiB. |
| Effective link | 5 / 25 / 100 Mbps | Venue range. The 09-26 incident link was below 4 Mbps effective. |
| Worker verify (JS SHA-256) on t982 | ~40 MB/s → 3.5 s | Estimate (pure-JS hash in the worker) |
| Worker assemble (disk → disk) | ~3 s | Estimate |
| App SHA-256 over stored bytes on t982 | ~150 MB/s → ~1 s | Estimate (eMMC-bound). rk3288: ~60 MB/s. |
| Web prepare to first frame | ~1 s | Estimate |
| Native prepare to first frame (surface, codec, reveal) | ~0.6 s | The uploaded logs suggest about 0.3 s attach → reveal request without a loop-point wait, plus 10–50 ms reveal → first post-request render (`requestNs` → `renderNs` in four field lines) |
| Loop-point wait | average 15 s, maximum 30 s (bound 60 s) | Half a lap on average |
| Fleet scale | 150 screens | Launch scale. Today: 36 screens reported in the last 7 days, 3 at 4K, 2 double-sided units. |

### 9.2 Time to first frame (t982, 141 MB 4K clip)

| Case | Today: first frame | Today: native from | Takeovers | Designed: first frame | Takeovers |
|---|---|---|---|---|---|
| First boot, 5 Mbps | 3 min 54 s (web) | 7 min 55 s | 1 | **3 min 48 s (native)** | 0 |
| First boot, 25 Mbps | 53 s (web) | 1 min 54 s (1:39–2:09) | 1 | **47 s (native)** | 0 |
| First boot, 100 Mbps | 19 s (web) | 46 s | 1 | **13 s (native)** | 0 |
| Reboot / reload, file on disk | ~1.5 s after the page loads (web) | 3–33 s later (after a reboot, a full re-hash first; then the loop-point wait) | 1 | ~0.7 s after the page decides (native). With boot resume (B2): ~1 s after the Activity starts, before the page. | 0 |
| Content change A → B (B new), 25 Mbps | A until B is cached (53 s), then web B | native B ~1 min later | 2 | A until B is verified (47 s), then native B at A's loop end | 0 |
| All-clear after an alert | content web-first | a lap later | 1 | native, one start | 0 |
| Page reload / WebView crash while native plays | web lap | after the loop point | 1 | **picture never leaves the glass** | 0 |

Formulas, with S = size and B = link speed:

- today's first frame = S/B + JS verify + assemble + web prepare;
- today's native = that + S/B (the second download starts only after the mount) + native prepare + loop-point wait;
- designed = S/B + verify as stored + native prepare.

### 9.3 Egress (Supabase storage → screens)

| | Today (native screen) | Designed |
|---|---|---|
| Per screen, per new 141 MB clip | 282 MB (worker + native) | **141 MB** |
| 150 screens, one new clip | 42.4 GB | **21.2 GB** |
| 150 screens, one new clip per week (4.33 per month) | ~184 GB / month | **~92 GB / month** |
| Interrupted download on a flaky link | Native restarts from zero, each attempt up to 141 MB, then a false 24 h web block (§1.2) | Resumes at the last chunk (≤ 32 MiB lost) |
| Web-only screens (not native-enrolled) | 141 MB | 141 MB, unchanged, plus resume |

One-time phase 2 cost: web-only screens download their current media set once (§5.7), for example
about 145 MB for one clip plus its images. Phase 1 native screens adopt their native copy at zero
egress. At a list price of $0.09/GB over the plan's included egress (check the current plan before
budgeting), the weekly-clip case saves about $8 a month at 150 screens. The real value is a
downloaded file that resumes and is never thrown away.

### 9.4 Disk (per screen, one 141 MB clip, steady state)

| | Today (native screen, continuous loop default) | Designed |
|---|---|---|
| Worker playlist entry | 141 MB | 0 after proof |
| MSE loop package (`venueos-continuous-loop-v1`, never pruned) | ~141 MB, plus every earlier clip's package | 0 (store mode loops with the element) |
| Native copy (+ newest previous copy) | 141 MB (+ previous) | — |
| Store | — | 141 MB (+ previous content while the budget allows) |
| **Total** | **~423 MB + previous + stale packages** | **~141 MB (+ optional previous)** |
| 150 screens | ~63 GB | ~21 GB |

Plus the worker's emergency tier and the store's pinned set: under 15 MB each (at the 2026-09-26
production check: 23 emergency assets, largest 661 KB, none ≥ 8 MiB).

---

## 10. Risks, honestly

| Risk | Likelihood / impact | Mitigation |
|---|---|---|
| **WebView intercept behaviour differs across 66 → 128** (Range skip, status replacement, the service-worker client) | Medium / high for phase 2 | The byte-exact self-test per WebView version (§5.8). Phase 1 never depends on interception. A failed self-test keeps the worker path for web-served files. Bench every class before phase 2. |
| **Intercepted media is copied again into the WebView's HTTP cache** | Unknown / disk | Responses carry `Cache-Control: no-store`. Bench: watch `app_webview/` size during an hour of looping. |
| **Storage full** | Medium on 8 GB boxes / content stalls | Pins reserved first, in-use never evicted, LRU outside current sets, `store-full` refuses new content and keeps the current content, dashboard line. `insufficient-storage` keeps store mode off. |
| **A corrupt file, now the only copy** | Low / the current content is unavailable until re-downloaded | Verified as stored, persisted records, weekly scrub, re-hash before grading any decode fault, resumable re-download, visible in the cache report. The accidental redundancy today (native copy vs worker copy) is lost, and this design says so. |
| **The two engines disagree on readiness** | Low | One index. Native re-checks at prepare (`not-in-store` = wait). In-use files are never evicted. The page re-reads on `generation` change. |
| **A native session presenting with no controller** | Medium / stale content while the page is dead | Bounded by page recovery, which no longer interrupts the glass. The 30 min ceiling before an Activity relaunch. `nativePresenting` heartbeat proof. Alerts covered by E4. |
| **Alert latency while the page is dead** | Low / ≤ 5 s + page reload | The watch at a 5 s cadence while no lease is held. During a reload the alert appears when the new page applies the manifest, which is the same moment it would appear today. |
| **Two decoders for a 4K pre-roll** | Medium on 2 GB boxes | The decoder budget refuses early. Fallback: hold the last frame, then cut (§3.3). Measure on t982 and rk3288. |
| **The app process does more work: downloads, hashing, serving** | Low / CPU and IO on rk3288 (the WebView renderer is in-process on Android 7) | Background priority, a rate-limited verify, no whole-file buffers, one download at a time. Bench: frame-interval histogram during a download plus a verify. |
| **Two code paths to maintain** (worker for browser players, store for the app) | Certain / maintenance | Shared constants and tests for thresholds and reason codes. The worker protocol stays frozen for browser players. Delete the v2/v3 handoff two releases after phase 3. |
| **Emergency-path changes** (the watch runs while the lease is absent; D3 if chosen) | — | Explicit sign-off per CLAUDE.md. The watch stays raise-only. §7 ship gate. |

---

## 11. Test plan

**Web (Jest), all next to their sources:**
- `decideFaceEngine.test.ts`: one case per row of §3.1, including a hold raised, emergency
  content, a block, the switch off, protocol < 4, `wait` vs `native`, operator overlays as yields.
- `nativeVideoNext` replacement: transient → native again; not-ready → wait; fault → web 24 h;
  repeated transients settle on web. A generated table shared with the app.
- Store-mode readiness adapter: `store.ready` → `{present, current}`; never `'unavailable'`; a
  store read failure falls back to the worker; `generation` change re-reads.
- Re-attach: same identity adopts with no prepare or commit; different identity sends `start:
  boundary`; web content sends `release at: boundary`; a suspended intent restores after release.
- Drive: phase 1 does not precache a native-selected file into the worker until verified + 10 min
  presented; phase 2 sends no `PRECACHE_PLAYLIST`, keeps `PRECACHE_SHELL` and `PRECACHE_EMERGENCY`.
- Cache report shape unchanged, plus the held-back `source` extra.
- **Unchanged and green:** the vm-loaded worker suites (`sw-large-asset-cache`,
  `sw-emergency-large-assets`, `sw-playlist-quota`, `sw-shell-*`, `sw-legacy-syntax`),
  `mediaReadiness`, `emergencyInterlock`, `emergencyHold`, `offlineBoot`, `digestQuarantine`,
  `collapseCopies`. Browser players depend on them.

**App (JVM unit tests, required by `scripts/check-player-test-execution.cjs`):**
- `ContentStorePolicyTest`: paths (sha / uuid regexes, no URL segment ever reaches a path), tenant
  isolation and re-pair purge, budget math, prune with pins / in-use / LRU, insufficient storage.
- `ContentStoreDownloadTest`: chunk sizing, resume at `bytesWritten`, `Content-Range` mismatch,
  `source-changed`, verify-as-stored, checksum quarantine, the crash guard, priority order,
  pre-emption by the emergency set.
- `EmergencyPinTest`: §7 E3 rows.
- `StoreInterceptPolicyTest`: managed / unmanaged / emergency fall-through / large-not-ready 503,
  the range header → status and `Content-Range` math, the full-stream-from-0 contract, headers,
  documents served at their own URL.
- `WebViewRangeSelfTestTest`: pattern generation, the three ranges, result recording per WebView
  major, `failed` → serve off.
- `PlaybackLeaseTest`: lapse → unattended; document change → continues; host re-home; adopt by a
  new lease; a retired lease cannot act; release at boundary; hold → suspended → restore; operator UI
  still ends; Activity pause still ends; persisted intent across a simulated process death.
- `NativeFirstBoundaryTest`: pre-roll vs hold-last-frame under the decoder budget; the swap pass
  checks the hold first.
- Extended: `FaceVideoBoxContractTest` (§7 E1 / E2 source guards; no page event ends a v4 session),
  `FaceEmergencyHoldTest` (unattended and mid-boundary sessions), `NativeAlertWatchEngineTest` /
  `NativeAlertWatchWiringTest` (lease-absent trigger, 5 s cadence, raise-only),
  `DeviceClassPolicyTest` (`nativeFirst`, `storeServe` defaults false; switch precedence).
  `DisplayEmergencyRaceTest` unchanged.

**Emulator CI (Android 7 / 9 / 11 / 13 images; proves logic, never compositors or decoders):**
- Interception with Range: the self-test, a `<video>` seek and loop, the service-worker-originated
  fetch path.
- Drill ordering, instrumented (§7 E1 b).
- Reload during native, renderer kill during native, reload during an alert.
- Alert at boot, during the first download, at the boundary.
- Offline boot with an alert.

**On the glass, per class** (one unit each: t982 Android 13, t982 Android 11, rk3288 Android 7.1
both faces, rk3328 Android 11, Android 9 Commercial; Taurus as a no-change control). The standard
on-glass runbook (install, update path, five loops, counter clip, Back/settings, drill, power cut,
network out, a 16-minute idle), plus:

1. First boot with an empty store: the splash shows the real download, then **native frame 0**,
   with no web frame at any point (240 fps capture).
2. Reboot: native about 0.7 s after the page decides, no takeover. Five loops with no white, no
   haze, no black flash, no seam.
3. Content change A → B: A until B is verified, a swap at A's loop end; record the held-frame time
   when the decoder budget forces the fallback.
4. Page survival:
   - a dashboard Resync during native;
   - a nightly-style bundle apply during native;
   - the WebView renderer killed during native (`adb shell kill` of the sandboxed renderer process
     on the bench build);
   - the page kept dead for 10 min.
   For each, the picture never leaves the glass, the new page re-attaches with nothing visible,
   and the ledger records "page reload, glass unaffected".
5. Emergency (the §7 gate): a drill over native (live and drill labels); an alert during the first
   download; an alert at the boundary swap; an alert with Redis down (manifest path); an alert over
   SSE; an alert offline (power-cycle during an alert); an alert while the page is dead; a reload
   during an alert; the all-clear restore (one native start); the WebView-hidden experiment if it
   ever ships.
6. Store: storage full (fill the disk with a dummy file on the bench build): current content stays,
   `store-full` is reported. A corrupt file (bench debug build, flip a byte): re-hash, evict,
   re-download, no native block. Network out for 5 min: content continues.
7. Numbers: egress per screen per change (storage logs), store accounting vs `df`, the time to
   first frame for each case in §9.2, and the frame-interval histogram during a download plus a
   verify.

---

## 12. Decisions for the owner

| # | Decision | Recommendation |
|---|---|---|
| D1 | Adopt this direction: decide before mount, one store, the app owns the session | Yes |
| D2 | Keep the worker's emergency tier as a permanent redundant copy of alert media (under 15 MB per screen) | **Yes.** It is the one duplicate that buys a life-safety property: alert media survives a store or intercept defect. |
| D3 | All-clear while the page is gone: the app drives page recovery and the live page releases (rule 11 unchanged), **or** the app releases under the page's own confirmation rules | The first. The second is an emergency-path change for a case where nothing can draw the alert anyway. |
| D4 | Boot resume: the app starts the last native intent before the page loads (§4.5) | After phase 1 soaks 72 h |
| D5 | While the page is dead, keep playing the last intent (no autonomous content changes) | Yes: one controller for content |
| D6 | Keep previous content files while the budget allows (LRU) rather than strict one-file-per-current-item | Yes: a quick switch back costs no download |
| D7 | Ship phase 0 (the failure-grading table) now, independent of native-first | Yes: it removes a latent 24 h block on offline boot |

---

## 13. One-page summary for the owner

**You were right.** Starting video on the web engine and flipping to native is not what good
players do, and it is costing us. Every boot, every nightly reload, every Resync and every content
change shows a web lap and then a visible switch. Native needs a second download before it can
start, so a 4K clip lives on the screen two or three times. And any page reload takes the native
picture off the glass.

**What changes:**

1. **Native from the first frame.** Before anything is mounted, the player decides which engine
   plays this content. If the file is on disk and verified, native shows frame 0, and the web video
   is never created. If the file is still downloading, the screen keeps what it is showing, or at
   first boot it shows the real download bar. It never plays a web lap and never streams. A content
   change switches native to native at the end of the current clip.
2. **One verified store, owned by the Android app.** One download per file, resumable, checked
   byte for byte. Both engines read the same copy, and alert media is pinned and never evicted.
   Today's native copies are adopted with no re-download.
3. **The picture survives the page.** A reload, a Resync, a bundle update or a crashed browser
   component no longer interrupts the video. The page comes back, sees what is playing, and
   nothing happens on the glass.

**What does not change:** how alerts behave. An alert is still decided first. It takes the glass
from native video before it draws, it plays on the web layer from disk (or the network if it must),
and only the server's live all-clear releases it. That is a ship gate: native-first does not ship
until every alert check passes on every hardware class, including a drill over native, an alert
during a download, an alert at a content switch, an alert with Redis down, an alert offline and an
alert while the page is dead. Browser players and the LED posters are untouched.

**What you get** (4K clip, 150 screens; model, to be measured):

| | Today | After |
|---|---|---|
| Engine switches per boot / reload / content change | 1 / 1 / 2 | **0 / 0 / 0** |
| First frame once the page has loaded, file on disk | web after ~1.5 s, native 3–33 s later | **native after ~0.7 s** |
| First frame for a new clip at 25 Mbps | web after 53 s, native after ~1 min 54 s | **native after 47 s** |
| Download per new clip, fleet | 42 GB | **21 GB** |
| Disk per screen for one clip | ~423 MB | **~141 MB** |
| A page reload while video plays | a web lap, then a switch | **nothing visible** |

**How it rolls out:** a lead-only switch, off by default. It goes on for one screen per class,
then the class, only after the glass passes. Old copies are deleted only after the new store has
proven itself on that screen, and alert media keeps its spare copy. Turning the switch off puts a
screen back exactly where it is today. There is no setting for anyone to choose.

**Decisions I need:** D1 (go), D2 (keep the spare alert copy; I recommend yes), D3 (all-clear when
the page is gone: I recommend keeping release with the page), and D7 (ship the small fix for false
24-hour blocks now).
