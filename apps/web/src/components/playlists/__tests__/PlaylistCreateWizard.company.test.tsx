import * as React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const HQ = { id: 'hq', name: 'Test Corporate', slug: 'hq' };
const ALPHA = { id: 'alpha', name: 'Alpha office', slug: 'alpha' };
const BETA = { id: 'beta', name: 'Beta office', slug: 'beta' };
const ASSETS = [{ id: 'asset', originalName: 'Welcome.png', mimeType: 'image/png', fileUrl: '/welcome.png' }];
const TEMPLATES = [{ id: 'custom', name: 'Local Board', isSystem: false }];
const OWN = { id: 'hq-screen', name: 'Corporate lobby', status: 'ONLINE', sourceTenant: HQ, screenGroupId: 'hq-group' };
const FRONT = { id: 'alpha-front', name: 'Entrance display', status: 'ONLINE', sourceTenant: ALPHA, screenGroupId: 'alpha-group' };
const BACK = { ...FRONT, id: 'alpha-back', name: 'Entrance display back', faceOfScreenId: FRONT.id, faceContentMode: 'MIRROR', faceIndex: 1 };
const BETA_FRONT = { id: 'beta-front', name: 'Reception display', status: 'ONLINE', sourceTenant: BETA };
const BETA_BACK = { ...BETA_FRONT, id: 'beta-back', name: 'Reception display back', faceOfScreenId: BETA_FRONT.id, faceContentMode: 'OWN', faceIndex: 1 };
const SCREENS = [OWN, FRONT, BACK, BETA_FRONT, BETA_BACK];
const GROUPS = [
  { id: 'hq-group', name: 'Lobby', tenantId: HQ.id, sourceTenant: HQ },
  { id: 'alpha-group', name: 'Lobby', tenantId: ALPHA.id, sourceTenant: ALPHA },
];
let role = 'DISTRICT_ADMIN';
let currentTenant = HQ.id;
let schedules: unknown[] = [];
let fleetLoading = false;
const createPlaylist = jest.fn();
const createSchedule = jest.fn();
const publish = jest.fn();
const confirm = jest.fn();
const alert = jest.fn();
const setFaceMode = jest.fn();
const fleetHook = jest.fn();
const mutation = () => ({ mutateAsync: jest.fn().mockResolvedValue({ id: 'saved' }), isPending: false });
jest.mock('@/hooks/use-api', () => ({
  useAssets: () => ({ data: ASSETS }), useAssetFolders: () => ({ data: [] }), useTemplates: () => ({ data: TEMPLATES }),
  useScreens: () => ({ data: [OWN] }), useScreenGroups: () => ({ data: [{ ...GROUPS[0], screens: [OWN] }] }),
  useFleetOperations: (options: unknown) => {
    fleetHook(options);
    return { isLoading: fleetLoading, data: { root: HQ, locations: [HQ, ALPHA, BETA], screens: SCREENS,
      operations: { groups: GROUPS, schedules, playlists: [{ id: 'existing', name: 'Existing welcome' }] } } };
  },
  usePublishToFleet: () => ({ mutateAsync: publish, isPending: false }),
  useCreatePlaylist: () => ({ mutateAsync: createPlaylist, isPending: false }),
  useCreateSchedule: () => ({ mutateAsync: createSchedule, isPending: false }),
  useReorderPlaylistItems: mutation, useCreateSubmission: mutation, useSetPlaylistSync: mutation,
  useSetScreenFaceMode: () => ({ mutate: setFaceMode, isPending: false }),
}));
jest.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: jest.fn(), refetchQueries: jest.fn() }) }));
jest.mock('@/components/ui/app-dialog', () => ({ appConfirm: (...args: unknown[]) => confirm(...args), appAlert: (...args: unknown[]) => alert(...args) }));
jest.mock('@/hooks/use-overlay-lock', () => ({ useOverlayLock: () => {} }));
jest.mock('@/store/ui-store', () => ({ useUIStore: (select: (state: unknown) => unknown) => select({ user: { role, tenantId: currentTenant } }) }));

import { PlaylistCreateWizard } from '../PlaylistCreateWizard';

