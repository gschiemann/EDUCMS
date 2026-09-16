/**
 * Prepare's job is to account for every page and then stop.
 *
 * The parsers and the rasterizer have their own suites against real documents
 * and a real browser; both are mocked here so these assertions are about the
 * ORCHESTRATION — what ends up in the manifest, which modes each page is
 * honestly offered, and what is refused before anything is staged.
 *
 * `parsePdf` is mocked for a second reason: pdfjs-dist v6 is ESM-only and Jest
 * cannot load it in this CommonJS project, which is why the parser's own PDF
 * suite shells out to a child process.
 */
jest.mock('./parsers/pdf-parser', () => ({ parsePdf: jest.fn() }));
jest.mock('./parsers/pptx-parser', () => ({ parsePptx: jest.fn() }));

import JSZip from 'jszip';
import { ImportPrepareService, PrepareRejection } from './import-prepare.service';
import { parsePdf } from './parsers/pdf-parser';
import { parsePptx } from './parsers/pptx-parser';
import type { ParsedDocument, ParsedPage } from './parsers/types';

const page = (n: number, over: Partial<ParsedPage> = {}): ParsedPage => ({
  sourcePage: n,
  label: `Page ${n}`,
  disposition: 'converted',
  screenWidth: 1920,
  screenHeight: 1080,
  zones: [
    { name: 'Heading', widgetType: 'TEXT', x: 5, y: 5, width: 50, height: 10, zIndex: 1, defaultConfig: { content: 'Hello' } } as any,
  ],
  warnings: [],
  ...over,
});

const doc = (pages: ParsedPage[], over: Partial<ParsedDocument> = {}): ParsedDocument => ({
  pages, media: [], sourcePageCount: pages.length, warnings: [], ...over,
});

function harness(raster?: any) {
  const staged: Array<{ key: string; mime: string }> = [];
  const rows: any[] = [];
  const updates: any[] = [];
  const prisma = {
    client: {
      importJob: {
        // The row is written BEFORE conversion, then updated — so a failure
        // mid-convert still leaves the staged objects owned by a job.
        create: jest.fn((a: any) => { rows.push(a.data); return Promise.resolve(a.data); }),
        updateMany: jest.fn((a: any) => { updates.push(a); return Promise.resolve({ count: 1 }); }),
      },
    },
  };
  const storage = {
    uploadImportStaging: jest.fn(async (key: string, _b: Buffer, mime: string) => {
      staged.push({ key, mime });
      return `https://x/storage/v1/object/import-staging/${key}`;
    }),
  };
  const rasterSvc = {
    rasterizePdf: jest.fn(async () => raster ?? {
      ok: true, sourcePageCount: 3, truncated: false, warnings: [], elapsedMs: 10,
      pages: [1, 2, 3].map((n) => ({
        sourcePage: n, widthPx: 1920, heightPx: 1080,
        webp: Buffer.from(`p${n}`), thumbWebp: Buffer.from(`t${n}`),
      })),
    }),
  };
  const svc = new ImportPrepareService(prisma as any, storage as any, rasterSvc as any);
  return { svc, staged, rows, updates, storage, rasterSvc };
}

const PDF_BYTES = Buffer.from('%PDF-1.7\n stand-in; the renderer is mocked');
const input = { tenantId: 'tenant-a', userId: 'u1', originalName: 'Assembly.pdf', bytes: PDF_BYTES };

/** What the renderer hands back: `rendered` of `sourcePageCount` pages, from page 1. */
const rasterOf = (rendered: number, sourcePageCount = rendered) => ({
  ok: true as const,
  sourcePageCount,
  truncated: rendered < sourcePageCount,
  warnings: [] as string[],
  elapsedMs: 5,
  pages: Array.from({ length: rendered }, (_, i) => ({
    sourcePage: i + 1, widthPx: 1484, heightPx: 1920,
    webp: Buffer.from(`p${i + 1}`), thumbWebp: Buffer.from(`t${i + 1}`),
  })),
});

