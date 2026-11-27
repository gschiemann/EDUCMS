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
  liveManifestHold,
  signalDisplayEmergencyHold,
  displayEmergencyHoldRaised,
  displayEmergencyPlaybackHeld,
  reassertDisplayEmergencyHold,
  updateBroadcastBannerInset,
  subscribeDisplayEmergencyHold,
  DISPLAY_EMERGENCY_HOLD_METHOD,
  __resetDisplayEmergencyHoldForTests,
  bannerRefusalFromState,
  noteNativeBannerRefused,
  displayEmergencyBannerRefused,
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
  it('a known banner holds wake/brightness while playback and paint reassertions stay continuous', () => {
    signalDisplayEmergencyHold(true, true, true);
    expect(displayEmergencyHoldRaised()).toBe(true);
    expect(displayEmergencyPlaybackHeld()).toBe(false);
    reassertDisplayEmergencyHold();
    expect(displayEmergencyPlaybackHeld()).toBe(false);
    updateBroadcastBannerInset(0.1);
    updateBroadcastBannerInset(0);
    expect(displayEmergencyHoldRaised()).toBe(true);
    expect(displayEmergencyPlaybackHeld()).toBe(false);
    signalDisplayEmergencyHold(false);
    expect(displayEmergencyHoldRaised()).toBe(false);
  });

  it('a full takeover immediately restores playback suppression, including paint reassertions', () => {
    signalDisplayEmergencyHold(true, true, true);
    signalDisplayEmergencyHold(true, true);
    expect(displayEmergencyPlaybackHeld()).toBe(true);
    reassertDisplayEmergencyHold();
    expect(displayEmergencyPlaybackHeld()).toBe(true);
  });
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


