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
// The PDF parser stays mocked, and primed, even though commit no longer
// imports it: a PDF editable route that came back would call it, and the R1
// tests below assert that it never is.
jest.mock('./parsers/pdf-parser', () => ({ parsePdf: jest.fn() }));
jest.mock('./parsers/pptx-parser', () => ({ parsePptx: jest.fn() }));

import { createHash } from 'node:crypto';
import { ImportCommitService, CommitRejection } from './import-commit.service';
import { CONVERTER_VERSION } from './import-prepare.service';
import type { ImportManifest } from './import-manifest';
import { parsePdf } from './parsers/pdf-parser';
import { parsePptx } from './parsers/pptx-parser';
import type { ParsedDocument } from './parsers/types';

/** A one-slide deck carrying one embedded picture, for the editable route. */
function parsedWithMedia() {
  return {
    sourcePageCount: 3,
    warnings: [],
    media: [{ id: 'm0', data: Buffer.from('png-bytes'), mimeType: 'image/png', name: 'logo.png' }],
    pages: [
      {
        sourcePage: 1, label: 'Page 1', disposition: 'converted' as const,
        screenWidth: 1920, screenHeight: 1080, warnings: [],
        zones: [
          { name: 'Logo', widgetType: 'IMAGE' as const, x: 5, y: 5, width: 20, height: 20, zIndex: 1, mediaRef: 'm0', defaultConfig: {} },
          { name: 'Title', widgetType: 'TEXT' as const, x: 5, y: 30, width: 60, height: 10, zIndex: 2, defaultConfig: { content: 'Hello' } },
        ],
      },
    ],
  } as any;
}

beforeEach(() => {
  (parsePdf as jest.Mock).mockReset();
  (parsePdf as jest.Mock).mockResolvedValue(parsedWithMedia());
  (parsePptx as jest.Mock).mockReset();
  (parsePptx as jest.Mock).mockResolvedValue(parsedWithMedia());
});

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
      availableModes: ['preserve'], defaultMode: 'preserve',
      editableTextCount: 0, editableImageCount: 0,
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
      availableModes: ['preserve'], defaultMode: 'preserve',
      editableTextCount: 0, editableImageCount: 0,
      rasterObjectKey: 't/j/p3.webp', thumbObjectKey: 't/j/p3.thumb.webp',
      widthPx: 1920, heightPx: 1080, warnings: [],
    },
  ],
  ...over,
});

/** A one-slide deck: editable layers are the only route a PowerPoint has. */
const pptxManifest = (): ImportManifest => ({
  version: 1,
  format: 'pptx',
  sourcePageCount: 1,
  warnings: [],
  pages: [
    {
      sourcePage: 1, label: 'Slide 1', disposition: 'converted',
      availableModes: ['editable'], defaultMode: 'editable',
      editableTextCount: 1, editableImageCount: 1, warnings: [],
    },
  ],
});
const pptxJob = {
  manifest: JSON.stringify(pptxManifest()),
  sourceName: 'Assembly.pptx',
  sourceObject: 't/j/source.pptx',
};

