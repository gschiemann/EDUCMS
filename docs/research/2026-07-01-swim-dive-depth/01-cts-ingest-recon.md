# CTS ingest recon — existing patterns to mirror for SwimTimingFeed

**Date:** 2026-07-01
**Author:** research sub-agent dispatched from the swim/dive DEPTH build agent (worktree `agent-af977bf281d0b326d`)
**Scope:** find any existing serial/bridge/ingest pattern in the API before building Part 2 (CTS timing-console feed) from scratch.

## TL;DR

**This is NOT greenfield.** A complete CTS (Colorado Time Systems) ingest pipeline already exists end-to-end, built for Sprint 13 (game-clock/score ingest, NOT swim timing yet). The new `SwimTimingFeed` parser/normalizer should extend this existing pattern (same package, same feed-token auth, same controller shape, same audit-sampling), not invent a new transport.

## 1. Existing bridge/serial/ingest/scoreboard code

- `packages/scoreboard-cts/` — a full workspace package (`@cms/scoreboard-cts`, v1.1.0) with **browser-side** RS-232 parsers: `CtsParser` (CTS System 6/Gen 6, water polo), `DaktronicsParser` (All Sport 5000 RTD), `Gen7Parser`, `ClassicCtsDecoder`, `CtsWireParser`, plus a `CONSOLE_PROFILES` registry (`packages/scoreboard-cts/src/console-profiles.ts`) mapping console family → serial settings → decoder. Explicitly documented as browser-only (no `fs`/`Buffer`/Node APIs) — targets the **Web Serial API** (Chrome 89+), used from a Beelink Mini PC player, not the API server.
- `apps/web/src/components/player/CtsBridge.tsx` — the browser component that opens the serial port via `navigator.serial`, runs the parser, and **POSTs parsed snapshots to the API** at ~5 Hz.
- Also: `apps/web/src/app/super/cts-simulator/page.tsx` (a CTS simulator UI), `apps/web/src/components/widgets/sports/CtsRibbonWidgets.tsx`, `cts-fields.ts`.
- No literal "bridge"/"serial" server-side transport exists in `apps/api/src` — the API only ever receives already-parsed JSON over HTTP.

## 2. `apps/api/src/sports/` structure + `updateStats`

Files: `clock-advance.service.ts`, `sponsor-impression.spec.ts`, `sponsor.constants.ts`, `sponsors.controller.ts`, `sponsors.service.ts` (+spec), `sports-board.controller.ts`, `sports-engine.spec.ts`, `sports-feed-token.ts`, `sports-stats.service.ts` (+spec), `sports.controller.ts`, `sports.module.ts`, `sports.service.ts` (+spec, ~5200 lines).

`updateStats` (operator-console path, `apps/api/src/sports/sports.service.ts:2739`):
```ts
async updateStats(
  tenantId: string,
  id: string,
  dto: { stats?: Record<string, unknown> },
)
```
Validates `dto.stats` is a plain object; scalar stat keys are checked against `def.stats` (per-sport catalog) + a `META_KEYS` allowlist (e.g. `celebrationPack`), strings capped at 200 chars, numbers/booleans passed, everything else dropped. Structured array-valued keys (`STRUCTURED_STAT_KEYS = ['results', 'playerFouls', 'playerExclusions']` in `packages/api-types/src/sports.ts:302`) go through `sanitizeStructuredStat(key, value)` which bounds arrays to 64 entries, strings to 64 chars. `MeetResult`/`ResultEntry` types live at `packages/api-types/src/sports.ts:240-263`.

## 3. Device/console-facing ingest auth (mirror this exactly)

Two live patterns:
- **JWT device auth** (`apps/api/src/devices/devices.controller.ts`) — pairing-code exchange → signs a device JWT with `DEVICE_JWT_SECRET` via `requireSecret()`. For player kiosks, session-based.
- **Stateless HMAC feed token** (`apps/api/src/sports/sports-feed-token.ts`) — the one to mirror for a console. `makeFeedToken(gameId, {version, ttlSeconds})` / `verifyFeedToken(gameId, token, currentVersion)`. Game-scoped HMAC (`HMAC-SHA256("feed:<gameId>", secret)`), secret is `SPORTS_FEED_SECRET` env var falling back to `DEVICE_SECRET_KEY` via `requireSecret`. Revocation via `Game.feedTokenVersion` counter (bump → all old tokens die). Presented via `x-feed-token` header (preferred) or `?token=` query param.

