# Launch-Readiness Verification — 2026-08-03

**Ask:** "please make sure we are ready to launch."
**Morning verdict: NO-GO until the security branch ships. Everything else verified healthy.**

> **⚡ EVENING ADDENDUM (same day, ≈20:10Z — re-verified live): all three blockers CLOSED → GO.**
> See §8 at the bottom for the evidence. The body below is the morning state, kept for the record.

**Scope note (per the Standard-Audit-Surface rule):** this is NOT a fresh 21-section audit — the
last full one (2026-07-16, `docs/research/…launch-readiness-reaudit…`) closed READY / 0 blockers,
and the 2026-08-01→03 security program re-audited the highest-risk surfaces adversarially. This
pass verifies (a) live production health end-to-end, (b) everything that changed since 07-16,
(c) the full state of the in-flight security program, and (d) prod configuration. Surfaces not
re-examined here are covered by those two on-disk audits.

---

## 1. What is VERIFIED GREEN (all checked live this morning)

| Check | Result |
|---|---|
| Prod API `GET /health` | 200 — db ok, redis ok, running master tip `cca5aa78` (prod = latest master) |
| Prod `GET /health/storage` | 200 — upload ok, read ok, transport **primary**, 759 ms (the 07-31 upload outage is confirmed dead) |
| Prod `GET /health/emergency-path` | 200 — db + redis + **ws_signer ok** |
| Prod web `https://venue-os.app` | 200 |
| CI on master | Green across the board today: Prod Smoke ✅ (09:40Z), DB Backup ✅, Keep-warm ✅ |
| Security branch @ `0a1d6512` — API | non-incremental `tsc` clean; **Jest 154 suites / 2059 tests, 0 fail** |
| Security branch @ `0a1d6512` — web | `tsc` clean; **Jest 77/77 suites, 872/872 tests** (after un-burying — §3) |
| `pnpm preflight` | exit 0 (lockfile + workspace + API + web builds) |
| Taurus inset-serialization guard | clean (290 files, 0 landmines) |
| Mobile-perf guard | clean |
| Prod env hygiene | `ALLOWED_ORIGINS` ✅, `EMAIL_FROM` on verified custom domain ✅, `connection_limit=25&pool_timeout=20` ✅, CSRF enforced (no override vars) ✅, `DEV_WS_ALLOW` absent ✅, Sentry DSN set ✅ |

## 2. LAUNCH BLOCKERS (in order)

### B1 — The security fixes exist but are NOT on prod. Prod still carries every hole.
`security/player-fixes-2026-08-01` (25 commits, **local-only by design** — public repo, disclosure
sequencing) fixes, verified green in §1: **ACC-01 CRITICAL** (self-signup → SSO config →
SUPER_ADMIN JWT — a full platform takeover chain), ACC-02…08, INJ-003 + sandbox/CSP, R-01…R-08
realtime hardening, DT-01…08 device-token revocation, OTA-01…05. **Until this branch merges and
deploys, launch means launching the vulnerable build.** Ship path + disclosure options are in
`docs/research/2026-08-01-player-security-audit/04-FIX-STATUS-AND-DECISIONS.md` (owner decision).
The "Player security hardening" session is actively curating this branch — coordinate there.

### B2 — Prod `JWT_SECRET` and `SESSION_SECRET` are still the human-written beta placeholders.
Confirmed live in Railway env this morning (values not reproduced here; they are recognizable
"beta 2026" phrase strings, NOT the required 64-char random hex). `JWT_SECRET` signs every auth
token in the product. Rotation has been flagged since the 2026-06-15 audit and is still not done.
Fix: 2× `openssl rand -hex 32` into Railway → redeploy. Side effect: every session re-logs-in
(cleanest done together with the B1 deploy). `DEVICE_SECRET_KEY` / `DEVICE_JWT_SECRET` are already
proper hex ✅.

### B3 — The Android player track (the program's original CRITICAL pair).
Shipped APKs are debug-keystore-signed (public key in the repo) and `debuggable=true` — verified
against the real distributed v1.0.52 binary. The branch contains the fixed build/CI path
(guards verified working), BUT: (a) the branch's 920 changed Kotlin lines have **never compiled**
(no JDK on this machine — must be CI-built: `gh workflow run android-player-apk.yml --ref <branch>`
after push, or install JDK 17); (b) the signing cutover changes the package id
(`com.educms.player.debug` → `com.educms.player`) = **install-new-app on every screen**, runbook in
`apps/player/RELEASE_SIGNING.md`; (c) `bundleManagerApk` still hardcodes `assembleDebug` (known,
deliberate — cutover step); (d) proguard-rules.pro unvalidated until a release build runs.

