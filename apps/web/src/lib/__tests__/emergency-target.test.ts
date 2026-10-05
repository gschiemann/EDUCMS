/**
 * Alert targeting (2026-10-05) — the words and the request, pinned.
 *
 *   1. "All screens" sends BYTE-FOR-BYTE the body every trigger sent before
 *      targeting existed. This is the promise that the default flow is
 *      unchanged, so it is asserted against the literal string.
 *   2. The confirmation states target and count in plain words.
 *   3. The picker's search finds what an operator would type.
 */
import { useTranslations } from 'next-intl';
import {
  activeAlertLabel,
  allClearScopeOf,
  allScreensTarget,
  emergencyAllClearBody,
  emergencyTriggerBody,
  filterTargets,
  groupTarget,
  isAllScreens,
  isSameAlert,
  screenTarget,
  targetChipLabel,
  targetSummary,
  typeIdOf,
  type ActiveAlert,
  type EmergencyTargets,
} from '@/lib/emergency-target';

// The jest next-intl stand-in resolves the REAL English catalog, so these are
// the sentences an operator actually reads.
// eslint-disable-next-line react-hooks/rules-of-hooks -- the next-intl test mock, called once at module scope in a test file; no component renders here
const t = useTranslations() as unknown as (k: string, v?: Record<string, string | number>) => string;

const TARGETS: EmergencyTargets = {
  tenantId: 't1',
  tenantName: 'Lincoln High',
  allScreensCount: 24,
  groups: [
    { id: 'g-gym', name: 'Gym', tenantId: 't1', tenantName: 'Lincoln High', screenCount: 6 },
    { id: 'g-front', name: 'Front Entrance Group', tenantId: 't1', tenantName: 'Lincoln High', screenCount: 2 },
  ],
  screens: [
    { id: 's-lobby', name: 'Lobby', location: 'Main entrance', online: true, groupId: null, groupName: null, tenantId: 't1', tenantName: 'Lincoln High', displayScreenCount: 1 },
    { id: 's-cafe', name: 'Cafetería wall', location: 'Building B', online: false, groupId: 'g-gym', groupName: 'Gym', tenantId: 't1', tenantName: 'Lincoln High', displayScreenCount: 1 },
    { id: 's-entry', name: 'Entrance display', location: null, online: true, groupId: 'g-front', groupName: 'Front Entrance Group', tenantId: 't1', tenantName: 'Lincoln High', displayScreenCount: 2 },
  ],
};

describe('"All screens" sends exactly what was sent before targeting existed', () => {
  it('no target → the literal pre-targeting body', () => {
    expect(JSON.stringify(emergencyTriggerBody({ schoolId: 't1', type: 'lockdown' }))).toBe(
      '{"scopeType":"tenant","scopeId":"t1","overridePayload":{"severity":"CRITICAL","type":"lockdown"}}',
    );
  });

  it('an explicit All-screens target is the same body, not a different one', () => {
    const body = emergencyTriggerBody({ schoolId: 't1', type: 'lockdown', target: allScreensTarget('t1', 24) });
    expect(JSON.stringify(body)).toBe(
      '{"scopeType":"tenant","scopeId":"t1","overridePayload":{"severity":"CRITICAL","type":"lockdown"}}',
    );
  });

  it('keeps carrying a playlistId exactly where it always did', () => {
    expect(JSON.stringify(emergencyTriggerBody({ schoolId: 't1', type: 'evacuate', playlistId: 'pl-1' }))).toBe(
      '{"scopeType":"tenant","scopeId":"t1","overridePayload":{"severity":"CRITICAL","type":"evacuate","playlistId":"pl-1"}}',
    );
  });

  it('a chosen screen or group changes ONLY the scope', () => {
    expect(
      JSON.stringify(emergencyTriggerBody({ schoolId: 't1', type: 'lockdown', target: { scopeType: 'device', scopeId: 's-lobby' } })),
    ).toBe('{"scopeType":"device","scopeId":"s-lobby","overridePayload":{"severity":"CRITICAL","type":"lockdown"}}');
    expect(
      JSON.stringify(emergencyTriggerBody({ schoolId: 't1', type: 'hold', target: { scopeType: 'group', scopeId: 'g-gym' } })),
    ).toBe('{"scopeType":"group","scopeId":"g-gym","overridePayload":{"severity":"CRITICAL","type":"hold"}}');
  });

  it('the all-clear defaults to the whole organisation (the old body) and otherwise names its alert’s scope', () => {
    expect(JSON.stringify(emergencyAllClearBody({ schoolId: 't1' }))).toBe('{"scopeType":"tenant","scopeId":"t1"}');
    expect(emergencyAllClearBody({ schoolId: 't1', scopeType: 'group', scopeId: 'g-gym' })).toEqual({ scopeType: 'group', scopeId: 'g-gym' });
    expect(emergencyAllClearBody({ schoolId: 't1', scopeType: 'device', scopeId: 's-lobby' })).toEqual({ scopeType: 'device', scopeId: 's-lobby' });
    // A tenant-scoped clear with a scopeId (a district admin ending one
    // school's alert) is passed as schoolId by the caller, never lost.
    expect(emergencyAllClearBody({ schoolId: 'school-b', scopeType: 'tenant', scopeId: 'school-b' })).toEqual({ scopeType: 'tenant', scopeId: 'school-b' });
  });
});

