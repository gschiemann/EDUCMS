/**
 * PdfPagesService — a PDF's pages, made once after its upload answers
 * (2026-10-05, media beta test M2-02 / L3).
 *
 * The renderer is stubbed here (the real one — pdf.js in the disposable
 * Chromium — is pinned by `proxy/pdf-raster-pipeline.spec.ts`, pixel by
 * pixel); what this suite pins is everything AROUND it: ranges walked to the
 * end, the page cap, the record written (and what a screen will verify), the
 * progress the library shows, a refusal about the file vs a hiccup of this
 * attempt, the guard against a row whose file changed, cleanup of every
 * uploaded object on every failure path, fleet copies, and the stale sweep.
 */
import { createHash } from 'crypto';
import { pdfDelivery, readPdfPages, PDF_PAGE_FRAMES } from '@cms/api-types';
import {
  PDF_PAGES_FAILED,
  PDF_PAGES_RENDERED,
  PdfPagesService,
  pdfPageObjectPaths,
} from './pdf-pages.service';
import type { RasterizeFramesResult } from '../../imports/raster/pdf-raster.service';

const SUPA = 'https://example.supabase.co/storage/v1/object/public/assets/';
const T = 'tenant-a';

type Row = { id: string; tenantId: string; fileUrl: string; mimeType: string; processingMeta: any };

function world(rows: Row[]) {
  const assets = new Map(rows.map((r) => [r.id, { ...r }]));
  const audits: any[] = [];
  const matches = (row: Row, where: any) =>
    (where.id === undefined || (typeof where.id === 'string' ? row.id === where.id : row.id !== where.id.not)) &&
    (where.tenantId === undefined || row.tenantId === where.tenantId) &&
    (where.fileUrl === undefined || row.fileUrl === where.fileUrl);
  const client: any = {
    asset: {
      findFirst: jest.fn(async ({ where }: any) => {
        for (const r of assets.values()) if (matches(r, where)) return { ...r };
        return null;
      }),
      findMany: jest.fn(async ({ where }: any) => [...assets.values()].filter((r) => matches(r, where)).map((r) => ({ ...r }))),
      updateMany: jest.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const r of assets.values()) {
          if (!matches(r, where)) continue;
          Object.assign(r, data);
          count += 1;
        }
        return { count };
      }),
    },
    auditLog: { create: jest.fn(async ({ data }: any) => audits.push(data)) },
    videoTranscodeJob: { count: jest.fn(async () => 0) },
    $transaction: jest.fn(async (fn: any) => fn(client)),
    $queryRaw: jest.fn(async () => []),
    // The raw pending → pending write (writeProgress): [record JSON, attempts?, id, tenantId, fileUrl].
    $executeRaw: jest.fn(async (sql: { values: unknown[] }) => {
      const v = sql.values;
      const [json] = v;
      const attempts = v.length === 5 ? v[1] : undefined;
      const [id, tenantId, fileUrl] = v.slice(-3);
      const row = assets.get(id as string);
      if (!row || row.tenantId !== tenantId || row.fileUrl !== fileUrl) return 0;
      if (row.processingMeta?.pdfPages?.state !== 'pending') return 0;
      row.processingMeta = {
        ...(row.processingMeta ?? {}),
        pdfPages: JSON.parse(json as string),
        ...(attempts !== undefined ? { pdfPagesAttempts: attempts } : {}),
      };
      return 1;
    }),
  };
  return { prisma: { client } as any, assets, audits, client };
}

function storageStub() {
  const objects = new Map<string, Buffer>();
  return {
    objects,
    extractPath: (url: string) => (url.startsWith(SUPA) ? url.slice(SUPA.length) : null),
    publicUrlForPath: (p: string) => SUPA + p,
    download: jest.fn(async () => Buffer.from('%PDF-1.7 fake')),
    upload: jest.fn(async (p: string, b: Buffer) => {
      objects.set(p, b);
      return SUPA + p;
    }),
    deleteMany: jest.fn(async (paths: string[]) => {
      for (const p of paths) objects.delete(p);
      return paths.length;
    }),
  };
}

