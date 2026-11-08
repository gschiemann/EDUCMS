# FUH storage full, black after an alert, and the DH43 delay (2026-11-07)

Author: Claude Opus 5.5 (`claude-opus-5-5`), Claude Code agent harness, isolated worktree. Phase 1 was read-only: SELECTs through the postgres MCP, `git log`/`git show`, and `gh pr view`. No screen command, alert, all-clear, OTA, cache clear or flag change was made. The Railway MCP failed to connect, so the live API environment flags (`PLAYER_CONTENT_STORE`, `PLAYER_NATIVE_FIRST`) were **not** re-read. Their state below comes from the 2026-11-04 handoff.

Timestamp note: the postgres MCP shows naive `created_at` values 8 h ahead. Every time below was read with `created_at::text` and is UTC; device log stamps (`…Z`) agree with it.

## The screens

| Screen | id | Hardware (from `last_video_report.native.device` / UA) | Android | WebView | Player |
|---|---|---|---|---|---|
| FUH43-L | 5c9e2109-… | Amlogic, class `amlogic/android-9`, decoder `OMX.amlogic.avc.decoder.awesome`, 1920×1080@60 | 9 (SDK 28, `Commercial Build/PPR1.180610.011`) | **Chrome 66.0.3359.158** | 1.1.64-field.1 (10164) |
| FUH43-R | 9b73af0f-… | same | 9 | Chrome 66 | 1.1.64-field.1 |
| DH43 (front / back) | 40864836-… / 80bf9b8d-… | rk3288, two faces | 7.1.2 | Chrome 116 | 1.1.64-field.1 |

`hardware_model` reads `generic-android` for all four, and `screens.user_agent` is stale (it still says EduCmsPlayer/1.1.23). The version is in `player_version`.

## Findings

### 1. The WebView quota is 167,680,409 bytes, and the cache tiers we report hold about 11 MB of it

- Measured by the player's own diagnostics (`navigator.storage.estimate()` in `deviceDiagnostics.ts`): FUH43-L `{"usage":166922437,"quota":167680409}` at 2026-11-04 21:14:17Z. FUH43-R reached `usage` 167,371,973 on the same quota.
- 167,680,409 B is 159.9 MiB, the owner's "159 MB". Chrome 66's temporary-storage pool gives each origin a share of the **free** disk, not of the whole disk. A small, nearly full `/data` partition therefore yields a quota of about 160 MB.
- "Earlier it showed nothing, now it shows some": PR #253 (merged 2026-11-04 03:03Z) replaced the fabricated initial values and the whole-GB rounding that turned a 0.16 GB quota into "0". The number is real now, and it is full.
- `last_cache_report` showed the playlist tier at 0.93 MB (2 files) and the emergency tier at 10.6 MB (18 files). The never-evict emergency tier is about 6 % of the origin. **It is not what fills it.**
- What fills the rest is **not reported**. The cache report omits `STAGING_CACHE` (the `/__edu_stage__/` and `/__edu_stage_em__/` chunks) and drops the shell tier, which the worker does send. Indirect evidence:
  - On 2026-11-03 the 52,262,871-byte file stalled at offset 41,943,040 (5 × 8 MiB) on both screens, 64 times between 20:09Z and 22:53Z. The failures were reported as `truncated`; before #253, a QuotaExceededError was hidden behind that reason.
  - So with only 40 MiB of that file staged, the origin was already at its limit. Roughly **100 MB** sat outside the playlist and emergency tiers.
  - On 11-04 the 128,108,229-byte file stalled at several offsets: 25,165,824, 41,943,040, 47,185,920, 52,428,800, 54,525,952 and 68,157,440. That is consistent with the page halving its chunk size after each failure (`failStep`) and leaving overlapping runs and `tmp-*` bodies behind. The 21:13Z snapshot reads `usage` 114.5 MB with about 52 MiB of that file staged.
- Candidate occupants, none of them measured on the device:
  - (a) playlist staging leftovers: `tmp-<offset>` bodies from a stopped worker, and chunks covered by a longer chunk. `purgeStagingExcept` keeps all of these while the URL is still live.
  - (b) the shell cache. `RUNTIME_KEEP_MS` keeps every `/_next/static` chunk the page used within 30 days, and master took about 580 web-touching commits in that window. The local build's player route references about 2.4 MB of JS. Tens of bundle versions are plausible but unproven.
  - (c) a stale chunk run for a URL that is still live.
- Emergency large-file staging (`/__edu_stage_em__/`) is not implicated: the emergency set is 18 small files, 10.6 MB in all, and none of them is on the large-file lane.
- Duplicates: none in the playlist or emergency tiers (2 and 18 entries). Overlap inside staging cannot be excluded until the new staging bytes are reported.

### 2. Black after an alert

