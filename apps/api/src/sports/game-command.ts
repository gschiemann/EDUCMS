/**
 * Game-command primitives — K-12 sports launch program, lane A1 (2026-09-26).
 *
 * Pure, dependency-free pieces of SportsService's command pipeline
 * (`runGameCommand`), kept out of the service so each can be unit-tested and
 * the 7k-line service stays about orchestration:
 *
 *   - WHO issued a command (GameActor) and its durable identity (commandId,
 *     expectedSegment) — K12-F10 / F34;
 *   - the request hash that stops a command id being reused for a different
 *     request — K12-F10;
 *   - the before/after STATE CHANGE a command made, recorded on its primary
 *     event, and `planUndo`, which turns that record back into the exact
 *     inverse of the whole command (every side effect included), refusing
 *     when a later command has changed what it touched — K12-F09.
 */
import { BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';

// ── who ─────────────────────────────────────────────────────────

/**
 * user    — an authenticated operator (JWT / API key); `userId` when human.
 * console — a scorekeeper share link; `ref` = fingerprint of the issued link.
 * feed    — a machine score feed; `ref` = which feed ('feed' | 'cts' | 'swim').
 * system  — the server itself; `ref` = which worker ('clock-advance', …).
 */
export type GameActorKind = 'user' | 'console' | 'feed' | 'system';

export interface GameActor {
  kind: GameActorKind;
  userId?: string | null;
  ref?: string | null;
}

export interface GameCommandContext {
  actor?: GameActor;
  /** Client-minted durable id; a second arrival replays the first's response. */
  commandId?: string | null;
  /**
   * The segment the client saw when it made the command. Sent by the offline
   * queue on REPLAY of an absolute command: if the game has moved to another
   * period meanwhile, the command is refused (409 GAME_SEGMENT_CHANGED)
   * instead of silently landing a Q1 value in Q2.
   */
  expectedSegment?: number | null;
}

/**
 * What service methods accept for "who / which command". A bare string is the
 * operator's user id — the shape every existing caller already passes.
 */
export type CommandInput = string | GameCommandContext | null | undefined;

export interface ResolvedCommandContext {
  actor: GameActor;
  commandId: string | null;
  expectedSegment: number | null;
}

export function resolveCommandContext(input: CommandInput): ResolvedCommandContext {
  if (typeof input === 'string') {
    return { actor: { kind: 'user', userId: input }, commandId: null, expectedSegment: null };
  }
  const actor: GameActor = input?.actor ?? { kind: 'user', userId: null };
  return {
    actor: { kind: actor.kind, userId: actor.userId ?? null, ref: actor.ref ?? null },
    commandId: input?.commandId ?? null,
    expectedSegment:
      typeof input?.expectedSegment === 'number' && Number.isInteger(input.expectedSegment)
        ? input.expectedSegment
        : null,
  };
}

export const SYSTEM_CLOCK_ACTOR: GameCommandContext = {
  actor: { kind: 'system', ref: 'clock-advance' },
};

export function feedActor(ref: 'feed' | 'cts' | 'swim'): GameCommandContext {
  return { actor: { kind: 'feed', ref } };
}

/**
 * A non-reversible fingerprint of an issued console share link. Recorded on
 * the mint audit row and on every command the link drives, so an admin can
 * tell WHICH issued link did what — never the token itself.
 */
export function consoleTokenFingerprint(token: string): string {
  return createHash('sha256').update(`console-link:${token}`).digest('hex').slice(0, 16);
}

// ── transport fields (controller side) ──────────────────────────

/** Same charset / bounds as the AI-designer idempotency key. */
const COMMAND_ID_RE = /^[A-Za-z0-9._:-]{8,100}$/;

/**
 * Split a request body into the command's own DTO and its transport fields
 * (`commandId`, `expectedSegment`). Malformed transport fields are a 400 —
 * a garbled id must never silently disable replay protection.
 */
export function splitCommandFields<T extends Record<string, unknown>>(
  body: T | null | undefined,
): { dto: Omit<T, 'commandId' | 'expectedSegment'>; commandId: string | null; expectedSegment: number | null } {
  const src = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const { commandId, expectedSegment, ...dto } = src;
  let id: string | null = null;
  if (commandId !== undefined && commandId !== null) {
    if (typeof commandId !== 'string' || !COMMAND_ID_RE.test(commandId)) {
      throw new BadRequestException({
        code: 'COMMAND_ID_INVALID',
        message: 'commandId must be 8-100 characters of A-Z a-z 0-9 . _ : -',
      });
    }
    id = commandId;
  }
  let seg: number | null = null;
  if (expectedSegment !== undefined && expectedSegment !== null) {
    if (typeof expectedSegment !== 'number' || !Number.isInteger(expectedSegment) || expectedSegment < 1) {
      throw new BadRequestException({
        code: 'EXPECTED_SEGMENT_INVALID',
        message: 'expectedSegment must be a positive integer',
      });
    }
    seg = expectedSegment;
  }
  return { dto: dto as Omit<T, 'commandId' | 'expectedSegment'>, commandId: id, expectedSegment: seg };
}

/** JSON with object keys sorted at every depth — a stable hash input. */
export function stableStringify(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(',')}}`;
}

export function requestHash(kind: string, dto: unknown): string {
  return createHash('sha256').update(`${kind}\n${stableStringify(dto ?? null)}`).digest('hex');
}

// ── state change (the undo record) ──────────────────────────────

/** The Game columns a command can change. */
export const TRACKED_COLUMNS = [
  'homeScore',
  'awayScore',
  'segment',
  'clockMs',
  'clockRunning',
  'clockUpdatedAt',
  'status',
  'possession',
  'startedAt',
  'endedAt',
] as const;

/**
 * Stats keys machines rewrite on their own cadence (feed liveness stamp, the
 * CTS overlay block, the swim audit-cadence markers). They are never part of
 * what an OPERATOR command meant, and including them would make every undo
 * conflict with the next heartbeat.
 */
function isMachineStatsKey(key: string): boolean {
  return key === 'feed' || key === 'cts' || key.startsWith('swimAuditAt:');
}

/** Marks a stats key that did not exist on that side of the change. */
export const ABSENT = Object.freeze({ $absent: true });

function isAbsent(v: unknown): boolean {
  return !!v && typeof v === 'object' && (v as Record<string, unknown>).$absent === true;
}

/** before/after of every field a command changed. Keys: a column name, or `stats.<key>`. */
export interface StateChange {
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}

type GameLike = Record<string, any>;

function normColumn(v: unknown): unknown {
  if (v === undefined || v === null) return null;
  if (v instanceof Date) return v.toISOString();
  return v;
}

function statsOf(g: GameLike): Record<string, unknown> {
  return g && g.stats && typeof g.stats === 'object' && !Array.isArray(g.stats)
    ? (g.stats as Record<string, unknown>)
    : {};
}

/** The values of `keys` on a row, in StateChange form. */
export function readFields(g: GameLike, keys: string[]): Record<string, unknown> {
  const stats = statsOf(g);
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    if (k.startsWith('stats.')) {
      const sk = k.slice(6);
      out[k] = Object.prototype.hasOwnProperty.call(stats, sk) ? stats[sk] : ABSENT;
    } else {
      out[k] = normColumn(g[k]);
    }
  }
  return out;
}

/** Every tracked field that differs between two rows. */
export function diffState(before: GameLike, after: GameLike): StateChange {
  const keys: string[] = [];
  for (const c of TRACKED_COLUMNS) {
    if (stableStringify(normColumn(before[c])) !== stableStringify(normColumn(after[c]))) keys.push(c);
  }
  const bs = statsOf(before);
  const as = statsOf(after);
  for (const k of new Set([...Object.keys(bs), ...Object.keys(as)])) {
    if (isMachineStatsKey(k)) continue;
    const had = Object.prototype.hasOwnProperty.call(bs, k);
    const has = Object.prototype.hasOwnProperty.call(as, k);
    if (had !== has || stableStringify(bs[k]) !== stableStringify(as[k])) keys.push(`stats.${k}`);
  }
  return { before: readFields(before, keys), after: readFields(after, keys) };
}

export function isEmptyChange(change: StateChange | null | undefined): boolean {
  return !change || Object.keys(change.after ?? {}).length === 0;
}

// ── undo ────────────────────────────────────────────────────────

export type ClockKind = 'countdown' | 'countup' | 'none';

function projectMs(ms: number, anchor: unknown, running: boolean, now: number, kind: ClockKind): number {
  if (!running) return ms;
  const at = new Date(String(anchor ?? '')).getTime();
  if (!Number.isFinite(at)) return ms;
  const elapsed = Math.max(0, now - at);
  if (kind === 'countup') return ms + elapsed;
  if (kind === 'countdown') return Math.max(0, ms - elapsed);
  return ms;
}

/**
 * Re-anchor a restored secondary clock (shot / play clock objects, the
 * penalty box) at `now`, projecting any that were running — the same
 * single-anchor discipline every clock write in the service keeps.
 */
function reanchorStatsValue(key: string, value: unknown, now: Date): unknown {
  const nowMs = now.getTime();
  const iso = now.toISOString();
  if ((key === 'shotClock' || key === 'playClock') && value && typeof value === 'object' && !Array.isArray(value)) {
    const v = value as Record<string, unknown>;
    const ms = Math.max(0, Number(v.ms) || 0);
    return { ...v, ms: projectMs(ms, v.at, !!v.running, nowMs, 'countdown'), at: iso };
  }
  if (key === 'penalties' && Array.isArray(value)) {
    return value
      .map((p) => {
        if (!p || typeof p !== 'object') return p;
        const row = p as Record<string, unknown>;
        if (row.source === 'cts') return row; // console-owned timers keep their own state
        const ms = projectMs(Math.max(0, Number(row.ms) || 0), row.at, !!row.running, nowMs, 'countdown');
        return { ...row, ms, at: iso };
      })
      .filter((p) => !p || typeof p !== 'object' || (p as Record<string, unknown>).source === 'cts' || Number((p as Record<string, unknown>).ms) > 0);
  }
  return value;
}

const CLOCK_KEYS = new Set(['clockMs', 'clockRunning', 'clockUpdatedAt']);
const SCORE_KEYS = new Set(['homeScore', 'awayScore']);

export type UndoPlan =
  | { ok: true; data: Record<string, unknown>; mode: 'exact' | 'delta' }
  | { ok: false; conflicts: string[] };

/**
 * Turn a recorded StateChange into the Prisma patch that reverses it, given
 * the game's CURRENT row.
 *
 *  - EXACT: every field the command changed still holds the value the command
 *    left there → restore every `before` value (score, set count, period,
 *    status, fouls, secondary clocks — the whole action). Clocks are
 *    re-anchored at `now`: a clock that was running before the command is
 *    projected forward, so undoing a mistaken pause resumes at the reading it
 *    would have had, and undoing a mistaken start gives the elapsed time back.
 *  - DELTA: the command touched ONLY score columns and a later command moved
 *    them too — a score change is commutative, so apply the inverse of what
 *    this command ACTUALLY changed (a clamped −1 at 0 changed nothing, so its
 *    inverse is nothing).
 *  - otherwise a later command changed something this one touched: refuse and
 *    name the fields, rather than overwrite that later change.
 */
export function planUndo(
  change: StateChange,
  current: GameLike,
  opts: { clock: ClockKind; now: Date },
): UndoPlan {
  const keys = Object.keys(change.after ?? {});
  const now = opts.now;
  if (keys.length === 0) return { ok: true, data: {}, mode: 'exact' };

  const currentVals = readFields(current, keys);
  const conflicts = keys.filter(
    (k) => stableStringify(currentVals[k]) !== stableStringify(change.after[k]),
  );

  if (conflicts.length > 0) {
    if (keys.every((k) => SCORE_KEYS.has(k))) {
      const data: Record<string, unknown> = {};
      for (const k of keys) {
        const applied = Number(change.after[k]) - Number(change.before[k]);
        if (!Number.isFinite(applied) || applied === 0) continue;
        data[k] = Math.max(0, (Number(current[k]) || 0) - applied);
      }
      return { ok: true, data, mode: 'delta' };
    }
    return { ok: false, conflicts };
  }

  const data: Record<string, unknown> = {};
  let touchesClock = false;
  let statsPatch: Record<string, unknown> | null = null;
  for (const k of keys) {
    const before = change.before[k];
    if (k.startsWith('stats.')) {
      statsPatch ??= { ...statsOf(current) };
      const sk = k.slice(6);
      if (isAbsent(before)) delete statsPatch[sk];
      else statsPatch[sk] = reanchorStatsValue(sk, before, now);
      continue;
    }
    if (CLOCK_KEYS.has(k)) {
      touchesClock = true;
      continue;
    }
    if (k === 'startedAt' || k === 'endedAt') {
      data[k] = before === null || before === undefined ? null : new Date(String(before));
      continue;
    }
    data[k] = before;
  }
  if (touchesClock) {
    const pick = (k: string) =>
      Object.prototype.hasOwnProperty.call(change.before, k) ? change.before[k] : normColumn(current[k]);
    const running = !!pick('clockRunning');
    const baseMs = Math.max(0, Number(pick('clockMs')) || 0);
    data.clockMs = Math.round(projectMs(baseMs, pick('clockUpdatedAt'), running, now.getTime(), opts.clock));
    data.clockRunning = running;
    data.clockUpdatedAt = now;
  }
  if (statsPatch) data.stats = statsPatch;
  return { ok: true, data, mode: 'exact' };
}

/**
 * Bound a JSON-able value for an audit `details` string: large arrays/objects
 * (a swim results blob, a long penalty list) are summarised, never dropped
 * silently, so the row stays readable and small.
 */
export function boundedForAudit(value: unknown, maxChars = 6000): unknown {
  const text = stableStringify(value);
  if (text.length <= maxChars) return value;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const s = stableStringify(v);
      out[k] = s.length > 400 ? { $truncated: true, chars: s.length } : v;
    }
    return out;
  }
  return { $truncated: true, chars: text.length };
}