beforeEach(() => {
  jest.clearAllMocks();
  role = 'DISTRICT_ADMIN'; currentTenant = HQ.id; schedules = []; fleetLoading = false;
  createPlaylist.mockResolvedValue({ id: 'new-playlist', name: 'Company welcome' });
  createSchedule.mockResolvedValue({ id: 'new-schedule' });
  publish.mockResolvedValue({ totalScreens: 4, totalLocations: 3, screensScheduled: 4, screensPending: 0, failures: [],
    perLocation: [HQ, ALPHA, BETA].map((location) => ({ tenantId: location.id, tenantName: location.name, playlistId: 'copy', screensScheduled: location.id === BETA.id ? 2 : 1, isParent: location.id === HQ.id })) });
  confirm.mockResolvedValue(true); alert.mockResolvedValue(undefined);
});

function openToScreens(custom = false) {
  const onCreated = jest.fn();
  render(<PlaylistCreateWizard open onClose={() => {}} onCreated={onCreated} />);
  fireEvent.change(screen.getByPlaceholderText(/e\.g\.|name/i), { target: { value: 'Company welcome' } });
  fireEvent.click(screen.getByText(custom ? 'From Template' : 'Media Playlist'));
  fireEvent.click(screen.getByRole('button', { name: /^Next/ }));
  fireEvent.click(screen.getByText(custom ? 'Local Board' : 'Welcome.png'));
  fireEvent.click(screen.getByRole('button', { name: /Next/ }));
  return onCreated;
}
function review() {
  fireEvent.click(screen.getByRole('button', { name: /^Next/ }));
  fireEvent.click(screen.getByRole('button', { name: /^Next/ }));
}

it('selects all company screens including HQ, publishes through distribution, and counts mirrored reach', async () => {
  const onCreated = openToScreens();
  expect(screen.getByRole('button', { name: 'All company screens' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'Select all matching screens' }));
  expect(screen.getByText('5 of 5 screens')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /^Next/ }));
  expect(screen.getByText('Publishing across the company')).toBeInTheDocument();
  expect(screen.queryByText('Schedule a window')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /^Next/ }));
  expect(screen.getByText('Publishes to 5 screens across 3 locations')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Create & Publish' }));
  await waitFor(() => expect(onCreated).toHaveBeenCalled());
  expect(publish).toHaveBeenCalledWith({ playlistId: 'new-playlist', screenIds: [OWN.id, FRONT.id, BETA_FRONT.id, BETA_BACK.id] });
  expect(createSchedule).not.toHaveBeenCalled();
});

it('keeps selected locations when filtering, and can pick a single independent side', async () => {
  openToScreens();
  fireEvent.change(screen.getByRole('combobox', { name: 'Filter by location' }), { target: { value: ALPHA.id } });
  fireEvent.click(screen.getByRole('button', { name: 'Select all matching screens' }));
  fireEvent.change(screen.getByRole('combobox', { name: 'Filter by location' }), { target: { value: BETA.id } });
  fireEvent.click(screen.getByRole('button', { name: 'Back side' }));
  review();
  expect(screen.getByText('Publishes to 3 screens across 2 locations')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Create & Publish' }));
  await waitFor(() => expect(publish).toHaveBeenCalledWith({ playlistId: 'new-playlist', screenIds: [FRONT.id, BETA_BACK.id] }));
});

it('preserves local group scheduling and schedule windows', async () => {
  const onCreated = openToScreens();
  fireEvent.click(screen.getByRole('button', { name: 'Local screens' }));
  fireEvent.click(screen.getByText('Lobby'));
  fireEvent.click(screen.getByRole('button', { name: /^Next/ }));
  fireEvent.click(screen.getByText('Schedule a window'));
  fireEvent.click(screen.getByRole('button', { name: /^Next/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Create Playlist' }));
  await waitFor(() => expect(onCreated).toHaveBeenCalled());
  expect(createSchedule).toHaveBeenCalledWith(expect.objectContaining({ screenGroupId: 'hq-group', daysOfWeek: 'Mon,Tue,Wed,Thu,Fri', timeStart: '08:00' }));
  expect(publish).not.toHaveBeenCalled();
});

it.each(['CONTRIBUTOR', 'SCHOOL_ADMIN'])('does not expose cached company targets to %s', (localRole) => {
  role = localRole;
  openToScreens();
  expect(fleetHook).toHaveBeenLastCalledWith({ enabled: false });
  expect(screen.queryByRole('button', { name: 'All company screens' })).not.toBeInTheDocument();
  expect(screen.queryByText('Entrance display')).not.toBeInTheDocument();
});

it('does not expose a previous tenant’s cached company during an account switch', () => {
  currentTenant = 'different-root';
  openToScreens();
  expect(screen.queryByRole('button', { name: 'All company screens' })).not.toBeInTheDocument();
});

it('selects a child display without attempting to edit its face settings', () => {
  openToScreens();
  expect(screen.getAllByRole('button', { name: 'Same on both sides' }).every((button) => button.hasAttribute('disabled'))).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Play this on both sides' }));
  expect(setFaceMode).not.toHaveBeenCalled();
});

it('honors a declined conflict before publishing and opens the saved unassigned playlist', async () => {
  schedules = [{ id: 'occupied', playlistId: 'existing', screenId: FRONT.id, isActive: true }];
  confirm.mockResolvedValue(false);
  const onCreated = openToScreens();
  fireEvent.click(screen.getByRole('button', { name: 'Play this on both sides' }));
  review();
  fireEvent.click(screen.getByRole('button', { name: 'Create & Publish' }));
  await waitFor(() => expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: 'new-playlist' })));
  expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('Existing welcome') }));
  expect(publish).not.toHaveBeenCalled();
});

