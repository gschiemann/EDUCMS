/**
 * video-probe-backfill.spec.ts — the probe backfill's four promises:
 * DRY-RUN BY DEFAULT, idempotent, resumable, rate-limited — plus the three
 * that are specific to it: a row that already has a POSTER but no probe is
 * still a candidate (independent columns); a row a VERSION-1 pass probed is a
 * candidate exactly once more (it has dimensions but none of the facts the
 * signage grader reads) — after which a second `--apply` changes nothing; and
 * a row the probe FAILS on is stamped (`probedAt` + `probeFailed` +
 * `probeFailedVersion`) and tried once per version, not on every run.
 *
 * This runs the REAL loop `scripts/backfill-video-posters.ts --only=dimensions`
 * runs, against an in-memory fixture set that behaves like the SQL the script
 * issues (candidate = video mime + `NEEDS_PROBE`, i.e. (no usable dimensions OR
 * `probe.probeVersion` IS DISTINCT FROM 2) AND NOT already failed by version 2;
 * both writes MERGE and re-assert the same predicate). `needsProbe` is the
 * in-process twin of that SQL.
 */
import {
  runProbeBackfill,
  type BackfillAssetRow,
  type ProbeBackfillDeps,
} from './video-probe-backfill';
import {
  buildProbeFailureMeta,
  buildProbeMeta,
  hasCurrentProbe,
  hasCurrentProbeFailure,
  hasUsableDimensions,
  needsProbe,
  PROBE_VERSION,
  type ProbeSuccess,
} from './video-probe';

interface Row extends BackfillAssetRow {
  posterUrl: string | null;
  processingMeta: Record<string, unknown> | null;
}

const PROBE: ProbeSuccess = {
  ok: true,
  width: 1920,
  height: 1080,
  displayWidth: 1920,
  displayHeight: 1080,
  durationMs: 75_400,
  codec: 'h264',
  profile: 'High',
  level: 41,
  pixFmt: 'yuv420p',
  fps: 30,
  nominalFps: 30,
  variableFrameRate: false,
  bitrateKbps: 4523,
  rotation: 0,
  container: 'mov,mp4,m4a,3gp,3g2,mj2',
  fastStart: false,
  audio: { codec: 'aac', channels: 2, sampleRate: 48000 },
};

/** Exactly what today's version-1 pass left on a row: dims, no marker, no facts. */
const V1_META: Record<string, unknown> = {
  originalDimensions: { w: 1280, h: 720 },
  processedDimensions: null,
  durationMs: 2000,
  probe: {
    codec: 'h264',
    fps: 30,
    rotation: 0,
    codedWidth: 1280,
    codedHeight: 720,
  },
  probedAt: '2026-09-24T09:00:00.000Z',
};
/** A row the current code probed — the shape this pass writes. */
const V2_META: Record<string, unknown> = { ...buildProbeMeta(PROBE) };
/** A failure with no version mark — earns exactly one version-2 attempt. */
const FAILED_UNVERSIONED: Record<string, unknown> = {
  probedAt: '2026-09-24T09:00:00.000Z',
  probeFailed: 'no-video-stream',
};
/** A failure the CURRENT version already stamped (API at upload, or this pass). */
const FAILED_V2: Record<string, unknown> = {
  ...buildProbeFailureMeta('no-video-stream'),
};

