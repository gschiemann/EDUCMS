/**
 * Rasterize a PDF, one image per page, inside the SEC-006 disposable browser.
 *
 * This is the sibling of `render-pipeline.ts`: same disposable Chromium, same
 * forked process, same allowlisted environment — a different job. Where that
 * file points a browser at a hostile URL, this one points it at hostile BYTES,
 * and the threat model is the same one that moved Chromium out of the API
 * process in the first place: whatever a malformed PDF can do to a renderer,
 * it does it somewhere that holds no database handle, no Redis connection and
 * no signing key, and whose death costs one import.
 *
 * ── WHY A BROWSER AT ALL ─────────────────────────────────────────────────
 * pdf.js needs a real 2D canvas to paint into, and Node has none. The
 * alternatives were a native canvas binding (a new dependency, a new build
 * surface on Alpine, and a decode of attacker bytes IN the API process) or an
 * external converter (Ghostscript and MuPDF are AGPL-3.0; see the LEAD-PLAN's
 * deferred list). Chromium is already in the image, already forked per job,
 * already bounded. This adds no dependency at all.
 *
 * ── THE NO-NETWORK GUARANTEE, THREE TIMES OVER ───────────────────────────
 *   1. The page is a `data:` document. There is no navigation to a URL, so
 *      there is no origin to be talked into fetching anything.
 *   2. pdf.js's code arrives as blob URLs built from strings this process read
 *      off its own disk. Nothing is fetched to get the renderer running.
 *   3. Request interception fulfils the ONLY thing pdf.js legitimately asks
 *      for — base-font and CMap data — from the installed `pdfjs-dist`
 *      package, and aborts everything else. Chromium is additionally launched
 *      with `--host-resolver-rules=MAP * ~NOTFOUND`, so a request that somehow
 *      escaped interception would fail to resolve rather than leave the box.
 *
 * A consequence worth naming: a `data:` document has an OPAQUE origin, and
 * Chromium will not start a Worker from one. pdf.js falls back to running its
 * worker module on the page's main thread (it logs "Setting up fake worker"),
 * importing it from the blob URL we supplied — so the injected worker source
 * is genuinely load-bearing, not decorative: hand it a broken blob and the
 * document fails to open. The fallback costs nothing here because the page has
 * nothing else to keep responsive, and the whole job is under a wall clock.
 */
import { readFile, stat, unlink } from 'node:fs/promises';
import type { Browser, HTTPRequest, Page, LaunchOptions } from 'puppeteer-core';
import sharp from 'sharp';
import {
  buildChromiumLaunchArgs,
  type BrowserLauncher,
  type PipelineLogger,
} from './render-pipeline';
import {
  loadPdfjsAssets,
  resolvePdfjsAsset,
  type PdfjsAssets,
} from './pdfjs-assets';
import type {
  RasterizeJobLimits,
  RasterizedPageMessage,
} from './render-worker-protocol';

/**
 * The origin pdf.js is told to fetch font data from.
 *
 * `.invalid` is reserved by RFC 2606 and can never resolve, so even the shape
 * of the string says "this is not a host". Every request to it is answered by
 * the interceptor from the local `pdfjs-dist` install; nothing reaches DNS.
 */
const ASSET_ORIGIN = 'https://pdfjs-assets.invalid/';

/** A blank document. The page's only job is to host pdf.js and a canvas. */
const BLANK_DOCUMENT =
  'data:text/html,%3C!doctype%20html%3E%3Cmeta%20charset%3D%22utf-8%22%3E%3Cbody%3E%3C%2Fbody%3E';

