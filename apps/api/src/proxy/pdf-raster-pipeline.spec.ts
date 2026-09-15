/**
 * The rasterizer, against a real Chromium and the audit's real fixtures.
 *
 * These are the assertions that cannot be faked. The claim this package makes
 * is "every source page comes back, looking like itself, at its own aspect,
 * and every bound announces itself" — and the only honest way to test that is
 * to paint the fixtures and LOOK AT THE PIXELS. So the artwork-only page is
 * checked by sampling its colours, not by counting its bytes: a white
 * rectangle of the right size would pass a size assertion, and a white
 * rectangle is exactly the bug being fixed.
 *
 * `mixed-layout.pdf` is 3 pages at 800×450: a dark title page, a page that is
 * ONLY artwork (a yellow disc on blue — no text at all, which is why today's
 * text-run importer drops it), and a page with one line of text.
 * `forty-one-pages.pdf` is 41 numbered pages at the same size.
 *
 * If no browser is available the suite SKIPS with a named reason. It never
 * passes vacuously — see `test/chromium-for-tests.ts`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import {
  DEFAULT_RASTERIZE_LIMITS,
  buildRasterLaunchArgs,
  runPdfRasterPipeline,
  type RasterPipelineOutcome,
} from './pdf-raster-pipeline';
import { resolvePdfjsAsset, loadPdfjsAssets } from './pdfjs-assets';
import type { BrowserLauncher, PipelineLogger } from './render-pipeline';
import type { RasterizeJobLimits } from './render-worker-protocol';
import {
  describeWithChromium,
  loadPuppeteerForTests,
} from '../../test/chromium-for-tests';

const EVIDENCE = join(
  __dirname,
  '../../test/fixtures/import-corpus',
);

function fixture(name: string): Buffer {
  const path = join(EVIDENCE, name);
  if (!existsSync(path)) {
    throw new Error(
      `Fixture ${name} is missing. Expected it at ${path} — these tests are only ` +
        "meaningful against the audit's real PDFs.",
    );
  }
  return readFileSync(path);
}

const silent: PipelineLogger = {
  log: () => {},
  warn: () => {},
  error: () => {},
};

/** The source fixtures are 800×450 — 16:9. */
const SOURCE_ASPECT = 800 / 450;

/** Sample one pixel as #rrggbb. */
async function pixelAt(
  webp: Buffer,
  xRatio: number,
  yRatio: number,
): Promise<string> {
  const image = sharp(webp);
  const meta = await image.metadata();
  const left = Math.min(
    meta.width! - 1,
    Math.max(0, Math.round(meta.width! * xRatio)),
  );
  const top = Math.min(
    meta.height! - 1,
    Math.max(0, Math.round(meta.height! * yRatio)),
  );
  const { data } = await image
    .extract({ left, top, width: 1, height: 1 })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const hex = (n: number) => n.toString(16).padStart(2, '0');
  return `#${hex(data[0])}${hex(data[1])}${hex(data[2])}`;
}

