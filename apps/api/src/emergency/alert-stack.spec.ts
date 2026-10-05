/**
 * alert-stack.ts — the pure rule behind "each alert has its own all-clear".
 *
 *   A screen shows the newest alert aimed at it; ending an alert returns each
 *   of its screens to the next-newest alert still aimed at it, or to normal.
 *
 * `emergency.targeting.spec.ts` proves the rule end to end through the real
 * controller and manifest; this file pins each branch of it in isolation,
 * including the fail-safe ones that are hard to reach from the controller.
 */

import {
  MAX_DISPLACED_ALERTS,
  clearAlert,
  entriesOfRow,
  entryFromRow,
  isEntryExpired,
  parseDisplaced,
  placeAlert,
  type OverrideEntry,
} from './alert-stack';

const T0 = Date.parse('2026-10-05T10:00:00Z');

function entry(alertId: string | null, over: Partial<OverrideEntry> = {}): OverrideEntry {
  return {
    alertId,
    scopeType: 'device',
    scopeId: 'lobby',
    type: 'LOCKDOWN',
    severity: 'CRITICAL',
    scopeNote: null,
    playlistId: null,
    mediaUrl: null,
    textBlob: null,
    floorPlanId: null,
    floorZoneId: null,
    scenarioId: null,
    triggeredByUserId: 'u1',
    triggeredAt: new Date(T0).toISOString(),
    expiresAt: null,
    ...over,
  };
}

/** A DB row as Prisma returns it: Date columns, `displaced` as JSON. */
function row(top: OverrideEntry, displaced: OverrideEntry[] = []): any {
  return {
    screenId: 'lobby',
    tenantId: 't1',
    ...top,
    triggeredAt: new Date(top.triggeredAt),
    expiresAt: top.expiresAt ? new Date(top.expiresAt) : null,
    displaced,
  };
}

const never = () => false;
const byId = (id: string) => (e: OverrideEntry) => e.alertId === id;

describe('placeAlert — a new alert on a screen', () => {
  it('on an empty screen it is simply the alert, covering nothing', () => {
    const { columns, replacedAlertIds } = placeAlert(null, entry('a'), never, T0);
    expect(columns).toMatchObject({ alertId: 'a', type: 'LOCKDOWN', displaced: [] });
    expect(columns.triggeredAt).toEqual(new Date(T0));
    expect(replacedAlertIds).toEqual([]);
  });

  it('the newest alert is shown; what the screen had goes underneath, newest first', () => {
    const existing = row(entry('b', { type: 'MEDICAL' }), [entry('a', { type: 'HOLD' })]);
    const { columns } = placeAlert(existing, entry('c', { type: 'EVACUATE' }), never, T0);
    expect(columns.type).toBe('EVACUATE');
    expect(columns.displaced.map((e) => e.alertId)).toEqual(['b', 'a']);
  });

  it('an alert on the SAME target replaces the old one instead of stacking (escalation)', () => {
    const existing = row(entry('hold', { scopeType: 'group', scopeId: 'gym', type: 'HOLD' }));
    const sameGym = (e: OverrideEntry) => e.scopeType === 'group' && e.scopeId === 'gym';
    const { columns, replacedAlertIds } = placeAlert(
      existing,
      entry('lock', { scopeType: 'group', scopeId: 'gym' }),
      sameGym,
      T0,
    );
    expect(columns.displaced).toEqual([]);
    expect(replacedAlertIds).toEqual(['hold']);
  });

  it('a same-target alert buried underneath is replaced too, the rest is kept in order', () => {
    const existing = row(entry('one-screen'), [entry('hold', { scopeType: 'group', scopeId: 'gym' }), entry('old')]);
    const sameGym = (e: OverrideEntry) => e.scopeType === 'group' && e.scopeId === 'gym';
    const { columns, replacedAlertIds } = placeAlert(
      existing,
      entry('lock', { scopeType: 'group', scopeId: 'gym' }),
      sameGym,
      T0,
    );
    expect(columns.displaced.map((e) => e.alertId)).toEqual(['one-screen', 'old']);
    expect(replacedAlertIds).toEqual(['hold']);
  });

  it('writing the same alert twice does not stack it on itself', () => {
    const { columns } = placeAlert(row(entry('a')), entry('a'), never, T0);
    expect(columns.displaced).toEqual([]);
  });

  it('an expired alert is not carried underneath', () => {
    const expired = entry('old', { expiresAt: new Date(T0 - 1000).toISOString() });
    const { columns } = placeAlert(row(expired), entry('new'), never, T0);
    expect(columns.displaced).toEqual([]);
  });

  it('keeps a pre-targeting row (no alertId) underneath — it is somebody’s alert', () => {
    const legacy = entry(null, { scopeType: null, scopeId: null, scopeNote: 'GPIO IN1 panic' });
    const { columns } = placeAlert(row(legacy), entry('new'), never, T0);
    expect(columns.displaced).toHaveLength(1);
    expect(columns.displaced[0]).toMatchObject({ alertId: null, scopeNote: 'GPIO IN1 panic' });
  });

  it('is bounded: the oldest covered alert drops off past the cap', () => {
    const many = Array.from({ length: MAX_DISPLACED_ALERTS }, (_, i) => entry(`old-${i}`));
    const { columns } = placeAlert(row(entry('top'), many), entry('new'), never, T0);
    expect(columns.displaced).toHaveLength(MAX_DISPLACED_ALERTS);
    expect(columns.displaced[0].alertId).toBe('top');
    expect(columns.displaced.map((e) => e.alertId)).not.toContain(`old-${MAX_DISPLACED_ALERTS - 1}`);
  });
});

