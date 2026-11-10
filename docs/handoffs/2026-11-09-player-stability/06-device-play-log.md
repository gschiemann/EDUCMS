# 06 — Device play log (gap 7)

Agent F · Claude Opus 5.5 (Claude Code, worktree agent) · branch `claude/device-play-log`, cut from `origin/master` 58ec24c25 · 2026-11-09. Not pushed, no PR.

## What already existed (read before building)

| Thing | Where | What it proves | Why it is not a play log |
|---|---|---|---|
| Proof-of-play sampler | `apps/api/src/analytics/proof-of-play.sampler.ts` | Every 10 min, for each ONLINE screen, the highest-priority schedule's playlist → one `playback_samples` row (`tenantId, screenId, playlistId, sampledAt`). Kill switch `PROOF_OF_PLAY_DISABLED`. | Server-side guess of what was SCHEDULED. No item, no asset, no start time, ignores day/time windows (its own v1 limitation), no player input at all. |
| Hourly rollup + watermark | `proof-of-play-rollup.service.ts`, `playback_sample_hours`, `playback_rollup_state` | Exact sums for the report beyond 14 days. Kill switch `PROOF_OF_PLAY_ROLLUP_DISABLED`. Raw purge never cuts past the watermark (`proof-of-play.retention.spec.ts`). | Aggregates the same scheduled-playlist samples. |
| Report | `GET /api/v1/analytics/proof-of-play` (`analytics.controller.ts`) | Estimated hours per playlist / asset / screen. Asset airtime = playlist samples credited to every item in the playlist. | An estimate; cannot answer "did file X run on screen Y at 10:14". |
| Touch events | `POST /api/v1/analytics/touch-events` | Kiosk taps (device JWT). | Interaction, not playback. |
| Sports sponsor impressions | `POST /sports/sponsors/:sponsorId/impression`, `SponsorImpression` (`verified`, `screenId` via the beacon capability, `sports/beacon-capability.ts`) | A sponsor look entering view on a sports board. | Sports boards only. |
| Ad impressions | `ads/ads.service.ts` `recordImpression` → `ad_impressions` | Server-side, per ad-network serve. | Third-party ad networks only. |
| Per-file playback evidence | `telemetry/file-playback.ts` → `screen_file_playback` | Video smoothness per screen × file. | Quality evidence, one row per file, no timeline. |
| Interruption ledger | `screens/events/screen-events.ts` → `screen_events` | Reloads, engine swaps, OTA, `emergency-start/clear`. | Interruptions, deliberately "normal playback leaves no trail". |

**Search that proves the web player sent no play/impression event before this branch:** `grep -rn "impression\|playLog\|play-log\|proof" apps/web/src/app/player` — hits only `proof` in the render-proof / emergency-paint-proof sense; the only player POSTs are telemetry, refresh-ack, render/cache proof, player-logs (APK) and touch events. Nothing was duplicated.

## What I built

1. **Web player** — `apps/web/src/app/player/playLog.ts` (new). `PlayLogCore` is pure (every clock is an argument): open entry, bounded queue, upload decision, persistence format. `startPlayLog` is the glue (one 30 s interval, localStorage, `fetchJsonBounded`, `pagehide`). `playLogShown` decides what is loggable.
   - Entry: `{ startedAt (server-corrected wall ms), shownMs (monotonic), completed, playlistId, itemId, assetId }`. Ids are filtered to `[A-Za-z0-9_.:-]{1,128}` — no names, no text.
   - `completed`: shown ≥ planned − 1 s; for an item with no planned duration, true unless cut short. Solo items split into 15-min segments. Flickers < 250 ms dropped.
   - **Emergency decision: alerts and drills are NOT logged** (the audit log is their record of truth, with `screen_events` and the paint proof). Any raised hold (`nativeFirstHoldRaised`, which includes `activeEmergency`, pushed messages, polled takeover, pending override) closes the open item as `completed: false` and blocks upload for as long as it is raised (stronger than "the first seconds"). An emergency playlist is never logged.
   - Bounds: queue ≤ 2,000 (oldest dropped); persisted ≤ every 30 s + pagehide (~200 KB max); on a quota error it sheds the older half so the emergency cache keeps its room. A persisted queue for another screen id (re-pair) is dropped.
   - Cadence: first upload 3–4 min after start (jittered), then 10 min; backlog drains a 200-entry batch per 90 s. 2xx removes exactly the sent batch; 400/413 drops it; 401/429/5xx/no answer keeps it. Server `stop` drops the queue and stops recording until `retryAfterMs` (persisted, survives reloads).
   - Never in preview mode (the page never starts it). Chromium 83: no `inset`, no flex `gap`, no `AbortSignal.timeout`, no DOM styling.
   - **`page.tsx` diff (13 lines, two hunks):** one import after the `./telemetry` import (line 206) and lines 11838–11849: a `playLogRef`, a start effect keyed on `screenId`, and an observe effect, placed right after the native website-overlay effect. No overlap with #295's push-gate lines (it touches the push gate region, not these).
