/**
 * asset-backfill-loop.ts — the ONE loop under every `scripts/backfill-video-*`
 * pass that walks Asset rows and fills in something new uploads now get for
 * free.
 *
 * Two backfills ride it: video POSTERS (`video-poster-backfill.ts`, 2026-09-11)
 * and video DIMENSIONS (`video-probe-backfill.ts`, 2026-09-24). They share it
 * for the reason this repo keeps re-learning: one loop with the four promises
 * below is easy to keep honest, and two copies drift — the copy nobody
 * re-tested is the one that overwrites a good value at 2 a.m. Each adapter
 * supplies only what differs: the candidate query, the expensive step, the
 * guarded write, and the words in the log.
 *
 * Kept under apps/api/src (not scripts/) because `apps/api`'s jest rootDir is
 * `src`, so this is where the loop's real behaviour can be unit-tested. The
 * CLI is a thin wiring layer — Prisma + Supabase + ffmpeg/ffprobe — over this.
 *
 * THE FOUR PROMISES (pinned by both adapters' specs):
 *   * DRY RUN WRITES NOTHING. Not the DB, not storage. It does not even run
 *     the expensive step — that means downloading video bytes, and a
 *     "preview" that burns egress is not a preview.
 *   * IDEMPOTENT. A candidate is a row still missing the value; `persist`
 *     re-asserts that condition in its own WHERE, so a re-run (or a second
 *     concurrent run) never overwrites a value that already exists.
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

export type StepOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string };

export interface BackfillLoopDeps<R extends BackfillAssetRow, T> {
  /** Total rows matching the candidate filter. */
  countCandidates(): Promise<number>;
  /** One page of candidates, ordered by id ASC, strictly after `afterId`. */
  fetchBatch(afterId: string | null, take: number): Promise<R[]>;
  /**
   * Bucket-relative storage path for this row's video, or null when the asset
   * isn't one of ours (a pasted external/CDN URL via `POST /assets/url`).
   * Those are skipped: we don't own the bytes, and we never point ffmpeg or
   * ffprobe at a stored third-party URL.
   */
  storagePathFor(row: R): string | null;
  /** The expensive step. LIVE RUNS ONLY. Never throws. */
  produce(row: R, storagePath: string): Promise<StepOutcome<T>>;
  /** Tenant-scoped, still-missing-guarded write. Returns rows changed. */
  persist(row: R, value: T): Promise<number>;
  log(line: string): void;
  sleep(ms: number): Promise<void>;
}

/** The words that differ between backfills. Everything else is the loop. */
export interface BackfillLoopCopy<R extends BackfillAssetRow, T> {
  /** "Video poster backfill" */
  title: string;
  /** "videos with no poster" — the header count line. */
  candidateNoun: string;
  /** "every video already has a poster" — the clean no-op line. */
  nothingToDo: string;
  /** Per-row tag in a dry run, e.g. "would-poster". */
  wouldTag: string;
  /** Progress + summary verbs: { dry: "would-poster", live: "postered" }. */
  progressVerb: { dry: string; live: string };
  summaryVerb: { dry: string; live: string };
  /** What a produced value looks like on the "wrote" line: " → url (4 KB)". */
  describe(value: T, row: R): string;
  /** "stays NULL, safe to re-run" */
  failedNote: string;
  /** "poster set by another run, left as-is" */
  alreadySetNote: string;
}

export interface BackfillLoopOptions {
  dryRun: boolean;
  batch: number;
  limit: number;
  /** Pause between rows — the rate limit. */
  delayMs: number;
  /** Resume point: process only ids strictly greater than this. */
  afterId?: string | null;
}

export interface BackfillLoopSummary {
  scanned: number;
  /** Values written (live) or that WOULD be written (dry run). */
  written: number;
  skippedExternal: number;
  failed: number;
  alreadySet: number;
  /** Last id processed — pass back as `--after=` to resume. */
  lastId: string | null;
  dryRun: boolean;
}

/** Column widths that keep every summary line's colons aligned. */
const HEADER_LABEL_WIDTH = 22;
const TAG_WIDTH = 13;
const SUMMARY_LABEL_WIDTH = 19;

export async function runAssetBackfill<R extends BackfillAssetRow, T>(
  deps: BackfillLoopDeps<R, T>,
  opts: BackfillLoopOptions,
  copy: BackfillLoopCopy<R, T>,
): Promise<BackfillLoopSummary> {
  const total = await deps.countCandidates();
  const toProcess = Math.min(total, opts.limit);
  const rule = '─'.repeat(64);
  const header = (label: string, value: string | number) =>
    deps.log(`  ${label.padEnd(HEADER_LABEL_WIDTH)}: ${value}`);
  const tag = (t: string) => `[${t.padEnd(TAG_WIDTH)}]`;

  deps.log(rule);
  deps.log(
    `${copy.title} ${opts.dryRun ? '(DRY RUN — no writes, no downloads)' : '(LIVE — will write)'}`,
  );
  header(copy.candidateNoun, total);
  header('will process this run', toProcess);
  header('batch / delay', `${opts.batch} / ${opts.delayMs}ms`);
  if (opts.afterId) header('resuming after id', opts.afterId);
  deps.log(rule);

  const summary: BackfillLoopSummary = {
    scanned: 0,
    written: 0,
    skippedExternal: 0,
    failed: 0,
    alreadySet: 0,
    lastId: null,
    dryRun: opts.dryRun,
  };

  if (toProcess === 0) {
    deps.log(`Nothing to do — ${copy.nothingToDo}. ✅`);
    return summary;
  }

  // The cursor advances by id even on failure, so a row the tool cannot
  // decode is skipped this run and retried on the next one (it is still a
  // candidate) instead of wedging the page.
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
        deps.log(
          `  ${tag('skip:external')} ${label} — not an assets-bucket URL`,
        );
        continue;
      }

      if (opts.dryRun) {
        summary.written++;
        deps.log(
          `  ${tag(copy.wouldTag)} ${label} — ${row.mimeType} @ ${storagePath}`,
        );
        continue;
      }

      const made = await deps.produce(row, storagePath);
      if (!made.ok) {
        summary.failed++;
        deps.log(
          `  ${tag('failed')} ${label} — ${made.reason} (${copy.failedNote})`,
        );
        await deps.sleep(opts.delayMs);
        continue;
      }

      const changed = await deps.persist(row, made.value);
      if (changed > 0) {
        summary.written++;
        deps.log(`  ${tag('wrote')} ${label}${copy.describe(made.value, row)}`);
      } else {
        // Another run (or an upload) set it between fetch and persist.
        summary.alreadySet++;
        deps.log(`  ${tag('already-set')} ${label} — ${copy.alreadySetNote}`);
      }
      await deps.sleep(opts.delayMs);
    }

    deps.log(
      `  … progress: ${summary.scanned}/${toProcess} scanned, ${summary.written} ${opts.dryRun ? copy.progressVerb.dry : copy.progressVerb.live}`,
    );
  }

  const line = (label: string, value: string | number) =>
    deps.log(`  ${label.padEnd(SUMMARY_LABEL_WIDTH)}: ${value}`);
  deps.log(rule);
  deps.log('Done.');
  line('scanned', summary.scanned);
  line(
    opts.dryRun ? copy.summaryVerb.dry : copy.summaryVerb.live,
    summary.written,
  );
  line('skipped (external)', summary.skippedExternal);
  line('already set', summary.alreadySet);
  line('failed', summary.failed);
  if (summary.lastId) line('resume with', `--after=${summary.lastId}`);
  deps.log(rule);

  return summary;
}
