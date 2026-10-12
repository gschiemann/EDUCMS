/**
 * offHoursUpdate — WHEN may a waiting web bundle be applied? (2026-10-10)
 *
 * Greg: "is there any way to keep content running and update in the
 * background? We need to limit the downtime… if so yes force update off
 * hours."
 *
 * The never-interrupt program (`refreshAdmission.ts`) made a newer player
 * bundle wait until nothing is on the glass. Its side effect: a screen that
 * plays 24/7 never picks up a bundle (bug fixes, the drill banner) until an
 * operator presses Refresh. This module is the other half: the bundle is
 * PREPARED in the background while content plays (the service worker pins
 * the new document + chunks, `offline-cache.ts`), and APPLIED only inside
 * the screen's off-hours window, at a natural boundary, under a cover frame
 * (`updateCover.ts`) so the reload itself is nearly invisible.
 *
 * Pure — no React / DOM / network / clock reads except the `nowMs` the
 * caller passes — so every decision is unit-tested without mounting the
 * page (same pattern as `refreshAdmission.ts`, `softSchedule.ts`).
 *
 * THE WINDOW, in order of preference:
 *   (a) display-off — the screen is inside a scheduled OFF window (the same
 *       `display.schedules` / `display.softSchedules` rows the on/off
 *       schedule runs on) or the soft-blank overlay is on the glass. Nothing
 *       visible is torn down: apply at once.
 *   (b) idle — nothing on the glass (`bundleReloadIdle`, the existing rule).
 *   (c) nightly — 03:00–04:00 in the SCREEN'S local timezone, at the next
 *       item boundary. Each screen starts at a deterministic jitter inside
 *       the hour (0–20 min from its id) so a fleet does not reload at
 *       03:00:00 sharp.
 *
 * THE TIMEZONE comes from the screen's own display-schedule rows (the only
 * per-screen zone the manifest carries today — `DisplaySchedule.timezone`,
 * IANA). A screen with no display schedule falls back to the DEVICE's zone
 * (`Intl.DateTimeFormat().resolvedOptions().timeZone`), and a device that
 * cannot say falls back to UTC. The source is recorded in the evidence so a
 * dashboard can tell "03:00 America/Chicago from the schedule" from "03:00
 * on the box's own clock". A box still on its factory zone would apply at
 * the wrong local hour — the honest fix is a display schedule (or a
 * tenant-level zone in the manifest, a recorded follow-up).
 *
 * NEVER: during an emergency or drill; while a large file is downloading;
 * on an operator-paused screen; on a sync-locked group mid-timeline (the
 * group would need one coordinated point — not built; sync must be off);
 * within the reload-loop floor; before the new shell is prepared (unless
 * there is no service worker to prepare it, or preparation keeps failing).
 * A screen that misses its window (offline, emergency) applies at the next
 * one — never in the daytime by itself. An operator's Refresh is a
 * different path and still applies immediately.
 */

import { bundleReloadIdle, type LiveEvidence } from './refreshAdmission';
import {
  desiredOnAt,
  localPartsOf,
  parseSoftWindow,
  resolveZone,
  type SoftWindow,
} from './softSchedule';

export type UpdateWindowKind = 'display-off' | 'idle' | 'nightly';
export type UpdateZoneSource = 'schedule' | 'device' | 'utc';
export type UpdateBoundary = 'now' | 'item';

/** Nightly window: [03:00, 04:00) local, minutes past midnight. */
export const NIGHTLY_WINDOW_START_MIN = 3 * 60;
export const NIGHTLY_WINDOW_END_MIN = 4 * 60;
/** Per-screen deterministic start offset inside the nightly hour. */
export const NIGHTLY_JITTER_MAX_MS = 20 * 60_000;
/** Inside the nightly window, how long to wait for an item boundary before applying anyway. */
export const BOUNDARY_WAIT_CAP_MS = 10 * 60_000;
/** Shell-prepare attempts (one per 15-min check) before applying unprepared. */
export const PREPARE_MAX_ATTEMPTS = 3;
/**
 * After an applied update, if the new document still runs the OLD bundle
 * (CDN skew, a build-info env var that drifts), hold this long before
 * trying again — the hard guarantee against a nightly reload loop.
 */
export const CONVERGENCE_HOLD_MS = 6 * 60 * 60_000;
/** How often the page re-evaluates a pending update. */
export const UPDATE_TICK_MS = 30_000;

export const UPDATE_COVER_KEY = 'edu:update-cover';
export const UPDATE_EVIDENCE_KEY = 'edu:update-evidence';

export interface UpdateZone {
  zone: string;
  source: UpdateZoneSource;
}

/**
 * Both display arrays → windows. The hard array (`schedules`, real panel
 * power on a proven panel) and the soft array (`softSchedules`, the web
 * overlay) are disjoint and together are the screen's whole schedule; for
 * "is the display scheduled OFF right now" both count. `null` when the
 * block is absent (an emergency manifest, an older payload).
 */
