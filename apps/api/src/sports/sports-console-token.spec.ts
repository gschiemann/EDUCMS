import * as crypto from 'crypto';
import {
  makeConsoleToken,
  verifyConsoleToken,
  verifyConsoleTokenScope,
  CONSOLE_SCOPES,
  CONSOLE_SCOPE_ALLOWS,
  consoleScopeOffered,
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

  // K12-F34 — a link is minted for one job; the scope is the permission.
  describe('scopes', () => {
    it('each scope round-trips, in the SAME five-part shape every client already parses', () => {
      for (const scope of CONSOLE_SCOPES) {
        const tok = makeConsoleToken(GAME, { version: 2, scope });
        expect(tok.split('.')).toHaveLength(5);
        expect(parseConsoleTokenGameId(tok)).toBe(GAME);
        expect(verifyConsoleTokenScope(GAME, tok, 2)).toBe(scope);
        expect(verifyConsoleToken(GAME, tok, 2)).toBe(true);
      }
    });

    it('a link minted before scopes existed (no scope) verifies as full', () => {
      const tok = makeConsoleToken(GAME, { version: 0 });
      expect(verifyConsoleTokenScope(GAME, tok, 0)).toBe('full');
    });

    it('the scope is inside the MAC: no cleartext edit turns a scorer link into anything else', () => {
      const tok = makeConsoleToken(GAME, { version: 0, scope: 'scorer' });
      const [g, v, iat, ttl, mac] = tok.split('.');
      // Hand-rolled "full" MAC for the same fields needs the secret.
      const forged = crypto
        .createHmac('sha256', 'not-the-secret')
        .update(`console:${g}:${v}:${iat}:${ttl}`)
        .digest('hex')
        .slice(0, 32);
      expect(verifyConsoleTokenScope(GAME, `${g}.${v}.${iat}.${ttl}.${forged}`, 0)).toBeNull();
      // Flipping one MAC character never lands on another scope.
      const flipped = mac.slice(0, -1) + (mac.endsWith('0') ? '1' : '0');
      expect(verifyConsoleTokenScope(GAME, `${g}.${v}.${iat}.${ttl}.${flipped}`, 0)).toBeNull();
    });

    it('revocation, expiry and game binding apply to every scope', () => {
      const tok = makeConsoleToken(GAME, { version: 1, scope: 'timer' });
      expect(verifyConsoleTokenScope(GAME, tok, 2)).toBeNull();
      expect(verifyConsoleTokenScope('a3d1b2c4-5678-4abc-9def-000000000002', tok, 1)).toBeNull();
      const realNow = Date.now;
      Date.now = () => realNow() + (DEFAULT_CONSOLE_TOKEN_TTL_SEC + 5) * 1000;
      try {
        expect(verifyConsoleTokenScope(GAME, tok, 1)).toBeNull();
      } finally {
        Date.now = realNow;
      }
    });

    it('the allow table (@cms/api-types): full is the frozen original five; the volunteer duties ride only on newer scopes', () => {
      expect([...CONSOLE_SCOPES]).toEqual(['full', 'table', 'scorer', 'timer', 'shot', 'presentation']);
      expect([...CONSOLE_SCOPE_ALLOWS.full].sort()).toEqual(['clock', 'cue', 'score', 'segment', 'timeout']);
      expect([...CONSOLE_SCOPE_ALLOWS.table].sort()).toEqual(
        ['clock', 'cue', 'penalties', 'playClock', 'possession', 'score', 'segment', 'shotClock', 'stats', 'timeout'],
      );
      expect([...CONSOLE_SCOPE_ALLOWS.scorer].sort()).toEqual(
        ['cue', 'penalties', 'possession', 'score', 'stats', 'timeout'],
      );
      expect([...CONSOLE_SCOPE_ALLOWS.timer].sort()).toEqual(['clock', 'segment', 'timeout']);
      expect([...CONSOLE_SCOPE_ALLOWS.shot].sort()).toEqual(['playClock', 'shotClock']);
      expect([...CONSOLE_SCOPE_ALLOWS.presentation]).toEqual(['cue']);
    });

    it('every scope is bound into the MAC with its own input; a MAC for one scope never verifies as another', () => {
      const secret = process.env.SPORTS_CONSOLE_SECRET as string;
      const iat = Math.floor(Date.now() / 1000);
      const macFor = (input: string) =>
        crypto.createHmac('sha256', secret).update(input).digest('hex').slice(0, 32);
      const base = `console:${GAME}:0:${iat}:3600`;
      // Positive control: the documented inputs verify as exactly their scope.
      expect(verifyConsoleTokenScope(GAME, `${GAME}.0.${iat}.3600.${macFor(base)}`, 0)).toBe('full');
      for (const scope of CONSOLE_SCOPES.filter((s) => s !== 'full')) {
        expect(verifyConsoleTokenScope(GAME, `${GAME}.0.${iat}.3600.${macFor(`${base}:${scope}`)}`, 0)).toBe(scope);
      }
      // A scope name outside the table, signed with the REAL secret, is nothing.
      for (const bogus of ['admin', 'status', 'table ', 'TABLE', 'full']) {
        expect(verifyConsoleTokenScope(GAME, `${GAME}.0.${iat}.3600.${macFor(`${base}:${bogus}`)}`, 0)).toBeNull();
      }
      // The retired lane-B1 prototype (a readable role in a 6-part token under
      // a "console-role:" purpose) never verifies and never even parses.
      const b1Mac = macFor(`console-role:${GAME}:0:${iat}:3600:table`);
      expect(verifyConsoleTokenScope(GAME, `${GAME}.0.${iat}.3600.${b1Mac}`, 0)).toBeNull();
      expect(verifyConsoleTokenScope(GAME, `${GAME}.0.${iat}.3600.table.${b1Mac}`, 0)).toBeNull();
      expect(parseConsoleTokenGameId(`${GAME}.0.${iat}.3600.table.${b1Mac}`)).toBeNull();
    });

    it('a scope cannot be added to a token as text: a 6th field is refused outright', () => {
      const tok = makeConsoleToken(GAME, { version: 0, scope: 'timer' });
      const parts = tok.split('.');
      for (const scope of ['table', 'scorer', 'full']) {
        const relabelled = [...parts.slice(0, 4), scope, parts[4]].join('.');
        expect(verifyConsoleTokenScope(GAME, relabelled, 0)).toBeNull();
        expect(parseConsoleTokenGameId(relabelled)).toBeNull();
      }
    });

    it('verification compares EVERY scope in constant time — no early exit, whichever scope (if any) matches', () => {
      // Spy on the node module object itself (the `import * as` namespace
      // binding is a read-only getter; the token module reads through it).
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const nodeCrypto = require('crypto') as typeof import('crypto');
      const spy = jest.spyOn(nodeCrypto, 'timingSafeEqual');
      try {
        for (const tok of [
          makeConsoleToken(GAME, { version: 0 }), // full — the FIRST scope tried
          makeConsoleToken(GAME, { version: 0, scope: 'presentation' }), // the last
          (() => {
            const p = makeConsoleToken(GAME, { version: 0 }).split('.');
            p[4] = (p[4][0] === 'a' ? 'b' : 'a') + p[4].slice(1);
            return p.join('.');
          })(), // no scope at all
        ]) {
          spy.mockClear();
          verifyConsoleTokenScope(GAME, tok, 0);
          expect(spy).toHaveBeenCalledTimes(CONSOLE_SCOPES.length);
        }
      } finally {
        spy.mockRestore();
      }
    });

    it('consoleScopeOffered follows the sport: full always, no clock operator for volleyball, no shot link for soccer', () => {
      expect(consoleScopeOffered('full', 'volleyball')).toBe(true);
      expect(consoleScopeOffered('timer', 'basketball')).toBe(true);
      expect(consoleScopeOffered('shot', 'basketball')).toBe(true);
      expect(consoleScopeOffered('shot', 'football')).toBe(true);
      expect(consoleScopeOffered('table', 'soccer')).toBe(true);
      expect(consoleScopeOffered('timer', 'volleyball')).toBe(false);
      expect(consoleScopeOffered('shot', 'soccer')).toBe(false);
      expect(consoleScopeOffered('scorer', 'no-such-sport')).toBe(false);
      expect(consoleScopeOffered('full', 'no-such-sport')).toBe(true);
    });
  });
});