describe('regular-content render interlock', () => {
  it('notifies before native surface removal can expose normal web video', () => {
    const seen: boolean[] = [];
    const unsubscribe = subscribeDisplayEmergencyHold(() => seen.push(displayEmergencyHoldRaised()));
    fireMock.mockImplementation(() => {
      expect(seen).toEqual([true]);
      expect(displayEmergencyHoldRaised()).toBe(true);
      return CHANNEL_OK;
    });
    signalDisplayEmergencyHold(true);
    unsubscribe();
  });

  it('keeps rendering held when native refuses a raise or clear', () => {
    fireMock.mockReturnValue(LEGACY_REFUSED);
    signalDisplayEmergencyHold(true);
    expect(displayEmergencyHoldRaised()).toBe(true);
    signalDisplayEmergencyHold(false);
    expect(displayEmergencyHoldRaised()).toBe(true);
    fireMock.mockReturnValue(CHANNEL_OK);
    signalDisplayEmergencyHold(false);
    expect(displayEmergencyHoldRaised()).toBe(false);
  });

  it('notifies once per edge and stops after unsubscribe', () => {
    const listener = jest.fn();
    const unsubscribe = subscribeDisplayEmergencyHold(listener);
    signalDisplayEmergencyHold(true);
    signalDisplayEmergencyHold(true, true);
    expect(listener).toHaveBeenCalledTimes(1);
    signalDisplayEmergencyHold(false);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    signalDisplayEmergencyHold(true);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe('the app refuses banner posture (2026-11-02, portrait-by-rotation native video)', () => {
  it('reads the refusal from one sharedVideoState reply, bounded and total', () => {
    expect(bannerRefusalFromState({ broadcastBannerPosture: { posture: 'refused', reason: 'display-rotated' } })).toBe('display-rotated');
    expect(bannerRefusalFromState({ broadcastBannerPosture: { posture: 'refused', reason: 'x'.repeat(65) } })).toBe('refused');
    expect(bannerRefusalFromState({ broadcastBannerPosture: { posture: 'banner' } })).toBeNull();
    expect(bannerRefusalFromState({})).toBeNull();
    expect(bannerRefusalFromState(null)).toBeNull();
    expect(bannerRefusalFromState('nope')).toBeNull();
  });

  it('a refused banner holds playback, tells the app it is a takeover, and later banner signals cannot reopen it', () => {
    signalDisplayEmergencyHold(true, true, true);
    expect(displayEmergencyPlaybackHeld()).toBe(false);
    const listener = jest.fn();
    const off = subscribeDisplayEmergencyHold(listener);
    fireMock.mockClear();
    noteNativeBannerRefused('display-rotated');
    expect(displayEmergencyBannerRefused()).toBe(true);
    expect(displayEmergencyPlaybackHeld()).toBe(true);
    expect(listener).toHaveBeenCalled();
    // The banner geometry is withdrawn and the hold re-asserted as a takeover.
    expect(fireMock).toHaveBeenCalledWith('sharedVideoPrepare', expect.stringContaining('"active":false'));
    expect(fireMock).toHaveBeenCalledWith(DISPLAY_EMERGENCY_HOLD_METHOD, true);
    // The page's own effects keep asking for a banner: it stays a takeover.
    signalDisplayEmergencyHold(true, true, true);
    reassertDisplayEmergencyHold();
    expect(displayEmergencyPlaybackHeld()).toBe(true);
    expect(fireMock).not.toHaveBeenCalledWith(DISPLAY_EMERGENCY_HOLD_METHOD, true, true);
    // Only the release ends it; the next alert starts unrefused.
    signalDisplayEmergencyHold(false);
    expect(displayEmergencyBannerRefused()).toBe(false);
    signalDisplayEmergencyHold(true, true, true);
    expect(displayEmergencyPlaybackHeld()).toBe(false);
    off();
  });

  it('a refusal with no hold raised is ignored (never invents an alert)', () => {
    noteNativeBannerRefused('display-rotated');
    expect(displayEmergencyBannerRefused()).toBe(false);
    expect(displayEmergencyHoldRaised()).toBe(false);
  });
});

describe('the takeover → banner transition (2026-11-23, a drill over a broadcast, then its all-clear)', () => {
  const holds = () => fireMock.mock.calls.filter((c) => c[0] === DISPLAY_EMERGENCY_HOLD_METHOD).map((c) => c.slice(1));
  const geometry = () => fireMock.mock.calls
    .filter((c) => c[0] === 'sharedVideoPrepare')
    .map((c) => JSON.parse(String(c[1])) as { op: string; active: boolean });

  it('a LIVE manifest that asks for banner posture tells the app the takeover ended; geometry goes first', () => {
    signalDisplayEmergencyHold(true, true, true); // the broadcast (push path)
    signalDisplayEmergencyHold(true, true, false); // the drill takes over
    fireMock.mockClear();
    liveManifestHold(true, true, () => signalDisplayEmergencyHold(true, true, true)); // the all-clear's live manifest
    expect(holds()).toEqual([[true, true, true]]);
    expect(geometry()).toEqual([expect.objectContaining({ op: 'banner', active: true })]);
    const order = fireMock.mock.calls.map((c) => c[0]);
    expect(order.indexOf('sharedVideoPrepare')).toBeLessThan(order.indexOf(DISPLAY_EMERGENCY_HOLD_METHOD));
    expect(displayEmergencyPlaybackHeld()).toBe(false);
  });

  it('every live banner raise carries it (the flip may have happened on the push path), never a takeover or a release', () => {
    signalDisplayEmergencyHold(true, true, true); // banner
    signalDisplayEmergencyHold(true, true, false); // SOS over it
    signalDisplayEmergencyHold(true, true, true); // the SOS clear — push path, flips back
    expect(holds().every((a) => a.length <= 2)).toBe(true);
    fireMock.mockClear();
    liveManifestHold(true, true, () => signalDisplayEmergencyHold(true, true, true)); // no flip now
    liveManifestHold(true, true, () => signalDisplayEmergencyHold(true, true, true)); // the next poll
    expect(holds()).toEqual([[true, true, true], [true, true, true]]);
    fireMock.mockClear();
    liveManifestHold(true, true, () => signalDisplayEmergencyHold(true, true, false)); // a live takeover
    liveManifestHold(true, true, () => signalDisplayEmergencyHold(false, false, false)); // a live release
    expect(holds()).toEqual([[true], [false]]);
  });

  it('no other path ever sends it: push, clear, reconcile, effects and the paint reassert stay two arguments', () => {
    signalDisplayEmergencyHold(true, true, true);
    signalDisplayEmergencyHold(true, false, true);
    signalDisplayEmergencyHold(true, true, false);
    signalDisplayEmergencyHold(true, true, true);
    reassertDisplayEmergencyHold();
    liveManifestHold(false, true, () => signalDisplayEmergencyHold(true, true, true));
    expect(holds().some((a) => a.length > 2)).toBe(false);
  });

  it('the kill switch (playback.bannerRestore: off) omits it — the app keeps today\'s full takeover', () => {
    signalDisplayEmergencyHold(true, true, true);
    signalDisplayEmergencyHold(true, true, false);
    fireMock.mockClear();
    liveManifestHold(true, false, () => signalDisplayEmergencyHold(true, true, true));
    expect(holds()).toEqual([[true, true]]);
  });

  it('a refused banner never claims the takeover ended', () => {
    signalDisplayEmergencyHold(true, true, true);
    noteNativeBannerRefused('display-rotated');
    fireMock.mockClear();
    liveManifestHold(true, true, () => signalDisplayEmergencyHold(true, true, true));
    expect(holds()).toEqual([[true]]);
    expect(displayEmergencyPlaybackHeld()).toBe(true);
  });

  it('the app reporting it KEPT the takeover is read like a refusal (full presentation, playback held)', () => {
    expect(bannerRefusalFromState({ broadcastBannerPosture: { posture: 'takeover-kept', reason: 'native-watch' } })).toBe('native-watch');
    expect(bannerRefusalFromState({ broadcastBannerPosture: { posture: 'takeover-kept' } })).toBe('refused');
    liveManifestHold(true, true, () => signalDisplayEmergencyHold(true, true, true));
    noteNativeBannerRefused(bannerRefusalFromState({ broadcastBannerPosture: { posture: 'takeover-kept', reason: 'native-watch' } }) ?? undefined);
    expect(displayEmergencyBannerRefused()).toBe(true);
    expect(displayEmergencyPlaybackHeld()).toBe(true);
  });

  it('the live-manifest scope covers exactly one call inside it and never outlives it, even when it throws', () => {
    signalDisplayEmergencyHold(true, true, true);
    signalDisplayEmergencyHold(true, true, false);
    fireMock.mockClear();
    liveManifestHold(true, true, () => {
      signalDisplayEmergencyHold(true, true, true); // the manifest handler's own call
      signalDisplayEmergencyHold(true, true, true); // anything else inside: not live
    });
    signalDisplayEmergencyHold(true, true, true); // after it: not live
    expect(() => liveManifestHold(true, true, () => { throw new Error('boom'); })).toThrow('boom');
    signalDisplayEmergencyHold(true, true, true); // after a throw: not live
    expect(holds()).toEqual([[true, true, true], [true, true], [true, true], [true, true]]);
    expect(liveManifestHold(true, true, () => 42)).toBe(42);
  });

  it('a legacy (Taurus) transport still gets the same call; the bridge slices it to one boolean (nativeBridge legacyArgs)', () => {
    fireMock.mockReturnValue(LEGACY_OK);
    signalDisplayEmergencyHold(true, true, true);
    signalDisplayEmergencyHold(true, true, false);
    fireMock.mockClear();
    expect(liveManifestHold(true, true, () => signalDisplayEmergencyHold(true, true, true))).toBe('applied');
    expect(holds()).toEqual([[true, true, true]]);
  });
});
