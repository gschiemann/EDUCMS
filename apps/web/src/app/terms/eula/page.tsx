"use client";

/**
 * End User License Agreement.
 *
 * Linked from the sign-in acceptance box and from /terms. Covers the license
 * to the software itself (dashboard, screen player apps); the Terms of Service
 * are the main agreement.
 *
 * 2026-10-11 — rewritten on the owner's instruction to match the new Terms of
 * Service (docs/research/2026-10-11-greg-decisions/02-legal-api-docs.md §4,
 * "Governing law conflict"):
 *   - governing law + courts = GOVERNING_STATE from `@/lib/legal-entity`, the
 *     SAME constant the Terms use, with the same public-entity exception;
 *   - NO arbitration and NO class-action waiver (the old Delaware/AAA clause
 *     is gone);
 *   - the liability cap is the Terms' cap (fees paid or payable in the prior
 *     twelve months), not a different number;
 *   - order of precedence: Order Form / Enterprise agreement > DPA > Terms >
 *     this EULA.
 * The emergency-features disclaimer (section 5) is load-bearing — do not
 * soften or remove it without counsel's approval. No certifications are
 * claimed and no warranty beyond the Terms is given. Needs attorney review
 * before launch.
 *
 * EULA_VERSION (`@/lib/eula-acceptance`) was deliberately NOT bumped by this
 * rewrite; bumping it makes every signed-in user re-accept on next sign-in.
 */

import Link from 'next/link';
import { EULA_VERSION } from '@/lib/eula-acceptance';
import {
  GOVERNING_STATE,
  LEGAL_CONTACTS,
  LEGAL_ENTITY,
  LEGAL_LAST_UPDATED,
} from '@/lib/legal-entity';

export default function EulaPage() {
  return (
    <main className="max-w-3xl mx-auto px-6 py-16 text-slate-900 font-sans">
      <nav className="mb-8 text-sm">
        <Link href="/" className="text-indigo-600 hover:text-indigo-800">← Back</Link>
      </nav>
      <h1 className="text-3xl font-bold mb-2">End User License Agreement</h1>
      <p className="text-sm text-slate-500 mb-4">
        Last updated: {LEGAL_LAST_UPDATED} · Version {EULA_VERSION}
      </p>
      <div className="mb-8 rounded-lg bg-amber-50 border border-amber-200 p-4 text-sm text-amber-900">
        This document is boilerplate drafted for {LEGAL_ENTITY.productName} and is{' '}
        <strong>not legal advice</strong>. Please have your own organization&apos;s legal counsel
        review it before relying on it.
      </div>

      <EulaBody />

      <p className="mt-10 text-xs text-slate-500 border-t border-slate-200 pt-6">
        Questions about this EULA? Contact{' '}
        <a href={`mailto:${LEGAL_CONTACTS.legal}`} className="text-indigo-600">{LEGAL_CONTACTS.legal}</a>.
      </p>
    </main>
  );
}

/**
 * EULA body — kept as a named export so any sign-in surface that shows the
 * agreement inline renders exactly the same text as /terms/eula.
 */
