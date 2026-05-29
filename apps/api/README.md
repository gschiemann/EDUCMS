# VenueOS API (`apps/api`)

NestJS 11 + Express API server. The system-of-record for the whole
platform: tenancy, auth, content (assets / playlists / templates),
the emergency trigger pipeline, billing, and the signed realtime fan-out.

- **Runtime:** NestJS 11, Prisma ORM → PostgreSQL (Supabase), Redis pub/sub
- **Port:** `8080` (or `$PORT`)
- **Deployed on:** Railway (Docker, root `Dockerfile`)
- **API base path:** all routes under `/api/v1`

> This is one workspace in a pnpm + Turborepo monorepo. Run commands from
> the **repo root** unless noted. The source of truth for architecture,
> conventions, and the emergency-system safeguards is the root
> [`CLAUDE.md`](../../CLAUDE.md) — read it before changing anything here.

## Local dev

From the repo root (installs the whole workspace, generates the Prisma
client via `postinstall`):

```bash
pnpm install
pnpm db:push          # apply Prisma schema to your database
pnpm db:seed          # seed tenants, users, templates
pnpm dev:api          # NestJS in watch mode on :8080
```

Or from this directory:

```bash
pnpm dev              # nest start --watch
```

Sanity check it's up:

```bash
curl -s http://localhost:8080/api/v1/health    # → { status, db, redis, uptime, ... }
```

## Build & run (production)

```bash
pnpm --filter api run build         # nest build → dist/
pnpm --filter api run start:prod    # node dist/main
```

On Railway this happens inside the root `Dockerfile` (Alpine + the native
toolchain argon2 needs — see CLAUDE.md "Deploy Reliability" for the build
failure modes that CI catches before they reach Railway).

## Tests & lint

```bash
pnpm --filter api run test          # jest unit (*.spec.ts next to source)
pnpm --filter api run test:cov      # with coverage
pnpm --filter api run test:e2e      # jest e2e (test/jest-e2e.json)
pnpm --filter api run lint          # eslint --fix
```

Before pushing anything, run `pnpm preflight` from the repo root — it runs
the same non-Docker build/type checks CI does, in under 90s.

## Environment

The API reads its config from `.env` (gitignored — never commit it; the
repo is **public**). The full annotated table lives in
[`CLAUDE.md` → Environment Variables](../../CLAUDE.md#environment-variables).
The load-bearing ones:

| Variable | Why it matters |
|---|---|
| `DATABASE_URL` | Pooled Supabase URL. **Must include `connection_limit=10&pool_timeout=20`** — Prisma's pgbouncer default of 1 causes cascading 500s. |
| `DIRECT_URL` | Direct Postgres URL, migrations only. |
| `JWT_SECRET` / `SESSION_SECRET` / `DEVICE_SECRET_KEY` / `DEVICE_JWT_SECRET` | 64-char hex secrets. In production the API **refuses to boot** if any are missing (`src/security/required-secret.ts`). |
| `ALLOWED_ORIGINS` | CORS whitelist (comma-sep). **Required in production** — API refuses to boot if unset. |
| `REDIS_URL` | Realtime pub/sub. If absent the API still boots and falls back to HTTP-polling realtime. |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | Auth + object storage. |
| `RESEND_API_KEY` / `EMAIL_FROM` | Outbound email. Watch the `EMAIL_FROM` Resend gotcha documented in CLAUDE.md. |
| `STRIPE_*` | Billing. Dormant + degrades gracefully when unset. |
| `ANTHROPIC_API_KEY` | AI content generation. Degrades gracefully when unset. |

## Module map

```
src/
  auth/          JWT + Argon2 + express-session, RBAC guards
  emergency/     trigger / all-clear (LOAD-BEARING — review required)
  realtime/      signed WS gateway + Redis fan-out gate + SSE fallback
  screens/       pairing, manifest, heartbeat, device tokens
  templates/     17 system presets + custom templates
  billing/       Stripe checkout / portal / invoices / webhook
  security/      required-secret boot validation, CSRF
  health/        /health (liveness), /health/ready, /health/emergency-path
```

## Health endpoints (Railway + monitoring)

- `GET /api/v1/health` — liveness, always 200. Railway healthcheck.
- `GET /api/v1/health/ready` — readiness, 503 when DB unreachable. Monitoring.
- `GET /api/v1/health/emergency-path` — verifies DB + WS signer chain pre-drill.

## Changing the emergency system

Any change to emergency endpoints, payload validation, the
`@AllowPanicBypass` decorator, audit logging, or the signed Redis fan-out
gate requires explicit code review and end-to-end trigger/clear testing.
See CLAUDE.md → "Emergency System (Load-Bearing)".