/** An in-memory stand-in for the `assets` table + the ffprobe step. */
function makeFixture(rows: Row[], opts: { failOn?: Set<string> } = {}) {
  const table = rows.map((r) => ({ ...r }));
  const log: string[] = [];
  const sleeps: number[] = [];
  const probeCalls: string[] = [];
  const hooks: { beforeProbe?: (row: BackfillAssetRow) => void } = {};

  // The SQL twin: `mime_type LIKE 'video/%' AND NEEDS_PROBE`.
  const candidates = () =>
    table.filter(
      (r) => r.mimeType.startsWith('video/') && needsProbe(r.processingMeta),
    );
  /** The guard inside both writes — the same predicate as the candidate filter. */
  const stillNeeds = (row: BackfillAssetRow) =>
    table.find(
      (r) =>
        r.id === row.id &&
        r.tenantId === row.tenantId &&
        needsProbe(r.processingMeta),
    );

  const deps: ProbeBackfillDeps = {
    countCandidates: () => Promise.resolve(candidates().length),
    fetchBatch: (afterId, take) =>
      Promise.resolve(
        candidates()
          .filter((r) => (afterId ? r.id > afterId : true))
          .sort((a, b) => (a.id < b.id ? -1 : 1))
          .slice(0, take)
          .map(({ id, tenantId, fileUrl, mimeType, originalName }) => ({
            id,
            tenantId,
            fileUrl,
            mimeType,
            originalName,
          })),
      ),
    storagePathFor: (row) =>
      row.fileUrl.includes('/object/public/assets/')
        ? row.fileUrl.split('/object/public/assets/')[1]
        : null,
    probe: (row) => {
      probeCalls.push(row.id);
      hooks.beforeProbe?.(row);
      if (opts.failOn?.has(row.id))
        return Promise.resolve({ ok: false, reason: 'Invalid data found' });
      return Promise.resolve(PROBE);
    },
    // Mirrors the script's guarded UPDATE: tenant-scoped, drops an earlier
    // failure stamp, MERGES the probe's keys over whatever is there (jsonb
    // `||` is shallow, so the whole `probe` block is replaced), and only
    // while the row still NEEDS a probe.
    persist: (row, p) => {
      const hit = stillNeeds(row);
      if (!hit) return Promise.resolve(0);
      const {
        probeFailed: _f,
        probeFailedVersion: _v,
        ...rest
      } = hit.processingMeta ?? {};
      void _f;
      void _v;
      hit.processingMeta = { ...rest, ...buildProbeMeta(p) };
      return Promise.resolve(1);
    },
    // Mirrors the script's failure stamp: same guard, MERGES the three failure
    // keys, never touches the dimensions.
    persistFailure: (row, reason) => {
      const hit = stillNeeds(row);
      if (!hit) return Promise.resolve(0);
      hit.processingMeta = {
        ...(hit.processingMeta ?? {}),
        ...buildProbeFailureMeta(reason),
      };
      return Promise.resolve(1);
    },
    log: (line) => log.push(line),
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
  };

  return { deps, table, log, sleeps, probeCalls, hooks };
}

const video = (id: string, extra: Partial<Row> = {}): Row => ({
  id,
  tenantId: 'tenant-1',
  fileUrl: `https://proj.supabase.co/storage/v1/object/public/assets/tenant-1/${id}.mp4`,
  mimeType: 'video/mp4',
  originalName: `${id}.mp4`,
  posterUrl: null,
  processingMeta: null,
  ...extra,
});

const OPTS = {
  dryRun: false,
  batch: 10,
  limit: Number.MAX_SAFE_INTEGER,
  delayMs: 400,
};

const snapshot = (table: Row[]) =>
  table.map((r) => JSON.stringify(r.processingMeta));
const rowById = (table: Row[], id: string) => table.find((r) => r.id === id)!;

describe('DRY RUN is the default posture', () => {
  it('writes nothing, probes nothing, and reports exactly what it WOULD do', async () => {
    const f = makeFixture([
      video('a1'),
      video('a2', { processingMeta: V1_META }),
      video('a3', { processingMeta: FAILED_UNVERSIONED }),
    ]);
    const before = snapshot(f.table);
    const s = await runProbeBackfill(f.deps, { ...OPTS, dryRun: true });

    expect(s.probed).toBe(3);
    expect(s.dryRun).toBe(true);
    expect(f.probeCalls).toEqual([]);
    expect(snapshot(f.table)).toEqual(before);
    expect(f.log.join('\n')).toContain(
      'Video probe backfill (dimensions + codec facts) (DRY RUN — no writes, no downloads)',
    );
    expect(f.log.filter((l) => l.includes('[would-probe  ]'))).toHaveLength(3);
    expect(f.sleeps).toEqual([]);
  });

  it('a dry run over an already-current library is a clean no-op', async () => {
    const f = makeFixture([
      video('a1', { processingMeta: V2_META }),
      video('a2', { processingMeta: FAILED_V2 }),
    ]);
    const s = await runProbeBackfill(f.deps, { ...OPTS, dryRun: true });
    expect(s).toMatchObject({ scanned: 0, probed: 0, failed: 0 });
    expect(f.log.join('\n')).toContain(
      'Nothing to do — every video already carries a current probe',
    );
  });
});

