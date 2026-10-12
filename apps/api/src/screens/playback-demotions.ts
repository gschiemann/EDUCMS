/**
 * The manifest's read of `screen_playback_demotions` (video guarantee, owner
 * decision A, 2026-10-12).
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

export async function loadDemotedSources(
  db: DemotionReadDb,
  screenId: string,
  tenantId: string | null,
): Promise<ReadonlySet<string>> {
  if (!tenantId || !db?.screenPlaybackDemotion) return new Set();
  try {
    const rows = await db.screenPlaybackDemotion.findMany({
      where: { screenId, tenantId, clearedAt: null },
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
