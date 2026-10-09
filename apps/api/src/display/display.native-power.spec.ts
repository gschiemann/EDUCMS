import { DisplayService } from './display.service';
import type { DisplayActionType } from '@cms/api-types';

function harness() {
  const prisma = {
    client: {
      screen: {
        update: jest
          .fn<
            Promise<object>,
            [
              input: {
                where: { id: string; tenantId: string };
                data: { nativePowerOnAt: Date | null };
              },
            ]
          >()
          .mockResolvedValue({}),
      },
      auditLog: {
        create: jest
          .fn<Promise<object>, [input: unknown]>()
          .mockResolvedValue({}),
      },
    },
  };
  const redis = {
    isConnected: jest.fn(() => false),
    publish: jest
      .fn<Promise<boolean>, [channel: string, message: unknown]>()
      .mockResolvedValue(true),
  };
  const signer = {
    signMessage: jest
      .fn<object, [type: string, payload: unknown]>()
      .mockReturnValue({}),
  };
  const service = new DisplayService(
    prisma as never,
    redis as never,
    signer as never,
  );
  const apply = (action: DisplayActionType) =>
    service.applyAction({
      screenId: 'wall',
      tenantId: 'cleveland',
      userId: 'operator',
      action,
      capabilities: {
        verdict: {
          volume: 'audiomanager',
          brightness: 'sysfs',
          screenBlank: 'vendor-recipe',
          reboot: 'none',
          hardPowerOff: 'none',
          deviceOwnerPath: 'provisionable-after-factory-reset',
        },
      },
      lastPushConnectedAt: null,
    });
  return { prisma, redis, signer, apply };
}

it('retains an audited POWER_ON before attempting a dead push channel', async () => {
  const { prisma, redis, signer, apply } = harness();
  expect(await apply('POWER_ON')).toMatchObject({ delivered: false });
  expect(prisma.client.screen.update).toHaveBeenCalledWith({
    where: { id: 'wall', tenantId: 'cleveland' },
    data: { nativePowerOnAt: expect.any(Date) as Date },
  });
  expect(
    prisma.client.auditLog.create.mock.invocationCallOrder[0],
  ).toBeLessThan(prisma.client.screen.update.mock.invocationCallOrder[0]);
  expect(prisma.client.screen.update.mock.invocationCallOrder[0]).toBeLessThan(
    redis.publish.mock.invocationCallOrder[0],
  );
  const queuedAt =
    prisma.client.screen.update.mock.calls[0][0].data.nativePowerOnAt;
  expect(signer.signMessage.mock.calls[0][1]).toMatchObject({
    issuedAt: queuedAt?.toISOString(),
    nativePowerOnRequestedAt: queuedAt?.toISOString(),
  });
});

it('cancels a pending native wake before a later permitted power-off is published', async () => {
  const { prisma, redis, apply } = harness();
  await apply('POWER_OFF');
  expect(prisma.client.screen.update).toHaveBeenCalledWith({
    where: { id: 'wall', tenantId: 'cleveland' },
    data: { nativePowerOnAt: null },
  });
  expect(prisma.client.screen.update.mock.invocationCallOrder[0]).toBeLessThan(
    redis.publish.mock.invocationCallOrder[0],
  );
});

it('keeps web blank/unblank separate and does not publish if durable storage fails', async () => {
  const { prisma, redis, apply } = harness();
  await apply('WAKE');
  expect(prisma.client.screen.update).not.toHaveBeenCalled();
  redis.publish.mockClear();
  prisma.client.screen.update.mockRejectedValueOnce(
    new Error('database unavailable'),
  );
  await expect(apply('POWER_ON')).rejects.toThrow('database unavailable');
  expect(redis.publish).not.toHaveBeenCalled();
  expect(prisma.client.auditLog.create).toHaveBeenCalled();
});