2. **API** — `apps/api/src/play-log/` (new module, registered in `app.module.ts`):
   - `POST /api/v1/screens/:id/play-log` (`play-log.controller.ts`): kill switch first (zero work), Content-Length > 64 KB → 413 (plus a route-scoped 64 KB `express.json` in `main.ts`, same as telemetry), strict zod (`play-log.policy.ts`; unknown keys refused, ≤ 200 entries), shared `verifyDeviceForScreen` with default options (unproven and unpaired refused), tenant from the credential's live screen row, per-screen floor 1 batch / 20 s (429, no DB), `createMany({ skipDuplicates })`. DB failure → 503 so the player keeps the batch. CSRF: covered by the existing Bearer bypass. IP `@Throttle` 300/min.
   - **Idempotency key = primary key (screen_id, started_at, playlist_item_id)**, a client-generated natural key: the player stores `startedAt` once and resends it unchanged, and a screen cannot start one item twice in the same ms. Chosen over a random entry id because it is also the "this screen between these times" index, so it costs no extra index.
   - Ids are opaque strings, never joined across tenants: the read side resolves names with `tenantId` in every `where`.
   - `GET /api/v1/analytics/play-log` (`play-log-read.controller.ts`): JwtAuthGuard + RbacGuard, same role set as the proof-of-play report, `screenId` or `assetId` required, range ≤ 31 days (default 24 h), JSON ≤ 5,000 rows (`truncated` flag), `format=csv` ≤ 50,000 rows using the audit export's `csvEscape` (now exported from `audit/audit.controller.ts`; one-word change).
3. **Storage** — `PlayLogEntry` / `play_log_entries`, migration `20261109120000_play_log_entries` (additive, `IF NOT EXISTS`, generated with `prisma migrate diff`). Indexes: PK; `(tenant_id, asset_id, started_at)`; BRIN `(started_at)` for retention. Not in `MANIFEST_FED_MODELS` (spec pins `shouldBumpManifestRev('PlayLogEntry', 'createMany') === false`). Retention: `PlayLogRetentionService`, hourly, leader-leased (`LEASE.PLAY_LOG_RETENTION`), `DELETE … WHERE ctid IN (SELECT … LIMIT 20000)` × ≤ 20 per pass, `PLAY_LOG_RETENTION_DAYS` default 30.
4. **Config/docs** — `PLAY_LOG_DISABLED`, `PLAY_LOG_RETENTION_DAYS` in `env-schema.ts`; `docs/ENVIRONMENT.md` + `.env.example` regenerated; rule 18 in `apps/web/src/app/player/CLAUDE.md`; `CHANGELOG.md` 2026-11-09; Register B row in `docs/governance/AUTONOMY-REGISTER.md`.
5. **UI: proposal only, not built.** `apps/web/src/app/[schoolId]/analytics/page.tsx` already renders the proof-of-play report; the natural slot is a "Play log" tab there and a "Where did this play" link on a Media Library file's details, both calling the read endpoint with a date range and a CSV button. Needs en/es/zh strings and a mount proof — left for a UI pass.

## Volume estimate (rows per screen per day)

One row per item shown. 12 h of operating hours at a 10 s average item ≈ 4,300 rows/screen/day; 24 h at 10 s = 8,640; a solo slide = 96 (15-min segments). At ~270 bytes/row with the PK and asset index: ~1.2 MB/screen/day, ~35 MB/screen at the 30-day default. **100 screens ≈ 3.5 GB; 1,000 screens ≈ 35 GB.** That is the main open decision below. Purge capacity: 400k rows/hour.

## Tests (real counts)

