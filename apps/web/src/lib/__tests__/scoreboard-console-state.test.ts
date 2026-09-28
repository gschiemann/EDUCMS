/**
 * K12-F32 — the Scoreboard console setup card's state, one case per shape:
 * each says what the evidence proves, judged on the server clock.
 */
import type { ScoreboardConsoleView } from '@/hooks/use-api';
import { scoreboardConsoleState } from '../scoreboard-console-state';

const NOW = Date.parse('2026-09-27T18:00:00.000Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();

function view(over: Partial<ScoreboardConsoleView> = {}): ScoreboardConsoleView {
  return {
    gameId: 'g1',
    sport: 'basketball',
    sportName: 'Basketball',
    final: false,
    supported: true,
    models: [],
    screens: [],
    binding: null,
    preview: null,
    link: null,
    serverTime: NOW,
    ...over,
  };
}

const binding = (over: Partial<NonNullable<ScoreboardConsoleView['binding']>> = {}) => ({
  screenId: 'box-1',
  screenName: 'Gym box',
  screenOnline: true,
  consoleProfile: 'daktronics-allsport',
  modelLabel: 'Daktronics All Sport 5000',
  decoderSport: 'basketball',
  supportedSportNames: ['Football', 'Basketball', 'Baseball', 'Softball'],
  boundAt: ago(60_000),
  confirmedAt: null,
  ...over,
});

const link = (over: Partial<NonNullable<ScoreboardConsoleView['link']>> = {}) => ({
  reportedAt: ago(2_000),
  status: 'connected' as const,
  bytes: 4096,
  goodFrames: 12,
  badFrames: 0,
  native: true,
  ...over,
});

const preview = (receivedAgoMs = 1_000) => ({
  receivedAt: ago(receivedAgoMs),
  screenId: 'box-1',
  decoderSport: 'basketball',
  clockMs: 412_000,
  clockRunning: true,
  segment: 2,
  homeScore: 45,
  awayScore: 38,
});

describe('scoreboardConsoleState (K12-F32)', () => {
  it('a sport no console decodes says so — no form, no football fallback', () => {
    expect(scoreboardConsoleState(view({ supported: false, sportName: 'Volleyball' }), {}, NOW)).toEqual({
      kind: 'unsupported',
      sportName: 'Volleyball',
    });
  });

  it('unbound: the form; a final game: nothing to connect', () => {
    expect(scoreboardConsoleState(view(), {}, NOW).kind).toBe('unbound');
    expect(scoreboardConsoleState(view({ final: true }), {}, NOW).kind).toBe('final');
    expect(scoreboardConsoleState(undefined, {}, NOW).kind).toBe('loading');
  });

  it('a model that cannot read the sport is named, with what it CAN read', () => {
    const s = scoreboardConsoleState(
      view({ binding: binding({ decoderSport: null, supportedSportNames: ['Water Polo'] }) }),
      {},
      NOW,
    );
    expect(s).toEqual({ kind: 'model-mismatch', screenName: 'Gym box', supportedSportNames: ['Water Polo'], sportName: 'Basketball' });
  });

  it('before any report: waiting for an online box, or saying it is offline', () => {
    expect(scoreboardConsoleState(view({ binding: binding() }), {}, NOW).kind).toBe('waiting-box');
    expect(scoreboardConsoleState(view({ binding: binding({ screenOnline: false }) }), {}, NOW).kind).toBe('box-offline');
    // A link report that is too old proves nothing about now.
    expect(scoreboardConsoleState(view({ binding: binding(), link: link({ reportedAt: ago(60_000) }) }), {}, NOW).kind).toBe(
      'waiting-box',
    );
  });

  it('the box reports its port: closed (with the one-click hint only for a browser box), or open with nothing decoding', () => {
    expect(
      scoreboardConsoleState(view({ binding: binding(), link: link({ status: 'idle', native: false }) }), {}, NOW),
    ).toMatchObject({ kind: 'port-closed', needsClick: true });
    expect(
      scoreboardConsoleState(view({ binding: binding(), link: link({ status: 'disconnected', native: true }) }), {}, NOW),
    ).toMatchObject({ kind: 'port-closed', needsClick: false });
    expect(scoreboardConsoleState(view({ binding: binding(), link: link() }), {}, NOW)).toEqual({
      kind: 'no-frames',
      screenName: 'Gym box',
      bytes: 4096,
    });
  });

  it('a current preview is what the operator confirms; an old one is not shown as current', () => {
    const s = scoreboardConsoleState(view({ binding: binding(), link: link(), preview: preview() }), {}, NOW);
    expect(s).toMatchObject({ kind: 'preview', ageMs: 1_000, preview: { homeScore: 45, awayScore: 38 } });
    expect(
      scoreboardConsoleState(view({ binding: binding(), link: link(), preview: preview(90_000) }), {}, NOW).kind,
    ).toBe('no-frames');
  });

  it('after confirmation the game record is the evidence: live while fresh, stale with the box’s own word after', () => {
    const confirmed = binding({ confirmedAt: ago(30_000) });
    expect(
      scoreboardConsoleState(view({ binding: confirmed }), { cts: { lastUpdateAt: ago(1_500) } }, NOW),
    ).toEqual({ kind: 'live', screenName: 'Gym box', ageMs: 1_500 });
    expect(
      scoreboardConsoleState(
        view({ binding: confirmed, link: link({ status: 'disconnected' }) }),
        { cts: { lastUpdateAt: ago(45_000) } },
        NOW,
      ),
    ).toEqual({ kind: 'live-stale', screenName: 'Gym box', ageMs: 45_000, linkStatus: 'disconnected' });
    expect(scoreboardConsoleState(view({ binding: confirmed }), {}, NOW)).toMatchObject({
      kind: 'live-stale',
      ageMs: null,
      linkStatus: null,
    });
  });
});