/**
 * Default bounds.
 *
 * Every number here is a ceiling on what ONE upload may cost the container,
 * and each has a reason rather than a round-number feel:
 *
 *   • `maxPages` 60 — above the 41-page fixture and above Appspace's 30-page
 *     cap, and cheap: the measured cost of the 41-page fixture end to end
 *     (open, paint, read back) was 856 ms in the shipped shape.
 *   • `maxPagePixels` 3840×2160 — the largest panel the fleet drives. A page
 *     rendered bigger is memory spent on pixels no screen will show, and at
 *     4 bytes per pixel it is also the real memory bound on one page.
 *   • `maxScale` 8 — an independent cap for the case `maxPagePixels` does not
 *     catch: a tiny source page blown up enormously. The tighter of the two
 *     always wins, so this is belt to the pixel cap's braces.
 *   • `maxPdfBytes` 50 MB — the upload cap the import route already enforces
 *     (`imports.controller.ts`). Stated again here so the worker refuses on
 *     its own rather than inheriting a caller's discipline.
 *   • `maxTotalOutputBytes` 32 MB — the whole result crosses IPC as base64,
 *     so this is really a cap on what the API process must hold at once. 60
 *     pages of 1920-px WebP measured well under it; a document that exceeds it
 *     truncates and says so.
 *   • `targetLongEdgePx` 1920 — the player's canvas. A preserve-appearance
 *     page is shown full-bleed on a screen, and 1920 is where that lands
 *     without paying 4× the bytes for a 4K panel's extra sharpness on what is
 *     usually flat vector artwork.
 *   • `workerBudgetMs` 45 s — ~50× the measured cost of the largest fixture,
 *     which leaves room for a genuinely heavy scanned document while still
 *     bounding how long one import can hold a worker slot. The parent's
 *     SIGKILL sits above it, as it does for renders.
 */
export const DEFAULT_RASTERIZE_LIMITS: RasterizeJobLimits = {
  maxPages: 60,
  maxPagePixels: 3840 * 2160,
  maxScale: 8,
  maxPdfBytes: 50 * 1024 * 1024,
  maxTotalOutputBytes: 32 * 1024 * 1024,
  targetLongEdgePx: 1920,
  thumbLongEdgePx: 480,
  webpQuality: 82,
  workerBudgetMs: 45_000,
  pageRenderTimeoutMs: 20_000,
};

/**
 * Why a rasterize job produced nothing.
 *
 * A closed set, and a stable one: these strings reach the operator through the
 * import UI, so "we could not read that file" and "that file was bigger than
 * we accept" must stay distinguishable. Note what is NOT here — a partial
 * result. Bounds that limit HOW MUCH of a document we do (`maxPages`,
 * `maxTotalOutputBytes`) truncate and announce it in `truncated`; bounds that
 * mean the job cannot be done at all fail with one of these.
 */
export type RasterFailureReason =
  | 'pdf-too-large'
  | 'pdf-unreadable'
  | 'pdf-empty'
  | 'pdf-password-protected'
  | 'pdfjs-unavailable'
  | 'browser-launch-failed'
  | 'browser-disconnected'
  | 'page-render-failed'
  | 'encode-failed'
  | 'raster-budget-exceeded';

export type RasterPipelineOutcome =
  | {
      ok: true;
      /** Pages in the SOURCE document, whether or not all were rastered. */
      sourcePageCount: number;
      pages: RasterizedPageMessage[];
      warnings: string[];
      truncated: boolean;
      elapsedMs: number;
    }
  | { ok: false; reason: RasterFailureReason | string };

export interface RasterPipelineInput {
  launcher: BrowserLauncher;
  /** Absolute path to the PDF. Read here, never sent over IPC. */
  pdfPath: string;
  executablePath: string;
  /** Throwaway Chromium profile directory, owned by the parent process. */
  userDataDir?: string;
  limits: RasterizeJobLimits;
  logger: PipelineLogger;
  onBrowserLaunched?: (pid: number) => void;
}

/** Race `work` against a hard deadline, without holding the event loop open. */
async function withDeadline<T>(
  work: Promise<T>,
  ms: number,
  reason: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(reason)), ms);
        if (typeof timer.unref === 'function') timer.unref();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Chromium flags for a job that must not reach the network.
 *
 * Built on top of the render pipeline's flags rather than beside them, so a
 * future hardening of those (or a future removal of `--no-sandbox`, if the
 * container ever gets its namespaces) applies to both job kinds at once.
 */
export function buildRasterLaunchArgs(userDataDir?: string): string[] {
  return [
    ...buildChromiumLaunchArgs(userDataDir),
    // Request interception already fulfils or aborts everything before the
    // network stack sees it. This is the answer to "what if it did not":
    // no name resolves, so nothing can be reached even by accident.
    '--host-resolver-rules=MAP * ~NOTFOUND',
    '--no-proxy-server',
  ];
}

/** How the page reports one rendered page back over CDP. */
interface PagePaintResult {
  /** Natural page size in CSS px at scale 1, for the aspect assertion. */
  naturalWidth: number;
  naturalHeight: number;
  widthPx: number;
  heightPx: number;
  /** Lossless PNG. sharp owns the lossy step, so the quality knob is in Node. */
  pngBase64: string;
}

