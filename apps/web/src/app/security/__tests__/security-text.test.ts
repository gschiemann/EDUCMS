/**
 * /security ("Report a security issue") text lives outside the locale catalogs
 * (server-only, bundle budget), so the catalog parity gate cannot see it — this
 * test is its gate. It also holds the page's commitments to the ones
 * SECURITY.md makes, because both are public promises and they must agree.
 */
import fs from 'fs';
import path from 'path';
import { SECURITY_POLICY_TEXT } from '../policy-text';

type Leaf = string;
const tags = (s: Leaf) => [...s.matchAll(/<(\w+)>/g)].map((m) => m[1]).sort().join(',');
const holes = (s: Leaf) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

/** Every string leaf, keyed by its path (`stats.0.value`, `rules.3` …). */
function leaves(node: unknown, prefix = '', out: Record<string, string> = {}): Record<string, string> {
  if (typeof node === 'string') {
    out[prefix] = node;
  } else if (Array.isArray(node)) {
    node.forEach((v, i) => leaves(v, prefix ? `${prefix}.${i}` : String(i), out));
  } else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) leaves(v, prefix ? `${prefix}.${k}` : k, out);
  }
  return out;
}

const LOCALES = ['en', 'es', 'zh'] as const;
const en = leaves(SECURITY_POLICY_TEXT.en);
const SECURITY_MD = fs.readFileSync(path.resolve(__dirname, '../../../../../../SECURITY.md'), 'utf8');

describe('/security page text', () => {
  it.each(['es', 'zh'] as const)('%s has the same shape as English: every key, list length, link and placeholder', (loc) => {
    const tr = leaves(SECURITY_POLICY_TEXT[loc]);
    expect(Object.keys(tr).sort()).toEqual(Object.keys(en).sort());
    for (const k of Object.keys(en)) {
      expect(tr[k].trim()).not.toBe('');
      expect(tags(tr[k])).toBe(tags(en[k]));
      expect(holes(tr[k])).toBe(holes(en[k]));
    }
  });

  it('is actually translated — no Spanish or Chinese line is left in English', () => {
    for (const loc of ['es', 'zh'] as const) {
      const tr = leaves(SECURITY_POLICY_TEXT[loc]);
      const same = Object.keys(en).filter((k) => tr[k] === en[k] && /[a-z]{4,}\s+[a-z]{3,}/i.test(en[k]));
      expect(same).toEqual([]);
    }
  });

  it('only uses the link tags the page knows', () => {
    for (const loc of LOCALES) {
      for (const v of Object.values(leaves(SECURITY_POLICY_TEXT[loc]))) {
        for (const t of tags(v).split(',').filter(Boolean)) {
          expect(['mail', 'github', 'overview', 'network', 'dpa', 'txt']).toContain(t);
        }
      }
    }
  });

  it('says what to send, what happens next, the safe harbor and the scope in every language', () => {
    for (const loc of LOCALES) {
      const t = SECURITY_POLICY_TEXT[loc];
      expect(t.send).toHaveLength(4);
      expect(t.stats).toHaveLength(4);
      expect(t.steps).toHaveLength(5);
      expect(t.harbor.length).toBeGreaterThanOrEqual(3);
      expect(t.harborLimits).toMatch(/<mail>security@venue-os\.app<\/mail>/);
      expect(t.inScope.length).toBeGreaterThan(0);
      expect(t.outOfScope.length).toBeGreaterThan(0);
      expect(t.rules.length).toBeGreaterThan(0);
    }
  });

  it('commits to an acknowledgement within 2 business days — in every language', () => {
    expect(SECURITY_POLICY_TEXT.en.stats[0].value).toBe('2 business days');
    expect(SECURITY_POLICY_TEXT.en.steps[0].body).toMatch(/\b2 business days\b/);
    expect(SECURITY_POLICY_TEXT.es.stats[0].value).toBe('2 días hábiles');
    expect(SECURITY_POLICY_TEXT.es.steps[0].body).toMatch(/\b2 días hábiles\b/);
    expect(SECURITY_POLICY_TEXT.zh.stats[0].value).toBe('2 个工作日');
    expect(SECURITY_POLICY_TEXT.zh.steps[0].body).toMatch(/2 个工作日/);
  });

  it('states the same commitments SECURITY.md makes (acknowledge 2, assess 10, fix 30 / 90)', () => {
    const t = SECURITY_POLICY_TEXT.en;
    expect(t.stats.map((s) => s.value)).toEqual(['2 business days', '10 business days', '30 days', '90 days']);
    expect(t.steps[1].body).toMatch(/\b10 business days\b/);
    expect(t.steps[2].body).toMatch(/\b30 days\b.*\b90 days\b/);
    expect(SECURITY_MD).toMatch(/Acknowledgement \| Within \*\*2 business days\*\*/);
    expect(SECURITY_MD).toMatch(/Initial assessment \+ severity \| Within \*\*10 business days\*\*/);
    expect(SECURITY_MD).toMatch(/Critical \/ High \| Target \*\*30 days\*\*/);
    expect(SECURITY_MD).toMatch(/Medium \/ Low \| Target \*\*90 days\*\*/);
    expect(SECURITY_MD).not.toMatch(/3 business days/);
  });

  it('SECURITY.md links the public page and its machine-readable twin', () => {
    expect(SECURITY_MD).toContain('https://venue-os.app/security');
    expect(SECURITY_MD).toContain('https://venue-os.app/.well-known/security.txt');
  });

  it('claims no certification VenueOS does not hold, and no bounty', () => {
    for (const loc of LOCALES) {
      const all = Object.values(leaves(SECURITY_POLICY_TEXT[loc])).join(' ');
      expect(all).not.toMatch(/SOC ?2|ISO ?27001|FedRAMP|HITRUST/i);
    }
    expect(SECURITY_POLICY_TEXT.en.bountyNote).toMatch(/do not run a paid bug bounty/);
  });
});
