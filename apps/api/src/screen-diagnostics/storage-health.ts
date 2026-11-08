/**
 * Storage health (2026-11-08, inventory #6) — free and total disk, a cheap
 * write test, the WebView origin quota (the FUH43's ~160 MB), and a
 * READ-ONLY look at the emergency tier of the offline cache.
 *
 * TWO HALVES, ONE ROW (`screen_storage_health`, never the hot `screens` row):
 *   • native — the Android disk, from the native status heartbeat's
 *     `x-venueos-storage` header. The player attaches it at most every
 *     30 minutes (`StorageHealthProbe.kt`), so the heartbeat stays light.
 *   • page   — the origin quota and the emergency tier, which only the
 *     WebView can see (`navigator.storage.estimate`, the service worker's
 *     STATUS reply), posted by the page every 30 minutes to
 *     `POST /screens/:id/storage-health`.
 *
 * THE EMERGENCY TIER IS NEVER TOUCHED. The page reads the service worker's
 * existing STATUS reply (counts and bytes); nothing here evicts, rewrites or
 * re-downloads anything, on the device or off it.
 *
 * THE PRE-DEGRADATION WARNING. A screen close to full gets "Storage almost
 * full: new content may not download" — in the screen drawer, and once a
 * day at most as a bell notification (the existing NotificationsService, a
 * dashboard surface). It is never an email: customer alert email is the
 * owner's no-false-positive channel and this signal has not earned it.
 * Kill switch: SCREEN_STORAGE_WARNINGS_DISABLED=1 — no grade, no
 * notification; the raw numbers stay readable.
 */
import { Logger } from '@nestjs/common';
import { Prisma } from '@cms/database';
import type { PrismaService } from '../prisma/prisma.service';
import type { NotificationsService } from '../notifications/notifications.service';

export const STORAGE_HEADER = 'x-venueos-storage';

const MiB = 1024 * 1024;
const GiB = 1024 * MiB;

export const STORAGE_RULES = {
  DISK_CRITICAL_BYTES: 256 * MiB,
  DISK_CRITICAL_RATIO: 0.02,
  DISK_LOW_BYTES: 1 * GiB,
  DISK_LOW_RATIO: 0.05,
  ORIGIN_LOW_RATIO: 0.9,
  ORIGIN_CRITICAL_RATIO: 0.97,
  /** A half older than this no longer counts toward the grade. */
  STALE_MS: 6 * 60 * 60_000,
} as const;

export type StorageWarning = 'almost-full' | 'critical' | null;

export interface NativeStorage {
  freeBytes: number;
  totalBytes: number;
  writeOk: boolean | null;
  writeMs: number | null;
}

export interface PageStorage {
  origin: { usage: number; quota: number } | null;
  emergency: { readable: boolean; entries: number | null; bytes: number | null } | null;
}

const n = (v: unknown, max = Number.MAX_SAFE_INTEGER): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max ? Math.round(v) : null;

/** The header, or null for anything this version cannot read (an older player sends none). */
export function parseNativeStorage(raw: unknown): NativeStorage | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 512) return null;
  let v: any;
  try { v = JSON.parse(raw); } catch { return null; }
  if (!v || typeof v !== 'object' || v.schema !== 1) return null;
  const free = n(v.freeBytes);
  const total = n(v.totalBytes);
  if (free === null || total === null || total === 0 || free > total) return null;
  return {
    freeBytes: free,
    totalBytes: total,
    writeOk: typeof v.writeOk === 'boolean' ? v.writeOk : null,
    writeMs: n(v.writeMs, 600_000),
  };
}

export function parsePageStorage(body: unknown): PageStorage | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const b = body as Record<string, any>;
  const usage = n(b.origin?.usage);
  const quota = n(b.origin?.quota);
  const origin = usage !== null && quota !== null && quota > 0 ? { usage, quota } : null;
  const emergency = b.emergency && typeof b.emergency === 'object' && typeof b.emergency.readable === 'boolean'
    ? { readable: b.emergency.readable, entries: n(b.emergency.entries, 100_000), bytes: n(b.emergency.bytes) }
    : null;
  return origin || emergency ? { origin, emergency } : null;
}

export function storageWarningsDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return ['1', 'true', 'yes'].includes(String(env.SCREEN_STORAGE_WARNINGS_DISABLED ?? '').trim().toLowerCase());
}

