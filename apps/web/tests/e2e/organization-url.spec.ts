import { test, expect, type Page } from '@playwright/test';

interface Scenario {
  /** The server refuses the save (503). */
  reject?: boolean;
  /** The organization has single sign-on configured: the name saves, the URL is kept. */
  ssoKeepsUrl?: boolean;
}

type Row = { id: string; name: string; slug: string; vertical: string; parentId: string | null; address: string | null };

/** What the server does to a name: a lower-case ASCII label (see organizationSlug in the API). */
const labelFor = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

async function setup(page: Page, scenario: Scenario = {}) {
  // A district admin: the token names the district; a child location sits under it.
  const user = { id: 'rename-user', tenantId: 'rename-tenant', tenantSlug: 'harbor-demo', role: 'DISTRICT_ADMIN', email: 'rename@example.test' };
  let tenant: Row = { id: user.tenantId, name: 'Harbor Demo', slug: 'harbor-demo', vertical: 'CORPORATE', parentId: null, address: null };
  const location: Row = { id: 'rename-location', name: 'Riverside East', slug: 'riverside-east', vertical: 'CORPORATE', parentId: user.tenantId, address: null };
  let writes = 0;
  const headers = { 'Access-Control-Allow-Origin': 'http://localhost:3000', 'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Headers': 'authorization,content-type,x-csrf-token,x-requested-with', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS' };
  await page.addInitScript(u => {
    sessionStorage.setItem('edu_cms_token', 'rename-test-token');
    sessionStorage.setItem('edu_cms_user', JSON.stringify(u));
    localStorage.setItem('edu_cms_eula_accepted_v1.0', '1');
  }, user);
  await page.route('**/api/v1/**', async route => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
    if (path === '/tenants/me' && route.request().method() === 'PATCH') {
      writes++;
      if (scenario.reject) return route.fulfill({ status: 503, headers, contentType: 'application/json', body: JSON.stringify({ message: 'Save could not be confirmed' }) });
      const body = route.request().postDataJSON();
      tenant = { ...tenant, name: body.name, slug: scenario.ssoKeepsUrl ? tenant.slug : labelFor(body.name) };
      return route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify({ ...tenant, urlKept: scenario.ssoKeepsUrl ? 'sso' : null }) });
    }
    const bodies: Record<string, unknown> = {
      '/auth/me': user, '/users/me': user, '/tenants': tenant,
      '/tenants/accessible': { current: user.tenantId, tenants: [tenant, location] },
      '/tenants/children': { districtId: user.tenantId, children: [location] },
      '/branding/me': {}, '/branding/context': {},
      '/audit': { items: [], total: 0 },
      '/assets/storage-summary': { totalBytes: 0, totalFiles: 0, images: { bytes: 0, files: 0 }, videos: { bytes: 0, files: 0 }, other: { bytes: 0, files: 0 } },
    };
    return route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify(bodies[path] ?? (path.startsWith('/audit') ? { items: [], total: 0 } : [])) });
  });
  return { writes: () => writes };
}

test('organization rename updates the current account URL and retains the page without a tenant switch', async ({ page }, info) => {
  const scenario = await setup(page);
  const switched: string[] = [];
  page.on('request', request => { if (request.url().includes('/tenants/switch')) switched.push(request.url()); });
  await page.goto('/harbor-demo/settings/organization?demo=1#cc-org-identity');
  await expect(page.getByLabel('Organization name', { exact: true })).toHaveValue('Harbor Demo');
  await page.getByLabel('Organization name', { exact: true }).fill('Riverside Homes');
  await page.getByRole('button', { name: /^Save 1 change$/ }).click();
  await expect(page).toHaveURL(/\/riverside-homes\/settings\/organization\?demo=1#cc-org-identity$/);
  await expect(page.getByLabel('Organization name', { exact: true })).toHaveValue('Riverside Homes');
  await expect(page.getByText('Account URL: /riverside-homes', { exact: true })).toBeVisible();
  expect(scenario.writes()).toBe(1);
  await page.screenshot({ path: info.outputPath('organization-name-url.png'), fullPage: true });
  // An old bookmark for the signed-in member re-labels to the current URL, keeping query and anchor.
  await page.goto('/harbor-demo/settings/organization?bookmark=1#cc-org-address');
  await expect(page).toHaveURL(/\/riverside-homes\/settings\/organization\?bookmark=1#cc-org-address$/);
  expect(switched).toEqual([]);
  expect(await page.evaluate(() => localStorage.getItem('edu_cms_last_school'))).toBe('riverside-homes');
});

test('a failed organization save keeps the previous URL and typed name', async ({ page }) => {
  await setup(page, { reject: true });
  await page.goto('/harbor-demo/settings/organization');
  await expect(page.getByLabel('Organization name', { exact: true })).toHaveValue('Harbor Demo');
  await page.getByLabel('Organization name', { exact: true }).fill('Riverside Homes');
  await page.getByRole('button', { name: /^Save 1 change$/ }).click();
  await expect(page.getByText('Save could not be confirmed', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/harbor-demo\/settings\/organization$/);
  await expect(page.getByLabel('Organization name', { exact: true })).toHaveValue('Riverside Homes');
});

test('a rename the server keeps for single sign-on saves the name, leaves the URL and says why', async ({ page }) => {
  const scenario = await setup(page, { ssoKeepsUrl: true });
  await page.goto('/harbor-demo/settings/organization');
  await expect(page.getByLabel('Organization name', { exact: true })).toHaveValue('Harbor Demo');
  await page.getByLabel('Organization name', { exact: true }).fill('Riverside Homes');
  await page.getByRole('button', { name: /^Save 1 change$/ }).click();
  await expect(page.getByText('The account URL stays /harbor-demo because single sign-on is set up for this organization.', { exact: true })).toBeVisible();
  await expect(page.getByText('Account URL: /harbor-demo', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Organization name', { exact: true })).toHaveValue('Riverside Homes');
  await expect(page).toHaveURL(/\/harbor-demo\/settings\/organization$/);
  expect(scenario.writes()).toBe(1);
});

test('a district admin opening a location’s URL while the token still names the district is not sent back', async ({ page }) => {
  await setup(page);
  const accessible = page.waitForResponse(response => response.url().includes('/tenants/accessible'));
  await page.goto('/riverside-east/settings/organization');
  await accessible;
  // Both the token's tenant and the list of tenants this admin may open have loaded.
  await expect(page.getByLabel('Organization name', { exact: true })).toHaveValue('Harbor Demo');
  // A wrongly-firing canonicalizer navigates as soon as that data renders; give it room to.
  await page.waitForTimeout(750);
  await expect(page).toHaveURL(/\/riverside-east\/settings\/organization$/);
  expect(await page.evaluate(() => localStorage.getItem('edu_cms_last_school'))).toBeNull();
});