export function parseDisplayWindows(display: unknown): SoftWindow[] | null {
  if (!display || typeof display !== 'object' || Array.isArray(display)) return null;
  const d = display as Record<string, unknown>;
  const out: SoftWindow[] = [];
  for (const key of ['schedules', 'softSchedules'] as const) {
    const raw = d[key];
    if (!Array.isArray(raw)) continue;
    for (const row of raw) {
      const w = parseSoftWindow(row);
      if (w) out.push(w);
    }
  }
  return out;
}

/**
 * The zone the nightly window is evaluated in. Schedule rows first (the
 * screen's own zone), then the device's, then UTC. A zone the runtime cannot
 * resolve is treated as absent (softSchedule rule 3 would read it as UTC —
 * here we would rather fall through to the device's real zone than to UTC).
 */
export function resolveUpdateZone(
  windows: readonly SoftWindow[] | null,
  deviceZone: string | null | undefined,
): UpdateZone {
  if (windows) {
    for (const w of windows) {
      const z = (w.timezone || '').trim();
      if (z && resolveZone(z) === z) return { zone: z, source: 'schedule' };
    }
  }
  const dz = (deviceZone || '').trim();
  if (dz && dz !== 'UTC' && resolveZone(dz) === dz) return { zone: dz, source: 'device' };
  return { zone: 'UTC', source: 'utc' };
}

/** Deterministic 0 … NIGHTLY_JITTER_MAX_MS from the screen id (FNV-1a). */
export function nightlyJitterMs(screenId: string | null | undefined): number {
  const s = String(screenId || '');
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % NIGHTLY_JITTER_MAX_MS;
}

/**
 * Is `nowMs` inside this screen's slice of the nightly window — i.e. local
 * wall clock in [03:00 + jitter, 04:00)? Wall-clock components, never
 * `+ 86_400_000`, so a DST day lands on the right minute (03:00 exists on
 * both US transition days; a zone that skips 03:00 simply has no window
 * that night and catches up the next).
 */
export function nightlyWindowOpen(zone: string, nowMs: number, jitterMs: number): boolean {
  const p = localPartsOf(resolveZone(zone), nowMs);
  const minuteOfDay = p.hour * 60 + p.minute + p.second / 60;
  const start = NIGHTLY_WINDOW_START_MIN + Math.max(0, Math.min(NIGHTLY_JITTER_MAX_MS, jitterMs)) / 60_000;
  return minuteOfDay >= start && minuteOfDay < NIGHTLY_WINDOW_END_MIN;
}

export type CacheDriveState = 'unknown' | 'ready' | 'unavailable';

export interface UpdateDecisionInput {
  /** A newer bundle is waiting (the build-info check saw drift). */
  pending: boolean;
  /** The service worker acknowledged the new shell (document + chunks) on disk. */
  prepared: boolean;
  prepareAttempts: number;
  cacheDrive: CacheDriveState;
  nowMs: number;
  /** Last bundle-drift reload this document fired (0 = never) and the floor. */
  lastReloadAtMs: number;
  minReloadGapMs: number;
  screenId: string | null;
  zone: UpdateZone;
  /** The screen's display windows (both arrays), or null when unknown. */
  windows: readonly SoftWindow[] | null;
  /** The soft-blank overlay (manual or scheduled) is on the glass. */
  softBlank: boolean;
  emergency: boolean;
  /** A large file is being driven into the cache right now. */
  largeDownload: boolean;
  /** Operator stopped playback from the remote. */
  paused: boolean;
  /** Frame-locked sync is driving this screen. */
  syncActive: boolean;
  evidence: Pick<LiveEvidence, 'rendering' | 'sig' | 'kind' | 'emergency'>;
  /** More than one playable item — there IS an item boundary to wait for. */
  hasItemBoundary: boolean;
}

export type UpdateDecision =
  | { action: 'apply'; window: UpdateWindowKind; boundary: UpdateBoundary }
  | {
      action: 'wait';
      reason:
        | 'no-update'
        | 'emergency'
        | 'reload-floor'
        | 'not-prepared'
        | 'downloading'
        | 'paused'
        | 'sync-locked'
        | 'outside-window';
    };

/** Is the shell ready enough to reload onto? */
export function shellReady(input: Pick<UpdateDecisionInput, 'prepared' | 'prepareAttempts' | 'cacheDrive'>): boolean {
  if (input.prepared) return true;
  // No worker to prepare with: the reload is network-served, as it always was.
  if (input.cacheDrive === 'unavailable') return true;
  return input.prepareAttempts >= PREPARE_MAX_ATTEMPTS;
}

