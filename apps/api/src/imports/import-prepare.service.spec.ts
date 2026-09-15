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
  const prisma = { client: { importJob: { create: jest.fn((a: any) => { rows.push(a.data); return Promise.resolve(a.data); }) } } };
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
  return { svc, staged, rows, storage, rasterSvc };
}

const PDF_BYTES = Buffer.from('%PDF-1.7\n stand-in; the parser is mocked');
const input = { tenantId: 'tenant-a', userId: 'u1', originalName: 'Assembly.pdf', bytes: PDF_BYTES };

describe('ImportPrepareService — PDF', () => {
  beforeEach(() => {
    (parsePdf as jest.Mock).mockReset();
    (parsePptx as jest.Mock).mockReset();
  });

  it('accounts for EVERY source page, including one with nothing to extract', async () => {
    // This is the audit's headline failure: a 3-page PDF whose middle page is
    // artwork-only produced 2 templates while the UI said "one per page".
    (parsePdf as jest.Mock).mockResolvedValue(
      doc([page(1), page(2, { zones: [], disposition: 'empty' }), page(3)]),
    );
    const { svc } = harness();
    const { manifest } = await svc.prepare(input);

    expect(manifest.sourcePageCount).toBe(3);
    expect(manifest.pages.map((p) => p.sourcePage)).toEqual([1, 2, 3]);
    const artworkOnly = manifest.pages[1];
    expect(artworkOnly.disposition).toBe('empty');
    // It has no editable layers — but it DOES have a picture of itself, so it
    // is offered rather than dropped.
    expect(artworkOnly.availableModes).toEqual(['preserve']);
    expect(artworkOnly.defaultMode).toBe('preserve');
  });

  it('offers both modes on a page that has text, and defaults to the faithful one', async () => {
    (parsePdf as jest.Mock).mockResolvedValue(doc([page(1), page(2), page(3)]));
    const { svc } = harness();
    const { manifest } = await svc.prepare(input);
    expect(manifest.pages[0].availableModes).toEqual(['preserve', 'editable']);
    expect(manifest.pages[0].defaultMode).toBe('preserve');
    expect(manifest.pages[0].editableTextCount).toBe(1);
  });

  it('stages the original and every page raster privately, and records KEYS not URLs', async () => {
    (parsePdf as jest.Mock).mockResolvedValue(doc([page(1), page(2), page(3)]));
    const { svc, staged } = harness();
    const { manifest } = await svc.prepare(input);
    expect(staged[0].key).toMatch(/^tenant-a\/[0-9a-f-]+\/source\.pdf$/);
    expect(staged.filter((s) => s.mime === 'image/webp')).toHaveLength(6); // 3 pages + 3 thumbs
    for (const p of manifest.pages) {
      expect(p.rasterObjectKey).toMatch(/^tenant-a\//);
      expect(p.rasterObjectKey).not.toMatch(/^https?:/);
    }
  });

  it('carries truncation into the manifest as a typed warning, never as a silent short result', async () => {
    (parsePdf as jest.Mock).mockResolvedValue(doc([page(1)], { sourcePageCount: 60 }));
    const { svc } = harness({
      ok: true, sourcePageCount: 60, truncated: true, warnings: ['stopped at the page cap'], elapsedMs: 5,
      pages: [{ sourcePage: 1, widthPx: 1920, heightPx: 1080, webp: Buffer.from('a'), thumbWebp: Buffer.from('b') }],
    });
    const { manifest } = await svc.prepare(input);
    expect(manifest.warnings.some((w) => w.code === 'PAGES_TRUNCATED')).toBe(true);
    expect(manifest.warnings.find((w) => w.code === 'PAGES_TRUNCATED')!.detail).toMatch(/of 60 pages/);
  });

  it('says so when the document cannot be rendered, instead of pretending preserve exists', async () => {
    (parsePdf as jest.Mock).mockResolvedValue(doc([page(1)]));
    const { svc } = harness({ ok: false, reason: 'page-render-failed' });
    const { manifest } = await svc.prepare(input);
    expect(manifest.pages[0].availableModes).toEqual(['editable']);
    expect(manifest.warnings.some((w) => w.code === 'PAGE_UNREADABLE')).toBe(true);
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
