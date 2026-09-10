# Moving VenueOS onto your own infrastructure

Evidence: `docs/research/2026-09-10-self-host-migration/00-RECON.md` (seven read-only
agents, 54 silent-failure items catalogued). Written 2026-09-10, when there were no
customers and 16 live screens — the cheapest this migration will ever be.

---

## 1. The database decision — settle this first, it sizes everything else

**Use self-hosted PostgreSQL. Do not use Microsoft SQL Server.**

This was measured, not estimated. Flipping `provider = "postgresql"` → `"sqlserver"` in
`packages/database/prisma/schema.prisma:7` and running our own Prisma 5.22 CLI produces
**117 schema validation errors before a single line of app code compiles**:

| | PostgreSQL (self-hosted) | MS SQL Server |
|---|---|---|
| Prisma schema | works unchanged | **117 validation errors** (28 Json, 6 list, 83 relation) |
| The 115 migrations | run verbatim | **all discarded** — `migration_lock.toml` pins the provider |
| Raw SQL | unchanged | **27 of 36** statements rewritten in T-SQL |
| Cascade deletion | unchanged | **redesigned** — SQL Server forbids multi-path FK cascades |
| Audit-log immutability | unchanged | **gone** — 2 plpgsql functions + 2 triggers have no equivalent |
| Total discrete changes | **4 code sites + 2 env vars** | **~250, plus two redesigns** |

The 83 relation errors are not cosmetic. They come from one feature: the district→school
hierarchy (`schema.prisma:71-72`). SQL Server rejects cyclic/multi-path cascade FKs at the
engine level, and breaking that self-relation does not fix it — the count goes *up* to 94,
with 57 multi-path errors spanning Tenant→Screen, Tenant→Asset, Tenant→AuditLog and 15 more.
The only resolution is setting ~58 cascade relations to `NoAction` and re-implementing
tenant deletion as ordered application-level cascades across 30 models. That is a rewrite of
the deletion semantics of the product.

**Three SQL Server changes would be silent, which is worse than loud:**

1. **Default collation is case-INSENSITIVE.** 18 `@unique` string columns change meaning.
   Concretely, session refresh-token family IDs are `base64url` — a case-variant would match
   a real family and let an attacker revoke a victim's session family at will.
2. **The audit-log immutability triggers disappear with no error**, because the application
   never attempts the UPDATE/DELETE they block. That is the §16 forensic guarantee — the
   record of who fired a district-wide lockdown — silently becoming mutable.
3. **`SERIALIZABLE` means pessimistic range locks on SQL Server**, not Postgres's fast
   abort-and-retry, and our retry classifier only matches Postgres/pgbouncer error strings.
   Seat enforcement would block instead of retrying.

By contrast, self-hosted Postgres is genuinely a config change: **zero** `CREATE EXTENSION`,
zero RLS, zero citext, zero tsvector across all 115 migrations. `scripts/venueos.cjs env up`
already boots the real production image against a throwaway `postgres:16-alpine` — that is
the migration, proven, today.

> If SQL Server is a hard customer requirement rather than a preference, say so and I will
> scope it honestly as a data-layer rewrite. It is not a porting exercise.

---

## 2. What already works in your favour

- **Emergency + signage need zero internet.** Verified: the emergency controller imports only
  Redis, Prisma, the WS signer, the cache invalidator, GPIO and the webhook dispatcher. The
  8.6k-line player has no hardcoded external hosts. The service worker keeps a never-evicted
  1 GB emergency media tier. **A school on a closed network still gets lockdown alerts.**
- **Auth is entirely ours** — Argon2 + our own JWT + express-session. `@supabase/auth-js` is
  a transitive lockfile entry imported by nothing. Zero migration cost.
- **The API container is already a real production closure** — 3-stage Dockerfile, ~20 boot
  assertions, system Chromium (never downloaded at runtime), ffmpeg, pinned CA. It runs under
  systemd/compose/k8s essentially unchanged.
- **`venueos env up` is ~80% of a single-box installer's happy path** — it already creates a
  network, starts Postgres, generates all four required secrets with `crypto.randomBytes(32)`,
  and boots the real image to a healthy `/health`.
- **Migrations self-apply at boot** (`scripts/railway-start.sh`) and system presets self-seed
  (`main.ts:455`).

---

## 3. What is actually hard, in order

### 3.1 Object storage — the single biggest item
`SupabaseStorageService` is 808 lines / 22 methods / 18 consumers speaking the **Supabase
Storage REST API**, not S3. **MinIO cannot answer it.** Two paths:

- **Cheap:** run the open-source `supabase/storage-api` container. URL shape and client stay
  identical. Recommended for the first cut.
- **Expensive:** rewrite the service against S3 (`@aws-sdk/client-s3`), which then works with
  MinIO, Ceph, or a NAS.

Either way: **31 columns persist absolute URLs**, so existing rows need rewriting, and the
bucket-level `allowedMimeTypes` / `fileSizeLimit` guards have **no S3 equivalent** — that
defence-in-depth must be re-implemented in the app. Also note the image-transform pipeline is
a Supabase-only endpoint behind 27 call sites whose failure handler **silently** serves
full-resolution originals.

