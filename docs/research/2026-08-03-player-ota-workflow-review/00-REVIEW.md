# Player upgrade workflow review — 2026-08-03

**Question:** "Do I have the best workflow possible to remotely keep the screen up to date?"

**Verdict:** The *design* is genuinely strong — better than typical signage vendors
(default-off auto-update, deterministic canary cohorts, evidence-based auto-promote,
maintenance windows, fail-closed release policy, quarantine kill switch, watchdog +
rollback, atomic release script with CI gates). **But the pipeline is dead in
production right now** — making the repo private on 2026-08-01 broke the OTA
resolution chain in three independent places, verified live against prod. There is a
grace period: the current fleet can't OTA across the v1.1.0 signing/package boundary
anyway (manual reinstall was already planned). The resolver must be fixed **before**
the physical reinstall pass, or the first post-reinstall update (v1.1.1) will silently
never arrive — the exact "fleet stuck, no error anywhere" failure mode this system
was built to prevent.

---

## The workflow as it exists (all layers)

Three update layers, correctly separated so APK churn is rare:

1. **Content** (seconds) — signed WS push + 6-15s manifest polling fallback. Not in
   scope here; healthy.
2. **Web app** (minutes) — the APK is a WebView shell; the actual player UI ships
   from Vercel on every web deploy with zero fleet action. `REFRESH_WEB` →
   `hardCacheBustingReload` for forced reloads. This is the architecture win: most
   product changes never need an APK release.
3. **APK shell** (the OTA pipeline reviewed here):

### Release side
- `scripts/release-apk.sh player x.y.z` — atomic bump+commit+tag (versionCode =
  MA*10000+MI*100+PA), refuses dirty tree / duplicate tag. Push tag → CI.
- `.github/workflows/android-player-apk.yml` — builds **release-signed** when the 4
  `RELEASE_*` secrets are present (falls back to debug with a loud warning),
  debuggable-APK gate is live with the escape hatch **deleted**, keystore-tracking
  gate blocking. `apk-version-tag-sync` guards tag/version drift.
- v1.1.0 (vc 10100) is tagged, release-signed (CN=VenueOS), 5.8 MB (R8 minified,
  down from ~12 MB debug).

### Server side (`apps/api/src/player-ota/`)
- `POST /player/update-check` (6h poll + boot + instant push): default **no
  auto-update**; per-tenant `autoUpdatePlayerEnabled` opt-in OR per-screen/tenant
  "Push update" (`forceApkUpdatePendingAt`, 24h window, cleared **only** by a
  device-authenticated version-bump report — OTA-01). Maintenance windows
  (tz-aware, wraparound, per-screen override), stalled-install auto-clear (10 min),
  stale-flag sweep (24h).
- Canary: deterministic hash cohort per tenant (`canaryFleetPercent`), auto-promote
  rebuilt 2026-08-03 (OTA-02) to require **positive evidence** — non-empty cohort,
  ≥1 confirmed install, error rate under threshold; authenticated errors always halt.
- Release policy gate (OTA-03/04/05): https + host allowlist on every advertised
  URL, anti-rollback floor (`MIN_SUPPORTED_PLAYER_VERSION`), quarantine denylist
  (code + `PLAYER_APK_QUARANTINE` env, subtractive-only), out-of-band SHA pins
  (`PLAYER_RELEASE_SHA_PINS` + env). Everything fails closed to `uptoDate`.
- `GET /player/apk/v/:vc` — Railway-egress APK proxy (GH_TOKEN-authenticated fetch,
  LRU cache) — solves the GitHub-CDN anonymous-download throttle (13-min downloads,
  2026-05-12).

### Device side
- **Player** `OtaUpdateWorker`: 6h WorkManager periodic + boot + WS
  `CHECK_FOR_UPDATES` → instant one-shot (dashboard "Push update" →
  `screens/force-update` → signed WS → WebAppBridge). Host allowlist re-validated at
  point of use on both `api_root` and `apkUrl` (AND-001), SHA-256 verify,
  `PackageInstaller.Session` with silent-install hint + installer-of-record
  (one tap on first self-install, silent forever after), Android 14 update-ownership
  lock, post-install relaunch safety net (persisted WorkManager job survives package
  replace), per-phase state reporting (CHECKING/DOWNLOADING%/VERIFYING/INSTALLING/
  ERROR) to the dashboard. Install success is only ever confirmed by the next
  heartbeat's version bump — no optimistic claims.
- **Manager** (companion): watchdog (30s ticks, 3-strike → relaunch Player),
  first-boot-failure rollback (quarantine bad vc + reinstall archived previous APK),
  self-update (30 min), fresh-kiosk bootstrap (vc=0 → installs Player, no gate).

---

## Findings (ranked)

