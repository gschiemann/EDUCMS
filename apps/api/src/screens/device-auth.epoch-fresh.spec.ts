import { isEpochAcceptableFresh, invalidateDeviceCredentialCache } from './device-auth';

// 2026-10-12 VisionCore: a manifest read that raced the device's own
// re-register cached the pre-commit row; every poll 403'd for 10 min.
describe('isEpochAcceptableFresh', () => {
  const live = (epoch: number, status = 'ACTIVE') => ({
    client: { screen: { findUnique: jest.fn().mockResolvedValue({ id: 's1', tenantId: 't1', screenGroupId: null, status, credentialEpoch: epoch, credentialEpochRotatedAt: new Date() }) } },
  } as any);
  beforeEach(() => invalidateDeviceCredentialCache('s1'));

  it('accepts the current epoch without a read', async () => {
    const prisma = live(5);
    expect(await isEpochAcceptableFresh({ prisma }, 's1', 5, { credentialEpoch: 5, credentialEpochRotatedAt: null })).toBe(true);
    expect(prisma.client.screen.findUnique).not.toHaveBeenCalled();
  });
  it('a token newer than a stale snapshot re-reads the live row and passes', async () => {
    const prisma = live(6);
    expect(await isEpochAcceptableFresh({ prisma }, 's1', 6, { credentialEpoch: 5, credentialEpochRotatedAt: null })).toBe(true);
    expect(prisma.client.screen.findUnique).toHaveBeenCalledTimes(1);
  });
  it('a newer token the live row does not back is still refused', async () => {
    expect(await isEpochAcceptableFresh({ prisma: live(5) }, 's1', 9, { credentialEpoch: 5, credentialEpochRotatedAt: null })).toBe(false);
  });
  it('a revoked live row is refused', async () => {
    expect(await isEpochAcceptableFresh({ prisma: live(6, 'REVOKED') }, 's1', 6, { credentialEpoch: 5, credentialEpochRotatedAt: null })).toBe(false);
  });
  it('an OLD token never triggers a read and stays refused', async () => {
    const prisma = live(9);
    expect(await isEpochAcceptableFresh({ prisma }, 's1', 3, { credentialEpoch: 9, credentialEpochRotatedAt: null })).toBe(false);
    expect(prisma.client.screen.findUnique).not.toHaveBeenCalled();
  });
});
