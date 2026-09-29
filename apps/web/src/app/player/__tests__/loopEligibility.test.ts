import { pickLoopBackend, type LoopEligibilityInput } from '../loopEligibility';

const ok: LoopEligibilityInput = {
  loopMode: 'twodeck', urlOverride: null, isSolo: true, muted: true, syncActive: false,
  isEmergency: false, isMov: false, hasRvfc: true, blocked: false, isPreview: false,
};

describe('pickLoopBackend', () => {
  it('is native unless two-deck was asked for — by the manifest or a bench override', () => {
    expect(pickLoopBackend({ ...ok, loopMode: 'native' })).toEqual({ backend: 'native', reason: 'not-requested' });
    expect(pickLoopBackend({ ...ok, loopMode: undefined })).toEqual({ backend: 'native', reason: 'not-requested' });
    expect(pickLoopBackend({ ...ok, loopMode: 'garbage' }).backend).toBe('native');
    expect(pickLoopBackend({ ...ok, loopMode: 'native', urlOverride: 'twodeck' }).backend).toBe('twodeck');
    expect(pickLoopBackend({ ...ok, loopMode: 'twodeck', urlOverride: 'native' }).backend).toBe('native');
  });

  it('is two-deck for a plain muted solo video on a capable browser', () => {
    expect(pickLoopBackend(ok)).toEqual({ backend: 'twodeck', reason: 'requested' });
  });

  it.each([
    ['isPreview', 'preview'],
    ['isEmergency', 'emergency'],
    ['syncActive', 'sync-active'],
    ['isMov', 'mov-source'],
    ['blocked', 'blocked'],
  ] as const)('stays native when %s', (key, reason) => {
    expect(pickLoopBackend({ ...ok, [key]: true })).toEqual({ backend: 'native', reason });
  });

  it('stays native with sound, when not solo, or without requestVideoFrameCallback', () => {
    expect(pickLoopBackend({ ...ok, muted: false })).toEqual({ backend: 'native', reason: 'has-audio' });
    expect(pickLoopBackend({ ...ok, isSolo: false })).toEqual({ backend: 'native', reason: 'not-solo' });
    expect(pickLoopBackend({ ...ok, hasRvfc: false })).toEqual({ backend: 'native', reason: 'no-rvfc' });
  });

  it('emergency content is refused even when a bench override asks for two-deck', () => {
    expect(pickLoopBackend({ ...ok, urlOverride: 'twodeck', isEmergency: true }).backend).toBe('native');
  });

  it('uses the fleet continuous request only on an eligible MP4 player', () => {
    const continuous = { ...ok, loopMode: 'continuous', continuousCapable: true };
    expect(pickLoopBackend(continuous)).toEqual({ backend: 'continuous', reason: 'requested' });
    expect(pickLoopBackend({ ...continuous, continuousCapable: false })).toEqual({ backend: 'native', reason: 'continuous-unsupported' });
    expect(pickLoopBackend({ ...continuous, continuousCapable: undefined }).backend).toBe('native');
    expect(pickLoopBackend({ ...continuous, urlOverride: 'native' }).backend).toBe('native');
  });

  it.each([
    [{ isEmergency: true }, 'emergency'],
    [{ syncActive: true }, 'sync-active'],
    [{ muted: false }, 'has-audio'],
    [{ isSolo: false }, 'not-solo'],
    [{ hasRvfc: false }, 'no-rvfc'],
    [{ isMov: true }, 'mov-source'],
    [{ isPreview: true }, 'preview'],
  ] as const)('the fleet continuous request preserves the %s gate', (override, reason) => {
    expect(pickLoopBackend({ ...ok, loopMode: 'continuous', continuousCapable: true, ...override })).toEqual({ backend: 'native', reason });
  });
});
