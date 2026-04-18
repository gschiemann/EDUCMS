import { LegalPage } from '@/components/marketing/LegalPage';

export const metadata = { title: 'Terms of service — EduSignage' };

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of service"
      subtitle="The agreement between EduSignage and the schools and districts that use our service."
      updated="April 16, 2026"
    >
      <p>
        These Terms of Service (&quot;<strong>Terms</strong>&quot;) govern your use of EduSignage. By
        creating an account, using the dashboard, or connecting a display device, you agree to these
        Terms on behalf of yourself and the organization you represent.
      </p>

      <h2>1. The service</h2>
      <p>
        EduSignage provides cloud-hosted software for managing digital signage, emergency alerts, and
        interactive displays across K-12 schools. The service is delivered on a subscription basis at the
        pricing tier agreed to by your district.
      </p>

      <h2>2. Account eligibility</h2>
      <ul>
        <li>You must be 18 or older and authorized to bind your organization to these Terms.</li>
        <li>Your use must comply with your school or district&apos;s acceptable-use policies.</li>
        <li>Each named user is responsible for safeguarding their login credentials.</li>
      </ul>

      <h2>3. Customer data</h2>
      <p>
        You retain all rights to the content you upload (images, videos, announcements, templates). You
        grant us a limited license to host, display, and process that content solely to provide the
        service. We will not use customer data for any other purpose, including training AI models.
      </p>

      <h2>4. Acceptable use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>Use the service to display content that is unlawful, harassing, obscene, or infringes third-party rights.</li>
        <li>Attempt to bypass authentication, tamper with audit logs, or disable emergency system safeguards.</li>
        <li>Reverse-engineer or copy substantial portions of the service.</li>
        <li>Resell the service to third parties without a written reseller agreement.</li>
        <li>Use the service in a way that materially harms our other customers or the service itself.</li>
      </ul>

      <h2>5. Emergency system</h2>
      <p>
        EduSignage&apos;s emergency alert system is designed to be highly reliable but is not a substitute
        for calling 911 or your local emergency services. You remain responsible for following applicable
        laws, district policies, and state drill requirements. We are not liable for any harm resulting
        from failure to follow established emergency protocols.
      </p>

      <h2>6. Fees and billing</h2>
      <ul>
        <li>Fees are billed in advance on a monthly or annual cycle, as described on our <a href="/pricing">pricing page</a>.</li>
        <li>Purchase orders are accepted on District and Enterprise plans. Invoice terms: net 30.</li>
        <li>Failed credit-card payments result in a 10-day grace period before downgrading to read-only.</li>
        <li>Pricing may change with 30 days&apos; written notice. Annual customers are honored through their current term.</li>
      </ul>

      <h2>7. Term and termination</h2>
      <p>
        Either party may terminate with 30 days&apos; written notice. Upon termination, we provide a 90-day
        grace window for data export. We may suspend or terminate service immediately for material breach
        of these Terms, including misuse of the emergency system or non-payment after the grace period.
      </p>

      <h2>8. Service-level commitments</h2>
      <p>
        We target 99.9% uptime measured monthly for the core service. Scheduled maintenance is announced
        at least 72 hours in advance and, where possible, scheduled outside the school day. Credits may be
        available for sustained outages under your subscription agreement.
      </p>

      <h2>9. Warranty disclaimer</h2>
      <p>
        Except as expressly stated in a signed master services agreement, the service is provided
        &quot;as is.&quot; We disclaim all implied warranties of merchantability, fitness for a particular
        purpose, and non-infringement to the fullest extent permitted by law.
      </p>

      <h2>10. Limitation of liability</h2>
      <p>
        To the maximum extent permitted by law, neither party&apos;s aggregate liability under these Terms
        will exceed the fees paid or payable by you in the twelve (12) months preceding the event giving
        rise to the claim. Neither party will be liable for indirect, incidental, special, or
        consequential damages. This section does not apply to: (a) your obligation to pay fees;
        (b) either party&apos;s indemnification obligations; or (c) liability that cannot be excluded by
        law.
      </p>

      <h2>11. Indemnification</h2>
      <p>
        Each party will defend and indemnify the other against third-party claims to the extent caused by
        its breach of these Terms or its infringement of a third party&apos;s intellectual property
        rights, subject to prompt notice and reasonable cooperation from the indemnified party.
      </p>

      <h2>12. Governing law and disputes</h2>
      <p>
        These Terms are governed by the laws of the state in which your district is located, without
        regard to conflict-of-law principles. Disputes will first be attempted through good-faith
        negotiation and, if unresolved, through binding arbitration or in the courts of the applicable
        jurisdiction.
      </p>

      <h2>13. Changes</h2>
      <p>
        We may update these Terms. Material changes will be posted here and emailed to district
        administrators at least 30 days in advance.
      </p>

      <h2>14. Contact</h2>
      <p>
        Questions about these Terms? Email{' '}
        <a href="mailto:legal@edusignage.app">legal@edusignage.app</a>.
      </p>
    </LegalPage>
  );
}
