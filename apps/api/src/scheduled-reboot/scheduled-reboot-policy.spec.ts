import {
  CHECK_IN_GRACE_MS,
  DISPATCH_WINDOW_MS,
  currentSlot,
  decideScheduledReboot,
  evaluateReturn,
  isAllowedPolicyTime,
  jitterOffsetMs,
  otaIsInFlight,
  panelIsOff,
  returnWindowMs,
  scheduledRebootsDisabled,
  tenantNightlyCap,
  uptimeFrom,
  verdictCanRestart,
  type RebootFacts,
} from './scheduled-reboot-policy';
import { parseOnWindow } from '../notifications/customer-alerts/schedule-windows';

const ZONE = 'America/Chicago';
// 2026-11-10 is a Tuesday. 03:00 CST = 09:00Z.
const SLOT_START = Date.parse('2026-11-10T09:00:00Z');
const SCREEN = '11111111-1111-4111-8111-111111111111';
const AFTER_JITTER = SLOT_START + jitterOffsetMs(SCREEN, '2026-11-10') + 1;

const daily = { id: 'p1', cadence: 'DAILY', dayOfWeek: null, time: '03:00', isActive: true };

function facts(over: Partial<RebootFacts> = {}): RebootFacts {
  return {
    nowMs: AFTER_JITTER,
    policy: daily,
    screenId: SCREEN,
    timeZone: ZONE,
    windows: [],
    canRestart: true,
    panelOff: false,
    syncActive: false,
    emergencyActive: false,
    otaInFlight: false,
    online: true,
    uptimeMs: 3 * 24 * 3600_000,
    classBusy: false,
    tenantCapReached: false,
    returnWindowMs: 15 * 60_000,
    ...over,
  };
}

const offAtNight = parseOnWindow({ id: 'w', daysOfWeek: [0, 1, 2, 3, 4, 5, 6], onTime: '07:00', offTime: '22:00', timezone: ZONE })!;
const onAllNight = parseOnWindow({ id: 'w2', daysOfWeek: [0, 1, 2, 3, 4, 5, 6], onTime: '18:00', offTime: '04:00', timezone: ZONE })!;
const offUntil0310 = parseOnWindow({ id: 'w3', daysOfWeek: [0, 1, 2, 3, 4, 5, 6], onTime: '03:10', offTime: '22:00', timezone: ZONE })!;

describe('scheduled restart — the slot', () => {
  it('only an off-hours time can be saved (22:00–04:59)', () => {
    expect(isAllowedPolicyTime('22:00')).toBe(true);
    expect(isAllowedPolicyTime('03:30')).toBe(true);
    expect(isAllowedPolicyTime('04:59')).toBe(true);
    expect(isAllowedPolicyTime('05:00')).toBe(false);
    expect(isAllowedPolicyTime('12:00')).toBe(false);
    expect(isAllowedPolicyTime('21:59')).toBe(false);
    expect(isAllowedPolicyTime('3:00')).toBe(false);
  });

  it('is open for one hour from the local time, in the screen zone', () => {
    expect(currentSlot(daily, ZONE, SLOT_START - 1)).toBeNull();
    expect(currentSlot(daily, ZONE, SLOT_START)).toEqual({ slotKey: '2026-11-10', startMs: SLOT_START });
    expect(currentSlot(daily, ZONE, SLOT_START + DISPATCH_WINDOW_MS - 1)?.slotKey).toBe('2026-11-10');
    expect(currentSlot(daily, ZONE, SLOT_START + DISPATCH_WINDOW_MS)).toBeNull();
  });

  it('a slot after midnight local keeps its own date; a 23:30 slot spans midnight', () => {
    const late = { ...daily, time: '23:30' };
    // 23:30 CST on 11-09 = 05:30Z on 11-10; 00:10 local next day is still that slot.
    const start = Date.parse('2026-11-10T05:30:00Z');
    expect(currentSlot(late, ZONE, start + 40 * 60_000)).toEqual({ slotKey: '2026-11-09', startMs: start });
  });

  it('weekly runs only on its day', () => {
    expect(currentSlot({ ...daily, cadence: 'WEEKLY', dayOfWeek: 2 }, ZONE, SLOT_START)?.slotKey).toBe('2026-11-10');
    expect(currentSlot({ ...daily, cadence: 'WEEKLY', dayOfWeek: 3 }, ZONE, SLOT_START)).toBeNull();
    expect(currentSlot({ ...daily, cadence: 'WEEKLY', dayOfWeek: null }, ZONE, SLOT_START)).toBeNull();
  });

  it('an inactive or malformed policy has no slot', () => {
    expect(currentSlot({ ...daily, isActive: false }, ZONE, SLOT_START)).toBeNull();
    expect(currentSlot({ ...daily, time: 'nope' }, ZONE, SLOT_START)).toBeNull();
    expect(currentSlot({ ...daily, cadence: 'HOURLY' }, ZONE, SLOT_START)).toBeNull();
  });

  it('jitter staggers screens inside 45 minutes and is stable', () => {
    const a = jitterOffsetMs(SCREEN, '2026-11-10');
    expect(a).toBe(jitterOffsetMs(SCREEN, '2026-11-10'));
    const offsets = new Set(Array.from({ length: 20 }, (_, i) => jitterOffsetMs(`screen-${i}`, '2026-11-10')));
    expect(offsets.size).toBeGreaterThan(15);
    for (const o of offsets) expect(o).toBeLessThan(45 * 60_000);
  });
});

