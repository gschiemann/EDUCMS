"use client";

/**
 * End User License Agreement.
 *
 * Displayed on first login (see the EulaGate component below which is
 * mounted inside DashboardLayout) and linked from the /terms route for
 * re-reading.
 *
 * IMPORTANT: this document is the front-line liability firewall for
 * the emergency-alert features. Every clause that limits or disclaims
 * liability is intentional. Do NOT soften, remove, or reword without
 * explicit approval from counsel. When in doubt, err on the side of
 * MORE disclaimer, not less.
 */

import Link from 'next/link';

export default function EulaPage() {
  return (
    <main className="max-w-3xl mx-auto px-6 py-16 text-slate-900 font-sans">
      <nav className="mb-8 text-sm">
        <Link href="/" className="text-indigo-600 hover:text-indigo-800">← Back</Link>
      </nav>
      <h1 className="text-3xl font-bold mb-2">End User License Agreement</h1>
      <p className="text-sm text-slate-500 mb-8">
        Effective Date: April 24, 2026 · Version 1.0
      </p>

      <EulaBody />

      <p className="mt-10 text-xs text-slate-500 border-t border-slate-200 pt-6">
        Questions about this EULA? Contact{' '}
        <a href="mailto:legal@educms.example" className="text-indigo-600">legal@educms.example</a>.
      </p>
    </main>
  );
}

/**
 * EULA body — shared between the /terms/eula page and the first-login
 * modal. Kept as a named export so the modal can import it directly
 * and the text stays in lock-step.
 */
