/** Fresh usage is shown in the first confirmation; errors remain inside it. */

import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
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

function mount(over: Record<string, unknown> = {}, handlers: Record<string, jest.Mock> = {}, extra: Record<string, unknown> = {}) {
  const onClose = handlers.onClose || jest.fn();
  const onReviewUsage = handlers.onReviewUsage || jest.fn();
  const onDeleteAnyway = handlers.onDeleteAnyway || jest.fn();
  const onOpenPlaylist = handlers.onOpenPlaylist || jest.fn();
  render(
    <TemplateUsageImpactDialog
      impact={impact(over)}
      onClose={onClose}
      onReviewUsage={onReviewUsage}
      onDeleteAnyway={onDeleteAnyway}
      onOpenPlaylist={onOpenPlaylist}
      {...extra}
    />,
  );
  return { onClose, onReviewUsage, onDeleteAnyway, onOpenPlaylist };
}

const footer = () => {
  const dialog = screen.getByRole('alertdialog');
  return ['Cancel', 'Review', 'Delete anyway', 'Deleting…'].flatMap((n) => within(dialog).queryAllByRole('button', { name: n }));
};

describe('the impact dialog: a warning that can delete, and a Review that goes to the playlist', () => {
  it('offers Cancel, Review and Delete anyway — in that order', () => {
    mount();
    expect(footer().map((b) => b.textContent?.trim())).toEqual(['Cancel', 'Review', 'Delete anyway']);
  });

  it('Review is the focused action, so Enter lands on the one that changes nothing', async () => {
    mount();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Review' })));
  });

  it('each button fires exactly its own handler', () => {
    const h = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    expect(h.onReviewUsage).toHaveBeenCalledTimes(1);
    expect(h.onDeleteAnyway).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Delete anyway' }));
    expect(h.onDeleteAnyway).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(h.onClose).toHaveBeenCalledTimes(1);
  });

  it('every listed playlist opens ITSELF', () => {
    const h = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Front Desk' }));
    expect(h.onOpenPlaylist).toHaveBeenCalledWith('p2');
    fireEvent.click(screen.getByRole('button', { name: 'Morning Loop' }));
    expect(h.onOpenPlaylist).toHaveBeenLastCalledWith('p1');
  });

  it('says what deleting does to those playlists, in the singular and the plural', () => {
    mount({ playlists: [{ id: 'p1', name: 'Morning Loop' }] });
    expect(screen.getByText(/takes this layout off that playlist — it falls back to its next layout/)).toBeInTheDocument();
  });

  it('while the delete runs, every action stands down and the button says so', () => {
    mount({}, {}, { deleting: true });
    for (const b of footer()) expect(b).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Deleting…' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Morning Loop' })).toBeDisabled();
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


describe('the first confirmation checks before enabling Delete', () => {
  it('keeps Delete disabled while usage is loading and still permits Cancel', () => {
    mount({ playlists: [], inUse: false }, {}, { checking: true });
    expect(screen.getByText('Checking where this template is used…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete template' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Review' })).not.toBeInTheDocument();
  });

  it('unused templates need only Cancel and Delete', () => {
    mount({ playlists: [], total: 0, inUse: false });
    expect(screen.getByRole('button', { name: 'Delete template' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Review' })).not.toBeInTheDocument();
  });

  it('reports total usage even when playlist names are capped', () => {
    mount({ total: 8 });
    expect(screen.getByText('8 playlists · 3 screens · 1 location')).toBeInTheDocument();
    expect(screen.getByText('And 6 more playlists.')).toBeInTheDocument();
  });

  it('protected content cannot be deleted', () => {
    mount({ protectedEmergency: true });
    expect(screen.getByText(/used by emergency content and can’t be deleted here/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete anyway' })).toBeDisabled();
  });

  it('a failed usage read offers an inline retry and cannot arm Delete', () => {
    const onRetry = jest.fn();
    mount({ playlists: [], inUse: false }, {}, { error: 'Usage unavailable', canDelete: false, onRetry });
    expect(screen.getByRole('alert')).toHaveTextContent('Usage unavailable');
    expect(screen.getByRole('button', { name: 'Delete template' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
