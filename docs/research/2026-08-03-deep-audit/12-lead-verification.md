# Lead verification lane — 2026-08-03

Everything here was run by the lead directly, not by an audit agent. Covers §21 (Verification Before Claim), live prod state, live DB grounding, and independent re-verification of the highest-severity agent findings. **Findings an agent asserted are not repeated here unless I checked them myself.**

## 1. Live production state — all green

Run at ~20:43Z against `https://api-production-39a1.up.railway.app/api/v1`:

| Endpoint | Result |
|---|---|
| `GET /health` | 200 — `db:ok`, `redis:ok`, commit `a74c7894`, uptime 6254 s |
| `GET /health/ready` | 200 — `db:ok` |
| `GET /health/emergency-path` | 200 — `db:ok`, `redis:ok`, **`ws_signer:ok`** |
| `GET /health/storage` | 200 — `upload:ok`, `read:ok`, transport **primary**, 760 ms |
| `https://venue-os.app` | 200 |

Prod is healthy and running the security-wave sha. The 2026-07-31 upload outage and the storage-transport fallback both remain closed.

## 2. Live database grounding

```sql
active_tenants 19 · child_tenants 10 · screens_total 242 · screens_paired 213
screens_online 38 · active_users 88 · audit_rows 12949 · tenants_in_emergency 0
```

No tenant is stuck in an emergency state (the 07-31 stuck-lockdown class is clean in live data, not just in code).

## 3. The district-emergency gap, quantified against real data

The §1 agent found that a district-scope emergency trigger never reaches child-school tenants. I verified the code claim two independent ways and then measured the blast radius in prod.

**Code verification (mine):**
- `grep -rn "parentId\|children\|childId\|descendant" apps/api/src/emergency/` → **zero hits**. No hierarchy fan-out exists in the emergency module.
- The manifest resolves emergency state from `tenant.findUnique({ where: { id: screen.tenantId } })` (`screens.controller.ts:3116`) — the screen's own tenant, no parent walk.

**Blast radius (live prod):**

| District | Child schools | Paired screens that a district-level trigger MISSES |
|---|---|---|
| Walnut Creek School District | 7 | **38** |
| Springfield School District | 1 | **3** |
| Chardon High School | 2 | 0 |

**41 paired screens sit under child tenants today.** A DISTRICT_ADMIN firing a lockdown updates one `Tenant` row and publishes to one channel; every school screen keeps showing normal content. This is not theoretical — it is the shape of the flagship demo district. Demoing "district-wide lockdown" to a superintendent on Walnut Creek would visibly fail on all 38 screens.

## 4. ACC-09 cross-tenant hijack — independently confirmed

Read the full chain myself in `apps/api/src/onboarding/onboarding.service.ts`:
- `:572` looks the user up by **global email**; `:573` rejects only `status === 'ACTIVE'`.
- `:582` `const patch: any = { role, status:'ACTIVE', passwordHash, tenantId: input.tenantId }` — an `INVITED` placeholder belonging to another tenant has its `tenantId` **rewritten to the caller's tenant**.
- `:562` cross-tenant guard compares `inviter.tenantId !== input.tenantId` — the attacker targets their *own* tenant, so it passes.
- `acceptInvite` (read at `:660-685`) does `tx.user.update({ where: { id: invite.userId! }, ... })` then `authService.login(user)` with **no assertion that `invite.tenantId === user.tenantId`**.

Confirmed open. Flagged in the 2026-08-01 security audit; the recommended fix was never applied.

## 5. CI is RED on master — the "12/12 green" claim did not hold

The 2026-08-03 launch-readiness evening addendum states "All 12 CI workflows green on `a74c7894` (18:55Z sweep)." That sweep ran before the longest job finished.

`CI & Security` on `a74c7894` = **failure**. Job breakdown:

