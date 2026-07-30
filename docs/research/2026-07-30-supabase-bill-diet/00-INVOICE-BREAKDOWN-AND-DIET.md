# Supabase Bill Breakdown + Cost Diet — 2026-07-30

**Trigger:** Greg's July Supabase invoice (`DKICZO-00007`, $32.89) with "zero
customers and like zero activity." Target: total infra ≈ $5/mo until real
customers exist. **Result: root causes found and measured; the code-side fix
(manifest content cache) is shipped; two 5-minute dashboard moves by Greg take
Supabase from $32.89/mo → $0.**

## 1. Where the $32.89 actually went (line-by-line)

| Line | Amount | What it is |
|---|---|---|
| Pro Plan (Jul 30–Aug 29, billed in advance) | **$25.00** | The org's Pro subscription |
| Compute Hours (Micro) — `bhdaxzfalaycfopvcopm` | $9.68 | **VenueOS** project, 720 h (full month) |
| Compute Hours (Micro) — `efnbdbyezqkvxdakxfok` | $8.21 | **MouthMap** (the separate SLP telehealth app!), 611 h |
| Pro-plan compute credit | −$10.00 | Covers ~one Micro instance |
| Egress 25.6 GB, MAU 3, Realtime 13.8k msgs, transforms 67, storage 0.14 GB | $0.00 | All inside Pro quotas |
| **Total** | **$32.89** | |

**Root cause #1 — MouthMap lives in the same Supabase org.** The $10 compute
credit covers exactly one Micro instance; MouthMap's 611 hours were nearly pure
overage. VenueOS did not cause the overage line — the second project did.

**Root cause #2 — the Pro plan itself** ($25) is only needed for: no-pause,
daily backups, egress headroom (25.5 GB used vs Free's 5 GB cap), and image
transforms. Every one of those is now solved or fits Free (below).

## 2. Where 25.5 GB of egress came from (measured, not guessed)

`pg_stat_statements` since 2026-03-30 (live prod DB, queried 2026-07-30):

- The manifest fan-out cluster — `schedules` (2.49M calls), `playlists`
  (1.67M), `playlist_items` (2.40M), `assets` (277k×7 rows), `template_zones`
  (363k), plus per-poll `screens`/`screen_groups`/`tenants` singles (~2.3–2.9M
  each) — is **the entire egress story**: ~16 calls/min fleet-wide, i.e. the
  4-5 always-on test screens polling `/screens/:id/manifest` every ~30 s
  (the WS-healthy reconcile cadence + heartbeats).
- The player's ETag/304 saved **Railway→player** bytes, but the API still
  re-ran the full schedule→playlist→items→asset→template→zones fan-out
  (~7 queries, ~100 KB DB wire bytes) on EVERY poll to compute the ETag.
  **Supabase→Railway (database egress) paid full freight each time:**
  ~118 KB × ~5 screens × 2/min ≈ 850 MB/day ≈ **25 GB/mo. Mystery closed.**
- Correction to the 2026-07-20 efficiency audit: "the 60s poll costs
  ~nothing" was true for Railway egress but missed the DB-side egress. This
  doc supersedes that sentence.
- DB is **39 MB** total (fits Free's 500 MB ×12 over), storage 138 MB (fits
  1 GB), playback_samples purge from `663ec688` is working (oldest row
  2026-05-19, 12 MB total). MAU 3, realtime trivial.

## 3. What shipped today (code — all verified green before push)

### 3a. Manifest content cache (the 25 GB → ~1-2 GB lever)
`apps/api/src/screens/manifest-hot-cache.ts` + `screens.controller.ts` +
`prisma.service.ts`:

- The **built hashable payload** (or the static "no schedule" body) is cached
  per screen. A cache hit serves the same ETag/304/200 bytes with ZERO
  fan-out queries — only the live screen row + per-screen override +
  (2s-cached) tenant emergency state are read per poll, ~3-5 KB.
- **Invalidation — freshness contract identical to the uncached path:**
  1. A Prisma `$use` mutation hook bumps a process-wide content rev on any
     write to a manifest-fed model (`Screen, ScreenGroup, Tenant, Schedule,
     Playlist, PlaylistItem, Asset, Template, TemplateZone, TemplateScene,
     ScreenEmergencyOverride`) → an operator edit is visible on the very
     next poll. Screen updates touching ONLY telemetry columns
     (`SCREEN_TELEMETRY_ONLY_FIELDS`: lastPingAt, heartbeat status, OTA
     fields, cache/render-proof/sync reports) do NOT bust — otherwise the
     fleet's own telemetry would thrash the cache. Polarity is
     correctness-safe: unknown columns/actions BUST.
  2. `nextScheduleBoundaryAt` — a cached entry never outlives the earliest
     future schedule startTime/endTime for that screen's targets (two
     1-row indexed probes, run only on rebuild). A 3:00 go-live appears on
     the first poll after 3:00, exactly as before. (daysOfWeek/timeStart
     windows are player-evaluated from payload fields — no rebuild needed.)
  3. TTL backstop: 30 min hook-armed / 20 s unarmed (hook arming is NEVER a
     correctness dependency). Covers Supabase-Studio edits, seeds, future
     replicas. Multi-replica note: rev is per-process (numReplicas=1 today,
     same assumption as every existing debounce in that file); scaling out
     → move the bust to Redis pub/sub.
- **Never cached:** the emergency branch and the sports scoreboard branch
  return BEFORE the cache is consulted; REVOKED/auth checks read the live
  row every poll. Life-safety and live-score behavior is byte-identical.
