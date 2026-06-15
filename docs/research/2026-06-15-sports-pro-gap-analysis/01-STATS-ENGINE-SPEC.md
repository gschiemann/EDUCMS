# Player-Stats / Records / Milestone Engine — LOCKED SPEC (2026-06-15)

Opus architect panel (data-model · computation · surfaces · imports → synthesis). NOTE 2026-06-15: DB is pre-customer (Greg) so Phase 2 may use the CLEAN schema (real Player/Team FKs) rather than the additive back-link below; re-lock additive+flags when a customer onboards. Full lens outputs: tasks/wfmqe5m56.output.

---

All four lenses are verified against the real code. Key confirmed facts that lock my conflict resolutions:

- `RosterPlayer` is per-game (`gameId` FK, `stats` Json of strings), schema comment explicitly invites "a future Team model can lift these up without a breaking change" — the DATA-MODEL lens's nullable `personId` back-link is the correct path.
- `setStatus(FINAL)` already fires a `status:final-*` CUE — the finalize hook slots in cleanly after the status write.
- `getBoardFresh` already ships `roster[]` with `stats` to every surface (SURFACES lens is right: leaders can be computed with zero new fetch).
- `CTS_CINEMATIC_CUE_IDS` (line 89) + `record(id,'CUE',...)` + `cueSnapshot` + `CELEBRATION_MUTEX_MS` all exist exactly as claimed — milestone cinematics ride the existing path.
- POS connector keystone (`apps/api/src/pos/providers/registry.ts` + `creds-cipher.ts` `sealCredentials`) exists — IMPORTS lens's clone path is real.
- `FLAGS` registry exists in both API and web with default-OFF env-fallback pattern.

Here is the locked spec.

---

# LOCKED SPEC — Sports Player-Stats / Stat-Leaders / Player-of-the-Game / Season+Career Records / "NEW SCHOOL RECORD" Milestone Engine

## 0. Conflict resolutions (locked decisions)

The four lenses agree on ~85%. The disagreements, resolved:

