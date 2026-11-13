/**
 * A screen on a BACKUP playlist (2026-11-13) — the rules (playlist-fallback.ts)
 * and what `POST /screens/:id/telemetry` does with the report.
 *
 * What these pin, in priority order:
 *   1. The device is hostile input: ids only, both verified inside the
 *      screen's own tenant, names read server-side.
 *   2. The steady state costs nothing: the same pair again is no query and
 *      no write.
 *   3. A change is recorded (immutable audit row) before the state moves,
 *      and the admins are told at most once per screen + playlist per day.
 *   4. The write never busts the manifest cache.
 */
import { TelemetryController, TELEMETRY_COLUMNS, resetTelemetryStateForTests } from './telemetry.controller';
import { screenTelemetrySchema } from './telemetry.schema';
import {
  FALLBACK_CHANGE_MIN_INTERVAL_MS,
  FALLBACK_MAX_FOR_MS,
  FALLBACK_NOTIFICATION_TITLE,
  PLAYER_PLAYLIST_FALLBACK,
  PLAYER_PLAYLIST_FALLBACK_ENDED,
  __resetFallbackChangeLimiter,
  acceptFallbackChange,
  fallbackDedupeKey,
  fallbackNotificationBody,
  planPlaylistFallback,
  storedPlaylistFallback,
  verifiedPlaylistFallback,
} from './playlist-fallback';
import {
  SCREEN_TELEMETRY_ONLY_FIELDS,
  shouldBumpManifestRev,
  resetManifestCacheForTests,
} from '../screens/manifest-hot-cache';
import { CUSTOMER_ACTIVITY } from '@cms/api-types';

jest.mock('../security/required-secret', () => ({
  requireSecret: (_name: string, opts?: { devFallback?: string }) =>
    opts?.devFallback ?? 'test_secret_32_chars_padded_here_ok',
}));
jest.mock('../screens/device-auth', () => ({ verifyDeviceForScreen: jest.fn() }));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const deviceAuth = require('../screens/device-auth') as { verifyDeviceForScreen: jest.Mock };

const NOW = Date.parse('2026-11-13T15:00:00Z');
const REPORT = { fromPlaylistId: 'pl-4k', toPlaylistId: 'pl-everyday', forMs: 45_000 };
const STORED = {
  fromPlaylistId: 'pl-4k',
  fromPlaylistName: '4k',
  toPlaylistId: 'pl-everyday',
  toPlaylistName: 'Everyday',
  since: new Date(NOW - 600_000).toISOString(),
};
const PLAYLISTS = [
  { id: 'pl-4k', name: '4k' },
  { id: 'pl-everyday', name: 'Everyday' },
];

