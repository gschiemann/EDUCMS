/**
 * Turn an uploaded PDF into one image per page.
 *
 * WHY THIS EXISTS. A 3-page PDF imports today as two white rectangles: the
 * parser reads text runs, so a page made of artwork has nothing to read and is
 * dropped without a word. Every competitor in this category rasterizes instead
 * — ScreenCloud, Appspace, NoviSign, Play and Rise Vision all say so in their
 * own support docs — and that is the floor we are missing. This service is the
 * floor: a faithful picture of every page, at the page's own aspect, with the
 * losses named rather than hidden.
 *
 * WHERE THE WORK RUNS. Not here. The API is `numReplicas: 1` and this process
 * publishes lockdown alerts; decoding a stranger's PDF in it is the same
 * mistake SEC-006 already fixed for Chromium. So this service decides WHETHER
 * to rasterize (availability, concurrency, bounds, a cheap format check) and a
 * forked, disposable, secret-free worker does the rasterizing —
 * `render-worker.ts`, the one that already exists, with a second job kind.
 * Nothing in this file launches a browser or decodes an image.
 *
 * WHAT CROSSES THE BOUNDARY. Not the upload: 50 MB through IPC twice over is a
 * cost with no benefit. The bytes are written to a file in a directory this
 * process created, the PATH is sent, and the directory is destroyed here
 * whatever happens. The worker unlinks the file itself the moment it has read
 * it, so the document is on disk for a read and not for a render.
 */
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_RASTERIZE_LIMITS,
  type RasterPipelineOutcome,
} from '../../proxy/pdf-raster-pipeline';
import {
  RenderWorkerClient,
  type RasterRangeRequest,
} from '../../proxy/render-worker-client';
import type { PipelineLogger } from '../../proxy/render-pipeline';
import type {
  RasterFrameSpec,
  RasterizeJobLimits,
} from '../../proxy/render-worker-protocol';

/** One rendered source page, ready to store. */
export interface RasterizedPage {
  /** 1-based page number in the SOURCE document — the number the operator sees. */
  sourcePage: number;
  widthPx: number;
  heightPx: number;
  webp: Buffer;
  thumbWebp: Buffer;
}

export type RasterizeResult =
  | {
      ok: true;
      /**
       * Pages in the SOURCE document. When this is larger than `pages.length`,
       * `truncated` is true and `warnings` says which bound stopped us — the
       * caller must never present a short result as a whole one.
       */
      sourcePageCount: number;
      pages: RasterizedPage[];
      warnings: string[];
      truncated: boolean;
      elapsedMs: number;
    }
  | { ok: false; reason: string };

/** Caller-tunable bounds. Anything omitted keeps the shipped default. */
export type RasterizeOptions = Partial<RasterizeJobLimits>;

/** One page composed into screen frames (`rasterizePdfFrames`). */
export interface FramedPage {
  /** 1-based page number in the SOURCE document. */
  sourcePage: number;
  /** The paint's size — the page's own shape, before it was framed. */
  widthPx: number;
  heightPx: number;
  thumbWebp: Buffer;
  /** In the order the frames were requested. */
  frames: Array<{ key: string; widthPx: number; heightPx: number; webp: Buffer }>;
}

export type RasterizeFramesResult =
  | {
      ok: true;
      sourcePageCount: number;
      pages: FramedPage[];
      warnings: string[];
      /** The document goes on past the last page returned. */
      truncated: boolean;
      elapsedMs: number;
    }
  | { ok: false; reason: string };

/**
 * A PDF may carry up to 1024 bytes of preamble before its header, and readers
 * tolerate it — so this is a scan, not a prefix test.
 */
const PDF_HEADER_SCAN_BYTES = 1024;

@Injectable()
export class PdfRasterService implements OnModuleDestroy {
  private readonly logger = new Logger('PdfRaster');
  private inFlight = 0;

  /**
   * ONE rasterize child at a time.
   *
   * Same reasoning as `RendererService.MAX_CONCURRENT`, with the same measured
   * numbers: a browser child costs the container ~200 MiB normally and is
   * allowed up to 1.5 GiB before the watchdog kills it. This service and the
   * SSR renderer hold separate clients, so the process can already have two
   * browser trees alive at once; that fits the 8 GB service limit, a third
   * would be pushing a bet rather than a budget. An over-cap request is
   * refused with a reason, not queued — a queue here would only move the
   * question from "how much memory" to "how long is the queue".
   */
  private readonly MAX_CONCURRENT = 1;

  /**
   * Who holds the one slot (2026-10-05). A design import is a person waiting
   * on a request; a PDF-pages range (`rasterizePdfFrames`) is background work
   * that retries by itself. So an import that finds a BACKGROUND range in the
   * slot waits for it (a range is a few pages — seconds) instead of being
   * refused, and takes the slot before the background loop's next range can.
   * Import against import is unchanged: refused, not queued.
   */
  private holder: 'import' | 'background' | null = null;
  private readonly releaseWaiters: Array<() => void> = [];
  /** How long an import waits for a background range to finish. */
  importWaitMs = 30_000;

