import { nextAutoSlug, slugifyLocationName } from '../location-slug';

describe('location slug (DEV-003)', () => {
  it('slugifies a name', () => {
    expect(slugifyLocationName('  Lincoln High — East!  ')).toBe('lincoln-high-east');
    expect(slugifyLocationName('x'.repeat(80))).toHaveLength(60);
  });

  it('follows the name keystroke by keystroke (never freezes at one letter)', () => {
    let state = { slug: '', lastAuto: '' };
    for (const name of ['L', 'Li', 'Lin', 'Linc', 'Lincoln', 'Lincoln H', 'Lincoln High']) {
      state = nextAutoSlug(state.slug, state.lastAuto, name);
    }
    expect(state.slug).toBe('lincoln-high');
  });

  it('keeps a slug the operator typed themselves', () => {
    const next = nextAutoSlug('custom', 'lincoln', 'Lincoln High');
    expect(next.slug).toBe('custom');
    expect(next.lastAuto).toBe('lincoln');
  });
});
