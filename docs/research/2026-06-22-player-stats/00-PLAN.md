# Player season-stats — complete the engine (2026-06-22)

> Greg: record player stats so they can access them after games + accumulative season stats; "investigate what
> others do … finish the stats, that is even more critical." 7-agent investigation + benchmark
> (GameChanger / MaxPreps / Hudl / SportsEngine / Athletic.net / TeamSnap). Raw: `../2026-06-21-console-fit-redesign/stats-raw-workflow.json`.

## What ALREADY exists (we're COMPLETING, not rebuilding)
- 3-table identity model: `SportsPerson` (persistent athlete), `RosterPlayer.personId/teamId` (per-game link),
  `PlayerSeasonStat` + `PlayerCareerStat` (materialized aggregates, leaderboard index). schema.prisma 2159-2498.
- `finalizeGameStats` **IS wired** — fires post-commit in `setStatus()` on FINAL, idempotent, gated
  SPORTS_PLAYER_STATS; only LINKED rows aggregate; counting stats accumulate, rate stats stay per-game; career
  recomputed from season rows each finalize (self-heals). sports-stats.service.ts 569-733; sports.service.ts 3338-3358.
- `linkRosterPlayerToPerson` (find-or-create by normalizedKey within tenant+team) + POST roster/link route.
- `getAthleteCareer` + GET /sports/athletes/:id/career (JWT/RBAC).
- Per-game stat LINES persist forever (RosterPlayer rows) → a game log is reconstructable.

## The REAL gaps (what to build)
1. **No player/parent-facing surface** — getAthleteCareer is admin-only; a parent literally can't reach their kid's
   stats. (#1 gap vs every competitor.)
2. **Linking is a manual per-row-per-game chore** — `importRosterCsv` createMany's UNLINKED rows + never calls
   linkRosterPlayerToPerson; RosterPanel's "Linked" state is local-only (lost on refresh). So nothing accumulates.
3. **No game-log read** — RosterPlayer rows never read back into a chronological log.
4. **Season = bare calendar year** — winter sports (Dec–Mar) split across two season rows.

## Build — 4 additive slices (deploy auto-runs `prisma migrate deploy`, so additive nullable migrations are safe)
- **S0 — Auto-link at import + console echo (NO schema, safe, ships first).** importRosterCsv calls
  linkRosterPlayerToPerson per home row (try/catch per row; home only, never opponents; return matched/unmatched).
  RosterPanel reads `player.personId` from listRoster → real persistent "Auto-linked" state. *Adoption unlock —
  makes every finalize roll up for free.*
- **S1 — Public athlete profile (the access unlock; +2 nullable SportsPerson cols).** `isPublic` (default false) +
  `publicShareToken` (unguessable uuid). New `getPublicAthleteProfile` (404 when off, minimal PII). Public
  rate-limited route GET /sports/board/athletes/:token (clone the public board controller). Authed share toggle
  (POST/DELETE /sports/athletes/:id/share, SCHOOL_ADMIN+ /CONTRIBUTOR, AuditLog). New public page /athlete/[token]
  (clone the /board page shell): hero + career totals + season table + game-log accordion.
- **S2 — Game log read (NO schema).** getAthleteGameLog joins RosterPlayer→Game (date/opponent/result), newest 25.
- **S3 — Academic season (deriveSeason → YYYY-YY; optional Game.season col).** Ship before winter data accrues.

## Privacy (minors — central risk)
Off by default; capability TOKEN not id (no enumeration); instant revoke + rotate; minimal default payload (number/
position/photo/team/stats; name+gradYear only when shared); only LINKED rows aggregate (opponents/typos never
surface); rate-limited + AuditLog on every share toggle; authed coach reads unchanged. Recommend an explicit
operator confirm before first share-on.

## Verify per slice: tsc + the sports-stats jest specs + (S1) WebKit smoke on the public /athlete page + CI-green.
