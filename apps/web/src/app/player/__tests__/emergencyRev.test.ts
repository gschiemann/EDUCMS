/**
 * Unit tests for the player's emergency-revision decision layer.
 *
 * The property that matters most and is asserted from several directions:
 * NO failure mode of the revision poll may stop the player from reconciling.
 * Every unusable answer — network error, 5xx, 4xx, garbage body, a 304 with
 * no baseline — must resolve to a full `fetchContent()` at the current
 * cadence, i.e. exactly the behaviour that shipped before this endpoint
 * existed.
 */

import {
  classifyRevPoll,
  decideRevAction,
  revPollCadenceMs,
  reconcileCadenceMs,
  emergencyRevPath,
  alertFromRevEnvelope,
  REV_POLL_FAST_MS,
  REV_POLL_HEALTHY_MS,
  RECONCILE_HEALTHY_MS,
  RECONCILE_DEGRADED_MS,
  REV_THROTTLE_STRIKES,
} from '../emergencyRev';

const REV_A = 'r1.aaaaaaaaaaaaaaaaaaaa';
const REV_B = 'r1.bbbbbbbbbbbbbbbbbbbb';

describe('classifyRevPoll', () => {
  it('reports unchanged when the server echoes the revision we hold', () => {
    expect(classifyRevPoll(REV_A, { status: 200, body: { rev: REV_A, active: false } })).toEqual({
      kind: 'unchanged',
      rev: REV_A,
      active: false,
    });
  });

  it('reports changed when the revision differs', () => {
    expect(classifyRevPoll(REV_A, { status: 200, body: { rev: REV_B, active: true } })).toEqual({
      kind: 'changed',
      rev: REV_B,
      active: true,
      // P0-7 #2: `alert` is always present on a `changed` outcome and is
      // null unless the server attached a raise envelope.
      alert: null,
    });
  });

  it('reports changed on the very first poll (no baseline to compare against)', () => {
    const out = classifyRevPoll(null, { status: 200, body: { rev: REV_A, active: false } });
    expect(out.kind).toBe('changed');
  });

  it('treats a 304 as confirmation only when we actually sent a baseline', () => {
    expect(classifyRevPoll(REV_A, { status: 304, body: null, etag: REV_A }).kind).toBe('unchanged');
    // No baseline → a 304 confirms nothing. Never read it as "no change".
    expect(classifyRevPoll(null, { status: 304, body: null }).kind).toBe('unavailable');
  });

  it('trusts a 304 ETag that disagrees with our baseline (proxy re-served a stale 304)', () => {
    const out = classifyRevPoll(REV_A, { status: 304, body: null, etag: REV_B });
    expect(out).toEqual({ kind: 'changed', rev: REV_B, active: false });
  });

  it('classifies our own per-screen floor as throttled, not as a failure', () => {
    expect(classifyRevPoll(REV_A, { status: 429, body: null }).kind).toBe('throttled');
  });

  it.each([
    ['server error', { status: 500, body: null }],
    ['unauthorized', { status: 401, body: null }],
    ['not found (endpoint absent on this deploy)', { status: 404, body: null }],
    ['gateway did not route it', { status: 502, body: null }],
    ['null body', { status: 200, body: null }],
    ['html error page', { status: 200, body: '<html>nope</html>' }],
    ['missing rev field', { status: 200, body: { active: true } }],
    ['empty rev field', { status: 200, body: { rev: '', active: false } }],
    ['non-string rev', { status: 200, body: { rev: 42 } }],
  ])('reports unavailable for %s', (_label, res) => {
    expect(classifyRevPoll(REV_A, res as never).kind).toBe('unavailable');
  });

  it('never reports `active` true from a body that did not say so', () => {
    const out = classifyRevPoll(null, { status: 200, body: { rev: REV_A, active: 'yes' } });
    expect(out.kind === 'changed' && out.active).toBe(false);
  });
});

