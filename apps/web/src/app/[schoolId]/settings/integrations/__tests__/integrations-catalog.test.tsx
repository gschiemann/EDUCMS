/**
 * The Integrations catalog page — what the operator can actually see and
 * click (handoff §7.7 / §11).
 *
 * The contracts under test are the ones a redesign could quietly break:
 *   1. A `planned` row renders NO interactive control — no link, no
 *      button. "Coming soon" wearing a real-button costume is banned.
 *   2. An `unsupported` row renders no control either, and says why.
 *   3. Family and state filters actually filter.
 *   4. Every row names the status source that produced its state.
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
    name: 'AI provider key',
    family: 'ai',
    route: 'integrations/ai',
    statusSource: 'aiKey',
    state: 'connected',
    action: { kind: 'manage', href: 'integrations/ai' },
    searchTerms: ['ai key', 'anthropic'],
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
    id: 'streaming:atmosphere',
    name: 'Atmosphere TV',
    family: 'streaming',
    route: 'integrations/streaming',
    statusSource: 'streamingConnections',
    state: 'external',
    action: { kind: 'instructions', href: 'integrations/streaming' },
    searchTerms: ['atmosphere'],
  },
  {
    id: 'streaming:soundtrack',
    name: 'Soundtrack Your Brand',
    family: 'streaming',
    route: 'integrations/streaming',
    statusSource: 'streamingConnections',
    state: 'planned',
    detail: 'Real API, adapter not built.',
    action: { kind: 'none' },
    searchTerms: ['soundtrack', 'music'],
  },
  {
    id: 'streaming:consumer-entertainment',
    name: 'Hulu · Netflix · Disney+ · Max',
    family: 'streaming',
    route: 'integrations/streaming',
    statusSource: 'catalogPolicy',
    state: 'unsupported',
    action: { kind: 'none' },
    searchTerms: ['hulu', 'netflix'],
  },
  {
    id: 'pos:square',
    name: 'Square',
    family: 'pos',
    route: 'integrations/pos',
    statusSource: 'posConnections',
    state: 'degraded',
    action: { kind: 'diagnose', href: 'integrations/pos' },
    searchTerms: ['square', 'pos'],
  },
];

const refetchAll = jest.fn();
jest.mock('@/components/settings/integrations/useIntegrationsCatalog', () => ({
  useIntegrationsCatalog: () => ({
    entries: ENTRIES,
    loading: false,
    degradedSources: false,
    refetchAll,
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

describe('Integrations catalog rows', () => {
  it('renders every provider with its §11 status pill', () => {
    renderPage();
    expect(within(rowFor('AI provider key')).getByText('Connected')).toBeInTheDocument();
    expect(within(rowFor('Custom HLS Stream')).getByText('Not configured')).toBeInTheDocument();
    expect(within(rowFor('Atmosphere TV')).getByText('External device')).toBeInTheDocument();
    expect(within(rowFor('Soundtrack Your Brand')).getByText('Planned')).toBeInTheDocument();
    expect(within(rowFor('Square')).getByText('Degraded')).toBeInTheDocument();
  });

  it('gives a planned row NO interactive control', () => {
    renderPage();
    const row = rowFor('Soundtrack Your Brand');
    expect(within(row).queryByRole('link')).toBeNull();
    expect(within(row).queryByRole('button')).toBeNull();
    expect(within(row).getByText('No action available')).toBeInTheDocument();
  });

  it('gives an unsupported row no control and explains the state', () => {
    renderPage();
    const row = rowFor('Hulu · Netflix · Disney+ · Max');
    expect(within(row).queryByRole('link')).toBeNull();
    expect(within(row).queryByRole('button')).toBeNull();
    expect(within(row).getByText(/Intentionally unavailable/i)).toBeInTheDocument();
  });

  it('gives each actionable row exactly one primary action, pointed at its route', () => {
    renderPage();
    const hls = within(rowFor('Custom HLS Stream')).getAllByRole('link');
    expect(hls).toHaveLength(1);
    expect(hls[0]).toHaveAttribute('href', '/school-1/settings/integrations/streaming');
    expect(hls[0]).toHaveTextContent('Configure');

    const external = within(rowFor('Atmosphere TV')).getAllByRole('link');
    expect(external).toHaveLength(1);
    expect(external[0]).toHaveTextContent('View setup instructions');
  });

  it('names the status source on every row', () => {
    renderPage();
    expect(within(rowFor('AI provider key')).getByText(/GET \/ai\/key/)).toBeInTheDocument();
    expect(
      within(rowFor('Hulu · Netflix · Disney+ · Max')).getByText(/Stated product policy/),
    ).toBeInTheDocument();
  });
});

describe('filters', () => {
  it('filters by family', () => {
    renderPage();
    expect(screen.getByText('Square')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Streaming & video' }));
    expect(screen.queryByText('Square')).toBeNull();
    expect(screen.getByText('Custom HLS Stream')).toBeInTheDocument();
  });

  it('filters by §11 state', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'External device' }));
    expect(screen.getByText('Atmosphere TV')).toBeInTheDocument();
    expect(screen.queryByText('Custom HLS Stream')).toBeNull();
    expect(screen.queryByText('AI provider key')).toBeNull();
  });

  it('filters by free-text search', () => {
    renderPage();
    fireEvent.change(screen.getByLabelText('Search integrations'), { target: { value: 'netflix' } });
    expect(screen.getByText('Hulu · Netflix · Disney+ · Max')).toBeInTheDocument();
    expect(screen.queryByText('Square')).toBeNull();
  });

  it('shows a named empty state when nothing matches', () => {
    renderPage();
    fireEvent.change(screen.getByLabelText('Search integrations'), { target: { value: 'zzzz' } });
    expect(screen.getByText('No integrations match these filters')).toBeInTheDocument();
  });
});
