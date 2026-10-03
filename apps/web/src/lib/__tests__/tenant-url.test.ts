import { canonicalTenantPath, type TenantUrlIdentity } from '../tenant-url';

/**
 * Who is who in these cases (GET /tenants answers for the TOKEN's tenant;
 * GET /tenants/accessible is what the switcher lists):
 *   - `renamed`     the signed-in organization, renamed from `harbor-demo`
 *   - `location`    a child location of it
 *   - `unrelated`   a tenant a super-admin can open but a normal member cannot
 *   - `system`      the real sentinel tenant, whose slug is `__system__`
 */
const renamed: TenantUrlIdentity = { id: 'org-1', slug: 'riverside-homes' };
const location: TenantUrlIdentity = { id: 'loc-1', slug: 'riverside-east' };
const unrelated: TenantUrlIdentity = { id: 'org-2', slug: 'unrelated-org' };
const system: TenantUrlIdentity = { id: '00000000-0000-0000-0000-000000000000', slug: '__system__' };

const memberList = [renamed];
const districtList = [renamed, location];
const superList = [renamed, location, unrelated, system];

describe('canonicalTenantPath — the signed-in organization’s own stale label', () => {
  it('re-labels the old URL and keeps the whole deep link: path, query and anchor', () => {
    expect(canonicalTenantPath('/harbor-demo/playlists/p1?addScreens=1#content', renamed, 'org-1', memberList))
      .toBe('/riverside-homes/playlists/p1?addScreens=1#content');
    expect(canonicalTenantPath('/harbor-demo/settings/organization', renamed, 'org-1', memberList))
      .toBe('/riverside-homes/settings/organization');
    expect(canonicalTenantPath('/harbor-demo?x=1', renamed, 'org-1', memberList)).toBe('/riverside-homes?x=1');
    expect(canonicalTenantPath('/harbor-demo#top', renamed, 'org-1', memberList)).toBe('/riverside-homes#top');
    expect(canonicalTenantPath('/harbor-demo/', renamed, 'org-1', memberList)).toBe('/riverside-homes/');
  });

  it('turns a URL that carries the organization’s id into its label', () => {
    expect(canonicalTenantPath('/org-1/screens', renamed, 'org-1', memberList)).toBe('/riverside-homes/screens');
  });

  it('is not shielded by a stale accessible list that still carries this organization’s OLD label', () => {
    // The list was fetched before the rename: its row for this tenant says `harbor-demo`.
    const stale = [{ id: 'org-1', slug: 'harbor-demo' }];
    expect(canonicalTenantPath('/harbor-demo/screens', renamed, 'org-1', stale)).toBe('/riverside-homes/screens');
  });

  it('leaves an already-canonical URL alone', () => {
    expect(canonicalTenantPath('/riverside-homes/dashboard', renamed, 'org-1', memberList)).toBeNull();
    expect(canonicalTenantPath('/riverside-homes', renamed, 'org-1', memberList)).toBeNull();
  });

  it('ignores a malformed or off-site path', () => {
    for (const path of ['', '/', '//evil.test', '//evil.test/x', 'harbor-demo/screens', '?x=1', '#top']) {
      expect(canonicalTenantPath(path, renamed, 'org-1', memberList)).toBeNull();
    }
  });
});

describe('canonicalTenantPath — never bounces someone legitimately on ANOTHER tenant’s URL', () => {
  it('(1) a district admin opening a child location while the token still names the district', () => {
    // The launch chooser and the mobile fleet cards link to /<location>/… without a switch.
    expect(canonicalTenantPath('/riverside-east/screens', renamed, 'org-1', districtList)).toBeNull();
    expect(canonicalTenantPath('/riverside-east/dashboard?tab=health#top', renamed, 'org-1', districtList)).toBeNull();
    // …including a URL that carries the location's id instead of its label.
    expect(canonicalTenantPath('/loc-1/screens', renamed, 'org-1', districtList)).toBeNull();
  });

  it('(2) a super-admin viewing any tenant, including one whose slug is not [a-z0-9-]', () => {
    expect(canonicalTenantPath('/unrelated-org/templates', renamed, 'org-1', superList)).toBeNull();
    expect(canonicalTenantPath('/__system__/dashboard', renamed, 'org-1', superList)).toBeNull();
  });

  it('(3) the tenant switcher: nothing is rewritten while a switch is landing', () => {
    // After the new token is stored but before GET /tenants has answered for it, the
    // cache still holds the PREVIOUS tenant (or nothing, once the switch clears it).
    expect(canonicalTenantPath('/riverside-east/screens', renamed, 'loc-1', districtList)).toBeNull();
    expect(canonicalTenantPath('/riverside-east/screens', undefined, 'loc-1', districtList)).toBeNull();
    // Once it lands, tenant and URL agree.
    expect(canonicalTenantPath('/riverside-east/screens', location, 'loc-1', districtList)).toBeNull();
    // And the way back: the switcher also lists the district for a location admin.
    expect(canonicalTenantPath('/riverside-homes/dashboard', location, 'loc-1', districtList)).toBeNull();
  });

  it('(4) GET /tenants answers for the token’s tenant: a cached row for a different tenant never rewrites', () => {
    expect(canonicalTenantPath('/harbor-demo/screens', renamed, 'org-2', memberList)).toBeNull();
    expect(canonicalTenantPath('/harbor-demo/screens', renamed, undefined, memberList)).toBeNull();
  });

  it('a normal member cannot see another tenant, so its label is rewritten to their own', () => {
    // The same URL a super-admin may open is just an unknown label to a member.
    expect(canonicalTenantPath('/unrelated-org/templates', renamed, 'org-1', memberList)).toBe('/riverside-homes/templates');
    expect(canonicalTenantPath('/__system__/dashboard', renamed, 'org-1', memberList)).toBe('/riverside-homes/dashboard');
  });

  it('waits for the accessible list rather than guess: unknown is not "an old label"', () => {
    expect(canonicalTenantPath('/riverside-east/screens', renamed, 'org-1', undefined)).toBeNull();
    expect(canonicalTenantPath('/harbor-demo/screens', renamed, 'org-1', undefined)).toBeNull();
  });
});

