/**
 * Device play log (2026-11-09, player stability gap 7) — ingest auth, tenant
 * isolation across two tenants, idempotency, kill switch, size caps, the
 * manifest-cache boundary, the read side and retention.
 */
import { PlayLogController } from './play-log.controller';
import { PlayLogReadController } from './play-log-read.controller';
import { PlayLogRetentionService, PLAY_LOG_PURGE_CHUNK, PLAY_LOG_PURGE_MAX_CHUNKS } from './play-log-retention.service';
import {
  PLAY_LOG_MAX_AGE_MS,
  PLAY_LOG_MAX_BODY_BYTES,
  PLAY_LOG_MAX_ENTRIES,
  PLAY_LOG_MIN_ACCEPT_INTERVAL_MS,
  PLAY_LOG_STOP_RETRY_MS,
  PlayLogAcceptFloor,
  parsePlayLogQuery,
  playLogRetentionCutoff,
  toPlayLogRows,
} from './play-log.policy';
import { MANIFEST_FED_MODELS, shouldBumpManifestRev } from '../screens/manifest-hot-cache';

jest.mock('../screens/device-auth', () => ({ verifyDeviceForScreen: jest.fn() }));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const deviceAuth = require('../screens/device-auth') as { verifyDeviceForScreen: jest.Mock };

const NOW = 1_800_000_000_000;

/** In-memory table with the real primary key, so skipDuplicates is honest. */
function makePrisma() {
  const table = new Map<string, any>();
  const pk = (r: any) => `${r.screenId}|${r.startedAt.getTime()}|${r.playlistItemId}`;
  const client = {
    playLogEntry: {
      createMany: jest.fn(async ({ data, skipDuplicates }: any) => {
        let count = 0;
        for (const r of data) {
          if (table.has(pk(r))) {
            if (!skipDuplicates) throw new Error('unique violation');
            continue;
          }
          table.set(pk(r), { ...r });
          count += 1;
        }
        return { count };
      }),
      findMany: jest.fn(async ({ where, take }: any) =>
        [...table.values()]
          .filter((r) => r.tenantId === where.tenantId)
          .filter((r) => !where.screenId || r.screenId === where.screenId)
          .filter((r) => !where.assetId || r.assetId === where.assetId)
          .filter((r) => r.startedAt >= where.startedAt.gte && r.startedAt < where.startedAt.lt)
          .sort((a, b) => a.startedAt - b.startedAt)
          .slice(0, take)),
    },
    screen: { findMany: jest.fn(async ({ where }: any) => (where.tenantId === 't1' ? [{ id: 'scr-a', name: 'Lobby' }] : [])) },
    asset: { findMany: jest.fn(async ({ where }: any) => (where.tenantId === 't1' ? [{ id: 'ast-1', originalName: '=ad.mp4' }] : [])) },
    playlist: { findMany: jest.fn(async () => []) },
  };
  return { prisma: { client } as any, table, client };
}

const entry = (over: Record<string, unknown> = {}) => ({
  startedAt: NOW - 60_000,
  shownMs: 10_000,
  completed: true,
  playlistId: 'pl-1',
  itemId: 'item-1',
  assetId: 'ast-1',
  ...over,
});

const req = (over: Record<string, string> = {}): any => ({ headers: { authorization: 'Bearer x', ...over } });

function authAs(screenId: string, tenantId: string | null) {
  deviceAuth.verifyDeviceForScreen.mockResolvedValue({ ok: true, sub: screenId, tenantId, screen: { id: screenId, tenantId }, token: 'x' });
}

