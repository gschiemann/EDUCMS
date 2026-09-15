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
  return { svc, prisma, storage, created, updates, outsideTx, tx };
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

  it('marks the job COMMITTED only after the rows exist', async () => {
    const { svc, updates } = harness();
    await svc.commit({ ...base, selections: [{ sourcePage: 1, mode: 'preserve' }] });
    expect(updates[0]).toMatchObject({
      where: { id: 'job-1', tenantId: 'tenant-a' },
      data: expect.objectContaining({ status: 'COMMITTED' }),
    });
  });

  it('does not mark the job COMMITTED when the transaction failed', async () => {
    const { svc, updates } = harness({ txThrowsOn: 'audit' });
    await expect(
      svc.commit({ ...base, selections: [{ sourcePage: 1, mode: 'preserve' }] }),
    ).rejects.toThrow();
    expect(updates.find((u: any) => u.data?.status === 'COMMITTED')).toBeUndefined();
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

