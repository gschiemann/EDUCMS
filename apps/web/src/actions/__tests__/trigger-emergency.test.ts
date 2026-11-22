/**
 * The emergency server actions put EXACTLY the right bytes on the wire
 * (alert targeting, 2026-10-05).
 *
 * `emergency-target.test.ts` pins the body builders; this pins that the
 * actions actually send them — the default call (no target) produces the
 * request every trigger has always produced, and a chosen group / screen and
 * an alert's own all-clear carry their scope.
 */
import { allClearEmergency, broadcastEmergency } from '@/actions/trigger-emergency';

const fetchMock = jest.fn();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ success: true, overrideId: 'ovr_123' }),
  });
  (global as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
});

const sent = () => {
  const [url, init] = fetchMock.mock.calls[0];
  return { url: String(url), body: String(init.body), auth: init.headers?.Authorization };
};

describe('broadcastEmergency', () => {
  it('All screens (no target) sends the exact pre-targeting request', async () => {
    const res = await broadcastEmergency({ schoolId: 't1', type: 'lockdown', triggeredBy: 'u1', token: 'tok' });
    expect(res).toEqual({ success: true, overrideId: 'ovr_123' });
    const { url, body, auth } = sent();
    expect(url).toMatch(/\/emergency\/trigger$/);
    expect(body).toBe('{"scopeType":"tenant","scopeId":"t1","overridePayload":{"severity":"CRITICAL","type":"lockdown"}}');
    expect(auth).toBe('Bearer tok');
  });

  it('one screen: the same request with the screen as its scope', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ success: true, overrideId: 'ovr_9', affectedScreenCount: 2 }),
    });
    const res = await broadcastEmergency({
      schoolId: 't1', type: 'medical', triggeredBy: 'u1', token: 'tok',
      target: { scopeType: 'device', scopeId: 's-lobby' },
    });
    expect(res).toEqual({ success: true, overrideId: 'ovr_9', affectedScreenCount: 2 });
    expect(sent().body).toBe('{"scopeType":"device","scopeId":"s-lobby","overridePayload":{"severity":"CRITICAL","type":"medical"}}');
  });

  it('one group', async () => {
    await broadcastEmergency({ schoolId: 't1', type: 'hold', triggeredBy: 'u1', target: { scopeType: 'group', scopeId: 'g-gym' } });
    expect(sent().body).toBe('{"scopeType":"group","scopeId":"g-gym","overridePayload":{"severity":"CRITICAL","type":"hold"}}');
  });

  it('a refused trigger is reported, never thrown', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({}) });
    await expect(
      broadcastEmergency({ schoolId: 't1', type: 'lockdown', triggeredBy: 'u1', target: { scopeType: 'device', scopeId: 'foreign' } }),
    ).resolves.toEqual({ success: false, error: 'Emergency broadcast failed: 403' });
  });
});