| Job | Result |
|---|---|
| E2E Tests (Playwright / Chromium) | **failure** — 19:25Z → 20:14Z (**49 min**) |
| Secret Leak Scan (gitleaks) | success |
| Accessibility Lint (jsx-a11y) | success |
| Production Dependency Audit | success |
| Build, Lint & Test | success |
| Container Security Scanning | success |

Every other workflow (Deploy Reliability, Taurus Safety, Tenant Isolation, Cross-Browser, Emergency Path, Prod Smoke, a11y, OTA Wiring, Capability Registry, Poster Freshness, Mobile Perf, Signing Secrets, Android APK) was green.

**Lesson for the standing rule:** a green sweep taken before the slowest job completes is not a green CI. The CLAUDE.md post-push rule (`gh run watch --exit-status`) exists precisely to prevent this and was not followed for that claim.

## 5b. CI forensics — what is ACTUALLY red on master, and why

Run `30851631766` on `ffddbdc4` (the current tip). Two jobs red:

### (a) Production Dependency Audit — 3 NEW HIGH advisories, zero dependency changes

`git diff a74c7894..ffddbdc4 -- pnpm-lock.yaml '**/package.json'` is **empty**, yet the gate flipped green→red in 110 minutes. Cause: `scripts/npm-advisory-audit.cjs` queries npm's **live** bulk advisory endpoint, so newly-published advisories red master with no code change. The three that landed:

| Severity | Package | Advisory |
|---|---|---|
| HIGH | `undici` >=7.0.0 <7.29.0 | GHSA-4cwx-7wf7-3272 — cross-user info disclosure + parse-time crash via degenerate private cache directives |
| HIGH | `ip-address` <=10.3.0 | GHSA-mwp4-54f8-5fhr — leading-zero octets decoded as decimal vs octal → **SSRF / trust-boundary bypass** |
| HIGH | `fast-uri` >=3.0.0 <3.1.5 | GHSA-7p8r-x3mc-p8w7 — host confusion via backslash authority introducer |

Two of these are directly load-bearing here, which raises them above routine dependency noise:
- **`undici`** is the storage transport's primary fetch (`storage-transport.ts`) — and a second MODERATE on the same package (GHSA-8xcm-r25x-g524) is *downstream response desynchronization via retry interceptor*, on a path that does retries.
- **`ip-address`** is an SSRF/trust-boundary bypass in a product whose outbound-webhook SSRF defense (`safe-fetch.ts`) depends on correct IP parsing. Worth checking whether `ssrfSafeLookup` sits downstream of it.

Also present below the fail threshold, both relevant to this product: MODERATE `sanitize-html` ≤2.17.4 (GHSA-vccv-cmxp-4j9h — `javascript:` URIs survive via `action`/`formaction`/`data`/`poster`/`background`) and LOW `dompurify` ≤3.4.11 (`CUSTOM_ELEMENT_HANDLING` bypasses `afterSanitizeElements`). Both sit on the operator-authored-HTML path.

Fix is what the script itself prints: pin fix floors in root `package.json` `pnpm.overrides`.

### (b) E2E — the emergency-path gate is red from a REVERTED test fix, not a product regression

The dedicated **Emergency Path** workflow also went red on `ffddbdc4` (green on `a74c7894`). Per-browser breakdown of run `30851631759` is decisive:

| Browser | Test #1 "baseline — no emergency, no overlay, empty cache" | Job |
|---|---|---|
| chromium | ✘ 25.1s · ✘ retry#1 25.2s · **✓ retry#2 in 4.7s** | success |
| webkit | ✘ 20.1s · ✘ retry#1 20.6s · ✘ retry#2 21.5s | **failure** |

Chromium passing in **4.7 s** once the route is warm — against ~25 s for the attempts that fail — is the signature of a cold-compile race, not a broken assertion. The first request logs `[REQUEST FAILED] http://localhost:3000/player?fp=… net::ERR_ABORTED`: the dev server has not finished compiling `/player` when test #1 fires. WebKit is slower to warm and never recovers inside its 3 retries.

