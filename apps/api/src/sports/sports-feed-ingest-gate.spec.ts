/**
 * Feed-ingest rate buckets: the per-GAME bucket counts only requests whose
 * token is valid; invalid-token attempts are counted in a separate per-IP
 * bucket. So a stream of bad tokens can neither use up a game's ingest
 * budget nor go on indefinitely from one address.
 */
import { HttpStatus } from '@nestjs/common';
import { SportsBoardController } from './sports-board.controller';
import { makeFeedToken } from './sports-feed-token';
import { _resetIngestRateLimitMemoryForTests } from '../security/ingest-rate-limit';

const GAME = 'game-1';
const OLD_ENV = { ...process.env };

function build() {
  const sports = {
    getFeedTokenVersion: jest.fn(async () => 0),
    ingestFeedPacket: jest.fn(async () => ({ accepted: true, game: { id: GAME } })),
    ingestCtsSnapshot: jest.fn(async () => ({ ok: true })),
    ingestSwimTimingSnapshot: jest.fn(async () => ({ ok: true })),
  };
  const ctl = new SportsBoardController(sports as any, { publisher: null } as any, {} as any);
  return { ctl, sports };
}

const reqFrom = (ip: string) => ({ ip, headers: {}, socket: { remoteAddress: ip } }) as any;

beforeEach(() => {
  process.env.SPORTS_FEED_SECRET = 'f'.repeat(64);
  _resetIngestRateLimitMemoryForTests();
});
afterEach(() => {
  process.env = { ...OLD_ENV };
});

describe('feed ingest buckets', () => {
  it('invalid tokens do not consume the game budget', async () => {
    const { ctl } = build();
    const good = makeFeedToken(GAME);
    // Far more bad attempts than the per-game budget (40/10s), each from a
    // different address so the per-IP bucket never trips.
    for (let i = 0; i < 60; i++) {
      await expect(ctl.feed(GAME, 'bad-token', undefined, {}, reqFrom(`198.51.100.${i}`))).rejects.toMatchObject({
        status: HttpStatus.UNAUTHORIZED,
      });
    }
    await expect(ctl.feed(GAME, good, undefined, { homeScore: 1 }, reqFrom('203.0.113.1'))).resolves.toMatchObject({
      ok: true,
    });
  });

  it('an IP that keeps sending invalid tokens is refused with 429 before the token is checked', async () => {
    const { ctl, sports } = build();
    for (let i = 0; i < 20; i++) {
      await expect(ctl.feed(GAME, 'bad', undefined, {}, reqFrom('198.51.100.7'))).rejects.toMatchObject({
        status: HttpStatus.UNAUTHORIZED,
      });
    }
    const readsBefore = sports.getFeedTokenVersion.mock.calls.length;
    await expect(ctl.feed(GAME, makeFeedToken(GAME), undefined, {}, reqFrom('198.51.100.7'))).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
      response: { code: 'SPORTS_FEED_AUTH_RATE_LIMITED' },
    });
    expect(sports.getFeedTokenVersion.mock.calls.length).toBe(readsBefore); // no DB read
    // Another address with a good token is unaffected.
    await expect(ctl.feed(GAME, makeFeedToken(GAME), undefined, {}, reqFrom('198.51.100.8'))).resolves.toMatchObject({
      ok: true,
    });
  });

  it('valid tokens are still limited per game', async () => {
    const { ctl } = build();
    const good = makeFeedToken(GAME);
    for (let i = 0; i < 40; i++) {
      await ctl.feed(GAME, good, undefined, {}, reqFrom('203.0.113.2'));
    }
    await expect(ctl.feed(GAME, good, undefined, {}, reqFrom('203.0.113.2'))).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
      response: { code: 'SPORTS_FEED_RATE_LIMITED' },
    });
  });

  it('cts-snapshot and swim-timing use the same ordering', async () => {
    const { ctl } = build();
    for (let i = 0; i < 60; i++) {
      await expect(ctl.ctsSnapshot(GAME, 'bad', undefined, reqFrom(`192.0.2.${i}`), {})).rejects.toMatchObject({
        status: HttpStatus.UNAUTHORIZED,
      });
      await expect(ctl.swimTimingSnapshot(GAME, 'bad', undefined, {} as any, reqFrom(`192.0.2.${i}`))).rejects.toMatchObject({
        status: HttpStatus.UNAUTHORIZED,
      });
    }
    await expect(ctl.ctsSnapshot(GAME, makeFeedToken(GAME), undefined, reqFrom('203.0.113.3'), {})).resolves.toBeTruthy();
    await expect(
      ctl.swimTimingSnapshot(GAME, makeFeedToken(GAME), undefined, {} as any, reqFrom('203.0.113.3')),
    ).resolves.toBeTruthy();
  });
});
