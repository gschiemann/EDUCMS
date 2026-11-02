import { ScreensController } from './screens.controller';

const challenge = '00000000-0000-4000-8000-000000000001';
const proof = { identity: 'abcdef01', documentId: 'document-a', challenge, frames: 2, painted: true };
let sequence = 0;
function harness() {
  const row = { id: `paint-test-${++sequence}`, tenantId: 'tenant-test', pendingRefreshAt: null, faceIndex: 0, nativeRuntimeReport: null as unknown, lastRenderedHash: 'pl:old' };
  const screen = { findUnique: jest.fn(async () => row), update: jest.fn(async () => ({ id: row.id })) };
  const auditLog = { create: jest.fn(async () => ({})) };
  const controller = new ScreensController({ client: { screen, auditLog } } as never, {} as never, {} as never, {} as never, {} as never);
  (controller as any).deviceAuth = jest.fn(async () => ({ ok: true }));
  const post = (body: Record<string, unknown>) => controller.reportRenderProof(row.id, {} as never, body);
  return { row, screen, auditLog, controller, post };
}

it('records raised without inventing a rendered timestamp, then accepts paint through the debounce', async () => {
  const h = harness();
  await h.post({ hash: 'pl:old', frames: 100 });
  await h.post({ hash: 'pending|em:abcdef01', emergencyProof: { ...proof, painted: false, frames: 0 } });
  expect(h.screen.update.mock.calls[1][0].data).toMatchObject({ lastRenderedHash: 'pending|em:abcdef01' });
  expect(h.screen.update.mock.calls[1][0].data).not.toHaveProperty('lastRenderedAt');
  h.row.nativeRuntimeReport = { emergencyProof: { faces: [{ face: 0, challenge, status: 'painted', identity: proof.identity, documentId: proof.documentId }] } };
  await h.post({ hash: 'em:abcdef01', emergencyProof: proof });
  expect(h.screen.update.mock.calls[2][0].data).toMatchObject({ lastRenderedHash: 'em:abcdef01', lastRenderedAt: expect.any(Date) });
  expect(h.auditLog.create.mock.calls.map(c => c[0].data.action)).toEqual(['PLAYER_EMERGENCY_NO_PAINT_PROOF', 'PLAYER_EMERGENCY_PAINTED']);
});

it('cannot certify a legacy React state signature or a prior native challenge', async () => {
  const h = harness();
  h.row.nativeRuntimeReport = { emergencyProof: { faces: [{ face: 0, challenge }] } };
  await h.post({ hash: 'em:lockdown', frames: 999 });
  expect(h.screen.update.mock.calls[0][0].data).not.toHaveProperty('lastRenderedAt');
  await h.post({ hash: 'em:abcdef01', emergencyProof: { ...proof, challenge: '00000000-0000-4000-8000-000000000002' } });
  expect(h.screen.update.mock.calls[1][0].data).not.toHaveProperty('lastRenderedAt');
});

it('refuses an unproven caller and malformed proof before any telemetry write', async () => {
  const h = harness();
  await expect(h.post({ emergencyProof: { ...proof, frames: 1 } })).rejects.toThrow();
  expect(h.screen.update).not.toHaveBeenCalled();
  (h.controller as any).deviceAuth.mockResolvedValue({ ok: false, reason: 'unproven' });
  await expect(h.post({ hash: 'em:abcdef01', emergencyProof: proof })).rejects.toThrow();
  expect(h.auditLog.create).not.toHaveBeenCalled();
});


it('native visibility acknowledgment is required even if the first native status has not arrived', async () => {
  const h = harness();
  const result = await h.post({ hash: 'em:abcdef01', emergencyProof: proof });
  expect(result).toMatchObject({ emergencyPaintAccepted: false });
  expect(h.screen.update.mock.calls[0][0].data).not.toHaveProperty('lastRenderedAt');
  h.row.nativeRuntimeReport = { emergencyProof: { faces: [{ face: 0, challenge, status: 'unconfirmed' }] } };
  expect(await h.post({ hash: 'em:abcdef01', emergencyProof: proof })).toMatchObject({ emergencyPaintAccepted: false });
  expect(h.screen.update.mock.calls[1][0].data).not.toHaveProperty('lastRenderedAt');
});

