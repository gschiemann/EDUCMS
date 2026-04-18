import { LegalPage } from '@/components/marketing/LegalPage';

export const metadata = { title: 'Privacy policy — EduSignage' };

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy policy"
      subtitle="How EduSignage collects, uses, and protects your data."
      updated="April 16, 2026"
    >
      <p>
        EduSignage (&quot;<strong>we</strong>&quot;, &quot;<strong>us</strong>&quot;) provides digital signage
        and emergency alerting software to K-12 school districts. This policy explains what information we
        collect from staff users and connected devices, how we use it, and your choices. By using
        EduSignage, you agree to the practices described here.
      </p>

      <h2>1. Information we collect</h2>
      <h3>Account information</h3>
      <ul>
        <li>Your name, email address, and the school or district you are affiliated with.</li>
        <li>Authentication data (hashed password, or identifier tokens issued by your SSO provider).</li>
        <li>Role and permissions assigned to you within your organization&apos;s EduSignage tenant.</li>
      </ul>
      <h3>Content you upload</h3>
      <ul>
        <li>Signage assets (images, videos, documents) and templates you create.</li>
        <li>Playlists, schedules, and screen-group configurations.</li>
      </ul>
      <h3>Device and usage information</h3>
      <ul>
        <li>IP address, browser, operating system, and device model of administrative users and paired display devices.</li>
        <li>Display device metadata (resolution, last-seen timestamp, pairing code).</li>
        <li>Audit logs: who triggered emergencies, who changed schedules, and similar privileged actions.</li>
      </ul>

      <h2>2. Student data</h2>
      <p>
        EduSignage is designed so that we rarely need to process personally identifiable information (PII)
        about students. Our standard product does not ingest student records. If your district enables
        optional features (for example, an attendance ticker or a classroom portal) that display or
        reference student PII, that data is processed under a separate data processing agreement and in
        accordance with FERPA and COPPA. See our <a href="/ferpa">FERPA statement</a> and{' '}
        <a href="/coppa">COPPA statement</a>.
      </p>

      <h2>3. How we use information</h2>
      <ul>
        <li>To operate EduSignage and deliver the signage and alerting services you and your district request.</li>
        <li>To authenticate users and enforce role-based access controls.</li>
        <li>To produce audit logs that your district can review for compliance and safety investigations.</li>
        <li>To diagnose and fix service issues.</li>
        <li>To comply with legal obligations, valid legal process, or to protect users&apos; safety.</li>
      </ul>
      <p>
        We do <strong>not</strong> use customer content to train AI models, and we do not sell personal
        information to third parties.
      </p>

      <h2>4. Sharing and sub-processors</h2>
      <p>We use a small number of vetted sub-processors to run EduSignage:</p>
      <ul>
        <li><strong>Supabase</strong> — managed PostgreSQL database and object storage.</li>
        <li><strong>Railway / Vercel</strong> — hosting for our backend API and web dashboard.</li>
        <li><strong>Sentry</strong> — error monitoring (stack traces, scrubbed of PII).</li>
        <li><strong>Redis Labs / Upstash</strong> — real-time pub/sub for screen updates.</li>
        <li><strong>Clever</strong>, <strong>Google</strong>, <strong>Microsoft</strong> — optional SSO and rostering integrations, activated only when your district connects them.</li>
      </ul>
      <p>
        Each sub-processor is contractually bound to protect customer data and to use it only to provide
        the services we request. A current list is available on request.
      </p>

      <h2>5. Data retention</h2>
      <ul>
        <li><strong>Active accounts</strong>: we retain your data for as long as your district&apos;s subscription is active.</li>
        <li><strong>Audit logs</strong>: retained for a minimum of three years for safety and compliance review. Logs are immutable — we cannot delete or alter individual entries.</li>
        <li><strong>Cancelled accounts</strong>: after cancellation, a 90-day grace period applies during which you can export data. After that, we purge customer content within 30 days, except for audit logs retained as noted above.</li>
        <li><strong>Backups</strong>: encrypted database backups are retained for 30 days on a rolling basis.</li>
      </ul>

      <h2>6. Security</h2>
      <ul>
        <li>All traffic to EduSignage is encrypted in transit via TLS 1.2+.</li>
        <li>Passwords are hashed with Argon2id; we never store plaintext.</li>
        <li>Emergency broadcast messages are cryptographically signed and verified on the receiving device.</li>
        <li>Role-based access control is enforced on every API endpoint.</li>
        <li>We conduct code reviews, run automated security scans, and maintain a responsible disclosure program.</li>
      </ul>

      <h2>7. Your choices and rights</h2>
      <p>
        Depending on where you reside, you may have rights to access, correct, delete, or export your
        personal information. To exercise these rights, contact us at{' '}
        <a href="mailto:privacy@edusignage.app">privacy@edusignage.app</a>. We will respond within 30 days.
      </p>
      <p>
        For school accounts, your district administrator is the primary contact for your data. We will
        typically direct rights requests through them.
      </p>

      <h2>8. Children under 13</h2>
      <p>
        EduSignage is a business-to-business product contracted by schools and districts. We do not
        knowingly collect personal information directly from children under 13. See our{' '}
        <a href="/coppa">COPPA statement</a> for details on how we handle any child-directed data.
      </p>

      <h2>9. International users</h2>
      <p>
        EduSignage is hosted in the United States. If you access the service from outside the US, you
        consent to the transfer of your information to the US. Districts with additional regulatory
        requirements (for example, under state data privacy laws such as CSDPA, SOPIPA, or SHIELD) should
        contact us to put an appropriate data processing addendum in place.
      </p>

      <h2>10. Changes to this policy</h2>
      <p>
        We may update this policy from time to time. Material changes will be posted here and
        communicated by email to district administrators at least 30 days before taking effect.
      </p>

      <h2>11. Contact</h2>
      <p>
        For privacy questions, contact{' '}
        <a href="mailto:privacy@edusignage.app">privacy@edusignage.app</a>. For data access requests,
        email{' '}
        <a href="mailto:dsr@edusignage.app">dsr@edusignage.app</a>.
      </p>
    </LegalPage>
  );
}
