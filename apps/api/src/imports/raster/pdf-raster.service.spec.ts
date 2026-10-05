/**
 * The service half: what it refuses, how it hands bytes to the worker, and
 * what it hands back.
 *
 * Two things here are load-bearing beyond the happy path.
 *
 * ONE — THE UPLOAD NEVER CROSSES IPC. 50 MB through `child.send` would be held
 * twice over for no benefit, so the parent writes a file and sends a PATH. The
 * test proves that by capturing what the seam was given and reading the file
 * off disk, and by proving the directory is gone afterwards. A leaked scratch
 * dir is a tenant's document sitting on a shared box.
 *
 * TWO — NOTHING HERE LAUNCHES A BROWSER. The seam exists so the service can be
 * tested without one; the LAST describe in this file overrides it with the
 * REAL shipped pipeline and a real Chromium, so the plumbing is proved end to
 * end rather than against a mock that agrees with itself.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import sharp from 'sharp';
import {
  PdfRasterService,
  looksLikePdf,
  type RasterizeResult,
} from './pdf-raster.service';
import {
  DEFAULT_RASTERIZE_LIMITS,
  runPdfRasterPipeline,
  type RasterPipelineOutcome,
} from '../../proxy/pdf-raster-pipeline';
import type { BrowserLauncher } from '../../proxy/render-pipeline';
import type { RasterizeJobLimits } from '../../proxy/render-worker-protocol';
import {
  describeWithChromium,
  loadPuppeteerForTests,
} from '../../../test/chromium-for-tests';

const EVIDENCE = join(
  __dirname,
  '../../../test/fixtures/import-corpus',
);

function fixture(name: string): Buffer {
  const path = join(EVIDENCE, name);
  if (!existsSync(path)) {
    throw new Error(`Fixture ${name} is missing. Expected it at ${path}.`);
  }
  return readFileSync(path);
}

/** What the seam was asked to do, recorded for inspection. */
interface SeamCall {
  pdfPath: string;
  scratchDir: string;
  limits: RasterizeJobLimits;
  /** The bytes as they existed ON DISK when the seam was entered. */
  bytesOnDisk: Buffer | null;
}

/** A service whose worker is replaced by a recording stub. */
class StubbedRasterService extends PdfRasterService {
  readonly calls: SeamCall[] = [];
  constructor(
    private readonly answer: (call: SeamCall) => Promise<RasterPipelineOutcome>,
  ) {
    super();
  }
  protected async executeRasterize(
    pdfPath: string,
    scratchDir: string,
    limits: RasterizeJobLimits,
  ): Promise<RasterPipelineOutcome> {
    const call: SeamCall = {
      pdfPath,
      scratchDir,
      limits,
      bytesOnDisk: existsSync(pdfPath) ? readFileSync(pdfPath) : null,
    };
    this.calls.push(call);
    return this.answer(call);
  }
}

const okOutcome = (
  overrides: Partial<Extract<RasterPipelineOutcome, { ok: true }>> = {},
) =>
  ({
    ok: true,
    sourcePageCount: 1,
    pages: [
      {
        sourcePage: 1,
        widthPx: 1920,
        heightPx: 1080,
        webpBase64: Buffer.from('full-image-bytes').toString('base64'),
        thumbWebpBase64: Buffer.from('thumb').toString('base64'),
      },
    ],
    warnings: [],
    truncated: false,
    elapsedMs: 7,
    ...overrides,
  }) as RasterPipelineOutcome;

describe('looksLikePdf', () => {
  it('accepts a header at the start and after a preamble', () => {
    expect(looksLikePdf(Buffer.from('%PDF-1.7\n...'))).toBe(true);
    // The spec permits junk before the header, and readers tolerate it.
    expect(
      looksLikePdf(
        Buffer.concat([Buffer.alloc(200, 0x20), Buffer.from('%PDF-1.4')]),
      ),
    ).toBe(true);
  });

  it('rejects anything else, including a header pushed past the scan window', () => {
    expect(looksLikePdf(Buffer.from('PK a zip, actually'))).toBe(false);
    expect(looksLikePdf(Buffer.alloc(0))).toBe(false);
    expect(
      looksLikePdf(
        Buffer.concat([Buffer.alloc(2000, 0x20), Buffer.from('%PDF-1.4')]),
      ),
    ).toBe(false);
  });
});

