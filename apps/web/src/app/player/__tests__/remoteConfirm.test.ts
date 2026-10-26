/**
 * The player's remote question — the state machine (remoteConfirm.ts).
 *
 * 2026-10-26, a Goodview 24" on site: Unpair opened the dashboard's dialog,
 * the remote could not reach it, and Back closed the menu UNDER it so it sat
 * over playing content until a restart. These cases pin every rule the fix
 * rests on: parked on the safe answer, Back cancels only the question, and it
 * closes as "cancel" whenever its menu closes or an alert arrives — once.
 */
import {
  REMOTE_DIALOG_CLOSED,
  isRemoteOkKey,
  remoteMoveForKey,
  remoteSurfaceStillUp,
  stepRemoteDialog,
  type RemoteDialogEvent,
  type RemoteDialogOutcome,
  type RemoteDialogState,
} from '../remoteConfirm';

/** Feed events in order; collect every outcome the machine reports. */
function run(events: RemoteDialogEvent[], from: RemoteDialogState = REMOTE_DIALOG_CLOSED) {
  let state = from;
  const outcomes: RemoteDialogOutcome[] = [];
  for (const e of events) {
    const step = stepRemoteDialog(state, e);
    state = step.state;
    if (step.outcome) outcomes.push(step.outcome);
  }
  return { state, outcomes };
}

const OPEN_UNPAIR: RemoteDialogEvent = { type: 'open', kind: 'unpair', surface: 'paused', danger: true };
const OPEN_NOTICE: RemoteDialogEvent = { type: 'open', kind: 'nothing-to-play', surface: 'idle', danger: false };

describe('open', () => {
  it('opens parked on the SAFE answer ("Keep paired"), never on Unpair', () => {
    const { state, outcomes } = run([OPEN_UNPAIR]);
    expect(state).toEqual({ open: true, kind: 'unpair', surface: 'paused', danger: true, focus: 'safe' });
    expect(outcomes).toEqual([]);
  });

  it('a second open while one is up changes nothing (the parked answer is kept)', () => {
    const before = run([OPEN_UNPAIR, { type: 'move', direction: 'next' }]).state;
    const step = stepRemoteDialog(before, OPEN_UNPAIR);
    expect(step.state).toBe(before);
    expect(step.outcome).toBeNull();
  });
});

describe('the six answers the remote can give', () => {
  it('Back cancels it', () => {
    const { state, outcomes } = run([OPEN_UNPAIR, { type: 'back' }]);
    expect(state.open).toBe(false);
    expect(outcomes).toEqual([{ kind: 'unpair', result: 'cancel', reason: 'back' }]);
  });

  it('Back cancels even when the remote was parked on Unpair', () => {
    const { outcomes } = run([OPEN_UNPAIR, { type: 'move', direction: 'next' }, { type: 'back' }]);
    expect(outcomes).toEqual([{ kind: 'unpair', result: 'cancel', reason: 'back' }]);
  });

  it('the menu closing (Resume / menu toggled away / page left that state) cancels it', () => {
    const { state, outcomes } = run([OPEN_UNPAIR, { type: 'move', direction: 'next' }, { type: 'surface-closed' }]);
    expect(state.open).toBe(false);
    expect(outcomes).toEqual([{ kind: 'unpair', result: 'cancel', reason: 'surface-closed' }]);
  });

  it('an emergency cancels it — even parked on Unpair, an alert never confirms', () => {
    const { state, outcomes } = run([OPEN_UNPAIR, { type: 'move', direction: 'next' }, { type: 'emergency' }]);
    expect(state.open).toBe(false);
    expect(outcomes).toEqual([{ kind: 'unpair', result: 'cancel', reason: 'emergency' }]);
  });

  it('OK on "Keep paired" cancels it', () => {
    const { state, outcomes } = run([OPEN_UNPAIR, { type: 'activate' }]);
    expect(state.open).toBe(false);
    expect(outcomes).toEqual([{ kind: 'unpair', result: 'cancel', reason: 'answer' }]);
  });

  it('OK on "Unpair" confirms it', () => {
    const { state, outcomes } = run([OPEN_UNPAIR, { type: 'move', direction: 'next' }, { type: 'activate' }]);
    expect(state.open).toBe(false);
    expect(outcomes).toEqual([{ kind: 'unpair', result: 'confirm', reason: 'answer' }]);
  });
});

describe('moving with the arrows', () => {
  it('next goes to Unpair, prev comes back — no wrap, so a long press cannot overshoot', () => {
    let s = run([OPEN_UNPAIR]).state;
    const at = (st: RemoteDialogState) => (st.open ? st.focus : null);
    s = stepRemoteDialog(s, { type: 'move', direction: 'next' }).state;
    expect(at(s)).toBe('danger');
    const again = stepRemoteDialog(s, { type: 'move', direction: 'next' });
    expect(again.state).toBe(s); // already there: same object, no re-render
    s = stepRemoteDialog(s, { type: 'move', direction: 'prev' }).state;
    expect(at(s)).toBe('safe');
    expect(stepRemoteDialog(s, { type: 'move', direction: 'prev' }).state).toBe(s);
  });

  it('DOM focus landing on an answer (mouse press, screen reader) parks the remote there', () => {
    const s = run([OPEN_UNPAIR, { type: 'focus', answer: 'danger' }]).state;
    expect(s.open && s.focus).toBe('danger');
  });

  it('a tap / click answers the button it hit, whatever the remote was parked on', () => {
    expect(run([OPEN_UNPAIR, { type: 'choose', answer: 'danger' }]).outcomes)
      .toEqual([{ kind: 'unpair', result: 'confirm', reason: 'answer' }]);
    expect(run([OPEN_UNPAIR, { type: 'move', direction: 'next' }, { type: 'choose', answer: 'safe' }]).outcomes)
      .toEqual([{ kind: 'unpair', result: 'cancel', reason: 'answer' }]);
  });
});