describe('ImportPrepareService — PDF', () => {
  beforeEach(() => {
    (parsePdf as jest.Mock).mockReset();
    (parsePptx as jest.Mock).mockReset();
  });

  it('accounts for every source page from the render, each offered as the page it is', async () => {
    const { svc } = harness(rasterOf(3));
    const { manifest } = await svc.prepare(input);

    expect(manifest.format).toBe('pdf');
    expect(manifest.sourcePageCount).toBe(3);
    expect(manifest.pages.map((p) => p.sourcePage)).toEqual([1, 2, 3]);
    for (const p of manifest.pages) {
      expect(p.disposition).toBe('converted');
      expect(p.availableModes).toEqual(['preserve']);
      expect(p.defaultMode).toBe('preserve');
      // The page's own shape, from the render — a portrait flyer stays portrait.
      expect(p.widthPx).toBe(1484);
      expect(p.heightPx).toBe(1920);
    }
  });

  it('never offers editable layers for a PDF, and never runs the text parser', async () => {
    // A page of text used to be offered as "Editable layers": words only — no
    // pictures, no colour, no weight — in line-sized boxes that clipped once
    // drawn (re-audit R1). The parser is primed with exactly such a page, so a
    // PDF path that still consulted it would show up here.
    (parsePdf as jest.Mock).mockResolvedValue(doc([page(1), page(2), page(3)]));
    const { svc } = harness(rasterOf(3));
    const { manifest } = await svc.prepare(input);

    expect(manifest.pages.flatMap((p) => p.availableModes)).toEqual(['preserve', 'preserve', 'preserve']);
    expect(manifest.pages.map((p) => [p.editableTextCount, p.editableImageCount])).toEqual([[0, 0], [0, 0], [0, 0]]);
    expect(parsePdf).not.toHaveBeenCalled();
  });

  it('stages the original and every page raster privately, and records KEYS not URLs', async () => {
    const { svc, staged } = harness(rasterOf(3));
    const { manifest } = await svc.prepare(input);
    expect(staged[0].key).toMatch(/^tenant-a\/[0-9a-f-]+\/source\.pdf$/);
    expect(staged.filter((s) => s.mime === 'image/webp')).toHaveLength(6); // 3 pages + 3 thumbs
    for (const p of manifest.pages) {
      expect(p.rasterObjectKey).toMatch(/^tenant-a\//);
      expect(p.rasterObjectKey).not.toMatch(/^https?:/);
    }
  });

  it('lists pages past the render cap as excluded-by-limit, and says so up front', async () => {
    const { svc, staged } = harness({
      ...rasterOf(60, 75),
      warnings: ['page-cap: rendered 60 of 75 pages (limit 60)'],
    });
    const { manifest } = await svc.prepare(input);

    expect(manifest.sourcePageCount).toBe(75);
    expect(manifest.pages).toHaveLength(75);
    expect(manifest.pages[59]).toMatchObject({ sourcePage: 60, availableModes: ['preserve'], defaultMode: 'preserve' });
    // Page 61 exists in the document and is listed as such — never dropped.
    expect(manifest.pages[60]).toMatchObject({
      sourcePage: 61, disposition: 'excluded-by-limit', availableModes: [], defaultMode: null,
    });
    expect(manifest.pages[60].rasterObjectKey).toBeUndefined();
    // One sentence about the cap, in our words; the renderer's own line about
    // the same fact is not repeated underneath it.
    expect(manifest.warnings).toEqual([
      {
        code: 'PAGES_TRUNCATED',
        detail: 'Only the first 60 of 75 pages were rendered. Import those, then import the rest as a second file.',
      },
    ]);
    expect(staged.filter((s) => s.mime === 'image/webp')).toHaveLength(120);
  });

  it('bounds the page list at the accounting cap, and names the cap', async () => {
    const { svc } = harness(rasterOf(2, 900));
    const { manifest } = await svc.prepare(input);

    expect(manifest.sourcePageCount).toBe(900);
    expect(manifest.pages).toHaveLength(500);
    expect(manifest.pages[499]).toMatchObject({ sourcePage: 500, disposition: 'excluded-by-limit' });
    expect(manifest.warnings.map((w) => w.detail)).toEqual([
      'Only the first 2 of 900 pages were rendered. Import those, then import the rest as a second file.',
      'Only the first 500 pages are listed individually.',
    ]);
  });

  it('refuses a PDF it cannot render, instead of offering something else in its place', async () => {
    // Before: a failed render quietly became "editable layers only", and was
    // preselected. There is no second route for a PDF now, so there is nothing
    // to substitute — the import stops, and says so.
    (parsePdf as jest.Mock).mockResolvedValue(doc([page(1)]));
    const { svc, updates } = harness({ ok: false, reason: 'page-render-failed' });

    await expect(svc.prepare(input)).rejects.toThrow(PrepareRejection);
    const statuses = (updates as Array<{ data?: { status?: string } }>).map((u) => u.data?.status);
    expect(statuses).toEqual(['FAILED']);
    expect(parsePdf).not.toHaveBeenCalled();
  });
});

describe('ImportPrepareService — a PDF that will not render stops, and says why', () => {
  // Every reason the renderer can give, and what the operator is told. 503 is
  // ours and temporary, so the review page offers the same file again; a 4xx
  // is about the file, with a sentence that says what to do (re-audit R3).
  const cases: Array<[string, string, number, RegExp]> = [
    ['raster-busy', 'IMPORTS_RENDER_BUSY', 503, /try again in a moment/i],
    ['worker-busy', 'IMPORTS_RENDER_BUSY', 503, /try again in a moment/i],
    ['pdf-too-large', 'IMPORTS_PDF_TOO_LARGE', 413, /too large to convert — the limit is 50 MB/],
    ['pdf-password-protected', 'IMPORTS_PDF_PASSWORD_PROTECTED', 422, /protected with a password/],
    ['pdf-empty', 'IMPORTS_PDF_EMPTY', 422, /has no pages/],
    ['pdf-unreadable', 'IMPORTS_PDF_UNREADABLE', 422, /may be damaged/],
    ['page-render-failed', 'IMPORTS_PDF_DAMAGED', 422, /could not be drawn/],
    ['encode-failed', 'IMPORTS_PDF_DAMAGED', 422, /could not be drawn/],
    ['raster-budget-exceeded', 'IMPORTS_PDF_TOO_COMPLEX', 422, /took too long/],
    ['raster-failed', 'IMPORTS_RENDER_UNAVAILABLE', 503, /try again in a moment/i],
    ['scratch-dir-failed', 'IMPORTS_RENDER_UNAVAILABLE', 503, /try again in a moment/i],
    ['browser-launch-failed', 'IMPORTS_RENDER_UNAVAILABLE', 503, /try again in a moment/i],
    ['a-reason-nobody-has-written-yet', 'IMPORTS_RENDER_UNAVAILABLE', 503, /try again in a moment/i],
  ];

  it.each(cases)('%s → %s (%i)', async (reason, code, status, sentence) => {
    const { svc, updates } = harness({ ok: false, reason });
    const started = Date.now();
    const err: unknown = await svc.prepare(input).then(
      () => null,
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(PrepareRejection);
    expect(err).toMatchObject({ code, status });
    expect((err as Error).message).toMatch(sentence);
    // The renderer's own words stay on the row, never in what the operator reads.
    expect((err as Error).message).not.toContain(reason);

    // FAILED with the same code and the raw reason — and nothing written that
    // could be reviewed, preselected or committed in the render's place.
    const writes = (updates as Array<{ data: Record<string, unknown> }>).map((u) => u.data);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ status: 'FAILED', failureCode: code, failureDetail: reason });
    expect(writes[0]).not.toHaveProperty('manifest');
    // Swept at the next tick, instead of holding the original for a day.
    const expiresAt = (writes[0].expiresAt as Date).getTime();
    expect(expiresAt).toBeGreaterThanOrEqual(started);
    expect(expiresAt).toBeLessThanOrEqual(Date.now());
  });
});

