/**
 * video-probe-backfill.spec.ts — the dimensions backfill's four promises:
 * DRY-RUN BY DEFAULT, idempotent, resumable, rate-limited — plus the one
 * that is specific to it: a row that already has a POSTER but no dimensions
 * is still a candidate, because the two are independent columns.
 *
 * This runs the REAL loop `scripts/backfill-video-posters.ts --only=dimensions`
 * runs, against an in-memory fixture set that behaves like the SQL the script
 * issues (candidate = video mime + no usable dimensions; the write MERGES and
 * re-asserts "still no usable dimensions").
 */
import {
  runProbeBackfill,
  type BackfillAssetRow,
  type ProbeBackfillDeps,
} from './video-probe-backfill';
import {
  buildProbeMeta,
  hasUsableDimensions,
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
  fps: 30,
  rotation: 0,
};

/** An in-memory stand-in for the `assets` table + the ffprobe step. */
function makeFixture(rows: Row[], opts: { failOn?: Set<string> } = {}) {
  const table = rows.map((r) => ({ ...r }));
  const log: string[] = [];
  const sleeps: number[] = [];
  const probeCalls: string[] = [];

  const candidates = () =>
    table.filter(
      (r) =>
        r.mimeType.startsWith('video/') &&
        !hasUsableDimensions(r.processingMeta),
    );

  const deps: ProbeBackfillDeps = {
    countCandidates: async () => candidates().length,
    fetchBatch: async (afterId, take) =>
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
    storagePathFor: (row) =>
      row.fileUrl.includes('/object/public/assets/')
        ? row.fileUrl.split('/object/public/assets/')[1]
        : null,
    probe: async (row) => {
      probeCalls.push(row.id);
      if (opts.failOn?.has(row.id))
        return { ok: false, reason: 'Invalid data found' };
      return PROBE;
    },
    // Mirrors the script's guarded UPDATE: tenant-scoped, MERGES the probe's
    // keys over whatever is there, and only when there are still no dims.
    persist: async (row, p) => {
      const hit = table.find(
        (r) =>
          r.id === row.id &&
          r.tenantId === row.tenantId &&
          !hasUsableDimensions(r.processingMeta),
      );
      if (!hit) return 0;
      hit.processingMeta = {
        ...(hit.processingMeta ?? {}),
        ...buildProbeMeta(p),
      };
      return 1;
    },
    log: (line) => log.push(line),
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  };

  return { deps, table, log, sleeps, probeCalls };
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

const WITH_DIMS = { originalDimensions: { w: 1280, h: 720 } };

const OPTS = {
  dryRun: false,
  batch: 10,
  limit: Number.MAX_SAFE_INTEGER,
  delayMs: 400,
};

describe('DRY RUN is the default posture', () => {
  it('writes nothing, probes nothing, and reports exactly what it WOULD do', async () => {
    const f = makeFixture([video('a1'), video('a2'), video('a3')]);
    const s = await runProbeBackfill(f.deps, { ...OPTS, dryRun: true });

    expect(s.probed).toBe(3);
    expect(s.dryRun).toBe(true);
    expect(f.probeCalls).toEqual([]);
    expect(f.table.every((r) => r.processingMeta === null)).toBe(true);
    expect(f.log.join('\n')).toContain(
      'Video dimensions backfill (DRY RUN — no writes, no downloads)',
    );
    expect(f.log.filter((l) => l.includes('[would-probe  ]'))).toHaveLength(3);
    expect(f.sleeps).toEqual([]);
  });

  it('a dry run over an already-complete library is a clean no-op', async () => {
    const f = makeFixture([video('a1', { processingMeta: WITH_DIMS })]);
    const s = await runProbeBackfill(f.deps, { ...OPTS, dryRun: true });
    expect(s).toMatchObject({ scanned: 0, probed: 0, failed: 0 });
    expect(f.log.join('\n')).toContain(
      'Nothing to do — every video already has dimensions',
    );
  });
});

describe('what counts as a candidate', () => {
  it('a row with a POSTER but no dimensions is still probed — the columns are independent', async () => {
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
    expect(f.table.every((r) => hasUsableDimensions(r.processingMeta))).toBe(
      true,
    );
  });

  it('a row that already has dimensions is invisible — even with no poster', async () => {
    const f = makeFixture([
      video('a1', { processingMeta: WITH_DIMS }),
      video('a2'),
      video('a3', { mimeType: 'image/png' }),
    ]);
    const s = await runProbeBackfill(f.deps, OPTS);
    expect(s.scanned).toBe(1);
    expect(f.probeCalls).toEqual(['a2']);
    // The good value was never touched.
    expect(f.table[0].processingMeta).toEqual(WITH_DIMS);
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
      probe: {
        codec: 'h264',
        fps: 30,
        rotation: 0,
        codedWidth: 1920,
        codedHeight: 1080,
      },
    });
    expect(typeof meta.probedAt).toBe('string');
    expect(f.log.join('\n')).toContain(
      '[wrote        ] "a1.mp4" → 1920×1080 · 1:15 · h264',
    );
  });
});

describe('idempotency', () => {
  it('a second LIVE run is a no-op — nothing is re-probed or overwritten', async () => {
    const f = makeFixture([video('a1'), video('a2')]);

    const first = await runProbeBackfill(f.deps, OPTS);
    expect(first.probed).toBe(2);
    const metaAfterFirst = f.table.map((r) => JSON.stringify(r.processingMeta));

    f.probeCalls.length = 0;
    const second = await runProbeBackfill(f.deps, OPTS);

    expect(second).toMatchObject({ scanned: 0, probed: 0, failed: 0 });
    expect(f.probeCalls).toEqual([]);
    expect(f.table.map((r) => JSON.stringify(r.processingMeta))).toEqual(
      metaAfterFirst,
    );
  });

  it('never overwrites dimensions set by a concurrent run between fetch and write', async () => {
    const f = makeFixture([video('a1')]);
    const realProbe = f.deps.probe;
    f.deps.probe = async (row, path) => {
      // The other run (or an upload-time probe) wins while ffprobe works.
      f.table[0].processingMeta = { originalDimensions: { w: 640, h: 360 } };
      return realProbe(row, path);
    };

    const s = await runProbeBackfill(f.deps, OPTS);

    expect(s.alreadySet).toBe(1);
    expect(s.probed).toBe(0);
    expect(f.table[0].processingMeta).toEqual({
      originalDimensions: { w: 640, h: 360 },
    });
    expect(f.log.join('\n')).toContain(
      'dimensions set by another run, left as-is',
    );
  });
});

describe('resumability', () => {
  it('a failed row stays a candidate, does not wedge the page, and is retried next run', async () => {
    const f = makeFixture([video('a1'), video('a2'), video('a3')], {
      failOn: new Set(['a2']),
    });

    const first = await runProbeBackfill(f.deps, OPTS);
    expect(first).toMatchObject({ scanned: 3, probed: 2, failed: 1 });
    expect(f.table.find((r) => r.id === 'a2')!.processingMeta).toBeNull();
    expect(f.log.join('\n')).toContain('stays unprobed, safe to re-run');

    f.deps.probe = async () => PROBE;
    const second = await runProbeBackfill(f.deps, OPTS);
    expect(second).toMatchObject({ scanned: 1, probed: 1, failed: 0 });
    expect(
      hasUsableDimensions(f.table.find((r) => r.id === 'a2')!.processingMeta),
    ).toBe(true);
  });

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
