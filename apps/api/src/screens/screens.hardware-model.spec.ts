/**
 * Regression tests for the Screen.hardwareModel round-trip through
 * PUT /screens/:id and the screens list endpoint.
 *
 * 2026-05-27 — added with the hardware-aware foundation layer
 * (commit Z / docs/EP6N_HARDWARE_EVAL.md). Confirms:
 *   1. Valid model id persists + comes back on the row
 *   2. Null clears the column
 *   3. Whitespace + case are normalized to the canonical id
 *   4. Unknown model id returns 400 BAD_REQUEST (no silent write)
 *   5. Skipping the key preserves the existing value
 *   6. PATCH on a screen not in the caller's tenant returns 404
 *
 * Mirrors the testing pattern in screens.register.spec.ts — minimal
 * Prisma + RedisService + WebsocketSignerService + LicenseService mocks.
 */

import { ScreensController } from './screens.controller';
import { HardwareModel } from '@cms/api-types';

// Stub requireSecret so tests don't need real env vars.
jest.mock('../security/required-secret', () => ({
  requireSecret: (_name: string, opts?: { devFallback?: string }) =>
    opts?.devFallback ?? 'test_secret_32_chars_padded_here_ok',
}));

// Minimal Prisma mock.
const mockPrisma: any = {
  client: {
      // readableTenantIds (fleet-scoped update, 2026-08-31): no children
      // in these fixtures -> the readable set collapses to the caller.
      tenant: { findMany: jest.fn(async () => []) },
    screen: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
  },
};

const mockRedis: any = { publish: jest.fn() };
const mockSigner: any = { signMessage: jest.fn(() => ({ type: 'SYNC', signature: 'x', timestamp: Date.now() })) };
const mockLicense: any = { assertSeatAvailable: jest.fn() };

let controller: ScreensController;

beforeEach(() => {
  jest.clearAllMocks();
  controller = new ScreensController(mockPrisma, mockRedis, mockSigner, mockLicense, {} as any, {} as any);
});

const ADMIN_REQ = {
  user: { id: 'user-admin', tenantId: 'tenant-xyz', role: 'SCHOOL_ADMIN' },
};

const SCREEN_ROW = {
  id: 'screen-001',
  tenantId: 'tenant-xyz',
  name: 'Lobby Screen',
  location: 'Main hall',
  screenGroupId: null,
  hardwareModel: null,
};

describe('PUT /screens/:id — hardwareModel round-trip', () => {
  it('persists a valid model id and includes it in the response', async () => {
    mockPrisma.client.screen.findFirst.mockResolvedValueOnce(SCREEN_ROW);
    const updatedRow = { ...SCREEN_ROW, hardwareModel: 'goodview-ep6n', screenGroup: null };
    mockPrisma.client.screen.update.mockResolvedValueOnce(updatedRow);

    const result = await controller.update(
      ADMIN_REQ as any,
      SCREEN_ROW.id,
      { hardwareModel: 'goodview-ep6n' as HardwareModel },
    );

    expect(result).toEqual(updatedRow);
    // SEC-009 (2026-09-05): the assertion was tightened, not relaxed — the
    // write must now carry the FLEET tenant window (the caller's tenant plus
    // its own non-archived children, the same set the read above used) so the
    // tenant boundary lives in the query rather than only in the prior read.
    expect(mockPrisma.client.screen.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: SCREEN_ROW.id, tenantId: { in: expect.arrayContaining([ADMIN_REQ.user.tenantId]) } },
        data: expect.objectContaining({ hardwareModel: 'goodview-ep6n' }),
      }),
    );
  });

  it('null hardwareModel clears the column back to unassigned', async () => {
    const paired = { ...SCREEN_ROW, hardwareModel: 'novastar-taurus' };
    mockPrisma.client.screen.findFirst.mockResolvedValueOnce(paired);
    mockPrisma.client.screen.update.mockResolvedValueOnce({
      ...paired,
      hardwareModel: null,
      screenGroup: null,
    });

    await controller.update(ADMIN_REQ as any, SCREEN_ROW.id, { hardwareModel: null });

    expect(mockPrisma.client.screen.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ hardwareModel: null }),
      }),
    );
  });

  it('normalizes whitespace and case to the canonical id', async () => {
    mockPrisma.client.screen.findFirst.mockResolvedValueOnce(SCREEN_ROW);
    mockPrisma.client.screen.update.mockResolvedValueOnce({
      ...SCREEN_ROW,
      hardwareModel: 'goodview-ep6n',
      screenGroup: null,
    });

    await controller.update(
      ADMIN_REQ as any,
      SCREEN_ROW.id,
      { hardwareModel: ' Goodview-EP6N ' as any },
    );

    expect(mockPrisma.client.screen.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ hardwareModel: 'goodview-ep6n' }),
      }),
    );
  });

  it('rejects an unknown model id with 400 — never silently writes a typo', async () => {
    mockPrisma.client.screen.findFirst.mockResolvedValueOnce(SCREEN_ROW);

    await expect(
      controller.update(
        ADMIN_REQ as any,
        SCREEN_ROW.id,
        { hardwareModel: 'made-up-vendor-9000' as any },
      ),
    ).rejects.toMatchObject({
      status: 400,
    });

    // Never even tried to update on a rejected input.
    expect(mockPrisma.client.screen.update).not.toHaveBeenCalled();
  });

  it('preserves the existing hardwareModel when the key is absent from the body', async () => {
    const paired = { ...SCREEN_ROW, hardwareModel: 'goodview-ep6n' };
    mockPrisma.client.screen.findFirst.mockResolvedValueOnce(paired);
    mockPrisma.client.screen.update.mockResolvedValueOnce({
      ...paired,
      screenGroup: null,
    });

    // Caller patches only the name — hardwareModel should not appear in
    // the data shape at all.
    await controller.update(
      ADMIN_REQ as any,
      SCREEN_ROW.id,
      { name: 'New Name' },
    );

    const callArgs = mockPrisma.client.screen.update.mock.calls[0][0];
    expect(callArgs.data).not.toHaveProperty('hardwareModel');
    expect(callArgs.data.name).toBe('New Name');
  });

  it('returns 404 if the screen is in another tenant', async () => {
    mockPrisma.client.screen.findFirst.mockResolvedValueOnce(null);
    await expect(
      controller.update(
        ADMIN_REQ as any,
        'screen-foreign',
        { hardwareModel: 'goodview-ep6n' as HardwareModel },
      ),
    ).rejects.toMatchObject({
      status: 404,
    });
  });

  it('round-trips every valid HardwareModel literal', async () => {
    // Tracks each catalog id through update() once.
    const models: HardwareModel[] = [
      'goodview-ep6n',
      'goodview-ecbox3576',
      'novastar-taurus',
      'pi5',
      'generic-android',
      'web',
      'unknown',
    ];

    for (const m of models) {
      jest.clearAllMocks();
      mockPrisma.client.screen.findFirst.mockResolvedValueOnce(SCREEN_ROW);
      mockPrisma.client.screen.update.mockResolvedValueOnce({
        ...SCREEN_ROW,
        hardwareModel: m,
        screenGroup: null,
      });

      const result = await controller.update(
        ADMIN_REQ as any,
        SCREEN_ROW.id,
        { hardwareModel: m },
      );

      expect((result as any).hardwareModel).toBe(m);
      expect(mockPrisma.client.screen.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ hardwareModel: m }),
        }),
      );
    }
  });
});