describe('scheduled restart — every blocked condition', () => {
  it('sends when every fact allows it', () => {
    expect(decideScheduledReboot(facts())).toMatchObject({ due: true, verdict: 'send', slot: { slotKey: '2026-11-10' } });
  });

  it('is not due before the screen jitter offset or outside the slot', () => {
    expect(decideScheduledReboot(facts({ nowMs: SLOT_START - 60_000 }))).toEqual({ due: false });
    expect(decideScheduledReboot(facts({ nowMs: SLOT_START + DISPATCH_WINDOW_MS }))).toEqual({ due: false });
  });

  it('cannot-restart: a screen with no reboot capability (every screen today) is skipped', () => {
    expect(decideScheduledReboot(facts({ canRestart: false }))).toMatchObject({ verdict: 'skip', reason: 'cannot-restart' });
  });

  it('no-time-zone: a screen whose zone does not resolve never uses the device zone', () => {
    const d = decideScheduledReboot(facts({ timeZone: null, nowMs: Date.parse('2026-11-10T03:10:00Z') }));
    expect(d).toMatchObject({ verdict: 'skip', reason: 'no-time-zone' });
    expect(decideScheduledReboot(facts({ timeZone: 'Not/AZone', nowMs: Date.parse('2026-11-10T08:00:00Z') }))).toEqual({ due: false });
  });

  it('not-off-hours: refused outside 22:00–06:00 local even if a slot were open', () => {
    // A 04:30 slot runs to 05:30 — inside; a hand-written 05:30 row (not savable) would be outside.
    const p = { ...daily, time: '05:30' };
    const start = Date.parse('2026-11-10T11:30:00Z');
    const d = decideScheduledReboot(facts({ policy: p, nowMs: start + jitterOffsetMs(SCREEN, '2026-11-10') + 1 }));
    expect(d).toMatchObject({ verdict: 'skip', reason: 'not-off-hours' });
  });

  it('outside-off-window: with an on/off schedule it must be OFF now and still OFF after the return window', () => {
    expect(decideScheduledReboot(facts({ windows: [offAtNight] }))).toMatchObject({ verdict: 'send' });
    // Lit 18:00–04:00: at 03:0x the screen is still on.
    expect(decideScheduledReboot(facts({ windows: [onAllNight] }))).toMatchObject({ verdict: 'skip', reason: 'outside-off-window' });
    // On until 04:00: at 03:0x the screen is lit.
    const lit = parseOnWindow({ id: 'w4', daysOfWeek: [0, 1, 2, 3, 4, 5, 6], onTime: '18:00', offTime: '05:00', timezone: ZONE })!;
    expect(decideScheduledReboot(facts({ windows: [lit] }))).toMatchObject({ verdict: 'skip', reason: 'outside-off-window' });
    // Off now, but the schedule switches it ON at 03:10, inside the return window.
    const nearOn = facts({ windows: [offUntil0310], nowMs: SLOT_START + 60_000 });
    nearOn.nowMs = Math.max(nearOn.nowMs, SLOT_START + jitterOffsetMs(SCREEN, '2026-11-10') + 1);
    expect(decideScheduledReboot(nearOn)).toMatchObject({ verdict: 'skip', reason: 'outside-off-window' });
  });

  it('panel-off: a panel turned off without a schedule saying so is never re-lit by a restart', () => {
    expect(decideScheduledReboot(facts({ panelOff: true }))).toMatchObject({ verdict: 'skip', reason: 'panel-off' });
    // Inside the schedule's OFF window a dark panel is expected and allowed.
    expect(decideScheduledReboot(facts({ panelOff: true, windows: [offAtNight] }))).toMatchObject({ verdict: 'send' });
  });

  it('sync-live: a frame-locked screen with no OFF schedule may be in a live moment', () => {
    expect(decideScheduledReboot(facts({ syncActive: true }))).toMatchObject({ verdict: 'skip', reason: 'sync-live' });
    expect(decideScheduledReboot(facts({ syncActive: true, windows: [offAtNight] }))).toMatchObject({ verdict: 'send' });
  });

  it('restarted-on-its-own: a box whose own standby/wake restarted it (t982, EP6N) is not restarted again', () => {
    expect(decideScheduledReboot(facts({ uptimeMs: 6 * 3600_000 }))).toMatchObject({ verdict: 'skip', reason: 'restarted-on-its-own' });
    expect(decideScheduledReboot(facts({ uptimeMs: 23 * 3600_000 + 1 }))).toMatchObject({ verdict: 'send' });
    const weekly = { ...daily, cadence: 'WEEKLY', dayOfWeek: 2 };
    expect(decideScheduledReboot(facts({ policy: weekly, uptimeMs: 3 * 24 * 3600_000 }))).toMatchObject({ reason: 'restarted-on-its-own' });
    // Unknown uptime does not count as a restart.
    expect(decideScheduledReboot(facts({ uptimeMs: null }))).toMatchObject({ verdict: 'send' });
  });

  it('offline waits (a box in Goodview deep standby is offline)', () => {
    expect(decideScheduledReboot(facts({ online: false }))).toMatchObject({ verdict: 'wait', reason: 'offline' });
  });

  it('emergency waits — any hold, including unreadable', () => {
    expect(decideScheduledReboot(facts({ emergencyActive: true }))).toMatchObject({ verdict: 'wait', reason: 'emergency' });
  });

  it('ota-in-flight waits', () => {
    expect(decideScheduledReboot(facts({ otaInFlight: true }))).toMatchObject({ verdict: 'wait', reason: 'ota-in-flight' });
  });

  it('class-busy waits: one hardware class at a time', () => {
    expect(decideScheduledReboot(facts({ classBusy: true }))).toMatchObject({ verdict: 'wait', reason: 'class-busy' });
  });

  it('tenant-cap waits', () => {
    expect(decideScheduledReboot(facts({ tenantCapReached: true }))).toMatchObject({ verdict: 'wait', reason: 'tenant-cap' });
  });
});

