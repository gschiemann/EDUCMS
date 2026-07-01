# Swim/Dive DEPTH build — status report

**Date:** 2026-07-01
**Branch:** `worktree-agent-af977bf281d0b326d` (worktree `.claude/worktrees/agent-af977bf281d0b326d`)
**Spec:** `docs/research/2026-06-30-swim-dive-scoreboards/00-REPORT.md`

## Part 1 — Widgets (frontend)

All four widgets built, registered, dispatched, and made editable — same pattern as the existing `SWIM_LANE_GRID` / `DIVE_LEADERBOARD`.

| Widget | File | Status |
|---|---|---|
| `SWIM_RELAY_EXCHANGE` | `apps/web/src/components/widgets/sports/SwimDiveWidgets.tsx` | DONE |
| `SWIM_SPLITS_PANEL` | same file | DONE |
| `SWIM_RECORD_LINE` | same file | DONE |
| `DIVE_JUDGES_PANEL` | same file | DONE |

Render-tree proof (CLAUDE.md rule #9):
- `apps/web/src/components/widgets/variants-register.ts` — all 4 `registerVariant()` calls (SPORTS vertical).
- `apps/web/src/components/widgets/WidgetRenderer.tsx` — all 4 `case` arms in `WidgetPreview`.
- `apps/web/src/components/template-builder/PropertiesPanel.tsx` — all 4 `case` arms with editable fields.
- `apps/web/src/components/widgets/themes/registry.ts` — added the 4 new `WidgetType` union members (this was the one real tsc break found; fixed).
- Mount confirmed: `grep -n '<VariantPicker' apps/web/src --include="*.tsx"` → `BuilderShell.tsx:722`.

Two new presets added to `apps/api/src/templates/sports-presets.ts`:
- `sports-swim-relay-board` (🏊 Swim Relay Exchange Board) — `SWIM_RECORD_LINE` stacked over `SWIM_RELAY_EXCHANGE`.
- `sports-dive-judges-board` (🤿 Diving Judges + Leaderboard Board) — `DIVE_JUDGES_PANEL` + `DIVE_LEADERBOARD` side by side.

Both confirmed inside `SPORTS_TEMPLATE_PRESETS` (consumed by `ensure-system-presets.ts`).

Jest render tests: `apps/web/src/components/widgets/__tests__/swim-dive-widgets.test.tsx` — 27/27 passing (12 pre-existing + 15 new), covering sample-data-when-not-live, operator overrides, drop-high/low math, and a `no inset shorthand` assertion per widget.

## Part 2 — CTS timing-console feed (backend)

**Key finding (persisted at `docs/research/2026-07-01-swim-dive-depth/01-cts-ingest-recon.md`):** a full CTS ingest pipeline already exists (`packages/scoreboard-cts`, `sports-feed-token.ts`, `POST :id/cts-snapshot`, `ingestCtsSnapshot`) — but it targets a DIFFERENT protocol (water polo's positional-7-segment / real channel-grid framing). `console-profiles.ts` explicitly lists `swimming` as a `CtsSport` "planned... not wired" value. So the swim LANE/PLACE/TIME protocol (report A7) was genuinely greenfield within an otherwise-mature package.

### Parser (pure, fully unit-tested)
`packages/scoreboard-cts/src/swim-timing.ts` — `SwimTimingParser` class + `parseCtsSwimPackets` pure framer, decoding the documented CTS scoreboard-serial byte map:
- `0x01-0x0A` lanes 1-10, `0x17-0x18` lanes 11-12: `[Lane][Place][Min][Sec][Hundredths]`.
- `0x0C` event & heat: `[EventHi][EventLo][Heat]` (hi*100+lo packing for 3-digit numbers).
- `0x0D` team scores: `[HomeHi][HomeLo][AwayHi][AwayLo]`.
- `0x19-0x1E` split times (6 channels): `[Lane][Min][Sec][Hundredths]`.
- `0xFF` in any numeric field = blank/idle (never rendered as 255).
- Resync-past-unknown-module framing (no checksum in this protocol, matching the real hardware's own daisy-chain "ignore what you don't own" behavior).
- Encode helpers (`encodeLanePacket`, `encodeSplitPacket`, `encodeEventHeatPacket`, `encodeTeamScorePacket`, `concatPackets`) mirror the water-polo package's `encodePacket`/`MockCtsFeed` convention — used by the Jest suite for round-trip proof without hardware.

Tests: `packages/scoreboard-cts/src/__tests__/swim-timing.test.ts` — 32/32 passing. Whole-package suite (pre-existing + new): 88/88 passing.

### Normalizer (pure, fully unit-tested)
`apps/api/src/sports/swim-timing-feed.ts` — `normalizeSwimSnapshot()` maps a decoded `SwimTimingSnapshot` + optional roster rows into the EXISTING `MeetResult`/`ResultEntry` shape:
- Joins lane → name/team via `RosterPlayer.stats.lane` (an additive JSON field read, NOT a schema change) when the operator has entered one; otherwise renders lane+time only — never fabricates a name (report A7/A5 explicit rule, proven by test).
- `formatSwimEventLabel` builds "EVENT 12 — HEAT 3" matching the rest of this repo's meet-sport event-label convention.
- `laneMark()` encodes the DQ inference: a blank lane only becomes "DQ" once the caller asserts `heatOver` — the parser itself has no DQ bit (real protocol doesn't either), so this is explicitly a normalizer-layer policy, proven separately from the decode.
- `mergeSwimResult()` replaces the same event/heat in place (live-updating heat) while keeping different heats as separate rows, capped at 64 (matches `sanitizeResults`' ceiling).
- `extractSwimTeamScore()` surfaces the dual-meet running score for the service to fold into plain scalar stats (`swimHomeScore`/`swimAwayScore`) — deliberately NOT a new structured-stat key.

Tests: `apps/api/src/sports/swim-timing-feed.spec.ts` — 20/20 passing, pure functions, no Prisma.

### Service + transport
- `SportsService.ingestSwimTimingSnapshot()` (`apps/api/src/sports/sports.service.ts`) — mirrors `ingestCtsSnapshot`'s auth/tenant-resolution (tenant-scoped when `auth.tenantId` present, public-token `findUnique` otherwise) and sampled-audit-log pattern (`SWIM_TIMING_SNAPSHOT_INGEST`), but writes ONLY into `Game.stats.results` via the EXISTING `sanitizeResults` gate — no score/segment write-through (swimming has no "operator column" equivalent for in-progress lane times), no new Prisma migration.
- `POST /api/v1/sports/board/:id/swim-timing-snapshot` (`apps/api/src/sports/sports-board.controller.ts`) — same stateless game-scoped HMAC feed-token auth (`sports-feed-token.ts`, reused verbatim) and the same 40-req/10s rate-limit pattern as `cts-snapshot`, keyed separately (`swim:${id}`) so a swim bridge and a water-polo bridge never share a bucket.
- Tests: 11 new integration tests appended to `apps/api/src/sports/sports.service.spec.ts` (empty-snapshot drop, lane-only write, roster join, same-heat replace, cross-heat accumulation, team-score fold, public-token path, 404 on unknown game, audit-log row, DQ inference both directions). Whole `src/sports` suite: 267/267 passing.

### What's live-verifiable vs. needs the physical console
- **Live-verifiable today (all done):** every byte-level decode rule, the framing/resync logic, the normalizer's join/merge/DQ policy, the service's persistence + auth + audit wiring — all proven against the DOCUMENTED protocol via encode/decode round-trip tests, exactly per the report's own recommended strategy ("the open Arduino/Python emulator packet shape... is how we prove correctness without the physical console").
- **Needs on-site verification:** the actual RS-232→LAN bridge box (browser-side `SwimTimingParser` wired into a `navigator.serial` reader, analogous to `CtsBridge.tsx`'s water-polo integration) was deliberately NOT built in this pass. `CtsBridge.tsx` is a 1500+ line, deeply water-polo-specific file (clock-running derivation, penalty sync, shot-clock slaving) and wiring a second sport into it is a substantial UI/hardware-integration task outside "the must" the mission scoped ("the parser + normalizer + tests are the must; live-hardware wiring is verify-on-site"). `console-profiles.ts`'s `CtsSport = 'water-polo' | 'swimming'` type already anticipates a `cts-swim` profile entry — that's the next concrete step, plus a `swim` `ConsoleDecoder` value and a browser bridge component mirroring `CtsBridge.tsx`'s structure but calling `SwimTimingParser` instead of `CtsParser`.

## Verification run (this pass)

```
rm -f apps/api/tsconfig.build.tsbuildinfo && pnpm --filter api exec tsc --noEmit --project tsconfig.build.json   → CLEAN (0 errors)
pnpm --filter web exec tsc --noEmit                                                                              → CLEAN (0 errors)
node apps/web/tools/check-taurus-safety.cjs                                                                       → OK, within baseline
apps/web: jest swim-dive-widgets.test.tsx                                                                         → 27/27
packages/scoreboard-cts: jest (whole package)                                                                     → 88/88
apps/api: jest src/sports (whole directory)                                                                       → 267/267
```

Note: the pre-existing `@cms/signage-design` / `@cms/scoreboard-cts` "Cannot find module" errors seen on a fresh `pnpm install` in this worktree were resolved by building those two workspace packages' `dist/` output (`npx tsc -p tsconfig.json` in each) — a read-only build step over another agent's already-committed source, not a source edit. Both `dist/` dirs are gitignored.