describe('what counts as a candidate', () => {
  it('a row with a POSTER but no probe is still probed — the columns are independent', async () => {
    const f = makeFixture([
      video('a1', { posterUrl: 'https://cdn.test/posters/a1.jpg' }),
      video('a2', {
        posterUrl: 'https://cdn.test/posters/a2.jpg',
        processingMeta: {},
      }),
    ]);
    const s = await runProbeBackfill(f.deps, OPTS);
    expect(s.probed).toBe(2);
    expect(f.probeCalls).toEqual(['a1', 'a2']);
    expect(f.table.every((r) => hasCurrentProbe(r.processingMeta))).toBe(true);
  });

  it('a VERSION-1 row (dimensions, no probeVersion) is a candidate and comes out version 2', async () => {
    const f = makeFixture([video('a1', { processingMeta: V1_META })]);
    expect(hasUsableDimensions(V1_META)).toBe(true); // it was "done" to the old pass…
    expect(hasCurrentProbe(V1_META)).toBe(false); // …and is not to this one
    expect(needsProbe(V1_META)).toBe(true);

    const s = await runProbeBackfill(f.deps, OPTS);
    expect(s).toMatchObject({ scanned: 1, probed: 1, failed: 0 });
    const meta = f.table[0].processingMeta!;
    expect(meta.probe).toMatchObject({
      probeVersion: PROBE_VERSION,
      codec: 'h264',
      profile: 'High',
      level: 41,
      fastStart: false,
      audio: { codec: 'aac', channels: 2, sampleRate: 48000 },
    });
    // The old block is REPLACED, never merged key-by-key under the new marker.
    expect(Object.keys(meta.probe as object)).toEqual(
      Object.keys(V2_META.probe as object),
    );
    expect(hasCurrentProbe(meta)).toBe(true);
  });

  it('a VERSION-2 row is invisible — even with no poster', async () => {
    const f = makeFixture([
      video('a1', { processingMeta: V2_META }),
      video('a2'),
      video('a3', { mimeType: 'image/png' }),
    ]);
    const s = await runProbeBackfill(f.deps, OPTS);
    expect(s.scanned).toBe(1);
    expect(f.probeCalls).toEqual(['a2']);
    // The current value was never touched.
    expect(f.table[0].processingMeta).toEqual(V2_META);
  });

  it('writes the SAME shape the upload-time probe writes, merged over existing keys', async () => {
    const f = makeFixture([
      video('a1', {
        processingMeta: { originalSize: 9, skippedReason: 'legacy' },
      }),
    ]);
    await runProbeBackfill(f.deps, OPTS);
    const meta = f.table[0].processingMeta!;
    expect(meta.originalSize).toBe(9);
    expect(meta.skippedReason).toBe('legacy');
    expect(meta).toMatchObject({
      originalDimensions: { w: 1920, h: 1080 },
      processedDimensions: null,
      durationMs: 75_400,
      probe: buildProbeMeta(PROBE).probe,
    });
    expect(typeof meta.probedAt).toBe('string');
    expect(f.log.join('\n')).toContain(
      '[wrote        ] "a1.mp4" → 1920×1080 · 1:15 · h264 High L41 · 30 fps · 4523 kbps · moov last · aac 2ch',
    );
  });
});

