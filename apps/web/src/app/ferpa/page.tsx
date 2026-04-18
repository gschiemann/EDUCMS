import { LegalPage } from '@/components/marketing/LegalPage';

export const metadata = { title: 'FERPA statement — EduSignage' };

export default function FerpaPage() {
  return (
    <LegalPage
      title="FERPA statement"
      subtitle="How EduSignage complies with the Family Educational Rights and Privacy Act."
      updated="April 16, 2026"
    >
      <h2>Our role as a &quot;school official&quot;</h2>
      <p>
        The Family Educational Rights and Privacy Act (FERPA) generally prohibits schools from disclosing
        personally identifiable information (PII) from a student&apos;s education record without written
        parental consent. FERPA allows disclosure to &quot;school officials&quot; with &quot;legitimate
        educational interests,&quot; including outside service providers under the conditions of 34 CFR
        &sect; 99.31(a)(1)(i)(B).
      </p>
      <p>When your school or district uses EduSignage, we act as a school official because:</p>
      <ul>
        <li>We perform a service for which the school would otherwise use its own employees.</li>
        <li>We operate under the direct control of the school with respect to the use and maintenance of education records.</li>
        <li>We use education records only for authorized purposes and do not redisclose them to third parties.</li>
      </ul>

      <h2>What we do (and don&apos;t) collect</h2>
      <p>
        EduSignage is designed to minimize contact with student records. The core product operates on
        signage content (announcements, menus, bell schedules) that does not typically include student
        PII. When your district enables optional features that could include student PII (for example, a
        classroom directory on a touchscreen display), we process that data solely to provide the
        requested service.
      </p>
      <p>We do <strong>not</strong>:</p>
      <ul>
        <li>Sell or license student PII.</li>
        <li>Use student PII to build behavioral profiles or market to students.</li>
        <li>Use student PII to train machine-learning models.</li>
        <li>Retain student PII beyond what is necessary to deliver the service.</li>
      </ul>

      <h2>Directory information</h2>
      <p>
        Your school may have designated certain items as &quot;directory information&quot; that can be
        publicly displayed (for example, student name on an honor-roll board). Your district is
        responsible for ensuring parental opt-out procedures have been honored before any student name or
        photograph is uploaded to EduSignage for public display.
      </p>

      <h2>Parental rights</h2>
      <p>
        Under FERPA, parents (and eligible students age 18+) have the right to:
      </p>
      <ul>
        <li>Inspect and review education records.</li>
        <li>Request correction of inaccurate records.</li>
        <li>Consent to disclosure of personally identifiable information, except where FERPA allows disclosure without consent.</li>
      </ul>
      <p>
        Because we operate on behalf of your school, requests from parents should go through your
        district&apos;s records office in the first instance. If you are a parent and have been directed
        to contact us, email{' '}
        <a href="mailto:ferpa@edusignage.app">ferpa@edusignage.app</a> and we will coordinate with your
        district.
      </p>

      <h2>Data security controls</h2>
      <ul>
        <li>Encryption in transit (TLS 1.2+) and at rest (AES-256).</li>
        <li>Role-based access: only users your district authorizes can see data.</li>
        <li>Immutable audit logs for all privileged actions.</li>
        <li>Regular third-party vulnerability scans.</li>
        <li>Employee access to production data is limited to what is necessary for support and is logged.</li>
      </ul>

      <h2>Incident response</h2>
      <p>
        In the unlikely event of a security incident affecting education records, we will notify the
        affected district&apos;s primary contact without unreasonable delay and no later than 72 hours
        after discovery, consistent with applicable law and our data processing agreement.
      </p>

      <h2>Contact</h2>
      <p>
        For FERPA-related questions, contact{' '}
        <a href="mailto:ferpa@edusignage.app">ferpa@edusignage.app</a>. Districts requiring a signed data
        processing agreement or data sharing addendum can request one at{' '}
        <a href="mailto:contracts@edusignage.app">contracts@edusignage.app</a>.
      </p>
    </LegalPage>
  );
}
