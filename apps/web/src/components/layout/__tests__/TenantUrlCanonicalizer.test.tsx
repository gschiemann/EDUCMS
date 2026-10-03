/**
 * TenantUrlCanonicalizer is mounted in the shared [schoolId] layout for EVERY
 * signed-in user, so what it must NOT do matters more than what it does: it may
 * re-label the signed-in organization's own stale URL after a rename, and it
 * must never bounce someone who is legitimately on another tenant's URL.
 *
 * The pure rule is covered in lib/__tests__/tenant-url.test.ts; this proves the
 * wiring around it — that the accessible list is read and awaited, and that the
 * side effects (router, store, last-organization hint) happen only on a rewrite.
 */
import { render } from '@testing-library/react';

const replace = jest.fn();
// The real router object is stable across renders; a fresh object per call would
// re-fire the effect on every render and hide a missing dependency.
const router = { replace };
let pathname: string | null = '/harbor-demo/settings/organization';
jest.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useRouter: () => router,
}));

let tenantQuery: { data?: unknown } = {};
let accessibleQuery: { data?: unknown } = {};
jest.mock('@/hooks/use-api', () => ({
  useTenant: () => tenantQuery,
  useAccessibleTenants: () => accessibleQuery,
}));

const setActiveTenant = jest.fn();
let signedInTenantId: string | undefined = 'org-1';
jest.mock('@/store/ui-store', () => ({
  useUIStore: (selector: (state: unknown) => unknown) =>
    selector({ user: signedInTenantId ? { tenantId: signedInTenantId } : null, setActiveTenant }),
}));

import { TenantUrlCanonicalizer } from '../TenantUrlCanonicalizer';

const renamed = { id: 'org-1', slug: 'riverside-homes' };
const location = { id: 'loc-1', slug: 'riverside-east' };
const entry = (t: { id: string; slug: string }) => ({ ...t, name: t.slug, parentId: null });

function at(url: string) {
  window.history.pushState({}, '', url);
  pathname = url.split(/[?#]/)[0];
}

beforeEach(() => {
  replace.mockReset();
  setActiveTenant.mockReset();
  tenantQuery = { data: renamed };
  accessibleQuery = { data: { current: 'org-1', tenants: [entry(renamed)] } };
  signedInTenantId = 'org-1';
  try { localStorage.clear(); } catch { /* unavailable */ }
});

it('re-labels the stale URL once, keeping query and anchor, and remembers the current label', () => {
  at('/harbor-demo/settings/organization?demo=1#cc-org-identity');
  render(<TenantUrlCanonicalizer />);

  expect(replace).toHaveBeenCalledTimes(1);
  expect(replace).toHaveBeenCalledWith('/riverside-homes/settings/organization?demo=1#cc-org-identity', { scroll: false });
  expect(setActiveTenant).toHaveBeenCalledWith('riverside-homes');
  expect(localStorage.getItem('edu_cms_last_school')).toBe('riverside-homes');
});

it('leaves a district admin on a child location’s URL while the token still names the district', () => {
  accessibleQuery = { data: { current: 'org-1', tenants: [entry(renamed), entry(location)] } };
  at('/riverside-east/screens?filter=offline');
  render(<TenantUrlCanonicalizer />);

  expect(replace).not.toHaveBeenCalled();
  expect(setActiveTenant).not.toHaveBeenCalled();
  expect(localStorage.getItem('edu_cms_last_school')).toBeNull();
});

it('waits for the accessible list, then re-labels once it has loaded', () => {
  accessibleQuery = {};
  at('/harbor-demo/screens');
  const { rerender } = render(<TenantUrlCanonicalizer />);
  expect(replace).not.toHaveBeenCalled();

  accessibleQuery = { data: { current: 'org-1', tenants: [entry(renamed)] } };
  rerender(<TenantUrlCanonicalizer />);
  expect(replace).toHaveBeenCalledTimes(1);
  expect(replace).toHaveBeenCalledWith('/riverside-homes/screens', { scroll: false });
});

it('does nothing while a tenant switch is landing (cached tenant is not the signed-in one)', () => {
  signedInTenantId = 'loc-1';
  accessibleQuery = { data: { current: 'loc-1', tenants: [entry(renamed), entry(location)] } };
  at('/riverside-east/dashboard');
  render(<TenantUrlCanonicalizer />);
  expect(replace).not.toHaveBeenCalled();
});

it('does nothing on an already-canonical URL, or before the tenant has loaded', () => {
  at('/riverside-homes/dashboard');
  const { rerender } = render(<TenantUrlCanonicalizer />);
  expect(replace).not.toHaveBeenCalled();

  tenantQuery = {};
  at('/harbor-demo/dashboard');
  rerender(<TenantUrlCanonicalizer />);
  expect(replace).not.toHaveBeenCalled();
});

it('does nothing when the router has no pathname', () => {
  pathname = null;
  render(<TenantUrlCanonicalizer />);
  expect(replace).not.toHaveBeenCalled();
});