describe('a FAILED probe: stamped, and tried once per version', () => {
  it('a failure with no version mark is a candidate for ONE version-2 attempt; a repeat failure stamps it and it stays', async () => {
    const f = makeFixture(
      [video('a1', { processingMeta: FAILED_UNVERSIONED })],
      { failOn: new Set(['a1']) },
    );
    expect(needsProbe(FAILED_UNVERSIONED)).toBe(true);

    const first = await runProbeBackfill(f.deps, OPTS);
    expect(first).toMatchObject({ scanned: 1, probed: 0, failed: 1 });
    const meta = f.table[0].processingMeta!;
    expect(meta).toMatchObject({
      probeFailed: 'Invalid data found',
      probeFailedVersion: PROBE_VERSION,
    });
    expect(typeof meta.probedAt).toBe('string');
    expect(meta.probedAt).not.toBe(FAILED_UNVERSIONED.probedAt); // a fresh stamp
    expect(hasCurrentProbeFailure(meta)).toBe(true);
    expect(f.log.join('\n')).toContain(
      'stamped probeFailed; retried on the next probe version or with --retry-failed',
    );

    // The next run does not touch it again.
    const second = await runProbeBackfill(makeFixture(f.table).deps, OPTS);
    expect(second).toMatchObject({ scanned: 0, probed: 0, failed: 0 });
  });

  it('a failure the current version already stamped is NOT a candidate', async () => {
    const f = makeFixture([
      video('a1', { processingMeta: FAILED_V2 }),
      video('a2'),
    ]);
    expect(needsProbe(FAILED_V2)).toBe(false);
    const s = await runProbeBackfill(f.deps, OPTS);
    expect(s.scanned).toBe(1);
    expect(f.probeCalls).toEqual(['a2']);
    expect(f.table[0].processingMeta).toEqual(FAILED_V2);
  });

  it('the failure stamp never touches the dimensions — a version-1 row that fails its retry keeps them', async () => {
    const f = makeFixture([video('a1', { processingMeta: V1_META })], {
      failOn: new Set(['a1']),
    });
    await runProbeBackfill(f.deps, OPTS);
    const meta = f.table[0].processingMeta!;
    expect(meta.originalDimensions).toEqual({ w: 1280, h: 720 });
    expect(meta.durationMs).toBe(2000);
    expect(meta.probe).toEqual(V1_META.probe);
    expect(meta).toMatchObject({
      probeFailed: 'Invalid data found',
      probeFailedVersion: PROBE_VERSION,
    });
    expect(needsProbe(meta)).toBe(false);
  });

  it('a later SUCCESS clears the failure keys — facts and "the probe failed" never coexist', async () => {
    const f = makeFixture([
      video('a1', {
        processingMeta: { ...FAILED_UNVERSIONED, originalSize: 7 },
      }),
    ]);
    const s = await runProbeBackfill(f.deps, OPTS);
    expect(s.probed).toBe(1);
    const meta = f.table[0].processingMeta!;
    expect('probeFailed' in meta).toBe(false);
    expect('probeFailedVersion' in meta).toBe(false);
    expect(meta.originalSize).toBe(7);
    expect(hasCurrentProbe(meta)).toBe(true);
  });

  it('a failed row does not wedge the page — the cursor moves on and the rest of the page is written', async () => {
    const f = makeFixture([video('a1'), video('a2'), video('a3')], {
      failOn: new Set(['a2']),
    });
    const s = await runProbeBackfill(f.deps, OPTS);
    expect(s).toMatchObject({ scanned: 3, probed: 2, failed: 1 });
    expect(s.lastId).toBe('a3');
    expect(hasCurrentProbe(rowById(f.table, 'a1').processingMeta)).toBe(true);
    expect(hasCurrentProbe(rowById(f.table, 'a3').processingMeta)).toBe(true);
    expect(hasCurrentProbeFailure(rowById(f.table, 'a2').processingMeta)).toBe(
      true,
    );
  });
});

