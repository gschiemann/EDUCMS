/**
 * The organization's screen PIN card (2026-11-09). Mocked at `apiFetch`, so
 * the REAL hooks run with their REAL URL and body.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const apiFetch = jest.fn();
jest.mock('@/lib/api-client', () => ({
  apiFetch: (path: string, opts?: any) => apiFetch(path, opts),
}));

let role = 'DISTRICT_ADMIN';
jest.mock('@/store/ui-store', () => ({
  useUIStore: (sel: any) => sel({ user: { role } }),
}));

import { ScreenPinCard } from '../ScreenPinCard';

function renderCard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ScreenPinCard />
    </QueryClientProvider>,
  );
}

let set = false;
beforeEach(() => {
  role = 'DISTRICT_ADMIN';
  set = false;
  apiFetch.mockReset();
  apiFetch.mockImplementation(async (path: string, opts?: any) => {
    if (path === '/tenants/me/screen-pin' && !opts) return { set, setAt: set ? '2026-11-09T00:00:00Z' : null };
    if (opts?.method === 'PUT') { set = true; return { ok: true, set: true }; }
    if (opts?.method === 'DELETE') { set = false; return { ok: true, set: false }; }
    return {};
  });
});

it('says plainly when no PIN is set', async () => {
  renderCard();
  expect(await screen.findByText(/No screen PIN/)).toBeInTheDocument();
});

it('sets a PIN typed twice: PUT with the PIN in the body, inputs cleared, status refreshed', async () => {
  renderCard();
  await screen.findByText(/No screen PIN/);
  fireEvent.change(screen.getByTestId('screen-pin-input'), { target: { value: '48a21' } });
  fireEvent.change(screen.getByTestId('screen-pin-confirm'), { target: { value: '4821' } });
  expect((screen.getByTestId('screen-pin-input') as HTMLInputElement).value).toBe('4821'); // digits only
  expect((screen.getByTestId('screen-pin-input') as HTMLInputElement).type).toBe('password');
  fireEvent.click(screen.getByRole('button', { name: 'Set PIN' }));
  await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/tenants/me/screen-pin', { method: 'PUT', body: JSON.stringify({ pin: '4821' }) }));
  expect(await screen.findByText('A screen PIN is set.')).toBeInTheDocument();
  expect((screen.getByTestId('screen-pin-input') as HTMLInputElement).value).toBe('');
});

it('refuses mismatched or short PINs before any request', async () => {
  renderCard();
  await screen.findByText(/No screen PIN/);
  fireEvent.change(screen.getByTestId('screen-pin-input'), { target: { value: '123' } });
  expect(screen.getByText('Use 4 to 8 digits.')).toBeInTheDocument();
  fireEvent.change(screen.getByTestId('screen-pin-input'), { target: { value: '1234' } });
  fireEvent.change(screen.getByTestId('screen-pin-confirm'), { target: { value: '1235' } });
  expect(screen.getByText('The two PINs do not match.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Set PIN' })).toBeDisabled();
  expect(apiFetch.mock.calls.filter(([, o]) => o?.method)).toHaveLength(0);
});

it('removes a PIN with DELETE', async () => {
  set = true;
  renderCard();
  fireEvent.click(await screen.findByRole('button', { name: 'Remove PIN' }));
  await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/tenants/me/screen-pin', { method: 'DELETE' }));
  expect(await screen.findByText(/No screen PIN/)).toBeInTheDocument();
});

it('is read-only below org admin, and names the dashboard recovery path', async () => {
  role = 'SCHOOL_ADMIN';
  renderCard();
  await screen.findByText(/No screen PIN/);
  expect(screen.getByTestId('screen-pin-input')).toBeDisabled();
  expect(screen.getByText(/Only organization admins/)).toBeInTheDocument();
  expect(screen.getByText(/Forgot the PIN\?/)).toBeInTheDocument();
});
