/**
 * console-pad-commands — how the volunteer scorekeeper pad (/console/<token>)
 * sends a tap, and what it says when one does not land (K-12 launch program,
 * register row K12-F16, on lane A1's command engine).
 *
 * The pad talks to the SAME command engine as the operator console:
 *   - every tap carries a durable command id (lib/game-op-queue newCommandId),
 *     so a retry of a tap whose response was lost is answered from the
 *     server's receipt instead of being applied twice (K12-F10);
 *   - a tap that got NO response at all (isNetworkFailure) and is one of the
 *     queue's kinds (score / clock / period / stats) is queued in a
 *     GameOpQueue under that same id and replayed when the connection is back
 *     (lib/game-op-replay — the operator console's replay triggers); any
 *     other kind is offered back to the volunteer as "Send again", with the
 *     same id;
 *   - Undo is the server's single-use inverse of THIS link's own latest
 *     action (POST /undo { undoOf: <its command id> }), so the pad remembers
 *     which of its taps the server now holds as the link's latest.
 *
 * Pure: no React, no DOM, no network — every rule is a unit test
 * (__tests__/console-pad-commands.test.ts). Connection truth (live / stale /
 * recovering) is NOT here: it is the shared freshness contract
 * (lib/sports-freshness + hooks/use-sports-link), the same one the board, the
 * ribbon, the scorebug and the operator console run.
 */
import type { ConsoleAction } from '@cms/api-types';
import type { GameOpKind } from './game-op-queue';

/** One console request (the command id is added by the sender). */
export interface PadStep {
  kind: ConsoleAction;
  path: string;
  method: 'PATCH' | 'POST';
  body: Record<string, unknown>;
}

/** Console kinds the offline queue can hold (all PATCH to the same path). */
const QUEUE_KIND: Partial<Record<ConsoleAction, GameOpKind>> = {
  score: 'score',
  clock: 'clock',
  segment: 'segment',
  stats: 'stats',
};

/** The GameOpQueue kind for a console action, or null when it is not queued. */
export function padQueueKind(kind: ConsoleAction): GameOpKind | null {
  return QUEUE_KIND[kind] ?? null;
}

/** The console path a queued op replays to. */
export function padQueuedPath(kind: GameOpKind): string {
  return kind === 'score' ? '/score' : kind === 'clock' ? '/clock' : kind === 'segment' ? '/segment' : '/stats';
}

/**
 * The actions whose command writes an event the server can undo (the undo
 * rail's SCORE / CLOCK / SEGMENT / STAT / TIMEOUT / POSSESSION / PENALTY).
 * A cue has already aired; a shot / play clock tap writes no event.
 */
const UNDOABLE: ReadonlySet<ConsoleAction> = new Set<ConsoleAction>([
  'score',
  'clock',
  'segment',
  'stats',
  'timeout',
  'possession',
  'penalties',
]);

/** The link's last action as the pad knows it — what Undo would reverse. */
export interface PadLastAction {
  commandId: string;
  label: string;
}

/**
 * What the pad holds as "this link's latest undoable action" after a tap
 * settles. The server undoes only the link's LATEST command, once:
 *   - a direct success of an undoable single-step action becomes the last
 *     action;
 *   - a shot / play clock tap (it has a receipt, so it is now the link's
 *     latest, but it cannot be undone) clears it;
 *   - a two-step action (the baseball half-inning: count, then inning) clears
 *     it — the server could reverse only its second half, which would leave a
 *     half-restored picture;
 *   - a tap that was queued, or whose fate is unknown (no response), clears
 *     it: the server's latest is not something the pad can name;
 *   - a cue leaves it alone (a cue carries no command receipt);
 *   - a refused tap leaves it alone (nothing was recorded).
 */
export function nextLastAction(
  prev: PadLastAction | null,
  outcome: 'ok' | 'queued' | 'unknown' | 'refused',
  step: PadStep,
  commandId: string,
  label: string,
  twoStep: boolean,
): PadLastAction | null {
  if (outcome === 'refused' || step.kind === 'cue') return prev;
  if (outcome !== 'ok' || twoStep) return null;
  if (!UNDOABLE.has(step.kind)) return null;
  return { commandId, label };
}

// ── when a tap does not land ────────────────────────────────────────

/** Why a tap did not land. `offline` = no response at all (it may or may
 *  not have reached the server — the volunteer must check the board). */
export type PadFailure =
  | 'offline'
  | 'not-permitted'
  | 'rate-limited'
  | 'final'
  | 'refused'
  | 'server'
  | 'undo-not-latest'
  | 'undo-conflict'
  | 'undo-gone'
  | 'undo-impossible';

/** Classify a failed console request by its HTTP status and the API's
 *  error `code` (null status = no response). */
export function classifyPadFailure(status: number | null, code?: unknown): PadFailure {
  if (status === null) return 'offline';
  if (code === 'GAME_FINAL') return 'final';
  if (code === 'CONSOLE_UNDO_NOT_LATEST') return 'undo-not-latest';
  if (code === 'UNDO_CONFLICT') return 'undo-conflict';
  if (code === 'CONSOLE_UNDO_NOT_FOUND') return 'undo-gone';
  if (code === 'BUG_NOT_UNDOABLE' || status === 422) return 'undo-impossible';
  if (status === 403) return 'not-permitted';
  if (status === 429) return 'rate-limited';
  if (status >= 500) return 'server';
  return 'refused';
}

/** A command the pad sent that did not land, kept on screen until dismissed.
 *  `retry` = the same request under the same command id (safe to resend: a
 *  copy that did land is answered from its receipt). */
export interface PadRejectedCommand {
  id: number;
  label: string;
  failure: PadFailure;
  at: number;
  retry?: { step: PadStep; commandId: string } | null;
}

/** Keep the newest few rejections (newest first) — enough to show what
 *  failed without growing forever on a long outage. */
export const PAD_MAX_REJECTED = 3;

export function pushRejected(list: PadRejectedCommand[], entry: PadRejectedCommand): PadRejectedCommand[] {
  return [entry, ...list].slice(0, PAD_MAX_REJECTED);
}

/**
 * The offline-queue namespace for ONE link in ONE tab. Kept apart from the
 * operator console's queue (`<gameId>`) so an operator who opens the pad in
 * the same tab never has the console's queued taps replayed under the link
 * (wrong actor, wrong scope). The token is folded through FNV-1a (a label,
 * not a secret — the token is already in this tab's URL).
 */
export function padQueueKey(gameId: string, token: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < token.length; i += 1) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `pad:${gameId}:${h.toString(16).padStart(8, '0')}`;
}
