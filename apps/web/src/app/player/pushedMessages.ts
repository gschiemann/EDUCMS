/**
 * Every pushed SOS / TEXT_BROADCAST / MEDIA_ALERT the player holds, keyed by
 * its signed `messageId` (2026-11-21, launch audit EMG-04).
 *
 * THE DEFECT THIS CLOSES. The page held ONE pushed message. Every push
 * replaced it, so an INFO "Early dismissal" banner sent while a CRITICAL
 * "SOS - Room 12" was on the glass took the SOS down; and every
 * ALL_CLEAR_MESSAGE set it to null without reading the id it carried, so
 * clearing the banner (or any district copy) left nothing on the glass until
 * the overlay's own poll re-found the SOS. Only the poll-only path
 * (`EmergencyOverlay`) ever ranked messages, and that poll is off while a
 * pushed message is held.
 *
 * THE RULE
 *   - Every push is kept under its own id. A second delivery of an id already
 *     held (a reconnect, a re-send) updates its content but keeps its place:
 *     its first-seen `createdAt` and arrival order. An identical re-delivery
 *     keeps the very same object, so nothing on the glass re-renders.
 *   - The glass shows ONE message, in the poll path's own order:
 *     `compareEmergencyMessages` (highest severity, then newest `createdAt`).
 *     The overlay sorts its poll with this same function, so the two paths
 *     cannot disagree. A complete tie (same severity, same `createdAt`) goes
 *     to the later arrival, so the choice is deterministic.
 *   - ALL_CLEAR_MESSAGE removes ONLY the id it names. A clear for an id this
 *     screen does not hold changes nothing. A clear with NO usable id also
 *     changes nothing - fail-safe toward over-alerting: the API signs
 *     `messageId` on every clear it sends (`emergency.controller.ts`,
 *     `clearMessage`), so an id-less one is malformed, and the server-confirmed
 *     reconcile below still takes off the glass anything the server stopped
 *     listing.
 *   - The server stays the arbiter, both ways. `reconcilePushedMessages`
 *     applies the existing two-miss rule (`reconcileStrandedEmergency`) to
 *     EVERY held id, not just the shown one, so a message whose clear was
 *     dropped cannot resurface from behind the one on the glass; and it adds
 *     a message the server lists for this screen that the page does not hold
 *     (a push that never arrived, or one the overlay's poll was showing), so
 *     a held INFO banner can no longer hide a CRITICAL the push missed. The
 *     answer it reads is the one the page already fetches - no new request.
 *     A poll that left before a message was delivered cannot count a miss
 *     against it (it could not have listed it), and a poll that was in flight
 *     while a signed clear landed may not add anything (it may still list the
 *     message that clear just took down).
 *   - Bounded. A message's own expiry (`expiresAt`, server epoch seconds) lets
 *     an entry that is NOT on the glass leave once it is past that expiry plus
 *     a grace - measured on the MONOTONIC clock from the moment it arrived, so
 *     a wall clock that steps later cannot move it. The message ON the glass
 *     never leaves on a clock alone (the rule since 2026-10-23: only a clear or
 *     the server-confirmed reconcile releases the glass), and an expired
 *     hidden entry leaves before a clear could bring it up. A hard cap drops
 *     the lowest-ranked entry, which is never the shown one.
 *
 * Signature, freshness and replay gates (`pushGate.ts`) run BEFORE anything
 * here; this module only decides what a gate-passed push does to the glass.
 *
 * PURE - no React, no DOM, no clock reads, no network. Unit-tested in
 * `__tests__/pushedMessages.test.ts`.
 */

import { sanitizeBannerOptions } from '@cms/api-types';
import type { PushedEmergencyMessage, PushedEmergencySeverity, PushedEmergencyType } from './pushedEmergencyMessage';
import { reconcileStrandedEmergency } from './emergencyReconcile';

// ── One ordering rule ───────────────────────────────────────────────────────

/** The fields the ordering reads. */
export interface RankedEmergencyMessage {
  severity: string;
  createdAt?: string | null;
}

/** Lower ranks first. An unknown severity ranks as CRITICAL (the mappers' own fail-safe default). */
const SEVERITY_RANK: Readonly<Record<string, number>> = { CRITICAL: 0, WARN: 1, INFO: 2 };
function severityRank(severity: string): number {
  return Object.prototype.hasOwnProperty.call(SEVERITY_RANK, severity) ? SEVERITY_RANK[severity] : 0;
}

/**
 * THE ordering of emergency messages on the player: highest severity first,
 * then newest `createdAt` (ISO strings compare in time order). This is the
 * `EmergencyOverlay` poll sort, moved here so the push path uses the same
 * function; the overlay now calls it.
 */
export function compareEmergencyMessages(a: RankedEmergencyMessage, b: RankedEmergencyMessage): number {
  return (severityRank(a.severity) - severityRank(b.severity))
    || String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? ''));
}

// ── One mapper for the poll ─────────────────────────────────────────────────

