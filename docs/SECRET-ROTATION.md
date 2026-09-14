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
| `JWT_SECRET`, `SESSION_SECRET`, `DEVICE_SECRET_KEY`, `DEVICE_JWT_SECRET` | — | ✅ | — | ✅ | rotating `DEVICE_JWT_SECRET` 401s the WHOLE fleet until re-pair — see `feedback_prove_leak_before_rotating` |
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