describe('the pure rules', () => {
  it('the wire schema: ids and a duration, strictly', () => {
    const ok = (playlistFallback: unknown) => screenTelemetrySchema.safeParse({ playlistFallback }).success;
    expect(ok(REPORT)).toBe(true);
    expect(screenTelemetrySchema.safeParse({}).success).toBe(true);
    expect(ok({ ...REPORT, fromName: 'Lunch' })).toBe(false); // never a name from the device
    expect(ok({ ...REPORT, fromPlaylistId: 'x'.repeat(65) })).toBe(false);
    expect(ok({ ...REPORT, toPlaylistId: 'has space' })).toBe(false);
    expect(ok({ ...REPORT, toPlaylistId: "'; DROP" })).toBe(false);
    expect(ok({ ...REPORT, forMs: -1 })).toBe(false);
    expect(ok({ ...REPORT, forMs: 1.5 })).toBe(false);
    expect(ok({ ...REPORT, forMs: FALLBACK_MAX_FOR_MS + 1 })).toBe(false);
    expect(ok({ fromPlaylistId: 'a' })).toBe(false);
  });

  it('plan: nothing → enter → nothing (steady) → exit', () => {
    expect(planPlaylistFallback(null, null, true)).toEqual({ kind: 'none' });
    expect(planPlaylistFallback(null, REPORT, true)).toEqual({ kind: 'enter', reported: REPORT, previous: null });
    expect(planPlaylistFallback(STORED, { ...REPORT, forMs: 999_999 }, true)).toEqual({ kind: 'none' });
    expect(planPlaylistFallback(STORED, null, true)).toEqual({ kind: 'exit', previous: STORED });
  });

  it('plan: a different pair is a new change; an unpaired screen is never planned for', () => {
    const other = { ...REPORT, toPlaylistId: 'pl-board' };
    expect(planPlaylistFallback(STORED, other, true)).toEqual({ kind: 'enter', reported: other, previous: STORED });
    expect(planPlaylistFallback(null, REPORT, false)).toEqual({ kind: 'none' });
    // "Fell back to itself" is not a fallback.
    expect(planPlaylistFallback(STORED, { ...REPORT, toPlaylistId: 'pl-4k' }, true)).toEqual({ kind: 'exit', previous: STORED });
  });

  it('verify: both playlists must be the tenant’s; names and the start come from the server', () => {
    const v = verifiedPlaylistFallback(REPORT, PLAYLISTS, new Date(NOW));
    expect(v).toEqual({
      fromPlaylistId: 'pl-4k', fromPlaylistName: '4k',
      toPlaylistId: 'pl-everyday', toPlaylistName: 'Everyday',
      since: new Date(NOW - 45_000).toISOString(),
    });
    expect(verifiedPlaylistFallback(REPORT, [PLAYLISTS[0]], new Date(NOW))).toBeNull();
    expect(verifiedPlaylistFallback(REPORT, [PLAYLISTS[1]], new Date(NOW))).toBeNull();
    expect(verifiedPlaylistFallback(REPORT, [], new Date(NOW))).toBeNull();
  });

  it('verify: the claimed duration is bounded, and a nameless playlist still reads', () => {
    const v = verifiedPlaylistFallback({ ...REPORT, forMs: Number.MAX_SAFE_INTEGER }, [{ id: 'pl-4k', name: null }, PLAYLISTS[1]], new Date(NOW));
    expect(v?.since).toBe(new Date(NOW - FALLBACK_MAX_FOR_MS).toISOString());
    expect(v?.fromPlaylistName).toBe('Untitled playlist');
  });

  it('the stored column is read defensively', () => {
    expect(storedPlaylistFallback(STORED)).toEqual(STORED);
    expect(storedPlaylistFallback(null)).toBeNull();
    expect(storedPlaylistFallback('x')).toBeNull();
    expect(storedPlaylistFallback([])).toBeNull();
    expect(storedPlaylistFallback({ fromPlaylistId: 'a' })).toBeNull();
  });

  it('the copy says only what the screen reported, in plain words', () => {
    expect(FALLBACK_NOTIFICATION_TITLE).toBe('A screen is showing its backup playlist');
    expect(fallbackNotificationBody('Lobby TV', STORED)).toBe(
      'Lobby TV could not play anything in “4k”, so it is showing “Everyday”. Check the files in “4k”.',
    );
    expect(fallbackNotificationBody(null, STORED)).toMatch(/^A screen could not play anything in “4k”/);
  });

  it('dedupe: one per screen + set-aside playlist per UTC day', () => {
    const a = fallbackDedupeKey('s1', 'pl-4k', new Date('2026-11-13T00:00:01Z'));
    expect(a).toBe('playlist-fallback:s1:pl-4k:2026-11-13');
    expect(fallbackDedupeKey('s1', 'pl-4k', new Date('2026-11-13T23:59:59Z'))).toBe(a);
    expect(fallbackDedupeKey('s1', 'pl-4k', new Date('2026-11-14T00:00:00Z'))).not.toBe(a);
    expect(fallbackDedupeKey('s2', 'pl-4k', new Date('2026-11-13T12:00:00Z'))).not.toBe(a);
    expect(fallbackDedupeKey('s1', 'pl-other', new Date('2026-11-13T12:00:00Z'))).not.toBe(a);
  });

  it('a looping device is held to one recorded change per interval, per screen', () => {
    __resetFallbackChangeLimiter();
    expect(acceptFallbackChange('s1', NOW)).toBe(true);
    expect(acceptFallbackChange('s1', NOW + FALLBACK_CHANGE_MIN_INTERVAL_MS - 1)).toBe(false);
    expect(acceptFallbackChange('s2', NOW + 1)).toBe(true);
    expect(acceptFallbackChange('s1', NOW + FALLBACK_CHANGE_MIN_INTERVAL_MS)).toBe(true);
    // An honest player needs two minutes on its card before it can enter again.
    expect(FALLBACK_CHANGE_MIN_INTERVAL_MS).toBeLessThan(2 * 60_000);
  });

  it('customer activity: neither action is on the allowlist (player recovery is machinery, by its own rule)', () => {
    expect(CUSTOMER_ACTIVITY).not.toHaveProperty(PLAYER_PLAYLIST_FALLBACK);
    expect(CUSTOMER_ACTIVITY).not.toHaveProperty(PLAYER_PLAYLIST_FALLBACK_ENDED);
  });

  it('the write never busts the manifest cache', () => {
    expect(SCREEN_TELEMETRY_ONLY_FIELDS.has('playlistFallback')).toBe(true);
    expect(TELEMETRY_COLUMNS.has('playlistFallback')).toBe(true);
    expect(shouldBumpManifestRev('Screen', 'update', ['lastPingAt', 'playlistFallback'])).toBe(false);
  });
});