describe('ImportPrepareService — PowerPoint', () => {
  it('offers editable layers and explains why the faithful render is missing', async () => {
    (parsePptx as jest.Mock).mockResolvedValue(doc([page(1), page(2)]));
    const { svc, rasterSvc } = harness();
    const { manifest } = await svc.prepare({
      ...input, originalName: 'Assembly.pptx', bytes: await pptxBytes(),
    });
    expect(manifest.format).toBe('pptx');
    expect(manifest.pages.every((p) => p.availableModes.includes('editable'))).toBe(true);
    expect(manifest.pages.every((p) => !p.availableModes.includes('preserve'))).toBe(true);
    // The reason names the one-click fix rather than leaving a mode mysteriously absent.
    expect(manifest.preserveUnavailableReason).toMatch(/export the deck to PDF/i);
    // And we never paid for a browser we cannot use on a deck.
    expect(rasterSvc.rasterizePdf).not.toHaveBeenCalled();
  });
});

describe('ImportPrepareService — what it refuses before staging anything', () => {
  it('rejects legacy .ppt with the fix, and stages nothing', async () => {
    const { svc, storage } = harness();
    const ppt = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(64)]);
    await expect(svc.prepare({ ...input, originalName: 'Old.ppt', bytes: ppt }))
      .rejects.toThrow(PrepareRejection);
    expect(storage.uploadImportStaging).not.toHaveBeenCalled();
  });

  it('rejects a file that only claims to be a PDF', async () => {
    const { svc, storage } = harness();
    await expect(svc.prepare({ ...input, bytes: Buffer.from('not a pdf at all') }))
      .rejects.toThrow(PrepareRejection);
    expect(storage.uploadImportStaging).not.toHaveBeenCalled();
  });
});

