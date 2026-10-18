export interface PlatformCost {
  id: string;
  provider: string;
  service: string;
  planName: string | null;
  monthlyCostCents: number;
  budgetCents: number | null;
  currency: 'usd';
  nextBillAt: string | null;
  notes: string | null;
  active: boolean;
  source: 'MANUAL' | string;
  observedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface BusinessProfitResponse {
  asOf: string;
  revenue: {
    committedMonthlyCents: number;
    activeCustomers: number;
    paidScreens: number;
    unpricedCustomers: number;
  };
  receivables: { openCents: number; overdueCents: number };
  costs: PlatformCost[];
  profit: {
    monthlyCostCents: number;
    estimatedMonthlyProfitCents: number;
    marginPercent: number | null;
    coverage: 'partial' | 'complete';
  };
  recommendations: Array<{
    id: string;
    tone: 'info' | 'warning' | 'critical';
    title: string;
    detail: string;
    href?: string;
  }>;
}

/** Convert a decimal dollar input to integer cents without floating point rounding. */
export function dollarsToCents(value: string): number | null {
  const normalized = value.trim();
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(normalized);
  if (!match) return null;
  const dollars = Number(match[1]);
  const cents = Number((match[2] ?? '').padEnd(2, '0') || '0');
  if (!Number.isSafeInteger(dollars) || dollars > Math.floor(Number.MAX_SAFE_INTEGER / 100)) return null;
  const result = dollars * 100 + cents;
  return Number.isSafeInteger(result) ? result : null;
}

export function centsToDollarInput(cents: number | null | undefined): string {
  return cents == null ? '' : (cents / 100).toFixed(2);
}

export function formatUsd(cents: number, locale = 'en-US'): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' }).format(cents / 100);
}

export function optionalDate(value: string): string | undefined {
  return value.trim() ? new Date(`${value}T00:00:00.000Z`).toISOString() : undefined;
}
