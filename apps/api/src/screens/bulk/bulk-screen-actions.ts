/**
 * BULK SCREEN ACTIONS (2026-10-11) — the pure half. No Prisma, no Nest.
 *
 * Greg: "If I want to manually push a resync, an update of the player, allow me
 * to do a select-all and push — by group at least. Doing one at a time is not
 * good when every screen needs it."
 *
 * The bulk endpoints loop the EXISTING single-screen commands
 * (`screens/screen-commands.ts`, `display/display.controller.ts#runDisplayControl`)
 * — this file only decides WHICH screens a request names, how a result is
 * worded, and how many run at once. Nothing here sends anything.
 */

/** Most screens one request may name (after a group is expanded). */
export const BULK_MAX_SCREENS = 500;

/** How many OTA pushes run at once — each is a DB write + a signed publish. */
export const BULK_OTA_CONCURRENCY = 8;
/** Resync / power / auto-update: same shape, a little wider. */
export const BULK_DEFAULT_CONCURRENCY = 16;

export const BULK_ACTIONS = ['resync', 'update', 'power', 'auto-update'] as const;
export type BulkAction = (typeof BULK_ACTIONS)[number];

export type BulkOutcome = 'sent' | 'skipped' | 'failed';

/**
 * Stable reason codes. The dashboard words them in en/es/zh
 * (`screens.bulk.reason.*`); the API's `message` is the English fallback.
 */
export type BulkReason =
  | 'not-found'
  | 'out-of-scope'
  | 'already-current'
  | 'no-player-app'
  | 'unchanged'
  | 'unsupported'
  | 'emergency-hold'
  | 'not-delivered'
  | 'no-live-connection'
  | 'error';

export interface BulkScreenResult {
  screenId: string;
  name: string | null;
  outcome: BulkOutcome;
  reason?: BulkReason;
  /** Machine code from the underlying command (e.g. DISPLAY_EMERGENCY_HOLD). */
  code?: string;
  message?: string;
  /** Update only: the screen cannot install silently, so Android shows an Install prompt on the glass. */
  installPrompt?: boolean;
}

export interface BulkSummary {
  requested: number;
  sent: number;
  skipped: number;
  failed: number;
}

export function summarize(results: BulkScreenResult[]): BulkSummary {
  const s: BulkSummary = { requested: results.length, sent: 0, skipped: 0, failed: 0 };
  for (const r of results) s[r.outcome] += 1;
  return s;
}

export class BulkInputError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400) {
    super(message);
  }
}

export interface BulkBody {
  screenIds?: unknown;
  screenGroupId?: unknown;
  dryRun?: unknown;
  /** power */
  state?: unknown;
  /** auto-update */
  mode?: unknown;
}

/** The ids a body names (de-duplicated, order kept). Throws BulkInputError on a malformed body. */
export function parseBulkTargets(body: BulkBody | null | undefined): { screenIds: string[]; screenGroupId: string | null; dryRun: boolean } {
  const b: BulkBody = body && typeof body === 'object' ? body : {};
  const screenIds: string[] = [];
  if (b.screenIds !== undefined && b.screenIds !== null) {
    if (!Array.isArray(b.screenIds)) throw new BulkInputError('BULK_INVALID_TARGETS', 'screenIds must be a list of screen ids.');
    for (const v of b.screenIds) {
      if (typeof v !== 'string' || !v.trim()) throw new BulkInputError('BULK_INVALID_TARGETS', 'screenIds must be a list of screen ids.');
      const id = v.trim();
      if (!screenIds.includes(id)) screenIds.push(id);
      // Refuse an oversized body before it ever reaches the database.
      if (screenIds.length > BULK_MAX_SCREENS) throw tooMany();
    }
  }
  let screenGroupId: string | null = null;
  if (b.screenGroupId !== undefined && b.screenGroupId !== null && b.screenGroupId !== '') {
    if (typeof b.screenGroupId !== 'string') throw new BulkInputError('BULK_INVALID_TARGETS', 'screenGroupId must be a screen group id.');
    screenGroupId = b.screenGroupId.trim();
  }
  if (screenIds.length === 0 && !screenGroupId) {
    throw new BulkInputError('BULK_NO_TARGETS', 'Choose at least one screen or a screen group.');
  }
  return { screenIds, screenGroupId, dryRun: b.dryRun === true };
}