Controller usage (`apps/api/src/sports/sports-board.controller.ts:152-203`, endpoint `POST :id/cts-snapshot`): rate-limits BEFORE auth (in-memory sliding window, 40 req/10s per game), reads token from header-or-query, verifies against `getFeedTokenVersion(id)`, then calls the service. A near-identical simpler endpoint `POST :id/feed` (line 206) exists for generic score/clock ingest via `ingestByFeed`.

## 4. WebSocket/LED bridge with custom protocol

None found server-side beyond the CTS/Daktronics serial decoders already covered in #1. No "ecbox"/"NovaStar bridge"/"onair" server-side protocol exists — NovaStar Taurus references in CLAUDE.md concern CSS/Chromium-83 compatibility only, not a data protocol.

## 5. AuditLog pattern to mirror

From `ingestCtsSnapshot` (`sports.service.ts` ~line 5007), wrapped in try/catch (best-effort, never blocks the write):
```ts
await this.prisma.client.auditLog.create({
  data: {
    tenantId: game.tenantId,
    userId: auth.actorUserId || null,
    action: 'CTS_SNAPSHOT_INGEST',
    targetType: 'Game',
    targetId: gameId,
    details: JSON.stringify({ source: auth.source || 'cts', reconnect, scoreChanged, segmentChanged, clockRunChanged, horn, snapshot: cleaned }),
  },
});
```
Sampled, not per-packet (would flood at 5Hz) — logs on reconnect, score/segment/clockRunning change, horn, or every 60s otherwise.

## 6. Tenant scoping pattern

`private async owned(tenantId, id)` (`sports.service.ts:216`) — `game.findFirst({ where: { id, tenantId } })`, throws `NotFoundException` if absent. Public helper `assertGameOwned`. For the feed/device path specifically, `ingestCtsSnapshot` (`sports.service.ts:4738`) branches: if `auth.tenantId` present (authenticated dashboard caller) it scopes by tenant; for the **public token path** it does `findUnique({ where: { id: gameId } })` with no tenant filter — token possession itself proves game ownership. Controller-level guard is `@UseGuards(JwtAuthGuard, RbacGuard)` + `@RequireRoles(...)` for admin routes; the feed/cts-snapshot routes are deliberately unguarded (no `JwtAuthGuard`) since a console box can't hold a session.

## 7. Spec.ts conventions

`apps/api/src/sports/sponsors.service.spec.ts` (211 lines) — in-memory Prisma fake, not a real DB/TestingModule:
```ts
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SponsorsService } from './sponsors.service';

function matches(row, where = {}) { /* ...where-clause emulation incl. `in`/`not` */ }
function makeTable() { /* returns {rows, findFirst, findMany, create, update, delete} */ }

const TENANT = 'tenant-1';
function setup() {
  const sponsor = makeTable(); const game = makeTable(); const auditLog = makeTable();
  const prisma = { client: { sponsor, game, auditLog } };
  const service = new SponsorsService(prisma as any);
  return { service, sponsor, game, auditLog };
}
```
`apps/api/src/sports/sports.service.spec.ts` (~5000+ lines) follows the identical fake-table convention — see its `ingestCtsSnapshot` tests at lines 1494-1660 and 2130-2220 for the exact assertion style.

## Recommendation actually taken

Given the mission's own instructions ("write thorough Jest unit tests against the documented CTS **scoreboard serial** protocol... this is how we prove correctness without the physical console"), and that the existing `@cms/scoreboard-cts` package targets *game-console* protocols (CTS System 6 / Gen 6 / Daktronics All Sport — score/clock, not swim lane/heat/split telemetry), the swim-specific parser is net-new but SHOULD:
1. Live in `packages/scoreboard-cts` alongside the other decoders (same package, same "browser-only, no Node APIs" constraint lifted for the pure-function parser since Part 2's core parser must be Node-testable in Jest — kept as a pure function with no I/O either way, so it works in both contexts).
2. Reuse `sports-feed-token.ts` verbatim for auth on the new ingest endpoint.
3. Add a sibling endpoint next to `cts-snapshot` in `sports-board.controller.ts` (e.g. `POST :id/swim-timing-snapshot`).
4. Write through the existing `results` / `MeetResult` structured-stat path (`STRUCTURED_STAT_KEYS`) via the existing `updateStats` validation — NOT a new stats shape, NOT a new Prisma migration.
5. Mirror `ingestCtsSnapshot`'s sampled AuditLog pattern.

Full agent transcript (if this file's summary needs re-verification): `/private/tmp/claude-501/-Users-gschiemann-Desktop-EDU-CMS/4129bcd1-4636-4065-90ea-207bae54cd20/tasks/a8ca75031c4109d7a.output`.
