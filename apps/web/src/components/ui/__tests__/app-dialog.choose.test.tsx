/**
 * `appChoose` — a question with THREE answers (2026-10-24, launch QA U15).
 *
 * First use: "Keep both" / "Replace everything" / Cancel when a time-limited
 * playlist lands on screens that run an always-on one. The default ("Keep
 * both") is the focused button — the safe answer is the reflex answer — and
 * every way out that is not a click on an answer (Escape, the close button,
 * the backdrop) is Cancel, never one of the two writes.
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { appChoose, AppDialogHost, type AppChoice } from '../app-dialog';

function ask(): Promise<AppChoice> {
  let p!: Promise<AppChoice>;
  act(() => {
    p = appChoose({
      title: 'Keep “Lobby loop” playing the rest of the time?',
      message: 'x',
      tone: 'warn',
      confirmLabel: 'Keep both',
      alternateLabel: 'Replace everything',
      cancelLabel: 'Cancel',
    });
  });
  return p;
}

const raf = () => new Promise((r) => requestAnimationFrame(() => r(undefined)));

// The dialog registry is a module singleton: a case that fails before it
// answers must not leave its dialog queued in front of the next case's.
afterEach(() => {
  for (let i = 0; i < 5 && document.querySelector('[role="dialog"]'); i++) {
    fireEvent.keyDown(window, { key: 'Escape' });
  }
});

describe('appChoose', () => {
  it('renders the three answers in reading order: Cancel · alternative · default', async () => {
    render(<AppDialogHost />);
    const p = ask();
    const dialog = await screen.findByRole('dialog');
    const names = within(dialog).getAllByRole('button').map((b) => b.textContent?.trim()).filter(Boolean);
    expect(names.slice(-3)).toEqual(['Cancel', 'Replace everything', 'Keep both']);
    // The dialog registry is a module singleton: answer it so the next case
    // starts with an empty queue.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep both' }));
    await expect(p).resolves.toBe('confirm');
  });

  it('each button resolves its own answer', async () => {
    render(<AppDialogHost />);
    let p = ask();
    fireEvent.click(await screen.findByRole('button', { name: 'Keep both' }));
    await expect(p).resolves.toBe('confirm');

    p = ask();
    fireEvent.click(await screen.findByRole('button', { name: 'Replace everything' }));
    await expect(p).resolves.toBe('alternate');

    p = ask();
    // Two controls are named Cancel (the close button and the footer button);
    // the footer one is the one that SAYS it.
    const cancels = await screen.findAllByRole('button', { name: /^Cancel$/ });
    fireEvent.click(cancels.find((b) => b.textContent?.trim() === 'Cancel')!);
    await expect(p).resolves.toBe('cancel');
  });

  it('Escape is Cancel — never one of the writes', async () => {
    render(<AppDialogHost />);
    const p = ask();
    await screen.findByRole('dialog');
    fireEvent.keyDown(window, { key: 'Escape' });
    await expect(p).resolves.toBe('cancel');
  });

  it('the close button is Cancel', async () => {
    render(<AppDialogHost />);
    const p = ask();
    const dialog = await screen.findByRole('dialog');
    // The first "Cancel"-named control is the top-right close button.
    fireEvent.click(within(dialog).getAllByRole('button', { name: 'Cancel' })[0]);
    await expect(p).resolves.toBe('cancel');
  });

  it('focus starts on the default, and Enter takes it', async () => {
    render(<AppDialogHost />);
    const p = ask();
    await screen.findByRole('dialog');
    await act(async () => { await raf(); });
    expect(document.activeElement?.textContent).toBe('Keep both');
    fireEvent.keyDown(window, { key: 'Enter' });
    await expect(p).resolves.toBe('confirm');
  });

  it('the D-pad walks all three answers, and Enter takes the focused one', async () => {
    render(<AppDialogHost />);
    const p = ask();
    await screen.findByRole('dialog');
    await act(async () => { await raf(); });
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(document.activeElement?.textContent).toBe('Replace everything');
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(document.activeElement?.textContent).toBe('Cancel');
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(document.activeElement?.textContent).toBe('Keep both');
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(document.activeElement?.textContent).toBe('Cancel');
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(document.activeElement?.textContent).toBe('Replace everything');
    fireEvent.keyDown(window, { key: 'Enter' });
    await expect(p).resolves.toBe('alternate');
  });
});
