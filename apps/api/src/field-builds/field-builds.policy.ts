/**
 * FIELD BUILD WINDOWS (2026-10-18) — the pure rules behind /super/field-builds.
 *
 * Nothing here touches Prisma, Nest or the wall clock unless a `now` is passed
 * in. The service calls these; field-builds.policy.spec.ts pins every shape.
 *
 * VOCABULARY
 *   candidate  a private field build of the Android player, registered (by its
 *              digest) in player-ota/field-candidate-releases.ts.
 *   window     one field_build_windows row: which organisations and screens
 *              may be offered which candidate, until when (≤ 24 h from arming).
 *   push       the dashboard's own "Send update" (screen-commands.ts
 *              armScreenApkUpdate) for a screen inside the window. Only a
 *              pushed screen is ever offered the candidate.
 */
import type { FieldBuildWindow } from '../player-ota/field-candidate';

/** The arm form's durations are minutes; the ceiling is the gate's own 24 h. */
export const MIN_WINDOW_MINUTES = 5;
export const MAX_WINDOW_MINUTES = 24 * 60;
/** Match the migration's CHECK constraints. */
export const MAX_WINDOW_TENANTS = 50;
export const MAX_WINDOW_SCREENS = 500;
export const MAX_NOTE_LENGTH = 500;
/** One screen at a time is the norm (never mass-push during playback); a few is the most one request takes. */
export const MAX_PUSH_SCREENS = 10;
/** The update check reads the newest window through a cache this old at most. */
export const GATE_TTL_MS = 10_000;
/**
 * A push waits this long after arming, so every replica's cached read has seen
 * the window: a screen that checked against a replica that had not would be
 * handed the ordinary stable update instead of the field build.
 */
export const PUSH_SETTLE_MS = GATE_TTL_MS + 2_000;

export class FieldBuildInputError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const FIELD_NAME = /^\d+\.\d{1,2}\.\d{1,2}-field\.[1-9]\d*$/;

export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);

export interface ArmInput {
  candidate: string;
  tenantIds: string[];
  allScreens: boolean;
  screenIds: string[];
  durationMinutes: number;
  note: string | null;
}

export interface PushInput {
  screenIds: string[];
  overrideWindow: boolean;
}

const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/** Distinct uuids, lower-cased, in the order sent; anything else is refused. */
export function parseUuidList(v: unknown, opts: { max: number; code: string; what: string }): string[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new FieldBuildInputError(opts.code, `${opts.what} must be a list of ids.`);
  const out: string[] = [];
  for (const item of v) {
    if (!isUuid(item)) throw new FieldBuildInputError(opts.code, `${opts.what} must be a list of ids.`);
    const id = item.toLowerCase();
    if (!out.includes(id)) out.push(id);
  }
  if (out.length > opts.max) {
    throw new FieldBuildInputError(opts.code, `${opts.what} may list at most ${opts.max}.`);
  }
  return out;
}

export function parseNote(v: unknown, field = 'note'): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') throw new FieldBuildInputError('FIELD_BUILD_NOTE_INVALID', `${field} must be text.`);
  const s = v.trim();
  if (!s) return null;
  if (s.length > MAX_NOTE_LENGTH) {
    throw new FieldBuildInputError('FIELD_BUILD_NOTE_TOO_LONG', `${field} must be ${MAX_NOTE_LENGTH} characters or fewer.`);
  }
  return s;
}

export function parseDurationMinutes(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  if (!Number.isInteger(n) || n < MIN_WINDOW_MINUTES || n > MAX_WINDOW_MINUTES) {
    throw new FieldBuildInputError(
      'FIELD_BUILD_DURATION_INVALID',
      `A window lasts between ${MIN_WINDOW_MINUTES} minutes and 24 hours (whole minutes).`,
    );
  }
  return n;
}

/**
 * `POST /super/field-builds/windows`:
 *   { candidate, tenantIds: uuid[], screens: 'all' | uuid[], durationMinutes, note? }
 * `screens: 'all'` means every screen of the listed organisations. There is no
 * organisation wildcard — every organisation is named.
 */
