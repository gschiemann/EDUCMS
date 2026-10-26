/**
 * Connections → All — what the operator can actually see and click
 * (handoff §7.7 / §11; Settings simplification Phase 1, 2026-10-26).
 *
 * The contracts under test are the ones a redesign could quietly break:
 *   1. Only things that really connect are listed (the catalog filters; the
 *      page lists what it is given), and one plain sentence answers the
 *      "why can't I add Netflix" question instead of a dead row.
 *   2. Every row has exactly one action, in plain words ("Connect", "Fix").
 *   3. Family and state filters actually filter; the kinds come in the order
 *      this business uses them.
 *   4. Every row names, in plain words, where its status came from.
 */
import * as React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { IntegrationCatalogEntry } from '@/components/settings/integrations/catalog';

const push = jest.fn();
jest.mock('next/navigation', () => ({
  useParams: () => ({ schoolId: 'school-1' }),
  useRouter: () => ({ push, replace: jest.fn(), refresh: jest.fn() }),
  usePathname: () => '/school-1/settings/integrations',
}));

const ENTRIES: IntegrationCatalogEntry[] = [
  {
    id: 'ai:key',
    name: 'Your AI key',
    family: 'ai',
    route: 'integrations/ai',
    statusSource: 'aiKey',
    state: 'connected',
    action: { kind: 'manage', href: 'integrations/ai' },
    searchTerms: ['ai key', 'anthropic'],
  },
  {
    id: 'pos:square',
    name: 'Square',
    family: 'pos',
    route: 'integrations/pos',
    statusSource: 'posConnections',
    state: 'degraded',
    detail: 'Square refused the saved sign-in.',
    action: { kind: 'diagnose', href: 'integrations/pos' },
    searchTerms: ['square', 'pos'],
  },
  {
    id: 'pos:toast',
    name: 'Toast',
    family: 'pos',
    route: 'integrations/pos',
    statusSource: 'posConnections',
    state: 'notConfigured',
    detail: 'Sync published menu items, prices, and photos from Toast.',
    action: { kind: 'configure', href: 'integrations/pos' },
    searchTerms: ['toast', 'pos'],
  },
  {
    id: 'streaming:custom-hls',
    name: 'Custom HLS Stream',
    family: 'streaming',
    route: 'integrations/streaming',
    statusSource: 'streamingConnections',
    state: 'notConfigured',
    action: { kind: 'configure', href: 'integrations/streaming' },
    searchTerms: ['hls'],
  },
  {
    id: 'clever:roster',
    name: 'Clever roster sync',
    family: 'clever',
    route: 'integrations/clever',
    statusSource: 'cleverStatus',
    state: 'notConfigured',
    action: { kind: 'configure', href: 'integrations/clever' },
    searchTerms: ['clever'],
  },
];

let vertical = 'K12';
const refetchAll = jest.fn();
jest.mock('@/components/settings/integrations/useIntegrationsCatalog', () => ({
  useIntegrationsCatalog: () => ({
    entries: ENTRIES,
    loading: false,
    degradedSources: false,
    refetchAll,
    vertical,
  }),
}));

import { SettingsShellProvider } from '@/components/settings/shell/SettingsShellContext';
import IntegrationsPage from '../page';

function renderPage() {
  return render(
    <SettingsShellProvider>
      <IntegrationsPage />
    </SettingsShellProvider>,
  );
}

/** The row container for a given provider name. */
function rowFor(name: string): HTMLElement {
  const label = screen.getByText(name);
  const li = label.closest('li');
  if (!li) throw new Error(`no row for ${name}`);
  return li as HTMLElement;
}

beforeEach(() => {
  vertical = 'K12';
});

describe('Connections rows', () => {
  it('renders every provider with a plain status', () => {
    renderPage();
    expect(within(rowFor('Your AI key')).getByText('Connected')).toBeInTheDocument();
    expect(within(rowFor('Custom HLS Stream')).getByText('Not set up')).toBeInTheDocument();
    expect(within(rowFor('Square')).getByText('Needs attention')).toBeInTheDocument();
    expect(within(rowFor('Toast')).getByText('Not set up')).toBeInTheDocument();
  });

  it('gives each row exactly one action, in plain words, pointed at its page', () => {
    renderPage();
    const hls = within(rowFor('Custom HLS Stream')).getAllByRole('link');
    expect(hls).toHaveLength(1);
    expect(hls[0]).toHaveAttribute('href', '/school-1/settings/integrations/streaming');
    expect(hls[0]).toHaveTextContent('Connect');
    const square = within(rowFor('Square')).getAllByRole('link');
    expect(square).toHaveLength(1);
    expect(square[0]).toHaveTextContent('Fix');
  });

  it('a healthy or unconnected provider reads its plain line; a problem keeps the server’s reason', () => {
    renderPage();
    expect(within(rowFor('Toast')).getByText('Your published menu, prices and photos, synced from Toast.')).toBeInTheDocument();
    expect(within(rowFor('Square')).getByText('Square refused the saved sign-in.')).toBeInTheDocument();
  });

  it('names the status source in plain words, never an API path', () => {
    renderPage();
    expect(within(rowFor('Your AI key')).getByText(/your saved AI key/)).toBeInTheDocument();
    expect(screen.queryByText(/GET \//)).toBeNull();
  });

  it('answers the Netflix question once, instead of a row that can never connect', () => {
    renderPage();
    expect(screen.getByTestId('connections-not-listed')).toHaveTextContent(/Netflix, Hulu, Disney\+/);
    expect(screen.queryByText('Hulu · Netflix · Disney+ · Max')).toBeNull();
  });
});

describe('filters', () => {
  it('filters by kind', () => {
    renderPage();
    expect(screen.getByText('Square')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Live video' }));
    expect(screen.queryByText('Square')).toBeNull();
    expect(screen.getByText('Custom HLS Stream')).toBeInTheDocument();
  });

  it('filters by state', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Needs attention' }));
    expect(screen.getByText('Square')).toBeInTheDocument();
    expect(screen.queryByText('Custom HLS Stream')).toBeNull();
    expect(screen.queryByText('Your AI key')).toBeNull();
  });

  it('a restaurant sees point of sale first', () => {
    vertical = 'RESTAURANT';
    renderPage();
    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(headings[0]).toBe('Point of sale');
  });

  it('filters by free-text search', () => {
    renderPage();
    fireEvent.change(screen.getByLabelText('Search connections'), { target: { value: 'toast' } });
    expect(screen.getByText('Toast')).toBeInTheDocument();
    expect(screen.queryByText('Square')).toBeNull();
  });

  it('shows a named empty state when nothing matches', () => {
    renderPage();
    fireEvent.change(screen.getByLabelText('Search connections'), { target: { value: 'zzzz' } });
    expect(screen.getByText('Nothing matches')).toBeInTheDocument();
  });
});
