import {
  contractRevenue,
  organisationRoots,
  parseCostInput,
  type BusinessTenant,
  type ContractLicense,
} from './business.policy';

const now = new Date('2026-10-18T12:00:00.000Z');
const license = (
  overrides: Partial<ContractLicense> = {},
): ContractLicense => ({
  tier: 'ANNUAL',
  status: 'ACTIVE',
  billingMode: 'INVOICE',
  seatLimit: 20,
  monthlyPriceCents: 2000,
  packagePriceCents: null,
  pooledSeats: false,
  trialEndsAt: null,
  ...overrides,
});
const tenant = (
  id: string,
  parentId: string | null = null,
  overrides: Partial<BusinessTenant> = {},
): BusinessTenant => ({
  id,
  parentId,
  slug: id,
  archivedAt: null,
  license: license(),
  ...overrides,
});

describe('business revenue is based on the contract, not screen telemetry', () => {
  it('counts a corporate pool once even when children have legacy license rows', () => {
    const result = contractRevenue(
      [
        tenant('corporate', null, { license: license({ pooledSeats: true }) }),
        tenant('location', 'corporate'),
        tenant('child', 'location'),
      ],
      now,
    );
    expect(result).toEqual({
      committedMonthlyCents: 40000,
      activeCustomers: 1,
      paidScreens: 20,
      unpricedCustomers: 0,
    });
  });
  it('uses a fixed package total before per-seat pricing and includes independent contracts', () => {
    const result = contractRevenue(
      [
        tenant('root', null, { license: license({ packagePriceCents: 9000 }) }),
        tenant('location', 'root'),
      ],
      now,
    );
    expect(result.committedMonthlyCents).toBe(49000);
    expect(result.activeCustomers).toBe(1);
  });
  it('does not present free trials, comped seats, cancelled/suspended/past-due accounts or demos as revenue', () => {
    const excluded = [
      license({ tier: 'PILOT' }),
      license({ billingMode: 'COMP' }),
      license({ status: 'CANCELLED' }),
      license({ status: 'SUSPENDED' }),
      license({ status: 'PAST_DUE' }),
      license({ trialEndsAt: new Date('2026-11-01') }),
    ];
    const tenants = excluded.map((item, i) =>
      tenant(String(i), null, { license: item }),
    );
    tenants.push(
      tenant('__system__'),
      tenant('springfield-district'),
      tenant('archived', null, { archivedAt: now }),
    );
    expect(contractRevenue(tenants, now).committedMonthlyCents).toBe(0);
  });
  it('reports unknown prices explicitly and accepts an intentional zero-price package', () => {
    const result = contractRevenue(
      [
        tenant('missing', null, {
          license: license({ monthlyPriceCents: null }),
        }),
        tenant('free', null, { license: license({ packagePriceCents: 0 }) }),
      ],
      now,
    );
    expect(result).toEqual({
      committedMonthlyCents: 0,
      activeCustomers: 2,
      paidScreens: 0,
      unpricedCustomers: 1,
    });
  });
  it('rejects cycles, orphan locations and descendants of archived or excluded organisations', () => {
    const tenants = [
      tenant('a', 'b'),
      tenant('b', 'a'),
      tenant('c', 'absent'),
      tenant('d', '__system__'),
      tenant('__system__'),
      tenant('archived', null, { archivedAt: now }),
      tenant('e', 'archived'),
    ];
    expect([...organisationRoots(tenants).values()]).toEqual(
      tenants.map(() => null),
    );
  });
});

describe('cost input boundary', () => {
  const body = {
    provider: ' Railway ',
    service: 'API',
    monthlyCostCents: 1234,
  };
  it('keeps money as integer cents, including explicit zero', () => {
    expect(parseCostInput(body)).toEqual({
      provider: 'Railway',
      service: 'API',
      monthlyCostCents: 1234,
    });
    expect(
      parseCostInput({ ...body, monthlyCostCents: 0 }).monthlyCostCents,
    ).toBe(0);
  });
  it.each([-1, 0.1, NaN, Infinity, 1_000_000_001, '2000'])(
    'refuses unsafe money: %s',
    (monthlyCostCents) => {
      expect(() => parseCostInput({ ...body, monthlyCostCents })).toThrow();
    },
  );
  it.each([
    null,
    [],
    {},
    { ...body, currency: 'eur' },
    { ...body, source: 'PROVIDER' },
    { ...body, active: true },
    { ...body, provider: '' },
  ])('refuses invalid or privileged fields', (input) => {
    expect(() => parseCostInput(input)).toThrow();
  });
  it('patches only supplied keys and permits archival', () => {
    expect(parseCostInput({ active: false }, true)).toEqual({ active: false });
    expect(parseCostInput({ budgetCents: null }, true)).toEqual({
      budgetCents: null,
    });
    expect(() => parseCostInput({}, true)).toThrow();
  });
  it('does not normalize impossible dates into different billing dates', () => {
    expect(() =>
      parseCostInput({ ...body, nextBillAt: '2026-02-31T00:00:00.000Z' }),
    ).toThrow();
    expect(
      parseCostInput({ ...body, nextBillAt: '2026-11-01T00:00:00.000Z' })
        .nextBillAt,
    ).toEqual(new Date('2026-11-01'));
  });
});