export function EulaBody() {
  return (
    <article className="prose prose-slate prose-sm max-w-none leading-relaxed">
      <p className="text-sm uppercase tracking-wider font-bold text-red-600 mb-4">
        Please Read Carefully. By checking the acceptance box on sign-in you
        agree to be bound by this Agreement.
      </p>

      <h2 className="text-xl font-bold mt-8 mb-3">1. Definitions</h2>
      <p>
        In this End User License Agreement (&quot;Agreement&quot;):
      </p>
      <ul className="list-disc pl-6 space-y-1">
        <li>
          &quot;<strong>Service</strong>&quot; means the EDU CMS software-as-a-service
          product, including the web dashboard, mobile panic interface, Android
          kiosk player application, APIs, and any bundled documentation.
        </li>
        <li>
          &quot;<strong>Licensor</strong>&quot;, &quot;<strong>we</strong>&quot;, and &quot;<strong>us</strong>&quot; mean the
          operator of the Service.
        </li>
        <li>
          &quot;<strong>You</strong>&quot;, &quot;<strong>your</strong>&quot;, and &quot;<strong>Customer</strong>&quot; mean the
          individual or organization accepting this Agreement and any end users
          accessing the Service through your account.
        </li>
        <li>
          &quot;<strong>Emergency Features</strong>&quot; means any portion of the Service
          used to broadcast, display, trigger, relay, or dismiss emergency,
          safety, panic, lockdown, shelter-in-place, evacuation, medical, or
          other life-safety messages.
        </li>
      </ul>

      <h2 className="text-xl font-bold mt-8 mb-3">2. License Grant</h2>
      <p>
        Subject to your continuing compliance with this Agreement, Licensor
        grants you a non-exclusive, non-transferable, revocable, limited license
        to access and use the Service during the term of your subscription.
        All rights not expressly granted are reserved. No right of ownership is
        transferred.
      </p>

      <h2 className="text-xl font-bold mt-8 mb-3">3. Acceptable Use</h2>
      <p>You agree NOT to:</p>
      <ul className="list-disc pl-6 space-y-1">
        <li>Reverse engineer, decompile, or attempt to derive source code of the Service except to the extent expressly permitted by applicable law;</li>
        <li>Resell, sublicense, or redistribute the Service;</li>
        <li>Use the Service in violation of any applicable law, regulation, or third-party right;</li>
        <li>Transmit malware, spam, or any content that is unlawful, defamatory, obscene, or infringing;</li>
        <li>Use Emergency Features to broadcast false, prank, drill-without-clearly-labeling-as-drill, or fraudulent alerts;</li>
        <li>Interfere with the integrity, security, or performance of the Service or the networks connecting to it.</li>
      </ul>

      <h2 className="text-xl font-bold mt-8 mb-3 text-red-700">
        4. EMERGENCY FEATURES — CRITICAL DISCLAIMER
      </h2>
      <p className="font-semibold">
        The Service&apos;s Emergency Features are CONVENIENCE TOOLS provided on
        a best-effort basis. They are NOT a substitute for, and must not be
        relied upon as a replacement for, any of the following:
      </p>
      <ul className="list-disc pl-6 space-y-1 font-semibold">
        <li>Fire alarm systems, smoke detectors, or sprinkler systems;</li>
        <li>Building-wide public address (PA), intercom, or siren systems;</li>
        <li>Direct voice communication with 911 or equivalent public emergency services;</li>
        <li>Certified mass-notification systems (for example, those complying with NFPA 72, UL 2572, or equivalent standards);</li>
        <li>IPAWS, CAP, Wireless Emergency Alerts (WEA), Emergency Alert System (EAS), or any government-authorized public alerting channel;</li>
        <li>Properly trained human responders, security staff, school resource officers, or emergency medical technicians;</li>
        <li>Any life-safety, medical, weapon-detection, threat-detection, or surveillance system subject to regulatory certification.</li>
      </ul>
      <p className="mt-4">
        You acknowledge that the Service depends on internet connectivity,
        third-party cloud infrastructure, web browsers, operating systems,
        display hardware, and other components outside Licensor&apos;s control,
        any of which may fail, delay, degrade, or be unavailable without
        warning. You agree it is YOUR responsibility to maintain redundant,
        independent, properly-certified emergency systems as required by
        applicable law, insurance policy, school district policy, local fire
        code, and prudent operations.
      </p>
      <p className="mt-4 font-semibold">
        LICENSOR MAKES NO REPRESENTATION THAT AN EMERGENCY MESSAGE TRIGGERED,
        BROADCAST, DELIVERED, DISPLAYED, OR DISMISSED THROUGH THE SERVICE WILL
        (A) REACH ANY SPECIFIC SCREEN, DEVICE, PERSON, OR AGENCY, (B) REACH
        THEM WITHIN ANY PARTICULAR TIME WINDOW, (C) BE UNDERSTOOD OR ACTED
        UPON CORRECTLY, OR (D) RESULT IN ANY PARTICULAR OUTCOME.
      </p>

      <h2 className="text-xl font-bold mt-8 mb-3">5. Customer Responsibilities</h2>
      <p>You are solely responsible for:</p>
      <ul className="list-disc pl-6 space-y-1">
        <li>Establishing, training, testing, and maintaining your own emergency response plan, drills, evacuation procedures, and chain of command;</li>
        <li>Configuring the Service correctly, including but not limited to emergency playlist assignment, panic-trigger role permissions, device pairing, and all-clear procedures;</li>
        <li>Training your staff on proper use of the Service, including how to trigger, escalate, and cancel emergency messages;</li>
        <li>Verifying that emergency content actually displays on intended screens before relying on the Service in a real incident;</li>
        <li>Maintaining independent communication channels (cellular, landline, radio, PA) for emergency situations;</li>
        <li>Ensuring content displayed complies with FERPA, COPPA, HIPAA, state privacy laws, and any other applicable regulations.</li>
      </ul>

      <h2 className="text-xl font-bold mt-8 mb-3">6. Service Availability; No Warranty</h2>
      <p className="font-semibold uppercase tracking-wide">
        THE SERVICE IS PROVIDED &quot;AS IS&quot; AND &quot;AS AVAILABLE,&quot; WITHOUT WARRANTY
        OF ANY KIND.
      </p>
      <p>
        Licensor expressly disclaims all warranties, whether express, implied,
        statutory, or otherwise, including but not limited to any implied
        warranties of merchantability, fitness for a particular purpose,
        non-infringement, quiet enjoyment, accuracy, or uninterrupted or
        error-free operation. No advice or information, whether oral or
        written, obtained from Licensor or through the Service creates any
        warranty not expressly stated in this Agreement.
      </p>
      <p>
        Licensor does not warrant that: (a) the Service will meet your
        requirements; (b) the Service will be available at any particular time
        or location, uninterrupted, secure, or error-free; (c) any defects
        will be corrected; (d) the Service is free of viruses or other
        harmful components; or (e) the results of using the Service will meet
        your expectations.
      </p>

      <h2 className="text-xl font-bold mt-8 mb-3 text-red-700">7. LIMITATION OF LIABILITY</h2>
      <p className="font-semibold uppercase tracking-wide">
        TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, IN NO EVENT WILL
        LICENSOR, ITS AFFILIATES, OFFICERS, DIRECTORS, EMPLOYEES, AGENTS,
        SUPPLIERS, OR LICENSORS BE LIABLE FOR ANY INDIRECT, INCIDENTAL,
        SPECIAL, CONSEQUENTIAL, EXEMPLARY, OR PUNITIVE DAMAGES, INCLUDING BUT
        NOT LIMITED TO DAMAGES FOR:
      </p>
      <ul className="list-disc pl-6 space-y-1 font-semibold uppercase">
        <li>Loss of life, personal injury, emotional distress, or bodily harm;</li>
        <li>Failure, delay, misdelivery, or non-delivery of any emergency, safety, panic, lockdown, shelter, evacuation, medical, or other alert message;</li>
        <li>False alerts, accidental triggers, or unintended broadcasts;</li>
        <li>Screens that fail to render, freeze, crash, display stale content, or stay stuck on an emergency state after an all-clear;</li>
        <li>Loss of profits, revenue, business, goodwill, data, or content;</li>
        <li>Security breaches, data leaks, or unauthorized access to your content or accounts;</li>
        <li>Any act or omission of any third party, including internet service providers, cloud hosting providers, telecommunications carriers, display manufacturers, web browser vendors, or government alerting authorities;</li>
        <li>Any matter beyond Licensor&apos;s reasonable control (force majeure).</li>
      </ul>
      <p className="mt-4 font-semibold uppercase tracking-wide">
        LICENSOR&apos;S TOTAL CUMULATIVE LIABILITY TO YOU FOR ALL CLAIMS
        ARISING OUT OF OR RELATING TO THIS AGREEMENT OR THE SERVICE, WHETHER
        IN CONTRACT, TORT (INCLUDING NEGLIGENCE), STRICT LIABILITY, OR ANY
        OTHER THEORY, WILL NOT EXCEED THE LESSER OF (A) THE FEES YOU
        ACTUALLY PAID TO LICENSOR FOR THE SERVICE DURING THE TWELVE (12)
        MONTHS IMMEDIATELY PRECEDING THE EVENT GIVING RISE TO THE CLAIM, OR
        (B) ONE HUNDRED U.S. DOLLARS ($100).
      </p>
      <p className="mt-4">
        The foregoing limitations apply even if Licensor has been advised of
        the possibility of such damages and even if a remedy fails of its
        essential purpose. Some jurisdictions do not allow the exclusion or
        limitation of certain damages; in those jurisdictions, the foregoing
        limitations apply to the maximum extent permitted by law.
      </p>

      <h2 className="text-xl font-bold mt-8 mb-3">8. Indemnification</h2>
      <p>
        You agree to defend, indemnify, and hold harmless Licensor, its
        affiliates, and their respective officers, directors, employees, and
        agents from and against any and all claims, damages, obligations,
        losses, liabilities, costs, and expenses (including reasonable
        attorneys&apos; fees) arising from: (a) your use or misuse of the
        Service; (b) your violation of this Agreement; (c) your violation of
        any third-party right, including privacy, publicity, or intellectual
        property rights; (d) any claim that content you submitted caused
        damage to a third party; and (e) your use or reliance on any
        Emergency Feature.
      </p>

      <h2 className="text-xl font-bold mt-8 mb-3">9. Term and Termination</h2>
      <p>
        This Agreement remains in effect until terminated. Licensor may
        suspend or terminate your access at any time, with or without cause
        or notice, including for non-payment, violation of this Agreement, or
        risk to the Service or other users. Upon termination, your license
        ends and you must cease all use of the Service. Sections 4 through 11
        survive termination.
      </p>

      <h2 className="text-xl font-bold mt-8 mb-3">10. Changes to the Agreement</h2>
      <p>
        Licensor may modify this Agreement from time to time. Material
        changes will be signaled by incrementing the Version number at the top
        of this page and prompting you to re-accept on next login. Continued
        use of the Service after a new version takes effect constitutes
        acceptance of the new version.
      </p>

      <h2 className="text-xl font-bold mt-8 mb-3">11. Governing Law; Disputes</h2>
      <p>
        This Agreement is governed by the laws of the State of Delaware,
        without regard to its conflict-of-laws provisions. Any dispute
        arising out of or relating to this Agreement or the Service will be
        resolved exclusively through binding arbitration administered by the
        American Arbitration Association under its Commercial Arbitration
        Rules, in Wilmington, Delaware. You WAIVE any right to participate
        in a class action, class arbitration, or collective proceeding.
      </p>

      <h2 className="text-xl font-bold mt-8 mb-3">12. Miscellaneous</h2>
      <p>
        This Agreement, together with any subscription order form, constitutes
        the entire agreement between you and Licensor regarding the Service
        and supersedes all prior agreements, discussions, or understandings.
        If any provision is held invalid or unenforceable, the remaining
        provisions will remain in full effect. Licensor&apos;s failure to enforce
        any right or provision is not a waiver of that right or provision.
        You may not assign this Agreement without Licensor&apos;s prior written
        consent; Licensor may assign freely.
      </p>

      <p className="mt-10 font-bold uppercase tracking-wider text-red-700 border-2 border-red-300 p-4 rounded-lg bg-red-50">
        By checking the acceptance box on the sign-in screen, you acknowledge
        that you have read, understood, and agree to be bound by this End User
        License Agreement, including in particular the disclaimers in
        Section 4 (Emergency Features), Section 6 (No Warranty), and the
        limitation of liability in Section 7.
      </p>
    </article>
  );
}
