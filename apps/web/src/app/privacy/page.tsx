import Link from 'next/link';
import { LegalPage } from '@/components/marketing/LegalPage';
import { LEGAL_CONTACTS, LEGAL_ENTITY, LEGAL_LAST_UPDATED } from '@/lib/legal-entity';

export const metadata = { title: 'Privacy policy — VenueOS' };

/**
 * Privacy policy — for every customer type (2026-10-11). Retention numbers
 * match the code: proof-of-play raw 14 days / hourly totals 400 days
 * (`analytics/proof-of-play-rollup.service.ts`), audit logs immutable
 * (DB triggers, migration 20260531000000_audit_logs_immutable), nightly
 * encrypted backups kept 30 days (`.github/workflows/db-backup.yml`).
 * Needs attorney review before launch.
 */
export default function PrivacyPage() {
  const { companyLegalName, mailingAddress, productName } = LEGAL_ENTITY;
  return (
    <LegalPage
      title="Privacy policy"
      subtitle="What VenueOS collects, why, who processes it, and how long we keep it."
      updated={LEGAL_LAST_UPDATED}
    >
      <p>
        {productName} is operated by {companyLegalName} (&quot;<strong>we</strong>&quot;,
        &quot;<strong>us</strong>&quot;). We provide software for digital signage, interactive
        displays, live scoreboards and emergency alerts to organizations of every kind — school
        districts and schools, sports venues, restaurants, stores, places of worship, gyms, healthcare
        and hospitality operators, and businesses (each a &quot;<strong>Customer</strong>&quot;). This
        policy explains what personal information we process when a Customer and its authorized users
        use {productName}, and the choices available.
      </p>
      <p>
        For information we process on behalf of a Customer, the Customer decides how it is used and
        we act as its service provider (a &quot;processor&quot;). Our{' '}
        <Link href="/dpa">Data Processing Addendum</Link> sets out those commitments.
      </p>

      <h2>1. Information we collect</h2>
      <h3>Account information</h3>
      <ul>
        <li>Name, email address, role and the organization or location an authorized user belongs to.</li>
        <li>Sign-in data: password hashes (never the password itself), passkey public keys, multi-factor settings, and sign-in identifiers from a single sign-on provider the Customer connects.</li>
        <li>Organization and location names and addresses.</li>
      </ul>
      <h3>Content</h3>
      <ul>
        <li>Images, videos, documents, templates, playlists, schedules and settings the Customer creates or uploads.</li>
        <li>Data from services the Customer connects (for example a point-of-sale menu, a calendar, a sports scoring feed or a social account), only as needed to show it on screens.</li>
      </ul>
      <h3>Screens and usage</h3>
      <ul>
        <li>Screen names, status, player version, display and device details, and the network address a screen connects from.</li>
        <li>Playback records (what played on which screen, and when) used for proof-of-play reports.</li>
        <li>Audit records of privileged actions — for example who sent or cleared an emergency alert, who changed a schedule, or which API key made a change.</li>
        <li>Diagnostic information a user chooses to include with a problem report, such as a screenshot of the page and recent error messages. Screenshots are stored privately and can only be opened through links that expire after 30 minutes.</li>
      </ul>
      <h3>Billing</h3>
      <p>
        Card payments are taken on Stripe-hosted pages. We receive the subscription status and billing
        contact details from Stripe, never full card numbers.
      </p>

      <h2>2. How we use information</h2>
      <ul>
        <li>To provide the Service: deliver content and alerts to screens, run schedules, and show reports.</li>
        <li>To authenticate users and enforce the roles and permissions the Customer sets.</li>
        <li>To keep audit records the Customer can review for safety and compliance.</li>
        <li>To send service email such as sign-in codes, invitations and notices.</li>
        <li>To secure, maintain, diagnose and improve the Service.</li>
        <li>To bill for subscriptions and to comply with law.</li>
      </ul>
      <p>
        We do <strong>not</strong> sell personal information, use Customer content for advertising,
        or use Customer content to train artificial-intelligence models.
      </p>

      <h2>3. AI features</h2>
      <p>
        When an authorized user uses an AI feature (for example generating a board design or
        describing an image), the content needed for that request is sent to the AI provider that
        processes it. When the Customer uses {productName}-provided AI, those providers are listed as
        sub-processors in our Data Processing Addendum and we do not authorize them to use Customer
        content to train their models. When the Customer connects its own AI provider key, that
        request is governed by the Customer&apos;s agreement with its provider.
      </p>

      <h2>4. Sharing and sub-processors</h2>
      <p>
        We share information only with service providers that help us run {productName}
        (&quot;sub-processors&quot;), with services the Customer chooses to connect, as the Customer
        directs, or where required by law. The current list of sub-processors, what each does and
        where it processes data is in the{' '}
        <Link href="/dpa#subprocessors">Data Processing Addendum</Link>. All customer data is stored in
        the United States.
      </p>
      <p>
        Our personnel reach a Customer&apos;s organization in the Service only with access the
        Customer&apos;s administrators approve, except for a time-limited emergency access that is
        recorded and notified to those administrators immediately. Each access, and every change made
        under it, is recorded in the Customer&apos;s audit log.
      </p>

      <h2>5. Retention</h2>
      <ul>
        <li><strong>Content and settings</strong> — kept while the Customer&apos;s account is active, or until the Customer deletes them.</li>
        <li><strong>Playback records</strong> — detailed records about 14 days; hourly totals about 13 months.</li>
        <li><strong>Audit records</strong> — kept for the life of the account and cannot be edited or deleted through the Service. They may be kept after the account ends where needed for security, safety or legal reasons.</li>
        <li><strong>Backups</strong> — nightly, encrypted, kept 30 days on a rolling basis.</li>
        <li><strong>Exports</strong> — administrators can download uploaded files and export the audit log and proof-of-play reports as CSV at any time; a complete export is provided on written request.</li>
        <li><strong>After an account ends</strong> — the Customer can export its data for at least 90 days; after that, or sooner on written request, we delete Customer data. Backup copies expire within 30 days of deletion.</li>
      </ul>

      <h2>6. Security</h2>
      <ul>
        <li>Encryption in transit (TLS) for all connections, and encryption at rest by our hosting providers.</li>
        <li>Passwords stored only as salted Argon2 hashes; passkeys, authenticator apps and emailed codes for multi-factor sign-in, which each organization can require for its administrators and for everyone permitted to send emergency alerts.</li>
        <li>Role-based access control on every API request, with organization-level data separation.</li>
        <li>Emergency alert messages are cryptographically signed before they are delivered to screens.</li>
        <li>Rate limiting on sign-in and other sensitive actions; audit records for privileged actions.</li>
      </ul>
      <p>
        Please report suspected vulnerabilities to{' '}
        <a href={`mailto:${LEGAL_CONTACTS.security}`}>{LEGAL_CONTACTS.security}</a> — see{' '}
        <Link href="/security">how to report a vulnerability</Link>.
      </p>

      <h2>7. Educational institutions and student data</h2>
      <p>
        This section applies when the Customer is a school district, school or other educational
        institution. {productName} does not require student records to operate. Where a school uses
        features that show student information — for example athlete names on a sports scoreboard —
        we process it only on the school&apos;s behalf, as a &quot;school official&quot; under FERPA,
        and never sell it, use it for targeted advertising or use it to train AI models. Student names
        and photos are hidden on public sports screens until a school administrator confirms its
        directory-information and photo-release policies, and a family&apos;s directory opt-out always
        hides that student. See our <Link href="/ferpa">FERPA statement</Link> and{' '}
        <Link href="/coppa">COPPA statement</Link>.
      </p>

      <h2>8. Your choices and rights</h2>
      <p>
        Depending on where you live, you may have rights to access, correct, delete or export your
        personal information, or to object to certain processing. Because we process most information
        on behalf of the Customer, please contact your organization&apos;s administrator first; we
        will help the Customer respond. You can also contact us at{' '}
        <a href={`mailto:${LEGAL_CONTACTS.privacy}`}>{LEGAL_CONTACTS.privacy}</a>, and we will respond
        within the time the applicable law requires.
      </p>

      <h2>9. Children</h2>
      <p>
        {productName} is a service for organizations and is not directed to children. We do not
        knowingly collect personal information directly from children under 13. See our{' '}
        <Link href="/coppa">COPPA statement</Link> for how school customers&apos; information about
        students is handled.
      </p>

      <h2>10. Location of processing</h2>
      <p>
        {productName} stores customer data in the United States. If you use the Service from outside
        the United States, your information is transferred to and processed in the United States.
        Customers with additional regulatory requirements can contact us to put an appropriate
        agreement in place.
      </p>

      <h2>11. Changes</h2>
      <p>
        We may update this policy. We will post material changes here and email the Customer&apos;s
        administrators at least 30 days before they take effect.
      </p>

      <h2>12. Contact</h2>
      <p>
        {productName}
        <br />
        {mailingAddress}
        <br />
        <a href={`mailto:${LEGAL_CONTACTS.privacy}`}>{LEGAL_CONTACTS.privacy}</a>
      </p>
    </LegalPage>
  );
}
