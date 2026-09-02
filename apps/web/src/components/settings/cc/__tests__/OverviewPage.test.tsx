/**
 * Settings Overview (§7.1) — what the page is allowed to claim.
 *
 * The three behaviours worth locking down: it renders an editor-shaped
 * skeleton while the tenant is still loading, it quotes the SERVER's
 * readiness items (never a status it invented), and a role the server would
 * refuse fires no admin-only request at all — it says so instead.
 */
import { screen, waitFor } from '@testing-library/react';

const apiFetch = jest.fn();
jest.mock('@/lib/api-client', () => ({
  apiFetch: (path: string, opts?: any) => apiFetch(path, opts),
}));

let role = 'DISTRICT_ADMIN';
const uiState = () => ({ user: { role, tenantVertical: 'K12' } });
jest.mock('@/store/ui-store', () => ({
  useUIStore: Object.assign((sel: any) => sel(uiState()), {
    getState: () => uiState(),
    setState: () => {},
  }),
}));

const push = jest.fn();
jest.mock('next/navigation', () => ({
  useParams: () => ({ schoolId: 'springfield' }),
  useRouter: () => ({ push, replace: push, prefetch: jest.fn() }),
  usePathname: () => '/springfield/settings/overview',
}));

import { renderInShell } from './testHarness';
import { SettingsOverviewPage } from '../OverviewPage';

const TENANT = { id: 't1', name: 'Springfield District', vertical: 'K12', parentId: null };

function routes(overrides: Record<string, unknown> = {}) {
  apiFetch.mockImplementation(async (path: string) => {
    if (path === '/tenants') return TENANT;
    if (path === '/emergency/readiness') {
      return (
        overrides['/emergency/readiness'] ?? {
          verdict: 'READY',
          score: 100,
          items: [{ key: 'content', status: 'ok', label: 'Alert content', detail: 'All wired.', fixHint: '' }],
          computedAt: new Date().toISOString(),
        }
      );
    }
    if (path === '/license/me') {
      return (
        overrides['/license/me'] ?? {
          tier: 'PILOT', seatLimit: 1000, seatsUsed: 3, seatsAvailable: 997,
          status: 'ACTIVE', expiresAt: null, isPilot: true, atLimit: false,
        }
      );
    }
    if (path.startsWith('/audit')) return overrides['/audit'] ?? { items: [], total: 0, limit: 25, offset: 0 };
    return {};
  });
}

beforeEach(() => {
  role = 'DISTRICT_ADMIN';
  apiFetch.mockReset();
  push.mockReset();
});

it('shows an editor-shaped skeleton until the tenant payload lands', () => {
  apiFetch.mockImplementation(() => new Promise(() => {}));
  const { container } = renderInShell(<SettingsOverviewPage />);
  expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument();
});

it('quotes the server readiness items as attention, with the owning category', async () => {
  routes({
    '/emergency/readiness': {
      verdict: 'NOT_CONFIGURED',
      score: 20,
      items: [
        { key: 'content', status: 'missing', label: 'Alert content', detail: 'Lockdown has no content.', fixHint: 'Wire a playlist.' },
        { key: 'exercise', status: 'warn', label: 'Last exercise', detail: 'No drill in 120 days.', fixHint: 'Run a drill.' },
      ],
      computedAt: new Date().toISOString(),
    },
  });
  renderInShell(<SettingsOverviewPage />);

  expect(await screen.findByText('Alert content')).toBeInTheDocument();
  expect(screen.getByText('Lockdown has no content. Wire a playlist.')).toBeInTheDocument();
  expect(screen.getByText('Last exercise')).toBeInTheDocument();
  // Every attention item names the category that owns the fix.
  expect(screen.getAllByText('Open Emergency').length).toBe(2);
  // The verdict is the server's, not one derived in the browser.
  expect(screen.getByText('Not ready')).toBeInTheDocument();
});

it('raises the license blocker when seats are full', async () => {
  routes({
    '/license/me': {
      tier: 'MONTHLY', seatLimit: 5, seatsUsed: 5, seatsAvailable: 0,
      status: 'ACTIVE', expiresAt: null, isPilot: false, atLimit: true,
    },
  });
  renderInShell(<SettingsOverviewPage />);
  expect(await screen.findByText('Screen seats are full')).toBeInTheDocument();
  expect(screen.getByText('Open Billing')).toBeInTheDocument();
});

it('a CONTRIBUTOR fires no admin-only read and is told why, not shown an empty list', async () => {
  role = 'CONTRIBUTOR';
  routes();
  renderInShell(<SettingsOverviewPage />);

  expect(await screen.findByText('Springfield District')).toBeInTheDocument();
  await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/tenants', undefined));
  const called = apiFetch.mock.calls.map((c) => c[0]);
  expect(called).not.toContain('/emergency/readiness');
  expect(called.some((p: string) => p.startsWith('/audit'))).toBe(false);
  expect(screen.getAllByText('Readiness checks are available to administrators.').length).toBeGreaterThan(0);
  expect(screen.getByText('The audit log is available to administrators.')).toBeInTheDocument();
});

it('says the state is UNKNOWN when the readiness check itself fails', async () => {
  apiFetch.mockImplementation(async (path: string) => {
    if (path === '/tenants') return TENANT;
    if (path === '/emergency/readiness') throw new Error('boom');
    if (path === '/license/me') return { tier: 'PILOT', seatLimit: 10, seatsUsed: 1, seatsAvailable: 9, status: 'ACTIVE', expiresAt: null, isPilot: true, atLimit: false };
    return { items: [], total: 0, limit: 25, offset: 0 };
  });
  renderInShell(<SettingsOverviewPage />);
  expect(await screen.findByText('Unknown')).toBeInTheDocument();
  expect(
    screen.getByText('The readiness check itself failed, so the configuration state is unknown right now.'),
  ).toBeInTheDocument();
});

it('names the audit window rather than claiming nothing ever changed', async () => {
  routes({ '/audit': { items: [{ id: 'a1', action: 'ASSET_APPROVED', targetType: 'Asset', targetId: 'x', details: null, createdAt: new Date().toISOString(), user: { email: 'a@b.c' } }], total: 1, limit: 25, offset: 0 } });
  renderInShell(<SettingsOverviewPage />);
  expect(
    await screen.findByText('No settings changes in the 25 most recent recorded events.'),
  ).toBeInTheDocument();
});
