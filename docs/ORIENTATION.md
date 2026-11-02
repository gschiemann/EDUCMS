**Scope:** orientation — what VenueOS is, the stack, the monorepo layout, how to run it and the code conventions. Moved verbatim from the old single-file `CLAUDE.md` on 2026-11-01 (move map: `docs/governance/decisions/2026-11-01-rulebook-restructure-map.md`); `/CLAUDE.md` §1 is the always-loaded summary. New here? Start with `CONTRIBUTING.md`.

# VenueOS — orientation

## Project Mission

**VenueOS** — a secure, real-time signage + emergency-alert CMS. Born in K-12 (interactive displays, digital signage, and life-safety lockdown / weather / evacuation alerts across thousands of screens) and now **multi-vertical**: K-12 districts (the beachhead + the emergency moat), live **sports venues** (Sprint 13 — scoreboards, ribbon boards, game presentation), and QSR / restaurant / retail / worship / corporate. The wedge: ONE platform that runs everyday signage **and** native life-safety **and** (in sports) full game presentation on the same screens — so the board earns its keep 5 days a week, not just on Friday night.

> **READ FIRST:** `AGENTS.md` (imported at the top of `CLAUDE.md` — the North Star, the precedence of texts and the hard stops), then `docs/governance/` (the app profile, owner rules, autonomy registers, mechanism map and the current freeze) and the latest handoff in `docs/handoffs/`. New here? Start with `CONTRIBUTING.md`. Pre-launch April-2026 design docs in `docs/archive/` are HISTORICAL ONLY — ignore them.

Ambition: the default operating system for every screen a school, venue, or multi-location operator runs.

## Technology Stack

**Backend:** NestJS 11 + Express, Prisma ORM, PostgreSQL (Supabase), Redis (realtime)
**Frontend:** Next.js 16 (App Router), React 19, Zustand, Tailwind CSS 4, shadcn/Base UI, dnd-kit, React Query
**Monorepo:** Turborepo + pnpm
**Auth:** Argon2 password hashing, JWT + HttpOnly cookies, express-session, @nestjs/jwt + @nestjs/passport
**Realtime:** Signed WebSocket messages via Redis pub/sub with HTTP polling fallback
**File Storage:** Supabase (Postgres + object storage)
**Testing:** Jest (backend), Playwright (E2E)

## Monorepo Layout

```
apps/
  api/                 NestJS API server on port 8080 (or $PORT)
  web/                 Next.js web dashboard on port 3000 (or $PORT)
  player/              Android kiosk player (SHIPPED — release-signed APKs, gated by
                       apps/player/HARDWARE-QUALIFICATION.md; not "future")
  edge/                Edge functions

packages/
  database/            Prisma schema + @prisma/client, seed script
  api-types/           Shared TypeScript types (API contracts)
  scoreboard-cts/      Sports scoreboard / CTS feed types + helpers
  signage-design/      AI signage design engine (art-director, archetypes)

  NOTE (2026-09-08): `auth-core/` and `ws-events/` are GONE. They are listed in no
  package.json, imported by nothing, and carry 0 tracked files — what survives
  locally under those paths is stale `dist/` + `.turbo/` build detritus from May.
  A fresh clone does not have them. Do not "restore" them, and do not trust an
  older doc that says the Dockerfile must build them.
```

## How to Run

### Install & Setup
```bash
pnpm install                 # Install all dependencies
pnpm db:push                 # Push the schema (prisma db push) — a schema DIFF, NOT migrations
pnpm db:seed                 # Seed test data (tenants, users, templates)
```

### Development
```bash
pnpm dev                     # Start both API and web (parallel, in watch mode)
pnpm dev:api                 # NestJS API alone (watch mode, port 8080)
pnpm dev:web                 # Next.js web alone (watch mode, port 3000)
```

### Build & Run (Production)
```bash
pnpm build                   # Build both API and web
pnpm start                   # Start API in production mode
# For web: next start (from apps/web dir)
```

### Testing & Lint
```bash
pnpm test                    # Jest in each workspace that defines a test script (api, renderer, api-types, scoreboard-cts, signage-design). apps/web has none: run its Jest with `pnpm --filter web exec jest`
pnpm lint                    # ESLint across workspaces (api auto-fixes, web only reports)
```

### API Scripts
Individual app scripts available:
- `pnpm --filter api run start:prod` — NestJS production binary
- `pnpm --filter api run test:cov` — Jest with coverage
- `pnpm --filter web run build` — Next.js production build (a server build: route handlers and middleware, started with `next start`; not a static export)

## Conventions

- **TypeScript:** `strict: true` in `apps/web`, the root tsconfig and the `@cms/api-types`, `@cms/scoreboard-cts` and `@cms/signage-design` packages; `apps/api` is NOT strict (`strictNullChecks` only — `noImplicitAny: false`, no `strict`); no `any` without deliberate reason
- **Database Access:** Always via Prisma client (typed, migrations tracked)
- **Components:** shadcn/Base UI + lucide-react icons; Tailwind for styling
- **Forms:** React Hook Form + Zod validation; Zod is already in use at the API boundary (26 non-test files import it — 21 in `apps/api`, 4 in `packages/api-types`, 1 in `apps/web`)
- **Testing:** API and package Jest specs live next to source as `*.spec.ts`; web unit tests are `*.test.ts(x)` under `apps/web/src` (almost all in `__tests__/`) and run with `pnpm --filter web exec jest` (`pnpm test` skips them); Playwright e2e specs are `*.spec.ts` under `apps/web/tests`
- **Async Patterns:** async/await throughout; RxJS appears in only 8 API files (the interceptors), not NestJS-wide
- **Secrets:** Use env vars, never hardcode. .env is gitignored.

## Roadmap & Sprint Plan

> **Moved out of CLAUDE.md (2026-05-30 — governance review #9).** The full
> forward-looking plan — Sprint 1.5 (submit-for-review), 7 (offline player +
> USB sneakernet), 8/8b (fleet map + indoor floor plans), 9 (auto-branding),
> 10/11 (design imports + Canva), V2 (safety-platform pivot), multi-vertical
> expansion, and Sprint 13 (VenueOS Sports) — now lives in
> **[`docs/roadmap/ROADMAP.md`](roadmap/ROADMAP.md)**. It is context +
> plans, not load-bearing rules. The rules and the Standard Audit Surface
> stay below.