/**
 * A row of the device-authed `GET /emergency/messages` answer as the player
 * shows it (`toEmergencyMessageView` on the API). Shared by the overlay's own
 * poll and the page's reconcile, so both read a row the same way. Fields are
 * passed through as the overlay always passed them; the severity falls back
 * to CRITICAL like the push mapper's. A row with no string id keeps an empty
 * id (the overlay still shows it; the reconcile cannot key it and skips it).
 */
export function emergencyMessageFromPollRow(row: unknown): PushedEmergencyMessage {
  const r = (row && typeof row === 'object' ? row : {}) as Record<string, unknown>;
  const banner = sanitizeBannerOptions(r.banner);
  const severity = r.severity;
  return {
    id: typeof r.id === 'string' ? r.id : '',
    type: r.type as PushedEmergencyType,
    severity: (severity === 'INFO' || severity === 'WARN' || severity === 'CRITICAL' ? severity : 'CRITICAL') as PushedEmergencySeverity,
    textBlob: r.textBlob as string | null,
    mediaUrls: Array.isArray(r.mediaUrls) ? (r.mediaUrls as string[]) : [],
    audioUrl: r.audioUrl as string | null,
    expiresAt: r.expiresAt as number | null,
    createdAt: r.createdAt as string,
    ...(banner ? { banner } : {}),
  };
}

// ── The held set ────────────────────────────────────────────────────────────

/** Past its own expiry, a hidden message may leave this long after (covers the push freshness window and clock offset error). */
export const PUSHED_MESSAGE_EXPIRY_GRACE_MS = 60_000;
/** Most messages held at once (the API's own poll lists at most 50). */
export const MAX_PUSHED_MESSAGES = 50;

export interface PushedMessageEntry {
  readonly message: PushedEmergencyMessage;
  /** Arrival order - the last tie-break. */
  readonly seq: number;
  /** Consecutive successful `/emergency/messages` polls that did not list this id. */
  readonly misses: number;
  /** Monotonic ms of its latest delivery: a poll sent before this cannot count a miss against it. */
  readonly heldSinceMono: number;
  /** Monotonic ms after which this entry may leave while it is NOT shown; null = no expiry known. */
  readonly dropAfterMono: number | null;
}

export interface PushedMessages {
  readonly entries: ReadonlyMap<string, PushedMessageEntry>;
  readonly nextSeq: number;
}

export const EMPTY_PUSHED_MESSAGES: PushedMessages = Object.freeze({ entries: new Map<string, PushedMessageEntry>(), nextSeq: 0 });

/** The clock readings taken when something arrives (the page reads them; this module never does). */
export interface PushClock {
  /** `performance.now()` - monotonic. */
  monoNowMs: number;
  /** The server-corrected wall clock (`Date.now() + serverClockOffset`). */
  serverNowMs: number;
}

function rankEntries(a: PushedMessageEntry, b: PushedMessageEntry): number {
  return compareEmergencyMessages(a.message, b.message) || (b.seq - a.seq);
}

function shownEntry(entries: ReadonlyMap<string, PushedMessageEntry>): PushedMessageEntry | null {
  let best: PushedMessageEntry | null = null;
  entries.forEach((entry) => {
    if (!best || rankEntries(entry, best) < 0) best = entry;
  });
  return best;
}

/** The one message the glass shows, or null when none is held. */
export function shownPushedMessage(state: PushedMessages): PushedEmergencyMessage | null {
  return shownEntry(state.entries)?.message ?? null;
}

function dropAfter(message: PushedEmergencyMessage, clock: PushClock): number | null {
  if (typeof message.expiresAt !== 'number' || !Number.isFinite(message.expiresAt)) return null;
  const untilExpiryMs = Math.max(0, message.expiresAt * 1000 - clock.serverNowMs);
  return clock.monoNowMs + untilExpiryMs + PUSHED_MESSAGE_EXPIRY_GRACE_MS;
}

function sameContent(a: PushedEmergencyMessage, b: PushedEmergencyMessage): boolean {
  return a.type === b.type
    && a.severity === b.severity
    && a.textBlob === b.textBlob
    && a.audioUrl === b.audioUrl
    && a.expiresAt === b.expiresAt
    && a.mediaUrls.length === b.mediaUrls.length
    && a.mediaUrls.every((url, i) => url === b.mediaUrls[i])
    && JSON.stringify(a.banner ?? null) === JSON.stringify(b.banner ?? null);
}

function freshEntry(message: PushedEmergencyMessage, seq: number, clock: PushClock): PushedMessageEntry {
  return { message, seq, misses: 0, heldSinceMono: clock.monoNowMs, dropAfterMono: dropAfter(message, clock) };
}

/**
 * The end of every change: expired entries that are not on the glass leave
 * (`keepId` - the one shown before this change - never leaves on the clock),
 * then the cap drops the lowest-ranked.
 */
