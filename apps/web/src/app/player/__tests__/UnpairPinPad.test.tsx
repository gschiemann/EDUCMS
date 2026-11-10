/**
 * The screen-PIN keypad, drawn (UnpairPinPad.tsx + usePinPad), in a miniature
 * of the page's wiring: the page's Back authority cancels the pad before it
 * toggles anything, and the page lets Backspace through to the pad.
 */
import React, { useEffect } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { UnpairPinPad, usePinPad, type PinPadCopy } from '../UnpairPinPad';

const copy: PinPadCopy = {
  title: 'Enter the screen PIN', body: 'body', hint: 'hint', deleteLabel: 'Delete', okLabel: 'OK',
  wrong: 'Wrong PIN', locked: 'Locked', unreachable: 'Unreachable', required: 'Required', checking: 'Checking',
};

function Harness({ onSubmit, onCancel, onMenuToggle }: { onSubmit: (pin: string) => void; onCancel: () => void; onMenuToggle: () => void }) {
  const { state, stateRef, dispatch } = usePinPad({ onSubmit, onCancel });
  useEffect(() => {
    dispatch({ type: 'open' });
    const onBack = () => {
      if (stateRef.current.open) { dispatch({ type: 'back' }); return; }
      onMenuToggle();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Backspace' && stateRef.current.open) return;
      if (e.key === 'Escape' || e.key === 'Backspace' || e.key === 'GoBack' || e.key === 'Back') { e.preventDefault(); onBack(); }
    };
    window.addEventListener('edu-show-stop-overlay', onBack);
    window.addEventListener('keydown', onKey, true);
    return () => { window.removeEventListener('edu-show-stop-overlay', onBack); window.removeEventListener('keydown', onKey, true); };
  }, [dispatch, stateRef, onMenuToggle]);
  return state.open ? <UnpairPinPad state={state} copy={copy} onEvent={dispatch} /> : <div data-testid="closed" />;
}

const key = (k: string, extra: Partial<KeyboardEventInit> = {}) => act(() => { fireEvent.keyDown(window, { key: k, ...extra }); });
const parked = () => document.querySelector('[data-remote-parked="true"]')?.getAttribute('data-pin-key');

it('opens parked on "1" with a visible highlight and DOM focus on it', () => {
  render(<Harness onSubmit={jest.fn()} onCancel={jest.fn()} onMenuToggle={jest.fn()} />);
  expect(screen.getByText('Enter the screen PIN')).toBeTruthy();
  expect(parked()).toBe('1');
  expect(document.activeElement?.getAttribute('data-pin-key')).toBe('1');
});

it('the remote enters a PIN with arrows and OK; dots never show digits', () => {
  const onSubmit = jest.fn();
  render(<Harness onSubmit={onSubmit} onCancel={jest.fn()} onMenuToggle={jest.fn()} />);
  key('Enter'); // 1
  key('ArrowRight'); key('Enter'); // 2
  key('ArrowRight'); key('Enter'); // 3
  key('ArrowDown'); key('Enter'); // 6
  const dots = document.querySelector('[data-edu-unpair-pin-dots]')!.textContent!;
  expect(dots).toBe('●●●●');
  expect(document.body.textContent).not.toContain('1236');
  key('ArrowDown'); key('ArrowDown'); key('Enter'); // ok (row 3, col 2)
  expect(onSubmit).toHaveBeenCalledWith('1236');
  expect(document.querySelector('[data-edu-unpair-pin-message]')!.getAttribute('data-edu-unpair-pin-message')).toBe('checking');
});

it('a held OK never presses (auto-repeat swallowed)', () => {
  render(<Harness onSubmit={jest.fn()} onCancel={jest.fn()} onMenuToggle={jest.fn()} />);
  key('Enter', { repeat: true });
  expect(document.querySelector('[data-edu-unpair-pin-dots]')!.textContent).toBe('○○○○');
});

it('a USB keyboard: digits, Backspace deletes (not Back), Enter submits', () => {
  const onSubmit = jest.fn();
  const onCancel = jest.fn();
  render(<Harness onSubmit={onSubmit} onCancel={onCancel} onMenuToggle={jest.fn()} />);
  for (const d of ['4', '8', '9']) key(d);
  key('Backspace');
  key('2'); key('1');
  expect(onCancel).not.toHaveBeenCalled();
  expect(parked()).toBe('ok');
  key('Enter');
  expect(onSubmit).toHaveBeenCalledWith('4821');
});

it('Back always escapes: the APK event, Escape, and GoBack — and never reaches the menu', () => {
  for (const back of [() => act(() => { window.dispatchEvent(new Event('edu-show-stop-overlay')); }), () => key('Escape'), () => key('GoBack')]) {
    const onCancel = jest.fn();
    const onMenuToggle = jest.fn();
    const { unmount } = render(<Harness onSubmit={jest.fn()} onCancel={onCancel} onMenuToggle={onMenuToggle} />);
    back();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onMenuToggle).not.toHaveBeenCalled();
    expect(screen.getByTestId('closed')).toBeTruthy();
    unmount();
  }
});

it('a tap on a key presses it; a tap on the scrim is Back', () => {
  const onCancel = jest.fn();
  render(<Harness onSubmit={jest.fn()} onCancel={onCancel} onMenuToggle={jest.fn()} />);
  fireEvent.click(document.querySelector('[data-pin-key="7"]')!);
  expect(document.querySelector('[data-edu-unpair-pin-dots]')!.textContent).toBe('●○○○');
  fireEvent.click(document.querySelector('[data-edu-unpair-pin]')!);
  expect(onCancel).toHaveBeenCalledTimes(1);
});

it('Chromium-83 safe: no inset, no four-sided style object, no flex gap', () => {
  render(<Harness onSubmit={jest.fn()} onCancel={jest.fn()} onMenuToggle={jest.fn()} />);
  for (const el of Array.from(document.querySelectorAll('[style]'))) {
    const s = el.getAttribute('style') || '';
    expect(s).not.toMatch(/inset/);
    expect(s).not.toMatch(/(^|;)\s*gap:/);
  }
});
