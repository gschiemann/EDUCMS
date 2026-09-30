import { PlayerLogsController } from './player-logs.controller';
import { verifyDeviceForScreen } from '../screens/device-auth';
jest.mock('../screens/device-auth', () => ({ verifyDeviceForScreen: jest.fn() }));
const verify = jest.mocked(verifyDeviceForScreen);
const screenId = 'test-screen';
const tenantId = 'test-tenant';
const recovery = '2026-09-29T17:35:00Z ERROR PLAYER_RENDERER_TERMINATED slot=primary didCrash=false failures=1 retryMs=2000';
let prisma: any;
let controller: PlayerLogsController;
beforeEach(() => {
  jest.clearAllMocks();
  prisma = { client: { auditLog: { create: jest.fn().mockResolvedValue({ id: 'audit' }), findFirst: jest.fn().mockResolvedValue(null) } } };
  controller = new PlayerLogsController(prisma, {} as any);
  verify.mockResolvedValue({ ok: true, sub: screenId, tenantId } as any);
});
const request = (body: string) => ({ body, headers: {} } as any);
test('delegates identity, revocation and epoch checks to the shared device verifier', async () => {
  const req = request('FATAL EXCEPTION: main');
  await controller.ingestLog(screenId, req);
  expect(verify).toHaveBeenCalledWith({ prisma, redis: {} }, req, screenId, { allowUnpaired: true });
  expect(prisma.client.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ tenantId, targetId: screenId, action: 'PLAYER_DIAGNOSTICS_CRASH' }) });
});
test.each(['missing', 'invalid', 'subject-mismatch', 'unproven', 'revoked', 'stale-epoch'])('%s credentials cannot attribute a recovery event to any tenant', async () => {
  verify.mockResolvedValue({ ok: false } as any);
  expect(await controller.ingestLog(screenId, request(recovery))).toEqual({ stored: true, rows: 0 });
  expect(prisma.client.auditLog.findFirst).not.toHaveBeenCalled();
  expect(prisma.client.auditLog.create).not.toHaveBeenCalled();
});
test('records isolated renderer termination without requiring a JVM fatal exception', async () => {
  expect(await controller.ingestLog(screenId, request('routine token-bearing navigation log\n' + recovery))).toEqual({ stored: true, rows: 1 });
  const data = prisma.client.auditLog.create.mock.calls[0][0].data;
  expect(data).toMatchObject({ tenantId, targetId: screenId, action: 'PLAYER_RECOVERY_EVENT' });
  const details = JSON.parse(data.details);
  expect(details.log).toBe(recovery);
  expect(details.recoveryEventId).toMatch(/^[a-f0-9]{64}$/);
  expect(details.crashDetected).toBe(false);
});
test('does not re-audit a timestamped recovery event from a repeated rotating-log upload', async () => {
  prisma.client.auditLog.findFirst.mockResolvedValue({ id: 'existing' });
  expect(await controller.ingestLog(screenId, request(recovery))).toEqual({ stored: true, rows: 0 });
  expect(prisma.client.auditLog.findFirst).toHaveBeenCalledWith({ where: expect.objectContaining({ tenantId, targetId: screenId, action: 'PLAYER_RECOVERY_EVENT' }), select: { id: true } });
  expect(prisma.client.auditLog.create).not.toHaveBeenCalled();
});
test('routine diagnostics stay outside the immutable audit log', async () => {
  expect(await controller.ingestLog(screenId, request('heartbeat synced'))).toEqual({ stored: true, rows: 0 });
  expect(prisma.client.auditLog.create).not.toHaveBeenCalled();
});
test('failed persistence is visible to the uploader so the local record can be retried', async () => {
  prisma.client.auditLog.create.mockRejectedValue(Error('database unavailable'));
  expect(await controller.ingestLog(screenId, request(recovery))).toEqual({ stored: false, rows: 0 });
});
test('oversized bodies are refused before authentication or storage', async () => {
  await expect(controller.ingestLog(screenId, request('x'.repeat(1_048_577)))).rejects.toThrow();
  expect(verify).not.toHaveBeenCalled();
});
test('retains each distinct renderer and decoder event in a bounded upload', async () => {
  const body = recovery + '\n2026-09-29T17:36:00Z PLAYER_PLAYBACK_FAILURE video stalled';
  expect(await controller.ingestLog(screenId, request(body))).toEqual({ stored: true, rows: 2 });
  expect(prisma.client.auditLog.create).toHaveBeenCalledTimes(2);
});
test('an already uploaded renderer marker cannot hide a simultaneous JVM fatal exception', async () => {
  prisma.client.auditLog.findFirst.mockResolvedValue({ id: 'existing' });
  expect(await controller.ingestLog(screenId, request(recovery + '\nFATAL EXCEPTION main'))).toEqual({ stored: true, rows: 1 });
  expect(prisma.client.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'PLAYER_DIAGNOSTICS_CRASH' }) });
});
