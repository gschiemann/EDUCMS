/**
 * The player's remote question, drawn — RemoteDialog.tsx + useRemoteDialog.
 *
 * The page is a 15k-line component that cannot mount in jsdom, so the
 * harness below is a miniature of exactly the wiring page.tsx uses: the
 * Back authority (the APK's `edu-show-stop-overlay` and the raw Escape /
 * Backspace / GoBack / Back keys) cancels the question BEFORE it toggles the
 * menu, and the dialog is mounted INSIDE the menu so it unmounts with it.
 * `remoteDialogWiring.test.ts` checks page.tsx really is wired that way, and
 * `tests/e2e/player-unpair-confirm.spec.ts` drives the real page.
 */
import React, { StrictMode, useEffect, useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import {
  REMOTE_DIALOG_COPY,
  REMOTE_DIALOG_Z_INDEX,
  RemoteDialog,
  useRemoteDialog,
} from '../RemoteDialog';
import type { RemoteDialogKind, RemoteDialogOutcome } from '../remoteConfirm';

function Harness({ onAnswer, kind = 'unpair' }: { onAnswer: (o: RemoteDialogOutcome) => void; kind?: RemoteDialogKind }) {
  const [menuUp, setMenuUp] = useState(true);
  const { state, stateRef, dispatch } = useRemoteDialog(onAnswer);
  useEffect(() => {
    const onBack = () => {
      if (stateRef.current.open) {
        dispatch({ type: 'back' });
        return;
      }
      setMenuUp((up) => !up);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Backspace' || e.key === 'GoBack' || e.key === 'Back') {
        e.preventDefault();
        onBack();
      }
    };
    window.addEventListener('edu-show-stop-overlay', onBack);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('edu-show-stop-overlay', onBack);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [dispatch, stateRef]);
  return (
    <>
      {menuUp ? (
        <div data-testid="menu" style={{ position: 'absolute', top: 0, left: 0, width: 800, height: 600 }}>
          <button type="button" onClick={() => setMenuUp(false)}>Resume</button>
          <button
            type="button"
            data-testid="opener"
            onClick={() => dispatch({ type: 'open', kind, surface: 'paused', danger: kind === 'unpair' })}
          >
            Unpair device
          </button>
          {state.open ? (
            <RemoteDialog name={state.kind} {...REMOTE_DIALOG_COPY[state.kind]} focus={state.focus} onEvent={dispatch} />
          ) : null}
        </div>
      ) : (
        <div data-testid="content">content playing</div>
      )}
      {/* Something OTHER than Back that closes the menu (an alert does this). */}
      <button type="button" data-testid="force-resume" onClick={() => setMenuUp(false)}>force</button>
    </>
  );
}

const dialog = () => screen.queryByRole('alertdialog', { name: 'Unpair this screen?' });
const keep = () => screen.getByRole('button', { name: 'Keep paired' });
const unpair = () => screen.getByRole('button', { name: 'Unpair' });
const key = (k: string, init: KeyboardEventInit = {}) =>
  fireEvent.keyDown(document.activeElement || document.body, { key: k, ...init });
/** Let deferred work (the unmount check) run. */
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 10)); });

