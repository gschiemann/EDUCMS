/**
 * PDF pages on screens (2026-10-05, media beta test M2-02 / L3).
 *
 * A PDF in a playlist used to reach a screen as the PDF, drawn in an
 * `<iframe>` — the desktop browser's viewer on Chrome (toolbar, download and
 * print buttons, page 1 only) and NOTHING on our Android players, whose System
 * WebView has no PDF viewer. This service renders every page ONCE, after the
 * upload has answered, into screen-shaped pictures (see `@cms/api-types`
 * `pdf-pages.ts` for the record and why the pages are framed), stores them
 * beside the PDF, and writes the facts to `processingMeta.pdfPages`. The
 * normal manifest then hands screens one picture per page; the player needs no
 * PDF support at all.
 *
 * THE RENDERER is the one Design imports already ship: pdf.js inside the
 * disposable SEC-006 Chromium child (`PdfRasterService`) — forked per job, no
 * network, a cgroup memory watchdog, a SIGKILL budget, and ONE job per process
 * shared with the import (so a page render and an import never run two
 * browsers at once). Nothing here decodes a PDF in the API process.
 *
 * BOUNDED, because this process also delivers lockdown alerts:
 *   • one document at a time per process (a FIFO); a range of
 *     `PDF_PAGES_PER_JOB` pages (default 6) per Chromium job, so no child ever
 *     holds a whole document's images, progress can be written as it goes, and
 *     a design import waiting for the browser slot never waits long;
 *   • at most `PDF_PAGES_MAX` pages (default 60); the rest are not made and the
 *     record says so (`truncatedAt`) — the library shows "first 60 of 214";
 *   • a job refused because the one browser slot is busy (an import) waits and
 *     retries; a document whose pages cannot be made is stamped `failed` with a
 *     stable reason and never retried by itself.
 *
 * CRASH / DEPLOY SAFE. Every range writes the record (`updatedAt`), so a
 * rendering that is alive is never more than one range old. The leader-leased
 * sweep (`sweepTick`) resumes a `pending` record no one has touched for
 * `STALE_MS` — a container that died mid-document — from the start, under a
 * fresh folder; three interrupted attempts end as `failed`.
 *
 * WRITES go through `prisma.client` (never raw SQL) so the manifest hot cache's
 * mutation hook sees them: the moment the pages are written, every screen's
 * next poll rebuilds and picks them up, with no publish.
 *
 * `PDF_PAGES_DISABLED=1` turns the whole feature off: a new PDF then gets no
 * record and is delivered exactly as before (the PDF itself).
 */
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { Prisma } from '@cms/database';
import { createHash, randomUUID } from 'crypto';
import {
  PDF_PAGE_FRAMES,
  PDF_PAGE_MIME,
  PDF_PAGES_DEFAULT_CAP,
  PDF_PAGES_VERSION,
  isPdfAsset,
  pdfPageFileName,
  readPdfPages,
  type PdfFrameKey,
  type PdfPageJson,
  type PdfPagesJson,
} from '@cms/api-types';
import { PrismaService } from '../../prisma/prisma.service';
import {
  LEASE,
  LeaderLeaseService,
  leadThisTick,
} from '../../realtime/leader-lease.service';
import { PdfRasterService } from '../../imports/raster/pdf-raster.service';
import { SupabaseStorageService } from '../supabase-storage.service';

/** Audit actions this service writes. */
export const PDF_PAGES_RENDERED = 'PDF_PAGES_RENDERED';
export const PDF_PAGES_FAILED = 'PDF_PAGES_FAILED';

/** What one `render` call did. */
export type PdfRenderOutcome =
  | { status: 'ready'; pages: number; count: number }
  | { status: 'failed'; reason: string }
  | { status: 'skipped'; reason: string }
  | { status: 'interrupted' };

interface PdfAssetRow {
  id: string;
  tenantId: string;
  fileUrl: string;
  mimeType: string;
  processingMeta: unknown;
}

const ASSET_SELECT = {
  id: true,
  tenantId: true,
  fileUrl: true,
  mimeType: true,
  processingMeta: true,
} as const;

