# Screens dark after the device-secret rotation — root cause and fix (2026-10-23)

PR https://github.com/gschiemann/EDUCMS/pull/149 (branch `fix/retired-signing-key-reregister`). Persisted by the lead per CLAUDE.md agent rule 8. The lead reviewed the security-critical change (below) before merge.

## Incident
The device-secret rotation's `finish` (05:42Z) removed `DEVICE_JWT_SECRET_PREVIOUS`. 14 paired screens at 5 sites stopped checking in at 05:43–05:44Z. Their 180-day device JWTs were signed by the retired key, and the API logged `[WS] Auth failed … jwt_invalid:invalid signature` every few seconds. Their Manager app kept checking in, so the units were on and online.

## Root cause (line numbers on master at the time)
1. **Server.** `verifyPriorToken` in `apps/api/src/screens/screens.controller.ts` special-cased only `TokenExpiredError` (~:960). Every other verification error became `'invalid'` (~:967) → `401 SCREEN_TOKEN_MISMATCH` (~:1020–1024). A retired-key token fails with jsonwebtoken's `invalid signature`, so it always hit the 401. The documented 1-hour + `requiresRePair` answer was unreachable for it. Spec `screens.register-retired-key.spec.ts`: 8 of its 18 tests fail on the old code with that exact 401.
2. **The player did try; the logs hid it.** Recovery fires on a manifest 401 (`apps/web/src/app/player/page.tsx` ~:7810) and on WS `AUTH_FAIL` (~:9495). It sends the stored token as `priorDeviceToken` and retries once a minute (`deviceCredential.ts:124`). A refused register left no trace: the 401 comes before any audit row, `RequestLogInterceptor` logs only successful mutations (`request-log.interceptor.ts:89`), and `AllExceptionsFilter` logs only 5xx (`all-exceptions.filter.ts:166`). The APK has opened no WS of its own since 2026-04-17; old APKs (1.1.23) load the same web player.
3. **Why they never renewed in the window.** Paired tokens last 180 days (`device-auth.ts:102`) and renew only on page reload or < 14 days before expiry (`deviceCredential.ts:94`). The runbook, script, `key-ring.ts` and the CLAUDE.md env row all assumed 1-hour tokens renewed every ~10 minutes.

## Fix
- **New `isUnverifiableDeviceTokenForScreen` (`device-auth.ts`).** It returns true only for jsonwebtoken's exact `invalid signature` error, on an HS256 token whose unverified claims say `kind:'device'` and name THIS screen (`sub` and `deviceId` agree). Such a token is graded `'unverifiable'`, which means exactly what an ABSENT prior gets: a 1-hour bootstrap credential (unproven, bootstrap audience, no tenant claim), no epoch rotation, `requiresRePair`, `authState` REPAIR_REQUIRED, and a `SCREEN_TOKEN_DOWNGRADED` audit row. The retired key is never consulted, signature checking is unchanged, and DEVAUTH-01 / DT-04 hold. Every other bad token is still a 401.
- **Logging.** A refused or downgraded prior writes one stdout line per screen per verdict every 10 min (bounded map; ids and verdicts only).
- **`keyIdOf` (`key-ring.ts`).** Token-issue audit rows (register and `/devices/pair`) record `mintKeyId`, a non-secret id of the signing key.
- **Rotation guard.** `scripts/rotation-renewal-guard.cjs` is read-only and verifies TLS against the CA in the repo. `node scripts/railway-rotation.mjs finish` refuses (exit 2, nothing removed) while any paired, non-revoked screen seen in the last 24 h has no token issued on the new key. "Seen" means the newest of last_ping / player_version_at / manager_version_at; the signal is `mintKeyId`. The override `--override-unrenewed "<why>"` first writes an immutable `KEY_ROTATION_FINISH_OVERRIDE` audit row.
- **Docs.** `docs/SECRET-ROTATION.md` A-4/A-5 now read: Resync the fleet inside the window, then let `finish` check. A new section covers recovery for a screen that missed the window. The false 1-hour claims in CLAUDE.md, `key-ring.ts` and a test header are corrected.

## Lead review
The register handler resolves `existing` by `deviceFingerprint` (`findUnique`) before `verifyPriorToken(existing)`. So the unverifiable branch needs the caller's fingerprint to match the screen AND the token's unverified `sub` to equal that screen's id. That is strictly no more than the fingerprint-only path already grants; it widens nothing.

## Reach and the operator step
The fix is server-only. Each dark screen's next once-a-minute recovery should get the 1-hour token about a minute after the API deploy is live, and content and alerts flow again over manifest polling. The live socket stays refused for bootstrap tokens by design (SEC-001), and the dashboard shows "re-pair required". Pressing **Restore trust** on each such screen gives it a proven 180-day token on its next re-register, with no pairing code or site visit. Until then each screen re-registers about once a minute and writes one audit row a minute (existing behaviour).

## Tests
- Full API Jest: 577 suites, 11,052 passed, 0 failed.
- API and web tsc clean.
- Guard and script tests 66/66 (17 new). Player credential unit tests 35.
- New e2e case 5 in `credential-lifecycle.spec.ts`: Chromium and WebKit 5/5 each.
- Scratch Postgres with all 160 migrations: the guard SQL, the immutable override row, and the real register handler on Prisma end to end (fails with the classifier off, passes with it on).

## Not verified
- No production confirmation of the refused registers (Railway edge HTTP logs would show `POST /api/v1/screens/register 401` from their IPs).
- Each screen's web bundle: one older than 2026-08-30 never re-registers on a 401.
- The live `finish` path was not run.
- A register response lost in the window would leave a screen holding the old token despite a new-key audit row.

## Follow-ups (not in the PR)
- During an open window, ask screens still on the old key to renew, so no fleet Resync is needed.
- Log refused 4xx mutations somewhere searchable.