- **FUH: the all-clear meets a cache that cannot finish.**
  - `decidePlaylistCommit` (mediaReadiness.ts) commits the regular playlist at once when the content on glass is emergency content. It does this on purpose, so an all-clear is never held behind the alert.
  - Under rule 17(d), the large item is then never mounted until its bytes are on disk. On a full 160 MB origin the 128 MB file, and later the 52 MB file, never get there.
  - So the screen sits on the readiness splash / black with the proof hash `idle:content-downloading`. The 11-04 handoff records exactly that, "FUHs remain black for minutes after clear … WebView UI 159/159 MB", and nothing ever completes the download. That is "never comes back right".
  - Before the alert the content was on glass because the deferral rule had kept the previously playing item up, or native was presenting it. The alert removed that on-glass content, and with it the deferral.
  - **Not** the cause: eviction by the emergency precache (the emergency tier is 10.6 MB and its prune touches only its own namespace), a page reload, or the blank policy (sleep report `blank: screen-timeout`, interactive=true, foreground=true).
- **FUH, after the last drill (clear 2026-11-04 21:40:31Z, FUH43-L on 1.1.64):** native solo sessions for sha 9325cc0a started at 21:41:35Z and were stopped `page-stopped` after 9 frames. The page then logged "the last playable file failed (attempt 2) — re-mounting in 5 s", and native restarted and stopped again. In the native/web handoff the web side cannot play the file because the web cache does not have it. PR #257 ("retain the solo browser through native admission changes", web) and #256 (store discovery, web) merged at 03:15–03:57Z on Nov 5, **after** that drill. No alert has run since, so whether they repair the post-clear path is **unverified**.
- **FUH today:** both screens present natively. 9325cc0a has `uniqueFrames` about 970 k (L) and 1.03 M (R), 0 drops, 0 stalls, `state: presenting`. Normal playback is good. Post-alert recovery is unproven.
- **DH43 (two faces): the double-sided echo loop, unfixed.** After the clear at 21:40:31Z, `PLAYER_EMERGENCY_RECOVERY` shows **new** holds raised after the all-clear, with no alert behind them:
  - `heldAtMs` values 1793828437005 (21:40:37Z), 1793828470196, 1793828474564, 1793828492818, 1793828493237 and 1793828498826 (21:41:38Z), alternating face 0 and face 1.
  - Each hold climbs the paint-recovery ladder, steps 0→4, ending `unconfirmed` / `no-overlay-paint-proof`.
  - This is exactly PR #241's root cause. #241 is **OPEN, not merged**, so it is live on no screen. The 5-minute-plus recovery is the ladder plus the echo re-seeding until one face's release finally sticks. DH43's origin quota is about 2.2 GB, so storage is not its cause.

### 3. Re-downloading: yes

`content cache failed … storage-quota` ran on both FUHs **6–17 times an hour, every hour, from 2026-11-04 03:00Z to 21:00Z** (about 300 events). Each attempt downloaded its whole Range body, up to 32 MiB, before `Cache.put` refused it. The page then halved the chunk size and tried again. That is the owner's "re-downloading the content again". Separately, native store enrolment (FUH-L store trial) keeps its own app-private copy of the same file. That is by design and is a second copy, not a loop.

### 4. Related PRs

| PR | State | What | Live on these screens? |
|---|---|---|---|
| #247 release 1.1.63 | merged 11-02 | launch candidate | superseded by the 1.1.64 field build |
| #252 Android 9 delivery repair | **OPEN draft** | bridge nonce, single-copy staging, storage UI, 30 fps cap | its bridge commit cd2213a0c was cherry-picked into the 1.1.64 source (aa444aa7e); its web parts came via #253 |
| #253 cache recovery + storage estimates | merged 11-04 03:03Z | single-copy staging, honest QuotaExceeded, honest estimate | **live (web)**. It made the failure honest and the gauge real. It did not free the origin. |
| #254 offline remote menu | merged 11-04 | web | live |
| #255 native store enrolment bootstrap | merged 11-05 02:55Z | APK + API fixture | in 1.1.64-field.1 (built from aa444aa7e, run 41905986062) |
| #256 store discovery after image→video | merged 11-05 03:15Z | web | live; the post-alert result is unverified |
| #257 solo resume through admission changes | merged 11-05 03:57Z | web | live; the post-alert result is unverified |
| #241 double-sided echo loop | **OPEN** | web + APK, EMERGENCY-PATH | **not live**: this is DH43's delay |
| #250 rotated-display banner | OPEN | EMERGENCY-PATH | not live |

- `field-candidate-releases.ts` on master registers candidates up to 1.1.62-field.1. 1.1.63 and 1.1.64 are not registered.
- `field_build_windows` has no 1.1.63 or 1.1.64 window. The last window naming FUH43-L is 1.1.62-field.1 (11-03 17:03Z, cancelled).
- The owner installed 1.1.63 and then 1.1.64-field.1 on the FUHs **by hand** (the 11-04 handoff, 21:13Z). The 1.1.64 APK is sha256 4e7ff524…ab274, on the production certificate, unqualified.

