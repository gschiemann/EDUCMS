/**
 * A screen on a BACKUP playlist (2026-11-13/14) — the rules (playlist-fallback.ts)
 * and what `POST /screens/:id/telemetry` does with the report.
 *
 * What these pin, in priority order:
 *   1. The device is hostile input: ids only, both verified inside the
 *      screen's own tenant, names read server-side; a flapping device is held
 *      down (one recorded change per interval, a daily cap on the bell).
 *   2. The steady state costs nothing: the same episode again is no query
 *      and no write.
 *   3. A change is recorded (immutable audit row) before the state moves.
 *   4. The admins hear an episode's start once — when a backup is on the
 *      glass — and its end once, only when it really recovered and only for
 *      an episode whose start they heard.
 *   5. The write never busts the manifest cache.
 */
import { TelemetryController, TELEMETRY_COLUMNS, resetTelemetryStateForTests } from './telemetry.controller';
import { screenTelemetrySchema } from './telemetry.schema';
import {
  FALLBACK_CHANGE_MIN_INTERVAL_MS,
  FALLBACK_MAX_FOR_MS,
  FALLBACK_NOTICES_PER_SCREEN_PER_DAY,
  FALLBACK_NOTIFICATION_TITLE,
  FALLBACK_RECOVERED_NOTIFICATION_TITLE,
  PLAYER_PLAYLIST_FALLBACK,
  PLAYER_PLAYLIST_FALLBACK_ENDED,
  __resetFallbackChangeLimiter,
  acceptFallbackChange,
  claimFallbackNotice,
  fallbackDedupeKey,
  fallbackNotificationBody,
  fallbackRecoveredDedupeKey,
  fallbackRecoveredNotificationBody,
  fallbackSince,
  planPlaylistFallback,
  storedPlaylistFallback,
  verifiedPlaylistNames,
  type StoredPlaylistFallback,
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

const MIN = 60_000;
const NOW = Date.parse('2026-11-13T15:00:30Z');
const REPORT = { fromPlaylistId: 'pl-4k', toPlaylistId: 'pl-everyday', forMs: 45_000, state: 'backup' as const };
const SINCE = '2026-11-13T14:59:00.000Z'; // NOW − 45 s, to the minute
const STORED: StoredPlaylistFallback = {
  fromPlaylistId: 'pl-4k',
  fromPlaylistName: '4k',
  toPlaylistId: 'pl-everyday',
  toPlaylistName: 'Everyday',
  since: '2026-11-13T14:50:00.000Z',
  state: 'backup',
  notified: true,
};
const PLAYLISTS = [
  { id: 'pl-4k', name: '4k' },
  { id: 'pl-everyday', name: 'Everyday' },
  { id: 'pl-lunch', name: 'Lunch' },
  { id: 'pl-board', name: 'Board' },
];

describe('the pure rules', () => {
  beforeEach(() => __resetFallbackChangeLimiter());

  it('the wire schema: ids, a duration and a state, strictly', () => {
    const ok = (playlistFallback: unknown) => screenTelemetrySchema.safeParse({ playlistFallback }).success;
    expect(ok(REPORT)).toBe(true);
    expect(ok({ ...REPORT, state: 'retrying' })).toBe(true);
    expect(ok({ ...REPORT, state: 'recovered' })).toBe(true);
    expect(screenTelemetrySchema.safeParse({}).success).toBe(true);
    expect(ok({ ...REPORT, fromName: 'Lunch' })).toBe(false); // never a name from the device
    expect(ok({ ...REPORT, state: 'fine' })).toBe(false);
    expect(ok({ fromPlaylistId: 'pl-4k', toPlaylistId: 'pl-everyday', forMs: 1 })).toBe(false); // the state is required
    expect(ok({ ...REPORT, fromPlaylistId: 'x'.repeat(65) })).toBe(false);
    expect(ok({ ...REPORT, toPlaylistId: 'has space' })).toBe(false);
    expect(ok({ ...REPORT, toPlaylistId: "'; DROP" })).toBe(false);
    expect(ok({ ...REPORT, forMs: -1 })).toBe(false);
    expect(ok({ ...REPORT, forMs: 1.5 })).toBe(false);
    expect(ok({ ...REPORT, forMs: FALLBACK_MAX_FOR_MS + 1 })).toBe(false);
  });

  it('plan: nothing → enter → steady → phase → end (recovered) → nothing', () => {
    expect(planPlaylistFallback(null, null, true)).toEqual({ kind: 'none' });
    expect(planPlaylistFallback(null, REPORT, true)).toEqual({ kind: 'enter', reported: REPORT, previous: null });
    expect(planPlaylistFallback(STORED, { ...REPORT, forMs: 999_999 }, true)).toEqual({ kind: 'none' });
    expect(planPlaylistFallback(STORED, { ...REPORT, state: 'retrying' }, true)).toEqual({ kind: 'phase', previous: STORED, state: 'retrying' });
    const recovered = { ...REPORT, toPlaylistId: 'pl-4k', state: 'recovered' as const };
    expect(planPlaylistFallback(STORED, recovered, true)).toEqual({ kind: 'end', previous: STORED, reason: 'recovered', reported: recovered });
    // The recovery keeps riding a few reports after the end: no-ops.
    expect(planPlaylistFallback(null, recovered, true)).toEqual({ kind: 'none' });
  });

  it('plan: the key stops, another backup, another playlist, "fell back to itself", an unpaired screen', () => {
    expect(planPlaylistFallback(STORED, null, true)).toEqual({ kind: 'end', previous: STORED, reason: 'no-longer-reported', reported: null });
    const board = { ...REPORT, toPlaylistId: 'pl-board' };
    expect(planPlaylistFallback(STORED, board, true)).toEqual({ kind: 'change', reported: board, previous: STORED });
    const lunch = { ...REPORT, fromPlaylistId: 'pl-lunch' };
    expect(planPlaylistFallback(STORED, lunch, true)).toEqual({ kind: 'enter', reported: lunch, previous: STORED });
    expect(planPlaylistFallback(STORED, { ...REPORT, toPlaylistId: 'pl-4k' }, true)).toMatchObject({ kind: 'end', reason: 'no-longer-reported' });
    expect(planPlaylistFallback(STORED, { ...REPORT, fromPlaylistId: 'pl-lunch', state: 'recovered' }, true)).toMatchObject({ kind: 'end', reason: 'superseded' });
    expect(planPlaylistFallback(null, REPORT, false)).toEqual({ kind: 'none' });
  });

  it('the start: the server clock minus the claimed duration, bounded, to the minute', () => {
    expect(fallbackSince(45_000, new Date(NOW))).toBe(SINCE);
    expect(fallbackSince(Number.MAX_SAFE_INTEGER, new Date(NOW))).toBe(new Date(Math.floor((NOW - FALLBACK_MAX_FOR_MS) / MIN) * MIN).toISOString());
    expect(fallbackSince(-5, new Date(NOW))).toBe('2026-11-13T15:00:00.000Z');
  });

  it('verify: both playlists must be the tenant’s; names come from the server', () => {
    expect(verifiedPlaylistNames(REPORT, PLAYLISTS)).toEqual({ fromPlaylistName: '4k', toPlaylistName: 'Everyday' });
    expect(verifiedPlaylistNames(REPORT, [PLAYLISTS[0]])).toBeNull();
    expect(verifiedPlaylistNames(REPORT, [PLAYLISTS[1]])).toBeNull();
    expect(verifiedPlaylistNames(REPORT, [])).toBeNull();
    expect(verifiedPlaylistNames(REPORT, [{ id: 'pl-4k', name: null }, PLAYLISTS[1]])?.fromPlaylistName).toBe('Untitled playlist');
  });

  it('the stored column is read defensively', () => {
    expect(storedPlaylistFallback(STORED)).toEqual(STORED);
    expect(storedPlaylistFallback({ ...STORED, state: 'weird', notified: 'yes' })).toMatchObject({ state: 'backup', notified: false });
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
    expect(FALLBACK_RECOVERED_NOTIFICATION_TITLE).toBe('A screen is back on its scheduled playlist');
    expect(fallbackRecoveredNotificationBody('Lobby TV', '4k')).toBe('Lobby TV is back on its scheduled playlist “4k”.');
    expect(fallbackRecoveredNotificationBody('  ', 'Lunch')).toBe('A screen is back on its scheduled playlist “Lunch”.');
  });

  it('dedupe: one start and one end per episode', () => {
    expect(fallbackDedupeKey('s1', SINCE)).toBe(`playlist-fallback:s1:${SINCE}`);
    expect(fallbackRecoveredDedupeKey('s1', SINCE)).toBe(`playlist-fallback-recovered:s1:${SINCE}`);
    expect(fallbackDedupeKey('s1', SINCE)).not.toBe(fallbackDedupeKey('s1', STORED.since));
    expect(fallbackDedupeKey('s2', SINCE)).not.toBe(fallbackDedupeKey('s1', SINCE));
  });

  it('a looping device is held to one recorded change per interval, per screen', () => {
    expect(acceptFallbackChange('s1', NOW)).toBe(true);
    expect(acceptFallbackChange('s1', NOW + FALLBACK_CHANGE_MIN_INTERVAL_MS - 1)).toBe(false);
    expect(acceptFallbackChange('s2', NOW + 1)).toBe(true);
    expect(acceptFallbackChange('s1', NOW + FALLBACK_CHANGE_MIN_INTERVAL_MS)).toBe(true);
    // An honest player needs two minutes on its card before it can enter again.
    expect(FALLBACK_CHANGE_MIN_INTERVAL_MS).toBeLessThan(2 * MIN);
  });

  it('the bell: at most a handful of episode starts per screen per UTC day', () => {
    for (let i = 0; i < FALLBACK_NOTICES_PER_SCREEN_PER_DAY; i += 1) expect(claimFallbackNotice('s1', new Date(NOW + i))).toBe(true);
    expect(claimFallbackNotice('s1', new Date(NOW + 10))).toBe(false);
    expect(claimFallbackNotice('s2', new Date(NOW))).toBe(true);
    expect(claimFallbackNotice('s1', new Date('2026-11-14T00:00:00Z'))).toBe(true); // a new day
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
  const stored = (over: Partial<StoredPlaylistFallback> = {}) => row({ playlistFallback: { ...STORED, ...over } });

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

  it('ENTER (backup on the glass): verifies inside the screen’s tenant, records, stores, tells the admins — once', async () => {
    await controller.report(SCREEN_ID, req(), { playlistFallback: REPORT });

    expect(prisma.client.playlist.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.client.playlist.findMany.mock.calls[0][0].where).toEqual({ tenantId: 'tenant-a', id: { in: ['pl-4k', 'pl-everyday'] } });

    expect(written().playlistFallback).toEqual({
      fromPlaylistId: 'pl-4k', fromPlaylistName: '4k',
      toPlaylistId: 'pl-everyday', toPlaylistName: 'Everyday',
      since: SINCE, state: 'backup', notified: true,
    });

    expect(audit()).toHaveLength(1);
    expect(audit()[0]).toMatchObject({ tenantId: 'tenant-a', userId: null, action: 'PLAYER_PLAYLIST_FALLBACK', targetType: 'Screen', targetId: SCREEN_ID });
    expect(JSON.parse(audit()[0].details)).toMatchObject({
      screenName: 'Lobby TV', fromPlaylistId: 'pl-4k', fromPlaylistName: '4k', toPlaylistId: 'pl-everyday', toPlaylistName: 'Everyday', since: SINCE, previous: null,
    });

    expect(notifications.notify).toHaveBeenCalledTimes(1);
    expect(notifications.notify).toHaveBeenCalledWith({
      tenantId: 'tenant-a',
      kind: 'INFO',
      title: 'A screen is showing its backup playlist',
      body: 'Lobby TV could not play anything in “4k”, so it is showing “Everyday”. Check the files in “4k”.',
      link: '/screens',
      dedupeKey: `playlist-fallback:${SCREEN_ID}:${SINCE}`,
    });
  });

  it('the audit row is written BEFORE the screen row, and the bell after it', async () => {
    await controller.report(SCREEN_ID, req(), { playlistFallback: REPORT });
    const auditAt = prisma.client.auditLog.create.mock.invocationCallOrder[0];
    const writeAt = prisma.client.screen.update.mock.invocationCallOrder[0];
    expect(auditAt).toBeLessThan(writeAt);
    expect(writeAt).toBeLessThan(notifications.notify.mock.invocationCallOrder[0]);
  });

  it('STEADY STATE: the same episode again costs no query, no audit row, no column write, no notification', async () => {
    prisma.client.screen.findUnique.mockResolvedValue(stored());
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

  it('PHASE (the scheduled playlist is tried again, and fails again): the column only — no lookup, no record, no bell', async () => {
    prisma.client.screen.findUnique.mockResolvedValue(stored());
    await controller.report(SCREEN_ID, req(), { playlistFallback: { ...REPORT, state: 'retrying', forMs: 20 * MIN } });
    expect(written().playlistFallback).toEqual({ ...STORED, state: 'retrying' });
    jest.setSystemTime(NOW + MIN);
    prisma.client.screen.findUnique.mockResolvedValue(stored({ state: 'retrying' }));
    await controller.report(SCREEN_ID, req(), { playlistFallback: { ...REPORT, forMs: 21 * MIN } });
    expect(written().playlistFallback).toEqual(STORED);
    expect(prisma.client.playlist.findMany).not.toHaveBeenCalled();
    expect(prisma.client.auditLog.create).not.toHaveBeenCalled();
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('an episode first seen while RETRYING is recorded but announced only when its backup goes up', async () => {
    await controller.report(SCREEN_ID, req(), { playlistFallback: { ...REPORT, state: 'retrying' } });
    expect(audit()).toHaveLength(1);
    expect(written().playlistFallback).toMatchObject({ state: 'retrying', notified: false });
    expect(notifications.notify).not.toHaveBeenCalled();
    jest.setSystemTime(NOW + MIN);
    prisma.client.screen.findUnique.mockResolvedValue(stored({ state: 'retrying', notified: false, since: SINCE }));
    await controller.report(SCREEN_ID, req(), { playlistFallback: REPORT });
    expect(written().playlistFallback).toMatchObject({ state: 'backup', notified: true });
    expect(notifications.notify).toHaveBeenCalledTimes(1);
    expect(notifications.notify.mock.calls[0][0]).toMatchObject({ title: FALLBACK_NOTIFICATION_TITLE, dedupeKey: `playlist-fallback:${SCREEN_ID}:${SINCE}` });
  });

  it('RECOVERED: an ENDED row, the column cleared, and the admins hear it is back — named from the record, no lookup', async () => {
    prisma.client.screen.findUnique.mockResolvedValue(stored());
    await controller.report(SCREEN_ID, req(), { playlistFallback: { ...REPORT, toPlaylistId: 'pl-4k', state: 'recovered', forMs: 40 * MIN } });
    expect(prisma.client.playlist.findMany).not.toHaveBeenCalled();
    expect(audit()).toHaveLength(1);
    expect(audit()[0]).toMatchObject({ action: 'PLAYER_PLAYLIST_FALLBACK_ENDED', tenantId: 'tenant-a', targetId: SCREEN_ID });
    expect(JSON.parse(audit()[0].details)).toMatchObject({ reason: 'recovered', fromPlaylistId: 'pl-4k', playingPlaylistId: 'pl-4k', playingPlaylistName: '4k', forMs: 40 * MIN });
    expect(written()).toHaveProperty('playlistFallback');
    expect(JSON.stringify(written().playlistFallback)).not.toContain('pl-4k'); // Prisma.DbNull
    expect(notifications.notify).toHaveBeenCalledTimes(1);
    expect(notifications.notify).toHaveBeenCalledWith({
      tenantId: 'tenant-a',
      kind: 'INFO',
      title: 'A screen is back on its scheduled playlist',
      body: 'Lobby TV is back on its scheduled playlist “4k”.',
      link: '/screens',
      dedupeKey: `playlist-fallback-recovered:${SCREEN_ID}:${STORED.since}`,
    });
  });

  it('RECOVERED onto a playlist the schedule moved to: named after a tenant-scoped lookup; a foreign id is not described', async () => {
    prisma.client.screen.findUnique.mockResolvedValue(stored());
    await controller.report(SCREEN_ID, req(), { playlistFallback: { ...REPORT, toPlaylistId: 'pl-lunch', state: 'recovered' } });
    expect(prisma.client.playlist.findMany.mock.calls[0][0].where).toEqual({ tenantId: 'tenant-a', id: { in: ['pl-lunch'] } });
    expect(notifications.notify.mock.calls[0][0].body).toBe('Lobby TV is back on its scheduled playlist “Lunch”.');

    __resetFallbackChangeLimiter();
    jest.setSystemTime(NOW + 31_000); // past the 30 s accept floor
    notifications.notify.mockClear();
    prisma.client.auditLog.create.mockClear();
    await controller.report(SCREEN_ID, req(), { playlistFallback: { ...REPORT, toPlaylistId: 'pl-of-tenant-b', state: 'recovered' } });
    expect(JSON.parse(audit()[0].details).reason).toBe('not-verifiable');
    expect(JSON.stringify(written().playlistFallback)).not.toContain('pl-4k');
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('an episode the admins were never told about ends without a "back" notice', async () => {
    prisma.client.screen.findUnique.mockResolvedValue(stored({ notified: false }));
    await controller.report(SCREEN_ID, req(), { playlistFallback: { ...REPORT, toPlaylistId: 'pl-4k', state: 'recovered' } });
    expect(audit()[0].action).toBe('PLAYER_PLAYLIST_FALLBACK_ENDED');
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('the recovery keeps riding a few reports: once the episode is over they are no-ops', async () => {
    await controller.report(SCREEN_ID, req(), { playlistFallback: { ...REPORT, toPlaylistId: 'pl-4k', state: 'recovered' } });
    expect(prisma.client.auditLog.create).not.toHaveBeenCalled();
    expect(notifications.notify).not.toHaveBeenCalled();
    expect(written()).not.toHaveProperty('playlistFallback');
  });

  it('EXIT without a recovery (the key stops): an ENDED row, the column cleared, no claim to anyone', async () => {
    prisma.client.screen.findUnique.mockResolvedValue(stored());
    await controller.report(SCREEN_ID, req(), {});
    expect(prisma.client.playlist.findMany).not.toHaveBeenCalled();
    expect(audit()).toHaveLength(1);
    expect(JSON.parse(audit()[0].details)).toMatchObject({ fromPlaylistId: 'pl-4k', toPlaylistName: 'Everyday', reason: 'no-longer-reported' });
    expect(JSON.stringify(written().playlistFallback)).not.toContain('pl-4k');
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('CHANGE (another backup in the same episode): recorded with the previous one; the start and its notice are kept', async () => {
    prisma.client.screen.findUnique.mockResolvedValue(stored());
    await controller.report(SCREEN_ID, req(), { playlistFallback: { ...REPORT, toPlaylistId: 'pl-board' } });
    expect(audit()[0].action).toBe('PLAYER_PLAYLIST_FALLBACK');
    expect(JSON.parse(audit()[0].details).previous).toMatchObject({ toPlaylistId: 'pl-everyday' });
    expect(written().playlistFallback).toEqual({ ...STORED, toPlaylistId: 'pl-board', toPlaylistName: 'Board' });
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('ANOTHER playlist cannot play (a new first choice): a new episode, recorded over the old one, announced', async () => {
    prisma.client.screen.findUnique.mockResolvedValue(stored());
    await controller.report(SCREEN_ID, req(), { playlistFallback: { ...REPORT, fromPlaylistId: 'pl-lunch' } });
    expect(JSON.parse(audit()[0].details)).toMatchObject({ fromPlaylistId: 'pl-lunch', previous: { fromPlaylistId: 'pl-4k' } });
    expect(written().playlistFallback).toMatchObject({ fromPlaylistId: 'pl-lunch', since: SINCE, notified: true });
    expect(notifications.notify).toHaveBeenCalledTimes(1);
  });

  it('HOSTILE: another tenant’s playlist id is not a fallback we describe — nothing stored, nothing said', async () => {
    await controller.report(SCREEN_ID, req(), { playlistFallback: { ...REPORT, toPlaylistId: 'pl-of-tenant-b' } });
    expect(prisma.client.playlist.findMany.mock.calls[0][0].where.tenantId).toBe('tenant-a');
    expect(prisma.client.auditLog.create).not.toHaveBeenCalled();
    expect(notifications.notify).not.toHaveBeenCalled();
    expect(written()).not.toHaveProperty('playlistFallback');
  });

  it('HOSTILE: an unverifiable pair over a stored one ends the stored one (reads as "nothing reported")', async () => {
    prisma.client.screen.findUnique.mockResolvedValue(stored());
    await controller.report(SCREEN_ID, req(), { playlistFallback: { ...REPORT, fromPlaylistId: 'pl-of-tenant-b' } });
    expect(audit()[0]).toMatchObject({ action: 'PLAYER_PLAYLIST_FALLBACK_ENDED' });
    expect(JSON.parse(audit()[0].details).reason).toBe('not-verifiable');
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('HOSTILE: a name, an over-long id, a bad state or junk in the block is a 400 before any database work', async () => {
    for (const bad of [{ ...REPORT, fromName: 'x' }, { ...REPORT, fromPlaylistId: 'y'.repeat(200) }, { ...REPORT, forMs: 'soon' }, { ...REPORT, state: 'ok' }]) {
      await expect(controller.report(SCREEN_ID, req(), { playlistFallback: bad })).rejects.toMatchObject({ status: 400 });
    }
    expect(prisma.client.screen.findUnique).not.toHaveBeenCalled();
  });

  it('HOSTILE: a device starting episode after episode reaches the bell a handful of times a day — every one still recorded', async () => {
    const fromIds = ['pl-4k', 'pl-lunch', 'pl-board', 'pl-everyday'];
    let current: StoredPlaylistFallback | null = null;
    let t = NOW;
    for (let i = 0; i < FALLBACK_NOTICES_PER_SCREEN_PER_DAY + 3; i += 1) {
      const fromPlaylistId = fromIds[i % fromIds.length];
      const toPlaylistId = fromIds[(i + 1) % fromIds.length];
      prisma.client.screen.findUnique.mockResolvedValue(row({ playlistFallback: current }));
      await controller.report(SCREEN_ID, req(), { playlistFallback: { ...REPORT, fromPlaylistId, toPlaylistId } });
      current = (written().playlistFallback as StoredPlaylistFallback) ?? current;
      t += FALLBACK_CHANGE_MIN_INTERVAL_MS;
      jest.setSystemTime(t);
    }
    expect(audit()).toHaveLength(FALLBACK_NOTICES_PER_SCREEN_PER_DAY + 3);
    expect(notifications.notify).toHaveBeenCalledTimes(FALLBACK_NOTICES_PER_SCREEN_PER_DAY);
    expect(current?.notified).toBe(false); // …and its end will not be announced either
  });

  it('an unpaired screen (no tenant) is ignored', async () => {
    prisma.client.screen.findUnique.mockResolvedValue(row({ tenantId: null }));
    await controller.report(SCREEN_ID, req(), { playlistFallback: REPORT });
    expect(prisma.client.playlist.findMany).not.toHaveBeenCalled();
    expect(prisma.client.auditLog.create).not.toHaveBeenCalled();
    expect(written()).not.toHaveProperty('playlistFallback');
  });

  it('NO RECORD, NO STATE: if the audit row cannot be written the column is left alone and the report still succeeds', async () => {
    prisma.client.auditLog.create.mockRejectedValue(new Error('db'));
    await expect(controller.report(SCREEN_ID, req(), { playlistFallback: REPORT })).resolves.toMatchObject({ ok: true });
    expect(written()).not.toHaveProperty('playlistFallback');
    expect(notifications.notify).not.toHaveBeenCalled();
    // …and the same for an end.
    __resetFallbackChangeLimiter();
    jest.setSystemTime(NOW + 31_000); // past the 30 s accept floor
    prisma.client.screen.findUnique.mockResolvedValue(stored());
    await controller.report(SCREEN_ID, req(), { playlistFallback: { ...REPORT, toPlaylistId: 'pl-4k', state: 'recovered' } });
    expect(written()).not.toHaveProperty('playlistFallback');
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('a failed lookup changes nothing and never fails the report', async () => {
    prisma.client.playlist.findMany.mockRejectedValue(new Error('db'));
    prisma.client.screen.findUnique.mockResolvedValue(stored({ toPlaylistId: 'pl-board' }));
    await expect(controller.report(SCREEN_ID, req(), { playlistFallback: REPORT })).resolves.toMatchObject({ ok: true });
    expect(prisma.client.auditLog.create).not.toHaveBeenCalled();
    expect(written()).not.toHaveProperty('playlistFallback');
  });

  it('a flapping screen: a second recorded change inside the interval is held to the next report; nothing is lost', async () => {
    await controller.report(SCREEN_ID, req(), { playlistFallback: REPORT });
    expect(audit()).toHaveLength(1);
    // 31 s later the key is gone (past the 30 s accept floor, inside the change interval).
    jest.setSystemTime(NOW + 31_000);
    prisma.client.screen.findUnique.mockResolvedValue(stored());
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
