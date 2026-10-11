/**
 * Muse beta DEV-029 (2026-10-07): "Schedule game mode" said "No paired
 * screens yet" before the screen list had loaded (`[]` while loading).
 */
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const apiFetch = jest.fn();
jest.mock('@/lib/api-client', () => ({ apiFetch: (path: string, opts?: unknown) => apiFetch(path, opts) }));

import { AutoPushCard } from '../page';

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AutoPushCard gameId="g1" scheduledAt={null} />
    </QueryClientProvider>,
  );
}

beforeEach(() => apiFetch.mockReset());

it('says "Loading screens" — not "No paired screens yet" — while the list loads', () => {
  apiFetch.mockImplementation((path: string) =>
    path.endsWith('/screens') ? new Promise(() => undefined) : Promise.resolve({ armed: false, screenIds: [] }),
  );
  mount();
  expect(screen.getByTestId('autopush-screens-loading')).toBeInTheDocument();
  expect(screen.queryByText(/No paired screens yet/)).toBeNull();
});

it('a failed read says so instead of claiming there are no screens', async () => {
  apiFetch.mockImplementation((path: string) =>
    path.endsWith('/screens') ? Promise.reject(new Error('down')) : Promise.resolve({ armed: false, screenIds: [] }),
  );
  mount();
  expect(await screen.findByTestId('autopush-screens-error')).toBeInTheDocument();
  expect(screen.queryByText(/No paired screens yet/)).toBeNull();
});

it('an empty answer still says "No paired screens yet"', async () => {
  apiFetch.mockImplementation((path: string) =>
    path.endsWith('/screens') ? Promise.resolve([]) : Promise.resolve({ armed: false, screenIds: [] }),
  );
  mount();
  expect(await screen.findByText(/No paired screens yet/)).toBeInTheDocument();
});
