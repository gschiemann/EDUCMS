/**
 * One screen's playback capability profile, loaded from the database — shared
 * by the read-only endpoint (`GET /screens/:id/playback-capability`) and the
 * publish gate (video guarantee step 5), so the two can never disagree.
 *
 * Reads: this screen's own `screen_file_playback` rows (tenant-scoped), its
 * declared WebView capability, and same-model evidence from OTHER screens as
 * SQL AGGREGATES only — what leaves the database is a handful of (verdict,
 * short edge, alone/with company, newest date) groups and one distinct-screen
 * count, never a row, screen id, file, name or tenant from another location.
 *
 * Never evaluated for emergency content (the callers skip it).
 */

import {
  computePlaybackCapability,
  playbackDeviceClass,
  type CapabilityRecordInput,
  type MediaCapsReport,
  type PlaybackCapability,
} from '@cms/api-types';

/** The newest files read per screen. */
export const PLAYBACK_FILES_LIMIT = 20;
/** Upper bound on the aggregate groups read for class evidence (verdict × short edge × alone/with company). */
export const PLAYBACK_CLASS_GROUPS_LIMIT = 200;

export interface CapabilityScreen {
  id: string;
  tenantId: string;
  playerVersionCode: number | null;
  displayCapabilities: any;
}

export interface LoadedPlaybackCapability {
  capability: PlaybackCapability;
  rows: any[];
  capsRow: any | null;
  declared: MediaCapsReport | null;
  deviceClass: string | null;
}

export type ClassEvidence = { classRecords: CapabilityRecordInput[]; classScreenCount: number };

/** Same-model evidence from other screens, as SQL aggregates only. */
export async function loadClassEvidence(db: any, deviceClass: string, excludeScreenId: string): Promise<ClassEvidence> {
  const groups = await db.$queryRaw`
      WITH c AS (
        SELECT screen_id, verdict, LEAST(width, height) AS se, unit_concurrent_max AS u, last_at
        FROM screen_file_playback
        WHERE device_class = ${deviceClass}
          AND screen_id <> ${excludeScreenId}
          AND verdict IN ('smooth', 'stuttering')
          AND width IS NOT NULL AND height IS NOT NULL
      )
      SELECT verdict, se, max(u)::int AS unit, max(last_at) AS at,
             (SELECT count(DISTINCT screen_id)::int FROM c) AS screens
      FROM c
      GROUP BY verdict, se, (u > 1)
      LIMIT ${PLAYBACK_CLASS_GROUPS_LIMIT}`;
  const list: Array<{ verdict: string; se: number | null; unit: number | null; at: Date | null; screens: number | bigint | null }> =
    Array.isArray(groups) ? groups : [];
  return {
    classScreenCount: list.length ? Number(list[0].screens ?? 0) : 0,
    classRecords: list.map((g, i) => ({
      screenId: `class-${i}`,
      width: g.se ?? null,
      height: g.se ?? null,
      verdict: g.verdict === 'stuttering' ? 'stuttering' : 'smooth',
      unitConcurrentMax: Number(g.unit ?? 1) || 1,
      lastAt: g.at ?? new Date(0),
    })),
  };
}

export async function loadPlaybackCapability(
  db: any,
  screen: CapabilityScreen,
  opts: { classCache?: Map<string, Promise<ClassEvidence>> } = {},
): Promise<LoadedPlaybackCapability> {
  const tenantId = screen.tenantId;
  const rows: any[] = await db.screenFilePlayback.findMany({
    where: { screenId: screen.id, tenantId },
    orderBy: { lastAt: 'desc' },
    take: PLAYBACK_FILES_LIMIT,
  });
  const capsRow = await db.screenMediaCapabilities.findFirst({ where: { screenId: screen.id, tenantId } });
  const declared = (capsRow?.report ?? null) as MediaCapsReport | null;

  const deviceClass: string | null =
    rows.find((r) => typeof r.deviceClass === 'string' && r.deviceClass)?.deviceClass ??
    playbackDeviceClass(screen.displayCapabilities?.build ?? null);

  let classEvidence: ClassEvidence = { classRecords: [], classScreenCount: 0 };
  if (deviceClass) {
    // The cache key carries the excluded screen: class evidence never counts
    // the screen it is describing.
    const key = `${deviceClass}|${screen.id}`;
    const cached = opts.classCache?.get(key);
    const p = cached ?? loadClassEvidence(db, deviceClass, screen.id);
    if (!cached) opts.classCache?.set(key, p);
    classEvidence = await p;
  }

  const toInput = (r: any): CapabilityRecordInput => ({
    screenId: r.screenId,
    width: r.width ?? null,
    height: r.height ?? null,
    verdict: r.verdict,
    unitConcurrentMax: Number(r.unitConcurrentMax ?? 1) || 1,
    lastAt: r.lastAt,
    playerVersionCode: r.playerVersionCode ?? null,
    webviewMajor: r.webviewMajor ?? null,
  });
  const currentWebview: number | null = rows[0]?.webviewMajor ?? capsRow?.webviewMajor ?? null;
  const capability = computePlaybackCapability({
    deviceClass,
    screenRecords: rows.map(toInput),
    classRecords: classEvidence.classRecords,
    classScreenCount: classEvidence.classScreenCount,
    declared,
    current: { playerVersionCode: screen.playerVersionCode ?? null, webviewMajor: currentWebview },
  });
  return { capability, rows, capsRow, declared, deviceClass };
}
