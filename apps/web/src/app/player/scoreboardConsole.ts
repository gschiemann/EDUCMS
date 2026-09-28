/**
 * K12-F32 — the player's side of a scoreboard console bound to a game.
 *
 * The manifest's `scoreboardConsole` block (apps/api/src/sports/
 * scoreboard-console.ts) tells a box which game its console feeds and the
 * decoder table for that game's sport — or `decoderSport: null` when the
 * console on this box cannot read it. This module turns it into:
 *
 *   • a validated binding (allow-listed like every other manifest field the
 *     player trusts — an unknown profile or decoder table is dropped, never
 *     guessed), and
 *   • the bridge mount plan: MANAGED (from the manifest — no URL, no token;
 *     the box posts with its own device credential) or LEGACY (the old
 *     `?cts=1&game=…&feedToken=…` kiosk URL, kept only so an existing pilot
 *     install keeps working until it is set up the new way).
 *
 * Pure — no React, no DOM, no network — so the decision is unit-tested
 * without mounting the player page. Chromium-83 safe.
 */
import { CONSOLE_PROFILES, DAKTRONICS_OFFSETS } from '@cms/scoreboard-cts';

export type ManagedConsoleProfile = 'cts-gen6' | 'cts-gen7' | 'cts-wttc' | 'daktronics-allsport';

export interface ManagedConsoleBinding {
  gameId: string;
  /** Engine sport key and its display name (for the box's own message). */
  sport: string;
  sportName: string;
  consoleProfile: ManagedConsoleProfile | null;
  decoder: 'cts' | 'daktronics' | null;
  /** The decoder's table for the game's sport; null = this console cannot read it. */
  decoderSport: string | null;
  supportedSportNames: string[];
  /** The operator compared the preview with the scoreboard and confirmed it. */
  confirmed: boolean;
}

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** The decoder tables each decoder actually carries — the parsers' own lists. */
export function decoderTables(decoder: 'cts' | 'daktronics', profile: ManagedConsoleProfile | null): string[] {
  if (decoder === 'daktronics') return Object.keys(DAKTRONICS_OFFSETS);
  const p = profile ? CONSOLE_PROFILES[profile] : null;
  return p && p.decoder === 'cts' ? [...(p.sports ?? [])] : [];
}

function names(v: unknown): string[] {
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= 40).slice(0, 12)
    : [];
}

/** Validate the manifest block. Anything malformed → null (not bound). */
export function parseScoreboardConsoleBlock(raw: unknown): ManagedConsoleBinding | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const gameId = typeof o.gameId === 'string' && ID_RE.test(o.gameId) ? o.gameId : null;
  const sport = typeof o.sport === 'string' && ID_RE.test(o.sport) ? o.sport : null;
  if (!gameId || !sport) return null;
  const consoleProfile =
    typeof o.consoleProfile === 'string' && o.consoleProfile in CONSOLE_PROFILES
      ? (o.consoleProfile as ManagedConsoleProfile)
      : null;
  const decoder =
    consoleProfile && (o.decoder === 'cts' || o.decoder === 'daktronics') &&
    CONSOLE_PROFILES[consoleProfile].decoder === o.decoder
      ? (o.decoder as 'cts' | 'daktronics')
      : null;
  const decoderSport =
    decoder && typeof o.decoderSport === 'string' && decoderTables(decoder, consoleProfile).includes(o.decoderSport)
      ? o.decoderSport
      : null;
  return {
    gameId,
    sport,
    sportName: typeof o.sportName === 'string' && o.sportName.length <= 40 ? o.sportName : sport,
    consoleProfile,
    decoder,
    decoderSport,
    supportedSportNames: names(o.supportedSportNames),
    confirmed: o.confirmed === true,
  };
}

/** Structural equality — keeps React state stable across identical manifests. */
export function sameConsoleBinding(a: ManagedConsoleBinding | null, b: ManagedConsoleBinding | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export type BridgeMountPlan =
  | { mount: false }
  | { mount: true; mode: 'managed'; binding: ManagedConsoleBinding }
  | { mount: true; mode: 'legacy'; gameId: string | null; feedToken: string | null };

/**
 * A manifest binding always wins over the kiosk URL — once a box is set up
 * the new way, a stale `?feedToken=` in its start URL is never used.
 */
export function bridgeMountPlan(input: {
  binding: ManagedConsoleBinding | null;
  urlCts: string | null;
  urlGame: string | null;
  urlFeedToken: string | null;
}): BridgeMountPlan {
  if (input.binding) return { mount: true, mode: 'managed', binding: input.binding };
  if (input.urlCts === '1') {
    return { mount: true, mode: 'legacy', gameId: input.urlGame || null, feedToken: input.urlFeedToken || null };
  }
  return { mount: false };
}

/** What the console endpoint last said about this box's packets. */
export type ManagedAnswer = 'preview' | 'live' | 'final' | 'mismatch' | 'notBound' | 'gameGone' | 'unsupported';

/**
 * What the console endpoint's answer means for the box's panel. Only a
 * DEFINITIVE answer changes it: a heartbeat, a transient failure (network,
 * a 401 while the device credential renews, 429, 5xx) or an out-of-order
 * refusal leaves the last state standing — the panel never flaps on a blip.
 */
export function managedAnswerFor(status: number, body: Record<string, unknown> | null): ManagedAnswer | null {
  if (status >= 200 && status < 300) {
    if (!body || body.reason === 'heartbeat') return null;
    if (body.preview === true) return 'preview';
    if (body.accepted === true) return 'live';
    if (body.reason === 'game is final') return 'final';
    return null;
  }
  if (status === 409) {
    switch (body?.code) {
      case 'CONSOLE_DECODER_MISMATCH':
        return 'mismatch';
      case 'CONSOLE_NOT_BOUND':
        return 'notBound';
      case 'CONSOLE_GAME_GONE':
        return 'gameGone';
      case 'CONSOLE_SPORT_UNSUPPORTED':
        return 'unsupported';
      default:
        return null;
    }
  }
  return null;
}

/**
 * Which decoder table the bridge reads with. MANAGED: exactly the manifest's
 * (server-computed from the game's sport) — null means "cannot read this
 * sport". LEGACY: an explicit `?dakSport=` the parser carries, else NONE for
 * a Daktronics console. The old default was 'football', which decoded a
 * basketball or baseball console with football's byte offsets.
 */
export function resolveDecoderSport(input: {
  decoder: 'cts' | 'daktronics';
  profile: ManagedConsoleProfile | null;
  managed: ManagedConsoleBinding | null;
  explicit: string | null | undefined;
}): string | null {
  const tables = decoderTables(input.decoder, input.profile);
  if (input.managed) {
    return input.managed.decoderSport && tables.includes(input.managed.decoderSport)
      ? input.managed.decoderSport
      : null;
  }
  if (input.explicit && tables.includes(input.explicit)) return input.explicit;
  // A legacy CTS install has always been water polo (its only table).
  return input.decoder === 'cts' && tables.length === 1 ? tables[0] : null;
}
