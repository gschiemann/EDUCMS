# API Versioning & Schema Evolution — VenueOS (EDU CMS)

**Status:** Current / living. **Last verified against code:** 2026-05-29.
**Why this exists:** a fleet of **always-on kiosks** and a **native Android APK**
poll this API. A breaking change doesn't just 500 a browser the user can
refresh — it can take a hallway full of emergency-capable screens offline until
someone walks to each one. This doc is the contract for changing the API
**without bricking the fleet.**

---

## 1. How versioning actually works today

- **One published version: `v1`.** Every route lives under `/api/v1/...`.
- **The prefix is applied per-controller**, hardcoded in the `@Controller()`
  decorator — e.g. `@Controller('api/v1/auth')` (`auth.controller.ts:12`),
  `@Controller('api/v1/emergency')` (`emergency.controller.ts:39`),
  `@Controller('api/v1/health')` (`health.controller.ts:37`). 57 of 58
  controllers carry the `api/v1` prefix. There is **no** global
  `setGlobalPrefix` and **no** `enableVersioning()` — the version is part of
  each controller's path string.
- **Consequence:** adding `v2` means adding `@Controller('api/v2/...')`
  controllers that coexist with the `v1` ones. `v1` keeps serving the fleet
  unchanged while `v2` is introduced. There is no "flip a flag and the whole API
  becomes v2."

## 2. The two contracts the fleet depends on

A "breaking change" is anything that violates one of these:

1. **HTTP route + response shape** consumed by the player/APK — chiefly:
   - `GET /api/v1/screens/:id/manifest` (carries playlist + the live
     `emergency` field — the HTTP-polling backstop)
   - `GET /api/v1/screens/:id/emergency-assets`
   - `POST /api/v1/player/update-check` (OTA), `.../ota-state`,
     `.../crash-report`
   - `POST /api/v1/screens/register`, `/api/v1/devices/pair`
   - the signed-WebSocket message envelope (`eventId`/`timestamp`/`type`/
     `payload`/`signature` — `security/ws-signature.ts:20-30`)
2. **The Prisma DB schema** behind those routes.

Both must evolve **additively**.

## 3. Additive-only schema rule (load-bearing)

VenueOS runs against a **live pilot tenant**. The standing rule
(memory: V1 pilot locked) is **migrations are additive-only**:

- ✅ Add a new table.
- ✅ Add a **nullable** column (or one with a default).
- ✅ Add a new index.
- ❌ Drop or rename a column/table that any deployed code reads.
- ❌ Tighten a column to `NOT NULL` without a backfill + a default.
- ❌ Change a column type in a way that breaks existing rows.

Why it's safe: new tables + nullable pointers don't change existing query
patterns (this is exactly why Sprint 1.5 `Submission`, Sprint 8b floor plans,
and Sprint 13 sports models could ship to the live tenant — all additive).

**Deploy-time note (the seatbelt, not the system):** Railway's start command
(`node apps/api/dist/main.js`) does **not** run `prisma migrate deploy`. New
columns reach prod via a regenerated client, and a short, idempotent
`ALTER TABLE ... ADD COLUMN IF NOT EXISTS` boot-time safety net covers the
window before the real migration lands (`main.ts:243-258`). This is a seatbelt
for additive columns — **it is not a substitute** for writing the migration,
and it cannot make a destructive change safe. Retire each entry once the
matching migration has cleared every environment.

## 4. How to make a NON-breaking API change

- **Add a field to a response?** Fine — clients ignore unknown fields. Make sure
  the new field is also tolerated by the **APK's** JSON parsing (the APK has no
  cookie jar and lenient parsing — but verify it doesn't choke on a new type).
- **Add a new endpoint?** Add it under `/api/v1/...`. No version bump needed.
- **Add a new WS message type?** The player has a `default`/unknown-type branch;
  add the type and ship the player handler **first or together**, never a
  message type the deployed fleet can't recognize on a life-safety channel.
- **Change request validation?** Loosen freely; **tightening** validation on an
  endpoint the fleet already calls is a breaking change — treat as §5.

## 5. How to make a BREAKING change without bricking the fleet

1. **Introduce `v2` alongside `v1`.** New `@Controller('api/v2/...')`; leave
   `v1` serving.
2. **Migrate the schema additively** to support both shapes simultaneously
   (new nullable columns; dual-write if needed).
3. **Ship the new player/APK** that speaks `v2`. For the APK this means an OTA
   roll — and **OTA itself depends on `v1` endpoints** (`/player/update-check`),
   so **`v1` must keep working until the entire fleet has upgraded.** Bump the
   gradle `versionCode`/`versionName` and commit **before** tagging
   (memory: `feedback_player_release_tagging` — a raw tag without a bump caused
   an endless OTA loop in the field).
4. **Confirm fleet adoption** — per-screen `player_version`/`player_version_code`
   columns (`schema.prisma`, `main.ts:248-250`) tell you who's upgraded. Do not
   proceed to step 5 until the fleet is on the version that speaks `v2`.
5. **Deprecate `v1`** (§6) only after adoption is complete.
6. **Then** retire the old columns in a **separate, later** additive→removal
   migration (the only time a drop is allowed: when nothing deployed reads it).

## 6. Deprecation procedure (without bricking kiosks)

1. **Announce** the `v1` sunset internally + to any API-key integrators
   (`vos_` tenant keys, `jwt-auth.guard.ts:41`).
2. **Instrument** `v1` usage so you can see who/what still calls it (the
   `RequestLogInterceptor` breadcrumb + route metrics).
3. **Keep `v1` alive until fleet `player_version` telemetry shows zero stragglers
   AND no integrator traffic.** Kiosks are the long pole — a school that hasn't
   powered a screen on in a month is still on the old version.
4. **Soft-deprecate first:** `v1` keeps working but logs/warns; never hard-404 a
   route the fleet still hits on a life-safety path.
5. **Remove `v1` controllers** only after telemetry is clean; then the
   schema-cleanup migration (§5.6).

## 7. Anti-patterns (do not do these to a live fleet)

- Renaming/removing a manifest or OTA field "to clean it up" — kiosks parsing
  the old shape break.
- Tightening validation on `/screens/register`, `/devices/pair`, or any
  device endpoint without a `v2` path.
- Hard-404'ing a `v1` route before fleet telemetry proves nobody calls it.
- A destructive migration "because the boot safety net will handle it" — the
  safety net only does `ADD COLUMN IF NOT EXISTS`; it cannot undo a drop.
- Tagging an APK release without bumping `versionCode` first (endless OTA loop).

## 8. Quick reference

| Question | Answer |
|---|---|
| Where is the version set? | Per-controller `@Controller('api/v1/...')` (no global prefix) |
| How do I add `v2`? | New `@Controller('api/v2/...')` controllers; `v1` keeps serving |
| Can I add a column? | Yes, nullable / with default (additive-only) |
| Can I drop a column? | Only after nothing deployed reads it, in a separate later migration |
| What guards prod migrations? | Additive-only rule + boot-time `ADD COLUMN IF NOT EXISTS` seatbelt (`main.ts:243`) |
| How do I know the fleet upgraded? | `Screen.player_version` / `player_version_code` telemetry |
| When can I sunset `v1`? | Only when fleet telemetry + integrator traffic are clean |
