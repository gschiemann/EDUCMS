import * as crypto from 'crypto';
import { requireSecret } from '../security/required-secret';

/**
 * Stateless, game-scoped CONSOLE SHARE token — Phase-2 Domain SHARE.
 *
 * Hands a student/volunteer scorekeeper LIMITED live-game control (score /
 * clock / segment / timeouts / celebration cues ONLY) via a revocable
 * /console/<token> link + QR, WITHOUT a tenant account. Before this the only
 * option was a full CONTRIBUTOR login (tenant-wide content-publishing
 * rights); the ?view=score URL param was purely cosmetic.
 *
 * Modeled directly on sports-feed-token.ts (same signing-secret strategy,
 * same stateless-verify + per-game version-revocation pattern) with three
 * deliberate differences:
 *
 *   1. DISTINCT PURPOSE STRING. The MAC input is prefixed "console:" — a
 *      console token can NEVER verify as a feed token (whose structured MACs
 *      use "feedv:" and whose bare MACs use "feed:"), and vice versa, even
 *      when both derive from the same fallback secret. Cross-purpose forgery
 *      is covered by spec.
 *
 *   2. THE GAME ID RIDES IN THE TOKEN. The public console controller's path
 *      is `/sports/console/:token/…` — the token is the only URL material, so
 *      it must carry which game it drives. Token shape:
 *          `<gameId>.<ver>.<iatSec>.<ttlSec>.<mac>`
 *      where mac = HMAC-SHA256("console:<gameId>:<ver>:<iat>:<ttl>",
 *      SECRET)[:32]. gameId / ver / iat / ttl are all inside the MAC — an
 *      attacker can't edit any cleartext field to retarget a game, dodge
 *      revocation, or extend expiry. (Game ids are UUIDs — no '.' or ':' —
 *      and the parser enforces that charset so the colon-delimited MAC input
 *      can never be aliased.)
 *
 *   3. ALWAYS-EXPIRING, no legacy bare form. This token travels in a URL
 *      (that is the whole product: a link you text to a volunteer), so like
 *      the feed's query-token posture (audit W0-01.4) a non-expiring form is
 *      never minted AND never verified: mint clamps ttl into
 *      [MIN, MAX_CONSOLE_TOKEN_TTL_SEC]; verify rejects ttl <= 0 or over the
 *      cap regardless of MAC validity.
 *
 * Revocation: Game.consoleTokenVersion (additive column, default 0) is folded
 * into the MAC. Bumping it (DELETE /sports/games/:id/console-share) instantly
 * invalidates every outstanding link for the game. Deliberately a SEPARATE
 * counter from feedTokenVersion — revoking a scorekeeper's link must never
 * kill a vendor's feed credential, and vice versa.
 */

// One-shot advisory flag — same log-spam guard as sports-feed-token.ts.
let warnedNoDedicatedSecret = false;

function consoleSecret(): string {
  // A dedicated SPORTS_CONSOLE_SECRET wins if set; otherwise the same
  // requireSecret(DEVICE_SECRET_KEY) fallback chain as the feed token. The
  // distinct "console:" MAC purpose keeps the two token families
  // non-interchangeable even when both derive from DEVICE_SECRET_KEY.
  const dedicated = process.env.SPORTS_CONSOLE_SECRET;
  if (dedicated && dedicated.trim().length >= 16) {
    return dedicated;
  }
  if (process.env.NODE_ENV === 'production' && !warnedNoDedicatedSecret) {
    warnedNoDedicatedSecret = true;
    console.error(
      '[sports-console-token] ACTION REQUIRED: SPORTS_CONSOLE_SECRET is not set in production. ' +
        'Console share tokens are deriving from DEVICE_SECRET_KEY (shared blast radius). ' +
        'Set a dedicated 64-hex SPORTS_CONSOLE_SECRET in the API environment.',
    );
  }
  return requireSecret('DEVICE_SECRET_KEY', {
    devFallback: 'dev_only_feed_secret_CHANGE_ME',
  });
}

const MAC_HEX_LEN = 32; // 128-bit truncation — matches the feed token width.

/** Game ids are UUIDs; enforce that charset so a crafted "id" containing the
 *  MAC's ':' delimiter (or the token's '.' delimiter) can never alias the MAC
 *  input of a different (gameId, ver, iat, ttl) tuple. */
const GAME_ID_RE = /^[A-Za-z0-9-]+$/;