### P0-1 — OTA resolution is dead in prod: private repo × anonymous GitHub fetches
Verified live 2026-08-03:
- `api.github.com/repos/gschiemann/EDUCMS/releases` anonymous → **404** (repo PRIVATE).
- Prod `GET /api/v1/player/latest-version-public` → `{"versionName":null}`.
- Prod `GET /api/v1/player/apk/v/10100` → **200, 5.8 MB** (GH_TOKEN on Railway works
  against the private repo — the fix is code-only, no config needed).

Three independent breaks in `player-ota.controller.ts`:
1. `resolveLatestReleaseInfo` / `resolveLatestManagerReleaseInfo` /
   `resolveLatestManagerReleaseApk` — release-list fetch sends **no Authorization
   header** → 404 → `uptoDate` for every kiosk, forever, silently.
2. `resolveLatestPlayerReleaseSha` / `resolveLatestManagerReleaseSha` — fetch
   `browser_download_url` anonymously → 404 → empty SHA → fail-closed → `uptoDate`.
3. Even if 1+2 worked, the **advertised** `apkUrl` is `browser_download_url`, which
   a kiosk cannot fetch anonymously from a private repo.

**Recommended fix (one change, fixes all three + the old CDN-throttle problem):**
- Attach `GH_TOKEN` to the release-list fetches.
- Advertise the Railway proxy as `apkUrl`: build it from the update-check request's
  own `Host` (the device's `api_root` — guaranteed to pass the device-side
  `HostAllowlist`, since it IS the host the device validated):
  `https://<request-host>/api/v1/player/apk/v/<derivedVc>`.
- Compute the SHA from `ensureApkInCache(vc)` bytes instead of a second anonymous
  fetch — the digest then provably matches the exact bytes the kiosk will download.
- Same treatment for the Manager endpoints (`manager-update-check`,
  `manager-apk/latest`) — Manager bootstrap installs are equally dead.
- Egress: ~5.8 MB × fleet per release through Railway — trivial (uncapped plan).

### P1-2 — After the fix, the old `.debug` fleet will churn on an uninstallable update
Current fleet runs `com.educms.player.debug` v`1.0.74-debug` (debug-signed). Once the
resolver works, `semverGte("1.0.74-debug","1.1.0")=false` → they'll be offered
v1.1.0, download 5.8 MB, and **fail install every cycle** (package id + signing key
mismatch — `INSTALL_FAILED_UPDATE_INCOMPATIBLE`), spamming ERROR states and
bandwidth until manually reinstalled.
**Fix:** in `/update-check`, refuse to offer a `>=1.1.0` build to any caller whose
`versionName` ends in `-debug` (the suffix is reliably reported) — log
`needs-manual-reinstall` and return `uptoDate` + a diagnostic field the dashboard
can surface as a "needs hands-on reinstall" chip. That also gives the reinstall tour
a live checklist of which screens remain.

### P1-3 — On-device auto-rollback is degraded for release-signed builds
`RollbackInstaller`'s downgrade path relied on debug builds allowing downgrade
installs. Release-signed builds refuse downgrades without device-owner
(`installSystemUpdate`) — the "Phase 2.5 problem" its own comment flags. From v1.1.0
onward the automatic bad-build recovery is effectively: server-side quarantine
(`PLAYER_APK_QUARANTINE`) + ship a higher fixed version. That's an acceptable recall
path, but it should be a conscious decision, documented, and it strengthens the case
for the Phase-C device-owner provisioning already queued.

### P2-4 — Provenance pins are built but never populated
`PLAYER_RELEASE_SHA_PINS = {}` and `release-apk.sh` has no pin step. Until pins are
populated per release, the SHA is transport-integrity only (the code now says so
honestly). Add to the release flow: after CI attaches the asset, compute its sha256
and commit the pin (or print the `PLAYER_APK_SHA_PINS` env line in the script's
post-tag checklist).

### P2-5 — Anti-rollback floor still `0.0.0`
The old debug keystore is permanently compromised (public repo history). Once the
fleet is reinstalled on v1.1.0, set `MIN_SUPPORTED_PLAYER_VERSION = '1.1.0'` so no
debug-keystore-era build can ever be advertised again, no matter what tag appears.

### P2-6 — Manager path lacks the full policy gate
`manager-update-check` got the URL allowlist (OTA-04) but not the floor / quarantine
/ pins (`evaluateReleaseForFleet` is Player-only). Manager is the *more* privileged
component — it installs Player. Extend the gate.

### P3-7 — `RELEASE_SIGNING.md` header is stale
Says "Status: NOT DONE… nothing executed" — but steps 1–4 + 7 are done (secrets
loaded, workflow wired, escape hatch deleted, v1.1.0 shipped release-signed).
Update it to a checklist: remaining = Step 5 verify (bundled-Manager variant on a
real device), Step 6 field smoke (R8/ProGuard on real kiosk + Taurus), Step 8 (fleet
reinstall), Step 9 (retire old key).

### P3-8 — `release-apk.sh` could print the post-tag checklist
Watch CI to green → verify release asset name/signature → add SHA pin → (first
release after an incident) confirm quarantine/floor state. Cheap insurance.

