/**
 * Browser-behavior test for AppDialogHost's Tab focus trap (a11y wave,
 * 2026-08-24/25). The trap was written and reviewed but never actually
 * exercised in jsdom/a browser — this mounts a real `appConfirm()` dialog
 * (3 real focusable controls: close-X, Cancel, Confirm — all real
 * <button> elements, all with aria-label/text "Cancel" on the first two,
 * so this test finds them by DOM order via `within(dialog)` rather than
 * by accessible name) and drives it with real keydown events, since the
 * trap is a `window`-level capture-phase listener, not native browser Tab
 * traversal (jsdom doesn't move focus on Tab by itself).
 *
 * Catches exactly the bug this wave found and fixed: the confirm-kind
 * D-pad handler used to intercept Tab too, toggling ONLY between Cancel
 * and Confirm — so close-X (a real, visible, keyboard-focusable button)
 * was never reachable by Tab, only by mouse click. See app-dialog.tsx's
 * "Universal Tab focus trap" comment.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { appConfirm, AppDialogHost } from '../app-dialog';

function Invoker() {
  return <button type="button">Open dialog</button>;
}

// jsdom does no real layout, so `offsetParent` (the source's getFocusable()
// "is this element actually visible" check) is always null — every real
// browser gives a normal, non-hidden element a non-null offsetParent. Stub
// it to a truthy value so the trap's visibility filter behaves the way it
// does in a real browser for these always-visible dialog buttons.
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
    configurable: true,
    get() {
      return document.body;
    },
  });
});

describe('<AppDialogHost /> Tab focus trap', () => {
  it('wraps Tab from the last control to the first, Shift+Tab from the first to the last, and restores focus to the invoker on close', async () => {
    render(
      <>
        <Invoker />
        <AppDialogHost />
      </>,
    );

    const invoker = screen.getByRole('button', { name: 'Open dialog' });
    invoker.focus();
    expect(document.activeElement).toBe(invoker);

    let resolvedWith: boolean | undefined;
    act(() => {
      appConfirm({ title: 'Delete?', message: 'Are you sure?' }).then((v) => {
        resolvedWith = v;
      });
    });

    const dialog = await screen.findByRole('dialog');

    // Exactly 3 focusable controls, in DOM order: close-X, Cancel, Confirm.
    const buttons = within(dialog).getAllByRole('button');
    expect(buttons).toHaveLength(3);
    const [closeBtn, cancelBtn, confirmBtn] = buttons;

    // Initial focus lands on Confirm (requestAnimationFrame in the source).
    await waitFor(() => expect(document.activeElement).toBe(confirmBtn));

    // Tab from Confirm (the LAST control) wraps to close-X (the FIRST).
    fireEvent.keyDown(confirmBtn, { key: 'Tab' });
    expect(document.activeElement).toBe(closeBtn);

    // Normal forward traversal still works: close-X -> Cancel -> Confirm.
    fireEvent.keyDown(closeBtn, { key: 'Tab' });
    expect(document.activeElement).toBe(cancelBtn);
    fireEvent.keyDown(cancelBtn, { key: 'Tab' });
    expect(document.activeElement).toBe(confirmBtn);

    // Shift+Tab from close-X (the FIRST control) wraps to Confirm (the LAST).
    fireEvent.keyDown(confirmBtn, { key: 'Tab' }); // back to close-X
    expect(document.activeElement).toBe(closeBtn);
    fireEvent.keyDown(closeBtn, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(confirmBtn);

    // Close (Cancel button) restores focus to the invoker.
    fireEvent.click(cancelBtn);
    await waitFor(() => expect(document.activeElement).toBe(invoker));
    expect(resolvedWith).toBe(false);
  });

  it('keeps the confirm-row D-pad (arrow keys) toggling only Cancel <-> Confirm — unchanged by the Tab trap fix', async () => {
    render(
      <>
        <Invoker />
        <AppDialogHost />
      </>,
    );

    act(() => {
      void appConfirm({ title: 'Reset clock?', message: 'This cannot be undone.' });
    });

    const dialog = await screen.findByRole('dialog');
    const [, cancelBtn, confirmBtn] = within(dialog).getAllByRole('button');

    await waitFor(() => expect(document.activeElement).toBe(confirmBtn));

    fireEvent.keyDown(confirmBtn, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(cancelBtn);
    fireEvent.keyDown(cancelBtn, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(confirmBtn);

    // Clean up so this dialog doesn't leak into the next test.
    fireEvent.click(confirmBtn);
  });
});
