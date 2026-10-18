import { BadRequestException } from '@nestjs/common';

export const MAX_COST_CENTS = 1_000_000_000;
const EXCLUDED_SLUGS = new Set(['__system__', 'springfield-district']);
const TRIAL_TIERS = new Set(['PILOT', 'FREE_TRIAL', 'TRIAL']);

export interface ContractLicense {
  tier: string;
  status: string;
  billingMode: string;
  seatLimit: number;
  monthlyPriceCents: number | null;
  packagePriceCents: number | null;
  pooledSeats: boolean;
  trialEndsAt: Date | null;
}

export interface BusinessTenant {
  id: string;
  parentId: string | null;
  slug: string;
  archivedAt: Date | null;
  license: ContractLicense | null;
}

/** Resolve the real billing tree; cycles and missing parents never become new customers. */
export function organisationRoots(
  tenants: BusinessTenant[],
): Map<string, string | null> {
  const byId = new Map(tenants.map((t) => [t.id, t]));
  const roots = new Map<string, string | null>();
  for (const tenant of tenants) {
    let current: BusinessTenant | undefined = tenant;
    const seen = new Set<string>();
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      if (!current.parentId) break;
      current = byId.get(current.parentId);
    }
    roots.set(
      tenant.id,
      current &&
        !current.parentId &&
        !EXCLUDED_SLUGS.has(current.slug) &&
        !current.archivedAt
        ? current.id
        : null,
    );
  }
  return roots;
}

/** Monthly-equivalent CONTRACT revenue; cash collected and paired-screen usage are different facts. */
export function contractRevenue(tenants: BusinessTenant[], now: Date) {
  const roots = organisationRoots(tenants);
  const byId = new Map(tenants.map((t) => [t.id, t]));
  const customers = new Set<string>();
  let committedMonthlyCents = 0;
  let paidScreens = 0;
  let unpricedCustomers = 0;
  for (const tenant of tenants) {
    const rootId = roots.get(tenant.id);
    if (!rootId || tenant.archivedAt) continue;
    const root = byId.get(rootId)!;
    // A corporate pool is ONE contract. Its location license rows are not extra revenue.
    if (tenant.id !== rootId && root.license?.pooledSeats) continue;
    const license = tenant.license;
    if (
      !license ||
      license.status !== 'ACTIVE' ||
      license.billingMode === 'COMP' ||
      TRIAL_TIERS.has(license.tier)
    )
      continue;
    if (license.trialEndsAt && license.trialEndsAt > now) continue;
    customers.add(rootId);
    const cents =
      license.packagePriceCents ??
      (license.monthlyPriceCents == null
        ? null
        : license.monthlyPriceCents * license.seatLimit);
    if (cents === null) {
      unpricedCustomers += 1;
      continue;
    }
    committedMonthlyCents += cents;
    if (cents > 0) paidScreens += license.seatLimit;
  }
  return {
    committedMonthlyCents,
    activeCustomers: customers.size,
    paidScreens,
    unpricedCustomers,
  };
}

export interface CostInput {
  provider?: string;
  service?: string;
  planName?: string | null;
  monthlyCostCents?: number;
  budgetCents?: number | null;
  nextBillAt?: Date | null;
  notes?: string | null;
  active?: boolean;
}

export function parseCostInput(body: unknown, patch = false): CostInput {
  const fail = (message: string): never => {
    throw new BadRequestException({ code: 'INVALID_BUSINESS_COST', message });
  };
  if (!body || typeof body !== 'object' || Array.isArray(body))
    fail('Enter a cost record.');
  const source = body as Record<string, unknown>;
  const keys = new Set([
    'provider',
    'service',
    'planName',
    'monthlyCostCents',
    'budgetCents',
    'nextBillAt',
    'notes',
    ...(patch ? ['active'] : []),
  ]);
  if (Object.keys(source).some((key) => !keys.has(key)))
    fail('That cost field cannot be changed.');
  if (!Object.keys(source).length) fail('Enter at least one change.');
  const result: CostInput = {};
  for (const [key, max, nullable] of [
    ['provider', 80, false],
    ['service', 160, false],
    ['planName', 160, true],
    ['notes', 4000, true],
  ] as const) {
    if (!(key in source)) {
      if (!patch && !nullable) fail(`${key} is required.`);
      continue;
    }
    const raw = source[key];
    if (nullable && (raw === null || raw === '')) {
      result[key] = null;
      continue;
    }
    if (typeof raw !== 'string' || !raw.trim() || raw.trim().length > max)
      fail(`Enter a valid ${key} (up to ${max} characters).`);
    result[key] = (raw as string).trim();
  }
  for (const key of ['monthlyCostCents', 'budgetCents'] as const) {
    if (!(key in source)) {
      if (!patch && key === 'monthlyCostCents')
        fail('A monthly cost is required.');
      continue;
    }
    const value = source[key];
    if (key === 'budgetCents' && value === null) {
      result.budgetCents = null;
      continue;
    }
    if (
      typeof value !== 'number' ||
      !Number.isSafeInteger(value) ||
      value < 0 ||
      value > MAX_COST_CENTS
    )
      fail('Amounts must be whole cents between zero and $10,000,000.');
    result[key] = value as number;
  }
  if ('active' in source) {
    if (typeof source.active !== 'boolean')
      fail('Active must be true or false.');
    result.active = source.active as boolean;
  }
  if ('nextBillAt' in source) {
    const value = source.nextBillAt;
    if (value === null || value === '') result.nextBillAt = null;
    else {
      if (
        typeof value !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/.test(value)
      )
        fail('Choose a valid billing date.');
      const date = new Date(value as string);
      if (!Number.isFinite(date.getTime()) || date.toISOString() !== value)
        fail('Choose a valid billing date.');
      result.nextBillAt = date;
    }
  }
  return result;
}
