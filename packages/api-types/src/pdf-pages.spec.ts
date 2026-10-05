import {
  PDF_PAGE_FRAMES,
  pdfDelivery,
  pdfFrameKey,
  pdfPageFileName,
  pdfPlaySeconds,
  readPdfPages,
  type PdfPageJson,
} from './pdf-pages';

const BASE = 'https://x.supabase.co/storage/v1/object/public/assets/t1/pdf-pages/a1/k9/';
const sha = (c: string) => c.repeat(64);
const page = (n: number): PdfPageJson => ({
  n,
  w: 2160,
  h: 2795,
  frames: {
    landscape: { sha256: sha('a'), size: 300_000 },
    'landscape-1080': { sha256: sha('b'), size: 90_000 },
    portrait: { sha256: sha('c'), size: 400_000 },
    'portrait-1080': { sha256: sha('d'), size: 110_000 },
  },
});
const ready = (extra: Record<string, unknown> = {}) => ({
  pdfPages: { version: 1, state: 'ready', count: 2, base: BASE, pages: [page(2), page(1)], updatedAt: 'x', ...extra },
});
const pdf = (processingMeta: unknown) => ({ mimeType: 'application/pdf', processingMeta });

describe('readPdfPages — the one reading of processingMeta.pdfPages', () => {
  it('a ready record: every page, in page order, every frame a complete file', () => {
    const r = readPdfPages(ready())!;
    expect(r.state).toBe('ready');
    expect(r.pages.map((p) => p.n)).toEqual([1, 2]);
    expect(r.pages[0].frames.landscape).toEqual({
      url: `${BASE}p1-landscape.webp`, sha256: sha('a'), size: 300_000, width: 3840, height: 2160,
    });
    expect(r.pages[1].frames['portrait-1080']).toMatchObject({ url: `${BASE}p2-portrait-1080.webp`, width: 1080, height: 1920 });
    expect(r.pages[0].thumbUrl).toBe(`${BASE}p1-thumb.webp`);
    expect(r).toMatchObject({ count: 2, done: 2, truncatedAt: null });
  });

  it('says how many pages a capped document did NOT get', () => {
    expect(readPdfPages(ready({ count: 214, truncatedAt: 2 }))).toMatchObject({ count: 214, done: 2, truncatedAt: 2 });
    // A cap that did not bite is not a truncation.
    expect(readPdfPages(ready({ truncatedAt: 60 }))!.truncatedAt).toBeNull();
  });

  it('a pending record carries its progress, never more than the count', () => {
    expect(readPdfPages({ pdfPages: { version: 1, state: 'pending', count: 12, done: 7, updatedAt: 'x' } }))
      .toMatchObject({ state: 'pending', count: 12, done: 7, pages: [] });
    expect(readPdfPages({ pdfPages: { version: 1, state: 'pending', count: 3, done: 9, updatedAt: 'x' } })!.done).toBe(3);
    expect(readPdfPages({ pdfPages: { version: 1, state: 'pending', updatedAt: 'x' } })).toMatchObject({ count: null, done: 0 });
  });

  it('a failed record carries its reason', () => {
    expect(readPdfPages({ pdfPages: { version: 1, state: 'failed', error: 'pdf-password-protected', updatedAt: 'x' } }))
      .toMatchObject({ state: 'failed', error: 'pdf-password-protected', legacy: false });
  });

  it.each([
    ['a page missing a frame', () => { const p = page(1) as any; delete p.frames.portrait; return ready({ pages: [p] }); }],
    ['a frame without a real hash', () => { const p = page(1) as any; p.frames.landscape.sha256 = 'nope'; return ready({ pages: [p] }); }],
    ['a frame of no size', () => { const p = page(1) as any; p.frames.landscape.size = 0; return ready({ pages: [p] }); }],
    ['a base that is not https', () => ready({ base: 'http://x/' })],
    ['a base that is not a folder', () => ready({ base: 'https://x/a' })],
    ['no pages at all', () => ready({ pages: [] })],
    ['a page listed twice', () => ready({ pages: [page(1), page(1)] })],
  ])('a half-written ready record (%s) is NOT ready — never a URL whose hash is wrong', (_l, meta) => {
    expect(readPdfPages(meta())).toMatchObject({ state: 'failed', error: 'invalid-record', pages: [] });
  });

  it.each([
    ['no processingMeta', null],
    ['no pdfPages key', { screen: {} }],
    ['another version', { pdfPages: { version: 2, state: 'ready' } }],
    ['an unknown state', { pdfPages: { version: 1, state: 'cooking' } }],
    ['an array', { pdfPages: [] }],
  ])('%s reads as "no pages record"', (_l, meta) => {
    expect(readPdfPages(meta)).toBeNull();
  });
});

