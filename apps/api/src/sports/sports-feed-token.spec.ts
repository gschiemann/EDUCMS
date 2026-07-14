import {
  makeFeedToken,
  verifyFeedToken,
  verifyFeedTokenFromQuery,
  MAX_QUERY_TOKEN_TTL_SEC,
  DEFAULT_FEED_TOKEN_TTL_SEC,
} from './sports-feed-token';

// A dedicated feed secret so these tests never depend on DEVICE_SECRET_KEY.
beforeAll(() => {
  process.env.SPORTS_FEED_SECRET =
    'test_feed_secret_0123456789abcdef0123456789abcdef';
});

describe('sports feed token', () => {
  const gameId = 'game-abc';

  describe('header path (verifyFeedToken) — accepts every valid shape', () => {
    it('verifies a legacy bare v0 token', () => {
      const bare = makeFeedToken(gameId); // no opts → bare, non-expiring
      expect(verifyFeedToken(gameId, bare, 0)).toBe(true);
    });

    it('rejects a bare token once the game is revoked (version bumped)', () => {
      const bare = makeFeedToken(gameId);
      expect(verifyFeedToken(gameId, bare, 1)).toBe(false);
    });

    it('verifies a structured TTL token before expiry', () => {
      const tok = makeFeedToken(gameId, { version: 2, ttlSeconds: 3600 });
      expect(verifyFeedToken(gameId, tok, 2)).toBe(true);
    });

    it('rejects a structured token after its TTL', () => {
      const nowSec = Math.floor(Date.now() / 1000);
      // ttl 10s, issued 20s ago → expired.
      const expired = `3.${nowSec - 20}.10.${'0'.repeat(32)}`;
      expect(verifyFeedToken(gameId, expired, 3)).toBe(false);
    });

    it('is game-scoped — a token for game A cannot drive game B', () => {
      const tok = makeFeedToken('game-A', { ttlSeconds: 3600 });
      expect(verifyFeedToken('game-B', tok, 0)).toBe(false);
    });
  });

  describe('query path (verifyFeedTokenFromQuery) — short-lived structured only', () => {
    it('REJECTS a legacy bare token in the query string', () => {
      const bare = makeFeedToken(gameId);
      // Valid on the header path…
      expect(verifyFeedToken(gameId, bare, 0)).toBe(true);
      // …but never accepted via ?token= (non-expiring bearer in a URL).
      expect(verifyFeedTokenFromQuery(gameId, bare, 0)).toBe(false);
    });

    it('REJECTS a non-expiring structured token (ttl 0) in the query string', () => {
      // A structured token with ttl 0 is non-expiring — query must refuse it.
      const nowSec = Math.floor(Date.now() / 1000);
      const tok = makeFeedToken(gameId, { version: 1 }); // ver≥1, ttl 0 → structured, non-expiring
      expect(tok.split('.')[2]).toBe('0'); // ttl field is 0
      expect(verifyFeedTokenFromQuery(gameId, tok, 1)).toBe(false);
      void nowSec;
    });

    it('REJECTS a structured token whose TTL exceeds the 7-day query cap', () => {
      const tooLong = makeFeedToken(gameId, {
        version: 1,
        ttlSeconds: MAX_QUERY_TOKEN_TTL_SEC + 3600,
      });
      expect(verifyFeedTokenFromQuery(gameId, tooLong, 1)).toBe(false);
    });

    it('ACCEPTS a short-lived structured token within the cap', () => {
      const ok = makeFeedToken(gameId, { version: 1, ttlSeconds: 3600 });
      expect(verifyFeedTokenFromQuery(gameId, ok, 1)).toBe(true);
    });

    it('the 30-day default credential token is REJECTED in the query (over cap)', () => {
      // The feed-credentials endpoint mints DEFAULT_FEED_TOKEN_TTL_SEC (30d);
      // that is header-only and must not be pasted into a URL.
      expect(DEFAULT_FEED_TOKEN_TTL_SEC).toBeGreaterThan(MAX_QUERY_TOKEN_TTL_SEC);
      const cred = makeFeedToken(gameId, {
        version: 0,
        ttlSeconds: DEFAULT_FEED_TOKEN_TTL_SEC,
      });
      expect(verifyFeedTokenFromQuery(gameId, cred, 0)).toBe(false);
      expect(verifyFeedToken(gameId, cred, 0)).toBe(true); // …but fine in the header
    });
  });
});
