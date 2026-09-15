/**
 * Commit is the only place this feature creates anything durable, so these are
 * the properties the old single-call endpoint failed, each pinned:
 *
 *   - it creates exactly what was selected, and no playlist appears as a side
 *     effect of importing templates;
 *   - the audit row is inside the same transaction as the rows it describes,
 *     so a failed audit cannot leave a successful-looking import behind;
 *   - moderation follows the derivative — an image pulled out of a
 *     contributor's deck does not become APPROVED because it arrived inside a
 *     document;
 *   - a repeat commit returns the first result instead of making a second copy.
 */
import { createHash } from 'node:crypto';
import { ImportCommitService, CommitRejection } from './import-commit.service';
import { CONVERTER_VERSION } from './import-prepare.service';
import type { ImportManifest } from './import-manifest';

const SOURCE = Buffer.from('%PDF-1.4 pretend document');
const SHA = createHash('sha256').update(SOURCE).digest('hex');

const manifest = (over: Partial<ImportManifest> = {}): ImportManifest => ({
  version: 1,
  format: 'pdf',
  sourcePageCount: 3,
  warnings: [],
  pages: [
    {
      sourcePage: 1, label: 'Page 1', disposition: 'converted',
      availableModes: ['preserve', 'editable'], defaultMode: 'preserve',
      editableTextCount: 3, editableImageCount: 0,
      rasterObjectKey: 't/j/p1.webp', thumbObjectKey: 't/j/p1.thumb.webp',
      widthPx: 1920, heightPx: 1080, warnings: [],
    },
    {
      // The artwork-only page today's importer drops on the floor.
      sourcePage: 2, label: 'Page 2', disposition: 'empty',
      availableModes: ['preserve'], defaultMode: 'preserve',
      editableTextCount: 0, editableImageCount: 0,
      rasterObjectKey: 't/j/p2.webp', thumbObjectKey: 't/j/p2.thumb.webp',
      widthPx: 1920, heightPx: 1080, warnings: [],
    },
    {
      sourcePage: 3, label: 'Page 3', disposition: 'converted',
      availableModes: ['preserve', 'editable'], defaultMode: 'preserve',
      editableTextCount: 1, editableImageCount: 0,
      rasterObjectKey: 't/j/p3.webp', thumbObjectKey: 't/j/p3.thumb.webp',
      widthPx: 1920, heightPx: 1080, warnings: [],
    },
  ],
  ...over,
});

function harness(over: { job?: Record<string, unknown>; txThrowsOn?: 'audit' } = {}) {
  const created = { assets: [] as any[], templates: [] as any[], audits: [] as any[], playlists: [] as any[] };
  const job = {
    id: 'job-1', tenantId: 'tenant-a', createdByUserId: 'u1', status: 'PREPARED',
    sourceName: 'Assembly.pdf', sourceObject: 't/j/source.pdf', sourceSha256: SHA,
    manifest: JSON.stringify(manifest()), converterVersion: CONVERTER_VERSION, result: null,
    ...over.job,
  };
  const updates: any[] = [];
  const tx = {
    asset: { create: jest.fn((a: any) => { created.assets.push(a.data); return Promise.resolve({ id: 'a' }); }) },
    template: {
      create: jest.fn((a: any) => {
        created.templates.push(a.data);
        return Promise.resolve({ id: `tpl-${created.templates.length}`, name: a.data.name });
      }),
    },
    auditLog: {
      create: jest.fn((a: any) => {
        if (over.txThrowsOn === 'audit') return Promise.reject(new Error('audit insert failed'));
        created.audits.push(a.data);
        return Promise.resolve({ id: 'au' });
      }),
    },
    playlist: { create: jest.fn(() => { created.playlists.push({}); return Promise.resolve({}); }) },
  };
  const prisma = {
    client: {
      importJob: {
        findFirst: jest.fn().mockResolvedValue(job),
        updateMany: jest.fn((a: any) => { updates.push(a); return Promise.resolve({ count: 1 }); }),
      },
      asset: { create: tx.asset.create },
      // The transaction runs the callback; if any insert rejects, the whole
      // thing rejects exactly as Prisma's interactive transaction would.
      $transaction: jest.fn(async (fn: any) => fn(tx)),
    },
  };
  const storage = {
    importStagingBucketName: () => 'import-staging',
    downloadFromBucket: jest.fn(async (_b: string, key: string) =>
      key.endsWith('source.pdf') ? SOURCE : Buffer.from(`raster:${key}`)),
    upload: jest.fn(async (p: string) => `https://cdn.example/assets/${p}`),
    toSafeBuffer: (b: Buffer) => b,
  };
  const svc = new ImportCommitService(prisma as any, storage as any);
  return { svc, prisma, storage, created, updates, tx };
}

const base = { tenantId: 'tenant-a', userId: 'u1', userRole: 'SCHOOL_ADMIN', jobId: 'job-1' };

