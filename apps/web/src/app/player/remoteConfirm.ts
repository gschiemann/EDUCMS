/**
 * Remote question — the player's own dialog, answered with a D-pad.
 *
 * WHY THIS EXISTS (2026-10-26, a Goodview 24" panel on site). Back opened the
 * Screen options menu; the owner pressed Unpair by accident and got the
 * DASHBOARD's confirm dialog (`appConfirm`, a portal outside the player's
 * remote handling). The remote could not reach its buttons, so it could be
 * neither cancelled nor confirmed. The APK delivers Back as
 * `edu-show-stop-overlay`, which that dialog never listened to: Back closed the
 * menu underneath it, content resumed, and the question stayed drawn over the
 * content until the app was restarted. It also sat at z-index 10000, above the
 * emergency overlay's 9999.
 *
 * This file is the whole state machine and it is pure (no React, no DOM, no
 * timers), so every rule is unit-tested in `__tests__/remoteConfirm.test.ts`:
 *
 *  1. It opens PARKED ON THE SAFE ANSWER ("Keep paired"). A reflex OK never
 *     does the destructive thing.
 *  2. The arrows move between the answers; OK answers the one the remote is
 *     parked on; a tap or a click answers the one it hit.
 *  3. Back cancels it, and only it: the menu it came from stays up.
 *  4. It never outlives the surface that opened it. That surface closing
 *     (Resume, the menu toggled away, the page leaving that state) or an
 *     emergency hold starting closes it, and the answer is "cancel".
 *  5. It answers exactly ONCE. Every event after it closes is a no-op, so a
 *     late close signal can never run an answer twice or undo one.
 *
 * A one-answer NOTICE (no destructive answer, e.g. "Nothing to play yet") is
 * the same machine with `danger: false`: the arrows have nowhere to go and
 * every close is a "cancel".
 */

/** The two answers. `safe` is where the remote is parked when it opens. */
export type RemoteAnswer = 'safe' | 'danger';

/** Which surface opened the question — the Back menu, or the idle paired card. */
export type RemoteSurface = 'paused' | 'idle';

export type RemoteDialogKind = 'unpair' | 'nothing-to-play';

export type RemoteDialogState =
  | { readonly open: false }
  | {
      readonly open: true;
      readonly kind: RemoteDialogKind;
      readonly surface: RemoteSurface;
      /** Whether a destructive second answer exists (false = a notice). */
      readonly danger: boolean;
      /** The answer the remote is parked on. */
      readonly focus: RemoteAnswer;
    };

export type RemoteDialogEvent =
  | { readonly type: 'open'; readonly kind: RemoteDialogKind; readonly surface: RemoteSurface; readonly danger: boolean }
  /** An arrow key. `prev` = left / up (towards "Keep paired"), `next` = right / down. */
  | { readonly type: 'move'; readonly direction: 'prev' | 'next' }
  /** DOM focus landed on an answer (a mouse press, a screen reader). Never a hover. */
  | { readonly type: 'focus'; readonly answer: RemoteAnswer }
  /** OK / Enter: answer the one the remote is parked on. */
  | { readonly type: 'activate' }
  /** A tap or a click on one answer. */
  | { readonly type: 'choose'; readonly answer: RemoteAnswer }
  | { readonly type: 'back' }
  /** The surface that opened it is gone (Resume, menu closed, page left that state). */
  | { readonly type: 'surface-closed' }
  /** An alert is on the glass. An alert always wins. */
  | { readonly type: 'emergency' };

export type RemoteCloseReason = 'answer' | 'back' | 'surface-closed' | 'emergency';

export interface RemoteDialogOutcome {
  readonly kind: RemoteDialogKind;
  /** `confirm` ONLY when the destructive answer was given. Every other close is `cancel`. */
  readonly result: 'confirm' | 'cancel';
  readonly reason: RemoteCloseReason;
}

export interface RemoteDialogStep {
  readonly state: RemoteDialogState;
  /** Set exactly when THIS event closed the dialog. */
  readonly outcome: RemoteDialogOutcome | null;
}

export const REMOTE_DIALOG_CLOSED: RemoteDialogState = Object.freeze({ open: false as const });

function close(
  state: Extract<RemoteDialogState, { open: true }>,
  answered: RemoteAnswer | null,
  reason: RemoteCloseReason,
): RemoteDialogStep {
  return {
    state: REMOTE_DIALOG_CLOSED,
    outcome: {
      kind: state.kind,
      result: answered === 'danger' && state.danger ? 'confirm' : 'cancel',
      reason,
    },
  };
}

/**
 * One event in, the next state (and the answer, when this event closed it).
 * Returns the SAME state object when nothing changed, so a caller can skip a
 * re-render with an identity check.
 */
export function stepRemoteDialog(state: RemoteDialogState, event: RemoteDialogEvent): RemoteDialogStep {
  if (!state.open) {
    if (event.type !== 'open') return { state, outcome: null };
    return {
      state: { open: true, kind: event.kind, surface: event.surface, danger: event.danger, focus: 'safe' },
      outcome: null,
    };
  }
  switch (event.type) {
    case 'open':
      // Already asking. The question on the glass keeps its parked answer.
      return { state, outcome: null };
    case 'move': {
      const focus: RemoteAnswer = event.direction === 'next' && state.danger ? 'danger' : 'safe';
      return focus === state.focus ? { state, outcome: null } : { state: { ...state, focus }, outcome: null };
    }
    case 'focus': {
      const focus: RemoteAnswer = event.answer === 'danger' && state.danger ? 'danger' : 'safe';
      return focus === state.focus ? { state, outcome: null } : { state: { ...state, focus }, outcome: null };
    }
    case 'activate':
      return close(state, state.focus, 'answer');
    case 'choose':
      return close(state, event.answer, 'answer');
    case 'back':
      return close(state, null, 'back');
    case 'surface-closed':
      return close(state, null, 'surface-closed');
    case 'emergency':
      return close(state, null, 'emergency');
    default:
      return { state, outcome: null };
  }
}

/**
 * Is the surface that opened the question still the one on the glass?
 * `playbackStopped` decides which variant of the paired card is showing: the
 * Back menu (paused) or the idle card. Anything else means it closed.
 */
export function remoteSurfaceStillUp(state: RemoteDialogState, playbackStopped: boolean): boolean {
  if (!state.open) return false;
  return state.surface === (playbackStopped ? 'paused' : 'idle');
}

/**
 * The keys a remote's OK button arrives as. Android WebView maps
 * DPAD_CENTER and ENTER to `Enter`; some TV stacks report `Select` or
 * `Accept`; a keyboard's Space activates a focused button too.
 */
export function isRemoteOkKey(e: { key?: string; keyCode?: number }): boolean {
  const k = e.key;
  if (k === 'Enter' || k === 'NumpadEnter' || k === 'Select' || k === 'Accept' || k === ' ' || k === 'Spacebar') return true;
  // Legacy remotes report no `key` (or "Unidentified"): 13 = Enter, 23 = DPAD_CENTER.
  if (!k || k === 'Unidentified') return e.keyCode === 13 || e.keyCode === 23;
  return false;
}

/** Arrow keys → a move, or null. Up/left go towards the safe answer. */
export function remoteMoveForKey(key: string | undefined): 'prev' | 'next' | null {
  if (key === 'ArrowLeft' || key === 'ArrowUp' || key === 'Left' || key === 'Up') return 'prev';
  if (key === 'ArrowRight' || key === 'ArrowDown' || key === 'Right' || key === 'Down') return 'next';
  return null;
}
