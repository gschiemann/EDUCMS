/**
 * The Screens page's view switcher — the rollback contract.
 *
 * Two behaviours are pinned here because both were bought with real operator
 * pain:
 *
 *   1. NEVER PAINT THE WRONG VARIANT FIRST. On 2026-08-31 the operator caught
 *      exactly this on the dashboard's identical toggle ("i see the old
 *      classic dashboard for about .5 seconds and then the new one loads").
 *      Neither surface may render until the stored preference has been read.
 *   2. The stored preference decides, and switching writes it — so a
 *      fleet-wide rollback (flip the module constant) and a per-operator
 *      rollback (the quiet Classic view link) both work.
 */
import * as React from 'react';
import { render, screen as rtl, act, fireEvent } from '@testing-library/react';

// ── Everything the page reaches for, stubbed at the boundary ────────
jest.mock('next/navigation', () => ({ useParams: () => ({ schoolId: 'demo' }) }));
jest.mock('qrcode', () => ({ toDataURL: jest.fn(async () => 'data:image/png;base64,') }));
jest.mock('@/lib/branding-context', () => ({ useBranding: () => ({ logoUrl: 'https://cdn.example/brookfield.png' }) }));
jest.mock('@/lib/api-client', () => ({ apiFetch: jest.fn(async () => ({})) }));
let mockRole = 'SCHOOL_ADMIN';
let mockFleet: any = undefined;
let mockCompany: any = undefined;
const mockCompanyQueryOptions = jest.fn();
jest.mock('@/store/ui-store', () => ({
  useUIStore: (sel: any) => sel({ user: { role: mockRole, tenantId: 'hq' }, token: 'tok' }),
}));
jest.mock('@/hooks/use-overlay-lock', () => ({ useOverlayLock: () => {} }));
const q = (data: any) => ({ data, isLoading: false, isError: false, refetch: jest.fn() });
jest.mock('@/hooks/use-api', () => ({
  useScreens: () => q([{ id: 'local', name: 'HQ lobby', status: 'ONLINE' }]),
  useFleet: () => q(mockFleet),
  useFleetOperations: (options: any) => { mockCompanyQueryOptions(options); return q(mockCompany); },
  useScreenGroups: () => q([]),
  useSchedules: () => q([]),
  usePlaylists: () => q([]),
  useDistrictReadiness: () => q(undefined),
  useUpdateScreenLocation: () => ({ mutateAsync: jest.fn() }),
  useUpdateScreenGroup: () => ({ mutateAsync: jest.fn(), mutate: jest.fn(), isPending: false }),
  useCreateScreenGroup: () => ({ mutate: jest.fn(), isPending: false }),
  useDeleteScreenGroup: () => ({ mutate: jest.fn(), isPending: false }),
  useRefreshWeb: () => ({ mutate: jest.fn(), isPending: false }),
  // The "Full settings" popover's LED-canvas section reads the tenant's
  // standard poster size (2026-09-01). This mock is a FULL replacement of
  // the module, so every hook the tree can reach has to exist in it.
  useTenantPosterStandard: () => ({
    w: 320, h: 1080, isDefault: true, storedW: null, storedH: null,
    isLoading: false, isError: false,
  }),
}));
jest.mock('@/components/screens/CompanyScreenAtlas', () => ({ CompanyScreenAtlas: () => <div data-testid="company-map" /> }));
jest.mock('@/components/screens/ScreenLocationAtlas', () => ({ ScreenLocationAtlas: (props: any) => <div data-testid="screen-map" data-logo={props.logoUrl ?? ''} /> }));
jest.mock('@/components/screens/ReturnToFleetBanner', () => ({ ReturnToFleetBanner: () => null }));
jest.mock('@/components/screens/ScreenLocationModal', () => ({ ScreenLocationModal: () => null }));
jest.mock('@/components/screens/FloorPlansView', () => ({ FloorPlansView: () => <div /> }));
jest.mock('@/components/screens/DisplayScheduleModal', () => ({ DisplayScheduleModal: () => null }));
// next/dynamic wraps the lazily-loaded modals; resolve them synchronously.
jest.mock('next/dynamic', () => () => {
  const Lazy = () => null;
  return Lazy;
});
const mockV3Props: any[] = [];
jest.mock('@/components/screens/v3/ScreenOperationsV3', () => ({
  ScreenOperationsV3: (props: any) => {
    mockV3Props.push(props);
    return <div data-testid="v3-screens">{props.scopeSlot}{props.renderMap([], { rows: [], onOpenScreen: jest.fn(), onList: jest.fn() })}</div>;
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const ScreensPage = require('@/app/[schoolId]/screens/page').default;

/**
 * A localStorage whose read is observable: the test can assert that NEITHER
 * surface was in the DOM before the preference answered.
 */
function installStorage(value: string | null) {
  const store: Record<string, string> = {};
  if (value) store.venueos_screens_view = value;
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v; },
      removeItem: (k: string) => { delete store[k]; },
    },
  });
  return store;
}

beforeEach(() => {
  global.fetch = jest.fn(async () => ({ ok: false })) as any;
  window.history.replaceState(null, '', '/demo/screens');
  mockRole = 'SCHOOL_ADMIN';
  mockFleet = undefined; mockCompany = undefined; mockCompanyQueryOptions.mockClear();
  mockV3Props.length = 0;
});

