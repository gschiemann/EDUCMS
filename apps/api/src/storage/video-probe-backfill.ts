/**
 * video-probe-backfill.ts — the PROBE half of `scripts/backfill-video-posters.ts`
 * (dimensions + the codec facts the signage-compatibility grader reads).
 *
 * WHY: new uploads get their width × height / duration probed automatically
 * (VideoPosterService runs ffprobe beside the poster grab, 2026-09-24). Every
 * video uploaded BEFORE that has `processingMeta` NULL — or, for the ones the
 * 2026-09-11 poster backfill touched, a poster but still no dimensions — and
 * the media library shows "—" for its resolution. This pass closes that gap.
 * Since probe version 2 (same day, operator: "why can't we check the file for
 * fps, the codec, and anything else that the signage might not display
 * properly") it also re-probes, exactly once, every row a version-1 pass
 * wrote: those carry dimensions but none of the facts a warning needs.
 *
 * The loop is `asset-backfill-loop.ts`, shared with the poster backfill; this
 * file supplies the probe-specific step (`probe` → a `ProbeSuccess`), the
 * guarded MERGE into `processingMeta` (the CLI's `persist` re-asserts
 * "still lacks a current probe" in the same statement as the write, and merges
 * rather than replaces so a poster-era key is never clobbered), and the words.
 *
 * A row is a candidate when it is a video and `needsProbe(meta)` is true —
 * no usable dimensions, OR a `probe.probeVersion` older than `PROBE_VERSION`,
 * UNLESS the current version has already failed on it (`probeFailed` +
 * `probeFailedVersion`, stamped by the API at upload time or by this pass) —
 * whether or not it already has a poster. Those are independent columns
 * filled by independent steps, and the backfill treats them that way. The
 * SQL twin of that predicate is `NEEDS_PROBE` in the CLI.
 */
import {
  runAssetBackfill,
  type BackfillAssetRow,
  type BackfillLoopCopy,
  type BackfillLoopOptions,
} from './asset-backfill-loop';
import {
  describeProbe,
  PROBE_VERSION,
  type ProbeOutcome,
  type ProbeSuccess,
} from './video-probe';
import { Prisma } from '@cms/database';

export type { BackfillAssetRow } from './asset-backfill-loop';

// ── The candidate predicate, as SQL ─────────────────────────────────────────
// Prisma's JSON filters cannot express "key missing or not a number", and the
// SAME predicate has to sit inside the UPDATE that writes the facts (the guard
// and the write in one statement is what makes a pass idempotent under a
// concurrent run or an upload-time probe). Shared by the CLI backfill
// (scripts/backfill-video-posters.ts) and the in-API auto-heal cron
// (video-probe-autoheal.cron.ts), so the two can never disagree about which
// rows still need a probe. In-process twin: `needsProbe()` in video-probe.ts.

/**
 * "This video row still has no usable dimensions". `jsonb_typeof(NULL)` is
 * NULL, so a NULL column, an empty object and a missing key all qualify.
 */
export const NO_USABLE_DIMS_SQL = Prisma.sql`jsonb_typeof(processing_meta->'originalDimensions'->'w') IS DISTINCT FROM 'number'`;

/** The current `PROBE_VERSION` as a jsonb literal — `'2'::jsonb` is the number 2. */
const PROBE_VERSION_JSONB = Prisma.sql`${JSON.stringify(PROBE_VERSION)}::jsonb`;

/**
 * "This video row has no CURRENT probe" — the SQL twin of `!hasCurrentProbe()`:
 * no usable dimensions, OR a `probe.probeVersion` that is not the current
 * `PROBE_VERSION`. A row the version-1 pass wrote (dims, no version marker)
 * matches once; the version-2 write stamps the marker and it never matches
 * again. Compared as jsonb against the number itself rather than
 * `(...->>'probeVersion')::int`, so a non-numeric value in that slot (we never
 * write one, but a cast would make the WHOLE pass throw) simply counts as
 * "not current" and is re-probed — the same answer the in-process guard gives.
 */
export const NO_CURRENT_PROBE_SQL = Prisma.sql`(${NO_USABLE_DIMS_SQL} OR processing_meta->'probe'->'probeVersion' IS DISTINCT FROM ${PROBE_VERSION_JSONB})`;

/**
 * "The current probe version already FAILED on this row" — the twin of
 * `hasCurrentProbeFailure()`: a `probeFailed` string plus `probeFailedVersion`
 * equal to the current version. COALESCE'd to false so NULL meta can never
 * make the surrounding NOT go NULL and silently drop candidates.
 */
export const CURRENT_PROBE_FAILURE_SQL = Prisma.sql`COALESCE(jsonb_typeof(processing_meta->'probeFailed') = 'string' AND processing_meta->'probeFailedVersion' = ${PROBE_VERSION_JSONB}, false)`;

/**
 * "This video row still needs a probe" — the twin of `needsProbe()`: no
 * current probe, and not already failed by the current version either, so a
 * permanently unreadable file is tried ONCE per version, not on every run.
 * `retryFailed` drops the second clause (the CLI's `--retry-failed`).
 */
export function needsProbeSql(retryFailed = false): Prisma.Sql {
  return retryFailed
    ? NO_CURRENT_PROBE_SQL
    : Prisma.sql`(${NO_CURRENT_PROBE_SQL} AND NOT ${CURRENT_PROBE_FAILURE_SQL})`;
}

export interface ProbeBackfillDeps {
  /** Total rows matching the candidate filter (video + no current probe [+ tenant]). */
  countCandidates(): Promise<number>;
  /** One page of candidates, ordered by id ASC, strictly after `afterId`. */
  fetchBatch(afterId: string | null, take: number): Promise<BackfillAssetRow[]>;
  /** Bucket-relative path of OUR object, or null for an external URL (skipped). */
  storagePathFor(row: BackfillAssetRow): string | null;
  /** Run ffprobe against the object. LIVE RUNS ONLY. Never throws. */
  probe(row: BackfillAssetRow, storagePath: string): Promise<ProbeOutcome>;
  /**
   * Tenant-scoped MERGE of `buildProbeMeta(probe)` into `processingMeta`,
   * guarded by "still needs a probe". Returns rows changed — 0 when another
   * run (or an upload-time probe) got there first.
   */
  persist(row: BackfillAssetRow, probe: ProbeSuccess): Promise<number>;
  /**
   * Tenant-scoped MERGE of `buildProbeFailureMeta(reason)` — `probedAt`,
   * `probeFailed`, `probeFailedVersion` — under the same guard, so a row the
   * current version cannot read is tried ONCE per version, not on every run
   * (`--retry-failed` in the CLI widens the guard again). Never touches the
   * dimensions. Returns rows changed.
   */
  persistFailure(row: BackfillAssetRow, reason: string): Promise<number>;
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
  title: 'Video probe backfill (dimensions + codec facts)',
  candidateNoun: 'videos w/o a current probe',
  nothingToDo: 'every video already carries a current probe',
  wouldTag: 'would-probe',
  progressVerb: { dry: 'would-probe', live: 'probed' },
  summaryVerb: { dry: 'would probe', live: 'probed' },
  describe: (p) => ` → ${describeProbe(p)}`,
  failedNote: 'not stamped — retried next run',
  failedStampedNote:
    'stamped probeFailed; retried on the next probe version or with --retry-failed',
  alreadySetNote: 'probed by another run, left as-is',
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
      persistFailure: (row, reason) => deps.persistFailure(row, reason),
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