export function parseArmInput(body: unknown): ArmInput {
  const b = asRecord(body);
  const candidate = typeof b.candidate === 'string' ? b.candidate.trim() : '';
  if (!FIELD_NAME.test(candidate)) {
    throw new FieldBuildInputError('FIELD_BUILD_CANDIDATE_INVALID', 'Choose a registered field build.');
  }
  const tenantIds = parseUuidList(b.tenantIds, {
    max: MAX_WINDOW_TENANTS,
    code: 'FIELD_BUILD_TENANTS_INVALID',
    what: 'tenantIds',
  });
  if (tenantIds.length === 0) {
    throw new FieldBuildInputError('FIELD_BUILD_TENANTS_REQUIRED', 'Choose at least one organisation.');
  }
  let allScreens = false;
  let screenIds: string[] = [];
  if (b.screens === 'all') {
    allScreens = true;
  } else {
    screenIds = parseUuidList(b.screens, {
      max: MAX_WINDOW_SCREENS,
      code: 'FIELD_BUILD_SCREENS_INVALID',
      what: 'screens',
    });
    if (screenIds.length === 0) {
      throw new FieldBuildInputError('FIELD_BUILD_SCREENS_REQUIRED', 'Choose at least one screen, or every screen.');
    }
  }
  return {
    candidate,
    tenantIds,
    allScreens,
    screenIds,
    durationMinutes: parseDurationMinutes(b.durationMinutes),
    note: parseNote(b.note),
  };
}

/** `POST /super/field-builds/windows/:id/push`: { screenIds: uuid[], overrideWindow? }. */
export function parsePushInput(body: unknown): PushInput {
  const b = asRecord(body);
  const screenIds = parseUuidList(b.screenIds, {
    max: MAX_PUSH_SCREENS,
    code: 'FIELD_BUILD_PUSH_SCREENS_INVALID',
    what: 'screenIds',
  });
  if (screenIds.length === 0) {
    throw new FieldBuildInputError('FIELD_BUILD_PUSH_SCREENS_REQUIRED', 'Choose a screen to push.');
  }
  if (b.overrideWindow !== undefined && typeof b.overrideWindow !== 'boolean') {
    throw new FieldBuildInputError('FIELD_BUILD_PUSH_OVERRIDE_INVALID', 'overrideWindow must be true or false.');
  }
  return { screenIds, overrideWindow: b.overrideWindow === true };
}

// ─── The window's own state ────────────────────────────────────────────────

export type WindowState = 'active' | 'cancelled' | 'expired';

const ms = (v: Date | string | number | null | undefined): number =>
  v == null ? NaN : v instanceof Date ? v.getTime() : typeof v === 'number' ? v : Date.parse(v);

export function windowState(
  w: Pick<FieldBuildWindow, 'cancelledAt' | 'expiresAt'>,
  now: number,
): WindowState {
  if (w.cancelledAt != null) return 'cancelled';
  return ms(w.expiresAt) > now ? 'active' : 'expired';
}

/** When a push may go out (see PUSH_SETTLE_MS). */
export function pushReadyAt(w: Pick<FieldBuildWindow, 'armedAt'>): number {
  return ms(w.armedAt) + PUSH_SETTLE_MS;
}

/**
 * The variables' window, in the panel's words — so the page can say which
 * source the gate is following. Read exactly as player-ota/field-candidate.ts
 * reads it; nothing here decides admission.
 */
export interface EnvWindowView {
  configured: boolean;
  candidate: string | null;
  tenantIds: string[];
  screens: 'all' | string[];
  expiresAt: string | null;
  /** Inside its expiry and at most 24 h away — what the gate would admit by. */
  live: boolean;
}

export function envWindowView(env: NodeJS.ProcessEnv, now: number): EnvWindowView {
  const csv = (v: string | undefined) =>
    (v ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  const screens = csv(env.PLAYER_APK_FIELD_SCREEN_IDS);
  const end = Date.parse(env.PLAYER_APK_FIELD_EXPIRES_AT ?? '');
  const candidate = (env.PLAYER_APK_FIELD_CANDIDATE ?? '').trim() || null;
  const tenantIds = csv(env.PLAYER_APK_FIELD_TENANT_ID).filter((t) => isUuid(t));
  return {
    configured: !!(candidate || tenantIds.length || screens.length || env.PLAYER_APK_FIELD_EXPIRES_AT),
    candidate,
    tenantIds,
    screens: screens.some((s) => s.toLowerCase() === 'all') ? 'all' : screens.filter((s) => isUuid(s)),
    expiresAt: Number.isFinite(end) ? new Date(end).toISOString() : null,
    live: !!candidate && tenantIds.length > 0 && Number.isFinite(end) && end > now && end - now <= 24 * 60 * 60_000,
  };
}
