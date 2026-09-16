/**
 * The staging sweep deletes only what a job row names, and it never strands a
 * row. Both properties are load-bearing: the first is what stops a bug here
 * from walking a shared bucket, and the second is what stops a storage blip
 * from producing an infinite retry against an object that is already gone.
 */
import {
  ImportStagingSweepCron,
  stagedObjectKeys,
  unsweptLegacyKeys,
} from './import-staging-sweep.cron';

describe('stagedObjectKeys', () => {
  it('collects the original plus every artifact the manifest recorded', () => {
    const manifest = JSON.stringify({
      pages: [
        { sourcePage: 1, objectKey: 't/job/p1.webp', thumbObjectKey: 't/job/p1.thumb.webp' },
        { sourcePage: 2, objectKey: 't/job/p2.webp', thumbObjectKey: 't/job/p2.thumb.webp' },
      ],
    });
    expect(stagedObjectKeys('t/job/source.pdf', manifest).sort()).toEqual([
      't/job/p1.thumb.webp', 't/job/p1.webp', 't/job/p2.thumb.webp', 't/job/p2.webp', 't/job/source.pdf',
    ]);
  });

  /** What prepare ACTUALLY writes. The test above used a field it never emits. */
  const realManifest = JSON.stringify({
    pages: [
      { sourcePage: 1, rasterObjectKey: 't/job/p1.webp', thumbObjectKey: 't/job/p1.thumb.webp' },
      { sourcePage: 2, rasterObjectKey: 't/job/p2.webp', thumbObjectKey: 't/job/p2.thumb.webp' },
    ],
  });

  it('collects the FULL-SIZE page render, not just its thumbnail', () => {
    // THE LEAK (re-audit R6). This collected `objectKey` and `thumbObjectKey`;
    // prepare writes `rasterObjectKey` and `thumbObjectKey`. So every sweep
    // deleted the thumbnails, left every full-size render behind, and then
    // cleared `manifest` in the same tick — destroying the only record of the
    // keys. At one 1920-px WebP per page that is nearly all the bytes an import
    // stages, orphaned permanently.
    expect(stagedObjectKeys('t/job/source.pdf', realManifest).sort()).toEqual([
      't/job/p1.thumb.webp', 't/job/p1.webp',
      't/job/p2.thumb.webp', 't/job/p2.webp',
      't/job/source.pdf',
    ]);
  });

  it('ignores URLs — only ever an object key', () => {
    // A signed URL is already expired and a public URL belongs to a different
    // bucket. Handing either to a delete is how you remove the wrong thing.
    const manifest = JSON.stringify({
      pages: [{ previewUrl: 'https://x.supabase.co/storage/v1/object/assets/other/tenant/live.png' }],
    });
    expect(stagedObjectKeys('t/job/source.pdf', manifest)).toEqual(['t/job/source.pdf']);
  });

  it('does not guess when the manifest cannot be parsed', () => {
    expect(stagedObjectKeys('t/job/source.pdf', '{not json')).toEqual(['t/job/source.pdf']);
  });

  it('names what the old field set left behind, so the orphans can be found', () => {
    // The detector. Run over stored ImportJob rows, a non-empty answer is the
    // condition — per job, from the job's OWN manifest, never a name guessed
    // from the bucket.
    const manifest = JSON.stringify({
      pages: [
        { sourcePage: 1, rasterObjectKey: 't/job/p1.webp', thumbObjectKey: 't/job/p1.thumb.webp' },
      ],
    });
    expect(unsweptLegacyKeys('t/job/source.pdf', manifest)).toEqual(['t/job/p1.webp']);
  });

  it('reports nothing unswept for a job with no page renders', () => {
    expect(unsweptLegacyKeys('t/job/source.pptx', JSON.stringify({ pages: [{ sourcePage: 1 }] }))).toEqual([]);
    expect(unsweptLegacyKeys('t/job/source.pdf', null)).toEqual([]);
    expect(unsweptLegacyKeys('t/job/source.pdf', '{not json')).toEqual([]);
  });

  it('is depth-bounded, so a hostile manifest cannot spin it', () => {
    let deep: any = { objectKey: 'too/deep.webp' };
    for (let i = 0; i < 40; i++) deep = { nested: deep };
    expect(stagedObjectKeys(null, JSON.stringify(deep))).toEqual([]);
  });
});

