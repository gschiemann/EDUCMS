/**
 * playlistOps — the truth model, tested without mounting anything.
 *
 * Two families of assertion:
 *   1. Derivation correctness — §4.1 schedule-state precedence, §11 delivery
 *      precedence, reach, filters, sorting, the confirmation copy.
 *   2. THE LANGUAGE GATE — every string this module can emit is swept for the
 *      §4.3 prohibited vocabulary. That test is the reason the mock's
 *      "Confirmed 4/4" never made it into the build: the platform stores no
 *      expected per-target content signature, so nothing here may claim one.
 */

import {
  applyLibrary,
  buildExceptionBanner,
  buildPlaylistRow,
  countByStatus,
  describeContent,
  describeDays,
  describeReach,
  deriveDeliveryFromScreens,
  derivePlaybackCopyStates,
  deriveReach,
  deriveScheduleState,
  deriveTargetsFromScreens,
  retryPublishPayload,
  DELIVERY_UNAVAILABLE,
  EMPTY_FILTERS,
  formatClock,
  formatDuration,
  isScheduleEligibleNow,
  needsAttention,
  overlayCurrentScreenHealth,
  pauseEverywhereCopy,
  removePlaylistCopy,
  removePlaylistCopyFromServer,
  removePlaylistsCopy,
  removePlaylistsSequentially,
  describeRemoveManyOutcome,
  REMOVE_MANY_NAMES_SHOWN,
  resolveTargetScreenIds,
  summarizeDelivery,
  summarizeDeliveryPayload,
  worstTargetState,
  type DeliveryTarget,
  type OpsScheduleRef,
  type OpsScreenRef,
  type PlaylistSummaryRow,
} from '../playlistOps';

// A Wednesday, 10:00 local — inside a weekday 08:00–17:00 window.
const WED_10AM = new Date('2026-09-02T10:00:00');
const NOW_MS = WED_10AM.getTime();

function sched(over: Partial<OpsScheduleRef> = {}): OpsScheduleRef {
  return {
    id: over.id ?? 's1',
    playlistId: over.playlistId ?? 'p1',
    startTime: over.startTime ?? new Date(NOW_MS - 86_400_000).toISOString(),
    isActive: true,
    ...over,
  };
}

function screen(over: Partial<OpsScreenRef> = {}): OpsScreenRef {
  return {
    id: over.id ?? 'sc1',
    name: over.name ?? 'Lobby TV',
    status: 'ONLINE',
    lastRenderedAt: new Date(NOW_MS - 20_000).toISOString(),
    lastRenderedHash: 'pl:test|30000|version',
    renderHealth: 'OK',
    pushChannel: 'live',
    ...over,
  };
}

function target(state: DeliveryTarget['state'], name: string): DeliveryTarget {
  return {
    screenId: name, name, locationName: null, online: state !== 'offline',
    ackAt: null, lastProofAt: null, pushChannel: 'live', state,
  };
}

