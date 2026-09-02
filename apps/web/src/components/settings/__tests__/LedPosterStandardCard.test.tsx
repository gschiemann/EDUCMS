/**
 * The tenant's standard LED poster size (2026-09-01).
 *
 * A NovaStar TB poster cannot report its own LED module size, so the operator
 * states it here once. Mocked at `apiFetch` rather than at the hooks, so the
 * REAL use-api hooks run with their REAL URL and body — that is what proves
 * the card writes `PUT /tenants/:id/poster-standard` and that "Reset" sends
 * NULL/NULL rather than the default numbers (nulls are how the row goes back
 * to "use the built-in default").
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const apiFetch = jest.fn();
jest.mock('@/lib/api-client', () => ({
  apiFetch: (path: string, opts?: any) => apiFetch(path, opts),
}));

let role = 'SCHOOL_ADMIN';
jest.mock('@/store/ui-store', () => ({
  useUIStore: (sel: any) => sel({ user: { role } }),
}));

import { LedPosterStandardCard } from '../LedPosterStandardCard';

function renderCard() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <LedPosterStandardCard />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  role = 'SCHOOL_ADMIN';
  apiFetch.mockReset();
});

/** The tenant payload the dashboard already reads (`GET /tenants`). */
function tenant(posterStandardW: number | null, posterStandardH: number | null) {
  apiFetch.mockImplementation(async (path: string) => {
    if (path === '/tenants') return { id: 't1', name: 'District', posterStandardW, posterStandardH };
    return { success: true, posterStandardW, posterStandardH };
  });
}

it('names the built-in default AS a default when nothing is stored', async () => {
  tenant(null, null);
  renderCard();
  expect(await screen.findByText('320×1080')).toBeInTheDocument();
  expect(screen.getByText('(built-in default)')).toBeInTheDocument();
});

it('saves a preset to PUT /tenants/:id/poster-standard', async () => {
  tenant(null, null);
  renderCard();
  await screen.findByText('320×1080');

  fireEvent.click(screen.getByRole('button', { name: '1.56 mm · 360×1200' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));

  await waitFor(() =>
    expect(apiFetch).toHaveBeenCalledWith('/tenants/t1/poster-standard', expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify({ w: 360, h: 1200 }),
    })),
  );
  expect(await screen.findByText('· Saved.')).toBeInTheDocument();
});

it('"Reset" clears to NULL/NULL — not to the default numbers', async () => {
  tenant(360, 1200);
  renderCard();
  await screen.findByText('360×1200');

  fireEvent.click(screen.getByRole('button', { name: /Reset to 320×1080/ }));

  await waitFor(() =>
    expect(apiFetch).toHaveBeenCalledWith('/tenants/t1/poster-standard', expect.objectContaining({
      body: JSON.stringify({ w: null, h: null }),
    })),
  );
});

it('says so when a save fails, instead of showing a false "Saved"', async () => {
  apiFetch.mockImplementation(async (path: string) => {
    if (path === '/tenants') return { id: 't1', posterStandardW: null, posterStandardH: null };
    throw new Error('500');
  });
  renderCard();
  await screen.findByText('320×1080');

  fireEvent.click(screen.getByRole('button', { name: '1.56 mm · 360×1200' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));

  expect(await screen.findByText('· Could not save — try again.')).toBeInTheDocument();
  expect(screen.queryByText('· Saved.')).not.toBeInTheDocument();
});

it('refuses to save a size outside 32–8192 and says why', async () => {
  tenant(null, null);
  renderCard();
  const width = await screen.findByDisplayValue('320');

  fireEvent.change(width, { target: { value: '9000' } });

  expect(screen.getByText(/must be whole numbers between 32 and 8192/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
});

it.each(['CONTRIBUTOR', 'RESTRICTED_VIEWER'])('is read-only for %s', async (r) => {
  role = r;
  tenant(360, 1200);
  renderCard();
  await screen.findByText('360×1200');

  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  expect(screen.getByRole('button', { name: /Reset to 320×1080/ })).toBeDisabled();
  expect(screen.getByRole('button', { name: '1.86 mm · 320×1080' })).toBeDisabled();
  expect(screen.getByText('· Read-only for your role.')).toBeInTheDocument();
});