it('reports held playback copies and partial screen failures honestly', async () => {
  publish.mockResolvedValue({ totalScreens: 2, totalLocations: 1, screensScheduled: 0, screensPending: 1, failures: [],
    perLocation: [{ tenantId: BETA.id, tenantName: BETA.name, screensScheduled: 0, screensPending: 1,
      screenFailures: [{ screenId: BETA_BACK.id, screenName: 'Back display', error: 'Copy unavailable' }] }] });
  const onCreated = openToScreens();
  fireEvent.change(screen.getByRole('combobox', { name: 'Filter by location' }), { target: { value: BETA.id } });
  fireEvent.click(screen.getByRole('button', { name: 'Select all matching screens' }));
  review();
  fireEvent.click(screen.getByRole('button', { name: 'Create & Publish' }));
  await waitFor(() => expect(onCreated).toHaveBeenCalled());
  expect(alert).toHaveBeenCalledWith(expect.objectContaining({ title: 'Published with issues', tone: 'warn', message: expect.stringContaining('1 screen will start when the playback copy is ready') }));
  expect(alert.mock.calls[0][0].message).toContain('Beta office · Back display: Copy unavailable');
});

it('recovers the saved source after publish failure rather than leaving Create available for duplication', async () => {
  publish.mockRejectedValue(new Error('No locations could publish'));
  const onCreated = openToScreens();
  fireEvent.click(screen.getByRole('button', { name: 'Play this on both sides' }));
  review();
  fireEvent.click(screen.getByRole('button', { name: 'Create & Publish' }));
  await waitFor(() => expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: 'new-playlist', items: expect.any(Array) })));
  expect(createPlaylist).toHaveBeenCalledTimes(1);
  expect(alert).toHaveBeenCalledWith(expect.objectContaining({ title: 'Playlist saved, publishing failed' }));
});

it('blocks unsupported location templates before creating a cross-location playlist', () => {
  openToScreens(true);
  fireEvent.click(screen.getByRole('button', { name: 'Play this on both sides' }));
  expect(screen.getByRole('alert')).toHaveTextContent('This template belongs to this location');
  expect(screen.getByRole('button', { name: /^Next/ })).toBeDisabled();
  expect(createPlaylist).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Local screens' }));
  expect(screen.getByRole('button', { name: /^Next/ })).toBeEnabled();
});

it('Skip clears both selected groups and their members', () => {
  openToScreens();
  fireEvent.click(screen.getByText('Alpha office · Lobby'));
  fireEvent.click(screen.getByRole('button', { name: 'Skip — assign screens later' }));
  fireEvent.click(screen.getByRole('button', { name: /^Next/ }));
  expect(screen.getByText('Publishes to 0 screens')).toBeInTheDocument();
});
