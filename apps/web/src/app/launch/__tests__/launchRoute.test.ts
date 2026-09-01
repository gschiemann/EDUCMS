import { decideLaunch, isSafeNext } from '../launchRoute';

/** M01 — the five launch states, and the open-redirect the `next` param invites. */
describe('decideLaunch', () => {
  it('sends a verified session with a location to that location Home', () => {
    expect(decideLaunch({ hasToken: true, slug: 'peak-west', verify: 'ok' }))
      .toEqual({ kind: 'go', path: '/peak-west/dashboard' });
  });

  it('sends a verified session WITHOUT a location to the chooser', () => {
    expect(decideLaunch({ hasToken: true, slug: null, verify: 'ok' }))
      .toEqual({ kind: 'choose-location' });
  });

  it('sends an unauthenticated launch to sign-in', () => {
    expect(decideLaunch({ hasToken: false, slug: null, verify: 'skipped' }))
      .toEqual({ kind: 'sign-in', redirect: null });
  });

  it('preserves the intended destination through sign-in (§6.4)', () => {
    expect(decideLaunch({ hasToken: false, slug: null, verify: 'skipped', next: '/peak-west/screens' }))
      .toEqual({ kind: 'sign-in', redirect: '/peak-west/screens' });
  });

  it('a deep link outranks the default Home', () => {
    expect(decideLaunch({ hasToken: true, slug: 'peak-west', verify: 'ok', next: '/peak-west/screens?q=g43' }))
      .toEqual({ kind: 'go', path: '/peak-west/screens?q=g43' });
  });

  it('a server that ANSWERS 401 produces the expired screen', () => {
    expect(decideLaunch({ hasToken: true, slug: 'peak-west', verify: 'expired' }))
      .toEqual({ kind: 'expired', redirect: null });
  });

  /**
   * THE ONE THAT MATTERS ON A PHONE. "No signal in the stairwell" and "you
   * have been signed out" look identical if you conflate them, and only one
   * of those answers should send an operator hunting for a password.
   */
  it('a session we could not CHECK is offline, never expired', () => {
    expect(decideLaunch({ hasToken: true, slug: 'peak-west', verify: 'unreachable' }))
      .toEqual({ kind: 'offline' });
  });

  it('an unreachable server does not get overridden by a deep link', () => {
    expect(decideLaunch({ hasToken: true, slug: 'peak-west', verify: 'unreachable', next: '/peak-west/screens' }))
      .toEqual({ kind: 'offline' });
  });
});

describe('isSafeNext — the open-redirect gate', () => {
  it('accepts an absolute same-origin path', () => {
    expect(isSafeNext('/peak-west/dashboard')).toBe(true);
    expect(isSafeNext('/panic?schoolId=x')).toBe(true);
  });

  it.each([
    ['//evil.example/steal', 'protocol-relative — a browser treats this as cross-origin'],
    ['https://evil.example', 'absolute external'],
    ['/\\evil.example', 'backslash fold'],
    ['peak-west/dashboard', 'relative'],
    ['', 'empty'],
    [null, 'absent'],
    [undefined, 'undefined'],
  ])('rejects %s (%s)', (value: string | null | undefined, _why: string) => {
    expect(isSafeNext(value)).toBe(false);
  });

  it('an unsafe next is dropped, not followed, on the sign-in path', () => {
    expect(decideLaunch({ hasToken: false, slug: null, verify: 'skipped', next: '//evil.example' }))
      .toEqual({ kind: 'sign-in', redirect: null });
  });

  it('an unsafe next cannot hijack an authenticated launch either', () => {
    expect(decideLaunch({ hasToken: true, slug: 'peak-west', verify: 'ok', next: 'https://evil.example' }))
      .toEqual({ kind: 'go', path: '/peak-west/dashboard' });
  });
});
