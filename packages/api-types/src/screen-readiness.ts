/**
 * Screen readiness — `Asset.processingMeta.screen`, the ONE record of whether
 * the file a video asset SERVES is something every signage player decodes
 * (2026-10-04 compatibility-before-size; 2026-10-05 the screen-ready gate).
 *
 * What "screen-safe" means is decided in exactly one place on the API:
 * `screenCompatibilityIssues` (apps/api/src/storage/video-transcode/
 * transcode-profile.ts). This module only carries that verdict: the API
 * WRITES it (at upload, from the upload check's own ffprobe, and from every
 * transcode outcome that learns something) and READS it (the normal manifest
 * leaves a not-ready video out); the dashboard READS it (Media Library,
 * playlist editor). Shared, so the screens and the dashboard can never
 * disagree about which videos are not playing and why.
 *
 * ── Shape (version 1) ─────────────────────────────────────────────────────
 *   { version: 1, ready: true,  convertedFrom?: issue[], checkedAt }
 *       every player decodes the served file (as uploaded, or converted from
 *       what `convertedFrom` names)
 *   { version: 1, ready: false, pending: true, issues: issue[], checkedAt }
 *       not screen-safe as uploaded; its conversion is queued or running
 *   { version: 1, ready: false, issues: issue[], error, checkedAt }
 *       not screen-safe, and the conversion failed or could not run
 *   absent
 *       UNKNOWN — a video from before the verdict existed, or one whose probe
 *       could not run. Unknown is delivered exactly as before; nobody invents
 *       a verdict.
 *
 * Every writer builds the whole object with `buildScreenStamp` and REPLACES
 * the key — a verdict is never merged into the one before it, so `pending`,
 * `error` or `issues` from an earlier stage can never survive into a later one.
 */

export const SCREEN_STAMP_VERSION = 1 as const;

/** What a writer knows. `pending` is meaningful only when `ready` is false. */
export interface ScreenVerdictInput {
  ready: boolean;
  pending?: boolean;
  issues?: readonly string[];
  convertedFrom?: readonly string[];
  error?: string | null;
}

/** The JSON written into `processingMeta.screen`. */
export interface ScreenStampJson {
  version: typeof SCREEN_STAMP_VERSION;
  ready: boolean;
  pending?: true;
  issues?: string[];
  convertedFrom?: string[];
  error?: string;
  checkedAt: string;
}

/** `error` is a short machine reason (a job outcome code), never a log. */
export const SCREEN_STAMP_ERROR_MAX = 160;

/** The one builder every writer uses (upload, every transcode outcome). Pure. */
export function buildScreenStamp(v: ScreenVerdictInput, nowMs: number): ScreenStampJson {
  const issues = cleanList(v.issues);
  const convertedFrom = cleanList(v.convertedFrom);
  return {
    version: SCREEN_STAMP_VERSION,
    ready: v.ready,
    ...(!v.ready && v.pending ? { pending: true as const } : {}),
    ...(issues.length ? { issues } : {}),
    ...(convertedFrom.length ? { convertedFrom } : {}),
    ...(v.error ? { error: String(v.error).slice(0, SCREEN_STAMP_ERROR_MAX) } : {}),
    checkedAt: new Date(nowMs).toISOString(),
  };
}

/** A stamp as a reader sees it — every field present, defaults filled. */
export interface ScreenStamp {
  ready: boolean;
  /** Not ready YET: its conversion is queued or running. Always false when `ready`. */
  pending: boolean;
  /** Why the file as uploaded is not screen-safe (`ScreenCompatibilityIssue` codes, or 'unreadable'). */
  issues: string[];
  /** What a successful conversion fixed. */
  convertedFrom: string[];
  /** Why the conversion failed / could not run (a job outcome code); null otherwise. */
  error: string | null;
  checkedAt: string | null;
}

/**
 * Read `processingMeta.screen`. Null when there is no stamp, or one this
 * version does not understand (wrong version, `ready` not a boolean) — i.e.
 * UNKNOWN, which every caller treats exactly as before the verdict existed.
 */
export function readScreenStamp(meta: unknown): ScreenStamp | null {
  if (!isRecord(meta)) return null;
  const s = meta.screen;
  if (!isRecord(s) || s.version !== SCREEN_STAMP_VERSION || typeof s.ready !== 'boolean') return null;
  return {
    ready: s.ready,
    pending: s.ready === false && s.pending === true,
    issues: cleanList(s.issues),
    convertedFrom: cleanList(s.convertedFrom),
    error: typeof s.error === 'string' && s.error ? s.error : null,
    checkedAt: typeof s.checkedAt === 'string' ? s.checkedAt : null,
  };
}

/** The slice of an asset row the gate reads. */
export interface ScreenGateAsset {
  mimeType?: string | null;
  processingMeta?: unknown;
}

/**
 * THE GATE (normal manifest only): is this asset a video whose served file is
 * stamped NOT ready — still converting, or failed to convert? Such an item is
 * left out of a screen's manifest. No stamp, an unreadable stamp, or
 * `ready: true` → false: delivered exactly as before. Never consulted by the
 * emergency or sports-scoreboard branches.
 */
export function withheldFromScreens(asset: ScreenGateAsset | null | undefined): boolean {
  if (!asset || typeof asset.mimeType !== 'string' || !asset.mimeType.toLowerCase().startsWith('video/')) {
    return false;
  }
  return readScreenStamp(asset.processingMeta)?.ready === false;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** Strings only, trimmed, de-duplicated, bounded — a stamp is a label, never a payload. */
function cleanList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    if (typeof x !== 'string') continue;
    const s = x.trim().slice(0, 64);
    if (s && !out.includes(s)) out.push(s);
    if (out.length >= 32) break;
  }
  return out;
}
