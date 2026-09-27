/**
 * cache-report.ts — the ONE shape `Screen.lastCacheReport` is ever written in
 * (2026-09-27, download visibility).
 *
 * Two routes write that column: the unified telemetry POST (every current
 * player) and the legacy `POST /screens/:id/cache-status` (bundles from before
 * 2026-09-02). Until today the legacy route stored its request body AS SENT —
 * any JSON a device cared to post, straight into a column the fleet list hands
 * to every dashboard poll. That did not matter while the dashboard only read
 * two counters out of it. It matters now that the dashboard also reads a
 * download snapshot and prints its file name, so both routes rebuild the
 * report field by field here and nothing else is ever stored.
 *
 * Shape:
 *   playlist / emergency — two non-negative ints each (unchanged)
 *   downloading          — the large file the player is downloading RIGHT
 *                          NOW, present only while it is. A LIVENESS-GRADE
 *                          fact, never a render proof (player rule 5): it
 *                          proves the page's JS runs and bytes arrive, never
 *                          that a frame was painted.
 */

/** Longest file name kept. The player sends the last URL path segment. */
export const DOWNLOAD_FILE_MAX_CHARS = 120;

export interface CacheTierReport {
  count: number;
  bytes: number;
}

export interface DownloadingReport {
  /** The file's name as the player sees it (last path segment), bounded. */
  file: string;
  bytesLoaded: number;
  /** Null when the player has not learnt the file's size yet. */
  bytesTotal: number | null;
  /**
   * TRUE while a NEW playlist is held back and the previous content stays on
   * glass until one of its files is complete (readiness-gated playback,
   * CLAUDE.md player rule 17). False: nothing of the new content was
   * waiting on it (first boot, or a file downloading behind items that play).
   */
  deferredCommit: boolean;
}

export interface CacheReport {
  playlist?: CacheTierReport;
  emergency?: CacheTierReport;
  downloading?: DownloadingReport;
}

const safeInt = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0
    ? Math.min(Math.floor(v), Number.MAX_SAFE_INTEGER)
    : null;

/** Clamp a cache tier to two non-negative ints; never store raw client JSON. */
export function sanitizeTier(tier: unknown): CacheTierReport | undefined {
  if (!tier || typeof tier !== 'object' || Array.isArray(tier))
    return undefined;
  const t = tier as Record<string, unknown>;
  return { count: safeInt(t.count) ?? 0, bytes: safeInt(t.bytes) ?? 0 };
}

// C0 + C1 control characters (and DEL). A file name is data an operator reads;
// nothing that moves a cursor or rings a bell belongs in it.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;

/**
 * Rebuild the download snapshot field by field. `null` = nothing worth
 * storing (absent, not an object, or no usable byte count) — the report is
 * then written WITHOUT a snapshot, which the dashboard reads as "not
 * downloading", never as an error.
 */
export function sanitizeDownloadingReport(
  raw: unknown,
): DownloadingReport | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const d = raw as Record<string, unknown>;
  const loaded = safeInt(d.bytesLoaded);
  if (loaded === null) return null;
  const totalRaw = safeInt(d.bytesTotal);
  const bytesTotal = totalRaw !== null && totalRaw > 0 ? totalRaw : null;
  const file =
    typeof d.file === 'string'
      ? d.file
          .replace(CONTROL_CHARS, '')
          .trim()
          .slice(0, DOWNLOAD_FILE_MAX_CHARS)
      : '';
  return {
    file,
    // A count past the file's own size is a client bug, and the dashboard
    // divides the two — never let it print "112 %".
    bytesLoaded: bytesTotal !== null ? Math.min(loaded, bytesTotal) : loaded,
    bytesTotal,
    deferredCommit: d.deferredCommit === true,
  };
}

/**
 * The report as stored. Tiers keep their existing representation exactly
 * (an absent tier stays absent), so every report that carries no download
 * serializes byte-for-byte as it did before this change — the write
 * debounce keyed on that serialization keeps coalescing the fleet's
 * identical reports.
 */
export function sanitizeCacheReport(raw: unknown): CacheReport {
  const r =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const report: CacheReport = {
    playlist: sanitizeTier(r.playlist),
    emergency: sanitizeTier(r.emergency),
  };
  const downloading = sanitizeDownloadingReport(r.downloading);
  if (downloading) report.downloading = downloading;
  return report;
}
