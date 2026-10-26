/**
 * The Settings home (Phase 1 simplification, 2026-10-26).
 *
 *   - an admin sees search, the six areas with plain names, and ONE clear
 *     link to Activity (owner decision 4: not in the sidebar);
 *   - an Editor or Viewer is sent to My account (owner decision 1);
 *   - "Needs attention" quotes the server, at most three lines, each with
 *     its fix as the button;
 *   - the Emergency card's status is the server's verdict, never invented.
 */
import { render, screen, within } from '@testing-library/react';
import { SettingsShellProvider } from '../../shell/SettingsShellContext';

const replace = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace, prefetch: jest.fn() }),
  usePathname: () => '/springfield/settings',
  useParams: () => ({ schoolId: 'springfield' }),
}));
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

let role = 'DISTRICT_ADMIN';
jest.mock('@/store/ui-store', () => ({
  useUIStore: Object.assign((sel: any) => sel({ user: { role } }), { getState: () => ({}), setState: () => {} }),
}));
let vertical = 'K12';
jest.mock('@/hooks/use-tenant-copy', () => ({ useTenantCopy: () => ({ vertical }) }));
jest.mock('@/hooks/use-api', () => ({ useTenant: () => ({ data: { name: 'Lincoln Unified' } }) }));

let readiness: any = null;
const readinessEnabled = jest.fn();
jest.mock('@/hooks/use-settings-cc', () => ({
  useEmergencyReadiness: (opts: { enabled: boolean }) => {
    readinessEnabled(opts.enabled);
    return { data: opts.enabled ? readiness : undefined, isLoading: false };
  },
}));
let billing: any = null;
jest.mock('@/components/billing/billing-summary', () => ({
  useBillingSummary: (enabled: boolean) => ({ data: enabled ? billing : undefined }),
}));

import { SettingsHome } from '../SettingsHome';

function mount() {
  return render(
    <SettingsShellProvider>
      <SettingsHome />
    </SettingsShellProvider>,
  );
}

beforeEach(() => {
  role = 'DISTRICT_ADMIN';
  vertical = 'K12';
  readiness = null;
  billing = null;
  replace.mockReset();
  readinessEnabled.mockReset();
});

it('an admin sees search, the six areas and one link to Activity', () => {
  mount();
  expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
  expect(screen.getByText('Lincoln Unified')).toBeInTheDocument();
  expect(screen.getByTestId('settings-home-search')).toHaveTextContent('Search settings');
  for (const [id, name] of [
    ['organization', 'Organization'],
    ['emergency', 'Emergency'],
    ['team', 'Team'],
    ['connections', 'Connections'],
    ['billing', 'Plan & billing'],
    ['advanced', 'Advanced'],
  ]) {
    expect(screen.getByTestId(`settings-home-area-${id}`)).toHaveTextContent(name);
  }
  expect(screen.getByTestId('settings-home-area-organization')).toHaveAttribute('href', '/springfield/settings/organization');
  expect(screen.getByTestId('settings-home-area-team')).toHaveAttribute('href', '/springfield/settings/people');
  const activity = screen.getByTestId('settings-home-activity');
  expect(activity).toHaveAttribute('href', '/springfield/audit');
  expect(activity).toHaveTextContent('Activity');
  expect(screen.getByTestId('settings-home-account')).toHaveAttribute('href', '/springfield/account');
  expect(replace).not.toHaveBeenCalled();
});

it('a location admin opens Organization on the page they can change', () => {
  role = 'SCHOOL_ADMIN';
  mount();
  expect(screen.getByTestId('settings-home-area-organization')).toHaveAttribute('href', '/springfield/settings/branding');
});

it.each(['CONTRIBUTOR', 'RESTRICTED_VIEWER'])('%s is sent to My account and fires no admin reads', (r) => {
  role = r;
  mount();
  expect(replace).toHaveBeenCalledWith('/springfield/account');
  expect(screen.queryByTestId('settings-home-area-organization')).toBeNull();
  expect(screen.queryByTestId('settings-home-activity')).toBeNull();
  expect(readinessEnabled).toHaveBeenCalledWith(false);
});

it('quotes the server under "Needs attention", fix first, at most three lines', () => {
  readiness = {
    verdict: 'NEEDS_ATTENTION',
    items: [
      { key: 'content', status: 'ok', code: 'content.allStandard' },
      { key: 'delivery', status: 'ok', code: 'delivery.ok' },
      { key: 'screens', status: 'missing', code: 'screens.none', params: { total: 0, online: 0 } },
      { key: 'staff', status: 'warn', code: 'staff.one', params: { count: 1 } },
      { key: 'exercise', status: 'warn', code: 'exercise.never' },
    ],
  };
  billing = { state: 'trial', daysLeft: 3, prices: { monthlyCents: 0, annualCents: 0 } };
  mount();
  const list = screen.getByTestId('settings-home-attention');
  const lines = within(list).getAllByRole('listitem');
  expect(lines).toHaveLength(3);
  expect(within(lines[0]).getByText('Only one person can send an alert.')).toBeInTheDocument();
  expect(within(lines[0]).getByRole('link', { name: 'Choose people' })).toHaveAttribute('href', '/springfield/settings/people');
  expect(within(lines[1]).getByText('No screens are paired yet, so an alert would reach no one.')).toBeInTheDocument();
  expect(within(lines[1]).getByRole('link', { name: 'Pair a screen' })).toHaveAttribute('href', '/springfield/screens');
  // The emergency card says what the server said.
  expect(screen.getByTestId('settings-home-status-emergency')).toHaveTextContent('Needs attention');
  expect(screen.getByTestId('settings-home-status-billing')).toHaveTextContent('Free trial · 3 days left');
});

it('a ready organization shows no attention list and a Ready emergency card', () => {
  readiness = { verdict: 'READY', items: [] };
  billing = { state: 'active', prices: { monthlyCents: 0, annualCents: 0 } };
  mount();
  expect(screen.queryByTestId('settings-home-attention')).toBeNull();
  expect(screen.getByTestId('settings-home-status-emergency')).toHaveTextContent('Ready');
  expect(screen.getByTestId('settings-home-status-billing')).toHaveTextContent('Active');
});
