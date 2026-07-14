import * as crypto from 'crypto';
import { requireSecret } from '../security/required-secret';

/**
 * Stateless, game-scoped feed token for EXTERNAL score ingestion.
 *
 * Closes the "two clocks" credibility gap: lets a Sportzcast/Scorebird box, a
 * console-reader bridge, or any custom integration push live score/clock to a
 * game machine-to-machine — WITHOUT a dashboard login (the guarded
 * /sports/games/:id/ingest needs an admin session, which a feed box can't
 * have). The operator copies a feed URL + token from the console and hands it
 * to their feed vendor.
 *
 * ── Token shapes (verify accepts BOTH) ─────────────────────────
 *   1. BARE (legacy + version 0, non-expiring):
 *        `HMAC-SHA256("feed:<gameId>", SECRET)` truncated to 32 hex.
 *      Byte-for-byte the ORIGINAL token format — every token already handed
 *      to a feed vendor keeps verifying unchanged. A fresh Game starts at
 *      feedTokenVersion 0, and v0 deliberately reuses the legacy
 *      "feed:<id>" MAC input (NOT "feed:<id>:v0"), so the HMAC is identical.
 *      DO NO HARM to the live bridge.
 *
 *   2. STRUCTURED (versioned and/or expiring):
 *        `<ver>.<iatSec>.<ttlSec>.<mac>` where mac =
 *        HMAC-SHA256("feedv:<gameId>:<ver>:<iatSec>:<ttlSec>", SECRET)[:32].
 *      - `ver`  — integer ≥ 0; folds the per-game feedTokenVersion into the
 *                 MAC so incrementing Game.feedTokenVersion REVOKES every
 *                 outstanding token for that game (the token's baked-in ver no
 *                 longer matches the live ver passed to verify).
 *      - `ttl`  — 0 means non-expiring; >0 is seconds-from-iat after which
 *                 verify rejects the token.
 *      The structured MAC uses a DISTINCT "feedv:" prefix so a structured
 *      token can never collide with / be replayed as a bare token, and the
 *      version + iat + ttl are all inside the MAC (an attacker can't edit the
 *      cleartext ver/ttl to dodge revocation or expiry).
 *
 * Properties:
 *  - Unguessable (keyed HMAC) and game-scoped (a token for game A can't drive
 *    game B — the gameId is in the MAC input).
 *  - Revocable per-game via Game.feedTokenVersion (a stored counter; see the
 *    additive migration). Optionally time-boxed via the embedded iat+ttl.
 *  - Still essentially stateless at verify-time: the ONLY state is the small
 *    integer version, read off the game row the controller already loads.
 *  - Secret: a dedicated SPORTS_FEED_SECRET if set, else DEVICE_SECRET_KEY
 *    (always present in prod via required-secret boot validation). Rotating the
 *    secret remains the GLOBAL kill-switch; bumping feedTokenVersion is the
 *    PER-GAME kill-switch.
 */

// One-shot advisory flags so a busy feed (~5 Hz CTS snapshots) can't
// turn boot advisories into log spam.
let warnedNoDedicatedSecret = false;
let warnedShortDedicatedSecret = false;

