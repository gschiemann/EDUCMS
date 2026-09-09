<div align="center">

# VenueOS

### One platform for every screen a school or venue runs.

**Everyday signage · native life-safety alerts · live sports presentation — on the same displays.**

[Quickstart](#quickstart) · [Architecture](#architecture) · [Documentation map](#documentation-map) · [Deploy &amp; health](#deploy--health) · [Contributing](./CONTRIBUTING.md)

</div>

---

## What this is

VenueOS is a secure, real-time signage **and emergency-alert** CMS. It started in K-12 — interactive displays, digital signage, and life-safety lockdown / weather / evacuation alerts across thousands of screens — and is now **multi-vertical**: school districts, live **sports venues** (scoreboards, ribbon boards, full game presentation), and QSR / restaurant / retail / worship / corporate.

The wedge is simple: **one platform that runs everyday signage *and* native life-safety *and* (in sports) full game presentation on the same screens** — so the board earns its keep five days a week, not just on Friday night.

Three things make it more than a slideshow player:

- **Life-safety is load-bearing, not a feature.** A single trigger fans a signed, audited lockdown / weather / evacuate alert to every screen in scope over WebSockets, with an HTTP-polling fallback when Redis is down. Every trigger and all-clear is immutably logged. See [`docs/spec/THREAT_MODEL.md`](./docs/spec/THREAT_MODEL.md) and the emergency-system section of [`CLAUDE.md`](./CLAUDE.md).
- **Real-time at fleet scale.** Signed pub/sub over Redis, per-event dedup, canary rollouts, offline-tolerant kiosk players (down to Chromium 83 on NovaStar Taurus LED controllers).
- **The operator does the work in seconds, not with a consultant.** Auto-detecting integration concierge, brandable templates, one-click game presentation.

> **New here?** Read [`CONTRIBUTING.md`](./CONTRIBUTING.md) first — it lists the five docs to read in order. The code-verified status of what is *actually shipped* lives in [`docs/CURRENT_STATE.md`](./docs/CURRENT_STATE.md).

---

## Tech stack

| Layer | Choice |
|---|---|
| **Backend** | NestJS 11 + Express · Prisma ORM · PostgreSQL (Supabase hosted; `postgres:15-alpine` locally) · Redis |
| **Frontend** | Next.js 16 (App Router) · React 19 · Zustand · Tailwind CSS 4 · shadcn/Base UI · React Query |
| **Player** | Android kiosk (offline-first, USB sneakernet ingest) |
| **Monorepo** | Turborepo + pnpm |
| **Auth** | Argon2id · JWT + HttpOnly cookies · express-session |
| **Realtime** | Signed WebSocket messages over Redis pub/sub, HTTP-polling fallback |
| **Storage** | Supabase (Postgres + object storage) |
| **Testing** | Jest (API) · Playwright (E2E + cross-browser) |
| **Deploy** | Railway (API) · Vercel (web) — push to `master` ships to production |

---

## Quickstart

**Prerequisites:** Node.js 20+, [pnpm](https://pnpm.io) (`pnpm@9`), and a Postgres + Redis you can reach. The fastest local path uses the bundled `docker-compose.yml`.

```bash
# 1. Install dependencies
pnpm install

# 2. Configure env (copy the template, fill in DATABASE_URL etc.)
cp .env.example .env

# 3a. Local DB via Docker (optional — skip if you point .env at Supabase)
docker compose up db redis -d

# 4. Push the Prisma schema and seed test data
pnpm db:setup            # = db:push && db:seed

# 5. Run the API + web dashboard together (watch mode)
pnpm dev                 # API on :8080, web on :3000
```

Then open **http://localhost:3000/login**. The seed creates `admin@springfield.edu` (SUPER_ADMIN outside production) and `teacher@springfield.edu` (CONTRIBUTOR) on the demo school Springfield Elementary (`00000000-0000-0000-0000-000000000002`). `pnpm db:seed` prints the two addresses but **never the password** — set `SEED_PASSWORD` before seeding, or read the public dev default in `packages/database/prisma/seed.ts`.

Run one side alone with `pnpm dev:api` / `pnpm dev:web`. See [`CLAUDE.md` → How to Run](./CLAUDE.md) for the full command set (build, migrate, test, lint).

> ⚠️ **`DATABASE_URL` gotcha:** when using the Supabase pooler you **must** append `&connection_limit=10&pool_timeout=20`. Prisma's default under pgBouncer is **1 connection**, which makes every concurrent request time out. This has bitten us repeatedly — the full env-var reference is in [`CLAUDE.md`](./CLAUDE.md).

---

## Architecture

```
EDU CMS/
├── apps/
│   ├── api/          NestJS 11 API server         (port 8080)
│   ├── web/          Next.js 16 dashboard + player routes (port 3000)
│   ├── player/       Android kiosk player
│   └── edge/         Cloudflare Worker in front of the API
├── packages/
│   ├── database/     Prisma schema + @prisma/client + seed
│   ├── api-types/    Shared TypeScript API contracts
│   ├── scoreboard-cts/  CTS + Daktronics scoreboard-console serial decoders
│   └── signage-design/  AI signage design engine (archetypes, type scale, contrast)
└── docs/             spec, design, roadmap, archive, template-finalization
```

The domain model (Tenant → Screen / ScreenGroup / Playlist / Schedule / Asset / Template / AuditLog), the 5-role RBAC matrix, the emergency endpoints, and the template/widget system are all documented in [`CLAUDE.md`](./CLAUDE.md) and [`docs/spec/DOMAIN_MODEL.md`](./docs/spec/DOMAIN_MODEL.md).

---

## Documentation map

The repo root is intentionally small — four markdown files. Everything else lives under `docs/`.

| Where | What | Read it when |
|---|---|---|
| **[`CLAUDE.md`](./CLAUDE.md)** | **The source of truth.** Architecture, env vars, conventions, emergency safeguards, hard-won rules (render-tree #9, Chromium-83/Taurus CSS #10), the 21-section Standard Audit Surface, agent-dispatch protocol. | Before touching anything. |
| [`CONTRIBUTING.md`](./CONTRIBUTING.md) | The 5-doc reading list, preflight, verify-before-claim, parallel-agent worktree discipline, conventions. | First contribution. |
| [`SECURITY.md`](./SECURITY.md) | How to report a vulnerability (security@venue-os.app), response targets, safe harbor. | You found a vulnerability. |
| [`docs/CURRENT_STATE.md`](./docs/CURRENT_STATE.md) | The **canonical app status** — code-verified account of what is actually shipped. | You need ground truth on what's actually shipped. |
| [`docs/spec/`](./docs/spec/) | The engineering specs — RBAC, realtime, sync protocol, threat model, device provisioning, failure modes, test strategy, and more. | Implementing or changing a subsystem. |
| [`docs/roadmap/ROADMAP.md`](./docs/roadmap/ROADMAP.md) | Forward-looking sprint plan and the multi-vertical / safety-platform vision. | Planning new work. |
| [`docs/OBSERVABILITY.md`](./docs/OBSERVABILITY.md) · [`docs/FEATURE_FLAGS.md`](./docs/FEATURE_FLAGS.md) · [`docs/BACKUP_AND_ROLLBACK.md`](./docs/BACKUP_AND_ROLLBACK.md) | How we watch, gate, and roll back. | Shipping anything risky. |
| [`docs/design/`](./docs/design/) · [`docs/template-finalization/`](./docs/template-finalization/) | Template standards and the design pipeline. | Building or redoing a template. |
| [`docs/archive/`](./docs/archive/) | Pre-launch April-2026 design docs + beta-testing logs. **Historical only — they describe a system that diverged from what shipped.** | Provenance only. Do not treat as current. |

---

## Deploy &amp; health

Push to `master` deploys the API to **Railway** and the web app to **Vercel**. Always wait for green CI (`Deploy Reliability`) before considering anything shipped — `pnpm preflight` runs the same non-Docker checks locally in ~90 seconds.

Health endpoints (all under `/api/v1`):

| Endpoint | Purpose |
|---|---|
| `GET /health` | Liveness — always 200, even when DB/Redis degraded. Railway healthcheck uses this. |
| `GET /health/ready` | Readiness — 503 when DB unreachable. For monitoring, not Railway. |
| `GET /health/emergency-path` | Verifies DB + WS signer chain before a life-safety drill. |

Recovery runbooks (Railway redeploys, Vercel env, Supabase pooler, Redis fallback) are in [`CLAUDE.md` → Deploy reliability](./CLAUDE.md).

---

## A few non-negotiables

- **Never commit `.env*`, API keys, or PII** — secrets live in env vars only. `gschiemann/EDUCMS` is **private** today (`gh repo view gschiemann/EDUCMS --json visibility`), but git history is permanent and outlives any visibility flip, so treat every commit as if it will be published.
- **Never weaken emergency safeguards** (the `@AllowPanicBypass` decorator, the immutable audit log, signed WS messages) without explicit review.
- **Cross-browser is mandatory.** Every customer-facing surface must work in Safari/WebKit; player surfaces must also survive Chromium 83–87 (Taurus LED). Never use the CSS `inset` shorthand or Tailwind `inset-*` in widget/player styles.
- **Migrations are additive-only** while a live pilot tenant is in production.

Full rationale for each — and the scars that earned them — is in [`CLAUDE.md`](./CLAUDE.md).