export function tooMany(): BulkInputError {
  return new BulkInputError(
    'BULK_TOO_MANY_SCREENS',
    `One request can act on at most ${BULK_MAX_SCREENS} screens. Narrow the selection and send the rest separately.`,
  );
}

/** Merge explicit ids with a group's screens, explicit ids first, no duplicates, capped. */
export function mergeTargetIds(explicit: string[], fromGroup: string[]): string[] {
  const out = [...explicit];
  for (const id of fromGroup) if (!out.includes(id)) out.push(id);
  if (out.length > BULK_MAX_SCREENS) throw tooMany();
  return out;
}

export function parsePowerState(v: unknown): 'on' | 'off' {
  if (v === 'on' || v === 'off') return v;
  throw new BulkInputError('BULK_POWER_STATE_INVALID', 'state must be "on" or "off".');
}

export function parseAutoUpdateMode(v: unknown): 'on' | 'off' | 'inherit' {
  if (v === 'on' || v === 'off' || v === 'inherit') return v;
  throw new BulkInputError('SCREEN_AUTO_UPDATE_MODE_INVALID', 'mode must be "on", "off" or "inherit".');
}

/**
 * Is an installed Player at or past the latest published one? Same comparison
 * as the dashboard's per-screen push button (`compareInstalledVersion` in
 * ScreenSettingsMenu.tsx): numeric dotted segments, a leading `v` ignored.
 * `null` = unknown (either side missing) — never "current", never "stale".
 */
export function playerIsCurrent(installed: string | null | undefined, latest: string | null | undefined): boolean | null {
  if (!installed || !latest) return null;
  const norm = (v: string) => v.trim().replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  const a = norm(installed);
  const b = norm(latest);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x < y) return false;
    if (x > y) return true;
  }
  return true;
}

/**
 * Should "Send update" go to this screen?
 *   - no Player version ever reported → skip: a browser player has no app to
 *     update, and a kiosk that never checked in cannot be graded;
 *   - installed ≥ latest → skip as already current;
 *   - latest unknown (release lookup failed) → send: the operator asked, and
 *     the screen's own update-check decides (same as the single-screen button).
 */
export function updateDecision(installed: string | null | undefined, latest: string | null | undefined): { send: true } | { send: false; reason: BulkReason } {
  if (!installed) return { send: false, reason: 'no-player-app' };
  if (playerIsCurrent(installed, latest) === true) return { send: false, reason: 'already-current' };
  return { send: true };
}

/** English fallback for a reason (the dashboard translates the code). */
export const REASON_MESSAGE: Record<BulkReason, string> = {
  'not-found': 'Not found in this location.',
  'out-of-scope': 'You do not have access to this screen.',
  'already-current': 'Already on the latest Player.',
  'no-player-app': 'No Player app version reported (a browser player cannot be updated).',
  unchanged: 'Already set that way.',
  unsupported: 'This screen cannot do that.',
  'emergency-hold': 'An emergency alert is active on this screen.',
  'not-delivered': 'The command could not be delivered.',
  'no-live-connection': 'No live connection — this screen did not get the command. Try again once it reconnects.',
  error: 'Something went wrong.',
};

/**
 * Run `fn` over `items` with at most `limit` in flight. Results keep input
 * order. A throw inside `fn` is the caller's to catch — every bulk worker
 * catches its own so one screen can never sink the batch.
 */
export async function mapWithConcurrency<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const width = Math.max(1, Math.min(limit, items.length));
  const workers = Array.from({ length: width }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}