describe('POST /screens/:id/play-log', () => {
  const OLD_ENV = process.env;
  let ctx: ReturnType<typeof makePrisma>;
  let controller: PlayLogController;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(NOW);
    process.env = { ...OLD_ENV };
    delete process.env.PLAY_LOG_DISABLED;
    ctx = makePrisma();
    controller = new PlayLogController(ctx.prisma, {} as any);
    authAs('scr-a', 't1');
  });
  afterEach(() => {
    jest.useRealTimers();
    process.env = OLD_ENV;
  });

  it('stores entries under the credential screen and its live-row tenant', async () => {
    const out = await controller.ingest('scr-a', req(), { entries: [entry(), entry({ itemId: 'item-2', startedAt: NOW - 50_000 })] });
    expect(out).toEqual({ accepted: 2, rejected: 0, stored: 2 });
    const rows = [...ctx.table.values()];
    expect(rows.every((r) => r.screenId === 'scr-a' && r.tenantId === 't1')).toBe(true);
    expect(deviceAuth.verifyDeviceForScreen.mock.calls[0][2]).toBe('scr-a');
    // Unpaired refused (stated); unproven left at its refusing default.
    expect(deviceAuth.verifyDeviceForScreen.mock.calls[0][3]).toEqual({ allowUnpaired: false });
  });

  it('refuses a failed device credential with 401 and writes nothing', async () => {
    deviceAuth.verifyDeviceForScreen.mockResolvedValue({ ok: false, reason: 'subject_mismatch' });
    await expect(controller.ingest('scr-b', req(), { entries: [entry()] })).rejects.toMatchObject({ status: 401 });
    expect(ctx.client.playLogEntry.createMany).not.toHaveBeenCalled();
  });

  it('refuses an unpaired screen (no tenant) with 401', async () => {
    authAs('scr-a', null);
    await expect(controller.ingest('scr-a', req(), { entries: [entry()] })).rejects.toMatchObject({ status: 401 });
  });

  it('two tenants: a body cannot name a screen or tenant, and each device lands in its own tenant', async () => {
    await expect(
      controller.ingest('scr-a', req(), { entries: [entry()], tenantId: 't2' } as any),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      controller.ingest('scr-a', req(), { entries: [entry({ tenantId: 't2' })] } as any),
    ).rejects.toMatchObject({ status: 400 });
    await controller.ingest('scr-a', req(), { entries: [entry()] });
    authAs('scr-z', 't2');
    await controller.ingest('scr-z', req(), { entries: [entry()] });
    const rows = [...ctx.table.values()];
    expect(rows.map((r) => `${r.screenId}:${r.tenantId}`).sort()).toEqual(['scr-a:t1', 'scr-z:t2']);
  });

  it('is idempotent: a retried batch never double-counts', async () => {
    const batch = { entries: [entry(), entry({ itemId: 'item-2' })] };
    const first = await controller.ingest('scr-a', req(), batch);
    jest.setSystemTime(NOW + PLAY_LOG_MIN_ACCEPT_INTERVAL_MS + 1);
    const second = await controller.ingest('scr-a', req(), batch);
    expect(first.stored).toBe(2);
    expect(second).toMatchObject({ accepted: 2, stored: 0 });
    expect(ctx.table.size).toBe(2);
    expect(ctx.client.playLogEntry.createMany.mock.calls[1][0].skipDuplicates).toBe(true);
  });

  it('kill switch: accepts and discards with zero work and tells the player to stop', async () => {
    process.env.PLAY_LOG_DISABLED = '1';
    const out = await controller.ingest('scr-a', req(), { entries: [entry()] });
    expect(out).toEqual({ accepted: 0, rejected: 0, stored: 0, stop: true, retryAfterMs: PLAY_LOG_STOP_RETRY_MS });
    expect(deviceAuth.verifyDeviceForScreen).not.toHaveBeenCalled();
    expect(ctx.client.playLogEntry.createMany).not.toHaveBeenCalled();
  });

  it('size caps: Content-Length over 64 KB → 413, more than 200 entries → 400, before auth', async () => {
    await expect(
      controller.ingest('scr-a', req({ 'content-length': String(PLAY_LOG_MAX_BODY_BYTES + 1) }), { entries: [] }),
    ).rejects.toMatchObject({ status: 413 });
    const many = Array.from({ length: PLAY_LOG_MAX_ENTRIES + 1 }, (_, i) => entry({ itemId: `i${i}` }));
    await expect(controller.ingest('scr-a', req(), { entries: many })).rejects.toMatchObject({ status: 400 });
    expect(deviceAuth.verifyDeviceForScreen).not.toHaveBeenCalled();
  });

  it('refuses content text and hostile ids', async () => {
    await expect(controller.ingest('scr-a', req(), { entries: [entry({ text: 'hello' })] } as any)).rejects.toMatchObject({ status: 400 });
    await expect(controller.ingest('scr-a', req(), { entries: [entry({ itemId: '<script>' })] })).rejects.toMatchObject({ status: 400 });
    await expect(controller.ingest('scr-a', req(), { entries: [entry({ itemId: 'x'.repeat(129) })] })).rejects.toMatchObject({ status: 400 });
  });

  it('per-screen accept floor: a second batch inside 20 s is 429 with no write', async () => {
    await controller.ingest('scr-a', req(), { entries: [entry()] });
    await expect(controller.ingest('scr-a', req(), { entries: [entry({ itemId: 'b' })] })).rejects.toMatchObject({ status: 429 });
    expect(ctx.client.playLogEntry.createMany).toHaveBeenCalledTimes(1);
  });

  it('a database failure is a 503 so the player keeps the batch', async () => {
    ctx.client.playLogEntry.createMany.mockRejectedValueOnce(new Error('pool'));
    await expect(controller.ingest('scr-a', req(), { entries: [entry()] })).rejects.toMatchObject({ status: 503 });
  });

  it('never busts the manifest cache: PlayLogEntry is not a manifest-fed model', () => {
    expect(MANIFEST_FED_MODELS.has('PlayLogEntry')).toBe(false);
    expect(shouldBumpManifestRev('PlayLogEntry', 'createMany', null)).toBe(false);
  });
});