/**
 * Rasterize every page of one PDF, or refuse.
 *
 * Never throws for a document problem — a refusal is a value, because the
 * caller has to be able to tell an operator WHICH thing went wrong.
 */
export async function runPdfRasterPipeline(
  input: RasterPipelineInput,
): Promise<RasterPipelineOutcome> {
  const {
    launcher,
    pdfPath,
    executablePath,
    userDataDir,
    limits,
    logger,
    onBrowserLaunched,
  } = input;
  const start = Date.now();
  // Under the child's own `workerBudgetMs` so a job that runs long reports
  // `raster-budget-exceeded` instead of being shot anonymously by the parent.
  const deadlineAt = start + Math.max(1_000, limits.workerBudgetMs - 2_000);
  const warnings: string[] = [];

  // ── THE INPUT, BOUNDED BEFORE IT IS READ ───────────────────────────────
  // `stat` first: a 2 GB file must not become a 2 GB Buffer to discover it is
  // too big. The route caps uploads too; a worker that trusts that is a worker
  // whose bound moves whenever a caller changes.
  let pdfBytes: Buffer;
  try {
    const info = await stat(pdfPath);
    if (!info.isFile()) return { ok: false, reason: 'pdf-unreadable' };
    if (info.size > limits.maxPdfBytes)
      return { ok: false, reason: 'pdf-too-large' };
    if (info.size === 0) return { ok: false, reason: 'pdf-unreadable' };
    pdfBytes = await readFile(pdfPath);
  } catch (e: any) {
    logger.warn(`[raster] could not read input: ${e?.message}`);
    return { ok: false, reason: 'pdf-unreadable' };
  }
  // The file has been read; nothing below reopens it. Unlinking HERE rather
  // than in the worker's exit path is what actually keeps a tenant's document
  // off disk — the worker's cleanup runs after it posts the result, which
  // races the parent's SIGKILL and was measured losing that race.
  await unlink(pdfPath).catch(() => undefined);

  let assets: PdfjsAssets;
  try {
    assets = loadPdfjsAssets();
  } catch (e: any) {
    logger.error(
      `[raster] pdfjs-dist is not loadable in this build: ${e?.message}`,
    );
    return { ok: false, reason: 'pdfjs-unavailable' };
  }

  let browser: Browser | null = null;
  let page: Page | null = null;
  try {
    const options: LaunchOptions = {
      headless: true,
      executablePath,
      args: buildRasterLaunchArgs(userDataDir),
    };
    browser = await launcher.launch(options);
  } catch (e: any) {
    logger.error(`[raster] browser launch failed: ${e?.message}`);
    return { ok: false, reason: 'browser-launch-failed' };
  }

  try {
    const browserPid = browser.process?.()?.pid;
    if (typeof browserPid === 'number' && onBrowserLaunched)
      onBrowserLaunched(browserPid);
  } catch {
    /* a launcher without a real child process */
  }

  // A dead browser must cost ONE job, not the whole budget — the lesson
  // `render-pipeline.ts` learned from an in-container proof: SIGKILLing
  // Chromium mid-render does not reject the awaits, it just never settles them.
  let closingOnPurpose = false;
  let signalDisconnect: ((e: Error) => void) | null = null;
  const disconnected = new Promise<never>((_, reject) => {
    signalDisconnect = reject;
  });
  disconnected.catch(() => {
    /* observed at each race site */
  });
  const raceDisconnect = <T>(work: Promise<T>): Promise<T> =>
    Promise.race([work, disconnected]);
  try {
    (browser as unknown as { on?: (e: string, f: () => void) => void }).on?.(
      'disconnected',
      () => {
        if (closingOnPurpose) return;
        signalDisconnect?.(new Error('browser-disconnected'));
      },
    );
  } catch {
    /* a launcher without an event emitter */
  }

  try {
    page = await raceDisconnect(browser.newPage());
    await page.setRequestInterception(true);
    page.on('request', (request: HTTPRequest) => {
      void serveAsset(request, assets.packageRoot, warnings, logger);
    });
    page.on('pageerror', (e: Error) => {
      warnings.push(`page-error: ${String(e?.message ?? e).slice(0, 160)}`);
    });
    await raceDisconnect(page.goto(BLANK_DOCUMENT));

    // ── OPEN THE DOCUMENT ────────────────────────────────────────────────
    const opened = await raceDisconnect(
      withDeadline(
        page.evaluate(openDocumentInPage, {
          moduleSource: assets.moduleSource,
          workerSource: assets.workerSource,
          assetOrigin: ASSET_ORIGIN,
          pdfBase64: pdfBytes.toString('base64'),
        }),
        Math.max(1_000, deadlineAt - Date.now()),
        'raster-budget-exceeded',
      ),
    );
    if (opened.error) {
      logger.warn(`[raster] pdf refused to open: ${opened.error}`);
      return { ok: false, reason: classifyOpenError(opened.error) };
    }
    const sourcePageCount = opened.numPages ?? 0;
    if (sourcePageCount < 1) return { ok: false, reason: 'pdf-empty' };

    // ── BOUND 1: HOW MANY PAGES ──────────────────────────────────────────
    // Truncation is a RESULT, not a failure: an operator with a 200-page
    // catalogue gets the first 60 and a sentence saying so, which is strictly
    // better than a refusal and incomparably better than the silent drop this
    // replaces.
    let truncated = false;
    let pageBudget = sourcePageCount;
    if (sourcePageCount > limits.maxPages) {
      pageBudget = limits.maxPages;
      truncated = true;
      warnings.push(
        `page-cap: rendered ${limits.maxPages} of ${sourcePageCount} pages (limit ${limits.maxPages})`,
      );
    }

    const pages: RasterizedPageMessage[] = [];
    let totalBytes = 0;

    for (let n = 1; n <= pageBudget; n += 1) {
      if (Date.now() >= deadlineAt) {
        // Out of clock with pages already encoded. Those pages are real, so
        // they are returned — flagged, counted and explained.
        truncated = true;
        warnings.push(
          `time-cap: stopped after ${pages.length} of ${sourcePageCount} pages (budget ${limits.workerBudgetMs} ms)`,
        );
        break;
      }
      let painted: PagePaintResult;
      try {
        painted = await raceDisconnect(
          withDeadline(
            page.evaluate(paintPageInPage, {
              pageNumber: n,
              targetLongEdgePx: limits.targetLongEdgePx,
              maxPagePixels: limits.maxPagePixels,
              maxScale: limits.maxScale,
            }),
            Math.min(
              limits.pageRenderTimeoutMs,
              Math.max(1_000, deadlineAt - Date.now()),
            ),
            'page-render-timeout',
          ),
        );
      } catch (e: any) {
        const message = String(e?.message ?? e);
        if (message.includes('browser-disconnected'))
          return { ok: false, reason: 'browser-disconnected' };
        if (message.includes('raster-budget-exceeded'))
          return { ok: false, reason: 'raster-budget-exceeded' };
        logger.warn(`[raster] page ${n} failed: ${message.slice(0, 160)}`);
        // A page we cannot paint is a HARD failure, not a page we quietly skip.
        // Skipping is precisely the behaviour this job kind was built to end,
        // and the caller cannot honestly say "here is your deck" with a hole
        // in it. If a tolerant mode is ever wanted it has to be asked for.
        return { ok: false, reason: 'page-render-failed' };
      }

      let encoded: { webp: Buffer; thumb: Buffer };
      try {
        encoded = await encodePage(
          Buffer.from(painted.pngBase64, 'base64'),
          limits,
        );
      } catch (e: any) {
        logger.warn(
          `[raster] page ${n} encode failed: ${String(e?.message ?? e).slice(0, 160)}`,
        );
        return { ok: false, reason: 'encode-failed' };
      }

      // ── BOUND 2: HOW MANY BYTES GO BACK ────────────────────────────────
      // Checked BEFORE the page joins the result, so the returned set always
      // fits the budget the parent will re-check. Same truncation contract as
      // the page cap: stop, flag, explain.
      const pageBytes = encoded.webp.byteLength + encoded.thumb.byteLength;
      if (totalBytes + pageBytes > limits.maxTotalOutputBytes) {
        truncated = true;
        warnings.push(
          `size-cap: stopped after ${pages.length} of ${sourcePageCount} pages ` +
            `(limit ${Math.round(limits.maxTotalOutputBytes / 1048576)} MB of images)`,
        );
        break;
      }
      totalBytes += pageBytes;
      pages.push({
        sourcePageNumber: n,
        widthPx: painted.widthPx,
        heightPx: painted.heightPx,
        webpBase64: encoded.webp.toString('base64'),
        thumbWebpBase64: encoded.thumb.toString('base64'),
      });
    }

    if (pages.length === 0) {
      // Nothing encoded and no page-level failure means the very first page
      // did not fit a bound. That is not a success with zero pages.
      return { ok: false, reason: 'raster-budget-exceeded' };
    }

    return {
      ok: true,
      sourcePageCount,
      pages,
      warnings,
      truncated,
      elapsedMs: Date.now() - start,
    };
  } catch (e: any) {
    const message = String(e?.message ?? e);
    if (message.includes('browser-disconnected'))
      return { ok: false, reason: 'browser-disconnected' };
    if (message.includes('raster-budget-exceeded'))
      return { ok: false, reason: 'raster-budget-exceeded' };
    logger.warn(`[raster] failed: ${message.slice(0, 200)}`);
    return { ok: false, reason: 'pdf-unreadable' };
  } finally {
    closingOnPurpose = true;
    try {
      if (page) await page.close();
    } catch {
      /* the browser is going away anyway */
    }
    try {
      if (browser) await browser.close();
    } catch {
      /* the parent kills the process group regardless */
    }
  }
}