describe('scheduled restart — facts read off the screen', () => {
  it('reads the reboot capability from the stored verdict', () => {
    expect(verdictCanRestart({ verdict: { reboot: 'none' } })).toBe(false);
    expect(verdictCanRestart({ verdict: { reboot: 'device-owner' } })).toBe(true);
    expect(verdictCanRestart({ reboot: 'device-owner' })).toBe(true);
    expect(verdictCanRestart(null)).toBe(false);
  });

  it('uptime advances with the report age and goes unknown when stale', () => {
    const at = new Date(SLOT_START - 60_000);
    expect(uptimeFrom({ elapsedRealtimeMs: 1000 }, at, SLOT_START)).toBe(61_000);
    expect(uptimeFrom({ elapsedRealtimeMs: 1000 }, new Date(SLOT_START - 3 * 3600_000), SLOT_START)).toBeNull();
    expect(uptimeFrom({}, at, SLOT_START)).toBeNull();
  });

  it('panel off: native not interactive, or a soft blank', () => {
    expect(panelIsOff({ interactive: false }, null)).toBe(true);
    expect(panelIsOff({ interactive: true }, new Date())).toBe(true);
    expect(panelIsOff({ interactive: null }, null)).toBe(false);
  });

  it('OTA in flight: an active tracked push, or a recent install step', () => {
    expect(otaIsInFlight({}, true, SLOT_START)).toBe(true);
    expect(otaIsInFlight({ lastOtaState: 'INSTALLING', lastOtaAt: new Date(SLOT_START - 60_000) }, false, SLOT_START)).toBe(true);
    expect(otaIsInFlight({ lastOtaState: 'INSTALLING', lastOtaAt: new Date(SLOT_START - 40 * 60_000) }, false, SLOT_START)).toBe(false);
    expect(otaIsInFlight({ lastOtaState: 'INSTALLED', lastOtaAt: new Date(SLOT_START) }, false, SLOT_START)).toBe(false);
  });
});