| # | Conflict | Lenses | LOCKED decision |
|---|---|---|---|
| C1 | **Persistent identity model**: `SportsPerson`+`Team` (DATA) vs `Athlete`+`normalizedKey`+`teamName` string (COMPUTATION) | DATA wants a first-class lightweight `Team`; COMPUTATION wants no Team, key off the `Game.homeTeam`/`awayTeam` strings | **Adopt DATA's `SportsPerson` + lightweight `Team`**, but **defer `Team` to Phase 2** and make it nullable everywhere. COMPUTATION's `normalizedKey` is correct as the **dedup mechanism** — fold it into `SportsPerson` as a stored column. Net: persistent entity named **`SportsPerson`**, optional `teamId`, with a `normalizedKey` for CSV-reimport idempotency. Rationale: a real `Team` is needed for "school record across all Varsity Basketball seasons" record-scoping; `teamName` strings can't scope records reliably. |
| C2 | **Aggregation trigger**: on-FINAL only (DATA) vs FINAL + a new live-delta per-stat endpoint (COMPUTATION) | COMPUTATION wants `recordPlayerStatDelta` to fire milestones *live, mid-game* | **Phase-split.** FINAL-only is the locked V1 path (DATA). The live-delta milestone (the "1,000th point AS IT HAPPENS") is **Phase 3b, opt-in**, because it requires operators to enter per-player stats live — extra workload the water-polo pilot won't do. Ship the emotional peak at FINAL first; add live-delta only after aggregation is trusted. |
| C3 | **Milestone fire mechanism** | All three (DATA/COMPUTATION/SURFACES) agree: write a `record(id,'CUE',{...})` + add a milestone id to `CTS_CINEMATIC_CUE_IDS` | **Locked as agreed.** New cue id **`CEL_MILESTONE_RECORD`** (+ `CEL_MILESTONE_CAREER`), reusing `TrWorldRecordWidget`. No new realtime plumbing. |
| C4 | **Stat semantics location** | DATA: `PLAYER_STAT_META` + extend `SportStatField`; COMPUTATION: `STAT_SEMANTICS` + `parseStatValue` + `CAREER_THRESHOLDS` | **Merge into ONE Phase-0 api-types addition.** Single export `STAT_SEMANTICS: Record<sport, StatSemantic[]>` (COMPUTATION's name) carrying `{key, kind:'counting'|'rate', higherBetter, decimals?}`; plus `parseStatValue()`, `CAREER_THRESHOLDS`, and the `MILESTONE_DEFS` seed map. Do **NOT** mutate `SportStatField` (it's the operator stat-entry control contract; adding agg fields there risks the live console). Keep semantics a **sibling** map. |
| C5 | **Leaders on the hot poll?** | SURFACES: yes, inside the 1s board cache, omit-when-empty; DATA: no, separate endpoint | **Both, by phase.** Phase 1 leaders ride `getBoardFresh` (SURFACES) because they're computed from the already-loaded `roster[]` — zero extra query, gated + omitted-when-empty. Season/career **leaderboards** (cross-game) get a **separate authed endpoint** (DATA) — never on the 750ms poll. |
| C6 | **First shippable IMPORT slice** | IMPORTS: GameChanger CSV-export importer (no partner-API dep) as Slice 0 | **Adopt.** The CSV importer reuses existing `importRosterCsv` and proves the persistent schema end-to-end with zero external dependency. It's the Phase 4 entry point, not a blocker for Phases 1-3. |
| C7 | **Identity table name** | `SportsPerson` (DATA) vs `Athlete` (COMPUTATION) vs `SeasonPlayer` (IMPORTS) | **`SportsPerson`** is the persistent human. **`SeasonPlayer`/`SeasonStat`** (IMPORTS) are folded into DATA's `PlayerSeasonStat` — one materialized aggregate table, not two parallel schemas. |
| C8 | **`finalizeGameStats` failure mode** | COMPUTATION: try/catch fail-open, run AFTER status commit, own `$transaction` | **Locked as agreed — load-bearing.** A stats/milestone bug must NEVER block the operator's "end game" click. Finalize runs post-commit, wrapped in try/catch + `withDbRetry`, in its own transaction. |

**Universal invariants (all phases):**
1. **Additive-only.** Zero `DROP`, zero `ALTER COLUMN … SET NOT NULL`, zero rename on any existing table. Every new column nullable. Migrations via `prisma migrate dev --create-only` (uses `DIRECT_URL`); **lead eyeballs the generated SQL** for forbidden statements before apply, then applies on merge.
2. **Flag-gated default-OFF.** Two flags: `sports_player_stats` (the engine) and `sports_records_milestones` (the emotional-peak sub-feature). Both default-OFF for pilot tenants. Flag-OFF path is **byte-identical** to today's payload (omit keys, don't send nulls; skip all compute).
3. **`tenantId`-scoped on every model + every query.** `@@unique` always `tenantId`-first.
4. **Fail-open.** No stats/records/milestone code may throw on the live game path.
5. **Per-eventId / dedupe-key replay defense** on milestone firing (mirrors Standard Audit Surface §1).

---

## PHASE 0 — Stat semantics in api-types (ships independently, zero DB risk)

**Why first:** every later phase needs to know whether `PTS` sums and `AVG` doesn't, and how to parse `".312"` / `"1:52.31"` / `"142-06"`. Pure types-package addition, nothing reads it yet, reviewable on its own, zero pilot risk.

### Deliverables
- Extend `packages/api-types/src/sports.ts` (NEW exports, no mutation of existing types):
  ```ts
  export interface StatSemantic {
    key: string;                          // matches PLAYER_STATS entries
    kind: 'counting' | 'rate';            // sum vs recompute-from-components
    higherBetter: boolean;                // false: golf STR, race TIME
    decimals?: number;                    // display precision
    timeMark?: boolean;                   // '1:52.31' → centiseconds parse
  }
  export const STAT_SEMANTICS: Record<string, StatSemantic[]>;  // 1 row per PLAYER_STATS key, all 18 sports
  export function parseStatValue(raw: string | number, sem?: StatSemantic): number | null; // null on unparseable
  export const CAREER_THRESHOLDS: Record<string, Record<string, number[]>>; // basketball.PTS=[500,1000,1500,2000,2500,3000]
  export interface MilestoneDef { sport: string; statKey: string; kind: 'THRESHOLD'|'RECORD'|'NTH'; threshold?: number; label: string; cueKey: string; emoji?: string; }
  export const MILESTONE_DEFS: MilestoneDef[];  // seeded defaults, all 18 sports
  ```
