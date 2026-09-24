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
  deriveReach,
  deriveScheduleState,
  deriveTargetsFromScreens,
  DELIVERY_UNAVAILABLE,
  EMPTY_FILTERS,
  formatClock,
  formatDuration,
  isScheduleEligibleNow,
  needsAttention,
  pauseEverywhereCopy,
  removePlaylistCopy,
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
describe('high-consequence confirmations', () => {
  it('pause everywhere states the exact reach (§19.2)', () => {
    const copy = pauseEverywhereCopy('Member Promotions', { screens: 18, groups: 2, locations: 3 }, 6);
    expect(copy.title).toBe('Pause “Member Promotions” everywhere?');
    expect(copy.message).toBe(
      'This disables 6 publishing rules across 18 screens and 3 locations. Screens will fall back according to their schedule priority.',
    );
    expect(copy.confirmLabel).toBe('Pause everywhere');
  });

  it('a published playlist is BLOCKED from removal with Review publishing as the way out (§20.2)', () => {
    const r = removePlaylistCopy(
      { name: 'Member Promotions', reach: { screens: 18, groups: 0, locations: 3 } } as PlaylistSummaryRow,
      6,
    );
    expect(r.blocked).toBe(true);
    expect(r.primaryLabel).toBe('Review publishing');
    expect(r.message).toContain('6 rules · 18 screens · 3 locations');
    expect(r.message).not.toMatch(/delete anyway/i);
  });

  it('an unpublished removal never promises a restore the backend cannot honour (§20.3)', () => {
    const r = removePlaylistCopy(
      { name: 'New Member Orientation', reach: { screens: 0, groups: 0, locations: 0 } } as PlaylistSummaryRow,
      0,
    );
    expect(r.blocked).toBe(false);
    expect(r.message).toMatch(/cannot be restored/i);
    expect(r.message).not.toMatch(/30 days|trash|recoverable/i);
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
      push(d.title); push(d.message); push(d.confirmLabel); push(d.primaryLabel);
    }

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
