/**
 * The encode-target provider's REAL mount point (2026-09-24).
 *
 * `useEncodeTarget()` falls back to 1920 × 1080 / panel-unknown wherever no
 * provider is mounted, so a provider that quietly fell out of the layout
 * would fail nothing — and would grade every 4K file as "larger than your
 * biggest screen" on a fleet of 4K panels. This renders the real SchoolLayout
 * with a child that reads the target and proves the fleet's answer reaches
 * it (CLAUDE.md #9: verify the render tree, not the component's own word).
 */
import { render, screen, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('next/navigation', () => ({
  useParams: () => ({ schoolId: 'riot-cle' }),
}));

// The chrome's dozen data hooks are not what this proves.
jest.mock('@/components/layout/DashboardLayout', () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dashboard-chrome">{children}</div>
  ),
}));

const apiFetchMock = jest.fn();
jest.mock('@/lib/api-client', () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
}));

import SchoolLayout from '../layout';
import { useEncodeTarget } from '@/hooks/use-encode-target';
import { useUIStore } from '@/store/ui-store';

function TargetProbe() {
  const t = useEncodeTarget();
  return (
    <div data-testid="target">{`${t.panelWidth}x${t.panelHeight}:${t.panelKnown ? 'known' : 'unknown'}`}</div>
  );
}

async function renderUnderLayout() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    render(
      <QueryClientProvider client={qc}>
        <SchoolLayout>
          <TargetProbe />
        </SchoolLayout>
      </QueryClientProvider>,
    );
  });
}

describe('SchoolLayout mounts EncodeTargetProvider', () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    useUIStore.setState({
      token: 'session.jwt.token',
      user: {
        id: 'u1',
        email: 'ops@riotcolor.com',
        role: 'SCHOOL_ADMIN',
        tenantId: 'tenant-riot-cle',
        tenantSlug: 'riot-cle',
        mustSetupCredentials: false,
      },
    });
  });

  it('hands the fleet’s largest panel to every page under the layout', async () => {
    apiFetchMock.mockResolvedValue({ panelWidth: 3840, panelHeight: 2160, panelKnown: true });
    await renderUnderLayout();
    expect(screen.getByTestId('dashboard-chrome')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('target')).toHaveTextContent('3840x2160:known'));
    expect(apiFetchMock).toHaveBeenCalledWith('/screens/panel-target');
  });

  it('keeps the default target while the fleet has no panel size to offer', async () => {
    apiFetchMock.mockResolvedValue({ panelWidth: null, panelHeight: null, panelKnown: false });
    await renderUnderLayout();
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledWith('/screens/panel-target'));
    expect(screen.getByTestId('target')).toHaveTextContent('1920x1080:unknown');
  });
});
