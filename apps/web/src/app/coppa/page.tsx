import Link from 'next/link';
import { LegalPage } from '@/components/marketing/LegalPage';
import { LEGAL_CONTACTS, LEGAL_ENTITY, LEGAL_LAST_UPDATED } from '@/lib/legal-entity';

export const metadata = { title: 'COPPA statement — VenueOS' };

/** School-customer statement (2026-10-11). Needs attorney review before launch. */
export default function CoppaPage() {
  const { productName } = LEGAL_ENTITY;
  return (
    <LegalPage
      title="COPPA statement"
      subtitle="How VenueOS handles information about children under 13."
      updated={LEGAL_LAST_UPDATED}
    >
      <h2>A service for organizations, not children</h2>
      <p>
        {productName} is a business-to-business service sold to organizations — schools and
        districts, sports venues, businesses and others. It is not directed to children, and we do not
        knowingly collect personal information directly from children under 13. The people who sign
        in to {productName} are adults authorized by the customer.
      </p>

      <h2>School-authorized consent</h2>
      <p>
        This section applies when the customer is a school or district. Under the Children&apos;s
        Online Privacy Protection Act (COPPA), a school may consent on behalf of parents to the
        collection of personal information from students under 13, but only for the use and benefit of
        the school and for no other commercial purpose. Where a school uses {productName} features that
        involve information about students under 13, we rely on that school-authorized consent,
        consistent with FTC guidance. As a condition of using those features, the school represents
        that:
      </p>
      <ul>
        <li>It has the authority to provide consent for its students in place of parental consent, as COPPA permits.</li>
        <li>It has given parents appropriate notice of how student information is used.</li>
        <li>It provides parents a way to review or request deletion of their child&apos;s information.</li>
      </ul>

      <h2>What we collect</h2>
      <p>
        The core product does not collect personal information from students. If a school enables
        features that show student information — for example athlete names on a sports scoreboard —
        we process only what the school provides and only to deliver that feature. Student names and
        photos stay hidden on public sports screens until a school administrator confirms its
        directory-information and photo-release policies, and a family&apos;s opt-out always hides
        that student. Customers that are not schools but whose content involves minors (for example a
        youth sports venue) can mark that their athletes include minors.
      </p>

      <h2>What we never do</h2>
      <ul>
        <li>Collect more information about a child than is reasonably necessary for the feature the school uses.</li>
        <li>Use children&apos;s personal information for behavioral or targeted advertising.</li>
        <li>Sell or rent children&apos;s personal information.</li>
        <li>Use children&apos;s personal information to train artificial-intelligence models.</li>
      </ul>

      <h2>Parental rights</h2>
      <p>
        Parents may review the personal information about their child, refuse further collection or
        use, and request deletion. Because we act on behalf of the school, these requests normally go
        through the school or district. Parents who have been directed to contact us can email{' '}
        <a href={`mailto:${LEGAL_CONTACTS.privacy}`}>{LEGAL_CONTACTS.privacy}</a> and we will coordinate
        with the school.
      </p>

      <h2>Retention and deletion</h2>
      <p>
        We keep student information only as long as needed to provide the service. A school can remove
        student information from {productName} at any time. When a school&apos;s subscription ends,
        student information is deleted with the rest of its data as described in our{' '}
        <Link href="/dpa">Data Processing Addendum</Link>; encrypted backup copies expire within 30
        days.
      </p>

      <h2>Security</h2>
      <p>
        See the security section of our <Link href="/privacy">Privacy Policy</Link>: encryption in
        transit and at rest, role-based access control, multi-factor sign-in for administrators,
        signed emergency alerts and immutable audit records.
      </p>

      <h2>Contact</h2>
      <p>
        COPPA questions:{' '}
        <a href={`mailto:${LEGAL_CONTACTS.privacy}`}>{LEGAL_CONTACTS.privacy}</a>.
      </p>
    </LegalPage>
  );
}