function feedSecret(): string {
  // A dedicated SPORTS_FEED_SECRET wins if set. Otherwise fall back to
  // DEVICE_SECRET_KEY via requireSecret, which THROWS in production when it
  // is missing/empty (boot-validated anyway) and only yields a loud DEV-only
  // fallback outside prod. 2026-05-29 (Audit 34-supplychain P3): the prior
  // `||'dev_only_feed_secret_CHANGE_ME'` literal was NODE_ENV-ungated — dead
  // in prod only by transitive boot-gate luck. Now it's explicit + consistent
  // with the other secret call-sites.
  const dedicated = process.env.SPORTS_FEED_SECRET;
  if (dedicated && dedicated.trim().length >= 16) {
    if (dedicated.trim().length < 64 && !warnedShortDedicatedSecret) {
      warnedShortDedicatedSecret = true;
      console.warn(
        '[sports-feed-token] SPORTS_FEED_SECRET is set but shorter than 64 chars. ' +
          'Generate a full-strength value: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
      );
    }
    return dedicated;
  }
  // 2026-07-13 (audit W0-01.3): sharing DEVICE_SECRET_KEY couples the sports
  // feed to the key that also signs WS/Redis control traffic and wraps
  // BYOK/MFA/streaming credentials — a leaked feed credential becomes a
  // platform-wide incident. Production must run a DEDICATED key. We warn
  // loudly instead of refusing to boot so a deploy that predates the Railway
  // env change cannot take the emergency path down; the rotation runbook
  // (docs/research/2026-07-12-world-class-fullapp-audit/, Part II.F) flips
  // this env var and then this warning goes silent.
  if (process.env.NODE_ENV === 'production' && !warnedNoDedicatedSecret) {
    warnedNoDedicatedSecret = true;
    console.error(
      '[sports-feed-token] ACTION REQUIRED: SPORTS_FEED_SECRET is not set in production. ' +
        'Feed tokens are deriving from DEVICE_SECRET_KEY (shared blast radius). ' +
        'Set a dedicated 64-hex SPORTS_FEED_SECRET in the API environment — see the W0-01 rotation runbook.',
    );
  }
  return requireSecret('DEVICE_SECRET_KEY', {
    devFallback: 'dev_only_feed_secret_CHANGE_ME',
  });
}

const MAC_HEX_LEN = 32; // 128-bit truncation — matches the original token width.

