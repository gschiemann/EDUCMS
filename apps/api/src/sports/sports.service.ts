import {
  Injectable,
  Logger,
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
  forwardRef,
  Inject,
  Optional,
} from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { wakeClockSweep } from './clock-wake';
import { wakeScheduleSweep } from './game-schedule-wake';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../realtime/redis.service';
import { TimeSyncService } from '../realtime/time-sync.service';
import { WebsocketSignerService } from '../security/websocket-signer.service';
import { SponsorsService } from './sponsors.service';
// 2026-05-26 — reused inside getBoard() to resolve the operator-
// picked scoreboard/ribbon/scorebug templates with parsed zone
// defaultConfig (Prisma stores it as a JSON string). Bundles the
// templates directly into the public /sports/board response so
// public surfaces don't have to fetch the auth-gated /templates/:id.
import { mapTemplate } from '../templates/templates.controller';
import {
  findSport,
  SPORTS,
  resolveRibbonPresets,
  sanitizeRibbonPresets,
  sanitizeRibbonSpeed,
  sanitizeRibbonScoreRepeat,
  STRUCTURED_STAT_KEYS,
  sanitizeStructuredStat,
  sanitizeResults,
  // K-12 lane A2 — the shared clock contract (packages/api-types/src/sports-clock.ts).
  clockAnchorMs,
  formatSportClock,
  gameClockExpiryMs,
  isGameClockExpired,
  isUntimedSegment,
  projectCountdownMs,
  projectGameClockMs,
  shotClockMode,
  // K-12 lane A3 — the game's bound rules profile (sports-rules.ts).
  defaultRulesProfile,
  findRulesProfile,
  maxSegment,
  overtimeLabel,
  parseGameRules,
  rulesProfilesForSport,
  segmentLengthMs,
  setFormatOf,
  setWinner,
  setsToWin,
  shortTimeoutKey,
  snapshotRules,
  sportForGame,
  teamBonus,
  teamFoulRules,
  timeoutAllocation,
  timeoutBanks,
  // K-12 lane A4 — THE result of a game (sports-result.ts, K12-F18).
  SET_SCORES_KEY,
  appendSetScore,
  finalCueKey,
  gameResult,
  // K-12 lane A4 — the postgame hold (sports-postgame.ts, K12-F37).
  POSTGAME_HOLD_OPTIONS_MINUTES,
  cleanPostgameHoldMinutes,
  postgameHoldMinutes,
} from '@cms/api-types';
import type { RulesProfile, SportDefinition } from '@cms/api-types';
import { SPONSOR_SPOT_SECONDS } from './sponsor.constants';
// SEC-007 (2026-09-04) — proof-of-play beacon provenance.
import { UNATTESTED, type BeaconAttestation } from './beacon-capability';
import {
  makeFeedToken,
  DEFAULT_FEED_TOKEN_TTL_SEC,
  MIN_FEED_TOKEN_TTL_SEC,
  MAX_FEED_TOKEN_TTL_SEC,
} from './sports-feed-token';
import {
  type ConsoleScope,
  consoleScopeOffered,
  makeConsoleToken,
  DEFAULT_CONSOLE_TOKEN_TTL_SEC,
} from './sports-console-token';
// 2026-07-01 swim/dive DEPTH pass — CTS SWIMMING scoreboard-serial ingest
// (docs/research/2026-06-30-swim-dive-scoreboards/00-REPORT.md part A7).
import type { SwimTimingSnapshot } from '@cms/scoreboard-cts';
import {
  normalizeSwimSnapshot,
  mergeSwimResult,
  extractSwimTeamScore,
  type SwimRosterEntry,
} from './swim-timing-feed';
// Phase 1-A player-stats engine — PURE leaders + player-of-the-game
// computed from the roster already in the board payload (no DB query).
import {
  STAT_ROLLUP_STATE,
  applyGameStatRollup,
  computeGameContribution,
  computePlayerSurfaces,
  hasLegacyFinalizeMarker,
  getStatLeaders,
  getAthleteCareer,
  getPublicAthleteProfile,
  linkRosterPlayerToPerson,
} from './sports-stats.service';
import { FeatureFlagsService, FLAGS } from '../feature-flags/feature-flags.service';
import { withDbRetry } from '../prisma/with-db-retry';
import type { Game, Prisma } from '@cms/database';
import {
  type FeedCursor,
  cleanFeedEnvelope,
  hasEnvelope,
  orderFeedPacket,
  parseFeedCursor,
  readFeedCursor,
} from './feed-order';
import {
  type CommandInput,
  type ResolvedCommandContext,
  type StateChange,
  SYSTEM_CLOCK_ACTOR,
  boundedForAudit,
  consoleTokenFingerprint,
  diffState,
  feedActor,
  planUndo,
  requestHash,
  resolveCommandContext,
} from './game-command';
import { ROSTER_PRIVACY_EVENT, parseRosterPrivacy } from './roster-privacy';
// K-12 launch program, lane B3 — the one gate every public output of student
// names and photos goes through (see ./student-privacy.ts).
import {
  StudentDirectory,
  loadStudentPolicy,
  publicCuePayload,
  publicLiveOverlayPayload,
  publicSpotlight,
  publicStats,
  publicStudentView,
  studentFlags,
  studentRosterPrivacy,
  type PublicStudentContext,
} from './student-privacy';
// Lane B4 — the same gate for student names TYPED into the bundled layouts.
import { redactTypedStudentNames } from './typed-student-names';

/**
 * VenueOS Sports — Sprint 13. The game engine service.
 *
 * Every game-control mutation is ONE COMMAND run by `runGameCommand`
 * (K-12 launch program, lane A1, 2026-09-26). Inside one database
 * transaction it:
 *   1. re-reads the game (tenant-scoped) and refuses a FINAL game unless the
 *      command is allowed there (K12-F13);
 *   2. updates the `games` row ONLY where `version` still equals the version
 *      it read, bumping it — a writer holding a stale read matches nothing and
 *      the whole command re-runs on the fresh row (K12-F12);
 *   3. appends its `game_events` rows (the forensic log + the celebration-cue
 *      feed the board polls), attributed to the command's actor (K12-F34);
 *   4. writes the command's AuditLog row (K12-F34) and, when the client sent a
 *      command id, the durable receipt a replay answers from (K12-F10).
 * All of it commits together or none of it does (K12-F11). Side effects that
 * are not rows — board-cache invalidation, the SYNC nudge, the FINAL hook —
 * run after the commit.
 *
 * Real-time delivery is the 750ms polling path on the public board
 * endpoint (with a 1s in-memory cache + per-write invalidation). There
 * is intentionally NO pub/sub fan-out for game-state events: an earlier
 * draft published a signed `game:<id>` message on every write, but
 * RedisService.psubscribe only listens on `tenant:* | group:* | device:*`,
 * so the signed message landed on the bus and died — theater, not
 * delivery. If a true WS-driven board lands later, register `game:*` on
 * the RedisService psubscribe list at THAT point (and verify the gate
 * with verifyWsHmac the way the broadcast bus does). Audit-Fix 2.
 *
 * THE CLOCK IS AN ANCHOR. We never tick on the server. `clockMs` is the
 * clock reading at `clockUpdatedAt`; `clockRunning` says whether it is
 * advancing. The board page derives the live displayed clock from those
 * three every frame. The only place the server computes a live value is
 * `pause`, which re-anchors `clockMs` to the current displayed reading.
 */

type ClockAction = 'start' | 'pause' | 'set' | 'reset';

const GAME_STATUSES = ['SCHEDULED', 'PRE_GAME', 'LIVE', 'HALFTIME', 'FINAL'];
const CUE_FEED_WINDOW_MS = 20_000;

// Inputs-wave SCHED (2026-08-10) — how far before scheduledAt an armed
// game's board goes up. A BAKED default, deliberately not a knob: "the
// board goes up 10 minutes before start" is the product sentence, and the
// console card derives its copy from this same constant via the auto-push
// GET (leadMs) so the number can never drift between code and UI.
const AUTO_PUSH_LEAD_MS = 10 * 60_000;

/** One screen's pre-push pointer state, captured at auto-push time so the
 *  FINAL revert can put back exactly what the screen showed before. */
type AutoPushSavedScreen = {
  screenId: string;
  prevGameId: string | null;
  prevSurface: string | null;
};

/** The resolved schedule-game-mode config for a game — the latest-wins
 *  AUTO_PUSH GameEvent payload, sanitized. */
type AutoPushConfig = {
  armed: boolean;
  screenIds: string[];
  surface: 'BOARD' | 'RIBBON' | 'SCOREBUG';
  savedState: AutoPushSavedScreen[] | null;
  pushedAt: string | null;
  /** K12-F37 — the postgame hold the table picked, minutes (null = the
   *  default, POSTGAME_HOLD_DEFAULT_MINUTES). */
  holdMin: number | null;
  /** K12-F37 — set while a finished game holds its result on the pushed
   *  screens: when the schedule sweep returns them (ISO). Game.autoPushAt
   *  carries the same instant as the sweep's claim predicate. */
  returnAt: string | null;
};

/** A Game row as the engine reads it (Prisma returns every column). */
type GameRow = Game;

/**
 * One pushed game snapshot (the generic feed and the operator's manual
 * ingest). Every field is optional. `session` / `seq` / `eventId` /
 * `occurredAt` are the ordering envelope (feed-order.ts, K12-F14).
 */
type FeedIngestDto = {
  homeScore?: number;
  awayScore?: number;
  clockMs?: number;
  clockRunning?: boolean;
  segment?: number;
  session?: string;
  seq?: number;
  eventId?: string;
  occurredAt?: number | string;
};

/** A snapshot's verdict: applied, or refused by the ordering rules and why. */
type FeedIngestOutcome = { game: GameRow; accepted: boolean; reason?: string };

/**
 * A command's compare-and-swap write matched nothing: another writer changed
 * the game (bumped its version) after this command read it. The runner
 * re-runs the whole command against the fresh row.
 */
class GameVersionConflict extends Error {
  constructor() {
    super('game changed underneath this command');
  }
}

/** How many times a command re-runs after losing a compare-and-swap. */
const MAX_COMMAND_ATTEMPTS = 5;

/** K12-F39 — a PENDING roll-up older than this lost its post-commit hook. */
const STAT_ROLLUP_PENDING_GRACE_MS = 30_000;
/** K12-F39 — after this many failed attempts a roll-up waits for an administrator. */
const STAT_ROLLUP_MAX_ATTEMPTS = 50;

/**
 * K12-F13 — the only commands a FINAL game accepts: the audited reopen, and a
 * repeated "end game" (a no-op). Everything else answers 409 GAME_FINAL.
 * Presentation that does not change the result (cues, overlays, scenes, the
 * ribbon, team names/colours) is not a game command and stays available.
 */
const FINAL_ALLOWED_COMMANDS: ReadonlySet<string> = new Set(['game.reopen', 'status.final']);

/** Is this the FINAL lock's refusal? */
function isGameFinalRefusal(err: unknown): boolean {
  if (!(err instanceof ConflictException)) return false;
  const body = err.getResponse() as { code?: unknown } | string;
  return typeof body === 'object' && body?.code === 'GAME_FINAL';
}

/** Everything a command body can do inside its transaction. */
interface GameCommandScope {
  readonly tx: any;
  readonly ctx: ResolvedCommandContext;
  readonly kind: string;
  /** The game as read inside this transaction, before any write. */
  readonly before: GameRow;
  /** The game after this command's latest write (=== before until it writes). */
  current(): GameRow;
  /** Compare-and-swap update of the game row; bumps `version`. */
  write(data: Record<string, unknown>): Promise<GameRow>;
  /** Append a GameEvent inside the transaction. */
  event(
    type: string,
    payload: Record<string, unknown>,
    opts?: { derived?: boolean },
  ): Promise<{ id: string; createdAt: Date }>;
  /** Every tracked field this command has changed so far (the undo record). */
  change(): StateChange;
  /**
   * Write an AuditLog row inside the transaction (after the body). A row
   * marked `sideEffect` (the auto-celebration a score triggered) records
   * something the command caused, not the command itself: the command still
   * gets its own attributed row carrying the state change.
   */
  audit(action: string, details?: Record<string, unknown>, opts?: { sideEffect?: boolean }): void;
  /** Run after COMMIT (fail-open). Not run for a rolled-back attempt. */
  after(fn: () => unknown): void;
}

/**
 * Board-payload normalization (2026-07-12 world-class audit, football P1):
 * fold the first-class `Game.possession` column into the returned
 * `stats.possession` so EVERY board/ribbon/widget reader sees one value,
 * regardless of which control wrote it (the run-bar arrow chip writes the
 * column; the football tray toggle also writes the column post-fix). The
 * column wins when set; otherwise the existing stats.possession is kept for
 * legacy rows written before the column existed. Pure + additive — a null
 * column on a game with no stats.possession leaves the blob untouched.
 */
function mirrorPossessionIntoStats(
  rawStats: unknown,
  possession: string | null | undefined,
): unknown {
  if (!rawStats || typeof rawStats !== 'object') {
    return possession ? { possession } : rawStats;
  }
  const stats = rawStats as Record<string, unknown>;
  const resolved = possession ?? (stats.possession as string | undefined);
  if (!resolved || resolved === stats.possession) return stats;
  return { ...stats, possession: resolved };
}

// ── CTS cue-fired audit — fabrication / inflation guards (Task D) ──
//
// /sports/board/:id/cts-cue-fired is intentionally PUBLIC and tokenless:
// the ONLY legitimate caller is the public ribbon render surface
// (apps/web/.../CtsRibbonWidgets.tsx `auditCueFire`), which resolves the
// gameId from the board URL and POSTs with no feed token. Because the
// endpoint feeds the sponsor proof-of-play report, an attacker who knows a
// public board game id could otherwise POST forged cue-fired events to
// inflate sponsor impression counts. We can't gate on the feed token
// without 401-ing the real caller, so we instead:
//   (a) VALIDATE the incoming cueId against the game's KNOWN cue set
//       (cinematic catalog ∪ sport celebration keys ∪ the game's custom
//       cues) — an unknown id is silently dropped, killing fabricated-id
//       inflation;
//   (b) DEDUP a given (cueId, team) within the client cooldown window so a
//       replay flood of one valid cue can't run the count up.
//
// CTS_CINEMATIC_CUE_IDS mirrors CUE_CATALOG in CtsRibbonWidgets.tsx — the
// fixed library of cinematic scene ids the orchestrator round-robins
// through (the dominant legitimate cueId namespace, e.g. CEL_SOCCER_GOLAZO
// fired in front of a sponsor banner). Keep this list in sync when a new
// CEL_* scene is added to the client catalog. Sport-specific celebration
// keys (goal/touchdown/…) and operator custom cues are resolved per-game
// at validation time, so only the catalog needs mirroring here.
const CTS_CINEMATIC_CUE_IDS: ReadonlySet<string> = new Set<string>([
  'CEL_SOCCER_GOAL', 'CEL_SOCCER_GOLAZO', 'CEL_SOCCER_FREEKICK', 'CEL_SOCCER_HATTRICK',
  'CEL_HOCKEY_GOAL', 'CEL_HOCKEY_HATTRICK', 'CEL_HOCKEY_POWERPLAY', 'CEL_HOCKEY_EMPTYNET',
  'CEL_SC_GOAL_RETRO', 'CEL_SC_GOAL_NEON', 'CEL_HK_GOAL_NEON', 'CEL_HK_GOAL_RETRO',
  'CEL_LX_GOAL', 'CEL_LX_BEHINDTHEBACK',
  'CEL_FOOTBALL_TOUCHDOWN', 'CEL_FOOTBALL_FIELDGOAL', 'CEL_BASKETBALL_BUZZER',
  'CEL_BASKETBALL_THREE', 'CEL_BASKETBALL_DUNK',
  // 2026-06-13 every-sport fix wave — baseball + pickleball cinematic scenes.
  'CEL_BASEBALL_HOMERUN', 'CEL_BASEBALL_GRANDSLAM', 'CEL_BASEBALL_STRIKEOUT', 'CEL_BASEBALL_DOUBLEPLAY',
  'CEL_PICKLEBALL_ACE', 'CEL_PICKLEBALL_WINNER', 'CEL_PICKLEBALL_GAMEWIN',
  // 2026-06-13 P2 parity wave — lacrosse save + meet-sport (track / swim / golf) cinematics.
  'CEL_LX_SAVE', 'CEL_TF_FIRSTPLACE', 'CEL_TF_RECORD', 'CEL_TF_PERSONALBEST',
  'CEL_SW_FIRSTPLACE', 'CEL_SW_RECORD', 'CEL_GOLF_HOLEINONE', 'CEL_GOLF_EAGLE', 'CEL_GOLF_BIRDIE',
]);
// Control cues the orchestrator / console can legitimately fire that are
// neither cinematic scenes nor per-sport celebration keys.
const CTS_CONTROL_CUE_IDS: ReadonlySet<string> = new Set<string>([
  'pregame-intro', 'horn',
]);
// Server-side mirror of the client CUE_COOLDOWN_MS (CtsRibbonWidgets.tsx):
// a given (cueId, team) is recorded at most once per this window so a
// replay flood of the same valid cue can't inflate proof-of-play counts.
const CTS_CUE_DEDUP_MS = 2_000;

@Injectable()
export class SportsService {
  private readonly logger = new Logger(SportsService.name);

  // Per-game AUTO-celebrate toggle cache. Default ON; hydrated once per
  // gameId from the latest AUTO_CELEBRATE GameEvent on first feed touch,
  // then updated in place by setAutoCelebrate. Keeps the feed hot path
  // (ingest, 1-10 pushes/sec) from re-reading the toggle on every push.
  // Per-process — a single Railway instance; a cold start re-hydrates from
  // the persisted event, so an operator's OFF survives a restart.
  private readonly autoCelebrateCache = new Map<string, boolean>();

  // Inputs-wave SCHED — per-game schedule-game-mode (auto-push) config
  // cache. Hydrated once per gameId from the latest AUTO_PUSH GameEvent,
  // then updated in place by every writer — same discipline as
  // autoCelebrateCache above. Writers that must never act on a stale copy
  // (the sweep, the FINAL hook, a scheduledAt edit) bypass it with
  // { fresh: true }. `null` = hydrated, game was never armed.
  private readonly autoPushCache = new Map<string, AutoPushConfig | null>();

  // `redis` + `signer` carry the signed SYNC nudge on the screen-push
  // paths (notifySync below — Inputs-wave SCHED). Game-STATE events still
  // have NO pub/sub fan-out (Audit-Fix 2 — see record() and the
  // class-level note): SYNC only tells players "reconcile your manifest
  // now", which is exactly what a scoreboard push/revert changes.
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly signer: WebsocketSignerService,
    @Inject(forwardRef(() => SponsorsService))
    private readonly sponsorsService: SponsorsService,
    // Phase 1-A — gates the player-stats surfaces (leaders / POTG) on
    // the board payload. FeatureFlagsModule is @Global() so this
    // resolves without listing it in SportsModule providers.
    private readonly flags: FeatureFlagsService,
    // K12-F17 — the server clock (RealtimeModule is @Global()). Optional so
    // a unit test (or a stripped module) runs on the replica's own clock.
    @Optional() private readonly timeSync?: TimeSyncService,
  ) {}

  // ── the server clock (K12-F17) ─────────────────────────────────

  /**
   * THE clock every game-clock anchor is written in (`clockUpdatedAt`, the
   * shot / play / penalty `at`, the feed and CTS liveness stamps) and every
   * `serverTime` sample a surface projects with is read from: TimeSyncService,
   * Redis-TIME aligned, so two replicas — and a deploy's old and new
   * containers — agree to about a millisecond (Frame-Locked Sync rule 3:
   * never raw Date.now() in a time response). Anchors and samples move to it
   * TOGETHER, which is the one way to change the clock domain without
   * injecting the replica-vs-Redis offset into every projected clock. With no
   * TimeSyncService it is the replica's own clock (single-replica behaviour).
   */
  serverTimeMs(): number {
    return this.timeSync ? this.timeSync.now() : Date.now();
  }

  private clockNow(): Date {
    return new Date(this.serverTimeMs());
  }

  // ── helpers ──────────────────────────────────────────────────

  /**
   * The SportDefinition a game RUNS, or 400 if the sport key is unknown.
   *
   * K12-F01 — for a game (anything carrying `sport` + `rules`) this is the
   * sport with the game's own bound rules snapshot applied (`sportForGame`,
   * @cms/api-types sports-rules.ts): NFHS basketball's four-minute overtime,
   * a volleyball match's format, a lacrosse profile's shot-clock options.
   * Every engine path reads rules through here, never from the base
   * catalog, so a later profile version can never reach a bound game. A bare
   * sport key (a game being created) resolves the base definition.
   */
  private sportOf(
    sportOrGame: string | { sport: string; rules?: unknown },
  ): SportDefinition {
    const def =
      typeof sportOrGame === 'string'
        ? findSport(sportOrGame)
        : sportForGame(sportOrGame);
    if (!def) {
      const key =
        typeof sportOrGame === 'string' ? sportOrGame : sportOrGame.sport;
      throw new BadRequestException(`Unknown sport "${key}"`);
    }
    return def;
  }

  /** Starting clock reading for a fresh game / a segment reset.
   *
   *  `stats` (the game's stats blob) may carry a per-game regulation
   *  length override — `stats.clockSegmentMs`, picked at game creation
   *  when the sport publishes `clock.segmentMsOptions` (water polo 7:00
   *  NFHS HS vs 8:00 NCAA). The override is honored ONLY when it matches
   *  one of the sport's published options, so a corrupted/foreign value
   *  can never produce a nonsense clock.
   *
   *  `segment` enables the overtime rules: past regulation a reset uses the
   *  rules' overtime length (NFHS basketball 4:00, water polo 3:00) or their
   *  finite overtime sequence (NFHS wrestling 1:00, 0:30, 0:30, 0:30); a
   *  profile with per-period lengths (junior-high wrestling 1:00, 1:30, 1:30)
   *  uses the period's own. One implementation, shared with every surface:
   *  `segmentLengthMs` (@cms/api-types sports-rules.ts).
   */
  private segmentStartMs(
    def: SportDefinition,
    stats?: unknown,
    segment?: number,
  ): number {
    if (def.clock.type !== 'countdown') return 0; // countup starts at 0; "none" has no clock
    return segmentLengthMs(def, stats, segment);
  }

  /**
   * The live game-clock reading now, on the server clock — the same shared
   * projection (sports-clock.ts) every surface runs.
   */
  private liveClockMs(game: {
    clockMs: number;
    clockRunning: boolean;
    clockUpdatedAt: Date;
    sport: string;
    // K12-F01 — the bound rules decide the clock (NFHS soccer counts down).
    rules?: unknown;
  }): number {
    return projectGameClockMs(
      game,
      this.sportOf(game).clock.type,
      this.serverTimeMs(),
    );
  }

  /**
   * Append a game_events row + invalidate the board cache.
   *
   * Audit-Fix 2: real-time delivery is the 750ms polling path; no pub/sub
   * fan-out for game-state events. We previously signed every GAME_EVENT
   * and published to `game:<gameId>` — but RedisService.psubscribe only
   * listens on `tenant:* | group:* | device:*`, so the signed message
   * landed on the bus and DIED. The board cache is invalidated explicitly
   * on every write here, and the public board controller's 750ms poll +
   * 1s in-memory cache carries the data within a perceived sub-second.
   * (If a true WS-driven board lands later, add `game:*` to the
   * RedisService psubscribe list at THAT point — not before.)
   */
  private async record(gameId: string, type: string, payload: Record<string, unknown>) {
    const event = await this.prisma.client.gameEvent.create({
      data: { gameId, type, payload: payload as any },
    });
    // Lane-4 P0: every write to a game (cue/score/clock/penalty/segment/
    // ribbon) flows through this method — invalidate the board cache so the
    // next poll sees the change instantly instead of waiting up to 1s.
    this.invalidateBoardCache(gameId);
    return event;
  }

  /**
   * Nudge every player in the tenant to reconcile its manifest NOW — a
   * signed SYNC on the tenant channel, exactly the screens.controller
   * pattern (Inputs-wave SCHED). Without it a scoreboard push/revert
   * waits out the player's 30s reconcile poll — an armed "board up at
   * kickoff−10" would land up to half a minute late. Fail-open:
   * realtime is a latency optimization here; the manifest poll is the
   * backstop (and the Screen write already busted the manifest cache).
   */
  private async notifySync(tenantId: string) {
    try {
      const message = this.signer.signMessage('SYNC', { source: 'screen_update' });
      await this.redis.publish(`tenant:${tenantId}`, message);
    } catch {
      /* best-effort */
    }
  }

  /** Load a game scoped to its tenant, or 404. */
  private async owned(tenantId: string, id: string) {
    const game = await this.prisma.client.game.findFirst({
      where: { id, tenantId },
    });
    if (!game) throw new NotFoundException('Game not found');
    return game;
  }

  /** Public ownership assertion (controllers that need to gate on tenant
   *  ownership without otherwise touching the game, e.g. feed-credentials). */
  async assertGameOwned(tenantId: string, id: string): Promise<void> {
    await this.owned(tenantId, id);
  }

  /**
   * Run ONE game-control command (K-12 launch program, lane A1 — K12-F11 /
   * F12; see the class header for the whole contract).
   *
   * THE BUGS this closes. Game state is one row whose `stats` is a single JSON
   * blob, and commands read-modify-write it: the operator's taps, the ~5 Hz
   * CTS / swim / score feeds, the clock-expiry sweep. The 2026-07-03 stats-race
   * fix (withStatsTx, Serializable) covered five of those writers; everything
   * else still wrote whole blobs or absolute scores from a stale read — a clock
   * start erased a foul booked a moment earlier (K12-17), setting HOME's score
   * rewrote AWAY's from before a concurrent point (K12-18) — and every command
   * wrote its GameEvent / AuditLog in separate statements AFTER the state
   * write, so a failed event insert left the score changed with no record of
   * it (K12-11).
   *
   * THE FIX, per attempt, in one transaction:
   *   - re-read the game with the tenant predicate (a moved/foreign row reads
   *     nothing → NotFound);
   *   - `scope.write()` updates `WHERE id AND tenantId AND version = <read>`
   *     and bumps `version`. If another writer committed in between, that
   *     matches nothing (Prisma P2025) → GameVersionConflict → the WHOLE
   *     command re-runs against the fresh row (up to MAX_COMMAND_ATTEMPTS),
   *     so the loser merges on top of the winner instead of erasing it;
   *   - events / audit rows go through the SAME `tx`, so they commit with the
   *     state change or not at all;
   *   - `scope.after()` hooks run only after COMMIT.
   * An explicit compare-and-swap works at READ COMMITTED and cannot be defeated
   * by a writer the old Serializable helper did not wrap; transient pool
   * errors are still retried by withDbRetry.
   *
   * SEC-009 (2026-09-05, carried over from withStatsTx): `tenantId` rides BOTH
   * the in-transaction read and the write. The outer `owned()` gate runs first
   * (a foreign or missing game 404s before a transaction opens); the two PUBLIC
   * feed-token ingests pass the row their token-authorized gate resolved, and
   * there the predicate asserts the row has not moved tenants since.
   */
  private async runGameCommand<R>(
    tenantId: string,
    gameId: string,
    kind: string,
    input: CommandInput,
    /** The command's request body — hashed into its receipt (K12-F10). */
    request: unknown,
    body: (scope: GameCommandScope) => Promise<R>,
    opts: { gate?: GameRow | null; label?: string } = {},
  ): Promise<R> {
    const ctx = resolveCommandContext(input);
    if (!opts.gate) await this.owned(tenantId, gameId);
    const label = opts.label ?? `sports.${kind}`;
    const hash = ctx.commandId ? requestHash(kind, request ?? null) : null;

    for (let attempt = 1; ; attempt++) {
      const afterHooks: Array<() => unknown> = [];
      try {
        const value = await withDbRetry(
          () =>
            this.prisma.client.$transaction(
              async (tx: any) => {
                afterHooks.length = 0;
                const read: GameRow | null = await tx.game.findFirst({
                  where: { id: gameId, tenantId },
                });
                if (!read) throw new NotFoundException('Game not found');

                // K12-F10 — a command that already committed is answered from
                // its durable receipt, with NO second effect. Checked before
                // anything else so a replay of a command that landed before a
                // later refusal (a period change, FINAL) still gets its own
                // original answer instead of that refusal.
                if (ctx.commandId && hash) {
                  const prior = await tx.gameCommand.findUnique({
                    where: { gameId_commandId: { gameId, commandId: ctx.commandId } },
                  });
                  if (prior) {
                    if (prior.requestHash !== hash) {
                      throw new ConflictException({
                        code: 'COMMAND_ID_REUSED',
                        message: 'This command id was already used for a different request.',
                      });
                    }
                    return this.replayedResponse(prior.response, read) as R;
                  }
                }
                // K12-F13 — a FINAL game is locked. A late phone tap, a queued
                // op or a feed replay cannot change an official result; the one
                // way back is the named, audited reopen (reopenGame).
                if (read.status === 'FINAL' && !FINAL_ALLOWED_COMMANDS.has(kind)) {
                  throw new ConflictException({
                    code: 'GAME_FINAL',
                    message: 'This game is final. Reopen it to make a correction.',
                  });
                }
                // A queued command made in one period must not land in another
                // (stale-queue reconciliation, K12-F10): the client sends the
                // segment it saw when it made the command.
                if (ctx.expectedSegment !== null && read.segment !== ctx.expectedSegment) {
                  throw new ConflictException({
                    code: 'GAME_SEGMENT_CHANGED',
                    message: 'The game moved to another period since this was entered. Check it and enter it again.',
                    expectedSegment: ctx.expectedSegment,
                    currentSegment: read.segment,
                  });
                }

                // A private copy: the command's `before` (and the undo record
                // diffed from it) must not change when the row object the
                // client handed back is updated by this command's own write.
                const before: GameRow = {
                  ...read,
                  stats: read.stats && typeof read.stats === 'object' ? structuredClone(read.stats) : read.stats,
                };
                const scope = this.makeCommandScope(tx, ctx, kind, before, afterHooks);
                const result = await body(scope);
                await scope.flush();
                if (ctx.commandId && hash) {
                  await this.writeCommandReceipt(tx, scope, ctx, hash, result);
                }
                return result;
              },
              // Same headroom withStatsTx carried: the first statement on a
              // cold Supavisor connection can outlast Prisma's 5 s default.
              { timeout: 20000, maxWait: 10000 },
            ),
          { label },
        );
        for (const hook of afterHooks) {
          try {
            await hook();
          } catch (err) {
            this.logger.warn(
              `${label}: post-commit step failed (non-fatal) game=${gameId}: ${
                err instanceof Error ? err.message : String(err)
              }`,
            );
          }
        }
        return value;
      } catch (err) {
        if (err instanceof GameVersionConflict && attempt < MAX_COMMAND_ATTEMPTS) continue;
        if (err instanceof GameVersionConflict) {
          throw new ConflictException({
            code: 'GAME_BUSY',
            message: 'The game kept changing while this was being applied. Try again.',
          });
        }
        throw err;
      }
    }
  }

  /** Largest command response stored verbatim in a receipt. */
  private static readonly RECEIPT_RESPONSE_MAX_CHARS = 32_000;

  /**
   * K12-F10 — write the durable receipt of a command, inside its transaction.
   * The unique (game_id, command_id) key is what makes replay safe ACROSS
   * REPLICAS: two concurrent arrivals of one command both reach this insert,
   * one commits, and the other's P2002 aborts its whole transaction — which
   * then re-runs, finds this receipt, and answers from it. A command's
   * original response is kept (JSON-serialised exactly as the HTTP layer
   * would send it) unless it is unusually large, in which case a replay
   * answers with the game's current state instead.
   */
  private async writeCommandReceipt(
    tx: any,
    scope: GameCommandScope,
    ctx: ResolvedCommandContext,
    hash: string,
    result: unknown,
  ): Promise<void> {
    let response: unknown = null;
    try {
      const text = JSON.stringify(result ?? null);
      response =
        text.length <= SportsService.RECEIPT_RESPONSE_MAX_CHARS
          ? JSON.parse(text)
          : { $omitted: 'too-large' };
    } catch {
      response = { $omitted: 'unserialisable' };
    }
    const current = scope.current();
    try {
      await tx.gameCommand.create({
        data: {
          tenantId: current.tenantId,
          gameId: current.id,
          commandId: ctx.commandId,
          kind: scope.kind,
          requestHash: hash,
          actorType: ctx.actor.kind,
          actorUserId: ctx.actor.kind === 'user' ? ctx.actor.userId ?? null : null,
          actorRef: ctx.actor.ref ?? null,
          revisionBefore: typeof scope.before.version === 'number' ? scope.before.version : 0,
          revisionAfter: typeof current.version === 'number' ? current.version : 0,
          response: response as any,
        },
      });
    } catch (err) {
      // A concurrent twin committed the receipt first. This transaction is
      // now unusable (Postgres aborts it on the failed INSERT), so give up the
      // attempt: the retry reads the twin's receipt and replays it.
      if ((err as { code?: string } | null)?.code === 'P2002') throw new GameVersionConflict();
      throw err;
    }
  }

  /** What a replayed command answers: its stored response, or the current game. */
  private replayedResponse(stored: unknown, current: GameRow): unknown {
    if (stored && typeof stored === 'object' && '$omitted' in (stored as Record<string, unknown>)) {
      return current;
    }
    return stored;
  }

  /** The scope object handed to a command body (see GameCommandScope). */
  private makeCommandScope(
    tx: any,
    ctx: ResolvedCommandContext,
    kind: string,
    before: GameRow,
    afterHooks: Array<() => unknown>,
  ): GameCommandScope & { flush(): Promise<void> } {
    let current: GameRow = before;
    const audits: Array<{ action: string; details: Record<string, unknown>; sideEffect: boolean }> = [];
    const tenantId: string = before.tenantId;
    const gameId: string = before.id;
    const service = this;
    // Postgres CURRENT_TIMESTAMP is fixed for a whole transaction, so every
    // event of one command would tie on created_at and the undo rail would
    // list them in random order. Stamp each one explicitly, strictly
    // increasing, in the order the command wrote them.
    let lastEventAt = 0;
    const nextEventAt = () => {
      lastEventAt = Math.max(Date.now(), lastEventAt + 1);
      return new Date(lastEventAt);
    };
    return {
      tx,
      ctx,
      kind,
      before,
      current: () => current,
      async write(data: Record<string, unknown>) {
        // `version` is a NOT NULL column, so a real row always carries a number;
        // the guard only lets pre-revision test doubles (rows with no version)
        // run unchanged.
        const expected = typeof current.version === 'number' ? current.version : null;
        const where: Record<string, unknown> =
          expected === null ? { id: gameId, tenantId } : { id: gameId, tenantId, version: expected };
        try {
          current = await tx.game.update({
            where,
            // updatedAt on the SERVER clock (K12-F17): surfaces measure
            // commit-to-visible against it (K12-F40).
            data: { ...data, version: (expected ?? 0) + 1, updatedAt: service.clockNow() },
          });
        } catch (err) {
          if ((err as { code?: string } | null)?.code === 'P2025') throw new GameVersionConflict();
          throw err;
        }
        return current;
      },
      async event(type, payload, eventOpts) {
        const body = eventOpts?.derived ? { ...payload, derived: true } : payload;
        return tx.gameEvent.create({
          data: {
            gameId,
            type,
            payload: body as any,
            createdAt: nextEventAt(),
            // K12-F34 — who produced this event, in the same transaction.
            commandId: ctx.commandId,
            actorType: ctx.actor.kind,
            actorUserId: ctx.actor.kind === 'user' ? ctx.actor.userId ?? null : null,
            revision: typeof current.version === 'number' ? current.version : null,
          },
        });
      },
      change: () => diffState(before, current),
      audit(action, details = {}, auditOpts) {
        audits.push({ action, details, sideEffect: auditOpts?.sideEffect === true });
      },
      after(fn) {
        afterHooks.push(fn);
      },
      async flush() {
        // K12-F34 — every command a person drives (operator, scorekeeper
        // link — including an operator pushing a feed payload by hand) or
        // the server itself drives (clock expiry) leaves an immutable
        // AuditLog row in its own transaction, even when it wrote no
        // action-specific row. Machine feeds are attributed on their events
        // instead (actorType 'feed'): a 5 Hz console must not write five
        // audit rows a second.
        const changed = current !== before;
        if (!audits.some((a) => !a.sideEffect) && changed && ctx.actor.kind !== 'feed') {
          audits.unshift({ action: 'SPORTS_GAME_COMMAND', details: {}, sideEffect: false });
        }
        for (const a of audits) {
          await tx.auditLog.create({
            data: {
              tenantId,
              userId: ctx.actor.kind === 'user' ? ctx.actor.userId ?? null : null,
              action: a.action,
              targetType: 'Game',
              targetId: gameId,
              details: JSON.stringify(
                boundedForAudit({
                  ...a.details,
                  // The attribution every row carries: which command, from
                  // whom (actor kind + credential reference — a console link
                  // fingerprint, an API key, a feed, a worker), and the game
                  // revision it moved from/to.
                  command: {
                    kind,
                    commandId: ctx.commandId,
                    actorType: ctx.actor.kind,
                    actorRef: ctx.actor.ref ?? null,
                    revisionBefore: typeof before.version === 'number' ? before.version : null,
                    revisionAfter: typeof current.version === 'number' ? current.version : null,
                  },
                  change:
                    a.details.change ??
                    (changed && !a.sideEffect ? diffState(before, current) : undefined),
                }),
              ),
            },
          });
        }
        // Every committed command changes what a board shows.
        afterHooks.unshift(() => service.invalidateBoardCache(gameId));
      },
    };
  }

  /**
   * K12-F34 — an immutable AuditLog row inside the CALLER's transaction,
   * attributed to the actor (the user id when a person acted; the actor kind
   * and credential reference — console-link fingerprint, API key, feed,
   * worker — ride in `details.actor`).
   */
  private auditRow(
    tx: any,
    tenantId: string,
    actor: CommandInput,
    action: string,
    targetId: string,
    details: Record<string, unknown>,
    targetType = 'Game',
  ) {
    const ctx = resolveCommandContext(actor);
    return tx.auditLog.create({
      data: {
        tenantId,
        userId: ctx.actor.kind === 'user' ? ctx.actor.userId ?? null : null,
        action,
        targetType,
        targetId,
        details: JSON.stringify(
          boundedForAudit({ ...details, actor: { type: ctx.actor.kind, ref: ctx.actor.ref ?? null } }),
        ),
      },
    });
  }

  /**
   * K12-F34 — a non-command game action (a cue, an overlay, a scene, ribbon
   * configuration): its GameEvent and its AuditLog row commit TOGETHER, or
   * neither does. These used to write the event and then a best-effort audit
   * row that swallowed failures — a record of who did it could silently not
   * exist.
   */
  private async recordAudited(
    tenantId: string,
    gameId: string,
    type: string,
    payload: Record<string, unknown>,
    actor: CommandInput,
    action: string,
    details: (eventId: string) => Record<string, unknown>,
  ): Promise<{ id: string; createdAt: Date }> {
    const ctx = resolveCommandContext(actor);
    const event = await this.prisma.client.$transaction(async (tx: any) => {
      const ev = await tx.gameEvent.create({
        data: {
          gameId,
          type,
          payload: payload as any,
          actorType: ctx.actor.kind,
          actorUserId: ctx.actor.kind === 'user' ? ctx.actor.userId ?? null : null,
        },
      });
      await this.auditRow(tx, tenantId, actor, action, gameId, details(ev.id));
      return ev;
    });
    this.invalidateBoardCache(gameId);
    return event;
  }

  /**
   * K12-F34 — the audit row of a credential REVOCATION. The revocation has
   * already committed (killing a leaked credential must never wait on audit
   * storage), so a failure here cannot undo it — but it is never swallowed:
   * it is logged as an error naming the action and returned as `false` so the
   * caller can tell the operator the record is missing.
   */
  private async writeCredentialAudit(row: {
    tenantId: string;
    userId: string | null;
    action: string;
    gameId: string;
    details: Record<string, unknown>;
  }): Promise<boolean> {
    try {
      await this.prisma.client.auditLog.create({
        data: {
          tenantId: row.tenantId,
          userId: row.userId,
          action: row.action,
          targetType: 'Game',
          targetId: row.gameId,
          details: JSON.stringify(row.details),
        },
      });
      return true;
    } catch (err) {
      this.logger.error(
        `AUDIT WRITE FAILED for ${row.action} game=${row.gameId} tenant=${row.tenantId}: ${
          err instanceof Error ? err.message : String(err)
        } — the action itself completed`,
      );
      return false;
    }
  }

  // ── feed-token revocation (Sprint 13) ─────────────────────────
  //
  // The external score-feed token (sports-feed-token.ts) is a stateless
  // game-scoped HMAC. Game.feedTokenVersion is folded into the MAC so bumping
  // it instantly invalidates every outstanding token for the game. These two
  // methods are the read + increment paths.

  /**
   * The game's current feed-token version. UN-guarded (the PUBLIC board
   * controller calls this from the feed/cts-snapshot ingest, which has no
   * dashboard session). A missing game returns 0 — the caller's HMAC compare
   * fails anyway, and a non-existent game has no valid token. Selects only the
   * one integer column to keep this off the hot ingest path's cost.
   */
  async getFeedTokenVersion(gameId: string): Promise<number> {
    if (!gameId) return 0;
    // ten-ok: no caller tenant exists on this path. It is called by the PUBLIC
    // board controller's feed ingest BEFORE the token is verified, precisely to
    // learn which version to verify against — so there is nothing to scope to
    // yet. It returns a single non-secret integer and never mutates; an
    // attacker who guesses a game UUID learns only a revocation counter, and
    // still cannot forge a MAC over it. Scoping it is not possible without
    // first trusting an unverified caller-supplied tenant.
    const row = await this.prisma.client.game.findUnique({
      where: { id: gameId },
      select: { feedTokenVersion: true },
    });
    return row?.feedTokenVersion ?? 0;
  }

  /**
   * Revoke all outstanding feed tokens for a game by incrementing
   * Game.feedTokenVersion. Tenant-scoped (404 if the game isn't the caller's).
   * Returns the freshly-minted CURRENT token so the operator can immediately
   * re-copy working credentials to their vendor. Writes an immutable AuditLog
   * row (privileged action — Standard Audit Surface §16).
   */
  async revokeFeedToken(
    tenantId: string,
    gameId: string,
    actorUserId?: string,
  ): Promise<{
    success: true;
    feedTokenVersion: number;
    token: string;
    tokenExpiresAt: string;
    audited: boolean;
  }> {
    // Ownership gate (throws NotFound if the game isn't this tenant's).
    await this.owned(tenantId, gameId);

    const updated = await this.prisma.client.game.update({
      where: { id: gameId, tenantId },
      data: { feedTokenVersion: { increment: 1 } },
      select: { feedTokenVersion: true },
    });
    const version = updated.feedTokenVersion;

    // Immutable AuditLog row — who revoked the feed credential, and the new
    // version. K12-F34: a revocation must never be BLOCKED by audit storage
    // (killing a leaked credential comes first), so the row is written after
    // the bump — but a failure is never swallowed silently: it is logged as
    // an error and reported back (`audited: false`).
    const audited = await this.writeCredentialAudit({
      tenantId,
      userId: actorUserId || null,
      action: 'SPORTS_FEED_TOKEN_REVOKED',
      gameId,
      details: { feedTokenVersion: version },
    });

    // 2026-07-13 (audit W0-01.5): the replacement credential carries a TTL —
    // we no longer issue immortal bearer material anywhere. The operator can
    // mint a differently-scoped one via feed-credentials?ttlSeconds=…
    return {
      success: true,
      feedTokenVersion: version,
      token: makeFeedToken(gameId, { version, ttlSeconds: DEFAULT_FEED_TOKEN_TTL_SEC }),
      tokenExpiresAt: new Date(Date.now() + DEFAULT_FEED_TOKEN_TTL_SEC * 1000).toISOString(),
      audited,
    };
  }

  /**
   * Mint the game's current feed credential (Inputs-wave GUIDED, 2026-08-10).
   *
   * Extracted from the controller's GET /sports/games/:id/feed-credentials so
   * the mint gets the SAME immutable-AuditLog treatment revokeFeedToken above
   * already has — the mint response IS a live write credential for a public
   * scoreboard (AUTHZ-01), so handing it out is a privileged action (Standard
   * Audit Surface §16) and must leave a forensic row. Details carry only the
   * token's METADATA (version / ttl / expiry) — NEVER the token itself.
   *
   * Tenant-scoped (404 if the game isn't the caller's). Minting is stateless
   * (no version bump) — re-opening the setup card just re-issues an
   * equivalent credential at the current version.
   */
  async mintFeedCredentials(
    tenantId: string,
    gameId: string,
    actorUserId?: string,
    ttlSecondsRaw?: string,
  ): Promise<{
    token: string;
    tokenTtlSeconds: number;
    expiresAt: string;
    feedTokenVersion: number;
  }> {
    // Ownership gate (throws NotFound if the game isn't this tenant's).
    await this.owned(tenantId, gameId);

    const feedTokenVersion = await this.getFeedTokenVersion(gameId);
    const requested = Number(ttlSecondsRaw);
    const tokenTtlSeconds =
      Number.isFinite(requested) && requested > 0
        ? Math.min(MAX_FEED_TOKEN_TTL_SEC, Math.max(MIN_FEED_TOKEN_TTL_SEC, Math.floor(requested)))
        : DEFAULT_FEED_TOKEN_TTL_SEC;
    const token = makeFeedToken(gameId, { version: feedTokenVersion, ttlSeconds: tokenTtlSeconds });
    const expiresAt = new Date(Date.now() + tokenTtlSeconds * 1000).toISOString();

    // Immutable AuditLog row — who was handed a live feed credential, at
    // which version, expiring when. The token itself must NEVER appear here.
    // K12-F34: written BEFORE the credential is returned and NOT best-effort
    // — if the row cannot be written, no credential leaves the server.
    await this.prisma.client.auditLog.create({
      data: {
        tenantId,
        userId: actorUserId || null,
        action: 'SPORTS_FEED_TOKEN_MINTED',
        targetType: 'Game',
        targetId: gameId,
        details: JSON.stringify({ feedTokenVersion, tokenTtlSeconds, expiresAt }),
      },
    });

    return { token, tokenTtlSeconds, expiresAt, feedTokenVersion };
  }

  // ── feed liveness stamp (Inputs-wave GUIDED, 2026-08-10) ──────
  //
  // `Game.stats.feed = { lastPacketAt, source, accepted }` is the shared
  // "is anything talking to this game?" heartbeat behind the guided
  // scoreboard-feed setup card's status row (Waiting for first packet… /
  // Receiving / stale). All THREE machine-ingest paths stamp it:
  //   - POST board/:id/feed                → source 'feed'  (ingest(), stampFeed)
  //   - POST board/:id/cts-snapshot        → source 'cts'   (ingestCtsSnapshot)
  //   - POST board/:id/swim-timing-snapshot→ source 'swim'  (ingestSwimTimingSnapshot)
  // Every stamp rides the ingest command's own compare-and-swap write (zero
  // extra writes, zero extra race surface). The generic /feed path stamps via
  // the throttle below — including on its no-op early-return, so an
  // idle-but-connected vendor heartbeat never looks dead on the pill.
  // The stamp changes at most once per FEED_STAMP_MIN_INTERVAL_MS on the
  // /feed path, so the board ETag (which hashes stats) is bumped at most
  // every 5s by an otherwise-idle feed — bounded, and irrelevant during
  // live play when the payload churns anyway.

  private static readonly FEED_STAMP_MIN_INTERVAL_MS = 5_000;

  /** Build the stats.feed stamp value. */
  private feedStamp(
    source: 'feed' | 'cts' | 'swim',
    accepted: boolean,
  ): Record<string, unknown> {
    // Server clock: the dashboard grades this stamp against `serverTime`.
    return { lastPacketAt: this.clockNow().toISOString(), source, accepted };
  }

  /**
   * Throttle gate: is a fresh stats.feed stamp worth a write? True when the
   * blob has no (parseable) stamp yet, or the previous one is older than
   * FEED_STAMP_MIN_INTERVAL_MS. Keeps a 4 Hz no-op heartbeat from hammering
   * the contended stats row — the pill only needs ~5s granularity.
   */
  private feedStampDue(stats: unknown, now: number): boolean {
    if (!stats || typeof stats !== 'object') return true;
    const f = (stats as Record<string, unknown>).feed;
    if (!f || typeof f !== 'object') return true;
    const t = Date.parse(String((f as Record<string, unknown>).lastPacketAt));
    if (!Number.isFinite(t)) return true;
    return now - t > SportsService.FEED_STAMP_MIN_INTERVAL_MS;
  }

  // ── scorekeeper console share-link (Phase-2 Domain SHARE) ─────
  //
  // The console share token (sports-console-token.ts) hands a student/
  // volunteer LIMITED in-game control (score / clock / segment / timeouts /
  // celebration cues ONLY) via a revocable /console/<token> link + QR — no
  // tenant account. Game.consoleTokenVersion is folded into the MAC so
  // bumping it revokes every outstanding link. Deliberately a SEPARATE
  // counter from feedTokenVersion (revoking a scorekeeper never kills a
  // vendor feed credential, and vice versa).

  /**
   * The minimal game facts the PUBLIC console controller needs per request:
   * the live consoleTokenVersion for the MAC check, the tenantId to scope
   * the delegated SportsService calls, and the small public identity block
   * the /session endpoint returns (all of it already public via GET
   * /sports/board/:id). UN-guarded — the caller has no session; the token
   * MAC (checked by the controller against consoleTokenVersion) is the
   * auth. Missing game → null (the controller 401s without distinguishing
   * "no such game" from "bad token" — no existence oracle).
   */
  async getConsoleShareMeta(gameId: string): Promise<{
    tenantId: string;
    consoleTokenVersion: number;
    sport: string;
    status: string;
    homeTeam: string;
    awayTeam: string;
    // K12-F01 — the game's bound rules: a link's allowed actions, stat
    // bounds and shot-clock resets come from the rules the game runs.
    rules: unknown;
  } | null> {
    if (!gameId) return null;
    // ten-ok: identity-derived resolver for the scorekeeper share link. The
    // caller is a /console/<token> holder with NO account and therefore NO
    // tenant — this read IS how the tenant is discovered, and the controller
    // then feeds that tenantId into every delegated SportsService call, so a
    // console token can only ever drive its own game's tenant. Scoping the
    // read would require the tenant it exists to produce.
    const row = await this.prisma.client.game.findUnique({
      where: { id: gameId },
      select: {
        tenantId: true,
        consoleTokenVersion: true,
        sport: true,
        status: true,
        homeTeam: true,
        awayTeam: true,
        rules: true,
      },
    });
    return row ?? null;
  }

  /**
   * Mint a scorekeeper console share link for a game. Tenant-scoped (404 if
   * the game isn't the caller's). The token is minted against the game's
   * CURRENT consoleTokenVersion, always-expiring (default 24h, clamped in
   * sports-console-token.ts). Writes an immutable AuditLog row (privileged
   * action — this response is a WRITE credential, same posture as
   * feed-credentials). The token itself is deliberately NOT logged: an
   * AuditLog reader must never be able to drive the game.
   */
  async mintConsoleShare(
    tenantId: string,
    gameId: string,
    actorUserId?: string,
    ttlSeconds?: number,
    scope: ConsoleScope = 'full',
  ): Promise<{
    success: true;
    token: string;
    consoleTokenVersion: number;
    tokenTtlSeconds: number;
    expiresAt: string;
    scope: ConsoleScope;
  }> {
    const game = await this.owned(tenantId, gameId);
    // K12-F16 — a link that could do nothing for this sport is never handed
    // out (no clock operator for volleyball, no shot-clock link for soccer).
    // `full`, the mint default, is always mintable.
    if (!consoleScopeOffered(scope, game)) {
      throw new BadRequestException({
        code: 'CONSOLE_SCOPE_NOT_FOR_SPORT',
        message: `A "${scope}" scorekeeper link does not apply to this sport.`,
      });
    }
    const row = await this.prisma.client.game.findUnique({
      where: { id: gameId, tenantId },
      select: { consoleTokenVersion: true },
    });
    const version = row?.consoleTokenVersion ?? 0;
    const token = makeConsoleToken(gameId, { version, ttlSeconds, scope });
    // The REAL ttl after mint's clamp rides inside the token (4th field).
    const ttlSec = Number(token.split('.')[3]) || DEFAULT_CONSOLE_TOKEN_TTL_SEC;
    const iatSec = Number(token.split('.')[2]) || Math.floor(Date.now() / 1000);
    const expiresAt = new Date((iatSec + ttlSec) * 1000).toISOString();
    // K12-F34: written before the link is returned and NOT best-effort — no
    // audit row, no link. `linkFingerprint` is how every command this link
    // later drives (attributed `console-link:<fingerprint>`) is traced back to
    // who issued it; it is a one-way hash, never the token.
    await this.prisma.client.auditLog.create({
      data: {
        tenantId,
        userId: actorUserId || null,
        action: 'SPORTS_CONSOLE_SHARE_MINTED',
        targetType: 'Game',
        targetId: gameId,
        details: JSON.stringify({
          consoleTokenVersion: version,
          tokenTtlSeconds: ttlSec,
          expiresAt,
          scope,
          linkFingerprint: consoleTokenFingerprint(token),
        }),
      },
    });
    return {
      success: true,
      token,
      consoleTokenVersion: version,
      tokenTtlSeconds: ttlSec,
      expiresAt,
      scope,
    };
  }

  /**
   * Revoke every outstanding scorekeeper link for a game by incrementing
   * Game.consoleTokenVersion. Tenant-scoped. Unlike revokeFeedToken this
   * deliberately does NOT auto-mint a replacement — revoke means "kill the
   * links now"; the operator re-shares when they mean to. AuditLog row is
   * written best-effort, matching the rest of this service's audit writes.
   */
  async revokeConsoleShare(
    tenantId: string,
    gameId: string,
    actorUserId?: string,
  ): Promise<{ success: true; consoleTokenVersion: number; audited: boolean }> {
    await this.owned(tenantId, gameId);
    const updated = await this.prisma.client.game.update({
      where: { id: gameId, tenantId },
      data: { consoleTokenVersion: { increment: 1 } },
      select: { consoleTokenVersion: true },
    });
    const version = updated.consoleTokenVersion;
    // Revoke first (security); audit strictly after, never silently lost.
    const audited = await this.writeCredentialAudit({
      tenantId,
      userId: actorUserId || null,
      action: 'SPORTS_CONSOLE_SHARE_REVOKED',
      gameId,
      details: { consoleTokenVersion: version },
    });
    return { success: true, consoleTokenVersion: version, audited };
  }

  // ── reads ────────────────────────────────────────────────────

  /** Sport catalog — single source of truth lives in @cms/api-types. */
  listSports() {
    return SPORTS;
  }

  /** All games for a tenant, newest first. */
  async listGames(tenantId: string) {
    return this.prisma.client.game.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * The current operator-set ribbon messages — the payload of the most
   * recent RIBBON GameEvent. The ribbon scrolls these in place of the
   * default crowd prompts. No new table: RIBBON rides the generic
   * GameEvent log, latest-event-wins.
   */
  private async latestRibbonMessages(gameId: string): Promise<string[]> {
    const ev = await this.prisma.client.gameEvent.findFirst({
      where: { gameId, type: 'RIBBON' },
      orderBy: { createdAt: 'desc' },
    });
    const raw = (ev?.payload as Record<string, unknown> | undefined)?.messages;
    return Array.isArray(raw) ? raw.filter((m): m is string => typeof m === 'string') : [];
  }

  /**
   * The operator's stored ribbon preset config — the payload of the
   * most recent RIBBON_PRESETS GameEvent, or null when the reel has
   * never been configured. Rides the generic GameEvent log,
   * latest-event-wins — same pattern as RIBBON messages.
   */
  private async latestRibbonPresets(gameId: string): Promise<string[] | null> {
    const ev = await this.prisma.client.gameEvent.findFirst({
      where: { gameId, type: 'RIBBON_PRESETS' },
      orderBy: { createdAt: 'desc' },
    });
    if (!ev) return null;
    const raw = (ev.payload as Record<string, unknown> | undefined)?.presets;
    return Array.isArray(raw) ? raw.filter((m): m is string => typeof m === 'string') : [];
  }

  /**
   * The EFFECTIVE ribbon preset list for a game — the stored config,
   * or the sport's full default-on set when the reel was never
   * configured. The ribbon page and the control panel both consume
   * this resolved array, so neither has to special-case "no config".
   */
  private async ribbonPresetsFor(gameId: string, sportKey: string): Promise<string[]> {
    const def = findSport(sportKey);
    if (!def) return [];
    return resolveRibbonPresets(def, await this.latestRibbonPresets(gameId));
  }

  /**
   * The ribbon's scroll speed — the latest RIBBON_SPEED event,
   * normalized to a known speed, defaulting to 'normal'.
   */
  private async latestRibbonSpeed(gameId: string): Promise<string> {
    const ev = await this.prisma.client.gameEvent.findFirst({
      where: { gameId, type: 'RIBBON_SPEED' },
      orderBy: { createdAt: 'desc' },
    });
    return sanitizeRibbonSpeed((ev?.payload as Record<string, unknown> | undefined)?.speed);
  }

  /**
   * The operator's full-bleed ribbon image slides — the URL list
   * from the latest RIBBON_SLIDES event. Rides the generic
   * GameEvent log, latest-event-wins.
   */
  private async latestRibbonSlides(gameId: string): Promise<string[]> {
    const ev = await this.prisma.client.gameEvent.findFirst({
      where: { gameId, type: 'RIBBON_SLIDES' },
      orderBy: { createdAt: 'desc' },
    });
    const raw = (ev?.payload as Record<string, unknown> | undefined)?.slides;
    return Array.isArray(raw) ? raw.filter((m): m is string => typeof m === 'string') : [];
  }

  /**
   * How many times the score anchor repeats around the ribbon — the
   * latest RIBBON_SCORE event, normalized to a known value, default
   * 'auto'. A continuous full-bowl wrap repeats the score so it stays
   * readable from every seat. Rides the generic GameEvent log.
   */
  private async latestRibbonScoreRepeat(gameId: string): Promise<string> {
    const ev = await this.prisma.client.gameEvent.findFirst({
      where: { gameId, type: 'RIBBON_SCORE' },
      orderBy: { createdAt: 'desc' },
    });
    return sanitizeRibbonScoreRepeat((ev?.payload as Record<string, unknown> | undefined)?.repeat);
  }

  /**
   * One game, tenant-scoped — for the operator control surface.
   * Includes the current custom ribbon messages, the effective
   * preset config, the scroll speed, and the image slides so every
   * ribbon panel can pre-fill.
   */
  async getGame(tenantId: string, id: string) {
    const game = await this.owned(tenantId, id);
    const [ribbonMessages, ribbonPresets, ribbonSpeed, ribbonSlides, ribbonScoreRepeat, statRollup] =
      await Promise.all([
        this.latestRibbonMessages(id),
        this.ribbonPresetsFor(id, game.sport),
        this.latestRibbonSpeed(id),
        this.latestRibbonSlides(id),
        this.latestRibbonScoreRepeat(id),
        // K12-F39 — whether a final game's season roll-up has landed (read
        // only for FINAL games: the console polls this).
        game.status === 'FINAL' ? this.statRollupStatus(tenantId, id) : Promise.resolve(null),
      ]);
    return {
      ...game,
      ribbonMessages,
      ribbonPresets,
      ribbonSpeed,
      ribbonSlides,
      ribbonScoreRepeat,
      statRollup,
      // K12-F17 — a server-clock sample, so the operator console projects
      // the clock from SERVER time (it used to use the device's own clock:
      // a laptop two minutes fast showed the table a different clock from
      // the board). Same domain as every anchor — see serverTimeMs().
      serverTime: this.serverTimeMs(),
    };
  }

  // Lane-4 P0 — in-process board cache. The /board/:id endpoint polls at
  // 750ms × N viewers per game; each call fans out to 8 Prisma queries.
  // A 1-second TTL drops that hot path by ~99% (a 750ms-poll window crosses
  // at most one boundary). The cue feed advances by record() writing a new
  // GameEvent whose `id` the board dedups by — so a 1-second cache lag on
  // cue arrival is invisible (the next poll picks it up). Operator score
  // updates are similarly bounded to <1s perceived lag.
  //
  // Cache is invalidated explicitly on writes (record + game.update paths)
  // via invalidateBoardCache(); the TTL is the belt-and-suspenders.
  private boardCache = new Map<string, { ts: number; payload: any; etag: string }>();
  private static readonly BOARD_CACHE_TTL_MS = 1000;
  private invalidateBoardCache(gameId: string) { this.boardCache.delete(gameId); }

  /**
   * WEAK ETag for a board payload — computed ONCE per cache fill, over the
   * payload with the volatile per-request `serverTime` field EXCLUDED (same
   * rule as the manifest ETag: a per-request clock inside the hashed body
   * would rotate the tag every call and kill every 304). Deterministic from
   * content alone — one code path builds the object (stable key order) and
   * there is no per-replica salt — so every replica derives the same tag and
   * a poller can hop replicas without spurious 200s.
   *
   * WEAK (`W/"…"`) is load-bearing, not cosmetic (RFC 9110 §8.8.3): because
   * `serverTime` rides the body but is excluded from the hash, two responses
   * carrying the same tag are NOT byte-identical representations — a strong
   * tag would license a conforming shared cache to substitute an old stored
   * body on a 304 revalidation, freezing every poller behind it on a stale
   * clock sample. A weak tag promises only semantic equivalence, which is
   * exactly what this payload delivers. If-None-Match uses weak comparison
   * anyway (§13.1.2), so 304s behave identically.
   */
  private static boardEtag(payload: Record<string, unknown>): string {
    const { serverTime: _serverTime, ...hashed } = payload;
    return `W/"${createHash('sha1').update(JSON.stringify(hashed)).digest('hex').slice(0, 16)}"`;
  }

  /**
   * Public board view — by game id only, NOT tenant-scoped. Scoreboard
   * data (score, clock, team names) is inherently public: it is shown
   * on a stadium display. The id is an unguessable UUID. Returns the
   * raw clock anchor (board ticks locally) + the recent celebration
   * cue feed (board dedupes by event id and fires new ones).
   *
   * Lane-4 P0: response is memoized for BOARD_CACHE_TTL_MS so a 50-viewer
   * game serving the same payload for ~750ms hits the DB once, not 50×.
   */
  async getBoard(id: string) {
    return (await this.getBoardWithMeta(id)).payload;
  }

  /**
   * Trust wave (2026-08-06) — board payload + its ETag, for the public
   * controller's If-None-Match handling. Two rules:
   *   - The etag rides the cache entry (hashed once per fill, serverTime
   *     excluded — see boardEtag), so a cache hit costs zero hashing.
   *   - `serverTime` is per-REQUEST fresh: the cached copy bakes in a value
   *     up to BOARD_CACHE_TTL_MS stale, and boards compute clock skew from
   *     it, so every return overrides it via spread (never mutating the
   *     cached object — it is shared across concurrent pollers).
   *
   * CLOCK-DOMAIN INVARIANT: serverTime MUST share the clock domain of every
   * anchor it is subtracted against (`clockUpdatedAt`, the shot / play /
   * penalty `at`, the CTS and feed liveness stamps). K12-F17 moved the
   * anchors AND this sample to serverTimeMs() (TimeSyncService) together —
   * one without the other would inject the replica-vs-Redis offset straight
   * into every projected clock.
   */
  async getBoardWithMeta(id: string): Promise<{ payload: any; etag: string }> {
    const now = Date.now();
    let hit = this.boardCache.get(id);
    if (!hit || now - hit.ts >= SportsService.BOARD_CACHE_TTL_MS) {
      const fresh = await this.getBoardFresh(id);
      hit = { ts: now, payload: fresh, etag: SportsService.boardEtag(fresh) };
      this.boardCache.set(id, hit);
    }
    const serverTime = this.serverTimeMs();
    return { payload: { ...hit.payload, serverTime }, etag: hit.etag };
  }

  private async getBoardFresh(id: string) {
    // Lane-4 P0 fix: explicit `select` so this hot poll (every 750ms × N
    // viewers per game) only ships the fields the board actually consumes,
    // not every column on the row. Combined with the future ETag/cache layer
    // this measurably drops egress per game.
    //
    // ten-ok: this backs GET /sports/board/:id, which is a PUBLIC scoreboard —
    // an unauthenticated fan, an OBS browser source and an HDMI-driven board
    // all read it, and none of them has a tenant. The payload is deliberately
    // the public game facts (teams, score, clock) and the row's own tenantId is
    // what every downstream scope in this method derives from. There is no
    // narrower scope available, and adding one would break the public board.
    const game = await this.prisma.client.game.findUnique({
      where: { id },
      select: {
        id: true, tenantId: true, sport: true, status: true, segment: true,
        homeTeam: true, awayTeam: true, homeScore: true, awayScore: true,
        homeColor: true, awayColor: true, homeLogoUrl: true, awayLogoUrl: true,
        clockMs: true, clockRunning: true, clockUpdatedAt: true,
        startedAt: true, stats: true, spotlight: true,
        // 2026-07-12 world-class audit (football P1) — the first-class
        // Game.possession column was NEVER in this select, so it never
        // reached the board: `data.possession` was always undefined and every
        // surface silently fell back to stats.possession. That made the
        // run-bar possession-arrow chip (which writes ONLY the column) a
        // no-op on the board. Ship the column + mirror it into stats below.
        possession: true,
        scoreboardTemplateId: true, ribbonTemplateId: true, scorebugTemplateId: true,
        // K12-F40 — the revision the payload shows and when it was committed.
        version: true, updatedAt: true,
        // K12-F01 — the game's bound rules: every surface derives its
        // definition from them (sportForGame), so the board, ribbon and
        // scorebug show the periods, overtime, bonus and shot clock the game
        // actually runs.
        rulesProfile: true,
        rules: true,
      },
    });
    if (!game) throw new NotFoundException('Game not found');

    const since = new Date(Date.now() - CUE_FEED_WINDOW_MS);
    // 2026-05-26 — operator hit "template error http 401 on the cts
    // ribbon preview". Root cause: the public /ribbon/[gameId] page
    // resolved Game.ribbonTemplateId then fetched
    // /api/v1/templates/:id — which is admin-auth-required. Browser
    // had no JWT (it's a public surface), 401, modal showed
    // "Template error: HTTP 401". Fix: resolve all three surface
    // templates server-side here and BUNDLE them into the board
    // response. CustomScoreboardScene now reads the template from
    // the same /sports/board fetch it already does for cues +
    // sponsors + roster — one network call, no second auth-gated
    // endpoint to fail on. Tenant-scope is enforced server-side: a
    // template only ships if isSystem OR tenantId === game.tenantId
    // (a leaked or maliciously-set foreign template id returns
    // null and the ribbon falls back to its built-in render).
    const templateInclude = {
      zones: { orderBy: { sortOrder: 'asc' as const } },
    } as const;
    const resolveTemplate = async (tplId: string | null) => {
      if (!tplId) return null;
      // ten-ok: the tenant scope IS here — it rides the `OR` below, which the
      // static gate only inspects at the top level of `where`. The board may
      // render a layout owned by THIS game's tenant or a tenant-less system
      // preset, and nothing else; a foreign tenant's template resolves to null.
      const t = await this.prisma.client.template.findFirst({
        where: {
          id: tplId,
          OR: [{ tenantId: game.tenantId }, { isSystem: true }],
        },
        include: templateInclude,
      });
      return t ? mapTemplate(t) : null;
    };

    const [
      cues, sponsors, rosterRaw, ribbonMessages, ribbonPresets,
      ribbonSpeed, ribbonSlides, ribbonScoreRepeat,
      scoreboardTemplate, ribbonTemplate, scorebugTemplate,
      latestLiveOverlayEvent, latestSceneEvent, latestRosterPrivacyEvent,
      studentPolicy,
    ] = await Promise.all([
      this.prisma.client.gameEvent.findMany({
        where: { gameId: id, type: 'CUE', createdAt: { gte: since } },
        orderBy: { createdAt: 'asc' },
      }),
      // Active, in-flight sponsors for the board's banner slot — routed
      // through SponsorsService.listActive so flight-window filtering
      // (flightStartAt / flightEndAt) is always applied consistently.
      // Public by design — sponsors exist to be shown on the scoreboard.
      this.sponsorsService.listActive(game.tenantId),
      // The roster — drives player cards on the ribbon + scoreboard. The
      // per-student privacy flags (and the linked athlete's) are read here so
      // the public view can apply them; they never leave the server
      // (publicStudentView strips them).
      this.prisma.client.rosterPlayer.findMany({
        where: { gameId: id },
        orderBy: [{ team: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
        select: {
          id: true, team: true, name: true, number: true,
          position: true, photoUrl: true, stats: true,
          directoryOptOut: true, photoRelease: true,
          person: { select: { directoryOptOut: true, photoRelease: true } },
        },
      }),
      // Operator-set ribbon messages — the latest RIBBON event wins.
      this.latestRibbonMessages(id),
      // Which content presets ride the ribbon reel (resolved — stored
      // config, or the sport's full default-on set).
      this.ribbonPresetsFor(id, game.sport),
      // Ribbon scroll speed + the operator's full-bleed image slides.
      this.latestRibbonSpeed(id),
      this.latestRibbonSlides(id),
      // How many times the score anchor repeats around the ribbon.
      this.latestRibbonScoreRepeat(id),
      // Sprint 13 fix — inline the resolved templates so public
      // scoreboard / ribbon / scorebug surfaces never have to call
      // the auth-gated /templates/:id endpoint.
      resolveTemplate(game.scoreboardTemplateId),
      resolveTemplate(game.ribbonTemplateId),
      resolveTemplate(game.scorebugTemplateId),
      // T2-5: latest live-game text overlay. Latest-wins — the board
      // renders whatever the last LIVE_OVERLAY event says. `kind: 'clear'`
      // means "no active overlay".
      this.prisma.client.gameEvent.findFirst({
        where: { gameId: id, type: 'LIVE_OVERLAY' },
        orderBy: { createdAt: 'desc' },
        select: { id: true, payload: true, createdAt: true },
      }),
      // T3-3 Show Control: latest recalled-scene event (latest-wins, like the
      // overlay above). `kind: 'clear'` or an expired `expiresAt` → no scene.
      this.prisma.client.gameEvent.findFirst({
        where: { gameId: id, type: 'SCENE' },
        orderBy: { createdAt: 'desc' },
        select: { id: true, payload: true, createdAt: true },
      }),
      // K-12 launch audit F38: the school's public roster visibility,
      // latest-wins (see ./roster-privacy.ts).
      this.prisma.client.gameEvent.findFirst({
        where: { gameId: id, type: ROSTER_PRIVACY_EVENT },
        orderBy: { createdAt: 'desc' },
        select: { payload: true },
      }),
      // K-12 launch, lane B3: the school's student-information policy (its
      // own attestation, or its district's). Never throws — an unreadable
      // policy is a school that has confirmed nothing (fail closed).
      loadStudentPolicy(this.prisma.client, game.tenantId),
    ]);
    // Applied HERE, inside the cached build, so the payload, its ETag and the
    // stat leaders computed from `roster` below all see the public view. The
    // game's switches (B2) can only make the school's policy stricter.
    const rosterPrivacy = parseRosterPrivacy(latestRosterPrivacyEvent?.payload);
    const studentCtx: PublicStudentContext = {
      policy: studentPolicy,
      game: rosterPrivacy,
      directory: new StudentDirectory(rosterRaw),
      teams: [game.homeTeam, game.awayTeam],
    };
    const roster = rosterRaw.map((p) => publicStudentView(p, studentPolicy, rosterPrivacy));

    // T3-3 Show Control: resolve the latest SCENE with a SERVER-AUTHORITATIVE
    // expiry — the board never even sees an expired scene, so it auto-reverts
    // to the live scoreboard on its own (a closed operator laptop can't strand
    // it). One extra template lookup, and only while a scene is on-air.
    let scene: { templateId: string; template: unknown; expiresAt: number } | null = null;
    if (latestSceneEvent) {
      const sp = (latestSceneEvent.payload as Record<string, unknown>) ?? {};
      const expiresAt = typeof sp.expiresAt === 'number' ? sp.expiresAt : 0;
      if (
        sp.kind !== 'clear' &&
        typeof sp.templateId === 'string' &&
        (!expiresAt || Date.now() < expiresAt)
      ) {
        const tpl = await resolveTemplate(sp.templateId);
        if (tpl) scene = { templateId: sp.templateId, template: tpl, expiresAt };
      }
    }

    // K-12 sports launch, lane B4 — student names TYPED into the layouts this
    // payload bundles (relay legs, CTS announcements, venue player / lineup /
    // scorer fields, celebrations). The gate above never saw them: blank every
    // such value that is a rostered student of this tenant the school's
    // policy hides (./typed-student-names.ts — B3's rule, applied to the
    // shared list of typed-name fields). Inside the cached build, so the ETag
    // covers it. No query unless a zone carries a typed-name value.
    const [
      publicScoreboardTemplate,
      publicRibbonTemplate,
      publicScorebugTemplate,
      publicSceneTemplate,
    ] = await redactTypedStudentNames(this.prisma.client as any, game.tenantId, [
      scoreboardTemplate as any,
      ribbonTemplate as any,
      scorebugTemplate as any,
      (scene?.template ?? null) as any,
    ]);
    if (scene) scene = { ...scene, template: publicSceneTemplate };

    const board = {
      id: game.id,
      // K12-F40 — every surface's freshness contract keys off these: a poll
      // answered by another replica's one-second board cache can carry an
      // OLDER state, and surfaces never apply a revision below the one they
      // show; `updatedAt` (the commit time) measures commit-to-visible.
      revision: game.version,
      updatedAt: game.updatedAt,
      sport: game.sport,
      // K12-F01 — the bound rules (null = classic rules, a game created
      // before profiles). Static per game, so it never busts the ETag.
      rulesProfile: game.rulesProfile ?? null,
      rules: game.rules ?? null,
      status: game.status,
      segment: game.segment,
      homeTeam: game.homeTeam,
      awayTeam: game.awayTeam,
      homeScore: game.homeScore,
      awayScore: game.awayScore,
      homeColor: game.homeColor,
      awayColor: game.awayColor,
      homeLogoUrl: game.homeLogoUrl,
      awayLogoUrl: game.awayLogoUrl,
      clockMs: game.clockMs,
      clockRunning: game.clockRunning,
      clockUpdatedAt: game.clockUpdatedAt,
      // First-class possession column (football/basketball). Exposed
      // top-level for the board's `data.possession` read AND mirrored into
      // stats.possession below so the shared SituationalRow (and any widget)
      // that reads stats.possession sees the SAME value — one source of
      // truth, whichever control wrote it (2026-07-12 world-class audit).
      possession: game.possession ?? null,
      // Typed meet results, the swim feed's lane→name join, foul / exclusion
      // rows and the athlete-name stats go through the same gate (B3). The
      // bonus lamps are added from the game's own rules (K12-F04).
      stats: this.withBonusLamps(
        game,
        publicStats(
          mirrorPossessionIntoStats(game.stats, game.possession),
          studentCtx,
        ),
      ),
      spotlight: publicSpotlight(game.spotlight, studentCtx),
      cues: cues.map((c) => {
        const p = publicCuePayload((c.payload as Record<string, unknown>) ?? {}, studentCtx);
        return {
          id: c.id,
          ...p,
          // Explicit contract fields — always present, null when absent so
          // the frontend never has to guard against `undefined`.
          audioUrl: (p.audioUrl as string | null) ?? null,
          sponsorName: (p.sponsorName as string | null) ?? null,
          sponsorLogoUrl: (p.sponsorLogoUrl as string | null) ?? null,
          createdAt: c.createdAt,
        };
      }),
      sponsors,
      roster,
      ribbonMessages,
      ribbonPresets,
      ribbonSpeed,
      ribbonSlides,
      ribbonScoreRepeat,
      sponsorSpotSeconds: SPONSOR_SPOT_SECONDS,
      serverTime: this.serverTimeMs(),
      // Sprint 13 — operator-picked custom layout IDs. Each route
      // (/board /ribbon /scorebug) checks the matching field and,
      // if non-null, fetches + renders that Template (wrapped in
      // GameStateProvider) instead of the legacy hardcoded layout.
      scoreboardTemplateId: game.scoreboardTemplateId,
      ribbonTemplateId: game.ribbonTemplateId,
      scorebugTemplateId: game.scorebugTemplateId,
      // 2026-05-26 — resolved templates so public board surfaces can
      // render the operator-picked layout without a second
      // authenticated fetch to /api/v1/templates/:id. CustomScoreboardScene
      // reads these instead of hitting the auth-gated endpoint. Tenant-
      // scope already enforced above (system OR same-tenant only).
      scoreboardTemplate: publicScoreboardTemplate ?? null,
      ribbonTemplate: publicRibbonTemplate ?? null,
      scorebugTemplate: publicScorebugTemplate ?? null,
      // T2-5: active live-game text overlay (null = none).
      // `kind: 'clear'` means the last overlay was explicitly dismissed —
      // the frontend treats that as null. Any other kind is the live overlay.
      liveOverlay: (() => {
        if (!latestLiveOverlayEvent) return null;
        const p = (latestLiveOverlayEvent.payload as Record<string, unknown>) ?? {};
        if (p.kind === 'clear') return null;
        return {
          id: latestLiveOverlayEvent.id,
          kind: p.kind,
          payload: publicLiveOverlayPayload(p.payload ?? {}, studentCtx),
          snapshot: p.snapshot ?? {},
          createdAt: latestLiveOverlayEvent.createdAt,
        };
      })(),
      // T3-3 Show Control: the recalled GAMEDAY scene currently on-air, with
      // its resolved template bundled (like scoreboardTemplate) so the public
      // board needs no second auth-gated fetch. null = none / cleared / expired.
      scene,
    };

    // Phase 1-A — player-stats surfaces (stat leaders + auto
    // player-of-the-game). Computed from the `roster` already loaded
    // above (NO new DB query) inside the ~1s board cache build, ONLY
    // when the SPORTS_PLAYER_STATS flag is ON for this tenant. The keys
    // are OMITTED ENTIRELY when the flag is off or the result is empty,
    // so the flag-off payload is byte-identical to before this change.
    // Fail-open: computePlayerSurfaces never throws; a flag-eval error
    // is caught here and the keys are simply omitted.
    try {
      if (
        await this.flags.isEnabledAsync(FLAGS.SPORTS_PLAYER_STATS, {
          tenantId: game.tenantId,
        })
      ) {
        const surfaces = computePlayerSurfaces(game.sport, roster);
        if (surfaces.leaders.length > 0) {
          (board as typeof board & { leaders: typeof surfaces.leaders }).leaders =
            surfaces.leaders;
        }
        if (surfaces.playerOfGame) {
          (
            board as typeof board & { playerOfGame: typeof surfaces.playerOfGame }
          ).playerOfGame = surfaces.playerOfGame;
        }
      }
    } catch {
      // Never let stats compute / flag eval break the board.
    }

    return board;
  }

  /**
   * K12-F04 — the bonus lamps of a public stats blob, decided by the game's
   * OWN rules (`teamBonus`, @cms/api-types sports-rules.ts): `homeBonus` is
   * true when HOME shoots bonus free throws — i.e. when AWAY has reached the
   * bonus foul count this period (NFHS: five [nfhs-bb-changes-2023-24]). The
   * surfaces light a lamp from these flags, never from thresholds of their
   * own. A sport that keeps no team fouls is returned untouched.
   */
  private withBonusLamps(
    game: { sport: string; rules?: unknown },
    stats: unknown,
  ): unknown {
    const def = sportForGame(game);
    if (!teamFoulRules(def) || !stats || typeof stats !== 'object') {
      return stats;
    }
    const s = stats as Record<string, unknown>;
    return {
      ...s,
      homeBonus: teamBonus(def, 'home', s) !== null,
      awayBonus: teamBonus(def, 'away', s) !== null,
    };
  }

  // ── writes ───────────────────────────────────────────────────

  /** Bound a logo URL — trim, cap length, drop empties. */
  private cleanLogo(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const s = value.trim();
    return s ? s.slice(0, 2048) : null;
  }

  /**
   * Sports Wave S4-1 (P1-8) — parse the optional game kickoff date/time.
   * `undefined` (field omitted) and `null`/`''` (explicitly cleared) both
   * resolve to `null` — scheduledAt is optional everywhere, so a missing or
   * blank value is never an error, just "no time set yet." An unparseable
   * string is treated the same way rather than 400ing the whole create/
   * update — the New Game modal's datetime-local input can't produce one,
   * and a hand-rolled API caller shouldn't be able to wedge a bad date into
   * an otherwise-successful game create.
   */
  private parseScheduledAt(value: unknown): Date | null {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'string' || !value.trim()) return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  /**
   * Lane-2 P0: verify every foreign-key the operator can set on a Game
   * (`screenGroupId` + three template IDs) belongs to the caller's tenant
   * BEFORE persisting. Without this, a SCHOOL_ADMIN could paste a foreign
   * tenant's ScreenGroup UUID and pin their game's broadcast output to a
   * stranger's screen fleet — or paste a foreign template id to render
   * arbitrary HTML on their own scoreboard. Same shape as the panic-settings
   * ownership fix in tenants.controller.
   *
   * Templates may be tenant-owned OR `isSystem: true` (matches the existing
   * templates.controller convention).
   */
  private async assertOwnedGameRefs(
    tenantId: string,
    refs: {
      screenGroupId?: string | null;
      scoreboardTemplateId?: string | null;
      ribbonTemplateId?: string | null;
      scorebugTemplateId?: string | null;
    },
  ): Promise<void> {
    if (refs.screenGroupId) {
      const sg = await this.prisma.client.screenGroup.findFirst({
        where: { id: refs.screenGroupId, tenantId },
        select: { id: true },
      });
      if (!sg) {
        throw new NotFoundException(
          `Screen group not found in this tenant: ${refs.screenGroupId}`,
        );
      }
    }
    const templateIds = [
      refs.scoreboardTemplateId,
      refs.ribbonTemplateId,
      refs.scorebugTemplateId,
    ].filter((x): x is string => typeof x === 'string' && x.length > 0);
    if (templateIds.length > 0) {
      const owned = await this.prisma.client.template.findMany({
        where: {
          id: { in: templateIds },
          OR: [{ tenantId }, { isSystem: true }],
        },
        select: { id: true },
      });
      const ownedSet = new Set(owned.map((t) => t.id));
      const foreign = templateIds.filter((id) => !ownedSet.has(id));
      if (foreign.length > 0) {
        throw new NotFoundException(
          `Template(s) not found in this tenant: ${foreign.join(', ')}`,
        );
      }
    }
  }

  async createGame(
    tenantId: string,
    dto: {
      sport?: string;
      homeTeam?: string;
      awayTeam?: string;
      homeColor?: string;
      awayColor?: string;
      homeLogoUrl?: string;
      awayLogoUrl?: string;
      screenGroupId?: string;
      status?: string;
      // Sprint 13 — operator-picked custom layouts.
      scoreboardTemplateId?: string | null;
      ribbonTemplateId?: string | null;
      scorebugTemplateId?: string | null;
      // Sports Wave S4-1 (P1-8) — optional kickoff date/time. Absent/invalid
      // stays legal (null) — the "When is it?" field on New Game is optional.
      scheduledAt?: string | null;
      // 2026-07-12 world-class audit P1 — per-game regulation period length
      // for sports that publish clock.segmentMsOptions (water polo 7:00 HS
      // vs 8:00 NCAA). Validated against the sport's options; anything else
      // silently falls back to the sport default.
      clockSegmentMs?: number;
      // K12-F01 — the rules profile the game binds ('nfhs-basketball@2026-27',
      // @cms/api-types sports-rules.ts). Absent = the sport's default
      // profile; an unknown key or another sport's profile is refused.
      rulesProfile?: string;
      // K12-F05 / F24 — the shot-clock length a state-option clock starts
      // at: one of the profile's options, 0 = off. Absent = the profile's
      // default (OFF for NFHS basketball and lacrosse).
      shotClockLen?: number;
    },
    actor?: CommandInput,
  ) {
    const baseDef = this.sportOf(String(dto.sport || ''));
    // K12-F01 — bind the rules profile NOW: the game stores the resolved
    // snapshot, and every later command reads the game's own rules.
    const profile = this.resolveRulesProfile(baseDef.key, dto.rulesProfile);
    const rules = snapshotRules(profile);
    const def = this.sportOf({ sport: baseDef.key, rules });
    const homeTeam = String(dto.homeTeam || '').trim();
    const awayTeam = String(dto.awayTeam || '').trim();
    if (!homeTeam || !awayTeam) {
      throw new BadRequestException('homeTeam and awayTeam are required');
    }
    // Lane-2 P0 ownership check — see assertOwnedGameRefs for rationale.
    await this.assertOwnedGameRefs(tenantId, dto);
    const status = dto.status && GAME_STATUSES.includes(dto.status) ? dto.status : 'SCHEDULED';
    const scheduledAt = this.parseScheduledAt(dto.scheduledAt);

    // Seed the starting state the rules call for: full timeout banks (so the
    // broadcast pips read full from the opening whistle — an unset count
    // renders as "no timeouts left"), the short-timeout sub-bank, and a
    // state-option shot clock at the length the table picked (or the
    // profile's default — OFF for NFHS basketball and lacrosse).
    const createdAt = this.clockNow();
    const initialStats = this.rulesStartingStats(
      def,
      dto.shotClockLen,
      createdAt,
    );
    // Per-game period length (only when it matches a published option) —
    // stored in stats so every later clock reset (segment advance, clock
    // reset, auto-advance, integration ingest) picks it up via
    // segmentStartMs with zero schema change.
    if (
      typeof dto.clockSegmentMs === 'number' &&
      def.clock.segmentMsOptions?.some((o) => o.ms === dto.clockSegmentMs)
    ) {
      initialStats.clockSegmentMs = dto.clockSegmentMs;
    }

    return this.prisma.client.$transaction(async (tx: any) => {
      const created = await tx.game.create({
        data: {
          tenantId,
          sport: def.key,
          rulesProfile: profile.key,
          rules: rules as unknown as Prisma.InputJsonValue,
          homeTeam: homeTeam.slice(0, 80),
          awayTeam: awayTeam.slice(0, 80),
          homeColor: dto.homeColor?.slice(0, 32) || null,
          awayColor: dto.awayColor?.slice(0, 32) || null,
          homeLogoUrl: this.cleanLogo(dto.homeLogoUrl),
          awayLogoUrl: this.cleanLogo(dto.awayLogoUrl),
          screenGroupId: dto.screenGroupId || null,
          status,
          segment: 1,
          clockMs: this.segmentStartMs(def, initialStats),
          clockRunning: false,
          clockUpdatedAt: createdAt,
          stats: initialStats,
          scoreboardTemplateId: dto.scoreboardTemplateId || null,
          ribbonTemplateId: dto.ribbonTemplateId || null,
          scorebugTemplateId: dto.scorebugTemplateId || null,
          scheduledAt,
        },
      });
      await this.auditRow(tx, tenantId, actor, 'SPORTS_GAME_CREATED', created.id, {
        sport: created.sport,
        homeTeam: created.homeTeam,
        awayTeam: created.awayTeam,
        status: created.status,
        rulesProfile: profile.key,
      });
      return created;
    });
  }

  /**
   * K12-F01 — the rules profile a game binds: the one the table picked, or
   * the sport's default (@cms/api-types `defaultRulesProfile` — NFHS where a
   * listed source covers the sport, else its classic rules). A key that is
   * not a published, selectable profile of THIS sport is refused with the
   * keys that are.
   */
  private resolveRulesProfile(
    sportKey: string,
    requested: unknown,
  ): RulesProfile {
    if (requested === undefined || requested === null || requested === '') {
      const fallback = defaultRulesProfile(sportKey);
      if (!fallback) {
        throw new BadRequestException(`Unknown sport "${sportKey}"`);
      }
      return fallback;
    }
    const picked =
      typeof requested === 'string' ? findRulesProfile(requested) : undefined;
    if (!picked || picked.sport !== sportKey || !picked.selectable) {
      throw new BadRequestException({
        code: 'RULES_PROFILE_UNKNOWN',
        message: 'That is not a rules profile for this sport.',
        allowed: rulesProfilesForSport(sportKey).map((p) => p.key),
      });
    }
    return picked;
  }

  /**
   * The starting state a game's RULES call for, merged into its stats when it
   * is created (or, before it starts, re-bound to another profile):
   *   - every timeout bank full — the profile's full + short allocation
   *     (NFHS basketball: 5, of which 2 are 30-second), else the classic
   *     stat maximum (K12-F03);
   *   - the short-timeout sub-bank, when the profile has short timeouts;
   *   - a shot clock at the requested length or the profile's default: a
   *     state-option clock (NFHS basketball 35 s, boys lacrosse 70 s, girls
   *     lacrosse 90 s) starts OFF unless the table picks it (K12-F05 / F24).
   *     A length the rules do not offer is refused, never turned into OFF.
   */
  private rulesStartingStats(
    def: SportDefinition,
    shotClockLen: unknown,
    now: Date,
  ): Record<string, unknown> {
    const stats: Record<string, unknown> = {};
    for (const side of ['home', 'away'] as const) {
      const key = side === 'home' ? 'homeTimeouts' : 'awayTimeouts';
      const field = def.stats.find((s) => s.key === key);
      if (!field) continue;
      if (def.timeouts) {
        stats[key] = timeoutAllocation(def);
        if (def.timeouts.short > 0) {
          stats[shortTimeoutKey(side)] = def.timeouts.short;
        }
      } else if (typeof field.max === 'number') {
        stats[key] = field.max;
      }
    }
    const requested =
      shotClockLen === undefined || shotClockLen === null || shotClockLen === ''
        ? undefined
        : Number(shotClockLen);
    const cfg = def.shotClock;
    if (!cfg) {
      if (requested !== undefined && requested !== 0) {
        throw new BadRequestException({
          code: 'SHOT_CLOCK_UNSUPPORTED',
          message: `${def.name} has no shot clock under these rules.`,
        });
      }
      return stats;
    }
    const len = requested ?? cfg.defaultLen;
    if (len === undefined) return stats; // never configured: armed at `full` by the first start
    if (!Number.isInteger(len) || !cfg.options.includes(len)) {
      throw new BadRequestException({
        code: 'SHOT_CLOCK_LENGTH_UNSUPPORTED',
        message: `Under these rules the shot clock can be ${cfg.options
          .map((o) => (o === 0 ? 'off' : `${o} seconds`))
          .join(', ')}.`,
        allowed: cfg.options,
      });
    }
    const at = now.toISOString();
    stats.shotClock =
      len === 0
        ? { len: 0, ms: 0, at, running: false, off: true }
        : { len, ms: len * 1000, at, running: false };
    return stats;
  }

  /**
   * Duplicate a game — clone its full PRESENTATION setup into a fresh
   * SCHEDULED game. Operator (2026-05-20): "if I have 5 games this week
   * I can build out all the content ahead of time." Per-game pre-build
   * already works on any SCHEDULED game; this is the "build once, reuse"
   * shortcut so a whole week of games starts from a finished template
   * instead of being assembled five times.
   *
   * Copies (the reusable presentation):
   *   - identity: sport, team names, colors, logos
   *   - the three surface template assignments (scoreboard / ribbon /
   *     scorebug)
   *   - ribbon config: messages, presets, speed, slides, score-repeat —
   *     replayed as fresh GameEvents on the new game (that's where the
   *     ribbon state lives; latest-event-wins)
   *   - roster (home + away players) so the lineup is a starting point
   *
   * Resets (never inherit live state): score, clock, segment, status
   * (always a clean SCHEDULED game), the broadcast spotlight (live
   * content, not setup), and the screen-group binding (a duplicate must
   * never silently start pushing to the source's live screens).
   *
   * Sponsors + custom cues are already tenant-level and reusable, so
   * they carry over for free with no copy. Tenant-scoped; additive — no
   * schema change.
   */
  async duplicateGame(tenantId: string, id: string, actor?: CommandInput) {
    const src = await this.owned(tenantId, id);
    const def = this.sportOf(src);

    // Latest-wins ribbon config rows on the source (any may be absent).
    const ribbonTypes = [
      'RIBBON',
      'RIBBON_PRESETS',
      'RIBBON_SPEED',
      'RIBBON_SLIDES',
      'RIBBON_SCORE',
    ];
    const ribbonEvents = await Promise.all(
      ribbonTypes.map((type) =>
        this.prisma.client.gameEvent.findFirst({
          where: { gameId: id, type },
          orderBy: { createdAt: 'desc' },
        }),
      ),
    );

    // K12-F01 — the copy runs the SAME rules as the source: its profile key
    // and its stored snapshot, verbatim (a source created before profiles
    // stays on the classic rules; the table can switch the copy before it
    // starts). Its starting state is seeded from those rules like createGame
    // — full timeout banks, not the source's depleted count — and the
    // source's shot-clock choice carries over (a state that adopted the 35 s
    // clock plays every game of the week with it).
    const srcRules = parseGameRules(src.rules, src.sport);
    const initialStats = this.rulesStartingStats(
      def,
      this.keptShotClockLen(def, src.stats),
      this.clockNow(),
    );
    // Carry the source's per-game period length (part of the reusable
    // presentation setup — a 7:00 HS water polo game duplicates to
    // another 7:00 game). Same validation as createGame.
    const srcSegmentMs =
      src.stats && typeof src.stats === 'object'
        ? (src.stats as Record<string, unknown>).clockSegmentMs
        : undefined;
    if (
      typeof srcSegmentMs === 'number' &&
      def.clock.segmentMsOptions?.some((o) => o.ms === srcSegmentMs)
    ) {
      initialStats.clockSegmentMs = srcSegmentMs;
    }

    return this.prisma.client.$transaction(async (tx: any) => {
      const copy = await tx.game.create({
        data: {
          tenantId,
          sport: src.sport,
          rulesProfile: srcRules
            ? (src.rulesProfile ?? srcRules.profile)
            : null,
          rules: srcRules
            ? (srcRules as unknown as Prisma.InputJsonValue)
            : undefined,
          homeTeam: src.homeTeam,
          awayTeam: src.awayTeam,
          homeColor: src.homeColor,
          awayColor: src.awayColor,
          homeLogoUrl: src.homeLogoUrl,
          awayLogoUrl: src.awayLogoUrl,
          screenGroupId: null, // never inherit the source's live screen binding
          status: 'SCHEDULED',
          segment: 1,
          clockMs: this.segmentStartMs(def, initialStats),
          clockRunning: false,
          clockUpdatedAt: this.clockNow(),
          stats: initialStats,
          scoreboardTemplateId: src.scoreboardTemplateId,
          ribbonTemplateId: src.ribbonTemplateId,
          scorebugTemplateId: src.scorebugTemplateId,
        },
      });

      // Replay the ribbon config onto the copy (only events that exist).
      for (const ev of ribbonEvents) {
        if (ev) {
          await tx.gameEvent.create({ data: { gameId: copy.id, type: ev.type, payload: ev.payload as any } });
        }
      }

      // Clone the roster (home + away). Players are per-game; copying
      // gives the operator the lineup to tweak rather than re-enter it.
      const roster = await tx.rosterPlayer.findMany({
        where: { gameId: id },
        orderBy: { sortOrder: 'asc' },
      });
      if (roster.length > 0) {
        await tx.rosterPlayer.createMany({
          data: roster.map((p) => ({
            tenantId,
            gameId: copy.id,
            team: p.team,
            name: p.name,
            number: p.number,
            position: p.position,
            photoUrl: p.photoUrl,
            stats: p.stats as any,
            sortOrder: p.sortOrder,
            // K-12 launch, lane B3: the same students, so the same privacy
            // flags — and the same persistent athlete, whose flags follow the
            // student into every game (a family's opt-out recorded after the
            // source game was built must still hide them in the copy).
            directoryOptOut: p.directoryOptOut === true,
            photoRelease: p.photoRelease === true,
            personId: p.personId ?? null,
            teamId: p.teamId ?? null,
          })),
        });
      }

      await this.auditRow(tx, tenantId, actor, 'SPORTS_GAME_DUPLICATED', copy.id, {
        sourceGameId: id,
        rosterCopied: roster.length,
        rulesProfile: srcRules ? srcRules.profile : null,
      });
      return copy;
    });
  }

  /** The statuses in which a game's rules may still be changed (K12-F01). */
  private static readonly RULES_OPEN_STATUSES: ReadonlySet<string> = new Set([
    'SCHEDULED',
    'PRE_GAME',
  ]);

  /**
   * K12-F01 — switch a game that has NOT STARTED to another rules profile:
   * the explicit, audited way a game scheduled before profiles existed (or
   * set up under the wrong level) moves onto the rules it will be played
   * under. Nothing migrates a game silently. Refused once the game is LIVE,
   * at HALFTIME or FINAL (409 RULES_LOCKED): a game in progress or a finished
   * result never changes rules.
   *
   * The starting state is re-seeded from the new rules — full timeout banks,
   * the short-timeout sub-bank, the shot clock (the requested length, else
   * the table's current choice when the new rules still offer it, else the
   * new default) — and, while the game is still at the opening whistle, the
   * clock. Scores, rosters and presentation are untouched.
   */
  async setRulesProfile(
    tenantId: string,
    id: string,
    dto: { rulesProfile?: string; shotClockLen?: number },
    actor?: CommandInput,
  ) {
    if (typeof dto.rulesProfile !== 'string' || !dto.rulesProfile) {
      throw new BadRequestException('rulesProfile is required');
    }
    return this.runGameCommand(
      tenantId,
      id,
      'rules.set',
      actor,
      dto,
      async (scope) => {
        const game = scope.before;
        if (!SportsService.RULES_OPEN_STATUSES.has(game.status)) {
          throw new ConflictException({
            code: 'RULES_LOCKED',
            message: 'The rules are fixed once a game has started.',
          });
        }
        const profile = this.resolveRulesProfile(game.sport, dto.rulesProfile);
        const rules = snapshotRules(profile);
        const def = this.sportOf({ sport: game.sport, rules });
        const current: Record<string, unknown> =
          game.stats && typeof game.stats === 'object'
            ? { ...(game.stats as Record<string, unknown>) }
            : {};
        // Keep the table's shot-clock choice when the new rules still offer it.
        const shotLen = dto.shotClockLen ?? this.keptShotClockLen(def, current);
        const now = this.clockNow();
        const seeded = this.rulesStartingStats(def, shotLen, now);
        const stats: Record<string, unknown> = { ...current, ...seeded };
        // Blocks the new rules do not have leave with the old rules.
        if (!(def.timeouts && def.timeouts.short > 0)) {
          delete stats.homeShortTimeouts;
          delete stats.awayShortTimeouts;
        }
        if (!def.shotClock || seeded.shotClock === undefined) {
          delete stats.shotClock;
        }
        if (!def.stats.some((s) => s.key === 'homeTimeouts')) {
          delete stats.homeTimeouts;
          delete stats.awayTimeouts;
        }
        const data: Record<string, unknown> = {
          rulesProfile: profile.key,
          rules,
          stats,
        };
        // A game still at the opening whistle starts from the new length.
        if (
          !game.clockRunning &&
          game.segment === 1 &&
          def.clock.type !== 'none'
        ) {
          data.clockMs = this.segmentStartMs(def, stats, 1);
          data.clockUpdatedAt = now;
        }
        const updated = await scope.write(data);
        await scope.event('RULES', {
          from: game.rulesProfile ?? null,
          to: profile.key,
          label: profile.label,
        });
        scope.audit('SPORTS_GAME_RULES_SET', {
          from: game.rulesProfile ?? null,
          to: profile.key,
          verification: profile.verification,
        });
        return updated;
      },
    );
  }

  /** The table's current shot-clock length, when `def`'s rules still offer it. */
  private keptShotClockLen(
    def: SportDefinition,
    stats: unknown,
  ): number | undefined {
    if (!def.shotClock) return undefined;
    const mode = shotClockMode(stats);
    if (mode === 'unset') return undefined;
    const entry = (stats as Record<string, unknown>).shotClock;
    const len =
      mode === 'off' ? 0 : Number((entry as Record<string, unknown>).len);
    return def.shotClock.options.includes(len) ? len : undefined;
  }

  /**
   * Edit a game's identity — team names, colors, logos. Lets an
   * operator fix a typo or drop in a brand logo without recreating
   * the game (and losing the score/clock). Tenant-scoped.
   */
  async updateGameDetails(
    tenantId: string,
    id: string,
    dto: {
      homeTeam?: string;
      awayTeam?: string;
      homeColor?: string;
      awayColor?: string;
      homeLogoUrl?: string | null;
      awayLogoUrl?: string | null;
      // Sprint 13 — template reassignment.
      scoreboardTemplateId?: string | null;
      ribbonTemplateId?: string | null;
      scorebugTemplateId?: string | null;
      // Sports Wave S4-1 (P1-8) — editable any time from Setup. `null`/`''`
      // clears it back to "no time set."
      scheduledAt?: string | null;
    },
    actor?: CommandInput,
  ) {
    await this.owned(tenantId, id);
    // Lane-2 P0 ownership check — see assertOwnedGameRefs for rationale.
    await this.assertOwnedGameRefs(tenantId, dto);
    const data: Record<string, unknown> = {};
    if (dto.homeTeam !== undefined) {
      const t = String(dto.homeTeam).trim();
      if (!t) throw new BadRequestException('homeTeam cannot be empty');
      data.homeTeam = t.slice(0, 80);
    }
    if (dto.awayTeam !== undefined) {
      const t = String(dto.awayTeam).trim();
      if (!t) throw new BadRequestException('awayTeam cannot be empty');
      data.awayTeam = t.slice(0, 80);
    }
    if (dto.homeColor !== undefined) data.homeColor = dto.homeColor?.slice(0, 32) || null;
    if (dto.awayColor !== undefined) data.awayColor = dto.awayColor?.slice(0, 32) || null;
    if (dto.homeLogoUrl !== undefined) data.homeLogoUrl = this.cleanLogo(dto.homeLogoUrl);
    if (dto.awayLogoUrl !== undefined) data.awayLogoUrl = this.cleanLogo(dto.awayLogoUrl);
    // Sprint 13 — template reassignment. Empty string → clear (null).
    if (dto.scoreboardTemplateId !== undefined)
      data.scoreboardTemplateId = dto.scoreboardTemplateId || null;
    if (dto.ribbonTemplateId !== undefined)
      data.ribbonTemplateId = dto.ribbonTemplateId || null;
    if (dto.scorebugTemplateId !== undefined)
      data.scorebugTemplateId = dto.scorebugTemplateId || null;
    if (dto.scheduledAt !== undefined) {
      data.scheduledAt = this.parseScheduledAt(dto.scheduledAt);
      // Inputs-wave SCHED — a kickoff edit while armed moves the pending
      // fire time with it (still scheduledAt − 10m; clearing the kickoff
      // clears the pending fire). Only until a push has completed —
      // re-timing an already-on-air board makes no sense. Fail-open: a
      // config-read error leaves autoPushAt exactly as it was.
      try {
        const cfg = await this.latestAutoPush(id, { fresh: true });
        if (cfg?.armed && !cfg.pushedAt) {
          data.autoPushAt = data.scheduledAt
            ? new Date((data.scheduledAt as Date).getTime() - AUTO_PUSH_LEAD_MS)
            : null;
        }
      } catch {
        /* keep autoPushAt untouched */
      }
    }
    const updated = await this.prisma.client.$transaction(async (tx: any) => {
      const row = await tx.game.update({ where: { id, tenantId }, data });
      await this.auditRow(tx, tenantId, actor, 'SPORTS_GAME_DETAILS_UPDATED', id, {
        fields: Object.keys(data),
        values: data,
      });
      return row;
    });
    // Restore the sweep cadence when the fire time moved — an edit to
    // "starts in 8 minutes" must fire within one tick, not one idle window.
    if (data.autoPushAt instanceof Date) wakeScheduleSweep();
    // Lane-8 P1 (re-audit): updateGameDetails bypasses record(), so the
    // board cache wouldn't refresh on team-name/color/logo/template change
    // for up to BOARD_CACHE_TTL_MS. Invalidate explicitly.
    this.invalidateBoardCache(id);
    return updated;
  }

  /**
   * Set (or clear) the broadcast spotlight — the featured-player /
   * promo panel on the scoreboard: a title, photo, subtitle, and up
   * to four stat lines. `clear` wipes it; otherwise the whole panel
   * is replaced. `visible` lets the operator stage a player and
   * toggle the panel on/off without losing the content.
   */
  async setSpotlight(
    tenantId: string,
    id: string,
    dto: {
      clear?: boolean;
      visible?: boolean;
      title?: string;
      photoUrl?: string;
      subtitle?: string;
      lines?: Array<{ label?: string; value?: string }>;
    },
    actor?: CommandInput,
  ) {
    await this.owned(tenantId, id);
    if (dto.clear) {
      const cleared = await this.prisma.client.$transaction(async (tx: any) => {
        const row = await tx.game.update({ where: { id, tenantId }, data: { spotlight: {} } });
        await this.auditRow(tx, tenantId, actor, 'SPORTS_SPOTLIGHT_CLEARED', id, {});
        return row;
      });
      this.invalidateBoardCache(id); // Lane-8 P1: bypasses record()
      return cleared;
    }
    const title = String(dto.title ?? '').trim().slice(0, 80);
    if (!title) throw new BadRequestException('Spotlight title is required');
    const lines = Array.isArray(dto.lines)
      ? dto.lines
          .slice(0, 4)
          .map((l) => ({
            label: String(l?.label ?? '').trim().slice(0, 24),
            value: String(l?.value ?? '').trim().slice(0, 24),
          }))
          .filter((l) => l.label || l.value)
      : [];
    const spotlight = {
      visible: dto.visible !== false,
      title,
      photoUrl: this.cleanLogo(dto.photoUrl),
      subtitle: String(dto.subtitle ?? '').trim().slice(0, 80),
      lines,
    };
    const updated = await this.prisma.client.$transaction(async (tx: any) => {
      const row = await tx.game.update({ where: { id, tenantId }, data: { spotlight: spotlight as any } });
      await this.auditRow(tx, tenantId, actor, 'SPORTS_SPOTLIGHT_SET', id, { spotlight });
      return row;
    });
    this.invalidateBoardCache(id); // Lane-8 P1: bypasses record()
    return updated;
  }

  async deleteGame(tenantId: string, id: string, actor?: CommandInput) {
    const game = await this.owned(tenantId, id);
    await this.prisma.client.$transaction(async (tx: any) => {
      // Release any screens pushing this game's scoreboard so they fall
      // back to their scheduled content (the pointer has no FK).
      await tx.screen.updateMany({
        where: { tenantId, activeBoardGameId: id },
        data: { activeBoardGameId: null, activeBoardSurface: null },
      });
      await tx.game.delete({ where: { id, tenantId } }); // cascades events
      // K12-F34: the game's own event trail goes with it, so the audit row
      // keeps the result that was deleted.
      await this.auditRow(tx, tenantId, actor, 'SPORTS_GAME_DELETED', id, {
        sport: game.sport,
        homeTeam: game.homeTeam,
        awayTeam: game.awayTeam,
        status: game.status,
        finalScore: { home: game.homeScore, away: game.awayScore },
      });
    });
    return { deleted: true };
  }

  // ── scoreboard-to-screen push ────────────────────────────────

  /** The valid sports display surfaces an operator can push to a screen. */
  static readonly BOARD_SURFACES = ['BOARD', 'RIBBON', 'SCOREBUG'] as const;

  /** Normalize an untrusted surface value; defaults to BOARD. */
  private cleanSurface(surface: unknown): 'BOARD' | 'RIBBON' | 'SCOREBUG' {
    const s = String(surface || 'BOARD').toUpperCase();
    return s === 'RIBBON' || s === 'SCOREBUG' ? s : 'BOARD';
  }

  /**
   * Tenant's screens + whether each currently shows this game, and which
   * surface (scoreboard / ribbon / scorebug) it's showing.
   */
  async listGameScreens(tenantId: string, gameId: string) {
    await this.owned(tenantId, gameId);
    const screens = await this.prisma.client.screen.findMany({
      where: { tenantId },
      select: {
        id: true,
        name: true,
        status: true,
        activeBoardGameId: true,
        activeBoardSurface: true,
      },
      orderBy: { name: 'asc' },
    });
    // Label any screen claimed by a DIFFERENT game with that game's
    // matchup, so the operator sees who owns it before taking it over.
    const otherIds = [
      ...new Set(
        screens
          .map((s) => s.activeBoardGameId)
          .filter((id): id is string => !!id && id !== gameId),
      ),
    ];
    const otherGames = otherIds.length
      ? await this.prisma.client.game.findMany({
          where: { id: { in: otherIds } },
          select: { id: true, homeTeam: true, awayTeam: true },
        })
      : [];
    const labelById = new Map(
      otherGames.map((g) => [g.id, `${g.homeTeam} vs ${g.awayTeam}`]),
    );
    return screens.map((s) => {
      const showingOther =
        !!s.activeBoardGameId && s.activeBoardGameId !== gameId;
      return {
        id: s.id,
        name: s.name,
        status: s.status,
        showing: s.activeBoardGameId === gameId,
        showingOther,
        // Which game owns it, when another game does — for the
        // take-over confirmation.
        otherGame: showingOther
          ? labelById.get(s.activeBoardGameId as string) ?? 'another game'
          : null,
        // K12-F35 — the owner a take-over is made against: the console
        // sends it back, and the claim only succeeds while it still holds.
        otherGameId: showingOther ? (s.activeBoardGameId as string) : null,
        // The surface this screen renders when it IS showing this game.
        // Null surface on a pushed screen reads as BOARD (back-compat).
        surface:
          s.activeBoardGameId === gameId ? s.activeBoardSurface || 'BOARD' : null,
      };
    });
  }

  /**
   * Push this game to the given screens on a chosen surface — the full
   * scoreboard (BOARD), the LED ribbon (RIBBON), or the broadcast
   * scorebug (SCOREBUG). Defaults to BOARD.
   */
  async showOnScreens(
    tenantId: string,
    gameId: string,
    screenIds: unknown,
    surface?: unknown,
    force?: unknown,
    actor?: CommandInput,
    takeover?: unknown,
  ) {
    await this.claimScreens(tenantId, gameId, screenIds, surface, { force, takeover, actor });
    return this.listGameScreens(tenantId, gameId);
  }

  /**
   * K12-F35 — claim screens for this game, atomically. A screen is owned by
   * ONE game at a time. Every claim is a compare-and-swap on the owner this
   * transaction read (`UPDATE … WHERE id AND tenant AND active_board_game_id
   * = <owner seen>`), all in one transaction: two operators claiming the same
   * free screen at once get exactly one winner — the loser's write re-checks
   * the owner after the winner commits, misses, and its whole claim rolls
   * back with a SCREEN_IN_USE conflict that names the screen and its actual
   * owner. It used to check ownership and then write unconditionally, so
   * both could pass the check and the later write silently won.
   *
   * Taking a screen from ANOTHER game needs an explicit take-over:
   * `takeover` maps screenId → the game id the operator saw on it (and
   * confirmed); the claim only succeeds while that game still owns it, so a
   * stale confirmation dialog cannot steal a screen that has since changed
   * hands. `force: true` without a map is the older console's form: a
   * take-over from whichever game owns the screen at the moment of the
   * claim. Every claim and every take-over is audited with the previous
   * owner, in the same transaction. The signed SYNC nudge (and the manifest
   * fallback behind it) is unchanged.
   *
   * Returns what each screen showed before, for the auto-push's revert.
   */
  private async claimScreens(
    tenantId: string,
    gameId: string,
    screenIds: unknown,
    surface: unknown,
    opts: { force?: unknown; takeover?: unknown; actor?: CommandInput },
  ): Promise<AutoPushSavedScreen[]> {
    await this.owned(tenantId, gameId);
    const ids = Array.isArray(screenIds)
      ? [...new Set(screenIds.filter((x): x is string => typeof x === 'string' && x.length > 0))]
      : [];
    if (ids.length === 0) throw new BadRequestException('screenIds is required');
    const cleanSurface = this.cleanSurface(surface);
    const takeoverMap: Record<string, string> =
      opts.takeover && typeof opts.takeover === 'object' && !Array.isArray(opts.takeover)
        ? Object.fromEntries(
            Object.entries(opts.takeover as Record<string, unknown>).filter(
              (e): e is [string, string] => typeof e[1] === 'string' && e[1].length > 0,
            ),
          )
        : {};
    const legacyForce = opts.force === true && Object.keys(takeoverMap).length === 0;

    const claimed = await this.prisma.client.$transaction(async (tx: any) => {
      const targets: Array<{
        id: string;
        name: string;
        activeBoardGameId: string | null;
        activeBoardSurface: string | null;
      }> = await tx.screen.findMany({
        where: { id: { in: ids }, tenantId },
        select: { id: true, name: true, activeBoardGameId: true, activeBoardSurface: true },
      });
      const conflicts: Array<{ id: string; name: string; ownerGameId: string | null }> = [];
      const saved: AutoPushSavedScreen[] = [];
      const takenOver: Array<{ screenId: string; fromGameId: string }> = [];
      for (const s of targets) {
        const owner = s.activeBoardGameId ?? null;
        const prevSurface = s.activeBoardSurface ?? null;
        if (owner && owner !== gameId) {
          // Another game's screen: only by an explicit take-over made
          // against THIS owner.
          const allowed = legacyForce || takeoverMap[s.id] === owner;
          if (!allowed) {
            conflicts.push({ id: s.id, name: s.name, ownerGameId: owner });
            continue;
          }
        }
        const res = await tx.screen.updateMany({
          where: { id: s.id, tenantId, activeBoardGameId: owner },
          data: { activeBoardGameId: gameId, activeBoardSurface: cleanSurface },
        });
        if (res.count === 0) {
          // The owner changed after this transaction read it — a concurrent
          // claim won. Report who holds it now.
          const now = await tx.screen.findFirst({
            where: { id: s.id, tenantId },
            select: { activeBoardGameId: true },
          });
          conflicts.push({ id: s.id, name: s.name, ownerGameId: now?.activeBoardGameId ?? null });
          continue;
        }
        saved.push({ screenId: s.id, prevGameId: owner, prevSurface });
        if (owner && owner !== gameId) takenOver.push({ screenId: s.id, fromGameId: owner });
      }
      if (conflicts.length > 0) {
        // Nothing lands: a push is all of its screens or none of them.
        throw new ConflictException({
          code: 'SCREEN_IN_USE',
          message: `Already showing another game: ${conflicts
            .map((c) => c.name)
            .join(', ')}. Take it over to switch.`,
          screenIds: conflicts.map((c) => c.id),
          screenNames: conflicts.map((c) => c.name),
          conflicts: conflicts.map((c) => ({
            screenId: c.id,
            screenName: c.name,
            ownerGameId: c.ownerGameId,
          })),
        });
      }
      if (saved.length > 0) {
        await this.auditRow(tx, tenantId, opts.actor, 'SPORTS_SCREENS_SHOWN', gameId, {
          surface: cleanSurface,
          screens: saved,
        });
      }
      for (const t of takenOver) {
        await this.auditRow(tx, tenantId, opts.actor, 'SPORTS_SCREEN_TAKEN_OVER', gameId, {
          screenId: t.screenId,
          fromGameId: t.fromGameId,
          toGameId: gameId,
          surface: cleanSurface,
          confirmedOwner: takeoverMap[t.screenId] ?? null,
        });
      }
      return saved;
    });
    // Inputs-wave SCHED — players otherwise pick this up on their 30s
    // reconcile poll; the SYNC nudge makes the board land now.
    await this.notifySync(tenantId);
    return claimed;
  }

  /** Stop showing this game — on a given subset, or every screen. */
  async hideFromScreens(
    tenantId: string,
    gameId: string,
    screenIds?: unknown,
    actor?: CommandInput,
  ) {
    await this.owned(tenantId, gameId);
    const where: Record<string, unknown> = { tenantId, activeBoardGameId: gameId };
    if (Array.isArray(screenIds) && screenIds.length > 0) {
      where.id = {
        in: screenIds.filter((x): x is string => typeof x === 'string' && x.length > 0),
      };
    }
    // Only screens THIS game owns are released (the owner is in the WHERE),
    // so a hide can never blank a screen another game has since taken.
    await this.prisma.client.$transaction(async (tx: any) => {
      const releasing: Array<{ id: string }> = await tx.screen.findMany({ where, select: { id: true } });
      if (releasing.length === 0) return;
      await tx.screen.updateMany({
        where,
        data: { activeBoardGameId: null, activeBoardSurface: null },
      });
      await this.auditRow(tx, tenantId, actor, 'SPORTS_SCREENS_RELEASED', gameId, {
        screenIds: releasing.map((r) => r.id),
      });
    });
    // Inputs-wave SCHED — same nudge as showOnScreens: the screen falls
    // back to its scheduled content now, not at the next 30s reconcile.
    await this.notifySync(tenantId);
    return this.listGameScreens(tenantId, gameId);
  }

  // ── schedule game mode — auto-push at scheduledAt−10m (Inputs-wave SCHED) ──
  //
  // Persistence is a latest-wins AUTO_PUSH GameEvent (the AUTO_CELEBRATE /
  // RIBBON* pattern — zero new tables) plus ONE additive column,
  // Game.autoPushAt, as the sweep's tenant-less claim predicate. The board
  // goes up 10 minutes before scheduledAt (AUTO_PUSH_LEAD_MS — baked, no
  // knob) and comes back down automatically at FINAL (onGameFinal).

  /** Sanitize an untrusted AUTO_PUSH event payload into a typed config. */
  private parseAutoPushPayload(payload: unknown): AutoPushConfig {
    const p = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
    const screenIds = Array.isArray(p.screenIds)
      ? p.screenIds.filter((x): x is string => typeof x === 'string' && x.length > 0)
      : [];
    const savedState = Array.isArray(p.savedState)
      ? p.savedState
          .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
          .map((e) => ({
            screenId: typeof e.screenId === 'string' ? e.screenId : '',
            prevGameId: typeof e.prevGameId === 'string' && e.prevGameId ? e.prevGameId : null,
            prevSurface: typeof e.prevSurface === 'string' && e.prevSurface ? e.prevSurface : null,
          }))
          .filter((e) => e.screenId)
      : null;
    return {
      armed: p.armed === true,
      screenIds,
      surface: this.cleanSurface(p.surface),
      savedState,
      pushedAt: typeof p.pushedAt === 'string' ? p.pushedAt : null,
      holdMin: cleanPostgameHoldMinutes(p.holdMin),
      returnAt: typeof p.returnAt === 'string' ? p.returnAt : null,
    };
  }

  /** The AUTO_PUSH event payload of a config (the latest-wins record). */
  private autoPushPayload(config: AutoPushConfig): Record<string, unknown> {
    return {
      armed: config.armed,
      screenIds: config.screenIds,
      surface: config.surface,
      ...(config.savedState ? { savedState: config.savedState } : {}),
      ...(config.pushedAt ? { pushedAt: config.pushedAt } : {}),
      ...(config.holdMin !== null ? { holdMin: config.holdMin } : {}),
      ...(config.returnAt ? { returnAt: config.returnAt } : {}),
    };
  }

  /**
   * The game's current schedule-game-mode config. Reads the in-memory
   * cache; on a miss, hydrates ONCE from the latest AUTO_PUSH GameEvent
   * (null when the game was never armed) — the autoCelebrateEnabled
   * pattern. `fresh: true` bypasses the cache for writers that must never
   * act on a stale copy (the sweep, the FINAL hook, a scheduledAt edit):
   * arming may have happened on another process, and a stale screen list
   * would push to — or revert — the wrong screens.
   */
  private async latestAutoPush(
    gameId: string,
    opts?: { fresh?: boolean },
  ): Promise<AutoPushConfig | null> {
    if (!opts?.fresh) {
      const cached = this.autoPushCache.get(gameId);
      if (cached !== undefined) return cached;
    }
    try {
      const ev = await this.prisma.client.gameEvent.findFirst({
        where: { gameId, type: 'AUTO_PUSH' },
        orderBy: { createdAt: 'desc' },
      });
      const config = ev ? this.parseAutoPushPayload(ev.payload) : null;
      this.autoPushCache.set(gameId, config);
      return config;
    } catch {
      // Fail open to "no config" WITHOUT poisoning the cache — a transient
      // read error must never block the caller (sweep push, FINAL
      // transition); worst case the operator re-arms.
      return null;
    }
  }

  /**
   * Read the schedule-game-mode state for the console card: armed flag,
   * target screens/surface, the pending fire time (Game.autoPushAt, null
   * once fired/cancelled), pushedAt when the sweep already put the board
   * up, and the baked lead so UI copy derives from the same constant.
   */
  async getAutoPush(tenantId: string, id: string) {
    const game = await this.owned(tenantId, id);
    const config = await this.latestAutoPush(id);
    const armed = config?.armed === true;
    return {
      armed,
      screenIds: armed && config ? config.screenIds : [],
      surface: armed && config ? config.surface : ('BOARD' as const),
      autoPushAt: (game as { autoPushAt?: Date | null }).autoPushAt ?? null,
      pushedAt: armed && config ? config.pushedAt : null,
      leadMs: AUTO_PUSH_LEAD_MS,
      // K12-F37 — how long the final result stays up after the game, the
      // choices the card offers, and (during that hold) when the screens go
      // back to their schedule.
      holdMin: postgameHoldMinutes(config?.holdMin),
      holdOptions: POSTGAME_HOLD_OPTIONS_MINUTES,
      returnAt: armed && config ? config.returnAt : null,
    };
  }

  /**
   * Arm or disarm schedule game mode. Arming computes
   * `autoPushAt = scheduledAt − 10 minutes` (the board goes up 10 minutes
   * before start — baked default, deliberately no knob) and therefore
   * requires a game time to already be set. Latest-wins AUTO_PUSH
   * GameEvent + the autoPushAt column; immutable AuditLog row either way
   * (privileged mutation — Standard Audit Surface §16).
   */
  async setAutoPush(
    tenantId: string,
    id: string,
    dto: { armed?: unknown; screenIds?: unknown; surface?: unknown; holdMin?: unknown },
    actor?: CommandInput,
  ) {
    const game = await this.owned(tenantId, id);
    const actorCtx = resolveCommandContext(actor);
    const previousAutoPushAt = (game as { autoPushAt?: Date | null }).autoPushAt ?? null;
    // K12-F37 — the postgame hold, when this request names one.
    const holdMin = dto.holdMin === undefined ? undefined : cleanPostgameHoldMinutes(dto.holdMin);
    if (holdMin === null) {
      throw new BadRequestException({
        code: 'POSTGAME_HOLD_INVALID',
        message: `Keep the final result up for one of: ${POSTGAME_HOLD_OPTIONS_MINUTES.join(', ')} minutes.`,
      });
    }
    // K12-F34: the AUTO_PUSH event, the autoPushAt column and the audit row
    // commit together (the audit write used to be best-effort, after both).
    // `autoPushAt: undefined` leaves the column as it is.
    const persist = async (
      payload: Record<string, unknown>,
      autoPushAt: Date | null | undefined,
      action: string,
      details: (eventId: string) => Record<string, unknown>,
    ) => {
      await this.prisma.client.$transaction(async (tx: any) => {
        const ev = await tx.gameEvent.create({
          data: {
            gameId: id,
            type: 'AUTO_PUSH',
            payload: payload as any,
            actorType: actorCtx.actor.kind,
            actorUserId: actorCtx.actor.kind === 'user' ? actorCtx.actor.userId ?? null : null,
          },
        });
        if (autoPushAt !== undefined) await tx.game.update({ where: { id, tenantId }, data: { autoPushAt } });
        await this.auditRow(tx, tenantId, actor, action, id, details(ev.id));
      });
      this.invalidateBoardCache(id);
    };

    // K12-F37 — a new postgame hold on its own (the card's "keep the final
    // up for" choice), keeping everything else about the armed config. During
    // the hold itself it moves the return: the new length counts from the end
    // of the game, and one that has already run out returns the screens now.
    if (dto.armed === undefined && holdMin !== undefined) {
      const config = await this.latestAutoPush(id, { fresh: true });
      if (!config?.armed) {
        throw new BadRequestException({
          code: 'AUTO_PUSH_NOT_ARMED',
          message: 'Turn on schedule game mode first.',
        });
      }
      let returnAt = config.returnAt;
      let column: Date | undefined;
      if (returnAt && game.status === 'FINAL') {
        const endedMs = game.endedAt ? new Date(game.endedAt).getTime() : this.serverTimeMs();
        const at = endedMs + holdMin * 60_000;
        if (at <= this.serverTimeMs()) {
          const next = { ...config, holdMin };
          this.autoPushCache.set(id, next);
          await this.returnPostgameScreens(tenantId, id, actor, 'hold-shortened', next);
          return this.getAutoPush(tenantId, id);
        }
        returnAt = new Date(at).toISOString();
        column = new Date(at);
      }
      const next: AutoPushConfig = { ...config, holdMin, returnAt };
      await persist(this.autoPushPayload(next), column, 'SPORTS_POSTGAME_HOLD_SET', (eventId) => ({
        eventId,
        holdMin,
        previousHoldMin: config.holdMin,
        returnAt,
      }));
      this.autoPushCache.set(id, next);
      if (column) wakeScheduleSweep();
      return this.getAutoPush(tenantId, id);
    }

    if (dto.armed !== true) {
      // K12-F37 — turning schedule game mode off while a finished game holds
      // its result gives the screens back to their schedule now; leaving
      // them on a stale final with no return scheduled would strand them.
      if (game.status === 'FINAL' && previousAutoPushAt) {
        await this.returnPostgameScreens(tenantId, id, actor, 'disarmed');
        return this.getAutoPush(tenantId, id);
      }
      await persist({ armed: false }, null, 'SPORTS_AUTO_PUSH_DISARMED', (eventId) => ({
        eventId,
        previousAutoPushAt: previousAutoPushAt ? new Date(previousAutoPushAt).toISOString() : null,
      }));
      this.autoPushCache.set(id, this.parseAutoPushPayload({ armed: false }));
      return this.getAutoPush(tenantId, id);
    }

    // K12-F37 — a finished game has nothing to put up, and re-arming it would
    // overwrite the config its postgame hold returns the screens from.
    if (game.status === 'FINAL') {
      throw new ConflictException({
        code: 'AUTO_PUSH_GAME_FINAL',
        message: 'This game is over. Reopen it to put its board up again.',
      });
    }
    const scheduledAt = game.scheduledAt ? new Date(game.scheduledAt) : null;
    if (!scheduledAt || Number.isNaN(scheduledAt.getTime())) {
      throw new BadRequestException(
        'Set a game time first — the board goes up 10 minutes before it.',
      );
    }
    const requestedIds = Array.isArray(dto.screenIds)
      ? dto.screenIds.filter((x): x is string => typeof x === 'string' && x.length > 0)
      : [];
    if (requestedIds.length === 0) {
      throw new BadRequestException('screenIds is required to arm auto-push');
    }
    // Persist only screens this tenant actually owns — showOnScreens
    // re-filters at push time too, but the stored config (and the audit
    // row) should never carry a foreign id.
    const ownedScreens = await this.prisma.client.screen.findMany({
      where: { id: { in: requestedIds }, tenantId },
      select: { id: true },
    });
    const screenIds = ownedScreens.map((s: { id: string }) => s.id);
    if (screenIds.length === 0) {
      throw new BadRequestException('No matching screens in this venue');
    }
    const surface = this.cleanSurface(dto.surface);
    const autoPushAt = new Date(scheduledAt.getTime() - AUTO_PUSH_LEAD_MS);

    // K12-F37 — the postgame hold rides the armed config: this request's
    // choice, else the one the game already had (re-arming with a changed
    // screen list keeps it), else the default at FINAL.
    const keptHold = holdMin ?? (await this.latestAutoPush(id, { fresh: true }))?.holdMin ?? null;
    const armedPayload: Record<string, unknown> = {
      armed: true,
      screenIds,
      surface,
      ...(keptHold !== null ? { holdMin: keptHold } : {}),
    };
    await persist(armedPayload, autoPushAt, 'SPORTS_AUTO_PUSH_ARMED', (eventId) => ({
      screenIds,
      surface,
      holdMin: keptHold,
      autoPushAt: autoPushAt.toISOString(),
      previousAutoPushAt: previousAutoPushAt ? new Date(previousAutoPushAt).toISOString() : null,
      eventId,
    }));
    this.autoPushCache.set(id, this.parseAutoPushPayload(armedPayload));
    // Restore the sweep's cadence immediately — arming close to (or past)
    // kickoff−10 should put the board up within one tick, not one idle
    // window.
    wakeScheduleSweep();
    return this.getAutoPush(tenantId, id);
  }

  /**
   * One schedule sweep (GameScheduleService, every 15s): atomically CLAIM
   * every game whose autoPushAt has arrived, then push each claimed
   * game's board. The claim is a single UPDATE … SET auto_push_at = NULL
   * … RETURNING — under READ COMMITTED a second replica's UPDATE
   * re-evaluates the predicate after the first commits and returns no
   * rows, so two replicas can never double-fire a game (the
   * webhook-retry.worker claim-by-write pattern). The push itself is
   * idempotent, but the savedState capture is NOT — that exclusivity is
   * the point of claiming.
   *
   * Fail-open PER GAME: one bad game (vanished screens, conflicting
   * operator, DB hiccup) must never kill the pass for the others.
   */
  async sweepDueAutoPushes(): Promise<{ found: number; pushed: number; blocked: number; returned: number }> {
    const due = await this.prisma.client.$queryRaw<Array<{ id: string; tenant_id: string }>>`
      UPDATE "games"
         SET "auto_push_at" = NULL
       WHERE "auto_push_at" IS NOT NULL
         AND "auto_push_at" <= NOW()
      RETURNING "id", "tenant_id"
    `;
    let pushed = 0;
    let blocked = 0;
    let returned = 0;
    for (const row of due ?? []) {
      try {
        const outcome = await this.executeAutoPush(row.tenant_id, row.id);
        if (outcome === 'pushed') pushed++;
        else if (outcome === 'blocked') blocked++;
        else if (outcome === 'returned') returned++;
      } catch (err) {
        this.logger.warn(
          `auto-push failed (non-fatal) game=${row.id} tenant=${row.tenant_id}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
    return { found: due?.length ?? 0, pushed, blocked, returned };
  }

  /**
   * Act on one CLAIMED game: put its board up on its armed screens, or —
   * K12-F37 — end its postgame hold and give the screens back.
   */
  private async executeAutoPush(
    tenantId: string,
    gameId: string,
  ): Promise<'pushed' | 'blocked' | 'returned' | 'skipped'> {
    // Fresh config read — see latestAutoPush: arming may have happened on
    // another process, and a stale screen list here pushes to the wrong
    // screens.
    const config = await this.latestAutoPush(gameId, { fresh: true });
    if (!config?.armed || config.screenIds.length === 0) return 'skipped';
    // The claim can race an operator's early FINAL (onGameFinal nulls
    // autoPushAt, but the row may already be claimed) or a delete — never
    // put a finished or vanished game's board up.
    const game = await this.prisma.client.game.findFirst({
      where: { id: gameId, tenantId },
      select: { status: true },
    });
    if (!game) return 'skipped';
    // K12-F37 — the claim was a postgame hold running out. A game reopened
    // for a correction since then keeps its board (the reopen cancelled the
    // hold; the next final starts a new one).
    if (config.returnAt) {
      if (game.status !== 'FINAL') return 'skipped';
      await this.returnPushedScreens(tenantId, gameId, config, 'hold-ended');
      return 'returned';
    }
    if (game.status === 'FINAL') return 'skipped';
    // This arming's push already completed (a re-arm writes a config with no
    // pushedAt): a claim now is a stale one — a hold that a correction
    // cancelled while the sweep held its claim — never a second push, which
    // would re-capture the saved state and lose what the screens showed
    // before the game.
    if (config.pushedAt) return 'skipped';

    // The claim returns exactly what each screen showed when it was
    // claimed (read in the claim's own transaction), so FINAL can put back
    // what each screen showed. Not idempotent — the exclusive sweep claim
    // above is what makes a single capture safe.
    let savedState: AutoPushSavedScreen[];
    try {
      // force=false ALWAYS — an automation must never steal a screen a
      // co-operator is using (back-to-back games, same gym).
      savedState = await this.claimScreens(tenantId, gameId, config.screenIds, config.surface, {
        force: false,
        actor: { actor: { kind: 'system', ref: 'auto-push' } },
      });
    } catch (err) {
      if (err instanceof ConflictException) {
        const resp = err.getResponse() as {
          code?: string;
          screenIds?: string[];
          screenNames?: string[];
        };
        if (resp?.code === 'SCREEN_IN_USE') {
          // Skip this game entirely (no partial push, no savedState) and
          // leave a forensic trail naming the conflicting screens. The
          // latest config stays without pushedAt, so FINAL won't "revert"
          // a push that never happened.
          try {
            await this.prisma.client.auditLog.create({
              data: {
                tenantId,
                userId: null, // machine action — the sweep, not an operator
                action: 'SPORTS_AUTO_PUSH_BLOCKED',
                targetType: 'Game',
                targetId: gameId,
                details: JSON.stringify({
                  screenIds: Array.isArray(resp.screenIds) ? resp.screenIds : [],
                  screenNames: Array.isArray(resp.screenNames) ? resp.screenNames : [],
                }),
              },
            });
          } catch {
            /* best-effort */
          }
          return 'blocked';
        }
      }
      throw err;
    }

    // Persist the armed config WITH the captured saved state — a fresh
    // latest-wins record. savedState + pushedAt together are the FINAL
    // hook's "a push actually completed" signal.
    const pushedAt = new Date().toISOString();
    // The table's postgame hold (K12-F37) rides along unchanged.
    const pushed: AutoPushConfig = { ...config, armed: true, savedState, pushedAt, returnAt: null };
    await this.record(gameId, 'AUTO_PUSH', this.autoPushPayload(pushed));
    this.autoPushCache.set(gameId, pushed);
    try {
      await this.prisma.client.auditLog.create({
        data: {
          tenantId,
          userId: null, // machine action — the sweep, not an operator
          action: 'SPORTS_AUTO_PUSHED',
          targetType: 'Game',
          targetId: gameId,
          details: JSON.stringify({ screenIds: config.screenIds, surface: config.surface, pushedAt }),
        },
      });
    } catch {
      /* best-effort */
    }
    return 'pushed';
  }

  /**
   * FINAL hook (Inputs-wave SCHED + Show-Control slice 4) — called
   * POST-COMMIT from BOTH paths that can land status='FINAL': setStatus
   * (operator) and applySetWin (volleyball/pickleball set majority; the
   * 2026-08-10 recon §4 rules every other path out). ENTIRELY fail-open:
   * an error here must never break or roll back the operator's "end
   * game". Never reached on a suppressAutoFinal hold — the game HOLDS at
   * LIVE there and the operator's later setStatus is the FINAL signal.
   *
   * Three jobs:
   *   1. Cancel a still-pending auto-push (a game ended before its own
   *      kickoff−10 must not have its board go UP afterwards).
   *   2. Show-Control slice 4 — clear any ACTIVE recalled SCENE (a
   *      halftime/sponsor scene must not cover the final result).
   *   3. K12-F37 — if the armed config shows a completed push, HOLD the
   *      final result on those screens for the game's postgame hold
   *      (default POSTGAME_HOLD_DEFAULT_MINUTES; the table picks it on the
   *      schedule-game-mode card): the return time rides Game.autoPushAt, so
   *      the schedule sweep — on any replica, after any restart — gives the
   *      screens back when it arrives (returnPushedScreens). A hold of 0 gives
   *      them back now, which is all this step did before: the final board
   *      and the winning cue were cut the moment the game ended.
   *   Emergency precedence is unchanged: a screen's manifest serves an alert
   *   before any scoreboard, hold or not.
   */
  private async onGameFinal(tenantId: string, gameId: string): Promise<void> {
    try {
      // 1 — cancel a pending fire. Conditional updateMany: one statement,
      // writes only when something is actually pending.
      await this.prisma.client.game.updateMany({
        where: { id: gameId, tenantId, autoPushAt: { not: null } },
        data: { autoPushAt: null },
      });

      // 2 — end any ACTIVE scene. Same latest-wins + server-authoritative
      // expiry semantics getBoardFresh resolves; only writes a clearing
      // event when a scene is genuinely on-air, so a game that never used
      // scenes gets no extra row.
      const latestScene = await this.prisma.client.gameEvent.findFirst({
        where: { gameId, type: 'SCENE' },
        orderBy: { createdAt: 'desc' },
        select: { payload: true },
      });
      const sp = (latestScene?.payload as Record<string, unknown>) ?? {};
      const sceneExpiresAt = typeof sp.expiresAt === 'number' ? sp.expiresAt : 0;
      const sceneActive =
        !!latestScene &&
        sp.kind !== 'clear' &&
        typeof sp.templateId === 'string' &&
        (!sceneExpiresAt || Date.now() < sceneExpiresAt);
      if (sceneActive) await this.record(gameId, 'SCENE', { kind: 'clear' });

      // 3 — the pushed screens (K12-F37). Fresh read: the push may have
      // happened on another process.
      const config = await this.latestAutoPush(gameId, { fresh: true });
      if (!config?.armed) return;
      const holdMin = postgameHoldMinutes(config.holdMin);
      if (config.pushedAt && (config.savedState ?? []).length > 0 && holdMin > 0) {
        const returnAt = new Date(this.serverTimeMs() + holdMin * 60_000);
        const next: AutoPushConfig = { ...config, returnAt: returnAt.toISOString() };
        const held = await this.prisma.client.$transaction(async (tx: any) => {
          // Only while the game is still final: a reopen that raced this
          // post-commit hook keeps its board with no return pending.
          const res = await tx.game.updateMany({
            where: { id: gameId, tenantId, status: 'FINAL' },
            data: { autoPushAt: returnAt },
          });
          if (res.count === 0) return false;
          await tx.gameEvent.create({
            data: { gameId, type: 'AUTO_PUSH', payload: this.autoPushPayload(next) as any, actorType: 'system' },
          });
          await tx.auditLog.create({
            data: {
              tenantId,
              userId: null, // machine action — the FINAL transition
              action: 'SPORTS_POSTGAME_HOLD',
              targetType: 'Game',
              targetId: gameId,
              details: JSON.stringify({ screenIds: config.screenIds, holdMin, returnAt: next.returnAt }),
            },
          });
          return true;
        });
        if (held) {
          this.autoPushCache.set(gameId, next);
          wakeScheduleSweep();
        }
        return;
      }
      await this.returnPushedScreens(tenantId, gameId, config, 'final');
    } catch (err) {
      this.logger.error(
        `onGameFinal failed (non-fatal) game=${gameId} tenant=${tenantId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /**
   * Give a game's pushed screens back to their schedule and end schedule
   * game mode: hide the board from EXACTLY the pushed screens, restore any
   * screen whose pre-push pointer was a different still-unfinished game,
   * audit, disarm. What the FINAL transition did at once before the
   * postgame hold (K12-F37) — now at the end of the hold, on the table's
   * "Return screens now", or at once for a hold of 0.
   */
  private async returnPushedScreens(
    tenantId: string,
    gameId: string,
    config: AutoPushConfig,
    reason: 'final' | 'hold-ended' | 'returned-early' | 'hold-shortened' | 'disarmed',
  ): Promise<void> {
    const saved = config.savedState ?? [];
    if (config.pushedAt && saved.length > 0) {
      const savedScreenIds = saved.map((e) => e.screenId);
      // Scoped to EXACTLY the pushed ids — never undefined, which would
      // also hide the game from screens an operator pushed manually.
      await this.hideFromScreens(tenantId, gameId, savedScreenIds, {
        actor: { kind: 'system', ref: 'auto-push-revert' },
      });
      // Put back screens whose pre-push pointer was a DIFFERENT game —
      // only when that game still exists in this tenant and is not
      // itself FINAL, and only if the screen is still free (the hide
      // above just cleared it; a concurrent operator take-over is never
      // clobbered).
      const restored: Array<{ screenId: string; gameId: string }> = [];
      for (const e of saved) {
        if (!e.prevGameId || e.prevGameId === gameId) continue;
        const prev = await this.prisma.client.game.findFirst({
          where: { id: e.prevGameId, tenantId },
          select: { id: true, status: true },
        });
        if (!prev || prev.status === 'FINAL') continue;
        const res = await this.prisma.client.screen.updateMany({
          where: { id: e.screenId, tenantId, activeBoardGameId: null },
          data: { activeBoardGameId: e.prevGameId, activeBoardSurface: e.prevSurface },
        });
        if (res.count > 0) restored.push({ screenId: e.screenId, gameId: e.prevGameId });
      }
      // The hide's SYNC fired before the restores landed — nudge again
      // so a restored screen doesn't sit on scheduled content for 30s.
      if (restored.length > 0) await this.notifySync(tenantId);
      try {
        await this.prisma.client.auditLog.create({
          data: {
            tenantId,
            userId: null, // machine action — a person's request is audited by its caller
            action: 'SPORTS_AUTO_REVERTED',
            targetType: 'Game',
            targetId: gameId,
            details: JSON.stringify({ screenIds: savedScreenIds, restored, reason }),
          },
        });
      } catch {
        /* best-effort */
      }
    }
    // Disarm — the end of a game always ends schedule game mode, pushed or
    // not. The AUTO_PUSH event trail (armed:false after a pushedAt record)
    // is the forensic record for the machine disarm; SPORTS_AUTO_PUSH_DISARMED
    // stays reserved for the operator's own action.
    await this.record(gameId, 'AUTO_PUSH', { armed: false });
    this.autoPushCache.set(gameId, this.parseAutoPushPayload({ armed: false }));
  }

  /**
   * K12-F37 — end a finished game's postgame hold now: the table's "Return
   * screens now", turning schedule game mode off during the hold, or a
   * shorter hold that has already run out. The pending return is CLAIMED
   * (Game.autoPushAt → null, only while the game is final) in the same
   * transaction as the attributed audit row, so the sweep and a second tap
   * can never return the screens twice and the record of who did it cannot
   * be lost. Nothing pending → nothing to return (`returned: false`).
   */
  async returnPostgameScreens(
    tenantId: string,
    id: string,
    actor?: CommandInput,
    why: 'returned-early' | 'hold-shortened' | 'disarmed' = 'returned-early',
    known?: AutoPushConfig,
  ): Promise<{ returned: boolean }> {
    await this.owned(tenantId, id);
    const config = known ?? (await this.latestAutoPush(id, { fresh: true }));
    const claimed: boolean = await this.prisma.client.$transaction(async (tx: any) => {
      const res = await tx.game.updateMany({
        where: { id, tenantId, status: 'FINAL', autoPushAt: { not: null } },
        data: { autoPushAt: null },
      });
      if (res.count === 0) return false;
      await this.auditRow(tx, tenantId, actor, 'SPORTS_POSTGAME_RETURNED', id, {
        why,
        screenIds: config?.screenIds ?? [],
        returnAt: config?.returnAt ?? null,
      });
      return true;
    });
    if (claimed && config?.armed) {
      await this.returnPushedScreens(tenantId, id, config, why);
      return { returned: true };
    }
    // Turning the mode off still turns it off when there was nothing to return.
    if (why === 'disarmed') {
      await this.recordAudited(tenantId, id, 'AUTO_PUSH', { armed: false }, actor, 'SPORTS_AUTO_PUSH_DISARMED', (eventId) => ({
        eventId,
      }));
      this.autoPushCache.set(id, this.parseAutoPushPayload({ armed: false }));
    }
    return { returned: false };
  }

  // ── roster ───────────────────────────────────────────────────

  private cleanTeam(team: unknown): 'home' | 'away' {
    return String(team || '').toLowerCase() === 'away' ? 'away' : 'home';
  }

  /** Bound a free-text roster field — trim, cap length, null empties. */
  private cleanText(value: unknown, max: number): string | null {
    const s = String(value ?? '').trim().slice(0, max);
    return s || null;
  }

  /**
   * Normalize an untrusted stat map: string keys → string values,
   * trimmed and length-capped, max 24 entries. Keeps the scoreboard
   * safe from a pasted CSV with hundreds of junk columns.
   */
  private cleanStats(input: unknown): Record<string, string> {
    const out: Record<string, string> = {};
    if (input && typeof input === 'object') {
      for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
        const key = String(k).trim().slice(0, 24);
        if (!key) continue;
        const val = String(v ?? '').trim().slice(0, 40);
        if (!val) continue;
        out[key] = val;
        if (Object.keys(out).length >= 24) break;
      }
    }
    return out;
  }

  /**
   * Every player on a game, home + away, in display order. K-12 launch, lane
   * B3: `directoryOptOut` / `photoRelease` are the flags the PUBLIC view
   * actually applies — an opt-out recorded on the linked athlete counts, and a
   * linked student's photo release is the athlete's (see studentFlags) — so
   * the roster manager shows the truth, not just this row's own columns.
   */
  async listRoster(tenantId: string, gameId: string) {
    await this.owned(tenantId, gameId);
    const rows = await this.prisma.client.rosterPlayer.findMany({
      where: { gameId },
      orderBy: [{ team: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: { person: { select: { directoryOptOut: true, photoRelease: true } } },
    });
    return rows.map(({ person, ...row }) => {
      const flags = studentFlags({ ...row, person });
      return { ...row, directoryOptOut: flags.optOut, photoRelease: flags.photoRelease };
    });
  }

  /** Add one player to a game's roster. */
  async addPlayer(
    tenantId: string,
    gameId: string,
    dto: {
      team?: string; name?: string; number?: string;
      position?: string; photoUrl?: string; stats?: unknown;
    },
    actor?: CommandInput,
  ) {
    const game = await this.owned(tenantId, gameId);
    this.assertBoxScoreEditable(game);
    const name = this.cleanText(dto.name, 80);
    if (!name) throw new BadRequestException('Player name is required.');
    const team = this.cleanTeam(dto.team);
    const sortOrder = await this.prisma.client.rosterPlayer.count({
      where: { gameId, team },
    });
    const created = await this.prisma.client.$transaction(async (tx: any) => {
      await this.lockBoxScore(tx, tenantId, gameId);
      const row = await tx.rosterPlayer.create({
        data: {
          tenantId,
          gameId,
          team,
          name,
          number: this.cleanText(dto.number, 8),
          position: this.cleanText(dto.position, 24),
          photoUrl: this.cleanText(dto.photoUrl, 2048),
          stats: this.cleanStats(dto.stats),
          sortOrder,
        },
      });
      await this.auditRow(tx, tenantId, actor, 'SPORTS_ROSTER_PLAYER_ADDED', gameId, {
        playerId: row.id,
        team: row.team,
        number: row.number,
        stats: row.stats,
      });
      return row;
    });
    // 2026-06-25 — link the moment a HOME player is added so stats accumulate
    // (and the Share/athlete page works) without a CSV import or hand-linking.
    if (created.team === 'home') {
      await this.autoLinkHomeRoster(tenantId, gameId, (game as { homeTeamId?: string | null }).homeTeamId);
    }
    return created;
  }

  /**
   * K12-F13 — a FINAL game's box score is part of its official result (and
   * of the season totals rolled up from it), so adding, removing or
   * re-scoring a player needs the same reopen as any other correction.
   * Cosmetic roster edits (name, number, position, photo) stay open.
   */
  private assertBoxScoreEditable(game: { status?: string | null }): void {
    if (game.status === 'FINAL') {
      throw new ConflictException({
        code: 'GAME_FINAL',
        message: 'This game is final. Reopen it to correct its box score.',
      });
    }
  }

  /**
   * The race-free half of assertBoxScoreEditable, inside the box-score
   * edit's own transaction: a conditional write that bumps the game's
   * revision only while it is NOT final. It takes the game row's lock, so
   * the edit and a concurrent "end game" serialise — either the edit lands
   * first (and the FINAL command, whose compare-and-swap now misses, re-reads
   * and rolls up a box score that includes it) or FINAL lands first and the
   * edit is refused. A pre-read alone left a window where an edit committed
   * after the season roll-up had read the roster.
   */
  private async lockBoxScore(tx: any, tenantId: string, gameId: string): Promise<void> {
    const res = await tx.game.updateMany({
      where: { id: gameId, tenantId, status: { not: 'FINAL' } },
      data: { version: { increment: 1 } },
    });
    if (res.count === 0) {
      throw new ConflictException({
        code: 'GAME_FINAL',
        message: 'This game is final. Reopen it to correct its box score.',
      });
    }
  }

  /** Resolve a player within a tenant-owned game, or 404. */
  private async ownedPlayer(tenantId: string, gameId: string, playerId: string) {
    const game = await this.owned(tenantId, gameId);
    const player = await this.prisma.client.rosterPlayer.findFirst({
      where: { id: playerId, gameId, tenantId },
    });
    if (!player) throw new NotFoundException('Player not found');
    return { player, game };
  }

  /** Edit a player — only the keys present in the dto are touched. */
  async updatePlayer(
    tenantId: string,
    gameId: string,
    playerId: string,
    dto: {
      team?: string; name?: string; number?: string;
      position?: string; photoUrl?: string; stats?: unknown;
    },
    actor?: CommandInput,
  ) {
    const { game, player } = await this.ownedPlayer(tenantId, gameId, playerId);
    const boxScoreEdit = dto.stats !== undefined || dto.team !== undefined;
    if (boxScoreEdit) this.assertBoxScoreEditable(game);
    const data: Record<string, unknown> = {};
    if (dto.team !== undefined) data.team = this.cleanTeam(dto.team);
    if (dto.name !== undefined) {
      const n = this.cleanText(dto.name, 80);
      if (!n) throw new BadRequestException('Player name cannot be empty.');
      data.name = n;
    }
    if (dto.number !== undefined) data.number = this.cleanText(dto.number, 8);
    if (dto.position !== undefined) data.position = this.cleanText(dto.position, 24);
    if (dto.photoUrl !== undefined) data.photoUrl = this.cleanText(dto.photoUrl, 2048);
    if (dto.stats !== undefined) data.stats = this.cleanStats(dto.stats);
    const before: Record<string, unknown> = {};
    for (const k of Object.keys(data)) before[k] = (player as Record<string, unknown>)[k] ?? null;
    return this.prisma.client.$transaction(async (tx: any) => {
      if (boxScoreEdit) await this.lockBoxScore(tx, tenantId, gameId);
      const updated = await tx.rosterPlayer.update({ where: { id: playerId, tenantId }, data });
      await this.auditRow(tx, tenantId, actor, 'SPORTS_ROSTER_PLAYER_UPDATED', gameId, {
        playerId,
        fields: Object.keys(data),
        before,
        after: data,
      });
      return updated;
    });
  }

  /** Remove a player from the roster. */
  async deletePlayer(tenantId: string, gameId: string, playerId: string, actor?: CommandInput) {
    const { game, player } = await this.ownedPlayer(tenantId, gameId, playerId);
    this.assertBoxScoreEditable(game);
    await this.prisma.client.$transaction(async (tx: any) => {
      await this.lockBoxScore(tx, tenantId, gameId);
      await tx.rosterPlayer.delete({ where: { id: playerId, tenantId } });
      // The row is gone, so the audit row keeps what was removed.
      await this.auditRow(tx, tenantId, actor, 'SPORTS_ROSTER_PLAYER_REMOVED', gameId, {
        playerId,
        team: player.team,
        number: player.number,
        stats: player.stats,
      });
    });
    return { deleted: true };
  }

  /**
   * Parse one CSV line into cells — handles double-quoted fields with
   * embedded commas and "" escapes. Good enough for roster CSVs an
   * operator exports from a spreadsheet.
   */
  private parseCsvLine(line: string): string[] {
    const cells: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"') {
          if (line[i + 1] === '"') { cur += '"'; i++; }
          else inQuotes = false;
        } else { cur += ch; }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        cells.push(cur); cur = '';
      } else { cur += ch; }
    }
    cells.push(cur);
    return cells.map((c) => c.trim());
  }

  /**
   * Bulk-import a roster from CSV text. The header row names the
   * columns: `team`, `name`/`player`, `number`/`no`/`#`,
   * `position`/`pos`, and `photo`/`photourl` are recognized — EVERY
   * other column becomes a stat keyed by its (upper-cased) header.
   * Imported players are appended; existing roster is kept.
   */
  /**
   * Auto-link the HOME roster to persistent athletes (find-or-create by name)
   * so finalize can roll up season + career stats WITHOUT the operator hand-
   * linking every row. HOME ONLY — never opponents, so a visitor/typo can't
   * pollute the persistent athlete tables. Best-effort + per-row try/catch:
   * linking must NEVER throw into the caller. Returns how many rows it linked.
   *
   * 2026-06-25 — extracted from importRosterCsv so EVERY roster-build path
   * links, not just CSV import. The live water-polo install had 28 home roster
   * players, 0 linked (built manually, not via CSV), so finalize had nothing to
   * roll up. Now: add a player → it links; finalize a game → unlinked home rows
   * self-link first (back-fills any roster, however it was built).
   */
  private async autoLinkHomeRoster(
    tenantId: string,
    gameId: string,
    homeTeamId?: string | null,
  ): Promise<number> {
    let linked = 0;
    try {
      const homeRows = await this.prisma.client.rosterPlayer.findMany({
        where: { gameId, team: 'home', personId: null },
        select: { id: true, name: true },
      });
      for (const rp of homeRows) {
        if (!rp.name || !rp.name.trim()) continue;
        try {
          await linkRosterPlayerToPerson(this.prisma.client, {
            tenantId,
            rosterPlayerId: rp.id,
            fullName: rp.name,
            teamId: homeTeamId ?? undefined,
          });
          linked++;
        } catch {
          /* one unmatchable name never blocks the rest */
        }
      }
    } catch {
      /* auto-link is additive convenience — caller already succeeded */
    }
    return linked;
  }

  async importRosterCsv(tenantId: string, gameId: string, csvText: string, actor?: CommandInput) {
    const game = await this.owned(tenantId, gameId);
    this.assertBoxScoreEditable(game);
    const lines = String(csvText || '')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    if (lines.length < 2) {
      throw new BadRequestException('CSV needs a header row and at least one player row.');
    }
    if (lines.length - 1 > 200) {
      throw new BadRequestException('CSV is limited to 200 players per import.');
    }
    const header = this.parseCsvLine(lines[0]).map((h) => h.toLowerCase());
    const idxOf = (...keys: string[]) => header.findIndex((h) => keys.includes(h));
    const nameIdx = idxOf('name', 'player');
    if (nameIdx < 0) {
      throw new BadRequestException('CSV must have a "name" column.');
    }
    const teamIdx = idxOf('team');
    const numberIdx = idxOf('number', 'no', '#');
    const posIdx = idxOf('position', 'pos');
    const photoIdx = idxOf('photo', 'photourl', 'photo_url');
    // K-12 launch, lane B3: a district's SIS export can carry its directory
    // opt-out list. Only the PROTECTIVE flag is importable — a photo release
    // is recorded per student by a school administrator, never in bulk.
    const optOutIdx = idxOf('opt_out', 'optout', 'opt-out', 'directory_opt_out', 'directoryoptout');
    const isYes = (v: unknown) => /^(y|yes|true|1|x|opted out|opt out)$/i.test(String(v ?? '').trim());
    const FIELD = new Set([
      'team', 'name', 'player', 'number', 'no', '#',
      'position', 'pos', 'photo', 'photourl', 'photo_url',
      'opt_out', 'optout', 'opt-out', 'directory_opt_out', 'directoryoptout',
    ]);

    const [homeCount, awayCount] = await Promise.all([
      this.prisma.client.rosterPlayer.count({ where: { gameId, team: 'home' } }),
      this.prisma.client.rosterPlayer.count({ where: { gameId, team: 'away' } }),
    ]);
    const nextOrder: Record<string, number> = { home: homeCount, away: awayCount };

    const rows: any[] = [];
    for (let r = 1; r < lines.length; r++) {
      const cells = this.parseCsvLine(lines[r]);
      const name = this.cleanText(cells[nameIdx], 80);
      if (!name) continue;
      const team = this.cleanTeam(teamIdx >= 0 ? cells[teamIdx] : 'home');
      const stats: Record<string, string> = {};
      header.forEach((h, i) => {
        if (!h || FIELD.has(h)) return;
        const val = String(cells[i] ?? '').trim();
        if (val) stats[h.toUpperCase()] = val;
      });
      rows.push({
        tenantId,
        gameId,
        team,
        name,
        number: numberIdx >= 0 ? this.cleanText(cells[numberIdx], 8) : null,
        position: posIdx >= 0 ? this.cleanText(cells[posIdx], 24) : null,
        photoUrl: photoIdx >= 0 ? this.cleanText(cells[photoIdx], 2048) : null,
        stats: this.cleanStats(stats),
        sortOrder: nextOrder[team]++,
        ...(optOutIdx >= 0 && isYes(cells[optOutIdx]) ? { directoryOptOut: true } : {}),
      });
    }
    if (rows.length === 0) {
      throw new BadRequestException('No valid player rows found in the CSV.');
    }
    await this.prisma.client.$transaction(async (tx: any) => {
      await this.lockBoxScore(tx, tenantId, gameId);
      await tx.rosterPlayer.createMany({ data: rows });
      await this.auditRow(tx, tenantId, actor, 'SPORTS_ROSTER_IMPORTED', gameId, {
        players: rows.length,
        home: rows.filter((r) => r.team === 'home').length,
        away: rows.filter((r) => r.team === 'away').length,
        directoryOptOuts: rows.filter((r) => r.directoryOptOut === true).length,
        statColumns: header.filter((h) => h && !FIELD.has(h)).map((h) => h.toUpperCase()),
      });
    });

    // S0 (2026-06-22) — auto-link the HOME roster to persistent athletes so
    // season + career stats accumulate without hand-linking every row. Shared
    // helper (2026-06-25) so CSV import, manual add, and finalize all link the
    // same way.
    await this.autoLinkHomeRoster(tenantId, gameId, game.homeTeamId);

    return this.listRoster(tenantId, gameId);
  }

  /** Adjust a score by a signed delta (the quick +1/+2/+3/… buttons). */
  async adjustScore(
    tenantId: string,
    id: string,
    dto: { team?: string; delta?: number },
    actor?: CommandInput,
    opts?: { suppressAutoFinal?: boolean },
  ) {
    const team = dto.team === 'away' ? 'away' : 'home';
    const delta = Number(dto.delta);
    if (!Number.isFinite(delta) || !Number.isInteger(delta)) {
      throw new BadRequestException('delta must be an integer');
    }
    // Scorekeeper share-link boundary (refuter P2, Phase-2 SHARE): a console
    // tap may credit a winning set, but FINAL stays operator-only — the game
    // HOLDS at LIVE with the set majority on the board until the operator
    // ends it.
    const holdFinal = opts?.suppressAutoFinal === true;
    return this.runGameCommand(tenantId, id, 'score.adjust', actor, dto, async (scope) => {
      const game = scope.before;
      const def = this.sportOf(game);
      const col = team === 'home' ? 'homeScore' : 'awayScore';
      const prevScores = {
        homeScore: Number(game.homeScore) || 0,
        awayScore: Number(game.awayScore) || 0,
      };
      // A score never goes below zero. What the tap ACTUALLY changed is what
      // gets written, recorded and (later) undone — a −1 at 0 changes nothing,
      // so undoing it can never award a point (K12-08).
      const nextScore = Math.max(0, prevScores[col] + delta);
      const applied = nextScore - prevScores[col];
      const point = { ...prevScores, [col]: nextScore };

      // Volleyball / pickleball: the set-win threshold is evaluated on THIS
      // command's fresh state and lands in the SAME write, so two winning taps
      // racing each other can only credit one set (K12-F12) and undoing the
      // winning point restores score, set count and period together (K12-06).
      const setWin = this.evaluateSetWin(def, game, point.homeScore, point.awayScore, holdFinal);
      const updated = await scope.write(
        setWin ? setWin.data : { [col]: { increment: applied } },
      );
      await scope.event('SCORE', {
        team,
        delta,
        appliedDelta: applied,
        homeScore: point.homeScore,
        awayScore: point.awayScore,
        prevHomeScore: prevScores.homeScore,
        prevAwayScore: prevScores.awayScore,
        change: scope.change(),
      });
      // Audit-Fix 1: a manual quick-button fires the same AUTO celebration a
      // feed would, off the post-point score (before any set reset).
      await this.autoCelebrateInCommand(
        scope,
        prevScores,
        { ...updated, ...point },
        { home: team === 'home', away: team === 'away' },
        'manual',
      );
      if (setWin) await this.recordSetWin(scope, def, setWin, updated);
      return updated;
    });
  }

  /** Set one or both scores outright (operator typo fix). */
  async setScore(
    tenantId: string,
    id: string,
    dto: { homeScore?: number; awayScore?: number },
    actor?: CommandInput,
  ) {
    // Only the columns the operator actually supplied (valid, non-negative
    // integers) are written. Rewriting the OTHER team's score from this
    // command's read erased a concurrent point for that team (K12-18).
    const supplied: { homeScore?: number; awayScore?: number } = {};
    for (const key of ['homeScore', 'awayScore'] as const) {
      if (dto[key] === undefined) continue;
      const n = Number(dto[key]);
      if (Number.isFinite(n) && Number.isInteger(n) && n >= 0) supplied[key] = n;
    }
    return this.runGameCommand(tenantId, id, 'score.set', actor, dto, async (scope) => {
      const game = scope.before;
      if (Object.keys(supplied).length === 0) return game;
      const prevScores = {
        homeScore: Number(game.homeScore) || 0,
        awayScore: Number(game.awayScore) || 0,
      };
      const updated = await scope.write(supplied);
      await scope.event('SCORE', {
        team: 'set',
        homeScore: updated.homeScore,
        awayScore: updated.awayScore,
        prevHomeScore: prevScores.homeScore,
        prevAwayScore: prevScores.awayScore,
        change: scope.change(),
      });
      // Audit-Fix 1: a manual set fires the same AUTO celebration path as the
      // feed, for the columns the operator supplied only.
      await this.autoCelebrateInCommand(
        scope,
        prevScores,
        updated,
        { home: supplied.homeScore !== undefined, away: supplied.awayScore !== undefined },
        'manual',
      );
      return updated;
    });
  }

  /**
   * Volleyball / pickleball set-and-match rule, evaluated on the post-point
   * scores of the command being applied, under the game's own set format
   * (K12-F19, `setFormat` of its rules profile): a set is won at its target
   * by the winning margin, or at the cap by any margin — varsity volleyball
   * 25 (the fifth set 15) by two with no cap; UIL sub-varsity and junior
   * high 25 by two, capped at 30 [uil-volleyball-rally]; a local pickleball
   * format's target. Winning credits the set, zeroes the rally score,
   * refills a per-set timeout bank and advances the set; winning the
   * majority ends the match (FINAL), unless `holdFinal` (console share link)
   * or a format whose match never ends itself (UIL junior high: the deciding
   * set may be played by mutual consent) — the set is credited and the game
   * holds at LIVE for the table. Returns the game patch, or null when no set
   * was won.
   */
  private evaluateSetWin(
    def: SportDefinition,
    game: GameRow,
    home: number,
    away: number,
    holdFinal: boolean,
  ): null | {
    winner: 'home' | 'away';
    final: boolean;
    segment: number | null;
    data: Record<string, unknown>;
  } {
    if (def.key !== 'volleyball' && def.key !== 'pickleball') return null;
    const format = setFormatOf(def);
    if (!format) return null;
    const deciding = game.segment >= def.segment.count;
    const winner = setWinner(format, deciding, home, away);
    if (!winner) return null;

    const n = (v: unknown) => (typeof v === 'number' && isFinite(v) ? v : 0);
    const isPickle = def.key === 'pickleball';
    const homeKey = isPickle ? 'homeGames' : 'homeSets';
    const awayKey = isPickle ? 'awayGames' : 'awaySets';
    const stats = { ...((game.stats as Record<string, unknown>) || {}) };
    const wonKey = winner === 'home' ? homeKey : awayKey;
    stats[wonKey] = n(stats[wonKey]) + 1;
    // K12-F18 — keep the set's final points (the rally score is zeroed
    // below): the final board prints the match set by set. Same write as the
    // credit, so undoing the winning point takes both back.
    stats[SET_SCORES_KEY] = appendSetScore(game.stats, home, away);
    // Best of N: the majority wins (best of five → three sets).
    const needed = setsToWin(format);
    const matchOver = n(stats[homeKey]) >= needed || n(stats[awayKey]) >= needed;

    const data: Record<string, unknown> = { stats, homeScore: 0, awayScore: 0 };
    let segment: number | null = null;
    const final = matchOver && !holdFinal && format.autoFinal !== false;
    if (final) {
      data.status = 'FINAL';
      data.endedAt = new Date();
      data.clockRunning = false;
    } else if (matchOver && format.autoFinal !== false) {
      // Set credited; the segment stays put (already the deciding set).
      segment = game.segment;
      data.segment = segment;
    } else {
      segment = Math.min(def.segment.count, game.segment + 1);
      data.segment = segment;
      if (segment !== game.segment) this.refillSetTimeouts(def, stats);
    }
    return { winner, final, segment, data };
  }

  /**
   * K12-F19 — a new set refills a per-set timeout bank (volleyball: two per
   * set [uil-volleyball-rally]). Only for rules whose bank is per set; the
   * classic rules have none.
   */
  private refillSetTimeouts(
    def: SportDefinition,
    stats: Record<string, unknown>,
  ): void {
    if (def.timeouts?.per !== 'set') return;
    const allocation = timeoutAllocation(def);
    for (const key of ['homeTimeouts', 'awayTimeouts'] as const) {
      if (def.stats.some((s) => s.key === key)) stats[key] = allocation;
    }
  }

  /** The event trail of a won set (inside the scoring command's transaction). */
  private async recordSetWin(
    scope: GameCommandScope,
    def: SportDefinition,
    setWin: NonNullable<ReturnType<SportsService['evaluateSetWin']>>,
    updated: GameRow,
  ): Promise<void> {
    if (setWin.final) {
      await scope.event('STATUS', { status: 'FINAL', source: 'set-majority' });
      // K12-F39 — a set-majority FINAL is a FINAL: its season roll-up is
      // queued like the operator's (it used to skip the roll-up entirely).
      await this.queueStatRollup(scope, updated);
      // Inputs-wave SCHED — the automatic set-majority FINAL runs the same
      // post-commit hook the operator's setStatus does (fail-open inside).
      scope.after(() => this.onGameFinal(updated.tenantId, updated.id));
    } else {
      await scope.event('SEGMENT', { segment: setWin.segment, source: 'set-win' }, { derived: true });
    }
    // T2-10: the sport's 'setWin' celebration.
    const setWinCue = def.celebrations.find((c) => c.key === 'setWin');
    if (setWinCue) {
      await scope.event('CUE', {
        key: setWinCue.key,
        label: setWinCue.label,
        emoji: setWinCue.emoji,
        target: 'ALL',
        audioUrl: null,
        sponsorName: null,
        sponsorLogoUrl: null,
        auto: true,
        team: setWin.winner,
        source: 'rule',
        snapshot: this.cueSnapshot(updated),
      });
    }
    // K12-F18 — a match the set majority ended announces its result like
    // every other FINAL (it used to end with the set cue alone).
    if (setWin.final) await scope.event('CUE', this.finalResultCue(updated, 'set-majority'));
  }

  /**
   * K12-F18 — the FINAL cue: its key, the score line it freezes and a copy of
   * the result all come from gameResult (@cms/api-types sports-result.ts) —
   * the sport's result model under the game's own rules. A 3–1 volleyball
   * match whose rally columns were zeroed announces 3–1 for home; it used to
   * compare the zeroed columns and announce "tied". A result with no deciding
   * totals is `status:final-none`, never a tie.
   */
  private finalResultCue(game: GameRow, source: string): Record<string, unknown> {
    const result = gameResult(game);
    const snapshot = this.cueSnapshot(game);
    snapshot.homeScore = result.home;
    snapshot.awayScore = result.away;
    // "3–1 · SET 4" would read as the fourth set's score: a sets or dual
    // total carries no period or clock beside it.
    if (result.basis === 'sets' || result.basis === 'team-points') {
      snapshot.segmentLabel = '';
      snapshot.clockText = '';
    }
    return {
      key: finalCueKey(result),
      label: 'Final',
      emoji: '🏆',
      target: 'ALL',
      auto: true,
      source,
      snapshot,
      result: {
        basis: result.basis,
        outcome: result.outcome,
        winner: result.winner,
        home: result.home,
        away: result.away,
        homeText: result.homeText,
        awayText: result.awayText,
        revision: result.revision,
      },
    };
  }

  /** Clock control: start | pause | set | reset. */
  async clockAction(
    tenantId: string,
    id: string,
    dto: { action?: string; ms?: number },
    actor?: CommandInput,
  ) {
    const action = String(dto.action || '') as ClockAction;
    if (!['start', 'pause', 'set', 'reset'].includes(action)) {
      throw new BadRequestException('action must be start | pause | set | reset');
    }
    const setMs = Number(dto.ms);
    if (action === 'set' && (!Number.isFinite(setMs) || setMs < 0)) {
      throw new BadRequestException('ms must be a non-negative number');
    }
    return this.runGameCommand(tenantId, id, `clock.${action}`, actor, dto, async (scope) => {
      const game = scope.before;
      const def = this.sportOf(game);
      if (action === 'start' && def.clock.type === 'none') {
        throw new BadRequestException(`${def.name} has no game clock`);
      }
      const now = this.clockNow();
      if (action === 'start') {
        // K12-F08 — a clock that has run out does not start again: the
        // period is held for the table. Starting it would only re-expire it
        // on the next sweep and sound the horn a second time.
        if (isUntimedSegment(def, game.segment)) {
          throw new ConflictException({
            code: 'CLOCK_UNTIMED_PERIOD',
            message: 'This period is untimed, so there is no game clock to start.',
          });
        }
        if (isGameClockExpired(def, game.stats, projectGameClockMs(game, def.clock.type, now.getTime()))) {
          throw new ConflictException({
            code: 'CLOCK_EXPIRED',
            message:
              'The clock has run out for this period. Set the time left (or add stoppage time), or move to the next period.',
          });
        }
      }
      const t = this.clockTransition(game, def, action, setMs, now);
      const updated = await scope.write(t.data);
      await scope.event('CLOCK', {
        action,
        clockMs: t.clockMs,
        clockRunning: t.clockRunning,
        prevClockMs: game.clockMs,
        prevClockRunning: game.clockRunning,
        change: scope.change(),
      });

      // T2-5: auto-clear a live overlay when the clock starts. Penalty /
      // injury overlays disappear the moment play resumes; review overlays
      // are persistent by design and need an explicit clear.
      if (action === 'start') {
        const latestOverlay = await scope.tx.gameEvent.findFirst({
          where: { gameId: id, type: 'LIVE_OVERLAY' },
          orderBy: { createdAt: 'desc' },
          select: { id: true, payload: true },
        });
        const overlayKind = (latestOverlay?.payload as Record<string, unknown> | undefined)?.kind;
        if (overlayKind && overlayKind !== 'clear' && overlayKind !== 'review') {
          await scope.event('LIVE_OVERLAY', { kind: 'clear', auto: true, reason: 'clock-start' });
        }
      }
      // Efficiency #3: a started clock snaps the auto-advance sweep out of
      // its 30s idle backoff so expiry detection is 1s-fresh.
      if (t.clockRunning) scope.after(() => wakeClockSweep());
      return updated;
    });
  }

  /**
   * The game-clock patch for one clock action, computed from ONE read of the
   * game so the game clock, penalty box and shot clock are all re-anchored on
   * the same instant and written in the same statement.
   *
   * Penalties slave to the game clock — a whistle that stops the game clock
   * freezes the whole penalty box; a start resumes it (skipped when the box
   * is empty). 2026-05-27: the shot clock also slaves to it, on start/pause
   * transitions only — set/reset edit the game clock alone without touching
   * the possession's shot clock.
   *
   * The football PLAY clock does NOT (K12-F06): it runs on its own. An
   * incomplete pass stops the game clock and starts a 40 s play clock; the
   * game clock then starts on the snap while the play clock is reset for the
   * next down (NFHS 2025 instructions for game and play-clock operators).
   * Slaving it froze the play clock at every incomplete pass — the table
   * could not run a standard stopped-clock down.
   */
  private clockTransition(
    game: GameRow,
    def: SportDefinition,
    action: ClockAction,
    setMs: number,
    now: Date,
  ): { data: Record<string, unknown>; clockMs: number; clockRunning: boolean } {
    let clockMs: number = game.clockMs;
    let clockRunning: boolean = game.clockRunning;
    // Every reading is projected at `now` — the one instant the whole
    // transition (game clock, penalty box, shot clock) is anchored on.
    switch (action) {
      case 'start':
        // Re-anchor at the current reading and let it run.
        clockMs = projectGameClockMs(game, def.clock.type, now.getTime());
        clockRunning = true;
        break;
      case 'pause':
        // Freeze: store the live reading, stop advancing.
        clockMs = projectGameClockMs(game, def.clock.type, now.getTime());
        clockRunning = false;
        break;
      case 'set':
        clockMs = Math.round(setMs);
        break;
      case 'reset':
        // An untimed period (football OT) has no clock to reset to.
        clockMs = isUntimedSegment(def, game.segment) ? 0 : this.segmentStartMs(def, game.stats, game.segment);
        clockRunning = false;
        break;
    }
    const data: Record<string, unknown> = { clockMs, clockRunning, clockUpdatedAt: now };
    const clockMutated = action === 'start' || action === 'pause';
    let mergedStats = this.syncPenaltiesToClock(game.stats, clockRunning, now);
    const sourceStats = mergedStats || game.stats;
    // T2-10 / Invariant #6: the shot clock is clamped to the post-action game
    // clock (the "0:08 left in Q4" case).
    const shotStats = this.syncShotClockToGameClock(
      sourceStats,
      clockMutated,
      clockRunning,
      now,
      clockMs,
      def.shotClock?.full,
    );
    if (shotStats) mergedStats = shotStats;
    if (mergedStats) data.stats = mergedStats;
    return { data, clockMs, clockRunning };
  }

  /**
   * K12-F07 — the patch that stops EVERY clock of a game at its current
   * reading, anchored on one instant: the game clock (with the penalty box and
   * the shot clock it carries — clockTransition 'pause') and the football
   * play clock, which runs on its own and so is frozen separately. For the
   * phase changes that stop all play (halftime, the final).
   */
  private freezeAllClocks(game: GameRow, now: Date): Record<string, unknown> {
    const def = this.sportOf(game);
    const out: Record<string, unknown> =
      def.clock.type === 'none' ? {} : this.clockTransition(game, def, 'pause', 0, now).data;
    const base = (out.stats ?? game.stats) as unknown;
    const stats: Record<string, unknown> | null =
      base && typeof base === 'object' && !Array.isArray(base) ? { ...(base as Record<string, unknown>) } : null;
    const pc = stats?.playClock;
    if (stats && pc && typeof pc === 'object' && (pc as Record<string, unknown>).running) {
      stats.playClock = {
        ...(pc as Record<string, unknown>),
        ms: projectCountdownMs(pc as Record<string, unknown>, now.getTime()),
        at: now.toISOString(),
        running: false,
      };
      out.stats = stats;
    }
    return out;
  }

  /**
   * The possession / shot clock — a second countdown beside the game clock
   * (basketball, water polo, lacrosse). Stored in Game.stats.shotClock
   * `{ len, ms, at, running }` (no schema column); every surface projects it
   * from its anchor like the game clock.
   *
   * K12-F05 — the table's configuration is never changed behind its back:
   *   - `configure 0` switches it OFF, and OFF survives every start, pause,
   *     timeout, period change, clock expiry and reload (it used to become
   *     24 s the next time the game clock started);
   *   - a configured length (35 s) is the length every reset returns to,
   *     period boundaries included (a period advance used to reset it to the
   *     sport's 24 s default);
   *   - an unsupported length, a reset above the configured length, a shot
   *     clock on a sport that has none, or a start / stop / reset while it
   *     is OFF is REFUSED with a reason — never silently turned into OFF or
   *     clamped.
   * A shot clock that was never configured ('unset') still arms itself at
   * the sport's default the first time it is needed, so nobody has to find a
   * setup step before tip-off.
   */
  async setShotClock(
    tenantId: string,
    id: string,
    dto: { action?: string; value?: number },
    actor?: CommandInput,
  ) {
    const action = String(dto.action || '');
    if (!['configure', 'start', 'stop', 'reset'].includes(action)) {
      throw new BadRequestException('action must be configure | start | stop | reset');
    }
    return this.runGameCommand(tenantId, id, `shot-clock.${action}`, actor, dto, (scope) =>
      scope.write({ stats: this.shotClockPatch(scope.before, action, dto.value, this.clockNow()) }),
    );
  }

  /** The stats blob after one shot-clock action on `game` (see setShotClock). */
  private shotClockPatch(
    game: GameRow,
    action: string,
    value: number | undefined,
    now: Date,
  ): Record<string, unknown> {
    const def = this.sportOf(game);
    const cfg = def.shotClock;
    if (!cfg) {
      throw new BadRequestException({
        code: 'SHOT_CLOCK_UNSUPPORTED',
        message: `${def.name} has no shot clock.`,
      });
    }
    const stats: Record<string, unknown> =
      game.stats && typeof game.stats === 'object'
        ? { ...(game.stats as Record<string, unknown>) }
        : {};
    const mode = shotClockMode(stats);
    const nowIso = now.toISOString();

    if (action === 'configure') {
      // value = the length in seconds — one of the sport's published
      // options (lacrosse 60/80/90, water polo 20/30, basketball 24/30/35),
      // 0 = off. Anything else is refused: an unsupported pick used to
      // become OFF without a word.
      const v = Number(value);
      if (!Number.isInteger(v) || !cfg.options.includes(v)) {
        throw new BadRequestException({
          code: 'SHOT_CLOCK_LENGTH_UNSUPPORTED',
          message: `A ${def.name.toLowerCase()} shot clock can be ${cfg.options
            .map((o) => (o === 0 ? 'off' : `${o} seconds`))
            .join(', ')}.`,
          allowed: cfg.options,
        });
      }
      if (v === 0) {
        // OFF is a real, persisted state, marked so it can never be taken
        // for "never configured" and re-armed by the next game-clock start.
        stats.shotClock = { len: 0, ms: 0, at: nowIso, running: false, off: true };
        return stats;
      }
      stats.shotClock = {
        len: v,
        ms: this.clampShotToGameClock(game, def, v * 1000, now),
        at: nowIso,
        running: false,
      };
      return stats;
    }

    if (mode === 'off') {
      throw new ConflictException({
        code: 'SHOT_CLOCK_OFF',
        message: 'The shot clock is off for this game. Turn it on in Setup first.',
      });
    }
    // Never configured → it runs at the sport's default length, the same
    // default the first game-clock start arms it with.
    const prev = mode === 'on' ? (stats.shotClock as Record<string, unknown>) : null;
    const len = prev ? Number(prev.len) : cfg.full;
    let ms = prev ? projectCountdownMs(prev, now.getTime()) : len * 1000;
    let running = prev ? !!prev.running : false;
    switch (action) {
      case 'start':
        running = true;
        break;
      case 'stop':
        running = false;
        break;
      case 'reset': {
        // value = the seconds to reset to: the full length or a partial
        // reset (14 after a basketball offensive rebound). Omitted = full.
        const v = value === undefined || value === null ? len : Number(value);
        if (!Number.isInteger(v) || v < 1 || v > len) {
          throw new BadRequestException({
            code: 'SHOT_CLOCK_RESET_INVALID',
            message: `A shot-clock reset must be a whole number of seconds from 1 to ${len}.`,
            max: len,
          });
        }
        ms = v * 1000;
        // 2026-05-27 (operator bug 51494dff): a reset runs on its own only
        // while the GAME clock is running. During a dead ball it parks at the
        // new value and starts with the game clock.
        running = !!game.clockRunning;
        break;
      }
    }
    stats.shotClock = {
      len,
      ms: this.clampShotToGameClock(game, def, ms, now),
      at: nowIso,
      running,
    };
    return stats;
  }

  /**
   * T2-10 / Invariant #6 — a shot clock never reads above the time left in
   * the period ("0:08 left in Q4, shot clock still showing 24").
   */
  private clampShotToGameClock(game: GameRow, def: SportDefinition, ms: number, now: Date): number {
    if (def.clock.type !== 'countdown') return ms;
    return Math.min(ms, projectGameClockMs(game, def.clock.type, now.getTime()));
  }

  /**
   * The football play clock — the 40 / 25-second count to the snap, stored
   * in Game.stats.playClock `{ ms, at, running }`. K12-F06: it is its OWN
   * clock — start, stop and reset never depend on the game clock, and the
   * game clock's start / pause / expiry never touch it (see clockTransition).
   *
   *   start  — run from the current reading (a count that hit 0 stays at 0
   *            until the table resets it: NFHS, a delay-of-game count is held
   *            at zero until the penalty is enforced)
   *   stop   — freeze at the current reading
   *   reset  — to 40 (after a normal down) or 25 (after an administrative
   *            stoppage) — the sport's two presets, nothing else. Runs at
   *            once unless `run: false` parks it: the snap sets it to 40
   *            without running, and a 25 count waits for the referee's
   *            ready-for-play signal.
   *
   * NFHS instruction M: a play clock that would START with more time than is
   * left in the quarter while the game clock is running is turned off, so the
   * offense is never shown more time than it has. It is stored `off: true`
   * (not running, hidden on the board) until the next start / reset.
   */
  async setPlayClock(
    tenantId: string,
    id: string,
    dto: { action?: string; value?: number; run?: boolean },
    actor?: CommandInput,
  ) {
    const action = String(dto.action || '');
    if (!['start', 'stop', 'reset'].includes(action)) {
      throw new BadRequestException('action must be start | stop | reset');
    }
    if (dto.run !== undefined && typeof dto.run !== 'boolean') {
      throw new BadRequestException('run must be true or false');
    }
    return this.runGameCommand(tenantId, id, `play-clock.${action}`, actor, dto, (scope) =>
      scope.write({
        stats: this.playClockPatch(scope.before, action, dto.value, dto.run !== false, this.clockNow()),
      }),
    );
  }

  /** The stats blob after one play-clock action on `game` (see setPlayClock). */
  private playClockPatch(
    game: GameRow,
    action: string,
    value: number | undefined,
    run: boolean,
    now: Date,
  ): Record<string, unknown> {
    const def = this.sportOf(game);
    const cfg = def.playClock;
    if (!cfg) {
      throw new BadRequestException({
        code: 'PLAY_CLOCK_UNSUPPORTED',
        message: `${def.name} has no play clock.`,
      });
    }
    const stats: Record<string, unknown> =
      game.stats && typeof game.stats === 'object'
        ? { ...(game.stats as Record<string, unknown>) }
        : {};
    const prev =
      stats.playClock && typeof stats.playClock === 'object' && !Array.isArray(stats.playClock)
        ? (stats.playClock as Record<string, unknown>)
        : null;
    let ms = prev ? projectCountdownMs(prev, now.getTime()) : cfg.full * 1000;
    let running = prev ? !!prev.running : false;

    switch (action) {
      case 'start':
        running = true;
        break;
      case 'stop':
        running = false;
        break;
      case 'reset': {
        const v = value === undefined || value === null ? cfg.full : Number(value);
        if (v !== cfg.full && v !== cfg.short) {
          throw new BadRequestException({
            code: 'PLAY_CLOCK_RESET_INVALID',
            message: `The play clock resets to ${cfg.full} or ${cfg.short} seconds.`,
            allowed: [cfg.full, cfg.short],
          });
        }
        ms = v * 1000;
        running = run;
        break;
      }
    }

    const nowIso = now.toISOString();
    if (running && def.clock.type === 'countdown' && game.clockRunning && !isUntimedSegment(def, game.segment)) {
      const left = projectGameClockMs(game, def.clock.type, now.getTime());
      if (ms > left) {
        stats.playClock = { ms, at: nowIso, running: false, off: true };
        return stats;
      }
    }
    // A stop leaves a clock the rule turned off still off; any start or
    // reset re-decides it above.
    const off = action === 'stop' && prev?.off === true;
    stats.playClock = off ? { ms, at: nowIso, running, off: true } : { ms, at: nowIso, running };
    return stats;
  }

  /**
   * Project one stored penalty anchor to its live remaining ms — the
   * same anchor math the game clock uses. A frozen penalty reads its
   * stored ms; a running one subtracts elapsed wall time.
   */
  private projectPenaltyMs(p: Record<string, unknown>, nowMs: number): number {
    const ms = Math.max(0, Number(p.ms) || 0);
    if (!p.running) return ms;
    const at = new Date(String(p.at || '')).getTime();
    if (!Number.isFinite(at)) return ms;
    return Math.max(0, ms - (nowMs - at));
  }

  /**
   * Re-anchor every penalty in a game's stats to a new running state,
   * projecting each to its live remaining time and dropping any that
   * already expired (a player whose box time ran out is back on the
   * ice). Returns the updated stats object, or null when the game has
   * no penalties — so callers can skip the stats write entirely for
   * the 14 sports with no penalty box.
   */
  /**
   * 2026-05-27 — Slave the shot clock to the game clock.
   * Operator: "when i stop and start the time clock it should auto
   * stop the clock shot and they need to be exact, the clock is so
   * important it needs to be instant because every second matters in
   * sports games".
   *
   * Same pattern as syncPenaltiesToClock. Returns a stats patch (or
   * null when no shot clock is configured), called from clockAction()
   * inside the same DB transaction so the two clocks share a single
   * anchor timestamp — zero drift between them.
   *
   * Behavior:
   *   - Game.start → shot clock runs at its current value (resuming).
   *   - Game.stop  → shot clock freezes at its current value.
   *   - set / reset / fine-nudge don't touch the shot clock — those
   *     are operator-precise edits to the game clock alone (a 1-sec
   *     correction on the game clock shouldn't burn a possession's
   *     shot clock).
   *   - When the shot clock isn't configured (len === 0 / off), this
   *     no-ops cleanly.
   *
   * `clockMutated` is true only for start/stop transitions; false for
   * set/reset where the running state didn't flip. Callers pass that
   * in so this helper doesn't have to second-guess the action.
   */
  private syncShotClockToGameClock(
    rawStats: unknown,
    clockMutated: boolean,
    running: boolean,
    now: Date,
    /**
     * T2-10 / Invariant #6: the live game-clock remaining at the instant
     * of this sync. When provided, the shot clock is clamped to this value
     * so it can never read higher than the game clock (e.g. "0:08 left in
     * Q4 but shot clock still showing 0:24"). Pass undefined to skip the
     * clamp (callers that don't have the game-clock value handy).
     */
    gameClockMs?: number,
    /**
     * The sport's full shot-clock seconds (def.shotClock.full). When the
     * stored shot clock is unconfigured (len 0) and the game clock is
     * STARTING, we arm it to this so the operator never has to find a
     * separate "configure" step. Undefined / 0 → sport has no shot clock.
     */
    shotClockFull?: number,
  ): Record<string, unknown> | null {
    if (!clockMutated) return null;
    if (!rawStats || typeof rawStats !== 'object') return null;
    const stats = { ...(rawStats as Record<string, unknown>) };
    const mode = shotClockMode(stats);
    // K12-F05 — a shot clock the table switched OFF stays off: nothing to
    // slave, and never re-armed (it used to come back at 24 s here).
    if (mode === 'off') return null;
    if (mode === 'unset') {
      // 2026-06-16 — AUTO-ARM a NEVER-CONFIGURED shot clock to the sport's
      // full length when the game clock STARTS ("the shot clock doesn't
      // start": a fresh game had no shot clock until the operator found a
      // 'configure' step). Clamped to the game clock remaining. Pausing an
      // unconfigured clock stays a clean no-op.
      if (running && shotClockFull && shotClockFull > 0) {
        let armed = shotClockFull * 1000;
        if (gameClockMs !== undefined && gameClockMs >= 0) armed = Math.min(armed, gameClockMs);
        stats.shotClock = { len: shotClockFull, ms: armed, at: now.toISOString(), running: true };
        return stats;
      }
      return null;
    }
    const prev = stats.shotClock as Record<string, unknown>;
    const len = Number(prev.len);
    // Project current live ms from the prior anchor (same math as
    // setShotClock + the UI projection in RunShotClockMini).
    let ms = Math.max(0, Number(prev.ms) || 0);
    const prevRunning = !!prev.running;
    if (prevRunning) {
      const at = new Date(String(prev.at || '')).getTime();
      if (Number.isFinite(at)) {
        ms = Math.max(0, ms - (now.getTime() - at));
      }
    }
    // T2-10 / Invariant #6: clamp shot clock to game clock remaining.
    if (gameClockMs !== undefined && gameClockMs >= 0) {
      ms = Math.min(ms, gameClockMs);
    }
    // Re-anchor: same `at` as the game clock's write so projections
    // on either clock from this point forward share a single source
    // of truth.
    stats.shotClock = {
      len,
      ms,
      at: now.toISOString(),
      running,
    };
    return stats;
  }

  private syncPenaltiesToClock(
    rawStats: unknown,
    running: boolean,
    now: Date,
  ): Record<string, unknown> | null {
    if (!rawStats || typeof rawStats !== 'object') return null;
    const stats = { ...(rawStats as Record<string, unknown>) };
    if (!Array.isArray(stats.penalties) || stats.penalties.length === 0) {
      return null;
    }
    const nowMs = now.getTime();
    const nowIso = now.toISOString();
    // CTS-sourced penalties (T2-1) have a different shape — slot/playerJersey/
    // secondsRemaining — and carry their own running state from the CTS
    // console. Preserve them as-is; only operator-shaped penalties are
    // re-anchored to the game clock.
    const ctsRows: Record<string, unknown>[] = [];
    const operatorRows: Record<string, unknown>[] = [];
    for (const p of stats.penalties as unknown[]) {
      if (!p || typeof p !== 'object') continue;
      const row = p as Record<string, unknown>;
      if (row.source === 'cts') ctsRows.push(row);
      else operatorRows.push(row);
    }
    const reAnchored = operatorRows
      .map((p) => ({
        id: String(p.id || ''),
        team: p.team === 'away' ? 'away' : 'home',
        label: String(p.label || '').slice(0, 24),
        player: String(p.player || '').slice(0, 4),
        ms: this.projectPenaltyMs(p, nowMs),
        at: nowIso,
        running,
      }))
      .filter((p) => p.id && p.ms > 0);
    stats.penalties = [...reAnchored, ...ctsRows];
    return stats;
  }

  /**
   * T2-10: Apply per-sport segment-reset rules to the stats blob.
   *
   * Returns an object with only the STAT keys that changed (so the
   * caller can merge just those into Game.stats and write individual
   * STAT GameEvents for the undo rail), plus a `shotClockReset`
   * boolean so the caller can do the shotClock anchor update
   * separately (it needs `def` + `now`).
   *
   * @param def       The sport definition (carries segmentReset).
   * @param rawStats  Current Game.stats (JSON blob, may be null).
   * @param newSegment The segment index we're advancing TO (1-based).
   * @param prevSegment The segment the game is leaving (K12-F02 / F03: the
   *                  rules profile's foul carry and overtime timeouts depend
   *                  on the direction and on which boundary is crossed).
   */
  private computeSegmentResets(
    def: SportDefinition,
    rawStats: unknown,
    newSegment: number,
    prevSegment: number,
  ): { statDeltas: Record<string, unknown>; shotClockReset: boolean } {
    const rules = def.segmentReset;
    const statDeltas: Record<string, unknown> = {};
    let shotClockReset = false;
    if (!rules) return { statDeltas, shotClockReset };

    const stats: Record<string, unknown> =
      rawStats && typeof rawStats === 'object'
        ? (rawStats as Record<string, unknown>)
        : {};
    const count = def.segment.count;
    const forward = newSegment > prevSegment;

    // Team fouls. Classic rules: back to zero at every segment change. Under
    // a rules profile's team-foul rules (K12-F02): back to zero only when the
    // game moves FORWARD into a new regulation period — NFHS basketball
    // resets at the end of the first, second and third quarters — and never
    // on the way into, or between, overtime periods, which continue the
    // fourth quarter's count [ncaa-nfhs-bb-2025-26; kshsaa-bb-table-2026 in
    // @cms/api-types RULES_SOURCES]. A move back is a correction: its fouls
    // come back through undo, never through a reset.
    const fouls = def.teamFouls;
    const resetFouls = !fouls
      ? true
      : forward && (!fouls.carryIntoOvertime || prevSegment < count);
    if (resetFouls && rules.homeFouls && (stats.homeFouls ?? 0) !== 0) {
      statDeltas.homeFouls = 0;
    }
    if (resetFouls && rules.awayFouls && (stats.awayFouls ?? 0) !== 0) {
      statDeltas.awayFouls = 0;
    }

    // Timeout banks — 'segment' = refilled at every boundary (volleyball: two
    // per set); 'half' = only at the halfway boundary (football: after Q2);
    // 'never' = one bank for the whole game (NFHS basketball, K12-F03 — no
    // halftime refill). A refill is the rules' allocation (full + short),
    // else the classic stat maximum.
    const halfPoint = Math.floor(count / 2);
    const atHalf = newSegment === halfPoint + 1; // advancing INTO the second half
    const allocation = timeoutAllocation(def);
    const shortBank =
      def.timeouts && def.timeouts.short > 0 ? def.timeouts.short : 0;
    for (const side of ['home', 'away'] as const) {
      const key = side === 'home' ? 'homeTimeouts' : 'awayTimeouts';
      const policy = side === 'home' ? rules.homeTimeouts : rules.awayTimeouts;
      if (policy !== 'segment' && !(policy === 'half' && atHalf)) continue;
      if ((stats[key] ?? allocation) !== allocation) {
        statDeltas[key] = allocation;
      }
      const shortKey = shortTimeoutKey(side);
      if (shortBank > 0 && (stats[shortKey] ?? shortBank) !== shortBank) {
        statDeltas[shortKey] = shortBank;
      }
    }
    // Overtime timeouts (K12-F03): every overtime period entered adds the
    // rules' `overtimeFull` to each team's bank; unused ones carry over.
    const otFull = def.timeouts?.overtimeFull ?? 0;
    const hasTimeouts = def.stats.some((f) => f.key === 'homeTimeouts');
    if (otFull > 0 && hasTimeouts && forward && newSegment > count) {
      const entered = newSegment - Math.max(prevSegment, count);
      for (const key of ['homeTimeouts', 'awayTimeouts'] as const) {
        const current = statDeltas[key] ?? stats[key];
        const left =
          typeof current === 'number' && isFinite(current) ? current : 0;
        statDeltas[key] = left + entered * otFull;
      }
    }

    // Shot clock reset flag — the caller handles the actual anchor update
    // because it needs `def.shotClock.full` and a timestamp.
    if (rules.shotClock && def.shotClock) {
      shotClockReset = true;
    }

    return { statDeltas, shotClockReset };
  }

  /**
   * LINE SCORE producer — cross-domain contract with the board surface
   * (2026-06-13 audit). The board renders the baseball per-inning grid
   * and the football per-quarter box from `Game.stats.lineScore`, an
   * array of CUMULATIVE-at-boundary snapshots:
   *
   *   stats.lineScore: { segment: number; home: number; away: number }[]
   *
   * `segment` is the segment that JUST FINISHED; `home`/`away` are the
   * running TOTAL scores AT that boundary. The board computes a single
   * segment's runs/points by DIFFERENCING consecutive snapshots (and the
   * current live total against the last snapshot for the in-progress
   * segment). We snapshot cumulative — not per-segment delta — because the
   * running total is the one number we can read losslessly off the Game
   * row at the boundary; deltas would have to reconstruct the segment's
   * start, which the undo rail can perturb. (R-H-E uses the separate
   * homeHits/awayHits/homeErrors/awayErrors stats added in the P1 wave.)
   *
   * Called ONLY on a FORWARD segment advance (oldSegment → newSegment,
   * newSegment > oldSegment) for the two box-score sports: baseball /
   * softball (segment = Inning) and football (segment = Quarter). It
   * folds the snapshot into the merged stats object the caller is about
   * to write — no extra DB round-trip. Idempotent: a snapshot for the
   * same `segment` is replaced, never duplicated, so a re-advance after
   * an undo can't leave a stale row.
   *
   * Returns the merged lineScore array, or null when this sport / move
   * doesn't produce one (so the caller can skip touching stats).
   */
  private computeLineScore(
    def: import('@cms/api-types').SportDefinition,
    rawStats: unknown,
    oldSegment: number,
    newSegment: number,
    homeScore: number,
    awayScore: number,
  ): Array<{ segment: number; home: number; away: number }> | null {
    // Only the two box-score sports, and only on a forward advance.
    const isBoxScore =
      def.key === 'baseball' ||
      def.key === 'softball' ||
      def.key === 'football';
    if (!isBoxScore) return null;
    if (newSegment <= oldSegment) return null;

    const home = Number.isFinite(homeScore) ? Math.max(0, Math.round(homeScore)) : 0;
    const away = Number.isFinite(awayScore) ? Math.max(0, Math.round(awayScore)) : 0;

    const stats: Record<string, unknown> =
      rawStats && typeof rawStats === 'object'
        ? (rawStats as Record<string, unknown>)
        : {};
    const prior = Array.isArray(stats.lineScore)
      ? (stats.lineScore as unknown[]).filter(
          (e): e is { segment: number; home: number; away: number } =>
            !!e &&
            typeof e === 'object' &&
            typeof (e as { segment?: unknown }).segment === 'number',
        )
      : [];

    // The boundary we just crossed snapshots the segment that finished.
    // For a multi-step jump (rare — operator types segment 5 from 2) we
    // backfill every skipped boundary at the same cumulative total so the
    // grid has a cell per segment rather than a gap. Idempotent per segment.
    const bySegment = new Map<number, { segment: number; home: number; away: number }>();
    for (const e of prior) bySegment.set(e.segment, e);
    for (let seg = oldSegment; seg < newSegment; seg++) {
      bySegment.set(seg, { segment: seg, home, away });
    }
    return Array.from(bySegment.values()).sort((a, b) => a.segment - b.segment);
  }

  /**
   * Penalty box — the timed penalties of hockey, lacrosse, field
   * hockey and water polo. Each penalty counts a player out for a
   * fixed duration; the box runs and freezes WITH the game clock.
   * Stored as an array in Game.stats.penalties (no schema column);
   * every surface projects each penalty from its own anchor.
   *
   *   add    — push a penalty for a team (lenSec + optional player #)
   *   remove — pull one penalty early (a power-play goal ends a minor)
   *   clear  — empty the box
   *
   * Every action re-anchors the surviving penalties to the game
   * clock's current running state and prunes any that hit 0:00.
   */
  async setPenalties(
    tenantId: string,
    id: string,
    dto: {
      action?: string;
      team?: string;
      penaltyId?: string;
      lenSec?: number;
      label?: string;
      player?: string;
      // 2026-07-12 world-class audit P1 — water polo's most repeated action
      // (a major-foul exclusion, ~8-14/game) used to take THREE disconnected
      // writes: this box timer, the per-player stats.playerExclusions count
      // ("2 of 3"/EJECTED panel on the board), and the team EXCL stat. Under
      // game pace they silently drifted. `exclusion: true` (sent by the
      // console's roster one-tap) makes ONE call bump all three atomically.
      // `playerName` labels the playerExclusions row so the board shows the
      // name, matching the manual stepper's rows.
      exclusion?: boolean;
      playerName?: string;
    },
    actor?: CommandInput,
  ) {
    const action = String(dto.action || '');
    if (!['add', 'remove', 'clear'].includes(action)) {
      throw new BadRequestException('action must be add | remove | clear');
    }
    return this.runGameCommand(tenantId, id, `penalties.${action}`, actor, dto, async (scope) => {
      const stats = this.penaltiesPatch(scope.before, action, dto);
      const updated = await scope.write({ stats });
      const list = stats.penalties as unknown[];
      await scope.event('PENALTY', { action, count: list.length, change: scope.change() });
      return updated;
    });
  }

  /** The stats blob after one penalty-box action on `game` (see setPenalties). */
  private penaltiesPatch(
    game: GameRow,
    action: string,
    dto: {
      team?: string;
      penaltyId?: string;
      lenSec?: number;
      label?: string;
      player?: string;
      exclusion?: boolean;
      playerName?: string;
    },
  ): Record<string, unknown> {
    const now = this.clockNow();
    // A penalty added while the clock runs starts counting at once;
    // added during a stoppage it waits, frozen, for the next start.
    const running = !!game.clockRunning;

    // Start from the stored box, re-anchored live + pruned of expired.
    const synced = this.syncPenaltiesToClock(game.stats, running, now);
    const baseStats: Record<string, unknown> =
      synced ??
      (game.stats && typeof game.stats === 'object'
        ? { ...(game.stats as Record<string, unknown>), penalties: [] }
        : { penalties: [] });
    let list = Array.isArray(baseStats.penalties)
      ? (baseStats.penalties as Record<string, unknown>[])
      : [];

    switch (action) {
      case 'add': {
        const sec = Math.round(Number(dto.lenSec));
        if (!Number.isFinite(sec) || sec < 5 || sec > 1800) {
          throw new BadRequestException('lenSec must be 5–1800 seconds');
        }
        if (list.length >= 12) {
          throw new BadRequestException('Penalty box is full (12 max)');
        }
        const team = dto.team === 'away' ? 'away' : 'home';
        // Jersey number — digits only, ≤ 3 (00–999 covers every code).
        const jerseyStr = String(dto.player || '').replace(/[^0-9]/g, '').slice(0, 3);
        list = [
          ...list,
          {
            id: `pen_${now.getTime().toString(36)}_${Math.random()
              .toString(36)
              .slice(2, 7)}`,
            team,
            label: String(dto.label || '').slice(0, 24),
            player: jerseyStr,
            ms: sec * 1000,
            at: now.toISOString(),
            running,
          },
        ];

        // One-tap exclusion capture (water polo only — see dto comment).
        // Bumps the per-player major-foul count AND the team EXCL stat in
        // the SAME stats write as the box timer, so the three surfaces can
        // never drift. The manual PlayerExclusionStepper stays the
        // correction path (it SETs absolute counts, so no double-count).
        if (dto.exclusion === true && jerseyStr) {
          const def = this.sportOf(game);
          if (def.key === 'water_polo') {
            const jersey = Number(jerseyStr);
            const name = String(dto.playerName || '').slice(0, 40) || undefined;
            const rows = Array.isArray(baseStats.playerExclusions)
              ? (baseStats.playerExclusions as Record<string, unknown>[]).map((r) => ({ ...r }))
              : [];
            const row = rows.find((r) => r.team === team && Number(r.jersey) === jersey);
            if (row) {
              // Same 0-9 clamp as the console stepper.
              row.count = Math.min(9, (Number(row.count) || 0) + 1);
              if (name && !row.name) row.name = name;
            } else {
              rows.push({ team, jersey, name, count: 1 });
            }
            baseStats.playerExclusions = rows;

            const teamKey = team === 'away' ? 'awayExclusions' : 'homeExclusions';
            const max = def.stats.find((s) => s.key === teamKey)?.max ?? 30;
            baseStats[teamKey] = Math.min(
              typeof max === 'number' ? max : 30,
              (Number(baseStats[teamKey]) || 0) + 1,
            );
          }
        }
        break;
      }
      case 'remove': {
        const pid = String(dto.penaltyId || '');
        if (!pid) throw new BadRequestException('penaltyId required');
        list = list.filter((p) => String(p.id) !== pid);
        break;
      }
      case 'clear':
        list = [];
        break;
    }
    return { ...baseStats, penalties: list };
  }

  /**
   * Legacy-EndSetMacro double-credit guard (task #289, 2026-07-02 sports
   * deep-pass audit) — see the long comment at the `setSegment` callsite
   * for the full mechanism. Returns true when `wonKey` was ALREADY
   * credited for the CURRENT set by a mutation other than this method's
   * own credit logic — i.e. the legacy client's raw stats PATCH (mutation
   * 1 of the 4-mutation macro) racing in before this call's read.
   *
   * Scoped two ways so it can't false-positive on legitimate history:
   *  - Time: only STAT events recorded since the most recent SEGMENT
   *    event for this game (i.e. since the current set began). A credit
   *    from a PRIOR set is irrelevant to whether THIS set was credited.
   *  - Source: `setSegment`'s own credit STAT events always carry
   *    `source: 'set-advance'` (recorded a few lines below this method)
   *    — excluded here, otherwise a normal single-path advance would see
   *    its OWN just-written trailing STAT event (timestamped right after
   *    the SEGMENT event that anchors the time window) and wrongly
   *    conclude the NEXT set was pre-credited, permanently disabling the
   *    credit for every set after the first. Any OTHER source touching
   *    `wonKey` in-window (the legacy macro's raw PATCH has none) means
   *    an external actor already applied this set's credit.
   */
  private async setCreditAlreadyApplied(
    gameId: string,
    wonKey: string,
    tx?: any,
  ): Promise<boolean> {
    const client = tx ?? this.prisma.client;
    const lastSegmentEvent = await client.gameEvent.findFirst({
      where: { gameId, type: 'SEGMENT' },
      orderBy: { createdAt: 'desc' },
    });
    const since = lastSegmentEvent?.createdAt;
    const recentStatEvents = await client.gameEvent.findMany({
      where: {
        gameId,
        type: 'STAT',
        ...(since ? { createdAt: { gte: since } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
    return recentStatEvents.some((ev) => {
      const payload = (ev.payload as Record<string, unknown> | undefined) || {};
      if (payload.source === 'set-advance') return false;
      const stats = (payload.stats as Record<string, unknown> | undefined) || {};
      return Object.prototype.hasOwnProperty.call(stats, wonKey);
    });
  }

  /** Advance / set the segment (quarter, inning, set, period). */
  async setSegment(
    tenantId: string,
    id: string,
    dto: { segment?: number; delta?: number },
    actor?: CommandInput,
  ) {
    // Input validation outside the transaction (cheap; a bad dto must never
    // be retried).
    if (typeof dto.segment !== 'number' && typeof dto.delta !== 'number') {
      throw new BadRequestException('provide segment or delta');
    }

    // One command: segment-reset stat deltas, shot/play-clock resets, the
    // line score and the volleyball/pickleball set credit are all merged
    // into ONE compare-and-swap write of the fresh row (so a concurrent CTS
    // or stat write is merged on top of, never erased), and the SEGMENT
    // event records the whole change so undo restores every side effect
    // (K12-16). Merge logic is unchanged from the 2026-07-03 stats-race fix.
    return this.runGameCommand(tenantId, id, 'segment.set', actor, dto, async (scope) => {
      const tx = scope.tx;
      const game = scope.before;
      let segment = 0;
      let prevSegment = 0;
      let prevClockMs = 0;
      let zeroedScores = false;
      let setGameWonKey: string | null = null;
      let setGameWonVal = 0;
      let statDeltas: Record<string, unknown> = {};
      let shotClockReset = false;
      let mergedStats: Record<string, unknown> = {};
      let lineScore: Array<{ segment: number; home: number; away: number }> | null = null;
      let prevHomeScore = 0;
      let prevAwayScore = 0;
      let statsBeforeWrite: Record<string, unknown> = {};
      const def = this.sportOf(game);
      const sportDefShotClock = def.shotClock;
      statsBeforeWrite =
        game.stats && typeof game.stats === 'object'
          ? (game.stats as Record<string, unknown>)
          : {};

      // Capture prev state for undo rail from THIS (fresh) read.
      prevSegment = game.segment;
      prevClockMs = game.clockMs;

      segment = game.segment;
      if (typeof dto.segment === 'number') {
        segment = Math.round(dto.segment);
      } else if (typeof dto.delta === 'number') {
        segment = game.segment + Math.round(dto.delta);
      }
      // Allow overtime segments past the regulation count when the sport
      // supports OT — as many as its rules allow (NFHS wrestling: four, K12-F23;
      // NFHS soccer: two, K12-F22; else the engine's cap of ten) — otherwise
      // clamp to [1, count].
      const max = maxSegment(def);
      segment = Math.min(max, Math.max(1, segment));

      // Advancing the segment resets the clock to the segment start and
      // stops it — for countdown AND countup. Count-up halves restart
      // from 0; without re-anchoring here, a running soccer clock would
      // jump forward by the entire halftime gap. 'none' clocks (baseball,
      // volleyball) have no clock to reset.
      const now = this.clockNow();
      const data: Record<string, unknown> = { segment };
      if (def.clock.type !== 'none') {
        // Football OT is untimed (possession-based, 1st-and-goal from the
        // 25 in HS/NCAA) — re-anchoring the game clock to 12:00 in OT is
        // wrong. When football crosses past the regulation quarter count,
        // zero the game clock (and leave it stopped) so the board hides /
        // zeros it for OT instead of showing a fake quarter clock. Every
        // other countdown sport, and football's regulation quarters, keep
        // the normal segment-start re-anchor. (2026-06-13 audit P2.)
        data.clockMs = isUntimedSegment(def, segment)
          ? 0
          : this.segmentStartMs(def, game.stats, segment);
        data.clockRunning = false;
        data.clockUpdatedAt = now;
      }

      // Volleyball / pickleball: a clockless set/game sport carries its
      // rally score (points-to-target) across NO clock boundary — so a
      // manual FORWARD segment advance ("next set") must zero the point
      // score, or the new set opens showing the old set's tally. (Baseball
      // is also clockless, but its segment is an Inning and the score is
      // cumulative — only set/game sports zero.) Best-in-industry: credit
      // the just-finished set/game to whichever side led it, so the match
      // set count (e.g. 2–1) stays correct even when the operator advances
      // by hand instead of scoring the set-winning point.
      const isSetGameSport =
        def.clock.type === 'none' &&
        (def.segment.name === 'Set' || def.segment.name === 'Game');
      const advancingForward = segment > prevSegment;
      prevHomeScore = Number(game.homeScore) || 0;
      prevAwayScore = Number(game.awayScore) || 0;
      zeroedScores = false;
      setGameWonKey = null;
      setGameWonVal = 0;
      if (isSetGameSport && advancingForward) {
        // Legacy-EndSetMacro double-credit guard (2026-07-02 sports deep-pass
        // audit, task #289): the OLD (pre-S1-5) client macro fires FOUR
        // near-simultaneous, unawaited mutations — a raw stats PATCH that
        // credits the set-win counter, a score-zero PATCH, a cue fire, and
        // THIS segment-advance PATCH. When the stats-credit PATCH lands on
        // the server before this call's read, `game.stats[setGameWonKey]`
        // already reflects that credit, and crediting again here double-
        // counts the set (net +2 instead of +1) even though this method
        // only runs once. The raw counter alone can't tell "the true prior
        // count" from "the true prior count plus a credit that just raced
        // in" — both are indistinguishable integers — so the guard consults
        // the immutable GameEvent log (untouched by that sibling PATCH) for
        // a STAT credit to the SAME won-key recorded since the current set
        // began (i.e. since the last SEGMENT advance). If one already
        // landed, the credit for this transition is already applied —
        // skip crediting AND skip re-zeroing (the sibling score-zero PATCH
        // owns that), and just advance the segment. The atomic
        // `endSegmentAtomic` endpoint (S1-5) is unaffected — it never
        // calls this method.
        const isPickle = def.key === 'pickleball';
        const homeLed = prevHomeScore > prevAwayScore;
        const candidateWonKey =
          prevHomeScore !== prevAwayScore
            ? isPickle
              ? homeLed
                ? 'homeGames'
                : 'awayGames'
              : homeLed
                ? 'homeSets'
                : 'awaySets'
            : null;
        const alreadyCredited =
          candidateWonKey !== null &&
          (await this.setCreditAlreadyApplied(id, candidateWonKey, tx));

        // Only zero if there's actually a carried-over score to clear, and
        // only if a sibling mutation hasn't already credited this set (that
        // sibling's own score-zero PATCH — mutation 2 of the legacy macro —
        // owns zeroing in that case, whether it has landed yet or not).
        if (!alreadyCredited && (prevHomeScore !== 0 || prevAwayScore !== 0)) {
          data.homeScore = 0;
          data.awayScore = 0;
          zeroedScores = true;
        }
        // Credit the set/game won to the leader of the set just finished —
        // unless it was already credited by a racing sibling mutation.
        if (!alreadyCredited && candidateWonKey) {
          setGameWonKey = candidateWonKey;
          const cur =
            game.stats && typeof game.stats === 'object'
              ? Number((game.stats as Record<string, unknown>)[candidateWonKey]) || 0
              : 0;
          // Clamp to the stat's configured max (homeSets/awaySets max 3 best-of-5,
          // homeGames/awayGames max 2) so a stray forward advance past a finished
          // match can't push the set/game count past its legal ceiling.
          const wonMax = def.stats.find((s) => s.key === candidateWonKey)?.max;
          setGameWonVal = typeof wonMax === 'number' ? Math.min(cur + 1, wonMax) : cur + 1;
        }
      }

      // T2-10: apply per-sport segment-reset rules AND T2-7's football
      // play-clock reset in one merged stats write. Both are
      // complementary: T2-10 handles homeFouls/awayFouls/timeouts/shot
      // clock per SportDefinition; T2-7 specifically resets the football
      // play clock to 40s on quarter advance.
      const resets = this.computeSegmentResets(
        def,
        game.stats,
        segment,
        prevSegment,
      );
      statDeltas = resets.statDeltas;
      shotClockReset = resets.shotClockReset;
      mergedStats =
        game.stats && typeof game.stats === 'object'
          ? { ...(game.stats as Record<string, unknown>) }
          : {};
      if (Object.keys(statDeltas).length > 0) {
        mergedStats = { ...mergedStats, ...statDeltas };
      }
      if (shotClockReset && def.shotClock && shotClockMode(mergedStats) === 'on') {
        // K12-F05 — reset to the length THIS game runs (35 s stays 35 s; it
        // used to become the sport's 24 s default here). An OFF or
        // never-configured shot clock is left exactly as it is.
        const len = Number((mergedStats.shotClock as Record<string, unknown>).len);
        // Clamp to the (just-reset) game clock — both start at their
        // segment-start values, so this is a no-op in normal play but keeps
        // Invariant #6 (never above the time left in the period).
        const gameClockMs = data.clockMs !== undefined
          ? Number(data.clockMs)
          : this.segmentStartMs(def, game.stats, segment);
        mergedStats.shotClock = {
          len,
          ms: Math.min(len * 1000, gameClockMs),
          at: now.toISOString(),
          running: false,
        };
      }
      // K12-F06: a new period starts on the 25-second count, parked until the
      // referee's ready-for-play signal (NFHS 2025 play-clock instructions:
      // "the beginning of any period" and every overtime period use 25). It
      // used to park at 40.
      if (def.playClock && mergedStats.playClock) {
        mergedStats.playClock = { ms: def.playClock.short * 1000, at: now.toISOString(), running: false };
      }
      // LINE SCORE (2026-06-13 audit — board cross-domain contract): on a
      // FORWARD advance for baseball/softball (per-inning) and football
      // (per-quarter), snapshot the cumulative score at the segment boundary
      // into stats.lineScore so the board can render the box grid. The score
      // is NOT mutated here (innings carry runs; quarters carry points), so
      // we read the current game totals as the boundary snapshot. The board
      // differences consecutive snapshots for per-segment values.
      lineScore = null;
      if (advancingForward) {
        lineScore = this.computeLineScore(
          def,
          mergedStats,
          prevSegment,
          segment,
          prevHomeScore,
          prevAwayScore,
        );
        if (lineScore) mergedStats.lineScore = lineScore;
      }
      // Volleyball / pickleball: credit the just-finished set/game to its
      // leader (computed above) into the merged stats write — with the points
      // it ended on (K12-F18: the final board prints the match set by set).
      if (setGameWonKey) {
        mergedStats[setGameWonKey] = setGameWonVal;
        mergedStats[SET_SCORES_KEY] = appendSetScore(game.stats, prevHomeScore, prevAwayScore);
      }
      if (Object.keys(mergedStats).length > 0) {
        data.stats = mergedStats as any;
      }
      const shotClockAfterWrite = mergedStats.shotClock;
      const updated = await scope.write(data);

      // The SEGMENT event is the command's undo target: it carries the whole
      // change (period, clock, reset fouls/timeouts, shot/play clocks, line
      // score, set credit, zeroed rally score). The events after it are the
      // same change itemised for the forensic log — `derived`, so the undo
      // rail offers the command once, not piecemeal.
      await scope.event('SEGMENT', {
        segment,
        prevSegment,
        prevClockMs,
        change: scope.change(),
      });

      // LINE SCORE paper trail (board cross-domain contract): only written
      // when a box-score snapshot was actually produced.
      if (lineScore) {
        await scope.event(
          'STAT',
          { stats: { lineScore }, source: 'line-score', segment },
          { derived: true },
        );
      }
      // Volleyball / pickleball next-set: the pre-zero rally tally, plus the
      // set/game-won credit.
      if (zeroedScores) {
        await scope.event(
          'SCORE',
          { homeScore: 0, awayScore: 0, prevHomeScore, prevAwayScore, source: 'set-advance', segment },
          { derived: true },
        );
      }
      if (setGameWonKey) {
        const oldVal = statsBeforeWrite[setGameWonKey] ?? null;
        await scope.event(
          'STAT',
          {
            stats: { [setGameWonKey]: setGameWonVal },
            oldValues: { [setGameWonKey]: oldVal },
            source: 'set-advance',
            segment,
          },
          { derived: true },
        );
      }
      // T2-10: one STAT event per reset field (forensic detail).
      for (const [key, newVal] of Object.entries(statDeltas)) {
        const oldVal = statsBeforeWrite[key] ?? null;
        await scope.event(
          'STAT',
          { stats: { [key]: newVal }, oldValues: { [key]: oldVal }, source: 'segment-reset', segment },
          { derived: true },
        );
      }
      if (shotClockReset && sportDefShotClock) {
        await scope.event(
          'STAT',
          { stats: { shotClock: shotClockAfterWrite }, source: 'segment-reset', segment },
          { derived: true },
        );
      }
      return updated;
    });
  }

  /**
   * Stop every LIVE game whose running game clock has run out — a countdown
   * at 0:00, or a count-up past its segment length (plus added time). Called
   * every second by ClockAdvanceService.
   *
   * K12-F08 — the period HOLDS: the clock stops at its expiry reading in the
   * SAME period, the horn sounds once, and nothing else changes. Moving to the
   * next period is the table's decision (setSegment), exactly as the NFHS
   * timing instructions have the clock operator wait for the Referee to
   * declare the period over. This used to roll the game straight into the
   * next quarter with a fresh 8:00 clock and cleared fouls — the crowd never
   * saw the end state, and a last-second correction or an untimed down had
   * nowhere to go.
   *
   * Safe on two replicas and on a lost leader lease (both replicas sweep when
   * Redis is down): every expiry is a compare-and-swap command on the fresh
   * row, so the loser re-reads a clock that is no longer running and does
   * nothing — one stop, one horn. A correction that lands first (the clock
   * set back to 0.3 s) is likewise never overwritten. Clockless sports are
   * skipped. Returns how many LIVE+running games were found (drives the
   * caller's idle-skip) and how many were stopped.
   */
  async autoAdvanceExpiredClocks(): Promise<{ found: number; changed: number }> {
    const games = await this.prisma.client.game.findMany({
      where: { status: 'LIVE', clockRunning: true },
    });
    let changed = 0;
    for (const swept of games) {
      // Cheap pre-check on the swept row; the command re-checks on its own
      // fresh read, so a clock the operator paused, corrected or advanced a
      // moment ago is never rolled over from this stale copy (K12-F12).
      if (!this.clockExpired(swept)) continue;
      try {
        const rolled = await this.runGameCommand(
          swept.tenantId,
          swept.id,
          'clock.expire',
          SYSTEM_CLOCK_ACTOR,
          null,
          (scope) => this.expireClock(scope),
          { gate: swept },
        );
        if (rolled) changed += 1;
      } catch (err) {
        this.logger.warn(
          `clock expiry failed (non-fatal) game=${swept.id}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
    return { found: games.length, changed };
  }

  /**
   * Has this game's running clock expired? A countdown at 0:00, or a count-up
   * past its segment length. Soccer-fix: a count-up half must NOT roll the
   * instant it hits regulation — stoppage / added time runs WITH the clock —
   * so the threshold moves out by the operator-set `addedTime` minutes.
   */
  private clockExpired(game: GameRow, nowMs: number = this.serverTimeMs()): boolean {
    if (game.status !== 'LIVE' || !game.clockRunning) return false;
    // K12-F01 — the game's own rules (a bound NFHS soccer game counts down).
    const def = sportForGame(game);
    if (!def || def.clock.type === 'none') return false;
    return isGameClockExpired(def, game.stats, projectGameClockMs(game, def.clock.type, nowMs));
  }

  /**
   * One clock expiry, as a system command on the fresh row (K12-F08): the
   * game HOLDS at the end of the period. Returns false — writing nothing and
   * sounding no horn — when the fresh row is no longer an expired running
   * LIVE game (another replica got there first, or the table corrected /
   * stopped the clock a moment ago).
   *
   * Every clock is stopped at the instant the period actually ended (the
   * anchor plus the time that was left), not at the sweep's tick: the game
   * clock reads exactly 0:00 (a count-up, its segment length plus added
   * time), and a penalty or shot clock carries exactly the time it had at
   * the horn — a sweep that runs late, or a leader-lease failover, costs a
   * player in the box nothing. The football play clock is its own clock and
   * is not touched (K12-F06). The segment, the score, fouls, timeouts and
   * the line score are untouched: those move only when the table advances
   * the period.
   */
  private async expireClock(scope: GameCommandScope): Promise<boolean> {
    const game = scope.before;
    const nowMs = this.serverTimeMs();
    if (!this.clockExpired(game, nowMs)) return false;
    const def = this.sportOf(game);
    const limit = gameClockExpiryMs(def, game.stats) ?? 0;
    const anchor = clockAnchorMs(game.clockUpdatedAt);
    let endedAt = nowMs;
    if (Number.isFinite(anchor)) {
      const left = def.clock.type === 'countdown' ? game.clockMs : limit - game.clockMs;
      endedAt = Math.min(nowMs, anchor + Math.max(0, left));
    }
    const t = this.clockTransition(game, def, 'pause', 0, new Date(endedAt));
    await scope.write(t.data);
    await scope.event('CLOCK', {
      action: 'expired',
      segment: game.segment,
      clockMs: t.clockMs,
      clockRunning: false,
      auto: true,
      change: scope.change(),
    });
    // T1-5: the horn, once per expiry — carries the period that just ended
    // ("Q1") so every surface can say which period is over.
    await scope.event('CUE', {
      key: 'horn',
      label: 'Horn',
      emoji: '📯',
      target: 'ALL',
      auto: true,
      source: 'clock-expired',
      segmentLabel: this.segmentLabelOf(def, game.segment),
    });
    return true;
  }

  /**
   * Merge sport-specific stat values into the game's stats JSON.
   *
   * For baseball / softball the ball–strike–out count is a real rules
   * engine, not a free-form number: a 4th ball is a walk, a 3rd strike
   * is an out, and a 3rd out retires the side — flipping the half and
   * advancing the inning after the bottom. The operator just clicks
   * Ball / Strike / Out and the count cascades on its own.
   */
  async updateStats(
    tenantId: string,
    id: string,
    dto: { stats?: Record<string, unknown> },
    actor?: CommandInput,
  ) {
    // Shape validation happens OUTSIDE the transaction (cheap, and a
    // BadRequestException must never be retried).
    if (!dto.stats || typeof dto.stats !== 'object' || Array.isArray(dto.stats)) {
      throw new BadRequestException('stats must be an object');
    }

    // The merge runs on the fresh in-transaction read and lands as one
    // compare-and-swap write, so a concurrent CTS snapshot, clock write or
    // co-operator's stat edit is merged on top of rather than erased
    // (K12-17). Merge logic is unchanged from the 2026-07-03 stats-race fix.
    return this.runGameCommand(tenantId, id, 'stats.update', actor, dto, async (scope) => {
      const freshGame = scope.before;
      let next: Record<string, unknown> = {};
      let oldValues: Record<string, unknown> = {};
      let segmentDelta = 0;
      let wasStrikeout = false;
      let dataSegment: number | undefined;
      const def = this.sportOf(freshGame);
      const allowed = new Set(def.stats.map((s) => s.key));
      // 2026-05-27 — Pure-config keys that live on Game.stats JSON but
      // aren't sport stats (no +/- chips on the scoreboard tile). Each
      // is operator-set in Setup mode. Add new ones here as game-level
      // settings expand; resist the urge to add per-sport state (those
      // belong in def.stats so the type system can constrain them).
      const META_KEYS = new Set([
        'celebrationPack',
      ]);
      // Structured (array-valued) stat keys — finish results, basketball
      // foul-trouble, water-polo exclusions. These ride on Game.stats JSON
      // alongside the scalar keys but are arrays, so the scalar branch below
      // (which drops non-scalars) would otherwise reject them. Each is
      // validated + bounded by the shared sanitizer in @cms/api-types so the
      // board surfaces read a predictable, capped shape. Additive: any key
      // NOT here and NOT a scalar/META key is still dropped exactly as before.
      const STRUCTURED_KEYS = new Set<string>(STRUCTURED_STAT_KEYS);
      const current = (freshGame.stats as Record<string, unknown>) || {};
      // Snapshot the old values for every key being mutated — used by the
      // undo rail to write `oldValue` into the STAT GameEvent payload.
      oldValues = {};
      next = { ...current };
      for (const [key, value] of Object.entries(dto.stats as Record<string, unknown>)) {
        // Structured keys: validate + sanitize the whole array into its
        // bounded shape (caps the array at 64, each nested array at 64, every
        // string ≤64 chars, every number coerced to a finite int in bounds,
        // malformed members dropped). The sanitizer always returns an array,
        // so an operator clearing a list (passing []) persists an empty list.
        if (STRUCTURED_KEYS.has(key)) {
          const sanitized = sanitizeStructuredStat(key, value);
          if (sanitized !== undefined) {
            oldValues[key] = current[key] ?? null;
            next[key] = sanitized;
          }
          continue;
        }
        if (!allowed.has(key) && !META_KEYS.has(key)) continue;
        // Bound the value: strings capped at 200 chars, numbers/booleans
        // pass, anything else (object/array) dropped — so a stat edit
        // can't bloat the game's stats JSON column.
        if (typeof value === 'string') {
          oldValues[key] = current[key] ?? null;
          next[key] = value.slice(0, 200);
        } else if (typeof value === 'number' || typeof value === 'boolean') {
          oldValues[key] = current[key] ?? null;
          next[key] = value;
        }
      }

      // Sport rules: the baseball/softball count cascades automatically.
      // T2-10: capture pre-cascade state to detect strikeout / walk events
      // so we can fire their celebration CUEs (both were dead code before).
      const preStrikes = typeof next.strikes === 'number' ? next.strikes : 0;
      const preBalls = typeof next.balls === 'number' ? next.balls : 0;
      const preOuts = typeof next.outs === 'number' ? next.outs : 0;
      const isBaseballSport = freshGame.sport === 'baseball' || freshGame.sport === 'softball';
      const cascade = isBaseballSport
        ? this.applyBaseballCount(next)
        : { segmentDelta: 0, runsScored: 0 };
      segmentDelta = cascade.segmentDelta;
      // Detect what event(s) the cascade produced.
      const postStrikes = typeof next.strikes === 'number' ? next.strikes : 0;
      const postOuts = typeof next.outs === 'number' ? next.outs : 0;
      wasStrikeout = isBaseballSport && preStrikes >= 3 && postStrikes === 0 && postOuts > preOuts;
      // (A walk's mechanical effects — count reset, force-advance, forced
      // run — are the cascade's; the baseball def has no 'walk' celebration.)
      void preBalls;

      const data: Record<string, unknown> = { stats: next as any };
      if (segmentDelta) {
        const max = maxSegment(def);
        dataSegment = Math.min(max, freshGame.segment + segmentDelta);
        data.segment = dataSegment;
      }
      // A bases-loaded walk forces in a run — credit it to the team at bat.
      // Top of the inning the AWAY team bats; Bottom, the HOME team bats.
      // `next.half` is always set by applyBaseballCount and reflects the
      // half the walk happened in (a walk never flips the half).
      if (cascade.runsScored > 0) {
        const battingTop = !String(next.half ?? 'Top').toLowerCase().startsWith('b');
        const scoreCol = battingTop ? 'awayScore' : 'homeScore';
        data[scoreCol] = { increment: cascade.runsScored };
      }
      const updated = await scope.write(data);

      // The STAT event is the command's undo target and carries the whole
      // change — including a cascade's out / half / inning / forced run.
      await scope.event('STAT', { stats: next, oldValues, change: scope.change() });
      if (segmentDelta) {
        await scope.event('SEGMENT', { segment: dataSegment, source: 'count' }, { derived: true });
      }
      // T2-10: the strikeout celebration.
      if (wasStrikeout) {
        const strikeoutCue = def.celebrations.find((c) => c.key === 'strikeout');
        if (strikeoutCue) {
          await scope.event('CUE', {
            key: strikeoutCue.key,
            label: strikeoutCue.label,
            emoji: strikeoutCue.emoji,
            target: 'ALL',
            audioUrl: null,
            sponsorName: null,
            sponsorLogoUrl: null,
            auto: true,
            source: 'rule',
            snapshot: this.cueSnapshot(updated),
          });
        }
      }
      return updated;
    });
  }

  /**
   * Baseball / softball count rules, applied in place to the merged
   * stats. Returns the inning advance (0 or 1) and any runs FORCED in
   * by a bases-loaded walk so the caller can credit the batting team.
   *   · 3rd strike → out; the count resets.
   *   · 4th ball   → walk; the count resets, no out, and the batter
   *                  takes 1B — runners advance only when FORCED (the
   *                  base behind them is occupied). A bases-loaded walk
   *                  forces the runner on 3B home for a run.
   *   · 3rd out    → side retired: outs + count reset, the bases
   *                  clear, half flips Top↔Bottom; advancing past
   *                  the bottom bumps the inning.
   */
  private applyBaseballCount(
    s: Record<string, unknown>,
  ): { segmentDelta: number; runsScored: number } {
    const n = (v: unknown) =>
      typeof v === 'number' && isFinite(v) ? Math.max(0, Math.floor(v)) : 0;
    const onBase = (v: unknown) => (n(v) > 0 ? 1 : 0);
    let balls = n(s.balls);
    let strikes = n(s.strikes);
    let outs = n(s.outs);
    let half = String(s.half || 'Top');
    let segmentDelta = 0;
    let runsScored = 0;

    // A strikeout takes precedence over a walk if both somehow trip in
    // one update (a single click only ever moves one count).
    if (strikes >= 3) {
      strikes = 0;
      balls = 0;
      outs += 1;
    } else if (balls >= 4) {
      balls = 0;
      strikes = 0;
      // Walk — the batter takes 1B and FORCES runners ahead only when
      // the base behind is occupied. Worked from the front of the line:
      //   1B occupied → that runner forced to 2B
      //     2B then occupied → forced to 3B
      //       3B then occupied → forced home (a run scores)
      // A runner NOT forced (e.g. man on 2B with 1B empty) stays put.
      // This lights the diamond correctly on every walk instead of
      // leaving 1B dark.
      let r1 = onBase(s.on1B);
      let r2 = onBase(s.on2B);
      let r3 = onBase(s.on3B);
      if (r1) {
        // 1B was occupied — the chain of forces moves up.
        if (r2) {
          if (r3) {
            // Bases loaded: the runner on 3B is forced home.
            runsScored = 1;
          }
          r3 = 1; // runner from 2B forced to 3B
        }
        r2 = 1; // runner from 1B forced to 2B
      }
      r1 = 1; // the batter always takes 1B on a walk
      s.on1B = r1;
      s.on2B = r2;
      s.on3B = r3;
    }

    if (outs >= 3) {
      outs = 0;
      balls = 0;
      strikes = 0;
      // Side retired — the bases clear for the new half. Without
      // this a stranded runner would haunt the next half-inning's
      // diamond on the scoreboard.
      s.on1B = 0;
      s.on2B = 0;
      s.on3B = 0;
      if (half.toLowerCase().startsWith('b')) {
        half = 'Top';
        segmentDelta = 1;
      } else {
        half = 'Bottom';
      }
    }

    s.balls = balls;
    s.strikes = strikes;
    s.outs = outs;
    s.half = half;
    return { segmentDelta, runsScored };
  }

  /**
   * S1-5 (P2-EndSetMacro, 2026-07-02 sports deep-pass audit): the ONE-TAP
   * "End set/game" macro the operator console fires for volleyball /
   * pickleball, made atomic. The console's `EndSetMacro` used to fire
   * FOUR independent, unawaited mutations back-to-back (set-win stat
   * credit, score zero, celebration cue, segment advance) — a failure or
   * a slow network between any two of them left the game in a torn state
   * (e.g. the set credited but the score never zeroed, or the segment
   * advanced with the old score still showing). This performs the exact
   * same four effects the client used to sequence, in ONE Prisma
   * transaction: either all four land together or none do.
   *
   * Deliberately self-contained rather than calling `setSegment` /
   * `adjustScore` / `fireCue` for the segment-advance/score-zero/cue
   * steps: `setSegment`'s own `isSetGameSport && advancingForward` branch
   * ALREADY performs the identical set-credit + score-zero a second time
   * when called after those effects have already landed (confirmed by
   * reading sports.service.ts — the two code paths were never meant to
   * compose; `applySetWin` is the separate AUTOMATIC threshold-triggered
   * path, unrelated to this MANUAL macro). Calling it here would
   * reintroduce a double-count bug, not fix the atomicity bug. For
   * volleyball/pickleball specifically this also loses nothing real:
   * neither sport declares `segmentReset` (only football/basketball/
   * hockey/lacrosse/water-polo do — `computeSegmentResets` no-ops
   * without it), both have `clock.type: 'none'` (skips the clock-reset
   * branch), and `computeLineScore` only fires for baseball/softball/
   * football — so `setSegment`'s FULL machinery collapses to exactly the
   * clamp-and-credit this method already replicates directly.
   *
   * Tenant-scoped (404 if the game isn't the caller's, checked INSIDE the
   * transaction so the read and the write are one atomic unit — no
   * TOCTOU window between "is this my game" and "update it"). Mirrors
   * the sibling mutations' GameEvent trail (SCORE/STAT/CUE/SEGMENT, same
   * shapes `record()` produces) and `fireCue`'s AuditLog row
   * (SPORTS_CUE_FIRED) for cross-tenant forensics parity — all writes go
   * through the transaction client `tx`, not `record()`/`fireCue()`
   * (which write via the outer, non-transactional client and would break
   * atomicity), so this duplicates their write SHAPE deliberately rather
   * than calling them.
   */
  async endSegmentAtomic(tenantId: string, id: string, actor?: CommandInput) {
    return this.runGameCommand(tenantId, id, 'segment.end', actor, null, async (scope) => {
      const game = scope.before;
      const def = this.sportOf(game);
      const home = Number(game.homeScore) || 0;
      const away = Number(game.awayScore) || 0;
      if (home === away) {
        // Tie can't end a set — same no-op guard EndSetMacro's `endSet()`
        // applies before firing anything. Returning here (rather than
        // throwing) keeps this endpoint safe to call speculatively/
        // idempotently the way the disabled-button UX implies.
        return { updated: game, ended: false as const };
      }
      const winner: 'home' | 'away' = home > away ? 'home' : 'away';

      const setKeyHome = def.stats.some((s) => s.key === 'homeSets')
        ? 'homeSets'
        : def.stats.some((s) => s.key === 'homeGames')
          ? 'homeGames'
          : null;
      const setKeyAway =
        setKeyHome === 'homeSets' ? 'awaySets' : setKeyHome === 'homeGames' ? 'awayGames' : null;
      const winCueKey = def.celebrations.some((c) => c.key === 'setWin')
        ? 'setWin'
        : def.celebrations.some((c) => c.key === 'gameWin')
          ? 'gameWin'
          : null;

      // Effect 1: credit the set/game win to the leader (if the sport
      // tracks one) — merged into the same stats write as everything
      // else so it's one Game row UPDATE, not four.
      const currentStats: Record<string, unknown> =
        game.stats && typeof game.stats === 'object' ? (game.stats as Record<string, unknown>) : {};
      const nextStats = { ...currentStats };
      const setWonKey = winner === 'home' ? setKeyHome : setKeyAway;
      let prevSetWon: unknown;
      if (setWonKey) {
        prevSetWon = currentStats[setWonKey] ?? null;
        const curWon = Number(currentStats[setWonKey]) || 0;
        // No max-clamp here — matches EndSetMacro's CURRENT client
        // behavior exactly (unlike setSegment's own internal credit,
        // which clamps to the stat's configured max; this endpoint
        // replaces the client's 4 mutations byte-for-byte, not
        // setSegment's different rule).
        nextStats[setWonKey] = curWon + 1;
        // K12-F18 — the set's final points, kept for the final board.
        nextStats[SET_SCORES_KEY] = appendSetScore(currentStats, home, away);
      }

      // Effect 4: advance the segment — clamp to [1, count(+OT)], the
      // same bound `setSegment` enforces.
      const lastSegment = maxSegment(def);
      const nextSegment = Math.min(
        lastSegment,
        Math.max(1, game.segment + 1),
      );
      // K12-F19 — the new set starts with a full per-set timeout bank.
      if (nextSegment !== game.segment) {
        this.refillSetTimeouts(def, nextStats);
      }

      const updated = await scope.write({
        stats: nextStats,
        homeScore: 0,
        awayScore: 0,
        segment: nextSegment,
      });

      // GameEvent trail — same shapes the four separate calls it replaces
      // produced. The SEGMENT event is the macro's undo target (it carries
      // the whole change); the rest are its itemised, `derived` detail.
      if (setWonKey) {
        await scope.event(
          'STAT',
          {
            stats: { [setWonKey]: nextStats[setWonKey] },
            oldValues: { [setWonKey]: prevSetWon },
            source: 'end-segment-macro',
          },
          { derived: true },
        );
      }
      await scope.event(
        'SCORE',
        {
          team: 'set',
          homeScore: 0,
          awayScore: 0,
          prevHomeScore: home,
          prevAwayScore: away,
          source: 'end-segment-macro',
        },
        { derived: true },
      );
      if (winCueKey) {
        const cue = def.celebrations.find((c) => c.key === winCueKey)!;
        const cueEvent = await scope.event('CUE', {
          key: cue.key,
          label: cue.label,
          emoji: cue.emoji,
          target: 'ALL',
          audioUrl: null,
          sponsorName: null,
          sponsorLogoUrl: null,
          auto: false,
          team: winner,
          source: 'end-segment-macro',
          snapshot: this.cueSnapshot(updated),
        });
        // AuditLog parity with fireCue()'s manual-cue path.
        scope.audit('SPORTS_CUE_FIRED', {
          eventId: cueEvent.id,
          key: cue.key,
          label: cue.label,
          target: 'ALL',
          team: winner,
          hasAudio: false,
          hasSponsor: false,
          source: 'end-segment-macro',
        }, { sideEffect: true });
      }
      await scope.event('SEGMENT', {
        segment: nextSegment,
        prevSegment: game.segment,
        prevClockMs: game.clockMs,
        source: 'end-segment-macro',
        change: scope.change(),
      });

      return { updated, ended: true as const };
    });
  }

  /**
   * Atomic state push from an external score source — a console tap-off
   * box or a league-feed adapter. Any subset of fields may be provided;
   * only the fields present in the dto are written. Clock fields are
   * re-anchored (clockUpdatedAt = now) whenever clockMs or clockRunning
   * is supplied, exactly as the 'set' clock action does. A GameEvent
   * row of type 'INGEST' is appended for the audit trail; the public
   * board's 750ms poll + invalidated cache then picks it up within a
   * perceived sub-second. (Audit-Fix 2: there is no pub/sub fan-out —
   * see record() and the class-level note.)
   */
  /**
   * Feed-authorized ingest: the caller proved possession of the game's feed
   * token (verified in the public board controller), so there's no dashboard
   * session / tenant context. Resolve the game's own tenant, then reuse the
   * exact same clamped `ingest()` path. Returns the game row (a packet the
   * ordering rules refused leaves it unchanged — see ingestFeedPacket for
   * the verdict).
   */
  async ingestByFeed(id: string, dto: FeedIngestDto) {
    return (await this.ingestFeedPacket(id, dto)).game;
  }

  /**
   * The machine-feed ingest WITH its verdict (K12-F14): `accepted: false` and
   * a reason when the packet was out of order, a straggler from a superseded
   * session or a duplicate — never applied, never an error the box retries.
   */
  async ingestFeedPacket(id: string, dto: FeedIngestDto): Promise<FeedIngestOutcome> {
    // ten-ok: the machine-feed lane. The caller is a vendor scoreboard box
    // holding a game-scoped feed token (already verified by the controller
    // against this game's feedTokenVersion) and has no account, so there is no
    // caller tenant to compare against. This read is the RESOLVER: the tenantId
    // it returns is what the tenant-scoped command below is run with, so the
    // feed can only ever drive the game its own token names.
    const game = await this.prisma.client.game.findUnique({
      where: { id },
      select: { tenantId: true },
    });
    if (!game) throw new NotFoundException('Game not found');
    // A machine feed has no operator at a launchpad, so this is the path
    // that should auto-fire celebrations on a score jump (the Sprint 13
    // "AUTO" trigger). The guarded admin /ingest endpoint passes no opts,
    // staying manual. stampFeed marks packets from this machine path in
    // stats.feed (the guided-setup liveness pill) — the manual admin path
    // must NOT stamp, or an operator edit would masquerade as a vendor feed.
    return this.ingestCommand(game.tenantId, id, dto, { auto: true, stampFeed: true }, feedActor('feed'));
  }

  async ingest(
    tenantId: string,
    id: string,
    dto: FeedIngestDto,
    opts: { auto?: boolean; stampFeed?: boolean } = {},
    actor?: CommandInput,
  ) {
    return (await this.ingestCommand(tenantId, id, dto, opts, actor)).game;
  }

  /**
   * One pushed snapshot, as one command.
   *
   * K12-F14 — ORDER. A snapshot may carry an envelope (session / seq /
   * eventId / occurredAt — feed-order.ts). One that is older than what the
   * game already took, a straggler from a session a newer box replaced, or a
   * repeat is refused before anything is read into the game, so a delayed or
   * replayed packet can never roll the score or the clock backwards. The
   * cursor advances in the same compare-and-swap write as the snapshot.
   *
   * K12-F14 — HONEST TIME. The clock reading stored is the feed's own reading
   * when it sent one; otherwise, on a period change, the new period's start;
   * otherwise — a boolean-only "stopped" / "running" packet — the clock's
   * CURRENT projected reading. A boolean-only stop used to keep the reading
   * from when the clock was last started, adding the elapsed time back.
   *
   * K12-F08 — a feed never runs a clock that has run out: a snapshot that
   * would leave a clock running at (or past) its expiry stores it held, and
   * when that packet is what ended the period the horn sounds once, the same
   * as the expiry sweep.
   */
  private async ingestCommand(
    tenantId: string,
    id: string,
    dto: FeedIngestDto,
    opts: { auto?: boolean; stampFeed?: boolean },
    actor: CommandInput,
  ): Promise<FeedIngestOutcome> {
    // Validated before the transaction: a malformed envelope is a 400 and
    // must never be retried.
    const envelope = cleanFeedEnvelope(dto as Record<string, unknown>);
    return this.runGameCommand(tenantId, id, 'feed.ingest', actor, dto, async (scope) => {
      const game = scope.before;
      const def = this.sportOf(game);
      const now = this.clockNow();
      const nowMs = now.getTime();

      let cursor: FeedCursor | null = null;
      if (hasEnvelope(envelope)) {
        const verdict = orderFeedPacket(readFeedCursor(game.stats), envelope);
        if (!verdict.accept) return { game, accepted: false, reason: verdict.reason };
        cursor = verdict.cursor;
      }

      const data: Record<string, unknown> = {};
      const applied: Record<string, unknown> = {};

      // Scores — clamp to non-negative integers; ignore non-numeric values.
      if (dto.homeScore !== undefined) {
        const v = Math.max(0, Math.round(Number(dto.homeScore)));
        if (Number.isFinite(v)) { data.homeScore = v; applied.homeScore = v; }
      }
      if (dto.awayScore !== undefined) {
        const v = Math.max(0, Math.round(Number(dto.awayScore)));
        if (Number.isFinite(v)) { data.awayScore = v; applied.awayScore = v; }
      }

      // Segment — clamp to >= 1. A new period resets the game clock to the
      // period start and stops it, as setSegment does (a count-up soccer clock
      // would otherwise jump forward by the whole halftime gap).
      let newSegment: number | null = null;
      if (dto.segment !== undefined) {
        const v = Math.max(1, Math.round(Number(dto.segment)));
        if (Number.isFinite(v)) {
          data.segment = v;
          applied.segment = v;
          if (v !== game.segment) newSegment = v;
        }
      }

      // Clock — re-anchored at `now` whenever the snapshot says anything about
      // it. When the running state changes, the same helper chain clockAction
      // uses freezes / resumes the penalty box and slaves the shot clock —
      // "all the same rules apply if we are doing it or the integration is
      // doing it" (Greg's rule, research doc §3).
      const clockProvided = dto.clockMs !== undefined || dto.clockRunning !== undefined;
      let endsPeriod = false;
      if (def.clock.type !== 'none' && (clockProvided || newSegment !== null)) {
        const feedMs = dto.clockMs !== undefined ? Math.max(0, Math.round(Number(dto.clockMs))) : NaN;
        let nextMs: number;
        if (Number.isFinite(feedMs)) {
          nextMs = feedMs;
          applied.clockMs = feedMs;
        } else if (newSegment !== null) {
          nextMs = isUntimedSegment(def, newSegment) ? 0 : this.segmentStartMs(def, game.stats, newSegment);
        } else {
          nextMs = projectGameClockMs(game, def.clock.type, nowMs);
        }
        const wanted =
          dto.clockRunning !== undefined ? Boolean(dto.clockRunning) : newSegment !== null ? false : game.clockRunning;
        if (dto.clockRunning !== undefined) applied.clockRunning = wanted;
        let nextRunning = wanted;
        if (isGameClockExpired(def, game.stats, nextMs)) {
          const wasHeld =
            newSegment === null &&
            !game.clockRunning &&
            isGameClockExpired(def, game.stats, projectGameClockMs(game, def.clock.type, nowMs));
          endsPeriod = game.status === 'LIVE' && (game.clockRunning || wanted) && !wasHeld;
          if (nextRunning) {
            nextRunning = false;
            applied.clockRunning = false;
          }
          if (endsPeriod) applied.expired = true;
        }
        data.clockMs = nextMs;
        data.clockRunning = nextRunning;
        data.clockUpdatedAt = now;
        applied.clockUpdatedAt = now;

        if (nextRunning !== game.clockRunning) {
          let mergedStats = this.syncPenaltiesToClock(game.stats, nextRunning, now);
          const sourceStats = mergedStats ?? game.stats;
          // T2-10: clamp the shot clock to the new game-clock reading.
          const shotStats = this.syncShotClockToGameClock(sourceStats, true, nextRunning, now, nextMs);
          if (shotStats) mergedStats = shotStats;
          if (mergedStats) data.stats = mergedStats;
        }
      }

      if (Object.keys(data).length === 0) {
        // Nothing to apply. For the machine-feed path this is the idle-but-
        // connected heartbeat (a vendor box POSTing an empty/unchanged body):
        // the packet itself is liveness proof, so stamp stats.feed (throttled
        // to one write per FEED_STAMP_MIN_INTERVAL_MS) or the guided-setup
        // pill would report a healthy feed as dead. A sequenced heartbeat
        // still advances the ordering cursor.
        const stampDue = !!opts.stampFeed && this.feedStampDue(game.stats, nowMs);
        if (stampDue || cursor) {
          const prev = game.stats && typeof game.stats === 'object' ? (game.stats as Record<string, unknown>) : {};
          const stats: Record<string, unknown> = { ...prev };
          if (stampDue) stats.feed = this.feedStamp('feed', false);
          if (cursor) stats.feedCursor = cursor;
          return { game: await scope.write({ stats }), accepted: true };
        }
        return { game, accepted: true };
      }

      // Machine-feed liveness stamp and the ordering cursor ride THIS write.
      // The stamp is attached only when stats is already being written (free)
      // or the previous stamp is past the throttle window; the cursor always.
      const stampNow =
        !!opts.stampFeed && (data.stats !== undefined || !!cursor || this.feedStampDue(game.stats, nowMs));
      if (stampNow || cursor) {
        const base = data.stats ?? game.stats;
        const baseObj: Record<string, unknown> =
          base && typeof base === 'object' ? { ...(base as Record<string, unknown>) } : {};
        if (stampNow) baseObj.feed = this.feedStamp('feed', true);
        if (cursor) baseObj.feedCursor = cursor;
        data.stats = baseObj;
      }

      const prevScores = {
        homeScore: Number(game.homeScore) || 0,
        awayScore: Number(game.awayScore) || 0,
      };
      const updated = await scope.write(data);
      // Efficiency #3 counterpart of clockAction's wake: a feed that starts
      // (or re-anchors) a running clock snaps the expiry sweep out of its 30s
      // idle backoff.
      if ((clockProvided || newSegment !== null) && updated.clockRunning) scope.after(() => wakeClockSweep());
      await scope.event('INGEST', {
        ...applied,
        ...(hasEnvelope(envelope) ? { envelope } : {}),
        change: scope.change(),
      });
      if (endsPeriod) {
        await scope.event('CLOCK', {
          action: 'expired',
          segment: updated.segment,
          clockMs: updated.clockMs,
          clockRunning: false,
          auto: true,
          source: 'feed',
        });
        await scope.event('CUE', {
          key: 'horn',
          label: 'Horn',
          emoji: '📯',
          target: 'ALL',
          auto: true,
          source: 'clock-expired',
          segmentLabel: this.segmentLabelOf(def, updated.segment),
        });
      }

      // AUTO celebration trigger — only on the machine-feed path, and only
      // when a score field was actually applied.
      if (opts.auto && (data.homeScore !== undefined || data.awayScore !== undefined)) {
        await this.autoCelebrateInCommand(
          scope,
          prevScores,
          updated,
          { home: data.homeScore !== undefined, away: data.awayScore !== undefined },
          'feed',
        );
      }
      return { game: updated, accepted: true };
    });
  }

  /**
   * The Sprint 13 "AUTO" trigger, run INSIDE the scoring command. For each
   * team whose score the command increased (among the columns it was given),
   * find the celebration whose `autoPoints` includes the delta and fire it —
   * the same CUE shape the manual launchpad (`fireCue`) writes, so every
   * board / ribbon / scorebug surface plays it with zero rendering changes.
   * Tagged `{ auto: true, team }` so the overlay can theme to the scoring
   * side. Honors the per-game toggle (default ON). Because it runs in the
   * command's transaction, a retried or replayed score command can never
   * celebrate twice, and a rolled-back one never celebrates at all.
   */
  private async autoCelebrateInCommand(
    scope: GameCommandScope,
    prev: { homeScore: number; awayScore: number },
    next: GameRow,
    provided: { home: boolean; away: boolean },
    source: 'manual' | 'feed',
  ): Promise<void> {
    const id = next.id;
    if (!(await this.autoCelebrateEnabled(id, scope.tx))) return;

    let def: SportDefinition;
    try {
      def = this.sportOf(next);
    } catch {
      return; // unknown sport — nothing to map a delta to
    }

    const hits: Array<{ team: 'home' | 'away'; cue: SportDefinition['celebrations'][number] }> = [];
    for (const team of ['home', 'away'] as const) {
      if (!(team === 'home' ? provided.home : provided.away)) continue;
      const before = team === 'home' ? prev.homeScore : prev.awayScore;
      const after = team === 'home' ? next.homeScore : next.awayScore;
      const delta = after - before;
      if (delta <= 0) continue; // only score INCREASES fire; corrections don't
      const cue = def.celebrations.find(
        (c) => Array.isArray(c.autoPoints) && c.autoPoints.includes(delta),
      );
      if (cue) hits.push({ team, cue });
    }
    if (hits.length === 0) return;

    // Celebration mutex (2026-06-12, operator-reported double-fire): the
    // designed scorer flow is "tap cue → pick player → fire (named
    // cinematic) → tap +1 to record the score" — and the +1 then auto-fired
    // a SECOND, unnamed GOAL cinematic for the same team. Suppress an AUTO
    // fire when an OPERATOR-FIRED (non-auto) cue for the same team landed
    // within the cinematic window — the named cue always wins; the auto
    // path is the backstop for un-narrated scores, never a second show.
    // Deliberately NOT mutexed: auto-after-auto. Two real goals seconds
    // apart must BOTH celebrate. Read through `tx`: a command never takes a
    // second pool connection while it holds one.
    const CELEBRATION_MUTEX_MS = 10_000;
    const recentCues = await scope.tx.gameEvent.findMany({
      where: {
        gameId: id,
        type: 'CUE',
        createdAt: { gte: new Date(Date.now() - CELEBRATION_MUTEX_MS) },
      },
      orderBy: { createdAt: 'desc' },
      take: 8,
    });
    const mutexedTeams = new Set<string>();
    for (const ev of recentCues as Array<{ payload: unknown }>) {
      const payload = ev.payload as { team?: unknown; auto?: unknown } | null;
      if (payload?.auto === true) continue; // auto fires never mutex real scores
      const evTeam = payload?.team;
      if (evTeam === 'home' || evTeam === 'away') mutexedTeams.add(evTeam);
    }
    const firable = hits.filter((h) => !mutexedTeams.has(h.team));
    if (firable.length < hits.length) {
      this.logger.debug(
        `auto-celebrate mutex: suppressed ${hits.length - firable.length} fire(s) for game ${id} (cue within ${CELEBRATION_MUTEX_MS}ms window)`,
      );
    }
    const snapshot = this.cueSnapshot(next);
    for (const h of firable) {
      const event = await scope.event('CUE', {
        key: h.cue.key,
        label: h.cue.label,
        emoji: h.cue.emoji,
        target: 'ALL',
        audioUrl: null,
        sponsorName: null,
        sponsorLogoUrl: null,
        auto: true,
        team: h.team,
        source,
        snapshot,
      });
      // Lane-8 P1 / Audit-Fix 1: an AUTO cue gets its own AuditLog row,
      // attributed to the command's actor (an operator for a manual tap, no
      // user for a machine feed) — in the same transaction as the score.
      scope.audit('SPORTS_CUE_FIRED', {
        eventId: event.id,
        key: h.cue.key,
        label: h.cue.label,
        target: 'ALL',
        team: h.team,
        auto: true,
        source,
      }, { sideEffect: true });
    }
  }

  /**
   * Per-game AUTO-celebrate toggle. Reads the in-memory cache; on a miss,
   * hydrates ONCE from the latest AUTO_CELEBRATE GameEvent (default ON when
   * none exists). Fails OPEN to the default on any read error so a feed
   * game still gets its show — never blocks the score sync.
   */
  private async autoCelebrateEnabled(gameId: string, client?: any): Promise<boolean> {
    const cached = this.autoCelebrateCache.get(gameId);
    if (cached !== undefined) return cached;
    let enabled = true;
    try {
      const ev = await (client ?? this.prisma.client).gameEvent.findFirst({
        where: { gameId, type: 'AUTO_CELEBRATE' },
        orderBy: { createdAt: 'desc' },
      });
      const payload = ev?.payload as { enabled?: unknown } | null;
      if (payload && typeof payload.enabled === 'boolean') enabled = payload.enabled;
    } catch {
      /* fail open to default ON */
    }
    this.autoCelebrateCache.set(gameId, enabled);
    return enabled;
  }

  /** Read the current AUTO-celebrate toggle for a game (tenant-scoped). */
  async getAutoCelebrate(tenantId: string, id: string) {
    await this.owned(tenantId, id);
    return { enabled: await this.autoCelebrateEnabled(id) };
  }

  /** Flip the AUTO-celebrate toggle. Persists a latest-wins AUTO_CELEBRATE
   *  GameEvent (no migration) and updates the hot-path cache in place. */
  async setAutoCelebrate(tenantId: string, id: string, enabled: unknown, actor?: CommandInput) {
    await this.owned(tenantId, id);
    const val = Boolean(enabled);
    const before = await this.autoCelebrateEnabled(id);
    await this.recordAudited(tenantId, id, 'AUTO_CELEBRATE', { enabled: val }, actor,
      'SPORTS_AUTO_CELEBRATE_SET', (eventId) => ({ eventId, before, after: val }));
    this.autoCelebrateCache.set(id, val);
    return { enabled: val };
  }

  /** Change the game status (SCHEDULED → LIVE → HALFTIME → FINAL …). */
  async setStatus(tenantId: string, id: string, dto: { status?: string }, actor?: CommandInput) {
    const status = String(dto.status || '');
    if (!GAME_STATUSES.includes(status)) {
      throw new BadRequestException(`status must be one of ${GAME_STATUSES.join(', ')}`);
    }
    return this.runGameCommand(tenantId, id, `status.${status.toLowerCase()}`, actor, dto, async (scope) => {
      const game = scope.before;
      // A repeated "end game" on a FINAL game changes nothing and fires no
      // second cinematic. Leaving FINAL is refused by the lock in
      // runGameCommand (409 GAME_FINAL) — only reopenGame does that.
      if (game.status === 'FINAL' && status === 'FINAL') return game;
      const now = this.clockNow();
      const data: Record<string, unknown> = { status };
      if (status === 'LIVE' && !game.startedAt) data.startedAt = now;
      // K12-F07 — halftime and the final are stoppages: every clock that is
      // running freezes at its CURRENT reading, in this same write — the game
      // clock, the shot clock, the penalty box and the football play clock.
      // HALFTIME used to leave the game clock running through the break, and
      // FINAL stopped it without projecting it, so the board jumped back to
      // the reading it had when it was last started.
      if (status === 'HALFTIME' || status === 'FINAL') Object.assign(data, this.freezeAllClocks(game, now));
      if (status === 'FINAL') data.endedAt = now;
      const updated = await scope.write(data);
      await scope.event('STATUS', { status, prevStatus: game.status, change: scope.change() });

      // T1-5: Status-transition cinematics — a synthetic CUE event so every
      // surface (board, ribbon, scorebug) can play a visual/audio cue instead
      // of silently swapping the scene on the next poll.
      if (status === 'HALFTIME') {
        await scope.event('CUE', {
          key: 'status:halftime',
          label: 'Halftime',
          emoji: '🏟️',
          target: 'ALL',
          auto: true,
          source: 'status-transition',
          snapshot: this.cueSnapshot(updated),
        });
      } else if (status === 'FINAL') {
        // K12-F18 — the final cue announces the sport's RESULT (sets, a dual's
        // team points, the low score), never a comparison of the raw columns.
        await scope.event('CUE', this.finalResultCue(updated, 'status-transition'));
        // K12-F39 — the season roll-up is QUEUED in this transaction (a
        // crash after commit cannot lose it) and applied after commit; the
        // schedule-game-mode FINAL hook stays post-commit and fail-open.
        // Neither may block or roll back the operator's "end game".
        await this.queueStatRollup(scope, updated);
        scope.after(() => this.onGameFinal(tenantId, id));
      }
      return updated;
    });
  }

  /**
   * K12-F13 — reopen a FINAL game for a correction: the one, named, audited
   * way out of the FINAL lock. Requires a reason (kept on the STATUS event and
   * the SPORTS_GAME_REOPENED audit row with the actor). The game returns to
   * LIVE with no cinematic; the scorer corrects it with the ordinary controls
   * (each one attributed) and ends it again, which re-rolls the player stats
   * for the corrected result (K12-F39).
   */
  async reopenGame(
    tenantId: string,
    id: string,
    dto: { reason?: unknown },
    actor?: CommandInput,
  ) {
    const reason = typeof dto?.reason === 'string' ? dto.reason.trim().slice(0, 500) : '';
    if (reason.length < 5) {
      throw new BadRequestException({
        code: 'REOPEN_REASON_REQUIRED',
        message: 'Say why the final result is being reopened (at least 5 characters).',
      });
    }
    return this.runGameCommand(tenantId, id, 'game.reopen', actor, { reason }, async (scope) => {
      const game = scope.before;
      if (game.status !== 'FINAL') {
        throw new ConflictException({
          code: 'GAME_NOT_FINAL',
          message: 'Only a final game can be reopened.',
        });
      }
      // K12-F37 — a correction during the postgame hold keeps the board up:
      // the pending return (Game.autoPushAt, set only by the hold once a game
      // is final) is cancelled here, and the corrected game's own final starts
      // a fresh hold.
      const cancelsHold = !!game.autoPushAt;
      const updated = await scope.write({
        status: 'LIVE',
        endedAt: null,
        ...(cancelsHold ? { autoPushAt: null } : {}),
      });
      await this.holdStatRollupForReopen(scope, game);
      const change = scope.change();
      await scope.event('STATUS', { status: 'LIVE', prevStatus: 'FINAL', reopened: true, reason, change });
      if (cancelsHold) {
        const latest = await scope.tx.gameEvent.findFirst({
          where: { gameId: id, type: 'AUTO_PUSH' },
          orderBy: { createdAt: 'desc' },
        });
        const kept: AutoPushConfig = { ...this.parseAutoPushPayload(latest?.payload), returnAt: null };
        await scope.event('AUTO_PUSH', this.autoPushPayload(kept), { derived: true });
        scope.after(() => this.autoPushCache.set(id, kept));
      }
      // K12-F18 — the result being reopened, as the sport decides it (a
      // volleyball match's sets; its rally columns read 0–0).
      const finalResult = gameResult(game);
      scope.audit('SPORTS_GAME_REOPENED', {
        reason,
        finalScore: { home: game.homeScore, away: game.awayScore },
        finalResult: {
          basis: finalResult.basis,
          outcome: finalResult.outcome,
          home: finalResult.home,
          away: finalResult.away,
        },
        postgameHoldCancelled: cancelsHold,
        revisionBefore: game.version,
        revisionAfter: updated.version,
      });
      return updated;
    });
  }

  /**
   * PHASE 2 — roll a FINAL game's player stats into the season / career
   * tables. Gated behind SPORTS_PLAYER_STATS for the tenant; fail-open.
   */
  /**
   * K12-F39 — queue a final game's season roll-up INSIDE the command that
   * made it final, at the revision that command produced, then apply it
   * after commit. A game finalized again after a correction re-queues at the
   * new revision; the apply moves the season totals by the difference.
   */
  private async queueStatRollup(scope: GameCommandScope, updated: GameRow): Promise<void> {
    const revision = typeof updated.version === 'number' ? updated.version : 0;
    await scope.tx.gameStatRollup.upsert({
      where: { gameId: updated.id, tenantId: updated.tenantId },
      create: {
        gameId: updated.id,
        tenantId: updated.tenantId,
        state: STAT_ROLLUP_STATE.PENDING,
        targetRevision: revision,
        contribution: [],
        attempts: 0,
      },
      update: { state: STAT_ROLLUP_STATE.PENDING, targetRevision: revision, lastError: null },
    });
    scope.after(() => this.runStatRollup(updated.tenantId, updated.id, updated.homeTeamId));
  }

  /**
   * K12-F39 — on reopen: a roll-up that has not applied yet waits for the
   * next FINAL (it must not roll a half-corrected box score), and a game
   * rolled up by the old marker-based finalize gets a baseline job holding
   * what it contributed, so the corrected FINAL moves the totals by the
   * difference instead of adding the game a second time.
   */
  private async holdStatRollupForReopen(scope: GameCommandScope, game: GameRow): Promise<void> {
    const tx = scope.tx;
    const job = await tx.gameStatRollup.findFirst({ where: { gameId: game.id, tenantId: game.tenantId } });
    if (job) {
      if (job.state === STAT_ROLLUP_STATE.PENDING || job.state === STAT_ROLLUP_STATE.FAILED) {
        await tx.gameStatRollup.update({
          where: { gameId: game.id, tenantId: game.tenantId },
          data: { state: STAT_ROLLUP_STATE.REOPENED },
        });
      }
      return;
    }
    if (!hasLegacyFinalizeMarker(game.stats)) return;
    const roster = await tx.rosterPlayer.findMany({
      where: { gameId: game.id, tenantId: game.tenantId, personId: { not: null } },
      select: { personId: true, teamId: true, stats: true },
    });
    const revision = typeof game.version === 'number' ? game.version : 0;
    await tx.gameStatRollup.create({
      data: {
        gameId: game.id,
        tenantId: game.tenantId,
        state: STAT_ROLLUP_STATE.APPLIED,
        targetRevision: revision,
        appliedRevision: revision,
        contribution: computeGameContribution(game, roster) as any,
        attempts: 0,
      },
    });
  }

  /**
   * K12-F39 — apply a queued roll-up (post-commit hook, retry sweep, admin
   * retry). Fail-open for the caller: a failure is recorded on the job
   * (FAILED, the error, the attempt) and logged, and the sweep retries it.
   */
  private async runStatRollup(
    tenantId: string,
    gameId: string,
    homeTeamId: string | null | undefined,
  ): Promise<void> {
    try {
      const statsOn = await this.flags.isEnabledAsync(FLAGS.SPORTS_PLAYER_STATS, { tenantId });
      if (!statsOn) {
        await this.prisma.client.gameStatRollup.updateMany({
          where: { gameId, tenantId, state: STAT_ROLLUP_STATE.PENDING },
          data: { state: STAT_ROLLUP_STATE.SKIPPED },
        });
        return;
      }
      // 2026-06-25 — self-link any unlinked HOME roster players BEFORE the
      // roll-up, which only aggregates LINKED rows, so a roster built any
      // way (not just CSV import) accumulates, and pre-existing unlinked
      // rosters back-fill on their next finalize.
      const linked = await this.autoLinkHomeRoster(tenantId, gameId, homeTeamId);
      if (linked > 0) {
        this.logger.log(`finalize self-linked ${linked} home roster player(s) game=${gameId} tenant=${tenantId}`);
      }
      const result = await applyGameStatRollup(this.prisma.client, tenantId, gameId);
      this.logger.log(
        `stat roll-up game=${gameId} tenant=${tenantId} applied=${result.applied} aggregated=${result.aggregated}${
          result.revision !== undefined ? ` revision=${result.revision}` : ''
        }${result.skipped ? ` skipped=${result.skipped}` : ''}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`stat roll-up FAILED game=${gameId} tenant=${tenantId} (will retry): ${message}`);
      try {
        await this.prisma.client.gameStatRollup.updateMany({
          where: {
            gameId,
            tenantId,
            state: { in: [STAT_ROLLUP_STATE.PENDING, STAT_ROLLUP_STATE.FAILED] },
          },
          data: {
            state: STAT_ROLLUP_STATE.FAILED,
            lastError: message.slice(0, 500),
            attempts: { increment: 1 },
          },
        });
      } catch (markErr) {
        this.logger.error(
          `stat roll-up failure could not be recorded game=${gameId}: ${
            markErr instanceof Error ? markErr.message : String(markErr)
          }`,
        );
      }
    }
  }

  /**
   * K12-F39 — the retry sweep (GameScheduleService, about once a minute). A
   * PENDING job older than STAT_ROLLUP_PENDING_GRACE_MS lost its post-commit
   * hook (a restart between commit and apply); a FAILED job is retried with
   * back-off (a minute per attempt, capped at an hour) until
   * STAT_ROLLUP_MAX_ATTEMPTS, then stays FAILED for an administrator. Every
   * apply is claimed on the job row, so this is safe on every replica at
   * once — NO LEADER LEASE, DELIBERATELY: a wedged lease holder must not
   * stall the season totals, and the claim already makes it exactly-once.
   */
  async sweepStatRollups(now = Date.now()): Promise<{ found: number; attempted: number }> {
    // ten-ok: a cross-tenant worker scan; every row it touches is then
    // applied through its own tenant-scoped reads and writes.
    const rows = await this.prisma.client.gameStatRollup.findMany({
      where: {
        OR: [
          { state: STAT_ROLLUP_STATE.PENDING, updatedAt: { lt: new Date(now - STAT_ROLLUP_PENDING_GRACE_MS) } },
          {
            state: STAT_ROLLUP_STATE.FAILED,
            attempts: { lt: STAT_ROLLUP_MAX_ATTEMPTS },
            updatedAt: { lt: new Date(now - 60_000) },
          },
        ],
      },
      orderBy: { updatedAt: 'asc' },
      take: 20,
      select: { gameId: true, tenantId: true, state: true, attempts: true, updatedAt: true },
    });
    let attempted = 0;
    for (const r of rows) {
      if (r.state === STAT_ROLLUP_STATE.FAILED) {
        const backoffMs = Math.min(60, Math.max(1, r.attempts)) * 60_000;
        if (now - new Date(r.updatedAt).getTime() < backoffMs) continue;
      }
      const game = await this.prisma.client.game.findFirst({
        where: { id: r.gameId, tenantId: r.tenantId },
        select: { homeTeamId: true },
      });
      attempted += 1;
      await this.runStatRollup(r.tenantId, r.gameId, game?.homeTeamId);
    }
    return { found: rows.length, attempted };
  }

  /** K12-F39 — a final game's roll-up job, as the console shows it. */
  private async statRollupStatus(tenantId: string, gameId: string) {
    const job = await this.prisma.client.gameStatRollup.findFirst({
      where: { gameId, tenantId },
      select: {
        state: true,
        targetRevision: true,
        appliedRevision: true,
        attempts: true,
        lastError: true,
        updatedAt: true,
      },
    });
    return job ?? null;
  }

  /**
   * K12-F39 — an administrator's "try again now" for a failed roll-up (the
   * sweep retries on its own; this skips the back-off). Audited.
   */
  async retryStatRollup(tenantId: string, gameId: string, actor?: CommandInput) {
    const game = await this.owned(tenantId, gameId);
    if (game.status !== 'FINAL') {
      throw new ConflictException({ code: 'GAME_NOT_FINAL', message: 'Only a final game rolls up season stats.' });
    }
    await this.prisma.client.$transaction(async (tx: any) => {
      const res = await tx.gameStatRollup.updateMany({
        where: { gameId, tenantId, state: STAT_ROLLUP_STATE.FAILED },
        data: { state: STAT_ROLLUP_STATE.PENDING },
      });
      await this.auditRow(tx, tenantId, actor, 'SPORTS_STATS_ROLLUP_RETRIED', gameId, {
        requeued: res.count > 0,
      });
    });
    await this.runStatRollup(tenantId, gameId, game.homeTeamId);
    return { statRollup: await this.statRollupStatus(tenantId, gameId) };
  }

  // ── PHASE 2 — persistent season/career stat reads + roster→person link ──
  //
  // Thin pass-throughs to the engine in sports-stats.service.ts. The reads
  // hit the materialized aggregate tables (fast, indexed — never the board
  // poll). tenantId comes from the authed context at the controller.

  /** Cross-game stat leaderboard for a stat (season or career scope). */
  async getLeaders(args: {
    tenantId: string;
    sport: string;
    season?: string;
    statKey: string;
    scope: 'SEASON' | 'CAREER';
    limit: number;
  }) {
    return getStatLeaders(this.prisma.client, args);
  }

  /** One athlete's full season + career stat line for the career page. */
  async getAthleteCareer(args: { tenantId: string; personId: string }) {
    return getAthleteCareer(this.prisma.client, args);
  }

  // ── S1: shareable public athlete profile ─────────────────────────────
  /** Public, privacy-minimal athlete profile by share token (null if off). */
  async getPublicAthleteProfile(token: string) {
    return getPublicAthleteProfile(this.prisma.client, token);
  }

  /**
   * Turn an athlete's public share ON: verify the person is this tenant's,
   * (re)issue an unguessable token, flip isPublic, audit. Returns the token so
   * the console can build the /athlete/:token link. Re-calling rotates the
   * token (orphaning any previously-shared link).
   */
  async setAthleteShare(tenantId: string, personId: string, actor?: CommandInput) {
    const person = await this.prisma.client.sportsPerson.findFirst({
      where: { id: personId, tenantId },
      select: { id: true, directoryOptOut: true, photoRelease: true },
    });
    if (!person) throw new NotFoundException('Athlete not found');
    // K-12 launch, lane B3 — a public athlete page is a public output of a
    // student's name. Refuse to create one the school's policy, or the
    // family's opt-out, keeps off public screens (the page would 404 anyway;
    // this says why, at the moment the operator asks).
    const shown = studentRosterPrivacy(studentFlags(person), await loadStudentPolicy(this.prisma.client, tenantId));
    if (shown.names === 'hidden') {
      throw new ConflictException({
        code: 'STUDENT_PRIVACY_BLOCKS_SHARE',
        message: person.directoryOptOut
          ? "This student's family opted out of directory information, so their stats page cannot be shared."
          : 'Student names stay off public pages until an administrator confirms your directory-information policy in Settings → Sports.',
      });
    }
    const token = randomUUID().replace(/-/g, '');
    // K12-F34: the share and its audit row commit together.
    await this.prisma.client.$transaction(async (tx: any) => {
      await tx.sportsPerson.update({
        where: { id: personId, tenantId },
        data: { isPublic: true, publicShareToken: token },
      });
      await this.auditRow(tx, tenantId, actor, 'SPORTS_ATHLETE_SHARED', personId, { token }, 'SportsPerson');
    });
    return { shared: true, token };
  }

  /** Turn an athlete's public share OFF — the existing link 404s immediately. */
  async unsetAthleteShare(tenantId: string, personId: string, actor?: CommandInput) {
    const person = await this.prisma.client.sportsPerson.findFirst({
      where: { id: personId, tenantId },
      select: { id: true },
    });
    if (!person) throw new NotFoundException('Athlete not found');
    await this.prisma.client.$transaction(async (tx: any) => {
      await tx.sportsPerson.update({
        where: { id: personId, tenantId },
        data: { isPublic: false },
      });
      await this.auditRow(tx, tenantId, actor, 'SPORTS_ATHLETE_UNSHARED', personId, {}, 'SportsPerson');
    });
    return { shared: false };
  }

  /** Link a per-game roster row to a persistent SportsPerson. */
  async linkPlayer(
    args: {
      tenantId: string;
      rosterPlayerId: string;
      personId?: string;
      fullName?: string;
      teamId?: string;
    },
    actor?: CommandInput,
  ) {
    // The link helper runs its own bounded retries, so it cannot share a
    // transaction; the audit row is written strictly after it and is NOT
    // best-effort (an error reaches the caller, who can safely retry — a
    // re-link to the same athlete is idempotent).
    const linked = await linkRosterPlayerToPerson(this.prisma.client, args);
    await this.auditRow(this.prisma.client, args.tenantId, actor, 'SPORTS_ROSTER_PLAYER_LINKED', args.rosterPlayerId, {
      personId: linked.personId,
      requestedPersonId: args.personId ?? null,
      teamId: args.teamId ?? null,
    }, 'RosterPlayer');
    return linked;
  }

  /**
   * A frozen snapshot of the live game state at cue-fire time. Embedded
   * in the CUE event so a celebration overlay can show the EXACT score
   * and clock of the moment — even if the operator bumps the score a
   * second later. The board reads ready-to-display strings; there is no
   * client-side projection (a celebration is a frozen instant, not a
   * ticking clock).
   */
  private cueSnapshot(game: {
    sport: string;
    // K12-F01 — the bound rules name the period ("SV", "OT") and the clock.
    rules?: unknown;
    homeTeam: string;
    awayTeam: string;
    homeScore: number;
    awayScore: number;
    homeColor: string | null;
    awayColor: string | null;
    segment: number;
    clockMs: number;
    clockRunning: boolean;
    clockUpdatedAt: Date;
  }): Record<string, unknown> {
    let segmentLabel = '';
    let clockText = '';
    try {
      const def = this.sportOf(game);
      segmentLabel = this.segmentLabelOf(def, game.segment);
      if (def.clock.type !== 'none') {
        // K12-F17 — the one display policy every surface uses (a buzzer-
        // beater cue in the final minute reads "4.3", not "0:04").
        clockText = formatSportClock(def, this.liveClockMs(game));
      }
    } catch {
      // Unknown sport — the score still snapshots; clock/segment stay blank.
    }
    return {
      homeTeam: game.homeTeam,
      awayTeam: game.awayTeam,
      homeScore: game.homeScore,
      awayScore: game.awayScore,
      homeColor: game.homeColor,
      awayColor: game.awayColor,
      segmentLabel,
      clockText,
    };
  }

  /** Short segment label — "Q3", "3RD INN", "SET 2", "OT". */
  private segmentLabelOf(def: SportDefinition, n: number): string {
    const name = def.segment.name;
    // SHARED-SPEC segment-overflow label — a segment past the regulation
    // count must NOT blindly read "OT":
    //   · Inning (baseball/softball) → the inning ordinal ("10TH INN"),
    //     never "OT" — extra innings just keep counting.
    //   · hole-based / LEADERBOARD (golf, track, etc.) → clamp at the
    //     last segment and show "F" (final); a meet/round never "OT"s.
    //   · period/quarter/half sports with overtime:true → "OT"/"2OT".
    if (n > def.segment.count) {
      if (name === 'Inning') return `${this.ordinal(n)} INN`;
      if (def.mode === 'LEADERBOARD' || def.segment.overtime === false) return 'F';
      // The rules' own overtime names (NFHS wrestling SV / TB1 / TB2 / UTB,
      // K12-F23), else OT / OT2 / OT3 — the shared helper every surface uses.
      return overtimeLabel(def, n) ?? 'OT';
    }
    if (name === 'Quarter') return `Q${n}`;
    if (name === 'Period') return `P${n}`;
    if (name === 'Inning') return `${this.ordinal(n)} INN`;
    if (name === 'Set') return `SET ${n}`;
    if (name === 'Half') return `${this.ordinal(n)} HALF`;
    return `${name.toUpperCase()} ${n}`;
  }

  private ordinal(n: number): string {
    const suf = ['TH', 'ST', 'ND', 'RD'];
    const v = n % 100;
    return `${n}${suf[(v - 20) % 10] || suf[v] || suf[0]}`;
  }

  /**
   * Normalize an untrusted cue target — which surfaces play the cue:
   *   BOARD  — scoreboards + broadcast scorebugs
   *   RIBBON — ribbon / fascia boards
   *   ALL    — every surface showing this game
   * Defaults to ALL. The target rides in the CUE payload; each
   * surface checks it before playing, so one tap can light up the
   * ribbon, the scoreboards, or every screen showing the game.
   */
  private cleanCueTarget(v: unknown): 'BOARD' | 'RIBBON' | 'ALL' {
    const s = String(v || 'ALL').toUpperCase();
    return s === 'BOARD' || s === 'RIBBON' ? s : 'ALL';
  }

  /**
   * Fire a cue. Either a built-in sport celebration (`key` — "Touchdown",
   * "GOAL!", validated against the sport) OR an operator-built custom
   * cue (`cueId` — a named trigger with uploaded takeover content).
   * `target` scopes which surfaces play it (scoreboard / ribbon / all).
   * Both land as a CUE GameEvent that every surface playing the game
   * polls; a surface plays the cue only when the target includes it.
   *
   * Optional co-branding: `audioUrl` plays a sound clip on every surface
   * that receives the cue; `sponsorName` + `sponsorLogoUrl` overlay a
   * co-branded attribution line ("This touchdown brought to you by …").
   * All three are optional — existing cues without them are unaffected.
   */
  async fireCue(
    tenantId: string,
    id: string,
    dto: {
      key?: string;
      cueId?: string;
      target?: string;
      audioUrl?: string;
      sponsorName?: string;
      sponsorLogoUrl?: string;
      // Lane-8 P1: scoring team — drives the celebration's team-color brand
      // shim. Manual path was previously missing this; only AUTO set it.
      team?: 'home' | 'away' | null;
      // 2026-05-27 — Player attribution for the celebration. Operator:
      // "shouldn't my cues tie back to a player? so it says like Goal
      // and has the name of the player that got the goal and number".
      // Most common path: ribbon's RunInlineCuesBar reads the currently
      // -spotlit player and attaches them here when firing GOAL (or
      // any celebration). Cinematic reads these off the cue and shows
      // "SCORED BY #12 SMITH" on its lower-third.
      scorerName?: string;
      scorerNumber?: string;
      scorerPhotoUrl?: string;
      scorerId?: string;
      /**
       * T2-6 — When true, the ribbon renders a tight 2.5s text-crawl
       * strip instead of the full 4500ms cinematic. Scoreboard is
       * unaffected. Automatically set when the operator fires from the
       * inline cue bar's "Ribbon" chip.
       */
      ribbonStrip?: boolean;
    },
    actor?: CommandInput,
  ) {
    const game = await this.owned(tenantId, id);
    const target = this.cleanCueTarget(dto.target);
    const ribbonStrip = target === 'RIBBON' || dto.ribbonStrip === true ? true : undefined;

    // Sanitize the three new optional co-branding / audio fields.
    const audioUrl = this.cleanText(dto.audioUrl, 2048);
    const sponsorName = this.cleanText(dto.sponsorName, 120);
    const sponsorLogoUrl = this.cleanText(dto.sponsorLogoUrl, 2048);
    const team = dto.team === 'home' || dto.team === 'away' ? dto.team : null;
    // Scorer attribution — clipped to display-safe lengths.
    const scorerName = this.cleanText(dto.scorerName, 80);
    const scorerNumber = this.cleanText(dto.scorerNumber, 8);
    const scorerPhotoUrl = this.cleanText(dto.scorerPhotoUrl, 2048);
    const scorerId = this.cleanText(dto.scorerId, 64);

    // Lane-8 P1: mirror every cue-fire into the immutable AuditLog so a
    // game-presentation forensics review can answer "who fired which
    // sponsor takeover at 7:42 in Q3". K12-F34: the CUE event and its audit
    // row now commit together (recordAudited) — the audit write used to be
    // best-effort, so a cue could fire with no record of who fired it.
    const auditDetails = (eventId: string, key: string, label: string) => ({
      eventId, key, label, target, team,
      hasAudio: !!audioUrl,
      hasSponsor: !!(sponsorName || sponsorLogoUrl),
    });

    // Custom cue — operator-defined trigger from the cue deck.
    if (dto.cueId) {
      const cc = await this.prisma.client.customCue.findFirst({
        where: { id: dto.cueId, tenantId },
      });
      if (!cc) throw new BadRequestException('Custom cue not found');
      const event = await this.recordAudited(tenantId, id, 'CUE', {
        key: `custom:${cc.id}`,
        label: cc.name,
        mediaUrl: cc.mediaUrl || null,
        color: cc.color || null,
        durationMs: cc.durationMs,
        displayMode: (cc as any).displayMode || 'overlay',
        custom: true,
        target,
        // T2-6: ribbon-strip mode — tight 2.5s crawl instead of 4500ms takeover.
        ...(ribbonStrip ? { ribbonStrip: true } : {}),
        audioUrl,
        sponsorName,
        sponsorLogoUrl,
        team,
        scorerName,
        scorerNumber,
        scorerPhotoUrl,
        scorerId,
        snapshot: this.cueSnapshot(game),
      }, actor, 'SPORTS_CUE_FIRED', (eventId) => auditDetails(eventId, `custom:${cc.id}`, cc.name));
      return { fired: true, cueId: cc.id, target, eventId: event.id };
    }

    const def = this.sportOf(game);
    const cue = def.celebrations.find((c) => c.key === dto.key);
    if (!cue) {
      throw new BadRequestException(`Unknown cue "${dto.key}" for ${def.name}`);
    }
    const event = await this.recordAudited(tenantId, id, 'CUE', {
      key: cue.key,
      label: cue.label,
      emoji: cue.emoji,
      target,
      // T2-6: ribbon-strip mode — tight 2.5s crawl instead of 4500ms takeover.
      ...(ribbonStrip ? { ribbonStrip: true } : {}),
      audioUrl,
      sponsorName,
      sponsorLogoUrl,
      team,
      scorerName,
      scorerNumber,
      scorerPhotoUrl,
      scorerId,
      snapshot: this.cueSnapshot(game),
    }, actor, 'SPORTS_CUE_FIRED', (eventId) => auditDetails(eventId, cue.key, cue.label));
    return { fired: true, cue, target, eventId: event.id };
  }

  /**
   * T2-4: Fire the pre-game starting-lineup choreography.
   *
   * Fetches the roster for `team` ('home' | 'away'), assembles the
   * lineup array, and writes a CUE GameEvent with key 'pregame-intro'.
   * The board page's existing cue-pump picks it up on the next 750ms
   * poll and routes it to `CuelPregameIntroWidget` for a 30-second
   * per-player cinematic takeover.
   *
   * `durationMs` is the per-player slot length (default 3500 ms).
   * `skippable` is surfaced in the cue payload so the board can offer
   * an escape hatch via an operator keypress (not used yet — forwarded
   * for future use).
   */
  async firePregameIntro(
    tenantId: string,
    gameId: string,
    dto: {
      team?: 'home' | 'away';
      audioUrl?: string;
      slotMs?: number;
      skippable?: boolean;
    },
    actor?: CommandInput,
  ) {
    const game = await this.owned(tenantId, gameId);
    const team: 'home' | 'away' = dto.team === 'away' ? 'away' : 'home';
    const slotMs = Math.max(1000, Math.min(10_000, Number(dto.slotMs ?? 3500) || 3500));
    const audioUrl = this.cleanText(dto.audioUrl, 2048);
    const skippable = dto.skippable !== false;

    // Fetch the roster — home or away, in display order.
    const players = await this.prisma.client.rosterPlayer.findMany({
      where: { gameId, team },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });

    // Shape each player to the minimal payload the widget needs — avoid
    // sending the full DB row over the GameEvent feed (stays under Redis
    // message-size limits even for 20-player rosters).
    const lineup = players.map((p) => ({
      id: p.id,
      name: p.name,
      number: p.number ?? '',
      position: p.position ?? '',
      photoUrl: p.photoUrl ?? '',
      stats: (p.stats && typeof p.stats === 'object' ? p.stats : {}) as Record<string, string>,
    }));

    const teamColor =
      team === 'home'
        ? (game.homeColor ?? null)
        : (game.awayColor ?? null);
    const teamName = team === 'home' ? game.homeTeam : game.awayTeam;

    // Total runtime: slotMs × number of players, capped at 60 s so a
    // huge bench never permanently blocks the board.
    const totalMs = Math.min(60_000, slotMs * Math.max(1, lineup.length));

    // Immutable AuditLog so game-presentation forensics can answer "who
    // started the lineup intro and when" — committed with the CUE event.
    const event = await this.recordAudited(tenantId, gameId, 'CUE', {
      key: 'pregame-intro',
      label: `${teamName} Starting Lineup`,
      emoji: '🎤',
      target: 'BOARD',        // scoreboard takeover only; ribbon keeps rotating
      durationMs: totalMs,
      audioUrl,
      skippable,
      team,
      teamColor,
      teamName,
      lineup,
      slotMs,
      snapshot: this.cueSnapshot(game as Parameters<typeof this.cueSnapshot>[0]),
    }, actor, 'SPORTS_PREGAME_INTRO_FIRED', (eventId) => ({
      eventId,
      team,
      playerCount: lineup.length,
      totalMs,
      hasAudio: !!audioUrl,
    }));

    return {
      fired: true,
      team,
      playerCount: lineup.length,
      totalMs,
      eventId: event.id,
    };
  }

  /**
   * Call a timeout for a team — the one coupled event Daktronics All
   * Sport has a dedicated TIMEOUT key for, and VenueOS had no atomic
   * equivalent. Calling this endpoint:
   *   1. Refuses with 422 if the team is already at 0 timeouts
   *      (floor-at-zero — you can't go negative).
   *   2. Decrements home/awayTimeouts in Game.stats (floor 0).
   *   3. Pauses the game clock (cascades shot-clock / penalty sync
   *      via the existing clockAction pause path).
   *   4. For football: resets the play clock to 25s and stops it.
   *   5. Appends a TIMEOUT GameEvent for the audit trail.
   *   6. Fires a 'timeout' CUE so surfaces render a "TIMEOUT —
   *      EASTSIDE 2 LEFT" overlay (target: ALL).
   *   7. Writes an immutable AuditLog row.
   *
   * Works for any sport whose SportDefinition carries homeTimeouts /
   * awayTimeouts stat fields (basketball, football, water polo, and
   * any future sport that adds them). Sports without those fields
   * still get the clock-pause + CUE (the decrement is a no-op for a
   * stat key that doesn't exist).
   */
  async callTimeout(
    tenantId: string,
    gameId: string,
    dto: { team?: string; type?: string },
    actor?: CommandInput,
  ) {
    const team: 'home' | 'away' = dto.team === 'away' ? 'away' : 'home';
    const statKey = team === 'home' ? 'homeTimeouts' : 'awayTimeouts';

    // ONE command, computed from ONE fresh read: the clock pause (with its
    // shot-clock / penalty-box slaving), the timeout debit and the football
    // play-clock reset all land in the same compare-and-swap write. It used
    // to pause via clockAction and then write back a stats copy read BEFORE
    // the pause — which restored the running shot clock (K12-20) and could
    // erase a concurrent stat — and two timeouts racing could both debit
    // from the same count.
    return this.runGameCommand(tenantId, gameId, 'timeout.call', actor, dto, async (scope) => {
      const game = scope.before;
      const def = this.sportOf(game);

      // Only sports whose definition declares team-timeout stats (football /
      // basketball / water polo) can call one — for every other sport the
      // decrement would compute NaN and persist `null` into the stats JSON
      // while still pausing the clock (refuter P1, Phase-2 SHARE).
      if (!def.stats.some((s) => s.key === statKey)) {
        throw new BadRequestException(`${def.name} has no team timeouts`);
      }
      const statsBefore: Record<string, unknown> =
        game.stats && typeof game.stats === 'object' ? (game.stats as Record<string, unknown>) : {};
      const prevRemaining = Number(statsBefore[statKey]);
      if (Number.isFinite(prevRemaining) && prevRemaining <= 0) {
        const label = def.stats.find((s) => s.key === statKey)?.label ?? statKey;
        throw new BadRequestException(
          `BUG_NO_TIMEOUTS_LEFT: ${team} team has no timeouts remaining (${label} = 0)`,
        );
      }
      // K12-F03 — under a rules profile with full AND short timeouts (NFHS
      // basketball: three 60 s + two 30 s per game [ncaa-nfhs-bb-2025-26]),
      // the timeout comes out of the bank the official signalled. No `type` =
      // a full one while the team has one, else a short one. The total left
      // (what every board shows) always drops by one.
      const banks = timeoutBanks(def, team, statsBefore);
      const shortBank = !!def.timeouts && def.timeouts.short > 0;
      let timeoutType: 'full' | 'short' =
        dto.type === 'short' ? 'short' : 'full';
      if (shortBank && dto.type === undefined && banks.full <= 0) {
        timeoutType = 'short';
      }
      const left = timeoutType === 'short' ? banks.short : banks.full;
      if (shortBank && left <= 0) {
        throw new BadRequestException({
          code: 'NO_TIMEOUTS_OF_KIND_LEFT',
          message: `The ${team} team has no ${
            timeoutType === 'short' ? '30-second' : 'full'
          } timeouts left.`,
          kind: timeoutType,
          full: banks.full,
          short: banks.short,
        });
      }
      const newRemaining = Math.max(0, prevRemaining - 1);

      const now = this.clockNow();
      const data: Record<string, unknown> =
        def.clock.type === 'none' ? {} : this.clockTransition(game, def, 'pause', 0, now).data;
      const stats: Record<string, unknown> = {
        ...((data.stats as Record<string, unknown> | undefined) ?? statsBefore),
      };
      stats[statKey] = newRemaining;
      if (shortBank) {
        stats[shortTimeoutKey(team)] =
          timeoutType === 'short' ? banks.short - 1 : banks.short;
      }
      // Football: a charged timeout sets the 25-second count, parked until
      // the referee's ready-for-play signal (NFHS play-clock instructions).
      if (def.playClock) {
        stats.playClock = { ms: def.playClock.short * 1000, at: now.toISOString(), running: false };
      }
      data.stats = stats;
      const updated = await scope.write(data);

      // TIMEOUT GameEvent — the command's undo target and forensic record.
      const shortLeft = shortBank
        ? {
            prevShortRemaining: banks.short,
            newShortRemaining: stats[shortTimeoutKey(team)],
          }
        : {};
      await scope.event('TIMEOUT', {
        team,
        type: timeoutType,
        prevTimeoutsRemaining: prevRemaining,
        newTimeoutsRemaining: newRemaining,
        ...shortLeft,
        change: scope.change(),
      });
      // CUE — drives the "TIMEOUT — EASTSIDE 2 LEFT" overlay on every
      // surface (scoreboard, ribbon, broadcast scorebug).
      const teamName = team === 'home' ? game.homeTeam : game.awayTeam;
      await scope.event('CUE', {
        key: 'timeout',
        label: `Timeout — ${teamName} (${newRemaining} left)`,
        emoji: '⏱️',
        target: 'ALL',
        audioUrl: null,
        sponsorName: null,
        sponsorLogoUrl: null,
        team,
        custom: false,
        snapshot: this.cueSnapshot(updated),
      });
      scope.audit('SPORTS_TIMEOUT_CALLED', {
        team,
        type: timeoutType,
        prevTimeoutsRemaining: prevRemaining,
        newTimeoutsRemaining: newRemaining,
        ...shortLeft,
      });
      return {
        success: true,
        team,
        type: timeoutType,
        timeoutsRemaining: newRemaining,
        ...(shortBank
          ? { shortTimeoutsRemaining: stats[shortTimeoutKey(team)] }
          : {}),
      };
    });
  }

  // ── live-game text overlay (T2-5) ─────────────────────────────

  /**
   * Fire a live-game text overlay on the scoreboard (and optionally
   * ribbon / broadcast scorebug).  Four overlay kinds:
   *
   *   • penalty   — lower-third "HOLDING #44 — 10 YDS". Auto-clears
   *                 on next clock start (3s default duration).
   *   • review    — persistent "OFFICIAL REVIEW" banner. Stays until
   *                 a separate /live-overlay/clear call.
   *   • injury    — "INJURY TIMEOUT". Auto-clears on clock start.
   *   • timeout-banner — "AWAY TIMEOUT — 2 LEFT" fly-in pill.
   *
   * The overlay is written as a LIVE_OVERLAY GameEvent. The board /
   * ribbon / scorebug poll the `liveOverlay` field on the board
   * response (latest LIVE_OVERLAY event wins, resolved in getBoard).
   * On next clock `start`, clockAction() writes a clearing event
   * automatically so the operator doesn't have to remember to clear.
   */
  async fireLiveOverlay(
    tenantId: string,
    id: string,
    dto: {
      kind: string;
      payload?: Record<string, unknown>;
    },
    actor?: CommandInput,
  ) {
    const game = await this.owned(tenantId, id);

    const allowedKinds = ['penalty', 'review', 'injury', 'timeout-banner'] as const;
    type OverlayKind = (typeof allowedKinds)[number];
    const kind = allowedKinds.includes(dto.kind as OverlayKind)
      ? (dto.kind as OverlayKind)
      : null;
    if (!kind) {
      throw new BadRequestException(
        `kind must be one of: ${allowedKinds.join(', ')}`,
      );
    }

    // Sanitize payload fields per kind so arbitrary strings can't
    // bloat the event row. All text capped at broadcast-safe lengths.
    let cleanPayload: Record<string, unknown> = {};
    const raw = dto.payload && typeof dto.payload === 'object' ? dto.payload : {};

    if (kind === 'penalty') {
      const team = raw.team === 'away' ? 'away' : 'home';
      const jersey = this.cleanText(raw.jersey, 12) ?? '';
      const infraction = this.cleanText(raw.infraction, 80) ?? '';
      const yards = Number.isFinite(Number(raw.yards)) ? Number(raw.yards) : null;
      cleanPayload = { team, jersey, infraction, yards };
    } else if (kind === 'review') {
      const description =
        this.cleanText(raw.description, 120) ?? 'OFFICIAL REVIEW — RULING ON FIELD STANDS';
      cleanPayload = { description };
    } else if (kind === 'injury') {
      const team = raw.team === 'away' ? 'away' : 'home';
      const jersey = this.cleanText(raw.jersey, 12) ?? '';
      const type = this.cleanText(raw.type, 60) ?? '';
      cleanPayload = { team, jersey, type };
    } else if (kind === 'timeout-banner') {
      const team = raw.team === 'away' ? 'away' : 'home';
      const remaining = Number.isFinite(Number(raw.remaining)) ? Number(raw.remaining) : null;
      cleanPayload = { team, remaining };
    }

    // Audit trail — who triggered what overlay (committed with the event).
    const event = await this.recordAudited(tenantId, id, 'LIVE_OVERLAY', {
      kind,
      payload: cleanPayload,
      snapshot: this.cueSnapshot(game),
    }, actor, 'SPORTS_LIVE_OVERLAY_FIRED', (eventId) => ({ kind, payload: cleanPayload, eventId }));

    return { fired: true, kind, eventId: event.id };
  }

  /**
   * Clear the active live-game text overlay. Writes a LIVE_OVERLAY
   * event with `kind: 'clear'`; the board resolves the latest event
   * so this immediately wins over any prior overlay.
   */
  async clearLiveOverlay(tenantId: string, id: string, actor?: CommandInput) {
    await this.owned(tenantId, id);
    const event = await this.recordAudited(
      tenantId, id, 'LIVE_OVERLAY', { kind: 'clear' }, actor,
      'SPORTS_LIVE_OVERLAY_CLEARED', (eventId) => ({ eventId }),
    );
    return { cleared: true, eventId: event.id };
  }

  // ── T3-3: Show Control — recall a full-screen GAMEDAY scene ────────
  // Mirrors the LIVE_OVERLAY pattern (latest-wins GameEvent resolved in
  // getBoard, surfaced on the 750ms board poll) so it needs ZERO schema
  // change. A SCENE event carries { templateId, expiresAt, holdMode }; the
  // board renders that template until `expiresAt` passes, then auto-reverts
  // to the live scoreboard — server-authoritative, so a closed operator
  // laptop can never strand the board. `{ kind: 'clear' }` ends the scene.

  /** Clamp an operator-supplied hold to a sane window (3s..1h); default 20s. */
  private sceneHoldMs(holdMs?: number): number {
    return Number.isFinite(holdMs) && (holdMs as number) > 0
      ? Math.min(Math.max(holdMs as number, 3000), 3_600_000)
      : 20_000;
  }

  /**
   * Recall a GAMEDAY scene template (Starting Lineup / Halftime Board /
   * Sponsors / …) to the board for `holdMs`, then auto-revert. Validates the
   * template is system OR owned by this game's tenant (same gate as the
   * per-surface layout templates) so a foreign/unknown id is rejected.
   */
  async recallScene(
    tenantId: string,
    id: string,
    templateId: string,
    holdMs: number | undefined,
    actor?: CommandInput,
  ) {
    const game = await this.owned(tenantId, id);
    const tpl = (templateId || '').trim();
    if (!tpl) throw new BadRequestException('templateId required');
    // ten-ok: the tenant scope IS here, inside the `OR` (which the static gate
    // reads only at the top level of `where`). `game` came from
    // `owned(tenantId, id)` on the line above, so this accepts a scene template
    // owned by the CALLER's own tenant or a tenant-less system preset, and
    // rejects anything else with "Unknown or inaccessible template".
    const owned = await this.prisma.client.template.findFirst({
      where: { id: tpl, OR: [{ tenantId: game.tenantId }, { isSystem: true }] },
      select: { id: true },
    });
    if (!owned) throw new BadRequestException('Unknown or inaccessible template');
    const expiresAt = Date.now() + this.sceneHoldMs(holdMs);
    const event = await this.recordAudited(
      tenantId, id, 'SCENE', { templateId: tpl, expiresAt, holdMode: 'auto' }, actor,
      'SPORTS_SCENE_RECALLED', (eventId) => ({ templateId: tpl, expiresAt, eventId }),
    );
    return { recalled: true, templateId: tpl, expiresAt, eventId: event.id };
  }

  /** End the active scene now — the board reverts to live on the next poll. */
  async clearScene(tenantId: string, id: string, actor?: CommandInput) {
    await this.owned(tenantId, id);
    const event = await this.recordAudited(
      tenantId, id, 'SCENE', { kind: 'clear' }, actor,
      'SPORTS_SCENE_CLEARED', (eventId) => ({ eventId }),
    );
    return { cleared: true, eventId: event.id };
  }

  /**
   * Hold/extend the current scene by re-stamping its expiry (keeps the same
   * template, so the operator needn't re-pick). No-op if no scene is active.
   */
  async extendScene(
    tenantId: string,
    id: string,
    holdMs: number | undefined,
    actor?: CommandInput,
  ) {
    await this.owned(tenantId, id);
    const latest = await this.prisma.client.gameEvent.findFirst({
      where: { gameId: id, type: 'SCENE' },
      orderBy: { createdAt: 'desc' },
      select: { payload: true },
    });
    const p = (latest?.payload as Record<string, unknown>) ?? {};
    if (!latest || p.kind === 'clear' || typeof p.templateId !== 'string') {
      return { extended: false };
    }
    const expiresAt = Date.now() + this.sceneHoldMs(holdMs);
    const templateId = p.templateId;
    const event = await this.recordAudited(
      tenantId, id, 'SCENE', { templateId, expiresAt, holdMode: 'held' }, actor,
      'SPORTS_SCENE_EXTENDED',
      (eventId) => ({ templateId, expiresAt, previousExpiresAt: p.expiresAt ?? null, eventId }),
    );
    return { extended: true, templateId: p.templateId, expiresAt, eventId: event.id };
  }

  /**
   * T2-8: Set possession to 'home' or 'away' as a first-class column.
   *
   * Replaces the free-text `stats.possession` approach that required the
   * operator to type 'home'/'away' into a generic stat field.  This writes
   * to `Game.possession` (the new dedicated column) so the operator UI can
   * offer a single tap-to-flip chip and display surfaces can read a typed
   * value instead of an arbitrary string.
   *
   * Atomically:
   *  1. Updates `Game.possession`
   *  2. Writes a `POSSESSION` GameEvent with { team, prevPossession }
   *  3. Writes an AuditLog row
   *
   * Sports that don't have a possession concept (baseball, volleyball, etc.)
   * can still call this endpoint — the UI controls gate it by sport, but the
   * service itself doesn't restrict by sport so future sports with possession
   * tracking work automatically.
   */
  async setPossession(
    tenantId: string,
    gameId: string,
    dto: { team?: string },
    actor?: CommandInput,
  ) {
    const team: 'home' | 'away' = dto.team === 'away' ? 'away' : 'home';
    return this.runGameCommand(tenantId, gameId, 'possession.set', actor, dto, async (scope) => {
      const game = scope.before;
      const prevPossession = game.possession ?? null;
      await scope.write({ possession: team });
      // Append-only POSSESSION event + audit row, in the same transaction.
      await scope.event('POSSESSION', { team, prevPossession, change: scope.change() });
      scope.audit('SPORTS_POSSESSION_SET', { team, prevPossession, sport: game.sport });
      return { success: true, possession: team };
    });
  }

  /**
   * Set the stadium ribbon's custom message reel. Each line scrolls on
   * the ribbon in place of the default crowd prompts; an empty list
   * clears back to the auto prompts. Stored as a RIBBON GameEvent
   * (latest wins) — no new table, no migration.
   */
  async setRibbon(tenantId: string, id: string, dto: { messages?: unknown }, actor?: CommandInput) {
    await this.owned(tenantId, id);
    const messages = Array.isArray(dto.messages)
      ? dto.messages
          .map((m) => this.cleanText(m, 120))
          .filter((m): m is string => m !== null)
          .slice(0, 30)
      : [];
    const before = await this.latestRibbonMessages(id);
    await this.recordAudited(tenantId, id, 'RIBBON', { messages }, actor, 'SPORTS_RIBBON_MESSAGES_SET',
      (eventId) => ({ eventId, before, after: messages }));
    return { messages };
  }

  /**
   * Set which content presets ride the stadium ribbon reel — the
   * score, clock, period, sport-specific game situation, crowd
   * messages, player spotlights, sponsors. The list is validated
   * against the game's sport catalog (a `clock` preset can't be set
   * on a clockless sport like baseball). Stored as a RIBBON_PRESETS
   * GameEvent (latest wins) — no new table, no migration.
   */
  async setRibbonPresets(tenantId: string, id: string, dto: { presets?: unknown }, actor?: CommandInput) {
    const game = await this.owned(tenantId, id);
    const def = this.sportOf(game);
    const presets = sanitizeRibbonPresets(def, dto.presets);
    const before = await this.latestRibbonPresets(id);
    await this.recordAudited(tenantId, id, 'RIBBON_PRESETS', { presets }, actor, 'SPORTS_RIBBON_PRESETS_SET',
      (eventId) => ({ eventId, before, after: presets }));
    return { presets };
  }

  /**
   * Set how fast the ribbon reel scrolls. The value is normalized to
   * a known speed (slow / normal / fast / very fast). Stored as a
   * RIBBON_SPEED GameEvent, latest-wins — no table, no migration.
   */
  async setRibbonSpeed(tenantId: string, id: string, dto: { speed?: unknown }, actor?: CommandInput) {
    await this.owned(tenantId, id);
    const speed = sanitizeRibbonSpeed(dto.speed);
    const before = await this.latestRibbonSpeed(id);
    await this.recordAudited(tenantId, id, 'RIBBON_SPEED', { speed }, actor, 'SPORTS_RIBBON_SPEED_SET',
      (eventId) => ({ eventId, before, after: speed }));
    return { speed };
  }

  /**
   * Set the ribbon's full-bleed image slides — a list of image URLs
   * the operator uploaded (sponsor banners, promos, welcome art).
   * Each fills the ribbon edge-to-edge as it scrolls past. Stored as
   * a RIBBON_SLIDES GameEvent, latest-wins — no table, no migration.
   */
  async setRibbonSlides(tenantId: string, id: string, dto: { slides?: unknown }, actor?: CommandInput) {
    await this.owned(tenantId, id);
    const slides = Array.isArray(dto.slides)
      ? dto.slides
          .map((s) => this.cleanText(s, 2048))
          .filter((s): s is string => s !== null)
          .slice(0, 20)
      : [];
    const before = await this.latestRibbonSlides(id);
    await this.recordAudited(tenantId, id, 'RIBBON_SLIDES', { slides }, actor, 'SPORTS_RIBBON_SLIDES_SET',
      (eventId) => ({ eventId, before, after: slides }));
    return { slides };
  }

  /**
   * Set how many times the score anchor repeats around the stadium
   * ribbon — one scorebug for a straight ribbon, or a recurring score
   * for a continuous full-bowl wrap so it reads from every seat.
   * 'auto' lets the ribbon size the count to its own width. Stored as
   * a RIBBON_SCORE GameEvent, latest-wins — no table, no migration.
   */
  async setRibbonScoreRepeat(tenantId: string, id: string, dto: { repeat?: unknown }, actor?: CommandInput) {
    await this.owned(tenantId, id);
    const repeat = sanitizeRibbonScoreRepeat(dto.repeat);
    const before = await this.latestRibbonScoreRepeat(id);
    await this.recordAudited(tenantId, id, 'RIBBON_SCORE', { repeat }, actor, 'SPORTS_RIBBON_SCORE_REPEAT_SET',
      (eventId) => ({ eventId, before, after: repeat }));
    return { repeat };
  }

  // ── cue deck (custom triggers) ───────────────────────────────

  /** Bound a cue duration to a sane 2–20s window. */
  private cleanDuration(v: unknown): number {
    const n = Number(v);
    if (!isFinite(n)) return 6000;
    return Math.min(20000, Math.max(2000, Math.round(n)));
  }

  /** The tenant's reusable cue deck, in display order. */
  async listCues(tenantId: string) {
    return this.prisma.client.customCue.findMany({
      where: { tenantId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  /** Create a custom cue (a trigger button + its takeover content). */
  async createCue(
    tenantId: string,
    dto: { name?: string; mediaUrl?: string; color?: string; durationMs?: number; displayMode?: string },
    actor?: CommandInput,
  ) {
    const name = this.cleanText(dto.name, 60);
    if (!name) throw new BadRequestException('Cue name is required.');
    const sortOrder = await this.prisma.client.customCue.count({ where: { tenantId } });
    return this.prisma.client.$transaction(async (tx: any) => {
      const created = await tx.customCue.create({
        data: {
          tenantId,
          name,
          mediaUrl: this.cleanText(dto.mediaUrl, 2048),
          color: this.cleanText(dto.color, 32),
          durationMs: this.cleanDuration(dto.durationMs),
          displayMode: dto.displayMode === 'takeover' ? 'takeover' : 'overlay',
          sortOrder,
        },
      });
      await this.auditRow(tx, tenantId, actor, 'SPORTS_CUE_CREATED', created.id, {
        name: created.name,
        mediaUrl: created.mediaUrl,
        displayMode: created.displayMode,
        durationMs: created.durationMs,
      }, 'CustomCue');
      return created;
    });
  }

  /** Resolve a tenant-owned cue, or 404. */
  private async ownedCue(tenantId: string, id: string) {
    const cc = await this.prisma.client.customCue.findFirst({ where: { id, tenantId } });
    if (!cc) throw new NotFoundException('Cue not found');
    return cc;
  }

  /** Edit a custom cue — only the keys present in the dto. */
  async updateCue(
    tenantId: string,
    id: string,
    dto: { name?: string; mediaUrl?: string; color?: string; durationMs?: number; displayMode?: string },
    actor?: CommandInput,
  ) {
    const existing = await this.ownedCue(tenantId, id);
    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) {
      const n = this.cleanText(dto.name, 60);
      if (!n) throw new BadRequestException('Cue name cannot be empty.');
      data.name = n;
    }
    if (dto.mediaUrl !== undefined) data.mediaUrl = this.cleanText(dto.mediaUrl, 2048);
    if (dto.color !== undefined) data.color = this.cleanText(dto.color, 32);
    if (dto.durationMs !== undefined) data.durationMs = this.cleanDuration(dto.durationMs);
    if (dto.displayMode !== undefined) data.displayMode = dto.displayMode === 'takeover' ? 'takeover' : 'overlay';
    const before: Record<string, unknown> = {};
    for (const k of Object.keys(data)) before[k] = (existing as Record<string, unknown>)[k] ?? null;
    return this.prisma.client.$transaction(async (tx: any) => {
      const updated = await tx.customCue.update({ where: { id, tenantId }, data });
      await this.auditRow(tx, tenantId, actor, 'SPORTS_CUE_UPDATED', id, { before, after: data }, 'CustomCue');
      return updated;
    });
  }

  /** Remove a custom cue from the deck. */
  async deleteCue(tenantId: string, id: string, actor?: CommandInput) {
    const existing = await this.ownedCue(tenantId, id);
    await this.prisma.client.$transaction(async (tx: any) => {
      await tx.customCue.delete({ where: { id, tenantId } });
      await this.auditRow(tx, tenantId, actor, 'SPORTS_CUE_DELETED', id, {
        name: existing.name,
        mediaUrl: existing.mediaUrl,
      }, 'CustomCue');
    });
    return { deleted: true };
  }

  /**
   * Sprint 13 — CTS celebration audit log.
   *
   * The CTS celebration orchestrator on the kiosk player POSTs to
   * /api/v1/sports/board/:id/cts-cue-fired each time it fires a cue,
   * so the GameEvent table captures a forensic record of every
   * celebration that played (cueId, team, source, live score at fire
   * time). Drives the sponsor proof-of-play report — "during this
   * game, the GOLAZO cue fired 4 times in front of the Pool Supply
   * sponsor banner".
   *
   * Best-effort: failure here NEVER blocks the kiosk (which already
   * rendered the cinematic). The endpoint that calls this catches and
   * discards thrown errors.
   */
  async recordCueFired(
    id: string,
    dto: {
      cueId: string;
      team: 'home' | 'away' | 'horn';
      source: 'auto' | 'preview' | 'manual';
      score?: string;
    },
    /**
     * SEC-007 — what the reporting client could actually prove about itself.
     * Defaults to UNATTESTED so an existing caller that has not been updated
     * records an honestly-unverified row rather than silently inheriting
     * someone else's provenance.
     */
    attestation: BeaconAttestation = UNATTESTED,
  ): Promise<void> {
    // Confirm the game exists (cheap select) so we don't write orphan
    // GameEvent rows pointing at deleted / non-existent games. Pull `sport`
    // + `tenantId` too so we can validate the cueId against the game's
    // KNOWN cue set (Task D — fabrication guard).
    //
    // ten-ok: called from the PUBLIC board controller's cue beacon, whose
    // principal is a signed beacon capability bound to this gameId (SEC-007) —
    // not an operator session, so there is no caller tenant. This read is the
    // resolver: the tenantId it returns is what the cue-set validation and the
    // GameEvent row are scoped to, so a beacon can only ever write an event for
    // the game its own capability names.
    const game = await this.prisma.client.game.findUnique({
      where: { id },
      select: { id: true, tenantId: true, sport: true, homeScore: true, awayScore: true },
    });
    if (!game) return;

    // (a) FABRICATION GUARD — only record a cueId that is a REAL cue for
    // this game. Silently drop anything else so an attacker who POSTs a
    // forged "GOLAZO_FAKE" (or any made-up id) to a public board url can't
    // inflate the sponsor proof-of-play report. The legit tokenless caller
    // (the ribbon orchestrator) only ever sends catalog ids, so this never
    // 401s / rejects a real fire — it just no-ops invalid ones.
    const known = await this.isKnownCue(game.tenantId, game.sport, dto.cueId);
    if (!known) {
      this.logger.debug(
        `cts-cue-fired dropped unknown cueId "${String(dto.cueId).slice(0, 64)}" for game ${id}`,
      );
      return;
    }

    // (b) DEDUP GUARD — record a given (cueId, team) at most once per the
    // client cooldown window. A replay flood that re-POSTs the same valid
    // (cueId, team) can't run the proof-of-play count up; two genuinely
    // distinct fires (different cue OR different team) still both record,
    // and a re-fire after the cooldown elapses records again (matches the
    // ribbon's own per-fire cadence). Best-effort — a read failure here
    // falls through to recording, never blocks a legit cue.
    try {
      const since = new Date(Date.now() - CTS_CUE_DEDUP_MS);
      // Scan a small recent window for an exact (cueId, team) match within
      // the cooldown. take:8 caps the read on the hot path.
      const recent = await this.prisma.client.gameEvent.findMany({
        where: { gameId: id, type: 'CTS_CUE', createdAt: { gte: since } },
        orderBy: { createdAt: 'desc' },
        take: 8,
      });
      const isReplay = recent.some((ev) => {
        const p = ev.payload as { cueId?: unknown; team?: unknown } | null;
        return p?.cueId === dto.cueId && p?.team === dto.team;
      });
      if (isReplay) {
        this.logger.debug(
          `cts-cue-fired deduped replay of (${dto.cueId}, ${dto.team}) for game ${id}`,
        );
        return;
      }
    } catch {
      /* dedup is best-effort — fall through and record */
    }

    await this.prisma.client.gameEvent.create({
      data: {
        gameId: id,
        type: 'CTS_CUE',
        payload: {
          cueId: dto.cueId,
          team: dto.team,
          source: dto.source,
          score: dto.score || `${game.homeScore}-${game.awayScore}`,
          t: new Date().toISOString(),
          // SEC-007 — provenance travels WITH the row. `verified: false` is
          // the honest label for an anonymous beacon, and for every row
          // written before this landed (which carry no `verified` key at all —
          // absence reads as unverified, see `isVerifiedCueEvent`).
          verified: attestation.verified,
          ...(attestation.screenId ? { screenId: attestation.screenId } : {}),
          ...(attestation.nonce ? { beaconNonce: attestation.nonce } : {}),
          ...(attestation.seq !== null ? { beaconSeq: attestation.seq } : {}),
        },
      },
    });
  }

  /**
   * Is `cueId` a REAL cue for this game? (Task D — fabrication guard.)
   *
   * The legitimate cueId namespace for the tokenless cts-cue-fired
   * endpoint is the union of:
   *   - the cinematic scene catalog (CTS_CINEMATIC_CUE_IDS) — what the
   *     ribbon orchestrator round-robins through (the dominant caller);
   *   - the sport's configured celebration keys (goal/touchdown/…), which
   *     the Celebrations panel / Stream Deck path can fire;
   *   - the game's tenant-scoped operator custom cues (`custom:<id>` or a
   *     bare `<id>`);
   *   - a small set of control cues (horn / pregame-intro).
   * Anything outside that set is treated as fabricated and dropped.
   *
   * Best-effort: a DB read failure resolving custom cues falls back to the
   * static (catalog ∪ sport-celebration ∪ control) allow-set rather than
   * blocking a real fire.
   */
  private async isKnownCue(
    tenantId: string,
    sport: string,
    cueId: unknown,
  ): Promise<boolean> {
    if (typeof cueId !== 'string' || !cueId) return false;
    if (CTS_CINEMATIC_CUE_IDS.has(cueId)) return true;
    if (CTS_CONTROL_CUE_IDS.has(cueId)) return true;
    // Sport-specific celebration keys (goal, touchdown, threePointer, …).
    const def = findSport(sport);
    if (def && def.celebrations.some((c) => c.key === cueId)) return true;
    // Operator custom cues, addressed as `custom:<id>` (fireCue's payload
    // key) or a bare custom-cue id. Tenant-scoped lookup.
    const customId = cueId.startsWith('custom:') ? cueId.slice('custom:'.length) : cueId;
    if (customId) {
      try {
        const cc = await this.prisma.client.customCue.findFirst({
          where: { id: customId, tenantId },
          select: { id: true },
        });
        if (cc) return true;
      } catch {
        /* fall through — static allow-set already checked above */
      }
    }
    return false;
  }

  // ── CTS snapshot ingest ──────────────────────────────────────
  //
  // CtsBridge POSTs the latest parsed snapshot at ~5 Hz when a CTS
  // console is streaming. We write it under `Game.stats.cts` as a
  // self-contained block — NO overwrite of the persistent `homeScore`,
  // `awayScore`, `clockMs`, `clockRunning`, `segment` columns.
  //
  // That separation is load-bearing. Those columns stay as the OPERATOR
  // INPUT layer — when CTS goes dark mid-game (cable yank, console
  // power-cycle, parity hiccup) the operator can take over manually and
  // not be silently stomped 200 ms later when CTS reconnects. The
  // public surfaces (board / ribbon / scorebug) apply the CTS overlay
  // at render time via `applyCtsOverlay` in apps/web/src/lib/cts-merge.ts:
  // fresh heartbeat → CTS wins, stale → operator inputs win. One central
  // helper, identical math everywhere.
  //
  // Forensic audit: every accepted snapshot writes an AuditLog row at
  // INFO frequency would flood the table (5 Hz × multi-hour games ≈
  // 100k rows / game), so we sample — log only on the FIRST snapshot
  // after a fresh-window gap, on every score change, on every segment
  // change, on horn, and on every clockRunning flip. That captures
  // the forensically interesting transitions without log-spam.

  /** Coerce + sanitize one inbound CTS snapshot for write into stats.cts.
   *
   * T2-1: extended to accept per-side shot clocks, exclusions, and
   * timeouts remaining.  All new fields are optional — an older bridge
   * that only sends the original 7 fields still works unchanged.
   */
  private cleanCtsSnapshot(raw: Record<string, unknown>): {
    clockMs?: number;
    clockRunning?: boolean;
    segment?: number;
    homeScore?: number;
    awayScore?: number;
    shotClock?: { ms: number; running: boolean; len?: number; at?: string };
    /** T2-1 — per-side shot clocks. */
    homeShotClock?: { ms: number; running: boolean; raw?: string; at?: string };
    awayShotClock?: { ms: number; running: boolean; raw?: string; at?: string };
    /** T2-1 — active exclusions per team (3-slot, nullable entries). */
    homeExclusions?: ({ playerJersey: number; secondsRemaining: number } | null)[];
    awayExclusions?: ({ playerJersey: number; secondsRemaining: number } | null)[];
    /** T2-1 — timeouts remaining per team. */
    homeTimeoutsRemaining?: number;
    awayTimeoutsRemaining?: number;
    horn?: boolean;
    raw?: string;
  } {
    const out: ReturnType<SportsService['cleanCtsSnapshot']> = {};
    const num = (v: unknown): number | undefined => {
      if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
      return v;
    };
    const nonNegInt = (v: unknown): number | undefined => {
      const n = num(v);
      if (n === undefined) return undefined;
      return Math.max(0, Math.round(n));
    };
    if (raw.clockMs !== undefined) {
      const v = nonNegInt(raw.clockMs);
      if (v !== undefined) out.clockMs = v;
    }
    if (raw.clockRunning !== undefined) {
      out.clockRunning = !!raw.clockRunning;
    }
    if (raw.segment !== undefined) {
      const v = nonNegInt(raw.segment);
      if (v !== undefined && v >= 1) out.segment = v;
    }
    if (raw.homeScore !== undefined) {
      const v = nonNegInt(raw.homeScore);
      if (v !== undefined) out.homeScore = v;
    }
    if (raw.awayScore !== undefined) {
      const v = nonNegInt(raw.awayScore);
      if (v !== undefined) out.awayScore = v;
    }
    if (raw.horn !== undefined) out.horn = !!raw.horn;
    if (typeof raw.raw === 'string') out.raw = raw.raw.slice(0, 96);
    if (raw.shotClock && typeof raw.shotClock === 'object') {
      const sc = raw.shotClock as Record<string, unknown>;
      const ms = nonNegInt(sc.ms);
      if (ms !== undefined) {
        const cleaned: { ms: number; running: boolean; len?: number; at?: string } = {
          ms,
          running: !!sc.running,
        };
        const len = nonNegInt(sc.len);
        if (len !== undefined && len > 0) cleaned.len = len;
        if (typeof sc.at === 'string') cleaned.at = sc.at;
        out.shotClock = cleaned;
      }
    }

    // T2-1: per-side shot clocks (bridge v1.1+; ignored by older bridges).
    const cleanShotClockField = (
      field: unknown,
    ): { ms: number; running: boolean; raw?: string; at?: string } | undefined => {
      if (!field || typeof field !== 'object') return undefined;
      const sc = field as Record<string, unknown>;
      const ms = nonNegInt(sc.ms);
      if (ms === undefined) return undefined;
      const result: { ms: number; running: boolean; raw?: string; at?: string } = {
        ms,
        running: !!sc.running,
      };
      if (typeof sc.raw === 'string') result.raw = sc.raw.slice(0, 8);
      if (typeof sc.at === 'string') result.at = sc.at;
      return result;
    };
    const homeSc = cleanShotClockField(raw.homeShotClock);
    if (homeSc !== undefined) out.homeShotClock = homeSc;
    const awaySc = cleanShotClockField(raw.awayShotClock);
    if (awaySc !== undefined) out.awayShotClock = awaySc;

    // T2-1: exclusions — 3-slot array, each slot is an object or null.
    const cleanExclusionArray = (
      field: unknown,
    ): ({ playerJersey: number; secondsRemaining: number } | null)[] | undefined => {
      if (!Array.isArray(field)) return undefined;
      const slots = field.slice(0, 3).map((slot) => {
        if (!slot || typeof slot !== 'object') return null;
        const s = slot as Record<string, unknown>;
        const jersey = nonNegInt(s.playerJersey);
        const secs = nonNegInt(s.secondsRemaining);
        if (jersey === undefined && secs === undefined) return null;
        return {
          playerJersey: jersey ?? 0,
          secondsRemaining: secs ?? 0,
        };
      });
      // Pad to 3 slots.
      while (slots.length < 3) slots.push(null);
      return slots as ({ playerJersey: number; secondsRemaining: number } | null)[];
    };
    const homeExcl = cleanExclusionArray(raw.homeExclusions);
    if (homeExcl !== undefined) out.homeExclusions = homeExcl;
    const awayExcl = cleanExclusionArray(raw.awayExclusions);
    if (awayExcl !== undefined) out.awayExclusions = awayExcl;

    // T2-1: timeouts remaining.
    if (raw.homeTimeoutsRemaining !== undefined) {
      const v = nonNegInt(raw.homeTimeoutsRemaining);
      if (v !== undefined) out.homeTimeoutsRemaining = v;
    }
    if (raw.awayTimeoutsRemaining !== undefined) {
      const v = nonNegInt(raw.awayTimeoutsRemaining);
      if (v !== undefined) out.awayTimeoutsRemaining = v;
    }

    return out;
  }

  /**
   * Ingest a CTS bridge snapshot. Writes under `Game.stats.cts`; does
   * NOT touch the persistent operator-input columns. Returns the
   * post-write game row so the bridge can confirm the write succeeded.
   *
   * `tenantId` is null when the caller authenticated via the public
   * feed token (no user context); audit rows in that case carry no
   * `userId`.
   */
  async ingestCtsSnapshot(
    gameId: string,
    snapshot: Record<string, unknown>,
    auth: { tenantId?: string | null; actorUserId?: string | null; source?: string },
  ): Promise<{ ok: true; accepted: boolean; reason?: string }> {
    // Tenant-scope the load when an authenticated user is calling. The
    // public feed-token path resolves the game without a tenant filter
    // (the token itself proves game ownership). This first read is only
    // an auth/existence gate + the input for the "empty snapshot" bail
    // below — the actual merge re-reads fresh inside withStatsTx.
    const gate = auth.tenantId
      ? await this.prisma.client.game.findFirst({
          where: { id: gameId, tenantId: auth.tenantId },
        })
      // ten-ok: this is the ELSE arm of the branch directly above — it runs
      // ONLY when there is no caller tenant, i.e. the CTS bridge box
      // authenticated with the game-scoped feed token the controller already
      // verified against this game's feedTokenVersion. The authenticated arm
      // above IS tenant-scoped. The tenantId this read resolves is what the
      // merge's withStatsTx predicate is then bound to.
      : await this.prisma.client.game.findUnique({ where: { id: gameId } });
    if (!gate) {
      throw new NotFoundException('Game not found');
    }

    const cleaned = this.cleanCtsSnapshot(snapshot);
    // K12-F14 — the ordering envelope (feed-order.ts). The bridge POSTs at
    // ~5 Hz with keepalive fetches that can overlap, so an older snapshot can
    // land after a newer one — it used to roll the overlay back and re-fire a
    // celebration for a score it had already counted. Malformed → 400.
    const envelope = cleanFeedEnvelope(snapshot);
    // Sanity bail — if every field is missing the snapshot is junk and
    // we silently drop it (don't bump lastUpdateAt; otherwise a stream
    // of empty snapshots would mask a real CTS outage).
    const hasAnyData =
      cleaned.clockMs !== undefined ||
      cleaned.clockRunning !== undefined ||
      cleaned.segment !== undefined ||
      cleaned.homeScore !== undefined ||
      cleaned.awayScore !== undefined ||
      cleaned.shotClock !== undefined ||
      cleaned.horn !== undefined ||
      // T2-1: new fields count as "has data" so they alone can update the
      // stats block without requiring a clock or score to be present.
      cleaned.homeShotClock !== undefined ||
      cleaned.awayShotClock !== undefined ||
      cleaned.homeExclusions !== undefined ||
      cleaned.awayExclusions !== undefined ||
      cleaned.homeTimeoutsRemaining !== undefined ||
      cleaned.awayTimeoutsRemaining !== undefined;
    if (!hasAnyData) {
      return { ok: true, accepted: false, reason: 'empty snapshot' };
    }

    // The ~5 Hz CTS write side of the stats race against the operator's
    // commands: the merge runs on the command's fresh in-transaction read and
    // lands as one compare-and-swap write, so the loser of a race re-runs on
    // top of the winner's committed state instead of stomping it. The SCORE /
    // SEGMENT events, the auto-celebration and the sampled audit row commit in
    // the SAME transaction (they used to be best-effort writes after it).
    //
    // SEC-009: bound to the tenant of the game the GATE above resolved. On
    // the operator path that is the caller's own tenant (the gate filtered on
    // it); on the PUBLIC feed-token path there is no caller tenant at all, so
    // this is a consistency assertion — the row may not have moved tenants
    // between gate and merge — and the token MAC over gameId + feedTokenVersion
    // stays the actual authorization.
    const actor: CommandInput = auth.actorUserId
      ? { actor: { kind: 'user', userId: auth.actorUserId } }
      : feedActor('cts');
    let refusedAs: string | null = null;
    try {
      await this.runGameCommand(gate.tenantId, gameId, 'feed.cts', actor, null, async (scope) => {
        const tx = scope.tx;
        const game = scope.before;
        let prevScores = { homeScore: game.homeScore, awayScore: game.awayScore };
        let scoreChanged = false;
        let segmentChanged = false;
        let clockRunChanged = false;
        let horn = false;
        let wantsAudit = false;
        let reconnect = false;
        let syntheticNext: GameRow = game;
        const prevStats: Record<string, unknown> =
          game.stats && typeof game.stats === 'object'
            ? { ...(game.stats as Record<string, unknown>) }
            : {};
        const prevCts: Record<string, unknown> =
          prevStats.cts && typeof prevStats.cts === 'object'
            ? (prevStats.cts as Record<string, unknown>)
            : {};

        // K12-F14 — out of order, a straggler from a superseded session, or a
        // repeat: refused before it touches anything (the CTS cursor lives in
        // stats.cts.cursor, separate from the generic feed's).
        let ctsCursor: FeedCursor | null = null;
        if (hasEnvelope(envelope)) {
          const verdict = orderFeedPacket(parseFeedCursor(prevCts.cursor), envelope);
          if (!verdict.accept) {
            refusedAs = verdict.reason;
            return;
          }
          ctsCursor = verdict.cursor;
        }

        const nowIso = this.clockNow().toISOString();
        const nextCts: Record<string, unknown> = {
          ...prevCts,
          ...cleaned,
          lastUpdateAt: nowIso,
          ...(ctsCursor ? { cursor: ctsCursor } : {}),
        };

        // What changed forensically? Score / segment / clockRunning / horn
        // are the audit-worthy transitions; clockMs ticks are not.
        const lastAuditAt =
          typeof prevCts.lastAuditAt === 'string' ? Date.parse(prevCts.lastAuditAt) : 0;
        reconnect =
          !Number.isFinite(Date.parse(String(prevCts.lastUpdateAt))) ||
          this.serverTimeMs() - Date.parse(String(prevCts.lastUpdateAt)) > 5000;
        scoreChanged =
          (cleaned.homeScore !== undefined && cleaned.homeScore !== prevCts.homeScore) ||
          (cleaned.awayScore !== undefined && cleaned.awayScore !== prevCts.awayScore);
        segmentChanged =
          cleaned.segment !== undefined && cleaned.segment !== prevCts.segment;
        clockRunChanged =
          cleaned.clockRunning !== undefined && cleaned.clockRunning !== prevCts.clockRunning;
        horn = cleaned.horn === true && !prevCts.horn;
        // Audit cap: at most one audit row per 1s of forensically uninteresting
        // updates (clock-only ticks). Score / segment / horn / reconnect always
        // audit immediately.
        wantsAudit =
          reconnect || scoreChanged || segmentChanged || clockRunChanged || horn ||
          Date.now() - (Number.isFinite(lastAuditAt) ? lastAuditAt : 0) > 60_000;
        if (wantsAudit) {
          nextCts.lastAuditAt = nowIso;
        }

        // "All the same rules apply if we are doing it or the integration is
        // doing it." (Greg's rule) — fire the same side-effect chain the
        // operator-path helpers run, scoped to what actually changed.
        //
        // NOTE — write-through contract (revised 2026-06-12, sports-venue audit
        // P0): SCORE and SEGMENT now write THROUGH to the operator columns
        // (homeScore/awayScore/segment) when the console reports a change,
        // guarded by a 15s manual-override window (a recent operator SCORE
        // event wins until the console's value next changes). Why the old
        // overlay-only design was a game-night bug, twice over:
        //   1. When the CTS feed dropped, the 5s render freshness window
        //      expired and every public surface reverted to the operator
        //      columns — which still said 0-0 from pre-game. The crowd saw the
        //      wrong score within seconds of a serial hiccup.
        //   2. AUTO celebrations compute deltas vs the operator columns; since
        //      CTS never moved them, goal #2 arrived as delta=2 (no water-polo
        //      cue matches) and auto-celebration silently died after goal #1.
        // CLOCK columns (clockMs/clockRunning) intentionally REMAIN overlay-
        // only: the 5 Hz tick stays out of the columns, and the penalty-box /
        // shot-clock sync helpers below already consume the CTS-reported
        // running state directly.

        // Prev scores come from OPERATOR columns, not from stats.cts, so the
        // delta math is consistent with adjustScore/setScore. Read from THIS
        // fresh row, not the pre-tx `gate` read, so a retry compares against
        // the state it's actually merging on top of.
        prevScores = { homeScore: game.homeScore, awayScore: game.awayScore };
        const now = this.clockNow();

        // Build the merged stats write so we do a single DB update.
        // Clock-running transition: slave the penalty box and shot clock —
        // same helper chain clockAction uses, same "clockMutated = true" flag.
        // The stats.feed liveness stamp (guided-setup pill, Inputs-wave GUIDED)
        // rides this SAME write — the blob is being rewritten anyway, so the
        // stamp costs nothing and stays inside the Serializable tx. Every later
        // re-spread below ({ ...mergedStatsForWrite, … }) preserves it.
        let mergedStatsForWrite: Record<string, unknown> = {
          ...prevStats,
          cts: nextCts,
          feed: this.feedStamp('cts', true),
        };

        // T2-1: merge CTS exclusions into stats.penalties (top-level, source:'cts')
        // so the existing penalty-box render path can consume them alongside
        // operator-entered penalties.  We replace only the 'cts'-sourced slots;
        // operator-entered penalties (source != 'cts') are preserved.
        if (cleaned.homeExclusions !== undefined || cleaned.awayExclusions !== undefined) {
          const prevPenalties = Array.isArray(mergedStatsForWrite.penalties)
            ? (mergedStatsForWrite.penalties as unknown[]).filter(
                (p) => p && typeof p === 'object' && (p as Record<string, unknown>).source !== 'cts',
              )
            : [];
          const ctsPenalties: unknown[] = [];
          if (cleaned.homeExclusions) {
            cleaned.homeExclusions.forEach((slot, i) => {
              if (slot && (slot.playerJersey > 0 || slot.secondsRemaining > 0)) {
                ctsPenalties.push({
                  source: 'cts',
                  team: 'home',
                  slot: i,
                  playerJersey: slot.playerJersey,
                  secondsRemaining: slot.secondsRemaining,
                });
              }
            });
          }
          if (cleaned.awayExclusions) {
            cleaned.awayExclusions.forEach((slot, i) => {
              if (slot && (slot.playerJersey > 0 || slot.secondsRemaining > 0)) {
                ctsPenalties.push({
                  source: 'cts',
                  team: 'away',
                  slot: i,
                  playerJersey: slot.playerJersey,
                  secondsRemaining: slot.secondsRemaining,
                });
              }
            });
          }
          mergedStatsForWrite = {
            ...mergedStatsForWrite,
            penalties: [...prevPenalties, ...ctsPenalties],
            cts: nextCts,
          };
        }

        // T2-1: merge CTS timeouts into stats.homeTimeouts / awayTimeouts.
        // Only overwrites when CTS is the source so operator adjustments
        // are not stomped when these fields are absent from the snapshot.
        if (cleaned.homeTimeoutsRemaining !== undefined) {
          mergedStatsForWrite = {
            ...mergedStatsForWrite,
            homeTimeouts: cleaned.homeTimeoutsRemaining,
            cts: nextCts,
          };
        }
        if (cleaned.awayTimeoutsRemaining !== undefined) {
          mergedStatsForWrite = {
            ...mergedStatsForWrite,
            awayTimeouts: cleaned.awayTimeoutsRemaining,
            cts: nextCts,
          };
        }

        if (clockRunChanged && cleaned.clockRunning !== undefined) {
          const running = cleaned.clockRunning;
          let synced = this.syncPenaltiesToClock(mergedStatsForWrite, running, now);
          const base = synced ?? mergedStatsForWrite;
          // T2-10: pass the CTS-reported game clock for clamping (Invariant #6).
          const ctsGameClockMs = cleaned.clockMs !== undefined ? Number(cleaned.clockMs) : undefined;
          const shotSynced = this.syncShotClockToGameClock(base, true, running, now, ctsGameClockMs);
          if (shotSynced) synced = shotSynced;
          if (synced) mergedStatsForWrite = { ...mergedStatsForWrite, ...synced, cts: nextCts };
        }

        // 2026-06-12 P0 — score/segment write-through (see contract note above).
        // Guard: a manual operator SCORE within the last 15s wins; the console
        // re-asserts on its NEXT score change, so a typo-fix sticks until the
        // real score moves again. Read through `tx` so this guard's view of
        // recent GameEvents is consistent with the same serializable snapshot
        // the stats merge is using.
        const columnWrites: Record<string, unknown> = {};
        if (scoreChanged) {
          let manualOverride = false;
          try {
            const lastScore = await tx.gameEvent.findFirst({
              where: {
                gameId,
                type: 'SCORE',
                createdAt: { gte: new Date(Date.now() - 15_000) },
              },
              orderBy: { createdAt: 'desc' },
            });
            const p = lastScore?.payload as { source?: unknown; team?: unknown } | null;
            manualOverride = !!lastScore && p?.source !== 'cts' && p?.team !== 'cts';
          } catch { /* guard is best-effort — write-through proceeds */ }
          if (!manualOverride) {
            if (cleaned.homeScore !== undefined) columnWrites.homeScore = cleaned.homeScore;
            if (cleaned.awayScore !== undefined) columnWrites.awayScore = cleaned.awayScore;
          } else {
            this.logger.debug(
              `cts write-through deferred for game ${gameId}: manual score within guard window`,
            );
          }
        }
        if (segmentChanged && cleaned.segment !== undefined) {
          columnWrites.segment = cleaned.segment;
        }

        // The row the celebration compares against: the fresh read with the
        // console's scores applied (before any operator-override deferral).
        syntheticNext = {
          ...game,
          homeScore: cleaned.homeScore !== undefined ? cleaned.homeScore : game.homeScore,
          awayScore: cleaned.awayScore !== undefined ? cleaned.awayScore : game.awayScore,
        };

        await scope.write({ stats: mergedStatsForWrite, ...columnWrites });
        // Deliberately NO wakeClockSweep() here (refuter P2, Phase-2 CLOCK):
        // CTS clock state lives in the stats JSON (`cts` sub-object) — this
        // path never writes the Game.clockMs/clockRunning COLUMNS the
        // auto-advance sweep queries, so a wake buys nothing while a 5 Hz
        // snapshot stream would permanently defeat the sweep's idle-skip.

        // Score GameEvent + AUTO celebration — same paper trail as
        // adjustScore. Only when the CTS-reported score differs from the prior
        // CTS value, so a 5 Hz re-send of the same score records nothing.
        if (scoreChanged) {
          await scope.event('SCORE', {
            team: 'cts',
            homeScore: syntheticNext.homeScore,
            awayScore: syntheticNext.awayScore,
            source: 'cts',
            change: scope.change(),
          });
          await this.autoCelebrateInCommand(
            scope,
            prevScores,
            syntheticNext,
            { home: cleaned.homeScore !== undefined, away: cleaned.awayScore !== undefined },
            'feed',
          );
        }
        // Segment GameEvent — same paper trail as setSegment.
        if (segmentChanged && cleaned.segment !== undefined) {
          await scope.event('SEGMENT', { segment: cleaned.segment, source: 'cts' });
        }
        if (wantsAudit) {
          scope.audit('CTS_SNAPSHOT_INGEST', {
            source: auth.source || 'cts',
            reconnect,
            scoreChanged,
            segmentChanged,
            clockRunChanged,
            horn,
            snapshot: cleaned,
          });
        }
      }, { gate });
    } catch (err) {
      // K12-F13: a FINAL game takes no feed data. A console that keeps
      // streaming after the final horn is told so, not errored at 5 Hz.
      if (isGameFinalRefusal(err)) return { ok: true, accepted: false, reason: 'game is final' };
      throw err;
    }

    if (refusedAs) return { ok: true, accepted: false, reason: refusedAs };
    return { ok: true, accepted: true };
  }

  /**
   * Sprint 13 DEPTH pass (2026-07-01) — CTS SWIMMING scoreboard-serial
   * ingest. Docs: docs/research/2026-06-30-swim-dive-scoreboards/
   * 00-REPORT.md part A7 + docs/research/2026-07-01-swim-dive-depth/.
   *
   * UNLIKE ingestCtsSnapshot (water polo — writes through to the
   * operator score/segment columns + syncs penalty/shot-clock timers),
   * swimming has no equivalent "operator column" for lane times/places —
   * the whole point is the console IS the source of truth for the heat
   * in progress. So this method writes ONLY into the structured
   * `Game.stats.results` key (the SAME MeetResult contract the console's
   * Meet-Results editor and every swim/dive board widget already read
   * via `readResults`/`sanitizeResults`) — no Prisma migration, no new
   * stats shape, no score-column write-through.
   *
   * Auth mirrors ingestCtsSnapshot exactly: tenant-scoped load when an
   * authenticated caller supplies `auth.tenantId`; otherwise the public
   * feed-token path (`auth.tenantId` absent) resolves the game by id
   * alone — token possession is what proves ownership there, checked by
   * the controller BEFORE this method is ever called.
   *
   * `snapshot` is the ALREADY-DECODED `SwimTimingSnapshot` shape from
   * `@cms/scoreboard-cts`'s `SwimTimingParser` (the bridge box parses the
   * raw RS-232 bytes locally and posts JSON, exactly like the CTS water-
   * polo bridge does for `cts-snapshot`) — this method never sees raw
   * serial bytes.
   */
  async ingestSwimTimingSnapshot(
    gameId: string,
    snapshot: SwimTimingSnapshot,
    auth: { tenantId?: string | null; actorUserId?: string | null; source?: string },
  ): Promise<{ ok: true; accepted: boolean; reason?: string }> {
    // Auth/existence gate only — the merge re-reads fresh inside withStatsTx.
    const gate = auth.tenantId
      ? await this.prisma.client.game.findFirst({
          where: { id: gameId, tenantId: auth.tenantId },
        })
      // ten-ok: ELSE arm of the branch above — reached only when there is no
      // caller tenant, i.e. the swim-timing bridge authenticated with the
      // game-scoped feed token the controller verified first. The authenticated
      // arm is tenant-scoped; the tenantId resolved here is what binds the
      // merge's withStatsTx predicate.
      : await this.prisma.client.game.findUnique({ where: { id: gameId } });
    if (!gate) {
      throw new NotFoundException('Game not found');
    }

    const laneCount = Object.keys(snapshot?.lanes ?? {}).length;
    if (laneCount === 0 && !snapshot?.eventHeat && !snapshot?.teamScore) {
      // Nothing decoded yet (e.g. the bridge just connected) — drop
      // silently, same "don't mask an outage with a no-op write" rule
      // ingestCtsSnapshot follows for an all-empty snapshot.
      return { ok: true, accepted: false, reason: 'empty snapshot' };
    }

    // Roster join (report A7: "names+seed come from meet-mgmt... VenueOS's
    // ingest must join these two streams on (event, heat, lane)"). VenueOS
    // has no dedicated Hy-Tek/Splash import yet, so the join source is
    // whatever the operator has already entered in the game's roster —
    // `RosterPlayer.stats.lane` (a plain JSON field, no migration) is the
    // per-heat lane hint. A roster with no lane hints yields lane+time-only
    // rows, never a fabricated name (report A7/A5 explicit rule).
    let rosterEntries: SwimRosterEntry[] = [];
    try {
      const rosterRows = await this.prisma.client.rosterPlayer.findMany({
        where: { gameId },
      });
      rosterEntries = rosterRows
        .map((r): SwimRosterEntry | null => {
          const stats = (r.stats as Record<string, unknown>) || {};
          const lane = typeof stats.lane === 'number' ? stats.lane : Number(stats.lane);
          if (!Number.isFinite(lane) || lane <= 0) return null;
          const team = r.team === 'home' || r.team === 'away' ? r.team : null;
          return { name: r.name, team, lane };
        })
        .filter((r): r is SwimRosterEntry => r !== null);
    } catch {
      // Roster lookup is best-effort — a DB hiccup here must not block
      // the timing snapshot; it just means this update renders lane+time
      // only, same as "no roster configured."
      rosterEntries = [];
    }

    // The feed never fabricates a DQ (2026-07-12 world-class audit P0), so
    // there is no "heat over" inference to do here — a lane with no time is
    // simply blank, and DQ/SCR come from the operator's lane pad, not the
    // timer. normalizeSwimSnapshot renders time-or-blank per lane.
    const fresh = normalizeSwimSnapshot(snapshot, rosterEntries);

    // Swim timing is the same ~5-10 Hz whole-blob merge as ingestCtsSnapshot,
    // racing the operator's Meet-Results edits on the same `Game.stats` blob:
    // one command, merged on the fresh in-transaction read, ONE compare-and-
    // swap write (the audit-cadence marker rides it — it used to be a second,
    // unguarded write), and the sampled audit row in the same transaction.
    //
    // SEC-009: bound to the tenant of the gate-resolved game — same reasoning
    // as ingestCtsSnapshot above (the feed token, not a caller tenant, is the
    // authorization on the public path).
    const actor: CommandInput = auth.actorUserId
      ? { actor: { kind: 'user', userId: auth.actorUserId } }
      : feedActor('swim');
    try {
      await this.runGameCommand(gate.tenantId, gameId, 'feed.swim', actor, null, async (scope) => {
        const game = scope.before;
        let wantsAudit = false;
        let placesChanged = false;
        const prevStats: Record<string, unknown> =
          game.stats && typeof game.stats === 'object' ? { ...(game.stats as Record<string, unknown>) } : {};
        const prevResults = sanitizeResults(prevStats.results);
        const mergedResults = mergeSwimResult(prevResults, fresh);
        const sanitized = sanitizeResults(mergedResults as unknown);

        // stats.feed liveness stamp (guided-setup pill, Inputs-wave GUIDED) —
        // rides the existing single merged write, inside the Serializable tx.
        const nextStats: Record<string, unknown> = {
          ...prevStats,
          results: sanitized,
          feed: this.feedStamp('swim', true),
        };

        // Team score (dual meets, report A7 module 0x0D) folds into the same
        // homeTimeouts-style scalar convention ingestCtsSnapshot uses for its
        // T2-1 fields — a plain scalar pair on stats, not a new structured key.
        const teamScore = extractSwimTeamScore(snapshot);
        if (teamScore) {
          nextStats.swimHomeScore = teamScore.homeScore;
          nextStats.swimAwayScore = teamScore.awayScore;
        }

        // Sampled audit — mirrors ingestCtsSnapshot's cadence discipline (a
        // 5-10Hz timing feed would otherwise flood AuditLog). Audit-worthy:
        // a new/changed event-heat header, any place change (someone
        // finished), or at most once per 60s otherwise.
        const prevEventHeat = prevResults.find((r) => r.event === fresh.event);
        placesChanged =
          !prevEventHeat ||
          prevEventHeat.entries.length !== fresh.entries.length ||
          fresh.entries.some((e, i) => prevEventHeat.entries[i]?.place !== e.place || prevEventHeat.entries[i]?.mark !== e.mark);
        const prevAuditKey = `swimAuditAt:${fresh.event}`;
        const lastAuditAt = typeof prevStats[prevAuditKey] === 'number' ? (prevStats[prevAuditKey] as number) : 0;
        wantsAudit = placesChanged || Date.now() - lastAuditAt > 60_000;
        if (wantsAudit) {
          // Stamp the audit-cadence marker into the SAME write.
          nextStats[prevAuditKey] = Date.now();
        }

        await scope.write({ stats: nextStats });
        if (wantsAudit) {
          scope.audit('SWIM_TIMING_SNAPSHOT_INGEST', {
            source: auth.source || 'swim-timing-feed',
            event: fresh.event,
            placesChanged,
            laneCount,
            rosterJoined: rosterEntries.length,
          });
        }
      }, { gate });
    } catch (err) {
      // K12-F13: a FINAL game takes no feed data. A console that keeps
      // streaming after the final horn is told so, not errored at 5 Hz.
      if (isGameFinalRefusal(err)) return { ok: true, accepted: false, reason: 'game is final' };
      throw err;
    }

    return { ok: true, accepted: true };
  }

  // ── Undo rail ─────────────────────────────────────────────────

  /**
   * Event types whose primary event records its command's whole state change
   * and can therefore be undone as a unit (K12-F09). CUE (already aired),
   * STATUS (a status transition fires its own cinematics; a FINAL is changed
   * through reopenGame), INGEST and the ribbon/config types are not.
   */
  private static readonly UNDOABLE_EVENT_TYPES: ReadonlySet<string> = new Set([
    'SCORE', 'CLOCK', 'SEGMENT', 'STAT', 'TIMEOUT', 'POSSESSION', 'PENALTY',
  ]);

  /**
   * Why an event cannot be undone, or null when it can. One rule set for the
   * rail's `undoable` flag and for undoEvent's refusal, so the button the
   * operator sees and the server's answer can never disagree.
   */
  private undoRefusal(
    ev: { type: string; payload: unknown },
  ): { code: 'system' | 'undo' | 'type' | 'derived' | 'feed' | 'legacy'; reason: string } | null {
    const p = (ev.payload as Record<string, unknown>) ?? {};
    if (p.auto) return { code: 'system', reason: 'System auto-advance events cannot be undone' };
    if (p.undoOf) return { code: 'undo', reason: 'Undo events cannot themselves be undone' };
    if (ev.type === 'CUE') {
      return { code: 'type', reason: 'Cue events cannot be undone (cinematic already aired)' };
    }
    if (!SportsService.UNDOABLE_EVENT_TYPES.has(ev.type)) {
      return { code: 'type', reason: `Event type "${ev.type}" is not undoable` };
    }
    if (p.derived) {
      return { code: 'derived', reason: 'Part of a larger action — undo that action instead' };
    }
    if (p.source === 'cts' || p.team === 'cts') {
      return { code: 'feed', reason: 'Set by the scoreboard feed — correct it at the console' };
    }
    const change = p.change as { before?: unknown; after?: unknown } | undefined;
    if (!change || typeof change.before !== 'object' || typeof change.after !== 'object' || !change.before || !change.after) {
      return { code: 'legacy', reason: 'Recorded before the undo record existed (pre-2026-09-26)' };
    }
    return null;
  }

  /**
   * Return the most-recent N game events in reverse-chronological
   * order — consumed by the operator's RecentEventsRail component.
   * Every event is listed; `undoable` says whether the rail may offer Undo
   * (see undoRefusal), and an event already undone is marked `undone`.
   */
  async getEvents(tenantId: string, gameId: string, limit = 25) {
    await this.owned(tenantId, gameId);
    const raw = await this.prisma.client.gameEvent.findMany({
      where: { gameId },
      // Deterministic order for the undo rail. createdAt alone is NOT enough:
      // several events of one command can share a millisecond, and the DB is
      // then free to return them in arbitrary order — so events[0] ("most
      // recent", what one-tap undo acts on) could change between requests.
      // The id tiebreak makes the sequence stable.
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: Math.min(50, Math.max(1, limit)),
    });
    // An undo is always newer than what it undid, so any undone event in this
    // window has its UNDO_* event in the window too.
    const undone = new Set(
      raw
        .map((ev) => (ev.payload as Record<string, unknown> | null)?.undoOf)
        .filter((id): id is string => typeof id === 'string'),
    );
    return raw.map((ev) => {
      const payload = (ev.payload as Record<string, unknown>) ?? {};
      const refusal = this.undoRefusal(ev);
      const nonUndoableReason = refusal?.code ?? (undone.has(ev.id) ? 'undone' : undefined);
      return {
        id: ev.id,
        type: ev.type,
        payload,
        undoable: nonUndoableReason === undefined,
        nonUndoableReason,
        createdAt: ev.createdAt,
      };
    });
  }

  /**
   * Undo ONE command — K12-F09: the single-use inverse of the whole action.
   *
   * THE BUGS this closes. The old rail synthesised an inverse from a couple
   * of `prev*` fields and re-ran the forward methods: a retried undo
   * subtracted the points again (K12-07); undoing a −1 clamped at zero
   * AWARDED a point (K12-08); an absolute correction had no before-snapshot
   * (K12-09); undoing a clock start left it running (K12-12); undoing a pause
   * added the elapsed time back (K12-13); undoing a period advance left the
   * fouls it cleared at zero (K12-16); undoing a set-winning point left the
   * set credited and the next set on the board (K12-06).
   *
   * NOW: every command's primary event records the before/after of every
   * field it changed (`change`), and the undo restores exactly that
   * (game-command.ts planUndo), as one command:
   *   - SINGLE-USE: it is claimed under the deterministic command id
   *     `undo:<eventId>` — a retried, double-tapped or concurrent undo of the
   *     same event is answered from that receipt and changes nothing;
   *   - EXACT when nothing it touched has changed since; clocks are re-anchored
   *     now (undoing a start gives the elapsed time back, undoing a pause
   *     resumes as if it never happened);
   *   - score-only commands undo by DELTA when later scoring moved the same
   *     columns (what the command actually applied — nothing, for a clamped −1);
   *   - otherwise 409 UNDO_CONFLICT naming the fields a later action changed,
   *     rather than overwrite that later action.
   * Refusals (422 BUG_NOT_UNDOABLE) follow undoRefusal — the same rules the
   * rail's `undoable` flag shows.
   */
  async undoEvent(tenantId: string, gameId: string, eventId: string, actor?: CommandInput) {
    if (typeof eventId !== 'string' || !eventId) throw new NotFoundException('Event not found');
    const base = resolveCommandContext(actor);
    const ctx: CommandInput = { actor: base.actor, commandId: `undo:${eventId}` };
    return this.runGameCommand(tenantId, gameId, 'event.undo', ctx, { eventId }, async (scope) => {
      const ev = await scope.tx.gameEvent.findFirst({ where: { id: eventId, gameId } });
      if (!ev) throw new NotFoundException('Event not found');
      const refusal = this.undoRefusal(ev);
      if (refusal) {
        throw new UnprocessableEntityException({ code: 'BUG_NOT_UNDOABLE', reason: refusal.reason });
      }
      const payload = (ev.payload as Record<string, unknown>) ?? {};
      const change = payload.change as StateChange;
      const def = this.sportOf(scope.before);
      const plan = planUndo(change, scope.before, { clock: def.clock.type, now: this.clockNow() });
      if (!plan.ok) {
        throw new ConflictException({
          code: 'UNDO_CONFLICT',
          message: 'Something changed since that action. Undo the newer actions first.',
          fields: plan.conflicts,
        });
      }
      if (Object.keys(plan.data).length > 0) await scope.write(plan.data);
      const undoChange = scope.change();
      await scope.event(`UNDO_${ev.type}`, {
        undoOf: eventId,
        originalType: ev.type,
        mode: plan.mode,
        change: undoChange,
      });
      scope.audit('SPORTS_EVENT_UNDONE', {
        eventId,
        originalType: ev.type,
        mode: plan.mode,
        change: undoChange,
      });
      return { ok: true, undoOf: eventId, originalType: ev.type };
    });
  }

  /**
   * The volunteer pad's Undo (K12-F16, 2026-09-27) — the single-use inverse
   * (K12-F09) of a scorekeeper LINK's own most recent action.
   *
   * A link can only undo what it did itself, and only its latest action:
   *   - the action is named by the durable command id the pad sent it with;
   *     its receipt (K12-F10) must say the command came from THIS link. The
   *     actor ref is the link's fingerprint (K12-F34), derived by the
   *     controller from the VERIFIED token — the caller cannot choose it;
   *   - it must be the link's LATEST command (receipts ordered by the game
   *     revision each produced) — a second phone on the same link, or a pad
   *     left open, cannot reach back past a newer action from that link;
   *   - the undo itself IS undoEvent: claimed once under `undo:<eventId>` (a
   *     second tap is answered from that receipt and changes nothing),
   *     refused when a later action changed what it touched (409
   *     UNDO_CONFLICT), refused on a FINAL game (409 GAME_FINAL), and written
   *     to the event trail + immutable audit log with this link as the actor.
   * "Not found" and "not this link's" are the same 404, so a link learns
   * nothing about other links' or the operator's command ids. An action that
   * wrote no undoable event (a cue, a shot-clock tap) is 422 BUG_NOT_UNDOABLE.
   */
  async undoConsoleAction(
    tenantId: string,
    gameId: string,
    targetCommandId: string,
    actor: CommandInput,
  ) {
    const ctx = resolveCommandContext(actor);
    const linkRef =
      ctx.actor.kind === 'console' && ctx.actor.ref ? ctx.actor.ref : null;
    if (!linkRef) {
      throw new BadRequestException(
        'Only a scorekeeper link undoes its own action here',
      );
    }
    await this.owned(tenantId, gameId);
    const receipt = await this.prisma.client.gameCommand.findFirst({
      where: { tenantId, gameId, commandId: targetCommandId },
      select: { commandId: true, kind: true, actorType: true, actorRef: true },
    });
    if (
      !receipt ||
      receipt.actorType !== 'console' ||
      receipt.actorRef !== linkRef ||
      receipt.kind === 'event.undo'
    ) {
      throw new NotFoundException({
        code: 'CONSOLE_UNDO_NOT_FOUND',
        message: 'That change was not made from this link.',
      });
    }
    const latest = await this.prisma.client.gameCommand.findFirst({
      where: {
        tenantId,
        gameId,
        actorType: 'console',
        actorRef: linkRef,
        kind: { not: 'event.undo' },
      },
      orderBy: [{ revisionAfter: 'desc' }, { createdAt: 'desc' }],
      select: { commandId: true },
    });
    if (!latest || latest.commandId !== targetCommandId) {
      throw new ConflictException({
        code: 'CONSOLE_UNDO_NOT_LATEST',
        message:
          'This link made another change after that one. Only its latest change can be undone here.',
      });
    }
    const events = await this.prisma.client.gameEvent.findMany({
      where: { gameId, commandId: targetCommandId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, type: true, payload: true },
    });
    const primary = events.find(
      (ev: { type: string; payload: unknown }) =>
        SportsService.UNDOABLE_EVENT_TYPES.has(ev.type) &&
        !(ev.payload as Record<string, unknown> | null)?.derived,
    );
    if (!primary) {
      throw new UnprocessableEntityException({
        code: 'BUG_NOT_UNDOABLE',
        reason: 'That change cannot be undone from a scorekeeper link.',
      });
    }
    return this.undoEvent(tenantId, gameId, primary.id, actor);
  }
}