describe('Screens page', () => {
  it('renders the v3 surface (classic retired 2026-09-14)', () => {
    installStorage(null);
    render(<ScreensPage />);
    expect(rtl.getByTestId('v3-screens')).toBeInTheDocument();
    expect(rtl.getByTestId('screen-map')).toHaveAttribute('data-logo', 'https://cdn.example/brookfield.png');
  });

  it('consumes ?screen= and ?filter= for v3, leaving a clean URL', () => {
    installStorage('v3');
    window.history.replaceState(null, '', '/demo/screens?screen=scr-9&filter=attention');
    render(<ScreensPage />);
    expect(window.location.search).toBe('');
  });

});

/**
 * Which roles the page tells the surface can write.
 *
 * Every write route this page reaches — `POST /screens/pair`, `PUT /screens/:id`,
 * `PUT /screens/:id/orientation`, `POST /screens/:id/{force-update,refresh-web,
 * revoke-credential}`, `DELETE /screens/:id`, and all of `/screen-groups` CRUD —
 * carries `@RequireRoles(SUPER_ADMIN, DISTRICT_ADMIN, SCHOOL_ADMIN)`. A
 * CONTRIBUTOR is excluded from every one of them, so it must land on the
 * surface as `canControl: false`. It used to land as `readOnly: false` (that
 * gate only knew about RESTRICTED_VIEWER) and every button rendered enabled.
 */
describe('role → write capability', () => {
  const capability = (role: string) => {
    mockRole = role;
    installStorage('v3');
    render(<ScreensPage />);
    const props = mockV3Props[mockV3Props.length - 1];
    return { canControl: props.canControl, pairDisabled: props.connectSlot.props.pairDisabled };
  };

  it.each(['SUPER_ADMIN', 'DISTRICT_ADMIN', 'SCHOOL_ADMIN'])('%s may drive writes', (role) => {
    expect(capability(role)).toEqual({ canControl: true, pairDisabled: false });
  });

  it.each(['CONTRIBUTOR', 'RESTRICTED_VIEWER'])('%s may not — the API would 403', (role) => {
    expect(capability(role)).toEqual({ canControl: false, pairDisabled: true });
  });
});



it('corporate selects named locations without changing session and returns to its own local controls', () => {
  mockRole = 'DISTRICT_ADMIN';
  mockFleet = { root: { id: 'hq', name: 'Corporate', slug: 'hq' }, locations: [{ id: 'hq', name: 'Corporate' }, { id: 'a', name: 'Austin' }, { id: 'b', name: 'Boston' }] };
  mockCompany = { ...mockFleet, screens: [
    { id: 'a-screen', name: 'A lobby', sourceTenant: { id: 'a', name: 'Austin' }, screenGroupId: 'a-group', screenGroup: { id: 'a-group', name: 'Lobby' } },
    { id: 'b-screen', name: 'B lobby', sourceTenant: { id: 'b', name: 'Boston' } },
  ], operations: { groups: [{ id: 'a-group', name: 'Lobby', tenantId: 'a', sourceTenant: { id: 'a', name: 'Austin' } }], schedules: [], playlists: [] } };
  render(<ScreensPage />);
  expect(mockV3Props.at(-1).screens.map((s: { id: string }) => s.id)).toEqual(['local']);
  expect(mockV3Props.at(-1).canControl).toBe(true);
  fireEvent.click(rtl.getByRole('button', { name: 'All company screens' }));
  expect(mockCompanyQueryOptions).toHaveBeenLastCalledWith({ enabled: true });
  expect(mockV3Props.at(-1).screens).toHaveLength(2);
  expect(mockV3Props.at(-1).groups[0].name).toBe('Austin · Lobby');
  expect(mockV3Props.at(-1).canControl).toBe(false);
  expect(mockV3Props.at(-1).buildPreviewHref(mockCompany.screens[0])).toBeNull();
  const filter = rtl.getByRole('button', { name: 'Filter by location' });
  fireEvent.click(filter);
  expect(rtl.getByRole('checkbox', { name: 'Select Boston' })).toBeInTheDocument();
  fireEvent.click(rtl.getByRole('checkbox', { name: 'Select Austin' }));
  expect(mockV3Props.at(-1).screens.map((s: { id: string }) => s.id)).toEqual(['a-screen']);
  expect(mockV3Props.at(-1).floorSlot).toBeNull();
  fireEvent.click(rtl.getByRole('checkbox', { name: 'Select Boston' }));
  expect(mockV3Props.at(-1).screens.map((s: { id: string }) => s.id)).toEqual(['a-screen', 'b-screen']);
  expect(new URLSearchParams(window.location.search).getAll('location')).toEqual(['a', 'b']);
  fireEvent.click(rtl.getByRole('button', { name: 'Done' }));
  fireEvent.click(rtl.getByRole('button', { name: 'Local screens' }));
  expect(mockV3Props.at(-1).screens.map((s: { id: string }) => s.id)).toEqual(['local']);
  expect(mockV3Props.at(-1).canControl).toBe(true);
});