describe('it answers exactly once', () => {
  it('every event after the close is a no-op — a late close can neither re-run nor undo the answer', () => {
    const { state, outcomes } = run([
      OPEN_UNPAIR,
      { type: 'move', direction: 'next' },
      { type: 'activate' },
      // Everything that can arrive late: the surface unmounting, the alert
      // effect, a second OK, a stray Back.
      { type: 'surface-closed' },
      { type: 'emergency' },
      { type: 'activate' },
      { type: 'choose', answer: 'danger' },
      { type: 'back' },
    ]);
    expect(state).toBe(REMOTE_DIALOG_CLOSED);
    expect(outcomes).toEqual([{ kind: 'unpair', result: 'confirm', reason: 'answer' }]);
  });

  it('nothing but open does anything while closed (returns the same object)', () => {
    for (const e of [
      { type: 'back' },
      { type: 'activate' },
      { type: 'surface-closed' },
      { type: 'emergency' },
      { type: 'move', direction: 'next' },
      { type: 'focus', answer: 'danger' },
      { type: 'choose', answer: 'danger' },
    ] as RemoteDialogEvent[]) {
      const step = stepRemoteDialog(REMOTE_DIALOG_CLOSED, e);
      expect(step.state).toBe(REMOTE_DIALOG_CLOSED);
      expect(step.outcome).toBeNull();
    }
  });

  it('it can be asked again after a cancel, and opens parked on the safe answer again', () => {
    const { state } = run([OPEN_UNPAIR, { type: 'move', direction: 'next' }, { type: 'back' }, OPEN_UNPAIR]);
    expect(state.open && state.focus).toBe('safe');
  });
});

describe('a one-answer notice ("Nothing to play yet")', () => {
  it('has nowhere to move, and every close — OK included — is a cancel', () => {
    const opened = run([OPEN_NOTICE]).state;
    expect(stepRemoteDialog(opened, { type: 'move', direction: 'next' }).state).toBe(opened);
    expect(stepRemoteDialog(opened, { type: 'focus', answer: 'danger' }).state).toBe(opened);
    expect(run([OPEN_NOTICE, { type: 'activate' }]).outcomes)
      .toEqual([{ kind: 'nothing-to-play', result: 'cancel', reason: 'answer' }]);
    expect(run([OPEN_NOTICE, { type: 'choose', answer: 'danger' }]).outcomes)
      .toEqual([{ kind: 'nothing-to-play', result: 'cancel', reason: 'answer' }]);
    expect(run([OPEN_NOTICE, { type: 'back' }]).outcomes)
      .toEqual([{ kind: 'nothing-to-play', result: 'cancel', reason: 'back' }]);
  });
});

describe('remoteSurfaceStillUp — which variant of the paired card is showing', () => {
  it('a question from the Back menu lives only while the menu is up', () => {
    const s = run([OPEN_UNPAIR]).state;
    expect(remoteSurfaceStillUp(s, true)).toBe(true);
    expect(remoteSurfaceStillUp(s, false)).toBe(false); // Resume: the menu is gone
  });

  it('a question from the idle card dies when Back turns the card into the menu', () => {
    const s = run([{ type: 'open', kind: 'unpair', surface: 'idle', danger: true }]).state;
    expect(remoteSurfaceStillUp(s, false)).toBe(true);
    expect(remoteSurfaceStillUp(s, true)).toBe(false);
  });

  it('nothing is up when closed', () => {
    expect(remoteSurfaceStillUp(REMOTE_DIALOG_CLOSED, true)).toBe(false);
    expect(remoteSurfaceStillUp(REMOTE_DIALOG_CLOSED, false)).toBe(false);
  });
});

describe('remote keys', () => {
  it('OK is Enter (Android maps DPAD_CENTER to it), Select, Accept, Space, and the legacy key codes', () => {
    for (const key of ['Enter', 'NumpadEnter', 'Select', 'Accept', ' ', 'Spacebar']) {
      expect(isRemoteOkKey({ key })).toBe(true);
    }
    expect(isRemoteOkKey({ key: 'Unidentified', keyCode: 23 })).toBe(true);
    expect(isRemoteOkKey({ keyCode: 13 })).toBe(true);
    for (const key of ['Escape', 'Backspace', 'GoBack', 'ArrowRight', 'Tab', 'a', 'Home']) {
      expect(isRemoteOkKey({ key })).toBe(false);
    }
    expect(isRemoteOkKey({ key: 'Unidentified', keyCode: 4 })).toBe(false);
  });

  it('left / up go towards the safe answer, right / down towards the other one', () => {
    expect(remoteMoveForKey('ArrowLeft')).toBe('prev');
    expect(remoteMoveForKey('ArrowUp')).toBe('prev');
    expect(remoteMoveForKey('ArrowRight')).toBe('next');
    expect(remoteMoveForKey('ArrowDown')).toBe('next');
    expect(remoteMoveForKey('Left')).toBe('prev');
    expect(remoteMoveForKey('Down')).toBe('next');
    expect(remoteMoveForKey('Enter')).toBeNull();
    expect(remoteMoveForKey('Escape')).toBeNull();
    expect(remoteMoveForKey(undefined)).toBeNull();
  });
});