/** Pure grade over whichever halves are fresh. */
export function gradeStorage(input: {
  native: NativeStorage | null;
  nativeAt: Date | null;
  page: PageStorage | null;
  pageAt: Date | null;
  nowMs: number;
}): StorageWarning {
  const fresh = (at: Date | null) => !!at && input.nowMs - at.getTime() <= STORAGE_RULES.STALE_MS;
  let worst: StorageWarning = null;
  const raise = (w: Exclude<StorageWarning, null>) => {
    if (w === 'critical' || worst === null) worst = w;
  };
  const d = fresh(input.nativeAt) ? input.native : null;
  if (d) {
    const ratio = d.freeBytes / d.totalBytes;
    if (d.writeOk === false || d.freeBytes < STORAGE_RULES.DISK_CRITICAL_BYTES || ratio < STORAGE_RULES.DISK_CRITICAL_RATIO) raise('critical');
    else if (d.freeBytes < STORAGE_RULES.DISK_LOW_BYTES || ratio < STORAGE_RULES.DISK_LOW_RATIO) raise('almost-full');
  }
  const o = fresh(input.pageAt) ? input.page?.origin : null;
  if (o) {
    const ratio = o.usage / o.quota;
    if (ratio >= STORAGE_RULES.ORIGIN_CRITICAL_RATIO) raise('critical');
    else if (ratio >= STORAGE_RULES.ORIGIN_LOW_RATIO) raise('almost-full');
  }
  return worst;
}

/** Notify on a rise only: null → almost-full, or anything → critical from below. */
export function shouldNotify(before: StorageWarning, after: StorageWarning): boolean {
  if (after === null) return false;
  if (before === null) return true;
  return before === 'almost-full' && after === 'critical';
}

/** The bell's sentences. `notificationCopy.ts` (web) recognises and translates both. */
export const storageNotice = (screenName: string) => ({
  title: `Storage almost full: ${screenName}`,
  body: 'New content may not download. Remove unused media from its playlists or free space on the device.',
});

const logger = new Logger('ScreenStorageHealth');

/**
 * The bell, for callers that hold no NotificationsService of their own — the
 * native heartbeat route (`ScreensController.deviceStatus`) takes no new
 * dependency for this. `ScreenDiagnosticsService` registers the app's one
 * instance at construction. Unregistered (a hand-built spec) = no bell.
 */
let registeredNotifier: Pick<NotificationsService, 'notify'> | null = null;
export function registerStorageNotifier(n: Pick<NotificationsService, 'notify'> | null): void {
  registeredNotifier = n;
}

/**
 * Store one half and regrade. Never throws: a storage report must never cost
 * the heartbeat or the page anything. Returns the new warning (or undefined
 * on a fault).
 */
export async function recordStorageHealth(
  deps: { prisma: PrismaService; notifications?: Pick<NotificationsService, 'notify'> | null },
  screen: { id: string; tenantId: string; name?: string | null },
  half: { native: NativeStorage } | { page: PageStorage },
  now: Date = new Date(),
): Promise<StorageWarning | undefined> {
  try {
    const db = deps.prisma.client;
    // ten-ok: (a) tenant-constrained — the row is keyed by the device-proven screen and filtered by its live tenant.
    const prev = await db.screenStorageHealth.findFirst({ where: { screenId: screen.id, tenantId: screen.tenantId } });
    const native = 'native' in half ? half.native : ((prev?.native as unknown as NativeStorage | null) ?? null);
    const nativeAt = 'native' in half ? now : prev?.nativeAt ?? null;
    const page = 'page' in half ? half.page : ((prev?.page as unknown as PageStorage | null) ?? null);
    const pageAt = 'page' in half ? now : prev?.pageAt ?? null;
    const disabled = storageWarningsDisabled();
    const warning = disabled ? null : gradeStorage({ native, nativeAt, page, pageAt, nowMs: now.getTime() });
    const before = (prev?.warning as StorageWarning) ?? null;
    const notifier = deps.notifications ?? registeredNotifier;
    const notify = !disabled && shouldNotify(before, warning) && !!notifier;

    const data = {
      tenantId: screen.tenantId,
      ...('native' in half ? { native: half.native as any, nativeAt: now } : {}),
      ...('page' in half ? { page: half.page as any, pageAt: now } : {}),
      warning,
      ...(notify ? { warnedAt: now } : {}),
    };
    if (prev && prev.tenantId === screen.tenantId) {
      await db.screenStorageHealth.updateMany({ where: { screenId: screen.id, tenantId: screen.tenantId }, data });
    } else {
      // A row filed under a previous organisation (a re-paired screen) is
      // replaced, never merged: the old tenant's numbers do not follow the hardware.
      // ten-ok: (b) identity-derived — the device credential proved this screen id; the stale row is re-filed under the screen's current tenant.
      await db.screenStorageHealth.upsert({
        where: { screenId: screen.id },
        create: { screenId: screen.id, ...data },
        update: { ...data, ...('native' in half ? { page: Prisma.DbNull, pageAt: null } : { native: Prisma.DbNull, nativeAt: null }), warnedAt: notify ? now : null },
      });
    }
    if (notify) {
      const day = now.toISOString().slice(0, 10);
      const copy = storageNotice(screen.name || 'Screen');
      await notifier!.notify({
        tenantId: screen.tenantId,
        kind: 'INFO',
        title: copy.title,
        body: copy.body,
        link: '/screens',
        dedupeKey: `storage-low:${screen.id}:${day}`,
      });
    }
    return warning;
  } catch (e) {
    logger.warn(`storage health for ${screen.id} not recorded: ${(e as Error).message}`);
    return undefined;
  }
}