- Add flag keys (default-OFF) to **both** registries:
  - `apps/api/src/feature-flags/feature-flags.service.ts`: `SPORTS_PLAYER_STATS: 'sports_player_stats'`, `SPORTS_RECORDS_MILESTONES: 'sports_records_milestones'`.
  - `apps/web/src/lib/feature-flags.ts`: same two keys, `FLAG_DEFAULTS[...] = false`, add the two `case` arms returning false.

### Owner / partition
- **Agent P0-A** (sole owner): `packages/api-types/src/sports.ts` + a co-located `sports-semantics.spec.ts` unit test (parse + agg-classification across all 18 sports).
- **Agent P0-B** (sole owner, no file overlap): the two `feature-flags` files.

### Verification
- `pnpm --filter api-types build` + the new spec green (parse `".312"→0.312`, `"DNP"→null`, `"1:52.31"→11231` cs, `"142-06"→null`).
- Assert `STAT_SEMANTICS` has a row for **every** `PLAYER_STATS[sport][*]` key (test iterates the existing map — catches drift).
- `pnpm --filter web build` (flag arms compile).

### Pilot risk
**None.** Nothing reads these exports; flags default-OFF.

---

## PHASE 1 — In-game leaders + auto Player-of-the-Game from EXISTING per-game data (NO migration)

**Why this is the recommended first dispatch:** it is the literal answer to "does it show OUR players and their stats?" — computed entirely from the `roster[]` that `getBoardFresh` **already ships**, with **zero schema change, zero migration, zero persistence**. Pure read over existing per-game data. Renders through the **already-shipped** `SpotlightBand` / `SpotlightLowerThird`. Smallest valuable slice; safest possible pilot footprint.

### Deliverables
1. **`computePlayerSurfaces(game, roster)` helper** (pure fn, new `apps/api/src/sports/sports-stats.service.ts`):
   - `leaders[]`: for each `PLAYER_STATS[sport]` key, the top roster player by `parseStatValue` (skip nulls, honor `higherBetter` from `STAT_SEMANTICS`).
   - `playerOfGame`: weighted per-sport score over the game's roster (weights table in `STAT_SEMANTICS`-adjacent const), returns `{name, number, team, photoUrl, headline, lines[]}` shaped for `SpotlightBand`.
2. **`getBoardFresh` payload delta** (`apps/api/src/sports/sports.service.ts` ~line 547 return): add OPTIONAL `leaders?`, `playerOfGame?`. Computed **only** when `await this.flags.isEnabledAsync(FLAGS.SPORTS_PLAYER_STATS, {tenantId: game.tenantId})`. **Omit keys entirely when flag-off or empty.** Compute inside the existing 1s board cache (runs once/sec/game, not per-viewer). No new DB query — reuse the `roster` already in the `Promise.all`.
3. **Board render** (`apps/web/src/app/board/[gameId]/page.tsx`): add a `{ kind: 'leaders' }` slot to the footer-rotation union; new `LeadersStrip` component (Taurus-safe: fixed px, longhand `top/right/bottom/left`, per-child margins, no `inset`/`gap`/`backdrop-filter`). Spotlight gate falls back to `playerOfGame` via `spotFromPotg()` **only when no manual spotlight is visible** (manual always wins).
4. **Stream parity** (`apps/web/src/components/sports/ScorebugSurface.tsx`): mirror the three new fields into its `BoardData` copy; `SpotlightLowerThird` falls back to `playerOfGame`; honor the `clean` feed flag.
5. **Console read-only tab**: `apps/web/src/app/[schoolId]/sports/[gameId]/LeadersPanel.tsx` beside `RosterPanel.tsx`; shows computed leaders; one-tap **"Spotlight this player"** reuses existing `PATCH games/:id/spotlight`. Tab hidden unless `isFeatureEnabled(FLAGS.SPORTS_PLAYER_STATS)`.

