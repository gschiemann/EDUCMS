import { GeocodeAutoHealCron } from './geocode-autoheal.cron';
import { GeocodeBackfillAlreadyRunningError } from './geocode-backfill.service';

/**
 * The auto-heal tick's contract: a quiet fleet costs one count() and nothing
 * else; candidates trigger a REAL (dryRun:false) bounded run; a concurrent
 * manual run is tolerated, never crashed on.
 */

function makeDeps(candidateCount: number) {
  const prisma = {
    client: { tenant: { count: jest.fn(async () => candidateCount) } },
  } as any;
  const backfill = {
    run: jest.fn(async () => ({ geocoded: 2, failed: 0, skipped: 0 })),
  } as any;
  return { prisma, backfill };
}

describe('GeocodeAutoHealCron.tick', () => {
  it('does nothing beyond the count when no candidates exist', async () => {
    const { prisma, backfill } = makeDeps(0);
    await new GeocodeAutoHealCron(prisma, backfill).tick();
    expect(prisma.client.tenant.count).toHaveBeenCalledWith({
      where: { address: { not: null }, latitude: null, longitude: null },
    });
    expect(backfill.run).not.toHaveBeenCalled();
  });

  it('runs a real, bounded backfill when candidates exist', async () => {
    const { prisma, backfill } = makeDeps(3);
    await new GeocodeAutoHealCron(prisma, backfill).tick();
    expect(backfill.run).toHaveBeenCalledWith({ dryRun: false, limit: 25 });
  });

  it('swallows a single-flight collision instead of throwing out of the tick', async () => {
    const { prisma, backfill } = makeDeps(3);
    backfill.run.mockRejectedValueOnce(new GeocodeBackfillAlreadyRunningError());
    await expect(new GeocodeAutoHealCron(prisma, backfill).tick()).resolves.toBeUndefined();
  });
});
