/**
 * Display-control EMERGENCY INTERLOCK — the web signal.
 *
 * The stake: the APK's display layer can put a blackout overlay ABOVE this
 * WebView, dim the window and blank the panel on a schedule. These screens
 * carry lockdown and evacuation alerts. If the hold signal is wrong, an
 * active alert can be hidden behind black — so the failure modes worth
 * pinning are (a) it must never throw, (b) it must never be silently
 * dropped by an over-eager dedupe, and (c) a browser player with no APK
 * must degrade to a no-op rather than an error.
 */

import {
  signalDisplayEmergencyHold,
  DISPLAY_EMERGENCY_HOLD_METHOD,
  __resetDisplayEmergencyHoldForTests,
} from '../emergencyHold';

const fireMock = jest.fn();
jest.mock('../nativeBridge', () => ({
  nativeFire: (...args: unknown[]) => fireMock(...args),
}));

beforeEach(() => {
  fireMock.mockReset();
  fireMock.mockReturnValue(true);
  __resetDisplayEmergencyHoldForTests();
});

describe('signalDisplayEmergencyHold', () => {
  it('sends the hold under the exact method name the APK exposes', () => {
    signalDisplayEmergencyHold(true);
    expect(fireMock).toHaveBeenCalledWith(DISPLAY_EMERGENCY_HOLD_METHOD, true);
    expect(DISPLAY_EMERGENCY_HOLD_METHOD).toBe('displayEmergencyHold');
  });

  it('sends the release when the emergency settles', () => {
    signalDisplayEmergencyHold(true);
    fireMock.mockClear();
    signalDisplayEmergencyHold(false);
    expect(fireMock).toHaveBeenCalledWith(DISPLAY_EMERGENCY_HOLD_METHOD, false);
  });

  it('does not spam the bridge when nothing changed', () => {
    signalDisplayEmergencyHold(true);
    fireMock.mockClear();
    signalDisplayEmergencyHold(true);
    signalDisplayEmergencyHold(true);
    expect(fireMock).not.toHaveBeenCalled();
  });

  it('re-asserts an unchanged HOLD when forced — a native restart re-arms', () => {
    // The manifest poll and the WS/SSE OVERRIDE branch both force, so a
    // player process that died and came back mid-alert is re-held on the
    // next poll instead of waiting for a state flip that may never come.
    signalDisplayEmergencyHold(true);
    fireMock.mockClear();
    signalDisplayEmergencyHold(true, true);
    expect(fireMock).toHaveBeenCalledWith(DISPLAY_EMERGENCY_HOLD_METHOD, true);
  });

  it('reports false — never throws — when no native transport takes it', () => {
    // Browser player / pre-wave APK: nativeFire finds no method.
    fireMock.mockReturnValue(false);
    expect(() => signalDisplayEmergencyHold(true)).not.toThrow();
    expect(signalDisplayEmergencyHold(false)).toBe(false);
  });

  it('swallows a throwing bridge rather than crashing the emergency render', () => {
    fireMock.mockImplementation(() => {
      throw new Error('hostile window shim');
    });
    expect(() => signalDisplayEmergencyHold(true)).not.toThrow();
    expect(signalDisplayEmergencyHold(true, true)).toBe(false);
  });
});