## 3. Fixed during this pass (on the branch)

1. **22 web Jest suites were dead since the 2026-07-22 i18n wave** — `next-intl` is ESM-only, no
   transform/mock existed, so any suite transitively importing it failed to load. No CI workflow
   runs web Jest, so nobody saw it. Fixed via `apps/web/test-mocks/next-intl.tsx` (resolves the
   real `en.json`) — commit `5b73a916`. Web went 55/77 → **77/77**.
   → Follow-up chip spawned: add a web-Jest job to Deploy Reliability CI.
2. **Stale quarantine pin** re-pinned 20→15-of-16 (5 boards legitimately reactivated by the July
   redesign waves; all safety invariants held) — same commit.
3. **A "shipped" prod bug fix that never landed:** memory + session title said the
   `settings.license.tier*` raw-key render was fixed in `4d5dc0d7` — that commit sat on an orphan
   worktree branch, on neither master nor the branch. Cherry-picked: `bbdfe356`. (Live prod symptom
   today: Settings → Plan & screens chip shows `settings.license.tierPilot`.)
4. **Last two stale Ed25519 claims** (THREAT_MODEL.md + 2026-06-09 audit) corrected per R-08 —
   commit `5be492ad`.
5. **Worktree hygiene:** 12 leftover trees (the 83-GB failure class) removed; `git worktree list`
   is clean. **Every dirty tree was preserved first** — see §5.

## 4. Open decisions for Greg (unchanged owners' calls, now with verified inputs)