## What 1.1.63 and 1.1.64 fixed, and what they did not

- **Fixed and seen in the field:** alerts stay visible and Exit to launcher works (1.1.63). Native solo playback of the 50 MB file is now stable on both FUHs (1.1.64 plus the web PRs #256/#257): about 1 M unique frames, 0 drops.
- **Not fixed:**
  - (1) The origin quota starvation. The web cache still cannot hold a playlist bigger than about 150 MB and still re-downloads chunks that cannot fit. Phase 2 below addresses the second half.
  - (2) Post-alert recovery on FUH. Unverified; it needs an owner drill on the bench.
  - (3) The DH43 echo loop. Needs #241.

## Phase 2 — this branch (`claude/fuh-storage-alert-recovery`)

**Web worker, playlist tier only. The emergency path is untouched.**

- **The worker checks for room first.** Before any playlist Range fetch it reads `navigator.storage.estimate()`, bounded at 2 s. If the chunk cannot fit:
  - it first reclaims playlist staging that no reader can serve: `tmp-<offset>` bodies that no chunk event is writing, and chunks wholly covered by the file's contiguous run;
  - if the chunk still cannot fit, it answers `storage-quota` **without downloading**. The answer carries `freeBytes`, `quotaBytes`, `needBytes`, `reclaimedBytes`, and an occupancy breakdown: playlist, emergency and shell bytes, plus staging per tier.
- **What it keeps:** chunks past a gap (resume data), every chunk in the served contiguous run, the emergency namespace and `EMERGENCY_CACHE`. It neither reads nor deletes any of these.
- **Safe when the estimate fails:** an estimate that is missing, slow or nonsensical lets the fetch proceed exactly as before.
- **After a refused write:** a QuotaExceededError on a playlist chunk write also triggers the reclaim, so the next attempt has room.
- **Reporting:** `STATUS_REPLY` now carries `staging` per tier, and the page's `CacheStatus` passes it through. The page's chunk-failure diagnostic keeps only the worker's numeric fields (`storageEvidence`) and no free text, so the next field quota failure names the occupant.
- **Tests:**
  - `sw-large-asset-cache.test.ts`: a refused chunk with zero network, reclaim with past-gap data kept, an estimate that fails or answers nonsense, staging in the status reply.
  - `sw-emergency-large-assets.test.ts`: on an origin that reads as full, an emergency chunk is never refused, and a playlist reclaim leaves emergency staging alone.
- **What it does not do:**
  - It does not make a 128 MB playlist fit in a 160 MB origin.
  - It does not change readiness gating or `decidePlaylistCommit`.
  - It does not prune the shell cache. That is the STEP-3 guard; decide only after the new occupancy numbers come in.
  - Rule 17 "never stream" is unchanged.

**Not emergency-path code**, by construction: playlist namespace only, and the emergency suite proves the isolation. A different-vendor review is still recommended because it is player cache code.

## Proposal: release candidate 1.1.65

PRs to include:

- **#241**, echo loop. EMERGENCY-PATH: needs a different-vendor review, the owner's merge, and a two-face drill. **The DH43 fix.**
- **#250**, rotated banner. EMERGENCY-PATH, same bar as #241.
- **Legacy-WebView polyfills** (`claude/legacy-webview-polyfills`). Chrome 66 is on two production FUHs.
- **Touch-template website fit** (`claude/touch-template-website-fit`).
- **This PR**, headroom.
- **The remaining non-web parts of #252**: the 30 fps descriptor ceiling (API) and the bridge nonce. Rebase it, drop what #253/#255 already landed, and get a different-vendor review, which #252 never had.

Build and qualification:

1. Merge the web PRs (live on Vercel, no APK needed). Confirm `/health` commit and the bundle sha.
2. Bump Gradle to 1.1.65 and run the field-candidate `workflow_dispatch`. Verify the signing cert e45adf50…3d1897, versionCode 10165, both ABIs and non-debuggable. Register it in `field-candidate-releases.ts` through a PR.
3. Arm a `field_build_windows` row, one class at a time, off-hours:
   - FUH43-L first;
   - then DH43 (both faces, one unit);
   - FUH43-R only after L passes.
4. On glass, per `docs/player/HARDWARE-QUAL-CHECKLIST.md`, with a camera:
   - an owner bench drill (drill mode, bench screens) followed by the all-clear;
   - time to first content frame after the clear. Target: under 10 s on FUH, and on DH43 both faces back with no new `heldAtMs` after the clear;
   - the next diagnostic must show `occupancy` and no further `storage-quota` Range downloads;
   - native frames advancing;
   - a reboot, an offline-recovery pass, and remote-only navigation.
5. Record PASS or a named override per class in `apps/player/HARDWARE-QUALIFICATION.md`, then tag `player-v1.1.65` on the merged commit.

Owner content decision (no code): on this Android 9 class, keep a single normal playlist's total under about 120 MB until the occupancy data says what else is in the origin.
