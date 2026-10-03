import { availableOrganizationSlug, organizationSlug } from './tenant-slug';

const tenantId = 'abcdef12-0000-4000-8000-000000000001';

/** A transaction handle whose tenant table already holds `claims` (slug -> owner id). */
function txWith(claims: Record<string, string>) {
  const findUnique = jest.fn(async ({ where }: any) => (claims[where.slug] ? { id: claims[where.slug] } : null));
  return { tx: { tenant: { findUnique } } as any, findUnique };
}

describe('organizationSlug', () => {
  it('normalizes a name to a lower-case ASCII label', () => {
    expect(organizationSlug(' Riverside Homes Northern California ', tenantId)).toBe('riverside-homes-northern-california');
    expect(organizationSlug('Café • São Paulo', tenantId)).toBe('cafe-sao-paulo');
    expect(organizationSlug('A  &  B -- Partners!!', tenantId)).toBe('a-b-partners');
  });

  it('never exceeds 60 characters and never ends on a hyphen', () => {
    const slug = organizationSlug('a '.repeat(100), tenantId);
    expect(slug.length).toBeLessThanOrEqual(60);
    expect(slug).not.toMatch(/^-|-$/);
    expect(organizationSlug(`${'x'.repeat(59)} tail`, tenantId)).toBe('x'.repeat(59));
  });

  it('falls back to the tenant id when the name yields no usable label', () => {
    // No ASCII at all, one character, and a word the web origin already serves.
    expect(organizationSlug('東京', tenantId)).toBe('organization-abcdef12');
    expect(organizationSlug('A', tenantId)).toBe('organization-abcdef12');
    for (const name of ['player', ' Panic ', 'SUPER', 'api', 'screens', 'locales', 'holiday-templates']) {
      expect(organizationSlug(name, tenantId)).toBe('organization-abcdef12');
    }
  });

  it('keeps a name that merely STARTS with a reserved word', () => {
    expect(organizationSlug('Player Development', tenantId)).toBe('player-development');
  });
});

describe('availableOrganizationSlug', () => {
  it('returns the plain label when nobody holds it', async () => {
    const { tx, findUnique } = txWith({});
    await expect(availableOrganizationSlug(tx, 'Riverside Homes', tenantId)).resolves.toBe('riverside-homes');
    expect(findUnique).toHaveBeenCalledTimes(1);
  });

  it('gives another organization’s label up to them and suffixes this one with its own id', async () => {
    const { tx } = txWith({ 'riverside-homes': 'someone-else' });
    await expect(availableOrganizationSlug(tx, 'Riverside Homes', tenantId)).resolves.toBe('riverside-homes-abcdef12');
  });

  it('keeps counting when the suffixed label is held too', async () => {
    const { tx } = txWith({ 'riverside-homes': 'someone-else', 'riverside-homes-abcdef12': 'another-one' });
    await expect(availableOrganizationSlug(tx, 'Riverside Homes', tenantId)).resolves.toBe('riverside-homes-abcdef12-2');
  });

  it('treats the caller’s own current label as available (a case-only rename is a no-op)', async () => {
    const { tx } = txWith({ 'riverside-homes': tenantId });
    await expect(availableOrganizationSlug(tx, 'RIVERSIDE HOMES', tenantId)).resolves.toBe('riverside-homes');
  });

  it('keeps every candidate within 60 characters, ending on a letter or digit', async () => {
    const long = 'x'.repeat(60);
    const { tx } = txWith({ [long]: 'someone-else' });
    const slug = await availableOrganizationSlug(tx, long, tenantId);
    expect(slug.length).toBeLessThanOrEqual(60);
    expect(slug).toMatch(/^x+-abcdef12$/);
  });

  it('never offers a reserved word, even when the name is one', async () => {
    const { tx, findUnique } = txWith({});
    await expect(availableOrganizationSlug(tx, 'Player', tenantId)).resolves.toBe('organization-abcdef12');
    expect(findUnique).toHaveBeenCalledWith({ where: { slug: 'organization-abcdef12' }, select: { id: true } });
  });

  it('gives up instead of looping forever when the whole namespace is taken', async () => {
    const findUnique = jest.fn(async () => ({ id: 'someone-else' }));
    await expect(availableOrganizationSlug({ tenant: { findUnique } } as any, 'Riverside Homes', tenantId)).rejects.toThrow(
      'Organization URL namespace exhausted',
    );
    expect(findUnique).toHaveBeenCalledTimes(100);
  });
});