describe('PdfRasterService — what it refuses before paying for a browser', () => {
  it('refuses an empty file', async () => {
    const service = new StubbedRasterService(async () => okOutcome());
    expect(await service.rasterizePdf(Buffer.alloc(0))).toEqual({
      ok: false,
      reason: 'pdf-unreadable',
    });
    expect(service.calls).toHaveLength(0);
  });

  it('refuses a file over the input cap, without writing it anywhere', async () => {
    const service = new StubbedRasterService(async () => okOutcome());
    const result = await service.rasterizePdf(Buffer.alloc(2048, 0x25), {
      maxPdfBytes: 1024,
    });
    expect(result).toEqual({ ok: false, reason: 'pdf-too-large' });
    expect(service.calls).toHaveLength(0);
  });

  it('refuses something that is not a PDF at all', async () => {
    const service = new StubbedRasterService(async () => okOutcome());
    const result = await service.rasterizePdf(
      Buffer.from('<html>not a document</html>'),
    );
    expect(result).toEqual({ ok: false, reason: 'pdf-unreadable' });
    expect(service.calls).toHaveLength(0);
  });

  it('refuses to fan out — one rasterize child at a time', async () => {
    // 2026-09-15 — this used to sleep 20 ms to "let the first call reach the
    // seam". That is a race against a filesystem write, and on a loaded CI
    // runner the sleep lost: the second call was not refused, so it waited on a
    // gate that only opens after the assertion, and the test timed out at 5 s.
    //
    // The stub now SIGNALS when it has entered the seam, so the second call is
    // issued at a known point rather than a hoped-for one. No sleep, no timing
    // assumption, same property proven.
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered: (() => void) | undefined;
    const inSeam = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const service = new StubbedRasterService(async () => {
      entered?.();
      await gate;
      return okOutcome();
    });

    const first = service.rasterizePdf(fixture('mixed-layout.pdf'));
    await inSeam;

    const second = await service.rasterizePdf(fixture('mixed-layout.pdf'));
    expect(second).toEqual({ ok: false, reason: 'raster-busy' });
    release?.();
    expect((await first).ok).toBe(true);
    expect(service.calls).toHaveLength(1);
  });

  it('has no worker to fork inside a Jest run, and says so rather than pretending', () => {
    // There is no compiled `render-worker.js` next to a ts-jest module, which
    // is precisely why the seam exists.
    expect(
      new StubbedRasterService(async () => okOutcome()).isAvailable(),
    ).toBe(false);
  });
});

describe('PdfRasterService — the upload is a PATH, and the path does not survive', () => {
  it('writes the bytes to a private file inside a scratch dir it created', async () => {
    const service = new StubbedRasterService(async () => okOutcome());
    const bytes = fixture('mixed-layout.pdf');
    await service.rasterizePdf(bytes);

    const call = service.calls[0];
    expect(call.bytesOnDisk).not.toBeNull();
    // The worker really is reading the same document the caller handed us.
    expect(call.bytesOnDisk!.equals(bytes)).toBe(true);
    // The file lives inside the directory the worker is told to destroy.
    expect(dirname(call.pdfPath)).toBe(call.scratchDir);
    // The name is ours, not the uploader's.
    expect(call.pdfPath).toMatch(/\/[0-9a-f]{32}\.pdf$/);
  });

  it('DESTROYS the scratch dir on success and on failure alike', async () => {
    const good = new StubbedRasterService(async () => okOutcome());
    await good.rasterizePdf(fixture('mixed-layout.pdf'));
    expect(existsSync(good.calls[0].scratchDir)).toBe(false);

    const bad = new StubbedRasterService(async () => ({
      ok: false,
      reason: 'pdf-unreadable',
    }));
    await bad.rasterizePdf(fixture('mixed-layout.pdf'));
    expect(existsSync(bad.calls[0].scratchDir)).toBe(false);

    const thrown = new StubbedRasterService(async () => {
      throw new Error('worker exploded');
    });
    expect(await thrown.rasterizePdf(fixture('mixed-layout.pdf'))).toEqual({
      ok: false,
      reason: 'raster-failed',
    });
    expect(existsSync(thrown.calls[0].scratchDir)).toBe(false);
  });

  it('gives every job its own directory', async () => {
    const service = new StubbedRasterService(async () => okOutcome());
    await service.rasterizePdf(fixture('mixed-layout.pdf'));
    await service.rasterizePdf(fixture('mixed-layout.pdf'));
    expect(service.calls[0].scratchDir).not.toBe(service.calls[1].scratchDir);
    expect(service.calls[0].pdfPath).not.toBe(service.calls[1].pdfPath);
  });
});