- Torn-build guard: the rev is snapshotted before the first row is read; a
  mutation landing mid-build makes the stored entry stale-on-arrival.
- Tests: `manifest-cache.spec.ts` (hook decision polarity, rev race,
  boundary expiry, both TTL modes, eviction cap). Full API suite green.

### 3b. Free-plan thumbnail fallback
Supabase image transforms (`/render/image/`, 67 uses last month) are
**Pro-only** — on Free every thumbnail URL 400s. One capture-phase error
listener (`installThumbTransformFallback` in `apps/web/src/lib/asset-image.ts`,
mounted once in `components/providers.tsx`) swaps any failed transform back to
the raw object URL. On Pro it never fires; on Free thumbnails still render
(full-res, browser-scaled — fine at 138 MB total storage). No settings.

### 3c. Nightly encrypted DB backups (replaces Pro's dailies)
`.github/workflows/db-backup.yml`: daily 09:17 UTC `pg_dump -Fc` (PG17
client) → AES-256-CBC/PBKDF2-200k encrypt → Actions artifact, 30-day
retention. Repo is PUBLIC → only ciphertext is ever uploaded. Secrets
`SUPABASE_DB_URL` + `BACKUP_ENC_KEY` set via `gh secret set` on 2026-07-30;
the key is also appended to the local gitignored `.env` — **Greg: copy it to
your password manager.** Restore commands are in the workflow header.

## 4. Greg's dashboard moves (~5 min total) — the actual money

1. **Move MouthMap out of this org** (kills the $8/mo overage): Supabase →
   project `efnbdbyezqkvxdakxfok` → Settings → General → **Transfer project**
   → into a NEW free-plan org (create "MouthMap" org). Free tier = Nano
   compute, $0. (If MouthMap is idle it will auto-pause after ~1 week —
   un-pause takes one click when you demo it.)
2. **Downgrade this org to Free** (kills the $25/mo): Org → Billing →
   change plan → Free. Do this AFTER the Railway deploy of today's commit is
   live (egress must be under the 5 GB/mo Free cap going forward — the cache
   handles that; new billing cycle started Jul 30, clean slate). The $25
   already invoiced for Jul 30–Aug 29 should come back prorated as credit —
   check the billing page after downgrading.
3. Optional sanity: Railway plan should be **Hobby ($5/mo incl. $5 usage)** —
   measured API usage is ~$3-6/mo, Redis near-idle. If it says Pro/$20 seat,
   downgrade.

**Expected steady state: Supabase $0 + Railway ≈$5 + Vercel Hobby $0 +
GitHub $0 ≈ $5/mo total** — the target. **Flip Pro back on the day a real
paying customer goes live** (daily backups + no-pause + egress headroom are
worth $25 the moment revenue exists — one click, no code changes needed;
thumbnails auto-upgrade back to transforms).

## 5. Free-tier residual risks (accepted at zero-customer scale)

- **No PITR/daily Supabase backups** → mitigated by 3c (nightly, 30 copies).
- **Nano compute** (shared 500 MB) → fine at 39 MB DB / 100% cache hit /
  ~16 light queries/min. The manifest cache REDUCES load vs today.
- **Project pause after 1 week of inactivity** → won't happen while the
  Railway API + keepwarm + any screen polls (constant DB activity).
- **5 GB/mo egress cap** → post-cache projection ~1-2 GB/mo (verify in ~1
  week on the Supabase usage page; the in-app egress anomaly monitor +
  `PLATFORM_ALERT_EMAILS` is the standing tripwire).
- **Image transforms unavailable** → 3b fallback.

## 6. Post-deploy verification — MEASURED LIVE 2026-07-30

Deployed as `45cc0b34` (Railway SUCCESS 15:23 UTC; health reports the
commit; all 12 CI workflows green ×2 commits; Prod Smoke green on rerun —
its first failure was a mid-Vercel-deploy chunk-reload transient on
`/screens`, zero React crashes).

1. **Fan-out rate: 20.7/min → 1.4/min (−93%), measured via
   `pg_stat_statements`** on the playlist_items SELECT cluster:
   pre-deploy window 15:14→15:33 = 387 calls/18.7 min; post-deploy window
   15:33→15:43 = **15 calls/10.6 min** — and the residual includes
   dashboard/fleet-scanner callers, not just manifest rebuilds.
2. The 1.4/min rate itself proves the mutation hook ARMED (an unarmed 20 s
   TTL would rebuild ~6-9/min at the fleet's poll cadence).
3. Live logs post-deploy: per-poll live reads (Screen/override/tenant)
   flowing normally, WS auth/OTA/wedge-detector/proof-of-play all healthy.
4. Projected Supabase egress: ~25.5 GB/mo → **~1.5-2.5 GB/mo** (small
   per-poll reads + 30-min rebuilds) — under the Free-tier 5 GB cap with
   ~2× headroom. Confirm the trend on the Supabase usage page in a few
   days; the in-app egress anomaly monitor remains the tripwire.
5. DB Backup workflow: first live run FAILED on pg_dump 16-vs-17 version
   mismatch (runner PATH); fixed via `postgres:17-alpine` (`3a4faaac`) and
   the re-run SUCCEEDED — encrypted artifact landed with 30-day retention.
6. Remaining real-world check (needs an operator session): edit a playlist
   → screen updates on the next poll. Covered by the unit spec + armed
   hook; if a screen ever lags an edit by minutes, that's the signal a
   content write bypassed the Prisma hook — report it.
