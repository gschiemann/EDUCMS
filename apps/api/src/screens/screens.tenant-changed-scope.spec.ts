/**
 * R-05 — TENANT_CHANGED must NOT be published fleet-wide.
 *
 * ScreensController.pair() emits a TENANT_CHANGED envelope whose payload
 * names ONE screen (`screenId`), so the physical kiosk wipes its DataStore
 * (device token, tenantId, usbIngestKey) and its filesDir/usb-cache before
 * re-pairing into the new district. It used to publish that on
 * `tenant:<previousTenantId>` — a channel every screen in the OLD district is
 * subscribed to. The player's TENANT_CHANGED handler wipes its device token,
 * manifest cache, emergency cache and SW tiers, so a single cross-district
 * re-pair would have been a district-wide kill switch. It now goes on
 * `device:<screenId>`.
 *
 * The branch is currently LATENT: pair() 409s a cross-tenant claim before it
 * can be reached (see the SCREEN_ALREADY_PAIRED guard test below, which pins
 * that). The scope test therefore drives the branch directly — a
 * `req.user.tenantId` that reports the screen's CURRENT tenant to the guard
 * and the NEW tenant thereafter — so the device-scoping stays pinned for
 * whoever eventually relaxes that guard.
 */

import { HttpStatus } from '@nestjs/common';
import { ScreensController } from './screens.controller';

jest.mock('../security/required-secret', () => ({
  requireSecret: (_name: string, opts?: { devFallback?: string }) =>
    opts?.devFallback ?? 'test_secret_32_chars_padded_here_ok',
}));

const mockPrisma: any = {
  client: {
    screen: { findUnique: jest.fn(), update: jest.fn() },
    $transaction: jest.fn(),
  },
};
const mockRedis: any = { publish: jest.fn().mockResolvedValue(undefined) };
const mockSigner: any = {
  signMessage: jest.fn((type: string, payload: any) => ({
    eventId: 'evt_1',
    timestamp: Date.now(),
    type,
    payload,
    signature: 'sig',
  })),
};
const mockLicense: any = { assertSeatAvailable: jest.fn() };
const mockStripe: any = { syncSubscriptionQuantity: jest.fn(() => Promise.resolve()) };

let controller: ScreensController;

beforeEach(() => {
  jest.clearAllMocks();
  controller = new ScreensController(
    mockPrisma,
    mockRedis,
    mockSigner,
    mockLicense,
    mockStripe,
    {} as any,
  );
  mockPrisma.client.$transaction.mockImplementation(async (fn: any) =>
    fn({ screen: { update: mockPrisma.client.screen.update } }),
  );
});

/** Find the publish() call carrying a given signed message type. */
function publishCallFor(type: string): [string, any] | undefined {
  return (mockRedis.publish as jest.Mock).mock.calls.find(
    (c: any[]) => c[1] && c[1].type === type,
  ) as [string, any] | undefined;
}

it('R-05: TENANT_CHANGED is published to the DEVICE channel, never the old tenant channel', async () => {
  mockPrisma.client.screen.findUnique.mockResolvedValue({
    id: 'screen-1',
    tenantId: 'tenant-OLD',
    name: 'Lobby',
    pairingCode: 'ABC123',
  });
  mockPrisma.client.screen.update.mockResolvedValue({
    id: 'screen-1',
    tenantId: 'tenant-NEW',
    name: 'Lobby',
    pairingCode: null,
    screenGroup: null,
  });

  // First read (the SCREEN_ALREADY_PAIRED guard) sees the screen's current
  // tenant so the guard passes; every later read is the new tenant, which is
  // exactly the state the TENANT_CHANGED branch guards on.
  let reads = 0;
  const req = {
    user: {
      get tenantId() {
        return reads++ === 0 ? 'tenant-OLD' : 'tenant-NEW';
      },
    },
  };

  await controller.pair(req as any, { pairingCode: 'ABC123' });

  const call = publishCallFor('TENANT_CHANGED');
  expect(call).toBeDefined();
  const [channel, signed] = call!;

  // THE FIX: per-device channel, carrying the same single-screen payload.
  expect(channel).toBe('device:screen-1');
  expect(signed.payload).toMatchObject({
    screenId: 'screen-1',
    previousTenantId: 'tenant-OLD',
    newTenantId: 'tenant-NEW',
  });

  // THE REGRESSION: nothing TENANT_CHANGED may land on ANY tenant channel.
  // (notifySync still publishes an unrelated SYNC on the new tenant — that
  // one is genuinely tenant-wide and harmless.)
  const tenantScoped = (mockRedis.publish as jest.Mock).mock.calls.filter(
    (c: any[]) => typeof c[0] === 'string' && c[0].startsWith('tenant:'),
  );
  expect(tenantScoped.some((c: any[]) => c[1]?.type === 'TENANT_CHANGED')).toBe(false);
  expect(
    (mockRedis.publish as jest.Mock).mock.calls.some(
      (c: any[]) => c[0] === 'tenant:tenant-OLD',
    ),
  ).toBe(false);
});

it('R-05: a cross-tenant claim still 409s before any broadcast (guard untouched)', async () => {
  mockPrisma.client.screen.findUnique.mockResolvedValue({
    id: 'screen-1',
    tenantId: 'tenant-OLD',
    name: 'Lobby',
    pairingCode: 'ABC123',
  });

  await expect(
    controller.pair({ user: { tenantId: 'tenant-NEW' } } as any, { pairingCode: 'ABC123' }),
  ).rejects.toMatchObject({ status: HttpStatus.CONFLICT });

  expect(mockRedis.publish).not.toHaveBeenCalled();
  expect(mockPrisma.client.screen.update).not.toHaveBeenCalled();
});