it('cannot certify DOM paint when native state failed before returning a challenge', async () => {
  const h = harness();
  const result = await h.post({ hash: 'em:abcdef01', emergencyProof: { ...proof, challenge: undefined, nativeRequired: true } });
  expect(result).toMatchObject({ emergencyPaintAccepted: false });
  expect(h.screen.update.mock.calls[0][0].data).toMatchObject({ lastRenderedHash: 'pending|em:abcdef01' });
  expect(h.screen.update.mock.calls[0][0].data).not.toHaveProperty('lastRenderedAt');
  expect(h.auditLog.create.mock.calls[0][0].data.action).toBe('PLAYER_EMERGENCY_NO_PAINT_PROOF');
});

// ─── 2026-11-02: the SECURE drill where not one screen confirmed ─────────────
// The APK accepted every receipt within ~400 ms; its heartbeat rides a 5-minute
// floor while the page reports, so the page's post always met a stored episode
// that was absent or still `pending` — and the old rule refused it.

it('accepts the page relaying the APK verdict (nativeAccepted) before the heartbeat lands, once', async () => {
  const h = harness();
  const relayed = { ...proof, nativeAccepted: true };
  expect(await h.post({ hash: 'em:abcdef01', emergencyProof: relayed })).toMatchObject({ emergencyPaintAccepted: true });
  expect(h.screen.update.mock.calls[0][0].data).toMatchObject({ lastRenderedHash: 'em:abcdef01', lastRenderedAt: expect.any(Date) });
  expect(h.auditLog.create.mock.calls.map(c => c[0].data.action)).toEqual(['PLAYER_EMERGENCY_PAINTED']);
  // A stale `pending` episode for the same challenge (the last heartbeat) does not contradict it.
  h.row.nativeRuntimeReport = { emergencyProof: { faces: [{ face: 0, challenge, status: 'pending' }] } };
  h.row.lastRenderedHash = 'em:abcdef01';
  expect(await h.post({ hash: 'em:abcdef01', emergencyProof: relayed })).toMatchObject({ emergencyPaintAccepted: true });
  expect(h.auditLog.create).toHaveBeenCalledTimes(1);
});

it('a native verdict for the SAME challenge outranks the relay: unconfirmed, or painted under another document', async () => {
  const h = harness();
  const relayed = { ...proof, nativeAccepted: true };
  h.row.nativeRuntimeReport = { emergencyProof: { faces: [{ face: 0, challenge, status: 'unconfirmed' }] } };
  expect(await h.post({ hash: 'em:abcdef01', emergencyProof: relayed })).toMatchObject({ emergencyPaintAccepted: false });
  h.row.nativeRuntimeReport = { emergencyProof: { faces: [{ face: 0, challenge, status: 'painted', identity: proof.identity, documentId: 'another-document' }] } };
  expect(await h.post({ hash: 'em:abcdef01', emergencyProof: relayed })).toMatchObject({ emergencyPaintAccepted: false });
  expect(h.screen.update.mock.calls.every(c => !('lastRenderedAt' in c[0].data))).toBe(true);
  // Without the relay flag nothing changed: the heartbeat still has to say painted.
  expect(await h.post({ hash: 'em:abcdef01', emergencyProof: { ...proof, challenge: '00000000-0000-4000-8000-000000000003' } })).toMatchObject({ emergencyPaintAccepted: false });
});

it('a stored episode that outlived the alert never grades ordinary render proof as "alert not painted"', async () => {
  const h = harness();
  // The all-clear landed; the APK released its hold; its next heartbeat is minutes away.
  h.row.nativeRuntimeReport = { emergencyProof: { faces: [{ face: 0, challenge, status: 'unconfirmed' }] } };
  await h.post({ hash: 'pl:0|10000|item-a|hash-a', frames: 500 });
  expect(h.screen.update.mock.calls[0][0].data).toMatchObject({ lastRenderedHash: 'pl:0|10000|item-a|hash-a', lastRenderedAt: expect.any(Date) });
  expect(h.auditLog.create).not.toHaveBeenCalled();
});