describe('play-log policy', () => {
  it('drops entries outside the time window and collapses in-batch duplicates', () => {
    const { rows, rejected } = toPlayLogRows(
      [
        entry(),
        entry(),
        entry({ itemId: 'old', startedAt: NOW - PLAY_LOG_MAX_AGE_MS - 1 }),
        entry({ itemId: 'future', startedAt: NOW + 10 * 60_000 }),
      ],
      { screenId: 's', tenantId: 't' },
      NOW,
    );
    expect(rows).toHaveLength(1);
    expect(rejected).toBe(2);
  });

  it('accept floor bounds its memory', () => {
    const floor = new PlayLogAcceptFloor(1_000, 2);
    expect(floor.accept('a', 0)).toBe(true);
    expect(floor.accept('a', 500)).toBe(false);
    floor.accept('b', 0);
    floor.accept('c', 0); // evicts 'a'
    expect(floor.accept('a', 600)).toBe(true);
  });

  it('read query: requires a scope, defaults to 24 h, caps the range at 31 days', () => {
    expect(parsePlayLogQuery({}, NOW)).toMatchObject({ ok: false, code: 'PLAY_LOG_SCOPE_REQUIRED' });
    const ok = parsePlayLogQuery({ screenId: 'scr-a' }, NOW);
    expect(ok).toMatchObject({ ok: true, limit: 1_000, csv: false });
    if (ok.ok) expect(ok.to.getTime() - ok.from.getTime()).toBe(86_400_000);
    expect(parsePlayLogQuery({ screenId: 'a', from: String(NOW - 40 * 86_400_000), to: String(NOW) }, NOW))
      .toMatchObject({ ok: false, code: 'PLAY_LOG_RANGE_TOO_LONG' });
    expect(parsePlayLogQuery({ assetId: 'a', format: 'csv', limit: '999999' }, NOW)).toMatchObject({ ok: true, limit: 50_000, csv: true });
    expect(parsePlayLogQuery({ screenId: "a' OR 1=1" }, NOW)).toMatchObject({ ok: false, code: 'PLAY_LOG_BAD_ID' });
  });
});

