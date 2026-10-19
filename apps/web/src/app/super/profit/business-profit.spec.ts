import { expect, test, type Page } from '@playwright/test';

type Cost = {
  id: string; provider: string; service: string; planName: string | null; monthlyCostCents: number;
  budgetCents: number | null; currency: 'usd'; nextBillAt: string | null; notes: string | null;
  active: boolean; source: string; observedAt: string; createdAt: string; updatedAt: string;
};

function initialSummary() {
  return {
    asOf: '2026-10-18T12:00:00.000Z',
    revenue: { committedMonthlyCents: 50000, activeCustomers: 3, paidScreens: 10, unpricedCustomers: 1 },
    receivables: { openCents: 7000, overdueCents: 2000 },
    costs: [] as Cost[],
    profit: { monthlyCostCents: 0, estimatedMonthlyProfitCents: 50000, marginPercent: 100, coverage: 'partial' as const },
    recommendations: [],
  };
}

async function installFixtures(page: Page) {
  const summary = initialSummary();
  const patchBodies: Array<Record<string, unknown>> = [];
  await page.addInitScript(() => {
    sessionStorage.setItem('edu_cms_token', 'playwright-owner-token');
    sessionStorage.setItem('edu_cms_user', JSON.stringify({
      id: 'owner-1', email: 'owner@example.test', role: 'SUPER_ADMIN', tenantId: 'tenant-1', tenantSlug: 'venue',
    }));
  });
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname.endsWith('/super/business') && request.method() === 'GET') return route.fulfill({ json: summary });
    if (pathname.endsWith('/super/business/provider-usage') && request.method() === 'GET') return route.fulfill({ json: {
      asOf: '2026-10-18T12:00:00.000Z',
      sources: [
        { provider: 'vercel', state: 'connected', scope: 'team', periodStart: '2026-10-01T00:00:00.000Z', periodEnd: '2026-10-18T00:00:00.000Z', observedAt: '2026-10-18T12:00:00.000Z', accruedCostCents: 1234, items: [{ label: 'Functions', costCents: 1234 }], href: 'https://vercel.com/dashboard' },
        { provider: 'railway', state: 'not_configured', scope: 'workspace', periodStart: null, periodEnd: null, observedAt: null, accruedCostCents: null, items: [], href: 'https://railway.app/dashboard' },
        { provider: 'supabase', state: 'manual', scope: 'organization', periodStart: null, periodEnd: null, observedAt: null, accruedCostCents: null, items: [], href: 'https://supabase.com/dashboard' },
      ],
    } });
    if (pathname.endsWith('/super/business/costs') && request.method() === 'POST') {
      const body = request.postDataJSON();
      const stamp = new Date().toISOString();
      const cost: Cost = {
        id: 'cost-1', provider: body.provider, service: body.service, planName: body.planName ?? null,
        monthlyCostCents: body.monthlyCostCents, budgetCents: body.budgetCents ?? null, currency: 'usd',
        nextBillAt: body.nextBillAt ?? null, notes: body.notes ?? null, active: true, source: 'MANUAL',
        observedAt: stamp, createdAt: stamp, updatedAt: stamp,
      };
      summary.costs = [cost];
      summary.profit.monthlyCostCents = cost.monthlyCostCents;
      summary.profit.estimatedMonthlyProfitCents = summary.revenue.committedMonthlyCents - cost.monthlyCostCents;
      summary.profit.marginPercent = summary.profit.estimatedMonthlyProfitCents / summary.revenue.committedMonthlyCents * 100;
      return route.fulfill({ status: 201, json: cost });
    }
    if (pathname.endsWith('/super/capacity')) return route.fulfill({ json: {
      enabled: true, thresholds: { warnPct: 70, criticalPct: 90 }, metrics: [], checklist: [], note: 'fixture capacity sample',
    } });
    const cost = summary.costs.find((candidate) => pathname.endsWith(`/super/business/costs/${candidate.id}`));
    if (request.method() !== 'PATCH') return route.fulfill({ json: {} });
    if (!cost) return route.fulfill({ status: 404, json: { message: 'Unknown fixture cost' } });
    const body = request.postDataJSON();
    patchBodies.push(body);
    Object.assign(cost, body, { updatedAt: new Date().toISOString() });
    summary.costs = [cost];
    summary.profit.monthlyCostCents = cost.active ? cost.monthlyCostCents : 0;
    summary.profit.estimatedMonthlyProfitCents = summary.revenue.committedMonthlyCents - summary.profit.monthlyCostCents;
    return route.fulfill({ json: cost });
  });
  return patchBodies;
}