export function EulaBody() {
  const { companyLegalName, mailingAddress, productName } = LEGAL_ENTITY;
  return (
    <article className="prose prose-slate prose-sm max-w-none leading-relaxed">
      <p className="text-sm uppercase tracking-wider font-bold text-red-600 mb-4">
        Please read carefully. By checking the acceptance box on sign-in you agree to this
        Agreement.
      </p>

      <h2 className="text-xl font-bold mt-8 mb-3">1. About this Agreement</h2>
      <p>
        This End User License Agreement (&quot;<strong>Agreement</strong>&quot;) is between{' '}
        {companyLegalName} (&quot;<strong>{productName}</strong>&quot;, &quot;<strong>we</strong>
        &quot;, &quot;<strong>us</strong>&quot;) and the organization whose account you sign in to
        (the &quot;<strong>Customer</strong>&quot;). You accept it on the Customer&apos;s behalf
        and for your own use of the software. It covers the license to the software. The rest of the
        relationship — fees, data, confidentiality, support and the like — is governed by our{' '}
        <Link href="/terms">Terms of Service</Link> (the &quot;<strong>Terms</strong>&quot;), our{' '}
        <Link href="/privacy">Privacy Policy</Link> and our{' '}
        <Link href="/dpa">Data Processing Addendum</Link> (&quot;<strong>DPA</strong>&quot;).
        Words defined in the Terms have the same meaning here.
      </p>
      <ul className="list-disc pl-6 space-y-1">
        <li>
          &quot;<strong>Software</strong>&quot; means the {productName} web dashboard, the screen
          player applications (including the Android player app and the web player) and any
          updates, documentation and files we provide with them.
        </li>
        <li>
          &quot;<strong>Emergency Features</strong>&quot; means any part of the Software used to
          trigger, display, relay or clear emergency, safety, lockdown, shelter, evacuation, medical
          or other life-safety messages.
        </li>
      </ul>

      <h2 className="text-xl font-bold mt-8 mb-3">2. License</h2>
      <p>
        While the Customer has an active subscription, and subject to this Agreement and the Terms,
        we grant the Customer a limited, non-exclusive, non-transferable, non-sublicensable license
        to:
      </p>
      <ul className="list-disc pl-6 space-y-1">
        <li>use the web dashboard through its Authorized Users; and</li>
        <li>
          install and run the screen player applications on displays, media players and other
          devices the Customer owns or controls, only to show the Customer&apos;s content through
          the Service.
        </li>
      </ul>
      <p>
        The Software is licensed, not sold. We and our licensors keep all rights not expressly
        granted.
      </p>

      <h2 className="text-xl font-bold mt-8 mb-3">3. Restrictions</h2>
      <p>The Customer and its Authorized Users will not:</p>
      <ul className="list-disc pl-6 space-y-1">
        <li>Reverse engineer, decompile or disassemble the Software, or try to derive its source code, except where the law allows it despite this restriction;</li>
        <li>Copy, modify or create derivative works of the Software, other than installing the player applications as allowed above;</li>
        <li>Sell, rent, lend, sublicense or redistribute the Software, or use it to provide a service to third parties, without a written reseller agreement with us;</li>
        <li>Remove or change any copyright, trademark or license notice in the Software;</li>
        <li>Bypass or disable any security, licensing or emergency safeguard in the Software; or</li>
        <li>Use the Software in breach of the acceptable-use rules in section 5 of the Terms.</li>
      </ul>

      <h2 className="text-xl font-bold mt-8 mb-3">4. Updates</h2>
      <p>
        We may release updates to the Software that fix problems, improve security or add features.
        The web dashboard and the web player are delivered as part of the hosted Service and are
        updated by us. The Customer controls automatic updates of the installed player app: updates
        install automatically only where the Customer has turned automatic updates on for its
        account or for a screen; otherwise the Customer chooses when to install them. Some features,
        including security fixes, may require a current version. This Agreement applies to every
        update unless an update comes with its own terms.
      </p>

      <h2 className="text-xl font-bold mt-8 mb-3">5. Open-source components</h2>
      <p>
        The Software includes open-source components, each licensed under its own license. Those
        licenses govern those components, and nothing in this Agreement limits the rights they
        grant. A list of the components and their licenses is available on request from{' '}
        <a href={`mailto:${LEGAL_CONTACTS.legal}`}>{LEGAL_CONTACTS.legal}</a>.
      </p>

      <h2 className="text-xl font-bold mt-8 mb-3">6. Export and sanctions</h2>
      <p>
        The Customer will comply with all applicable export-control and sanctions laws, including
        those of the United States. The Customer will not use, export or allow access to the Software
        in a country or region subject to comprehensive U.S. sanctions, or by a person on a U.S.
        government restricted-party list.
      </p>

      <h2 className="text-xl font-bold mt-8 mb-3 text-red-700">7. Emergency features — important</h2>
      <p className="font-semibold">
        The Emergency Features are designed to be dependable, but they are not a substitute for,
        and must not be relied on in place of:
      </p>
      <ul className="list-disc pl-6 space-y-1 font-semibold">
        <li>Fire alarm systems, smoke detectors or sprinkler systems;</li>
        <li>Building-wide public address (PA), intercom or siren systems;</li>
        <li>Calling 911 or your local emergency services;</li>
        <li>Certified mass-notification systems (for example, those complying with NFPA 72, UL 2572 or similar standards);</li>
        <li>IPAWS, CAP, Wireless Emergency Alerts (WEA), the Emergency Alert System (EAS) or any other government-authorized public alerting channel;</li>
        <li>Trained responders, security staff, school resource officers or emergency medical personnel; or</li>
        <li>Any life-safety, medical, weapon-detection, threat-detection or surveillance system that requires regulatory certification.</li>
      </ul>
      <p className="mt-4">
        The Emergency Features depend on internet connectivity, power, cloud infrastructure, web
        browsers, operating systems and display hardware, some of which are outside our control and
        may fail, slow down or be unavailable without warning. We do not represent that an emergency
        message will reach any particular screen, device, person or agency, or reach it within any
        particular time. The Customer is responsible for its own emergency plans, training, drills,
        configuration (including who may trigger alerts and which screens receive them), checking
        that alerts display on its screens, and keeping independent, properly certified emergency
        systems and communication channels as its laws, policies, insurers and fire codes require.
      </p>

      <h2 className="text-xl font-bold mt-8 mb-3">8. Warranty disclaimer</h2>
      <p>
        Except as expressly stated in the Terms or a signed agreement, the Software is provided
        &quot;as is&quot; and &quot;as available.&quot; To the fullest extent permitted by law, we
        disclaim all implied warranties, including merchantability, fitness for a particular purpose
        and non-infringement. This Agreement gives no warranty beyond those in the Terms.
      </p>

      <h2 className="text-xl font-bold mt-8 mb-3">9. Limitation of liability</h2>
      <p>
        The limitation of liability in section 13 of the Terms applies to this Agreement and the
        Software, and the two documents share one cap — they do not add together. In summary: to the
        maximum extent permitted by law, neither party&apos;s total liability arising out of or
        relating to the Terms and this Agreement will exceed the fees paid or payable by the Customer
        for the Service in the twelve (12) months before the event giving rise to the claim, and
        neither party is liable for indirect, incidental, special, consequential or punitive damages,
        or for lost profits, revenue or data. To the extent permitted by law, this includes damages
        arising from the failure, delay or misdelivery of an emergency message, a false or accidental
        alert, or a screen that does not display content as intended. These limits do not apply to
        the Customer&apos;s obligation to pay fees, to a party&apos;s indemnification obligations, or
        to liability that cannot be limited by law.
      </p>

      <h2 className="text-xl font-bold mt-8 mb-3">10. Indemnification</h2>
      <p>
        Each party&apos;s indemnification obligations are those in section 14 of the Terms. This
        Agreement adds none.
      </p>

      <h2 className="text-xl font-bold mt-8 mb-3">11. Term and termination</h2>
      <p>
        This Agreement lasts as long as the Customer&apos;s subscription. It ends automatically when
        the subscription ends or the Terms are terminated, and we may suspend the license whenever
        we may suspend access under the Terms. When it ends, the Customer must stop using the
        Software and uninstall the player applications from its devices. Data export after
        termination is covered by section 8 of the Terms. Sections 3, 5 through 10 and 12 through 14
        survive termination.
      </p>

      <h2 className="text-xl font-bold mt-8 mb-3">12. Order of precedence</h2>
      <p>
        If documents conflict, they apply in this order: (1) a signed order form or Enterprise
        agreement; (2) the DPA, for the processing of personal data; (3) the Terms; (4) this
        Agreement. This Agreement controls only on the license to the Software.
      </p>

      <h2 className="text-xl font-bold mt-8 mb-3">13. Governing law, disputes and public entities</h2>
      <p>
        This Agreement is governed by the laws of the State of {GOVERNING_STATE}, without regard to
        its conflict-of-law rules, unless a signed agreement says otherwise. Before starting a
        lawsuit, a party will give the other written notice of the dispute, and both will try in good
        faith to resolve it for at least 30 days. A dispute that is not resolved will be heard by the
        state or federal courts located in {GOVERNING_STATE}, and each party agrees to their
        jurisdiction. Either party may ask any court for urgent relief to protect its confidential
        information or intellectual property.
      </p>
      <p>
        <strong>Public entities.</strong> Where the Customer is a public school, school district,
        public college or university, or other government entity and the law that applies to it
        requires its own state&apos;s law or courts, or does not allow it to agree to a term in this
        Agreement (for example, indemnification, limitation of liability, governing law or venue, or
        confidentiality obligations that conflict with public-records laws), that term is changed
        only to the minimum extent needed to comply with that law, and the rest of this Agreement
        stays in effect.
      </p>

      <h2 className="text-xl font-bold mt-8 mb-3">14. General</h2>
      <ul className="list-disc pl-6 space-y-1">
        <li>
          We may update this Agreement. A material change gets a new version number at the top of
          this page and is shown for acceptance at the next sign-in.
        </li>
        <li>Assignment follows the Terms: neither party may assign this Agreement without the other&apos;s consent, except to a successor in a merger or sale of substantially all of its business.</li>
        <li>If a provision is unenforceable, the rest of this Agreement stays in effect. Not enforcing a provision is not a waiver of it.</li>
        <li>
          Notices: {companyLegalName}, {mailingAddress}, and{' '}
          <a href={`mailto:${LEGAL_CONTACTS.legal}`}>{LEGAL_CONTACTS.legal}</a>.
        </li>
      </ul>

      <p className="mt-10 font-semibold text-red-800 border-2 border-red-300 p-4 rounded-lg bg-red-50">
        By checking the acceptance box on the sign-in screen, you confirm that you have read and
        agree to this End User License Agreement, including the emergency-features terms in
        section 7, the warranty disclaimer in section 8 and the limitation of liability in
        section 9.
      </p>
    </article>
  );
}
