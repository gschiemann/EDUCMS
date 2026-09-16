/**
 * State-by-state proof for the wizard's publish confirmation.
 *
 * Mounts the REAL PlaylistCreateWizard (not a stand-in) and walks the two
 * states the blast-radius wave exists for:
 *
 *   A. group of 3  → Review must read "Publishes to 3 screens across 1 group"
 *                    and list the three real names, and Create must be live.
 *   B. zero days   → a windowed schedule with no days picked must DISABLE
 *                    Create and say why (live-test finding P7). Picking a day
 *                    must re-enable it.
 *   C. no screens  → Create must read honestly ("won't display yet"), still
 *                    enabled, because staging a playlist is a real choice.
 *
 * CLAUDE.md §9: a registry entry that never renders is not a feature. This
 * asserts against the operator's actual DOM.
 */

import * as React from 'react';
import { render, screen as rtl, fireEvent } from '@testing-library/react';

const SCREENS = [
  { id: 's1', name: 'Lobby North', status: 'ONLINE' },
  { id: 's2', name: 'Lobby South', status: 'OFFLINE' },
  { id: 's3', name: 'Cafeteria', status: 'ONLINE' },
  { id: 's9', name: 'Gym Ribbon', status: 'ONLINE' },
];
const GROUPS = [
  {
    id: 'g1',
    name: 'Lobby Wall',
    screens: [
      { id: 's1', name: 'Lobby North', status: 'ONLINE' },
      { id: 's2', name: 'Lobby South', status: 'OFFLINE' },
      { id: 's3', name: 'Cafeteria', status: 'ONLINE' },
    ],
  },
];
const ASSETS = [
  { id: 'a1', originalName: 'Welcome.png', title: 'Welcome', mimeType: 'image/png', fileUrl: '/u/a1.png', folderId: null },
];

const noopMutation = () => ({ mutateAsync: jest.fn().mockResolvedValue({ id: 'new' }), isPending: false });