---

## What already meets or beats industry best practice (keep)
- Default-off auto-update + explicit per-screen/tenant push (the operator's own
  requirement, correctly held).
- Canary cohort + auto-promote on positive evidence + sticky authenticated errors.
- Maintenance windows with per-screen override.
- Fail-closed release policy with subtractive-only env hooks (the 2026-05-15
  env-pinning lesson, learned and applied).
- Atomic release script + 4 CI gates (tag-sync, debuggable, keystore, build).
- Install confirmed only by heartbeat version bump; forensic `[ota]` log lines +
  AuditLog on unauthenticated claims.
- Watchdog + bootstrap + per-phase progress reporting.
- WebView-shell architecture keeping APK releases rare.

## The one structural upgrade worth planning (not urgent)
**Device-owner provisioning** (already queued as Phase C: QR DEVICE_OWNER). It's the
only thing that buys: guaranteed-silent installs on the very first OTA (no one-tap
bootstrap), true downgrade/rollback for release-signed builds (P1-3), and lock-task
kiosk hardening in one move. Everything else on the "best possible" menu (delta
updates, A/B seamless) is not worth it at a 5.8 MB APK on this hardware class.

## Recommended sequence
1. Ship P0-1 + P1-2 (one PR: authenticated resolution + proxy-URL advertising +
   `-debug` gate). **Before** the physical reinstall tour.
2. Verify live: `latest-version-public` returns `1.1.0`; a test screen's push
   completes CHECKING→…→install-confirmed.
3. During reinstall tour: dashboard chip from P1-2 tracks remaining `.debug` screens.
4. After fleet is on 1.1.0: raise floor to `1.1.0` (P2-5), start populating pins
   (P2-4), extend Manager gate (P2-6), refresh runbook (P3-7).

---

## ADDENDUM — SHIPPED same day (2026-08-03, "no customers, fix it all")

Everything code-side from the findings list landed in one wave:

- **P0-1 fixed.** All GitHub release-list fetches authenticate with GH_TOKEN
  (with a diagnosable `authed=false` warn log); `/update-check` and
  `/manager-update-check` advertise the Railway versioned proxies
  (`/apk/v/:vc`, new `/manager-apk/v/:vc`) built from the request's own Host
  (guaranteed to pass the device HostAllowlist); the sha256 is computed from
  the proxy-cache bytes — the exact bytes the kiosk downloads — replacing the
  deleted anonymous re-fetch hashers. `/manager-apk/latest` 302s to the proxy.
- **P1-2 fixed.** `blockedBySigningCutover()` in release-policy.ts; both
  update-check endpoints answer `-debug` callers targeting ≥1.1.0 with
  `uptoDate + needsManualReinstall` (bootstrap exempt). Screens-page popover
  shows a rose "Hands-on reinstall required" pill + explainer instead of a
  futile push button. (KioskSplash needed nothing — its update banner was
  already removed.)
- **P1-3 documented** as a conscious trade in RELEASE_SIGNING.md: post-cutover
  recall = server quarantine + ship-higher; true rollback returns with
  device-owner (Phase C).
- **P2-4:** `scripts/pin-apk-sha.sh` captures the out-of-band pin per release;
  `release-apk.sh` prints a post-tag checklist (CI watch → pin → verify →
  floor/quarantine reminder). Manager pin/quarantine env hooks added
  (`MANAGER_APK_SHA_PINS`, `MANAGER_APK_QUARANTINE`).
- **P2-5:** `MIN_SUPPORTED_PLAYER_VERSION = '1.1.0'` — the compromised
  debug-keystore era can never be advertised again. Manager floor stays
  `0.0.0` until manager-v1.1.0 exists (raising it earlier would refuse every
  manager build); raise post-tour.
- **P2-6:** `evaluateManagerReleaseForFleet` — full policy gate (URL + floor +
  quarantine + pins) on the manager path.
- **P3-7/8:** RELEASE_SIGNING.md status table rewritten to reality; both
  scripts carry the checklist.
- **NEW finding, fixed:** `bundleManagerApk` was hardcoded to
  `:manager:assembleDebug` — **v1.1.0's release-signed Player ships a
  DEBUG-signed Manager in its assets** (verified by unzipping the release
  asset). The task is now variant-aware off the release-signing env signal,
  excludes `-unsigned` outputs, and a companion `verifyBundledManagerApk`
  task hard-fails the build if no bundled Manager lands. CI's locate steps
  also refuse `-unsigned` artifacts. **Tour build = v1.1.1 + manager-v1.1.0,
  not v1.1.0.**

Tests: release-policy.spec extended (floor, cutover, manager gate) — 59/59
green across the 5 player-ota suites. Remaining owner/physical items: R8
field smoke (Step 6), tag v1.1.1 + manager-v1.1.0, reinstall tour (Step 8),
old-key retirement (Step 9).
