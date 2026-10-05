/**
 * The rasterize job's wire contract.
 *
 * The render worker's whole safety story is "it cannot be told to do anything
 * except the jobs it ships with". Adding a second job kind is the moment that
 * story is easiest to break — by loosening the parser instead of extending it.
 * So these tests pin BOTH directions: the new job is accepted only in exactly
 * one shape, the old job is untouched, and a raster result is re-bounded in the
 * parent because the child produced it from a stranger's file.
 */
import {
  RENDER_PROTOCOL_VERSION,
  parseRenderJob,
  parseWorkerMessage,
  type RasterResultCaps,
} from './render-worker-protocol';
import { DEFAULT_RENDER_LIMITS } from './render-pipeline';
import { DEFAULT_RASTERIZE_LIMITS } from './pdf-raster-pipeline';

const rasterJob = {
  v: RENDER_PROTOCOL_VERSION,
  type: 'rasterize',
  kind: 'pdf-pages',
  pdfPath: '/tmp/venueos-pdfin-abc/deadbeef.pdf',
  scratchDir: '/tmp/venueos-pdfin-abc',
  executablePath: '/usr/bin/chromium-browser',
  userDataDir: '/tmp/profile',
  limits: DEFAULT_RASTERIZE_LIMITS,
};

const renderJob = {
  v: RENDER_PROTOCOL_VERSION,
  type: 'render',
  url: 'https://example.com/',
  executablePath: '/usr/bin/chromium-browser',
  userDataDir: '/tmp/profile',
  limits: DEFAULT_RENDER_LIMITS,
};


describe('rasterize job — path containment', () => {
  // The parent builds both paths today, so these guard a future regression up
  // there rather than a message an attacker can send. That is exactly when a
  // check has to be right: nothing else is watching.
  const base = (over: Record<string, unknown> = {}) => ({
    v: RENDER_PROTOCOL_VERSION,
    type: 'rasterize',
    kind: 'pdf-pages',
    scratchDir: '/tmp/venueos-raster-abc',
    pdfPath: '/tmp/venueos-raster-abc/source.pdf',
    executablePath: '/usr/bin/chromium-browser',
    userDataDir: '/tmp/venueos-raster-abc/profile',
    limits: {
      maxPages: 60, maxPagePixels: 8_294_400, maxScale: 8,
      maxPdfBytes: 52_428_800, maxTotalOutputBytes: 33_554_432,
      targetLongEdgePx: 1920, thumbLongEdgePx: 480,
      webpQuality: 82, workerBudgetMs: 45_000, pageRenderTimeoutMs: 15_000,
    },
    ...over,
  });

  it('accepts a pdf inside the scratch directory', () => {
    expect(parseRenderJob(base())).not.toBeNull();
  });

  it('refuses a sibling directory whose name merely starts the same', () => {
    // The bare-prefix trap: this string DOES start with the scratch dir.
    expect(parseRenderJob(base({ pdfPath: '/tmp/venueos-raster-abc-elsewhere/x.pdf' }))).toBeNull();
  });

  it('refuses a traversal back out of the scratch directory', () => {
    expect(parseRenderJob(base({ pdfPath: '/tmp/venueos-raster-abc/../../etc/passwd' }))).toBeNull();
  });

  it('refuses the scratch directory itself as the file', () => {
    expect(parseRenderJob(base({ pdfPath: '/tmp/venueos-raster-abc' }))).toBeNull();
  });
});

describe('parseRenderJob — a second job kind, not a looser parser', () => {
  it('accepts a well-formed rasterize job', () => {
    expect(parseRenderJob(rasterJob)).toMatchObject({
      type: 'rasterize',
      kind: 'pdf-pages',
      pdfPath: rasterJob.pdfPath,
    });
  });

  it('still accepts the URL render job, unchanged', () => {
    expect(parseRenderJob(renderJob)).toMatchObject({
      type: 'render',
      url: 'https://example.com/',
    });
  });

  it.each([
    ['an unknown job type', { ...rasterJob, type: 'exec' }],
    ['an unknown kind on a known type', { ...rasterJob, kind: 'pptx-pages' }],
    ['a missing kind', { ...rasterJob, kind: undefined }],
    ['a wrong protocol version', { ...rasterJob, v: 2 }],
    ['no pdf path', { ...rasterJob, pdfPath: '' }],
    ['no scratch dir', { ...rasterJob, scratchDir: '' }],
    ['an absurd path', { ...rasterJob, pdfPath: 'x'.repeat(5000) }],
    ['no executable', { ...rasterJob, executablePath: '' }],
    ['no profile dir', { ...rasterJob, userDataDir: '' }],
    ['no limits', { ...rasterJob, limits: undefined }],
    [
      'a negative limit',
      { ...rasterJob, limits: { ...DEFAULT_RASTERIZE_LIMITS, maxPages: -1 } },
    ],
    [
      'a NaN limit',
      {
        ...rasterJob,
        limits: { ...DEFAULT_RASTERIZE_LIMITS, maxPagePixels: NaN },
      },
    ],
    ['a missing limit', { ...rasterJob, limits: { maxPages: 1 } }],
    [
      'an impossible webp quality',
      {
        ...rasterJob,
        limits: { ...DEFAULT_RASTERIZE_LIMITS, webpQuality: 101 },
      },
    ],
  ])('refuses %s', (_label, candidate) => {
    expect(parseRenderJob(candidate)).toBeNull();
  });

  it('REFUSES a pdf path that escapes the directory the child will destroy', () => {
    // Cleanup and blast radius have to name the same place. A job whose input
    // lives outside its scratch dir is either a bug or someone aiming the
    // child's `rm -rf` at a directory of their choosing.
    expect(
      parseRenderJob({
        ...rasterJob,
        pdfPath: '/etc/passwd',
        scratchDir: '/tmp/venueos-pdfin-abc',
      }),
    ).toBeNull();
  });
});