/** A renderer stub for a document of `count` pages; `answer` can override a call. */
function rasterStub(count: number, answer?: (firstPage: number, maxPages: number, call: number) => RasterizeFramesResult | null) {
  const calls: Array<{ firstPage: number; maxPages: number }> = [];
  return {
    calls,
    isAvailable: () => true,
    rasterizePdfFrames: jest.fn(async (_b: Buffer, req: any, opts: any) => {
      calls.push({ firstPage: req.firstPage, maxPages: opts.maxPages });
      const forced = answer?.(req.firstPage, opts.maxPages, calls.length);
      if (forced) return forced;
      const last = Math.min(count, req.firstPage + opts.maxPages - 1);
      const pages = [];
      for (let n = req.firstPage; n <= last; n += 1) {
        pages.push({
          sourcePage: n,
          widthPx: 2160,
          heightPx: 2795,
          thumbWebp: Buffer.from(`thumb-${n}`),
          frames: req.frames.map((f: any) => ({ key: f.key, widthPx: f.width, heightPx: f.height, webp: Buffer.from(`${f.key}-${n}`) })),
        });
      }
      return { ok: true, sourcePageCount: count, pages, warnings: [], truncated: last < count, elapsedMs: 1 } as RasterizeFramesResult;
    }),
  };
}

const pending = (over: any = {}) => ({ version: 1, state: 'pending', updatedAt: '2026-10-05T10:00:00.000Z', ...over });
const pdfRow = (id = 'doc', meta: any = { pdfPages: pending() }, over: Partial<Row> = {}): Row => ({
  id,
  tenantId: T,
  fileUrl: `${SUPA}${T}/${id}.pdf`,
  mimeType: 'application/pdf',
  processingMeta: meta,
  ...over,
});

function make(rows: Row[], raster: ReturnType<typeof rasterStub>, tune: Partial<PdfPagesService> = {}) {
  const w = world(rows);
  const storage = storageStub();
  const svc = new PdfPagesService(w.prisma, storage as any, raster as any, undefined);
  Object.assign(svc, { pagesPerJob: 2, busyRetryMs: 0, sleep: async () => undefined }, tune);
  return { svc, storage, ...w };
}

