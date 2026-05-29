/**
 * TouchMaker — player tap-dispatch repro (2026-05-28).
 *
 * Operator: "Touch interactive screen template maker doesn't work
 * right. Nothing has the ability to be functional."
 *
 * One concrete functional break: the Phone Button + Email Button touch
 * variants tell the operator (in their own picker descriptions) to wire
 * `open-url` with a `tel:` / `mailto:` target. But the player's URL gate
 * (isHttpUrl) only accepted http(s), so the dispatcher SILENTLY rejected
 * those targets — the visitor tapped the button and nothing happened.
 *
 * These tests pin the fix: tel:/mailto: now navigate (window.location);
 * http(s) still routes to the overlay/new-tab; dangerous schemes
 * (javascript:/data:/file:) stay rejected.
 *
 * The player page module pulls in service-worker + polyfill side-effects
 * that can't run under jsdom, so we mock those leaf modules. The
 * dispatcher itself is pure (it reads the action + fires CustomEvents /
 * navigation) so the mocks don't touch the code under test.
 */

// ── Mock the side-effecting leaf modules the page imports at top level ──
jest.mock('@/components/widgets/variants-register', () => ({}), { virtual: false });
jest.mock('@/lib/flex-gap-polyfill', () => ({
  isFlexGapSupported: () => true,
  applyFlexGapPolyfill: () => {},
}));
jest.mock('@/lib/cq-unit-polyfill', () => ({
  isCqUnitSupported: () => true,
  applyCqUnitPolyfill: () => {},
}));
jest.mock('../offline-cache', () => ({
  registerOfflineCache: () => {},
  precachePlaylist: () => {},
  precacheEmergency: () => {},
  getCacheStatus: async () => ({}),
  formatBytes: (n: number) => `${n}b`,
  isSwSupported: () => false,
}));

import { dispatchTouchAction, isContactUrl, playerNav } from '../page';

const CTX = { screenId: 's1', tenantId: 't1', zoneId: 'z1' };

describe('isContactUrl', () => {
  it('accepts tel: and mailto:, rejects everything else', () => {
    expect(isContactUrl('tel:+15551234567')).toBe(true);
    expect(isContactUrl('mailto:office@school.edu')).toBe(true);
    expect(isContactUrl('https://example.com')).toBe(false);
    expect(isContactUrl('javascript:alert(1)')).toBe(false);
    expect(isContactUrl('')).toBe(false);
    expect(isContactUrl(null)).toBe(false);
  });
});

describe('dispatchTouchAction — open-url tel:/mailto: (the Phone/Email touch buttons)', () => {
  let goSpy: jest.SpyInstance;
  beforeEach(() => { goSpy = jest.spyOn(playerNav, 'go').mockImplementation(() => {}); });
  afterEach(() => { goSpy.mockRestore(); });

  it('navigates the dialer for a tel: target (was silently dropped before the fix)', () => {
    dispatchTouchAction({ type: 'open-url', target: 'tel:+15551234567' }, CTX);
    expect(goSpy).toHaveBeenCalledWith('tel:+15551234567');
  });

  it('navigates the mail client for a mailto: target', () => {
    dispatchTouchAction({ type: 'open-url', target: 'mailto:office@school.edu' }, CTX);
    expect(goSpy).toHaveBeenCalledWith('mailto:office@school.edu');
  });

  it('legacy `url` action also honors tel:', () => {
    dispatchTouchAction({ type: 'url', target: 'tel:911' }, CTX);
    expect(goSpy).toHaveBeenCalledWith('tel:911');
  });

  it('does NOT navigate for a dangerous javascript: scheme', () => {
    dispatchTouchAction({ type: 'open-url', target: 'javascript:alert(document.cookie)' }, CTX);
    expect(goSpy).not.toHaveBeenCalled();
  });
});

describe('dispatchTouchAction — open-url http(s) still routes to the in-place overlay', () => {
  it('fires edu:touch-overlay (iframe) for a plain https URL', () => {
    const overlaySpy = jest.fn();
    window.addEventListener('edu:touch-overlay', overlaySpy);
    dispatchTouchAction({ type: 'open-url', target: 'https://example.com' }, CTX);
    expect(overlaySpy).toHaveBeenCalledTimes(1);
    const evt = overlaySpy.mock.calls[0][0] as CustomEvent;
    expect(evt.detail).toEqual({ kind: 'iframe', url: 'https://example.com' });
    window.removeEventListener('edu:touch-overlay', overlaySpy);
  });

  it('every tap broadcasts edu:touch-action (idle-reset + analytics)', () => {
    const actionSpy = jest.fn();
    window.addEventListener('edu:touch-action', actionSpy);
    dispatchTouchAction({ type: 'goto-scene', target: 'scene-2' }, CTX);
    expect(actionSpy).toHaveBeenCalled();
    window.removeEventListener('edu:touch-action', actionSpy);
  });
});
