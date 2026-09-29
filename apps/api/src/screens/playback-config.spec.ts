import { resolveLoopMode, resolvePlaybackConfig } from './playback-config';

describe('resolveLoopMode', () => {
  it('continuous is restricted to named screens, wins over two-deck, and never accepts all', () => {
    const env = { PLAYER_LOOP_CONTINUOUS: ' canary ', PLAYER_LOOP_TWODECK: 'all' };
    expect(resolveLoopMode('canary', env)).toBe('continuous');
    expect(resolveLoopMode('other', env)).toBe('twodeck');
    expect(resolveLoopMode('other', { PLAYER_LOOP_CONTINUOUS: 'all' })).toBe('native');
  });
  const S = '45d5eccc-a64c-4855-93ef-a79dbed2cd34';
  it('is native for everyone unless the switch is on', () => {
    expect(resolveLoopMode(S, {})).toBe('native');
    expect(resolveLoopMode(S, { PLAYER_LOOP_TWODECK: '' })).toBe('native');
    for (const off of ['off', '0', 'false', 'no', 'OFF', ' off ']) {
      expect(resolveLoopMode(S, { PLAYER_LOOP_TWODECK: off })).toBe('native');
    }
  });
  it('all switches every screen on', () => {
    expect(resolveLoopMode(S, { PLAYER_LOOP_TWODECK: 'all' })).toBe('twodeck');
    expect(resolveLoopMode('any-other-screen', { PLAYER_LOOP_TWODECK: ' ALL ' })).toBe('twodeck');
  });
  it('a list switches on exactly the screens named', () => {
    const env = { PLAYER_LOOP_TWODECK: ` other , ${S},x ` };
    expect(resolveLoopMode(S, env)).toBe('twodeck');
    expect(resolveLoopMode('not-listed', env)).toBe('native');
    expect(resolveLoopMode(null, env)).toBe('native');
  });
  it('a typo fails toward the current behaviour, never toward the new one', () => {
    expect(resolveLoopMode(S, { PLAYER_LOOP_TWODECK: 'tru' })).toBe('native');
    expect(resolveLoopMode(S, { PLAYER_LOOP_TWODECK: 'on' })).toBe('native');
  });
  it('resolvePlaybackConfig wraps it', () => {
    expect(resolvePlaybackConfig(S, { PLAYER_LOOP_TWODECK: 'all' })).toEqual({ loopMode: 'twodeck' });
  });
});