This is exactly the flake commit `25717588` diagnosed ("emergency-path had no route warm-up, so test #1 raced the cold compile") and commit `5844466a` **reverted** ("revert the emergency-path warm-up, keep the budget fix"). The warm-up was removed; the race came back; it now lands on WebKit.

**Do not read this as the emergency system being broken.** Prod `/health/emergency-path` returns 200 with `ws_signer:ok`, and the chromium run passes the same assertion once warm. What is broken is the *gate* — and a life-safety gate that is red for harness reasons is worse than useless, because it trains everyone to ignore it.

The other two E2E failures in `ci.yml` are real test failures worth triage, and both are editability invariants CLAUDE.md names explicitly:
- `external-html-clickedit.spec.ts:87` — click-to-edit fails on `/templates/signage/hospitality/01-lobby-welcome-flagship.html`, 3 attempts (note: hospitality is also the pack §14 found half-quarantined)
- `holiday-hotzone.spec.ts:214` — the live-fields hot-zone jump, 1.3 min

Ambient noise in both jobs: repeated `Hydration failed because the server rendered text didn't match the client`, and a React key warning from `LunchOpsInventoryWidget`.

## 6. Concurrent session activity — master moved mid-audit

The audit baseline was `a74c7894`. Master is now **`ffddbdc4`**. Landed during this pass:

| Commit | What |
|---|---|
| `cec023ec` | (mine) persist launch-readiness + bar-template research |
| `91702ef7` | serviceWorker safe accessor **+ the ci.yml E2E timeout and `--project=chromium` pin** |
| `ffddbdc4` | RS-01 security fix — proxy response same-origin + CSP sandbox |

This matters for §15 finding F-2: the chromium pin that drops WebKit coverage for the EXTERNAL_HTML / holiday-hotzone / multiscreen-sync specs is **live on master now**, not pending. It also means the E2E failure in §5 has a plausible fix in flight (30-min cap + single-project run), though the WebKit loss is a real side effect that needs its own follow-up.

## 7. Independent re-verification of agent P1s

### Confirmed (I checked these myself)

**Editability F-2 — 40 v2 variants have no typography/color/background control.** Triple-confirmed:
1. `variants-register.ts:849-892` maps `Clocks→CLOCK`, `Announcements→ANNOUNCEMENT`, `Calendars→CALENDAR`, `Staff→STAFF_SPOTLIGHT`, `Countdowns→COUNTDOWN`, `Logos→LOGO`, `Weather→WEATHER`, `Bell Schedules→BELL_SCHEDULE` — all types with hand-built `case`s that `break` before the v2 style branch.
2. `PropertiesPanel.tsx:6576-6578` — the universal "Text style" block is guarded by `!isV2Widget`, so it is skipped for exactly these widgets.
3. `grep -c data-field` = **0** in all eight v2 widget files, so the canvas-click per-field bar cannot arm either.

All three escape hatches are closed simultaneously. Real, and a launch blocker by CLAUDE.md's own "below B" rule.

**Taurus polyfill gap on sports routes.** `grep --include='*.ts' --include='*.tsx'` (quoted globs) across `apps/web/src`: `applyFlexGapPolyfill` / `applyCqUnitPolyfill` are invoked **only** at `player/page.tsx:2288-2289`. Zero references under `app/board`, `app/ribbon`, `app/scorebug` (excluding one test comment). Meanwhile `check-taurus-safety.cjs:30-36` explicitly scans those three routes with the comment *"Lane-6 P0: sports surfaces also render on Taurus."* The repo contradicts itself: the gate says those routes ship to Chromium-83 hardware; the runtime says only the player gets the Chromium-83 polyfills.

*(Note: my first attempt at this sweep used unquoted `--include=*.ts` and zsh ate it with `no matches found` — the exact "grep errors ≠ no-match" trap in the standing rules. Re-run with quoted globs before trusting any absence claim.)*