### Data contract delta
```ts
// getBoardFresh return (additive, omitted when flag-off/empty):
leaders?: Array<{ statKey:string; label:string; team:'home'|'away'; playerName:string; playerNumber:string|null; photoUrl:string|null; value:string }>;
playerOfGame?: { name:string; number:string|null; team:'home'|'away'; photoUrl:string|null; headline:string; lines:Array<{label:string;value:string}> } | null;
```
**No Prisma change. No migration.**

### File partition (parallel worktree agents)
| Agent | Files (sole owner) |
|---|---|
| **P1-A (service)** | `apps/api/src/sports/sports-stats.service.ts` (NEW) + the ~6-line `getBoardFresh` return delta + flag inject into `SportsService` constructor |
| **P1-B (board render)** | `apps/web/src/app/board/[gameId]/page.tsx` only (slot union, `LeadersStrip`, `spotFromPotg`, gate) |
| **P1-C (stream render)** | `apps/web/src/components/sports/ScorebugSurface.tsx` only (BoardData fields + lower-third fallback) |
| **P1-D (console)** | `apps/web/src/app/[schoolId]/sports/[gameId]/LeadersPanel.tsx` (NEW) + the one-line tab-strip mount in `[gameId]/page.tsx` |

> Note the soft seam: P1-B and P1-D both touch `[gameId]/page.tsx` (different files — board vs console; no conflict) and P1-D adds one import+mount line to the **console** page only. Lead merges P1-A first (defines the contract), then B/C/D.

### Flag
`sports_player_stats` (default-OFF).

