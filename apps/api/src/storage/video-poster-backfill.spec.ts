/**
 * video-poster-backfill.spec.ts — the backfill loop's four promises:
 * DRY-RUN BY DEFAULT, idempotent, resumable, rate-limited.
 *
 * This runs the REAL loop `scripts/backfill-video-posters.ts` runs, against an
 * in-memory fixture set that behaves like the Prisma queries the script issues
 * (candidate filter = video mime + posterUrl IS NULL; write re-asserts NULL).
 */
import {
  runPosterBackfill,
  type BackfillAssetRow,
  type BackfillDeps,
} from './video-poster-backfill';

interface Row extends BackfillAssetRow {
  posterUrl: string | null;
}

/** An in-memory stand-in for the `assets` table + the storage/ffmpeg step. */
function makeFixture(rows: Row[], opts: { failOn?: Set<string> } = {}) {
  const table = rows.map((r) => ({ ...r }));
  const log: string[] = [];
  const sleeps: number[] = [];
  const posterCalls: string[] = [];

  const candidates = () =>
    table.filter(
      (r) => r.posterUrl === null && r.mimeType.startsWith('video/'),
    );

  const deps: BackfillDeps = {
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
    // Anything not in our bucket is an external URL we don't own.
    storagePathFor: (row) =>
      row.fileUrl.includes('/object/public/assets/')
        ? row.fileUrl.split('/object/public/assets/')[1]
        : null,
    makePoster: async (row) => {
      posterCalls.push(row.id);
      if (opts.failOn?.has(row.id))
        return { ok: false, reason: 'Invalid data found' };
      return {
        ok: true,
        posterUrl: `https://cdn.test/posters/${row.id}.jpg`,
        bytes: 4242,
      };
    },
    // Mirrors the script's updateMany: tenant-scoped AND still-null-guarded.
    persist: async (row, posterUrl) => {
      const hit = table.find(
        (r) =>
          r.id === row.id &&
          r.tenantId === row.tenantId &&
          r.posterUrl === null,
      );
      if (!hit) return 0;
      hit.posterUrl = posterUrl;
      return 1;
    },
    log: (line) => log.push(line),
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  };

  return { deps, table, log, sleeps, posterCalls };
}

const video = (id: string, extra: Partial<Row> = {}): Row => ({
  id,
  tenantId: 'tenant-1',
  fileUrl: `https://proj.supabase.co/storage/v1/object/public/assets/tenant-1/${id}.mp4`,
  mimeType: 'video/mp4',
  originalName: `${id}.mp4`,
  posterUrl: null,
  ...extra,
});

const OPTS = {
  dryRun: false,
  batch: 10,
  limit: Number.MAX_SAFE_INTEGER,
  delayMs: 400,
};

describe('DRY RUN is the default posture', () => {
  it('writes nothing, downloads nothing, and reports exactly what it WOULD do', async () => {
    const f = makeFixture([video('a1'), video('a2'), video('a3')]);
    const s = await runPosterBackfill(f.deps, { ...OPTS, dryRun: true });

    expect(s.posted).toBe(3);
    expect(s.dryRun).toBe(true);
    // The whole point: no poster was ever generated (that means no video
    // download), and no row changed.
    expect(f.posterCalls).toEqual([]);
    expect(f.table.every((r) => r.posterUrl === null)).toBe(true);
    expect(f.log.join('\n')).toContain('DRY RUN — no writes, no downloads');
    expect(f.log.filter((l) => l.includes('[would-poster ]'))).toHaveLength(3);
  });

  it('a dry run over an already-complete library is a clean no-op', async () => {
    const f = makeFixture([
      video('a1', { posterUrl: 'https://cdn.test/p.jpg' }),
    ]);
    const s = await runPosterBackfill(f.deps, { ...OPTS, dryRun: true });
    expect(s).toMatchObject({ scanned: 0, posted: 0, failed: 0 });
    expect(f.log.join('\n')).toContain('Nothing to do');
  });
});

