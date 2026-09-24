/**
 * video-probe-autoheal.cron.spec.ts — the tick's contract.
 *
 * A quiet library costs one count() and nothing else; candidates get the real
 * probe + poster pass through VideoPosterService, newest first, bounded and
 * paced; a linked (external) URL is skipped, never probed; a non-leader
 * replica does nothing; a tick already in flight is not doubled.
 */
import { VideoProbeAutoHealCron } from './video-probe-autoheal.cron';

const PREFIX = 'https://proj.supabase.co/storage/v1/object/public/assets/';

interface Row {
  id: string;
  tenantId: string;
  fileUrl: string;
  mimeType: string;
  originalName: string | null;
}

function makeDeps(rows: Row[], opts: { leader?: boolean } = {}) {
  const queryRaw = jest.fn((q: { sql: string; strings?: string[] }) => {
    const text = Array.isArray(q?.strings)
      ? q.strings.join(' ')
      : String(q?.sql ?? '');
    if (/count\(\*\)/i.test(text))
      return Promise.resolve([{ count: rows.length }]);
    return Promise.resolve(rows.slice(0, VideoProbeAutoHealCron.BATCH_LIMIT));
  });
  const prisma = { client: { $queryRaw: queryRaw } } as any;
  const storage = {
    extractPath: (u: string) =>
      u.startsWith(PREFIX) ? u.slice(PREFIX.length) : null,
  } as any;
  const videoPoster = {
    processVideo: jest.fn(() =>
      Promise.resolve({ probed: true, posterUrl: null }),
    ),
  } as any;
  const lease =
    opts.leader === undefined
      ? undefined
      : ({
          tryAcquire: jest.fn(() =>
            Promise.resolve({
              name: 'x',
              leader: !!opts.leader,
              degraded: false,
              fence: 1,
            }),
          ),
        } as any);
  class TestCron extends VideoProbeAutoHealCron {
    slept: number[] = [];
    protected sleep(ms: number): Promise<void> {
      this.slept.push(ms);
      return Promise.resolve();
    }
  }
  const cron = new TestCron(prisma, storage, videoPoster, lease);
  jest.spyOn((cron as any).logger, 'log').mockImplementation(() => undefined);
  jest.spyOn((cron as any).logger, 'warn').mockImplementation(() => undefined);
  return { cron, prisma, videoPoster, queryRaw };
}

const video = (
  id: string,
  name: string,
  url = `${PREFIX}t1/uploads/${id}.mp4`,
): Row => ({
  id,
  tenantId: 't1',
  fileUrl: url,
  mimeType: 'video/mp4',
  originalName: name,
});

describe('VideoProbeAutoHealCron.tick', () => {
  it('costs one count and nothing else when no video needs a probe', async () => {
    const { cron, videoPoster, queryRaw } = makeDeps([]);
    await expect(cron.tick()).resolves.toBe(0);
    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(videoPoster.processVideo).not.toHaveBeenCalled();
  });

  it('runs the same probe + poster pass an upload gets, on the stored file, paced between rows', async () => {
    const { cron, videoPoster } = makeDeps([
      video('a', 'Pro Series.mp4'),
      video('b', 'promo.MOV'),
    ]);
    await expect(cron.tick()).resolves.toBe(2);
    expect(videoPoster.processVideo).toHaveBeenCalledTimes(2);
    expect(videoPoster.processVideo).toHaveBeenNthCalledWith(1, {
      assetId: 'a',
      tenantId: 't1',
      mimeType: 'video/mp4',
      storagePath: 't1/uploads/a.mp4',
      ext: '.mp4',
    });
    expect(videoPoster.processVideo).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ assetId: 'b', ext: '.MOV' }),
    );
    // One pause BETWEEN rows, none after the last.
    expect(cron.slept).toEqual([VideoProbeAutoHealCron.PACE_MS]);
  });

  it('never points ffprobe at a linked URL — it is skipped, not probed', async () => {
    const { cron, videoPoster } = makeDeps([
      video('ext', 'cdn.mp4', 'https://cdn.example.com/clip.mp4'),
      video('a', 'ours.mp4'),
    ]);
    await expect(cron.tick()).resolves.toBe(1);
    expect(videoPoster.processVideo).toHaveBeenCalledTimes(1);
    expect(videoPoster.processVideo).toHaveBeenCalledWith(
      expect.objectContaining({ assetId: 'a' }),
    );
  });

  it('does nothing on a replica that is not the leader', async () => {
    const { cron, videoPoster, queryRaw } = makeDeps([video('a', 'x.mp4')], {
      leader: false,
    });
    await expect(cron.tick()).resolves.toBe(0);
    expect(queryRaw).not.toHaveBeenCalled();
    expect(videoPoster.processVideo).not.toHaveBeenCalled();
  });

  it('asks for candidates newest first with the shared predicate, bounded to the batch', async () => {
    const { cron, queryRaw } = makeDeps([video('a', 'x.mp4')]);
    await cron.tick();
    const batchQuery = queryRaw.mock.calls[1][0];
    const text = (batchQuery.strings as string[]).join('?');
    expect(text).toMatch(/mime_type LIKE 'video\/%'/);
    expect(text).toMatch(/ORDER BY created_at DESC, id DESC/);
    expect(text).toMatch(/LIMIT/);
    expect(batchQuery.values).toContain(VideoProbeAutoHealCron.BATCH_LIMIT);
    // The shared predicate rides along: the "no current probe" and "not already failed" halves.
    expect(text).toMatch(/probeVersion/);
    expect(text).toMatch(/probeFailedVersion/);
  });

  it('does not double a tick that is already in flight', async () => {
    const { cron, videoPoster } = makeDeps([video('a', 'x.mp4')]);
    let release: () => void = () => undefined;
    videoPoster.processVideo.mockImplementationOnce(
      () =>
        new Promise<{ probed: boolean; posterUrl: null }>((r) => {
          release = () => r({ probed: true, posterUrl: null });
        }),
    );
    const first = cron.tick();
    // Let the first tick get past the lease + count and into processVideo.
    await new Promise<void>((r) => setImmediate(r));
    await expect(cron.tick()).resolves.toBe(0);
    release();
    await expect(first).resolves.toBe(1);
  });
});

describe('VideoProbeAutoHealCron.onModuleInit', () => {
  const env = process.env;
  afterEach(() => {
    process.env = env;
    jest.useRealTimers();
  });

  it('arms nothing under NODE_ENV=test or when disabled via env', () => {
    jest.useFakeTimers();
    const { cron } = makeDeps([]);
    cron.onModuleInit();
    expect(jest.getTimerCount()).toBe(0);

    process.env = {
      ...env,
      NODE_ENV: 'production',
      VIDEO_PROBE_AUTOHEAL_DISABLED: '1',
    };
    cron.onModuleInit();
    expect(jest.getTimerCount()).toBe(0);
  });
});