### Verification
- **Payload-diff proof (load-bearing):** `curl /api/v1/sports/board/:id` with flag OFF before/after the change → byte-identical (the pilot-safety gate).
- Flag ON for a test tenant: Playwright screenshot of `/board/:id` showing the LeadersStrip rotating + POTG in the Spotlight; `/scorebug/:id` lower-third.
- WebKit smoke on the board (Rule #1) + Taurus grep (`inset`/`gap` scan) on `LeadersStrip`.
- Unit test `computePlayerSurfaces` across sample rosters per sport (ties, all-null stats, missing keys → no crash, empty leaders).

### Pilot risk
**Minimal.** The only mutation to a pilot surface is additive payload fields, gated + omitted-when-off, computed from already-loaded data inside the existing cache. Flag-OFF = byte-identical. The one real risk — leaders polluting egress — is killed by the 1s-cache + omit-when-empty + no-new-query design.

---

## PHASE 2 — Persistent SportsPerson + Team + season/career schema + finalize aggregation (additive migration)

**Why second:** turns "OUR players this game" into "OUR players this season + career." Lands the persistent spine and the materialized aggregates. Records/milestones (Phase 3) depend on trustworthy totals, so they MUST come after aggregation is proven.

### Deliverables
1. **7 new Prisma models** (all additive, `tenantId`-first, `--create-only`):
   - `SportsPerson` (persistent athlete; `normalizedKey` for CSV-reimport dedup; optional `teamId`; `externalRef` forward-hook for imports).
   - `Team` (program/squad — "Varsity Boys Basketball"; `isHome` drives "OUR players"; nullable everywhere).
   - `PlayerSeasonStat` (materialized; `@@unique([personId, season, statKey])`; `@@index([tenantId, sport, season, statKey, statValue(sort:Desc)])` powers leaderboards).
   - `PlayerCareerStat` (same shape, no season).
   - `StatRecord` (record book; `holderName` denormalized; `higherBetter` per record; `@@unique` record-slot).
   - `StatMilestoneDef` (seeded defaults `tenantId=null`; tenant rows shadow).
   - `PlayerMilestone` (fired ledger; `@@unique([personId, dedupeKey])` replay defense; `celebratedAt` latch).
2. **Additive nullable columns:**
   - `RosterPlayer.personId String?` + `RosterPlayer.teamId String?` + `@@index([personId])` — the back-link. **The ONLY change to a pilot-touching table.** Null = today's behavior exactly.
   - `Game.homeTeamId String?` + `Game.awayTeamId String?` (SetNull) — record-scoping attribution.
   - Tenant back-relations (relation-only, no column).
3. **`finalizeGameStats(tenantId, gameId)`** in `sports-stats.service.ts`: on `setStatus(FINAL)`, **AFTER the status commit, post-commit, try/catch fail-open, `withDbRetry` + own `$transaction`**: parse each linked `RosterPlayer.stats` (where `personId != null`) via `STAT_SEMANTICS`, upsert `PlayerSeasonStat`, recompute `PlayerCareerStat`. Idempotent (re-FINAL is a no-op via upsert).
4. **Identity linking:** `linkRosterPlayerToPerson(...)` (manual, OUR-team-only — opponents/typos never pollute the persistent table) + a "link to roster" console hook.
5. **Cross-game leaderboard endpoints** (NOT on the poll): `GET /sports/leaders?sport&season&statKey&scope&limit`, `GET /sports/athletes/:id/career`. Both flag-gated, `tenantId`-scoped, read the indexed aggregate rows.
6. **Seed `StatMilestoneDef`** from `MILESTONE_DEFS` (ensure-style, idempotent).

### File partition
| Agent | Files |
|---|---|
| **P2-A (schema)** | `packages/database/prisma/schema.prisma` (7 models + nullable columns) + the `--create-only` migration SQL (lead reviews/applies) |
| **P2-B (finalize + aggregation)** | `sports-stats.service.ts` (`finalizeGameStats`, `linkRosterPlayerToPerson`) + the ~3-line hook in `setStatus` after the status commit |
| **P2-C (endpoints)** | `sports.controller.ts` + `sports.service.ts` leader/career read methods |
| **P2-D (seed + console link UI)** | seed script + console "link to roster" hook (own files) |

### Flag
`sports_player_stats` (the aggregation only runs when ON **and** a person is linked).

### Verification
- **Migration SQL audit (load-bearing):** grep the generated SQL for `DROP|SET NOT NULL|DROP COLUMN` → must be empty. Confirm every `ADD COLUMN` is nullable.
- Finalize a test game with linked persons → assert `PlayerSeasonStat`/`PlayerCareerStat` rows; re-FINAL → no double-count (idempotency).
- Finalize with an **unparseable** stat → finalize swallows it, status write succeeds (fail-open proof).
- Clean tsc (`rm tsconfig.build.tsbuildinfo && tsc --noEmit`) on api before push.

### Pilot risk
**Low.** Two nullable columns + one index on `roster_players`; everything else is new tables. `finalizeGameStats` is post-commit + fail-open + flag-gated → the pilot's "end game" path is untouched when OFF, and cannot be wedged even when ON.

---

## PHASE 3 — Records + "NEW SCHOOL RECORD" milestone cinematics (the emotional peak, sub-flag)

**Why third:** records depend on trustworthy season/career totals (Phase 2). This is the competitive differentiator vs Daktronics/Nevco.

### Deliverables (Phase 3a — FINAL-time, locked V1)
1. **`StatRecord` population + record-break detection** inside the Phase-2 finalize transaction: compare just-finalized totals against `StatRecord` rows; on a break, update the record + `INSERT PlayerMilestone` (dedupe via `@@unique`).
2. **Milestone fire:** for each fired milestone, `record(id,'CUE',{ key:'CEL_MILESTONE_RECORD', label, emoji:'🏆', target:'ALL', auto:true, source:'milestone', scorerName, scorerNumber, scorerPhotoUrl, snapshot: cueSnapshot(updated) })`. Add `CEL_MILESTONE_RECORD` + `CEL_MILESTONE_CAREER` to `CTS_CINEMATIC_CUE_IDS` (line 89) **and** client `CUE_CATALOG` (`CtsRibbonWidgets.tsx`), pointing at `TrWorldRecordWidget`.
3. **`activeMilestone` board payload field** (flag-gated, omit-when-empty): `liveMilestones` query for `gameId` where `celebratedAt: null`; `celebratedAt` latch on play so it fires once.
4. **Console "Fire NEW RECORD" button** in `LeadersPanel` (manual override) via the existing `fireCue` launchpad path — so even before a record is auto-detected, an operator who knows a record fell can fire it.

### Deliverables (Phase 3b — live mid-game, opt-in, deferred-but-specced)
- `recordPlayerStatDelta(...)`: increments a player's live stat, computes would-be career total, fires the milestone CUE the instant a threshold crosses. Writes a provisional `PlayerMilestone` that finalize reconciles (idempotent on `@@unique`). Gated behind `sports_records_milestones` AND requires the operator to enter per-player stats live. **Build only after the pilot asks** — the water-polo first customer won't enter live per-player stats.

### File partition
| Agent | Files |
|---|---|
| **P3-A (detect+fire)** | `sports-stats.service.ts` (record/milestone detection in finalize) + the `record('CUE',...)` call |
| **P3-B (allow-set)** | `CTS_CINEMATIC_CUE_IDS` in `sports.service.ts` + `CUE_CATALOG` in `CtsRibbonWidgets.tsx` |
| **P3-C (board surface)** | `liveMilestones`/`activeMilestone` in `getBoardFresh` + render via `TrWorldRecordWidget` |
| **P3-D (console)** | "Fire NEW RECORD" button in `LeadersPanel.tsx` |

### Flag
`sports_records_milestones` (sub-flag; requires `sports_player_stats` ON).

### Verification
- Seed a record, finalize a game that breaks it → `CEL_MILESTONE_RECORD` CUE written; board plays it once; `celebratedAt` set; re-FINAL doesn't re-fire (dedup).
- The public cue-audit endpoint still validates `CEL_MILESTONE_RECORD` (it's in the allow-set) — no spurious-fire path.
- `CELEBRATION_MUTEX_MS` suppresses double-play within 10s.
- WebKit + Taurus smoke on the milestone cinematic.

### Pilot risk
**Low-moderate** — touches the live celebration path. De-risked by: sub-flag default-OFF, DB-layer dedup (multi-replica safe — not in-memory), fire-via-authed-`fireCue`-only, and the existing mutex. The "game-one for a new program floods NEW RECORD" risk → **records start empty and accumulate from flag-on forward; no auto-backfill** (lead-runs opt-in backfill in Phase 4).

---

## PHASE 4 — GameChanger/MaxPreps import (kills the manual-entry objection)

**Why last:** depends on the persistent `SportsPerson`/`PlayerSeasonStat` spine (Phase 2) as the hydration target. Cloned from the verified POS connector keystone.

### Deliverables
- **Slice 4a (no partner dep):** GameChanger **CSV-export importer** reusing `importRosterCsv` → upserts `SportsPerson` + `PlayerSeasonStat`. Proves the import path with zero external API.
- **Slice 4b:** `SportsConnector` registry (clone of `apps/api/src/pos/providers/registry.ts`) + `SportsProviderConnection` table (clone of `PosProviderConnection`, sealed creds via `creds-cipher.ts` `sealCredentials`) + `gamechanger.ts` adapter (dark-launch until partner creds arrive) + OAuth callback (clone `pos-oauth.controller.ts`, CSRF state enforced) + `sports-sync.cron.ts` (clone `pos-sync.cron.ts`, short-circuits on flag before any query → zero pilot DB load when OFF).
- **Slice 4c:** MaxPreps partner-feed connector (schedule + roster); `ScheduledGame` → promote to `Game` via `linkedGameId`.
- **Slice 4d:** flip `discovery.service.ts` GameChanger/MaxPreps from `COMING_SOON` to real `connectHref`; SUPER_ADMIN dry-run backfill script for historical records.

### Models (additive)
`SportsProviderConnection`, `SportsImportCursor`, `ScheduledGame`. `SeasonPlayer`/`SeasonStat`/`SportsTeam` from the IMPORTS lens are **NOT** separate tables — imports hydrate the Phase-2 `SportsPerson`/`PlayerSeasonStat`/`Team` directly (one schema, no parallel identity).

### Flag
`sports_player_stats` (imports gated; cron short-circuits on flag before any query).

### Verification
Connect a test tenant → import → assert `SportsPerson`/`PlayerSeasonStat` rows; cron OFF-tenant adds zero queries (log-assert); SSRF-safe `safeFetch` for any scrape fallback; `tenantId`-first `@@unique` prevents cross-tenant collision on global external IDs.

### Pilot risk
**Low** — all new tables + one cron that no-ops when flagged off. GameChanger partner-API gating de-risked by shipping the CSV importer (4a) first.

---

## RECOMMENDED PHASE 1 — tightly scoped, dispatch-ready NOW

Dispatch **Phase 0 + Phase 1 together** as a 6-agent worktree fleet (Phase 0 has no DB risk and unblocks Phase 1's `STAT_SEMANTICS`/`parseStatValue` dependency). Lead merges P0 first, then P1-A (contract), then P1-B/C/D.

**Scope (locked, no migration, no persistence):**
- **P0-A** — `packages/api-types/src/sports.ts`: add `StatSemantic`, `STAT_SEMANTICS` (all 18 sports), `parseStatValue`, `CAREER_THRESHOLDS`, `MILESTONE_DEFS` + `sports-semantics.spec.ts`. Do NOT mutate `SportStatField`.
- **P0-B** — both `feature-flags` files: add `SPORTS_PLAYER_STATS` + `SPORTS_RECORDS_MILESTONES`, default-OFF, env-fallback + web `case` arms.
- **P1-A** — `apps/api/src/sports/sports-stats.service.ts` (NEW: `computePlayerSurfaces` pure fn — leaders + weighted POTG) + the ~6-line `getBoardFresh` return delta (flag-gated, omit-when-off, **no new DB query**, computed in the 1s cache) + flag inject into the `SportsService` constructor.
- **P1-B** — `apps/web/src/app/board/[gameId]/page.tsx`: `{kind:'leaders'}` footer slot + Taurus-safe `LeadersStrip` + `spotFromPotg` Spotlight fallback (manual spotlight always wins).
- **P1-C** — `apps/web/src/components/sports/ScorebugSurface.tsx`: mirror the 2 new `BoardData` fields + `SpotlightLowerThird` POTG fallback honoring `clean`.
- **P1-D** — `apps/web/src/app/[schoolId]/sports/[gameId]/LeadersPanel.tsx` (NEW) + one mount line in the console `[gameId]/page.tsx`; read-only leaders + "Spotlight this player" via existing `PATCH spotlight`.

**Ground rules baked into every prompt:** worktree isolation (`isolation: "worktree"`); no edits outside your owned file(s); flag default-OFF; flag-OFF payload must be byte-identical (omit keys, never send nulls); Taurus-safe (longhand `top/right/bottom/left`, no `inset`/`gap`/`backdrop-filter`) on any board surface; return the branch name, don't push.

**Single acceptance gate (the 30-second happy path):** flag ON for a test tenant, operator opens `/board/:id` for a game with a roster → OUR players' stat leaders rotate in the footer and the top performer appears in the Spotlight, with **zero typing and zero migration**. Flag OFF → `curl` payload diff byte-identical to today.

**Files verified to exist (anchors for the fleet):** `apps/api/src/sports/sports.service.ts` (`getBoardFresh` L432, return L530-575, `roster` already in payload), `apps/web/src/app/board/[gameId]/page.tsx` (SpotlightBand), `apps/web/src/components/sports/ScorebugSurface.tsx` (SpotlightLowerThird), `apps/web/src/app/[schoolId]/sports/[gameId]/RosterPanel.tsx`, `apps/api/src/feature-flags/feature-flags.service.ts` (FLAGS L5), `apps/web/src/lib/feature-flags.ts` (FLAGS L3 / FLAG_DEFAULTS L16), `packages/api-types/src/sports.ts` (PLAYER_STATS L1140, SportStatField L24).