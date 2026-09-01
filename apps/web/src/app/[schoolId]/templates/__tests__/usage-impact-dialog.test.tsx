/**
 * Templates Gallery — Calm v1 · §11.3, the in-use impact dialog.
 *
 * This is the deletion-safety half of the wave, and its central assertion
 * is a NEGATIVE one: this dialog has no destructive button.
 *
 * What it replaced: the gallery read a cached playlist count off the list
 * payload, and — before the server had said anything — opened a
 * confirmation whose primary button was a red "Delete anyway". One click
 * unlinked a layout from every playlist that used it. The operator was
 * handed a number and a red button in the same breath, and the screens
 * changed.
 *
 * Calm v1 §11.3: "The safe path is `Review usage`, not an emphasized
 * `Delete anyway`." Every figure printed here comes from the server's
 * 409 — when the server doesn't send one, the dialog says nothing about
 * it rather than printing a zero it can't prove.
 */

import { render, screen, fireEvent } from '@testing-library/react';
import { TemplateUsageImpactDialog } from '../page';

function impact(over: Record<string, unknown> = {}) {
  return {
    template: { id: 'tpl-1', name: 'Club Welcome' },
    playlists: [
      { id: 'p1', name: 'Morning Loop' },
      { id: 'p2', name: 'Front Desk' },
    ],
    screensReached: 3,
    locations: 1,
    ...over,
  } as any;
}

function mount(over: Record<string, unknown> = {}, handlers: Record<string, jest.Mock> = {}) {
  const onClose = handlers.onClose || jest.fn();
  const onReviewUsage = handlers.onReviewUsage || jest.fn();
  render(<TemplateUsageImpactDialog impact={impact(over)} onClose={onClose} onReviewUsage={onReviewUsage} />);
  return { onClose, onReviewUsage };
}

describe('§11.3 — the impact dialog offers no destructive path', () => {
  it('has NO delete / delete-anyway / remove button of any kind', () => {
    mount();
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /remove/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /anyway/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /trash/i })).not.toBeInTheDocument();
  });

  it('offers exactly two actions: Review usage (primary) and Cancel', () => {
    mount();
    const buttons = screen.getAllByRole('button').map((b) => b.textContent?.trim());
    expect(buttons).toEqual(['Cancel', 'Review usage']);
  });

  it('Review usage is the focused action when the dialog opens', () => {
    mount();
    // The safe path is what a keyboard operator's Enter lands on.
    expect(screen.getByRole('button', { name: 'Review usage' })).toBeInTheDocument();
  });

  it('Review usage fires its handler; Cancel closes', () => {
    const onReviewUsage = jest.fn();
    const onClose = jest.fn();
    mount({}, { onReviewUsage, onClose });
    fireEvent.click(screen.getByRole('button', { name: 'Review usage' }));
    expect(onReviewUsage).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Escape closes it (§14)', () => {
    const onClose = jest.fn();
    mount({}, { onClose });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('§11.3 — it states the server\'s reach, and only the server\'s reach', () => {
  it('names the template and summarizes playlists · screens · locations', () => {
    mount();
    expect(screen.getByText(/“Club Welcome” is currently in use/)).toBeInTheDocument();
    expect(screen.getByText('2 playlists · 3 screens · 1 location')).toBeInTheDocument();
  });

  it('lists the affected playlists by name', () => {
    mount();
    expect(screen.getByText('Morning Loop')).toBeInTheDocument();
    expect(screen.getByText('Front Desk')).toBeInTheDocument();
  });

  it('prints NO screen or location figure when the server didn\'t send one', () => {
    // Degradation path: the API shipping today answers 409 with just
    // `{ message, playlists, total }`. The dialog must not invent
    // "0 screens" from that silence.
    mount({ screensReached: undefined, locations: undefined });
    expect(screen.getByText('2 playlists')).toBeInTheDocument();
    // No COUNTED claim about screens or locations anywhere. (The body's
    // hedged "could change what those screens display" is §11.3's own
    // copy and asserts no figure, so the match is on numbers.)
    expect(screen.queryByText(/\d+\s+screens?\b/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/\d+\s+locations?\b/i)).not.toBeInTheDocument();
  });

  it('falls back to the server\'s own sentence when no playlist list came back', () => {
    mount({
      playlists: [],
      screensReached: undefined,
      locations: undefined,
      message: 'This layout is assigned to 4 playlists.',
    });
    expect(screen.getByText('This layout is assigned to 4 playlists.')).toBeInTheDocument();
  });

  it('is announced as an alertdialog with an accessible name', () => {
    mount();
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName(/Club Welcome/);
  });
});
