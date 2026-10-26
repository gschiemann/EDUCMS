/**
 * STANDARD WORDING on the fallback board (2026-10-26, owner decision 2 of the
 * Settings simplification: "default emergency wording for every alert type,
 * so each alert is ready on day 1"; the words themselves owner-approved).
 *
 * Against the real controller + manifest (the stateful world of
 * emergency.targeting.spec.ts). What this proves:
 *   1. a LIVE alert of each of the six types, on a tenant with no content of
 *      its own, shows that type's standard words — headline, blank line,
 *      action lines — on the same red DEFAULT_EMERGENCY board;
 *   2. a message the operator typed for a screen still wins (never overwritten);
 *   3. a DRILL keeps its own DRILL board — no live words, no red;
 *   4. nothing transmitted changes: `emergencyType` stays the raw enum.
 */
import { EMERGENCY_WORDING_KINDS, standardEmergencyText } from '@cms/api-types';
import { invalidateTenantState, resetManifestCacheForTests } from '../screens/manifest-hot-cache';
import { resetEmergencyRevForTests } from '../screens/emergency-rev';
import { DISTRICT, SCHOOL, SIBLING, OTHER, makeWorld, schoolAdmin } from './emergency.targeting.world';

const live = (type: string, extra: Record<string, unknown> = {}) =>
  ({ scopeType: 'tenant', scopeId: SCHOOL, overridePayload: { type, severity: 'CRITICAL', ...extra } }) as any;

beforeEach(() => {
  resetManifestCacheForTests();
  resetEmergencyRevForTests('origin-standard-wording');
  for (const id of [DISTRICT, SCHOOL, SIBLING, OTHER]) invalidateTenantState(id);
});

function boardText(m: any): string {
  return m.playlists[0].template.zones[0].defaultConfig.content;
}

describe('standard wording on the fallback board', () => {
  it.each(EMERGENCY_WORDING_KINDS)('a live %s alert with no content shows its standard words', async (kind) => {
    const w = makeWorld();
    const res: any = await w.emergency.triggerEmergency(live(kind), schoolAdmin);
    expect(res).toMatchObject({ success: true });
    const m = await w.manifest('gym-1');
    expect(m.isEmergency).toBe(true);
    expect(m.playlists[0].id).toBe('DEFAULT_EMERGENCY');
    expect(boardText(m)).toBe(standardEmergencyText(kind));
    // The raw enum still rides untouched — players switch on it.
    expect(m.emergencyType).toBe(kind.toUpperCase());
    // Same red board as before; only the words changed.
    expect(m.playlists[0].template.bgColor).toBe('#dc2626');
  });

  it('a lockdown reads exactly "LOCKDOWN / Locks, lights, out of sight."', async () => {
    const w = makeWorld();
    await w.emergency.triggerEmergency(live('lockdown'), schoolAdmin);
    expect(boardText(await w.manifest('lobby'))).toBe(
      'LOCKDOWN\n\nLocks, lights, out of sight.\nStay quiet. Do not open the door.',
    );
  });

  it('a message the operator typed for a screen always wins', async () => {
    const w = makeWorld();
    await w.emergency.triggerEmergency(
      {
        scopeType: 'device',
        scopeId: 'gym-1',
        overridePayload: { type: 'lockdown', severity: 'CRITICAL', textBlob: 'Gym wing — stay in the locker rooms' },
      } as any,
      schoolAdmin,
    );
    expect(boardText(await w.manifest('gym-1'))).toBe('Gym wing — stay in the locker rooms');
  });

  it('a drill keeps its own DRILL board, never the live words', async () => {
    const w = makeWorld();
    await w.emergency.triggerEmergency(live('lockdown', { isDrill: true }), schoolAdmin);
    const m = await w.manifest('gym-1');
    expect(boardText(m)).toMatch(/^DRILL — THIS IS A DRILL/);
    expect(boardText(m)).not.toContain('Locks, lights, out of sight.');
    expect(m.playlists[0].template.bgColor).not.toBe('#dc2626');
  });
});
