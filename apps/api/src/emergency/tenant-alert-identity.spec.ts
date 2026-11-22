/**
 * EMG-01 — the pure rule behind the tenant all-clear's compare-and-set
 * (tenant-alert-identity.ts). The end-to-end behaviour is pinned in
 * emergency.alert-identity.spec.ts.
 */
import {
  ALERT_CHANGED_CODE,
  alertChangedBody,
  alertIdentityDisabled,
  isRecordNotFound,
  namedAlertId,
  onePerKeptAlert,
  tenantAlertChanged,
  tenantClearGuard,
} from './tenant-alert-identity';

describe('namedAlertId — which requests name a real alert', () => {
  it.each([
    [undefined, null],
    [null, null],
    ['', null],
    ['   ', null],
    ['clear_7f0c1c8e-2b47-4c55-9a3b-2f0a1b9f6c11', null],
    ['global_clear', null],
    ['ovr_1234', 'ovr_1234'],
    ['  ovr_1234  ', 'ovr_1234'],
    ['custom-operator-id', 'custom-operator-id'],
  ])('%p → %p', (input, expected) => {
    expect(namedAlertId(input)).toBe(expected);
  });
});

describe('tenantAlertChanged — refuse only a real id against a different, identified, active alert', () => {
  const active = (id: string | null) => ({
    emergencyStatus: 'CRITICAL',
    emergencyAlertId: id,
  });
  it('different id on an active tenant → changed', () => {
    expect(tenantAlertChanged(active('ovr_new'), 'ovr_old')).toBe(true);
  });
  it('same id → not changed', () => {
    expect(tenantAlertChanged(active('ovr_same'), 'ovr_same')).toBe(false);
  });
  it('the request names no real id → never changed (today’s behaviour)', () => {
    expect(tenantAlertChanged(active('ovr_new'), null)).toBe(false);
  });
  it('a pre-identity alert (stored id NULL) → never changed (today’s behaviour)', () => {
    expect(tenantAlertChanged(active(null), 'ovr_old')).toBe(false);
  });
  it('an inactive tenant → never changed (a repeat clear is harmless)', () => {
    expect(
      tenantAlertChanged(
        { emergencyStatus: 'INACTIVE', emergencyAlertId: 'ovr_x' },
        'ovr_old',
      ),
    ).toBe(false);
  });
  it('unknown state (no row / a failed read) → not refused here; the write’s guard still applies', () => {
    expect(tenantAlertChanged(null, 'ovr_old')).toBe(false);
    expect(tenantAlertChanged(undefined, 'ovr_old')).toBe(false);
  });
});

describe('tenantClearGuard — the extra condition on the root write', () => {
  it('is empty when the request names no real id, so the write is unchanged', () => {
    expect(tenantClearGuard(null)).toEqual({});
  });
  it('matches the named alert, an unidentified one, or none', () => {
    expect(tenantClearGuard('ovr_1')).toEqual({
      OR: [
        { emergencyAlertId: 'ovr_1' },
        { emergencyAlertId: null },
        { emergencyStatus: 'INACTIVE' },
      ],
    });
  });
});

describe('alertChangedBody / isRecordNotFound', () => {
  it('names the alert that is live now', () => {
    const at = new Date('2026-11-21T10:00:00.000Z');
    const body = alertChangedBody(
      't1',
      {
        emergencyStatus: 'CRITICAL',
        emergencyType: 'LOCKDOWN',
        emergencyAlertId: 'ovr_new',
        emergencyIsDrill: false,
        emergencyTriggeredAt: at,
      },
      'ovr_old',
    );
    expect(body).toMatchObject({
      code: ALERT_CHANGED_CODE,
      requestedAlertId: 'ovr_old',
      currentAlert: {
        alertId: 'ovr_new',
        scopeType: 'tenant',
        scopeId: 't1',
        type: 'LOCKDOWN',
        severity: 'CRITICAL',
        isDrill: false,
        triggeredAt: at.toISOString(),
      },
    });
    expect(body.message).toMatch(/LOCKDOWN/);
  });
  it('recognises Prisma’s P2025 only', () => {
    expect(isRecordNotFound({ code: 'P2025' })).toBe(true);
    expect(isRecordNotFound({ code: 'P2002' })).toBe(false);
    expect(isRecordNotFound(new Error('boom'))).toBe(false);
    expect(isRecordNotFound(null)).toBe(false);
  });
});

describe('alertIdentityDisabled — the owner’s kill switch (review round 1)', () => {
  it.each(['1', 'true', 'TRUE', ' yes ', 'Yes'])('%p → off', (v) => {
    expect(
      alertIdentityDisabled({
        EMERGENCY_ALERT_IDENTITY_DISABLED: v,
      } as NodeJS.ProcessEnv),
    ).toBe(true);
  });
  it.each([undefined, '', '0', 'false', 'no', 'off', 'disabled', 'on'])(
    '%p → the rule stays on',
    (v) => {
      expect(
        alertIdentityDisabled({
          EMERGENCY_ALERT_IDENTITY_DISABLED: v,
        } as NodeJS.ProcessEnv),
      ).toBe(false);
    },
  );
});

describe('onePerKeptAlert — the kept locations, one entry per alert (review round 3)', () => {
  const k = (tenantId: string, parentId: string | null, alertId: string) => ({
    tenantId,
    parentId,
    alertId,
    type: 'LOCKDOWN',
    isDrill: false,
  });
  it('a school and the child location its alert was written on are one entry: the school', () => {
    expect(
      onePerKeptAlert([
        k('school', 'district', 'L'),
        k('annex', 'school', 'L'),
      ]).map((x) => x.tenantId),
    ).toEqual(['school']);
  });
  it('a child holding its OWN, different alert is its own entry', () => {
    expect(
      onePerKeptAlert([
        k('school', 'district', 'L'),
        k('annex', 'school', 'M'),
      ]).map((x) => x.tenantId),
    ).toEqual(['school', 'annex']);
  });
  it('a child whose parent was not kept is its own entry (the list shows it on its own)', () => {
    expect(
      onePerKeptAlert([k('annex', 'school', 'L')]).map((x) => x.tenantId),
    ).toEqual(['annex']);
  });
  it('a three-level chain sharing one id is one entry, at the top', () => {
    expect(
      onePerKeptAlert([
        k('sub', 'district', 'X'),
        k('school', 'sub', 'X'),
        k('annex', 'school', 'X'),
      ]).map((x) => x.tenantId),
    ).toEqual(['sub']);
  });
  it('empty in, empty out', () => {
    expect(onePerKeptAlert([])).toEqual([]);
  });
});