describe('parseWorkerMessage — a raster result is untrusted input too', () => {
  const caps: RasterResultCaps = { maxPages: 3, maxTotalOutputBytes: 1024 };
  const page = (n: number, bytes = 12) => ({
    sourcePage: n,
    widthPx: 1920,
    heightPx: 1080,
    webpBase64: 'A'.repeat(bytes),
    thumbWebpBase64: 'A'.repeat(4),
  });
  const result = (pages: unknown[], extra: Record<string, unknown> = {}) => ({
    v: RENDER_PROTOCOL_VERSION,
    type: 'raster-result',
    ok: true,
    sourcePageCount: 3,
    pages,
    warnings: [],
    truncated: false,
    elapsedMs: 42,
    ...extra,
  });

  it('accepts a well-formed result', () => {
    const parsed = parseWorkerMessage(result([page(1), page(2)]), 1, caps);
    expect(parsed).toMatchObject({
      type: 'raster-result',
      ok: true,
      sourcePageCount: 3,
    });
    expect((parsed as any).pages).toHaveLength(2);
  });

  it('REFUSES a raster result when the caller never asked for one', () => {
    // A client waiting for hydrated HTML must not be handed images just
    // because the child sent some.
    expect(parseWorkerMessage(result([page(1)]), 1)).toBeNull();
  });

  it('REFUSES more pages than the cap the parent set', () => {
    expect(
      parseWorkerMessage(result([page(1), page(2), page(3), page(4)]), 1, caps),
    ).toBeNull();
  });

  it('REFUSES a payload over the byte budget', () => {
    // Four pages' worth of base64 at ~1 KB each against a 1 KB budget.
    const fat = result([page(1, 2000)]);
    expect(parseWorkerMessage(fat, 1, caps)).toBeNull();
  });

  it.each([
    ['a page number of zero', result([{ ...page(1), sourcePage: 0 }])],
    ['a zero-width page', result([{ ...page(1), widthPx: 0 }])],
    [
      'image data that is not base64',
      result([{ ...page(1), webpBase64: '<script>' }]),
    ],
    [
      'a thumbnail that is not a string',
      result([{ ...page(1), thumbWebpBase64: 42 }]),
    ],
    ['pages that are not an array', result(null as any)],
    ['a page that is not an object', result(['nope'])],
    ['no source page count', result([page(1)], { sourcePageCount: undefined })],
  ])('refuses %s', (_label, candidate) => {
    expect(parseWorkerMessage(candidate, 1, caps)).toBeNull();
  });

  it('carries truncation through, and sanitizes the warnings that explain it', () => {
    const parsed = parseWorkerMessage(
      result([page(1)], {
        truncated: true,
        warnings: ['page-cap: 1 of 3\nforged log line'],
      }),
      1,
      caps,
    );
    expect(parsed).toMatchObject({ truncated: true });
    expect((parsed as any).warnings[0]).toBe(
      'page-cap: 1 of 3 forged log line',
    );
  });

  it('passes a refusal through with a sanitized reason', () => {
    expect(
      parseWorkerMessage(
        {
          v: RENDER_PROTOCOL_VERSION,
          type: 'raster-result',
          ok: false,
          reason: 'pdf\nunreadable',
        },
        1,
        caps,
      ),
    ).toEqual({
      v: RENDER_PROTOCOL_VERSION,
      type: 'raster-result',
      ok: false,
      reason: 'pdf unreadable',
    });
  });
});

