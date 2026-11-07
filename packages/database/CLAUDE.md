**Scope:** this file governs `packages/database/` (the Prisma schema, the migrations and the seed); `/CLAUDE.md` and `/AGENTS.md` are the core it refines — where they disagree, the core wins. The text below moved here verbatim from the old single-file `CLAUDE.md` on 2026-11-01 (move map: `docs/governance/decisions/2026-11-01-rulebook-restructure-map.md`).

# Database and schema rulebook

## Migrations — a schema change ships a MIGRATION FILE

### Database Commands (from root)
```bash
pnpm db:generate             # Regenerate @prisma/client
pnpm db:migrate              # Create a new migration (interactive)
pnpm db:reset                # Destroy and recreate database (dev only)
```

⚠️ **A schema change ships a MIGRATION FILE, or it takes production down (2026-09-19).**
`pnpm db:push` is the LOCAL dev flow only. **Production applies migration files and nothing
else**: `railway.json`'s `startCommand` is `scripts/railway-start.sh`, which runs
`prisma migrate deploy` **before node boots** (deploy log: `Applying migration …` →
`migrations applied successfully` → `booting the API`). Nobody runs `db:push` against
production, ever — there is no step for it, and nothing to wait on.

**Rules:**
1. Any `schema.prisma` change that alters the database adds
   `packages/database/prisma/migrations/<YYYYMMDDHHMMSS>_<name>/migration.sql` **in the same
   commit**. Generate the SQL with Prisma so it cannot drift from the client:
   `prisma migrate diff --from-schema-datamodel <old> --to-schema-datamodel <new> --script`.
2. **Additive only** (V1 is locked), and **idempotent** — `ADD COLUMN IF NOT EXISTS`, and a
   `DO $$ … pg_constraint … $$` guard for constraints — because dev databases already took the
   shape via `db:push`. On a hot table add `SET lock_timeout = '5s';` so it fails fast and
   retries instead of queueing the fleet behind a lock. Pattern:
   `20260919120000_screen_faces`. Prove it on a scratch Postgres: apply twice, both exit 0.
3. **Never edit a migration that has been applied** — not even a comment. Prisma checksums
   applied migrations and `migrate deploy` compares them.
4. The `main.ts` "boot-time schema safety net" is a seatbelt for `SKIP_MIGRATE` boots, **not**
   the mechanism: it runs AFTER `app.listen()`.
5. CI checks rule 1: `scripts/check-schema-has-migration.cjs` (Deploy Reliability →
   `schema-has-migration`, shown as "schema change ships a migration") fails a schema DDL
   change with no new migration dir, and prints the DDL. It is database-free. Verified
   against `684f8576` itself: red. It reports; it does not block a merge — only four build
   checks are required today (see the Deploy Reliability section).

Incident: `docs/incidents/2026-09-16-schema-change-without-migration.md`

## DATABASE_URL — why session mode on port 5432

The variable's row (what to set, the example value) is in `docs/ENVIRONMENT.md`; this is the measured reasoning behind it, moved verbatim from that row.

Measured on the real prod DB from one machine (wire RTT 74ms): raw `pg` on a reused connection = **68ms** (1 round trip); **Prisma via 6543 + `pgbouncer=true` = 350ms** (~5 round trips); **Prisma via 5432 session mode = 71ms** (1 round trip). Prisma's pgbouncer/transaction-pooling path turns one logical read into ~5 network round trips and made `DEALLOCATE ALL` 22% of all statements ever sent to the database. Prod result: queries 333ms -> ~212ms, boot `Prisma pool warm` 317ms -> 139ms, and `/health` stopped flickering `degraded` (the 400ms liveness budget had been sitting right on the old 333ms floor, which is what generated the "PLATFORM CRITICAL — database unreachable" emails). **`connection_limit` MUST stay LOW in session mode** — each pool slot holds a real Postgres connection and this instance has `max_connections=60` with ~30 used by Supabase itself. 10 is correct; raising it toward 25+ risks exhausting the server ceiling. Always check `SELECT current_setting('max_connections')` before changing it. Keep `pool_timeout=20`. **Supavisor's Pool Size (Supabase → Database → Settings → Connection pooling) is 24 since 2026-09-22 and must stay ≥ 2 × replicas × `connection_limit` + spare** — every Railway deploy runs the old AND the new API container for ~7–19 s, each allowed `connection_limit` connections; incident: `docs/incidents/2026-09-22-deploy-overlap-500s.md`. Checked headroom first: `max_connections` 60, non-API ≈ 14, so 24 peaks at ~38/60. Two replicas would need 40 (and a bigger compute).

