/**
 * EMG-01 (2026-11-21) — the tenant-wide alert carries an id, and an all-clear
 * for an older alert cannot end a newer one.
 *
 * THE SCENARIO. Operator A is looking at "Hold — all screens". Operator B
 * escalates the same tenant to LOCKDOWN. A types CLEAR to end the Hold. Before
 * this fix the tenant all-clear never compared the id it was sent, so the
 * LOCKDOWN ended on every screen.
 *
 * Driven through the REAL emergency controller and read back through the REAL
 * manifest handler (emergency.targeting.world.ts), so "unchanged" here means
 * what a screen would actually show. Sections:
 *   1. a stale id is refused (409 ALERT_CHANGED), nothing changes, nothing is
 *      pushed, the refusal is audited;
 *   2. the matching id clears;
 *   3. no id / a synthetic id / a pre-identity alert (stored id NULL) clears
 *      exactly as before;
 *   4. every trigger path writes the id (and every clearing write nulls it) —
 *      behaviourally and as a source guard over the controller;
 *   5. a trigger that lands between the all-clear's read and its commit still
 *      wins (the batch rolls back);
 *   6. /emergency/active names the tenant-wide alert.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import { ConflictException } from '@nestjs/common';
import {
  invalidateTenantState,
  resetManifestCacheForTests,
} from '../screens/manifest-hot-cache';
import {
  localTenantEmergencyEpoch,
  resetEmergencyRevForTests,
} from '../screens/emergency-rev';
import {
  DISTRICT,
  SCHOOL,
  SIBLING,
  OTHER,
  SCHOOL_IDS,
  EVERY_SCREEN,
  makeWorld,
  schoolAdmin,
  districtAdmin,
  delegatedStaff,
  clear,
  emergencyMap,
  only,
} from './emergency.targeting.world';
import {
  ALERT_CHANGED_CODE,
  CLEAR_REFUSED_ACTION,
} from './tenant-alert-identity';

jest.mock('../security/required-secret', () => ({
  requireSecret: (_name: string, opts?: { devFallback?: string }) =>
    opts?.devFallback ?? 'test_secret_32_chars_padded_here_ok',
}));

type Scope = 'tenant' | 'group' | 'device';
const live = (scopeType: Scope, scopeId: string, type = 'lockdown') =>
  ({
    scopeType,
    scopeId,
    overridePayload: { type, severity: 'CRITICAL' },
  }) as any;
const drill = (scopeType: Scope, scopeId: string, type = 'lockdown') =>
  ({
    scopeType,
    scopeId,
    overridePayload: { type, severity: 'CRITICAL', isDrill: true },
  }) as any;

/** A panic phone's principal, exactly as panic-device.controller.ts builds it. */
const panicPhone = {
  user: {
    id: 'u-phone',
    userId: 'u-phone',
    email: 'phone@school.test',
    role: 'CONTRIBUTOR',
    tenantId: SCHOOL,
    schoolId: SCHOOL,
    canTriggerPanic: true,
    kind: 'panic-device',
    panicDeviceId: 'pd-1',
    panicDeviceIp: '203.0.113.9',
  },
};

beforeEach(() => {
  resetManifestCacheForTests();
  resetEmergencyRevForTests('origin-alert-identity');
  for (const id of [DISTRICT, SCHOOL, SIBLING, OTHER])
    invalidateTenantState(id);
});

