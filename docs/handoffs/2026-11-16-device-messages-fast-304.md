# The device alert poll answered from memory - built, shipped switched off (2026-11-16)

**Status.** Branch `claude/device-messages-fast-304`, pull request open, **not merged**. Life safety CHANGE class: it needs a different vendor's review, the owner's written go, and an on-glass drill before `EMERGENCY_MESSAGES_FAST_304` is set for any screen. Merging changes nothing on any screen: with the variable unset, the route sends exactly what it sent before.

Model: Claude Fable 5.2 (`claude-fable-5-2`), Claude Code cloud session. No agents were dispatched.

## Situation

Sunday's fix (#311, #322) took the screens off the Vercel gateway. It moved requests; it did not reduce them. The owner asked for the app to scale efficiently before real customers arrive. The audit named `GET /api/v1/emergency/messages` as the first database ceiling: every paired screen polls it every 10 s, and every poll reads Postgres three times to discover that nothing changed.

## Measurement (2026-11-16, Railway HTTP metrics, one hour, 40 screens)

| What | Count |
|---|---|
| API requests, all paths | 53,080 - about 32,000 per screen per day |
| `GET /api/v1/emergency/messages` | 14,455 - 27% of all API requests, one per screen every 10 s |
| ... of those answered `304 Not Modified` | 14,368 - 99.4% |
| Postgres reads behind those polls | 3 each - about 43,000 an hour, 12 a second |

- Express answers the 304 only after the three reads, the serialisation and the body hash: the reads are the cost, and they buy "still nothing" 99.4% of the time.
- The API is in us-west2 and the database in us-east-1, on a pool of 10 connections. By the audit's arithmetic this one endpoint saturates the pool at 150 to 350 screens.
- **Correction to 2026-11-15:** a screen makes about 32,000 API requests a day, not 22,000. The request budget's totals leave out the APK's own timers. One API process therefore carries about 160 to 200 screens, not 240 to 300, and Railway costs about $275 per 1,000 screens a month, not $190. `docs/handoffs/2026-11-15-cost-fix-shipped.md` is corrected in place.

## What the change is

- `apps/api/src/emergency/device-messages-rev.ts` (new, pure, no Nest / Prisma / Redis import): a revision made of things the process already knows without Postgres, and a per-screen record of the exact response it last sent that screen.
- `apps/api/src/emergency/emergency.controller.ts`: the route becomes a thin adapter. Pass 1 asks "has anything moved for this screen?" from memory. Pass 2 is the old method, unchanged, called for every answer that is not a 304 from memory.
- `EMERGENCY_MESSAGES_FAST_304` (row in `apps/api/src/config/env-schema.ts`): unset or empty = off, the shipped default. A list of screen ids = those screens only, the bench ring. The exact word `all` = every screen. Anything else (`1`, `true`, a typo) names no screen and enables nothing.
- No schema change, no migration, no change to the player, the APK, the push, the signer or the HMAC gate, no new request from a screen.

## Why a 304 from memory is safe

The revision moves when any of these moves:

1. The tenant emergency epoch (`screens/emergency-rev.ts`), bumped by trigger, all-clear, SOS, broadcast, media alert and message clear for every tenant a send reaches.
2. The tenant state epoch (`screens/manifest-hot-cache.ts`), moved by `invalidateTenantState` before a trigger's fan-out and again after its commit.
3. The screen's tenant and group, from the credential snapshot the global `DeviceIdentityInterceptor` verified for that request.
4. The process origin, random per boot: nothing survives a restart.

A poll is answered 304 from memory only when all of these hold. Anything else is the database read it always was.

- The screen presents the exact ETag this process last sent it (the tag carries a hash of the body).
- The revision has not moved since that response's read **began** (the revision is taken before the read, never after).
- That read did not begin within 10 s of anything tenant-level moving. A trigger signals before its transaction commits; a read in that gap is served and never trusted.
- The record is under 60 s old.
- No message in that response has reached its expiry.
- The identity was verified by the interceptor, and the epoch could be read within 150 ms.

What it keeps: per screen, one ETag, one revision, two timestamps and a flag. No message row and nothing derived from one except its expiry instant. Every 200 is a live read.

The ETag is weak (`W/"m1.<revision>.<body hash>"`) on purpose: a compressing proxy keeps a weak validator and may weaken or drop a strong one, and the weak form is the one this route's 99.4% already proves survives every hop.

## What a screen can lose with the switch on

Stated against today's behaviour, where every poll is a live read:

- **A change made through the API** (trigger, all-clear, SOS, broadcast, media alert, message clear, from a school or from the district above it): nothing. It is in the screen's next poll, as today. Each change costs every screen of the affected tenants three live reads, then the hot path resumes.
- **A message reaching its expiry:** nothing. The record cannot answer at or after the earliest expiry it returned.
- **A change nobody signalled** (a row edited in Supabase Studio, a one-off script, a future writer that forgets the signal): up to 60 s later than today, on the polling tier only. The signed push is untouched. `device-messages-rev.writers.spec.ts` exists to stop such a writer from merging.
- **A screen moved to another group or organisation while a message is live for the destination:** up to 60 s later than today.
- **A second API replica** (not today): safe, but a screen that alternates replicas reads the database almost every poll, and with Redis down a replica learns of another replica's change only when a record ages out (60 s). Decide that design before adding a replica.