function open(onAnswer = jest.fn(), kind: RemoteDialogKind = 'unpair', strict = false) {
  const tree = <Harness onAnswer={onAnswer} kind={kind} />;
  const r = render(strict ? <StrictMode>{tree}</StrictMode> : tree);
  fireEvent.click(screen.getByTestId('opener'));
  return { onAnswer, r };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('opening', () => {
  it('parks the remote on "Keep paired": DOM focus AND the drawn highlight (from state, not :focus-visible)', () => {
    open();
    expect(dialog()).toBeInTheDocument();
    expect(dialog()).toHaveAccessibleDescription(REMOTE_DIALOG_COPY.unpair.body);
    expect(keep()).toHaveFocus();
    expect(keep()).toHaveAttribute('data-remote-parked', 'true');
    expect(unpair()).not.toHaveAttribute('data-remote-parked');
    // The loud amber ring is an inline style tied to the parked answer.
    expect(keep().style.outline).toContain('solid');
    expect(unpair().style.outline).toBe('none');
  });
});

describe('the remote drives it', () => {
  it('arrows move between the two answers and never reach anything behind it', () => {
    open();
    const behind = jest.fn();
    document.addEventListener('keydown', behind);
    expect(key('ArrowRight')).toBe(false); // default prevented: no spatial nav, no scroll
    expect(unpair()).toHaveFocus();
    expect(unpair()).toHaveAttribute('data-remote-parked', 'true');
    key('ArrowLeft');
    expect(keep()).toHaveFocus();
    key('ArrowDown');
    expect(unpair()).toHaveFocus();
    key('ArrowUp');
    expect(keep()).toHaveFocus();
    expect(behind).not.toHaveBeenCalled();
    document.removeEventListener('keydown', behind);
  });

  it('Tab and Shift+Tab stay inside it', () => {
    open();
    key('Tab');
    expect(unpair()).toHaveFocus();
    key('Tab', { shiftKey: true });
    expect(keep()).toHaveFocus();
  });

  it('OK on "Keep paired" cancels — and puts the menu back, not the content', () => {
    const { onAnswer } = open();
    expect(key('Enter')).toBe(false);
    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(onAnswer).toHaveBeenCalledWith({ kind: 'unpair', result: 'cancel', reason: 'answer' });
    expect(dialog()).toBeNull();
    expect(screen.getByTestId('menu')).toBeInTheDocument();
  });

  it('OK on "Unpair" confirms, exactly once', () => {
    const { onAnswer } = open();
    key('ArrowRight');
    key('Enter');
    key('Enter');
    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(onAnswer).toHaveBeenCalledWith({ kind: 'unpair', result: 'confirm', reason: 'answer' });
    expect(dialog()).toBeNull();
  });

  it('a HELD OK never answers: auto-repeat is swallowed (the press that opened it cannot also answer it)', () => {
    const { onAnswer } = open();
    key('ArrowRight');
    expect(key('Enter', { repeat: true })).toBe(false);
    expect(onAnswer).not.toHaveBeenCalled();
    expect(dialog()).toBeInTheDocument();
  });

  it('Space answers on keydown; while it is up, a Space keyup can never click a button natively', () => {
    const { onAnswer } = open();
    // A keyup with no keydown of ours (e.g. a Space held from before): swallowed.
    expect(fireEvent.keyUp(document.activeElement as Element, { key: ' ' })).toBe(false);
    expect(onAnswer).not.toHaveBeenCalled();
    expect(key(' ')).toBe(false);
    expect(onAnswer).toHaveBeenCalledWith({ kind: 'unpair', result: 'cancel', reason: 'answer' });
  });

  it('the DPAD_CENTER legacy key code is OK too', () => {
    const { onAnswer } = open();
    key('Unidentified', { keyCode: 23 });
    expect(onAnswer).toHaveBeenCalledWith({ kind: 'unpair', result: 'cancel', reason: 'answer' });
  });
});

describe('Back cancels the question, and only the question', () => {
  it("the APK's Back (edu-show-stop-overlay) closes it and leaves the menu up", () => {
    const { onAnswer } = open();
    key('ArrowRight'); // even parked on Unpair
    act(() => { window.dispatchEvent(new CustomEvent('edu-show-stop-overlay')); });
    expect(onAnswer).toHaveBeenCalledWith({ kind: 'unpair', result: 'cancel', reason: 'back' });
    expect(dialog()).toBeNull();
    expect(screen.getByTestId('menu')).toBeInTheDocument();
    // …and the next Back is the menu's own toggle again.
    act(() => { window.dispatchEvent(new CustomEvent('edu-show-stop-overlay')); });
    expect(screen.queryByTestId('menu')).toBeNull();
    expect(screen.getByTestId('content')).toBeInTheDocument();
    expect(onAnswer).toHaveBeenCalledTimes(1);
  });

  it.each(['Escape', 'Backspace', 'GoBack', 'Back'])('the raw remote key %s does the same', (k) => {
    const { onAnswer } = open();
    key(k);
    expect(onAnswer).toHaveBeenCalledWith({ kind: 'unpair', result: 'cancel', reason: 'back' });
    expect(screen.getByTestId('menu')).toBeInTheDocument();
  });

  it('Back keys are not the dialog\'s own to handle — the page\'s Back authority owns them', () => {
    const onEvent = jest.fn();
    render(<RemoteDialog name="unpair" {...REMOTE_DIALOG_COPY.unpair} focus="safe" onEvent={onEvent} />);
    expect(fireEvent.keyDown(document.body, { key: 'Escape' })).toBe(true);
    expect(onEvent).not.toHaveBeenCalledWith({ type: 'back' });
  });
});

describe('it never outlives its menu', () => {
  it('the menu closing by any other path unmounts it, and the machine closes as "cancel"', async () => {
    const { onAnswer } = open();
    key('ArrowRight'); // parked on Unpair — must still not confirm
    fireEvent.click(screen.getByTestId('force-resume'));
    expect(dialog()).toBeNull();
    await flush();
    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(onAnswer).toHaveBeenCalledWith({ kind: 'unpair', result: 'cancel', reason: 'surface-closed' });
  });

  it("React StrictMode's dev-only unmount/remount does not close it", async () => {
    const { onAnswer } = open(jest.fn(), 'unpair', true);
    await flush();
    expect(dialog()).toBeInTheDocument();
    expect(onAnswer).not.toHaveBeenCalled();
    expect(keep()).toHaveFocus();
  });
});

describe('touch and mouse still work', () => {
  it('a tap on Unpair confirms; a tap on Keep paired cancels', () => {
    const first = open();
    fireEvent.click(unpair());
    expect(first.onAnswer).toHaveBeenCalledWith({ kind: 'unpair', result: 'confirm', reason: 'answer' });
    first.r.unmount();
    const second = open();
    fireEvent.click(keep());
    expect(second.onAnswer).toHaveBeenCalledWith({ kind: 'unpair', result: 'cancel', reason: 'answer' });
  });

  it('a tap outside the card is Back; a tap inside the card (not a button) does nothing', () => {
    const { onAnswer } = open();
    fireEvent.click(screen.getByText(REMOTE_DIALOG_COPY.unpair.body));
    expect(onAnswer).not.toHaveBeenCalled();
    fireEvent.click(document.querySelector('[data-edu-remote-dialog="unpair"]') as Element);
    expect(onAnswer).toHaveBeenCalledWith({ kind: 'unpair', result: 'cancel', reason: 'back' });
  });
});

describe('a one-answer notice', () => {
  it('"Nothing to play yet" has only OK; the arrows go nowhere; OK closes it as a cancel', () => {
    const { onAnswer } = open(jest.fn(), 'nothing-to-play');
    expect(screen.getByRole('alertdialog', { name: 'Nothing to play yet' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Unpair' })).toBeNull();
    const ok = screen.getByRole('button', { name: 'OK' });
    expect(ok).toHaveFocus();
    key('ArrowRight');
    key('Tab');
    expect(ok).toHaveFocus();
    key('Enter');
    expect(onAnswer).toHaveBeenCalledWith({ kind: 'nothing-to-play', result: 'cancel', reason: 'answer' });
  });
});

describe('Chromium-83 (Taurus) and the alert layers', () => {
  it('the scrim uses two physical sides plus a size (never four — CLAUDE.md #10) and sits below every alert layer', () => {
    open();
    const scrim = document.querySelector('[data-edu-remote-dialog="unpair"]') as HTMLElement;
    expect(scrim.style.top).toBe('0px');
    expect(scrim.style.left).toBe('0px');
    expect(scrim.style.right).toBe('');
    expect(scrim.style.bottom).toBe('');
    expect(scrim.getAttribute('style') || '').not.toMatch(/inset/);
    expect(Number(scrim.style.zIndex)).toBe(REMOTE_DIALOG_Z_INDEX);
    // Below the soft blank (9990) and the emergency fallback / overlay (9998 / 9999).
    expect(REMOTE_DIALOG_Z_INDEX).toBeLessThan(9990);
  });
});