describe('decideRevAction', () => {
  const base = { emergencyOnGlass: false, windowEdge: false, throttleStrikes: 0 };

  it('does nothing when the revision is unchanged and no window edge crossed', () => {
    const action = decideRevAction({
      ...base,
      outcome: { kind: 'unchanged', rev: REV_A, active: false },
    });
    expect(action.fetch).toBe(false);
    expect(action.reason).toBe('rev-unchanged');
  });

  it('still reconciles on an unchanged revision when a LOCAL window edge crossed', () => {
    // Fine-grained daysOfWeek / timeStart windows are evaluated player-side;
    // the server cannot see them, so an unchanged revision is not permission
    // to ignore one.
    const action = decideRevAction({
      ...base,
      windowEdge: true,
      outcome: { kind: 'unchanged', rev: REV_A, active: false },
    });
    expect(action.fetch).toBe(true);
    expect(action.preempt).toBe(false);
    expect(action.reason).toBe('window-edge');
  });

  it('reconciles on a change, without the preempt lane in the quiet case', () => {
    const action = decideRevAction({
      ...base,
      outcome: { kind: 'changed', rev: REV_B, active: false },
    });
    expect(action).toEqual({ fetch: true, preempt: false, reason: 'rev-changed' });
  });

  it('takes the PREEMPT lane when an alert is on glass', () => {
    // This is the all-clear case: whatever moved may be the clear for what is
    // showing, and it must not queue behind a slow normal fetch (F2).
    const action = decideRevAction({
      ...base,
      emergencyOnGlass: true,
      outcome: { kind: 'changed', rev: REV_B, active: false },
    });
    expect(action).toEqual({ fetch: true, preempt: true, reason: 'rev-changed' });
  });

  it('takes the PREEMPT lane when the server reports an active alert', () => {
    const action = decideRevAction({
      ...base,
      outcome: { kind: 'changed', rev: REV_B, active: true },
    });
    expect(action.preempt).toBe(true);
  });

  it.each([
    ['http-500'],
    ['http-401'],
    ['unparseable-body'],
    ['network-error'],
    ['not-modified-without-baseline'],
  ])('falls back to a FULL fetch when the poll is unusable (%s)', (reason) => {
    const action = decideRevAction({ ...base, outcome: { kind: 'unavailable', reason } });
    expect(action.fetch).toBe(true);
    expect(action.reason).toContain('rev-unavailable');
  });

  it('a broken revision endpoint cannot suppress the backstop even mid-emergency', () => {
    const action = decideRevAction({
      ...base,
      emergencyOnGlass: true,
      outcome: { kind: 'unavailable', reason: 'http-500' },
    });
    expect(action.fetch).toBe(true);
  });

  it('skips the tick on a first throttle but never for long', () => {
    for (let strikes = 1; strikes < REV_THROTTLE_STRIKES; strikes += 1) {
      const action = decideRevAction({ ...base, throttleStrikes: strikes, outcome: { kind: 'throttled' } });
      expect(action.fetch).toBe(false);
      expect(action.reason).toBe('rev-throttled');
    }
    const escalated = decideRevAction({
      ...base,
      throttleStrikes: REV_THROTTLE_STRIKES,
      outcome: { kind: 'throttled' },
    });
    expect(escalated.fetch).toBe(true);
    expect(escalated.reason).toBe('rev-throttled-repeatedly');
  });

  it('escalating throttles preempt when an alert is on glass', () => {
    const action = decideRevAction({
      ...base,
      emergencyOnGlass: true,
      throttleStrikes: REV_THROTTLE_STRIKES,
      outcome: { kind: 'throttled' },
    });
    expect(action.preempt).toBe(true);
  });
});

describe('cadence', () => {
  it('polls the revision every 10 s when healthy', () => {
    expect(
      revPollCadenceMs({ emergencyOnGlass: false, pushDegraded: false, serverActive: false }),
    ).toBe(REV_POLL_HEALTHY_MS);
  });

  it.each([
    ['an alert is on glass', { emergencyOnGlass: true, pushDegraded: false, serverActive: false }],
    ['push is degraded', { emergencyOnGlass: false, pushDegraded: true, serverActive: false }],
    ['the server reports one active', { emergencyOnGlass: false, pushDegraded: false, serverActive: true }],
  ])('drops to 5 s when %s', (_label, state) => {
    expect(revPollCadenceMs(state)).toBe(REV_POLL_FAST_MS);
  });

  it('reconciles the manifest every 60 s healthy and every 10 s degraded', () => {
    expect(reconcileCadenceMs({ pushDegraded: false })).toBe(RECONCILE_HEALTHY_MS);
    expect(reconcileCadenceMs({ pushDegraded: true })).toBe(RECONCILE_DEGRADED_MS);
  });

  it('reconciles FASTER than the 30 s it replaced whenever push is unhealthy', () => {
    expect(reconcileCadenceMs({ pushDegraded: true })).toBeLessThan(30_000);
  });

  it('never lets the fast cadence exceed the old full-manifest poll cadence', () => {
    // The revision poll runs at most as often as the manifest poll it
    // replaced, on a request that costs the API no database work.
    expect(REV_POLL_FAST_MS).toBe(5_000);
    expect(REV_POLL_HEALTHY_MS).toBe(10_000);
  });
});

describe('emergencyRevPath', () => {
  it('encodes the screen id', () => {
    expect(emergencyRevPath('scr 1/../admin')).toBe(
      '/api/v1/screens/scr%201%2F..%2Fadmin/emergency-rev',
    );
  });
});

