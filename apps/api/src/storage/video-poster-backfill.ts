/**
 * video-poster-backfill.ts — the poster half of `scripts/backfill-video-posters.ts`.
 *
 * The loop itself — dry-run purity, idempotency, resumability, rate limiting —
 * lives in `asset-backfill-loop.ts`, shared with the dimensions backfill
 * (`video-probe-backfill.ts`). This file supplies only what is poster-specific:
 * the step signature (`makePoster` → a stored URL), the guarded write (which
 * re-asserts `posterUrl IS NULL`), and the words in the log. The spec next to
 * it pins the observable behaviour of the WHOLE thing, so the shared loop
 * cannot drift under it unnoticed.
 *
 * INVARIANTS (see the loop for why each one exists):
 *   * DRY RUN WRITES NOTHING — not the DB, not storage, and it never asks for
 *     a poster to be made (that would download video bytes).
 *   * IDEMPOTENT — a candidate is a row with `posterUrl IS NULL`; `persist`
 *     re-asserts that, so a re-run or a concurrent run never overwrites.
 *   * RESUMABLE — the cursor always advances, even over a failed row.
 *   * RATE LIMITED — a fixed pause between rows.
 */
import {
  runAssetBackfill,
  type BackfillAssetRow,
  type BackfillLoopCopy,
  type BackfillLoopOptions,
} from './asset-backfill-loop';

export type { BackfillAssetRow } from './asset-backfill-loop';

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

export type BackfillOptions = BackfillLoopOptions;

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

interface PosterValue {
  posterUrl: string;
  bytes?: number;
}

const POSTER_COPY: BackfillLoopCopy<BackfillAssetRow, PosterValue> = {
  title: 'Video poster backfill',
  candidateNoun: 'videos with no poster',
  nothingToDo: 'every video already has a poster',
  wouldTag: 'would-poster',
  progressVerb: { dry: 'would-poster', live: 'postered' },
  summaryVerb: { dry: 'would poster', live: 'postered' },
  describe: (v) => ` → ${v.posterUrl}${v.bytes ? ` (${v.bytes} B)` : ''}`,
  failedNote: 'stays NULL, safe to re-run',
  alreadySetNote: 'poster set by another run, left as-is',
};

export async function runPosterBackfill(
  deps: BackfillDeps,
  opts: BackfillOptions,
): Promise<BackfillSummary> {
  // Every dep is looked up on `deps` at call time, not captured up front: the
  // spec (and a CLI that wants to swap a step mid-run) reassigns them.
  const s = await runAssetBackfill<BackfillAssetRow, PosterValue>(
    {
      countCandidates: () => deps.countCandidates(),
      fetchBatch: (afterId, take) => deps.fetchBatch(afterId, take),
      storagePathFor: (row) => deps.storagePathFor(row),
      produce: async (row, storagePath) => {
        const made = await deps.makePoster(row, storagePath);
        return made.ok
          ? {
              ok: true,
              value: { posterUrl: made.posterUrl, bytes: made.bytes },
            }
          : made;
      },
      persist: (row, v) => deps.persist(row, v.posterUrl),
      log: (line) => deps.log(line),
      sleep: (ms) => deps.sleep(ms),
    },
    opts,
    POSTER_COPY,
  );
  return {
    scanned: s.scanned,
    posted: s.written,
    skippedExternal: s.skippedExternal,
    failed: s.failed,
    alreadySet: s.alreadySet,
    lastId: s.lastId,
    dryRun: s.dryRun,
  };
}
