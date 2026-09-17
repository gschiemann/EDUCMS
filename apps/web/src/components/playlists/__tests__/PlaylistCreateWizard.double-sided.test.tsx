/**
 * Double-sided displays in the create wizard — the operator's actual DOM.
 *
 * Greg: "when creating the playlist for double sided it should be very easy
 * to say you want individual content and then assign the content to each side
 * of the display or say you want them combined."
 *
 * So this mounts the REAL wizard and walks what he asked for:
 *
 *   A. The two Screen rows of one display render as ONE card, with the
 *      same/different question on it — not as two screens named alike.
 *   B. "Same on both sides" is one tap and publishes to the front only,
 *      because the back mirrors it. (Writing a row for a mirroring side
 *      would be a row that reaches nothing.)
 *   C. "Different per side" opens the card into Front and Back, each its
 *      own tap target.
 *   D. A side left out is SAID OUT LOUD, not discovered later as a blank
 *      panel.
 *   E. An ordinary fleet is untouched — normal screens still render as
 *      normal screens.
 *
 * CLAUDE.md §9: a registry entry that never renders is not a feature. These
 * assert against the DOM the operator gets.
 */

import * as React from 'react';
import { render, screen as rtl, fireEvent } from '@testing-library/react';

const FRONT = { id: 'd1', name: 'Entrance Display', status: 'ONLINE' };
const BACK = {
  id: 'd1b',
  name: 'Entrance Display — Back',
  status: 'ONLINE',
  faceOfScreenId: 'd1',
  faceIndex: 1,
  faceContentMode: 'MIRROR',
};
const PLAIN = { id: 's9', name: 'Gym Ribbon', status: 'ONLINE' };

const ASSETS = [
  {
    id: 'a1',
    originalName: 'Welcome.png',
    title: 'Welcome',
    mimeType: 'image/png',
    fileUrl: '/u/a1.png',
    folderId: null,
  },
];

/** Screens the hook returns; a test flips the back to OWN by reassigning it. */
let SCREENS: any[] = [FRONT, BACK, PLAIN];
const createSchedule = jest.fn().mockResolvedValue({ id: 'sch' });
const setFaceMode = jest.fn();

const noopMutation = () => ({ mutateAsync: jest.fn().mockResolvedValue({ id: 'new' }), isPending: false });