describe('idempotency', () => {
  it('a second LIVE run is a no-op — nothing is re-postered or overwritten', async () => {
    const f = makeFixture([video('a1'), video('a2')]);

    const first = await runPosterBackfill(f.deps, OPTS);
    expect(first.posted).toBe(2);
    const urlsAfterFirst = f.table.map((r) => r.posterUrl);
    expect(urlsAfterFirst.every(Boolean)).toBe(true);

    f.posterCalls.length = 0;
    const second = await runPosterBackfill(f.deps, OPTS);

    expect(second).toMatchObject({ scanned: 0, posted: 0, failed: 0 });
    expect(f.posterCalls).toEqual([]);
    expect(f.table.map((r) => r.posterUrl)).toEqual(urlsAfterFirst); // byte-identical
  });

  it('never overwrites a poster set by a concurrent run between fetch and write', async () => {
    const f = makeFixture([video('a1')]);
    const realMake = f.deps.makePoster;
    f.deps.makePoster = async (row, path) => {
      // Simulate the other run winning the race while ffmpeg was working.
      f.table[0].posterUrl = 'https://cdn.test/posters/from-other-run.jpg';
      return realMake(row, path);
    };

    const s = await runPosterBackfill(f.deps, OPTS);

    expect(s.alreadySet).toBe(1);
    expect(s.posted).toBe(0);
    expect(f.table[0].posterUrl).toBe(
      'https://cdn.test/posters/from-other-run.jpg',
    );
  });

  it('only ever touches videos with no poster — images and postered videos are invisible', async () => {
    const f = makeFixture([
      video('a1'),
      video('a2', { posterUrl: 'https://cdn.test/already.jpg' }),
      video('a3', { mimeType: 'image/png' }),
    ]);
    const s = await runPosterBackfill(f.deps, OPTS);
    expect(s.scanned).toBe(1);
    expect(f.posterCalls).toEqual(['a1']);
  });
});

describe('resumability', () => {
  it('a failed row keeps posterUrl NULL, does not wedge the page, and is retried next run', async () => {
    const f = makeFixture([video('a1'), video('a2'), video('a3')], {
      failOn: new Set(['a2']),
    });

    const first = await runPosterBackfill(f.deps, OPTS);
    expect(first).toMatchObject({ scanned: 3, posted: 2, failed: 1 });
    expect(f.table.find((r) => r.id === 'a2')!.posterUrl).toBeNull();
    expect(f.log.join('\n')).toContain('stays NULL, safe to re-run');

    // Second run sees only the failure — and this time it works.
    f.deps.makePoster = async (row) => ({
      ok: true,
      posterUrl: `https://cdn.test/${row.id}.jpg`,
    });
    const second = await runPosterBackfill(f.deps, OPTS);
    expect(second).toMatchObject({ scanned: 1, posted: 1, failed: 0 });
    expect(f.table.find((r) => r.id === 'a2')!.posterUrl).toBeTruthy();
  });

  it('--after resumes past work already done, and the summary names the resume point', async () => {
    const f = makeFixture([video('a1'), video('a2'), video('a3')]);
    const s = await runPosterBackfill(f.deps, { ...OPTS, afterId: 'a1' });
    expect(f.posterCalls).toEqual(['a2', 'a3']);
    expect(s.lastId).toBe('a3');
    expect(f.log.join('\n')).toContain('resume with        : --after=a3');
  });

  it('--limit bounds one run and the next resumes cleanly from where it stopped', async () => {
    const f = makeFixture([video('a1'), video('a2'), video('a3'), video('a4')]);
    const first = await runPosterBackfill(f.deps, {
      ...OPTS,
      limit: 2,
      batch: 10,
    });
    expect(first.scanned).toBe(2);
    expect(first.lastId).toBe('a2');

    const second = await runPosterBackfill(f.deps, {
      ...OPTS,
      afterId: first.lastId,
    });
    expect(f.posterCalls).toEqual(['a1', 'a2', 'a3', 'a4']);
    expect(second.scanned).toBe(2);
  });

  it('pages through a large set without re-reading rows it already did', async () => {
    const rows = Array.from({ length: 25 }, (_, i) =>
      video(`a${String(i).padStart(2, '0')}`),
    );
    const f = makeFixture(rows);
    const s = await runPosterBackfill(f.deps, { ...OPTS, batch: 5 });
    expect(s.scanned).toBe(25);
    expect(f.posterCalls).toHaveLength(25);
    expect(new Set(f.posterCalls).size).toBe(25); // no row processed twice
  });
});

describe('rate limiting + external assets', () => {
  it('pauses between rows on a live run — including after a failure', async () => {
    const f = makeFixture([video('a1'), video('a2')], {
      failOn: new Set(['a2']),
    });
    await runPosterBackfill(f.deps, { ...OPTS, delayMs: 400 });
    expect(f.sleeps).toEqual([400, 400]);
  });

  it('never sleeps in a dry run — nothing is being hammered', async () => {
    const f = makeFixture([video('a1'), video('a2')]);
    await runPosterBackfill(f.deps, { ...OPTS, dryRun: true });
    expect(f.sleeps).toEqual([]);
  });

  it('skips assets whose bytes we do not own (a pasted external URL)', async () => {
    const f = makeFixture([
      video('a1'),
      video('a2', { fileUrl: 'https://cdn.partner.example/promo.mp4' }),
    ]);
    const s = await runPosterBackfill(f.deps, OPTS);
    expect(s.skippedExternal).toBe(1);
    expect(f.posterCalls).toEqual(['a1']); // ffmpeg never points at a third-party URL
  });
});