jest.mock('@/hooks/use-api', () => ({
  useAssets: () => ({ data: ASSETS }),
  useAssetFolders: () => ({ data: [] }),
  useTemplates: () => ({ data: [] }),
  useScreens: () => ({ data: SCREENS }),
  useScreenGroups: () => ({ data: GROUPS }),
  useCreatePlaylist: noopMutation,
  useReorderPlaylistItems: noopMutation,
  useCreateSchedule: noopMutation,
  useCreateSubmission: noopMutation,
  // "Keep screens in sync" on the screen step is applied with a follow-up call
  // after create, so the wizard calls this hook unconditionally.
  useSetPlaylistSync: noopMutation,
}));
jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: jest.fn(), refetchQueries: jest.fn() }),
}));
jest.mock('@/components/ui/app-dialog', () => ({
  appConfirm: jest.fn().mockResolvedValue(true),
  appAlert: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/hooks/use-overlay-lock', () => ({ useOverlayLock: () => {} }));
jest.mock('@/store/ui-store', () => ({
  useUIStore: (sel: (s: unknown) => unknown) => sel({ user: { role: 'SCHOOL_ADMIN' } }),
}));

// ts-jest hoists the jest.mock calls above this import, so the wizard sees
// the stubs. This is the REAL component under test — nothing about it is
// mocked, only the data hooks it reads from.
import { PlaylistCreateWizard } from '../PlaylistCreateWizard';

/** Drive the wizard from Step 1 to Step 5 with a media playlist. */
function openToReview(opts: { pickGroup?: boolean; windowed?: boolean; clearDays?: boolean } = {}) {
  render(<PlaylistCreateWizard open onClose={() => {}} onCreated={() => {}} />);

  // Step 1 — name + type
  fireEvent.change(rtl.getByPlaceholderText(/e\.g\.|name/i), { target: { value: 'Fall Assembly' } });
  fireEvent.click(rtl.getByText('Media Playlist'));
  fireEvent.click(rtl.getByRole('button', { name: /^Next/ }));

  // Step 2 — pick the one asset
  fireEvent.click(rtl.getByText('Welcome.png'));
  fireEvent.click(rtl.getByRole('button', { name: /Next/ }));

  // Step 3 — screens
  if (opts.pickGroup) fireEvent.click(rtl.getByText('Lobby Wall'));
  fireEvent.click(rtl.getByRole('button', { name: /^Next/ }));

  // Step 4 — publish window
  if (opts.windowed) {
    fireEvent.click(rtl.getByText('Schedule a window'));
    if (opts.clearDays) {
      for (const d of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']) {
        fireEvent.click(rtl.getByRole('button', { name: d, pressed: true }));
      }
    }
  }
  fireEvent.click(rtl.getByRole('button', { name: /^Next/ }));
}

const createButton = () =>
  rtl.getByRole('button', { name: /Create Playlist|Create \(won't display yet\)/ });

describe('PlaylistCreateWizard — blast radius on Review', () => {
  it('A. a picked group of 3 reads as 3 screens across 1 group, with names', () => {
    openToReview({ pickGroup: true });

    expect(rtl.getByText('Ready to create')).toBeInTheDocument();
    expect(rtl.getByText('Publishes to 3 screens across 1 group')).toBeInTheDocument();
    // ≤8 screens → names already visible, no tap required.
    expect(rtl.getByText('Lobby North · Lobby South · Cafeteria')).toBeInTheDocument();
    expect(rtl.getByText('Lobby Wall')).toBeInTheDocument();
    expect(rtl.getByText('3 screens')).toBeInTheDocument();

    const create = createButton();
    expect(create).toHaveTextContent('Create Playlist');
    expect(create).not.toBeDisabled();
  });

  it('B. a windowed schedule with no days picked BLOCKS Create (P7)', () => {
    openToReview({ pickGroup: true, windowed: true, clearDays: true });

    expect(rtl.getByText('Publishes to 3 screens across 1 group')).toBeInTheDocument();
    const alert = rtl.getByRole('alert');
    expect(alert).toHaveTextContent('no days selected');
    expect(alert).toHaveTextContent('Activate immediately');
    expect(createButton()).toBeDisabled();

    // Fix it the way the guidance says: hop back and pick a day.
    fireEvent.click(rtl.getByRole('button', { name: /^Back/ }));
    fireEvent.click(rtl.getByRole('button', { name: 'Wed' }));
    fireEvent.click(rtl.getByRole('button', { name: /^Next/ }));
    expect(rtl.queryByRole('alert')).not.toBeInTheDocument();
    expect(createButton()).not.toBeDisabled();
  });

  it('C. no screens picked → honest button label, still allowed', () => {
    openToReview({ pickGroup: false });

    expect(rtl.getByText('Publishes to 0 screens')).toBeInTheDocument();
    expect(rtl.getByText(/no screens picked/)).toBeInTheDocument();
    const create = createButton();
    expect(create).toHaveTextContent("Create (won't display yet)");
    expect(create).not.toBeDisabled();
  });

  it('D. Step 4 shows the reach it is about to schedule, resolved not raw', () => {
    render(<PlaylistCreateWizard open onClose={() => {}} onCreated={() => {}} />);
    fireEvent.change(rtl.getByPlaceholderText(/e\.g\.|name/i), { target: { value: 'Fall Assembly' } });
    fireEvent.click(rtl.getByText('Media Playlist'));
    fireEvent.click(rtl.getByRole('button', { name: /^Next/ }));
    fireEvent.click(rtl.getByText('Welcome.png'));
    fireEvent.click(rtl.getByRole('button', { name: /Next/ }));
    fireEvent.click(rtl.getByText('Lobby Wall'));
    fireEvent.click(rtl.getByRole('button', { name: /^Next/ }));

    expect(rtl.getByText(/These rules apply to all 3 screens you picked/)).toBeInTheDocument();
    // The zero-day guidance lives beside the day picker, where it is fixable.
    fireEvent.click(rtl.getByText('Schedule a window'));
    for (const d of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']) {
      fireEvent.click(rtl.getByRole('button', { name: d, pressed: true }));
    }
    expect(rtl.getByText(/would run on zero days/)).toBeInTheDocument();
  });
});
