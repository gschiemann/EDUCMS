import { reconcileStrandedEmergency, STRANDED_EMERGENCY_CLEAR_STRIKES } from '../emergencyReconcile';

/**
 * Life-safety backstop decision (2026-07-04). A pushed emergency message must
 * clear when the server confirms it's gone (a missed ALL_CLEAR), but must NEVER
 * be dropped by a single transient empty/partial poll while it's still active.
 */
describe('reconcileStrandedEmergency', () => {
  const SHOWN = 'msg-abc';

  it('still active server-side → never clears, resets the miss streak', () => {
    const d = reconcileStrandedEmergency(new Set([SHOWN, 'other']), SHOWN, 1);
    expect(d.clear).toBe(false);
    expect(d.consecutiveMisses).toBe(0);
  });

  it('a SINGLE confirmed-absent poll does NOT clear (protects a live alert from a transient empty response)', () => {
    const d = reconcileStrandedEmergency(new Set(['other']), SHOWN, 0);
    expect(d.clear).toBe(false);
    expect(d.consecutiveMisses).toBe(1);
  });

  it('TWO consecutive confirmed-absent polls → clears (a genuinely missed ALL_CLEAR)', () => {
    const first = reconcileStrandedEmergency(new Set<string>(), SHOWN, 0);
    expect(first.clear).toBe(false);
    expect(first.consecutiveMisses).toBe(1);

    const second = reconcileStrandedEmergency(new Set<string>(), SHOWN, first.consecutiveMisses);
    expect(second.clear).toBe(true);
    expect(second.consecutiveMisses).toBe(STRANDED_EMERGENCY_CLEAR_STRIKES);
  });

  it('a re-appearance between two absences RESETS the streak → does not clear', () => {
    // absent → present → absent should NOT reach 2-in-a-row.
    const miss1 = reconcileStrandedEmergency(new Set<string>(), SHOWN, 0);
    expect(miss1.consecutiveMisses).toBe(1);
    const present = reconcileStrandedEmergency(new Set([SHOWN]), SHOWN, miss1.consecutiveMisses);
    expect(present.consecutiveMisses).toBe(0);
    const miss2 = reconcileStrandedEmergency(new Set<string>(), SHOWN, present.consecutiveMisses);
    expect(miss2.clear).toBe(false); // only 1 consecutive, not 2
    expect(miss2.consecutiveMisses).toBe(1);
  });

  it('ADVERSARIAL: the fix is load-bearing — an empty server list on the first check must NOT clear a still-shown alert', () => {
    // If this returned clear:true on a single empty poll, a transient blank
    // /emergency/messages response would wrongly drop a real, active takeover.
    expect(reconcileStrandedEmergency(new Set<string>(), SHOWN, 0).clear).toBe(false);
  });
});
