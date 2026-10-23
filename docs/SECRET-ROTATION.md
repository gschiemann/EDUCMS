# Secret rotation — every place each secret lives

A rotation is a list to tick, not a memory. On 2026-09-04 the production DB password was rotated
(it had been live in public git history) and the `SUPABASE_DB_URL` **GitHub secret was missed** —
the nightly encrypted backup then failed for nine nights before anyone noticed
(`docs/research/ops/2026-09-13-backup-postmortem.md`). Rule from that rotation, now binding:
**enumerate every consumer BEFORE rotating, update all of them the same day, then run
`node scripts/ops-sweep.mjs` and dispatch each consumer workflow (`gh workflow run <file>`).**

Where secrets live (never print a value — `gh secret list` prints names only):

| store | how to see the NAMES | who reads it |
|---|---|---|
| GitHub repository secrets | `gh secret list` | the workflows below |
| Railway (API service) env | Railway dashboard → service → Variables | `apps/api` at runtime |
| Vercel (web) env | Vercel dashboard → project → Environment Variables | `apps/web` at build + runtime |
| local `.env` (gitignored; `DATABASE_URL` points at PRODUCTION) | `grep -oE '^[A-Z0-9_]+=' .env` | local dev + `pnpm db:*` |
| `.mcp.json` (gitignored) | — | the postgres MCP connection string (`reference_postgres_mcp_tls_repair` memory) |
| `~/rotate/` (outside the repo) | — | the operator's credential store; never enters git |
| `.claude/launch.json` `api-sandbox` | — | LOCAL sandbox DB only, no production secret |

## Per-secret consumer map

| secret | GitHub secret | Railway (API) | Vercel (web) | local `.env` | notes |
|---|---|---|---|---|---|
| Postgres password (`DATABASE_URL`, `DIRECT_URL`) | `SUPABASE_DB_URL` → **DB Backup** (`db-backup.yml`) | ✅ `DATABASE_URL`, `DIRECT_URL` | — | ✅ | also `.mcp.json`; pooler session mode, port 5432 (CLAUDE.md) |
| `SUPABASE_SERVICE_ROLE_KEY` | `SUPABASE_SERVICE_ROLE_KEY` + `SUPABASE_URL` → **Android Player APK** release publish (non-blocking step) | ✅ | — | ✅ | storage uploads + APK bucket signed URLs |
| `BACKUP_ENC_KEY` | `BACKUP_ENC_KEY` → **DB Backup** | — | — | — | rotating it makes OLDER artifacts undecryptable — keep the previous key until they expire (30 days) |
| `JWT_SECRET`, `SESSION_SECRET` | — | ✅ | — | ✅ | a straight swap signs every operator out (sessions + user JWTs); no window exists for these two |
| `DEVICE_SECRET_KEY`, `DEVICE_JWT_SECRET` (+ optional `_PREVIOUS` companions) | — | ✅ | — | ✅ | **rotate ONLY through the `_PREVIOUS` window below** — a straight swap of `DEVICE_JWT_SECRET` 401s the WHOLE fleet until re-pair, and a straight swap of `DEVICE_SECRET_KEY` makes every stored credential (POS / streaming / ads / social tokens, BYOK AI keys, MFA secrets, kiosk Wi-Fi) unreadable at once |
| `GATEWAY_SHARED_SECRET`, `SESSION_BFF_SECRET` | — | ✅ | ✅ (same value on both) | optional | unset = subtractive on both sides |
| `SPORTS_BEACON_SECRET`, `PROXY_RENDER_SECRET` | — | ✅ | — | optional | `PROXY_RENDER_SECRET` unset ⇒ derives from `DEVICE_SECRET_KEY` |
| Prod smoke login | `PROD_SMOKE_EMAIL`, `PROD_SMOKE_PASSWORD` → **Prod Smoke** (`prod-smoke.yml`, incl. `webkit-nav`) | — | — | — | a dedicated smoke user; rotate its password in the app, then the two secrets |
| Android signing | `RELEASE_KEYSTORE_BASE64`, `RELEASE_STORE_PASSWORD`, `RELEASE_KEY_ALIAS`, `RELEASE_KEY_PASSWORD` → **Android Player APK** | — | — | — | keystore also in iCloud + password manager; a lost keystore = a new app identity |
| On-call routine | `ROUTINE_FIRE_URL`, `ROUTINE_FIRE_TOKEN` → **Workflow failure → issue + on-call routine** | — | — | — | token minted once in the routine's UI; re-mint = re-set the secret |
| Lighthouse | `LHCI_GITHUB_APP_TOKEN` → **Lighthouse CI** | — | — | — | |
| Playwright CI tenant | `PLAYWRIGHT_ADMIN_TOKEN`, `PLAYWRIGHT_TENANT_ID` → **CI & Security** | — | — | — | not present in `gh secret list` today — the jobs that use them skip when unset |
| Provider keys (`RESEND_API_KEY`, `ANTHROPIC_API_KEY`, `PEXELS_API_KEY`, `GOOGLE_MAPS_API_KEY`, POS `*_CLIENT_SECRET`, `CLEVER_*`, `CANVA_*`, `INSTAGRAM_*`, `META_*`, `STRIPE_*`) | — | ✅ | `NEXT_PUBLIC_*` only | ✅ | each provider's dashboard is the source; unset = the feature degrades, never crashes (CLAUDE.md env table) |
| Redis (`REDIS_URL`) | — | ✅ | — | ✅ | |