describe('PdfRasterService — what it hands back', () => {
  it('decodes the images and keeps the source page numbers', async () => {
    const service = new StubbedRasterService(async () => okOutcome());
    const result = (await service.rasterizePdf(
      fixture('mixed-layout.pdf'),
    )) as Extract<RasterizeResult, { ok: true }>;
    expect(result.ok).toBe(true);
    expect(result.pages[0].webp.toString()).toBe('full-image-bytes');
    expect(result.pages[0].thumbWebp.toString()).toBe('thumb');
    expect(result.pages[0].sourcePage).toBe(1);
    expect(result.pages[0].widthPx).toBe(1920);
  });

  it('carries truncation and its explanation to the caller, never swallowing it', async () => {
    const service = new StubbedRasterService(async () =>
      okOutcome({
        sourcePageCount: 41,
        truncated: true,
        warnings: ['page-cap: rendered 1 of 41 pages'],
      }),
    );
    const result = (await service.rasterizePdf(
      fixture('forty-one-pages.pdf'),
    )) as Extract<RasterizeResult, { ok: true }>;
    expect(result.truncated).toBe(true);
    expect(result.sourcePageCount).toBe(41);
    expect(result.pages).toHaveLength(1);
    expect(result.warnings).toEqual(['page-cap: rendered 1 of 41 pages']);
  });

  it('passes a worker refusal through with its reason intact', async () => {
    const service = new StubbedRasterService(async () => ({
      ok: false,
      reason: 'pdf-password-protected',
    }));
    expect(await service.rasterizePdf(fixture('mixed-layout.pdf'))).toEqual({
      ok: false,
      reason: 'pdf-password-protected',
    });
  });

  it('forwards caller bounds to the worker and defaults the rest', async () => {
    const service = new StubbedRasterService(async () => okOutcome());
    await service.rasterizePdf(fixture('mixed-layout.pdf'), { maxPages: 4 });
    expect(service.calls[0].limits.maxPages).toBe(4);
    expect(service.calls[0].limits.targetLongEdgePx).toBe(
      DEFAULT_RASTERIZE_LIMITS.targetLongEdgePx,
    );
  });
});

/**
 * The same service, with the seam wired to the REAL pipeline and a REAL
 * browser — no stub anywhere in the path from `rasterizePdf(bytes)` to a
 * decodable image.
 */
