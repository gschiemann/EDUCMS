import { resolveLoopMode, resolvePlaybackConfig } from './playback-config';

describe('resolveLoopMode', () => {
  it('pins only named screens to the same-file native backend without changing default enrollment', () => {
    const env = { PLAYER_LOOP_NATIVE: ' front , back ', PLAYER_LOOP_CONTINUOUS: 'all', PLAYER_LOOP_TWODECK: 'all' };
    expect(resolvePlaybackConfig('front', env)).toEqual({ loopMode: 'native' });
    expect(resolvePlaybackConfig('back', env)).toEqual({ loopMode: 'native' });
    expect(resolvePlaybackConfig('other', env)).toEqual({ loopMode: 'continuous' });
    expect(resolvePlaybackConfig('newly-paired', env)).toEqual({ loopMode: 'continuous' });
    for (const value of [undefined, '', ' ', 'all', 'fro', 'front-other']) {
      expect(resolveLoopMode('front', { PLAYER_LOOP_NATIVE: value })).toBe('continuous');
    }
    expect(resolveLoopMode('front', {})).toBe('continuous');
  });
  it('a diagnostic list restricts continuous and otherwise uses legacy selection', () => {
    const env = {
      PLAYER_LOOP_CONTINUOUS: ' canary ',
      PLAYER_LOOP_TWODECK: 'all',
    };
    expect(resolveLoopMode('canary', env)).toBe('continuous');
    expect(resolveLoopMode('other', env)).toBe('twodeck');
  });
  const S = '45d5eccc-a64c-4855-93ef-a79dbed2cd34';
  it('defaults to continuous for existing screens and screens added in the future', () => {
    const newlyPaired = '8e76b237-2b31-421f-b6d8-2a6b0eb46c44';
    for (const screen of [S, newlyPaired]) {
      expect(resolvePlaybackConfig(screen, {})).toEqual({
        loopMode: 'continuous',
      });
      expect(resolveLoopMode(screen, { PLAYER_LOOP_CONTINUOUS: '  ' })).toBe(
        'continuous',
      );
    }
  });
  it('all enables continuous fleet-wide and supersedes legacy two-deck settings', () => {
    for (const continuous of ['all', ' ALL ']) {
      expect(resolveLoopMode(S, { PLAYER_LOOP_CONTINUOUS: continuous })).toBe(
        'continuous',
      );
      expect(
        resolveLoopMode('new-screen', {
          PLAYER_LOOP_CONTINUOUS: continuous,
          PLAYER_LOOP_TWODECK: 'all',
        }),
      ).toBe('continuous');
    }
    expect(resolveLoopMode(S, { PLAYER_LOOP_TWODECK: 'all' })).toBe(
      'continuous',
    );
  });
  it('does not enable a player backend without a screen identity', () => {
    for (const screen of [undefined, null, '', '  ']) {
      expect(resolveLoopMode(screen, {})).toBe('native');
      expect(
        resolveLoopMode(screen, {
          PLAYER_LOOP_CONTINUOUS: 'all',
          PLAYER_LOOP_TWODECK: 'all',
        }),
      ).toBe('native');
    }
  });
  it('explicit continuous rollback restores native when no legacy backend is enabled', () => {
    for (const off of ['off', '0', 'false', 'no', 'OFF', ' off ']) {
      expect(resolveLoopMode(S, { PLAYER_LOOP_CONTINUOUS: off })).toBe(
        'native',
      );
    }
  });
  it('legacy two-deck stays disabled unless explicitly requested during rollback', () => {
    expect(
      resolveLoopMode(S, {
        PLAYER_LOOP_CONTINUOUS: 'off',
        PLAYER_LOOP_TWODECK: '',
      }),
    ).toBe('native');
    for (const off of ['off', '0', 'false', 'no', 'OFF', ' off ']) {
      expect(
        resolveLoopMode(S, {
          PLAYER_LOOP_CONTINUOUS: 'off',
          PLAYER_LOOP_TWODECK: off,
        }),
      ).toBe('native');
    }
  });
  it('all switches every screen on', () => {
    expect(
      resolveLoopMode(S, {
        PLAYER_LOOP_CONTINUOUS: 'off',
        PLAYER_LOOP_TWODECK: 'all',
      }),
    ).toBe('twodeck');
    expect(
      resolveLoopMode('any-other-screen', {
        PLAYER_LOOP_CONTINUOUS: 'off',
        PLAYER_LOOP_TWODECK: ' ALL ',
      }),
    ).toBe('twodeck');
  });
  it('a list switches on exactly the screens named', () => {
    const env = {
      PLAYER_LOOP_CONTINUOUS: 'off',
      PLAYER_LOOP_TWODECK: ` other , ${S},x `,
    };
    expect(resolveLoopMode(S, env)).toBe('twodeck');
    expect(resolveLoopMode('not-listed', env)).toBe('native');
    expect(resolveLoopMode(null, env)).toBe('native');
  });
  it('a typo fails toward the current behaviour, never toward the new one', () => {
    expect(resolveLoopMode(S, { PLAYER_LOOP_CONTINUOUS: 'al' })).toBe('native');
    expect(
      resolveLoopMode(S, {
        PLAYER_LOOP_CONTINUOUS: 'off',
        PLAYER_LOOP_TWODECK: 'tru',
      }),
    ).toBe('native');
    expect(
      resolveLoopMode(S, {
        PLAYER_LOOP_CONTINUOUS: 'off',
        PLAYER_LOOP_TWODECK: 'on',
      }),
    ).toBe('native');
  });
  it('resolvePlaybackConfig wraps it', () => {
    expect(
      resolvePlaybackConfig(S, {
        PLAYER_LOOP_CONTINUOUS: 'off',
        PLAYER_LOOP_TWODECK: 'all',
      }),
    ).toEqual({ loopMode: 'twodeck' });
  });
});