/** Reasons that mean the file itself cannot be shown — retrying cannot help. */
const FINAL_REASONS = new Set([
  'pdf-password-protected',
  'pdf-unreadable',
  'pdf-empty',
  'pdf-too-large',
  'page-render-failed',
  'encode-failed',
  'raster-budget-exceeded',
  'page-out-of-range',
]);

@Injectable()
export class PdfPagesService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('PdfPages');
  private readonly queue: Array<{ assetId: string; tenantId: string }> = [];
  private draining: Promise<void> | null = null;
  private stopped = false;
  private sweepTimer: ReturnType<typeof setInterval> | null = null;
  private sweeping = false;

  /** Pages made per document before the rest are listed as not shown. */
  pageCap = intEnv('PDF_PAGES_MAX', PDF_PAGES_DEFAULT_CAP);
  /** Pages per Chromium job. */
  pagesPerJob = intEnv('PDF_PAGES_PER_JOB', 6);
  /** WebP quality of every frame — the image optimizer's own default (MEDIA_IMAGE_WEBP_QUALITY). */
  webpQuality = intEnv('MEDIA_IMAGE_WEBP_QUALITY', 82);
  /** Wait between tries while the one browser slot is busy, and how many tries. */
  busyRetryMs = 5_000;
  busyRetries = 36;
  /** A pending record nobody has written for this long is an interrupted rendering. */
  static readonly STALE_MS = 3 * 60_000;
  /** Interrupted attempts before a document is stamped failed. */
  static readonly MAX_ATTEMPTS = 3;
  static readonly SWEEP_INTERVAL_MS = 60_000;
  static readonly SWEEP_BATCH = 3;
  /** PDFs from before pages existed, adopted per sweep tick (only while nothing else is busy). */
  static readonly LEGACY_BATCH = 2;

  /** `PDF_PAGES_LEGACY_SWEEP_DISABLED=1` leaves PDFs from before pages exactly as they are. */
  static legacySweepDisabled(): boolean {
    return process.env.PDF_PAGES_LEGACY_SWEEP_DISABLED === '1';
  }
  /** Test seams. */
  now: () => number = () => Date.now();
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms));

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: SupabaseStorageService,
    private readonly raster: PdfRasterService,
    @Optional() private readonly lease?: LeaderLeaseService,
  ) {}

  static disabled(): boolean {
    return process.env.PDF_PAGES_DISABLED === '1';
  }

  /** Will this process make pages for a PDF uploaded now? */
  enabled(): boolean {
    return !PdfPagesService.disabled() && this.raster.isAvailable();
  }

  /**
   * The record a new PDF is CREATED with, so the row never exists without it:
   * pending (left out of manifests until its pages exist). Null when no pages
   * will be made here — the PDF is then delivered exactly as before.
   */
  pendingRecord(): PdfPagesJson | null {
    if (!this.enabled()) return null;
    return {
      version: PDF_PAGES_VERSION,
      state: 'pending',
      updatedAt: new Date(this.now()).toISOString(),
    };
  }

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test') return;
    if (PdfPagesService.disabled()) {
      this.logger.warn('PDF pages disabled (PDF_PAGES_DISABLED=1) — PDFs reach screens as the PDF itself');
      return;
    }
    // Boot delay with jitter: after the pool is warm, and replicas out of phase.
    const first = setTimeout(
      () => void this.sweepTick().catch((e) => this.logger.warn(`sweep failed: ${(e as Error).message}`)),
      60_000 + Math.floor(Math.random() * 30_000),
    );
    first.unref?.();
    this.sweepTimer = setInterval(
      () => void this.sweepTick().catch((e) => this.logger.warn(`sweep failed: ${(e as Error).message}`)),
      PdfPagesService.SWEEP_INTERVAL_MS,
    );
    this.sweepTimer.unref?.();
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.sweepTimer) clearInterval(this.sweepTimer);
  }

  /**
   * Make this asset's pages after the caller has answered. Fire-and-forget,
   * never throws; one document at a time per process, in arrival order.
   */
  kickOff(assetId: string, tenantId: string): void {
    if (!this.enabled() || this.stopped) return;
    if (this.queue.some((q) => q.assetId === assetId)) return;
    this.queue.push({ assetId, tenantId });
    if (!this.draining) {
      this.draining = this.drain().finally(() => {
        this.draining = null;
      });
    }
  }

  /** Resolves when everything queued so far has been handled (tests). */
  async idle(): Promise<void> {
    while (this.draining) await this.draining;
  }

  private async drain(): Promise<void> {
    while (!this.stopped && this.queue.length) {
      const next = this.queue.shift()!;
      try {
        const out = await this.render(next.assetId, next.tenantId);
        if (out.status === 'failed') this.logger.warn(`[pdf-pages] ${next.assetId}: ${out.reason}`);
      } catch (e) {
        // `render` never throws by design; this is the belt to those braces.
        this.logger.warn(`[pdf-pages] ${next.assetId} threw: ${(e as Error).message}`);
      }
    }
  }

  /**
   * Make (or adopt) the pages of ONE pending PDF. Public for the sweep and the
   * specs; never throws.
   */
  async render(assetId: string, tenantId: string): Promise<PdfRenderOutcome> {
    let asset: PdfAssetRow | null;
    try {
      asset = await this.prisma.client.asset.findFirst({
        where: { id: assetId, tenantId },
        select: ASSET_SELECT,
      });
    } catch (e) {
      return { status: 'skipped', reason: `read-failed: ${(e as Error).message}` };
    }
    if (!asset || !isPdfAsset(asset)) return { status: 'skipped', reason: 'not-a-pdf' };
    const current = readPdfPages(asset.processingMeta);
    if (!current || current.state !== 'pending') return { status: 'skipped', reason: 'not-pending' };
    const legacy = current.legacy;
    const attempts = attemptsOf(asset.processingMeta) + 1;

    const path = this.storage.extractPath(asset.fileUrl);
    if (!path) return this.fail(asset, 'external-url', legacy, attempts);

    // A fleet copy (another location's row serving this tenant-owner's file):
    // the pages belong to the FILE, so it adopts the owner's record instead of
    // rendering the same document again.
    const owner = path.split('/')[0];
    if (owner && owner !== asset.tenantId) {
      const adopted = await this.adoptFromOwner(asset, owner);
      if (adopted) return adopted;
    }

    if (attempts > PdfPagesService.MAX_ATTEMPTS) {
      return this.fail(asset, 'render-interrupted', legacy, attempts);
    }
    // Claim: the attempt counter and a fresh `updatedAt`, so the sweep leaves
    // this rendering alone while it is alive.
    const claimed = await this.writeProgress(asset, {
      version: PDF_PAGES_VERSION,
      state: 'pending',
      ...(current.count ? { count: current.count } : {}),
      done: 0,
      ...(legacy ? { legacy: true as const } : {}),
      updatedAt: this.iso(),
    }, attempts);
    if (!claimed) return { status: 'skipped', reason: 'row-changed' };

    let bytes: Buffer | null = null;
    try {
      bytes = await this.storage.download(path);
    } catch {
      bytes = null;
    }
    // A failed read is not a verdict on the file: leave it pending — the sweep
    // tries again, and the attempt counter ends it if it never succeeds.
    if (!bytes) return { status: 'interrupted' };

    const prefix = `${asset.tenantId}/pdf-pages/${asset.id}/${randomUUID().slice(0, 12)}/`;
    const uploaded: string[] = [];
    const pages: PdfPageJson[] = [];
    let count = 0;
    let firstPage = 1;
    try {
      for (let guard = 0; guard <= this.pageCap; guard += 1) {
        if (this.stopped) {
          await this.cleanup(uploaded);
          return { status: 'interrupted' };
        }
        const want = Math.max(1, Math.min(this.pagesPerJob, this.pageCap - pages.length));
        const r = await this.rasterRange(asset, bytes, firstPage, want, attempts, legacy, count, pages.length);
        if (!r.ok) {
          await this.cleanup(uploaded);
          // A refusal about the FILE is final. Anything else (the browser did
          // not start, the worker died, the slot stayed busy) is this attempt
          // only: the record stays pending and the sweep tries again — at most
          // MAX_ATTEMPTS times.
          if (FINAL_REASONS.has(r.reason)) return this.fail(asset, r.reason, legacy, attempts);
          this.logger.warn(`[pdf-pages] ${asset.id}: attempt ${attempts} stopped (${r.reason}); the sweep retries`);
          return { status: 'interrupted' };
        }
        count = r.sourcePageCount;
        if (r.pages.length === 0) {
          await this.cleanup(uploaded);
          return this.fail(asset, 'raster-budget-exceeded', legacy, attempts);
        }
        for (const page of r.pages) {
          const frames = {} as Record<PdfFrameKey, { sha256: string; size: number }>;
          for (const frame of page.frames) {
            const key = frame.key as PdfFrameKey;
            const objectPath = prefix + pdfPageFileName(page.sourcePage, key);
            await this.storage.upload(objectPath, frame.webp, PDF_PAGE_MIME);
            uploaded.push(objectPath);
            frames[key] = {
              sha256: createHash('sha256').update(frame.webp).digest('hex'),
              size: frame.webp.length,
            };
          }
          const thumbPath = prefix + pdfPageFileName(page.sourcePage, 'thumb');
          await this.storage.upload(thumbPath, page.thumbWebp, PDF_PAGE_MIME);
          uploaded.push(thumbPath);
          pages.push({ n: page.sourcePage, w: page.widthPx, h: page.heightPx, frames });
        }
        const target = Math.min(count, this.pageCap);
        if (pages.length >= target || !r.truncated) break;
        firstPage = r.pages[r.pages.length - 1].sourcePage + 1;
        // Progress — what the library shows as "Preparing pages… 8 of 12".
        const progressed = await this.writeProgress(asset, {
          version: PDF_PAGES_VERSION,
          state: 'pending',
          count,
          done: pages.length,
          ...(legacy ? { legacy: true as const } : {}),
          updatedAt: this.iso(),
        }, attempts);
        if (!progressed) {
          await this.cleanup(uploaded);
          return { status: 'skipped', reason: 'row-changed' };
        }
      }
    } catch (e) {
      await this.cleanup(uploaded);
      this.logger.warn(`[pdf-pages] ${asset.id}: storage failed: ${(e as Error).message}`);
      // Storage, not the file: leave it pending for the sweep.
      return { status: 'interrupted' };
    }

    const record: PdfPagesJson = {
      version: PDF_PAGES_VERSION,
      state: 'ready',
      count,
      base: this.storage.publicUrlForPath(prefix),
      pages,
      ...(count > pages.length ? { truncatedAt: this.pageCap } : {}),
      ...(legacy ? { legacy: true as const } : {}),
      updatedAt: this.iso(),
    };
    const wrote = await this.writeFinal(asset, record, PDF_PAGES_RENDERED, {
      pages: pages.length,
      count,
      bytes: pages.reduce((sum, p) => sum + PDF_PAGE_FRAMES.reduce((s, f) => s + p.frames[f.key].size, 0), 0),
    });
    if (!wrote) {
      await this.cleanup(uploaded);
      return { status: 'skipped', reason: 'row-changed' };
    }
    await this.propagateToCopies(asset, record);
    this.logger.log(`[pdf-pages] ${asset.id}: ${pages.length} of ${count} page(s) ready`);
    return { status: 'ready', pages: pages.length, count };
  }

  /**
   * One range of pages, retried while the single browser slot is busy. Every
   * wait refreshes the record so the sweep never mistakes a queued rendering
   * for a dead one.
   */
  private async rasterRange(
    asset: PdfAssetRow,
    bytes: Buffer,
    firstPage: number,
    maxPages: number,
    attempts: number,
    legacy: boolean,
    count: number,
    done: number,
  ) {
    for (let tries = 0; ; tries += 1) {
      const r = await this.raster.rasterizePdfFrames(
        bytes,
        { firstPage, frames: PDF_PAGE_FRAMES.map((f) => ({ key: f.key, width: f.width, height: f.height })) },
        { maxPages, webpQuality: this.webpQuality },
      );
      if (r.ok || r.reason !== 'raster-busy') return r;
      if (this.stopped || tries >= this.busyRetries) {
        return { ok: false as const, reason: 'interrupted' };
      }
      await this.sleep(this.busyRetryMs);
      await this.writeProgress(asset, {
        version: PDF_PAGES_VERSION,
        state: 'pending',
        ...(count ? { count } : {}),
        done,
        ...(legacy ? { legacy: true as const } : {}),
        updatedAt: this.iso(),
      }, attempts);
    }
  }

  /** Stamp a document whose pages could not be made. Never throws. */
  private async fail(
    asset: PdfAssetRow,
    reason: string,
    legacy: boolean,
    attempts: number,
  ): Promise<PdfRenderOutcome> {
    const record: PdfPagesJson = {
      version: PDF_PAGES_VERSION,
      state: 'failed',
      error: reason.slice(0, 80),
      ...(legacy ? { legacy: true as const } : {}),
      updatedAt: this.iso(),
    };
    await this.writeFinal(asset, record, PDF_PAGES_FAILED, { reason, attempts });
    await this.propagateToCopies(asset, record);
    return { status: 'failed', reason };
  }

  /**
   * Write `processingMeta.pdfPages`, merged over the row's other keys and
   * guarded by the row's file URL — a row whose file was replaced meanwhile is
   * never stamped with another file's pages. Returns false when nothing was
   * written. `attempts` rides beside the record (`pdfPagesAttempts`).
   */
  private async writeRecord(asset: PdfAssetRow, record: PdfPagesJson, attempts?: number): Promise<boolean> {
    try {
      const fresh = await this.prisma.client.asset.findFirst({
        where: { id: asset.id, tenantId: asset.tenantId, fileUrl: asset.fileUrl },
        select: { processingMeta: true },
      });
      if (!fresh) return false;
      const merged = {
        ...asRecord(fresh.processingMeta),
        pdfPages: record,
        ...(attempts !== undefined ? { pdfPagesAttempts: attempts } : {}),
      };
      const updated = await this.prisma.client.asset.updateMany({
        where: { id: asset.id, tenantId: asset.tenantId, fileUrl: asset.fileUrl },
        data: { processingMeta: merged as unknown as Prisma.InputJsonObject },
      });
      return updated.count > 0;
    } catch (e) {
      this.logger.warn(`[pdf-pages] ${asset.id}: record write failed: ${(e as Error).message}`);
      return false;
    }
  }

  /**
   * A pending → pending write: the claim, progress after each range, a
   * heartbeat while the browser slot is busy. It changes nothing a screen is
   * handed (a pending PDF is left out before and after), so it is written with
   * raw SQL, which the manifest hot cache's mutation hook does not count
   * (prisma.service.ts bumps the content revision on MODEL writes only). As a
   * Prisma write it would rebuild every screen's manifest after every range —
   * ten fleet-wide rebuilds for one 60-page PDF, for nothing. Guarded: only a
   * row that still serves this file and still reads `pending` is touched, so it
   * can never overwrite a final record. The final record, and the legacy
   * adoption stamp (which DOES change delivery), go through prisma.client.
   */
  private async writeProgress(asset: PdfAssetRow, record: PdfPagesJson, attempts?: number): Promise<boolean> {
    try {
      const n = await this.prisma.client.$executeRaw(Prisma.sql`
        UPDATE assets
           SET processing_meta = jsonb_set(coalesce(processing_meta, '{}'::jsonb), '{pdfPages}', ${JSON.stringify(record)}::jsonb, true)${
             attempts !== undefined
               ? Prisma.sql` || jsonb_build_object('pdfPagesAttempts', ${attempts}::int)`
               : Prisma.empty
           }
         WHERE id = ${asset.id} AND tenant_id = ${asset.tenantId} AND file_url = ${asset.fileUrl}
           AND processing_meta->'pdfPages'->>'state' = 'pending'`);
      return n > 0;
    } catch (e) {
      this.logger.warn(`[pdf-pages] ${asset.id}: progress write failed: ${(e as Error).message}`);
      return false;
    }
  }

  /** The final record and its audit row, together. */
  private async writeFinal(
    asset: PdfAssetRow,
    record: PdfPagesJson,
    action: string,
    details: Record<string, unknown>,
  ): Promise<boolean> {
    try {
      return await this.prisma.client.$transaction(async (tx) => {
        const fresh = await tx.asset.findFirst({
          where: { id: asset.id, tenantId: asset.tenantId, fileUrl: asset.fileUrl },
          select: { processingMeta: true },
        });
        if (!fresh) return false;
        const { pdfPagesAttempts: _attempts, ...rest } = asRecord(fresh.processingMeta);
        const updated = await tx.asset.updateMany({
          where: { id: asset.id, tenantId: asset.tenantId, fileUrl: asset.fileUrl },
          data: { processingMeta: { ...rest, pdfPages: record } as unknown as Prisma.InputJsonObject },
        });
        if (!updated.count) return false;
        await tx.auditLog.create({
          data: {
            tenantId: asset.tenantId,
            userId: null,
            action,
            targetType: 'Asset',
            targetId: asset.id,
            details: JSON.stringify(details),
          },
        });
        return true;
      });
    } catch (e) {
      this.logger.warn(`[pdf-pages] ${asset.id}: final write failed: ${(e as Error).message}`);
      return false;
    }
  }

  /**
   * Fleet copies made while the owner was still rendering carry `pending`; the
   * owner's outcome is theirs too (same file, same pages). Only rows that hold
   * exactly this file and are still pending are touched.
   */
  private async propagateToCopies(asset: PdfAssetRow, record: PdfPagesJson): Promise<void> {
    try {
      const copies = await this.prisma.client.asset.findMany({
        where: { fileUrl: asset.fileUrl, id: { not: asset.id } },
        select: ASSET_SELECT,
        take: 200,
      });
      for (const copy of copies) {
        // A copy still waiting (pending), or one from before pages existed (no
        // record — the owner was adopted by the legacy sweep): the owner's
        // outcome is theirs. A copy with its own final record is left alone.
        const theirs = readPdfPages(copy.processingMeta);
        if (!isPdfAsset(copy) || (theirs && theirs.state !== 'pending')) continue;
        await this.writeFinal(copy, record, record.state === 'ready' ? PDF_PAGES_RENDERED : PDF_PAGES_FAILED, {
          adoptedFrom: asset.id,
        });
      }
    } catch (e) {
      this.logger.warn(`[pdf-pages] ${asset.id}: copies not updated: ${(e as Error).message}`);
    }
  }

  /**
   * A fleet copy adopts the file owner's FINAL record. Null when the owner has
   * none to give (no owner row, or the owner is itself still pending — then the
   * owner's completion reaches this row through `propagateToCopies`).
   */
  private async adoptFromOwner(asset: PdfAssetRow, ownerTenantId: string): Promise<PdfRenderOutcome | null> {
    const ownerRow = await this.prisma.client.asset.findFirst({
      where: { tenantId: ownerTenantId, fileUrl: asset.fileUrl },
      select: ASSET_SELECT,
    });
    if (!ownerRow) return null;
    const theirs = readPdfPages(ownerRow.processingMeta);
    const raw = asRecord(ownerRow.processingMeta).pdfPages as PdfPagesJson | undefined;
    if (!theirs || !raw) return null;
    if (theirs.state === 'pending') {
      // Refresh so the sweep does not pick this row every minute meanwhile.
      await this.writeProgress(asset, { ...raw, updatedAt: this.iso() });
      return { status: 'skipped', reason: 'waiting-for-owner' };
    }
    const wrote = await this.writeFinal(asset, raw, theirs.state === 'ready' ? PDF_PAGES_RENDERED : PDF_PAGES_FAILED, {
      adoptedFrom: ownerRow.id,
    });
    if (!wrote) return { status: 'skipped', reason: 'row-changed' };
    return theirs.state === 'ready'
      ? { status: 'ready', pages: theirs.pages.length, count: theirs.count ?? theirs.pages.length }
      : { status: 'failed', reason: theirs.error ?? 'failed' };
  }

  /**
   * The leader-leased sweep: resume renderings a deploy or a crash
   * interrupted (a `pending` record nobody has written for STALE_MS). Newest
   * first — the file an operator just uploaded is the one they are waiting for.
   */
  async sweepTick(): Promise<number> {
    if (this.sweeping || this.stopped || !this.enabled()) return 0;
    const status = await leadThisTick(this.lease, LEASE.PDF_PAGES_SWEEP);
    if (!status.leader) return 0;
    this.sweeping = true;
    try {
      const cutoff = new Date(this.now() - PdfPagesService.STALE_MS).toISOString();
      const rows = await this.prisma.client.$queryRaw<Array<{ id: string; tenantId: string }>>(
        Prisma.sql`SELECT id, tenant_id AS "tenantId" FROM assets
                   WHERE mime_type IN ('application/pdf', 'application/x-pdf')
                     AND processing_meta->'pdfPages'->>'state' = 'pending'
                     AND coalesce(processing_meta->'pdfPages'->>'updatedAt', '') < ${cutoff}
                   ORDER BY created_at DESC, id DESC
                   LIMIT ${PdfPagesService.SWEEP_BATCH}`,
      );
      for (const row of rows) this.kickOff(row.id, row.tenantId);
      const adopted = rows.length ? 0 : await this.adoptLegacy();
      return rows.length + adopted;
    } finally {
      this.sweeping = false;
    }
  }

  /**
   * PDFs uploaded before pages existed have no record and reach screens as the
   * PDF (nothing on an Android player). Adopt a few per tick — newest first,
   * only the file OWNER's row (a fleet copy follows its owner through
   * `propagateToCopies`), only PUBLISHED ones (what screens can be handed), and
   * never while this process has page work queued or a video transcode is
   * queued or running. Each is stamped `pending` + `legacy` and rendered: while
   * its pages are made it is left out of manifests like any new PDF; if they
   * cannot be made it goes back to being delivered exactly as before
   * (`pdfDelivery` → 'as-uploaded' for a legacy failure).
   */
  async adoptLegacy(): Promise<number> {
    if (PdfPagesService.legacySweepDisabled() || this.queue.length || this.draining) return 0;
    const transcoding = await this.prisma.client.videoTranscodeJob
      .count({ where: { status: { in: ['queued', 'running'] } } })
      .catch(() => 1);
    if (transcoding > 0) return 0;
    const rows = await this.prisma.client.$queryRaw<Array<{ id: string; tenantId: string }>>(
      Prisma.sql`SELECT id, tenant_id AS "tenantId" FROM assets
                 WHERE mime_type IN ('application/pdf', 'application/x-pdf')
                   AND status = 'PUBLISHED'
                   AND (processing_meta IS NULL OR processing_meta->'pdfPages' IS NULL)
                   AND strpos(file_url, '/' || tenant_id || '/') > 0
                 ORDER BY created_at DESC, id DESC
                 LIMIT ${PdfPagesService.LEGACY_BATCH}`,
    );
    let adopted = 0;
    for (const row of rows) {
      const asset = await this.prisma.client.asset.findFirst({
        where: { id: row.id, tenantId: row.tenantId },
        select: ASSET_SELECT,
      });
      if (!asset || !isPdfAsset(asset) || readPdfPages(asset.processingMeta)) continue;
      const stamped = await this.writeRecord(asset, {
        version: PDF_PAGES_VERSION,
        state: 'pending',
        legacy: true,
        updatedAt: this.iso(),
      });
      if (!stamped) continue;
      adopted += 1;
      this.kickOff(asset.id, asset.tenantId);
    }
    if (adopted) this.logger.log(`[pdf-pages] adopted ${adopted} PDF(s) from before pages existed`);
    return adopted;
  }

  private async cleanup(paths: string[]): Promise<void> {
    if (!paths.length) return;
    await this.storage.deleteMany(paths).catch(() => 0);
  }

  private iso(): string {
    return new Date(this.now()).toISOString();
  }
}