/** Channel-wise distance, so a lossy encode does not make an exact-match test flaky. */
function colourDistance(a: string, b: string): number {
  const parse = (hex: string) =>
    [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const [ar, ag, ab] = parse(a);
  const [br, bg, bb] = parse(b);
  return Math.max(Math.abs(ar - br), Math.abs(ag - bg), Math.abs(ab - bb));
}

describe('pdfjs assets — what the render page is allowed to read', () => {
  const root = '/opt/app/node_modules/pdfjs-dist';

  it('serves the packaged standard fonts and cmaps', () => {
    expect(resolvePdfjsAsset(root, 'standard_fonts/FoxitSans.pfb')).toBe(
      '/opt/app/node_modules/pdfjs-dist/standard_fonts/FoxitSans.pfb',
    );
    expect(resolvePdfjsAsset(root, 'cmaps/UniJIS-UCS2-H.bcmap')).toBe(
      '/opt/app/node_modules/pdfjs-dist/cmaps/UniJIS-UCS2-H.bcmap',
    );
  });

  it.each([
    ['traversal out of the package', 'standard_fonts/../../../etc/passwd'],
    ['a bare traversal', '../../.env'],
    ['an absolute path', '/etc/passwd'],
    ['another directory in the package', 'build/pdf.mjs'],
    ['a nested path', 'standard_fonts/nested/thing.pfb'],
    ['an empty name', 'standard_fonts/'],
  ])('refuses %s', (_label, candidate) => {
    expect(resolvePdfjsAsset(root, candidate)).toBeNull();
  });

  it('finds the pdf.js build this API actually ships', () => {
    const assets = loadPdfjsAssets();
    expect(assets.moduleSource.length).toBeGreaterThan(10_000);
    expect(assets.workerSource.length).toBeGreaterThan(10_000);
    expect(existsSync(join(assets.packageRoot, 'standard_fonts'))).toBe(true);
    expect(existsSync(join(assets.packageRoot, 'cmaps'))).toBe(true);
  });
});

describe('buildRasterLaunchArgs — the browser cannot reach the network', () => {
  it('maps every host to NOTFOUND, on top of the render pipeline flags', () => {
    const args = buildRasterLaunchArgs('/tmp/profile');
    expect(args).toContain('--host-resolver-rules=MAP * ~NOTFOUND');
    expect(args).toContain('--no-proxy-server');
    // Inherited, not re-declared: a future change to the shared flags has to
    // reach this job kind too.
    expect(args).toContain('--disable-dev-shm-usage');
    expect(args).toContain('--user-data-dir=/tmp/profile');
  });
});

describeWithChromium(
  'runPdfRasterPipeline — real Chromium, real PDFs',
  (executablePath) => {
    jest.setTimeout(180_000);

    let launcher: BrowserLauncher;
    let tmpDir: string;

    beforeAll(async () => {
      const puppeteer = await loadPuppeteerForTests();
      launcher = puppeteer as unknown as BrowserLauncher;
      const { mkdtemp } = await import('node:fs/promises');
      const { tmpdir } = await import('node:os');
      tmpDir = await mkdtemp(join(tmpdir(), 'venueos-raster-spec-'));
    });

    afterAll(async () => {
      const { rm } = await import('node:fs/promises');
      if (tmpDir)
        await rm(tmpDir, { recursive: true, force: true }).catch(
          () => undefined,
        );
    });

    /** Where the last `rasterize()` call put its input, for cleanup assertions. */
    let lastPdfPath = '';

    /** Write a fixture where the pipeline can read it, then rasterize it. */
    async function rasterize(
      bytes: Buffer,
      overrides: Partial<RasterizeJobLimits> = {},
    ): Promise<RasterPipelineOutcome> {
      const { writeFile } = await import('node:fs/promises');
      const { randomBytes } = await import('node:crypto');
      const pdfPath = join(tmpDir, `${randomBytes(8).toString('hex')}.pdf`);
      lastPdfPath = pdfPath;
      await writeFile(pdfPath, bytes);
      return runPdfRasterPipeline({
        launcher,
        pdfPath,
        executablePath,
        limits: { ...DEFAULT_RASTERIZE_LIMITS, ...overrides },
        logger: silent,
      });
    }

    it('UNLINKS the upload as soon as it has been read', async () => {
      // Not left to the worker's exit path: that runs after the result is
      // posted and loses the race with the parent's SIGKILL often enough to
      // have been caught driving the compiled worker. The document is on disk
      // for the read and not for the render.
      const result = await rasterize(fixture('mixed-layout.pdf'));
      expect(result.ok).toBe(true);
      expect(existsSync(lastPdfPath)).toBe(false);
    });

    it('unlinks the upload on the failure path too', async () => {
      const result = await rasterize(
        Buffer.from('%PDF-1.7\nnot really a document\n'),
      );
      expect(result.ok).toBe(false);
      expect(existsSync(lastPdfPath)).toBe(false);
    });

    it('returns ALL THREE pages of mixed-layout.pdf, including the artwork-only one', async () => {
      const result = await rasterize(fixture('mixed-layout.pdf'));
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.sourcePageCount).toBe(3);
      expect(result.pages).toHaveLength(3);
      expect(result.truncated).toBe(false);
      // Source page numbers, in order, so a caller can say "page 2 of your PDF".
      expect(result.pages.map((p) => p.sourcePage)).toEqual([1, 2, 3]);
      // Nothing tried to leave the box.
      expect(
        result.warnings.filter((w) => w.startsWith('network-blocked')),
      ).toEqual([]);
    });

    it('paints the artwork-only page as ARTWORK, not as a white rectangle', async () => {
      // This is the whole point. Page 2 has no text at all, so the text-run
      // importer drops it; a rasterizer that returned a blank page of the right
      // size would pass every structural assertion and still be useless.
      const result = await rasterize(fixture('mixed-layout.pdf'));
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const artwork = Buffer.from(result.pages[1].webpBase64, 'base64');
      const centre = await pixelAt(artwork, 0.5, 0.5);
      const corner = await pixelAt(artwork, 0.03, 0.05);
      // A yellow disc on a blue field, from the fixture generator.
      expect(colourDistance(centre, '#f4b942')).toBeLessThan(24);
      expect(colourDistance(corner, '#2563eb')).toBeLessThan(24);
      expect(colourDistance(centre, corner)).toBeGreaterThan(60);
    });

    it('keeps the source aspect ratio on every page, and hits the target long edge', async () => {
      const result = await rasterize(fixture('mixed-layout.pdf'));
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      for (const page of result.pages) {
        expect(page.widthPx / page.heightPx).toBeCloseTo(SOURCE_ASPECT, 2);
        expect(page.widthPx).toBe(DEFAULT_RASTERIZE_LIMITS.targetLongEdgePx);
        // And the encoded image really is that size — not a claim in a field.
        const meta = await sharp(
          Buffer.from(page.webpBase64, 'base64'),
        ).metadata();
        expect(meta.width).toBe(page.widthPx);
        expect(meta.height).toBe(page.heightPx);
        expect(meta.format).toBe('webp');
      }
    });

    it('ships a smaller thumbnail per page, at the same aspect', async () => {
      const result = await rasterize(fixture('mixed-layout.pdf'));
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      for (const page of result.pages) {
        const thumb = Buffer.from(page.thumbWebpBase64, 'base64');
        const meta = await sharp(thumb).metadata();
        expect(meta.format).toBe('webp');
        expect(meta.width).toBe(DEFAULT_RASTERIZE_LIMITS.thumbLongEdgePx);
        expect(meta.width! / meta.height!).toBeCloseTo(SOURCE_ASPECT, 2);
        expect(thumb.byteLength).toBeLessThan(
          Buffer.from(page.webpBase64, 'base64').byteLength,
        );
      }
    });

    it('rasterizes all 41 pages of the long fixture when the cap allows it', async () => {
      // NEGATIVE CONTROL for the truncation test below: with the cap above the
      // page count, nothing truncates. If this ever fails, the next test's
      // "truncated" is being caused by something other than the page cap.
      const result = await rasterize(fixture('forty-one-pages.pdf'), {
        maxPages: 60,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.sourcePageCount).toBe(41);
      expect(result.pages).toHaveLength(41);
      expect(result.truncated).toBe(false);
      expect(result.warnings.filter((w) => w.startsWith('page-cap'))).toEqual(
        [],
      );
    });

    it('TRUNCATES EXPLICITLY at the page cap — never silently', async () => {
      const result = await rasterize(fixture('forty-one-pages.pdf'), {
        maxPages: 5,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.pages).toHaveLength(5);
      // The source count is reported in full, so the caller can say "5 of 41".
      expect(result.sourcePageCount).toBe(41);
      expect(result.truncated).toBe(true);
      expect(
        result.warnings.some(
          (w) => w.startsWith('page-cap:') && w.includes('41'),
        ),
      ).toBe(true);
    });

    it('TRUNCATES EXPLICITLY at the output-byte budget', async () => {
      // Small enough that a couple of pages fit and the rest cannot.
      const result = await rasterize(fixture('forty-one-pages.pdf'), {
        maxPages: 41,
        maxTotalOutputBytes: 40_000,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.pages.length).toBeGreaterThan(0);
      expect(result.pages.length).toBeLessThan(41);
      expect(result.truncated).toBe(true);
      expect(result.warnings.some((w) => w.startsWith('size-cap:'))).toBe(true);
      const total = result.pages.reduce(
        (sum, p) =>
          sum +
          Buffer.from(p.webpBase64, 'base64').byteLength +
          Buffer.from(p.thumbWebpBase64, 'base64').byteLength,
        0,
      );
      expect(total).toBeLessThanOrEqual(40_000);
    });

    it('clamps the scale factor, and STILL keeps the aspect', async () => {
      // NEGATIVE CONTROL for `maxScale`: the target long edge asks for 1920 px
      // from an 800-px page (scale 2.4); a 0.5 ceiling must win. Delete the
      // clamp and this comes back 1920 wide.
      const result = await rasterize(fixture('mixed-layout.pdf'), {
        maxScale: 0.5,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.pages[0].widthPx).toBe(400);
      expect(result.pages[0].heightPx).toBe(225);
      expect(result.pages[0].widthPx / result.pages[0].heightPx).toBeCloseTo(
        SOURCE_ASPECT,
        2,
      );
    });

    it('clamps decoded pixels per page, and STILL keeps the aspect', async () => {
      // NEGATIVE CONTROL for `maxPagePixels`: 120_000 px at 16:9 is ~462×260.
      // Delete the clamp and this comes back at the 1920-px target.
      const result = await rasterize(fixture('mixed-layout.pdf'), {
        maxPagePixels: 120_000,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const page = result.pages[0];
      expect(page.widthPx * page.heightPx).toBeLessThanOrEqual(120_000);
      expect(page.widthPx).toBeLessThan(
        DEFAULT_RASTERIZE_LIMITS.targetLongEdgePx,
      );
      expect(page.widthPx / page.heightPx).toBeCloseTo(SOURCE_ASPECT, 2);
    });

    it('refuses a file larger than the input cap without opening it', async () => {
      const result = await rasterize(fixture('forty-one-pages.pdf'), {
        maxPdfBytes: 1024,
      });
      expect(result).toEqual({ ok: false, reason: 'pdf-too-large' });
    });

    it('fails cleanly on a corrupt PDF rather than returning half a document', async () => {
      // A real PDF header with a destroyed body: this has to reach pdf.js to be
      // rejected, so it exercises the pipeline's own error path, not a guard.
      const corrupt = Buffer.concat([
        Buffer.from('%PDF-1.7\n'),
        Buffer.from(
          '1 0 obj <<>> endobj trailer <<>> startxref 999999 %%EOF\n',
        ),
      ]);
      const result = await rasterize(corrupt);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe('pdf-unreadable');
    });

    it('fails cleanly on something that is not a PDF at all', async () => {
      const result = await rasterize(
        Buffer.from('this is a text file, not a document'),
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe('pdf-unreadable');
    });

    it('fails cleanly on an empty file', async () => {
      const result = await rasterize(Buffer.alloc(0));
      expect(result).toEqual({ ok: false, reason: 'pdf-unreadable' });
    });
  },
);