describe('scheduled restart — proof of return', () => {
  const d = SLOT_START;
  const win = 15 * 60_000;
  it('BACK, proven, when it checks in with a higher boot count', () => {
    expect(evaluateReturn({ nowMs: d + 120_000, dispatchedAtMs: d, bootBefore: 10, bootNow: 11, lastPingAtMs: d + 90_000, returnWindowMs: win }))
      .toEqual({ status: 'BACK', proven: true, returnedAtMs: d + 90_000, bootAfter: 11 });
  });
  it('a ping inside the grace after the dispatch proves nothing', () => {
    expect(evaluateReturn({ nowMs: d + 60_000, dispatchedAtMs: d, bootBefore: 10, bootNow: null, lastPingAtMs: d + CHECK_IN_GRACE_MS, returnWindowMs: win }))
      .toEqual({ status: 'pending' });
  });
  it('NOT_BACK when no check-in by the end of the window', () => {
    expect(evaluateReturn({ nowMs: d + win, dispatchedAtMs: d, bootBefore: 10, bootNow: null, lastPingAtMs: d - 1000, returnWindowMs: win }))
      .toEqual({ status: 'NOT_BACK' });
    expect(evaluateReturn({ nowMs: d + win - 1, dispatchedAtMs: d, bootBefore: 10, bootNow: null, lastPingAtMs: null, returnWindowMs: win }))
      .toEqual({ status: 'pending' });
  });
  it('NO_RESTART when it checked in but the boot count never moved', () => {
    expect(evaluateReturn({ nowMs: d + win, dispatchedAtMs: d, bootBefore: 10, bootNow: 10, lastPingAtMs: d + 200_000, returnWindowMs: win }))
      .toMatchObject({ status: 'NO_RESTART' });
  });
  it('BACK, unproven, with no boot count to compare', () => {
    expect(evaluateReturn({ nowMs: d + 200_000, dispatchedAtMs: d, bootBefore: null, bootNow: null, lastPingAtMs: d + 150_000, returnWindowMs: win }))
      .toMatchObject({ status: 'BACK', proven: false });
  });
});

describe('scheduled restart — configuration', () => {
  it('kill switch: only 1 / true / yes disables', () => {
    expect(scheduledRebootsDisabled({})).toBe(false);
    expect(scheduledRebootsDisabled({ SCHEDULED_REBOOTS_DISABLED: '1' })).toBe(true);
    expect(scheduledRebootsDisabled({ SCHEDULED_REBOOTS_DISABLED: 'yes' })).toBe(true);
    expect(scheduledRebootsDisabled({ SCHEDULED_REBOOTS_DISABLED: '0' })).toBe(false);
  });
  it('caps and windows fall back on junk', () => {
    expect(tenantNightlyCap({})).toBe(20);
    expect(tenantNightlyCap({ SCHEDULED_REBOOT_TENANT_CAP: '5' })).toBe(5);
    expect(tenantNightlyCap({ SCHEDULED_REBOOT_TENANT_CAP: '0' })).toBe(20);
    expect(returnWindowMs({})).toBe(15 * 60_000);
    expect(returnWindowMs({ SCHEDULED_REBOOT_RETURN_MINUTES: 'x' })).toBe(15 * 60_000);
  });
});
