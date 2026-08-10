import * as crypto from 'crypto';
import {
  makeConsoleToken,
  verifyConsoleToken,
  parseConsoleTokenGameId,
  DEFAULT_CONSOLE_TOKEN_TTL_SEC,
  MIN_CONSOLE_TOKEN_TTL_SEC,
  MAX_CONSOLE_TOKEN_TTL_SEC,
} from './sports-console-token';
import { makeFeedToken, verifyFeedToken } from './sports-feed-token';

/**
 * Phase-2 Domain SHARE — the scorekeeper console share token.
 *
 * The purpose-isolation block runs with BOTH families' dedicated secrets
 * UNSET, so console + feed tokens derive from the SAME fallback secret —
 * the worst case for cross-purpose forgery. The distinct "console:" vs
 * "feed:"/"feedv:" MAC inputs (plus the different cleartext shapes) must
 * be the only thing standing between the two families, and it must hold.
 */

const GAME = 'a3d1b2c4-5678-4abc-9def-000000000001';

describe('sports console token', () => {
  beforeEach(() => {
    process.env.SPORTS_CONSOLE_SECRET =
      'test_console_secret_0123456789abcdef0123456789abcdef';
  });

  describe('mint/verify roundtrip', () => {
    it('verifies a freshly-minted token at its version', () => {
      const tok = makeConsoleToken(GAME, { version: 0 });
      expect(verifyConsoleToken(GAME, tok, 0)).toBe(true);
    });

    it('token shape is <gameId>.<ver>.<iat>.<ttl>.<mac32hex>', () => {
      const tok = makeConsoleToken(GAME, { version: 3, ttlSeconds: 3600 });
      const parts = tok.split('.');
      expect(parts).toHaveLength(5);
      expect(parts[0]).toBe(GAME);
      expect(parts[1]).toBe('3');
      expect(Number(parts[2])).toBeGreaterThan(1_000_000_000);
      expect(parts[3]).toBe('3600');
      expect(parts[4]).toMatch(/^[0-9a-f]{32}$/);
    });

    it('is game-scoped — a token for game A never drives game B', () => {
      const other = 'b4e2c3d5-6789-4bcd-8eef-000000000002';
      const tok = makeConsoleToken(GAME, { version: 0 });
      expect(verifyConsoleToken(other, tok, 0)).toBe(false);
    });

    it('refuses to mint for a malformed gameId (delimiter injection)', () => {
      expect(() => makeConsoleToken('evil.id')).toThrow();
      expect(() => makeConsoleToken('evil:id')).toThrow();
      expect(() => makeConsoleToken('')).toThrow();
    });
  });

  describe('revocation — version bump kills every outstanding link', () => {
    it('a v0 token fails once the game is bumped to v1', () => {
      const tok = makeConsoleToken(GAME, { version: 0 });
      expect(verifyConsoleToken(GAME, tok, 0)).toBe(true);
      expect(verifyConsoleToken(GAME, tok, 1)).toBe(false);
    });

    it('a token minted AHEAD of the live version also fails', () => {
      const tok = makeConsoleToken(GAME, { version: 5 });
      expect(verifyConsoleToken(GAME, tok, 4)).toBe(false);
    });
  });

  describe('always-expiring posture', () => {
    it('expires: a token past iat+ttl fails even with a live version', () => {
      const nowSec = Math.floor(Date.now() / 1000);
      // Hand-build a genuinely-signed token issued 2h ago with a 1h ttl —
      // mint clamps can't produce a pre-expired token.
      const iat = nowSec - 7200;
      const ttl = 3600;
      const mac = crypto
        .createHmac('sha256', process.env.SPORTS_CONSOLE_SECRET as string)
        .update(`console:${GAME}:0:${iat}:${ttl}`)
        .digest('hex')
        .slice(0, 32);
      const expired = `${GAME}.0.${iat}.${ttl}.${mac}`;
      expect(verifyConsoleToken(GAME, expired, 0)).toBe(false);
      // Sanity: the same construction with a still-live window verifies —
      // the rejection above is expiry, not a bad hand-rolled MAC.
      const freshIat = nowSec - 60;
      const freshMac = crypto
        .createHmac('sha256', process.env.SPORTS_CONSOLE_SECRET as string)
        .update(`console:${GAME}:0:${freshIat}:${ttl}`)
        .digest('hex')
        .slice(0, 32);
      expect(verifyConsoleToken(GAME, `${GAME}.0.${freshIat}.${ttl}.${freshMac}`, 0)).toBe(true);
    });

    it('a ttl of 0 never verifies, even with a valid MAC', () => {
      const iat = Math.floor(Date.now() / 1000);
      const mac = crypto
        .createHmac('sha256', process.env.SPORTS_CONSOLE_SECRET as string)
        .update(`console:${GAME}:0:${iat}:0`)
        .digest('hex')
        .slice(0, 32);
      expect(verifyConsoleToken(GAME, `${GAME}.0.${iat}.0.${mac}`, 0)).toBe(false);
    });

    it('an over-cap ttl never verifies, even with a valid MAC', () => {
      const iat = Math.floor(Date.now() / 1000);
      const ttl = MAX_CONSOLE_TOKEN_TTL_SEC + 1;
      const mac = crypto
        .createHmac('sha256', process.env.SPORTS_CONSOLE_SECRET as string)
        .update(`console:${GAME}:0:${iat}:${ttl}`)
        .digest('hex')
        .slice(0, 32);
      expect(verifyConsoleToken(GAME, `${GAME}.0.${iat}.${ttl}.${mac}`, 0)).toBe(false);
    });

    it('mint clamps ttl into [MIN, MAX] and defaults to 24h', () => {
      expect(Number(makeConsoleToken(GAME, { ttlSeconds: 1 }).split('.')[3])).toBe(
        MIN_CONSOLE_TOKEN_TTL_SEC,
      );
      expect(
        Number(makeConsoleToken(GAME, { ttlSeconds: 999_999_999 }).split('.')[3]),
      ).toBe(MAX_CONSOLE_TOKEN_TTL_SEC);
      expect(Number(makeConsoleToken(GAME).split('.')[3])).toBe(DEFAULT_CONSOLE_TOKEN_TTL_SEC);
    });
  });

  describe('tamper refusal — every cleartext field is inside the MAC', () => {
    it('rejects any single-field edit', () => {
      const tok = makeConsoleToken(GAME, { version: 2, ttlSeconds: 3600 });
      const [gid, ver, iat, ttl, mac] = tok.split('.');
      const other = 'b4e2c3d5-6789-4bcd-8eef-000000000002';
      // Retarget the game.
      expect(verifyConsoleToken(other, [other, ver, iat, ttl, mac].join('.'), 2)).toBe(false);
      // Dodge revocation by rewriting the version.
      expect(verifyConsoleToken(GAME, [gid, '3', iat, ttl, mac].join('.'), 3)).toBe(false);
      // Extend life by rewriting iat or ttl.
      expect(
        verifyConsoleToken(GAME, [gid, ver, String(Number(iat) + 9999), ttl, mac].join('.'), 2),
      ).toBe(false);
      expect(verifyConsoleToken(GAME, [gid, ver, iat, '604800', mac].join('.'), 2)).toBe(false);
      // Flip one MAC nibble.
      const flipped = (mac[0] === 'a' ? 'b' : 'a') + mac.slice(1);
      expect(verifyConsoleToken(GAME, [gid, ver, iat, ttl, flipped].join('.'), 2)).toBe(false);
    });

    it('rejects malformed shapes outright', () => {
      expect(verifyConsoleToken(GAME, '', 0)).toBe(false);
      expect(verifyConsoleToken(GAME, null, 0)).toBe(false);
      expect(verifyConsoleToken(GAME, 'not-a-token', 0)).toBe(false);
      expect(verifyConsoleToken(GAME, `${GAME}.0.1.2`, 0)).toBe(false); // 4 parts
      expect(verifyConsoleToken(GAME, `${GAME}.x.1.2.${'0'.repeat(32)}`, 0)).toBe(false);
      expect(verifyConsoleToken(GAME, `${GAME}.0.1.2.${'0'.repeat(31)}`, 0)).toBe(false);
    });
  });

  describe('purpose isolation vs the feed-token family (SHARED secret)', () => {
    // The hostile configuration: no dedicated secrets, both families
    // derive from the same DEV fallback. Only the MAC purpose strings
    // (and shapes) separate them.
    beforeEach(() => {
      delete process.env.SPORTS_CONSOLE_SECRET;
      delete process.env.SPORTS_FEED_SECRET;
      delete process.env.DEVICE_SECRET_KEY;
    });
    afterEach(() => {
      process.env.SPORTS_CONSOLE_SECRET =
        'test_console_secret_0123456789abcdef0123456789abcdef';
      process.env.SPORTS_FEED_SECRET =
        'test_feed_secret_0123456789abcdef0123456789abcdef';
    });

    it('a console token is NEVER accepted as a feed token', () => {
      const consoleTok = makeConsoleToken(GAME, { version: 0, ttlSeconds: 3600 });
      expect(verifyConsoleToken(GAME, consoleTok, 0)).toBe(true);
      expect(verifyFeedToken(GAME, consoleTok, 0)).toBe(false);
    });

    it('feed tokens (bare AND structured) are NEVER accepted as console tokens', () => {
      const bare = makeFeedToken(GAME); // 32-hex legacy
      const structured = makeFeedToken(GAME, { version: 0, ttlSeconds: 3600 }); // 4-part
      expect(verifyFeedToken(GAME, bare, 0)).toBe(true);
      expect(verifyFeedToken(GAME, structured, 0)).toBe(true);
      expect(verifyConsoleToken(GAME, bare, 0)).toBe(false);
      expect(verifyConsoleToken(GAME, structured, 0)).toBe(false);
    });

    it('a console-SHAPED forgery signed with the feed purpose string fails', () => {
      // Attacker knows the (shared) secret derives both families and tries
      // to smuggle a feed-purpose MAC into the console's 5-part shape.
      const secret = 'dev_only_feed_secret_CHANGE_ME'; // the shared dev fallback
      const iat = Math.floor(Date.now() / 1000);
      const feedPurposeMac = crypto
        .createHmac('sha256', secret)
        .update(`feedv:${GAME}:0:${iat}:3600`)
        .digest('hex')
        .slice(0, 32);
      const forged = `${GAME}.0.${iat}.3600.${feedPurposeMac}`;
      expect(verifyConsoleToken(GAME, forged, 0)).toBe(false);
      // Control: the same shape with the CONSOLE purpose string verifies —
      // proving the rejection above is the purpose prefix, nothing else.
      const consolePurposeMac = crypto
        .createHmac('sha256', secret)
        .update(`console:${GAME}:0:${iat}:3600`)
        .digest('hex')
        .slice(0, 32);
      expect(verifyConsoleToken(GAME, `${GAME}.0.${iat}.3600.${consolePurposeMac}`, 0)).toBe(true);
    });
  });

  describe('parseConsoleTokenGameId (shape-only, pre-auth)', () => {
    it('extracts the embedded gameId from a well-shaped token', () => {
      expect(parseConsoleTokenGameId(makeConsoleToken(GAME))).toBe(GAME);
    });

    it('returns null for anything not console-shaped', () => {
      expect(parseConsoleTokenGameId(null)).toBeNull();
      expect(parseConsoleTokenGameId('')).toBeNull();
      expect(parseConsoleTokenGameId(makeFeedToken(GAME))).toBeNull(); // bare
      expect(
        parseConsoleTokenGameId(makeFeedToken(GAME, { version: 1, ttlSeconds: 60 })),
      ).toBeNull(); // 4-part structured
      expect(parseConsoleTokenGameId(`${GAME}.x.1.2.${'0'.repeat(32)}`)).toBeNull();
      expect(parseConsoleTokenGameId(`bad:id.0.1.2.${'0'.repeat(32)}`)).toBeNull();
    });
  });
});