## The rotation procedure

1. Prove the leak / decide the scope (`feedback_prove_leak_before_rotating`): which secret, which consumers.
2. Mint the new value at the source (Supabase / provider dashboard / `openssl rand -hex 32`).
3. Update **every** row in the map above for that secret — Railway and Vercel first (live traffic), then
   `gh secret set NAME` (value from the local env or the source, never typed into a chat), then `.env`, `.mcp.json`.
4. Same day: `node scripts/ops-sweep.mjs`; `gh workflow run db-backup.yml` (and any other consumer workflow);
   `curl https://<api>/api/v1/health` must report `db: ok`.
5. Write the rotation down in `docs/research/ops/<date>-rotation.md`: what, why, every consumer touched.

## Rotating `DEVICE_JWT_SECRET` / `DEVICE_SECRET_KEY` without taking the fleet offline (2026-10-22)

Both device-side secrets support a **rotation window** (`apps/api/src/security/key-ring.ts`): an
optional `<NAME>_PREVIOUS` companion. While it is set, everything NEW is minted / signed /
encrypted with `<NAME>` (the primary) and every verifier / decryptor accepts `<NAME>` **then**
`<NAME>_PREVIOUS`. With `_PREVIOUS` unset the API behaves byte for byte as a single-key install.
Boot refuses a `_PREVIOUS` that is shorter than 16 chars or identical to the primary (identical
means the secret was never actually rotated).

What each key covers:

| secret | mint / sign / encrypt (primary only) | verify / decrypt (primary, then previous) |
|---|---|---|
| `DEVICE_JWT_SECRET` | `POST /screens/register`, `POST /devices/pair` | `JwtAuthGuard` device leg, `decodeDeviceBearer`, `admitDeviceCredential` (HTTP + WS + SSE), `verifyPriorToken` on register, the per-device throttle key |
| `DEVICE_SECRET_KEY` | `WebsocketSignerService` (every emergency envelope), stream tickets, render / beacon capabilities\*, sports feed / console tokens\*, Clever OAuth state, OTA download tags, field-candidate tickets, the legacy `X-Device-Auth` header; **master key** for `creds-cipher` (streaming / POS / ads / social connections, kiosk Wi-Fi), `ai-key-cipher` (BYOK keys), `mfa-secret-cipher` (TOTP) | the Redis fan-out gate on every replica (`verifyWsHmac` with the ring), and every verifier / `open*` of the same modules |

\* only when no dedicated `PROXY_RENDER_SECRET` / `SPORTS_BEACON_SECRET` / `SPORTS_FEED_SECRET` /
`SPORTS_CONSOLE_SECRET` is set — a dedicated secret is never widened by the device window.

Deploys are rolling, so the previous value must be in place on the SAME deploy that introduces the
new primary: a replica on the old key may sign a lockdown that a replica on the new key must still
fan out. Never type a secret value into a chat, a ticket or a shell history — paste it from
`~/rotate/` into the Railway variable editor.

### A. `DEVICE_JWT_SECRET`

> ⚠️ **Paired screens do NOT renew on a timer (corrected 2026-10-23).** This step used to say
> "screens hold 1-hour device tokens and proactively renew every ~10 minutes — wait 2 hours". A
> PAIRED screen holds a **180-day** token (`DEVICE_TOKEN_TTL_PAIRED`) and re-registers only when its
> page loads, or when fewer than 14 days remain (`renewalDecision` in
> `apps/web/src/app/player/deviceCredential.ts`; the 10-minute timer only *checks*). Only 1-hour
> tokens — a screen already on "re-pair required" — renew by the clock. On 2026-10-23 the window was
> closed after ~4.7 h on that assumption, and every screen that had not reloaded inside it lost its
> sign-in at once. A screen moves to the new key only when it next re-registers, so **make the fleet
> re-register** (step 4), and let `finish` prove it (step 5).