/** Run the call and return the 409 it must refuse with. */
async function expectAlertChanged(p: Promise<unknown>): Promise<any> {
  let caught: unknown = null;
  try {
    await p;
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(ConflictException);
  const body = (caught as ConflictException).getResponse() as any;
  expect(body.code).toBe(ALERT_CHANGED_CODE);
  return body;
}

/** Hold on the school, then another operator escalates it to a Lockdown. */
async function holdThenLockdown(w: ReturnType<typeof makeWorld>) {
  const hold: any = await w.emergency.triggerEmergency(
    live('tenant', SCHOOL, 'hold'),
    schoolAdmin,
  );
  const lockdown: any = await w.emergency.triggerEmergency(
    live('tenant', SCHOOL, 'lockdown'),
    delegatedStaff,
  );
  expect(hold.overrideId).not.toBe(lockdown.overrideId);
  return { hold, lockdown };
}

// ═══ 1. A stale id is refused ═══════════════════════════════════════════════

describe('1. an all-clear naming an alert that was replaced is refused (409)', () => {
  it('the escalation scenario: clearing the Hold does NOT end the Lockdown', async () => {
    const w = makeWorld();
    const { hold, lockdown } = await holdThenLockdown(w);
    const before = { ...w.tenants.get(SCHOOL) };
    const publishedBefore = w.published.length;
    const auditBefore = w.auditLogs.length;

    const body = await expectAlertChanged(
      w.emergency.clearEmergency(
        hold.overrideId,
        clear('tenant', SCHOOL),
        schoolAdmin,
      ),
    );

    // The 409 names the alert that IS live, so the UI can say so.
    expect(body.requestedAlertId).toBe(hold.overrideId);
    expect(body.currentAlert).toMatchObject({
      alertId: lockdown.overrideId,
      scopeType: 'tenant',
      scopeId: SCHOOL,
      type: 'LOCKDOWN',
      severity: 'CRITICAL',
      isDrill: false,
    });
    // Status unchanged — the tenant row, and what every screen shows.
    expect(w.tenants.get(SCHOOL)).toEqual(before);
    expect(w.tenants.get(SCHOOL)).toMatchObject({
      emergencyStatus: 'CRITICAL',
      emergencyType: 'LOCKDOWN',
      emergencyAlertId: lockdown.overrideId,
    });
    expect(await emergencyMap(w)).toEqual(only(SCHOOL_IDS));
    // …and it is still the LOCKDOWN on the glass, not the Hold.
    for (const id of SCHOOL_IDS)
      expect((await w.manifest(id)).emergencyType).toBe('LOCKDOWN');
    // Nothing pushed: a refused all-clear never reaches a screen.
    expect(w.published.length).toBe(publishedBefore);
    // No clear recorded — only the refusal, with who, from where and both ids.
    expect(w.auditLogs.some((a) => a.action === 'CLEAR_EMERGENCY')).toBe(false);
    const added = w.auditLogs.slice(auditBefore);
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({
      action: CLEAR_REFUSED_ACTION,
      targetType: 'tenant',
      targetId: SCHOOL,
      tenantId: SCHOOL,
      userId: schoolAdmin.user.id,
    });
    expect(JSON.parse(added[0].details)).toMatchObject({
      reason: ALERT_CHANGED_CODE,
      requestedAlertId: hold.overrideId,
      currentAlertId: lockdown.overrideId,
      currentType: 'LOCKDOWN',
      stage: 'before-dispatch',
      scopeType: 'tenant',
      scopeId: SCHOOL,
      triggeredByTenant: SCHOOL,
    });
  });

  it('the operator then clears the CURRENT alert with its own id', async () => {
    const w = makeWorld();
    const { hold, lockdown } = await holdThenLockdown(w);
    await expectAlertChanged(
      w.emergency.clearEmergency(
        hold.overrideId,
        clear('tenant', SCHOOL),
        schoolAdmin,
      ),
    );
    const res: any = await w.emergency.clearEmergency(
      lockdown.overrideId,
      clear('tenant', SCHOOL),
      schoolAdmin,
    );
    expect(res.success).toBe(true);
    expect(await emergencyMap(w)).toEqual(only([]));
  });

  it('a district all-clear naming the district alert a newer district alert replaced is refused; every school keeps it', async () => {
    const w = makeWorld();
    const hold: any = await w.emergency.triggerEmergency(
      live('tenant', DISTRICT, 'hold'),
      districtAdmin,
    );
    const lockdown: any = await w.emergency.triggerEmergency(
      live('tenant', DISTRICT, 'lockdown'),
      districtAdmin,
    );
    await expectAlertChanged(
      w.emergency.clearEmergency(
        hold.overrideId,
        clear('tenant', DISTRICT),
        districtAdmin,
      ),
    );
    for (const tid of [DISTRICT, SCHOOL, SIBLING]) {
      expect(w.tenants.get(tid)).toMatchObject({
        emergencyStatus: 'CRITICAL',
        emergencyType: 'LOCKDOWN',
        emergencyAlertId: lockdown.overrideId,
      });
    }
    expect(await emergencyMap(w)).toEqual(
      only([
        'gym-1',
        'gym-2',
        'lobby',
        'office',
        'front',
        'back',
        'sib-1',
        'district-1',
      ]),
    );
  });

  it('an "End Drill" naming a drill that a newer drill replaced is refused too', async () => {
    const w = makeWorld();
    const d1: any = await w.emergency.triggerEmergency(
      drill('tenant', SCHOOL, 'hold'),
      schoolAdmin,
    );
    const d2: any = await w.emergency.triggerEmergency(
      drill('tenant', SCHOOL, 'lockdown'),
      schoolAdmin,
    );
    const body = await expectAlertChanged(
      w.emergency.clearEmergency(
        d1.overrideId,
        { ...clear('tenant', SCHOOL), isDrill: true },
        schoolAdmin,
      ),
    );
    expect(body.currentAlert).toMatchObject({
      alertId: d2.overrideId,
      isDrill: true,
      type: 'LOCKDOWN',
    });
    expect(w.tenants.get(SCHOOL)).toMatchObject({
      emergencyIsDrill: true,
      emergencyAlertId: d2.overrideId,
    });
  });
});

// ═══ 2. The matching id clears ══════════════════════════════════════════════

describe('2. an all-clear naming the alert the tenant holds clears it', () => {
  it('clears the row, its identity and every screen', async () => {
    const w = makeWorld();
    const res: any = await w.emergency.triggerEmergency(
      live('tenant', SCHOOL),
      schoolAdmin,
    );
    const cleared: any = await w.emergency.clearEmergency(
      res.overrideId,
      clear('tenant', SCHOOL),
      schoolAdmin,
    );
    expect(cleared.success).toBe(true);
    expect(w.tenants.get(SCHOOL)).toMatchObject({
      emergencyStatus: 'INACTIVE',
      emergencyType: null,
      emergencyAlertId: null,
      emergencyTriggeredAt: null,
    });
    expect(await emergencyMap(w)).toEqual(only([]));
    const row = w.auditLogs.find((a) => a.action === 'CLEAR_EMERGENCY');
    expect(JSON.parse(row!.details).overrideId).toBe(res.overrideId);
    expect(w.auditLogs.some((a) => a.action === CLEAR_REFUSED_ACTION)).toBe(
      false,
    );
    expect(w.published).toContain(`tenant:${SCHOOL}`);
  });

  it('a district all-clear with the district id clears every school, as before', async () => {
    const w = makeWorld();
    const res: any = await w.emergency.triggerEmergency(
      live('tenant', DISTRICT),
      districtAdmin,
    );
    await w.emergency.clearEmergency(
      res.overrideId,
      clear('tenant', DISTRICT),
      districtAdmin,
    );
    for (const tid of [DISTRICT, SCHOOL, SIBLING]) {
      expect(w.tenants.get(tid)).toMatchObject({
        emergencyStatus: 'INACTIVE',
        emergencyAlertId: null,
      });
    }
    expect(await emergencyMap(w)).toEqual(only([]));
  });

  it('a stale id on a tenant that is no longer in an alert is a harmless no-op clear, as before', async () => {
    const w = makeWorld();
    const res: any = await w.emergency.triggerEmergency(
      live('tenant', SCHOOL),
      schoolAdmin,
    );
    await w.emergency.clearEmergency(
      res.overrideId,
      clear('tenant', SCHOOL),
      schoolAdmin,
    );
    const again: any = await w.emergency.clearEmergency(
      res.overrideId,
      clear('tenant', SCHOOL),
      schoolAdmin,
    );
    expect(again.success).toBe(true);
  });
});

// ═══ 3. Backward compatibility — never leave an operator unable to clear ════

describe('3. a request that does not know the id behaves exactly as before', () => {
  it.each([
    [
      'a synthetic clear_<uuid> (older dashboard / panic bundle)',
      'clear_7f0c1c8e-2b47-4c55-9a3b-2f0a1b9f6c11',
    ],
    ['the legacy global_clear literal', 'global_clear'],
  ])('%s ends the current alert', async (_label, sentId) => {
    const w = makeWorld();
    await holdThenLockdown(w);
    const res: any = await w.emergency.clearEmergency(
      sentId,
      clear('tenant', SCHOOL),
      schoolAdmin,
    );
    expect(res.success).toBe(true);
    expect(w.tenants.get(SCHOOL)).toMatchObject({
      emergencyStatus: 'INACTIVE',
      emergencyAlertId: null,
    });
    expect(await emergencyMap(w)).toEqual(only([]));
    expect(w.auditLogs.some((a) => a.action === CLEAR_REFUSED_ACTION)).toBe(
      false,
    );
  });

  it('an alert raised before this deploy (stored id NULL) clears with whatever id the client sends', async () => {
    const w = makeWorld();
    await w.emergency.triggerEmergency(live('tenant', SCHOOL), schoolAdmin);
    // The row as the previous build left it: an active alert with no identity.
    Object.assign(w.tenants.get(SCHOOL)!, {
      emergencyAlertId: null,
      emergencyTriggeredAt: null,
    });
    const res: any = await w.emergency.clearEmergency(
      'ovr_from_an_old_browser_store',
      clear('tenant', SCHOOL),
      schoolAdmin,
    );
    expect(res.success).toBe(true);
    expect(w.tenants.get(SCHOOL)).toMatchObject({
      emergencyStatus: 'INACTIVE',
    });
    expect(await emergencyMap(w)).toEqual(only([]));
  });

  it('the root write for an id-less request is exactly the write it always was (no extra condition)', async () => {
    const w = makeWorld();
    await w.emergency.triggerEmergency(live('tenant', SCHOOL), schoolAdmin);
    w.client.tenant.update.mockClear();
    await w.emergency.clearEmergency(
      'clear_abc',
      clear('tenant', SCHOOL),
      schoolAdmin,
    );
    const call = w.client.tenant.update.mock.calls.find(
      (c: any[]) => c[0]?.data?.emergencyStatus === 'INACTIVE',
    );
    expect(call![0].where).toEqual({ id: SCHOOL });
  });
});

// ═══ 4. Every trigger path writes the id ════════════════════════════════════

describe('4. every path that raises a tenant-wide alert writes its id and raise time', () => {
  it.each([
    ['a dashboard session (school admin)', schoolAdmin],
    ['a delegated staffer with canTriggerPanic (/panic)', delegatedStaff],
    ['a panic phone', panicPhone],
  ])('%s', async (_label, who) => {
    const w = makeWorld();
    const t0 = Date.now();
    const res: any = await w.emergency.triggerEmergency(
      live('tenant', SCHOOL),
      who as any,
    );
    const row = w.tenants.get(SCHOOL)!;
    expect(row.emergencyAlertId).toBe(res.overrideId);
    expect(row.emergencyTriggeredAt).toBeInstanceOf(Date);
    expect((row.emergencyTriggeredAt as Date).getTime()).toBeGreaterThanOrEqual(
      t0 - 1000,
    );
  });

  it('a district alert writes the SAME id on the district and every descendant', async () => {
    const w = makeWorld();
    const res: any = await w.emergency.triggerEmergency(
      live('tenant', DISTRICT),
      districtAdmin,
    );
    const stamps = new Set<number>();
    for (const tid of [DISTRICT, SCHOOL, SIBLING]) {
      expect(w.tenants.get(tid)!.emergencyAlertId).toBe(res.overrideId);
      stamps.add((w.tenants.get(tid)!.emergencyTriggeredAt as Date).getTime());
    }
    expect(stamps.size).toBe(1);
    expect(w.tenants.get(OTHER)!.emergencyAlertId ?? null).toBeNull();
  });

  it('a drill writes its id; a live alert that ends a drill elsewhere nulls that drill’s id', async () => {
    const w = makeWorld();
    const d: any = await w.emergency.triggerEmergency(
      drill('tenant', DISTRICT, 'hold'),
      districtAdmin,
    );
    for (const tid of [DISTRICT, SCHOOL, SIBLING])
      expect(w.tenants.get(tid)!.emergencyAlertId).toBe(d.overrideId);
    const l: any = await w.emergency.triggerEmergency(
      live('tenant', SCHOOL),
      schoolAdmin,
    );
    expect(w.tenants.get(SCHOOL)).toMatchObject({
      emergencyAlertId: l.overrideId,
      emergencyIsDrill: false,
    });
    for (const tid of [DISTRICT, SIBLING]) {
      expect(w.tenants.get(tid)).toMatchObject({
        emergencyStatus: 'INACTIVE',
        emergencyAlertId: null,
        emergencyTriggeredAt: null,
      });
    }
  });

  it('source guard: every Tenant write in the emergency controller that sets emergencyStatus also sets emergencyAlertId', () => {
    const file = path.join(__dirname, 'emergency.controller.ts');
    const writes = tenantStatusWrites(fs.readFileSync(file, 'utf8'));
    // trigger (update), all-clear root (update + updateMany), all-clear
    // descendants (updateMany), live-ends-drill (updateMany) — at least these.
    expect(writes.length).toBeGreaterThanOrEqual(5);
    const missing = writes
      .filter((w) => !w.setsAlertId)
      .map((w) => `emergency.controller.ts:${w.line}`);
    expect(missing).toEqual([]);
  });
});

// ═══ 5. The race: a trigger between the all-clear's read and its commit ═════

describe('5. a trigger that lands after the all-clear read it still wins', () => {
  it('the root compare-and-set fails, the whole batch rolls back, 409, and the alert stays up', async () => {
    const w = makeWorld();
    makeWritesLazyAndTransactional(w);
    const hold: any = await w.emergency.triggerEmergency(
      live('tenant', DISTRICT, 'hold'),
      districtAdmin,
    );
    // What the all-clear's pre-dispatch read will see: the Hold, as it was
    // just before the escalation committed.
    const holdSnapshot = { ...w.tenants.get(DISTRICT) };
    const lockdown: any = await w.emergency.triggerEmergency(
      live('tenant', DISTRICT, 'lockdown'),
      districtAdmin,
    );
    const realFindUnique = w.client.tenant.findUnique;
    let staleReads = 0;
    w.client.tenant.findUnique = jest.fn(async (args: any) => {
      if (args?.select?.emergencyAlertId && staleReads === 0) {
        staleReads++;
        return { ...holdSnapshot };
      }
      return realFindUnique(args);
    });
    const auditBefore = w.auditLogs.length;

    const body = await expectAlertChanged(
      w.emergency.clearEmergency(
        hold.overrideId,
        clear('tenant', DISTRICT),
        districtAdmin,
      ),
    );
    expect(staleReads).toBe(1);
    expect(body.currentAlert).toMatchObject({
      alertId: lockdown.overrideId,
      type: 'LOCKDOWN',
    });

    // Nothing the all-clear built was committed — not the root, not the
    // schools, not a CLEAR_EMERGENCY row.
    for (const tid of [DISTRICT, SCHOOL, SIBLING]) {
      expect(w.tenants.get(tid)).toMatchObject({
        emergencyStatus: 'CRITICAL',
        emergencyType: 'LOCKDOWN',
        emergencyAlertId: lockdown.overrideId,
      });
    }
    const added = w.auditLogs.slice(auditBefore);
    expect(added.map((a) => a.action)).toEqual([CLEAR_REFUSED_ACTION]);
    expect(JSON.parse(added[0].details)).toMatchObject({
      stage: 'at-commit',
      requestedAlertId: hold.overrideId,
      currentAlertId: lockdown.overrideId,
    });
    // The pushed ALL_CLEAR only makes a screen re-read its manifest, and the
    // manifest still carries the Lockdown; the revision says an alert is up.
    expect(await emergencyMap(w)).toEqual(
      only(EVERY_SCREEN.filter((id) => !['other-1', 'stray'].includes(id))),
    );
    expect(localTenantEmergencyEpoch(DISTRICT)?.active).toBe(true);
  });
});

// ═══ 6. /emergency/active names the tenant-wide alert ═══════════════════════

describe('6. GET /emergency/active carries the tenant-wide alert’s id and raise time', () => {
  it('returns the id the trigger answered with, so the overlay and /panic can send it back', async () => {
    const w = makeWorld();
    const res: any = await w.emergency.triggerEmergency(
      live('tenant', SCHOOL, 'hold'),
      schoolAdmin,
    );
    const { alerts } = (await w.emergency.activeAlerts(schoolAdmin)) as any;
    const tenantWide = alerts.find((a: any) => a.scopeType === 'tenant');
    expect(tenantWide).toMatchObject({
      alertId: res.overrideId,
      scopeId: SCHOOL,
      type: 'HOLD',
    });
    expect(typeof tenantWide.triggeredAt).toBe('string');
    expect(Number.isNaN(Date.parse(tenantWide.triggeredAt))).toBe(false);
  });

  it('an alert from before alert identity still lists, with alertId null', async () => {
    const w = makeWorld();
    await w.emergency.triggerEmergency(live('tenant', SCHOOL), schoolAdmin);
    Object.assign(w.tenants.get(SCHOOL)!, {
      emergencyAlertId: null,
      emergencyTriggeredAt: null,
    });
    const { alerts } = (await w.emergency.activeAlerts(schoolAdmin)) as any;
    expect(alerts.find((a: any) => a.scopeType === 'tenant')).toMatchObject({
      alertId: null,
      triggeredAt: null,
    });
  });
});

// ── helpers ─────────────────────────────────────────────────────────────────

/**
 * Prisma statements are lazy (they run when awaited or when `$transaction`
 * runs them) and an array `$transaction` is all-or-nothing. The shared world
 * runs a write the moment it is built; this makes the writes the all-clear
 * batches lazy and the batch roll back on failure, so the race in section 5
 * is judged by the semantics production has (proved against Postgres in the
 * EMG-01 report).
 */
function makeWritesLazyAndTransactional(w: ReturnType<typeof makeWorld>) {
  const models: Array<[any, string[]]> = [
    [w.client.tenant, ['update', 'updateMany']],
    [w.client.auditLog, ['create']],
    [
      w.client.screenEmergencyOverride,
      ['upsert', 'update', 'updateMany', 'delete', 'deleteMany'],
    ],
  ];
  for (const [model, methods] of models) {
    for (const m of methods) {
      const eager = model[m];
      model[m] = (...args: any[]) => {
        let p: Promise<any> | null = null;
        const run = () => (p ??= eager(...args));
        return {
          then: (a: any, b: any) => run().then(a, b),
          catch: (b: any) => run().catch(b),
          finally: (f: any) => run().finally(f),
        };
      };
    }
  }
  w.client.$transaction = async (ops: any) => {
    if (typeof ops === 'function') return ops(w.client);
    const tenants = new Map([...w.tenants].map(([k, v]) => [k, { ...v }]));
    const overrides = new Map([...w.overrides].map(([k, v]) => [k, { ...v }]));
    const auditLen = w.auditLogs.length;
    try {
      const out: any[] = [];
      for (const op of ops) out.push(await op);
      return out;
    } catch (e) {
      w.tenants.clear();
      for (const [k, v] of tenants) w.tenants.set(k, v);
      w.overrides.clear();
      for (const [k, v] of overrides) w.overrides.set(k, v);
      w.auditLogs.length = auditLen;
      throw e;
    }
  };
}

/**
 * Every `tenant.update / updateMany / upsert` in the controller whose data
 * sets `emergencyStatus`, and whether that same data sets `emergencyAlertId`.
 * Data written through a variable (`data: clearedState`) is followed to the
 * object literal it was initialised with.
 */
function tenantStatusWrites(
  text: string,
): Array<{ line: number; setsAlertId: boolean }> {
  const sf = ts.createSourceFile(
    'emergency.controller.ts',
    text,
    ts.ScriptTarget.Latest,
    true,
  );
  const unwrap = (n: ts.Expression): ts.Expression => {
    let e = n;
    while (
      ts.isAsExpression(e) ||
      ts.isParenthesizedExpression(e) ||
      ts.isNonNullExpression(e)
    )
      e = e.expression;
    return e;
  };
  const literals = new Map<string, ts.ObjectLiteralExpression[]>();
  const collect = (n: ts.Node): void => {
    if (
      ts.isVariableDeclaration(n) &&
      ts.isIdentifier(n.name) &&
      n.initializer
    ) {
      const init = unwrap(n.initializer);
      if (ts.isObjectLiteralExpression(init))
        literals.set(n.name.text, [...(literals.get(n.name.text) ?? []), init]);
    }
    ts.forEachChild(n, collect);
  };
  collect(sf);
  const names = (root: ts.Node, prop: string): boolean => {
    const followed = new Set<string>();
    let found = false;
    const walk = (n: ts.Node): void => {
      if (found) return;
      if (
        ts.isPropertyAssignment(n) &&
        n.name.getText(sf).replace(/['"]/g, '') === prop
      ) {
        // A `select: { emergencyStatus: true }` is a read, not a write.
        const v = unwrap(n.initializer);
        if (v.kind !== ts.SyntaxKind.TrueKeyword) {
          found = true;
          return;
        }
      }
      if (ts.isIdentifier(n) && literals.has(n.text) && !followed.has(n.text)) {
        followed.add(n.text);
        for (const lit of literals.get(n.text) ?? []) walk(lit);
      }
      ts.forEachChild(n, walk);
    };
    walk(root);
    return found;
  };
  const out: Array<{ line: number; setsAlertId: boolean }> = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      /(^|\.)tenant\.(update|updateMany|upsert)$/.test(
        node.expression.getText(sf).replace(/\s+/g, ''),
      )
    ) {
      const arg = node.arguments[0] ? unwrap(node.arguments[0]) : undefined;
      if (arg && ts.isObjectLiteralExpression(arg)) {
        const data = arg.properties.find(
          (p) => p.name && ['data', 'update'].includes(p.name.getText(sf)),
        );
        if (data && names(data, 'emergencyStatus')) {
          out.push({
            line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
            setsAlertId: names(data, 'emergencyAlertId'),
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}
