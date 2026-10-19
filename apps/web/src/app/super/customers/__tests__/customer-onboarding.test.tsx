import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import NewCustomerPage from '../new/page';

const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
let deliveryFails = false;
const apiFetch = jest.fn(async (path: string, options: RequestInit) => {
  calls.push({ path, body: JSON.parse(String(options.body)) });
  if (path.endsWith('/starter-link/email')) {
    if (deliveryFails) throw new Error('Email unavailable');
    return { url: 'https://example.invalid/claim-account/emailed', expiresAt: '2026-10-25T00:00:00Z', emailDelivered: true };
  }
  return { id: 'created', slug: 'sample', starterLink: { url: 'https://example.invalid/claim-account/created', expiresAt: '2026-10-25T00:00:00Z' } };
});
jest.mock('@/lib/api-client', () => ({ apiFetch: (p: string, o: RequestInit) => apiFetch(p, o) }));
jest.mock('@/lib/store', () => ({ useAppStore: (selector: (s: unknown) => unknown) => selector({ user: { role: 'SUPER_ADMIN' } }) }));
jest.mock('next/link', () => ({ __esModule: true, default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
function mount() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><NewCustomerPage /></QueryClientProvider>);
  fireEvent.change(screen.getByLabelText('Organization name'), { target: { value: 'Sample customer' } });
  fireEvent.change(screen.getByLabelText(/^Owner email/), { target: { value: 'owner@example.invalid' } });
}
beforeEach(() => { calls.length = 0; deliveryFails = false; });
afterEach(cleanup);

it('creates full branding/package terms, then emails an authoritative one-time setup URL', async () => {
  mount();
  fireEvent.change(screen.getByLabelText('Logo URL'), { target: { value: 'https://example.invalid/logo.png' } });
  fireEvent.change(screen.getByLabelText('Custom package name'), { target: { value: 'Campus Plus' } });
  fireEvent.change(screen.getByLabelText('Fixed package / month (USD)'), { target: { value: '450' } });
  fireEvent.click(screen.getByLabelText('Corporate billing across locations'));
  fireEvent.click(screen.getByRole('button', { name: 'Create customer' }));
  await screen.findByTestId('customer-created');
  expect(calls[0]).toMatchObject({ path: '/super/customers', body: { name: 'Sample customer', logoUrl: 'https://example.invalid/logo.png', packageName: 'Campus Plus', packagePriceCents: 45000, pooledSeats: true } });
  expect(calls[1]).toEqual({ path: '/super/customers/created/starter-link/email', body: { email: 'owner@example.invalid' } });
  expect(screen.getByDisplayValue('https://example.invalid/claim-account/emailed')).toBeInTheDocument();
});

it('preserves created customer and copyable link when email delivery fails', async () => {
  deliveryFails = true;
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Create customer' }));
  await screen.findByTestId('customer-created');
  expect(screen.getByText('Customer created. The invitation email could not be delivered; share the setup link below.')).toBeInTheDocument();
  expect(screen.getByDisplayValue('https://example.invalid/claim-account/created')).toBeInTheDocument();
  expect(calls.filter(c => c.path === '/super/customers')).toHaveLength(1);
});

it('rejects unsafe logo URLs before creating a customer', async () => {
  mount();
  fireEvent.change(screen.getByLabelText('Logo URL'), { target: { value: 'http://example.invalid/logo.png' } });
  fireEvent.submit(screen.getByRole('button', { name: 'Create customer' }).closest('form')!);
  await waitFor(() => expect(screen.getByText('Enter an HTTPS logo URL, or leave it blank.')).toBeInTheDocument());
  expect(calls).toHaveLength(0);
});
