/**
 * Pure rules behind the device message poll and the message clear
 * (2026-10-22 — district broadcasts vanished from child screens). The
 * end-to-end behaviour against the real controller is in
 * `emergency.district-propagation.spec.ts`; this file pins each shape.
 */
import {
  clearTargetMessageIds,
  deviceMessagesWhere,
  fanoutMessageId,
  isMessageVisibleToTenant,
  rootMessageIdOf,
} from './message-visibility';

describe('deviceMessagesWhere', () => {
  const now = new Date('2026-10-22T12:00:00Z');

  it('pins the row to the screen’s OWN tenant and leaves tenant-scope scopeId open', () => {
    const where = deviceMessagesWhere({ tenantId: 'school-a', screenId: 'scr-1', groupId: null }, now);
    expect(where.tenantId).toBe('school-a');
    expect(where.clearedAt).toBeNull();
    expect(where.OR).toEqual([{ expiresAt: null }, { expiresAt: { gt: now } }]);
    expect(where.AND).toEqual([
      { OR: [{ scopeType: 'tenant' }, { scopeType: 'device', scopeId: 'scr-1' }] },
    ]);
  });

  it('adds the group scope only when the screen is in a group', () => {
    const where = deviceMessagesWhere({ tenantId: 't', screenId: 's', groupId: 'g1' }, now);
    expect(where.AND[0].OR).toContainEqual({ scopeType: 'group', scopeId: 'g1' });
    const noGroup = deviceMessagesWhere({ tenantId: 't', screenId: 's', groupId: undefined }, now);
    expect(noGroup.AND[0].OR.map((c) => c.scopeType)).toEqual(['tenant', 'device']);
  });
});

describe('isMessageVisibleToTenant', () => {
  const ancestors = new Set(['district']);

  it('a copy aimed at the tenant itself is visible', () => {
    expect(isMessageVisibleToTenant({ scopeType: 'tenant', scopeId: 'school-a' }, 'school-a', ancestors)).toBe(true);
  });

  it('a copy aimed at an ancestor (district broadcast) is visible', () => {
    expect(isMessageVisibleToTenant({ scopeType: 'tenant', scopeId: 'district' }, 'school-a', ancestors)).toBe(true);
  });

  it('a tenant-scoped row aimed at a non-ancestor is NOT visible (no writer produces one; fail closed)', () => {
    expect(isMessageVisibleToTenant({ scopeType: 'tenant', scopeId: 'school-b' }, 'school-a', ancestors)).toBe(false);
    expect(isMessageVisibleToTenant({ scopeType: 'tenant', scopeId: 'other-org' }, 'school-a', new Set())).toBe(false);
  });

  it('group / device rows passed the where’s exact membership match and pass through', () => {
    expect(isMessageVisibleToTenant({ scopeType: 'device', scopeId: 'scr-9' }, 'school-a', new Set())).toBe(true);
    expect(isMessageVisibleToTenant({ scopeType: 'group', scopeId: 'g-9' }, 'school-a', new Set())).toBe(true);
  });
});

describe('fan-out ids', () => {
  it('fanoutMessageId mirrors the write path: bare id for the aimed tenant, suffixed for descendants', () => {
    expect(fanoutMessageId('bcast_1', 'district', 'district')).toBe('bcast_1');
    expect(fanoutMessageId('bcast_1', 'district', 'school-a')).toBe('bcast_1_school-a');
  });

  it('rootMessageIdOf strips exactly the row’s own tenant suffix', () => {
    expect(rootMessageIdOf('bcast_1', 'district')).toBe('bcast_1');
    expect(rootMessageIdOf('bcast_1_school-a', 'school-a')).toBe('bcast_1');
    // A tenant id containing an underscore strips by its full value, once.
    expect(rootMessageIdOf('bcast_1_sch_ool', 'sch_ool')).toBe('bcast_1');
    // A different tenant's suffix is not stripped (not this row's copy).
    expect(rootMessageIdOf('bcast_1_school-a', 'school-b')).toBe('bcast_1_school-a');
    // Degenerate: an id that IS the suffix is left alone.
    expect(rootMessageIdOf('_x', 'x')).toBe('_x');
  });

  it('clearTargetMessageIds covers the named row plus every descendant copy', () => {
    expect(clearTargetMessageIds('bcast_1', 'district', ['school-a', 'school-b', 'annex']).sort()).toEqual(
      ['bcast_1', 'bcast_1_annex', 'bcast_1_school-a', 'bcast_1_school-b'],
    );
  });

  it('clearing from a CHILD copy reaches that child’s subtree only, never the parent', () => {
    expect(clearTargetMessageIds('bcast_1_school-a', 'school-a', ['annex']).sort()).toEqual(
      ['bcast_1_annex', 'bcast_1_school-a'],
    );
  });

  it('a leaf with no descendants clears exactly the one row (single-tenant behaviour unchanged)', () => {
    expect(clearTargetMessageIds('sos_7', 'school-a', [])).toEqual(['sos_7']);
  });
});
