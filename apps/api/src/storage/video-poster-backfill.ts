/**
 * video-poster-backfill.ts — the REUSABLE CORE of `scripts/backfill-video-posters.ts`.
 *
 * Kept here, away from the CLI, for one reason: `apps/api`'s jest rootDir is
 * `src`, so this is the only place the loop's real behaviour (idempotency,
 * resumability, rate limiting, dry-run purity) can be unit-tested. The script
 * is then a thin wiring layer — Prisma + Supabase + ffmpeg — over this.
 *
 * INVARIANTS THE TESTS PIN:
 *   * DRY RUN WRITES NOTHING. Not the DB, not storage. It doesn't even ask for
 *     a poster to be made — extracting a frame means downloading video bytes,
 *     and a "preview" that burns egress is not a preview.
 *   * IDEMPOTENT. A candidate is a row with `posterUrl IS NULL`; persistence
 *     re-asserts that condition, so a re-run (or a second concurrent run)
 *     never overwrites a poster that already exists.
 *   * RESUMABLE. The cursor advances by ascending id and ALWAYS moves, even
 *     over a row that failed — otherwise one undecodable video parks the run
 *     forever on the same page.
 *   * RATE LIMITED. A fixed pause between rows, so a 1,000-video backfill
 *     can't saturate the API pod, Supabase egress, or the connection pool
 *     (`connection_limit=10` in session mode — see CLAUDE.md).
 */

export interface BackfillAssetRow {
  id: string;
  tenantId: string;
  fileUrl: string;
  mimeType: string;
  originalName: string | null;
}

export type MakePosterResult =
  | { ok: true; posterUrl: string; bytes?: number }
  | { ok: false; reason: string };

export interface BackfillDeps {
  /** Total rows matching the candidate filter (video + posterUrl IS NULL [+ tenant]). */
  countCandidates(): Promise<number>;
  /** One page of candidates, ordered by id ASC, strictly after `afterId`. */
  fetchBatch(afterId: string | null, take: number): Promise<BackfillAssetRow[]>;
  /**
   * Bucket-relative storage path for this row's video, or null when the asset
   * isn't one of ours (a pasted external/CDN URL via `POST /assets/url`). Those
   * are skipped: we don't own the bytes, and we never point ffmpeg at a stored
   * third-party URL.
   */
  storagePathFor(row: BackfillAssetRow): string | null;
  /** Extract + upload the poster. LIVE RUNS ONLY. Never throws. */
  makePoster(
    row: BackfillAssetRow,
    storagePath: string,
  ): Promise<MakePosterResult>;
  /** Tenant-scoped, still-null-guarded write. Returns the number of rows changed. */
  persist(row: BackfillAssetRow, posterUrl: string): Promise<number>;
  log(line: string): void;
  sleep(ms: number): Promise<void>;
}

export interface BackfillOptions {
  dryRun: boolean;
  batch: number;
  limit: number;
  /** Pause between rows — the rate limit. */
  delayMs: number;
  /** Resume point: process only ids strictly greater than this. */
  afterId?: string | null;
}

export interface BackfillSummary {
  scanned: number;
  /** Posters written (live) or that WOULD be written (dry run). */
  posted: number;
  skippedExternal: number;
  failed: number;
  alreadySet: number;
  /** Last id processed — pass back as `--after=` to resume. */
  lastId: string | null;
  dryRun: boolean;
}

export async function runPosterBackfill(
  deps: BackfillDeps,
  opts: BackfillOptions,
): Promise<BackfillSummary> {
  const total = await deps.countCandidates();
  const toProcess = Math.min(total, opts.limit);

  deps.log('─'.repeat(64));
  deps.log(
    `Video poster backfill ${opts.dryRun ? '(DRY RUN — no writes, no downloads)' : '(LIVE — will write)'}`,
  );
  deps.log(`  videos with no poster : ${total}`);
  deps.log(`  will process this run : ${toProcess}`);
  deps.log(`  batch / delay         : ${opts.batch} / ${opts.delayMs}ms`);
  if (opts.afterId) deps.log(`  resuming after id     : ${opts.afterId}`);
  deps.log('─'.repeat(64));

  const summary: BackfillSummary = {
    scanned: 0,
    posted: 0,
    skippedExternal: 0,
    failed: 0,
    alreadySet: 0,
    lastId: null,
    dryRun: opts.dryRun,
  };

  if (toProcess === 0) {
    deps.log('Nothing to do — every video already has a poster. ✅');
    return summary;
  }

  // The cursor advances by id even on failure, so a row ffmpeg cannot decode
  // is skipped this run and retried on the next one (it stays posterUrl=NULL)
  // instead of wedging the page.
  let cursor: string | null = opts.afterId ?? null;

  while (summary.scanned < toProcess) {
    const take = Math.min(opts.batch, toProcess - summary.scanned);
    const page = await deps.fetchBatch(cursor, take);
    if (page.length === 0) break;

    for (const row of page) {
      summary.scanned++;
      cursor = row.id;
      summary.lastId = row.id;
      const label = row.originalName ? `"${row.originalName}"` : row.id;

      const storagePath = deps.storagePathFor(row);
      if (!storagePath) {
        summary.skippedExternal++;
        deps.log(`  [skip:external] ${label} — not an assets-bucket URL`);
        continue;
      }

      if (opts.dryRun) {
        summary.posted++;
        deps.log(
          `  [would-poster ] ${label} — ${row.mimeType} @ ${storagePath}`,
        );
        continue;
      }

      const made = await deps.makePoster(row, storagePath);
      if (!made.ok) {
        summary.failed++;
        deps.log(
          `  [failed       ] ${label} — ${made.reason} (stays NULL, safe to re-run)`,
        );
        await deps.sleep(opts.delayMs);
        continue;
      }

      const changed = await deps.persist(row, made.posterUrl);
      if (changed > 0) {
        summary.posted++;
        deps.log(
          `  [wrote        ] ${label} → ${made.posterUrl}${made.bytes ? ` (${made.bytes} B)` : ''}`,
        );
      } else {
        // Another run (or an upload) set it between fetch and persist.
        summary.alreadySet++;
        deps.log(
          `  [already-set  ] ${label} — poster set by another run, left as-is`,
        );
      }
      await deps.sleep(opts.delayMs);
    }

    deps.log(
      `  … progress: ${summary.scanned}/${toProcess} scanned, ${summary.posted} ${opts.dryRun ? 'would-poster' : 'postered'}`,
    );
  }

  deps.log('─'.repeat(64));
  deps.log('Done.');
  deps.log(`  scanned            : ${summary.scanned}`);
  deps.log(
    `  ${opts.dryRun ? 'would poster' : 'postered    '}       : ${summary.posted}`,
  );
  deps.log(`  skipped (external) : ${summary.skippedExternal}`);
  deps.log(`  already set        : ${summary.alreadySet}`);
  deps.log(`  failed             : ${summary.failed}`);
  if (summary.lastId)
    deps.log(`  resume with        : --after=${summary.lastId}`);
  deps.log('─'.repeat(64));

  return summary;
}