describeWithChromium(
  'PdfRasterService — end to end on a real browser',
  (executablePath) => {
    jest.setTimeout(180_000);

    let launcher: BrowserLauncher;
    beforeAll(async () => {
      launcher = (await loadPuppeteerForTests()) as unknown as BrowserLauncher;
    });

    class RealRasterService extends PdfRasterService {
      protected async executeRasterize(
        pdfPath: string,
        _scratchDir: string,
        limits: RasterizeJobLimits,
      ): Promise<RasterPipelineOutcome> {
        return runPdfRasterPipeline({
          launcher,
          pdfPath,
          executablePath,
          limits,
          logger: { log: () => {}, warn: () => {}, error: () => {} },
        });
      }
    }

    it('turns the 3-page fixture into three decodable WebP images', async () => {
      const service = new RealRasterService();
      const result = (await service.rasterizePdf(
        fixture('mixed-layout.pdf'),
      )) as Extract<RasterizeResult, { ok: true }>;
      expect(result.ok).toBe(true);
      expect(result.sourcePageCount).toBe(3);
      expect(result.pages).toHaveLength(3);
      expect(result.truncated).toBe(false);

      for (const page of result.pages) {
        const meta = await sharp(page.webp).metadata();
        expect(meta.format).toBe('webp');
        expect(meta.width).toBe(page.widthPx);
        expect(meta.height).toBe(page.heightPx);
        const thumbMeta = await sharp(page.thumbWebp).metadata();
        expect(thumbMeta.format).toBe('webp');
        expect(thumbMeta.width).toBeLessThan(meta.width!);
      }
    });

    it('truncates a long document explicitly, end to end', async () => {
      const service = new RealRasterService();
      const result = (await service.rasterizePdf(
        fixture('forty-one-pages.pdf'),
        {
          maxPages: 3,
        },
      )) as Extract<RasterizeResult, { ok: true }>;
      expect(result.ok).toBe(true);
      expect(result.pages).toHaveLength(3);
      expect(result.sourcePageCount).toBe(41);
      expect(result.truncated).toBe(true);
      expect(result.warnings.some((w) => w.includes('41'))).toBe(true);
    });

    it('fails cleanly on a PDF-shaped file with a destroyed body', async () => {
      const service = new RealRasterService();
      const corrupt = Buffer.concat([
        Buffer.from('%PDF-1.7\n'),
        Buffer.from(
          '1 0 obj <<>> endobj trailer <<>> startxref 999999 %%EOF\n',
        ),
      ]);
      expect(await service.rasterizePdf(corrupt)).toEqual({
        ok: false,
        reason: 'pdf-unreadable',
      });
    });
  },
);

