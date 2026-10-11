import Link from 'next/link';
import { LegalPage } from '@/components/marketing/LegalPage';
import { LEGAL_CONTACTS, LEGAL_ENTITY, LEGAL_LAST_UPDATED } from '@/lib/legal-entity';

export const metadata = { title: 'FERPA statement — VenueOS' };

/** School-customer statement (2026-10-11). Needs attorney review before launch. */
export default function FerpaPage() {
  const { productName } = LEGAL_ENTITY;
  return (
    <LegalPage
      title="FERPA statement"
      subtitle="How VenueOS handles education records for school and district customers."
      updated={LEGAL_LAST_UPDATED}
    >
      <p>
        This statement applies when a school district, school or other educational institution uses{' '}
        {productName}. It supplements our <Link href="/privacy">Privacy Policy</Link> and section 10 of
        our <Link href="/dpa">Data Processing Addendum</Link>.
      </p>

      <h2>Our role as a &quot;school official&quot;</h2>
      <p>
        The Family Educational Rights and Privacy Act (FERPA) generally prohibits schools from
        disclosing personally identifiable information (PII) from a student&apos;s education records
        without written consent. It allows disclosure to &quot;school officials&quot; with
        &quot;legitimate educational interests,&quot; including outside service providers under the
        conditions of 34 CFR &sect; 99.31(a)(1)(i)(B). When a school uses {productName}, we act as a
        school official because:
      </p>
      <ul>
        <li>We perform a service for which the school would otherwise use its own employees.</li>
        <li>We are under the direct control of the school with respect to the use and maintenance of education records.</li>
        <li>We use education records only for the purposes of the service and do not re-disclose them except as the school directs or the law requires.</li>
      </ul>

      <h2>What we do (and don&apos;t) collect</h2>
      <p>
        {productName} does not require student records to operate. Most signage content —
        announcements, menus, bell schedules, event promotions — contains no student PII. Some optional
        features can show student information, for example athlete names and photos on a sports
        scoreboard. When a school uses those features, we process that information solely to provide
        them.
      </p>
      <p>We do <strong>not</strong>:</p>
      <ul>
        <li>Sell or license student PII.</li>
        <li>Use student PII for targeted advertising or to build profiles of students for any non-educational purpose.</li>
        <li>Use student PII to train artificial-intelligence models.</li>
        <li>Keep student PII longer than needed to provide the service.</li>
      </ul>

      <h2>Directory information — hidden by default</h2>
      <p>
        A school may designate certain items, such as a student&apos;s name and participation in
        officially recognized sports, as &quot;directory information&quot; that can be shown publicly.
        {' '}{productName} treats student names and photos on public sports screens as{' '}
        <strong>hidden by default</strong>:
      </p>
      <ul>
        <li>Names are shown only after a school or district administrator confirms that the annual FERPA notice designates them as directory information and that family opt-outs are recorded.</li>
        <li>Photos are shown only for students marked as having a signed photo or media release, after an administrator confirms that policy.</li>
        <li>A family&apos;s directory-information opt-out always hides that student.</li>
      </ul>
      <p>
        The school is responsible for the accuracy of these confirmations and for honoring opt-outs
        for any other student information it chooses to display.
      </p>

      <h2>Parental rights</h2>
      <p>
        Under FERPA, parents (and eligible students age 18 or older) have the right to inspect and
        review education records, to request correction of inaccurate records, and to consent to
        disclosures except where FERPA allows disclosure without consent. Because we act on behalf of
        the school, these requests go to the school or district first. If you are a parent and have
        been directed to contact us, email{' '}
        <a href={`mailto:${LEGAL_CONTACTS.privacy}`}>{LEGAL_CONTACTS.privacy}</a> and we will coordinate
        with the school.
      </p>

      <h2>Data security controls</h2>
      <ul>
        <li>Encryption in transit and at rest.</li>
        <li>Role-based access: only users the school authorizes can see its data.</li>
        <li>Multi-factor sign-in for administrators.</li>
        <li>Immutable audit records of privileged actions.</li>
        <li>Access by our personnel to a school&apos;s organization requires approval by the school&apos;s administrators, except time-limited emergency access that is recorded and notified to them immediately.</li>
      </ul>

      <h2>Incident response</h2>
      <p>
        If a security incident affects education records, we will notify the school&apos;s
        administrators without undue delay, and in any event within 72 hours of becoming aware of it,
        as described in our Data Processing Addendum and consistent with applicable law.
      </p>

      <h2>Contact</h2>
      <p>
        FERPA questions, or a request for a signed data processing or state student-privacy
        agreement:{' '}
        <a href={`mailto:${LEGAL_CONTACTS.privacy}`}>{LEGAL_CONTACTS.privacy}</a>.
      </p>
    </LegalPage>
  );
}
