/**
 * The manifest's read of `screen_playback_demotions` (video guarantee, owner
 * decision A, 2026-10-12).
 *
 * A demotion EXPIRES (2026-10-31): it is evidence about one engine/firmware/
 * APK on one day, and the original file's digest does not change when an
 * operator re-pushes the same video, so a never-expiring row kept a 4K panel
 * on the 1080p copy for weeks after the player had been fixed. After
 * `VIDEO_DEMOTION_TTL_HOURS` (default 72; `0` = never expire) the manifest
 * names the original again; three fresh BAD minutes demote it again.
 *
 * The normal-content manifest branch asks, once per rebuild, which ORIGINAL
 * files this screen has been moved off; `selectVideoFile` then serves their
 * validated 1080p copy. Rules:
 *   • Normal branch only. The emergency and sports branches never call this.
 *   • Tenant-scoped to the screen's own live row.
 *   • Never fails a manifest: a read that fails (pool blip, an old mock in a
 *     spec) answers "no demotions" — the exact pre-feature selection.
 *   • The model is manifest-fed (manifest-hot-cache.ts), so a demotion write
 *     or an operator's "Try full quality again" busts the cached manifest.
 */

/** Narrow Prisma surface — kept small so specs can fake it. */
export interface DemotionReadDb {
  screenPlaybackDemotion?: {
    findMany(args: any): Promise<Array<{ sourceSha256: string }>>;
  };
}

/** Bound on active demotions read per screen (a screen plays a handful of files). */
export const DEMOTIONS_PER_SCREEN_LIMIT = 200;

export const DEMOTION_TTL_HOURS_DEFAULT = 72;

/** Oldest `createdAt` a demotion may have and still apply; null = never expires. */
export function demotionExpiryCutoff(
  now: Date = new Date(),
  env: Record<string, string | undefined> = process.env,
): Date | null {
  const raw = (env.VIDEO_DEMOTION_TTL_HOURS ?? '').trim();
  const n = raw === '' ? DEMOTION_TTL_HOURS_DEFAULT : Number(raw);
  if (!Number.isFinite(n) || n < 0) return new Date(now.getTime() - DEMOTION_TTL_HOURS_DEFAULT * 3_600_000);
  if (n === 0) return null;
  return new Date(now.getTime() - n * 3_600_000);
}

export async function loadDemotedSources(
  db: DemotionReadDb,
  screenId: string,
  tenantId: string | null,
  now: Date = new Date(),
  env: Record<string, string | undefined> = process.env,
): Promise<ReadonlySet<string>> {
  if (!tenantId || !db?.screenPlaybackDemotion) return new Set();
  try {
    const rows = await db.screenPlaybackDemotion.findMany({
      where: {
        screenId,
        tenantId,
        clearedAt: null,
        ...(demotionExpiryCutoff(now, env) ? { createdAt: { gt: demotionExpiryCutoff(now, env) } } : {}),
      },
      select: { sourceSha256: true },
      take: DEMOTIONS_PER_SCREEN_LIMIT,
    });
    return new Set(
      (Array.isArray(rows) ? rows : [])
        .map((r) => (typeof r?.sourceSha256 === 'string' ? r.sourceSha256.toLowerCase() : ''))
        .filter((s) => /^[0-9a-f]{64}$/.test(s)),
    );
  } catch {
    return new Set();
  }
}
