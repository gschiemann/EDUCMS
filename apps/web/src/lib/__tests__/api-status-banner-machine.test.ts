import {
  apiBannerReducer,
  initialApiBannerState,
  type ApiBannerState,
} from '../api-status-banner-machine';

const status = (s: 'ok' | 'retrying' | 'unreachable') =>
  ({ type: 'api-status', status: s }) as const;

describe('apiBannerReducer', () => {
  it('starts idle and stays idle while requests succeed', () => {
    const next = apiBannerReducer(initialApiBannerState, status('ok'));
    expect(next.phase).toBe('idle');
    // Same reference → React bails out, no chrome re-render on every 200.
    expect(next).toBe(initialApiBannerState);
  });

  it('enters trouble on a retry', () => {
    const next = apiBannerReducer(initialApiBannerState, status('retrying'));
    expect(next.phase).toBe('trouble');
  });

  it('enters trouble on unreachable', () => {
    const next = apiBannerReducer(initialApiBannerState, status('unreachable'));
    expect(next.phase).toBe('trouble');
  });

  it('re-arms the stale timer on each further retry (nonce bumps)', () => {
    const first = apiBannerReducer(initialApiBannerState, status('retrying'));
    const second = apiBannerReducer(first, status('retrying'));
    expect(second.phase).toBe('trouble');
    expect(second.nonce).toBeGreaterThan(first.nonce);
  });

  it('recovers on the next successful request', () => {
    const trouble = apiBannerReducer(initialApiBannerState, status('retrying'));
    const recovered = apiBannerReducer(trouble, status('ok'));
    expect(recovered.phase).toBe('recovered');
  });

  it('does not restart the auto-dismiss timer while already recovered', () => {
    const trouble = apiBannerReducer(initialApiBannerState, status('retrying'));
    const recovered = apiBannerReducer(trouble, status('ok'));
    const again = apiBannerReducer(recovered, status('ok'));
    expect(again).toBe(recovered);
  });

  it('dismisses the recovered banner when its hold elapses', () => {
    const trouble = apiBannerReducer(initialApiBannerState, status('retrying'));
    const recovered = apiBannerReducer(trouble, status('ok'));
    const idle = apiBannerReducer(recovered, { type: 'recovered-elapsed' });
    expect(idle.phase).toBe('idle');
  });

  it('ignores a stale recovered-elapsed that lands after trouble resumed', () => {
    const trouble = apiBannerReducer(initialApiBannerState, status('retrying'));
    const recovered = apiBannerReducer(trouble, status('ok'));
    const troubleAgain = apiBannerReducer(recovered, status('retrying'));
    const unchanged = apiBannerReducer(troubleAgain, { type: 'recovered-elapsed' });
    expect(unchanged).toBe(troubleAgain);
    expect(unchanged.phase).toBe('trouble');
  });

  it('stands down QUIETLY when the bus goes silent mid-trouble', () => {
    const trouble = apiBannerReducer(initialApiBannerState, status('retrying'));
    const idle = apiBannerReducer(trouble, { type: 'trouble-elapsed' });
    // idle, NOT recovered — we never saw a success, so we must not claim one.
    expect(idle.phase).toBe('idle');
  });

  it('ignores trouble-elapsed once already recovered', () => {
    const trouble = apiBannerReducer(initialApiBannerState, status('retrying'));
    const recovered = apiBannerReducer(trouble, status('ok'));
    expect(apiBannerReducer(recovered, { type: 'trouble-elapsed' })).toBe(recovered);
  });

  it('survives a full outage → recovery → outage cycle', () => {
    let s: ApiBannerState = initialApiBannerState;
    const seen: string[] = [];
    const feed = (a: Parameters<typeof apiBannerReducer>[1]) => {
      s = apiBannerReducer(s, a);
      seen.push(s.phase);
    };
    feed(status('retrying'));
    feed(status('retrying'));
    feed(status('unreachable'));
    feed(status('ok'));
    feed({ type: 'recovered-elapsed' });
    feed(status('ok'));
    feed(status('retrying'));
    expect(seen).toEqual([
      'trouble',
      'trouble',
      'trouble',
      'recovered',
      'idle',
      'idle',
      'trouble',
    ]);
  });
});
