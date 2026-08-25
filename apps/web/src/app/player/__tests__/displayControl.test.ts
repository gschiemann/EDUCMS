/**
 * Display control — the consumer half.
 *
 * ============================================================
 * WHAT THIS SUITE IS FOR
 * ============================================================
 *
 * The 2026-08-13 wave shipped a signed `DISPLAY_CONTROL` push, a full audit
 * trail, a `delivered:true` API response, a dashboard, and an entire native
 * control stack — and the player never consumed ANY of it. Every operator
 * click and every on/off schedule died silently at the WebView while the
 * dashboard reported success. Nothing failed; nothing happened.
 *
 * That failure is invisible to a type checker and to a build. It is only
 * visible to a test that asserts the NATIVE CALL FIRES. So the two tests
 * this suite exists for are:
 *
 *   1. a DISPLAY_CONTROL message driven through the real handler makes
 *      `nativeCall('displayApply', …)` happen;
 *   2. a CHANGED manifest display block installs, an UNCHANGED one does not.
 *
 * Everything else here guards the ways that wire can be quietly wrong: the
 * scope check, replay, the C4 recovery exemption, the array-vs-object wire
 * shape the device parser actually reads, and — at the end — a source-level
 * guard that `page.tsx` still calls these functions at all.
 */

import {
  MIN_SAFE_BRIGHTNESS_PERCENT,
  DISPLAY_BRIGHTNESS_MECHANISMS,
  isBrightnessMechanismProven,
} from '@cms/api-types';

import {
  DISPLAY_CONTROL_TYPE,
  SOFT_DIM_FLOOR_PERCENT,
  SOFT_DIM_MAX_ALPHA,
  checkDisplayControlPush,
  dispatchDisplayControl,
  displayConfigFingerprint,
  displayFrameDarkensContent,
  installDisplayConfig,
  isDisplayRecoveryAction,
  parseDisplayControlCommand,
  pickVendorRecipe,
  recipeMatchesDevice,
  softDimAlpha,
  toDeviceActionJson,
  toDeviceDisplayConfig,
} from '../displayControl';

const callMock = jest.fn();
const hasMock = jest.fn();
jest.mock('../nativeBridge', () => ({
  nativeCall: (...args: unknown[]) => callMock(...args),
  nativeHas: (...args: unknown[]) => hasMock(...args),
}));

const NOW = 1_760_000_000_000;

/** A signed envelope exactly as `DisplayService.applyAction` emits it. */
function envelope(payload: Record<string, unknown>, over: Record<string, unknown> = {}) {
  return {
    type: DISPLAY_CONTROL_TYPE,
    eventId: `evt-${Math.random().toString(36).slice(2)}`,
    timestamp: NOW,
    signature: 'deadbeef',
    payload: {
      screenId: 'screen-1',
      actionId: 'act-1',
      mechanism: 'software-dim',
      issuedAt: new Date(NOW).toISOString(),
      ...payload,
    },
    ...over,
  };
}

function ctx(seen = new Map<string, number>()) {
  return { seenEventIds: seen, serverClockOffsetMs: 0, now: () => NOW };
}

/**
 * A stand-in for the page's black overlay + live emergency state. Records
 * every `set()` so a test can assert not just the end state but that the
 * overlay was never even momentarily wrong.
 */
function sink(opts: { emergency?: boolean } = {}) {
  const calls: boolean[] = [];
  const dimCalls: number[] = [];
  let on = false;
  let dim = 0;
  let emergency = opts.emergency === true;
  return {
    calls,
    /** Every `setDim` alpha, in order — same discipline as `calls`. */
    dimCalls,
    get on() {
      return on;
    },
    get dim() {
      return dim;
    },
    setEmergency(v: boolean) {
      emergency = v;
    },
    set(next: boolean) {
      calls.push(next);
      on = next;
    },
    setDim(alpha: number) {
      dimCalls.push(alpha);
      dim = alpha;
    },
    emergencyDisplayed() {
      return emergency;
    },
  };
}