/**
 * Every object a PDF's pages occupy, for deletion with the asset: the four
 * frames and the thumbnail of every page, under the record's own folder — and
 * only inside `tenantId`'s folder, never another tenant's (a fleet copy's
 * record points at the owner's pages, which are the owner's to delete).
 */
export function pdfPageObjectPaths(
  meta: unknown,
  tenantId: string,
  extractPath: (url: string) => string | null,
): string[] {
  const pages = readPdfPages(meta);
  if (!pages || pages.state !== 'ready') return [];
  const out: string[] = [];
  for (const page of pages.pages) {
    for (const spec of PDF_PAGE_FRAMES) {
      const p = extractPath(page.frames[spec.key].url);
      if (p) out.push(p);
    }
    const t = extractPath(page.thumbUrl);
    if (t) out.push(t);
  }
  return out.filter((p) => p.startsWith(`${tenantId}/pdf-pages/`) && !p.includes('..'));
}

function attemptsOf(meta: unknown): number {
  const n = asRecord(meta).pdfPagesAttempts;
  return typeof n === 'number' && Number.isSafeInteger(n) && n > 0 ? n : 0;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function intEnv(name: string, def: number): number {
  const v = parseInt(process.env[name] || '', 10);
  return Number.isFinite(v) && v > 0 ? v : def;
}