/** A minimal real .pptx — the sniffer reads the zip directory, not the name. */
async function pptxBytes(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types/>');
  zip.file('ppt/presentation.xml', '<p:presentation/>');
  return zip.generateAsync({ type: 'nodebuffer' });
}

/** A real PNG signature + IHDR. Enough for the sniffer and the header read. */
function pngBytes(width: number, height: number): Buffer {
  const buf = Buffer.alloc(40);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.writeUInt32BE(13, 8);
  buf.write('IHDR', 12, 'ascii');
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

/** A JPEG whose EXIF says "rotate a quarter turn", like every phone photo. */
function rotatedJpegBytes(storedWidth: number, storedHeight: number): Buffer {
  const tiff = Buffer.alloc(26);
  tiff.write('II', 0, 'ascii');
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(1, 8);
  tiff.writeUInt16LE(0x0112, 10); // Orientation
  tiff.writeUInt16LE(3, 12);      // SHORT
  tiff.writeUInt32LE(1, 14);
  tiff.writeUInt16LE(6, 18);      // rotate 90° CW
  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const app1 = Buffer.alloc(4);
  app1.writeUInt16BE(0xffe1, 0);
  app1.writeUInt16BE(payload.length + 2, 2);

  const sof = Buffer.alloc(13);
  sof.writeUInt16BE(0xffc0, 0);
  sof.writeUInt16BE(11, 2);
  sof.writeUInt8(8, 4);
  sof.writeUInt16BE(storedHeight, 5);
  sof.writeUInt16BE(storedWidth, 7);
  sof.writeUInt8(1, 9);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app1, payload, sof, Buffer.alloc(20)]);
}

