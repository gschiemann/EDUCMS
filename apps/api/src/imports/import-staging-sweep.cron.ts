import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseStorageService } from '../storage/supabase-storage.service';
import { LEASE, LeaderLeaseService, leadThisTick } from '../realtime/leader-lease.service';

/**
 * Staged imports are disposable. This is what disposes of them.
 *
 * An import stages the operator's original — and every page raster the
 * converter produced — in the PRIVATE `import-staging` bucket, so they can be
 * reviewed before anything is committed. Most of that is then abandoned: the
 * operator picks 6 pages of 20, or closes the tab, or the conversion failed.
 * Nothing a screen plays ever points at these objects (a committed import
 * copies what it needs onto the public assets bucket), so they can be deleted
 * on a clock rather than reference-counted.
 *
 * Two properties this must keep:
 *   • It only ever deletes objects recorded on a job row it also expires, so
 *     it cannot walk the bucket and delete something it does not understand.
 *   • A COMMITTED job's staged objects are swept too, and that is safe for the
 *     same reason: commit copies bytes out. If that ever stops being true,
 *     this sweep becomes a data-loss bug — which is why the invariant is
 *     written here and asserted in the spec.
 */
@Injectable()
export class ImportStagingSweepCron implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ImportStagingSweepCron.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  /** Hourly. Nothing here is urgent; the cost of a late sweep is disk. */
  private static readonly INTERVAL_MS = 60 * 60_000;
  /** How many jobs one tick will clear. Bounds the storage calls per tick. */
  private static readonly BATCH = 50;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: SupabaseStorageService,
    @Optional() private readonly lease?: LeaderLeaseService,
  ) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test') return;
    // Not on boot: a cold start already has migrations, module init and a cold
    // pool to get through, and this is the least urgent work in the process.
    this.timer = setInterval(() => {
      void this.sweep().catch((e) =>
        this.logger.warn(`[import-sweep] tick failed: ${e?.message ?? e}`),
      );
    }, ImportStagingSweepCron.INTERVAL_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * Delete the staged objects of every job past its expiry, then mark the job
   * EXPIRED so it is never swept twice. Returns what it cleared, for tests and
   * for the log line.
   */
  async sweep(now: Date = new Date()): Promise<{ jobs: number; objects: number }> {
    const status = await leadThisTick(this.lease, LEASE.IMPORT_STAGING_SWEEP);
    if (!status.leader) return { jobs: 0, objects: 0 };

    const due = await this.prisma.client.importJob.findMany({
      where: { expiresAt: { lt: now }, status: { not: 'EXPIRED' } },
      select: { id: true, sourceObject: true, manifest: true },
      orderBy: { expiresAt: 'asc' },
      take: ImportStagingSweepCron.BATCH,
    });
    if (due.length === 0) return { jobs: 0, objects: 0 };

    let objects = 0;
    for (const job of due) {
      const keys = stagedObjectKeys(job.sourceObject, job.manifest);
      if (keys.length > 0) {
        try {
          await this.storage.deleteManyFromBucket(this.storage.importStagingBucketName(), keys);
          objects += keys.length;
        } catch (e: any) {
          // A storage failure must not strand the row: leaving it un-expired
          // would retry forever against an object that may already be gone.
          // Expire it anyway and say so — the cost of a missed delete is disk,
          // and the bucket has its own lifecycle as a backstop.
          this.logger.warn(
            `[import-sweep] job=${job.id} storage delete failed, expiring anyway: ${e?.message ?? e}`,
          );
        }
      }
      await this.prisma.client.importJob.update({
        where: { id: job.id },
        data: { status: 'EXPIRED', manifest: null },
      });
    }

    this.logger.log(`[import-sweep] expired ${due.length} job(s), ${objects} staged object(s)`);
    return { jobs: due.length, objects };
  }
}

/**
 * Every staging key a job owns: its original, plus every artifact the manifest
 * recorded. Exported and pure so the spec can pin the "we only delete what the
 * row names" property without a database.
 */
export function stagedObjectKeys(sourceObject: string | null, manifestJson: string | null): string[] {
  const keys = new Set<string>();
  if (sourceObject) keys.add(sourceObject);
  if (manifestJson) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(manifestJson);
    } catch {
      // A manifest we cannot read is not a licence to guess at object names.
      return [...keys];
    }
    collectKeys(parsed, keys, 0);
  }
  return [...keys];
}

/** Walk the manifest for `objectKey`-shaped fields, depth-bounded. */
function collectKeys(node: unknown, out: Set<string>, depth: number): void {
  if (depth > 6 || node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const child of node) collectKeys(child, out, depth + 1);
    return;
  }
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    // Only ever a KEY. A signed URL would already be expired and a public URL
    // would belong to a different bucket — neither is safe to hand a delete.
    if ((k === 'objectKey' || k === 'thumbObjectKey') && typeof v === 'string' && v) out.add(v);
    else collectKeys(v, out, depth + 1);
  }
}