describe('the confirmation states target and count in plain words', () => {
  it('All screens, with and without a known count', () => {
    expect(targetSummary(t, 'Lockdown', allScreensTarget('t1', 24))).toBe('Lockdown on all 24 screens');
    expect(targetSummary(t, 'Lockdown', allScreensTarget('t1', 1))).toBe('Lockdown on your only screen');
    expect(targetSummary(t, 'Lockdown', allScreensTarget('t1', null))).toBe('Lockdown on all screens');
  });

  it('one screen and one group', () => {
    expect(targetSummary(t, 'Lockdown', screenTarget(TARGETS.screens[0]))).toBe('Lockdown on 1 screen — Lobby');
    expect(targetSummary(t, 'Lockdown', groupTarget(TARGETS.groups[0]))).toBe('Lockdown on 6 screens — Gym group');
    // Both sides of a double-sided display are counted.
    expect(targetSummary(t, 'Medical', screenTarget(TARGETS.screens[2]))).toBe('Medical on 2 screens — Entrance display');
  });

  it('never doubles a group the operator already called "… Group"', () => {
    expect(targetSummary(t, 'Hold', groupTarget(TARGETS.groups[1]))).toBe('Hold on 2 screens — Front Entrance Group');
  });

  it('the "Send to" line', () => {
    expect(targetChipLabel(t, allScreensTarget('t1', 24))).toBe('All screens (24)');
    expect(targetChipLabel(t, allScreensTarget('t1', null))).toBe('All screens');
    expect(targetChipLabel(t, groupTarget(TARGETS.groups[0]))).toBe('Gym group · 6 screens');
    expect(targetChipLabel(t, screenTarget(TARGETS.screens[0]))).toBe('Lobby · 1 screen');
  });

  it('a live alert, listed', () => {
    const base = { alertId: 'a1', tenantId: 't1', tenantName: null, severity: 'CRITICAL', showingCount: null, triggeredAt: null } as const;
    const all: ActiveAlert = { ...base, alertId: null, scopeType: 'tenant', scopeId: 't1', targetName: 'Lincoln High', type: 'LOCKDOWN', screenCount: 24 };
    const gym: ActiveAlert = { ...base, scopeType: 'group', scopeId: 'g-gym', targetName: 'Gym', type: 'LOCKDOWN', screenCount: 6 };
    const lobby: ActiveAlert = { ...base, scopeType: 'device', scopeId: 's-lobby', targetName: 'Lobby', type: 'MEDICAL', screenCount: 1 };
    expect(activeAlertLabel(t, 'Lockdown', all)).toBe('Lockdown — all 24 screens');
    expect(activeAlertLabel(t, 'Lockdown', gym)).toBe('Lockdown — Gym group, 6 screens');
    expect(activeAlertLabel(t, 'Medical', lobby)).toBe('Medical — Lobby, 1 screen');
  });
});