describe('ImportPrepareService — an image comes in as itself (re-audit R7)', () => {
  const imageInput = (bytes: Buffer, originalName = 'Poster.png') => ({
    ...input, originalName, bytes,
  });

  it('stages a PNG as a PNG and records the type, so commit stops calling it WebP', async () => {
    const { svc, staged } = harness();
    const { manifest } = await svc.prepare(imageInput(pngBytes(1200, 900)));

    expect(staged.filter((s) => s.mime === 'image/png')).toHaveLength(2); // source + page
    expect(manifest.pages).toHaveLength(1);
    expect(manifest.pages[0].rasterObjectKey).toMatch(/\/p1\.png$/);
    expect(manifest.pages[0].rasterMimeType).toBe('image/png');
  });

  it('records the real pixel size instead of leaving commit to assume 1920×1080', async () => {
    const { svc } = harness();
    const { manifest } = await svc.prepare(imageInput(pngBytes(1, 1)));
    // The audit's exact reproduction: a 1×1 PNG became a landscape HD template.
    expect(manifest.pages[0]).toMatchObject({ widthPx: 1, heightPx: 1 });
  });

  it.each<[string, number, number]>([
    ['portrait', 1080, 1920],
    ['square', 1000, 1000],
    ['landscape', 1920, 1080],
  ])('keeps a %s image its own shape', async (_shape, w, h) => {
    const { svc } = harness();
    const { manifest } = await svc.prepare(imageInput(pngBytes(w, h)));
    expect(manifest.pages[0]).toMatchObject({ widthPx: w, heightPx: h });
  });

  it('records the size a screen DRAWS a rotated photo at, not the size it is stored at', async () => {
    // A phone photo stored 4032×3024 with orientation 6 is drawn 3024×4032.
    // Taking the stored numbers gives a portrait picture a landscape canvas.
    const { svc } = harness();
    const { manifest } = await svc.prepare(imageInput(rotatedJpegBytes(4032, 3024), 'Photo.jpg'));
    expect(manifest.pages[0]).toMatchObject({
      widthPx: 3024, heightPx: 4032, rasterMimeType: 'image/jpeg',
    });
  });

  it('refuses an image whose header will not parse, instead of inventing a shape', async () => {
    const { svc, updates } = harness();
    // A PNG signature and nothing usable after it: the sniffer says PNG, the
    // header does not parse.
    const truncated = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(30),
    ]);
    await expect(svc.prepare(imageInput(truncated))).rejects.toMatchObject({
      code: 'IMPORTS_IMAGE_UNREADABLE',
      status: 422,
    });
    expect(updates.find((u) => u.data?.status === 'FAILED')).toBeTruthy();
  });

  it('refuses an image with more pixels than a screen can decode', async () => {
    // The 50 MB upload cap bounds COMPRESSED bytes. A few megabytes of PNG can
    // be a gigapixel, and commit publishes these bytes straight to a screen.
    const { svc, staged } = harness();
    const err: unknown = await svc.prepare(imageInput(pngBytes(40000, 30000))).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toMatchObject({ code: 'IMPORTS_IMAGE_TOO_LARGE', status: 413 });
    expect((err as Error).message).toMatch(/40000×30000/);
    // The original was staged (the row owns it, the sweep takes it); the page
    // object never was.
    expect(staged.filter((s) => s.key.includes('/p1.'))).toHaveLength(0);
  });

  it('accepts a big-but-sane poster', async () => {
    const { svc } = harness();
    const { manifest } = await svc.prepare(imageInput(pngBytes(7680, 4320))); // 8K
    expect(manifest.pages[0]).toMatchObject({ widthPx: 7680, heightPx: 4320 });
  });
});