## Evidence

- `device-messages-rev.spec.ts`, 90 tests: the algebra, then a model world driven by the real epoch modules - idle (5 polls in 6 free), broadcast and clear at the next poll, the pre-commit trigger race, expiry, an unsignalled write (bounded at 60 s plus one poll), group and tenant isolation, re-home, revoked / unpaired / no identity, slow Redis, a second tab, a clock running backwards, a restart, the summary line.
- `device-messages-rev.writers.spec.ts`, 19 tests: a TypeScript-AST guard. Every `emergencyMessage` write in `apps/api/src` lives in the emergency controller, is awaited by its own handler and is followed by `bumpTenantEmergencyEpoch`; exactly 5 exist. Every update of `Tenant.emergencyStatus` / `emergencyPlaylistId` lives there too; exactly 5 exist. No raw SQL writes either. Negative controls first, so a checker that passes everything cannot pass.
- `emergency.device-messages-route.spec.ts`, 19 tests on the real controller and the shared targeting world: switch off = `res.json`, no header of its own, three reads a poll; a bench list changes only the listed screen; `1` / `true` / `yes` enable nothing; switch on = a 304 with zero Prisma calls; a real broadcast, lockdown and all-clear reach the next poll, from the school and from the district above it; another organisation's screen is still answered from memory; a revoked screen gets the empty answer the old way.
- Deliberate breaks: 18 rules of the module removed one at a time, and 3 signals removed from the controller (a district broadcast and a district trigger that signal only the district, a message writer without its bump). Every one fails a test. One of them survived its first run: the district broadcast test had aged its first record past 60 s during setup, so a read forced by age was hiding the missing signal. The test now holds every record young and fails as it should.
- Local runs: the emergency folder 31 suites; the whole API suite 637 of 640 suites, the 3 failures being the suites that need ffmpeg, failing identically on `master`; 0 new type errors against `master`.
- Guards: `check-rulebook.cjs`, `generate-env-docs.cjs --check`, `check-env-declared.cjs`, `check-tenant-isolation.cjs`.

## What could not be verified from this session

- **The generated database client cannot be built in this sandbox** (its engine download is blocked). Suites that import the controller ran locally against a stand-in for the client. CI is the real run; the pull request carries its result.
- **Nothing ran on glass, and nothing ran in production.** The switch is unset.
- **Whether every hop between a screen and the API returns the validator unchanged.** Designed around (see the weak ETag), and visible once on: the API writes one counts-only line every ten minutes while the switch is on, `[Emergency] device message poll, last 10 min: N answered from memory, M read the database (reasons), K had no revision`. A validator that does not survive shows as `no-validator` or `different-representation` on every poll.
- **CPU per poll.** The request count does not change; what one 304 from memory costs the process is unmeasured.

## Expected effect, unmeasured until it runs

- Database reads for this poll at idle: 3 per poll to about 0.5 per poll. Today 12 a second to 2 a second. At 1,000 screens 300 a second to 50 a second.
- This endpoint's database ceiling, by the audit's arithmetic: 150 to 350 screens to about 900 to 2,100.
- It does **not** raise the API process ceiling (160 to 200 screens per process) by itself.

## Rollout - each step is the owner's decision

1. A different vendor reviews the pull request. The owner gives a written go. The lead merges. Nothing changes on any screen.
2. Off-hours, the lead sets `EMERGENCY_MESSAGES_FAST_304` to two or three bench screen ids. Changing a Railway variable restarts the API, so this is a deploy.
3. The on-glass drill, with the owner's permission for that test: a text broadcast aimed at one listed screen, then its clear, watched on the glass. To exercise the polling tier itself, one listed screen should sit on a network that blocks WebSocket and SSE: the broadcast must appear within one poll (10 s) and leave within one poll of the clear. Then read the summary line.
4. The lead sets it to `all`. Watch the path's response time and 304 share (Railway), the database's query rate (Supabase) and the summary line.

**Rollback at any step:** unset the variable. Nothing is persisted; the records live in the process and die with it.

## What this does not fix - still open, in order

1. The APK's native alert watch polls the full manifest every 5 to 15 s (`NativeAlertWatch.kt`). What one poll costs the database is unmeasured. Likely the next largest reader.
2. The API and the database are in different regions. Moving the API (and Redis) next to the database cuts every read's latency several times over. Owner's apply.
3. Retries on 401 / 402 / 429 do not slow down (`docs/COST.md` rule 3, a GAP). Sentry sampling. An index on `fleet_samples(created_at)` (a schema change, the owner's approval).
4. One API process. A second replica needs the design note above and a load test as a gate.
5. From 2026-11-15, unchanged: the API's own hostname under `venue-os.app`, the origin epoch in `createControlPlaneRequest`, a usage watch, the bench drill still owed for #311 and #322.
