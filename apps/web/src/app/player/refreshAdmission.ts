/**
 * refreshAdmission — may THIS reload interrupt what is on the glass?
 * (never-interrupt program, 2026-10-10)
 *
 * Greg's #1 player requirement: "playing content must NEVER be interrupted
 * unless someone changes it." Seen in the field several times: a screen
 * suddenly refreshes, shows the connecting page, then plays again. Every
 * automatic reload path in the player now asks this module first. Pure — no
 * React / DOM / network — so each decision is unit-tested without mounting
 * the 14k-line page (same pattern as `emergencyInterlock.ts`).
 *
 * Two questions, two functions:
 *
 *   1. `admitRefresh` — a REFRESH_WEB arrived (WS / SSE push, or the durable
 *      manifest `refreshRequestedAt`). An OPERATOR's refresh is always
 *      honoured: a person pressed Refresh / Resync and expects it. A SYSTEM
 *      refresh (the wedge detector, a rendition swap) was issued by a server
 *      that can only see telemetry; the player holds strictly better evidence
 *      about its own health. When it can PROVE it is healthy — content on
 *      glass, frames still painting, manifests still arriving, media not
 *      stalled — the reload would only tear down content a customer is
 *      looking at, and it is declined. When it cannot prove that, the reload
 *      happens exactly as before: a wedged manifest loop (the 2026-05-27 G43
 *      shape) has a stale `lastManifestOkAt`, a frozen compositor has a stale
 *      paint stamp, and both still get their recovery.
 *
 *   2. `bundleReloadIdle` — a newer web bundle is waiting (the 15-min
 *      build-info check). It may be picked up ONLY when nothing is on the
 *      glass: the splash phases, a screen with nothing scheduled, the
 *      "Content Unavailable" card. Never while content plays, never while a
 *      file is downloading or loading (a reload would restart it), never on
 *      an operator-paused screen (a reload would un-pause it), never during
 *      an emergency. (Codex's 5f780188 made the pending bundle wait for
 *      `phase !== 'playing'`; this widens "idle" to the playing-phase states
 *      that show no content, and keeps everything that does.)
 *
 * Emergency alerts are the exception to all of it: they preempt instantly on
 * their own lane (player rules 4 and 11) and are untouched here.
 */

export type RefreshOrigin = 'operator' | 'system';

/**
 * Who sent a PUSHED refresh. The operator endpoints sign `requestedBy` with
 * the user's id; the wedge detector signs `requestedBy: null`, the rendition
 * sweep sends no such field. Same rule as `isOperatorRefresh`.
 */
export function pushRefreshOrigin(payload: unknown): RefreshOrigin {
  const by = (payload as { requestedBy?: unknown } | null | undefined)?.requestedBy;
  return typeof by === 'string' && by.length > 0 ? 'operator' : 'system';
}

/**
 * Who stamped a DURABLE refresh (manifest `refreshRequestedBy`). Only an
 * explicit 'system' is the system's: an older API that does not send the
 * field, or any other value, reads as an operator's — the pre-field
 * behaviour, so a person's refresh can never silently vanish.
 */
export function manifestRefreshOrigin(refreshRequestedBy: unknown): RefreshOrigin {
  return refreshRequestedBy === 'system' ? 'system' : 'operator';
}

/** A paint older than this is not "still painting" (rAF runs at ≥ 1 fps on any live, visible page). */
export const PAINT_FRESH_MS = 15_000;
/** The manifest poll is 5–10 s; five minutes of no 2xx/304 means the fetch loop is not healthy. */
export const MANIFEST_FRESH_MS = 5 * 60_000;

export interface LiveEvidence {
  /** The page phase at decision time (`phaseRef`). */
  phase: string;
  /** `renderStateRef.rendering` — operator content (or an emergency) is on the glass. */
  rendering: boolean;
  /** `renderStateRef.sig` — `pl:` is operator content; `em:` an emergency; `idle:` / `paused:` nothing. */
  sig: string;
  /** `renderStateRef.kind` — 'playlist' | 'template' | 'emergency' | 'idle' | 'paused'. */
  kind?: string;
  /** An emergency (or pushed SOS/broadcast) is displayed — the callers' own deferral owns that case. */
  emergency: boolean;
  /** The active video is stalled per the media stall watchdog — not healthy. */
  mediaStalled?: boolean;
  nowMs: number;
  /** Last requestAnimationFrame tick (compositor-driven — proves painting). 0 = never. */
  lastPaintAtMs: number;
  /** Last manifest 2xx/304. 0 = never. */
  lastManifestOkAtMs: number;
}

export type RefreshAdmission =
  | { action: 'reload' }
  | { action: 'decline'; reason: 'healthy-playing' };

/** Content is on the glass AND the page can prove it is painting and fetching. */
export function provablyHealthyPlaying(ev: LiveEvidence): boolean {
  if (ev.phase !== 'playing' || !ev.rendering || ev.emergency || ev.mediaStalled) return false;
  if (!ev.sig.startsWith('pl:')) return false;
  if (ev.lastPaintAtMs <= 0 || ev.nowMs - ev.lastPaintAtMs > PAINT_FRESH_MS) return false;
  if (ev.lastManifestOkAtMs <= 0 || ev.nowMs - ev.lastManifestOkAtMs > MANIFEST_FRESH_MS) return false;
  return true;
}

export function admitRefresh(origin: RefreshOrigin, ev: LiveEvidence): RefreshAdmission {
  if (origin === 'operator') return { action: 'reload' };
  return provablyHealthyPlaying(ev) ? { action: 'decline', reason: 'healthy-playing' } : { action: 'reload' };
}

/** Render states in which a reload would restart work the screen is doing for the operator. */
const BUSY_IDLE_SIGS: ReadonlySet<string> = new Set(['idle:content-downloading', 'idle:content-loading']);

/** May a waiting web bundle be picked up right now? Only when nothing is on the glass. */
export function bundleReloadIdle(ev: Pick<LiveEvidence, 'rendering' | 'sig' | 'kind' | 'emergency'>): boolean {
  if (ev.emergency || ev.rendering) return false;
  if (ev.kind !== undefined && ev.kind !== 'idle') return false; // 'paused' — the operator parked it
  if (ev.sig.startsWith('paused:')) return false;
  if (BUSY_IDLE_SIGS.has(ev.sig)) return false;
  return true;
}