describe('clearAlert — ending one alert on a screen', () => {
  it('the only alert ends → the row goes away (screen returns to normal)', () => {
    expect(clearAlert(row(entry('a')), byId('a'), T0)).toEqual({ kind: 'delete' });
  });

  it('the shown alert ends → the screen returns to the newest alert it was covering', () => {
    const r = row(entry('b', { type: 'MEDICAL' }), [entry('a', { type: 'LOCKDOWN' }), entry('z', { type: 'HOLD' })]);
    const plan = clearAlert(r, byId('b'), T0);
    expect(plan.kind).toBe('update');
    if (plan.kind !== 'update') return;
    expect(plan.restored?.alertId).toBe('a');
    expect(plan.columns).toMatchObject({ alertId: 'a', type: 'LOCKDOWN' });
    expect(plan.columns.displaced.map((e) => e.alertId)).toEqual(['z']);
  });

  it('a covered alert ends → what is on glass does not change, it just leaves the stack', () => {
    const r = row(entry('b', { type: 'MEDICAL' }), [entry('a'), entry('z')]);
    const plan = clearAlert(r, byId('a'), T0);
    expect(plan.kind).toBe('update');
    if (plan.kind !== 'update') return;
    expect(plan.restored).toBeNull();
    expect(plan.columns).toMatchObject({ alertId: 'b', type: 'MEDICAL' });
    expect(plan.columns.displaced.map((e) => e.alertId)).toEqual(['z']);
  });

  it('an alert that is not on this screen leaves the row untouched', () => {
    expect(clearAlert(row(entry('b'), [entry('a')]), byId('nope'), T0)).toEqual({ kind: 'keep' });
  });

  it('never falls back to an EXPIRED alert — the screen goes to normal instead', () => {
    const r = row(entry('b'), [entry('a', { expiresAt: new Date(T0 - 1).toISOString() })]);
    expect(clearAlert(r, byId('b'), T0)).toEqual({ kind: 'delete' });
  });

  it('restores the covered alert’s own content and timestamps exactly', () => {
    const covered = entry('a', {
      type: 'EVACUATE',
      playlistId: 'pl-evac',
      textBlob: 'Use north exit',
      triggeredAt: new Date(T0 - 60_000).toISOString(),
      expiresAt: new Date(T0 + 3_600_000).toISOString(),
    });
    const plan = clearAlert(row(entry('b'), [covered]), byId('b'), T0);
    if (plan.kind !== 'update') throw new Error('expected update');
    expect(plan.columns).toMatchObject({ playlistId: 'pl-evac', textBlob: 'Use north exit', type: 'EVACUATE' });
    expect(plan.columns.triggeredAt).toEqual(new Date(T0 - 60_000));
    expect(plan.columns.expiresAt).toEqual(new Date(T0 + 3_600_000));
  });

  it('can clear several entries in one pass (a whole-organisation all-clear)', () => {
    const r = row(entry('t2', { scopeType: 'tenant' }), [entry('dev', { scopeType: 'device' }), entry('t1', { scopeType: 'tenant' })]);
    const plan = clearAlert(r, (e) => e.scopeType === 'tenant', T0);
    if (plan.kind !== 'update') throw new Error('expected update');
    expect(plan.columns.alertId).toBe('dev');
    expect(plan.columns.displaced).toEqual([]);
  });
});

describe('fail-safe parsing', () => {
  it('a damaged `displaced` value reads as covering nothing — never as a crash', () => {
    for (const junk of [null, undefined, 'x', 42, {}, [null, 'x', 7, []], [{ alertId: 'no-type' }]]) {
      expect(parseDisplaced(junk)).toEqual([]);
    }
  });

  it('a row read back from the database round-trips through an entry', () => {
    const e = entry('a', { mediaUrl: 'https://x/y.png' });
    expect(entryFromRow(row(e))).toEqual(e);
    expect(entriesOfRow(row(e, [entry('b')])).map((x) => x.alertId)).toEqual(['a', 'b']);
  });

  it('an entry without an expiry never expires; an unparseable one is treated as live', () => {
    expect(isEntryExpired(entry('a'), T0)).toBe(false);
    expect(isEntryExpired(entry('a', { expiresAt: 'not-a-date' }), T0)).toBe(false);
    expect(isEntryExpired(entry('a', { expiresAt: new Date(T0 + 1).toISOString() }), T0)).toBe(false);
    expect(isEntryExpired(entry('a', { expiresAt: new Date(T0 - 1).toISOString() }), T0)).toBe(true);
  });
});
