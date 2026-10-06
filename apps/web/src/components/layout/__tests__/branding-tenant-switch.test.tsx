import { act, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrandingProvider } from '@/lib/branding-context';
import { BrandMark } from '../BrandMark';
import { useUIStore } from '@/store/ui-store';
import { apiFetch } from '@/lib/api-client';

jest.mock('@/lib/api-client', () => ({ apiFetch: jest.fn() }));
jest.mock('@/hooks/use-tenant-copy', () => ({ useTenantCopy: () => ({ defaultBrandName: 'VenueOS' }) }));

it('rebinds every brand consumer on tenant change and never paints another tenant cache', async () => {
  const a = { displayName: 'Test Alpha', logoUrl: 'https://cdn.example.test/alpha.png' };
  const b = { displayName: 'Test Beta', logoUrl: 'https://cdn.example.test/beta.png' };
  let resolveBeta!: (value: typeof b) => void;
  (apiFetch as jest.Mock).mockResolvedValueOnce(a).mockImplementationOnce(() => new Promise((resolve) => { resolveBeta = resolve; }));
  localStorage.clear();
  localStorage.setItem('edu-cms-branding-cache-v1', JSON.stringify(a));
  act(() => useUIStore.setState({ user: { id: 'test-user', tenantId: 'alpha' } as never }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(<QueryClientProvider client={client}><BrandingProvider><BrandMark /><BrandMark /></BrandingProvider></QueryClientProvider>);
  await waitFor(() => expect(screen.getAllByRole('img', { name: 'Test Alpha' })).toHaveLength(2));
  expect(apiFetch).toHaveBeenCalledTimes(1);
  act(() => useUIStore.setState({ user: { id: 'test-user', tenantId: 'beta' } as never }));
  expect(screen.queryByRole('img', { name: 'Test Alpha' })).not.toBeInTheDocument();
  await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(2));
  await act(async () => resolveBeta(b));
  await waitFor(() => expect(screen.getAllByRole('img', { name: 'Test Beta' })).toHaveLength(2));
  expect(client.getQueryData(['branding', 'me', 'alpha'])).toEqual(a);
  expect(client.getQueryData(['branding', 'me', 'beta'])).toEqual(b);
  view.unmount();
  client.clear();
});