  /** Take the slot synchronously — before any await, so two callers cannot both pass a check. */
  private claim(kind: 'import' | 'background'): boolean {
    if (this.inFlight >= this.MAX_CONCURRENT) return false;
    this.inFlight += 1;
    this.holder = kind;
    return true;
  }

  /** Free the slot and wake anyone waiting for it (synchronously, so a waiter claims first). */
  private release(): void {
    this.inFlight -= 1;
    this.holder = null;
    for (const wake of this.releaseWaiters.splice(0)) wake();
  }

  private waitForRelease(ms: number): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const wake = () => {
        clearTimeout(timer);
        resolve(true);
      };
      const timer = setTimeout(() => {
        const i = this.releaseWaiters.indexOf(wake);
        if (i >= 0) this.releaseWaiters.splice(i, 1);
        resolve(false);
      }, ms);
      timer.unref?.();
      this.releaseWaiters.push(wake);
    });
  }

  /**
   * The parent's SIGKILL deadline, above the worker's own budget so the normal
   * path is a reported reason and the signal is the backstop.
   */
  private readonly KILL_BUDGET_MS =
    DEFAULT_RASTERIZE_LIMITS.workerBudgetMs + 5_000;

  private readonly workerLogger: PipelineLogger = {
    log: (m) => this.logger.log(m),
    warn: (m) => this.logger.warn(m),
    error: (m) => this.logger.error(m),
  };

  private readonly worker = new RenderWorkerClient({
    killBudgetMs: this.KILL_BUDGET_MS,
    logger: this.workerLogger,
  });

  /** True when a compiled worker exists to fork. False in a Jest run. */
  isAvailable(): boolean {
    return this.worker.isAvailable();
  }

  /**
   * Rasterize a PDF into one WebP per page plus a thumbnail per page.
   *
   * Never throws. A refusal is a value carrying a stable reason, because the
   * import UI has to tell an operator which thing went wrong — "we could not
   * read that file" and "that file is bigger than we accept" are different
   * sentences and different next steps.
   */
  async rasterizePdf(
    bytes: Buffer,
    options: RasterizeOptions = {},
  ): Promise<RasterizeResult> {
    const limits: RasterizeJobLimits = {
      ...DEFAULT_RASTERIZE_LIMITS,
      ...options,
    };

    if (bytes.byteLength === 0) return { ok: false, reason: 'pdf-unreadable' };
    if (bytes.byteLength > limits.maxPdfBytes)
      return { ok: false, reason: 'pdf-too-large' };
    // A browser launch is the expensive part of a rasterize; something that is
    // not a PDF at all should not cost one. The worker re-checks everything,
    // so this is an early exit, not the control.
    if (!looksLikePdf(bytes)) return { ok: false, reason: 'pdf-unreadable' };

    if (!this.claim('import')) {
      // A background page range gives way: wait for it, then go first.
      const waited =
        this.holder === 'background' &&
        (await this.waitForRelease(this.importWaitMs)) &&
        this.claim('import');
      if (!waited) {
        this.logger.warn(
          `[raster] max concurrency hit (${this.inFlight}); refusing`,
        );
        return { ok: false, reason: 'raster-busy' };
      }
    }

    let scratchDir: string;
    try {
      scratchDir = await mkdtemp(join(tmpdir(), 'venueos-pdfin-'));
    } catch (e: any) {
      this.release();
      this.logger.warn(`[raster] could not create scratch dir: ${e?.message}`);
      return { ok: false, reason: 'scratch-dir-failed' };
    }
    // A random name, not the operator's filename: nothing an uploader chose
    // reaches a path this process opens.
    const pdfPath = join(scratchDir, `${randomBytes(16).toString('hex')}.pdf`);

    try {
      // 0o600 — the worker runs as the same user, and nothing else on the box
      // has any business reading a tenant's upload.
      await writeFile(pdfPath, bytes, { mode: 0o600 });
      const outcome = await this.executeRasterize(pdfPath, scratchDir, limits);
      if (!outcome.ok) {
        this.logger.warn(`[raster] refused: ${outcome.reason}`);
        return { ok: false, reason: outcome.reason };
      }
      if (outcome.truncated) {
        this.logger.log(
          `[raster] truncated: ${outcome.pages.length} of ${outcome.sourcePageCount} pages — ` +
            outcome.warnings.join('; '),
        );
      }
      return {
        ok: true,
        sourcePageCount: outcome.sourcePageCount,
        pages: outcome.pages.map((page) => ({
          sourcePage: page.sourcePage,
          widthPx: page.widthPx,
          heightPx: page.heightPx,
          webp: Buffer.from(page.webpBase64, 'base64'),
          thumbWebp: Buffer.from(page.thumbWebpBase64, 'base64'),
        })),
        warnings: outcome.warnings,
        truncated: outcome.truncated,
        elapsedMs: outcome.elapsedMs,
      };
    } catch (e: any) {
      this.logger.warn(`[raster] failed: ${e?.message}`);
      return { ok: false, reason: 'raster-failed' };
    } finally {
      this.release();
      // The worker unlinks the FILE as soon as it has read it, and removes the
      // directory on its way out — but that last step runs after it posts its
      // result and so races our own SIGKILL. This process owns the directory
      // precisely because that race exists: a leaked scratch dir per failed
      // import is a disk leak with a tenant's document in it.
      await rm(scratchDir, { recursive: true, force: true }).catch(
        () => undefined,
      );
    }
  }

  /**
   * Rasterize a RANGE of pages, each composed into the given screen frames
   * (2026-10-05, PDF pages on screens — `storage/pdf-pages`).
   *
   * Same gates as `rasterizePdf` — the size cap, the header sniff, ONE job per
   * process across both callers (`inFlight` is shared with the design import,
   * so a page render and an import never run two browsers at once), the
   * scratch directory this process owns — and the same never-throws contract.
   * What differs is the output: per page, one WebP per frame plus the
   * thumbnail, and no page-shaped full-size image. `maxPages` (in `options`)
   * is the size of THIS range; the caller walks a long document range by range.
   */
  async rasterizePdfFrames(
    bytes: Buffer,
    request: { firstPage: number; frames: RasterFrameSpec[] },
    options: RasterizeOptions = {},
  ): Promise<RasterizeFramesResult> {
    const limits: RasterizeJobLimits = {
      ...DEFAULT_RASTERIZE_LIMITS,
      ...options,
    };
    if (bytes.byteLength === 0) return { ok: false, reason: 'pdf-unreadable' };
    if (bytes.byteLength > limits.maxPdfBytes)
      return { ok: false, reason: 'pdf-too-large' };
    if (!looksLikePdf(bytes)) return { ok: false, reason: 'pdf-unreadable' };
    if (!request.frames.length) return { ok: false, reason: 'no-frames' };
    // Background work never waits here: the caller backs off and retries.
    if (!this.claim('background')) return { ok: false, reason: 'raster-busy' };

    let scratchDir: string;
    try {
      scratchDir = await mkdtemp(join(tmpdir(), 'venueos-pdfin-'));
    } catch (e: any) {
      this.release();
      this.logger.warn(`[raster] could not create scratch dir: ${e?.message}`);
      return { ok: false, reason: 'scratch-dir-failed' };
    }
    const pdfPath = join(scratchDir, `${randomBytes(16).toString('hex')}.pdf`);
    try {
      await writeFile(pdfPath, bytes, { mode: 0o600 });
      const outcome = await this.executeRasterize(pdfPath, scratchDir, limits, {
        firstPage: request.firstPage,
        frames: request.frames,
      });
      if (!outcome.ok) return { ok: false, reason: outcome.reason };
      const pages: FramedPage[] = [];
      for (const page of outcome.pages) {
        // `parseWorkerMessage` already refused a page without exactly the
        // requested frames; this re-states it for the in-process test seam.
        if (!page.frames || page.frames.length !== request.frames.length) {
          return { ok: false, reason: 'worker-frames-missing' };
        }
        pages.push({
          sourcePage: page.sourcePage,
          widthPx: page.widthPx,
          heightPx: page.heightPx,
          thumbWebp: Buffer.from(page.thumbWebpBase64, 'base64'),
          frames: page.frames.map((f) => ({
            key: f.key,
            widthPx: f.widthPx,
            heightPx: f.heightPx,
            webp: Buffer.from(f.webpBase64, 'base64'),
          })),
        });
      }
      return {
        ok: true,
        sourcePageCount: outcome.sourcePageCount,
        pages,
        warnings: outcome.warnings,
        truncated: outcome.truncated,
        elapsedMs: outcome.elapsedMs,
      };
    } catch (e: any) {
      this.logger.warn(`[raster] frames failed: ${e?.message}`);
      return { ok: false, reason: 'raster-failed' };
    } finally {
      this.release();
      await rm(scratchDir, { recursive: true, force: true }).catch(
        () => undefined,
      );
    }
  }

  /**
   * The seam between "decide whether to rasterize" (this service) and "drive a
   * browser" (a separate process).
   *
   * Overridden in `pdf-raster.service.spec.ts` to run the SAME shipped
   * pipeline in-process against a real Chromium, because a Jest run has no
   * compiled `render-worker.js` to fork — the pattern `renderer.ssrf.spec.ts`
   * already uses for the URL render path.
   */
  protected async executeRasterize(
    pdfPath: string,
    scratchDir: string,
    limits: RasterizeJobLimits,
    request: RasterRangeRequest = {},
  ): Promise<RasterPipelineOutcome> {
    return this.worker.rasterizePdf(pdfPath, scratchDir, limits, request);
  }

  async onModuleDestroy() {
    this.worker.shutdown();
  }
}

/** Does this look like a PDF at all? Cheap, and deliberately not a parser. */
export function looksLikePdf(bytes: Buffer): boolean {
  return bytes.subarray(0, PDF_HEADER_SCAN_BYTES).includes('%PDF-');
}
