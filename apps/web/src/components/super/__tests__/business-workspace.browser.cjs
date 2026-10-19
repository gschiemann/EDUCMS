/** Actual mounted route QA. Run against an isolated web dev server; every API response is a public fixture. */
const { chromium, webkit, expect } = require('@playwright/test');
const fs = require('node:fs');
const http = require('node:http');
let attachmentUrl;
const base = process.env.BUSINESS_UI_URL || 'http://localhost:3261';
const out = process.env.BUSINESS_UI_EVIDENCE || '/tmp/business-workspace-evidence';
fs.mkdirSync(out, { recursive: true });
const invoice = { id: 'i1', number: 'ARC-2026-1042', amountCents: 84000, currency: 'usd', poNumber: 'PO-1042', periodStart: '2026-10-01T00:00:00Z', periodEnd: '2026-10-31T00:00:00Z', sentAt: '2026-10-01T00:00:00Z', dueAt: '2026-10-10T00:00:00Z', paidAt: null, status: 'SENT', overdue: true, notes: 'Monthly screen service', attachment: { fileName: 'ARC-2026-1042.pdf', sizeBytes: 1024, uploadedAt: '2026-10-18T00:00:00Z' } };
const rows = [
  { id: 'c1', name: 'Northstar Learning', slug: 'northstar', vertical: 'K12', createdAt: '2026-10-10T00:00:00Z', archived: false, plan: 'ANNUAL', billingMode: 'INVOICE', licenseStatus: 'ACTIVE', status: 'past_due', seatLimit: 24, seatsUsed: 18, locations: 3, monthlyPriceCents: 2000, packageName: 'Campus Plus', packagePriceCents: 84000, renewalDate: '2026-11-01T00:00:00Z', lastActivityAt: '2026-10-17T00:00:00Z', openInvoiceCents: 84000, overdueInvoices: 1 },
  { id: 'c2', name: 'Juniper Coffee', slug: 'juniper', vertical: 'QSR', createdAt: '2026-10-08T00:00:00Z', archived: false, plan: 'MONTHLY', billingMode: 'CARD', licenseStatus: 'ACTIVE', status: 'active', seatLimit: 6, seatsUsed: 4, locations: 1, monthlyPriceCents: 2500, renewalDate: '2026-11-08T00:00:00Z', lastActivityAt: '2026-10-16T00:00:00Z', openInvoiceCents: 0, overdueInvoices: 0 },
];
const detail = { ...rows[0], license: { plan: 'ANNUAL', status: 'ACTIVE', billingMode: 'INVOICE', seatLimit: 24, monthlyPriceCents: 2000, packageName: 'Campus Plus', packagePriceCents: 84000, pooledSeats: true, renewalDate: null, contractRenewalDate: '2026-11-01T00:00:00Z', poNumber: 'PO-1042', notes: '', suspendedAt: null, suspendReason: null, stripeManaged: false, aiIncluded: true }, cardCheckout: false, locations: [{ id: 'l1', name: 'North campus', slug: 'north-campus', parentId: 'c1', depth: 1, archived: false, seatsUsed: 8, allocatedSeats: 10 }, { id: 'l2', name: 'Arts building', slug: 'arts', parentId: 'l1', depth: 2, archived: false, seatsUsed: 4, allocatedSeats: 6 }, { id: 'l3', name: 'South campus', slug: 'south-campus', parentId: 'c1', depth: 1, archived: false, seatsUsed: 6, allocatedSeats: 8 }], admins: [{ id: 'u2', email: 'admin@example.invalid', name: 'Sample admin', role: 'DISTRICT_ADMIN', status: 'ACTIVE', awaitingSetup: false, atLocation: false }], starterLogin: { state: 'pending', createdAt: '2026-10-10T00:00:00Z', expiresAt: '2026-10-25T00:00:00Z', claimedAt: null, ownerEmail: null }, invoices: [invoice], branding: { displayName: 'Northstar Learning', primary: '#4f46e5', accent: '#0ea5e9', logoUrl: null }, activity: [{ id: 'a1', action: 'CUSTOMER_LICENSE_UPDATED', at: '2026-10-17T00:00:00Z', by: 'owner@example.invalid', details: { changed: ['seatLimit'] } }] };
const business = { revenue: { committedMonthlyCents: 99500, activeCustomers: 2, paidScreens: 30, unpricedCustomers: 0 }, profit: { monthlyCostCents: 18750, estimatedMonthlyProfitCents: 80750, marginPercent: 81.16, coverage: 'partial' }, receivables: { openCents: 84000, overdueCents: 84000 } };
async function setup(page, role = 'SUPER_ADMIN') {
  const calls = [];
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', message => { if (message.type() === 'error' && /MISSING_MESSAGE|FORMATTING_ERROR|Route error boundary caught/.test(message.text())) errors.push(message.text()); });
  await page.addInitScript(({ role }) => {
    document.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style');
      style.textContent = 'nextjs-portal { display: none !important; }';
      document.head.appendChild(style);
    });
    const payload = btoa(JSON.stringify({ exp: Math.floor(Date.now()/1000) + 86400 }));
    sessionStorage.setItem('edu_cms_token', `fixture.${payload}.fixture`);
    sessionStorage.setItem('edu_cms_user', JSON.stringify({ id: 'fixture-owner', role, tenantId: 'internal', tenantSlug: 'internal', email: 'owner@example.invalid', setupComplete: true }));
  }, { role });
  await page.context().route('**/api/v1/**', async route => {
    const req = route.request(); const url = new URL(req.url()); const path = url.pathname.replace('/api/v1','');
    const headers = { 'access-control-allow-origin': base, 'access-control-allow-credentials': 'true', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS' };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    calls.push({ path, query: url.search, method: req.method(), body: req.postData() });
    let body = {};
    if (path === '/security/csrf') body = { token: 'public-fixture-csrf' };
    else if (path === '/super/capacity') body = { enabled: true, thresholds: { warnPct: 70, criticalPct: 85 }, metrics: [], checklist: [], note: 'Public fixture: no samples yet.' };
    else if (path === '/super/efficiency') body = { window: { minutes: 60, from: null, to: null }, requests: { total: 0, bytes: 0, p50LatencyMs: 0, p95LatencyMs: 0 }, topRoutesByBytes: [], topRoutesByRequests: [], slowQueries: [], egress: { rollingBytes: 0, rollingGb: 0, budgetGb: 250, usedPct: 0, cacheHitRatioPct: null }, anomaly: { currentHourBytes: 0, baselineAvgBytes: 0, ratio: null, triggered: false }, efficiency: { score: 100, worstOffenders: [] }, banner: { active: false, message: null }, meta: { budgetGb: 250, slowQueryThresholdMs: 200, note: 'Public fixture' } };
    else if (path === '/super/business') body = business;
    else if (path === '/super/tenants') body = rows.map(r => ({ ...r, tier: 'ENTERPRISE', screensOnline: r.seatsUsed, emergencyActive: false, canaryPercent: 100, openIncidents24h: 0 }));
    else if (path === '/super/activation-funnel') body = { aggregate: { totalTenants: 2, excludedTenants: 0, stageCounts: { SIGNED_UP: 2, BOARD_CREATED: 2, SCREEN_PAIRED: 2, PUBLISHED: 2, RENDER_PROVEN: 2 }, activationRate: { overall: { reached: 2, total: 2, pct: 100 }, last30Days: { reached: 2, total: 2, pct: 100 } }, medianHoursToMilestone: { boardCreated: 1, screenPaired: 2, published: 3, renderProven: 4 } }, recentTenants: [], excluded: { count: 0, note: 'Fixture' }, meta: { generatedAt: '2026-10-18T00:00:00Z', definition: 'Fixture' } };
    else if (path === '/super/customers/invoices') body = { rows: [{ ...invoice, customerId: 'c1', customerName: rows[0].name }], total: 1, page: 1, pageSize: 25, pages: 1 };
    else if (path === '/super/customers' && req.method() === 'POST') body = { id: 'created', slug: 'new', starterLink: { url: `${base}/claim-account/public-fixture`, expiresAt: '2026-10-25T00:00:00Z' } };
    else if (path === '/super/customers') { const filtered = url.searchParams.get('status') === 'past_due' ? [rows[0]] : url.searchParams.get('seats') ? [] : rows; body = { rows: filtered, total: filtered.length, page: 1, pageSize: 25, pages: 1 }; }
    else if (path.endsWith('/payment-summary')) body = { state: 'not_applicable', card: null, nextPayment: null, observedAt: '2026-10-18T00:00:00Z' };
    else if (path.endsWith('/support-access')) body = { internal: false, active: null, pending: [], history: [], locations: detail.locations };
    else if (path.endsWith('/pdf')) body = { url: attachmentUrl, expiresAt: '2026-10-18T01:00:00Z', fileName: 'ARC-2026-1042.pdf' };
    else if (path.endsWith('/document')) body = { seller: { name: 'VenueOS' }, customer: { name: detail.name, slug: detail.slug }, invoice, branding: detail.branding, lines: [{ description: 'VenueOS subscription services', descriptionCode: 'subscription', quantity: 1, unitAmountCents: 84000, totalCents: 84000 }] };
    else if (path.endsWith('/starter-link/email')) body = { url: `${base}/claim-account/public-email-fixture`, expiresAt: '2026-10-25T00:00:00Z', emailDelivered: true };
    else if (path === '/super/customers/c1') body = detail;
    return route.fulfill({ json: body, headers });
  });
  return { calls, errors };
}
(async () => {
  // WebKit does not reliably surface downloads fulfilled by route interception. Serve the public PDF fixture over real loopback HTTP.
  const fixtureServer = http.createServer((_request, response) => { response.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename=ARC-2026-1042.pdf' }); response.end('%PDF-1.4 public fixture'); });
  await new Promise(resolve => fixtureServer.listen(0, '127.0.0.1', resolve));
  attachmentUrl = `http://127.0.0.1:${fixtureServer.address().port}/fixture-arc.pdf`;
  const report = [];
  for (const [engine, browserType] of Object.entries({ chromium, webkit })) {
    const browser = await browserType.launch(); const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } }); const { calls, errors } = await setup(page);
    // Settle automatic RSC prefetches before hard navigations; WebKit reports cancelled cross-document reads as access-control errors.
    const goto = async (url) => { await page.waitForLoadState('networkidle'); await page.goto(url); await page.waitForLoadState('networkidle'); };
    await goto(`${base}/super`); await expect(page.getByRole('heading', { name: 'Your business, in one place.' })).toBeVisible();
    await expect(page.getByText('$995', { exact: true })).toBeVisible(); await expect(page.getByText('$188', { exact: true })).toBeVisible();
    await page.screenshot({ path: `${out}/${engine}-overview-desktop.png`, fullPage: true });
    for (const path of ['/super/customers', '/super/customers/c1', '/super/invoices', '/super/invoices/i1?customer=c1']) {
      await goto(base+path); await expect(page.locator('main h1')).toBeVisible(); await page.screenshot({ path: `${out}/${engine}-${path.includes('?') ? 'invoice-document' : path.split('/').at(-1)}-desktop.png`, fullPage: true });
    }
    await goto(`${base}/super`);
    await page.evaluate(() => { window.__ownerNavigationMarker = 'same-document'; });
    await page.getByRole('navigation', { name: 'Business navigation' }).getByRole('link', { name: 'Customers', exact: true }).click();
    await expect(page).toHaveURL(/\/super\/customers$/);
    await page.waitForLoadState('networkidle');
    if (await page.evaluate(() => window.__ownerNavigationMarker) !== 'same-document') throw new Error('Business navigation reloaded the document');
    // Exercise the signed attachment through an actual user gesture in both engines.
    await goto(`${base}/super/invoices`);
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'ARC-2026-1042.pdf', exact: true }).click();
    const download = await downloadPromise;
    if (download.suggestedFilename() !== 'ARC-2026-1042.pdf') throw new Error('Attachment download failed');
    await expect(page).toHaveURL(/\/super\/invoices$/);
    await goto(`${base}/super/invoices/i1?customer=c1`);
    await expect(page.locator('#invoice-print')).toBeVisible();
    await page.emulateMedia({ media: 'print' });
    await page.screenshot({ path: `${out}/${engine}-invoice-print.png`, fullPage: true });
    if (engine === 'chromium') {
      const pdf = await page.pdf({ format: 'A4', printBackground: true });
      fs.writeFileSync(`${out}/invoice-print.pdf`, pdf);
      const pages = pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) || [];
      if (pages.length !== 1) throw new Error(`Invoice print generated ${pages.length} pages`);
    }
    await page.emulateMedia({ media: 'screen' });
    await goto(`${base}/super/customers/new`);
    await page.getByLabel('Organization name').fill('Public fixture customer');
    await page.getByLabel('Owner email (optional)').fill('owner@example.invalid');
    await page.getByLabel('Custom package name').fill('Public fixture package');
    await page.getByLabel('Fixed package / month (USD)').fill('450');
    await page.getByRole('button', { name: 'Create customer', exact: true }).click();
    await expect(page.getByTestId('customer-created')).toBeVisible(); await expect(page.getByText('Owner setup invitation emailed.')).toBeVisible();
    if (!calls.some(c => c.path === '/super/customers/created/starter-link/email' && c.method === 'POST')) throw new Error('Owner invite was not sent');
    await goto(`${base}/super/customers/c1#customer-locations`); await expect(page.getByRole('tab', { name: 'Locations' })).toHaveAttribute('aria-selected', 'true'); await expect(page.getByText('Organization & locations')).toBeVisible();
    await page.getByRole('tab', { name: 'Locations' }).press('ArrowRight'); await expect(page.getByRole('tab', { name: 'People' })).toHaveAttribute('aria-selected','true');
    await page.setViewportSize({ width: 390, height: 844 });
    for (const path of ['/super', '/super/customers', '/super/customers/c1', '/super/customers/new', '/super/invoices']) {
      await goto(base+path); await expect(page.locator('main h1')).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1); if (overflow) throw new Error(`${engine} horizontal overflow ${path}`);
      await page.screenshot({ path: `${out}/${engine}-${path.split('/').at(-1) || 'overview'}-mobile.png`, fullPage: true });
    }
    await page.getByRole('navigation', { name: 'Business navigation' }).getByRole('link', { name: 'Platform health' }).click();
    await expect(page).toHaveURL(/\/super\/efficiency/);
    await expect(page.getByText('Efficiency Score', { exact: true })).toBeVisible();
    for (const locale of ['es','zh']) { await page.context().addCookies([{ name: 'venueos_locale', value: locale, url: base }]); await goto(`${base}/super`); await expect(page.getByRole('heading', { name: locale === 'es' ? 'Tu negocio, en un solo lugar.' : '业务管理，尽在一处。' })).toBeVisible(); await page.screenshot({ path: `${out}/${engine}-${locale}-mobile.png`, fullPage: true }); }
    // Error boundaries catch React exceptions without emitting pageerror; console evidence counts too.
    if (errors.length) throw new Error(`${engine} page errors: ${errors.join('; ')}`);
    const denied = await browser.newPage(); const deniedState = await setup(denied, 'DISTRICT_ADMIN'); await denied.goto(`${base}/super/customers`); await expect(denied.getByRole('heading', { name: 'Owner-only area' })).toBeVisible();
    if (deniedState.calls.some(c => c.path.startsWith('/super/'))) throw new Error('Restricted account made a privileged request');
    report.push({ engine, apiCalls: calls.length, pageErrors: errors, hydrationRoleGate: 'passed', desktopMobileLocales: 'passed', signedPdfDownload: 'passed', invoicePrint: 'passed', customerKeyboardTabs: 'passed' });
    await browser.close();
  }
  fixtureServer.close();
  fs.writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2)); console.log(JSON.stringify({ report, evidence: out }, null, 2));
})().catch(e => { console.error(e); process.exit(1); });