describe('allClearEmergency', () => {
  it('with no scope: the whole organisation, as before', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ success: true }) });
    await allClearEmergency({ schoolId: 't1', token: 'tok', overrideId: 'ovr_1' });
    const { url, body } = sent();
    expect(url).toMatch(/\/emergency\/ovr_1\/all-clear$/);
    expect(body).toBe('{"scopeType":"tenant","scopeId":"t1"}');
  });

  it('a group / one-screen alert ends exactly itself: its id in the URL, its scope in the body', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ success: true }) });
    const res = await allClearEmergency({ schoolId: 't1', token: 'tok', overrideId: 'ovr_gym', scopeType: 'group', scopeId: 'g-gym' });
    expect(res).toEqual({ success: true });
    const { url, body } = sent();
    expect(url).toMatch(/\/emergency\/ovr_gym\/all-clear$/);
    expect(body).toBe('{"scopeType":"group","scopeId":"g-gym"}');
  });

  it('a failed all-clear is reported, so no surface can claim it worked', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
    await expect(
      allClearEmergency({ schoolId: 't1', overrideId: 'ovr_1', scopeType: 'device', scopeId: 's-lobby' }),
    ).resolves.toEqual({ success: false, error: 'All clear failed: 500' });
  });

  // EMG-01 (2026-11-21) — the server refuses an all-clear naming an alert a
  // newer one replaced. The action passes the code and the newer alert's type
  // through, and keeps the "All clear failed: <status>" head the surfaces route on.
  it('a 409 ALERT_CHANGED is reported with its code and the type of the alert that is live now', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({
        code: 'ALERT_CHANGED',
        message: 'A newer LOCKDOWN alert is active.',
        requestedAlertId: 'ovr_hold',
        currentAlert: { alertId: 'ovr_lockdown', scopeType: 'tenant', scopeId: 't1', type: 'LOCKDOWN' },
      }),
    });
    await expect(allClearEmergency({ schoolId: 't1', token: 'tok', overrideId: 'ovr_hold' })).resolves.toEqual({
      success: false,
      error: 'All clear failed: 409',
      code: 'ALERT_CHANGED',
      currentAlertType: 'LOCKDOWN',
      // Review round 2 — the alert that is live now, so the next fresh CLEAR
      // can name it even when the list cannot be re-read.
      currentAlert: { alertId: 'ovr_lockdown', scopeId: 't1', type: 'LOCKDOWN', isDrill: false },
    });
    expect(sent().url).toMatch(/\/emergency\/ovr_hold\/all-clear$/);
  });

  // EMG-01 review round 1 — the body exactly as the API's method-scoped
  // filter puts it on the wire (tenant-alert-changed.filter.ts); and a body
  // that carries only the flat field still yields the type.
  it('reads the newer alert’s type from the real wire body, nested or flat', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({
        error: true,
        code: 'ALERT_CHANGED',
        message: 'A newer LOCKDOWN alert is active.',
        requestedAlertId: 'ovr_hold',
        currentAlert: { alertId: 'ovr_lockdown', scopeType: 'tenant', scopeId: 't1', type: 'LOCKDOWN', severity: 'CRITICAL', isDrill: false, triggeredAt: '2026-11-21T10:00:00.000Z' },
        currentAlertId: 'ovr_lockdown',
        currentAlertType: 'LOCKDOWN',
        currentAlertSeverity: 'CRITICAL',
        currentAlertIsDrill: false,
        currentAlertTriggeredAt: '2026-11-21T10:00:00.000Z',
      }),
    });
    await expect(allClearEmergency({ schoolId: 't1', token: 'tok', overrideId: 'ovr_hold' })).resolves.toMatchObject({
      code: 'ALERT_CHANGED',
      currentAlertType: 'LOCKDOWN',
    });
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({ error: true, code: 'ALERT_CHANGED', message: 'x', currentAlertType: 'EVACUATE' }),
    });
    await expect(allClearEmergency({ schoolId: 't1', token: 'tok', overrideId: 'ovr_hold' })).resolves.toMatchObject({
      code: 'ALERT_CHANGED',
      currentAlertType: 'EVACUATE',
    });
  });

  // EMG-01 review round 2.
  it('passes the live alert’s id through from the flat wire fields too, and only on ALERT_CHANGED', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({ error: true, code: 'ALERT_CHANGED', currentAlertId: 'ovr_evac', currentAlertType: 'EVACUATE', currentAlertIsDrill: true }),
    });
    await expect(allClearEmergency({ schoolId: 't1', token: 'tok', overrideId: 'ovr_hold' })).resolves.toMatchObject({
      currentAlert: { alertId: 'ovr_evac', scopeId: null, type: 'EVACUATE', isDrill: true },
    });
    // Another 409 (a drill refused over a live alert, say) carries no aim.
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({ error: true, code: 'LIVE_ALERT_ACTIVE', currentAlertId: 'ovr_x' }),
    });
    const other = await allClearEmergency({ schoolId: 't1', token: 'tok', overrideId: 'ovr_hold' });
    expect(other).not.toHaveProperty('currentAlert');
    // An ALERT_CHANGED with no id (an older API) carries no aim either.
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({ error: true, code: 'ALERT_CHANGED', currentAlertType: 'LOCKDOWN' }),
    });
    expect(await allClearEmergency({ schoolId: 't1', token: 'tok', overrideId: 'ovr_hold' })).not.toHaveProperty('currentAlert');
  });

  it('a district all-clear reports the locations it left in their own alert; any other success body is plain success', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ success: true, affectedTenantIds: ['d1', 's2'], keptTenantIds: ['s1'] }),
    });
    await expect(allClearEmergency({ schoolId: 'd1', token: 'tok', overrideId: 'ovr_w' })).resolves.toEqual({
      success: true,
      keptTenantIds: ['s1'],
      // Review round 3 — a body without the flag reads as "not listed".
      keptListedForCaller: false,
    });
    fetchMock.mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ success: true, keptTenantIds: [] }) });
    await expect(allClearEmergency({ schoolId: 'd1', token: 'tok', overrideId: 'ovr_w' })).resolves.toEqual({ success: true });
    fetchMock.mockResolvedValueOnce({ ok: true, status: 201, json: async () => { throw new Error('no body'); } });
    await expect(allClearEmergency({ schoolId: 'd1', token: 'tok', overrideId: 'ovr_w' })).resolves.toEqual({ success: true });
  });

  // EMG-01 review round 3 — one entry per kept alert, and whether the
  // caller's own alert list shows them.
  it('passes keptListedForCaller through, and counts each kept location once', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ success: true, keptTenantIds: ['s1', 's1', 's2'], keptListedForCaller: true }),
    });
    await expect(allClearEmergency({ schoolId: 'd1', token: 'tok', overrideId: 'ovr_w' })).resolves.toEqual({
      success: true,
      keptTenantIds: ['s1', 's2'],
      keptListedForCaller: true,
    });
    // Anything but `true` is "not listed" — the copy that claims less.
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ success: true, keptTenantIds: ['annex'], keptListedForCaller: 'yes' }),
    });
    await expect(allClearEmergency({ schoolId: 's1', token: 'tok', overrideId: 'ovr_h' })).resolves.toMatchObject({
      keptListedForCaller: false,
    });
  });
});