**Manifest cache-bust gaps.** `SCREEN_TELEMETRY_ONLY_FIELDS` (`manifest-hot-cache.ts`) contains `lastPingAt, status, lastCacheReport*, lastOta*, lastRendered*, lastSyncReport*, credentialEpoch*, playerVersion*, managerVersion*` — and **not** the five `lastCrash*` columns written by `POST /screens/status/:fp/crash-report`, nor the identity fields (`resolution, osInfo, browserInfo, userAgent, ipAddress, hardwareModel`) written by `POST /screens/register` (`screens.controller.ts:505-520`). Both therefore bump the global manifest content rev and clear the whole fleet's cache. Confirmed.

**Stripe test-vs-live blindness.** `enabled()` is `return !!process.env.STRIPE_SECRET_KEY` (`stripe.service.ts:112-114`). Grep for `sk_test|sk_live|livemode|testMode` across `apps/api/src/billing/` and the billing page: only a docstring and a unit-test fixture. No mode detection exists anywhere. Confirmed — the UI tells operators checkout is "live" while prod runs test keys.

### Corrected (agent finding revised after my check)

**"14-day trial not enforced" is KNOWN and deliberate, not a new discovery.** The §8/§11 agent labelled it NEW. In fact `license.service.ts:5-15,34-41` carries an extensive comment block stating the pilot ceiling is an *internal testing accommodation*, that it is "NOT the plan we advertise", that the advertised trial is 14 days / 3 screens, that the real cap awaits the PLAN-001A entitlement backfill, and that `PILOT_SEAT_LIMIT=3` enforces it early. A boot-time warning makes it loud. This was consciously deferred by the 2026-07-13 W0-07 audit. The customer-facing copy still overstates the product, which is worth fixing — but nobody was self-deceived, and it should not be reported as a fresh discovery.

**"PDF import may be a silent costume on Node 20" — DISPROVEN on the load axis.** The §12 agent flagged that `pdfjs-dist@6` declares `engines: node >=22.13.0 || >=24` while both Dockerfile stages are `node:20-alpine`, and that `pdf-parser.ts:33-46` swallows every import error — so structured PDF import might never have worked in prod. I ran the exact dynamic import on Node **v20.20.2** (same major as the Docker base) from the `apps/api` workspace:

```
import('pdfjs-dist/legacy/build/pdf.mjs')  →  IMPORT OK — getDocument is function
resolved: node_modules/.pnpm/pdfjs-dist@6.0.227/…/legacy/build/pdf.mjs
```

The `engines` field is advisory; the package is pure JS with no native bindings, so the musl/glibc difference does not apply. **The load-failure hypothesis is dead.** What survives is the agent's real point: the failure mode is silent — if the parse *did* fail for any reason, the operator gets a cheerful "A new template is in your Templates gallery" for a non-editable iframe, with `importSource:'flat-fallback'` buried in an audit-log JSON blob. That silence is worth fixing on its own merits.

**Blast radius of the import findings today: zero.** `SELECT ... FROM audit_logs WHERE action ILIKE '%IMPORT%'` returns **no rows**. The design-import feature has never been used in production. Every §12 import finding is latent, not actively harming anyone.

## 8. Workspace hygiene (done, not just reported)

- 3 leftover agent worktrees (clean, 0 unmerged commits each) removed via `pnpm worktrees:clean`; backup at `~/Desktop/venueos-worktree-backup-20260803-132107`. `git worktree list` now shows only the main tree.
- `pnpm hygiene`: `.git` healthy (176 MB, 0 garbage). Outstanding: 18 local branches, 1 stale merged remote branch. Not blocking.
- Walnut Creek demo folder + seed script deliberately left untracked (live demo credentials — launch-readiness §4 decision 9). Scanned both for secret-shaped strings before committing the *other* research folders: clean.
