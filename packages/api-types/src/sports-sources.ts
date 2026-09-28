/**
 * VenueOS Sports — WHERE A GAME'S SCORE CAN COME FROM, said truthfully
 * (K-12 sports launch program, lane A4, 2026-09-27). Register rows K12-F33
 * ("make provider and hardware capability labels truthful and consistent")
 * and K12-F32 ("replace URL-based bridge setup and the football parser
 * fallback") of the Codex readiness audit.
 *
 * ONE list of score sources, each of one kind:
 *
 *   manual                 the game console or a scorekeeper link — always there;
 *   generic-feed           our signed JSON score feed (one URL + token per game).
 *                          The SENDER is the customer's: a vendor's HTTP push, a
 *                          relay, a script. Sportzcast and Scorebird are setup
 *                          RECIPES on this feed — there is no native adapter;
 *   experimental-hardware  a scoreboard console read by a VenueOS box over
 *                          serial. The decoder runs; it has not been confirmed
 *                          against the real console on site (hardware gate G03);
 *   unavailable            no connector exists. Never shown as connected.
 *
 * Each source names its capability in the §21 capability registry
 * (capability-registry.ts) — sports-sources.spec.ts holds the two in step —
 * and the sports it can drive. A hardware source also names the console
 * profiles (@cms/scoreboard-cts console-profiles.ts) it covers and, per
 * sport, the decoder table it reads: a console is only ever decoded with a
 * table for the game's OWN sport. The old bridge decoded any Daktronics
 * console as FOOTBALL when nobody told it the sport; `consoleDecoderFor`
 * answers "not supported" instead.
 *
 * Pure: shared by the API (which binds a console to a game and refuses an
 * unsupported one), the console (which labels what it offers) and the player
 * bridge (which decodes). Safe on Chromium 83.
 */

export type ScoreSourceKind = 'manual' | 'generic-feed' | 'experimental-hardware' | 'unavailable';

export interface ScoreSource {
  id: string;
  /** Proper noun — never translated. */
  name: string;
  kind: ScoreSourceKind;
  /** Its entry in CAPABILITY_REGISTRY. */
  capability: string;
  /** Sports it can drive: every sport, or these engine sport keys. */
  sports: 'all' | readonly string[];
  /** experimental-hardware: the console profiles (scoreboard-cts ids) it covers. */
  consoleProfiles?: readonly string[];
  /** experimental-hardware: which decoder those profiles run. */
  decoder?: 'cts' | 'daktronics';
  /** experimental-hardware: engine sport key → the decoder's own sport table. */
  decoderSports?: Readonly<Record<string, string>>;
}

export const SCORE_SOURCES: readonly ScoreSource[] = Object.freeze([
  { id: 'manual', name: 'VenueOS console', kind: 'manual', capability: 'sports-manual-scoring', sports: 'all' },
  {
    id: 'generic-feed',
    name: 'VenueOS score feed',
    kind: 'generic-feed',
    capability: 'sports-generic-score-feed',
    sports: 'all',
  },
  { id: 'sportzcast', name: 'Sportzcast', kind: 'generic-feed', capability: 'sports-vendor-feed-recipes', sports: 'all' },
  { id: 'scorebird', name: 'Scorebird', kind: 'generic-feed', capability: 'sports-vendor-feed-recipes', sports: 'all' },
  {
    id: 'cts-console',
    name: 'Colorado Time Systems console',
    kind: 'experimental-hardware',
    capability: 'sports-hardware-console',
    // The CTS scoreboard decoder models a water-polo board (clock, period,
    // scores, shot clocks, exclusions); swim timing is its own path.
    sports: ['water_polo'],
    consoleProfiles: ['cts-gen6', 'cts-gen7', 'cts-wttc'],
    decoder: 'cts',
    decoderSports: { water_polo: 'water-polo' },
  },
  {
    id: 'daktronics-allsport',
    name: 'Daktronics All Sport',
    kind: 'experimental-hardware',
    capability: 'sports-hardware-console',
    // The three field maps the decoder carries (scoreboard-cts
    // daktronics/offsets.ts); softball runs on the console's baseball
    // insert, the same table. Soccer, volleyball, wrestling … have none.
    sports: ['football', 'basketball', 'baseball', 'softball'],
    consoleProfiles: ['daktronics-allsport'],
    decoder: 'daktronics',
    decoderSports: { football: 'football', basketball: 'basketball', baseball: 'baseball', softball: 'baseball' },
  },
  { id: 'genius-sports', name: 'Genius Sports', kind: 'unavailable', capability: 'sports-league-data-connectors', sports: [] },
  { id: 'sportradar', name: 'Sportradar', kind: 'unavailable', capability: 'sports-league-data-connectors', sports: [] },
  { id: 'maxpreps', name: 'MaxPreps', kind: 'unavailable', capability: 'sports-league-data-connectors', sports: [] },
  { id: 'gamechanger', name: 'GameChanger', kind: 'unavailable', capability: 'sports-league-data-connectors', sports: [] },
  { id: 'nfhs-network', name: 'NFHS Network', kind: 'unavailable', capability: 'nfhs-network-overlay', sports: [] },
] as ScoreSource[]);

/** A source by id. */
export function scoreSource(id: string | null | undefined): ScoreSource | undefined {
  return id ? SCORE_SOURCES.find((s) => s.id === id) : undefined;
}

/** Can this source drive this sport? */
export function scoreSourceDrives(source: ScoreSource, sportKey: string | null | undefined): boolean {
  if (!sportKey) return false;
  return source.sports === 'all' || source.sports.includes(sportKey);
}

/** The hardware source a console profile belongs to. */
export function consoleSource(profileId: string | null | undefined): ScoreSource | undefined {
  return profileId
    ? SCORE_SOURCES.find((s) => s.kind === 'experimental-hardware' && s.consoleProfiles?.includes(profileId))
    : undefined;
}

export type ConsoleDecoderVerdict =
  | { ok: true; sourceId: string; decoder: 'cts' | 'daktronics'; decoderSport: string }
  | { ok: false; code: 'CONSOLE_UNKNOWN' | 'CONSOLE_SPORT_UNSUPPORTED'; supportedSports: string[] };

/**
 * K12-F32 — how a console profile decodes a game of `sportKey`: its decoder
 * and the decoder's table for THAT sport, or why it cannot. Never a default
 * sport: a console with no table for the game's sport is not supported.
 */
export function consoleDecoderFor(
  profileId: string | null | undefined,
  sportKey: string | null | undefined,
): ConsoleDecoderVerdict {
  const src = consoleSource(profileId);
  if (!src || !src.decoder) return { ok: false, code: 'CONSOLE_UNKNOWN', supportedSports: [] };
  const supportedSports = Object.keys(src.decoderSports ?? {});
  const decoderSport = sportKey ? src.decoderSports?.[sportKey] : undefined;
  if (!decoderSport) return { ok: false, code: 'CONSOLE_SPORT_UNSUPPORTED', supportedSports };
  return { ok: true, sourceId: src.id, decoder: src.decoder, decoderSport };
}