function settle(entries: Map<string, PushedMessageEntry>, nextSeq: number, keepId: string | null, monoNowMs: number): PushedMessages {
  Array.from(entries.entries()).forEach(([id, entry]) => {
    if (id !== keepId && entry.dropAfterMono !== null && monoNowMs > entry.dropAfterMono) entries.delete(id);
  });
  while (entries.size > MAX_PUSHED_MESSAGES) {
    // With two or more held, the lowest-ranked entry is never the shown one.
    let lowest: PushedMessageEntry | null = null;
    entries.forEach((entry) => {
      if (!lowest || rankEntries(entry, lowest) > 0) lowest = entry;
    });
    if (!lowest) break;
    entries.delete((lowest as PushedMessageEntry).message.id);
  }
  return { entries, nextSeq };
}

/**
 * Hold a message: a gate-passed push, or (from the page) the message the
 * overlay's own poll was showing when the first push took the overlay over.
 */
export function addPushedMessage(state: PushedMessages, message: PushedEmergencyMessage, clock: PushClock): PushedMessages {
  const keepId = shownEntry(state.entries)?.message.id ?? null;
  const entries = new Map(state.entries);
  const held = entries.get(message.id);
  let nextSeq = state.nextSeq;
  if (held) {
    const kept = sameContent(held.message, message) ? held.message : { ...message, createdAt: held.message.createdAt };
    entries.set(message.id, freshEntry(kept, held.seq, clock));
  } else {
    entries.set(message.id, freshEntry(message, nextSeq, clock));
    nextSeq += 1;
  }
  return settle(entries, nextSeq, keepId, clock.monoNowMs);
}

/**
 * The message id an ALL_CLEAR_MESSAGE names: the signed `messageId` (a
 * literal `id` is accepted, as the push mapper accepts one). Never the
 * envelope's eventId - that is the clear's own id, not a message's.
 */
export function pushedClearMessageId(payload: unknown): string | null {
  const p = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
  const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
  return str(p.messageId) ?? str(p.id);
}

/**
 * A gate-passed ALL_CLEAR_MESSAGE: remove the id it names and nothing else.
 * An unknown id, or no id, returns `state` itself (unchanged).
 */
export function clearPushedMessage(state: PushedMessages, messageId: string | null, monoNowMs: number): PushedMessages {
  if (!messageId || !state.entries.has(messageId)) return state;
  const shownId = shownEntry(state.entries)?.message.id ?? null;
  const entries = new Map(state.entries);
  entries.delete(messageId);
  return settle(entries, state.nextSeq, shownId === messageId ? null : shownId, monoNowMs);
}

/** One SUCCESSFUL `/emergency/messages` answer, as the page read it. */
export interface PollAnswer {
  /** The answer's `active` rows (`emergencyMessageFromPollRow`). */
  active: ReadonlyArray<PushedEmergencyMessage>;
  /** Monotonic ms when the request was SENT. */
  sentMono: number;
  /** False when a signed ALL_CLEAR_MESSAGE landed while it was in flight: it may still list what that clear took down. */
  mayAdd: boolean;
}

/**
 * One SUCCESSFUL poll: the two-miss rule for every held id, then any message
 * the server lists that is not held joins. A failed or offline poll must not
 * call this (the alert stays up). Returns `state` itself when nothing changed.
 */
export function reconcilePushedMessages(state: PushedMessages, answer: PollAnswer, clock: PushClock): PushedMessages {
  const listed = new Set<string>();
  answer.active.forEach((m) => { if (m.id) listed.add(m.id); });
  const shownId = shownEntry(state.entries)?.message.id ?? null;
  const entries = new Map(state.entries);
  let changed = false;
  state.entries.forEach((entry, id) => {
    // Delivered after this request left: the answer could not have listed it.
    if (!listed.has(id) && entry.heldSinceMono > answer.sentMono) return;
    const decision = reconcileStrandedEmergency(listed, id, entry.misses);
    if (decision.clear) {
      entries.delete(id);
      changed = true;
    } else if (decision.consecutiveMisses !== entry.misses) {
      entries.set(id, { ...entry, misses: decision.consecutiveMisses });
      changed = true;
    }
  });
  let nextSeq = state.nextSeq;
  if (answer.mayAdd) {
    answer.active.forEach((m) => {
      if (!m.id || entries.has(m.id)) return;
      entries.set(m.id, freshEntry(m, nextSeq, clock));
      nextSeq += 1;
      changed = true;
    });
  }
  if (!changed) return state;
  return settle(entries, nextSeq, shownId !== null && entries.has(shownId) ? shownId : null, clock.monoNowMs);
}

/** Ids held in `before` and gone from `after` - for the page's log line. */
export function removedPushedMessageIds(before: PushedMessages, after: PushedMessages): string[] {
  return Array.from(before.entries.keys()).filter((id) => !after.entries.has(id));
}

/** Ids held in `after` and not in `before` - for the page's log line. */
export function addedPushedMessageIds(before: PushedMessages, after: PushedMessages): string[] {
  return Array.from(after.entries.keys()).filter((id) => !before.entries.has(id));
}
