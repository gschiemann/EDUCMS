/**
 * Settings Command Center — Billing / Developer & audit / My security.
 *
 * Four behaviours that are easy to regress and expensive when they go:
 *
 *   1. BILLING WITH STRIPE DORMANT offers no checkout action at all. The old
 *      page always rendered "Choose Monthly" and only admitted online
 *      payments were unconfigured in an alert AFTER the operator clicked —
 *      a dead button wearing a real-button costume (handoff §7.9, §11).
 *   2. DEVELOPER & AUDIT refuses a SCHOOL_ADMIN with the shell's permission
 *      page naming the category and who can grant access (§10) — not a
 *      redirect to somewhere unrelated.
 *   3. MY SECURITY renders for a CONTRIBUTOR. It is account-scoped and every
 *      authenticated role must reach it (§5, §7.11, §22).
 *   4. THE SAMPLE-DATA HARNESS is refused to a DISTRICT_ADMIN in production.
 *      "Sample integration data is absent from ordinary production operator
 *      navigation" (§22) is the acceptance criterion; this is its test.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';

const apiFetch = jest.fn();
jest.mock('@/lib/api-client', () => ({
  apiFetch: (...a: any[]) => apiFetch(...a),
}));

jest.mock('next/navigation', () => ({
  useParams: () => ({ schoolId: 'springfield' }),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
  usePathname: () => '/springfield/settings/billing',
  useSearchParams: () => new URLSearchParams(),
}));

import { SettingsShellProvider } from '@/components/settings/shell/SettingsShellContext';
import { useUIStore } from '@/store/ui-store';
import BillingPage from '../../../app/[schoolId]/settings/billing/page';
import DeveloperPage from '../../../app/[schoolId]/settings/developer/page';
import SecurityPage from '../../../app/[schoolId]/settings/security/page';
import TestIntegrationsPage from '../../../app/[schoolId]/settings/test-integrations/page';
import { developerToolsVisible } from '../developer-tools';

function renderInShell(ui: ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <SettingsShellProvider>{ui}</SettingsShellProvider>
    </QueryClientProvider>,
  );
}

function setRole(role: string) {
  useUIStore.setState({
    user: { id: 'u1', email: 'a@b.c', name: 'A', role, tenantId: 't1', tenantName: 'Springfield' } as any,
  });
}

beforeEach(() => {
  apiFetch.mockReset();
  apiFetch.mockImplementation(() => Promise.resolve(null));
});

describe('Billing — Stripe not configured', () => {
  const TIERS = [
    { id: 'FREE_TRIAL', name: 'Free trial', blurb: '', monthlyPriceCents: 0, annualPriceCents: 0, features: [], recommended: false },
    { id: 'MONTHLY', name: 'Monthly', blurb: '', monthlyPriceCents: 2500, annualPriceCents: null, features: [], recommended: false },
    { id: 'ANNUAL', name: 'Annual', blurb: '', monthlyPriceCents: null, annualPriceCents: 24000, features: [], recommended: true },
  ];

  function mockBilling(stripeEnabled: boolean) {
    apiFetch.mockImplementation((url: string) => {
      if (url === '/billing/status') return Promise.resolve({ stripeEnabled });
      if (url === '/billing/invoices') return Promise.resolve({ stripeEnabled, invoices: [] });
      if (url === '/license/tiers') return Promise.resolve(TIERS);
      if (url === '/license/current')
        return Promise.resolve({ tier: 'PILOT', tierName: 'Free pilot', seatLimit: 3, seatsUsed: 1, status: 'ACTIVE', isPilot: true });
      return Promise.resolve(null);
    });
  }

  it('renders the managed-externally state and NO checkout action', async () => {
    setRole('DISTRICT_ADMIN');
    mockBilling(false);
    renderInShell(<BillingPage />);

    expect(await screen.findByText('Billing is managed outside VenueOS')).toBeInTheDocument();
    // The plan catalogue still renders (pricing is useful information) but
    // nothing in it can start a checkout.
    await waitFor(() => expect(screen.getByText('Annual')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /Choose/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Manage billing/i })).not.toBeInTheDocument();
    // …and the real path forward is named.
    expect(screen.getAllByRole('link', { name: 'Contact sales' }).length).toBeGreaterThan(0);
  });

  it('offers checkout once the API reports Stripe configured', async () => {
    setRole('DISTRICT_ADMIN');
    mockBilling(true);
    renderInShell(<BillingPage />);

    expect(await screen.findByRole('button', { name: /Choose Monthly/i })).toBeInTheDocument();
    expect(screen.queryByText('Billing is managed outside VenueOS')).not.toBeInTheDocument();
  });
});

describe('Developer & audit — permission', () => {
  it('refuses a SCHOOL_ADMIN by name, and says who can grant access', () => {
    setRole('SCHOOL_ADMIN');
    renderInShell(<DeveloperPage />);
    expect(screen.getByText(/You don’t have access to Developer & audit/)).toBeInTheDocument();
    expect(screen.getByText(/can grant access to this section/)).toBeInTheDocument();
    // No developer surface leaked into the denied view.
    expect(screen.queryByText('API keys')).not.toBeInTheDocument();
  });
});

describe('My security — every authenticated role', () => {
  it('renders password + two-factor for a CONTRIBUTOR', async () => {
    setRole('CONTRIBUTOR');
    apiFetch.mockImplementation((url: string) => {
      if (url === '/auth/mfa/status') return Promise.resolve({ enabled: false });
      return Promise.resolve(null);
    });
    renderInShell(<SecurityPage />);
    expect(await screen.findByText('Your account security')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Password' })).toBeInTheDocument();
    // The MfaCard carries its own heading too, so assert presence, not count.
    expect(screen.getAllByRole('heading', { name: 'Two-factor authentication' }).length).toBeGreaterThan(0);
    // The containment behaviour that IS built is stated; no invented
    // "active sessions" list.
    expect(screen.getByText(/does not list your individual sessions yet/)).toBeInTheDocument();
  });
});

describe('Sample-data harness visibility', () => {
  const realEnv = process.env.NODE_ENV;
  afterEach(() => {
    (process.env as any).NODE_ENV = realEnv;
  });

  it('developerToolsVisible: super admin always; district admin only outside production', () => {
    (process.env as any).NODE_ENV = 'production';
    expect(developerToolsVisible('SUPER_ADMIN')).toBe(true);
    expect(developerToolsVisible('DISTRICT_ADMIN')).toBe(false);
    expect(developerToolsVisible('SCHOOL_ADMIN')).toBe(false);
    expect(developerToolsVisible(undefined)).toBe(false);

    (process.env as any).NODE_ENV = 'development';
    expect(developerToolsVisible('DISTRICT_ADMIN')).toBe(true);
    expect(developerToolsVisible('SCHOOL_ADMIN')).toBe(false);
  });

  it('the page itself refuses a DISTRICT_ADMIN in production', () => {
    (process.env as any).NODE_ENV = 'production';
    setRole('DISTRICT_ADMIN');
    renderInShell(<TestIntegrationsPage />);
    expect(screen.getByText(/You don’t have access to Integration test data/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Run full audit/i })).not.toBeInTheDocument();
  });

  it('the page opens for a SUPER_ADMIN in production', async () => {
    (process.env as any).NODE_ENV = 'production';
    setRole('SUPER_ADMIN');
    apiFetch.mockImplementation((url: string) => {
      if (url.startsWith('/health/integrations'))
        return Promise.resolve({ generatedAt: new Date().toISOString(), generatedInMs: 5, summary: {}, rows: [] });
      return Promise.resolve(null);
    });
    renderInShell(<TestIntegrationsPage />);
    expect(await screen.findByRole('button', { name: /Run full audit/i })).toBeInTheDocument();
  });
});
