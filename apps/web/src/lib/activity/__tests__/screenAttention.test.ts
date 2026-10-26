import { offlineKey, sortOfflineScreens, type ScreenRowLike } from '../screenAttention';

const NOW = Date.parse('2026-10-24T22:00:00Z');
const H = 60 * 60 * 1000;

const mediaPlayer: ScreenRowLike = { id: 'mp', name: 'Venue Media Player', status: 'OFFLINE', lastPingAt: new Date(NOW - 41 * H).toISOString(), hardwareModel: 'generic-android', osInfo: 'Android', playerVersion: '1.1.42' };
const test1: ScreenRowLike = { id: 't1', name: 'Test 1', status: 'OFFLINE', lastPingAt: '2026-08-06T19:10:58.000Z', hardwareModel: 'web', osInfo: 'iOS', playerVersion: null, screenGroup: { name: 'Web App' } };
const online: ScreenRowLike = { id: 'on', name: 'Lobby', status: 'ONLINE', lastPingAt: new Date(NOW - 10_000).toISOString() };
const pending: ScreenRowLike = { id: 'p', name: 'New', status: 'PENDING', lastPingAt: null };

describe('Screens down vs quiet', () => {
  it('the owner\'s Home: one real outage, one test screen silent since Aug 6 — with no server verdict yet', () => {
    const out = sortOfflineScreens([mediaPlayer, test1, online, pending], null, NOW);
    expect(out.down.map((s) => s.id)).toEqual(['mp']);
    expect(out.dormant).toEqual([expect.objectContaining({ id: 't1', reason: 'not-seen-30-days', groupName: 'Web App' })]);
    expect(out.resting).toEqual([]);
  });

  it('the server\'s verdict wins: a screen off on schedule is resting, not down', () => {
    const out = sortOfflineScreens([mediaPlayer, test1], {
      down: [],
      resting: [{ id: 'mp', name: 'Venue Media Player', lastSeenAt: null, reason: 'display-schedule-off' }],
      dormant: [{ id: 't1', name: 'Test 1', lastSeenAt: null, reason: 'not-seen-30-days' }],
    }, NOW);
    expect(out.down).toEqual([]);
    expect(out.resting).toEqual([expect.objectContaining({ id: 'mp', reason: 'display-schedule-off' })]);
  });

  it('a screen that went offline after the verdict was read is DOWN (never hidden)', () => {
    const out = sortOfflineScreens([mediaPlayer, { ...online, status: 'OFFLINE', lastPingAt: new Date(NOW - 5 * 60_000).toISOString() }], { down: [{ id: 'mp', name: '', lastSeenAt: null, reason: null }], resting: [], dormant: [] }, NOW);
    expect(out.down.map((s) => s.id).sort()).toEqual(['mp', 'on']);
  });

  it('a phone-browser test screen is quiet after a day; a Windows browser kiosk is not', () => {
    const phone = { ...test1, id: 'ph', lastPingAt: new Date(NOW - 30 * H).toISOString() };
    const kiosk = { ...phone, id: 'pc', osInfo: 'Windows' };
    const out = sortOfflineScreens([phone, kiosk], null, NOW);
    expect(out.dormant.map((s) => s.id)).toEqual(['ph']);
    expect(out.down.map((s) => s.id)).toEqual(['pc']);
  });

  it('the longest-silent outage leads the red card', () => {
    const a = { ...mediaPlayer, id: 'a', lastPingAt: new Date(NOW - 2 * H).toISOString() };
    const b = { ...mediaPlayer, id: 'b', lastPingAt: new Date(NOW - 20 * H).toISOString() };
    expect(sortOfflineScreens([a, b], null, NOW).down.map((s) => s.id)).toEqual(['b', 'a']);
  });

  it('the refetch key changes only when the offline set changes', () => {
    expect(offlineKey([mediaPlayer, test1, online])).toBe('mp,t1');
    expect(offlineKey([test1, mediaPlayer, { ...online, lastPingAt: 'x' }])).toBe('mp,t1');
  });
});
