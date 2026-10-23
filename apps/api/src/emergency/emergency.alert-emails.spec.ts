/**
 * Customer alert emails on the emergency paths (2026-10-23) — against the
 * real controller and the shared world of emergency.targeting.spec.ts.
 *
 * The record copy of a trigger / all-clear is FIRE AND FORGET:
 *   1. it is queued AFTER the action's own audit row;
 *   2. a mailer that throws synchronously, rejects, or never answers changes
 *      nothing about the alert, its all-clear, or their audit rows;
 *   3. it carries the alert's reach: every affected tenant (a district alert:
 *      the district and its schools), the type, drill or not.
 */
import { EmergencyController } from './emergency.controller';
import { invalidateTenantState, resetManifestCacheForTests } from '../screens/manifest-hot-cache';
import { resetEmergencyRevForTests } from '../screens/emergency-rev';
import { CustomerAlertEmailsService } from '../notifications/customer-alerts/customer-alert-emails.service';
import { DISTRICT, SCHOOL, SIBLING, OTHER, GYM, makeWorld, schoolAdmin, districtAdmin, trigger, clear } from './emergency.targeting.world';

const flush = async () => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r));
};

function build(alertEmails: any) {
  const w = makeWorld();
  const order: string[] = [];
  const audit = w.client.auditLog.create;
  w.client.auditLog.create = jest.fn(async (args: any) => {
    order.push(`audit:${args.data.action}`);
    return audit(args);
  });
  const emergency = new EmergencyController(
    w.redis,
    { client: w.client } as any,
    { signMessage: jest.fn((type: string, payload: any) => ({ type, payload, signature: 'sig', timestamp: Date.now() })) } as any,
    { dispatch: jest.fn() } as any,
    { driveStatusLampForEmergency: jest.fn(async () => ({ touched: 0 })) } as any,
    undefined,
    alertEmails,
  );
  return { w, order, emergency };
}

const ENV = { ...process.env };
beforeEach(() => {
  process.env = { ...ENV };
  delete process.env.CUSTOMER_ALERT_EMAILS_DISABLED;
  resetManifestCacheForTests();
  resetEmergencyRevForTests('origin-alert-emails');
  for (const id of [DISTRICT, SCHOOL, SIBLING, OTHER]) invalidateTenantState(id);
});
afterAll(() => {
  process.env = ENV;
});

describe('emergency record copy — queued after the action, never in its way', () => {
  it('is queued after the trigger / all-clear audit rows, with the alert reach', async () => {
    const calls: any[] = [];
    const { order, emergency } = build({
      recordEmergency: (input: any) => {
        order.push(`email:${input.event}`);
        calls.push(input);
      },
    });
    const res: any = await emergency.triggerEmergency(trigger('tenant', DISTRICT, 'weather'), districtAdmin);
    await emergency.clearEmergency(res.overrideId, clear('tenant', DISTRICT), districtAdmin);
    // A district alert writes one audit row per tenant; the copy comes after ALL of them.
    expect(order.indexOf('email:TRIGGERED')).toBeGreaterThan(order.lastIndexOf('audit:TRIGGER_EMERGENCY'));
    expect(order.indexOf('email:TRIGGERED')).toBeLessThan(order.indexOf('audit:CLEAR_EMERGENCY'));
    expect(order.indexOf('email:CLEARED')).toBe(order.length - 1);
    expect(order.filter((o) => o.startsWith('email:'))).toEqual(['email:TRIGGERED', 'email:CLEARED']);
    expect(calls[0]).toMatchObject({ event: 'TRIGGERED', overrideId: res.overrideId, alertType: 'WEATHER', isDrill: false });
    expect([...calls[0].tenantIds].sort()).toEqual([DISTRICT, SCHOOL, SIBLING].sort());
    expect(calls[1]).toMatchObject({ event: 'CLEARED', overrideId: res.overrideId, isDrill: false });
  });

  it('group scope: the owning school, with the screen count', async () => {
    const calls: any[] = [];
    const { emergency } = build({ recordEmergency: (i: any) => calls.push(i) });
    await emergency.triggerEmergency(trigger('group', GYM, 'hold'), schoolAdmin);
    expect(calls[0]).toMatchObject({ event: 'TRIGGERED', alertType: 'HOLD', tenantIds: [SCHOOL], screenCount: 2 });
  });

  it('a mailer that THROWS synchronously changes nothing about the alert or its all-clear', async () => {
    const { w, emergency } = build({
      recordEmergency: () => {
        throw new Error('mailer exploded');
      },
    });
    const res: any = await emergency.triggerEmergency(trigger('tenant', SCHOOL), schoolAdmin);
    expect(res).toMatchObject({ success: true, affectedTenantIds: [SCHOOL] });
    expect(w.tenants.get(SCHOOL)).toMatchObject({ emergencyStatus: 'CRITICAL' });
    const cleared: any = await emergency.clearEmergency(res.overrideId, clear('tenant', SCHOOL), schoolAdmin);
    expect(cleared).toMatchObject({ success: true });
    expect(w.tenants.get(SCHOOL)).toMatchObject({ emergencyStatus: 'INACTIVE' });
    expect(w.auditLogs.map((a: any) => a.action)).toEqual(['TRIGGER_EMERGENCY', 'CLEAR_EMERGENCY']);
  });

  it('the REAL service with a database that rejects or never answers: the trigger still completes, nothing awaited', async () => {
    for (const fail of [async () => { throw new Error('pool timeout'); }, () => new Promise(() => undefined)]) {
      const prisma = {
        client: new Proxy({}, { get: () => new Proxy({}, { get: () => jest.fn(fail) }) }),
      } as any;
      const service = new CustomerAlertEmailsService(prisma, undefined, { sendAlert: jest.fn(fail) } as any);
      const spy = jest.spyOn(service, 'sendEmergencyRecord');
      const { w, emergency } = build(service);
      const started = Date.now();
      const res: any = await emergency.triggerEmergency(trigger('tenant', SCHOOL), schoolAdmin);
      expect(res).toMatchObject({ success: true });
      expect(Date.now() - started).toBeLessThan(2_000);
      // Not even started yet when the trigger returned: it runs on a later turn.
      expect(spy).not.toHaveBeenCalled();
      await flush();
      expect(spy).toHaveBeenCalledTimes(1);
      expect(w.auditLogs.map((a: any) => a.action)).toEqual(['TRIGGER_EMERGENCY']);
    }
  });

  it('the kill switch: CUSTOMER_ALERT_EMAILS_DISABLED=1 queues nothing', async () => {
    process.env.CUSTOMER_ALERT_EMAILS_DISABLED = '1';
    const service = new CustomerAlertEmailsService({ client: {} } as any);
    const spy = jest.spyOn(service, 'sendEmergencyRecord');
    const { emergency } = build(service);
    await emergency.triggerEmergency(trigger('tenant', SCHOOL), schoolAdmin);
    await flush();
    expect(spy).not.toHaveBeenCalled();
  });
});