// ── 2026-10-05 — rasterizePdfFrames: a page range composed into screen frames ──
describe('PdfRasterService.rasterizePdfFrames', () => {
  const FRAMES = [
    { key: 'landscape', width: 3840, height: 2160 },
    { key: 'portrait', width: 2160, height: 3840 },
  ];
  const pdf = Buffer.from('%PDF-1.7\n1 0 obj<<>>endobj\n%%EOF\n');

  class RangeStub extends PdfRasterService {
    readonly seen: Array<{ firstPage?: number; frames?: unknown; maxPages: number }> = [];
    constructor(private readonly answer: () => Promise<RasterPipelineOutcome>) {
      super();
    }
    protected async executeRasterize(
      _pdfPath: string,
      _scratchDir: string,
      limits: RasterizeJobLimits,
      request: { firstPage?: number; frames?: unknown } = {},
    ): Promise<RasterPipelineOutcome> {
      this.seen.push({ firstPage: request.firstPage, frames: request.frames, maxPages: limits.maxPages });
      return this.answer();
    }
  }

  const framedPage = (n: number) => ({
    sourcePage: n,
    widthPx: 2160,
    heightPx: 2795,
    webpBase64: '',
    thumbWebpBase64: Buffer.from('thumb').toString('base64'),
    frames: FRAMES.map((f) => ({
      key: f.key,
      widthPx: f.width,
      heightPx: f.height,
      webpBase64: Buffer.from(`${f.key}-${n}`).toString('base64'),
    })),
  });

  it('hands the range and the frames to the worker, and the frames back as buffers', async () => {
    const svc = new RangeStub(async () => ({
      ok: true, sourcePageCount: 12, pages: [framedPage(7), framedPage(8)], warnings: [], truncated: true, elapsedMs: 5,
    }));
    const out = await svc.rasterizePdfFrames(pdf, { firstPage: 7, frames: FRAMES }, { maxPages: 2 });
    expect(svc.seen).toEqual([{ firstPage: 7, frames: FRAMES, maxPages: 2 }]);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out).toMatchObject({ sourcePageCount: 12, truncated: true });
    expect(out.pages.map((p) => p.sourcePage)).toEqual([7, 8]);
    expect(out.pages[1].frames.map((f) => [f.key, f.webp.toString()])).toEqual([
      ['landscape', 'landscape-8'],
      ['portrait', 'portrait-8'],
    ]);
    expect(out.pages[0].thumbWebp.toString()).toBe('thumb');
  });

  it('refuses a page that came back without its frames', async () => {
    const svc = new RangeStub(async () => ({
      ok: true, sourcePageCount: 1, pages: [{ ...framedPage(1), frames: undefined }], warnings: [], truncated: false, elapsedMs: 1,
    }));
    expect(await svc.rasterizePdfFrames(pdf, { firstPage: 1, frames: FRAMES })).toEqual({ ok: false, reason: 'worker-frames-missing' });
  });

  it('passes the worker refusal through, and refuses non-PDF bytes before any worker', async () => {
    const svc = new RangeStub(async () => ({ ok: false, reason: 'pdf-password-protected' }));
    expect(await svc.rasterizePdfFrames(pdf, { firstPage: 1, frames: FRAMES })).toEqual({ ok: false, reason: 'pdf-password-protected' });
    expect(await svc.rasterizePdfFrames(Buffer.from('not a pdf'), { firstPage: 1, frames: FRAMES })).toEqual({ ok: false, reason: 'pdf-unreadable' });
    expect(svc.seen).toHaveLength(1);
  });

  it('shares ONE slot with the design import: background work is refused while anything holds it', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => { release = r; });
    const svc = new RangeStub(async () => {
      await gate;
      return { ok: true, sourcePageCount: 1, pages: [framedPage(1)], warnings: [], truncated: false, elapsedMs: 1 };
    });
    const first = svc.rasterizePdfFrames(pdf, { firstPage: 1, frames: FRAMES });
    await new Promise((r) => setTimeout(r, 20));
    expect(await svc.rasterizePdfFrames(pdf, { firstPage: 1, frames: FRAMES })).toEqual({ ok: false, reason: 'raster-busy' });
    release();
    expect((await first).ok).toBe(true);
  });

  it('a design import WAITS for a background page range and goes first — the next range is refused', async () => {
    let releaseRange: () => void = () => undefined;
    const rangeGate = new Promise<void>((r) => { releaseRange = r; });
    let releaseImport: () => void = () => undefined;
    const importGate = new Promise<void>((r) => { releaseImport = r; });
    const order: string[] = [];
    const svc = new RangeStub(async () => undefined as never);
    (svc as any).executeRasterize = async (_p: string, _s: string, _l: unknown, request: { frames?: unknown } = {}) => {
      if (request.frames) {
        order.push('range');
        await rangeGate;
        return { ok: true, sourcePageCount: 2, pages: [framedPage(1)], warnings: [], truncated: true, elapsedMs: 1 };
      }
      order.push('import');
      await importGate;
      return { ok: true, sourcePageCount: 1, pages: [{ ...framedPage(1), frames: undefined, webpBase64: 'AAAA' }], warnings: [], truncated: false, elapsedMs: 1 };
    };
    const range = svc.rasterizePdfFrames(pdf, { firstPage: 1, frames: FRAMES });
    await new Promise((r) => setTimeout(r, 20));
    const importing = svc.rasterizePdf(pdf); // a person waiting: must not be refused
    await new Promise((r) => setTimeout(r, 20));
    releaseRange();
    expect((await range).ok).toBe(true);
    await new Promise((r) => setTimeout(r, 20));
    // The background loop's next range finds the import in the slot.
    expect(await svc.rasterizePdfFrames(pdf, { firstPage: 2, frames: FRAMES })).toEqual({ ok: false, reason: 'raster-busy' });
    releaseImport();
    expect((await importing).ok).toBe(true);
    expect(order).toEqual(['range', 'import']);
  });

  it('an import waits only so long for a background range, then is refused as before', async () => {
    const svc = new RangeStub(() => new Promise(() => undefined)); // a range that never ends
    svc.importWaitMs = 30;
    void svc.rasterizePdfFrames(pdf, { firstPage: 1, frames: FRAMES });
    await new Promise((r) => setTimeout(r, 10));
    expect(await svc.rasterizePdf(pdf)).toEqual({ ok: false, reason: 'raster-busy' });
  });
});