// EMG-01 review round 3 — `fetchWithTimeout` bounds a request until its
// headers arrive, then clears its timer. A BODY that stalls after that must
// never hold the operator: the status is the verdict, and a body that does
// not arrive within 3 s reads as "no body".
describe('a response body that stalls is bounded (review round 3)', () => {
  const stalledBody = (status: number) => ({
    ok: status >= 200 && status < 300,
    status,
    json: () => new Promise<never>(() => undefined),
  });
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  /** Settle `p` while advancing fake time by `ms`; returns what it resolved with, or 'pending'. */
  const settleWithin = async <T,>(p: Promise<T>, ms: number): Promise<T | 'pending'> => {
    let out: T | 'pending' = 'pending';
    void p.then((v) => {
      out = v;
    });
    await jest.advanceTimersByTimeAsync(ms);
    return out;
  };

  it('an all-clear whose 2xx body stalls is a success, never left pending', async () => {
    fetchMock.mockResolvedValueOnce(stalledBody(201));
    const p = allClearEmergency({ schoolId: 't1', token: 'tok', overrideId: 'ovr_1' });
    // Not settled a moment before the budget…
    expect(await settleWithin(p, 2_900)).toBe('pending');
    // …and settled, as plain success, once it has passed.
    expect(await settleWithin(p, 200)).toEqual({ success: true });
  });

  it('a refused all-clear whose body stalls is still the refusal, with its status', async () => {
    fetchMock.mockResolvedValueOnce(stalledBody(409));
    const p = allClearEmergency({ schoolId: 't1', token: 'tok', overrideId: 'ovr_1' });
    expect(await settleWithin(p, 3_100)).toEqual({ success: false, error: 'All clear failed: 409' });
  });

  it('a trigger whose 2xx body stalls is a success without an overrideId (its all-clear then clears as before alert identity)', async () => {
    fetchMock.mockResolvedValueOnce(stalledBody(201));
    const p = broadcastEmergency({ schoolId: 't1', type: 'lockdown', triggeredBy: 'u1', token: 'tok' });
    expect(await settleWithin(p, 3_100)).toEqual({ success: true, overrideId: undefined });
  });

  it('a refused trigger whose body stalls is still the refusal, with its status', async () => {
    fetchMock.mockResolvedValueOnce(stalledBody(503));
    const p = broadcastEmergency({ schoolId: 't1', type: 'lockdown', triggeredBy: 'u1', token: 'tok' });
    expect(await settleWithin(p, 3_100)).toEqual({ success: false, error: 'Emergency broadcast failed: 503' });
  });

  it('a body that arrives in time is read as before', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ success: true, overrideId: 'ovr_7' }) });
    const p = broadcastEmergency({ schoolId: 't1', type: 'lockdown', triggeredBy: 'u1', token: 'tok' });
    expect(await settleWithin(p, 0)).toEqual({ success: true, overrideId: 'ovr_7' });
  });
});
