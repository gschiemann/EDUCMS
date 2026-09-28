/**
 * K12-F32 — a scoreboard console bound to a game through authenticated
 * configuration (K-12 sports launch program, lane A4, 2026-09-27).
 *
 * THE FINDING. The console bridge ran only on a kiosk opened with
 * `?cts=1&game=<id>&feedToken=<token>` — a write credential in a URL, in the
 * browser history and in anything that copied the address — and it decoded a
 * Daktronics console as FOOTBALL whenever nobody passed `?dakSport=`. Picking
 * a console model on the screen did not finish the job, and a basketball or
 * baseball console could be read with football's byte offsets.
 *
 * THE BINDING. The operator binds one screen — the box wired to the console —
 * to one game from the game's console (Setup → Scoreboard console). It lives
 * on the screen, beside the console model the screen settings already carry:
 *
 *   Screen.config.consoleProfile     which console is wired to this box
 *   Screen.config.scoreboardConsole  { gameId, sport, boundAt, boundBy,
 *                                      confirmedAt, confirmedBy }
 *
 * A Screen write already invalidates the manifest cache, and the manifest is
 * the one place a player learns its configuration — so a bound box starts its
 * bridge with the right decoder for the game's sport, survives a restart, and
 * needs no URL. The game's sport is copied into the binding when it is made
 * (a game's sport never changes), so the manifest block is a pure function of
 * the screen row: no extra read per poll and nothing volatile in the hashed
 * payload.
 *
 * PREVIEW → CONFIRM. Until the operator has compared what the console sends
 * with the physical scoreboard and confirmed it, the box's snapshots are held
 * as a PREVIEW (never written to the game), so a wrong model or cable cannot
 * put numbers on a public board.
 *
 * Pure: no Nest, no Prisma. The service (scoreboard-console.service.ts) and
 * the manifest (screens.controller.ts) both read the binding through here.
 */
import {
  SCORE_SOURCES,
  consoleDecoderFor,
  consoleSource,
  findSport,
} from '@cms/api-types';

/** Every console profile a hardware score source covers (one list). */
export const SCOREBOARD_CONSOLE_PROFILE_IDS: readonly string[] = Object.freeze(
  SCORE_SOURCES.flatMap((s) =>
    s.kind === 'experimental-hardware' ? [...(s.consoleProfiles ?? [])] : [],
  ),
);

export interface ScoreboardConsoleBinding {
  gameId: string;
  /** The game's engine sport key, copied at bind time (a game's sport is fixed). */
  sport: string;
  boundAt: string;
  boundBy: string | null;
  /** Null until the operator confirmed the preview — until then nothing reaches the game. */
  confirmedAt: string | null;
  confirmedBy: string | null;
}

/** What the player's manifest carries for a bound box. Stable values only. */
export interface ScoreboardConsoleManifestBlock {
  gameId: string;
  sport: string;
  sportName: string;
  /** The console model on this box, or null when none is chosen. */
  consoleProfile: string | null;
  decoder: 'cts' | 'daktronics' | null;
  /** The decoder's table for the game's sport — null means "this console cannot read it". */
  decoderSport: string | null;
  supportedSports: string[];
  supportedSportNames: string[];
  confirmed: boolean;
}

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function configObject(config: unknown): Record<string, unknown> | null {
  return config && typeof config === 'object' && !Array.isArray(config)
    ? (config as Record<string, unknown>)
    : null;
}

function isoOrNull(v: unknown): string | null {
  return typeof v === 'string' && Number.isFinite(Date.parse(v)) ? v : null;
}

/** The binding on a screen's config, or null. Never throws. */
export function readScoreboardConsoleBinding(
  config: unknown,
): ScoreboardConsoleBinding | null {
  const raw = configObject(configObject(config)?.scoreboardConsole);
  if (!raw) return null;
  const gameId =
    typeof raw.gameId === 'string' && ID_RE.test(raw.gameId)
      ? raw.gameId
      : null;
  const sport =
    typeof raw.sport === 'string' && ID_RE.test(raw.sport) ? raw.sport : null;
  const boundAt = isoOrNull(raw.boundAt);
  if (!gameId || !sport || !boundAt) return null;
  return {
    gameId,
    sport,
    boundAt,
    boundBy: typeof raw.boundBy === 'string' ? raw.boundBy : null,
    confirmedAt: isoOrNull(raw.confirmedAt),
    confirmedBy: typeof raw.confirmedBy === 'string' ? raw.confirmedBy : null,
  };
}