test('create, edit and archive a cost entry without changing provider or service labels at 375px', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const patchBodies = await installFixtures(page);
  const unexpectedConsole: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && message.text().includes('/super/business')) unexpectedConsole.push(message.text());
  });

  await page.goto('/super/profit');
  await expect(page.getByRole('heading', { name: 'Profit & headroom' })).toBeVisible();
  await expect(page.getByText(/An operating estimate, not cash or accounting profit/)).toBeVisible();
  await expect(page.getByTestId('capacity-card')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Provider usage observations' })).toBeVisible();
  await expect(page.getByText('Accrued in reported period')).toHaveCount(3);
  await expect(page.locator('section[aria-labelledby="provider-usage-title"]').getByRole('heading', { name: 'supabase' })).toBeVisible();

  await page.getByLabel('Provider', { exact: true }).selectOption('Other');
  await page.getByLabel('Provider name').fill('Signal · Labs');
  await page.getByLabel('Service / product').fill('Email Relay');
  await page.getByLabel('Plan name').fill('Starter');
  await page.getByLabel('Monthly amount (USD)').fill('12.34');
  await page.getByLabel('Monthly budget (USD)').fill('20.00');
  await page.getByLabel('Next bill date').fill('2027-01-20');
  await page.getByLabel('Notes').fill('Receipt contact');
  await page.getByRole('button', { name: 'Save cost' }).click();
  await expect(page.getByRole('status')).toContainText('Cost entry saved');
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();

  const row = page.getByRole('listitem').filter({ hasText: 'Signal · Labs' });
  await expect(row).toContainText('Email Relay');
  await expect(row).toContainText('Manual');
  await row.getByRole('button', { name: 'Edit' }).click();
  await expect(page.getByLabel('Provider name')).toHaveValue('Signal · Labs');
  await expect(page.getByLabel('Service / product')).toHaveValue('Email Relay');
  await expect(page.getByLabel('Monthly amount (USD)')).toHaveValue('12.34');
  await page.getByLabel('Plan name').fill('');
  await page.getByLabel('Monthly budget (USD)').fill('');
  await page.getByLabel('Next bill date').fill('');
  await page.getByLabel('Notes').fill('');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('status')).toContainText('Cost entry updated');
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();

  await expect(row).toContainText('Signal · Labs');
  await expect(row).toContainText('Email Relay');
  await expect(row).not.toContainText('Starter');
  expect(patchBodies[0]).toMatchObject({ planName: null, budgetCents: null, nextBillAt: null, notes: null });
  await row.getByRole('button', { name: 'Archive' }).click();
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByText('Archived entries (1)')).toBeVisible();
  await page.getByText('Archived entries (1)').click();
  const archivedRow = page.getByRole('listitem').filter({ hasText: 'Signal · Labs' });
  await expect(archivedRow).toContainText('Archived');
  expect(patchBodies[1]).toMatchObject({ active: false });
  await archivedRow.getByRole('button', { name: 'Restore' }).click();
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'Signal · Labs' })).toBeVisible();
  expect(patchBodies[2]).toMatchObject({ active: true });

  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(375);
  const summaryColumns = await page.locator('section[aria-label="Business estimate summary"]').evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length);
  expect(summaryColumns).toBe(2);
  expect(unexpectedConsole).toEqual([]);
  await page.screenshot({ path: `test-results/profit-${page.context().browser()?.browserType().name() ?? 'browser'}-375.png`, fullPage: true });
});