## Core Domain Models

| Model | Purpose | Key Fields |
|---|---|---|
| **Tenant** | District or school (hierarchy-enabled) | `id`, `parentId` (for district→school), `name`, `slug`, `emergencyStatus`, `emergencyPlaylistId` / `emergencyPortraitPlaylistId` (the active alert), `emergencyIsDrill`, and 24 per-incident playlist ids: `panic{Evacuate,Lockdown,Weather,Hold,Secure,Medical}PlaylistId` and `drill{…}PlaylistId`, each with a `…PortraitPlaylistId` twin |
| **User** | Team member with RBAC role | `id`, `tenantId`, `email`, `passwordHash`, `role` (a `String` column holding an `AppRole` value — the schema defines no enums), `canTriggerPanic` (capability flag) |
| **Screen** | Physical or virtual display | `id`, `tenantId`, `screenGroupId`, `name`, `deviceFingerprint`, `pairingCode`, `status`, `lastPingAt`, `resolution`, `osInfo`, `browserInfo` |
| **ScreenGroup** | Organize screens (hallway, lobby, etc.) | `id`, `tenantId`, `name`, `description` |
| **Playlist** | Sequence of assets + schedule rules | `id`, `tenantId`, `name`, `templateId`, `items[]` (PlaylistItem[]) |
| **PlaylistItem** | Single asset in a playlist | `id`, `playlistId`, `assetId`, `durationMs`, `sequenceOrder`, `daysOfWeek`, `timeStart`/`timeEnd`, `transitionType` |
| **Schedule** | When/where a playlist plays | `id`, `tenantId`, `playlistId`, `screenId|screenGroupId`, `startTime`/`endTime`, `daysOfWeek`, `timeStart`/`timeEnd`, `priority`, `isActive` |
| **Asset** | Image, video, or document file | `id`, `tenantId`, `uploadedByUserId`, `folderId`, `fileUrl`, `mimeType`, `status` (a `String`: `PENDING_APPROVAL` by default, `PUBLISHED` once approved — the only value the manifest serves — or `ARCHIVED`) |
| **AssetFolder** | Hierarchical asset organization | `id`, `tenantId`, `parentId`, `name` |
| **Template** | Screen layout (537 system presets + custom — see Template System for how to re-derive) | `id`, `name`, `description`, `isSystem`, `screenWidth`/`screenHeight`, `bgColor`/`bgGradient`/`bgImage`, `zones[]` (TemplateZone[]) |
| **TemplateZone** | Widget region in a template | `id`, `templateId`, `name`, `widgetType`, `x`/`y`/`width`/`height` (% coords), `zIndex`, `defaultConfig` |
| **AuditLog** | Immutable activity log | `id`, `tenantId`, `userId`, `action`, `targetType`, `targetId`, `details`, `createdAt` |

### User Roles
- **SUPER_ADMIN** — VenueOS staff; manage all tenants
- **DISTRICT_ADMIN** — District-level; manage schools, users, branding
- **SCHOOL_ADMIN** — School-level; manage screens, playlists, staff
- **CONTRIBUTOR** — Can upload/edit assets and schedules
- **RESTRICTED_VIEWER** — Read-only access to dashboards

## Prisma schema and types

8. **Prisma schema & types** — Source of truth is `packages/database/prisma/schema.prisma`. Regenerate `@prisma/client` after schema changes: `pnpm db:generate`

## The manifest content cache — content writes go through `prisma.client`

7. **Manifest content cache (2026-07-30 — Supabase egress diet).** The
   normal-content manifest is served from an in-process per-screen cache
   (`manifest-hot-cache.ts`), invalidated by (a) a Prisma `$use` mutation
   hook in `prisma.service.ts` on any write to a manifest-fed model, (b) the
   screen's next schedule startTime/endTime boundary, (c) a TTL backstop
   (30 min armed / 20 s unarmed). Emergency + sports-scoreboard branches
   return BEFORE the cache and are never cached; REVOKED/auth reads stay
   live per poll. Rules: content writes MUST go through `prisma.client`
   (raw-SQL/Studio edits show up on players only after TTL); a NEW
   high-frequency Screen telemetry column MUST be added to
   `SCREEN_TELEMETRY_ONLY_FIELDS` or fleet telemetry will thrash the cache
   (silently re-creating the 25 GB/mo egress this killed); and per sync-rule #4 the
   cached payload stays free of volatile per-request fields.