// ─────────────────────────────────────────────────────────────────────
describe('§4.1 schedule-state precedence', () => {
  it('no schedules and no fleet fan-out is UNASSIGNED, not paused', () => {
    const r = deriveScheduleState([], WED_10AM);
    expect(r.state).toBe('UNASSIGNED');
    expect(r.summary).toBe('Not scheduled');
  });

  it('an always-on enabled schedule is ACTIVE', () => {
    const r = deriveScheduleState([sched()], WED_10AM);
    expect(r.state).toBe('ACTIVE');
    expect(r.summary).toBe('Always');
  });

  it('an eligible weekday window is ACTIVE and prints the window', () => {
    const r = deriveScheduleState(
      [sched({ daysOfWeek: 'Mon,Tue,Wed,Thu,Fri', timeStart: '05:00', timeEnd: '22:00' })],
      WED_10AM,
    );
    expect(r.state).toBe('ACTIVE');
    expect(r.summary).toBe('Weekdays · 5:00 AM–10:00 PM');
  });

  it('a future start is SCHEDULED and names the date', () => {
    const r = deriveScheduleState(
      [sched({ startTime: '2026-09-20T16:00:00', timeStart: '16:00' })],
      WED_10AM,
    );
    expect(r.state).toBe('SCHEDULED');
    expect(r.summary).toBe('Starts Sep 20 · 4:00 PM');
  });

  it('a failed media preparation is visible as a failed publish', () => {
    const r = deriveScheduleState([sched({ isActive: false, pendingMedia: true,
      pendingMediaError: 'A playback copy could not be prepared. Retry publishing this playlist.' })], WED_10AM);
    expect(r.pillLabel).toBe('MEDIA FAILED');
    expect(r.summary).toMatch(/could not be prepared/);
  });

  it('a pending playback copy stays visible when another rule already plays', () => {
    const r = deriveScheduleState([sched({ id: 'playing' }), sched({ id: 'new', isActive: false, pendingMedia: true })], WED_10AM);
    expect(r.pillLabel).toBe('PREPARING 1080P');
    expect(r.summary).toMatch(/publishing starts automatically/);
  });

  it('every schedule disabled is PAUSED even when its window is open', () => {
    const r = deriveScheduleState([sched({ isActive: false })], WED_10AM);
    expect(r.state).toBe('PAUSED');
    expect(r.pillLabel).toBe('PAUSED');
  });

  it('ACTIVE beats SCHEDULED when both kinds of rule exist', () => {
    const r = deriveScheduleState(
      [sched({ id: 'a' }), sched({ id: 'b', startTime: '2026-12-01T09:00:00' })],
      WED_10AM,
    );
    expect(r.state).toBe('ACTIVE');
  });

  it('an enabled but expired rule reads ENDED, and stays inside the four-value contract', () => {
    const r = deriveScheduleState(
      [sched({ startTime: '2026-08-01T00:00:00', endTime: '2026-08-12T23:59:00' })],
      WED_10AM,
    );
    // The API contract only knows four states — ENDED is a pill label, never a
    // fifth state value.
    expect(r.state).toBe('PAUSED');
    expect(r.pillLabel).toBe('ENDED');
    expect(r.summary).toBe('Ended Aug 12');
  });

  it('an HQ source with no rules of its own reports its childrens activity', () => {
    const r = deriveScheduleState([], WED_10AM, { fleetActiveSchedules: 6, fleetLocations: 3 });
    expect(r.state).toBe('ACTIVE');
    expect(r.summary).toBe('Running at 3 locations');
  });

  it('honours the overnight wrap the player uses (22:00–06:00 is open at 23:00)', () => {
    const lateWed = new Date('2026-09-02T23:30:00');
    expect(isScheduleEligibleNow(
      sched({ daysOfWeek: 'Wed', timeStart: '22:00', timeEnd: '06:00' }), lateWed,
    )).toBe(true);
    // ...and the morning half belongs to the START day.
    const earlyThu = new Date('2026-09-03T02:00:00');
    expect(isScheduleEligibleNow(
      sched({ daysOfWeek: 'Wed', timeStart: '22:00', timeEnd: '06:00' }), earlyThu,
    )).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────
describe('§11 delivery precedence', () => {
  it('orders worst-first exactly as the handoff specifies', () => {
    expect(worstTargetState(['acknowledged', 'unknown'])).toBe('unknown');
    expect(worstTargetState(['unknown', 'offline'])).toBe('offline');
    expect(worstTargetState(['offline', 'not-updated'])).toBe('not-updated');
    expect(worstTargetState(['not-updated', 'no-picture'])).toBe('no-picture');
    expect(worstTargetState(['no-picture', 'content-mismatch'])).toBe('content-mismatch');
  });

  it('names the failing screen instead of flattening to "Partial"', () => {
    const s = summarizeDelivery([
      target('acknowledged', 'A'), target('acknowledged', 'B'),
      target('acknowledged', 'C'), target('not-updated', 'G43'),
    ]);
    expect(s.state).toBe('not-updated');
    expect(s.label).toBe('G43: not updated');
    expect(s.sub).toBe('3 of 4 received');
    expect(s.label).not.toMatch(/partial/i);
  });

  it('a fully acknowledged push says received, never confirmed', () => {
    const s = summarizeDelivery([target('acknowledged', 'A'), target('acknowledged', 'B')]);
    expect(s.tone).toBe('ok');
    expect(s.label).toBe('Update received');
    expect(s.sub).toBe('on 2 of 2');
  });

  it('unknown is never styled as success', () => {
    const s = summarizeDelivery([target('unknown', 'A'), target('unknown', 'B')]);
    expect(s.tone).not.toBe('ok');
    expect(s.state).toBe('unknown');
  });

  it('no targets is Not published, not a green zero', () => {
    const s = summarizeDelivery([]);
    expect(s.state).toBe('not-published');
    expect(s.tone).toBe('muted');
    expect(s.label).toBe('Not published');
  });

  it('a fresh push still converging reads as sending, not as a failure', () => {
    const s = summarizeDelivery(
      [target('acknowledged', 'A'), target('not-updated', 'B')],
      { pushing: true },
    );
    expect(s.state).toBe('pushing');
    expect(s.label).toBe('Sending update');
    expect(s.sub).toBe('1 of 2 received');
  });

  it('a missing delivery payload surfaces unavailable, never a healthy gray (§22.5)', () => {
    const s = summarizeDeliveryPayload(null);
    expect(s).toBe(DELIVERY_UNAVAILABLE);
    expect(s.tone).toBe('unavailable');
    expect(s.label).toBe('Delivery status unavailable');
  });

  it('an empty deployment history is Not published', () => {
    expect(summarizeDeliveryPayload({ latest: null, history: [] }).state).toBe('not-published');
  });
});

// ─────────────────────────────────────────────────────────────────────
describe('degradation: grading targets from the screens payload', () => {
  it('matches the pending push VALUE exactly — never a clock comparison', () => {
    const pending = NOW_MS - 30_000;
    const [ok] = deriveTargetsFromScreens(
      [screen({ pendingRefreshAt: new Date(pending).toISOString(), refreshAckMs: pending })], NOW_MS,
    );
    expect(ok.state).toBe('acknowledged');

    // A LATER ack that does not equal the pending value is NOT an ack. A
    // signage box with minutes of clock skew must not be able to talk its way
    // into a green row.
    const [skewed] = deriveTargetsFromScreens(
      [screen({ pendingRefreshAt: new Date(pending).toISOString(), refreshAckMs: pending + 5_000 })], NOW_MS,
    );
    expect(skewed.state).toBe('not-updated');
  });

  it('offline outranks everything — an unreachable screen is never "not updated"', () => {
    const [t] = deriveTargetsFromScreens(
      [screen({ status: 'OFFLINE', pendingRefreshAt: new Date(NOW_MS).toISOString(), refreshAckMs: null })], NOW_MS,
    );
    expect(t.state).toBe('offline');
  });

  it('a reachable screen the server graded STALE has no confirmed picture', () => {
    const [t] = deriveTargetsFromScreens([screen({ renderHealth: 'STALE', renderStale: true })], NOW_MS);
    expect(t.state).toBe('no-picture');
  });

  it('a screen that has never reported a picture is unknown, not healthy', () => {
    const [t] = deriveTargetsFromScreens([screen({ lastRenderedAt: null, renderHealth: 'UNKNOWN' })], NOW_MS);
    expect(t.state).toBe('unknown');
  });

  it('an unavailable player fallback is a playback problem', () => {
    const unavailable = deriveDeliveryFromScreens([screen({ lastRenderedHash: 'idle:content-unavailable' })], NOW_MS);
    expect(unavailable.state).toBe('playback-issue');
    expect(unavailable.tone).toBe('bad');
  });

  it('with no push on record, a fresh picture is reported without claiming confirmation', () => {
    const s = deriveDeliveryFromScreens([screen({ id: 'a' }), screen({ id: 'b', name: 'Cafe' })], NOW_MS);
    expect(s.tone).toBe('muted');
    expect(s.label).toBe('Playback reported');
    expect(s.sub).toBe('on 2 of 2');
    expect(s.label).not.toMatch(/update received/i);
  });

  it('reproduces the mock G43 case: 4 targets, one behind', () => {
    const pending = NOW_MS - 12 * 60_000;
    const iso = new Date(pending).toISOString();
    const s = deriveDeliveryFromScreens([
      screen({ id: '1', name: 'Front', pendingRefreshAt: iso, refreshAckMs: pending }),
      screen({ id: '2', name: 'Back', pendingRefreshAt: iso, refreshAckMs: pending }),
      screen({ id: '3', name: 'Side', pendingRefreshAt: iso, refreshAckMs: pending }),
      screen({ id: '4', name: 'G43', pendingRefreshAt: iso, refreshAckMs: null }),
    ], NOW_MS);
    expect(s.label).toBe('G43: not updated');
    expect(s.sub).toBe('3 of 4 received');
    expect(s.tone).toBe('warn');
    expect(s.worstNames).toEqual(['G43']);
  });

  it('a push seconds old is still converging, not yet a failure', () => {
    const pending = NOW_MS - 5_000;
    const iso = new Date(pending).toISOString();
    const s = deriveDeliveryFromScreens([
      screen({ id: '1', name: 'Front', pendingRefreshAt: iso, refreshAckMs: pending }),
      screen({ id: '2', name: 'G43', pendingRefreshAt: iso, refreshAckMs: null }),
    ], NOW_MS);
    expect(s.state).toBe('pushing');
  });
});

// ─────────────────────────────────────────────────────────────────────
describe('reach', () => {
  const groups = [{ id: 'g1', name: 'Lobby', screens: [{ id: 'a' }, { id: 'b' }] }];
  const screens = [screen({ id: 'a' }), screen({ id: 'b' }), screen({ id: 'c' })];

  it('expands a group to its member screens', () => {
    const r = deriveReach([sched({ screenGroupId: 'g1' })], groups, screens);
    expect(r).toEqual({ screens: 2, groups: 1, locations: 0 });
  });

  it('does not double-count a screen reached by both a pin and its group', () => {
    const r = deriveReach(
      [sched({ id: '1', screenGroupId: 'g1' }), sched({ id: '2', screenId: 'a' })],
      groups, screens,
    );
    expect(r.screens).toBe(2);
  });

  it('describes reach the way the mock does', () => {
    expect(describeReach({ screens: 4, groups: 2, locations: 0 })).toBe('4 screens · 2 groups');
    expect(describeReach({ screens: 3, groups: 0, locations: 0 })).toBe('3 screens');
    expect(describeReach({ screens: 18, groups: 0, locations: 3 })).toBe('3 locations · 18 screens');
    expect(describeReach({ screens: 0, groups: 0, locations: 0 })).toBe('No screens');
  });

  it('resolves the drilldown screen id set', () => {
    expect(resolveTargetScreenIds([sched({ screenGroupId: 'g1' })], groups, screens).sort())
      .toEqual(['a', 'b']);
  });
});

// ─────────────────────────────────────────────────────────────────────
describe('the library row', () => {
  const groups = [{ id: 'g1', name: 'Lobby', screens: [{ id: 'a' }] }];
  const screens = [screen({ id: 'a', name: 'G43' })];

  it('builds the §26 summary shape from the full payload (degradation path)', () => {
    const row = buildPlaylistRow({
      playlist: {
        id: 'p1', name: 'Lobby Promotions', updatedAt: new Date(NOW_MS - 12 * 60_000).toISOString(),
        items: [{ durationMs: 10_000 }, { durationMs: 20_000 }],
        createdBy: { email: 'garlan@example.com' },
      },
      schedules: [sched({ screenId: 'a' })],
      screens, groups, now: WED_10AM,
    });
    expect(row.kind).toBe('media');
    expect(row.itemCount).toBe(2);
    expect(row.scheduleState).toBe('ACTIVE');
    expect(row.reach.screens).toBe(1);
    expect(row.sourceOwnership).toBe('own');
    expect(describeContent(row)).toBe('2 items · 0:30');
  });

  it('marks an HQ-distributed copy', () => {
    const row = buildPlaylistRow({
      playlist: { id: 'p2', name: 'Corporate promo', sourcePlaylistId: 'src' },
      schedules: [], screens, groups, now: WED_10AM,
    });
    expect(row.sourceOwnership).toBe('hq');
  });

  it('describes a template playlist by its canvas, not an item count', () => {
    const row = buildPlaylistRow({
      playlist: {
        id: 'p3', name: 'Club Welcome',
        template: { id: 't', name: 'Welcome', screenWidth: 1920, screenHeight: 1080 },
      },
      schedules: [], screens, groups, now: WED_10AM,
    });
    expect(row.kind).toBe('template');
    expect(describeContent(row)).toBe('Template · 1920×1080');
  });

  it('a PAUSED playlist never inherits its old targets’ delivery health', () => {
    const row = buildPlaylistRow({
      playlist: { id: 'p9', name: 'Trainer Spotlight' },
      // The rule is switched off — the screen is healthy, but it is showing
      // something else now, so this playlist may claim nothing about it.
      schedules: [sched({ playlistId: 'p9', screenId: 'a', isActive: false })],
      screens, groups, now: WED_10AM,
    });
    expect(row.scheduleState).toBe('PAUSED');
    expect(row.delivery.label).toBe('Not playing');
    expect(row.delivery.tone).toBe('muted');
    expect(row.delivery.label).not.toMatch(/received|confirmed/i);
    expect(needsAttention(row)).toBe(false);
  });

  it('an UNASSIGNED playlist reads Not published, not Not playing', () => {
    const row = buildPlaylistRow({
      playlist: { id: 'p10', name: 'Draft' },
      schedules: [], screens, groups, now: WED_10AM,
    });
    expect(row.scheduleState).toBe('UNASSIGNED');
    expect(row.delivery.label).toBe('Not published');
  });

  it('a SCHEDULED playlist still grades its targets — it is eligible, just later', () => {
    const row = buildPlaylistRow({
      playlist: { id: 'p11', name: 'Fall Drive' },
      schedules: [sched({ playlistId: 'p11', screenId: 'a', startTime: '2026-12-01T09:00:00' })],
      screens, groups, now: WED_10AM,
    });
    expect(row.scheduleState).toBe('SCHEDULED');
    expect(row.delivery.tone).toBe('muted');
  });

  it('search text covers name, creator, template and target names (§7.4)', () => {
    const row = buildPlaylistRow({
      playlist: {
        id: 'p1', name: 'Lobby Promotions', createdBy: { email: 'garlan@example.com' },
        template: { id: 't', name: 'Hero Board' },
      },
      schedules: [sched({ screenId: 'a' })],
      screens, groups, now: WED_10AM, assetNames: ['spring-sale.jpg'],
    });
    for (const q of ['lobby', 'garlan', 'hero board', 'spring-sale', 'g43']) {
      expect(row.searchText).toContain(q);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
describe('status tabs, filters, sorting', () => {
  function row(over: Partial<PlaylistSummaryRow>): PlaylistSummaryRow {
    return {
      id: 'x', name: 'X', kind: 'media', itemCount: 1, durationMs: 1000,
      thumbnailUrl: null, templateSummary: null, creatorSummary: null,
      scheduleState: 'ACTIVE', statusLabel: 'ACTIVE', reviewState: null,
      reach: { screens: 1, groups: 0, locations: 0 }, scheduleSummary: 'Always',
      syncPlayback: false,
      updatedAt: new Date(NOW_MS).toISOString(), sourceOwnership: 'own',
      delivery: summarizeDelivery([target('acknowledged', 'A')]),
      targetScreenIds: [], searchText: 'x',
      ...over,
    };
  }

  const rows = [
    row({ id: 'a', name: 'Alpha', scheduleState: 'ACTIVE' }),
    row({ id: 'b', name: 'Bravo', scheduleState: 'SCHEDULED' }),
    row({ id: 'c', name: 'Charlie', scheduleState: 'UNASSIGNED', delivery: summarizeDelivery([]) }),
    row({
      id: 'd', name: 'Delta', scheduleState: 'ACTIVE',
      delivery: summarizeDelivery([target('acknowledged', 'A'), target('not-updated', 'G43')]),
    }),
  ];

  it('counts overlap deliberately — attention is an exception filter (§7.3)', () => {
    const c = countByStatus(rows);
    expect(c).toEqual({ all: 4, active: 2, scheduled: 1, unassigned: 1, attention: 1 });
    // 2 + 1 + 1 = 4, and attention overlaps active — that is the design.
    expect(c.active + c.scheduled + c.unassigned + c.attention).not.toBe(c.all);
  });

  it('a paused playlist with an offline target never lands in Needs attention', () => {
    const paused = row({
      scheduleState: 'PAUSED',
      delivery: summarizeDelivery([target('offline', 'G43')]),
    });
    expect(needsAttention(paused)).toBe(false);
  });

  it('an unavailable delivery read counts as needing attention on an active playlist', () => {
    expect(needsAttention(row({ scheduleState: 'ACTIVE', delivery: DELIVERY_UNAVAILABLE }))).toBe(true);
  });

  it('filters by status tab', () => {
    const out = applyLibrary({ rows, tab: 'attention', search: '', filters: EMPTY_FILTERS, sort: 'updated' });
    expect(out.map((r) => r.id)).toEqual(['d']);
  });

  it('searches the row haystack', () => {
    const out = applyLibrary({
      rows: [row({ id: 'a', name: 'Alpha', searchText: 'alpha g43' })],
      tab: 'all', search: 'G43', filters: EMPTY_FILTERS, sort: 'updated',
    });
    expect(out).toHaveLength(1);
  });

  it('sorts needs-attention first when asked', () => {
    const out = applyLibrary({ rows, tab: 'all', search: '', filters: EMPTY_FILTERS, sort: 'attention' });
    expect(out[0].id).toBe('d');
  });

  it('sorts by name and by most screens', () => {
    const byName = applyLibrary({ rows, tab: 'all', search: '', filters: EMPTY_FILTERS, sort: 'name' });
    expect(byName.map((r) => r.name)).toEqual(['Alpha', 'Bravo', 'Charlie', 'Delta']);
    const wide = [row({ id: 'w', name: 'Wide', reach: { screens: 9, groups: 0, locations: 0 } }), ...rows];
    const byScreens = applyLibrary({ rows: wide, tab: 'all', search: '', filters: EMPTY_FILTERS, sort: 'screens' });
    expect(byScreens[0].id).toBe('w');
  });

  it('filters by content type and ownership', () => {
    const mixed = [row({ id: 't', kind: 'template' }), row({ id: 'm', kind: 'media', sourceOwnership: 'hq' })];
    expect(applyLibrary({ rows: mixed, tab: 'all', search: '', filters: { ...EMPTY_FILTERS, contentType: 'template' }, sort: 'updated' })
      .map((r) => r.id)).toEqual(['t']);
    expect(applyLibrary({ rows: mixed, tab: 'all', search: '', filters: { ...EMPTY_FILTERS, ownership: 'hq' }, sort: 'updated' })
      .map((r) => r.id)).toEqual(['m']);
  });

  it('filters by a specific screen', () => {
    const scoped = [row({ id: 'a', targetScreenIds: ['s1'] }), row({ id: 'b', targetScreenIds: ['s2'] })];
    expect(applyLibrary({ rows: scoped, tab: 'all', search: '', filters: { ...EMPTY_FILTERS, screenId: 's2' }, sort: 'updated' })
      .map((r) => r.id)).toEqual(['b']);
  });

  it('builds the exception banner from the worst row, naming both playlist and screen', () => {
    const banner = buildExceptionBanner(rows);
    expect(banner).not.toBeNull();
    expect(banner!.count).toBe(1);
    expect(banner!.headline).toBe('1 playlist needs attention');
    expect(banner!.detail).toBe('Delta is active, but G43 has not received the latest update.');
    expect(banner!.playlistId).toBe('d');
  });

  it('renders no banner when nothing is actionable (§7.5)', () => {
    expect(buildExceptionBanner([rows[0], rows[1]])).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────
describe('1080p playback copies — what each screen\'s switch may do (rule 16)', () => {
  const FAIL = 'A playback copy could not be prepared. Retry publishing this playlist.';
  const groups = [{ id: 'G', name: 'Hallway', screens: [{ id: 'g1' }, { id: 'g2' }] }];
  const screens = [screen({ id: 'lcd' }), screen({ id: 'wall' }), screen({ id: 'g1', screenGroupId: 'G' }), screen({ id: 'g2', screenGroupId: 'G' })];

  it('a screen whose own rule is held is preparing; one whose copy failed carries the server\'s words', () => {
    const m = derivePlaybackCopyStates([
      sched({ id: 'a', screenId: 'lcd', isActive: false, pendingMedia: true }),
      sched({ id: 'b', screenId: 'wall', isActive: false, pendingMedia: true, pendingMediaError: FAIL }),
    ], groups, screens);
    expect(m.get('lcd')).toEqual({ state: 'preparing', error: null, groupName: null });
    expect(m.get('wall')).toEqual({ state: 'failed', error: FAIL, groupName: null });
  });

  it('a screen with nothing pending is absent — its switch is a plain on/off', () => {
    const m = derivePlaybackCopyStates([sched({ id: 'a', screenId: 'lcd' }), sched({ id: 'b', screenId: 'wall', isActive: false })], groups, screens);
    expect(m.size).toBe(0);
  });

  it('every member of a group whose rule is preparing is locked, named for the group', () => {
    const m = derivePlaybackCopyStates([sched({ id: 'g', screenGroupId: 'G', isActive: false, pendingMedia: true })], groups, screens);
    expect(m.get('g1')).toEqual({ state: 'group-preparing', error: null, groupName: 'Hallway' });
    expect(m.get('g2')).toEqual({ state: 'group-preparing', error: null, groupName: 'Hallway' });
    expect(m.has('lcd')).toBe(false);
  });

  it('a member with a rule of its OWN answers for itself, not for the group', () => {
    const m = derivePlaybackCopyStates([
      sched({ id: 'g', screenGroupId: 'G', isActive: false, pendingMedia: true }),
      sched({ id: 'own', screenId: 'g1' }),
    ], groups, screens);
    expect(m.has('g1')).toBe(false);
    expect(m.get('g2')?.state).toBe('group-preparing');
  });

  it('a fresh attempt outranks an older failure on the same screen', () => {
    const m = derivePlaybackCopyStates([
      sched({ id: 'old', screenId: 'lcd', isActive: false, pendingMedia: true, pendingMediaError: FAIL }),
      sched({ id: 'new', screenId: 'lcd', isActive: false, pendingMedia: true }),
    ], groups, screens);
    expect(m.get('lcd')?.state).toBe('preparing');
  });

  it('a failed GROUP rule marks its members failed (switching one on is a retry)', () => {
    const m = derivePlaybackCopyStates([sched({ id: 'g', screenGroupId: 'G', isActive: false, pendingMedia: true, pendingMediaError: FAIL })], groups, screens);
    expect(m.get('g1')).toEqual({ state: 'failed', error: FAIL, groupName: 'Hallway' });
  });

  it('the retry is a fresh publish of the failed rule\'s own window and target', () => {
    const payload = retryPublishPayload(sched({
      id: 'x', playlistId: 'p1', screenGroupId: 'G', startTime: '2026-09-01T00:00:00.000Z', endTime: '2026-12-01T00:00:00.000Z',
      daysOfWeek: 'Mon,Tue', timeStart: '06:00', timeEnd: '10:00', priority: 3, mode: 'append', mutedOverride: true,
      isActive: false, pendingMedia: true, pendingMediaError: FAIL,
    }));
    expect(payload).toEqual({
      playlistId: 'p1', screenGroupId: 'G', startTime: '2026-09-01T00:00:00.000Z', endTime: '2026-12-01T00:00:00.000Z',
      daysOfWeek: 'Mon,Tue', timeStart: '06:00', timeEnd: '10:00', priority: 3, mode: 'append', mutedOverride: true,
    });
    // Never `isActive: false`: a retry must go live (or be held) through the gate, not be parked as a draft.
    expect('isActive' in payload).toBe(false);
    const minimal = retryPublishPayload(sched({ id: 'y', playlistId: 'p1', screenId: 'lcd', startTime: 'not a date' }));
    expect(minimal).toMatchObject({ playlistId: 'p1', screenId: 'lcd', priority: 0, mode: 'replace', mutedOverride: null });
    expect(new Date(minimal.startTime as string).getTime()).not.toBeNaN();
    expect(minimal).not.toHaveProperty('screenGroupId');
  });
});

describe('high-consequence confirmations', () => {
  it('pause everywhere states the exact reach (§19.2)', () => {
    const copy = pauseEverywhereCopy('Member Promotions', { screens: 18, groups: 2, locations: 3 }, 6);
    expect(copy.title).toBe('Pause “Member Promotions” everywhere?');
    expect(copy.message).toBe(
      'This disables 6 publishing rules across 18 screens and 3 locations. Screens will fall back according to their schedule priority.',
    );
    expect(copy.confirmLabel).toBe('Pause everywhere');
  });

  it('a published playlist can be deleted after an explicit warning about its rules', () => {
    const r = removePlaylistCopy(
      { name: 'Member Promotions', reach: { screens: 18, groups: 0, locations: 3 } } as PlaylistSummaryRow,
      6,
    );
    expect(r.confirmLabel).toBe('Delete playlist and rules');
    expect(r.message).toContain('6 rules · 18 screens · 3 locations');
    expect(r.message).toMatch(/removes its publishing rules/);
  });

  it('an unpublished removal never promises a restore the backend cannot honour (§20.3)', () => {
    const r = removePlaylistCopy(
      { name: 'New Member Orientation', reach: { screens: 0, groups: 0, locations: 0 } } as PlaylistSummaryRow,
      0,
    );
    expect(r.message).toMatch(/cannot be restored/i);
    expect(r.message).not.toMatch(/30 days|trash|recoverable/i);
  });

  // 2026-09-26 review finding: a district playlist published ONLY to its
  // schools has no rules and no screens of its own here, but the server deletes
  // every location's copy and its rules with it. That is published.
  it('a playlist that lives only as copies at other locations is warned about as published', () => {
    const r = removePlaylistCopy(
      { name: 'Fall Fundraiser', reach: { screens: 0, groups: 0, locations: 13 } } as PlaylistSummaryRow,
      0,
    );
    expect(r.confirmLabel).toBe('Delete playlist and rules');
    expect(r.message).toContain('13 locations');
    expect(r.message).toMatch(/copies at 12 other locations, including any rules those locations added/);
    expect(r.message).not.toMatch(/not published anywhere/);
  });

  it('a playlist published only here does not mention copies', () => {
    const r = removePlaylistCopy(
      { name: 'Lobby', reach: { screens: 2, groups: 0, locations: 1 } } as PlaylistSummaryRow,
      1,
    );
    expect(r.message).not.toMatch(/copies at/);
  });

  // 2026-09-26 — the server deletes a published playlist only with
  // ?confirm=in-use, and the page sends it only when THIS dialog said so.
  it('says whether its copy disclosed publishing — the in-use confirmation rides on that', () => {
    const pub = removePlaylistCopy({ name: 'Lobby', reach: { screens: 2, groups: 0, locations: 1 } } as PlaylistSummaryRow, 1);
    expect(pub.inUse).toBe(true);
    const copiesOnly = removePlaylistCopy({ name: 'Fall', reach: { screens: 0, groups: 0, locations: 4 } } as PlaylistSummaryRow, 0);
    expect(copiesOnly.inUse).toBe(true);
    const unpublished = removePlaylistCopy({ name: 'Draft', reach: { screens: 0, groups: 0, locations: 0 } } as PlaylistSummaryRow, 0);
    expect(unpublished.inUse).toBe(false);
    expect(unpublished.confirmLabel).toBe('Remove permanently');
  });

  it("takes the server's exact copy count over the reach.locations estimate", () => {
    // A district with its own rules on its own screens plus copies at 3 schools.
    const r = removePlaylistCopy(
      { name: 'Fall', reach: { screens: 5, groups: 0, locations: 4 } } as PlaylistSummaryRow,
      2,
      { copies: 3 },
    );
    expect(r.message).toMatch(/copies at 3 other locations/);
    // …and a group reaching another location's screens is not a copy.
    const noCopies = removePlaylistCopy(
      { name: 'Hall', reach: { screens: 5, groups: 1, locations: 2 } } as PlaylistSummaryRow,
      1,
      { copies: 0 },
    );
    expect(noCopies.message).not.toMatch(/copies at/);
    expect(noCopies.inUse).toBe(true);
  });
});

describe('the published warning rebuilt from a 409 PLAYLIST_PUBLISHED', () => {
  const row = { name: 'Fall Fundraiser', reach: { screens: 0, groups: 0, locations: 0 } } as PlaylistSummaryRow;

  it('uses the server reach — the numbers this page could not see', () => {
    const d = removePlaylistCopyFromServer(row, 0, { rules: 4, screens: 12, locations: 4, copies: 3 });
    expect(d).not.toBeNull();
    expect(d!.inUse).toBe(true);
    expect(d!.title).toBe('Delete published playlist “Fall Fundraiser”?');
    expect(d!.message).toContain('4 rules · 12 screens · 4 locations');
    expect(d!.message).toMatch(/copies at 3 other locations, including any rules those locations added/);
    expect(d!.confirmLabel).toBe('Delete playlist and rules');
  });

  it('a copy with no rules anywhere is still published', () => {
    const d = removePlaylistCopyFromServer(row, 0, { rules: 0, screens: 0, locations: 2, copies: 1 });
    expect(d?.inUse).toBe(true);
    expect(d?.message).toMatch(/copies at 1 other location,/);
  });

  it('counts it could not read fall back to what the page knows', () => {
    const d = removePlaylistCopyFromServer(
      { ...row, reach: { screens: 3, groups: 0, locations: 1 } } as PlaylistSummaryRow,
      2,
      { rules: null, screens: null, locations: null, copies: 1 },
    );
    expect(d?.message).toContain('2 rules · 3 screens');
    expect(d?.message).toMatch(/copies at 1 other location/);
  });

  it.each([
    ['no reach at all', undefined],
    ['a non-object reach', 'published'],
    ['a reach that is not published', { rules: 0, screens: 0, locations: 1, copies: 0 }],
    ['garbage counts', { rules: -1, screens: 'many', locations: 1.5, copies: NaN }],
  ])('%s → null: nothing honest to confirm', (_label, reach) => {
    expect(removePlaylistCopyFromServer(row, 0, reach)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────
describe('formatting helpers', () => {
  it('formats clocks, durations and day sets', () => {
    expect(formatClock('05:00')).toBe('5:00 AM');
    expect(formatClock('22:00')).toBe('10:00 PM');
    expect(formatClock('00:30')).toBe('12:30 AM');
    expect(formatClock('12:00')).toBe('12:00 PM');
    expect(formatDuration(90_000)).toBe('1:30');
    expect(formatDuration(45_000)).toBe('0:45');
    expect(formatDuration(3_725_000)).toBe('1:02:05');
    expect(describeDays('Mon,Tue,Wed,Thu,Fri')).toBe('Weekdays');
    expect(describeDays('Sat,Sun')).toBe('Weekends');
    expect(describeDays('Mon,Tue,Wed')).toBe('Mon–Wed');
    expect(describeDays('Mon,Wed,Fri')).toBe('Mon, Wed, Fri');
    expect(describeDays(null)).toBe('Every day');
  });
});

// ─────────────────────────────────────────────────────────────────────
// 2026-09-27 — new content still downloading to a screen
// ─────────────────────────────────────────────────────────────────────
// A file ≥ 8 MiB plays only once it is whole on the screen (player rule 17).
// Until then the screen shows its download splash or keeps the PREVIOUS
// content — and this rollup said "playback problem", "no picture" or even
// "Playback reported". The player now reports the download in its cache
// report; the rollup says what it says.
const MB = 1024 * 1024;
const SIZE = 141 * MB;
const AT_62 = Math.ceil(SIZE * 0.62);
function downloading(over: Record<string, unknown> = {}, ageMs = 20_000): Partial<OpsScreenRef> {
  return {
    lastCacheReport: {
      playlist: { count: 1, bytes: 1 },
      downloading: { file: 'promo.mp4', bytesLoaded: AT_62, bytesTotal: SIZE, deferredCommit: false, ...over },
    },
    lastCacheReportAt: new Date(NOW_MS - ageMs).toISOString(),
  };
}

describe('delivery while new content downloads (2026-09-27)', () => {
  it('the download splash is "Downloading new content · 62% of 141\u00a0MB" — never a playback problem', () => {
    const s = deriveDeliveryFromScreens([screen({ lastRenderedHash: 'idle:content-downloading', ...downloading() })], NOW_MS);
    expect(s.state).toBe('downloading');
    expect(s.tone).toBe('muted');
    expect(s.label).toBe('Downloading new content');
    expect(s.sub).toBe('Lobby TV · 62% of 141\u00a0MB');
    expect(s.messages).toEqual({
      label: { key: 'screens.contentState.downloading' },
      sub: { key: 'playlistsPage.deliveryDownloadOne', values: { name: 'Lobby TV', percent: 62, size: '141\u00a0MB' } },
    });
  });

  it('held: "Still showing previous content · new content 62% of 141\u00a0MB" — not "Playback reported"', () => {
    const s = deriveDeliveryFromScreens([screen({ ...downloading({ deferredCommit: true }) })], NOW_MS);
    expect(s.state).toBe('downloading');
    expect(s.label).toBe('Still showing previous content');
    expect(s.sub).toBe('Lobby TV · new content 62% of 141\u00a0MB');
    expect(s.label).not.toMatch(/playback reported/i);
  });

  it('the idle lane posts every five minutes: a two-minute-old download proof is still downloading, not "no picture"', () => {
    const s = deriveDeliveryFromScreens([
      screen({ lastRenderedHash: 'idle:content-downloading', lastRenderedAt: new Date(NOW_MS - 2 * 60_000).toISOString() }),
    ], NOW_MS);
    expect(s.state).toBe('downloading');
    // No snapshot (an older player bundle): the screen is named, no number is claimed.
    expect(s.sub).toBe('Lobby TV');
  });

  it('stale snapshot: never progress — the rollup reads the proof alone', () => {
    const held = deriveDeliveryFromScreens([screen({ ...downloading({ deferredCommit: true }, 10 * 60_000) })], NOW_MS);
    expect(held.label).toBe('Playback reported');
    const splash = deriveDeliveryFromScreens([
      screen({ lastRenderedHash: 'idle:content-downloading', ...downloading({}, 10 * 60_000) }),
    ], NOW_MS);
    expect(splash.state).toBe('downloading');
    expect(splash.sub).toBe('Lobby TV');
  });

  it('no size yet: bytes so far, never a percent', () => {
    const s = deriveDeliveryFromScreens([
      screen({ lastRenderedHash: 'idle:content-downloading', ...downloading({ bytesTotal: null, bytesLoaded: 20 * MB }) }),
    ], NOW_MS);
    expect(s.sub).toBe('Lobby TV · 20\u00a0MB so far');
  });

  it('several screens: how many, not a blended percent', () => {
    const s = deriveDeliveryFromScreens([
      screen({ id: 'a', name: 'Lobby TV', lastRenderedHash: 'idle:content-downloading', ...downloading() }),
      screen({ id: 'b', name: 'Cafe', ...downloading({ deferredCommit: true }) }),
      screen({ id: 'c', name: 'Gym' }),
    ], NOW_MS);
    expect(s.state).toBe('downloading');
    expect(s.label).toBe('Downloading new content');
    expect(s.sub).toBe('on 2 of 3 screens');
    expect(s.worstNames).toEqual(['Lobby TV', 'Cafe']);
  });

  it('a real problem on another screen still leads; a download outranks only the healthy state', () => {
    const offline = deriveDeliveryFromScreens([
      screen({ id: 'a', lastRenderedHash: 'idle:content-downloading', ...downloading() }),
      screen({ id: 'b', name: 'Cafe', status: 'OFFLINE' }),
    ], NOW_MS);
    expect(offline.state).toBe('offline');
    expect(worstTargetState(['acknowledged', 'downloading'])).toBe('downloading');
    expect(worstTargetState(['downloading', 'unknown'])).toBe('unknown');
    expect(worstTargetState(['downloading', 'no-picture'])).toBe('no-picture');
  });

  it('a download never talks a stale proof out of "no picture" — it is liveness, not a picture', () => {
    const [t] = deriveTargetsFromScreens([
      screen({ renderHealth: 'STALE', renderStale: true, lastRenderedAt: new Date(NOW_MS - 20 * 60_000).toISOString(), ...downloading() }),
    ], NOW_MS);
    expect(t.state).toBe('no-picture');
  });

  it('content that plays with one more file downloading still reports playback, and the target carries the download', () => {
    const [t] = deriveTargetsFromScreens([screen({ ...downloading() })], NOW_MS);
    expect(t.state).toBe('acknowledged');
    expect(t.pictureState).toBe('reported');
    expect(t.download).toMatchObject({ state: 'downloading', percent: 62 });
    // No download → no key at all (the receipt shape is unchanged).
    expect(deriveTargetsFromScreens([screen()], NOW_MS)[0]).not.toHaveProperty('download');
  });

  it('over a stored receipt, a live download is the fresher fact', () => {
    const receipt = { ...target('not-updated', 'Lobby TV'), screenId: 'sc1' };
    const [t] = overlayCurrentScreenHealth([receipt], [screen({ lastRenderedHash: 'idle:content-downloading', ...downloading() })], NOW_MS);
    expect(t.state).toBe('downloading');
    expect(t.download?.percent).toBe(62);
  });

  it('"Content unavailable" stays a playback problem', () => {
    const s = deriveDeliveryFromScreens([screen({ lastRenderedHash: 'idle:content-unavailable', ...downloading() })], NOW_MS);
    expect(s.state).toBe('playback-issue');
    expect(s.tone).toBe('bad');
  });

  it('a downloading playlist is not an exception on the library', () => {
    const r = buildPlaylistRow({
      playlist: { id: 'p1', name: 'Promo' },
      schedules: [sched({ screenId: 'sc1' })],
      screens: [screen({ lastRenderedHash: 'idle:content-downloading', ...downloading() })],
      groups: [],
      now: WED_10AM,
    });
    expect(r.delivery.state).toBe('downloading');
    expect(needsAttention(r)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────
// THE LANGUAGE GATE (§4.3 + the handoff's documented correction, §10)
// ─────────────────────────────────────────────────────────────────────
describe('§4.3 prohibited language', () => {
  /** Every operator-facing string this module can produce, in one place. */
  function everyString(): string[] {
    const out: string[] = [];
    const push = (s: string | null | undefined) => { if (s) out.push(s); };

    const states: DeliveryTarget['state'][] =
      ['acknowledged', 'not-updated', 'offline', 'unknown', 'no-picture', 'content-mismatch'];
    for (const s of states) {
      for (const n of [1, 2, 4]) {
        const targets = Array.from({ length: n }, (_, i) => target(i === 0 ? s : 'acknowledged', `S${i}`));
        const sum = summarizeDelivery(targets);
        push(sum.label); push(sum.detail); push(sum.clause);
        const pushing = summarizeDelivery(targets, { pushing: true });
        push(pushing.label); push(pushing.detail); push(pushing.clause);
      }
    }
    push(summarizeDelivery([]).label);
    push(DELIVERY_UNAVAILABLE.label); push(DELIVERY_UNAVAILABLE.detail);
    push(DELIVERY_UNAVAILABLE.clause);
    push(deriveDeliveryFromScreens([screen({ id: 'a' })], NOW_MS).label);
    // 2026-09-27 — every shape the downloading rollup can take.
    for (const screens of [
      [screen({ lastRenderedHash: 'idle:content-downloading', ...downloading() })],
      [screen({ ...downloading({ deferredCommit: true }) })],
      [screen({ lastRenderedHash: 'idle:content-downloading', ...downloading({ bytesTotal: null }) })],
      [screen({ lastRenderedHash: 'idle:content-downloading' })],
      [screen({ id: 'a', lastRenderedHash: 'idle:content-downloading' }), screen({ id: 'b', ...downloading({ deferredCommit: true }) })],
    ]) {
      const s = deriveDeliveryFromScreens(screens, NOW_MS);
      push(s.label); push(s.sub); push(s.detail); push(s.clause);
    }

    for (const s of [
      [] as OpsScheduleRef[],
      [sched()],
      [sched({ isActive: false })],
      [sched({ daysOfWeek: 'Mon,Tue,Wed,Thu,Fri', timeStart: '05:00', timeEnd: '22:00' })],
      [sched({ startTime: '2026-12-01T09:00:00' })],
      [sched({ startTime: '2026-08-01T00:00:00', endTime: '2026-08-12T23:59:00' })],
    ]) {
      const r = deriveScheduleState(s, WED_10AM, { fleetActiveSchedules: 0, fleetLocations: 0 });
      push(r.pillLabel); push(r.summary);
    }
    push(deriveScheduleState([], WED_10AM, { fleetActiveSchedules: 4, fleetLocations: 2 }).summary);

    for (const r of [
      { screens: 0, groups: 0, locations: 0 },
      { screens: 4, groups: 2, locations: 0 },
      { screens: 18, groups: 0, locations: 3 },
    ]) push(describeReach(r));

    const copy = pauseEverywhereCopy('X', { screens: 4, groups: 1, locations: 2 }, 3);
    push(copy.title); push(copy.message); push(copy.confirmLabel);
    for (const rules of [0, 6]) {
      const d = removePlaylistCopy(
        { name: 'X', reach: { screens: rules ? 4 : 0, groups: 0, locations: 0 } } as PlaylistSummaryRow, rules,
      );
      push(d.title); push(d.message); push(d.confirmLabel);
    }
    // 2026-09-28 — removing several at once: every shape its copy can take.
    const many = (n: number, published: number): PlaylistSummaryRow[] => Array.from({ length: n }, (_, i) => ({
      id: `m${i}`, name: `List ${i}`, targetScreenIds: [`s${i}`],
      reach: { screens: i < published ? 2 : 0, groups: 0, locations: 0 },
    }) as unknown as PlaylistSummaryRow);
    for (const [n, pub] of [[2, 0], [2, 1], [2, 2], [3, 3], [9, 4], [9, 0]] as const) {
      const d = removePlaylistsCopy(many(n, pub), (id) => (Number(id.slice(1)) < pub ? 2 : 0));
      push(d.title); push(d.message); push(d.confirmLabel);
    }
    const partial = describeRemoveManyOutcome(9, {
      removed: ['a'],
      failed: Array.from({ length: 8 }, (_, i) => ({ id: `f${i}`, name: `F${i}`, reason: 'the server rejected the request', becamePublished: i === 0 })),
    });
    push(partial?.title); push(partial?.message);

    const banner = buildExceptionBanner([{
      id: 'x', name: 'Lobby Promotions', kind: 'media', itemCount: 1, durationMs: 0,
      thumbnailUrl: null, templateSummary: null, creatorSummary: null,
      scheduleState: 'ACTIVE', statusLabel: 'ACTIVE', reviewState: null,
      reach: { screens: 4, groups: 0, locations: 0 }, scheduleSummary: 'Always',
      updatedAt: new Date().toISOString(), sourceOwnership: 'own',
      delivery: summarizeDelivery([target('acknowledged', 'A'), target('not-updated', 'G43')]),
      targetScreenIds: [], searchText: '', syncPlayback: false,
    }]);
    push(banner?.headline); push(banner?.detail);

    return out;
  }

  const strings = everyString();

  it('produces a non-trivial corpus (a passing sweep over nothing proves nothing)', () => {
    expect(strings.length).toBeGreaterThan(30);
  });

  it('never says LIVE', () => {
    for (const s of strings) expect(s).not.toMatch(/\bLIVE\b/i);
  });

  it('never claims Confirmed for anything but a reported picture', () => {
    for (const s of strings) {
      if (/confirmed/i.test(s)) {
        // The single permitted use: the device itself reported it painted.
        expect(s).toMatch(/picture/i);
      }
      expect(s).not.toMatch(/content confirmed/i);
    }
  });

  it('never says Delivered', () => {
    for (const s of strings) expect(s).not.toMatch(/\bdelivered\b/i);
  });

  it('never says Ready', () => {
    for (const s of strings) expect(s).not.toMatch(/\bready\b/i);
  });

  it('never leaks implementation jargon at the operator', () => {
    for (const s of strings) {
      expect(s).not.toMatch(/manifest|\back\b|painting|render[- ]proof/i);
    }
  });
});


// ═══════════════════════════════════════════════════════════════════
// Removing several playlists at once (Greg, 2026-09-28)
// ═══════════════════════════════════════════════════════════════════

describe('removePlaylistsCopy — the bulk confirmation', () => {
  const row = (id: string, name: string, over: Partial<PlaylistSummaryRow> = {}): PlaylistSummaryRow =>
    ({
      id, name, targetScreenIds: [], reach: { screens: 0, groups: 0, locations: 0 }, ...over,
    }) as unknown as PlaylistSummaryRow;

  it('none published: names them, says so, promises no way back', () => {
    const d = removePlaylistsCopy([row('a', 'Freese'), row('b', 'Old promo')], () => 0);
    expect(d.title).toBe('Remove 2 playlists?');
    expect(d.message).toContain('• Freese');
    expect(d.message).toContain('• Old promo');
    expect(d.message).toContain('None of them is published anywhere.');
    expect(d.message).toMatch(/cannot be restored/i);
    expect(d.message).not.toMatch(/30 days|trash|recoverable/i);
    expect(d.confirmLabel).toBe('Remove 2 permanently');
    expect(d.publishedCount).toBe(0);
    expect(d.inUseIds.size).toBe(0);
  });

  it('published ones are counted, use the SAME test as the single dialog, and are the only ids flagged in-use', () => {
    const published = row('p', 'Menu', { reach: { screens: 3, groups: 0, locations: 0 }, targetScreenIds: ['s1', 's2', 's3'] });
    const loose = row('q', 'Scratch');
    // Rules but no reach here still reads as published (the single dialog agrees).
    const ruled = row('r', 'Rules only');
    const d = removePlaylistsCopy([published, loose, ruled], (id) => (id === 'p' ? 2 : id === 'r' ? 1 : 0));
    expect([...d.inUseIds].sort()).toEqual(['p', 'r']);
    expect(d.publishedCount).toBe(2);
    expect(d.message).toContain('2 of them are published (3 rules · 3 screens).');
    expect(d.message).toMatch(/removes its publishing rules/);
    expect(d.confirmLabel).toBe('Delete 3 playlists');
    // Agreement with the single-playlist rule, row by row.
    for (const r of [published, loose, ruled]) {
      const single = removePlaylistCopy(r, r.id === 'p' ? 2 : r.id === 'r' ? 1 : 0).inUse;
      expect(d.inUseIds.has(r.id)).toBe(single);
    }
  });

  it('two playlists on the SAME screen are one screen affected, not two', () => {
    const a = row('a', 'A', { reach: { screens: 1, groups: 0, locations: 0 }, targetScreenIds: ['shared'] });
    const b = row('b', 'B', { reach: { screens: 1, groups: 0, locations: 0 }, targetScreenIds: ['shared'] });
    const d = removePlaylistsCopy([a, b], () => 1);
    expect(d.message).toContain('Both are published (2 rules · 1 screen).');
  });

  it('a long selection lists the first few and counts the rest', () => {
    const rows = Array.from({ length: 10 }, (_, i) => row(`x${i}`, `Playlist ${i}`));
    const d = removePlaylistsCopy(rows, () => 0);
    expect(d.title).toBe('Remove 10 playlists?');
    expect(d.message.split('\n').filter((l) => l.startsWith('• '))).toHaveLength(REMOVE_MANY_NAMES_SHOWN);
    expect(d.message).toContain(`…and ${10 - REMOVE_MANY_NAMES_SHOWN} more`);
  });
});

describe('removePlaylistsSequentially', () => {
  const rows = ['a', 'b', 'c', 'd'].map((id) => ({ id, name: id.toUpperCase() }) as unknown as PlaylistSummaryRow);

  it('deletes in order, one at a time, sending ?confirm=in-use only for the ids the dialog called published', async () => {
    const calls: Array<[string, boolean]> = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const out = await removePlaylistsSequentially(rows, new Set(['b', 'd']), async (id, confirmInUse) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      calls.push([id, confirmInUse]);
      inFlight--;
    });
    expect(calls).toEqual([['a', false], ['b', true], ['c', false], ['d', true]]);
    expect(maxInFlight).toBe(1);
    expect(out).toEqual({ removed: ['a', 'b', 'c', 'd'], failed: [] });
  });

  it('a failure never strands the ones behind it, and is reported by name', async () => {
    const out = await removePlaylistsSequentially(rows, new Set(), async (id) => {
      if (id === 'b') throw Object.assign(new Error('Protected'), { code: 'PLAYLIST_PROTECTED' });
      if (id === 'c') throw Object.assign(new Error('x'), { code: 'PLAYLIST_PUBLISHED' });
    });
    expect(out.removed).toEqual(['a', 'd']);
    expect(out.failed.map((f) => f.id)).toEqual(['b', 'c']);
    expect(out.failed[0]).toMatchObject({ name: 'B', reason: 'Protected', becamePublished: false });
    expect(out.failed[1]).toMatchObject({ name: 'C', becamePublished: true });
    expect(out.failed[1].reason).toMatch(/turned out to be published/);
  });

  it('a playlist the dialog called UNPUBLISHED that the server says is published is never deleted as published', async () => {
    const sent: Array<[string, boolean]> = [];
    await removePlaylistsSequentially(rows.slice(0, 1), new Set(), async (id, confirmInUse) => {
      sent.push([id, confirmInUse]);
      throw Object.assign(new Error('published'), { code: 'PLAYLIST_PUBLISHED' });
    });
    expect(sent).toEqual([['a', false]]); // one attempt, without the flag — never retried with it
  });
});

describe('describeRemoveManyOutcome', () => {
  it('says nothing when everything went', () => {
    expect(describeRemoveManyOutcome(3, { removed: ['a', 'b', 'c'], failed: [] })).toBeNull();
  });

  it('says how many went, and names each that did not', () => {
    const o = describeRemoveManyOutcome(3, {
      removed: ['a'],
      failed: [
        { id: 'b', name: 'B', reason: 'Protected', becamePublished: false },
        { id: 'c', name: 'C', reason: 'the server rejected the request', becamePublished: false },
      ],
    })!;
    expect(o.title).toBe('Removed 1 of 3 playlists');
    expect(o.message).toContain('2 were not removed and are still in your library');
    expect(o.message).toContain('• B — Protected');
    expect(o.message).toContain('• C — the server rejected the request');
  });
});
