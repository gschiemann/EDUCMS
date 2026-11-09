import { companionTapVerdict, isCompanionTapReport } from './companion-tap-report';

describe('companion tap report', () => {
  it('recognises only a NEEDS_TAP that names the companion', () => {
    expect(isCompanionTapReport('NEEDS_TAP', 'Companion service update is waiting for an Install tap on the screen.')).toBe(true);
    expect(isCompanionTapReport('NEEDS_TAP', 'Press Install now on the screen')).toBe(false);
    expect(isCompanionTapReport('CHECKING', 'Companion service update')).toBe(false);
    expect(isCompanionTapReport('NEEDS_TAP', null)).toBe(false);
  });

  it('is believed only from the device, and never over a pending Player push', () => {
    expect(companionTapVerdict({ deviceAuthenticated: false, pushPending: false })).toBe('ignore-anonymous');
    expect(companionTapVerdict({ deviceAuthenticated: true, pushPending: true })).toBe('ignore-push-pending');
    expect(companionTapVerdict({ deviceAuthenticated: true, pushPending: false })).toBe('store');
  });
});