describe('canonicalTenantPath — reserved routes are not old labels', () => {
  it('never rewrites a route the app serves, even though no tenant holds that label', () => {
    for (const path of ['/player', '/player/abc?x=1', '/super/ai', '/login?next=%2Fx', '/locales/es.json', '/api/v1/tenants', '/_next/static/a.js', '/Player/x']) {
      expect(canonicalTenantPath(path, renamed, 'org-1', memberList)).toBeNull();
    }
  });

  it('still rewrites a label that merely starts with a reserved word', () => {
    expect(canonicalTenantPath('/player-ecosystem/screens', renamed, 'org-1', memberList)).toBe('/riverside-homes/screens');
  });
});

describe('canonicalTenantPath — labels outside [a-z0-9-]', () => {
  it('never rewrites TO a label it could not safely write into a URL', () => {
    // The sentinel tenant is real: a super-admin can switch into it, and its slug is `__system__`.
    expect(canonicalTenantPath('/harbor-demo/dashboard', system, system.id, superList)).toBeNull();
    for (const slug of ['Upper-Case', 'has space', 'a/b', '//evil.test', 'x?y', '']) {
      expect(canonicalTenantPath('/harbor-demo/dashboard', { id: 'org-1', slug }, 'org-1', memberList)).toBeNull();
    }
  });

  it('is fine when the signed-in tenant is the sentinel and the URL already matches it', () => {
    expect(canonicalTenantPath('/__system__/dashboard', system, system.id, superList)).toBeNull();
  });

  it('treats a missing slug or id as nothing to do', () => {
    expect(canonicalTenantPath('/harbor-demo/x', { id: 'org-1' }, 'org-1', memberList)).toBeNull();
    expect(canonicalTenantPath('/harbor-demo/x', { slug: 'riverside-homes' }, 'org-1', memberList)).toBeNull();
    expect(canonicalTenantPath('/harbor-demo/x', undefined, 'org-1', memberList)).toBeNull();
  });
});

describe('canonicalTenantPath — never loops', () => {
  const paths = [
    '/harbor-demo/playlists/p1?addScreens=1#content',
    '/harbor-demo',
    '/harbor-demo/',
    '/org-1/screens',
    '/unrelated-org/x',
    '/__system__/x',
    '/riverside-east/screens',
    '/riverside-homes/dashboard',
    '/player/x',
    '/Player/x',
    '/%E4%B8%8D/x',
    '//evil.test',
    '/',
    '',
  ];
  const tenants: Array<[string, TenantUrlIdentity | undefined, string | undefined]> = [
    ['own', renamed, 'org-1'],
    ['location', location, 'loc-1'],
    ['sentinel', system, system.id],
    ['mismatched cache', renamed, 'org-2'],
    ['nothing cached', undefined, 'org-1'],
  ];
  const lists = [undefined, memberList, districtList, superList, [{ id: 'org-1', slug: 'harbor-demo' }]];

  it('a destination is always canonical: running it back through the rule returns null', () => {
    let rewrites = 0;
    for (const path of paths) {
      for (const [, tenant, authId] of tenants) {
        for (const list of lists) {
          const first = canonicalTenantPath(path, tenant, authId, list);
          if (first === null) continue;
          rewrites += 1;
          expect(canonicalTenantPath(first, tenant, authId, list)).toBeNull();
          // And it only ever writes the signed-in tenant's own label, with the rest preserved.
          expect(first.startsWith(`/${tenant!.slug}`)).toBe(true);
        }
      }
    }
    // The table is only meaningful if it actually exercised rewrites.
    expect(rewrites).toBeGreaterThan(10);
  });
});