/**
 * Answer one request from the render page.
 *
 * Three outcomes and no fourth: continue a `data:`/`blob:` URL (the document
 * and pdf.js's own code), fulfil a font/CMap request from the installed
 * package, or abort. The CORS header is needed because a `data:` document has
 * an opaque origin, so even a locally-fulfilled cross-scheme fetch is a CORS
 * request; `*` is the correct value for a non-credentialed read of a file we
 * are handing to ourselves.
 */
async function serveAsset(
  request: HTTPRequest,
  packageRoot: string,
  warnings: string[],
  logger: PipelineLogger,
): Promise<void> {
  const url = request.url();
  try {
    if (url.startsWith('data:') || url.startsWith('blob:')) {
      await request.continue();
      return;
    }
    if (url.startsWith(ASSET_ORIGIN)) {
      const relative = url.slice(ASSET_ORIGIN.length).split('?')[0];
      const filePath = resolvePdfjsAsset(packageRoot, relative);
      if (!filePath) {
        warnings.push(`asset-refused: ${relative.slice(0, 80)}`);
        await request.abort();
        return;
      }
      const body = await readFile(filePath);
      await request.respond({
        status: 200,
        contentType: 'application/octet-stream',
        headers: { 'access-control-allow-origin': '*' },
        body,
      });
      return;
    }
    // Nothing else is legitimate. A PDF that tries (an embedded link, a
    // remote XObject, a JavaScript action) is told no, and the attempt is
    // reported rather than swallowed.
    warnings.push(`network-blocked: ${url.slice(0, 80)}`);
    logger.warn(`[raster] blocked a non-local request: ${url.slice(0, 120)}`);
    await request.abort();
  } catch {
    /* the request was already handled, or the page is gone */
  }
}

