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
  DISPLAY_CONTROL_TYPE,
  checkDisplayControlPush,
  dispatchDisplayControl,
  displayConfigFingerprint,
  installDisplayConfig,
  isDisplayRecoveryAction,
  parseDisplayControlCommand,
  pickVendorRecipe,
  recipeMatchesDevice,
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

    it('drops a STALE blank — a captured BLANK must not replay hours later', () => {
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
});
