/**
 * video-probe-backfill.ts — the DIMENSIONS half of `scripts/backfill-video-posters.ts`.
 *
 * WHY: new uploads get their width × height / duration probed automatically
 * (VideoPosterService runs ffprobe beside the poster grab, 2026-09-24). Every
 * video uploaded BEFORE that has `processingMeta` NULL — or, for the ones the
 * 2026-09-11 poster backfill touched, a poster but still no dimensions — and
 * the media library shows "—" for its resolution. This pass closes that gap.
 *
 * The loop is `asset-backfill-loop.ts`, shared with the poster backfill; this
 * file supplies the probe-specific step (`probe` → a `ProbeSuccess`), the
 * guarded MERGE into `processingMeta` (the CLI's `persist` re-asserts
 * "still no usable dimensions" in the same statement as the write, and merges
 * rather than replaces so a poster-era key is never clobbered), and the words.
 *
 * A row is a candidate when it is a video and `hasUsableDimensions(meta)` is
 * false — whether or not it already has a poster. Those are independent
 * columns filled by independent steps, and the backfill treats them that way.
 */
import {
  runAssetBackfill,
  type BackfillAssetRow,
  type BackfillLoopCopy,
  type BackfillLoopOptions,
} from './asset-backfill-loop';
import {
  formatDurationMs,
  type ProbeOutcome,
  type ProbeSuccess,
} from './video-probe';

export type { BackfillAssetRow } from './asset-backfill-loop';

export interface ProbeBackfillDeps {
  /** Total rows matching the candidate filter (video + no usable dimensions [+ tenant]). */
  countCandidates(): Promise<number>;
  /** One page of candidates, ordered by id ASC, strictly after `afterId`. */
  fetchBatch(afterId: string | null, take: number): Promise<BackfillAssetRow[]>;
  /** Bucket-relative path of OUR object, or null for an external URL (skipped). */
  storagePathFor(row: BackfillAssetRow): string | null;
  /** Run ffprobe against the object. LIVE RUNS ONLY. Never throws. */
  probe(row: BackfillAssetRow, storagePath: string): Promise<ProbeOutcome>;
  /**
   * Tenant-scoped MERGE of `buildProbeMeta(probe)` into `processingMeta`,
   * guarded by "still has no usable dimensions". Returns rows changed — 0 when
   * another run (or an upload-time probe) got there first.
   */
  persist(row: BackfillAssetRow, probe: ProbeSuccess): Promise<number>;
  log(line: string): void;
  sleep(ms: number): Promise<void>;
}

export type ProbeBackfillOptions = BackfillLoopOptions;

export interface ProbeBackfillSummary {
  scanned: number;
  /** Rows probed + written (live) or that WOULD be (dry run). */
  probed: number;
  skippedExternal: number;
  failed: number;
  alreadySet: number;
  /** Last id processed — pass back as `--after=` to resume. */
  lastId: string | null;
  dryRun: boolean;
}

const PROBE_COPY: BackfillLoopCopy<BackfillAssetRow, ProbeSuccess> = {
  title: 'Video dimensions backfill',
  candidateNoun: 'videos w/o dimensions',
  nothingToDo: 'every video already has dimensions',
  wouldTag: 'would-probe',
  progressVerb: { dry: 'would-probe', live: 'probed' },
  summaryVerb: { dry: 'would probe', live: 'probed' },
  describe: (p) => {
    const dur = formatDurationMs(p.durationMs);
    return (
      ` → ${p.displayWidth}×${p.displayHeight}` +
      (dur ? ` · ${dur}` : '') +
      (p.codec ? ` · ${p.codec}` : '') +
      (p.rotation ? ` (rotated ${p.rotation}°)` : '')
    );
  },
  failedNote: 'stays unprobed, safe to re-run',
  alreadySetNote: 'dimensions set by another run, left as-is',
};

export async function runProbeBackfill(
  deps: ProbeBackfillDeps,
  opts: ProbeBackfillOptions,
): Promise<ProbeBackfillSummary> {
  const s = await runAssetBackfill<BackfillAssetRow, ProbeSuccess>(
    {
      countCandidates: () => deps.countCandidates(),
      fetchBatch: (afterId, take) => deps.fetchBatch(afterId, take),
      storagePathFor: (row) => deps.storagePathFor(row),
      produce: async (row, storagePath) => {
        const out = await deps.probe(row, storagePath);
        return out.ok ? { ok: true, value: out } : out;
      },
      persist: (row, p) => deps.persist(row, p),
      log: (line) => deps.log(line),
      sleep: (ms) => deps.sleep(ms),
    },
    opts,
    PROBE_COPY,
  );
  return {
    scanned: s.scanned,
    probed: s.written,
    skippedExternal: s.skippedExternal,
    failed: s.failed,
    alreadySet: s.alreadySet,
    lastId: s.lastId,
    dryRun: s.dryRun,
  };
}