/** Turn pdf.js's message into one of our stable reasons. */
function classifyOpenError(message: string): RasterFailureReason {
  const lower = message.toLowerCase();
  if (lower.includes('password')) return 'pdf-password-protected';
  return 'pdf-unreadable';
}

/** Full-size WebP plus a thumbnail, both encoded in this process. */
async function encodePage(
  png: Buffer,
  limits: RasterizeJobLimits,
): Promise<{ webp: Buffer; thumb: Buffer }> {
  const webp = await sharp(png)
    .webp({ quality: limits.webpQuality })
    .toBuffer();
  const thumb = await sharp(png)
    .resize({
      width: limits.thumbLongEdgePx,
      height: limits.thumbLongEdgePx,
      // `inside` keeps the source aspect exactly, which is the whole point of
      // the thumbnail: a review grid that crops is a review grid that lies.
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality: Math.min(limits.webpQuality, 70) })
    .toBuffer();
  return { webp, thumb };
}

/* ────────────────────────────────────────────────────────────────────────
 * The two functions below run INSIDE the page, not in Node. They are passed
 * to `page.evaluate`, serialised to source, and evaluated in the browser —
 * so they may not close over anything from this module, and `globalThis` is
 * the page's. Everything they need arrives as one JSON argument.
 * ──────────────────────────────────────────────────────────────────────── */

interface OpenDocumentArgs {
  moduleSource: string;
  workerSource: string;
  assetOrigin: string;
  pdfBase64: string;
}

