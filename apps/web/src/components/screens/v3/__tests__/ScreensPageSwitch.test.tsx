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
import { render, screen as rtl, act } from '@testing-library/react';

// ── Everything the page reaches for, stubbed at the boundary ────────
jest.mock('next/navigation', () => ({ useParams: () => ({ schoolId: 'demo' }) }));
jest.mock('qrcode', () => ({ toDataURL: jest.fn(async () => 'data:image/png;base64,') }));
jest.mock('@/lib/api-client', () => ({ apiFetch: jest.fn(async () => ({})) }));
jest.mock('@/store/ui-store', () => ({
  useUIStore: (sel: any) => sel({ user: { role: 'SCHOOL_ADMIN' }, token: 'tok' }),
}));
jest.mock('@/hooks/use-overlay-lock', () => ({ useOverlayLock: () => {} }));
const q = (data: any) => ({ data, isLoading: false, isError: false, refetch: jest.fn() });
jest.mock('@/hooks/use-api', () => ({
  useScreens: () => q([]),
  useScreenGroups: () => q([]),
  useSchedules: () => q([]),
  usePlaylists: () => q([]),
  useDistrictReadiness: () => q(undefined),
  useUpdateScreenLocation: () => ({ mutateAsync: jest.fn() }),
  useUpdateScreenGroup: () => ({ mutateAsync: jest.fn(), mutate: jest.fn(), isPending: false }),
  useCreateScreenGroup: () => ({ mutate: jest.fn(), isPending: false }),
  useDeleteScreenGroup: () => ({ mutate: jest.fn(), isPending: false }),
  useRefreshWeb: () => ({ mutate: jest.fn(), isPending: false }),
}));
jest.mock('@/components/screens/ScreenMapClient', () => ({ ScreenMapClient: () => <div /> }));
jest.mock('@/components/screens/ReturnToFleetBanner', () => ({ ReturnToFleetBanner: () => null }));
jest.mock('@/components/screens/ScreenLocationModal', () => ({ ScreenLocationModal: () => null }));
jest.mock('@/components/screens/FloorPlansView', () => ({ FloorPlansView: () => <div /> }));
jest.mock('@/components/screens/DisplayScheduleModal', () => ({ DisplayScheduleModal: () => null }));
// next/dynamic would defer the classic import past the assertion window.
jest.mock('next/dynamic', () => () => {
  const Classic = () => <div data-testid="classic-screens" />;
  return Classic;
});
jest.mock('@/components/screens/v3/ScreenOperationsV3', () => ({
  ScreenOperationsV3: () => <div data-testid="v3-screens" />,
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
});

describe('Screens view switcher', () => {
  it('never mounts the surface the preference did not ask for', () => {
    installStorage(null);
    render(<ScreensPage />);
    // v3 is the default; the classic tree is never even imported on this path.
    expect(rtl.getByTestId('v3-screens')).toBeInTheDocument();
    expect(rtl.queryByTestId('classic-screens')).not.toBeInTheDocument();
  });

  it('defaults to v3 when no preference is stored', () => {
    installStorage(null);
    render(<ScreensPage />);
    expect(rtl.getByTestId('v3-screens')).toBeInTheDocument();
  });

  it('a stored classic preference renders classic — and only classic', () => {
    installStorage('classic');
    render(<ScreensPage />);
    expect(rtl.getByTestId('classic-screens')).toBeInTheDocument();
    expect(rtl.queryByTestId('v3-screens')).not.toBeInTheDocument();
  });

  it('leaves ?screen= on the URL for classic — that page reads it itself', () => {
    installStorage('classic');
    window.history.replaceState(null, '', '/demo/screens?screen=scr-9');
    render(<ScreensPage />);
    // The strip must wait for the preference: on the first pass viewPref is
    // still the module default, and deleting the param there would break every
    // deep link for an operator who chose classic.
    expect(window.location.search).toContain('screen=scr-9');
  });

  it('consumes ?screen= and ?filter= for v3, leaving a clean URL', () => {
    installStorage('v3');
    window.history.replaceState(null, '', '/demo/screens?screen=scr-9&filter=attention');
    render(<ScreensPage />);
    expect(window.location.search).toBe('');
  });

  it('classic offers a way back to the new view, and it persists', () => {
    const store = installStorage('classic');
    render(<ScreensPage />);
    const back = rtl.getByRole('button', { name: 'Back to the new view' });
    act(() => { back.click(); });
    expect(rtl.getByTestId('v3-screens')).toBeInTheDocument();
    expect(store.venueos_screens_view).toBe('v3');
  });
});

describe('skeleton gate', () => {
  it('holds a skeleton while the preference read is outstanding', () => {
    // Force the pre-decision state by making the read throw — the effect still
    // sets prefLoaded, so instead we assert the branch directly by rendering
    // with a storage accessor that is slow to be consulted: React renders the
    // component body BEFORE effects run, so the first paint is the skeleton.
    installStorage(null);
    const paints: string[] = [];
    const Probe = () => {
      // A child that records what the page rendered on the very first pass.
      React.useEffect(() => {
        paints.push(document.body.innerHTML.includes('animate-pulse') ? 'skeleton' : 'surface');
      }, []);
      return null;
    };
    render(<><ScreensPage /><Probe /></>);
    // The child effect runs AFTER the page's own first commit and BEFORE the
    // page's effect flips prefLoaded in a later pass, so the first observed
    // paint must be the skeleton — never a guessed surface.
    expect(paints[0]).toBe('skeleton');
  });
});