1. Mint the new value: `openssl rand -hex 32`. (`node scripts/railway-rotation.mjs start` does
   steps 1–3 for both device secrets and prints the new key's non-secret **key id**.)
2. Railway → API service → Variables: set `DEVICE_JWT_SECRET_PREVIOUS` = the **current** value,
   then `DEVICE_JWT_SECRET` = the **new** value. Save both in one change so one deploy carries both.
3. Deploy. Boot log shows `[security] DEVICE_JWT_SECRET_PREVIOUS is set — a rotation window is OPEN`.
   `GET /api/v1/super/key-rotation` (SUPER_ADMIN) answers `open: true` for `DEVICE_JWT_SECRET`.
   **Wait until this deploy is live** before step 4: until then the OLD container is still minting
   on the old key.
4. **Make every screen re-register while the window is open.** A re-register presents the old-key
   token as `priorDeviceToken`, the ring accepts it as proof, and the screen is issued a 180-day token
   on the new key. Use **Resync content** on each screen (Screens → open the screen) — it reloads the
   player at once, even over playing content. Screens that are switched off must be powered on and
   re-registered too; extend the window over any planned outage.
5. **`node scripts/railway-rotation.mjs finish`** — the guard (2026-10-23,
   `scripts/rotation-renewal-guard.cjs`). Before it removes anything it reads the production
   database (with the Railway `DATABASE_URL`, TLS verified against the pinned CA, read-only) and
   **refuses** while any paired, non-revoked screen that was alive in the last 24 hours — newest of
   `last_ping_at`, `player_version_at`, `manager_version_at`, so a screen whose player is dark but
   whose Manager still checks in counts — has **no token issued on the new key**. "Issued on the new
   key" is a fact, not a guess from timestamps: every token issue's audit row
   (`SCREEN_TOKEN_RENEWED` / `SCREEN_TOKEN_DOWNGRADED` from `/screens/register`, `DEVICE_PAIRED` from
   `/devices/pair`) carries `mintKeyId`, a non-secret 16-hex id of the signing key (`keyIdOf` in
   `apps/api/src/security/key-ring.ts`), and the script computes the same id from the variable. It
   lists each screen (id, name, last seen, player version): Resync it, then run `finish` again. Exit
   code 2 = refused, nothing removed.
   - **Override (explicit, logged):** `finish --override-unrenewed "<why>"` closes the window anyway.
     It FIRST writes an immutable `KEY_ROTATION_FINISH_OVERRIDE` row to `audit_logs` (system tenant
     `00000000-0000-0000-0000-000000000000`: reason, new key id, the screens still on the old key,
     operator); if that row cannot be written nothing is removed. Every listed screen then follows
     the recovery below. If the database cannot be reached at all the script refuses too — removing
     the variable by hand in the Railway dashboard is then a deliberate act; write it down (step 7).
6. On a pass (or a recorded override) `finish` deletes `DEVICE_JWT_SECRET_PREVIOUS` (and
   `DEVICE_SECRET_KEY_PREVIOUS`) and deploys. The boot log no longer mentions a window.
7. Update local `.env` (if it carries the value) and write the rotation down in
   `docs/research/ops/<date>-rotation.md`.

#### A screen that still had an old-key token when the window closed

What it does by itself (fixed 2026-10-23): its manifest 401s and the gateway answers `AUTH_FAIL`, so
the player runs its one controlled re-register a minute (`attemptCredentialRecovery`), presenting the
old-key token. The API cannot verify that token any more, grades it `unverifiable`, and answers
exactly as for a screen that sent no token: a **1-hour bootstrap credential + `requiresRePair`**,
signed by the new key, no epoch rotation, a `SCREEN_TOKEN_DOWNGRADED` audit row with
`priorTokenStatus: "unverifiable"`, `Screen.authState = REPAIR_REQUIRED`, and one
`[register] … no current key verifies …` line in the API log. Content and alerts keep flowing over
the manifest poll (the emergency backstop); the realtime socket stays refused for a bootstrap
credential by design (SEC-001). **Until 2026-10-23 that register was a hard
`401 SCREEN_TOKEN_MISMATCH`** — retried once a minute forever, invisible in the API logs (a 401 writes
no audit row, `RequestLogInterceptor` logs only successful mutations, `AllExceptionsFilter` only 5xx)
— and the screen stayed dark.

What the operator does: the dashboard shows the screen as **re-pair required**. Open it and press
**Restore trust**; its next re-register (within about a minute — every refused socket triggers one)
is issued a proven 180-day token on the new key (`unproven-restorable`). No pairing code, no visit
to the screen. Find them all with:

```sql
SELECT s.id, s.name, s.auth_state, s.last_ping_at
  FROM screens s
 WHERE s.auth_state = 'REPAIR_REQUIRED' AND s.tenant_id IS NOT NULL AND s.status <> 'REVOKED'
 ORDER BY s.last_ping_at DESC NULLS LAST;
```

### B. `DEVICE_SECRET_KEY`

1. Mint the new value: `openssl rand -hex 32` (64 hex chars — the envelope ciphers require it).
2. Railway → API service → Variables: set `DEVICE_SECRET_KEY_PREVIOUS` = the **current** value,
   then `DEVICE_SECRET_KEY` = the **new** value. One change, one deploy.
3. Deploy. Boot log shows the window warning AND
   `DEVICE_SECRET_KEY_PREVIOUS is set — … Stored credential envelopes will be re-wrapped … (leader only)`.
   About 45 s after boot the leader replica runs the re-wrap (`KeyRotationRewrapService`,
   lease `security:key-rotation-rewrap`): every sealed row's **data-key envelope** is re-wrapped
   onto the new key — plaintext is never decrypted, writes are tenant-scoped and guarded on the
   exact old ciphertext, counts only are logged. Log line:
   `[key-rotation] re-wrap (boot) scanned=… rewrapped=… current=… unreadable=… skipped=…`.
   One `KEY_ROTATION_REWRAP` AuditLog row (system tenant) carries the same counts.
4. **Prove it is done** — `POST /api/v1/super/key-rotation/rewrap` (SUPER_ADMIN, idempotent). The
   answer must show `rewrapped: 0` and `unreadable: 0` in every table. `unreadable > 0` means rows
   wrapped under a key in NEITHER slot (a previous rotation that skipped this runbook): those were
   already unreadable before, and the operator re-enters that credential / re-enrols MFA.
   `skipped > 0` is harmless (an operator re-saved that row during the run; it is already on the
   new key) — run the POST again to see it drop to 0.
5. Also wait ≥ 6 hours after step 3 before closing the window if screens are showing web-proxy
   boards: render capabilities live 6 h in iframe `src`s and are verified against the ring (only
   when `PROXY_RENDER_SECRET` is unset; with it set, this step does not apply). Stream tickets
   (60 s), beacon capabilities (30 min) and sports tokens (24 h unless versioned) follow the same
   rule — wait out the longest TTL you rely on, or accept one re-mint.
6. Delete `DEVICE_SECRET_KEY_PREVIOUS`. Deploy. From now on a row that was somehow missed fails
   to open exactly as a corrupted row always did — which is why step 4 is not optional.
7. Update local `.env`; write the rotation down in `docs/research/ops/<date>-rotation.md`.

### Both at once (the 2026-10-21 Railway leak)

Do A and B in the SAME variable change and deploy once: four variables set, one deploy, one
boot (`node scripts/railway-rotation.mjs start`). Then run B-4, do A-4 (Resync the fleet) and wait
out B-5, and close both windows with `node scripts/railway-rotation.mjs finish` — it removes both
`_PREVIOUS` values in one change and deploys once more, but only after the A-5 guard passes (or an
override is recorded). The guard covers `DEVICE_JWT_SECRET` only; `DEVICE_SECRET_KEY`'s proof is
B-4's `rewrapped: 0, unreadable: 0`, which you still check yourself before `finish`. Tests pinning
every consumer: `apps/api/src/security/key-ring*.spec.ts`,
`realtime/redis.service.key-ring.spec.ts`, `auth/jwt-auth.guard.key-ring.spec.ts`, the three
`*-cipher.key-ring.spec.ts`, `security/key-rotation-rewrap.service.spec.ts`; the window closing on
a screen that never renewed: `screens/screens.register-retired-key.spec.ts` and
`apps/web/tests/e2e/credential-lifecycle.spec.ts` test 5; the `finish` guard:
`scripts/__tests__/rotation-renewal-guard.test.cjs`.
