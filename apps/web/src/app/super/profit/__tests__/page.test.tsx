import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { BusinessProfitResponse } from '@/lib/business-profit';

let role = 'SUPER_ADMIN';
const createMutation = jest.fn(async () => undefined);
const updateMutation = jest.fn(async () => undefined);
const response: BusinessProfitResponse = {
  asOf: '2026-10-18T12:00:00.000Z',
  revenue: { committedMonthlyCents: 12000, activeCustomers: 2, paidScreens: 4, unpricedCustomers: 1 },
  receivables: { openCents: 8000, overdueCents: 2500 },
  costs: [],
  profit: { monthlyCostCents: 0, estimatedMonthlyProfitCents: 12000, marginPercent: 100, coverage: 'partial' },
  recommendations: [],
};

jest.mock('@/lib/store', () => ({ useAppStore: (selector: (state: unknown) => unknown) => selector({ user: { role } }) }));
jest.mock('@/hooks/use-business-profit', () => ({
  useBusinessProfit: () => ({ data: response, isError: false, isLoading: false, isFetching: false, refetch: jest.fn() }),
  useProviderUsage: () => ({ data: { asOf: '2026-10-18T12:00:00.000Z', sources: [] }, isError: false, isLoading: false, isFetching: false, refetch: jest.fn() }),
  useSavePlatformCost: () => ({ mutateAsync: createMutation, isPending: false }),
  useUpdatePlatformCost: () => ({ mutateAsync: updateMutation, isPending: false }),
}));
jest.mock('next-intl', () => ({ ...jest.requireActual('next-intl'), useLocale: () => 'en' }));
jest.mock('@/app/super/efficiency/CapacityCard', () => ({ CapacityCard: () => <div data-testid="capacity-card" /> }));
jest.mock('next/navigation', () => ({ useRouter: () => ({ back: jest.fn() }) }));
jest.mock('next/link', () => ({ __esModule: true, default: ({ href, children, ...props }: { href: string; children: React.ReactNode; [key: string]: unknown }) => <a href={href} {...props}>{children}</a> }));

import BusinessProfitPage from '../page';

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}><BusinessProfitPage /></QueryClientProvider>);
}

beforeEach(() => {
  role = 'SUPER_ADMIN'; createMutation.mockClear(); updateMutation.mockClear();
});

describe('/super/profit form', () => {
  it('submits exact integer cents and keeps the estimate caveat visible', async () => {
    renderPage();
    fireEvent.change(screen.getByLabelText('Service / product'), { target: { value: 'Database' } });
    fireEvent.change(screen.getByLabelText('Monthly amount (USD)'), { target: { value: '15.07' } });
    fireEvent.change(screen.getByLabelText('Monthly budget (USD)'), { target: { value: '20.00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save cost' }));

    await waitFor(() => expect(createMutation).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'Supabase', service: 'Database', monthlyCostCents: 1507, budgetCents: 2000,
    })));
    expect(screen.getByText(/An operating estimate, not cash or accounting profit/)).toBeInTheDocument();
    expect(screen.getByTestId('capacity-card')).toBeInTheDocument();
  });
});
