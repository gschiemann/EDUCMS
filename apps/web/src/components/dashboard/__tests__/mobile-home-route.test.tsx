/**
 * Which home the phone paints — the §M04 mount point and its rollback
 * contract.
 *
 * MobileFleetCommand's own contents are graded in
 * mobile/__tests__/MobileFleetCommand.test.tsx. This suite grades the
 * DECISION in front of it, which has four ways to be wrong and only one to be
 * right:
 *
 *   - paint the classic stack for a beat before swapping (the operator's own
 *     half-second-flash report, now a test on both branches),
 *   - hand Fleet Command to a session whose role cannot read a fleet, so
 *     every tile 403s,
 *   - draw an all-zero command surface off a read that failed,
 *   - strand an operator who chose Classic.
 */
import * as React from 'react';
import { render, screen as rtl } from '@testing-library/react';

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, ...props }: any) => <a {...props}>{children}</a>,
}));
jest.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
jest.mock('@/hooks/use-tenant-copy', () => ({
  useTenantCopy: () => ({ vertical: 'GYM' }),
}));
jest.mock('@/components/dashboard/StarterBoardCard', () => ({
  StarterBoardCard: () => <div data-testid="starter-board" />,
}));

let fleetResult: any = { data: undefined, isPending: true };
const schedulesResult: any = { data: [] };

jest.mock('@/hooks/use-api', () => ({
  useFleet: (o?: { enabled?: boolean }) =>
    o?.enabled === false ? { data: undefined, isPending: false } : fleetResult,
  useDistrictReadiness: () => ({ data: undefined }),
  useDistrictPendingApprovals: () => ({ data: undefined }),
  useSchedules: () => schedulesResult,
  useScreens: () => ({ data: [] }),
  usePlaylists: () => ({ data: [] }),
  useAssets: () => ({ data: [] }),
  useSubmissions: () => ({ data: [] }),
  useTenantStatus: () => ({ data: { name: 'Iron Peak' } }),
}));

import { MobileDashboard } from '../MobileDashboard';
import { useAppStore } from '@/lib/store';
import { MOBILE_SHELL_KEY } from '@/lib/mobile-shell-pref';

const FLEET = {
  root: { id: 'hq', name: 'Iron Peak', slug: 'hq', vertical: 'GYM' },
  locations: [{ id: 'hq', name: 'Iron Peak HQ', slug: 'hq' }],
  stats: { total: 1, online: 1, offline: 0, locationCount: 1 },
  screens: [
    {
      id: 's1', name: 'Lobby', status: 'ONLINE', screenGroup: null, lastPingAt: null,
      lastCacheReport: null, renderHealth: 'OK', renderStale: false, renderStaleSeconds: 5,
      effectiveLatitude: null, effectiveLongitude: null, effectiveAddress: null,
      geoSource: 'none', sourceTenant: { id: 'hq', name: 'hq', slug: 'hq' }, pushChannel: 'live',
    },
  ],
};

function seedRole(role: string) {
  useAppStore.setState({
    user: { id: 'u1', email: 'a@b.c', role, tenantId: 'hq', canTriggerPanic: false } as never,
  });
}

beforeAll(() => {
  global.fetch = jest.fn(async () => ({ ok: false })) as any;
});

beforeEach(() => {
  window.localStorage.clear();
  fleetResult = { data: FLEET, isPending: false };
  seedRole('DISTRICT_ADMIN');
});

describe('the default home', () => {
  it('an admin lands on Fleet Command, not the old card stack', () => {
    render(<MobileDashboard schoolId="hq" />);
    expect(rtl.getByTestId('mobile-fleet-command')).toBeInTheDocument();
    expect(rtl.queryByTestId('starter-board')).toBeNull();
  });

  it('a SCHOOL_ADMIN gets it too — a leaf location reads its own fleet', () => {
    seedRole('SCHOOL_ADMIN');
    render(<MobileDashboard schoolId="hq" />);
    expect(rtl.getByTestId('mobile-fleet-command')).toBeInTheDocument();
  });
});

describe('the rollback contract', () => {
  it('a stored "classic" preference reaches the classic stack — with no frame of v1 first', () => {
    window.localStorage.setItem(MOBILE_SHELL_KEY, 'classic');
    const { container } = render(<MobileDashboard schoolId="hq" />);
    // Nothing painted before the preference was read: the very first commit
    // must not contain the surface the operator opted out of.
    expect(container.querySelector('[data-testid="mobile-fleet-command"]')).toBeNull();
    expect(rtl.getByTestId('starter-board')).toBeInTheDocument();
  });

  it('a stored "v1" preference reaches Fleet Command with no frame of classic first', () => {
    window.localStorage.setItem(MOBILE_SHELL_KEY, 'v1');
    const { container } = render(<MobileDashboard schoolId="hq" />);
    expect(container.querySelector('[data-testid="starter-board"]')).toBeNull();
    expect(rtl.getByTestId('mobile-fleet-command')).toBeInTheDocument();
  });
});

describe('roles that cannot read a fleet', () => {
  /**
   * `GET /screens/fleet` is @RequireRoles(SUPER, DISTRICT, SCHOOL). Handing
   * Fleet Command to anyone else would render a surface whose every number
   * comes back 403 — §10's "never let a user discover permissions by
   * receiving a 403", applied to a whole screen.
   */
  it.each(['CONTRIBUTOR', 'RESTRICTED_VIEWER'])('%s keeps the classic stack', (role) => {
    seedRole(role);
    render(<MobileDashboard schoolId="hq" />);
    expect(rtl.queryByTestId('mobile-fleet-command')).toBeNull();
    expect(rtl.getByTestId('starter-board')).toBeInTheDocument();
  });
});

describe('§13 — loading and failure', () => {
  it('a pending fleet read shows a geometry-matched skeleton, never a bare spinner', () => {
    fleetResult = { data: undefined, isPending: true };
    render(<MobileDashboard schoolId="hq" />);
    const skeleton = rtl.getByTestId('mobile-home-skeleton');
    // Same shape as the real thing: a header line, the needs-attention card,
    // a 2×2 assurance grid and one section below it.
    expect(skeleton.querySelector('.grid-cols-2')!.children).toHaveLength(4);
    expect(rtl.queryByTestId('mobile-fleet-command')).toBeNull();
  });

  /**
   * An errored read must never become an all-zero Fleet Command. Falling
   * through to the classic stack is honest: it carries its own independent
   * reads and its own error states.
   */
  it('a failed fleet read falls through to the classic stack, not a zeroed command surface', () => {
    fleetResult = { data: undefined, isPending: false, isError: true };
    render(<MobileDashboard schoolId="hq" />);
    expect(rtl.queryByTestId('mobile-fleet-command')).toBeNull();
    expect(rtl.getByTestId('starter-board')).toBeInTheDocument();
  });
});