export function decideUpdateApply(input: UpdateDecisionInput): UpdateDecision {
  if (!input.pending) return { action: 'wait', reason: 'no-update' };
  if (input.emergency || input.evidence.emergency) return { action: 'wait', reason: 'emergency' };
  if (input.lastReloadAtMs > 0 && input.nowMs - input.lastReloadAtMs < input.minReloadGapMs) {
    return { action: 'wait', reason: 'reload-floor' };
  }
  if (!shellReady(input)) return { action: 'wait', reason: 'not-prepared' };
  if (input.largeDownload) return { action: 'wait', reason: 'downloading' };
  if (input.paused || input.evidence.kind === 'paused' || input.evidence.sig.startsWith('paused:')) {
    return { action: 'wait', reason: 'paused' };
  }
  // (a) the display is OFF: scheduled off, or the blank overlay is up.
  const scheduledOff = !!input.windows && desiredOnAt(input.windows, input.nowMs) === false;
  if (scheduledOff || input.softBlank) return { action: 'apply', window: 'display-off', boundary: 'now' };
  // (b) nothing on the glass (the existing idle rule).
  if (bundleReloadIdle(input.evidence)) return { action: 'apply', window: 'idle', boundary: 'now' };
  // (c) the nightly window, at an item boundary.
  if (nightlyWindowOpen(input.zone.zone, input.nowMs, nightlyJitterMs(input.screenId))) {
    if (input.syncActive) return { action: 'wait', reason: 'sync-locked' };
    return { action: 'apply', window: 'nightly', boundary: input.hasItemBoundary ? 'item' : 'now' };
  }
  return { action: 'wait', reason: 'outside-window' };
}

/**
 * The record the applying document leaves for the next one (sessionStorage,
 * same tab — survives `location.replace` and the APK's WebView reload).
 */
export interface UpdateAppliedRecord {
  v: 1;
  /** Bundle identity this document ran (bundleId, or the SHA fallback). */
  from: string | null;
  /** The identity the server advertised. */
  to: string | null;
  window: UpdateWindowKind;
  boundary: UpdateBoundary;
  zone: string;
  zoneSource: UpdateZoneSource;
  /** How the cover frame was obtained. */
  capture: 'live' | 'refetch' | 'color' | 'none';
  /** `Date.now()` right before navigating away. */
  navigatedAtMs: number;
  /** Stamped by the next document's inline script when the cover painted. */
  coverAtMs?: number;
  /** Stamped by the next document when operator content was on the glass. */
  contentAtMs?: number;
  /**
   * Why the document navigated (2026-10-11, glass continuity). Absent or
   * `'bundle-update'` = the off-hours update this record was built for.
   * Anything else (`refresh-ws`, `error-boundary`, `canvas`, ...) is a reload
   * that borrowed the cover only: it never feeds the update evidence report
   * and never arms the convergence hold.
   */
  reason?: string;
}

/** Did this record come from an off-hours bundle update (not a borrowed cover)? */
export function isBundleUpdateRecord(record: UpdateAppliedRecord | null): boolean {
  return !!record && (record.reason === undefined || record.reason === 'bundle-update');
}

export function parseUpdateAppliedRecord(raw: unknown): UpdateAppliedRecord | null {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const r = JSON.parse(raw);
    if (!r || typeof r !== 'object' || r.v !== 1) return null;
    if (typeof r.navigatedAtMs !== 'number' || !Number.isFinite(r.navigatedAtMs)) return null;
    return r as UpdateAppliedRecord;
  } catch {
    return null;
  }
}

/**
 * After a reload, the new document compares its own identity to the record.
 * Same as `from` = the deploy did not converge: hold `CONVERGENCE_HOLD_MS`
 * from the attempt before trying again. Returns the instant the hold ends,
 * or 0 when there is nothing to hold for.
 */
export function convergenceHoldUntil(record: UpdateAppliedRecord | null, myIdentity: string | null): number {
  if (!record || !myIdentity || !record.from || !isBundleUpdateRecord(record)) return 0;
  if (record.from !== myIdentity) return 0;
  return record.navigatedAtMs + CONVERGENCE_HOLD_MS;
}

/** The telemetry `update` block, built from the completed record. */
export interface UpdateEvidenceReport {
  fromBundleId: string | null;
  toBundleId: string | null;
  window: UpdateWindowKind;
  boundary: UpdateBoundary;
  zone: string;
  zoneSource: UpdateZoneSource;
  capture: UpdateAppliedRecord['capture'];
  /** Old document's last frame → the new document's cover painted (the true blank). */
  blankMs: number | null;
  /** Cover painted → operator content on the glass (cover held). */
  coverMs: number | null;
  /** The new document runs a different bundle than the one that reloaded. */
  converged: boolean;
}

export function buildUpdateEvidence(record: UpdateAppliedRecord, myIdentity: string | null): UpdateEvidenceReport {
  const span = (a: number | undefined, b: number | undefined): number | null =>
    typeof a === 'number' && typeof b === 'number' && Number.isFinite(a) && Number.isFinite(b) && b >= a
      ? Math.min(Math.round(b - a), 86_400_000)
      : null;
  return {
    fromBundleId: record.from,
    toBundleId: myIdentity,
    window: record.window,
    boundary: record.boundary,
    zone: String(record.zone || 'UTC').slice(0, 64),
    zoneSource: record.zoneSource,
    capture: record.capture,
    blankMs: span(record.navigatedAtMs, record.coverAtMs),
    coverMs: span(record.coverAtMs, record.contentAtMs),
    converged: !!myIdentity && !!record.from && myIdentity !== record.from,
  };
}