describe('POST /screens/:id/telemetry — playlistFallback', () => {
  let controller: TelemetryController;
  let prisma: any;
  let notifications: { notify: jest.Mock };
  let SCREEN_ID = 'fb-screen-0';
  let seq = 0;
  const redis: any = { sismember: jest.fn(async () => false) };
  const req = (): any => ({ headers: { authorization: 'Bearer fake' } });
  const row = (over: Record<string, unknown> = {}) => ({
    id: SCREEN_ID,
    tenantId: 'tenant-a',
    name: 'Lobby TV',
    playerVersion: '1.1.55',
    playerVersionCode: 11550,
    managerVersion: null,
    forceApkUpdatePendingAt: null,
    pendingRefreshAt: null,
    lastOtaState: null,
    displayCapabilitiesAt: new Date(NOW - 60_000),
    playlistFallback: null,
    ...over,
  });
  const written = (): Record<string, unknown> => prisma.client.screen.update.mock.calls.at(-1)?.[0].data ?? {};
  const audit = (): any[] => prisma.client.auditLog.create.mock.calls.map((c: any[]) => c[0].data);

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(NOW);
    SCREEN_ID = `fb-screen-${++seq}`;
    resetManifestCacheForTests();
    resetTelemetryStateForTests();
    __resetFallbackChangeLimiter();
    deviceAuth.verifyDeviceForScreen.mockResolvedValue({
      ok: true, sub: SCREEN_ID, screen: { id: SCREEN_ID, tenantId: 'tenant-a' }, tenantId: 'tenant-a', token: 'fake',
    });
    prisma = {
      client: {
        screen: {
          findUnique: jest.fn(async () => row()),
          update: jest.fn(async () => ({ id: SCREEN_ID })),
        },
        // Only tenant-a's playlists exist for tenant-a; anything else finds nothing.
        playlist: {
          findMany: jest.fn(async ({ where }: any) =>
            where.tenantId === 'tenant-a' ? PLAYLISTS.filter((p) => where.id.in.includes(p.id)) : [],
          ),
        },
        auditLog: { create: jest.fn(async () => ({ id: 'a1' })) },
        screenEvent: { create: jest.fn(async () => ({ id: 'ev-1' })) },
      },
    };
    notifications = { notify: jest.fn(async () => ({ id: 'n1' })) };
    controller = new TelemetryController(prisma, redis, undefined, undefined, notifications as any);
  });
  afterEach(() => jest.useRealTimers());

  it('ENTER: verifies inside the screen’s tenant, records, stores, notifies — once', async () => {
    await controller.report(SCREEN_ID, req(), { playlistFallback: REPORT });

    expect(prisma.client.playlist.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.client.playlist.findMany.mock.calls[0][0].where).toEqual({ tenantId: 'tenant-a', id: { in: ['pl-4k', 'pl-everyday'] } });

    expect(written().playlistFallback).toEqual({
      fromPlaylistId: 'pl-4k', fromPlaylistName: '4k',
      toPlaylistId: 'pl-everyday', toPlaylistName: 'Everyday',
      since: new Date(NOW - 45_000).toISOString(),
    });

    expect(audit()).toHaveLength(1);
    expect(audit()[0]).toMatchObject({ tenantId: 'tenant-a', userId: null, action: 'PLAYER_PLAYLIST_FALLBACK', targetType: 'Screen', targetId: SCREEN_ID });
    expect(JSON.parse(audit()[0].details)).toMatchObject({
      screenName: 'Lobby TV', fromPlaylistId: 'pl-4k', fromPlaylistName: '4k', toPlaylistId: 'pl-everyday', toPlaylistName: 'Everyday', previous: null,
    });

    expect(notifications.notify).toHaveBeenCalledTimes(1);
    expect(notifications.notify).toHaveBeenCalledWith({
      tenantId: 'tenant-a',
      kind: 'INFO',
      title: 'A screen is showing its backup playlist',
      body: 'Lobby TV could not play anything in “4k”, so it is showing “Everyday”. Check the files in “4k”.',
      link: '/screens',
      dedupeKey: `playlist-fallback:${SCREEN_ID}:pl-4k:2026-11-13`,
    });
  });

  it('the audit row is written BEFORE the screen row', async () => {
    await controller.report(SCREEN_ID, req(), { playlistFallback: REPORT });
    expect(prisma.client.auditLog.create.mock.invocationCallOrder[0]).toBeLessThan(prisma.client.screen.update.mock.invocationCallOrder[0]);
  });

  it('STEADY STATE: the same pair again costs no query, no audit row, no column write, no notification', async () => {
    prisma.client.screen.findUnique.mockResolvedValue(row({ playlistFallback: STORED }));
    await controller.report(SCREEN_ID, req(), { playlistFallback: { ...REPORT, forMs: 700_000 } });
    expect(prisma.client.playlist.findMany).not.toHaveBeenCalled();
    expect(prisma.client.auditLog.create).not.toHaveBeenCalled();
    expect(notifications.notify).not.toHaveBeenCalled();
    expect(written()).not.toHaveProperty('playlistFallback');
    // …and it added no read: the one narrow select carries the column.
    expect(prisma.client.screen.findUnique).toHaveBeenCalledTimes(1);
    expect(prisma.client.screen.findUnique.mock.calls[0][0].select.playlistFallback).toBe(true);
  });

  it('a healthy screen that never fell back: nothing at all', async () => {
    await controller.report(SCREEN_ID, req(), {});
    expect(prisma.client.playlist.findMany).not.toHaveBeenCalled();
    expect(prisma.client.auditLog.create).not.toHaveBeenCalled();
    expect(written()).not.toHaveProperty('playlistFallback');
  });

  it('EXIT: the key stops arriving → an ENDED row, the column cleared, no notification, no lookup', async () => {
    prisma.client.screen.findUnique.mockResolvedValue(row({ playlistFallback: STORED }));
    await controller.report(SCREEN_ID, req(), {});
    expect(prisma.client.playlist.findMany).not.toHaveBeenCalled();
    expect(audit()).toHaveLength(1);
    expect(audit()[0]).toMatchObject({ action: 'PLAYER_PLAYLIST_FALLBACK_ENDED', tenantId: 'tenant-a', targetId: SCREEN_ID });
    expect(JSON.parse(audit()[0].details)).toMatchObject({ fromPlaylistId: 'pl-4k', toPlaylistName: 'Everyday', reason: 'no-longer-reported' });
    expect(written()).toHaveProperty('playlistFallback');
    expect(JSON.stringify(written().playlistFallback)).not.toContain('pl-4k'); // Prisma.DbNull
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('HOSTILE: another tenant’s playlist id is not a fallback we describe — nothing stored, nothing said', async () => {
    await controller.report(SCREEN_ID, req(), { playlistFallback: { ...REPORT, toPlaylistId: 'pl-of-tenant-b' } });
    expect(prisma.client.playlist.findMany.mock.calls[0][0].where.tenantId).toBe('tenant-a');
    expect(prisma.client.auditLog.create).not.toHaveBeenCalled();
    expect(notifications.notify).not.toHaveBeenCalled();
    expect(written()).not.toHaveProperty('playlistFallback');
  });

  it('HOSTILE: an unverifiable pair over a stored one ends the stored one (reads as "nothing reported")', async () => {
    prisma.client.screen.findUnique.mockResolvedValue(row({ playlistFallback: STORED }));
    await controller.report(SCREEN_ID, req(), { playlistFallback: { ...REPORT, fromPlaylistId: 'pl-of-tenant-b' } });
    expect(audit()[0]).toMatchObject({ action: 'PLAYER_PLAYLIST_FALLBACK_ENDED' });
    expect(JSON.parse(audit()[0].details).reason).toBe('not-verifiable');
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('HOSTILE: a name, an over-long id or junk in the block is a 400 before any database work', async () => {
    for (const bad of [{ ...REPORT, fromName: 'x' }, { ...REPORT, fromPlaylistId: 'y'.repeat(200) }, { ...REPORT, forMs: 'soon' }]) {
      await expect(controller.report(SCREEN_ID, req(), { playlistFallback: bad })).rejects.toMatchObject({ status: 400 });
    }
    expect(prisma.client.screen.findUnique).not.toHaveBeenCalled();
  });

  it('an unpaired screen (no tenant) is ignored', async () => {
    prisma.client.screen.findUnique.mockResolvedValue(row({ tenantId: null }));
    await controller.report(SCREEN_ID, req(), { playlistFallback: REPORT });
    expect(prisma.client.playlist.findMany).not.toHaveBeenCalled();
    expect(prisma.client.auditLog.create).not.toHaveBeenCalled();
    expect(written()).not.toHaveProperty('playlistFallback');
  });

  it('the pair changed (a different backup): a new FALLBACK row naming the previous one, and a notification', async () => {
    prisma.client.screen.findUnique.mockResolvedValue(row({ playlistFallback: { ...STORED, toPlaylistId: 'pl-board', toPlaylistName: 'Board' } }));
    await controller.report(SCREEN_ID, req(), { playlistFallback: REPORT });
    expect(audit()[0].action).toBe('PLAYER_PLAYLIST_FALLBACK');
    expect(JSON.parse(audit()[0].details).previous).toMatchObject({ toPlaylistId: 'pl-board' });
    expect((written().playlistFallback as any).toPlaylistId).toBe('pl-everyday');
    expect(notifications.notify).toHaveBeenCalledTimes(1);
  });

  it('NO RECORD, NO STATE: if the audit row cannot be written the column is left alone and the report still succeeds', async () => {
    prisma.client.auditLog.create.mockRejectedValue(new Error('db'));
    await expect(controller.report(SCREEN_ID, req(), { playlistFallback: REPORT })).resolves.toMatchObject({ ok: true });
    expect(written()).not.toHaveProperty('playlistFallback');
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('a failed lookup changes nothing and never fails the report', async () => {
    prisma.client.playlist.findMany.mockRejectedValue(new Error('db'));
    prisma.client.screen.findUnique.mockResolvedValue(row({ playlistFallback: { ...STORED, toPlaylistId: 'pl-board' } }));
    await expect(controller.report(SCREEN_ID, req(), { playlistFallback: REPORT })).resolves.toMatchObject({ ok: true });
    expect(prisma.client.auditLog.create).not.toHaveBeenCalled();
    expect(written()).not.toHaveProperty('playlistFallback');
  });

  it('a flapping screen: a second change inside the interval is held to the next report; nothing is lost', async () => {
    await controller.report(SCREEN_ID, req(), { playlistFallback: REPORT });
    expect(audit()).toHaveLength(1);
    // 31 s later the key is gone (past the 30 s accept floor, inside the change interval).
    jest.setSystemTime(NOW + 31_000);
    prisma.client.screen.findUnique.mockResolvedValue(row({ playlistFallback: STORED }));
    await controller.report(SCREEN_ID, req(), {});
    expect(audit()).toHaveLength(1);
    expect(written()).not.toHaveProperty('playlistFallback');
    // The next report still finds the difference and records it.
    jest.setSystemTime(NOW + 31_000 + FALLBACK_CHANGE_MIN_INTERVAL_MS);
    await controller.report(SCREEN_ID, req(), {});
    expect(audit()).toHaveLength(2);
    expect(audit()[1].action).toBe('PLAYER_PLAYLIST_FALLBACK_ENDED');
  });

  it('without the notifications service (a hand-built context) the state and the record still land', async () => {
    controller = new TelemetryController(prisma, redis);
    await controller.report(SCREEN_ID, req(), { playlistFallback: REPORT });
    expect(audit()).toHaveLength(1);
    expect(written()).toHaveProperty('playlistFallback');
  });
});