// ── 2026-10-05 — PDF pages on screens: a page RANGE and screen FRAMES ──────
//
// Two optional fields, and the same discipline as the rest of this file: when
// present they are exact, and a raster result that answers a frames job must
// carry exactly the frames that job asked for — the child decoded a stranger's
// file, so "here is your 3840×2160 frame" is a claim, not a fact.
describe('rasterize job — page range and screen frames', () => {
  const frames = [
    { key: 'landscape', width: 3840, height: 2160 },
    { key: 'portrait-1080', width: 1080, height: 1920 },
  ];

  it('accepts a range job with frames, and keeps both', () => {
    expect(parseRenderJob({ ...rasterJob, firstPage: 7, frames })).toMatchObject({
      firstPage: 7,
      frames,
    });
  });

  it('a job without them is the design-import job, unchanged', () => {
    const parsed = parseRenderJob(rasterJob) as Record<string, unknown>;
    expect(parsed).not.toHaveProperty('firstPage');
    expect(parsed).not.toHaveProperty('frames');
  });

  it.each([
    ['page zero', { firstPage: 0 }],
    ['a fractional page', { firstPage: 1.5 }],
    ['a page given as a string', { firstPage: '2' }],
    ['an empty frame list', { frames: [] }],
    ['frames that are not a list', { frames: { key: 'landscape' } }],
    ['more frames than allowed', { frames: Array.from({ length: 7 }, (_, i) => ({ key: `f${i}`, width: 100, height: 100 })) }],
    ['a duplicate frame key', { frames: [frames[0], frames[0]] }],
    ['a frame key with a path in it', { frames: [{ key: '../x', width: 100, height: 100 }] }],
    ['a frame wider than any screen', { frames: [{ key: 'x', width: 9000, height: 100 }] }],
    ['a frame of no size', { frames: [{ key: 'x', width: 0, height: 100 }] }],
    ['a fractional frame size', { frames: [{ key: 'x', width: 100.5, height: 100 }] }],
  ])('refuses %s', (_label, extra) => {
    expect(parseRenderJob({ ...rasterJob, ...extra })).toBeNull();
  });
});

describe('parseWorkerMessage — a frames result carries exactly the frames asked for', () => {
  const frames = [
    { key: 'landscape', width: 3840, height: 2160 },
    { key: 'portrait', width: 2160, height: 3840 },
  ];
  const caps: RasterResultCaps = { maxPages: 3, maxTotalOutputBytes: 4096, frames };
  const framed = (n: number, over: Record<string, unknown> = {}) => ({
    sourcePage: n,
    widthPx: 2160,
    heightPx: 2795,
    webpBase64: '',
    thumbWebpBase64: 'AAAA',
    frames: frames.map((f) => ({ key: f.key, widthPx: f.width, heightPx: f.height, webpBase64: 'AAAA' })),
    ...over,
  });
  const result = (pages: unknown[]) => ({
    v: RENDER_PROTOCOL_VERSION,
    type: 'raster-result',
    ok: true,
    sourcePageCount: 12,
    pages,
    warnings: [],
    truncated: true,
    elapsedMs: 9,
  });

  it('accepts a page carrying every requested frame, in order', () => {
    const parsed = parseWorkerMessage(result([framed(7), framed(8)]), 1, caps) as any;
    expect(parsed.pages.map((p: any) => p.sourcePage)).toEqual([7, 8]);
    expect(parsed.pages[0].frames.map((f: any) => f.key)).toEqual(['landscape', 'portrait']);
  });

  it.each([
    ['a missing frame', framed(1, { frames: [framed(1).frames[0]] })],
    ['frames in another order', framed(1, { frames: [...framed(1).frames].reverse() })],
    ['a frame of another size', framed(1, { frames: [{ ...framed(1).frames[0], widthPx: 3839 }, framed(1).frames[1]] })],
    ['an extra frame', framed(1, { frames: [...framed(1).frames, { key: 'x', widthPx: 16, heightPx: 16, webpBase64: 'AAAA' }] })],
    ['an empty frame image', framed(1, { frames: [{ ...framed(1).frames[0], webpBase64: '' }, framed(1).frames[1]] })],
    ['frame data that is not base64', framed(1, { frames: [{ ...framed(1).frames[0], webpBase64: '<svg>' }, framed(1).frames[1]] })],
    ['no frames at all', framed(1, { frames: undefined })],
  ])('REFUSES the whole result for %s', (_label, page) => {
    expect(parseWorkerMessage(result([page]), 1, caps)).toBeNull();
  });

  it('REFUSES frames the caller never asked for', () => {
    const { frames: _f, ...noFramesCaps } = caps;
    expect(parseWorkerMessage(result([framed(1)]), 1, noFramesCaps)).toBeNull();
  });

  it('counts frame bytes against the budget', () => {
    const fat = framed(1, { frames: frames.map((f) => ({ key: f.key, widthPx: f.width, heightPx: f.height, webpBase64: 'A'.repeat(4000) })) });
    expect(parseWorkerMessage(result([fat]), 1, caps)).toBeNull();
  });
});
