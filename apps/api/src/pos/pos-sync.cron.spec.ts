import { PosSyncCron } from './pos-sync.cron';

describe('POS sync cadence', () => {
  afterEach(() => jest.restoreAllMocks());

  it('checks Toast every five minutes while preserving hourly sync for other providers', async () => {
    const connections = [
      { id: 'toast-1', providerId: 'toast', tenantId: 'tenant-1' },
      { id: 'square-1', providerId: 'square', tenantId: 'tenant-1' },
    ];
    const prisma = { client: { posProviderConnection: { findMany: jest.fn().mockResolvedValue(connections) } } };
    const svc = { syncToastIfChanged: jest.fn().mockResolvedValue(false), syncConnection: jest.fn().mockResolvedValue({ status: 'ok' }) };
    const cron = new PosSyncCron(prisma as any, svc as any);
    const now = jest.spyOn(Date, 'now');

    now.mockReturnValue(Date.parse('2026-09-22T12:01:00Z'));
    await (cron as any).tick();
    now.mockReturnValue(Date.parse('2026-09-22T12:04:00Z'));
    await (cron as any).tick();
    expect(svc.syncToastIfChanged).toHaveBeenCalledTimes(1);
    expect(svc.syncConnection).toHaveBeenCalledTimes(1);

    now.mockReturnValue(Date.parse('2026-09-22T12:06:00Z'));
    await (cron as any).tick();
    expect(svc.syncToastIfChanged).toHaveBeenCalledTimes(2);
    expect(svc.syncConnection).toHaveBeenCalledTimes(1);

    now.mockReturnValue(Date.parse('2026-09-22T13:01:00Z'));
    await (cron as any).tick();
    expect(svc.syncToastIfChanged).toHaveBeenCalledTimes(3);
    expect(svc.syncConnection).toHaveBeenCalledTimes(2);
  });
});