| # | Decision | New evidence from this pass |
|---|---|---|
| 1 | **Merge + disclosure sequencing for the branch** (keep-local / terse-messages-code-only / repo-private) | All server-side fixes verified green at `0a1d6512`; nothing pushed |
| 2 | ~~`NEXT_PUBLIC_API_URL` check~~ **RESOLVED**: deployed bundle bakes the Railway host | INJ-001 confirmed **HIGH not CRITICAL**; `HostAllowlist.kt` matches prod = fleet-safe |
| 3 | Secret rotation (B2) | Weak values confirmed live in Railway |
| 4 | APK signing cutover scheduling (B3) | Guards verified; runbook exists |
| 5 | `ACCEPT_LEGACY_UNBOUND_WS_SIG` → false in a SECOND deploy after fleet rollout | Still `true` at `ws-signature.ts:46` (correct for deploy #1) |
| 6 | Stripe: still `sk_test` + test prices. Fine for pilot; real billing needs live keys | Confirmed live |
| 7 | `ANTHROPIC_API_KEY` + `PEXELS_API_KEY` **absent in prod** — Concierge/sparkle/AI-designer + stock photos silently degraded. 2-min env adds if wanted for launch demos | Confirmed live |
| 8 | `GH_TOKEN` (a GitHub OAuth token) lives in the prod API env — presumably for OTA/GH-Releases. Verify its scope is minimal (fine-grained, releases-read-only) | Presence confirmed |
| 9 | Walnut-Creek demo files (untracked) contain **live demo credentials** — scrub/exclude before they ever land in the public repo; account exists in prod | Left untracked deliberately |

## 5. Salvage inventory (nothing was lost; trees removed, branches keep everything)

| Branch | Commit | Contents |
|---|---|---|
| `worktree-agent-a262f1e…` | `5dbb6c12` | **AND-002 partial** — `NativeBridgeChannel.kt` + `nativeBridge.ts` (uncompiled, unfinished). Harvested onto the branch as `d0e63bda` by the hardening session — flagged to them that it's WIP |
| `worktree-agent-ace4526…` | `e149ec65` | Alternative api-key **scopes** impl + schema migration (vs the shipped no-migration ACC-06). Harvested as `e4883887`, then correctly reverted (`0a1d6512`) |
| `worktree-agent-a411c…` / `a4ce…` / `a86…` | `7c0ee737` / `0bcdde1d` / `ae688f04` | **Unshipped hospitality board redesigns** (pool/spa, dining, concierge) with baked photo assets — master lacks these; worth a review-and-ship pass |
| `claude/adoring-euler-c03dcc` | `4d5dc0d7` | The i18n fix — now cherry-picked (§3.3) |
| `worktree-wf_e984975b-5fd-2` | `cbe5aa9a` | SVG upload re-enable, **[HELD — security review]** (pre-existing hold, untouched) |
| `worktree-agent-ad14c55…` | `91607468` | zone-url-guard salvage (superseded by INJ-003 commits; kept for reference) |

## 6. Concurrency note (process)

A second live session ("Player security hardening") was committing to the same branch during this
pass — it landed `38e9044a` (DT/OTA) mid-verification and auto-harvested my preservation commits.
Coordinated via session message; final verification (§1) was re-run at its settled tip `0a1d6512`.
Lesson for the protocol: **wip(preserve) commits on agent branches get harvested by the lead's
loop — mark salvage commits clearly and message the lead session before touching shared branches.**

## 7. Bottom line

Prod is healthy, CI is green, the demo district stands, and every line of the security program's
server-side work is verified green — but it is sitting on a local branch while prod runs the
vulnerable build, behind one disclosure decision and one secret rotation. **The fastest credible
launch path: decide disclosure → merge → rotate secrets in the same deploy → flip the R-02 flag in
a follow-up deploy → schedule the APK cutover.** Steps 1–2 of that path are decisions only Greg
can make; everything downstream of them is staged and tested.

---

## 8. EVENING ADDENDUM (2026-08-03 ≈20:10Z) — re-verification: GO

Every check below was run live this evening, not inferred from the morning pass.

| Blocker | Status | Evidence |
|---|---|---|
| **B1 — security fixes on prod** | ✅ CLOSED | Branch merged to master (`f1705782` + follow-ups, tip `a74c7894`); `git log master..security/player-fixes-2026-08-01` = 0 commits; Railway deploy **SUCCESS 18:55Z on `a74c7894`**; `/health`, `/health/emergency-path` (ws_signer ok), `/health/storage` (primary, 793 ms) all 200 **reporting that exact sha**. Disclosure solved by making the repo **PRIVATE** before push. |
| **B2 — placeholder secrets** | ✅ CLOSED | `JWT_SECRET` + `SESSION_SECRET` in Railway are now proper 64-char random hex (values checked in place, not reproduced). Device secrets unchanged-good. |
| **B3 — APK track** | ✅ CLOSED (build) / 🔧 ops remainder | `player-v1.1.0` + `manager-v1.0.23` published by CI 17:30Z under `assembleRelease` (`236032d8`); the "never-compiled Kotlin" risk is dead — CI compiled and released it. Remainder: reinstall v1.1.0 on the 4 existing physical screens (package-id change; runbook `apps/player/RELEASE_SIGNING.md`). New installs get v1.1.0 by default. |

Additional verifications:
- **All 12 CI workflows green** on `a74c7894` (18:55Z sweep), including the NEW blocking
  web-Jest job (`e9ec45d0`) — the §3.1 follow-up chip landed same-day.
- **R-02 flag already flipped**: `ACCEPT_LEGACY_UNBOUND_WS_SIG = false` at `ws-signature.ts:56`
  (`2998dd32`) — closed in deploy #1 rather than the planned two-step.
- **Fleet survived the deploy**: the 4 real Dodgers LED screens (the physical hardware) are
  ONLINE and heartbeating seconds apart, ~75 min after the deploy. Demo district intact
  (38 future-dated demo screens ONLINE as designed).
- **Web**: `venue-os.app` 200; Prod Smoke (live login + webkit-nav) green post-merge.
- **Dead env vars**: `PLAYER_APK_LATEST_VERSION_CODE` / `_NAME` / `_SHA256` still set in Railway
  but consumed by NOTHING (env pinning removed 2026-05-15; `release-policy.ts` owns OTA
  authority). Delete for hygiene so nobody mistakes them for the OTA control.

**Non-blocking owner punch list (unchanged from §4 where still open):**
reinstall v1.1.0 on the 4 physical screens · Stripe still `sk_test` (fine for pilot, swap for
real billing) · `ANTHROPIC_API_KEY`/`PEXELS_API_KEY` absent (AI + stock photos degrade
gracefully — add for launch demos) · `GH_TOKEN` is a classic `gho_` token — replace with a
fine-grained minimal-scope token · delete the dead `PLAYER_APK_*` vars · keep the Walnut-Creek
seed files (live demo creds) out of the repo · CLAUDE.md still says "repo is PUBLIC" — now
private, though the treat-as-public discipline should stay.
