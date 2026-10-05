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
});
