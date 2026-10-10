/**
 * The drill log pairing (Settings → Emergency → Drill), 2026-10-10.
 */
import { drillDuration, pairDrillLog, type AuditRow } from '@/lib/drill-log';

const row = (action: string, createdAt: string, details: Record<string, unknown>, extra: Partial<AuditRow> = {}): AuditRow => ({
  id: `${action}-${createdAt}`,
  action,
  createdAt,
  details: JSON.stringify(details),
  targetType: 'tenant',
  targetId: 't1',
  user: { email: 'principal@school.test' },
  ...extra,
});

describe('pairDrillLog', () => {
  it('pairs a start with its own all-clear by overrideId, newest first, and marks an unended drill in progress', () => {
    const triggers = [
      row('TRIGGER_EMERGENCY_DRILL', '2026-10-10T10:00:00.000Z', { overrideId: 'ovr_a', type: 'LOCKDOWN', isDrill: true }),
      row('TRIGGER_EMERGENCY_DRILL', '2026-10-10T12:00:00.000Z', { overrideId: 'ovr_b', type: 'HOLD', isDrill: true }, { targetType: 'group', targetId: 'g1' }),
    ];
    const clears = [
      row('CLEAR_EMERGENCY_DRILL', '2026-10-10T10:04:12.000Z', { overrideId: 'ovr_a', isDrill: true }),
    ];
    const log = pairDrillLog(triggers, clears);
    expect(log.map((e) => e.overrideId)).toEqual(['ovr_b', 'ovr_a']);
    expect(log[1]).toMatchObject({ type: 'LOCKDOWN', scopeType: 'tenant', who: 'principal@school.test', endedAt: '2026-10-10T10:04:12.000Z' });
    expect(log[0]).toMatchObject({ type: 'HOLD', scopeType: 'group', scopeId: 'g1', endedAt: null });
  });

  it('tolerates unreadable details and a clear older than its start', () => {
    const triggers = [row('TRIGGER_EMERGENCY_DRILL', '2026-10-10T10:00:00.000Z', {}, { details: '{not json' })];
    const clears = [row('CLEAR_EMERGENCY_DRILL', '2026-10-09T10:00:00.000Z', { overrideId: 'x' })];
    expect(pairDrillLog(triggers, clears)).toEqual([
      expect.objectContaining({ overrideId: null, type: null, endedAt: null, scopeType: 'tenant' }),
    ]);
  });
});

describe('drillDuration', () => {
  it('formats seconds, minutes and hours; null while in progress or for a bad range', () => {
    expect(drillDuration('2026-10-10T10:00:00Z', '2026-10-10T10:00:42Z')).toBe('42s');
    expect(drillDuration('2026-10-10T10:00:00Z', '2026-10-10T10:04:05Z')).toBe('4m 05s');
    expect(drillDuration('2026-10-10T10:00:00Z', '2026-10-10T11:03:00Z')).toBe('1h 03m');
    expect(drillDuration('2026-10-10T10:00:00Z', null)).toBeNull();
    expect(drillDuration('2026-10-10T10:00:00Z', '2026-10-10T09:00:00Z')).toBeNull();
  });
});