/** Coerce any stored/passed version into a clean non-negative integer. */
function normVersion(version: unknown): number {
  const n = typeof version === 'number' ? version : Number(version);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

/** Bare legacy/v0 MAC — `HMAC("feed:<id>")`. Unchanged from the original. */
function bareMac(gameId: string): string {
  return crypto
    .createHmac('sha256', feedSecret())
    .update(`feed:${gameId}`)
    .digest('hex')
    .slice(0, MAC_HEX_LEN);
}

/** Structured MAC over (gameId, version, iat, ttl) — distinct "feedv:" prefix. */
function structuredMac(gameId: string, ver: number, iatSec: number, ttlSec: number): string {
  return crypto
    .createHmac('sha256', feedSecret())
    .update(`feedv:${gameId}:${ver}:${iatSec}:${ttlSec}`)
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

export interface MintFeedTokenOpts {
  /** Per-game feed-token version (Game.feedTokenVersion). Defaults to 0. */
  version?: number;
  /**
   * Time-to-live in SECONDS. Omit or 0 → non-expiring. When set (>0), a
   * STRUCTURED token is minted that verify rejects after iat+ttl.
   */
  ttlSeconds?: number;
}

/**
 * Mint a feed token for a game.
 *
 * - `makeFeedToken(id)` with NO opts (or version 0 + no ttl) returns the BARE
 *   legacy token, byte-for-byte identical to the pre-revocation token. So a
 *   game that has never been revoked keeps minting the exact same token a
 *   vendor may already hold — re-copying credentials is a no-op, not a break.
 * - Any version ≥ 1 OR any ttl > 0 produces a STRUCTURED token.
 */
export function makeFeedToken(gameId: string, opts: MintFeedTokenOpts = {}): string {
  const ver = normVersion(opts.version);
  const ttlSec =
    typeof opts.ttlSeconds === 'number' && Number.isFinite(opts.ttlSeconds) && opts.ttlSeconds > 0
      ? Math.floor(opts.ttlSeconds)
      : 0;

  // Backward-compatible fast path: version 0 + no expiry == the original token.
  if (ver === 0 && ttlSec === 0) {
    return bareMac(gameId);
  }

  const iatSec = Math.floor(Date.now() / 1000);
  const mac = structuredMac(gameId, ver, iatSec, ttlSec);
  return `${ver}.${iatSec}.${ttlSec}.${mac}`;
}

/**
 * Verify a feed token against a game's CURRENT version.
 *
 * @param gameId         the game the token must be scoped to
 * @param token          the presented token (bare or structured)
 * @param currentVersion the game's live Game.feedTokenVersion (default 0).
 *                       Tokens minted under a DIFFERENT version fail → bumping
 *                       the column revokes every outstanding token for the game.
 *
 * Accepts BOTH shapes:
 *   - A bare 32-hex token verifies ONLY when currentVersion is 0 (i.e. the game
 *     has never been revoked). Once the game is bumped to v≥1, the original
 *     bare token no longer verifies — that is the revocation.
 *   - A structured token verifies when its embedded version matches
 *     currentVersion, its MAC is valid, and (if ttl>0) it has not expired.
 */
export function verifyFeedToken(
  gameId: string,
  token: unknown,
  currentVersion: number = 0,
): boolean {
  if (typeof token !== 'string' || !gameId) return false;
  const ver = normVersion(currentVersion);

  // ── Structured token: "<ver>.<iat>.<ttl>.<mac>" ──
  if (token.includes('.')) {
    const parts = token.split('.');
    if (parts.length !== 4) return false;
    const [vStr, iatStr, ttlStr, mac] = parts;
    if (!/^\d+$/.test(vStr) || !/^\d+$/.test(iatStr) || !/^\d+$/.test(ttlStr)) return false;
    if (mac.length !== MAC_HEX_LEN) return false;

    const tokVer = Number(vStr);
    // The token's version must match the game's CURRENT version. A token
    // minted before a revocation (lower ver) — or somehow ahead of it — fails.
    if (tokVer !== ver) return false;

    const iatSec = Number(iatStr);
    const ttlSec = Number(ttlStr);
    if (ttlSec > 0) {
      const nowSec = Math.floor(Date.now() / 1000);
      if (nowSec > iatSec + ttlSec) return false;
    }

    return safeEqHex(structuredMac(gameId, tokVer, iatSec, ttlSec), mac);
  }

  // ── Bare legacy/v0 token: 32 hex, non-expiring ──
  // Only honored while the game is still at version 0. After a revocation
  // (version ≥ 1) the legacy token is dead and the operator must re-copy the
  // freshly-minted (structured) token.
  if (token.length !== MAC_HEX_LEN) return false;
  if (ver !== 0) return false;
  return safeEqHex(bareMac(gameId), token);
}

/**
 * Default TTL for tokens minted by the feed-credentials / revoke endpoints:
 * 30 days. Feed tokens are per-GAME, and a game is a matchday object — a
 * 30-day structured token comfortably covers any tournament while still
 * guaranteeing every issued credential dies on its own. (Audit W0-01.5 —
 * "stop returning non-expiring reusable bearer material".)
 */
export const DEFAULT_FEED_TOKEN_TTL_SEC = 30 * 24 * 3600;

/** Floor/ceiling for operator-requested TTLs on the credentials endpoint. */
export const MIN_FEED_TOKEN_TTL_SEC = 300;
export const MAX_FEED_TOKEN_TTL_SEC = DEFAULT_FEED_TOKEN_TTL_SEC;

/**
 * Cap for tokens presented in the `?token=` QUERY parameter: 7 days.
 *
 * Query strings leak into proxy/CDN/WAF access logs, browser history, and
 * Referer headers — so a URL-carried credential must be short-lived. The
 * header path (`x-feed-token`) has no such cap. 7 days covers a tournament
 * week for the URL-only CTS-adapter boxes that can't set headers.
 * (Audit W0-01.4 — "remove query-string feed authentication": long-lived and
 * legacy bare tokens are now header-only; the query path only accepts
 * short-lived structured tokens.)
 */
export const MAX_QUERY_TOKEN_TTL_SEC = 7 * 24 * 3600;

/**
 * Verify a token presented via the `?token=` QUERY parameter.
 *
 * Stricter than `verifyFeedToken`: bare legacy tokens and structured tokens
 * without an expiry (ttl 0) or with a ttl over MAX_QUERY_TOKEN_TTL_SEC are
 * REJECTED regardless of MAC validity — non-expiring credentials must never
 * ride in URLs. Everything that passes the shape gate goes through the same
 * constant-time MAC + version + expiry verification as the header path.
 */
export function verifyFeedTokenFromQuery(
  gameId: string,
  token: unknown,
  currentVersion: number = 0,
): boolean {
  if (typeof token !== 'string' || !gameId) return false;
  const parts = token.split('.');
  if (parts.length !== 4) return false; // bare tokens: header-only
  if (!/^\d+$/.test(parts[2])) return false;
  const ttlSec = Number(parts[2]);
  if (ttlSec <= 0 || ttlSec > MAX_QUERY_TOKEN_TTL_SEC) return false;
  return verifyFeedToken(gameId, token, currentVersion);
}