- `npx jest src/play-log` (API): **23 passed** — device auth refused → 401, unpaired → 401, two tenants (body cannot carry tenant/screen; each device lands in its own tenant; reads see only own rows; names resolved in-tenant), idempotent retry stores 0, kill switch zero work + stop, 413 / >200 → 400 before auth, text field and hostile ids refused, 20 s floor → 429, DB failure → 503, manifest cache untouched, policy window + floor memory bound, read query validation, CSV formula escape, retention default/override/disabled, chunk bound, failure, non-leader.
- `npx jest src/app/player/__tests__/playLog.test.ts` (web): **16 passed**.
- Migration applied twice to a scratch Postgres 16: both exit 0; `ON CONFLICT DO NOTHING` retry left 1 row; the chunked `ctid` DELETE runs.
- Full API jest, run 1: 631 suites passed, 3 tests failed, all mine: the SEC-001 device-route inventory and the SEC-009 two-tenant matrix correctly flagged the new routes. Fixed by adding the ingest to `DEVICE_AUTH_SITES` (`unpaired: refused`, now stated as `allowUnpaired: false`) and two matrix rows plus a `playLogEntry` dataset (`screens/device-route-inventory.spec.ts`, `tenant-isolation/two-tenant-role-matrix.spec.ts`). Rerun of those suites plus `src/tenant-isolation`, `src/audit`, `src/play-log`: 9 suites, 896 tests passed.
- Full API jest, run 2, at the same time as the web suite: 629 passed and 4 failed, in `ai/designer-assets.item-photos`, `branding/supertaco-reference`, `assets/assets-content-check.controller`, `assets/upload-content-check.service`. These are unrelated to this change; the slow ones took 175 s. Run alone, all 4 pass (117 tests). They passed in run 1. Read as load or timeout flakiness; confirm in CI.
- `apps/web`: `npx tsc --noEmit -p .` exit 0; `npx jest src/app/player`: 124 suites, 1,802 tests passed.
- `apps/api`: `tsc --noEmit -p tsconfig.build.json` exit 0. Under the spec-including `tsconfig.json`, the errors are only in spec files this branch does not touch.
- Gates: `check-tenant-isolation.cjs` OK (83 tenant-owned models, 0 unscoped, baseline unchanged at 0). `generate-env-docs.cjs --check` ok. `check-env-declared.cjs` 0 errors. `check-inset-serialization.cjs` OK. `check-rulebook.cjs` PASS. `check-schema-has-migration.cjs` run after commit.

## NOT proven

- Nothing on hardware or a live screen: no on-glass check that `displayIndex` matches the glass for native video / native-first faces, zone/template content, or long offline spells on a real WebView. Template-mode screens (no playlist items) log nothing; widgets inside zones are not logged.
- Not deployed; the read endpoint was not exercised against a real database.

## Kill switches and failure directions

- `PLAY_LOG_DISABLED=1` (API): route returns `{ stop: true, retryAfterMs: 6h }` with zero work; players drop their queues and stop recording. Unset → the log runs. Failure direction: **open toward playback** — every player failure drops the entry, never affects playback or the alert path.
- `PLAY_LOG_RETENTION_DAYS≤0`: purge off. A purge that cannot run deletes nothing (keeps rows).

## Blast radius on merge

- **Web player (every screen, on its next bundle load):** two effects start; ~one 30 s timer, one ≤ 200 KB localStorage key, one POST per screen per 10 min (~144/day; a few more while draining). Before the API is deployed the route 404s and the player keeps its capped queue (no loop, no retry storm). Off: `PLAY_LOG_DISABLED=1` on the API (players stand down for 6 h at a time); a full off on the web side is a revert.
- **Migration (at API boot):** creates one empty table and two indexes; touches no existing table, takes no lock anything else waits on. Rollback: revert the PR; the table stays harmlessly (additive).
- **Retention worker:** first pass 150 s after boot, then hourly; empty table = one cheap statement.

## Overlap with #294 / #295

- #294 (Kotlin): none.
- #295 (web): `page.tsx` only — my two hunks (line 206 import, 11838–11849) are away from the push-gate lines; expect a clean or trivial rebase. No change to `storageEstimate.ts` / `staleDropRecovery.ts`.

## Open decisions for the owner

1. **Retention and DB size** — default 30 days ≈ 35 MB/screen. Keep 30, shorten, or keep raw short and add an hourly per-asset rollup (like proof-of-play) for long reports?
2. **Ship ON at merge, or merge with `PLAY_LOG_DISABLED=1` set first** (launch-week no-disruption rule)? The cost is the database growth above, not playback.
3. Should a K-12 tenant's log be restricted further? It holds ids and times only, no student data, so I applied no FERPA gate.
4. The UI proposal above.