describe('pdfDelivery — what the NORMAL manifest does with a PDF', () => {
  it('not a PDF: nothing here applies', () => {
    expect(pdfDelivery({ mimeType: 'image/png', processingMeta: ready() })).toBe('not-pdf');
    expect(pdfDelivery(null)).toBe('not-pdf');
  });
  it('no record (a PDF from before pages existed): delivered exactly as before', () => {
    expect(pdfDelivery(pdf(null))).toBe('as-uploaded');
    expect(pdfDelivery(pdf({ pdfPages: { version: 9 } }))).toBe('as-uploaded');
  });
  it('ready: one picture per page', () => {
    expect(pdfDelivery(pdf(ready()))).toBe('pages');
    expect(pdfDelivery({ mimeType: 'APPLICATION/PDF', processingMeta: ready() })).toBe('pages');
  });
  it('still preparing: left out, like a video that is still converting', () => {
    expect(pdfDelivery(pdf({ pdfPages: { version: 1, state: 'pending', updatedAt: 'x' } }))).toBe('withhold');
    expect(pdfDelivery(pdf({ pdfPages: { version: 1, state: 'pending', legacy: true, updatedAt: 'x' } }))).toBe('withhold');
  });
  it('failed: a new PDF is left out; a legacy PDF keeps playing the way it always did', () => {
    expect(pdfDelivery(pdf({ pdfPages: { version: 1, state: 'failed', error: 'x', updatedAt: 'x' } }))).toBe('withhold');
    expect(pdfDelivery(pdf({ pdfPages: { version: 1, state: 'failed', error: 'x', legacy: true, updatedAt: 'x' } }))).toBe('as-uploaded');
  });
  it('a half-written ready record is left out, not delivered with wrong hashes', () => {
    expect(pdfDelivery(pdf(ready({ base: 'http://nope/' })))).toBe('withhold');
  });
});

describe('frames and timing', () => {
  it('four frames, each a screen canvas', () => {
    expect(PDF_PAGE_FRAMES.map((f) => `${f.key}:${f.width}x${f.height}`)).toEqual([
      'landscape:3840x2160', 'landscape-1080:1920x1080', 'portrait:2160x3840', 'portrait-1080:1080x1920',
    ]);
  });
  it('a screen gets the frame of its orientation, the 1080 one on a 1080p screen', () => {
    expect(pdfFrameKey('landscape', false)).toBe('landscape');
    expect(pdfFrameKey('landscape', true)).toBe('landscape-1080');
    expect(pdfFrameKey('portrait', false)).toBe('portrait');
    expect(pdfFrameKey('portrait', true)).toBe('portrait-1080');
  });
  it('file names are fixed by page and frame', () => {
    expect(pdfPageFileName(12, 'portrait-1080')).toBe('p12-portrait-1080.webp');
    expect(pdfPageFileName(3, 'thumb')).toBe('p3-thumb.webp');
  });
  it('every page gets the item duration — "12 pages · 10 s each = 2 min"', () => {
    expect(pdfPlaySeconds(12, 10_000)).toBe(120);
    expect(pdfPlaySeconds(0, 10_000)).toBe(0);
  });
});
