/**
 * Display-control EMERGENCY INTERLOCK — the web signal.
 *
 * The stake: the APK's display layer can put a blackout overlay ABOVE this
 * WebView, dim the window and blank the panel on a schedule. These screens
 * carry lockdown and evacuation alerts. If the hold signal is wrong, an
 * active alert can be hidden behind black — so the failure modes worth
 * pinning are (a) it must never throw, (b) it must never be silently
 * dropped by an over-eager dedupe, (c) a browser player with no APK must
 * degrade to a no-op rather than an error, and (d) — added 2026-08-13 after
 * the third review pass — a RELEASE the device REFUSED must not be latched
 * as applied, or a Chromium-83/87 Taurus is pinned lit forever.
 */

import {
  signalDisplayEmergencyHold,
  DISPLAY_EMERGENCY_HOLD_METHOD,
  __resetDisplayEmergencyHoldForTests,
} from '../emergencyHold';
import type { NativeFireOutcome } from '../nativeBridge';

const fireMock = jest.fn<NativeFireOutcome, unknown[]>();
jest.mock('../nativeBridge', () => ({
  nativeFireChecked: (...args: unknown[]) => fireMock(...args),
}));

/** The channel transport: trusted, so a delivered call is an applied call. */
const CHANNEL_OK: NativeFireOutcome = { transport: 'channel', delivered: true };
/** The legacy transport answering with a refusal, verbatim from the APK. */
const LEGACY_REFUSED: NativeFireOutcome = {
  transport: 'legacy',
  delivered: true,
  result:
    '{"ok":false,"code":"insecure-transport","message":"use the origin-scoped bridge channel"}',
};
/** The legacy transport accepting (a RAISE is honoured on any transport). */
const LEGACY_OK: NativeFireOutcome = {
  transport: 'legacy',
  delivered: true,
  result: '{"ok":true,"emergencyHold":true,"persisted":true}',
};

beforeEach(() => {
  fireMock.mockReset();
  fireMock.mockReturnValue(CHANNEL_OK);
  __resetDisplayEmergencyHoldForTests();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('signalDisplayEmergencyHold', () => {
  it('sends the hold under the exact method name the APK exposes', () => {
    expect(signalDisplayEmergencyHold(true)).toBe('applied');
    expect(fireMock).toHaveBeenCalledWith(DISPLAY_EMERGENCY_HOLD_METHOD, true);
    expect(DISPLAY_EMERGENCY_HOLD_METHOD).toBe('displayEmergencyHold');
  });

  it('sends the release when the emergency settles', () => {
    signalDisplayEmergencyHold(true);
    fireMock.mockClear();
    expect(signalDisplayEmergencyHold(false)).toBe('applied');
    expect(fireMock).toHaveBeenCalledWith(DISPLAY_EMERGENCY_HOLD_METHOD, false);
  });

  it('does not spam the bridge when nothing changed', () => {
    signalDisplayEmergencyHold(true);
    fireMock.mockClear();
    expect(signalDisplayEmergencyHold(true)).toBe('skipped');
    expect(signalDisplayEmergencyHold(true)).toBe('skipped');
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

  it('reports no-native — never throws — when no transport takes it', () => {
    // Browser player / pre-wave APK: no bridge, or the method is absent.
    fireMock.mockReturnValue({ transport: 'none', delivered: false });
    expect(() => signalDisplayEmergencyHold(true)).not.toThrow();
    expect(signalDisplayEmergencyHold(false)).toBe('no-native');
  });

  it('swallows a throwing bridge rather than crashing the emergency render', () => {
    fireMock.mockImplementation(() => {
      throw new Error('hostile window shim');
    });
    expect(() => signalDisplayEmergencyHold(true)).not.toThrow();
    expect(signalDisplayEmergencyHold(true, true)).toBe('no-native');
  });

  // ────────────────────────────────────────────────────────────────
  // ⚠️ LIFE SAFETY REGRESSION — the Taurus "pinned lit forever" bug.
  // ────────────────────────────────────────────────────────────────
  describe('a REFUSED release is retried, not latched (legacy transport)', () => {
    it('does not latch a refusal, so the next poll re-sends the release', () => {
      // Raise on the legacy transport — accepted (a raise can only ever make
      // a dark screen visible, so the APK honours it from any transport).
      fireMock.mockReturnValue(LEGACY_OK);
      expect(signalDisplayEmergencyHold(true)).toBe('applied');

      // All-clear. The APK refuses a risk-direction mutation arriving on the
      // untrusted every-frame bridge, and returns the refusal as a STRING —
      // it does not throw, so nothing upstream can see it.
      fireMock.mockReturnValue(LEGACY_REFUSED);
      fireMock.mockClear();
      expect(signalDisplayEmergencyHold(false)).toBe('refused');
      expect(fireMock).toHaveBeenCalledWith(DISPLAY_EMERGENCY_HOLD_METHOD, false);

      // THE ASSERTION THAT MATTERS. Before the fix, `lastSent` was set to
      // false before firing, so this second (deduped) call was a silent
      // no-op and the hold stayed engaged for the life of the page — every
      // blank, every dim and every dead-man revert refused forever.
      fireMock.mockClear();
      expect(signalDisplayEmergencyHold(false)).toBe('refused');
      expect(fireMock).toHaveBeenCalledWith(DISPLAY_EMERGENCY_HOLD_METHOD, false);
    });

    it('latches as soon as the device finally accepts the release', () => {
      fireMock.mockReturnValue(LEGACY_OK);
      signalDisplayEmergencyHold(true);

      fireMock.mockReturnValue(LEGACY_REFUSED);
      expect(signalDisplayEmergencyHold(false)).toBe('refused');

      // e.g. the box took an APK update that accepts the release, or the
      // origin-scoped channel attached on the next page load.
      fireMock.mockReturnValue({
        transport: 'legacy',
        delivered: true,
        result: '{"ok":true,"emergencyHold":false,"persisted":true}',
      });
      expect(signalDisplayEmergencyHold(false)).toBe('applied');

      fireMock.mockClear();
      expect(signalDisplayEmergencyHold(false)).toBe('skipped');
      expect(fireMock).not.toHaveBeenCalled();
    });

    it('treats an unparseable / non-JSON return as accepted, not as a refusal', () => {
      // Guard against phantom retries if the APK's return shape ever drifts.
      fireMock.mockReturnValue({ transport: 'legacy', delivered: true, result: 'ok' });
      signalDisplayEmergencyHold(true);
      expect(signalDisplayEmergencyHold(false)).toBe('applied');

      fireMock.mockReturnValue({ transport: 'legacy', delivered: true, result: undefined });
      expect(signalDisplayEmergencyHold(true)).toBe('applied');
    });

    it('never refuses a RAISE — the interlock still engages on legacy', () => {
      fireMock.mockReturnValue(LEGACY_OK);
      expect(signalDisplayEmergencyHold(true, true)).toBe('applied');
      expect(fireMock).toHaveBeenCalledWith(DISPLAY_EMERGENCY_HOLD_METHOD, true);
    });
  });
});
