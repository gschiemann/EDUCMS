/**
 * Branding on the phone HOME (2026-09-21).
 *
 * The operator opens this screen more than any other and it carried no
 * identity at all: no mark, and a near-black primary button that looked like
 * chrome from somebody else's product. Both mobile homes are covered — Fleet
 * Command (the default for anyone who can read a fleet) and the classic card
 * stack behind it — because a tenant who rolls back must not lose their brand
 * as a side effect.
 *
 * The un-branded assertions are the ones worth keeping: this change must be
 * invisible to a tenant who has configured nothing.
 */
import * as React from 'react';
import { render, screen, act } from '@testing-library/react';

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a>,
}));
jest.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
jest.mock('@/hooks/use-tenant-copy', () => ({
  useTenantCopy: () => ({ vertical: 'GYM', defaultBrandName: 'VenueOS' }),
}));
jest.mock('@/components/dashboard/StarterBoardCard', () => ({
  StarterBoardCard: () => <div data-testid="starter-board" />,
}));
// Wholesale — MobileDashboard reaches for all of these. Extend the list when a
// component grows a hook; never relax an assertion to route around it.
jest.mock('@/hooks/use-api', () => ({
  useFleet: () => ({ data: undefined, isPending: false }),
  useDistrictReadiness: () => ({ data: undefined }),
  useDistrictPendingApprovals: () => ({ data: undefined }),
  useSchedules: () => ({ data: [] }),
  useScreens: () => ({ data: [] }),
  usePlaylists: () => ({ data: [] }),
  useAssets: () => ({ data: [] }),
  useSubmissions: () => ({ data: [] }),
  useTenantStatus: () => ({ data: { name: 'Iron Peak' } }),
}));

import { MobileFleetCommand } from '../mobile/MobileFleetCommand';
import { MobileDashboard } from '../MobileDashboard';
import { useAppStore } from '@/lib/store';
import { MOBILE_SHELL_KEY } from '@/lib/mobile-shell-pref';
import type { FleetResponse } from '@/hooks/use-api';

const LS_KEY = 'edu-cms-branding-cache-v1:t1';
const BRANDED = {
  displayName: 'Iron Peak',
  logoUrl: 'https://cdn.test/iron-peak.png',
  palette: { primary: '#0f766e', logoBackground: 'primary' },
};

beforeAll(() => {
  // /api/build-info fails closed — content grades unknown, deterministically.
  global.fetch = jest.fn(async () => ({ ok: false })) as unknown as typeof fetch;
});

function seedUser(role = 'DISTRICT_ADMIN') {
  act(() => {
    useAppStore.setState({
      user: { id: 'u1', email: 'a@b.c', role, tenantId: 't1', canTriggerPanic: false } as never,
    });
  });
}
function brand() {
  window.localStorage.setItem(LS_KEY, JSON.stringify(BRANDED));
}

beforeEach(() => {
  window.localStorage.clear();
  seedUser();
});

const fleet = {
  root: { id: 'hq', name: 'Iron Peak', slug: 'hq', vertical: 'GYM' },
  locations: [{ id: 'hq', name: 'Iron Peak HQ', slug: 'hq' }],
  screens: [
    {
      id: 's1', name: 'Lobby', status: 'OFFLINE', screenGroup: null, lastPingAt: null,
      lastCacheReport: null, renderHealth: 'OK', renderStale: false, renderStaleSeconds: 5,
      effectiveLatitude: null, effectiveLongitude: null, effectiveAddress: null,
      geoSource: 'none', sourceTenant: { id: 'hq', name: 'hq', slug: 'hq' }, pushChannel: 'live',
    },
  ],
} as unknown as FleetResponse;

function drawFleetCommand() {
  return render(
    <MobileFleetCommand
      schoolId="hq"
      fleet={fleet as never}
      readiness={undefined}
      approvals={undefined}
      firstName="Greg"
      orgName="Iron Peak"
      schedule={null}
      can={{ upload: true, createPlaylist: true, pairScreen: true, submitOnly: false }}
    />,
  );
}

// ─────────────────────────────────────────────────────────────────────────

describe('Fleet Command home', () => {
  it('shows the tenant mark beside the greeting, on the same compact line', () => {
    brand();
    const { container } = drawFleetCommand();
    const root = container.querySelector('[data-testid="mobile-fleet-command"]')!;
    const first = root.firstElementChild!;
    expect(first.querySelector('img')).toHaveAttribute('src', BRANDED.logoUrl);
    // §M04 still holds: the identity rides the greeting line, it does NOT add
    // a welcome card above it.
    expect(first.textContent).toContain('Hi, Greg');
    expect(first.className).not.toMatch(/border|bg-white|rounded-2xl/);
  });

  it('the primary action is the brand colour, not near-black', () => {
    brand();
    drawFleetCommand();
    const cta = screen.getByRole('link', { name: /Review screens/i });
    // globals.css maps indigo-600 → --brand-primary-strong, the ≥4.5:1-vs-white
    // derivative, so white label text stays legible for any brand colour.
    expect(cta.className).toMatch(/\bbg-indigo-600\b/);
    expect(cta.className).toMatch(/\btext-white\b/);
    expect(cta.className).not.toMatch(/bg-slate-900/);
  });

  it('the attention card keeps its SEMANTIC tone — brand colour never replaces a status colour', () => {
    brand();
    drawFleetCommand();
    const card = screen.getByTestId('needs-attention');
    expect(card).toHaveAttribute('data-state', 'attention');
    expect(card.className).toMatch(/bg-(red|amber)-50/);
    expect(card.className).not.toMatch(/indigo/);
  });

  it('an unbranded tenant sees the product mark and nothing else changes', () => {
    const { container } = drawFleetCommand();
    const root = container.querySelector('[data-testid="mobile-fleet-command"]')!;
    expect(root.firstElementChild!.querySelector('[data-testid="brandmark-default"]')).not.toBeNull();
    expect(root.firstElementChild!.textContent).toContain('Iron Peak');
    expect(container.querySelector('img')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────

describe('the classic card-stack home', () => {
  it('puts the tenant mark in the greeting card', () => {
    brand();
    window.localStorage.setItem(MOBILE_SHELL_KEY, 'classic');
    const { container } = render(<MobileDashboard schoolId="hq" />);
    expect(container.querySelector('img')).toHaveAttribute('src', BRANDED.logoUrl);
  });

  it('an unbranded tenant gets the product mark, and no brand chip', () => {
    window.localStorage.setItem(MOBILE_SHELL_KEY, 'classic');
    const { container } = render(<MobileDashboard schoolId="hq" />);
    const mark = screen.getByTestId('brandmark-default');
    expect(mark).toBeInTheDocument();
    expect(mark.getAttribute('style')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
  });
});