describe('idempotency', () => {
  it('a second LIVE run is a no-op — nothing is re-probed or overwritten', async () => {
    const f = makeFixture(
      [
        video('a1'),
        video('a2', { processingMeta: V1_META }),
        video('a3', { processingMeta: FAILED_UNVERSIONED }),
      ],
      { failOn: new Set(['a3']) },
    );

    const first = await runProbeBackfill(f.deps, OPTS);
    expect(first).toMatchObject({ probed: 2, failed: 1 });
    const metaAfterFirst = snapshot(f.table);

    f.probeCalls.length = 0;
    const second = await runProbeBackfill(f.deps, OPTS);

    expect(second).toMatchObject({ scanned: 0, probed: 0, failed: 0 });
    expect(f.probeCalls).toEqual([]);
    expect(snapshot(f.table)).toEqual(metaAfterFirst);
  });

  it('never overwrites a current probe written by a concurrent run between fetch and write', async () => {
    const f = makeFixture([video('a1')]);
    f.hooks.beforeProbe = () => {
      // The other run (or an upload-time probe) wins while ffprobe works.
      f.table[0].processingMeta = {
        ...buildProbeMeta({ ...PROBE, displayWidth: 640, displayHeight: 360 }),
      };
    };

    const s = await runProbeBackfill(f.deps, OPTS);

    expect(s.alreadySet).toBe(1);
    expect(s.probed).toBe(0);
    expect(f.table[0].processingMeta!.originalDimensions).toEqual({
      w: 640,
      h: 360,
    });
    expect(f.log.join('\n')).toContain('probed by another run, left as-is');
  });

  it('a failure stamp never overwrites a current probe written concurrently either', async () => {
    const f = makeFixture([video('a1')], { failOn: new Set(['a1']) });
    f.hooks.beforeProbe = () => {
      f.table[0].processingMeta = { ...V2_META };
    };
    const s = await runProbeBackfill(f.deps, OPTS);
    expect(s.failed).toBe(1);
    expect(f.table[0].processingMeta).toEqual(V2_META);
    expect(f.log.join('\n')).toContain('not stamped — retried next run');
  });

  it('a concurrent VERSION-1 write does not block the version-2 write — the guard is the marker, not the dims', async () => {
    const f = makeFixture([video('a1')]);
    f.hooks.beforeProbe = () => {
      f.table[0].processingMeta = { ...V1_META };
    };
    const s = await runProbeBackfill(f.deps, OPTS);
    expect(s.probed).toBe(1);
    expect(hasCurrentProbe(f.table[0].processingMeta)).toBe(true);
  });
});

describe('resumability', () => {
  it('--after / --limit resume cleanly and the summary names the resume point', async () => {
    const f = makeFixture([video('a1'), video('a2'), video('a3'), video('a4')]);
    const first = await runProbeBackfill(f.deps, { ...OPTS, limit: 2 });
    expect(first.scanned).toBe(2);
    expect(first.lastId).toBe('a2');
    expect(f.log.join('\n')).toContain('resume with        : --after=a2');

    const second = await runProbeBackfill(f.deps, {
      ...OPTS,
      afterId: first.lastId,
    });
    expect(f.probeCalls).toEqual(['a1', 'a2', 'a3', 'a4']);
    expect(second.scanned).toBe(2);
  });
});

describe('rate limiting + external assets', () => {
  it('pauses between rows on a live run — including after a failure', async () => {
    const f = makeFixture([video('a1'), video('a2')], {
      failOn: new Set(['a2']),
    });
    await runProbeBackfill(f.deps, { ...OPTS, delayMs: 250 });
    expect(f.sleeps).toEqual([250, 250]);
  });

  it('skips assets whose bytes we do not own (a pasted external URL)', async () => {
    const f = makeFixture([
      video('a1'),
      video('a2', { fileUrl: 'https://cdn.partner.example/promo.mp4' }),
    ]);
    const s = await runProbeBackfill(f.deps, OPTS);
    expect(s.skippedExternal).toBe(1);
    expect(f.probeCalls).toEqual(['a1']); // ffprobe never points at a third-party URL
  });
});
