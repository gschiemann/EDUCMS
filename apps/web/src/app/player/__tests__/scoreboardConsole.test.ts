/**
 * K12-F32 — the player's scoreboard console decisions, per shape: the
 * manifest binding is allow-listed, it always wins over a kiosk URL, and a
 * console is decoded only with the table for the game's sport — there is no
 * football default any more.
 */
import {
  bridgeMountPlan,
  parseScoreboardConsoleBlock,
  resolveDecoderSport,
  sameConsoleBinding,
} from '../scoreboardConsole';

const BLOCK = {
  gameId: 'game-hoops',
  sport: 'basketball',
  sportName: 'Basketball',
  consoleProfile: 'daktronics-allsport',
  decoder: 'daktronics',
  decoderSport: 'basketball',
  supportedSports: ['football', 'basketball', 'baseball', 'softball'],
  supportedSportNames: ['Football', 'Basketball', 'Baseball', 'Softball'],
  confirmed: false,
};

describe('parseScoreboardConsoleBlock', () => {
  it('accepts the server block', () => {
    expect(parseScoreboardConsoleBlock(BLOCK)).toEqual({
      gameId: 'game-hoops',
      sport: 'basketball',
      sportName: 'Basketball',
      consoleProfile: 'daktronics-allsport',
      decoder: 'daktronics',
      decoderSport: 'basketball',
      supportedSportNames: ['Football', 'Basketball', 'Baseball', 'Softball'],
      confirmed: false,
    });
  });

  it('drops what it cannot trust: an unknown profile, a decoder that is not the profile’s, a table the parser lacks', () => {
    expect(parseScoreboardConsoleBlock({ ...BLOCK, consoleProfile: 'oes-isc9000' })).toMatchObject({
      consoleProfile: null,
      decoder: null,
      decoderSport: null,
    });
    expect(parseScoreboardConsoleBlock({ ...BLOCK, decoder: 'cts' })).toMatchObject({ decoder: null, decoderSport: null });
    expect(parseScoreboardConsoleBlock({ ...BLOCK, decoderSport: 'volleyball' })?.decoderSport).toBeNull();
    // The server says "this console cannot read the sport" → stays null.
    expect(parseScoreboardConsoleBlock({ ...BLOCK, consoleProfile: 'cts-gen6', decoder: 'cts', decoderSport: null })).toMatchObject({
      decoder: 'cts',
      decoderSport: null,
    });
  });

  it('a malformed or absent block is "not bound"', () => {
    expect(parseScoreboardConsoleBlock(undefined)).toBeNull();
    expect(parseScoreboardConsoleBlock('x')).toBeNull();
    expect(parseScoreboardConsoleBlock({ ...BLOCK, gameId: '../../admin' })).toBeNull();
    expect(parseScoreboardConsoleBlock({ ...BLOCK, sport: undefined })).toBeNull();
  });

  it('two identical manifests are the same binding (no remount churn)', () => {
    expect(sameConsoleBinding(parseScoreboardConsoleBlock(BLOCK), parseScoreboardConsoleBlock({ ...BLOCK }))).toBe(true);
    expect(
      sameConsoleBinding(parseScoreboardConsoleBlock(BLOCK), parseScoreboardConsoleBlock({ ...BLOCK, confirmed: true })),
    ).toBe(false);
  });
});

describe('bridgeMountPlan', () => {
  const binding = parseScoreboardConsoleBlock(BLOCK);

  it('a manifest binding mounts the bridge with no URL at all', () => {
    expect(bridgeMountPlan({ binding, urlCts: null, urlGame: null, urlFeedToken: null })).toEqual({
      mount: true,
      mode: 'managed',
      binding,
    });
  });

  it('the binding wins over a stale kiosk URL — its feed token is never used', () => {
    expect(bridgeMountPlan({ binding, urlCts: '1', urlGame: 'old-game', urlFeedToken: 'tok' })).toMatchObject({
      mode: 'managed',
    });
  });

  it('the legacy URL still mounts an existing install; nothing else mounts a bridge', () => {
    expect(bridgeMountPlan({ binding: null, urlCts: '1', urlGame: 'g', urlFeedToken: 't' })).toEqual({
      mount: true,
      mode: 'legacy',
      gameId: 'g',
      feedToken: 't',
    });
    expect(bridgeMountPlan({ binding: null, urlCts: null, urlGame: 'g', urlFeedToken: 't' })).toEqual({ mount: false });
  });
});

describe('resolveDecoderSport — no football fallback', () => {
  const managed = parseScoreboardConsoleBlock(BLOCK)!;

  it('managed: exactly the table the server computed from the game’s sport', () => {
    expect(resolveDecoderSport({ decoder: 'daktronics', profile: 'daktronics-allsport', managed, explicit: 'football' })).toBe(
      'basketball',
    );
    expect(
      resolveDecoderSport({
        decoder: 'daktronics',
        profile: 'daktronics-allsport',
        managed: { ...managed, decoderSport: null },
        explicit: 'football',
      }),
    ).toBeNull();
  });

  it('legacy Daktronics with no ?dakSport= decodes NOTHING (it used to decode as football)', () => {
    expect(resolveDecoderSport({ decoder: 'daktronics', profile: 'daktronics-allsport', managed: null, explicit: null })).toBeNull();
    expect(resolveDecoderSport({ decoder: 'daktronics', profile: 'daktronics-allsport', managed: null, explicit: 'soccer' })).toBeNull();
    expect(resolveDecoderSport({ decoder: 'daktronics', profile: 'daktronics-allsport', managed: null, explicit: 'baseball' })).toBe(
      'baseball',
    );
  });

  it('legacy CTS keeps its one table (water polo) — unchanged for the pilot install', () => {
    expect(resolveDecoderSport({ decoder: 'cts', profile: 'cts-gen6', managed: null, explicit: null })).toBe('water-polo');
  });
});
