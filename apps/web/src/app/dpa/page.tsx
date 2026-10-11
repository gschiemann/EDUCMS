import Link from 'next/link';
import { LegalPage } from '@/components/marketing/LegalPage';
import {
  LEGAL_CONTACTS,
  LEGAL_ENTITY,
  LEGAL_LAST_UPDATED,
  SUBPROCESSORS,
} from '@/lib/legal-entity';

export const metadata = { title: 'Data processing addendum — VenueOS' };

/**
 * Data Processing Addendum (2026-10-11) — one DPA for schools AND
 * businesses. Annex B (sub-processors) renders `SUBPROCESSORS` from
 * `@/lib/legal-entity`, so the list has one source. Prerendered public page:
 * listed in `CSP_UNNONCEABLE_PREFIXES` (`lib/csp-script-policy.ts`).
 * Needs attorney review before launch.
 */
export default function DpaPage() {
  const { companyLegalName, mailingAddress, productName } = LEGAL_ENTITY;
  return (
    <LegalPage
      title="Data processing addendum"
      subtitle="How VenueOS processes personal data on behalf of its customers — schools and businesses alike."
      updated={LEGAL_LAST_UPDATED}
    >
      <p>
        This Data Processing Addendum (&quot;<strong>DPA</strong>&quot;) forms part of the{' '}
        <Link href="/terms">Terms of Service</Link> or other written agreement (the
        &quot;<strong>Agreement</strong>&quot;) between {companyLegalName} (&quot;
        <strong>{productName}</strong>&quot;, &quot;<strong>we</strong>&quot;) and the Customer. It
        applies whenever we process personal data on the Customer&apos;s behalf. Section 10 adds
        terms that apply only when the Customer is an educational institution. A Customer that needs a
        countersigned copy, or a state-specific student data privacy agreement, can request one at{' '}
        <a href={`mailto:${LEGAL_CONTACTS.privacy}`}>{LEGAL_CONTACTS.privacy}</a>.
      </p>

      <h2>1. Roles</h2>
      <p>
        The Customer is the controller (or &quot;business&quot;) of Customer Data that contains
        personal data, and {productName} is its processor (or &quot;service provider&quot;). Where the
        Customer is itself a processor for another party, we act as its sub-processor.
      </p>

      <h2>2. Instructions</h2>
      <p>
        We process Customer Data only to provide, secure and support the Service under the Agreement,
        on the Customer&apos;s documented instructions (including those given through the Service&apos;s
        settings), or where the law requires it — in which case we will tell the Customer unless the
        law forbids it. We do not sell or share Customer Data for cross-context behavioral
        advertising, do not combine it with data from other sources except as needed to provide the
        Service, and do not use it to train artificial-intelligence models. Annex A describes the
        processing.
      </p>

      <h2>3. Confidentiality and personnel</h2>
      <p>
        Personnel with access to Customer Data are bound by confidentiality obligations and receive
        access only as needed for their role. Access by our personnel to a Customer&apos;s organization
        in the Service requires approval by the Customer&apos;s administrators, except time-limited
        emergency access that is recorded and notified to those administrators immediately.
      </p>

      <h2>4. Security</h2>
      <p>
        We maintain appropriate technical and organizational measures to protect Customer Data,
        including: encryption in transit and at rest; role-based access control enforced on every
        request; separation of each Customer&apos;s data; multi-factor authentication for administrators
        and for users permitted to send emergency alerts; salted Argon2 password hashing; signed
        emergency alert messages; immutable audit records of privileged actions; nightly encrypted
        backups; and processes for reviewing changes and handling vulnerabilities. We may update these
        measures provided the overall level of protection is not reduced.
      </p>

      <h2>5. Sub-processors</h2>
      <p>
        The Customer authorizes us to use the sub-processors listed in{' '}
        <a href="#subprocessors">Annex B</a>. Each is bound by written terms that protect Customer Data
        at least as strictly as this DPA, and we remain responsible for their performance. We will
        update Annex B and notify the Customer&apos;s administrators at least 30 days before adding or
        replacing a sub-processor. The Customer may object on reasonable data-protection grounds; if we
        cannot reasonably accommodate the objection, the Customer may terminate the affected Service
        and receive a refund of prepaid fees for the remaining term.
      </p>
      <p>
        Services the Customer chooses to connect (for example its own point-of-sale system, calendar,
        streaming service, single sign-on provider or its own AI provider key) are the Customer&apos;s
        own providers, not our sub-processors.
      </p>

      <h2>6. Assistance and data-subject requests</h2>
      <p>
        Taking into account the nature of the processing, we will help the Customer respond to
        requests from individuals to access, correct, delete or export their personal data, and with
        data-protection assessments and consultations the law requires. If we receive such a request
        directly, we will refer the individual to the Customer and will not respond ourselves except as
        the Customer directs or the law requires.
      </p>

      <h2>7. Security incidents</h2>
      <p>
        We will notify the Customer without undue delay, and in any event within 72 hours, after
        becoming aware of a security incident that leads to the accidental or unlawful destruction,
        loss, alteration, unauthorized disclosure of, or access to Customer Data. The notice will
        describe what is known about the incident and the steps taken, and we will provide updates as
        more becomes known. Notice is sent to the Customer&apos;s administrators.
      </p>

      <h2>8. Return and deletion</h2>
      <p>
        During the subscription the Customer can export and delete its data through the Service. After
        the Agreement ends, the Customer may export its data for at least 90 days; after that, or
        sooner on written request, we delete Customer Data, except where the law requires us to keep
        it. Encrypted backup copies expire within 30 days. Audit records may be kept longer where
        needed for security, safety or legal reasons, and remain protected by this DPA while kept.
      </p>

      <h2>9. Audits and information</h2>
      <p>
        On written request, no more than once a year (or after a security incident), we will answer
        reasonable security questionnaires and provide information needed to demonstrate compliance
        with this DPA. Our hosting providers maintain their own independent security audits, which we
        can point the Customer to. Any other audit must be agreed in writing in advance and will be
        conducted at the Customer&apos;s cost, with reasonable notice and confidentiality.
      </p>

      <h2>10. Educational institutions</h2>
      <p>This section applies only when the Customer is a school district, school or other educational institution.</p>
      <ul>
        <li>
          <strong>School official.</strong> For personally identifiable information from education
          records, we are a &quot;school official&quot; with a legitimate educational interest under
          FERPA (34 CFR &sect; 99.31(a)(1)(i)(B)), under the Customer&apos;s direct control regarding
          its use and maintenance, and we do not re-disclose it except as the Customer directs or the
          law requires.
        </li>
        <li>
          <strong>Student data use.</strong> We use student data only to provide the Service. We do
          not sell it, use it for targeted advertising, build profiles of students except to provide
          the Service, or use it to train AI models.
        </li>
        <li>
          <strong>COPPA.</strong> Where the Customer uses the Service with information about children
          under 13, the Customer consents on behalf of parents for the use and benefit of the school
          only, and is responsible for the related notices to parents.
        </li>
        <li>
          <strong>Directory information.</strong> Student names and photos are hidden on public sports
          screens by default. They are shown only after a Customer administrator confirms that the
          Customer&apos;s directory-information notice and photo releases allow it, and never for a
          student whose family has opted out. The Customer is responsible for the accuracy of those
          confirmations.
        </li>
        <li>
          <strong>Parent requests.</strong> Requests from parents or eligible students are handled by
          the Customer; we will help as described in section 6.
        </li>
        <li>
          <strong>State laws.</strong> Where a state student-privacy law requires additional terms, we
          will work with the Customer on a state-specific agreement, which controls over this DPA where
          they conflict.
        </li>
      </ul>

      <h2>11. Location of processing</h2>
      <p>
        Customer Data is stored in the United States. Where the law that applies to the Customer
        requires a transfer mechanism for personal data leaving another country, the parties will put
        an appropriate one in place on request.
      </p>

      <h2>12. Order of precedence</h2>
      <p>
        If this DPA conflicts with the Agreement regarding the processing of personal data, this DPA
        controls. A separately signed data processing or student data privacy agreement controls over
        this DPA.
      </p>

      <h2>Annex A — Description of processing</h2>
      <ul>
        <li><strong>Subject matter and duration:</strong> providing the Service for the term of the Agreement and the export period after it.</li>
        <li><strong>Nature and purpose:</strong> hosting, storing, transmitting and displaying content on the Customer&apos;s screens; scheduling; emergency alerting; user authentication; reporting; support.</li>
        <li><strong>Data subjects:</strong> the Customer&apos;s authorized users; people who appear in content the Customer uploads; and, for educational Customers, students and staff whose information the Customer chooses to display.</li>
        <li><strong>Categories of personal data:</strong> names, email addresses, roles and sign-in data of authorized users; content the Customer uploads, which may include images of people; screen and network information; audit records.</li>
        <li><strong>Sensitive data:</strong> the Service is not designed for health, financial or other sensitive personal data, and the Customer should not upload it.</li>
      </ul>

      <h2 id="subprocessors">Annex B — Sub-processors</h2>
      <div className="not-prose overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full text-sm text-left">
          <thead className="bg-slate-50 text-slate-900">
            <tr>
              <th scope="col" className="px-3 py-2 font-semibold">Provider</th>
              <th scope="col" className="px-3 py-2 font-semibold">Purpose</th>
              <th scope="col" className="px-3 py-2 font-semibold">Location</th>
              <th scope="col" className="px-3 py-2 font-semibold">When it receives data</th>
            </tr>
          </thead>
          <tbody>
            {SUBPROCESSORS.map((s) => (
              <tr key={s.name} className="border-t border-slate-200 align-top">
                <td className="px-3 py-2 font-medium text-slate-900">{s.name}</td>
                <td className="px-3 py-2">{s.purpose}</td>
                <td className="px-3 py-2">{s.location}</td>
                <td className="px-3 py-2">{s.when}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Contact</h2>
      <p>
        {companyLegalName}
        <br />
        {mailingAddress}
        <br />
        Privacy: <a href={`mailto:${LEGAL_CONTACTS.privacy}`}>{LEGAL_CONTACTS.privacy}</a> · Security:{' '}
        <a href={`mailto:${LEGAL_CONTACTS.security}`}>{LEGAL_CONTACTS.security}</a>
      </p>
    </LegalPage>
  );
}