/**
 * ── THE RAISE FAST PATH (P0-7 #2, 2026-09-05) ────────────────────────────
 *
 * WHY IT EXISTS, measured: with Redis stopped, a lockdown reached all 1 000
 * screens at p50 7 572 ms / p95 21 653 ms / max 45 131 ms, against p95 343 ms
 * with push alive (`P0-7-load-test.md` §5.6). Nothing errored — every screen
 * simply answered the moved revision with a full emergency-manifest fetch and
 * the herd queued on an API at CPU p50 228 % of 10 cores. A 200 that can
 * raise now carries the alert, so the screen goes red on the round trip it
 * was making anyway.
 *
 * The property every case below defends: this path may only ever move a
 * screen from "no alert" to "alert". It cannot release one, it cannot be
 * asserted by a malformed envelope, and it cannot fire twice for one
 * revision.
 */
describe('the raise fast path', () => {
  const SIGNED = {
    type: 'OVERRIDE',
    eventId: 'evt-1',
    timestamp: 1_700_000_000_000,
    signature: 'abc123',
    payload: {
      active: true,
      type: 'LOCKDOWN',
      severity: 'CRITICAL',
      scopeNote: null,
      scope: 'tenant',
      expiresAt: null,
      screenId: 'scr_1',
      via: 'emergency-rev',
    },
  };

  it('surfaces the envelope on a changed revision', () => {
    const out = classifyRevPoll(REV_A, {
      status: 200,
      body: { rev: REV_B, active: true, alert: SIGNED },
    });
    expect(out.kind).toBe('changed');
    expect((out as { alert?: unknown }).alert).toEqual(SIGNED);
  });

  it('DROPS an envelope arriving on an unchanged revision', () => {
    // We have already applied this revision, so we have already been told.
    // Without this the overlay would re-fire on every poll of a live alert.
    const out = classifyRevPoll(REV_A, {
      status: 200,
      body: { rev: REV_A, active: true, alert: SIGNED },
    });
    expect(out.kind).toBe('unchanged');
    expect((out as { alert?: unknown }).alert).toBeUndefined();
  });

  it('never surfaces one from a 304 — there is no body to carry it', () => {
    const out = classifyRevPoll(REV_A, { status: 304, body: null, etag: REV_B });
    expect(out.kind).toBe('changed');
    expect((out as { alert?: unknown }).alert).toBeUndefined();
  });

  it('rejects anything that is not an OVERRIDE envelope with a payload', () => {
    const reject = (alert: unknown) => {
      const out = classifyRevPoll(REV_A, { status: 200, body: { rev: REV_B, active: true, alert } });
      expect((out as { alert?: unknown }).alert).toBeNull();
    };
    reject(undefined);
    reject(null);
    reject('LOCKDOWN');
    reject({ type: 'SYNC', payload: {} }); // wrong type
    reject({ type: 'OVERRIDE' }); // no payload
    reject({ type: 'OVERRIDE', payload: 'lockdown' }); // payload not an object
  });

  it('builds the SAME flat object applyManifest builds from a manifest', () => {
    // If these two ever diverge, a screen visibly changes what it is showing
    // when the manifest lands a second after the fast path raised.
    expect(alertFromRevEnvelope(SIGNED as never)).toEqual({
      active: true,
      type: 'LOCKDOWN',
      severity: 'CRITICAL',
      scopeNote: null,
      scope: 'tenant',
      expiresAt: null,
    });
  });

  it('carries a scope note and expiry when the server sends them', () => {
    const withNote = {
      ...SIGNED,
      payload: { ...SIGNED.payload, scopeNote: 'Gym — hold position', expiresAt: 1_700_000_600 },
    };
    expect(alertFromRevEnvelope(withNote as never)).toMatchObject({
      scopeNote: 'Gym — hold position',
      expiresAt: 1_700_000_600,
    });
  });

  it('refuses to raise from an incomplete payload', () => {
    const drop = (payload: Record<string, unknown>) =>
      expect(alertFromRevEnvelope({ type: 'OVERRIDE', payload } as never)).toBeNull();
    drop({ ...SIGNED.payload, type: '' });
    drop({ ...SIGNED.payload, severity: undefined });
    drop({ ...SIGNED.payload, scope: undefined }); // an unscoped alert is not one we understand
    drop({ ...SIGNED.payload, active: false }); // there is no "clear" envelope
    expect(alertFromRevEnvelope(null)).toBeNull();
    expect(alertFromRevEnvelope(undefined)).toBeNull();
  });

  it('still reconciles the manifest on the preempt lane when it raises', () => {
    // The fast path is a HINT. The manifest is what installs the emergency
    // playlist and remains the sole arbiter that ever clears the alert.
    const action = decideRevAction({
      outcome: { kind: 'changed', rev: REV_B, active: true, alert: SIGNED as never },
      emergencyOnGlass: false,
      windowEdge: false,
      throttleStrikes: 0,
    });
    expect(action.fetch).toBe(true);
    expect(action.preempt).toBe(true);
  });
});