### 3.2 The web app cannot be repointed after it is built
**Verified empirically, not assumed.** In the checked-in `.next` output there are **0**
surviving `process.env.NEXT_PUBLIC_API_URL` lookups, `http://localhost:8080` is baked into
**74 chunks**, and `routes-manifest.json` pins `connect-src` to it.

**A prebuilt web image cannot be pointed at a customer's hostname by env var.** So either:
- **(a)** the installer builds the web app per customer (simple, slow, needs a toolchain), or
- **(b)** we refactor onto a runtime config endpoint (a real change, but it is what makes a
  true "download the installer" product possible).

**This is the one architectural decision that determines whether you can ship an installer at
all.** Everything else on this list is plumbing.

### 3.3 The screens
- The Android player **pins `api-production-39a1.up.railway.app` into both host allowlists**
  regardless of the `-PplayerBaseUrl` build flag, and `ApiRoot.resolve()` silently falls back
  to the *web* origin when a rejected API host appears. A customer whose API host is not a
  subdomain of their web host gets **screens that play content while reporting OFFLINE
  forever**, with only a logcat warning.
- **OTA is GitHub-Releases-only, and its failure mode is a lie**: unreachable GitHub returns
  `uptoDate: true`, so an air-gapped fleet is frozen on its current build with no error.
- **TLS is a real risk.** Self-hosting implies a private CA. OEM Android WebViews already fail
  on chain issues here — that is exactly what stranded the Android-9 Goodview units. Kiosks
  must trust the customer CA *before* pairing, or they will sit on "Connecting…".

### 3.4 Things that phone home or misbehave quietly
- `apps/web/src/app/cdn/assets/[...path]/route.ts:25` **hardcodes our production Supabase
  project** as its fallback origin. The override (`NEXT_PUBLIC_SUPABASE_URL`) appears once in
  the whole repo, is absent from `.env.example` and absent from CLAUDE.md. A self-hosted
  install would fetch assets from *our* cloud and nobody would know.
- `TRUSTED_PROXY_HOPS` defaults to **2** — measured for Railway's edge+internal chain. Behind
  one on-prem nginx the correct value is **1**. Wrong means every rate-limit key and every
  `AuditLog.ipAddress` — including who fired a lockdown — resolves to a client-spoofable
  entry. Silent.
- Session/CSRF cookies are hardcoded `Secure` + `SameSite=None` under `NODE_ENV=production`.
  **A plain-HTTP LAN install cannot hold a session.** TLS is mandatory, not optional.
- `APP_PUBLIC_URL` defaults to `http://localhost:3000`, so every password-reset and invite
  email points at the recipient's own machine.
- With Redis absent: `POST /auth/logout` **503s on every call**, and the sports proof-of-play
  verified lane silently grades zero.
- The reverse proxy must forward `/realtime` at the **API root** (not under `/api/v1`) and set
  `X-Forwarded-For` **on the WebSocket upgrade location**, or every screen in a venue shares
  one pre-auth socket bucket.
- **234 static boards + 107 source files load Google Fonts at runtime** with a render-blocking
  `<link>`. Air-gapped, typography breaks. Fonts must be self-hosted.
- `docker-compose.yml` **overrides `railway-start.sh`**, so an installer built naively from it
  boots against an **unmigrated schema**.
- `apps/edge` is a Cloudflare Worker that was never cut over (its route binding is commented
  out). Delete it.

---

## 4. The path

**Phase 0 — decide (you).** Postgres vs SQL Server (see §1). Build-per-customer vs runtime
config (§3.2). Air-gapped or internet-permitted. These three answers set everything below.

**Phase 1 — make the app location-agnostic.** No infrastructure yet, all in-repo:
delete the hardcoded cloud fallbacks; make the player allowlist build-flag-driven; move
`TRUSTED_PROXY_HOPS`, cookie flags and `APP_PUBLIC_URL` into explicit install config;
self-host the fonts. This is the work that stops an install phoning home.

**Phase 2 — replace the two managed services.** Storage (§3.1) and Redis (`redis:7-alpine`,
already in compose). Postgres needs no work beyond `DATABASE_URL`.

**Phase 3 — the box.** One `docker-compose.yml` that is actually correct: postgres, redis,
storage-api, api, web, and Caddy for TLS + the `/realtime` upgrade rules. Plus first-run:
migrate → seed → **create the first admin** (a path that does not exist today outside the
cloud signup flow) → pair the first screen.

**Phase 4 — the fleet.** A self-hosted OTA catalogue so screens update without GitHub, and a
documented CA-trust step for kiosks before pairing.

**Phase 5 — the installer.** Realistically a **docker compose bundle + a setup script**, not
an `.exe`. On Windows that means Docker Desktop or WSL2; the repo is bash/Alpine throughout,
so native Windows Server + IIS would be a separate port. A prebuilt VM/OVA image is the other
credible shape if you want true one-click.

---

## 5. What this does not cover

- **Bucket backups do not exist.** The nightly `pg_dump` covers Postgres only; the 5 storage
  buckets have no backup at all. That gap exists in the cloud deployment *today* and would
  follow you on-prem.
- Effort sizing per phase — deliberately omitted rather than invented. Ask and I will scope a
  phase once you have picked the Phase 0 answers.