describe('the picker’s search', () => {
  it('matches names, locations, groups — ignoring case and accents', () => {
    expect(filterTargets(TARGETS, 'gym').groups.map((g) => g.id)).toEqual(['g-gym']);
    // "cafeteria" finds "Cafetería wall"; "building b" finds it by location;
    // "gym" also finds it by its group.
    expect(filterTargets(TARGETS, 'CAFETERIA').screens.map((s) => s.id)).toEqual(['s-cafe']);
    expect(filterTargets(TARGETS, 'building b').screens.map((s) => s.id)).toEqual(['s-cafe']);
    expect(filterTargets(TARGETS, 'gym').screens.map((s) => s.id)).toEqual(['s-cafe']);
  });

  it('an empty query lists everything; no targets lists nothing', () => {
    expect(filterTargets(TARGETS, '  ').screens).toHaveLength(3);
    expect(filterTargets(null, 'x')).toEqual({ groups: [], screens: [] });
  });
});

describe('small rules the surfaces lean on', () => {
  it('All screens is the default and the only tenant scope', () => {
    expect(isAllScreens(allScreensTarget('t1'))).toBe(true);
    expect(isAllScreens(null)).toBe(true);
    expect(isAllScreens(screenTarget(TARGETS.screens[0]))).toBe(false);
  });

  it('maps API incident types to the surfaces’ type ids', () => {
    expect(typeIdOf('LOCKDOWN')).toBe('lockdown');
    expect(typeIdOf('CRITICAL')).toBeNull(); // a severity, never a type
    expect(typeIdOf(null)).toBeNull();
  });

  it('an alert whose group was deleted is still named, and is cleared where the server says', () => {
    const orphanGroup: ActiveAlert = {
      alertId: 'ovr_g', scopeType: 'group', scopeId: 'g-gone', targetName: null, tenantId: 't1', tenantName: null,
      type: 'LOCKDOWN', severity: 'CRITICAL', screenCount: 2, showingCount: 2, triggeredAt: null,
      clearScopeType: 'device', clearScopeId: 's-1',
    };
    expect(activeAlertLabel(t, 'Lockdown', orphanGroup)).toBe('Lockdown — a deleted group, 2 screens');
    expect(allClearScopeOf(orphanGroup)).toEqual({ scopeType: 'device', scopeId: 's-1' });
    const normal: ActiveAlert = { ...orphanGroup, targetName: 'Gym', scopeId: 'g-gym', clearScopeType: undefined, clearScopeId: undefined };
    expect(allClearScopeOf(normal)).toEqual({ scopeType: 'group', scopeId: 'g-gym' });
  });

  it('recognises the alert a trigger just sent', () => {
    const scoped: ActiveAlert = { alertId: 'ovr_1', scopeType: 'device', scopeId: 's-lobby', targetName: 'Lobby', tenantId: 't1', tenantName: null, type: 'LOCKDOWN', severity: 'CRITICAL', screenCount: 1, showingCount: 1, triggeredAt: null };
    const tenantWide: ActiveAlert = { ...scoped, alertId: null, scopeType: 'tenant', scopeId: 't1' };
    expect(isSameAlert(scoped, { overrideId: 'ovr_1', target: screenTarget(TARGETS.screens[0]) })).toBe(true);
    expect(isSameAlert(scoped, { overrideId: 'ovr_2', target: screenTarget(TARGETS.screens[0]) })).toBe(false);
    expect(isSameAlert(tenantWide, { overrideId: 'ovr_9', target: allScreensTarget('t1') })).toBe(true);
    expect(isSameAlert(tenantWide, { target: allScreensTarget('t2') })).toBe(false);
  });
});
