/**
 * Names for the owner's fleet alarms (2026-10-23): screen → location →
 * organisation, through the customer alerts' own tenant loader (one walk of
 * the hierarchy, not two). A label that cannot be resolved falls back to ids —
 * an alarm is never dropped for want of a name.
 */
import type { CustomerAlertEmailsService } from '../customer-alerts/customer-alert-emails.service';
import type { ScreenLabel } from './fleet-alarm-copy';

export async function labelScreens(
  alerts: CustomerAlertEmailsService | undefined,
  rows: ReadonlyArray<{ id: string; name: string; tenantId: string | null }>,
): Promise<Map<string, ScreenLabel>> {
  const out = new Map<string, ScreenLabel>();
  let tenants: Awaited<ReturnType<CustomerAlertEmailsService['loadTenants']>> | null = null;
  const ids = [...new Set(rows.map((r) => r.tenantId).filter((t): t is string => !!t))];
  if (alerts && ids.length) {
    try {
      tenants = await alerts.loadTenants(ids);
    } catch {
      tenants = null;
    }
  }
  for (const r of rows) {
    const tid = r.tenantId;
    const rootId = tid && tenants && alerts ? alerts.rootOf(tid, tenants) : tid;
    const orgName = (rootId && tenants?.get(rootId)?.name) || rootId || '—';
    const locationName = (tid && tenants?.get(tid)?.name) || null;
    out.set(r.id, { id: r.id, name: r.name || r.id, orgName, locationName });
  }
  return out;
}