describe('PdfPagesService.render — the pages of one PDF', () => {
  it('walks the document range by range and writes a record a screen can verify', async () => {
    const raster = rasterStub(5);
    const { svc, storage, assets, audits } = make([pdfRow()], raster);
    expect(await svc.render('doc', T)).toEqual({ status: 'ready', pages: 5, count: 5 });
    expect(raster.calls).toEqual([
      { firstPage: 1, maxPages: 2 },
      { firstPage: 3, maxPages: 2 },
      { firstPage: 5, maxPages: 2 },
    ]);
    // Four frames + a thumbnail per page, under ONE folder of this tenant.
    expect(storage.objects.size).toBe(25);
    const folders = new Set([...storage.objects.keys()].map((k) => k.slice(0, k.lastIndexOf('/') + 1)));
    expect(folders.size).toBe(1);
    expect([...folders][0]).toMatch(new RegExp(`^${T}/pdf-pages/doc/[0-9a-f-]{12}/$`));

    const rec = readPdfPages(assets.get('doc')!.processingMeta)!;
    expect(rec).toMatchObject({ state: 'ready', count: 5, done: 5, truncatedAt: null, legacy: false });
    // Every URL the record yields IS an uploaded object, and its hash and size
    // are of exactly those bytes.
    for (const page of rec.pages) {
      for (const spec of PDF_PAGE_FRAMES) {
        const f = page.frames[spec.key];
        const bytes = storage.objects.get(f.url.slice(SUPA.length))!;
        expect(bytes.toString()).toBe(`${spec.key}-${page.n}`);
        expect(f.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
        expect(f.size).toBe(bytes.length);
      }
      expect(storage.objects.has(page.thumbUrl.slice(SUPA.length))).toBe(true);
    }
    expect(audits.map((a) => a.action)).toEqual([PDF_PAGES_RENDERED]);
    expect(assets.get('doc')!.processingMeta.pdfPagesAttempts).toBeUndefined();
  });

  it('writes progress between ranges — "Preparing pages… 2 of 5" — WITHOUT busting every screen\'s manifest', async () => {
    const seen: string[] = [];
    const raster = rasterStub(5);
    const { svc, client } = make([pdfRow()], raster);
    const raw = client.$executeRaw;
    client.$executeRaw = jest.fn(async (sql: any) => {
      const r = JSON.parse(sql.values[0]);
      seen.push(`raw ${r.state}:${r.done ?? '-'}/${r.count ?? '-'}`);
      return raw(sql);
    });
    const update = client.asset.updateMany;
    client.asset.updateMany = jest.fn(async (args: any) => {
      const r = args.data.processingMeta.pdfPages;
      seen.push(`prisma ${r.state}:${r.done ?? '-'}/${r.count ?? '-'}`);
      return update(args);
    });
    await svc.render('doc', T);
    // pending → pending is raw SQL (the manifest cache's hook never sees it: a
    // pending PDF is left out before and after); only the final record is a
    // Prisma write — the one that must reach screens on their next poll.
    expect(seen).toEqual([
      'raw pending:0/-', // the claim
      'raw pending:2/5',
      'raw pending:4/5',
      'prisma ready:-/5',
    ]);
  });

  it('the raw progress write is guarded: this row, this tenant, this file, and only while still pending', async () => {
    const raster = rasterStub(3);
    const { svc, client } = make([pdfRow()], raster);
    await svc.render('doc', T);
    const sql: string = client.$executeRaw.mock.calls[0][0].strings.join('?');
    expect(sql).toMatch(/UPDATE assets/);
    expect(sql).toMatch(/WHERE id = \? AND tenant_id = \? AND file_url = \?/);
    // Never over a final record: a ready / failed row is not pending.
    expect(sql).toMatch(/processing_meta->'pdfPages'->>'state' = 'pending'/);
    expect(client.$executeRaw.mock.calls[0][0].values.slice(-3)).toEqual(['doc', T, `${SUPA}${T}/doc.pdf`]);
  });

  it('stops at the page cap and says how many it did not make', async () => {
    const raster = rasterStub(214);
    const { svc, assets, storage } = make([pdfRow()], raster, { pageCap: 3 });
    expect(await svc.render('doc', T)).toEqual({ status: 'ready', pages: 3, count: 214 });
    expect(raster.calls.map((c) => c.firstPage)).toEqual([1, 3]);
    expect(raster.calls[1].maxPages).toBe(1); // never asks for more than the cap
    expect(readPdfPages(assets.get('doc')!.processingMeta)).toMatchObject({ count: 214, done: 3, truncatedAt: 3 });
    expect(storage.objects.size).toBe(15);
  });

  it('a password-protected PDF is stamped failed with its reason, and nothing is left in storage', async () => {
    const raster = rasterStub(4, (first) => (first === 3 ? { ok: false, reason: 'pdf-password-protected' } : null));
    const { svc, assets, storage, audits } = make([pdfRow()], raster);
    expect(await svc.render('doc', T)).toEqual({ status: 'failed', reason: 'pdf-password-protected' });
    expect(readPdfPages(assets.get('doc')!.processingMeta)).toMatchObject({ state: 'failed', error: 'pdf-password-protected' });
    expect(storage.objects.size).toBe(0);
    expect(audits.map((a) => a.action)).toEqual([PDF_PAGES_FAILED]);
  });

  it('a hiccup of THIS attempt (the browser did not start) leaves it pending for the sweep', async () => {
    const raster = rasterStub(4, (first) => (first === 3 ? { ok: false, reason: 'browser-launch-failed' } : null));
    const { svc, assets, storage } = make([pdfRow()], raster);
    expect(await svc.render('doc', T)).toEqual({ status: 'interrupted' });
    expect(readPdfPages(assets.get('doc')!.processingMeta)!.state).toBe('pending');
    expect(assets.get('doc')!.processingMeta.pdfPagesAttempts).toBe(1);
    expect(storage.objects.size).toBe(0);
  });

  it('waits while the one browser slot is busy (an import), then goes on', async () => {
    const raster = rasterStub(2, (_f, _m, call) => (call <= 2 ? { ok: false, reason: 'raster-busy' } : null));
    const { svc } = make([pdfRow()], raster);
    expect(await svc.render('doc', T)).toEqual({ status: 'ready', pages: 2, count: 2 });
    expect(raster.calls).toHaveLength(3);
  });

  it('three interrupted attempts end it: failed, render-interrupted', async () => {
    const raster = rasterStub(2);
    const { svc, assets } = make([pdfRow('doc', { pdfPages: pending(), pdfPagesAttempts: 3 })], raster);
    expect(await svc.render('doc', T)).toEqual({ status: 'failed', reason: 'render-interrupted' });
    expect(raster.calls).toHaveLength(0);
    expect(readPdfPages(assets.get('doc')!.processingMeta)).toMatchObject({ state: 'failed', error: 'render-interrupted' });
  });

  it('a row whose file was replaced meanwhile is never stamped with the old file\'s pages', async () => {
    const raster = rasterStub(2);
    const { svc, assets, storage } = make([pdfRow()], raster);
    raster.rasterizePdfFrames.mockImplementationOnce(async (...args: any[]) => {
      assets.get('doc')!.fileUrl = `${SUPA}${T}/replaced.pdf`;
      return (rasterStub(2).rasterizePdfFrames as any)(...args);
    });
    expect(await svc.render('doc', T)).toEqual({ status: 'skipped', reason: 'row-changed' });
    expect(readPdfPages(assets.get('doc')!.processingMeta)!.state).toBe('pending');
    expect(storage.objects.size).toBe(0);
  });

  it.each([
    ['no record (a PDF from before pages)', { screen: {} }],
    ['already ready', { pdfPages: { version: 1, state: 'ready', count: 1, base: `${SUPA}x/`, pages: [], updatedAt: 'x' } }],
    ['already failed', { pdfPages: { version: 1, state: 'failed', error: 'pdf-unreadable', updatedAt: 'x' } }],
  ])('leaves alone a PDF with %s', async (_l, meta) => {
    const raster = rasterStub(1);
    const { svc } = make([pdfRow('doc', meta)], raster);
    expect((await svc.render('doc', T)).status).toBe('skipped');
    expect(raster.calls).toHaveLength(0);
  });

  it('is tenant-scoped: another tenant\'s id finds nothing', async () => {
    const raster = rasterStub(1);
    const { svc } = make([pdfRow()], raster);
    expect(await svc.render('doc', 'tenant-b')).toEqual({ status: 'skipped', reason: 'not-a-pdf' });
  });
});

describe('fleet copies — the pages belong to the FILE', () => {
  it('a copy pending while the owner renders takes the owner\'s pages when they land', async () => {
    const raster = rasterStub(2);
    const copy = pdfRow('copy', { pdfPages: pending() }, { tenantId: 'school-1', fileUrl: `${SUPA}${T}/doc.pdf` });
    const { svc, assets } = make([pdfRow(), copy], raster);
    await svc.render('doc', T);
    const theirs = readPdfPages(assets.get('copy')!.processingMeta)!;
    expect(theirs.state).toBe('ready');
    expect(theirs.pages[0].frames.landscape.url).toBe(readPdfPages(assets.get('doc')!.processingMeta)!.pages[0].frames.landscape.url);
  });

  it('a copy rendered on its own adopts the owner\'s finished record instead of rendering again', async () => {
    const raster = rasterStub(2);
    const { svc, assets } = make([pdfRow()], raster);
    await svc.render('doc', T);
    const calls = raster.calls.length;
    assets.set('copy', pdfRow('copy', { pdfPages: pending() }, { tenantId: 'school-1', fileUrl: `${SUPA}${T}/doc.pdf` }));
    expect(await svc.render('copy', 'school-1')).toMatchObject({ status: 'ready', pages: 2 });
    expect(raster.calls.length).toBe(calls);
  });
});

describe('pendingRecord / kickOff', () => {
  const OLD = process.env.PDF_PAGES_DISABLED;
  afterEach(() => {
    if (OLD === undefined) delete process.env.PDF_PAGES_DISABLED;
    else process.env.PDF_PAGES_DISABLED = OLD;
  });

  it('a new PDF is created pending — unless pages are switched off or cannot be made here', () => {
    const { svc } = make([], rasterStub(1));
    expect(svc.pendingRecord()).toMatchObject({ version: 1, state: 'pending' });
    process.env.PDF_PAGES_DISABLED = '1';
    expect(svc.pendingRecord()).toBeNull();
    delete process.env.PDF_PAGES_DISABLED;
    const unavailable = { ...rasterStub(1), isAvailable: () => false };
    expect(make([], unavailable as any).svc.pendingRecord()).toBeNull();
  });

  it('kickOff renders in the background, one document at a time, each once', async () => {
    const raster = rasterStub(1);
    const { svc, assets } = make([pdfRow('a'), pdfRow('b')], raster);
    svc.kickOff('a', T);
    svc.kickOff('b', T);
    svc.kickOff('a', T);
    await svc.idle();
    expect(readPdfPages(assets.get('a')!.processingMeta)!.state).toBe('ready');
    expect(readPdfPages(assets.get('b')!.processingMeta)!.state).toBe('ready');
    expect(raster.calls).toHaveLength(2);
  });
});

describe('sweepTick — resume what a deploy interrupted', () => {
  it('kicks the stale pending rows the query returns, and nothing when there are none', async () => {
    const raster = rasterStub(1);
    const { svc, client, assets } = make([pdfRow()], raster);
    client.$queryRaw.mockResolvedValueOnce([{ id: 'doc', tenantId: T }]);
    expect(await svc.sweepTick()).toBe(1);
    await svc.idle();
    expect(readPdfPages(assets.get('doc')!.processingMeta)!.state).toBe('ready');
    expect(await svc.sweepTick()).toBe(0);
  });
});

describe('pdfPageObjectPaths — what goes with a deleted PDF', () => {
  it('every frame and thumbnail of every page, only inside the tenant\'s own pages folder', async () => {
    const raster = rasterStub(2);
    const { svc, assets, storage } = make([pdfRow()], raster);
    await svc.render('doc', T);
    const paths = pdfPageObjectPaths(assets.get('doc')!.processingMeta, T, storage.extractPath);
    expect(paths.sort()).toEqual([...storage.objects.keys()].sort());
    // A fleet copy's record points at the OWNER's pages: never the copy's to delete.
    expect(pdfPageObjectPaths(assets.get('doc')!.processingMeta, 'school-1', storage.extractPath)).toEqual([]);
    expect(pdfPageObjectPaths({ pdfPages: pending() }, T, storage.extractPath)).toEqual([]);
  });
});

describe('adoptLegacy — PDFs from before pages existed', () => {
  const OLD = process.env.PDF_PAGES_LEGACY_SWEEP_DISABLED;
  afterEach(() => {
    if (OLD === undefined) delete process.env.PDF_PAGES_LEGACY_SWEEP_DISABLED;
    else process.env.PDF_PAGES_LEGACY_SWEEP_DISABLED = OLD;
  });

  it('stamps the owner row pending + legacy, renders it, and its fleet copies follow', async () => {
    const raster = rasterStub(2);
    const old = pdfRow('old', null);
    const copy = pdfRow('copy', null, { tenantId: 'school-1', fileUrl: old.fileUrl });
    const { svc, client, assets } = make([old, copy], raster);
    client.$queryRaw.mockResolvedValueOnce([{ id: 'old', tenantId: T }]);
    expect(await svc.adoptLegacy()).toBe(1);
    // Until its pages exist it is left out, like any PDF being prepared.
    expect(pdfDelivery(assets.get('old')!)).toBe('withhold');
    await svc.idle();
    const rec = readPdfPages(assets.get('old')!.processingMeta)!;
    expect(rec).toMatchObject({ state: 'ready', legacy: true, count: 2 });
    expect(pdfDelivery(assets.get('old')!)).toBe('pages');
    // The location's copy (no record of its own) takes the owner's pages.
    expect(readPdfPages(assets.get('copy')!.processingMeta)).toMatchObject({ state: 'ready', count: 2 });
  });

  it('a legacy PDF whose pages cannot be made goes back to being delivered exactly as before', async () => {
    const raster = rasterStub(1, () => ({ ok: false, reason: 'pdf-unreadable' }));
    const { svc, client, assets } = make([pdfRow('old', null)], raster);
    client.$queryRaw.mockResolvedValueOnce([{ id: 'old', tenantId: T }]);
    await svc.adoptLegacy();
    await svc.idle();
    expect(readPdfPages(assets.get('old')!.processingMeta)).toMatchObject({ state: 'failed', legacy: true, error: 'pdf-unreadable' });
    expect(pdfDelivery(assets.get('old')!)).toBe('as-uploaded');
  });

  it('waits while a video transcode is queued or running, and does nothing when switched off', async () => {
    const { svc, client, assets } = make([pdfRow('old', null)], rasterStub(1));
    client.videoTranscodeJob.count.mockResolvedValueOnce(1);
    client.$queryRaw.mockResolvedValue([{ id: 'old', tenantId: T }]);
    expect(await svc.adoptLegacy()).toBe(0);
    expect(assets.get('old')!.processingMeta).toBeNull();
    process.env.PDF_PAGES_LEGACY_SWEEP_DISABLED = '1';
    expect(await svc.adoptLegacy()).toBe(0);
    expect(assets.get('old')!.processingMeta).toBeNull();
  });

  it('never re-stamps a row that already has a record', async () => {
    const { svc, client, assets } = make([pdfRow('done', { pdfPages: { version: 1, state: 'failed', error: 'x', updatedAt: 'x' } })], rasterStub(1));
    client.$queryRaw.mockResolvedValueOnce([{ id: 'done', tenantId: T }]);
    expect(await svc.adoptLegacy()).toBe(0);
    expect(readPdfPages(assets.get('done')!.processingMeta)!.state).toBe('failed');
  });

  it('the sweep resumes stale renderings first, and adopts legacy PDFs only on an otherwise idle tick', async () => {
    const { svc, client } = make([pdfRow('stale'), pdfRow('old', null)], rasterStub(1));
    client.$queryRaw.mockResolvedValueOnce([{ id: 'stale', tenantId: T }]);
    expect(await svc.sweepTick()).toBe(1);
    expect(client.$queryRaw).toHaveBeenCalledTimes(1); // no legacy query on a busy tick
    await svc.idle();
  });
});