/** The console model on a screen's config, when it is one we know. */
export function readScreenConsoleProfile(config: unknown): string | null {
  const v = configObject(config)?.consoleProfile;
  return typeof v === 'string' && SCOREBOARD_CONSOLE_PROFILE_IDS.includes(v)
    ? v
    : null;
}

/** Engine sport key → its display name (proper noun, as every sports surface shows it). */
export function sportDisplayName(key: string): string {
  return findSport(key)?.name ?? key;
}

/**
 * The manifest block for a screen, or null when it is not bound. Derived from
 * the config alone — the ingest endpoint re-checks the game on every packet.
 */
export function scoreboardConsoleManifestBlock(
  config: unknown,
): ScoreboardConsoleManifestBlock | null {
  const binding = readScoreboardConsoleBinding(config);
  if (!binding) return null;
  const profile = readScreenConsoleProfile(config);
  const src = consoleSource(profile);
  const verdict = consoleDecoderFor(profile, binding.sport);
  const supportedSports = Object.keys(src?.decoderSports ?? {});
  return {
    gameId: binding.gameId,
    sport: binding.sport,
    sportName: sportDisplayName(binding.sport),
    consoleProfile: profile,
    decoder: src?.decoder ?? null,
    decoderSport: verdict.ok ? verdict.decoderSport : null,
    supportedSports,
    supportedSportNames: supportedSports.map(sportDisplayName),
    confirmed: !!binding.confirmedAt,
  };
}

/** Does this ingest body carry any scoreboard data (as opposed to a link heartbeat)? */
export function hasScoreboardData(body: Record<string, unknown>): boolean {
  return [
    'clockMs',
    'clockRunning',
    'segment',
    'homeScore',
    'awayScore',
    'horn',
    'shotClock',
    'homeShotClock',
    'awayShotClock',
    'homeExclusions',
    'awayExclusions',
    'homeTimeoutsRemaining',
    'awayTimeoutsRemaining',
  ].some((k) => body[k] !== undefined && body[k] !== null);
}

/** The box's report on its own serial link (what the setup card shows). */
export interface ConsoleLinkReport {
  reportedAt: string;
  status: 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error';
  bytes: number;
  goodFrames: number | null;
  badFrames: number | null;
  native: boolean;
}

const LINK_STATUSES = new Set([
  'idle',
  'connecting',
  'connected',
  'disconnected',
  'error',
]);

function count(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0
    ? Math.min(Math.round(v), 1e12)
    : null;
}

/** Sanitize the bridge's `link` block. Unknown shape → a bare "idle" report. */
export function cleanLinkReport(
  raw: unknown,
  reportedAt: string,
): ConsoleLinkReport {
  const o = configObject(raw) ?? {};
  const status =
    typeof o.status === 'string' && LINK_STATUSES.has(o.status)
      ? o.status
      : 'idle';
  return {
    reportedAt,
    status: status as ConsoleLinkReport['status'],
    bytes: count(o.bytes) ?? 0,
    goodFrames: count(o.goodFrames),
    badFrames: count(o.badFrames),
    native: o.native === true,
  };
}

/** The decoded values the operator compares with the scoreboard before confirming. */
export interface ConsolePreview {
  receivedAt: string;
  screenId: string;
  decoderSport: string;
  clockMs: number | null;
  clockRunning: boolean | null;
  segment: number | null;
  homeScore: number | null;
  awayScore: number | null;
}

function intOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0
    ? Math.round(v)
    : null;
}

/** Merge a snapshot onto the previous preview (a console sends what changed). */
export function nextPreview(
  prev: ConsolePreview | null,
  body: Record<string, unknown>,
  meta: { receivedAt: string; screenId: string; decoderSport: string },
): ConsolePreview {
  const keep =
    prev &&
    prev.screenId === meta.screenId &&
    prev.decoderSport === meta.decoderSport
      ? prev
      : null;
  const pick = (k: 'clockMs' | 'segment' | 'homeScore' | 'awayScore') =>
    intOrNull(body[k]) ?? keep?.[k] ?? null;
  return {
    receivedAt: meta.receivedAt,
    screenId: meta.screenId,
    decoderSport: meta.decoderSport,
    clockMs: pick('clockMs'),
    clockRunning:
      typeof body.clockRunning === 'boolean'
        ? body.clockRunning
        : (keep?.clockRunning ?? null),
    segment: pick('segment'),
    homeScore: pick('homeScore'),
    awayScore: pick('awayScore'),
  };
}
