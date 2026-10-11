import Link from 'next/link';
import { LegalPage } from '@/components/marketing/LegalPage';
import { LEGAL_CONTACTS, LEGAL_ENTITY, LEGAL_LAST_UPDATED } from '@/lib/legal-entity';

export const metadata = { title: 'Terms of service — VenueOS' };

/**
 * Terms of service — written for EVERY customer type (2026-10-11): school
 * districts and schools, sports venues, restaurants, retail, worship,
 * gyms, healthcare, hospitality and corporate. School-only obligations live in
 * section 9 and apply only when the Customer is an educational institution.
 * Entity + address placeholders come from `@/lib/legal-entity`.
 * Needs attorney review before launch.
 */
export default function TermsPage() {
  const { companyLegalName, mailingAddress, productName } = LEGAL_ENTITY;
  return (
    <LegalPage
      title="Terms of service"
      subtitle="The agreement between VenueOS and the organizations that use it."
      updated={LEGAL_LAST_UPDATED}
    >
      <p>
        These Terms of Service (&quot;<strong>Terms</strong>&quot;) are an agreement between{' '}
        {companyLegalName} (&quot;<strong>{productName}</strong>&quot;, &quot;<strong>we</strong>&quot;,
        &quot;<strong>us</strong>&quot;) and the organization that signs up for or uses the service
        (the &quot;<strong>Customer</strong>&quot;, &quot;<strong>you</strong>&quot;). The Customer may
        be a school district or school, a sports venue, a restaurant, a store, a place of worship, a
        gym, a healthcare or hospitality operator, a business, or any other organization. By creating
        an account, using the dashboard or connecting a display, the person doing so agrees to these
        Terms on behalf of the Customer and confirms that they are authorized to do so.
      </p>
      <p>
        If the Customer has signed an order form, master agreement or other written agreement with us
        for the service, that agreement controls where it conflicts with these Terms. Our{' '}
        <Link href="/privacy">Privacy Policy</Link> and{' '}
        <Link href="/dpa">Data Processing Addendum</Link> form part of these Terms. Each person who
        signs in also accepts the <Link href="/terms/eula">End User License Agreement</Link>.
      </p>

      <h2>1. Definitions</h2>
      <ul>
        <li>
          <strong>Service</strong> — the {productName} cloud software for digital signage, interactive
          displays, live scoreboards and emergency alerts, including the web dashboard, the screen
          player applications, the API and related documentation.
        </li>
        <li>
          <strong>Authorized Users</strong> — the Customer&apos;s employees, contractors and other
          individuals the Customer allows to use the Service under its account.
        </li>
        <li>
          <strong>Customer Content</strong> — images, videos, documents, text, templates, schedules
          and other material the Customer or its Authorized Users upload to or create in the Service.
        </li>
        <li>
          <strong>Customer Data</strong> — Customer Content plus account information and other data
          we process for the Customer when it uses the Service, as described in the Privacy Policy.
        </li>
        <li>
          <strong>Screen</strong> — a display, media player or browser paired to the Customer&apos;s
          account to show content.
        </li>
      </ul>

      <h2>2. The Service</h2>
      <p>
        We provide the Service on a subscription basis. We may improve and change the Service over
        time; we will not make a change that materially reduces the core functionality of a paid
        subscription during its current term without notice.
      </p>

      <h2>3. Accounts and Authorized Users</h2>
      <ul>
        <li>Authorized Users must be at least 18 years old, or of the age of majority where they live.</li>
        <li>The Customer is responsible for who it invites, for the roles and permissions it assigns, and for its Authorized Users&apos; compliance with these Terms.</li>
        <li>Authorized Users must keep their sign-in credentials confidential. The Customer must tell us promptly at <a href={`mailto:${LEGAL_CONTACTS.security}`}>{LEGAL_CONTACTS.security}</a> if it believes an account has been compromised.</li>
        <li>API keys created in the Service are credentials of the Customer and must be protected the same way.</li>
      </ul>

      <h2>4. Customer Data</h2>
      <p>
        As between the parties, the Customer owns Customer Data. The Customer grants us a limited
        license to host, copy, process, transmit and display Customer Data only as needed to provide,
        secure and support the Service, and as described in the Data Processing Addendum. We do not
        sell Customer Data, and we do not use Customer Data to train artificial-intelligence models.
      </p>
      <p>
        The Customer is responsible for having the rights and permissions needed for the Customer
        Content it displays, including any notices to and consents from the people shown in it.
      </p>

      <h2>5. Acceptable use</h2>
      <p>The Customer and its Authorized Users will not:</p>
      <ul>
        <li>Display or upload content that is unlawful, harassing, obscene, deceptive or that infringes anyone&apos;s rights.</li>
        <li>Attempt to bypass authentication or access controls, tamper with audit records, or disable emergency safeguards.</li>
        <li>Send false or misleading emergency alerts, or run a drill without labeling it as a drill.</li>
        <li>Probe, scan or test the Service&apos;s security without our written permission (report suspected vulnerabilities to <a href={`mailto:${LEGAL_CONTACTS.security}`}>{LEGAL_CONTACTS.security}</a>).</li>
        <li>Reverse-engineer the Service except where the law allows it, or resell it without a written reseller agreement.</li>
        <li>Use the Service in a way that materially harms other customers or the Service itself.</li>
      </ul>

      <h2>6. Emergency features</h2>
      <p>
        The emergency alert features are designed to be dependable but rely on internet
        connectivity, power, display hardware and third-party infrastructure outside our control.
        They are <strong>not a substitute</strong> for calling 911 or local emergency services, for
        fire alarm or public-address systems, or for any certified mass-notification system. The
        Customer remains responsible for its own emergency plans, training, drills and redundant
        communication channels. The End User License Agreement contains additional terms on
        emergency features.
      </p>

      <h2>7. Fees, billing and trials</h2>
      <ul>
        <li>
          Standard pricing is <strong>$25 per Screen per month</strong>, or{' '}
          <strong>$240 per Screen per year</strong> billed annually ($20 per Screen per month). Current
          prices are on our <Link href="/pricing">pricing page</Link>. Authorized User accounts are not
          charged separately.
        </li>
        <li>
          New accounts may start with a free trial with a limited number of Screens. When a trial
          ends without a payment method, the account may move to a limited, view-only state until
          a plan is chosen.
        </li>
        <li>Card payments are processed by Stripe on Stripe-hosted pages; we do not receive or store full card numbers.</li>
        <li>
          Purchase orders, invoicing, volume pricing and custom terms are available on{' '}
          <strong>Enterprise</strong> plans by written agreement. Anything outside the standard
          per-Screen pricing is quoted individually.
        </li>
        <li>
          If a payment fails, we will notify the Customer and allow time to update the payment
          method. An unpaid or cancelled account may be limited to view-only use. Screens continue to
          show already-scheduled content and the emergency alert features remain available while an
          account is view-only.
        </li>
        <li>Fees are exclusive of taxes, which the Customer pays unless it provides a valid exemption certificate.</li>
        <li>We may change prices with at least 30 days&apos; notice. Annual subscriptions keep their price for the current term.</li>
      </ul>

      <h2>8. Term, termination and data export</h2>
      <p>
        Subscriptions renew for successive periods of the same length unless cancelled. The Customer
        may cancel at any time from the billing settings; cancellation takes effect at the end of the
        current paid period. Either party may terminate for the other&apos;s material breach that is
        not cured within 30 days of written notice. We may suspend access immediately where needed to
        prevent harm to the Service, other customers or the public, including misuse of the emergency
        features.
      </p>
      <p>
        After the subscription ends, the Customer may export its Customer Data for at least 90 days.
        After that we may delete Customer Data, and we will delete it on the Customer&apos;s written
        request, as described in the Data Processing Addendum. Encrypted backup copies expire on their
        normal cycle. Audit records may be kept longer where needed for security, safety or legal
        reasons.
      </p>

      <h2>9. Educational institutions</h2>
      <p>
        This section applies only when the Customer is a school district, school or other
        educational institution (an &quot;<strong>Educational Customer</strong>&quot;).
      </p>
      <ul>
        <li>
          <strong>FERPA.</strong> To the extent we receive personally identifiable information from
          education records, we act as a &quot;school official&quot; with a legitimate educational
          interest under 34 CFR &sect; 99.31(a)(1)(i)(B): we perform a service the Educational Customer
          would otherwise use its own employees for, we are under its direct control regarding the
          use and maintenance of that information, and we use it only for the purposes of the Service
          and do not re-disclose it except as the Educational Customer directs or the law requires.
          See our <Link href="/ferpa">FERPA statement</Link>.
        </li>
        <li>
          <strong>COPPA.</strong> The Service is directed to organizations, not to children. Where
          an Educational Customer uses the Service with information about students under 13, the
          Educational Customer provides any consent required on behalf of parents, for the use and
          benefit of the school and no other commercial purpose. See our{' '}
          <Link href="/coppa">COPPA statement</Link>.
        </li>
        <li>
          <strong>Student information on public screens.</strong> The Service hides student names
          and photos on public sports screens until an administrator of the Educational Customer
          confirms that its directory-information notice and photo releases allow them. The
          Educational Customer is responsible for the accuracy of those confirmations and for
          honoring each family&apos;s opt-out.
        </li>
        <li>
          <strong>Student data.</strong> We do not sell student data, use it for targeted
          advertising, build profiles of students for any non-educational purpose, or use it to
          train AI models. State student-privacy agreements can be put in place by contacting{' '}
          <a href={`mailto:${LEGAL_CONTACTS.privacy}`}>{LEGAL_CONTACTS.privacy}</a>.
        </li>
        <li>
          <strong>Public entities.</strong> Where a public Educational Customer is prohibited by law
          from agreeing to a term in these Terms (for example, indemnification, governing law or
          venue), that term applies only to the extent permitted by the law that applies to it.
        </li>
      </ul>

      <h2>10. Service availability</h2>
      <p>
        We work to keep the Service available at all times, and announce planned maintenance in
        advance where practical. Specific uptime commitments and service credits apply only if they
        are included in a written Enterprise agreement.
      </p>

      <h2>11. Confidentiality and security</h2>
      <p>
        Each party will protect the other&apos;s non-public information with reasonable care and use
        it only for the purposes of these Terms. We maintain administrative, technical and physical
        safeguards for Customer Data as described in the Privacy Policy and the Data Processing
        Addendum.
      </p>

      <h2>12. Warranty disclaimer</h2>
      <p>
        Except as expressly stated in these Terms or a signed agreement, the Service is provided
        &quot;as is&quot; and &quot;as available.&quot; To the fullest extent permitted by law, we
        disclaim all implied warranties, including merchantability, fitness for a particular purpose
        and non-infringement.
      </p>

      <h2>13. Limitation of liability</h2>
      <p>
        To the maximum extent permitted by law, neither party&apos;s total liability arising out of or
        relating to these Terms will exceed the fees paid or payable by the Customer for the Service in
        the twelve (12) months before the event giving rise to the claim, and neither party is liable
        for indirect, incidental, special, consequential or punitive damages, or for lost profits,
        revenue or data. These limits do not apply to the Customer&apos;s obligation to pay fees, to a
        party&apos;s indemnification obligations, or to liability that cannot be limited by law.
      </p>

      <h2>14. Indemnification</h2>
      <p>
        Each party will defend the other against third-party claims to the extent caused by its breach
        of these Terms or, for us, a claim that the Service infringes a third party&apos;s
        intellectual-property rights, and, for the Customer, a claim arising from Customer Content —
        provided the defended party gives prompt notice and reasonable cooperation. This section is
        subject to section 9 for public Educational Customers.
      </p>

      <h2>15. Governing law and disputes</h2>
      <p>
        These Terms are governed by the laws of the state in which the Customer is located, without
        regard to conflict-of-law principles, unless a signed agreement says otherwise. The parties will
        first try to resolve any dispute through good-faith negotiation.
      </p>

      <h2>16. General</h2>
      <ul>
        <li>We may update these Terms. We will post material changes here and email the Customer&apos;s administrators at least 30 days before they take effect.</li>
        <li>Neither party may assign these Terms without the other&apos;s consent, except to a successor in a merger or sale of substantially all of its business.</li>
        <li>Neither party is liable for delays caused by events beyond its reasonable control.</li>
        <li>If a provision is unenforceable, the rest of these Terms stays in effect.</li>
      </ul>

      <h2>17. Contact and notices</h2>
      <p>
        {companyLegalName}
        <br />
        {mailingAddress}
      </p>
      <ul>
        <li>Legal notices: <a href={`mailto:${LEGAL_CONTACTS.legal}`}>{LEGAL_CONTACTS.legal}</a> and by mail to the address above</li>
        <li>Privacy and data requests: <a href={`mailto:${LEGAL_CONTACTS.privacy}`}>{LEGAL_CONTACTS.privacy}</a></li>
        <li>Security reports: <a href={`mailto:${LEGAL_CONTACTS.security}`}>{LEGAL_CONTACTS.security}</a></li>
        <li>Billing and general help: <a href={`mailto:${LEGAL_CONTACTS.support}`}>{LEGAL_CONTACTS.support}</a></li>
      </ul>
    </LegalPage>
  );
}