describe('ImportStagingSweepCron.sweep', () => {
  const makeCron = (jobs: any[], storage: any) => {
    const updated: any[] = [];
    const prisma = {
      client: {
        importJob: {
          findMany: jest.fn().mockResolvedValue(jobs),
          updateMany: jest.fn((args: any) => { updated.push(args); return Promise.resolve({ count: 1 }); }),
        },
      },
    };
    const cron = new ImportStagingSweepCron(prisma as any, storage as any);
    return { cron, prisma, updated };
  };

  const storageOk = () => ({
    importStagingBucketName: () => 'import-staging',
    deleteManyFromBucket: jest.fn().mockResolvedValue(2),
  });

  it('deletes from the PRIVATE staging bucket, never the assets bucket', async () => {
    const storage = storageOk();
    const { cron } = makeCron(
      [{ id: 'j1', tenantId: 'tenant-a', sourceObject: 't/j1/source.pdf', manifest: null }],
      storage,
    );
    await cron.sweep();
    expect(storage.deleteManyFromBucket).toHaveBeenCalledWith('import-staging', ['t/j1/source.pdf']);
  });

  it('marks each swept job EXPIRED and drops its manifest', async () => {
    const { cron, updated } = makeCron(
      [{ id: 'j1', tenantId: 'tenant-a', sourceObject: 't/j1/s.pdf', manifest: null }],
      storageOk(),
    );
    const result = await cron.sweep();
    expect(result).toEqual({ jobs: 1, objects: 1 });
    expect(updated[0]).toMatchObject({ where: { id: 'j1', tenantId: 'tenant-a' }, data: { status: 'EXPIRED', manifest: null } });
  });

  it('expires the row even when storage delete throws, rather than retrying forever', async () => {
    const storage = {
      importStagingBucketName: () => 'import-staging',
      deleteManyFromBucket: jest.fn().mockRejectedValue(new Error('storage down')),
    };
    const { cron, updated } = makeCron(
      [{ id: 'j1', tenantId: 'tenant-a', sourceObject: 't/j1/s.pdf', manifest: null }],
      storage,
    );
    const result = await cron.sweep();
    expect(updated[0]).toMatchObject({ data: { status: 'EXPIRED', manifest: null } });
    // Nothing was confirmed deleted, and the count says so honestly.
    expect(result.objects).toBe(0);
  });

  it('asks only for rows past expiry that are not already EXPIRED', async () => {
    const { cron, prisma } = makeCron([], storageOk());
    const now = new Date('2026-09-15T12:00:00Z');
    await cron.sweep(now);
    expect(prisma.client.importJob.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { expiresAt: { lt: now }, status: { not: 'EXPIRED' } },
      }),
    );
  });

  it('names the owning tenant in the write, never a bare id', async () => {
    // A bare `where: { id }` on a tenant-owned model is the shape of a
    // cross-tenant write, which the TEN-001 gate refuses on sight — correctly,
    // even though this id came from a query one line above.
    const { cron, updated } = makeCron(
      [{ id: 'j1', tenantId: 'tenant-a', sourceObject: 't/j1/s.pdf', manifest: null }],
      storageOk(),
    );
    await cron.sweep();
    expect(updated[0].where).toEqual({ id: 'j1', tenantId: 'tenant-a' });
  });

  it('stands down when another replica holds the lease', async () => {
    const storage = storageOk();
    const { cron, prisma } = makeCron([{ id: 'j1', tenantId: 'tenant-a', sourceObject: 's', manifest: null }], storage);
    (cron as any).lease = { tryAcquire: jest.fn().mockResolvedValue({ name: 'x', leader: false, fence: 0 }) };
    expect(await cron.sweep()).toEqual({ jobs: 0, objects: 0 });
    expect(prisma.client.importJob.findMany).not.toHaveBeenCalled();
    expect(storage.deleteManyFromBucket).not.toHaveBeenCalled();
  });
});
