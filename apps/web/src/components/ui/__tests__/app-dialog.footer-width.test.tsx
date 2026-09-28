/**
 * A long confirm label must WRAP inside the dialog, never run off its edge.
 *
 * 2026-09-28 (bulk playlist removal): "Delete 3 playlists and rules" ran past
 * the card's right edge in Chromium AND WebKit and the card's `overflow-hidden`
 * cut the red button off mid-word. The desktop footer is a `w-max` grid whose
 * columns all take the widest button's width (so Cancel and Confirm stay the
 * same size); `w-max` alone lets that grid outgrow the card the moment the
 * label passes ~24 characters ("Delete playlist and rules" — the longest label
 * in use — sits exactly on the limit, which is why nobody saw it before).
 * `max-w-full` caps the grid at the card, the columns shrink, and the label
 * wraps to a second line.
 *
 * jsdom does no layout, so this can only pin the two classes that make the
 * difference; the geometry itself was measured in real Chromium and WebKit
 * (the button's right edge against the card's, before and after).
 */
import { act, render, screen, within } from '@testing-library/react';
import { appConfirm, AppDialogHost } from '../app-dialog';

describe('<AppDialogHost /> footer', () => {
  it('caps the button row at the card width so a long confirm label wraps instead of clipping', async () => {
    render(<AppDialogHost />);
    act(() => {
      void appConfirm({
        title: 'Remove 12 playlists?',
        message: 'x',
        confirmLabel: 'Delete 12 playlists and all of their publishing rules',
      });
    });
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', {
      name: 'Delete 12 playlists and all of their publishing rules',
    });
    const row = confirm.parentElement as HTMLElement;
    expect(row.className).toContain('md:w-max');
    expect(row.className).toContain('md:max-w-full');
    // A no-wrap or truncating label would defeat the cap.
    expect(confirm.className).not.toMatch(/whitespace-nowrap|truncate/);
  });
});