describe('GET /analytics/play-log', () => {
  let ctx: ReturnType<typeof makePrisma>;
  let controller: PlayLogReadController;
  const res = () => ({ setHeader: jest.fn() }) as any;

  beforeEach(async () => {
    jest.useFakeTimers().setSystemTime(NOW);
    ctx = makePrisma();
    const ingest = new PlayLogController(ctx.prisma, {} as any);
    authAs('scr-a', 't1');
    await ingest.ingest('scr-a', req(), { entries: [entry()] });
    authAs('scr-a2', 't2');
    await ingest.ingest('scr-a2', req(), { entries: [entry()] });
    controller = new PlayLogReadController(ctx.prisma);
  });
  afterEach(() => jest.useRealTimers());

  it('two tenants: each caller sees only its own rows, even for the same asset id', async () => {
    const t1: any = await controller.read({ user: { tenantId: 't1' } }, res(), undefined, 'ast-1');
    const t2: any = await controller.read({ user: { tenantId: 't2' } }, res(), undefined, 'ast-1');
    expect(t1.items.map((i: any) => i.screenId)).toEqual(['scr-a']);
    expect(t2.items.map((i: any) => i.screenId)).toEqual(['scr-a2']);
    // Names are resolved inside the caller's tenant only.
    expect(t2.items[0].assetName).toBeNull();
    for (const call of [...ctx.client.screen.findMany.mock.calls, ...ctx.client.asset.findMany.mock.calls]) {
      expect(['t1', 't2']).toContain(call[0].where.tenantId);
    }
  });

  it('a tenant cannot read another tenant\'s screen by id', async () => {
    const out: any = await controller.read({ user: { tenantId: 't1' } }, res(), 'scr-a2');
    expect(out.items).toEqual([]);
  });

  it('CSV export escapes formula cells', async () => {
    const r = res();
    const csv: any = await controller.read({ user: { tenantId: 't1' } }, r, 'scr-a', undefined, undefined, undefined, undefined, 'csv');
    expect(r.setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv; charset=utf-8');
    const lines = String(csv).split('\n');
    expect(lines[0]).toBe('startedAt,shownSeconds,completed,screenId,screenName,playlistId,playlistName,playlistItemId,assetId,assetName');
    expect(lines[1]).toContain('\t=ad.mp4');
  });

  it('refuses a read with no screen or asset', async () => {
    await expect(controller.read({ user: { tenantId: 't1' } }, res())).rejects.toMatchObject({ status: 400 });
  });
});

describe('play-log retention', () => {
  const OLD_ENV = process.env;
  beforeEach(() => { process.env = { ...OLD_ENV }; delete process.env.PLAY_LOG_RETENTION_DAYS; });
  afterAll(() => { process.env = OLD_ENV; });

  it('defaults to 30 days and disables at <= 0', () => {
    expect(playLogRetentionCutoff({}, NOW)!.getTime()).toBe(NOW - 30 * 86_400_000);
    expect(playLogRetentionCutoff({ PLAY_LOG_RETENTION_DAYS: '7' }, NOW)!.getTime()).toBe(NOW - 7 * 86_400_000);
    expect(playLogRetentionCutoff({ PLAY_LOG_RETENTION_DAYS: '0' }, NOW)).toBeNull();
    expect(playLogRetentionCutoff({ PLAY_LOG_RETENTION_DAYS: 'x' }, NOW)).toBeNull();
  });

  it('deletes in bounded chunks and stops when a chunk comes back short', async () => {
    const exec = jest.fn()
      .mockResolvedValueOnce(PLAY_LOG_PURGE_CHUNK)
      .mockResolvedValueOnce(5);
    const svc = new PlayLogRetentionService({ client: { $executeRawUnsafe: exec } } as any);
    expect(await svc.purgeTick(NOW)).toBe(PLAY_LOG_PURGE_CHUNK + 5);
    expect(exec).toHaveBeenCalledTimes(2);
    expect(exec.mock.calls[0][0]).toContain(`LIMIT ${PLAY_LOG_PURGE_CHUNK}`);
    expect((exec.mock.calls[0][1] as Date).getTime()).toBe(NOW - 30 * 86_400_000);
  });

  it('never runs more than the chunk budget in one pass', async () => {
    const exec = jest.fn().mockResolvedValue(PLAY_LOG_PURGE_CHUNK);
    const svc = new PlayLogRetentionService({ client: { $executeRawUnsafe: exec } } as any);
    await svc.purgeTick(NOW);
    expect(exec).toHaveBeenCalledTimes(PLAY_LOG_PURGE_MAX_CHUNKS);
  });

  it('disabled retention and a failing database delete nothing and never throw', async () => {
    process.env.PLAY_LOG_RETENTION_DAYS = '0';
    const exec = jest.fn();
    const svc = new PlayLogRetentionService({ client: { $executeRawUnsafe: exec } } as any);
    expect(await svc.purgeTick(NOW)).toBe(0);
    expect(exec).not.toHaveBeenCalled();
    delete process.env.PLAY_LOG_RETENTION_DAYS;
    const failing = new PlayLogRetentionService({ client: { $executeRawUnsafe: jest.fn().mockRejectedValue(new Error('missing table')) } } as any);
    await expect(failing.purgeTick(NOW)).resolves.toBe(0);
  });

  it('a non-leader replica does not sweep', async () => {
    const exec = jest.fn();
    const lease: any = { tryAcquire: jest.fn(async () => ({ leader: false })) };
    const svc = new PlayLogRetentionService({ client: { $executeRawUnsafe: exec } } as any, lease);
    expect(await svc.purgeTick(NOW)).toBe(0);
    expect(exec).not.toHaveBeenCalled();
  });
});