function harness(
  over: { job?: Record<string, unknown>; txThrowsOn?: 'audit'; claimLost?: boolean } = {},
) {
  const created = { assets: [] as any[], templates: [] as any[], audits: [] as any[], playlists: [] as any[] };
  const job = {
    id: 'job-1', tenantId: 'tenant-a', createdByUserId: 'u1', status: 'PREPARED',
    sourceName: 'Assembly.pdf', sourceObject: 't/j/source.pdf', sourceSha256: SHA,
    manifest: JSON.stringify(manifest()), converterVersion: CONVERTER_VERSION, result: null,
    ...over.job,
  };
  const updates: any[] = [];
  // Job-row writes made INSIDE the transaction. The COMMITTED finalize lives
  // there now (re-audit R5), so "did the rows land?" and "did the job finish?"
  // are the same question — and `order` is what proves they cannot separate.
  const txUpdates: any[] = [];
  const order: string[] = [];
  const tx = {
    asset: { create: jest.fn((a: any) => { created.assets.push(a.data); return Promise.resolve({ id: 'a' }); }) },
    template: {
      create: jest.fn((a: any) => {
        created.templates.push(a.data);
        order.push('template');
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
    importJob: {
      // `claimLost` is the stale-claim takeover racing us: the finalize matches
      // no row, and everything this transaction inserted has to go with it.
      updateMany: jest.fn((a: any) => {
        txUpdates.push(a);
        order.push('finalize');
        return Promise.resolve({ count: over.claimLost ? 0 : 1 });
      }),
    },
  };
  // Writes through the NON-transaction client are the ones a failed commit
  // cannot roll back, so they are recorded separately and asserted on.
  const outsideTx: any[] = [];
  const prisma = {
    client: {
      importJob: {
        findFirst: jest.fn().mockResolvedValue(job),
        updateMany: jest.fn((a: any) => { updates.push(a); return Promise.resolve({ count: 1 }); }),
      },
      asset: {
        create: jest.fn((a: any) => { outsideTx.push(a.data); return Promise.resolve({ id: 'outside' }); }),
      },
      // The transaction runs the callback; if any insert rejects, the whole
      // thing rejects exactly as Prisma's interactive transaction would.
      $transaction: jest.fn(async (fn: any) => fn(tx)),
    },
  };
  const storage = {
    importStagingBucketName: () => 'import-staging',
    downloadFromBucket: jest.fn(async (_b: string, key: string) =>
      key.includes('/source.') ? SOURCE : Buffer.from(`raster:${key}`)),
    upload: jest.fn(async (p: string) => `https://cdn.example/assets/${p}`),
    toSafeBuffer: (b: Buffer) => b,
  };
  const svc = new ImportCommitService(prisma as any, storage as any);
  return { svc, prisma, storage, created, updates, txUpdates, order, outsideTx, tx };
}

/** Statuses written to the job row outside the transaction, in order. */
const claimTrail = (updates: any[]) => updates.map((u) => u.data?.status);

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
    // No page of a PDF offers editable layers.
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

  it('refuses editable layers for a PDF, even when a manifest claims to offer them', async () => {
    // Nothing this build prepares says so — but a stale or hand-edited manifest
    // could, and the text reconstruction behind it is withdrawn (R1).
    const claims = manifest();
    claims.pages[0].availableModes = ['preserve', 'editable'];
    const { svc, created, storage } = harness({ job: { manifest: JSON.stringify(claims) } });

    await expect(
      svc.commit({ ...base, selections: [{ sourcePage: 1, mode: 'editable' }] }),
    ).rejects.toMatchObject({ code: 'IMPORT_MODE_UNAVAILABLE' });
    expect(created.templates).toHaveLength(0);
    expect(storage.upload).not.toHaveBeenCalled();
    expect(parsePdf).not.toHaveBeenCalled();
    expect(parsePptx).not.toHaveBeenCalled();
  });

  it('refuses a job prepared while PDF pages still offered editable layers', async () => {
    const { svc, created } = harness({ job: { converterVersion: '2026-09-15.1' } });
    await expect(
      svc.commit({ ...base, selections: [{ sourcePage: 1, mode: 'preserve' }] }),
    ).rejects.toMatchObject({ code: 'IMPORT_JOB_STALE' });
    expect(created.templates).toHaveLength(0);
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

describe('ImportCommitService — every selected page, or none (R4)', () => {
  const allThree = {
    ...base,
    selections: [1, 2, 3].map((sourcePage) => ({ sourcePage, mode: 'preserve' as const })),
  };
  const oneSlide = { ...base, selections: [{ sourcePage: 1, mode: 'editable' as const }] };
  const nothing = { assets: [], templates: [], audits: [], playlists: [] };

  it.each<[string, number[], string]>([
    ['the first', [1], 'Page 1 is'],
    ['a middle', [2], 'Page 2 is'],
    ['the last', [3], 'Page 3 is'],
    ['every', [1, 2, 3], 'Pages 1, 2 and 3 are'],
  ])('creates nothing when %s selected page has lost its render', async (_which, gone, named) => {
    const { svc, storage, created, updates } = harness();
    storage.downloadFromBucket.mockImplementation((_b: string, key: string) =>
      Promise.resolve(
        key.includes('/source.')
          ? SOURCE
          : gone.some((n) => key === `t/j/p${n}.webp`)
            ? null
            : Buffer.from(`raster:${key}`),
      ),
    );

    const err: unknown = await svc.commit(allThree).then(
      () => null,
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(CommitRejection);
    expect(err).toMatchObject({ code: 'IMPORT_PAGES_UNAVAILABLE' });
    expect((err as Error).message).toBe(
      `${named} no longer available to add, so nothing was added. Import the file again.`,
    );
    // Refused before anything was published or written…
    expect(storage.upload).not.toHaveBeenCalled();
    expect(created).toEqual(nothing);
    // …and the job is back where it started, so the operator's next attempt is
    // a retry rather than a ten-minute wait for the claim to go stale (R5).
    expect(claimTrail(updates)).toEqual(['COMMITTING', 'PREPARED']);
  });

  it('creates nothing when a selected page never had a render recorded', async () => {
    const m = manifest();
    delete m.pages[1].rasterObjectKey;
    const { svc, storage, created } = harness({ job: { manifest: JSON.stringify(m) } });
    const err: unknown = await svc.commit(allThree).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toMatchObject({ code: 'IMPORT_PAGES_UNAVAILABLE' });
    expect((err as Error).message).toContain('Page 2 is no longer available');
    expect(storage.upload).not.toHaveBeenCalled();
    expect(created).toEqual(nothing);
  });

  it('refuses a slide that no longer rebuilds, before publishing a single picture', async () => {
    const deck = parsedWithMedia() as ParsedDocument;
    deck.pages[0].zones = [];
    (parsePptx as jest.Mock).mockResolvedValue(deck);
    const { svc, storage, created } = harness({ job: pptxJob });
    await expect(svc.commit(oneSlide)).rejects.toMatchObject({ code: 'IMPORT_PAGES_UNAVAILABLE' });
    expect(storage.upload).not.toHaveBeenCalled();
    expect(created).toEqual(nothing);
  });

  it('refuses a slide whose only picture failed to publish, instead of adding it empty', async () => {
    const deck = parsedWithMedia() as ParsedDocument;
    deck.pages[0].zones = deck.pages[0].zones.filter((z) => z.widgetType === 'IMAGE');
    (parsePptx as jest.Mock).mockResolvedValue(deck);
    const { svc, storage, created } = harness({ job: pptxJob });
    storage.upload.mockImplementation(() => Promise.reject(new Error('storage unavailable')));
    await expect(svc.commit(oneSlide)).rejects.toMatchObject({ code: 'IMPORT_PAGES_UNAVAILABLE' });
    expect(created).toEqual(nothing);
  });
});

describe('ImportCommitService — a failed commit leaves nothing behind', () => {
  // Embedded pictures only exist on the EDITABLE route, so these take it — a
  // `preserve` selection never reaches the media code and would assert nothing.
  const editable = { ...base, selections: [{ sourcePage: 1, mode: 'editable' as const }] };

  it('creates embedded-picture rows through the transaction, never the plain client', async () => {
    const { svc, created, outsideTx } = harness({ job: pptxJob });
    await svc.commit(editable);
    // The deck really did carry a picture, so this route was exercised.
    expect(created.assets.some((a: any) => a.originalName === 'logo.png')).toBe(true);
    expect(outsideTx).toHaveLength(0);
  });

  it('leaves no approved picture behind when the transaction fails', async () => {
    // Created outside, they survive a failed commit: pictures in the library
    // belonging to a template that was never made. That is how it used to work.
    const { svc, outsideTx } = harness({ job: pptxJob, txThrowsOn: 'audit' });
    await expect(svc.commit(editable)).rejects.toThrow();
    expect(outsideTx).toHaveLength(0);
  });

  it('marks the job COMMITTED inside the same transaction as the rows', async () => {
    // It used to be an updateMany AFTER the transaction returned, so a process
    // that died in between left the templates created and the job still
    // PREPARED — and the next retry made every one of them again (re-audit R5).
    const { svc, updates, txUpdates, order } = harness();
    await svc.commit({ ...base, selections: [{ sourcePage: 1, mode: 'preserve' }] });

    expect(txUpdates).toHaveLength(1);
    expect(txUpdates[0]).toMatchObject({
      where: { id: 'job-1', tenantId: 'tenant-a', status: 'COMMITTING' },
      data: expect.objectContaining({ status: 'COMMITTED' }),
    });
    // Rows first, then the finalize, and no gap outside the transaction where
    // one could exist without the other.
    expect(order).toEqual(['template', 'finalize']);
    expect(claimTrail(updates)).toEqual(['COMMITTING']);
  });

  it('records the ids it created, so a retry can hand back the same templates', async () => {
    const { svc, txUpdates } = harness();
    const result = await svc.commit({ ...base, selections: [{ sourcePage: 1, mode: 'preserve' }] });
    expect(JSON.parse(txUpdates[0].data.result)).toEqual(result);
    expect(result.templates[0].id).toBe('tpl-1');
  });

  it('does not mark the job COMMITTED when the transaction failed', async () => {
    const { svc, updates, txUpdates } = harness({ txThrowsOn: 'audit' });
    await expect(
      svc.commit({ ...base, selections: [{ sourcePage: 1, mode: 'preserve' }] }),
    ).rejects.toThrow();
    expect(txUpdates).toEqual([]);
    expect(updates.find((u: any) => u.data?.status === 'COMMITTED')).toBeUndefined();
    expect(claimTrail(updates)).toEqual(['COMMITTING', 'PREPARED']);
  });
});

/**
 * EXACTLY ONCE (re-audit R5).
 *
 * The harness above answers every job-row write with `{ count: 1 }`, which is
 * fine for asserting WHAT is written and useless for asserting WHO WON. So this
 * block runs against a job ROW: one mutable object, and an `updateMany` that
 * evaluates its own `where` against it and answers 0 or 1 exactly as Postgres
 * would. That is what makes a second caller a real second caller.
 *
 * WHAT THIS IS NOT. It is not a database. Two interactive transactions here do
 * not isolate, and the row lock that makes the loser's UPDATE re-evaluate its
 * predicate is Postgres behaviour this cannot reproduce — which is exactly why
 * the claim is taken with a single conditional UPDATE and not a read-then-write
 * that would need that lock to be safe. The audit asked for this to be
 * confirmed against real isolated infrastructure as well; that run is still
 * owed and is written up with the rest of the work.
 */
describe('ImportCommitService — exactly once (R5)', () => {
  const twoPages = {
    ...base,
    selections: [
      { sourcePage: 1, mode: 'preserve' as const },
      { sourcePage: 2, mode: 'preserve' as const },
    ],
  };

  /** One job row, and writes that actually have to match it. */
  function racingHarness(
    over: { job?: Record<string, unknown>; stealDuringTransaction?: unknown } = {},
  ) {
    const created = { templates: [] as any[], audits: [] as any[] };
    const row: any = {
      id: 'job-1', tenantId: 'tenant-a', createdByUserId: 'u1', status: 'PREPARED',
      sourceName: 'Assembly.pdf', sourceObject: 't/j/source.pdf', sourceSha256: SHA,
      manifest: JSON.stringify(manifest()), converterVersion: CONVERTER_VERSION,
      result: null,
      expiresAt: new Date(Date.now() + 60 * 60_000),
      updatedAt: new Date(),
      ...over.job,
    };

    /** Only the predicate shapes this service actually issues. */
    const matches = (where: any): boolean => {
      if (where.id !== row.id || where.tenantId !== row.tenantId) return false;
      if (where.expiresAt?.gt && !(row.expiresAt > where.expiresAt.gt)) return false;
      if (where.status !== undefined && where.status !== row.status) return false;
      if (
        where.OR &&
        !where.OR.some(
          (c: any) =>
            c.status === row.status && (!c.updatedAt?.lt || row.updatedAt < c.updatedAt.lt),
        )
      ) return false;
      return true;
    };
    const updateMany = jest.fn(async ({ where, data }: any) => {
      if (!matches(where)) return { count: 0 };
      Object.assign(row, data);
      row.updatedAt = new Date();
      return { count: 1 };
    });

    const tx = {
      asset: { create: jest.fn(async () => ({ id: 'a' })) },
      template: {
        create: jest.fn(async (a: any) => {
          created.templates.push(a.data);
          if (over.stealDuringTransaction) {
            // Someone else finalized this job while our transaction was open.
            row.status = 'COMMITTED';
            row.result = JSON.stringify(over.stealDuringTransaction);
          }
          return { id: `tpl-${created.templates.length}`, name: a.data.name };
        }),
      },
      auditLog: {
        create: jest.fn(async (a: any) => { created.audits.push(a.data); return { id: 'au' }; }),
      },
      importJob: { updateMany },
    };
    const prisma = {
      client: {
        importJob: { findFirst: jest.fn(async () => ({ ...row })), updateMany },
        asset: { create: jest.fn(async () => ({ id: 'outside' })) },
        $transaction: jest.fn(async (fn: any) => fn(tx)),
      },
    };
    const storage = {
      importStagingBucketName: () => 'import-staging',
      downloadFromBucket: jest.fn(async (_b: string, key: string) =>
        key.includes('/source.') ? SOURCE : Buffer.from(`raster:${key}`)),
      upload: jest.fn(async (p: string) => `https://cdn.example/assets/${p}`),
      toSafeBuffer: (b: Buffer) => b,
    };
    return { svc: new ImportCommitService(prisma as any, storage as any), row, created, storage };
  }

  it('creates one import when the SAME commit is sent twice in a row', async () => {
    // The double-click, and the retry after a response is lost on the wire.
    const { svc, created, row } = racingHarness();

    const first = await svc.commit(twoPages);
    const second = await svc.commit(twoPages);

    expect(second).toEqual(first);
    expect(second.templates.map((t) => t.id)).toEqual(['tpl-1', 'tpl-2']);
    // ONE set of rows, and ONE record that an import happened.
    expect(created.templates).toHaveLength(2);
    expect(created.audits).toHaveLength(1);
    expect(row.status).toBe('COMMITTED');
  });

  it('creates one import when two commits arrive at the same time', async () => {
    const { svc, created, row } = racingHarness();

    const settled = await Promise.allSettled([svc.commit(twoPages), svc.commit(twoPages)]);

    // Whatever the interleaving, exactly one import exists.
    expect(created.templates).toHaveLength(2);
    expect(created.audits).toHaveLength(1);
    expect(row.status).toBe('COMMITTED');

    const won = settled.filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<any>[];
    expect(won.length).toBeGreaterThanOrEqual(1);
    const winner = won[0].value;
    expect(winner.templates.map((t: any) => t.id)).toEqual(['tpl-1', 'tpl-2']);
    // The other call either got the same answer or was told it is in progress.
    // Both are honest; neither is a second import.
    for (const r of settled) {
      if (r.status === 'fulfilled') expect(r.value).toEqual(winner);
      else expect(r.reason).toMatchObject({ code: 'IMPORT_COMMIT_IN_PROGRESS', status: 409 });
    }
  });

  it('tells a second caller it is in progress rather than refusing or duplicating', async () => {
    const { svc, created } = racingHarness({ job: { status: 'COMMITTING', updatedAt: new Date() } });
    await expect(svc.commit(twoPages)).rejects.toMatchObject({
      code: 'IMPORT_COMMIT_IN_PROGRESS',
      status: 409,
    });
    expect(created.templates).toHaveLength(0);
  });

  it('lets a crashed commit be retried once its claim has gone stale', async () => {
    // A process that dies mid-commit leaves COMMITTING behind. Without a
    // takeover the operator could never retry this job at all.
    const { svc, created, row } = racingHarness({
      job: { status: 'COMMITTING', updatedAt: new Date(Date.now() - 11 * 60_000) },
    });
    const result = await svc.commit(twoPages);
    expect(result.templates).toHaveLength(2);
    expect(created.templates).toHaveLength(2);
    expect(row.status).toBe('COMMITTED');
  });

  it('rolls its own rows back when another caller finalized first', async () => {
    // The stale-claim takeover racing the original. The finalize re-asserts the
    // claim inside the transaction, so the second one to commit takes its own
    // inserts down and answers with the first one's result.
    const theirs = { templates: [{ id: 'tpl-theirs', name: 'Assembly', sourcePage: 1, mode: 'preserve' }], skippedPages: [] };
    const { svc } = racingHarness({ stealDuringTransaction: theirs });

    // The harness's $transaction does not roll back — a real one does — so what
    // is asserted here is the DECISION: this call does not report its own rows,
    // it reports the ones that actually landed.
    await expect(svc.commit(twoPages)).resolves.toEqual(theirs);
  });

  it('refuses an expired job instead of committing against objects the sweep may have taken', async () => {
    const { svc, created } = racingHarness({ job: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(svc.commit(twoPages)).rejects.toMatchObject({
      code: 'IMPORT_JOB_EXPIRED',
      status: 410,
    });
    expect(created.templates).toHaveLength(0);
  });

  it('claims the job BEFORE it publishes anything', async () => {
    // A loser that got as far as uploading page images would leave them
    // orphaned in the PUBLIC bucket even though its rows rolled back.
    const { svc, storage } = racingHarness({ job: { status: 'COMMITTING', updatedAt: new Date() } });
    await expect(svc.commit(twoPages)).rejects.toMatchObject({ code: 'IMPORT_COMMIT_IN_PROGRESS' });
    expect(storage.upload).not.toHaveBeenCalled();
    expect(storage.downloadFromBucket).not.toHaveBeenCalled();
  });
});

describe('ImportCommitService — a page is published as what it really is (R7)', () => {
  const one = { ...base, selections: [{ sourcePage: 1, mode: 'preserve' as const }] };
  const withRaster = (over: Record<string, unknown>) => {
    const m = manifest();
    Object.assign(m.pages[0], over);
    return { job: { manifest: JSON.stringify(m) } };
  };

  it('publishes a PNG page as a PNG, under a PNG name', async () => {
    // It used to publish EVERY page as `image/webp` with a `.webp` name. A PNG
    // upload is staged as itself, so that was simply false — the object, the
    // asset row and the file name all said WebP about PNG bytes.
    const { svc, created, storage } = harness(withRaster({ rasterMimeType: 'image/png' }));
    await svc.commit(one);

    expect(storage.upload).toHaveBeenCalledWith(
      expect.stringMatching(/^tenant-a\/[0-9a-f-]+\.png$/),
      expect.any(Buffer),
      'image/png',
    );
    expect(created.assets[0]).toMatchObject({ mimeType: 'image/png' });
    expect(created.assets[0].originalName).toMatch(/\.png$/);
  });

  it('publishes a JPEG page as a JPEG', async () => {
    const { svc, created, storage } = harness(withRaster({ rasterMimeType: 'image/jpeg' }));
    await svc.commit(one);
    expect(storage.upload).toHaveBeenCalledWith(
      expect.stringMatching(/\.jpg$/), expect.any(Buffer), 'image/jpeg',
    );
    expect(created.assets[0]).toMatchObject({ mimeType: 'image/jpeg' });
  });

  it('still publishes a rendered PDF page as WebP, because that is what it is', async () => {
    const { svc, created, storage } = harness(withRaster({ rasterMimeType: 'image/webp' }));
    await svc.commit(one);
    expect(storage.upload).toHaveBeenCalledWith(
      expect.stringMatching(/\.webp$/), expect.any(Buffer), 'image/webp',
    );
    expect(created.assets[0]).toMatchObject({ mimeType: 'image/webp' });
  });

  it('treats a job prepared before the type was recorded as the WebP it staged', async () => {
    const { svc, created } = harness(); // no rasterMimeType on any page
    await svc.commit(one);
    expect(created.assets[0]).toMatchObject({ mimeType: 'image/webp' });
    expect(created.assets[0].originalName).toMatch(/\.webp$/);
  });

  it('ignores a media type the manifest made up', async () => {
    // A manifest is persisted JSON, and this string becomes a file extension in
    // an object path. It is resolved through an allowlist, never trusted.
    const { svc, created, storage } = harness(
      withRaster({ rasterMimeType: 'text/html; charset=../../evil' }),
    );
    await svc.commit(one);
    expect(storage.upload).toHaveBeenCalledWith(
      expect.stringMatching(/^tenant-a\/[0-9a-f-]+\.webp$/),
      expect.any(Buffer),
      'image/webp',
    );
    expect(created.assets[0]).toMatchObject({ mimeType: 'image/webp' });
  });

  it('gives a portrait page a portrait canvas', async () => {
    const { svc, created } = harness(
      withRaster({ rasterMimeType: 'image/jpeg', widthPx: 3024, heightPx: 4032 }),
    );
    await svc.commit(one);
    expect(created.templates[0]).toMatchObject({
      screenWidth: 3024, screenHeight: 4032, orientation: 'PORTRAIT',
    });
  });
});

/**
 * Why there is no separate "does the player render an imported template?" test.
 *
 * Because an imported template must not BE different. It reaches a screen down
 * the same road as every other template — playlist, schedule, manifest,
 * WidgetRenderer — and the only way that road can break for imports
 * specifically is if commit emits a shape nothing else emits. So that is what
 * is pinned here: the rows commit writes use the same widget types and the same
 * config keys the rest of the product already renders.
 *
 * This is a structural claim, deliberately, and it is not a hardware claim.
 * Qualification on real panels stays a release gate.
 */
describe('ImportCommitService — the output is an ordinary template', () => {
  const zonesOf = (tpl: any) => JSON.parse(JSON.stringify(tpl.zones.create));

  it('emits only widget types the standard renderer already handles', async () => {
    const { svc, created } = harness();
    await svc.commit({
      ...base,
      selections: [{ sourcePage: 1, mode: 'preserve' }, { sourcePage: 2, mode: 'preserve' }],
    });
    const types = created.templates.flatMap((t: any) => zonesOf(t).map((z: any) => z.widgetType));
    expect(types.length).toBeGreaterThan(0);
    // TEXT and IMAGE are what the parsers produce and what every template uses.
    expect([...new Set(types)].sort()).toEqual(['IMAGE']);
  });

  it('writes the same IMAGE config every other image zone in the product writes', async () => {
    const { svc, created } = harness();
    await svc.commit({ ...base, selections: [{ sourcePage: 1, mode: 'preserve' }] });
    const cfg = JSON.parse(zonesOf(created.templates[0])[0].defaultConfig);
    expect(Object.keys(cfg).sort()).toEqual(['assetUrl', 'fit']);
    expect(cfg.fit).toBe('contain');
  });

  it('carries no import-only field a renderer would have to know about', async () => {
    const { svc, created } = harness();
    await svc.commit({ ...base, selections: [{ sourcePage: 1, mode: 'preserve' }] });
    const tpl = created.templates[0];
    // The row is a plain Template: nothing namespaced to imports, no marker a
    // downstream consumer would need a new branch for.
    for (const key of Object.keys(tpl)) {
      expect(key).not.toMatch(/import|source|manifest|job/i);
    }
    const zone = zonesOf(tpl)[0];
    expect(Object.keys(zone).sort()).toEqual(
      ['defaultConfig', 'height', 'name', 'sortOrder', 'widgetType', 'width', 'x', 'y', 'zIndex'].sort(),
    );
  });

  it('gives the template the page geometry, so a screen gets the right canvas', async () => {
    const { svc, created } = harness();
    await svc.commit({ ...base, selections: [{ sourcePage: 1, mode: 'preserve' }] });
    expect(created.templates[0]).toMatchObject({
      screenWidth: 1920, screenHeight: 1080, orientation: 'LANDSCAPE', status: 'ACTIVE',
    });
  });
});

