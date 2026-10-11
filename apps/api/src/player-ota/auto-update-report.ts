/**
 * What the dashboard shows about AUTOMATIC Player updates per screen
 * (2026-10-11): is the switch on (screen override, else org), can the screen
 * install silently, and in which window an automatic update would land.
 * Same decisions as the update-check gate (auto-update-policy.ts) — the
 * dashboard can never claim a screen will update that the server would hold.
 *
 * Every read is tenant-scoped (`tenantId` in each where).
 */
import {
  DEFAULT_AUTO_UPDATE_WINDOW,
  autoUpdateEnabledFor,
  isValidTimeZone,
  resolveAutoUpdateWindow,
  silentUpdateReadiness,
  type ResolvedWindow,
  type SilentReadinessResult,
} from './auto-update-policy';

export type AutoUpdateOverride = 'on' | 'off' | 'inherit';

export interface ScreenAutoUpdateRow {
  screenId: string;
  name: string;
  override: AutoUpdateOverride;
  enabled: boolean;
  enabledSource: 'screen' | 'org';
  readiness: SilentReadinessResult['readiness'];
  readinessReason: SilentReadinessResult['reason'];
  /** Null when no timezone is known — automatic updates then never run. */
  window: ResolvedWindow | null;
  /** True when every server rule for an unattended update is satisfiable. */
  willAutoUpdate: boolean;
  inventoryReportedAt: string | null;
}

export interface AutoUpdateReport {
  orgEnabled: boolean;
  orgWindow: { start: string | null; end: string | null; timezone: string | null };
  defaultWindow: { start: string; end: string };
  screens: ScreenAutoUpdateRow[];
}

export function overrideToMode(v: boolean | null | undefined): AutoUpdateOverride {
  return v === true ? 'on' : v === false ? 'off' : 'inherit';
}

export function modeToOverride(mode: unknown): boolean | null | undefined {
  if (mode === 'on') return true;
  if (mode === 'off') return false;
  if (mode === 'inherit') return null;
  return undefined;
}

/** Tenant-scoped report. `screenIds` narrows it to those screens (still within the tenant). */
export async function buildAutoUpdateReport(
  prisma: { client: any },
  tenantId: string,
  screenIds?: string[],
): Promise<AutoUpdateReport> {
  const db = prisma.client;
  const tenant = await db.tenant.findUnique({
    where: { id: tenantId },
    select: { autoUpdatePlayerEnabled: true, otaWindowStart: true, otaWindowEnd: true, otaWindowTimezone: true },
  });
  const screens: any[] = await db.screen.findMany({
    where: { tenantId, ...(screenIds ? { id: { in: screenIds } } : {}) },
    select: {
      id: true, name: true, playerVersionCode: true, screenGroupId: true,
      autoUpdatePlayerOverride: true,
    },
    orderBy: { name: 'asc' },
  });
  const ids = screens.map((s) => s.id);
  const inventories: any[] = ids.length
    ? await db.screenDeviceInventory.findMany({
        where: { tenantId, screenId: { in: ids } },
        select: { screenId: true, report: true, reportedAt: true },
      })
    : [];
  const invBy = new Map(inventories.map((r) => [r.screenId, r]));
  const needTz = !isValidTimeZone(tenant?.otaWindowTimezone);
  const schedules: any[] = needTz && ids.length
    ? await db.displaySchedule.findMany({
        where: { tenantId, isActive: true },
        select: { screenId: true, screenGroupId: true, timezone: true },
      })
    : [];

  const rows = screens.map((s): ScreenAutoUpdateRow => {
    const inv = invBy.get(s.id);
    const ready = silentUpdateReadiness(inv?.report ?? null, s.playerVersionCode);
    const sw = autoUpdateEnabledFor(tenant?.autoUpdatePlayerEnabled, s.autoUpdatePlayerOverride);
    let scheduleTimezone: string | null = null;
    if (needTz) {
      const own = schedules.find((r) => r.screenId === s.id && isValidTimeZone(r.timezone));
      const grp = s.screenGroupId
        ? schedules.find((r) => r.screenGroupId === s.screenGroupId && isValidTimeZone(r.timezone))
        : undefined;
      scheduleTimezone = (own ?? grp)?.timezone ?? null;
    }
    const window = resolveAutoUpdateWindow({
      orgStart: tenant?.otaWindowStart,
      orgEnd: tenant?.otaWindowEnd,
      orgTimezone: tenant?.otaWindowTimezone,
      scheduleTimezone,
    });
    return {
      screenId: s.id,
      name: s.name,
      override: overrideToMode(s.autoUpdatePlayerOverride),
      enabled: sw.enabled,
      enabledSource: sw.source,
      readiness: ready.readiness,
      readinessReason: ready.reason,
      window,
      willAutoUpdate: sw.enabled && ready.readiness === 'silent' && window !== null,
      inventoryReportedAt: inv?.reportedAt ? new Date(inv.reportedAt).toISOString() : null,
    };
  });

  return {
    orgEnabled: tenant?.autoUpdatePlayerEnabled === true,
    orgWindow: {
      start: tenant?.otaWindowStart ?? null,
      end: tenant?.otaWindowEnd ?? null,
      timezone: tenant?.otaWindowTimezone ?? null,
    },
    defaultWindow: { ...DEFAULT_AUTO_UPDATE_WINDOW },
    screens: rows,
  };
}
