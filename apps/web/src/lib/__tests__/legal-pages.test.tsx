/**
 * Public legal pages (2026-10-11) — copy that must stay true for EVERY
 * customer type, and the one-place entity/address placeholders.
 */
import { render } from '@testing-library/react';
import TermsPage from '../../app/terms/page';
import PrivacyPage from '../../app/privacy/page';
import DpaPage from '../../app/dpa/page';
import FerpaPage from '../../app/ferpa/page';
import CoppaPage from '../../app/coppa/page';
import { LEGAL_CONTACTS, LEGAL_ENTITY, SUBPROCESSORS } from '../legal-entity';
import { shouldEnforceScriptCsp } from '../csp-script-policy';

jest.mock('@/components/marketing/PublicShell', () => ({
  PublicShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const pages = { TermsPage, PrivacyPage, DpaPage, FerpaPage, CoppaPage };
const text = (C: () => React.ReactElement) => render(<C />).container.textContent ?? '';

describe('public legal pages', () => {
  it.each(Object.entries(pages))('%s has no phantom plan, no retired addresses, no certification claims', (_n, C) => {
    const t = text(C);
    expect(t).not.toMatch(/District plan/i);
    expect(t).not.toMatch(/(dsr|ferpa|coppa|contracts)@venue-os\.app|educms\.example/);
    expect(t).not.toMatch(/SOC 2|ISO 27001|FedRAMP|HIPAA[- ]compliant/i);
    expect(t).toMatch(/Last updated/);
  });

  it('terms, privacy and the DPA are written for every customer type, not K-12 only', () => {
    for (const C of [TermsPage, PrivacyPage, DpaPage]) {
      const t = text(C);
      expect(t).toMatch(/school districts? and schools?|school district, school/i);
      expect(t).toMatch(/restaurant|business/i);
      expect(t).not.toMatch(/to K-12 school districts\./);
    }
  });

  it('terms state the real pricing and put purchase orders on Enterprise plans', () => {
    const t = text(TermsPage);
    expect(t).toMatch(/\$25 per Screen per month/);
    expect(t).toMatch(/\$240 per Screen per year/);
    expect(t).toMatch(/Purchase orders, invoicing[\s\S]*Enterprise/);
  });

  it('entity name and address come from ONE constant (placeholders until filled)', () => {
    for (const C of [TermsPage, PrivacyPage, DpaPage]) {
      const t = text(C);
      expect(t).toContain(LEGAL_ENTITY.companyLegalName);
      expect(t).toContain(LEGAL_ENTITY.mailingAddress);
    }
    expect(text(TermsPage)).toContain(LEGAL_CONTACTS.legal);
  });

  it('the DPA renders every sub-processor', () => {
    const t = text(DpaPage);
    for (const s of SUBPROCESSORS) expect(t).toContain(s.name);
    for (const name of ['Supabase', 'Railway', 'Vercel', 'Resend', 'Stripe', 'Sentry', 'OpenAI', 'Anthropic', 'Google Maps']) {
      expect(SUBPROCESSORS.some((s) => s.name.includes(name))).toBe(true);
    }
  });

  it('/dpa is prerendered public content, outside the enforced nonce CSP', () => {
    expect(shouldEnforceScriptCsp('/dpa')).toBe(false);
  });
});
