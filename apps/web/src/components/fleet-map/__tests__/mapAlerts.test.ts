/**
 * ONE source of truth for the fleet map (2026-10-12).
 *
 * The fixture is RIOT Cleveland and RIOT Houston exactly as production held
 * them on 2026-10-12 (bundle ids, push state and render ages from the screens
 * table; the deployed web bundle was 6d803d524f9d). Before this change the
 * map printed three different answers for Cleveland:
 *   - location card "2 current · 1 behind"  (row: push-unacked only)
 *   - all three tiles "BEHIND"              (isContentBehind: + older web build)
 *   - summary "3 screens · 0 playing"       ("playing" = needs nothing at all)
 * and nothing for Houston, whose screens were only on the previous web player.
 *
 * Every consumer below is fed the SAME screens and must agree.
 */
import {
  buildFleetCommand, buildLocationPanel, gradeMapScreen, locationTone, PUSH_CONFIRM_GRACE_MS,
  type FleetCommandScreen, type MapScreenState,
} from '@/components/dashboard/district/fleetCommand';
import type { BuildDistrictRollupInput } from '@/components/dashboard/district/districtRollup';
import type { OpsScreen } from '@/components/screens/v3/screenOps';
import {
  countPlace, emergencyGapOf, fromOpsScreen, matchesMapFilter, placeTone, summarizeMapAlerts,
  toMapAlertScreen, type MapPlace,
} from '../mapAlerts';

const NOW = Date.parse('2026-10-12T13:32:30Z');
const DEPLOYED_SHA = '643161f88ed5';
const DEPLOYED_BUNDLE = '6d803d524f9d';
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;

const CLE = { id: 'cle', name: 'RIOT Cleveland', slug: 'riot-cleveland' };
const HOU = { id: 'hou', name: 'RIOT Houston', slug: 'riot-houston' };

function screen(tenant: typeof CLE, id: string, over: Partial<FleetCommandScreen>): FleetCommandScreen {
  return {
    id, name: id, status: 'ONLINE', renderHealth: 'OK', renderStale: false,
    lastRenderedAt: ago(30_000), lastRenderedHash: 'pl:0|10000|x', pushChannel: 'live',
    lastBundleSha: DEPLOYED_SHA, lastBundleId: DEPLOYED_BUNDLE, pendingRefreshAtMs: null, refreshAckMs: null,
    authState: 'PROVEN', lastPingAt: ago(10_000), sourceTenant: tenant,
    ...over,
  };
}

const SCREENS: FleetCommandScreen[] = [
  // Cleveland — two on an older web build (playing), one sent an update
  // ~10 h ago that it never confirmed and has not confirmed a picture in 51 h.
  screen(CLE, 'Cleveland High Brightness Portrait', { lastBundleSha: '583ccf14e927', lastBundleId: '2b8268744b51' }),
  screen(CLE, 'Pro Series 86', { lastBundleSha: '6498d9f8ea4c', lastBundleId: '293090d5a88c' }),
  screen(CLE, 'Video Wall', {
    lastBundleSha: '78a413053e83', lastBundleId: 'f4560e20b100',
    pendingRefreshAtMs: NOW - 10 * HOUR, refreshAckMs: null,
    renderHealth: 'STALE', renderStale: true, lastRenderedAt: ago(51 * HOUR),
  }),
  // Houston — eight screens, all painting; seven on older web builds.
  screen(HOU, 'Houston 86in Pro Series', { lastBundleId: '2b8268744b51' }),
  screen(HOU, 'Houston Double Sided', { lastBundleId: '9c6c0e1423c3' }),
  screen(HOU, 'Houston Double Sided — Back', { lastBundleId: '9c6c0e1423c3' }),
  screen(HOU, 'Houston Free Standing Kiosk', { lastBundleId: '2b8268744b51' }),
  screen(HOU, 'Houston High Brightness', { lastBundleId: '518ea6f3fc70' }),
  screen(HOU, 'Houston Menu Board Left', { lastBundleId: 'a3c1b35aa485' }),
  screen(HOU, 'Houston Menu Board Right', {}),
  screen(HOU, 'Houston Mobile A-Frame', { lastBundleId: '2b8268744b51' }),
];