/** Coerce any stored/passed version into a clean non-negative integer. */
function normVersion(version: unknown): number {
  const n = typeof version === 'number' ? version : Number(version);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

/** MAC over (gameId, version, iat, ttl) — distinct "console:" purpose. */
function consoleMac(gameId: string, ver: number, iatSec: number, ttlSec: number): string {
  return crypto
    .createHmac('sha256', consoleSecret())
    .update(`console:${gameId}:${ver}:${iatSec}:${ttlSec}`)
    .digest('hex')
    .slice(0, MAC_HEX_LEN);
}

/** Constant-time compare of two equal-purpose hex strings. */
function safeEqHex(expected: string, actual: string): boolean {
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(actual, 'utf8');
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Default TTL for scorekeeper links: 24 hours. A game is a matchday object —
 * a link handed out at 5pm comfortably covers the whole night (plus a
 * weather-delayed restart) while still guaranteeing every issued link dies on
 * its own even if the operator never taps Revoke.
 */
export const DEFAULT_CONSOLE_TOKEN_TTL_SEC = 24 * 3600;

/** Floor/ceiling for operator-requested TTLs on the mint endpoint. The 7-day
 *  ceiling mirrors MAX_QUERY_TOKEN_TTL_SEC's reasoning: this credential rides
 *  in URLs (links, QR codes, chat apps), so it must be short-lived. */
export const MIN_CONSOLE_TOKEN_TTL_SEC = 300;
export const MAX_CONSOLE_TOKEN_TTL_SEC = 7 * 24 * 3600;

export interface MintConsoleTokenOpts {
  /** Per-game console-token version (Game.consoleTokenVersion). Default 0. */
  version?: number;
  /** TTL in SECONDS — clamped into [MIN, MAX]. Omitted → the 24h default.
   *  There is NO non-expiring console token (see header comment #3). */
  ttlSeconds?: number;
}

/** Mint a console share token: `<gameId>.<ver>.<iat>.<ttl>.<mac>`. */
export function makeConsoleToken(gameId: string, opts: MintConsoleTokenOpts = {}): string {
  if (!gameId || !GAME_ID_RE.test(gameId)) {
    throw new Error('makeConsoleToken: invalid gameId');
  }
  const ver = normVersion(opts.version);
  const requested =
    typeof opts.ttlSeconds === 'number' && Number.isFinite(opts.ttlSeconds) && opts.ttlSeconds > 0
      ? Math.floor(opts.ttlSeconds)
      : DEFAULT_CONSOLE_TOKEN_TTL_SEC;
  const ttlSec = Math.min(
    MAX_CONSOLE_TOKEN_TTL_SEC,
    Math.max(MIN_CONSOLE_TOKEN_TTL_SEC, requested),
  );
  const iatSec = Math.floor(Date.now() / 1000);
  const mac = consoleMac(gameId, ver, iatSec, ttlSec);
  return `${gameId}.${ver}.${iatSec}.${ttlSec}.${mac}`;
}

/**
 * Shape-only parse: the gameId embedded in a console token, or null when the
 * token isn't even console-shaped. NO cryptographic verification — the public
 * controller uses this to key its rate limit and load the game's live version
 * BEFORE the MAC check (same defensive ordering as the feed ingest: a flood
 * of garbage tokens is rejected on shape, before any DB read).
 */
export function parseConsoleTokenGameId(token: unknown): string | null {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 5) return null;
  const [gameId, vStr, iatStr, ttlStr, mac] = parts;
  if (!gameId || !GAME_ID_RE.test(gameId)) return null;
  if (!/^\d+$/.test(vStr) || !/^\d+$/.test(iatStr) || !/^\d+$/.test(ttlStr)) return null;
  if (mac.length !== MAC_HEX_LEN) return null;
  return gameId;
}

/**
 * Verify a console token against a game's CURRENT version.
 *
 * @param gameId         the game the caller resolved (must equal the token's
 *                       embedded id — game-scoping is double-checked here)
 * @param token          the presented token
 * @param currentVersion the game's live Game.consoleTokenVersion (default 0).
 *                       Tokens minted under a DIFFERENT version fail → bumping
 *                       the column revokes every outstanding link.
 *
 * Rejects (regardless of MAC validity): wrong shape, mismatched gameId,
 * version mismatch, ttl <= 0 or over MAX_CONSOLE_TOKEN_TTL_SEC (a
 * non-expiring console credential must never verify — it rides in URLs), and
 * anything past its iat+ttl expiry.
 */
export function verifyConsoleToken(
  gameId: string,
  token: unknown,
  currentVersion: number = 0,
): boolean {
  if (typeof token !== 'string' || !gameId) return false;
  const parts = token.split('.');
  if (parts.length !== 5) return false;
  const [tokGameId, vStr, iatStr, ttlStr, mac] = parts;
  if (tokGameId !== gameId || !GAME_ID_RE.test(tokGameId)) return false;
  if (!/^\d+$/.test(vStr) || !/^\d+$/.test(iatStr) || !/^\d+$/.test(ttlStr)) return false;
  if (mac.length !== MAC_HEX_LEN) return false;

  const tokVer = Number(vStr);
  if (tokVer !== normVersion(currentVersion)) return false;

  const iatSec = Number(iatStr);
  const ttlSec = Number(ttlStr);
  // Always-expiring: ttl 0 (or an over-cap ttl) never verifies, even with a
  // valid MAC — mint can't produce one, and a hand-rolled one is refused.
  if (ttlSec <= 0 || ttlSec > MAX_CONSOLE_TOKEN_TTL_SEC) return false;
  const nowSec = Math.floor(Date.now() / 1000);
  if (nowSec > iatSec + ttlSec) return false;

  return safeEqHex(consoleMac(tokGameId, tokVer, iatSec, ttlSec), mac);
}
