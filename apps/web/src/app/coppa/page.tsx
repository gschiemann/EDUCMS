import { LegalPage } from '@/components/marketing/LegalPage';

export const metadata = { title: 'COPPA statement — EduSignage' };

export default function CoppaPage() {
  return (
    <LegalPage
      title="COPPA statement"
      subtitle="How EduSignage complies with the Children's Online Privacy Protection Act."
      updated="April 16, 2026"
    >
      <h2>Our product is designed for schools, not children</h2>
      <p>
        EduSignage is a business-to-business (B2B) service sold to K-12 school districts. We are not
        directed to children, and we do not knowingly collect personal information directly from
        children under 13. Administrative users — teachers, principals, district IT staff — are always
        adults.
      </p>

      <h2>School-authorized consent</h2>
      <p>
        Under the Children&apos;s Online Privacy Protection Act (COPPA), a school can provide consent on
        behalf of parents for the collection of personal information from children under 13, but only for
        the use and benefit of the school and for no other commercial purpose. Where your district uses
        EduSignage features that touch information about students under 13, we rely on this
        school-authorized consent, consistent with FTC guidance.
      </p>
      <p>As a condition of the service, your district represents that:</p>
      <ul>
        <li>It has the authority to provide consent for its students in lieu of parental consent, as permitted under COPPA.</li>
        <li>It has posted appropriate notices to parents describing how student data is used.</li>
        <li>It provides parents with a mechanism to review or request deletion of their child&apos;s information.</li>
      </ul>

      <h2>What we collect</h2>
      <p>
        EduSignage&apos;s core product does not collect personal information from students under 13. If
        your district enables optional features (for example, a student-portal kiosk or an interactive
        classroom display that shows individual student names), we process only the minimum information
        necessary to deliver that feature and only as instructed by your district.
      </p>

      <h2>What we never do</h2>
      <ul>
        <li>We do not require or collect more information from a child than is reasonably necessary to participate in an activity.</li>
        <li>We do not use children&apos;s personal information for behavioral advertising.</li>
        <li>We do not sell or rent children&apos;s personal information.</li>
        <li>We do not use children&apos;s personal information to train AI models.</li>
      </ul>

      <h2>Parental rights</h2>
      <p>
        Parents have the right to review the personal information we have about their child, refuse
        further collection or use, and request deletion. Because we act on behalf of the school, these
        requests are normally routed through your district&apos;s records office. Parents who have been
        directed to contact us can email{' '}
        <a href="mailto:coppa@edusignage.app">coppa@edusignage.app</a> and we will coordinate with the
        district.
      </p>

      <h2>Data retention and deletion</h2>
      <p>
        We retain student information only as long as needed to provide the service or as otherwise
        required by law. On termination of a district&apos;s subscription, we delete student information
        within 90 days of the grace period ending, unless retention is required for legal or safety
        reasons (for example, audit logs of emergency events).
      </p>

      <h2>Security</h2>
      <p>
        See the security section of our <a href="/privacy">privacy policy</a> for full details. In short:
        TLS 1.2+ in transit, AES-256 at rest, role-based access control, Argon2id password hashing,
        signed emergency broadcasts, and immutable audit logs.
      </p>

      <h2>Contact</h2>
      <p>
        For COPPA-related questions, contact{' '}
        <a href="mailto:coppa@edusignage.app">coppa@edusignage.app</a>.
      </p>
    </LegalPage>
  );
}