describe('ImportCommitService', () => {
  it('creates exactly the selected pages — including the artwork-only one — and no playlist', async () => {
    const { svc, created } = harness();
    const result = await svc.commit({
      ...base,
      selections: [
        { sourcePage: 1, mode: 'preserve' },
        { sourcePage: 2, mode: 'preserve' },
      ],
    });
    expect(result.templates).toHaveLength(2);
    expect(result.templates.map((t) => t.sourcePage)).toEqual([1, 2]);
    // Page 3 was convertible and not chosen — reported, not silently forgotten.
    expect(result.skippedPages).toEqual([3]);
    // The old endpoint made a playlist whether or not you asked for one.
    expect(created.playlists).toHaveLength(0);
  });

  it('writes the audit row inside the same transaction as the templates', async () => {
    const { svc, created } = harness();
    await svc.commit({ ...base, selections: [{ sourcePage: 1, mode: 'preserve' }] });
    expect(created.audits).toHaveLength(1);
    expect(created.audits[0]).toMatchObject({ action: 'IMPORT_DESIGN', targetId: 'job-1' });
    // …and it describes the import without quoting the operator's slides.
    expect(JSON.stringify(created.audits[0].details)).not.toMatch(/Page 1 body text/);
  });

  it('a failed audit takes the whole commit with it, instead of a silent success', async () => {
    // The old path caught this and returned ok:true, so an import could be
    // reported as done with no record that it happened.
    const { svc } = harness({ txThrowsOn: 'audit' });
    await expect(
      svc.commit({ ...base, selections: [{ sourcePage: 1, mode: 'preserve' }] }),
    ).rejects.toThrow(/audit insert failed/);
  });

  it("a contributor's published page inherits review, rather than being approved for arriving in a document", async () => {
    const { svc, created } = harness();
    await svc.commit({
      ...base, userRole: 'CONTRIBUTOR',
      selections: [{ sourcePage: 1, mode: 'preserve' }],
    });
    expect(created.assets[0]).toMatchObject({ status: 'PENDING_APPROVAL' });
  });

  it('an admin publishes approved', async () => {
    const { svc, created } = harness();
    await svc.commit({ ...base, selections: [{ sourcePage: 1, mode: 'preserve' }] });
    expect(created.assets[0]).toMatchObject({ status: 'APPROVED' });
  });

  it('refuses a mode the page never offered', async () => {
    // Page 2 is artwork only: there is nothing to make editable.
    const { svc } = harness();
    await expect(
      svc.commit({ ...base, selections: [{ sourcePage: 2, mode: 'editable' }] }),
    ).rejects.toThrow(CommitRejection);
  });

  it('ignores a page that is not in the manifest at all', async () => {
    const { svc } = harness();
    await expect(
      svc.commit({ ...base, selections: [{ sourcePage: 99, mode: 'preserve' }] }),
    ).rejects.toThrow(/at least one page/i);
  });

  it('a second commit returns the first result instead of making a second copy', async () => {
    const prior = { templates: [{ id: 'tpl-1', name: 'Assembly', sourcePage: 1, mode: 'preserve' }], skippedPages: [] };
    const { svc, created } = harness({ job: { status: 'COMMITTED', result: JSON.stringify(prior) } });
    const again = await svc.commit({ ...base, selections: [{ sourcePage: 1, mode: 'preserve' }] });
    expect(again).toEqual(prior);
    expect(created.templates).toHaveLength(0);
  });

  it('refuses a job prepared by a different converter, rather than quietly producing something else', async () => {
    const { svc } = harness({ job: { converterVersion: '2020-01-01.0' } });
    await expect(
      svc.commit({ ...base, selections: [{ sourcePage: 1, mode: 'preserve' }] }),
    ).rejects.toThrow(/import the file again/i);
  });

  it('refuses when the staged file no longer matches what was reviewed', async () => {
    const { svc } = harness({ job: { sourceSha256: 'not-the-same' } });
    await expect(
      svc.commit({ ...base, selections: [{ sourcePage: 1, mode: 'preserve' }] }),
    ).rejects.toThrow(/does not match what was reviewed/i);
  });

  it('never reads another tenant’s job', async () => {
    const { svc, prisma } = harness();
    await svc.commit({ ...base, selections: [{ sourcePage: 1, mode: 'preserve' }] });
    expect(prisma.client.importJob.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'job-1', tenantId: 'tenant-a' } }),
    );
  });

  it('publishes the page to the PUBLIC bucket, so a screen never depends on a link that expires', async () => {
    const { svc, storage, created } = harness();
    await svc.commit({ ...base, selections: [{ sourcePage: 1, mode: 'preserve' }] });
    expect(storage.upload).toHaveBeenCalled();
    const zones = JSON.parse(JSON.stringify(created.templates[0].zones.create));
    expect(JSON.parse(zones[0].defaultConfig).assetUrl).toMatch(/^https:\/\/cdn\.example\/assets\//);
  });
});
