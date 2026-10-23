/**
 * /security text lives outside the locale catalogs (server-only, bundle
 * budget), so the catalog parity gate cannot see it — this test is its gate.
 */
import { SECURITY_POLICY_TEXT } from '../policy-text';

const tags = (s: string) => [...s.matchAll(/<(\w+)>/g)].map((m) => m[1]).sort().join(',');
const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

describe('/security policy text', () => {
  const en = SECURITY_POLICY_TEXT.en as Record<string, string>;

  it.each(['es', 'zh'] as const)('%s has every English key, the same links and placeholders', (loc) => {
    const tr = SECURITY_POLICY_TEXT[loc] as Record<string, string>;
    expect(Object.keys(tr).sort()).toEqual(Object.keys(en).sort());
    for (const k of Object.keys(en)) {
      expect(tr[k].trim()).not.toBe('');
      expect(tags(tr[k])).toBe(tags(en[k]));
      expect(holes(tr[k])).toBe(holes(en[k]));
    }
  });

  it('only uses the link tags the page knows', () => {
    for (const loc of ['en', 'es', 'zh'] as const) {
      for (const v of Object.values(SECURITY_POLICY_TEXT[loc] as Record<string, string>)) {
        for (const t of tags(v).split(',').filter(Boolean)) expect(['mail', 'github', 'overview', 'network', 'dpa']).toContain(t);
      }
    }
  });

  it('names both private reporting channels, as SECURITY.md does (repo public, 2026-10-22)', () => {
    for (const loc of ['en', 'es', 'zh'] as const) {
      const how = (SECURITY_POLICY_TEXT[loc] as Record<string, string>).howBody;
      expect(how).toMatch(/<mail>security@venue-os\.app<\/mail>/);
      expect(how).toMatch(/<github>[^<]+<\/github>/);
    }
    expect(en.howBody).not.toMatch(/only reporting channel/);
  });

  it('states the commitments SECURITY.md makes, and no bounty or certification', () => {
    expect(en.ackTime).toMatch(/3 business days/);
    expect(en.assessTime).toMatch(/10 business days/);
    expect(en.fixHighTime).toMatch(/30 days/);
    expect(en.fixLowTime).toMatch(/90 days/);
    expect(Object.values(en).join(' ')).not.toMatch(/SOC ?2|ISO ?27001|FedRAMP/);
  });
});