beforeEach(() => {
  callMock.mockReset();
  callMock.mockResolvedValue('{"ok":true}');
  hasMock.mockReset();
  hasMock.mockReturnValue(true);
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ═════════════════════════════════════════════════════════════════
// PROOF #1 — the push actually reaches the device
// ═════════════════════════════════════════════════════════════════
describe('END-TO-END: a DISPLAY_CONTROL push reaches the native bridge', () => {
  it('fires nativeCall(displayApply) with the JSON the APK parses', () => {
    const res = dispatchDisplayControl(
      envelope({ action: 'BLANK', revertAfterMs: 300000 }),
      'screen-1',
      ctx(),
    );

    expect(res).toEqual({ status: 'sent', action: 'BLANK' });
    expect(callMock).toHaveBeenCalledTimes(1);
    const [method, json] = callMock.mock.calls[0];
    expect(method).toBe('displayApply');
    // `DisplayControlApi.applyJson` reads exactly these keys.
    expect(JSON.parse(json as string)).toEqual({ action: 'BLANK', revertAfterMs: 300000 });
  });

  it('carries brightness + allowBlack through in the device spelling', () => {
    dispatchDisplayControl(
      envelope({ action: 'SET_BRIGHTNESS', percent: 40, allowBlack: false }),
      'screen-1',
      ctx(),
    );
    expect(JSON.parse(callMock.mock.calls[0][1] as string)).toEqual({
      action: 'SET_BRIGHTNESS',
      percent: 40,
    });
  });

  it('sends every action in the contract-C1 SCREAMING_CASE vocabulary', () => {
    for (const action of ['SET_VOLUME', 'SET_BRIGHTNESS', 'BLANK', 'WAKE', 'REBOOT']) {
      callMock.mockClear();
      const res = dispatchDisplayControl(envelope({ action, percent: 30 }), 'screen-1', ctx());
      expect(res.status).toBe('sent');
      expect(JSON.parse(callMock.mock.calls[0][1] as string).action).toBe(action);
    }
  });

  it('is a clean no-op in a desktop browser — /player runs there too', () => {
    hasMock.mockReturnValue(false);
    const res = dispatchDisplayControl(envelope({ action: 'WAKE' }), 'screen-1', ctx());
    expect(res).toEqual({ status: 'no-bridge', action: 'WAKE' });
    expect(callMock).not.toHaveBeenCalled();
  });

  it('never throws, and never lets a rejected bridge call escape', async () => {
    callMock.mockRejectedValue(new Error('bridge timeout'));
    expect(() =>
      dispatchDisplayControl(envelope({ action: 'WAKE' }), 'screen-1', ctx()),
    ).not.toThrow();
    // The same socket carries the lockdown OVERRIDE — an unhandled rejection
    // here would surface as a page-level error event.
    await Promise.resolve();
    await Promise.resolve();
  });
});

// ═════════════════════════════════════════════════════════════════
// PROOF #1c — THE OUTCOME SEAM (2026-08-25, v1.1.5)
//
// This function's return value can only ever say "handed to the APK" —
// the same not-quite-a-fact as the server's `delivered:true`, one layer
// down. The APK's real verdict (which mechanism ran, whether it took, the
// before/after backlight sample) settles LATER, on a promise that until
// now nothing was listening to: it was logged to a console on a
// wall-mounted kiosk and then lost forever. That is precisely why "the
// panel did it" and "the panel silently did nothing" were the same
// observation from the server.
// ═════════════════════════════════════════════════════════════════
describe('the device-verdict seam', () => {
  it('hands the APK verdict to the reporter when the call resolves', async () => {
    const verdicts: Array<{ raw: string | null; error?: string }> = [];
    const answer = JSON.stringify({
      ok: true,
      mechanism: 'settings',
      evidence: { changed: false, readable: true },
    });
    callMock.mockResolvedValue(answer);

    dispatchDisplayControl(
      envelope({ action: 'SET_BRIGHTNESS', percent: 40 }),
      'screen-1',
      ctx(),
      'WS',
      undefined,
      (v) => verdicts.push(v),
    );
    await Promise.resolve();
    await Promise.resolve();

    expect(verdicts).toHaveLength(1);
    expect(verdicts[0].raw).toBe(answer);
  });

  it('reports a bridge failure as a verdict rather than swallowing it', async () => {
    const verdicts: Array<{ raw: string | null; error?: string }> = [];
    callMock.mockRejectedValue(new Error('bridge timeout'));

    dispatchDisplayControl(
      envelope({ action: 'WAKE' }),
      'screen-1',
      ctx(),
      'WS',
      undefined,
      (v) => verdicts.push(v),
    );
    await Promise.resolve();
    await Promise.resolve();

    expect(verdicts).toHaveLength(1);
    expect(verdicts[0].raw).toBeNull();
    expect(verdicts[0].error).toBe('bridge timeout');
  });

  it('a throwing reporter never costs the command', async () => {
    callMock.mockResolvedValue('{"ok":true}');
    expect(() =>
      dispatchDisplayControl(envelope({ action: 'WAKE' }), 'screen-1', ctx(), 'WS', undefined, () => {
        throw new Error('reporter exploded');
      }),
    ).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
  });

  it('is optional — every existing caller behaves exactly as before', () => {
    const res = dispatchDisplayControl(envelope({ action: 'WAKE' }), 'screen-1', ctx());
    expect(res).toEqual({ status: 'sent', action: 'WAKE' });
  });
});

// ═════════════════════════════════════════════════════════════════
// PROOF #1b — THE BLANK/POWER SPLIT (live field incident, 2026-08-25)
//
// Operator contract, verbatim: "wake and blank should just do that and turn
// on and off should do that, keep them separate and make them work perfectly
// on all our models."
//
// The bug these tests exist to make unrepeatable: a plain BLANK was forwarded
// to `displayApply`, which takes an Android device-admin lock, which latched a
// Goodview G43 and a Mobile A-Frame into a vendor standby — glass dark, IR
// remote and physical power button dead, WAKE delivered and useless, mains
// power-cycle required. The A-Frame then woke ITSELF back up minutes later,
// unprompted, proving the standby is a vendor timer: unreliable in BOTH
// directions and unpredictable from any verdict (an L55VEC with a
// byte-identical verdict recovered normally).
//
// So the single load-bearing assertion in this block is:
//   A SOFT FRAME NEVER REACHES `nativeCall`.
// ═════════════════════════════════════════════════════════════════
describe('THE SPLIT: soft frames draw the overlay, hard frames drive hardware', () => {
  it('a soft BLANK shows the overlay and NEVER calls the bridge', () => {
    const s = sink();
    const res = dispatchDisplayControl(
      envelope({ action: 'BLANK', mechanism: 'web-overlay', soft: true }),
      'screen-1',
      ctx(),
      'WS',
      s,
    );
    expect(res).toEqual({ status: 'soft', action: 'BLANK', overlay: true, dim: 0 });
    expect(s.on).toBe(true);
    // ⚠️ THE ASSERTION THIS WHOLE FILE EXISTS FOR. One forwarded soft BLANK
    // is one latched panel and a drive to the site.
    expect(callMock).not.toHaveBeenCalled();
  });

  it('a soft WAKE removes the overlay and NEVER calls the bridge', () => {
    const s = sink();
    dispatchDisplayControl(
      envelope({ action: 'BLANK', soft: true }),
      'screen-1',
      ctx(),
      'WS',
      s,
    );
    const res = dispatchDisplayControl(
      envelope({ action: 'WAKE', soft: true }),
      'screen-1',
      ctx(),
      'WS',
      s,
    );
    expect(res).toEqual({ status: 'soft', action: 'WAKE', overlay: false, dim: 0 });
    expect(s.on).toBe(false);
    expect(callMock).not.toHaveBeenCalled();
  });

  it('the soft overlay HOLDS — nothing but WAKE takes it down', () => {
    // The vendor standby failed in both directions: it would not come back on
    // command AND would not stay dark on command (the A-Frame's spontaneous
    // wake). The soft blank must do neither. Nothing here — repeated polls,
    // unrelated display traffic, brightness, even a REBOOT — clears it.
    const s = sink();
    const seen = new Map<string, number>();
    dispatchDisplayControl(envelope({ action: 'BLANK', soft: true }), 'screen-1', ctx(seen), 'WS', s);
    expect(s.on).toBe(true);

    dispatchDisplayControl(
      envelope({ action: 'SET_BRIGHTNESS', percent: 80 }),
      'screen-1',
      ctx(seen),
      'WS',
      s,
    );
    dispatchDisplayControl(envelope({ action: 'REBOOT' }), 'screen-1', ctx(seen), 'WS', s);
    dispatchDisplayControl(
      envelope({ action: 'SET_VOLUME', percent: 10 }),
      'screen-1',
      ctx(seen),
      'WS',
      s,
    );
    expect(s.on).toBe(true);
    expect(s.calls).toEqual([true]); // never toggled off by anything above

    dispatchDisplayControl(envelope({ action: 'WAKE', soft: true }), 'screen-1', ctx(seen), 'WS', s);
    expect(s.on).toBe(false);
  });

  it('a soft blank works with NO native bridge at all — browser players blank too', () => {
    // This is what "perfectly on all our models" buys: the soft path has no
    // device dependency, so a browser player behaves exactly like a Goodview
    // panel. Under the old hardware blank this screen class could do nothing.
    hasMock.mockReturnValue(false);
    const s = sink();
    expect(
      dispatchDisplayControl(envelope({ action: 'BLANK', soft: true }), 'screen-1', ctx(), 'WS', s),
    ).toEqual({ status: 'soft', action: 'BLANK', overlay: true, dim: 0 });
    expect(s.on).toBe(true);
  });

  it('a HARD frame (a translated POWER_OFF) IS forwarded to the bridge', () => {
    // The server ships POWER_OFF as the legacy verb 'BLANK' + hard:true,
    // because every shipped APK parses only five verbs. `hard` is the one
    // field that separates it from a soft blank on this side.
    const s = sink();
    const res = dispatchDisplayControl(
      envelope({ action: 'BLANK', mechanism: 'vendor-recipe', hard: true }),
      'screen-1',
      ctx(),
      'WS',
      s,
    );
    expect(res).toEqual({ status: 'sent', action: 'BLANK' });
    expect(callMock).toHaveBeenCalledTimes(1);
    expect(callMock.mock.calls[0][0]).toBe('displayApply');
    // The device JSON stays exactly the four keys `applyJson` reads — the
    // wire flags are ours, not the APK's.
    expect(JSON.parse(callMock.mock.calls[0][1] as string)).toEqual({ action: 'BLANK' });
    // A hard blank must not touch the overlay either way.
    expect(s.calls).toEqual([]);
  });

  it('a HARD POWER_ON is forwarded AND clears any soft overlay', () => {
    // "Wake" means "be visible", whatever put the screen dark. Leaving a
    // black div on top of a freshly-powered panel would be its own
    // stuck-dark bug, so the un-darkening direction always clears.
    const s = sink();
    const seen = new Map<string, number>();
    dispatchDisplayControl(envelope({ action: 'BLANK', soft: true }), 'screen-1', ctx(seen), 'WS', s);
    expect(s.on).toBe(true);

    const res = dispatchDisplayControl(
      envelope({ action: 'WAKE', hard: true }),
      'screen-1',
      ctx(seen),
      'WS',
      s,
    );
    expect(res).toEqual({ status: 'sent', action: 'WAKE' });
    expect(s.on).toBe(false);
    expect(callMock).toHaveBeenCalledWith('displayApply', '{"action":"WAKE"}');
  });

  it('a FLAG-LESS frame keeps its pre-split behaviour — forwarded', () => {
    // The web bundle (Vercel) and the API (Railway) do not deploy in the
    // same instant. A frame from an API build older than the split carries
    // neither flag, and a deploy window is not the place to invent new
    // semantics: it behaves exactly as it did yesterday.
    const s = sink();
    dispatchDisplayControl(envelope({ action: 'BLANK' }), 'screen-1', ctx(), 'WS', s);
    expect(callMock).toHaveBeenCalledTimes(1);
    expect(s.calls).toEqual([]);
  });

  it('a soft frame with NO overlay wired is still never forwarded', () => {
    // Fail toward "nothing happened", never toward "the bridge got it".
    const res = dispatchDisplayControl(
      envelope({ action: 'BLANK', soft: true }),
      'screen-1',
      ctx(),
    );
    expect(res).toEqual({ status: 'no-overlay', action: 'BLANK' });
    expect(callMock).not.toHaveBeenCalled();
  });

  describe('EMERGENCY ALWAYS PUNCHES THROUGH', () => {
    it('drops a soft BLANK while emergency content is displayed', () => {
      const s = sink({ emergency: true });
      const res = dispatchDisplayControl(
        envelope({ action: 'BLANK', soft: true }),
        'screen-1',
        ctx(),
        'WS',
        s,
      );
      expect(res).toEqual({ status: 'dropped', reason: 'emergency' });
      expect(s.on).toBe(false);
      expect(callMock).not.toHaveBeenCalled();
    });

    it('force-clears an overlay that is ALREADY up when a blank arrives mid-alert', () => {
      const s = sink();
      const seen = new Map<string, number>();
      dispatchDisplayControl(envelope({ action: 'BLANK', soft: true }), 'screen-1', ctx(seen), 'WS', s);
      expect(s.on).toBe(true);

      // Lockdown lands, then a duplicate/late blank arrives behind it.
      s.setEmergency(true);
      dispatchDisplayControl(envelope({ action: 'BLANK', soft: true }), 'screen-1', ctx(seen), 'WS', s);
      expect(s.on).toBe(false);
    });

    it('drops a HARD blank during an alert too — every layer asserts it', () => {
      const s = sink({ emergency: true });
      expect(
        dispatchDisplayControl(
          envelope({ action: 'BLANK', hard: true }),
          'screen-1',
          ctx(),
          'WS',
          s,
        ),
      ).toEqual({ status: 'dropped', reason: 'emergency' });
      expect(callMock).not.toHaveBeenCalled();
    });

    it('never blocks the RECOVERY direction during an alert', () => {
      // A guard that could stop an operator lighting a screen mid-incident
      // is worse than the thing it protects against.
      const s = sink({ emergency: true });
      const seen = new Map<string, number>();
      expect(
        dispatchDisplayControl(
          envelope({ action: 'WAKE', soft: true }),
          'screen-1',
          ctx(seen),
          'WS',
          s,
        ).status,
      ).toBe('soft');
      expect(
        dispatchDisplayControl(
          envelope({ action: 'WAKE', hard: true }),
          'screen-1',
          ctx(seen),
          'WS',
          s,
        ).status,
      ).toBe('sent');
    });
  });

  it('still refuses a literal POWER_OFF verb — the APK parses five verbs', () => {
    // The server translates on the way out precisely so this never happens.
    // If one ever does arrive, dropping it loudly beats handing the bridge a
    // verb every shipped APK silently ignores.
    const s = sink();
    expect(
      dispatchDisplayControl(envelope({ action: 'POWER_OFF' }), 'screen-1', ctx(), 'WS', s),
    ).toEqual({ status: 'dropped', reason: 'bad-action' });
    expect(callMock).not.toHaveBeenCalled();
  });

  it('applies scope, signature and replay to soft frames', () => {
    const s = sink();
    const seen = new Map<string, number>();
    // Wrong screen.
    expect(
      dispatchDisplayControl(
        envelope({ action: 'BLANK', soft: true, screenId: 'someone-else' }),
        'screen-1',
        ctx(seen),
        'WS',
        s,
      ),
    ).toEqual({ status: 'dropped', reason: 'not-ours' });
    // Unsigned — the HMAC is what proves the frame came through the signer,
    // and dropping the freshness window did NOT relax it.
    expect(
      dispatchDisplayControl(
        envelope({ action: 'BLANK', soft: true }, { signature: '' }),
        'screen-1',
        ctx(seen),
        'WS',
        s,
      ),
    ).toEqual({ status: 'dropped', reason: 'unsigned' });
    // Replay across transports.
    const frame = envelope({ action: 'BLANK', soft: true });
    expect(dispatchDisplayControl(frame, 'screen-1', ctx(seen), 'WS', s).status).toBe('soft');
    expect(dispatchDisplayControl(frame, 'screen-1', ctx(seen), 'SSE', s)).toEqual({
      status: 'dropped',
      reason: 'replay',
    });
    expect(s.calls).toEqual([true]);
  });
});

// ═════════════════════════════════════════════════════════════════
// P0 REGRESSION — 2026-08-25, "no wake or blank working"
// ═════════════════════════════════════════════════════════════════
/**
 * Two independent defects took the operator's Blank button off the air on a
 * live fleet. The render-exit one is guarded in
 * `softBlankRenderExits.test.ts` (it lives in page.tsx). This is the other:
 * the freshness window, written for a device-admin BLANK, was still being
 * applied to a black `<div>`.
 */
describe('P0: a clock-skewed panel keeps its Blank button', () => {
  /**
   * The failure mode: `serverClockOffsetMs` is learned ONCE per socket at
   * AUTH_OK. An Android signage box that boots without NTP and gets stepped
   * afterwards carries a wrong offset for the life of that socket — and every
   * risk-direction frame then reads as `stale`. Before this change that
   * silently killed BLANK (and every brightness change) with nothing but a
   * console line to show for it, while WAKE kept working — which presents to
   * the operator as "blank and wake both do nothing", because a WAKE with no
   * overlay up is indistinguishable from a WAKE that did nothing.
   */
  const skewed = (seen = new Map<string, number>()) => ({
    seenEventIds: seen,
    // Ten minutes of RTC drift the AUTH_OK sample never saw.
    serverClockOffsetMs: 0,
    now: () => NOW + 10 * 60_000,
  });

  it('ACTS on a validly-signed soft BLANK ten minutes off the wall clock', () => {
    const s = sink();
    expect(
      dispatchDisplayControl(
        envelope({ action: 'BLANK', soft: true }),
        'screen-1',
        skewed(),
        'WS',
        s,
      ),
    ).toEqual({ status: 'soft', action: 'BLANK', overlay: true, dim: 0 });
    expect(s.on).toBe(true);
    // And it still never touched the hardware.
    expect(callMock).not.toHaveBeenCalled();
  });

  it('ACTS on the matching soft WAKE (recovery lane, unchanged)', () => {
    const s = sink();
    s.set(true);
    expect(
      dispatchDisplayControl(
        envelope({ action: 'WAKE', soft: true }),
        'screen-1',
        skewed(),
        'WS',
        s,
      ),
    ).toEqual({ status: 'soft', action: 'WAKE', overlay: false, dim: 0 });
    expect(s.on).toBe(false);
  });

  it('STILL refuses a skewed HARD frame — those reach real hardware', () => {
    // POWER_OFF is translated onto the legacy 'BLANK' verb + hard:true. It
    // drives a vendor backlight recipe, so a captured one replayed later is a
    // genuine attack and keeps the window it was designed for.
    const s = sink();
    expect(
      dispatchDisplayControl(
        envelope({ action: 'BLANK', hard: true }),
        'screen-1',
        skewed(),
        'WS',
        s,
      ),
    ).toEqual({ status: 'dropped', reason: 'stale' });
    expect(callMock).not.toHaveBeenCalled();
  });

  it('STILL refuses a skewed brightness change', () => {
    // Brightness reaches the panel through the APK; only the overlay left the
    // freshness lane. (A dark screen still has WAKE as its guaranteed way back.)
    expect(
      dispatchDisplayControl(
        envelope({ action: 'SET_BRIGHTNESS', percent: 10 }),
        'screen-1',
        skewed(),
        'WS',
        sink(),
      ),
    ).toEqual({ status: 'dropped', reason: 'stale' });
  });

  it('names the reason AND the numbers behind it on every drop', () => {
    // "It did nothing and said nothing" is the whole complaint. A dropped
    // frame must be self-diagnosing on the panel's own console, because the
    // dashboard's `delivered:true` only ever meant "the fan-out was up".
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    dispatchDisplayControl(
      envelope({ action: 'BLANK', hard: true }),
      'screen-1',
      skewed(),
      'WS',
      sink(),
    );
    const line = warn.mock.calls.map((c) => String(c[0])).join('\n');
    expect(line).toContain('dropped stale');
    expect(line).toContain('hard=true');
    expect(line).toContain('signed=true');
    expect(line).toMatch(/skew=\d+ms/);
    expect(line).toMatch(/offset=0ms/);
  });
});

/**
 * THE DEPLOY-WINDOW CASE. A page bundle older than the split does not know
 * the `soft` flag; the server's frame is a plain BLANK to it and it forwards
 * to the bridge — the pre-split behaviour, deliberately preserved. What must
 * NEVER happen is the inverse: a post-split page treating a soft frame as
 * forwardable, or swallowing it with a success-shaped answer.
 */
describe('a soft frame degrades VISIBLY, never silently', () => {
  it('reports no-overlay and does NOT forward when no sink is wired', () => {
    const res = dispatchDisplayControl(
      envelope({ action: 'BLANK', soft: true }),
      'screen-1',
      ctx(),
      'WS',
      undefined, // a caller that forgot the 5th argument
    );
    expect(res).toEqual({ status: 'no-overlay', action: 'BLANK' });
    // Forwarding is the original brick. It must not happen even here.
    expect(callMock).not.toHaveBeenCalled();
  });

  it('says so out loud rather than answering "sent"', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    dispatchDisplayControl(
      envelope({ action: 'BLANK', soft: true }),
      'screen-1',
      ctx(),
      'WS',
      undefined,
    );
    expect(warn.mock.calls.map((c) => String(c[0])).join('\n')).toContain('had nowhere to go');
  });

  it('a flag-less frame from a pre-split API still drives the bridge', () => {
    // The other half of the deploy window. Behaviour during a Vercel/Railway
    // skew must not be invented — a frame with neither flag is exactly what
    // it was before the split.
    const res = dispatchDisplayControl(
      envelope({ action: 'BLANK' }),
      'screen-1',
      ctx(),
      'WS',
      sink(),
    );
    expect(res).toEqual({ status: 'sent', action: 'BLANK' });
    expect(callMock).toHaveBeenCalledWith('displayApply', '{"action":"BLANK"}');
  });
});

// ═════════════════════════════════════════════════════════════════
// PROOF #1c — THE BRIGHTNESS SPLIT (field evidence, 2026-08-25)
//
// The operator's brightness slider worked on two panels and was dead on
// two. Each panel's own hardware probe says exactly why:
//
//   M43      /sys/class/backlight/aml-bl    writable:true  → sysfs-backlight
//   L55VEC   /sys/class/backlight/aml-bl    writable:true  → sysfs-backlight
//   G43      /sys/class/backlight/aml-bl    writable:false → settings
//   A-Frame  /sys/class/backlight/backlight writable:false → settings
//
// The two `settings` panels are the dead ones — and the write SUCCEEDS
// (G43's stored screen_brightness reads 102, not 255); the vendor firmware
// just ignores it for the real backlight. A mechanism that reports success
// and does nothing to the glass: the blank incident's signature, one axis
// over. These tests pin the routing and the safety floor of the soft dim
// that replaces it.
// ═════════════════════════════════════════════════════════════════
describe('THE BRIGHTNESS SPLIT: proven mechanisms drive hardware, the rest dim softly', () => {
  it('a SOFT brightness frame dims the overlay and NEVER reaches the bridge', () => {
    const s = sink();
    const res = dispatchDisplayControl(
      envelope({ action: 'SET_BRIGHTNESS', percent: 40, soft: true }),
      'screen-1',
      ctx(),
      'WS',
      s,
    );
    expect(res.status).toBe('soft');
    expect(s.dimCalls).toEqual([softDimAlpha(40)]);
    expect(s.dim).toBeGreaterThan(0);
    // Forwarding is the whole bug: `settings` is the mechanism that lies.
    expect(callMock).not.toHaveBeenCalled();
  });

  it('a HARD brightness frame is untouched — M43 / L55VEC keep working', () => {
    const s = sink();
    const res = dispatchDisplayControl(
      envelope({ action: 'SET_BRIGHTNESS', percent: 40, mechanism: 'sysfs-backlight' }),
      'screen-1',
      ctx(),
      'WS',
      s,
    );
    expect(res).toEqual({ status: 'sent', action: 'SET_BRIGHTNESS' });
    expect(callMock).toHaveBeenCalledWith(
      'displayApply',
      '{"action":"SET_BRIGHTNESS","percent":40}',
    );
    // And no overlay is drawn on a panel whose backlight really moves.
    expect(s.dimCalls).toEqual([]);
  });

  it('100% clears the dim entirely — a raise is the recovery direction', () => {
    const s = sink();
    dispatchDisplayControl(
      envelope({ action: 'SET_BRIGHTNESS', percent: 10, soft: true }),
      'screen-1',
      ctx(),
      'WS',
      s,
    );
    expect(s.dim).toBeGreaterThan(0);
    dispatchDisplayControl(
      envelope({ action: 'SET_BRIGHTNESS', percent: 100, soft: true }, { eventId: 'e2' }),
      'screen-1',
      ctx(),
      'WS',
      s,
    );
    expect(s.dim).toBe(0);
  });

  it('a soft dim can NEVER reach black — not even at 0% with allowBlack', () => {
    // A slider is not a blank. A wall-mounted panel that goes black because
    // someone nudged one is the truck roll this whole feature exists to
    // avoid, and `allowBlack` opts out of the HARDWARE floor — there is no
    // hardware on this path to opt out of.
    for (const percent of [0, 1, 5, -20]) {
      expect(softDimAlpha(percent)).toBeLessThanOrEqual(SOFT_DIM_MAX_ALPHA);
      expect(softDimAlpha(percent)).toBeLessThan(1);
    }
    const s = sink();
    dispatchDisplayControl(
      envelope({ action: 'SET_BRIGHTNESS', percent: 0, allowBlack: true, soft: true }),
      'screen-1',
      ctx(),
      'WS',
      s,
    );
    expect(s.dim).toBe(SOFT_DIM_MAX_ALPHA);
    expect(s.dim).toBeLessThan(1);
    // …and it never flips the OPAQUE state, which is the only thing that
    // fully covers content.
    expect(s.on).toBe(false);
  });

  it('ramps monotonically between the floor and 100%', () => {
    expect(softDimAlpha(100)).toBe(0);
    expect(softDimAlpha(SOFT_DIM_FLOOR_PERCENT)).toBe(SOFT_DIM_MAX_ALPHA);
    let prev = softDimAlpha(SOFT_DIM_FLOOR_PERCENT);
    for (let p = SOFT_DIM_FLOOR_PERCENT + 5; p <= 100; p += 5) {
      const a = softDimAlpha(p);
      expect(a).toBeLessThanOrEqual(prev);
      prev = a;
    }
  });

  it('treats a missing / malformed percent as NO dim — malformed must fail bright', () => {
    expect(softDimAlpha(undefined)).toBe(0);
    expect(softDimAlpha(null)).toBe(0);
    expect(softDimAlpha(Number.NaN)).toBe(0);
    expect(softDimAlpha(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('pins the soft floor to the contract floor', () => {
    // displayControl.ts declares this locally to keep zod out of the player
    // bundle. This assertion is what stops the two drifting apart.
    expect(SOFT_DIM_FLOOR_PERCENT).toBe(MIN_SAFE_BRIGHTNESS_PERCENT);
  });

  it('WAKE clears the DIM as well as the blank, in BOTH lanes', () => {
    // Soft lane.
    const s = sink();
    dispatchDisplayControl(
      envelope({ action: 'SET_BRIGHTNESS', percent: 20, soft: true }),
      'screen-1',
      ctx(),
      'WS',
      s,
    );
    expect(s.dim).toBeGreaterThan(0);
    dispatchDisplayControl(
      envelope({ action: 'WAKE', soft: true }, { eventId: 'e2' }),
      'screen-1',
      ctx(),
      'WS',
      s,
    );
    expect(s.dim).toBe(0);

    // Hard lane (a translated POWER_ON). Same guarantee — "wake" means "be
    // visible", and a dim left behind a freshly-powered panel is its own
    // stuck-dark bug with no way for the operator to tell it from a fault.
    const h = sink();
    dispatchDisplayControl(
      envelope({ action: 'SET_BRIGHTNESS', percent: 20, soft: true }, { eventId: 'e3' }),
      'screen-1',
      ctx(),
      'WS',
      h,
    );
    expect(h.dim).toBeGreaterThan(0);
    dispatchDisplayControl(
      envelope({ action: 'WAKE', hard: true }, { eventId: 'e4' }),
      'screen-1',
      ctx(),
      'WS',
      h,
    );
    expect(h.dim).toBe(0);
  });

  it('DROPS a darkening soft brightness while an emergency is displayed', () => {
    const s = sink({ emergency: true });
    const res = dispatchDisplayControl(
      envelope({ action: 'SET_BRIGHTNESS', percent: 20, soft: true }),
      'screen-1',
      ctx(),
      'WS',
      s,
    );
    expect(res).toEqual({ status: 'dropped', reason: 'emergency' });
    // And it force-clears whatever was already up, rather than waiting for
    // the page's own effect — an alert must never be painted behind a film,
    // even for a frame.
    expect(s.dimCalls).toEqual([0]);
    expect(s.calls).toEqual([false]);
    expect(callMock).not.toHaveBeenCalled();
  });

  it('does NOT drop a soft brightness that draws no dim at all', () => {
    // 100% is not a darkening frame — refusing it would mean an operator
    // could not brighten a screen mid-incident, which is worse than the risk.
    const s = sink({ emergency: true });
    const res = dispatchDisplayControl(
      envelope({ action: 'SET_BRIGHTNESS', percent: 100, soft: true }),
      'screen-1',
      ctx(),
      'WS',
      s,
    );
    expect(res.status).toBe('soft');
    expect(s.dim).toBe(0);
  });

  it('leaves a HARD brightness frame to the server + APK interlocks', () => {
    // Scoped on purpose: the APK holds a native emergency hold and the
    // server refuses the darkening direction before publishing. Extending
    // the client drop to hard frames would change behaviour on the panels
    // that work today, for a case already closed twice.
    const cmd = parseDisplayControlCommand({ action: 'SET_BRIGHTNESS', percent: 10 });
    expect(displayFrameDarkensContent(cmd!)).toBe(false);
    const soft = parseDisplayControlCommand({
      action: 'SET_BRIGHTNESS',
      percent: 10,
      soft: true,
    });
    expect(displayFrameDarkensContent(soft!)).toBe(true);
  });

  it('reports no-overlay for a soft brightness with no sink — never forwards', () => {
    const res = dispatchDisplayControl(
      envelope({ action: 'SET_BRIGHTNESS', percent: 30, soft: true }),
      'screen-1',
      ctx(),
      'WS',
      undefined,
    );
    expect(res).toEqual({ status: 'no-overlay', action: 'SET_BRIGHTNESS' });
    expect(callMock).not.toHaveBeenCalled();
  });

  it('routes exactly the field-proven mechanisms to hardware, nothing else', () => {
    // THE ROUTING MATRIX, straight off the four field panels. If a future
    // provider id is added to the contract without a decision about whether
    // it actually moves a backlight, this fails rather than silently
    // assuming it does.
    const expected: Record<string, boolean> = {
      'vendor-recipe': true, // named-node write, percent-derived + validated
      'sysfs-backlight': true, // M43 / L55VEC — writable aml-bl
      sysfs: true, // same thing, probe's heuristic spelling
      settings: false, // G43 / A-Frame — write succeeds, glass does not move
      'software-dim': false, // the soft path by definition
    };
    for (const m of DISPLAY_BRIGHTNESS_MECHANISMS) {
      expect([m, isBrightnessMechanismProven(m)]).toEqual([m, expected[m]]);
    }
    // Every mechanism in the contract is accounted for above — a new one
    // added without a row here is a gap, not a default.
    expect(Object.keys(expected).sort()).toEqual([...DISPLAY_BRIGHTNESS_MECHANISMS].sort());
    // Unknown / absent fails toward the path that provably does something.
    expect(isBrightnessMechanismProven(undefined)).toBe(false);
    expect(isBrightnessMechanismProven(null)).toBe(false);
    expect(isBrightnessMechanismProven('something-new')).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════
// PROOF #2 — the manifest display block installs, and only on change
// ═════════════════════════════════════════════════════════════════
describe('END-TO-END: the manifest display block installs on the device', () => {
  /** Exactly what `buildDisplayManifestBlock` emits. */
  const BLOCK = {
    schedules: [
      {
        id: 'sched-1',
        daysOfWeek: [1, 2, 3, 4, 5],
        onTime: '07:00',
        offTime: '22:00',
        timezone: 'America/Los_Angeles',
        scope: 'screen',
      },
    ],
    brightness: { minSafePercent: 5, allowBlack: false },
    vendorRecipes: [],
  };

  it('installs a CHANGED block via nativeCall(displaySetSchedule)', () => {
    const fpRef = { current: '' };
    const res = installDisplayConfig(BLOCK, {}, fpRef);

    expect(res).toEqual({ status: 'installed', schedules: 1, recipe: null });
    expect(callMock).toHaveBeenCalledTimes(1);
    expect(callMock.mock.calls[0][0]).toBe('displaySetSchedule');

    // The shape `DisplayConfigParser.parse` reads, not the API's shape.
    const sent = JSON.parse(callMock.mock.calls[0][1] as string);
    expect(sent.version).toBe(1);
    expect(sent.schedules).toHaveLength(1);
    expect(sent.schedules[0]).toMatchObject({
      id: 'sched-1',
      daysOfWeek: [1, 2, 3, 4, 5], // contract C2: 0=Sunday..6=Saturday
      onTime: '07:00',
      offTime: '22:00',
      timezone: 'America/Los_Angeles',
    });
  });

  it('does NOT re-install an UNCHANGED block on the next poll', () => {
    const fpRef = { current: '' };
    installDisplayConfig(BLOCK, {}, fpRef);
    expect(callMock).toHaveBeenCalledTimes(1);

    callMock.mockClear();
    // The manifest carries the block on every 5–10 s poll; `setScheduleJson`
    // re-persists, re-resolves the provider chain and re-arms an
    // AlarmManager every call, so re-installing identical content would
    // churn SharedPreferences and the alarm forever.
    for (let i = 0; i < 5; i += 1) {
      expect(installDisplayConfig(JSON.parse(JSON.stringify(BLOCK)), {}, fpRef)).toEqual({
        status: 'unchanged',
      });
    }
    expect(callMock).not.toHaveBeenCalled();
  });

  it('re-installs once the operator edits a window', () => {
    const fpRef = { current: '' };
    installDisplayConfig(BLOCK, {}, fpRef);
    callMock.mockClear();

    const edited = {
      ...BLOCK,
      schedules: [{ ...BLOCK.schedules[0], offTime: '23:30' }],
    };
    expect(installDisplayConfig(edited, {}, fpRef).status).toBe('installed');
    expect(JSON.parse(callMock.mock.calls[0][1] as string).schedules[0].offTime).toBe('23:30');
  });

  it('does NOTHING when the block is absent — never disarms a schedule', () => {
    // The EMERGENCY manifest branch and older cached payloads omit `display`.
    // Reading that as "no schedules" would wipe a screen's overnight windows
    // during a lockdown.
    const fpRef = { current: 'previously-installed' };
    expect(installDisplayConfig(undefined, {}, fpRef)).toEqual({ status: 'absent' });
    expect(installDisplayConfig(null, {}, fpRef)).toEqual({ status: 'absent' });
    expect(callMock).not.toHaveBeenCalled();
    expect(fpRef.current).toBe('previously-installed');
  });

  it('rolls the fingerprint back when the device rejects the install', async () => {
    callMock.mockRejectedValue(new Error('insecure-transport'));
    const fpRef = { current: '' };
    installDisplayConfig(BLOCK, {}, fpRef);
    await Promise.resolve();
    await Promise.resolve();
    // Rolled back, so the next poll retries rather than believing it landed.
    expect(fpRef.current).toBe('');
  });

  it('installs as soon as a late-attaching bridge appears', () => {
    // Must NOT latch on no-bridge: "the bridge was not ready the first time
    // we saw this block, so never install it" is a silently dead schedule —
    // the exact failure class this module exists to kill.
    hasMock.mockReturnValue(false);
    const fpRef = { current: '' };
    expect(installDisplayConfig(BLOCK, {}, fpRef)).toEqual({ status: 'no-bridge' });
    expect(callMock).not.toHaveBeenCalled();
    expect(fpRef.current).toBe('');

    hasMock.mockReturnValue(true);
    expect(installDisplayConfig(BLOCK, {}, fpRef).status).toBe('installed');
    expect(callMock).toHaveBeenCalledTimes(1);
  });
});

// ═════════════════════════════════════════════════════════════════
// The wire shape the device parser actually reads
// ═════════════════════════════════════════════════════════════════
describe('manifest block → DisplayConfigParser shape', () => {
  it('collapses the vendorRecipes ARRAY into the single `recipe` OBJECT', () => {
    // The device reads `root.optJSONObject("recipe")`; the API ships a
    // catalog. Without this translation VendorRecipeProvider — the top of the
    // BRIGHTNESS and BLANK/WAKE chains — could never activate.
    const cfg = toDeviceDisplayConfig(
      {
        schedules: [],
        vendorRecipes: [
          {
            vendorId: 'tcl-panel',
            priority: 1,
            recipe: { vendorId: 'tcl-panel', match: { manufacturer: 'TCL' } },
          },
          {
            vendorId: 'goodview-ecbox',
            priority: 5,
            recipe: { vendorId: 'goodview-ecbox', match: { manufacturer: 'Goodview' } },
          },
        ],
      },
      { manufacturer: 'Goodview', model: 'ECBox3576', board: 'rk3288' },
    );
    expect(cfg?.recipe).toMatchObject({ vendorId: 'goodview-ecbox' });
    // …and the catalog rides along untouched for a future array-aware parser.
    expect(Array.isArray(cfg?.vendorRecipes)).toBe(true);
  });

  it('NEVER synthesises brightness.defaultPercent from minSafePercent', () => {
    // They are different quantities. Mapping the 5% floor onto the default
    // would drive every screen in the fleet to 5% the moment schedules land.
    const cfg = toDeviceDisplayConfig(
      { schedules: [], brightness: { minSafePercent: 5, allowBlack: false } },
      {},
    );
    expect(cfg?.brightness).toEqual({ minSafePercent: 5, allowBlack: false });
    expect(cfg?.brightness).not.toHaveProperty('defaultPercent');
  });

  it('passes a server-sent defaultPercent straight through', () => {
    const cfg = toDeviceDisplayConfig(
      { schedules: [], brightness: { minSafePercent: 5, defaultPercent: 80 } },
      {},
    );
    expect(cfg?.brightness).toMatchObject({ defaultPercent: 80 });
  });

  it('returns null for a missing / non-object block', () => {
    expect(toDeviceDisplayConfig(undefined)).toBeNull();
    expect(toDeviceDisplayConfig(null)).toBeNull();
    expect(toDeviceDisplayConfig('nope')).toBeNull();
    expect(toDeviceDisplayConfig([])).toBeNull();
  });

  it('drops junk schedule entries without losing the good ones', () => {
    const cfg = toDeviceDisplayConfig(
      { schedules: [null, 'x', { id: 'a', onTime: '07:00', offTime: '22:00', daysOfWeek: [0] }] },
      {},
    );
    expect(cfg?.schedules).toHaveLength(1);
    expect(cfg?.schedules[0]).toMatchObject({ id: 'a' });
  });
});

describe('vendor-recipe matching mirrors Kotlin RecipeMatch.matches', () => {
  it('an all-null match matches every device (that is a universal recipe)', () => {
    expect(recipeMatchesDevice({}, {})).toBe(true);
    expect(recipeMatchesDevice(undefined, { manufacturer: 'TCL' })).toBe(true);
  });

  it('matches case-insensitively, but EXACTLY — never on a substring', () => {
    // Case-insensitive equality, exactly as Kotlin's
    // `RecipeMatch.matches` does with `equals(ignoreCase = true)`.
    expect(recipeMatchesDevice({ manufacturer: 'goodview' }, { manufacturer: 'Goodview' }))
      .toBe(true);

    // ⚠️ THIS TEST USED TO ASSERT THE OPPOSITE (2026-08-14). It was titled
    // "matches on a substring" inside a describe block claiming to mirror
    // Kotlin — while Kotlin does exact equality. So the test pinned a real
    // defect: the web layer would select a recipe the device then silently
    // refused, dropping the vendor step to the software floor with no signal
    // anywhere the operator could see.
    expect(recipeMatchesDevice({ manufacturer: 'goodview' }, { manufacturer: 'Goodview Inc' }))
      .toBe(false);

    // And the reason substring matching is dangerous rather than merely
    // wrong: 'M43' is a real screen name in the pilot fleet and
    // 'M43GUQ-CS1382D-C' is a real, DIFFERENT box's model. A substring rule
    // would fire one SKU's vendor broadcasts at the other's panel.
    expect(recipeMatchesDevice({ model: 'M43' }, { model: 'M43GUQ-CS1382D-C' }))
      .toBe(false);
  });

  it('refuses when a constrained field is unknown on this device', () => {
    // Guessing would hand a Goodview broadcast to a TCL panel. The device
    // re-checks, but not shipping it is better than shipping and relying on
    // the second check.
    expect(recipeMatchesDevice({ board: 'rk3288' }, { manufacturer: 'Goodview' })).toBe(false);
  });

  it('breaks a priority tie deterministically so two identical screens agree', () => {
    const catalog = [
      { vendorId: 'zeta', priority: 3, recipe: { vendorId: 'zeta' } },
      { vendorId: 'alpha', priority: 3, recipe: { vendorId: 'alpha' } },
    ];
    expect(pickVendorRecipe(catalog, {})).toMatchObject({ vendorId: 'alpha' });
    expect(pickVendorRecipe([...catalog].reverse(), {})).toMatchObject({ vendorId: 'alpha' });
  });

  it('fills a missing nested vendorId from the catalog row (the device rejects a blank one)', () => {
    expect(pickVendorRecipe([{ vendorId: 'goodview', priority: 0, recipe: {} }], {}))
      .toMatchObject({ vendorId: 'goodview' });
  });

  it('changes the fingerprint when the PICK changes, not when the catalog does', () => {
    const block = {
      schedules: [],
      vendorRecipes: [
        { vendorId: 'gv', priority: 1, recipe: { vendorId: 'gv', match: { manufacturer: 'Goodview' } } },
      ],
    };
    const unknownBox = displayConfigFingerprint(toDeviceDisplayConfig(block, {}));
    const goodviewBox = displayConfigFingerprint(
      toDeviceDisplayConfig(block, { manufacturer: 'Goodview' }),
    );
    // This is what makes the identity arriving late (the probe runs 8 s after
    // paint) self-heal on the very next manifest poll.
    expect(unknownBox).not.toBe(goodviewBox);
  });
});

// ═════════════════════════════════════════════════════════════════
// The transport gate
// ═════════════════════════════════════════════════════════════════
describe('the DISPLAY_CONTROL transport gate', () => {
  it('fails CLOSED on a frame addressed to another screen', () => {
    const res = dispatchDisplayControl(
      envelope({ action: 'BLANK', screenId: 'someone-else' }),
      'screen-1',
      ctx(),
    );
    expect(res).toEqual({ status: 'dropped', reason: 'not-ours' });
    expect(callMock).not.toHaveBeenCalled();
  });

  it('fails CLOSED when the payload names no screen at all', () => {
    const e = envelope({ action: 'BLANK' });
    delete (e.payload as Record<string, unknown>).screenId;
    expect(dispatchDisplayControl(e, 'screen-1', ctx()).status).toBe('dropped');
  });

  it('refuses a verb the device does not implement', () => {
    expect(dispatchDisplayControl(envelope({ action: 'FACTORY_RESET' }), 'screen-1', ctx()))
      .toEqual({ status: 'dropped', reason: 'bad-action' });
  });

  it('dedupes a replay across BOTH transports via the shared LRU', () => {
    const seen = new Map<string, number>();
    const frame = envelope({ action: 'BLANK' });
    expect(dispatchDisplayControl(frame, 'screen-1', ctx(seen), 'WS').status).toBe('sent');
    // Same signed frame captured off WS and replayed on SSE.
    expect(dispatchDisplayControl(frame, 'screen-1', ctx(seen), 'SSE')).toEqual({
      status: 'dropped',
      reason: 'replay',
    });
    expect(callMock).toHaveBeenCalledTimes(1);
  });

  describe('contract C4 — fail-closed for risk, fail-open for recovery', () => {
    it('drops an UNSIGNED blank', () => {
      const e = envelope({ action: 'BLANK' }, { signature: '' });
      expect(dispatchDisplayControl(e, 'screen-1', ctx())).toEqual({
        status: 'dropped',
        reason: 'unsigned',
      });
    });

    it('drops a STALE flag-less BLANK — that one still reaches hardware', () => {
      // No `soft` flag = a pre-split frame = forwarded to `displayApply` =
      // a device-admin lock on real glass. Replaying a captured one hours
      // later is the attack the window was built for, so it keeps the window.
      // (The SOFT pair left this lane in the 2026-08-25 second pass — see the
      // "clock-skewed panel keeps its Blank button" block above.)
      const e = envelope({ action: 'BLANK' }, { timestamp: NOW - 10 * 60_000 });
      expect(dispatchDisplayControl(e, 'screen-1', ctx())).toEqual({
        status: 'dropped',
        reason: 'stale',
      });
    });

    it('drops a stale brightness change (risk direction on this side)', () => {
      const e = envelope({ action: 'SET_BRIGHTNESS', percent: 10 }, { timestamp: NOW - 120_000 });
      expect(dispatchDisplayControl(e, 'screen-1', ctx()).status).toBe('dropped');
    });

    it('DELIVERS a stale WAKE — a dark screen must always be recoverable', () => {
      // The whole point of C4. A clock-skewed Android box that never got
      // AUTH_OK would otherwise drop the one command that brings a blanked
      // wall-mounted screen back, and there is no other way to reach it.
      const e = envelope({ action: 'WAKE' }, { timestamp: NOW - 6 * 60 * 60_000 });
      expect(dispatchDisplayControl(e, 'screen-1', ctx())).toEqual({
        status: 'sent',
        action: 'WAKE',
      });
      expect(callMock).toHaveBeenCalledWith('displayApply', '{"action":"WAKE"}');
    });

    it('DELIVERS an unsigned WAKE for the same reason', () => {
      const e = envelope({ action: 'WAKE' }, { signature: undefined });
      expect(dispatchDisplayControl(e, 'screen-1', ctx()).status).toBe('sent');
    });

    it('still scope-checks and dedupes a WAKE', () => {
      const seen = new Map<string, number>();
      const e = envelope({ action: 'WAKE' });
      expect(dispatchDisplayControl(e, 'other', ctx(seen)).status).toBe('dropped');
      expect(dispatchDisplayControl(e, 'screen-1', ctx(seen)).status).toBe('sent');
      expect(dispatchDisplayControl(e, 'screen-1', ctx(seen)).status).toBe('dropped');
    });

    it('marks the verdict recovery-vs-risk explicitly', () => {
      expect(checkDisplayControlPush(envelope({ action: 'WAKE' }), 'screen-1', ctx()))
        .toEqual({ accepted: true, recovery: true });
      expect(checkDisplayControlPush(envelope({ action: 'BLANK' }), 'screen-1', ctx()))
        .toEqual({ accepted: true, recovery: false });
      expect(isDisplayRecoveryAction('wake')).toBe(true);
      expect(isDisplayRecoveryAction('BLANK')).toBe(false);
    });
  });
});

describe('payload normalisation', () => {
  it('clamps revertAfterMs to the 1 s … 1 h window both other halves use', () => {
    expect(parseDisplayControlCommand({ action: 'BLANK', revertAfterMs: 10 })?.revertAfterMs)
      .toBe(1000);
    expect(parseDisplayControlCommand({ action: 'BLANK', revertAfterMs: 99_999_999 })?.revertAfterMs)
      .toBe(3_600_000);
  });

  it('never forwards a NaN/Infinity percent (it would serialise to null → 0)', () => {
    expect(parseDisplayControlCommand({ action: 'SET_BRIGHTNESS', percent: NaN }))
      .toEqual({ action: 'SET_BRIGHTNESS' });
    expect(parseDisplayControlCommand({ action: 'SET_BRIGHTNESS', percent: Infinity }))
      .toEqual({ action: 'SET_BRIGHTNESS' });
  });

  it('omits allowBlack unless it is literally true', () => {
    expect(toDeviceActionJson({ action: 'SET_BRIGHTNESS', percent: 0 }))
      .toBe('{"action":"SET_BRIGHTNESS","percent":0}');
    expect(toDeviceActionJson({ action: 'SET_BRIGHTNESS', percent: 0, allowBlack: true }))
      .toBe('{"action":"SET_BRIGHTNESS","percent":0,"allowBlack":true}');
  });
});

// ═════════════════════════════════════════════════════════════════
// ⚠️ THE GUARD FOR THE ORIGINAL DEFECT
// ═════════════════════════════════════════════════════════════════
/**
 * Every test above can pass while the feature is still 100% dead, because
 * the whole bug was that `page.tsx` never CALLED any of this. Same class of
 * failure the nativeBridge drift guard catches, and the same remedy: read
 * the real source off disk and assert the wiring exists.
 */
describe('page.tsx is actually wired to this module', () => {
  const src = (() => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = jest.requireActual('fs') as typeof import('fs');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const path = jest.requireActual('path') as typeof import('path');
    return fs.readFileSync(path.resolve(__dirname, '../page.tsx'), 'utf8');
  })();

  it('imports the dispatcher and the installer', () => {
    expect(src).toMatch(/from '\.\/displayControl'/);
    expect(src).toContain('dispatchDisplayControl');
    expect(src).toContain('installDisplayConfig');
  });

  it('has a DISPLAY_CONTROL arm on the WebSocket consumer', () => {
    expect(src).toMatch(/msg\.type === DISPLAY_CONTROL_TYPE/);
  });

  it('has a DISPLAY_CONTROL listener on the SSE consumer', () => {
    // The SSE tier exists for screens behind a WS-blocking school proxy; a
    // realtime feature wired on one transport silently no-ops for all of them.
    expect(src).toMatch(/addEventListener\(DISPLAY_CONTROL_TYPE/);
  });

  it('installs the manifest display block from applyManifest', () => {
    expect(src).toMatch(/installDisplayConfig\(\s*manifest\.display/);
  });

  it('does not release the emergency hold off a CACHED manifest', () => {
    // A cached manifest is not the server of record. Releasing off it would
    // drop a live hold every time the network blipped during a lockdown.
    expect(src).toMatch(/if \(holdNow \|\| !fromCache\) signalDisplayEmergencyHold/);
    expect(src).toMatch(/applyManifest\(cached\.m, true\)/);
  });

  // ── The 2026-08-25 split: the overlay half is IN THE PAGE ────────────
  // Every soft-frame test above can pass while Blank does nothing on the
  // glass, because the overlay itself lives here. Same guard, same reason.

  it('hands dispatchDisplayControl the soft-blank sink', () => {
    // Without this 5th argument every soft frame returns 'no-overlay' and
    // the operator's Blank button is a no-op on every screen in the fleet.
    expect(src).toMatch(/softBlankSinkRef\.current/);
  });

  it('renders a black overlay gated on the soft-blank state', () => {
    expect(src).toMatch(/data-edu-soft-blank/);
    // Hoisted to a single `softBlankOverlay` const (2026-08-25 second pass) so
    // that EVERY render exit can render the same node — see
    // `softBlankRenderExits.test.ts`, which is the guard that matters.
    expect(src).toMatch(/const softBlankOverlay\s*=/);
  });

  it('confirms the overlay actually PAINTED after a soft blank', () => {
    // The bug was never "the state did not flip" — it was "the state flipped
    // and no pixel changed". `softBlank === true` is not evidence; the DOM
    // node is. The page attaches a ref to the div and, a beat after every
    // accepted soft BLANK, checks it and screams if it is missing.
    expect(src).toMatch(/ref=\{softBlankNodeRef\}/);
    // The message interpolates BLANK / DIM (the brightness split reuses this
    // same alarm), so the stable half is what we pin.
    expect(src).toMatch(/ACCEPTED BUT NOT PAINTED/);
  });

  it('extends the paint proof to the soft DIM as well', () => {
    // A dim that reports success and paints nothing is the same lie as a
    // blank that does — on the axis the operator was actually complaining
    // about. The alarm must not early-return just because the BLANK state is
    // false while a dim is up.
    expect(src).toMatch(/softDimRef\.current === 0/);
  });

  it('renders the dim through the SAME node as the blank', () => {
    // One node = one render-exit rule, one paint proof, one emergency clear.
    // A second stacking layer would need all three duplicated, and the
    // duplicate is what rots.
    expect(src).toMatch(/data-edu-soft-dim/);
    expect(src).toMatch(/opacity: softBlank \? 1 : softDim/);
  });

  it('lets a DIM through to touches, and a BLANK swallow them', () => {
    // A blanked kiosk must behave off. A dimmed one is still readable and
    // still meant to be usable, so the film has to be transparent to
    // hit-testing — an inert screen would read as a broken screen.
    expect(src).toMatch(/pointerEvents: softBlank \? 'auto' : 'none'/);
  });

  it('records every display verdict where a human can read it', () => {
    // `delivered:true` from the API only means the fan-out was up. The panel
    // is the only witness to what actually happened, so it keeps a rolling
    // log on the same kind of diagnostic global the sync work established.
    expect(src).toMatch(/__eduDisplayControl/);
  });

  it('never lets the overlay paint over an emergency', () => {
    // The render condition is the LAST of three independent guarantees (the
    // dispatch-time drop and the state-edge effect are the other two).
    expect(src).toMatch(
      /\(softBlank \|\| softDim > 0\) && !activeEmergency && !pushedEmergencyMessage/,
    );
    // The state-edge effect force-clears BOTH states — a translucent film
    // over a lockdown notice is contrast taken away from the one thing on
    // that screen that matters.
    const edge = src.slice(src.indexOf('if (activeEmergency || pushedEmergencyMessage) {'));
    expect(edge.slice(0, 400)).toMatch(/applySoftBlank\(false\)/);
    expect(edge.slice(0, 400)).toMatch(/applySoftDim\(0\)/);
  });

  it('positions the overlay with LONGHAND sides — Taurus is Chromium 83', () => {
    // CLAUDE.md #10: the CSS four-side shorthand (and its Tailwind utility)
    // is Chrome 87+. On a NovaStar Taurus it is silently dropped and the
    // absolutely-positioned box collapses to 0×0 — and a blank overlay that
    // renders 0×0 is a Blank button that does nothing on exactly the
    // hardware this feature exists for.
    //
    // ⚠️ THE BANNED SPELLINGS ARE NEVER WRITTEN OUT IN THIS FILE. Both the
    // pre-commit hook (a literal grep) and `check-taurus-safety.cjs` scan
    // the whole player directory INCLUDING tests, so quoting the forbidden
    // text — even inside a comment explaining it — trips the very guard this
    // test backs up. It cost one blocked commit to learn; hence the regex is
    // assembled from a fragment rather than spelled.
    const overlay = src.slice(
      src.indexOf('data-edu-soft-blank'),
      src.indexOf('data-edu-soft-blank') + 700,
    );
    expect(overlay).toMatch(/top: 0/);
    expect(overlay).toMatch(/right: 0/);
    expect(overlay).toMatch(/bottom: 0/);
    expect(overlay).toMatch(/left: 0/);
    // `\bins` + `et\b` — the word boundary catches BOTH forbidden forms,
    // the CSS shorthand and the hyphenated Tailwind utility.
    const FORBIDDEN = new RegExp('\\bins' + 'et\\b');
    expect(overlay).not.toMatch(FORBIDDEN);
  });

  it('stacks the overlay BELOW the emergency overlay', () => {
    // EmergencyOverlay renders at z-[9999]. Life safety always wins the
    // stacking contest, even if every other guarantee failed at once.
    const overlay = src.slice(
      src.indexOf('data-edu-soft-blank'),
      src.indexOf('data-edu-soft-blank') + 700,
    );
    const z = /zIndex:\s*(\d+)/.exec(overlay);
    expect(z).not.toBeNull();
    expect(Number(z![1])).toBeLessThan(9999);
  });
});