jest.mock('@/hooks/use-api', () => ({
  useAssets: () => ({ data: ASSETS }),
  useAssetFolders: () => ({ data: [] }),
  useTemplates: () => ({ data: [] }),
  useScreens: () => ({ data: SCREENS }),
  useScreenGroups: () => ({ data: [] }),
  useCreatePlaylist: () => ({
    mutateAsync: jest.fn().mockResolvedValue({ id: 'pl-1', name: 'Fall Assembly' }),
    isPending: false,
  }),
  useReorderPlaylistItems: noopMutation,
  useCreateSchedule: () => ({ mutateAsync: createSchedule, isPending: false }),
  useCreateSubmission: noopMutation,
  // 2026-09-16 — the wizard also offers "Keep screens in sync" on this step and
  // applies it with a follow-up call after create, so it calls this hook
  // unconditionally. A wholesale module mock must carry every hook the mounted
  // tree reaches, not just the ones the case under test exercises.
  useSetPlaylistSync: noopMutation,
  useSetScreenFaceMode: () => ({ mutate: setFaceMode, isPending: false }),
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

// ts-jest hoists the mocks above this import, so the wizard sees the stubs.
// The wizard itself is the real component under test.
import { PlaylistCreateWizard } from '../PlaylistCreateWizard';

/** Drive the wizard as far as the screens step. */
function openToScreens() {
  render(<PlaylistCreateWizard open onClose={() => {}} onCreated={() => {}} />);
  fireEvent.change(rtl.getByPlaceholderText(/e\.g\.|name/i), { target: { value: 'Fall Assembly' } });
  fireEvent.click(rtl.getByText('Media Playlist'));
  fireEvent.click(rtl.getByRole('button', { name: /^Next/ }));
  fireEvent.click(rtl.getByText('Welcome.png'));
  fireEvent.click(rtl.getByRole('button', { name: /Next/ }));
}

beforeEach(() => {
  SCREENS = [FRONT, BACK, PLAIN];
  createSchedule.mockClear();
  setFaceMode.mockClear();
});

describe('A. one display, one card', () => {
  it('shows the two rows of a double-sided display as ONE card', () => {
    openToScreens();

    // Not two lookalike screens — one display that says what it is.
    expect(rtl.getByText('Entrance Display')).toBeInTheDocument();
    expect(rtl.queryByText('Entrance Display — Back')).not.toBeInTheDocument();
    expect(rtl.getByText(/Double-sided · 2 sides/)).toBeInTheDocument();
  });

  it('asks the same/different question right on the card', () => {
    openToScreens();
    expect(rtl.getByRole('button', { name: 'Same on both sides' })).toBeInTheDocument();
    expect(rtl.getByRole('button', { name: 'Different per side' })).toBeInTheDocument();
  });

  it('leaves ordinary screens exactly as they were', () => {
    openToScreens();
    expect(rtl.getByText('Gym Ribbon')).toBeInTheDocument();
  });
});

describe('B. "same on both sides" is one tap', () => {
  it('starts on "Same on both sides" for a freshly added back', () => {
    openToScreens();
    expect(rtl.getByRole('button', { name: 'Same on both sides', pressed: true })).toBeInTheDocument();
  });

  it('one tap selects the whole display', () => {
    openToScreens();
    fireEvent.click(rtl.getByRole('button', { name: /Play this on both sides/ }));
    expect(rtl.getByRole('button', { name: /Playing on both sides/ })).toBeInTheDocument();
  });

  it('publishes ONE schedule — to the front, which the back mirrors', async () => {
    // A row pointed at a mirroring side would be stored and ignored forever.
    openToScreens();
    fireEvent.click(rtl.getByRole('button', { name: /Play this on both sides/ }));
    fireEvent.click(rtl.getByRole('button', { name: /^Next/ })); // → publish
    fireEvent.click(rtl.getByRole('button', { name: /^Next/ })); // → review
    fireEvent.click(rtl.getByRole('button', { name: /Create Playlist/ }));

    await new Promise((r) => setTimeout(r, 0));

    expect(createSchedule).toHaveBeenCalledTimes(1);
    expect(createSchedule.mock.calls[0][0]).toMatchObject({ screenId: 'd1' });
  });

  it('counts BOTH panes of glass on Review', async () => {
    // "Publishes to 1 screen" while two panes change is a half-truth.
    openToScreens();
    fireEvent.click(rtl.getByRole('button', { name: /Play this on both sides/ }));
    fireEvent.click(rtl.getByRole('button', { name: /^Next/ }));
    fireEvent.click(rtl.getByRole('button', { name: /^Next/ }));

    expect(rtl.getByText('Publishes to 2 screens')).toBeInTheDocument();
  });
});

describe('C + D. "different per side"', () => {
  it('switching to "Different per side" tells the server, for the back side', () => {
    openToScreens();
    fireEvent.click(rtl.getByRole('button', { name: 'Different per side' }));

    expect(setFaceMode).toHaveBeenCalledWith({ id: 'd1b', mode: 'OWN' });
  });

  it('opens into Front and Back, each its own tap target', () => {
    // The server has answered and the list now says OWN.
    SCREENS = [FRONT, { ...BACK, faceContentMode: 'OWN' }, PLAIN];
    openToScreens();

    // "Front side" / "Back side", not bare "Back" — the wizard footer has a
    // Back button, and the accessible names must not collide.
    expect(rtl.getByRole('button', { name: 'Front side' })).toBeInTheDocument();
    expect(rtl.getByRole('button', { name: 'Back side' })).toBeInTheDocument();
  });

  it('assigns content to ONE side and publishes to that side only', async () => {
    SCREENS = [FRONT, { ...BACK, faceContentMode: 'OWN' }, PLAIN];
    openToScreens();

    fireEvent.click(rtl.getByRole('button', { name: 'Back side' }));
    fireEvent.click(rtl.getByRole('button', { name: /^Next/ }));
    fireEvent.click(rtl.getByRole('button', { name: /^Next/ }));
    fireEvent.click(rtl.getByRole('button', { name: /Create Playlist/ }));

    await new Promise((r) => setTimeout(r, 0));

    expect(createSchedule).toHaveBeenCalledTimes(1);
    expect(createSchedule.mock.calls[0][0]).toMatchObject({ screenId: 'd1b' });
  });

  it('says out loud that the other side was left out', () => {
    // Discovered later as a blank panel is the failure this copy prevents.
    SCREENS = [FRONT, { ...BACK, faceContentMode: 'OWN' }, PLAIN];
    openToScreens();

    fireEvent.click(rtl.getByRole('button', { name: 'Back side' }));
    expect(
      rtl.getByText(/side you didn’t pick keeps whatever is already scheduled/i),
    ).toBeInTheDocument();
  });

  it('both sides picked publishes two schedules, one per side', async () => {
    SCREENS = [FRONT, { ...BACK, faceContentMode: 'OWN' }, PLAIN];
    openToScreens();

    fireEvent.click(rtl.getByRole('button', { name: 'Front side' }));
    fireEvent.click(rtl.getByRole('button', { name: 'Back side' }));
    fireEvent.click(rtl.getByRole('button', { name: /^Next/ }));
    fireEvent.click(rtl.getByRole('button', { name: /^Next/ }));
    fireEvent.click(rtl.getByRole('button', { name: /Create Playlist/ }));

    await new Promise((r) => setTimeout(r, 0));

    expect(createSchedule).toHaveBeenCalledTimes(2);
    const targets = createSchedule.mock.calls.map((c) => c[0].screenId).sort();
    expect(targets).toEqual(['d1', 'd1b']);
  });

  it('switching back to "Same on both sides" tells the server MIRROR', () => {
    SCREENS = [FRONT, { ...BACK, faceContentMode: 'OWN' }, PLAIN];
    openToScreens();

    fireEvent.click(rtl.getByRole('button', { name: 'Same on both sides' }));
    expect(setFaceMode).toHaveBeenCalledWith({ id: 'd1b', mode: 'MIRROR' });
  });
});
