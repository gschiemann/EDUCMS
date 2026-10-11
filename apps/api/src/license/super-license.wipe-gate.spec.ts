import { HttpException } from '@nestjs/common';
import { SuperLicenseController, isPlatformAssetWipeEnabled } from './super-license.controller';

/**
 * Muse beta (2026-10-07): "Wipe ALL Assets" deletes every tenant's media.
 * It is off unless PLATFORM_ASSET_WIPE_ENABLED is exactly 1/true, and a
 * refused attempt is audited.
 */
describe('POST /super/storage/wipe-all-assets — env gate', () => {
  const OLD = process.env.PLATFORM_ASSET_WIPE_ENABLED;
  afterEach(() => {
    if (OLD === undefined) delete process.env.PLATFORM_ASSET_WIPE_ENABLED;
    else process.env.PLATFORM_ASSET_WIPE_ENABLED = OLD;
  });

  function build() {
    const prisma = {
      client: {
        auditLog: { create: jest.fn().mockResolvedValue({}) },
        asset: {
          count: jest.fn().mockResolvedValue(0),
          aggregate: jest.fn().mockResolvedValue({ _sum: { fileSize: 0 } }),
          findMany: jest.fn().mockResolvedValue([]),
          deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
        playlistItem: {
          count: jest.fn().mockResolvedValue(0),
          deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
        $transaction: jest.fn(async (fn: any) => fn(prisma.client)),
      },
    };
    const storage = {
      bucketName: () => 'assets',
      extractPath: () => null,
      deleteMany: jest.fn().mockResolvedValue(0),
    };
    const ctrl = new SuperLicenseController(prisma as any, {} as any, storage as any);
    return { ctrl, prisma, storage };
  }

  it.each([[undefined], [''], ['0'], ['yes'], ['tru']])('is off for %p', (v) => {
    expect(isPlatformAssetWipeEnabled(v === undefined ? {} : { PLATFORM_ASSET_WIPE_ENABLED: v })).toBe(false);
  });

  it.each([['1'], ['true'], [' TRUE ']])('is on for %p', (v) => {
    expect(isPlatformAssetWipeEnabled({ PLATFORM_ASSET_WIPE_ENABLED: v })).toBe(true);
  });

  it('refuses with 403 by default, deletes nothing, and audits the attempt', async () => {
    delete process.env.PLATFORM_ASSET_WIPE_ENABLED;
    const { ctrl, prisma, storage } = build();
    let err: any;
    try {
      await ctrl.wipeAllAssets({ confirm: 'YES_WIPE_ALL_ASSETS' }, { user: { userId: 'u1' } });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(403);
    expect(err.getResponse().code).toBe('STORAGE_WIPE_DISABLED');
    expect(prisma.client.asset.deleteMany).not.toHaveBeenCalled();
    expect(prisma.client.playlistItem.deleteMany).not.toHaveBeenCalled();
    expect(storage.deleteMany).not.toHaveBeenCalled();
    expect(prisma.client.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'STORAGE_WIPE_ALL_ASSETS_REFUSED', userId: 'u1' }),
      }),
    );
  });

  it('when enabled, still requires the typed confirmation, and audits a real wipe', async () => {
    process.env.PLATFORM_ASSET_WIPE_ENABLED = '1';
    const { ctrl, prisma } = build();
    await expect(ctrl.wipeAllAssets({}, { user: { userId: 'u1' } })).rejects.toBeInstanceOf(HttpException);
    expect(prisma.client.asset.deleteMany).not.toHaveBeenCalled();

    await ctrl.wipeAllAssets({ confirm: 'YES_WIPE_ALL_ASSETS' }, { user: { userId: 'u1' } });
    expect(prisma.client.asset.deleteMany).toHaveBeenCalled();
    expect(prisma.client.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'STORAGE_WIPE_ALL_ASSETS' }) }),
    );
  });
});
