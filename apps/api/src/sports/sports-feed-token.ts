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
 * Token = HMAC-SHA256("feed:<gameId>", SPORTS_FEED_SECRET) truncated to 32 hex.
 *  - Unguessable (keyed HMAC) and game-scoped (a token for game A can't drive
 *    game B — the gameId is in the MAC input).
 *  - Stateless → no DB table, no migration, no boot risk.
 *  - Secret: a dedicated SPORTS_FEED_SECRET if set, else DEVICE_SECRET_KEY
 *    (always present in prod via required-secret boot validation). Rotating the
 *    secret is the global kill-switch; per-game revocation is a later add (it
 *    needs a stored per-game version, i.e. a migration we deliberately avoid
 *    here). Low stakes: a leaked token only lets someone push scores to ONE
 *    transient game; the ingest service clamps all values to safe ranges.
 */

function feedSecret(): string {
  // A dedicated SPORTS_FEED_SECRET wins if set. Otherwise fall back to
  // DEVICE_SECRET_KEY via requireSecret, which THROWS in production when it
  // is missing/empty (boot-validated anyway) and only yields a loud DEV-only
  // fallback outside prod. 2026-05-29 (Audit 34-supplychain P3): the prior
  // `||'dev_only_feed_secret_CHANGE_ME'` literal was NODE_ENV-ungated — dead
  // in prod only by transitive boot-gate luck. Now it's explicit + consistent
  // with the other secret call-sites.
  const dedicated = process.env.SPORTS_FEED_SECRET;
  if (dedicated && dedicated.trim().length >= 16) return dedicated;
  return requireSecret('DEVICE_SECRET_KEY', {
    devFallback: 'dev_only_feed_secret_CHANGE_ME',
  });
}

export function makeFeedToken(gameId: string): string {
  return crypto
    .createHmac('sha256', feedSecret())
    .update(`feed:${gameId}`)
    .digest('hex')
    .slice(0, 32);
}

export function verifyFeedToken(gameId: string, token: unknown): boolean {
  if (typeof token !== 'string' || token.length !== 32 || !gameId) return false;
  const expected = makeFeedToken(gameId);
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(token, 'utf8');
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