function build(screens = SCREENS) {
  const fc = buildFleetCommand({
    screens, deployedSha: DEPLOYED_SHA, deployedBundleId: DEPLOYED_BUNDLE, now: NOW,
    rollupInput: { locations: [CLE, HOU], rootId: null, screens: screens as unknown as BuildDistrictRollupInput["screens"], readiness: null, approvals: null },
  });
  const graded = screens.map((s) => toMapAlertScreen(s, DEPLOYED_SHA, DEPLOYED_BUNDLE, NOW));
  const places: MapPlace[] = fc.locations.map((row) => ({
    id: row.tenantId, name: row.name,
    screens: graded.filter((g) => screens.find((s) => s.id === g.id)?.sourceTenant?.id === row.tenantId),
    pushStale: row.pushStale, emergencyGap: emergencyGapOf(row.readiness, row.hasScreens),
  }));
  return { fc, places, summary: summarizeMapAlerts(places) };
}

describe('the fleet map has ONE grader', () => {
  it('Cleveland: the card, the tiles, the chip, the ring and the summary all say 2 playing · 1 not confirmed', () => {
    const { fc, places, summary } = build();
    const row = fc.locations.find((r) => r.tenantId === 'cle')!;
    const place = places.find((p) => p.id === 'cle')!;
    const panel = buildLocationPanel(row, locationTone(row));
    const tiles = place.screens.map((s) => s.grade.state);
    const counts = countPlace(place.screens);

    // Location row (table, chips, ring) and the card print from it.
    expect([row.screensPlaying, row.contentBehind]).toEqual([2, 1]);
    expect([panel.screensCurrent, panel.screensBehind]).toEqual([2, 1]);
    // Tiles — the same grader, so exactly one is behind.
    expect(tiles.filter((t) => t === 'behind')).toHaveLength(1);
    expect(tiles.filter((t) => t === 'playing')).toHaveLength(2);
    expect(place.screens.find((s) => s.grade.state === 'behind')!.id).toBe('Video Wall');
    // The shared place counts.
    expect([counts.playing, counts.behind, counts.appUpdating]).toEqual([2, 1, 2]);
    // The chip and the ring.
    expect(matchesMapFilter(place, 'drift')).toBe(true);
    expect(placeTone(place)).toBe(locationTone(row));
    // The summary — fleet-wide — names Cleveland and only Cleveland.
    expect(summary.action).toEqual({ kind: 'drift', count: 1, places: [{ id: 'cle', name: 'RIOT Cleveland', count: 1 }] });
  });

  it('Houston: on the previous web player is PLAYING (it updates itself) — never behind, never an alert', () => {
    const { fc, places, summary } = build();
    const row = fc.locations.find((r) => r.tenantId === 'hou')!;
    const place = places.find((p) => p.id === 'hou')!;
    expect([row.screensPlaying, row.contentBehind, row.screensAppUpdating]).toEqual([8, 0, 7]);
    expect(matchesMapFilter(place, 'drift')).toBe(false);
    expect(placeTone(place)).toBe('ok');
    expect(summary.playing).toBe(10);
    expect(summary.appUpdating).toBe(9);
    expect(summary.behind).toBe(1);
  });

  it('if Houston WERE sent an update it did not confirm, the summary would name it too — fleet-wide, not chip-wide', () => {
    const screens = SCREENS.map((s) =>
      s.id === 'Houston Mobile A-Frame' ? { ...s, pendingRefreshAtMs: NOW - 20 * MIN } : s,
    );
    const { summary } = build(screens);
    expect(summary.action?.kind).toBe('drift');
    expect(summary.action?.count).toBe(2);
    // Equal counts keep the rollup's worst-first order.
    expect(summary.action?.places).toEqual([
      { id: 'cle', name: 'RIOT Cleveland', count: 1 },
      { id: 'hou', name: 'RIOT Houston', count: 1 },
    ]);
  });

  it('the states are mutually exclusive: every location’s counts add up to its screen total', () => {
    const { fc, places } = build();
    for (const row of fc.locations) {
      const c = countPlace(places.find((p) => p.id === row.tenantId)!.screens);
      expect(c.playing + c.syncing + c.behind + c.offline + c.noPicture + c.unconfirmed).toBe(row.screensTotal);
      expect([c.playing, c.syncing, c.behind, c.offline, c.noPicture, c.unconfirmed])
        .toEqual([row.screensPlaying, row.screensSyncing, row.contentBehind, row.screensOffline, row.notPainting, row.screensUnconfirmed]);
    }
  });

  it('an update inside its confirmation window is "syncing" — not behind, not an alert, not an inbox row', () => {
    const screens = [screen(CLE, 'fresh', { pendingRefreshAtMs: NOW - (PUSH_CONFIRM_GRACE_MS - 5_000) })];
    expect(gradeMapScreen(screens[0], DEPLOYED_SHA, DEPLOYED_BUNDLE, NOW).state).toBe('syncing');
    const { fc, summary } = build(screens);
    expect(fc.locations.find((r) => r.tenantId === 'cle')!.contentBehind).toBe(0);
    expect(fc.inboxAll.some((r) => r.kind === 'content-behind')).toBe(false);
    expect(summary.action).toBeNull();
    expect(summary.syncing).toBe(1);
  });

  it('offline outranks everything; no picture outranks an unconfirmed update', () => {
    const off = screen(CLE, 'off', { status: 'OFFLINE', pendingRefreshAtMs: NOW - HOUR });
    const dark = screen(CLE, 'dark', { renderHealth: 'STALE', renderStale: true, lastRenderedAt: ago(20 * MIN), pendingRefreshAtMs: NOW - HOUR });
    expect(gradeMapScreen(off, DEPLOYED_SHA, DEPLOYED_BUNDLE, NOW).state).toBe('offline');
    expect(gradeMapScreen(dark, DEPLOYED_SHA, DEPLOYED_BUNDLE, NOW).state).toBe('no-picture');
  });

  it('a Screens-page row grades exactly like the same screen in the fleet payload', () => {
    for (const s of SCREENS) {
      const ops = {
        id: s.id, name: s.name, status: s.status, renderHealth: s.renderHealth, renderStale: s.renderStale,
        lastRenderedAt: s.lastRenderedAt, lastRenderedHash: s.lastRenderedHash, pushChannel: s.pushChannel,
        lastBundleSha: s.lastBundleSha, lastBundleId: s.lastBundleId,
        pendingRefreshAt: s.pendingRefreshAtMs != null ? new Date(s.pendingRefreshAtMs).toISOString() : null,
        authState: s.authState, lastPingAt: s.lastPingAt,
      };
      expect(gradeMapScreen(fromOpsScreen(ops as unknown as OpsScreen), DEPLOYED_SHA, DEPLOYED_BUNDLE, NOW))
        .toEqual(gradeMapScreen(s, DEPLOYED_SHA, DEPLOYED_BUNDLE, NOW));
    }
  });

  it('the summary priority: offline > no picture > emergency gap > update not confirmed', () => {
    const p = (id: string, state: MapScreenState, over: Partial<MapPlace> = {}): MapPlace => ({
      id, name: id, pushStale: 0, emergencyGap: null,
      screens: [{ id: `${id}-s`, name: 's', status: 'ONLINE', lastPingAt: null, lastRenderedAt: null, grade: { state, appUpdating: false, pushSentAtMs: null } }],
      ...over,
    });
    expect(summarizeMapAlerts([p('a', 'behind'), p('b', 'playing', { emergencyGap: 'not-configured' }), p('c', 'no-picture'), p('d', 'offline')]).action?.kind).toBe('offline');
    expect(summarizeMapAlerts([p('a', 'behind'), p('b', 'playing', { emergencyGap: 'not-configured' }), p('c', 'no-picture')]).action?.kind).toBe('dark');
    expect(summarizeMapAlerts([p('a', 'behind'), p('b', 'playing', { emergencyGap: 'needs-attention' })]).action?.kind).toBe('emergency');
    expect(summarizeMapAlerts([p('a', 'behind')]).action?.kind).toBe('drift');
    // A screenless location's missing alert content is setup, not an alarm.
    expect(emergencyGapOf('NOT_CONFIGURED', false)).toBeNull();
    expect(emergencyGapOf('UNKNOWN', true)).toBeNull();
  });
});