describe('ImportPrepareService — a preserve offer must have a render behind it (R6)', () => {
  it('takes the mode away from a page the renderer sized at zero, and says why', async () => {
    // Prepare is supposed to make this impossible. "Happens to be true" is not
    // an invariant, so it is checked before the manifest is persisted — and a
    // page that fails it becomes unselectable with a reason, instead of a
    // preselected page that would produce nothing.
    const { svc } = harness({
      ok: true, sourcePageCount: 2, truncated: false, warnings: [], elapsedMs: 5,
      pages: [
        { sourcePage: 1, widthPx: 1920, heightPx: 1080, webp: Buffer.from('p1'), thumbWebp: Buffer.from('t1') },
        { sourcePage: 2, widthPx: 0, heightPx: 0, webp: Buffer.from('p2'), thumbWebp: Buffer.from('t2') },
      ],
    });
    const { manifest } = await svc.prepare(input);

    // The good page is untouched.
    expect(manifest.pages[0]).toMatchObject({ availableModes: ['preserve'], defaultMode: 'preserve' });
    // The broken one keeps its row — a page that vanished is the bug this
    // program ended — but offers nothing, and explains itself.
    expect(manifest.pages).toHaveLength(2);
    expect(manifest.pages[1]).toMatchObject({
      sourcePage: 2, availableModes: [], defaultMode: null,
    });
    expect(manifest.pages[1].warnings).toEqual([
      expect.objectContaining({ code: 'PAGE_UNREADABLE', sourcePage: 2 }),
    ]);
  });

  it('leaves an ordinary render alone', async () => {
    const { svc } = harness(rasterOf(3));
    const { manifest } = await svc.prepare(input);
    expect(manifest.pages.every((p) => p.defaultMode === 'preserve')).toBe(true);
    expect(manifest.pages.flatMap((p) => p.warnings)).toEqual([]);
  });

  it('records that a rendered PDF page really is WebP', async () => {
    const { svc } = harness(rasterOf(1));
    const { manifest } = await svc.prepare(input);
    expect(manifest.pages[0].rasterMimeType).toBe('image/webp');
  });
});

describe('ImportPrepareService — nothing is left in the bucket unowned', () => {
  it('records the job BEFORE converting, so a mid-convert failure still owns what was staged', async () => {
    // The sweep can only delete what a job names. If the row were written last,
    // every failed conversion would strand the original — and any page rasters
    // written before the failure — permanently.
    const { svc, rows, updates, staged, storage } = harness(rasterOf(3));
    storage.uploadImportStaging.mockImplementation((key: string, _b: Buffer, mime: string) => {
      if (key.endsWith('/p2.webp')) return Promise.reject(new Error('storage hiccup'));
      staged.push({ key, mime });
      return Promise.resolve(`https://x/storage/v1/object/import-staging/${key}`);
    });
    await expect(svc.prepare(input)).rejects.toThrow(/could not convert/i);

    // The original WAS staged, and so was the page before the failure…
    expect(staged.some((x) => x.key.endsWith('source.pdf'))).toBe(true);
    expect(staged.some((x) => x.key.endsWith('/p1.webp'))).toBe(true);
    // …and a row already names it.
    expect(rows).toHaveLength(1);
    expect(rows[0].sourceObject).toMatch(/source\.pdf$/);
    expect(rows[0].status).toBe('CONVERTING');
    // The failure is recorded rather than leaving the row mid-flight forever.
    const failed = updates.find((u) => u.data?.status === 'FAILED');
    expect(failed).toBeTruthy();
    expect(failed.data.failureCode).toBe('CONVERSION_FAILED');
    expect(failed.where).toEqual({ id: rows[0].id, tenantId: 'tenant-a' });
  });

  it('does not leak the internal reason to the operator', async () => {
    // "pdf is damaged" is ours to log; what the operator gets has to be
    // something they can act on, and must not carry a stack or a bucket name.
    const { svc, updates, storage } = harness(rasterOf(1));
    storage.uploadImportStaging.mockImplementation((key: string) =>
      key.endsWith('.webp')
        ? Promise.reject(new Error('ENOENT /srv/secret/path'))
        : Promise.resolve(`https://x/storage/v1/object/import-staging/${key}`),
    );
    await expect(svc.prepare(input)).rejects.toThrow(/damaged, or protected with a password/i);
    // …but we kept the real reason on the row.
    expect(updates.find((u) => u.data?.status === 'FAILED').data.failureDetail).toContain('ENOENT');
  });
});

