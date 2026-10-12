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
import EulaPage from '../../app/terms/eula/page';
import { GOVERNING_STATE, LEGAL_CONTACTS, LEGAL_ENTITY, SUBPROCESSORS } from '../legal-entity';
import { shouldEnforceScriptCsp } from '../csp-script-policy';

jest.mock('@/components/marketing/PublicShell', () => ({
  PublicShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const pages = { TermsPage, PrivacyPage, DpaPage, FerpaPage, CoppaPage, EulaPage };
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
    // 2026-10-12 pricing: VenueOS $20 / $200, VenueOS + AI $25 / $250 per Screen.
    expect(t).toMatch(/\$20 per Screen per month/);
    expect(t).toMatch(/\$200 per Screen per year/);
    expect(t).toMatch(/\$25 per Screen per month/);
    expect(t).toMatch(/\$250 per Screen per year/);
    expect(t).toMatch(/Purchase orders, invoicing[\s\S]*Enterprise/);
  });

  it('entity name and address come from ONE constant and are filled in', () => {
    expect(LEGAL_ENTITY.companyLegalName).toBe('Twin Oaks Farm & Tech LLC');
    expect(LEGAL_ENTITY.mailingAddress).not.toMatch(/\[/);
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

  describe('EULA consistent with the Terms (2026-10-11)', () => {
    it('neither document has arbitration or a class-action waiver', () => {
      for (const C of [TermsPage, EulaPage]) {
        const t = text(C);
        expect(t).not.toMatch(/arbitrat/i);
        expect(t).not.toMatch(/class action|class-action|collective proceeding/i);
        expect(t).not.toMatch(/Delaware/);
      }
    });

    it('both use the ONE governing-state constant for law and courts, with the public-entity exception', () => {
      expect(GOVERNING_STATE).toBe('Alabama');
      for (const C of [TermsPage, EulaPage]) {
        const t = text(C);
        expect(t).toContain(`governed by the laws of the State of ${GOVERNING_STATE}`);
        expect(t).toContain(`courts located in ${GOVERNING_STATE}`);
        expect(t).toMatch(/good faith[\s\S]*30 days/);
        expect(t).toMatch(/public school, school district,\s+public college or university, or other government entity/);
        expect(t).toMatch(/public-records laws/);
        expect(t).toMatch(/minimum\s+extent/);
      }
      expect(text(TermsPage)).not.toMatch(/state in which the Customer is located/);
    });

    it('the EULA reuses the Terms liability cap and states the order of precedence', () => {
      const cap = /fees paid or payable by the Customer\s+for the Service in the twelve \(12\) months/;
      expect(text(TermsPage)).toMatch(cap);
      const t = text(EulaPage);
      expect(t).toMatch(cap);
      expect(t).not.toMatch(/\$100|ONE HUNDRED/i);
      expect(t).toMatch(/\(1\) a signed order form or Enterprise\s+agreement; \(2\) the DPA[\s\S]*\(3\) the Terms; \(4\) this\s+Agreement/);
    });

    it('the EULA covers the license scope, updates, open source and export, and keeps the counsel note', () => {
      const t = text(EulaPage);
      expect(t).toMatch(/install and run the screen player applications/);
      expect(t).toMatch(/Reverse engineer/);
      expect(t).toMatch(/automatic updates/);
      expect(t).toMatch(/open-source components/i);
      expect(t).toMatch(/sanctions/);
      expect(t).toMatch(/ends automatically when\s+the subscription ends/);
      expect(t).toMatch(/not legal advice/);
      expect(t).toMatch(/not a substitute for/);
      expect(t).toContain(LEGAL_ENTITY.companyLegalName);
      expect(t).toContain(LEGAL_ENTITY.mailingAddress);
    });
  });
});