/**
 * Load pdf.js from injected blobs and open the document.
 *
 * `isEvalSupported: false` is not optional: pdf.js otherwise compiles some
 * font programs and colour-space functions with `Function()`, which is the one
 * thing a process that just accepted a stranger's file should not do.
 */
function openDocumentInPage(
  args: OpenDocumentArgs,
): Promise<{ numPages?: number; error?: string }> {
  const scope = globalThis as unknown as Record<string, unknown>;
  const toModuleUrl = (source: string) =>
    URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  return (async () => {
    try {
      const pdfjs: any = await import(
        /* webpackIgnore: true */ toModuleUrl(args.moduleSource)
      );
      pdfjs.GlobalWorkerOptions.workerSrc = toModuleUrl(args.workerSource);
      const binary = atob(args.pdfBase64);
      const data = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) data[i] = binary.charCodeAt(i);
      const doc = await pdfjs.getDocument({
        data,
        isEvalSupported: false,
        // The container has no system fonts worth using and looking for them
        // is a filesystem probe we do not need; the packaged standard fonts
        // served through the interceptor are the supported path.
        useSystemFonts: false,
        standardFontDataUrl: args.assetOrigin + 'standard_fonts/',
        cMapUrl: args.assetOrigin + 'cmaps/',
        cMapPacked: true,
      }).promise;
      scope.__venueosPdfDoc = doc;
      return { numPages: doc.numPages as number };
    } catch (e: any) {
      return { error: String(e?.message ?? e).slice(0, 300) };
    }
  })();
}

interface PaintPageArgs {
  pageNumber: number;
  targetLongEdgePx: number;
  maxPagePixels: number;
  maxScale: number;
}

/**
 * Paint ONE page and hand back its PNG.
 *
 * One page at a time, and the canvas is released before returning. Painting
 * the whole document first and returning an array — which is what the proof of
 * concept did — holds every page's bitmap in the renderer at once; at the
 * pixel cap that is 33 MB per page, so a 60-page document would be asking the
 * renderer for two gigabytes before Node saw a single byte.
 */
function paintPageInPage(args: PaintPageArgs): Promise<PagePaintResult> {
  const scope = globalThis as unknown as Record<string, any>;
  return (async () => {
    const doc = scope.__venueosPdfDoc;
    const pdfPage = await doc.getPage(args.pageNumber);
    const natural = pdfPage.getViewport({ scale: 1 });
    const longEdge = Math.max(natural.width, natural.height) || 1;

    // Aspect is preserved by construction: one scale factor, both axes.
    let scale = args.targetLongEdgePx / longEdge;
    scale = Math.min(scale, args.maxScale);
    const pixelsAtScale = natural.width * scale * (natural.height * scale);
    if (pixelsAtScale > args.maxPagePixels) {
      scale *= Math.sqrt(args.maxPagePixels / pixelsAtScale);
    }
    // A page still has to be at least one pixel on each side.
    scale = Math.max(scale, 1 / longEdge);

    let viewport = pdfPage.getViewport({ scale });
    let width = Math.max(1, Math.round(viewport.width));
    let height = Math.max(1, Math.round(viewport.height));
    // Rounding a clamped page can put it back OVER its pixel budget — 462×260
    // against a 120,000 cap, measured. A budget that is almost enforced is not
    // enforced, so the rounded size is corrected down and the viewport is
    // re-derived from it so the paint and the canvas still agree.
    if (width * height > args.maxPagePixels) {
      const shrink = Math.sqrt(args.maxPagePixels / (width * height));
      width = Math.max(1, Math.floor(width * shrink));
      height = Math.max(1, Math.floor(height * shrink));
      viewport = pdfPage.getViewport({ scale: width / natural.width });
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no-2d-context');
    // PDF pages have no background of their own; without this a page whose
    // artwork does not cover the sheet encodes with transparent areas that
    // land black on a player.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    await pdfPage.render({ canvasContext: ctx, viewport }).promise;
    const pngBase64 = canvas.toDataURL('image/png').split(',')[1] ?? '';
    pdfPage.cleanup();
    canvas.width = 0;
    canvas.height = 0;
    return {
      naturalWidth: natural.width as number,
      naturalHeight: natural.height as number,
      widthPx: width,
      heightPx: height,
      pngBase64,
    };
  })();
}
