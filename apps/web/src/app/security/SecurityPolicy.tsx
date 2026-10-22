import Link from 'next/link';
import type { ReactNode } from 'react';
import { ShieldCheck } from 'lucide-react';
import { LocaleVariant } from '@/components/marketing/PublicText';
import { LEGAL_CONTACTS } from '@/lib/legal-entity';
import { SECURITY_POLICY_TEXT, type SecurityPolicyText } from './policy-text';

/** Shown as "Last updated" on /security. Keep in step with security.txt. */
export const SECURITY_POLICY_UPDATED = '2026-10-22';

const LINKS: Record<string, (c: string) => ReactNode> = {
  mail: (c) => <a href={`mailto:${LEGAL_CONTACTS.security}`}>{c}</a>,
  overview: (c) => <Link href="/help/it-security-overview">{c}</Link>,
  network: (c) => <Link href="/help/network-requirements">{c}</Link>,
  dpa: (c) => <Link href="/dpa#subprocessors">{c}</Link>,
};

/** `Email <mail>x</mail>.` → text with links. Server-side, no ICU runtime. */
function rich(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /<(\w+)>(.*?)<\/\1>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    out.push(text.slice(last, m.index));
    const link = LINKS[m[1]];
    out.push(<span key={m.index}>{link ? link(m[2]) : m[2]}</span>);
    last = m.index + m[0].length;
  }
  out.push(text.slice(last));
  return out;
}

/**
 * The vulnerability disclosure policy — a SERVER component. Every language is
 * rendered here and `LocaleVariant` shows the reader's, so neither the
 * markup nor the text becomes client JavaScript (bundle budget).
 */
export function SecurityPolicy() {
  return (
    <LocaleVariant
      en={<Policy t={SECURITY_POLICY_TEXT.en} />}
      es={<Policy t={SECURITY_POLICY_TEXT.es} />}
      zh={<Policy t={SECURITY_POLICY_TEXT.zh} />}
    />
  );
}

function Policy({ t }: { t: SecurityPolicyText }) {
  const s = t as unknown as Record<string, string>;
  const list = (prefix: string, n: number) => (
    <ul>
      {Array.from({ length: n }, (_, i) => (
        <li key={i}>{s[`${prefix}${i + 1}`]}</li>
      ))}
    </ul>
  );
  const stages = ['ack', 'assess', 'fixHigh', 'fixLow', 'disclosure'] as const;

  return (
    <article className="max-w-3xl mx-auto px-6 pt-12 pb-20">
      <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-indigo-50 border border-indigo-100 text-[11px] font-semibold text-indigo-700 mb-3">
        <ShieldCheck className="w-3 h-3" />
        {LEGAL_CONTACTS.security}
      </div>
      <h1 className="font-[family-name:var(--font-fredoka)] text-4xl md:text-5xl font-semibold tracking-tight text-slate-900">
        {t.title}
      </h1>
      <p className="mt-4 text-lg text-slate-600 leading-relaxed">{t.lead}</p>
      <p className="mt-3 text-sm text-slate-500">{t.updated.replace('{date}', SECURITY_POLICY_UPDATED)}</p>

      <div className="mt-10 space-y-8 text-slate-700 leading-relaxed [&_h2]:font-[family-name:var(--font-fredoka)] [&_h2]:font-semibold [&_h2]:text-slate-900 [&_h2]:text-2xl [&_h2]:tracking-tight [&_h2]:mt-10 [&_h3]:font-semibold [&_h3]:text-slate-900 [&_h3]:text-lg [&_h3]:mt-6 [&_p]:mb-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:space-y-2 [&_a]:text-indigo-600 [&_a]:underline [&_a]:underline-offset-2">
        <section>
          <h2>{t.howTitle}</h2>
          <p>{rich(t.howBody)}</p>
          <h3>{t.includeTitle}</h3>
          {list('include', 4)}
        </section>

        <section>
          <h2>{t.expectTitle}</h2>
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 text-slate-900">
                <tr>
                  <th scope="col" className="px-3 py-2 font-semibold">{t.stageCol}</th>
                  <th scope="col" className="px-3 py-2 font-semibold">{t.commitmentCol}</th>
                </tr>
              </thead>
              <tbody>
                {stages.map((st) => (
                  <tr key={st} className="border-t border-slate-200 align-top">
                    <td className="px-3 py-2 font-medium text-slate-900">{s[`${st}Stage`]}</td>
                    <td className="px-3 py-2">{s[`${st}Time`]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-4">{t.expectNote}</p>
        </section>

        <section>
          <h2>{t.scopeTitle}</h2>
          {list('scope', 3)}
          <h3>{t.priorityTitle}</h3>
          {list('priority', 5)}
          <h3>{t.outTitle}</h3>
          {list('out', 8)}
        </section>

        <section>
          <h2>{t.rulesTitle}</h2>
          {list('rule', 6)}
        </section>

        <section>
          <h2>{t.harborTitle}</h2>
          <p>{rich(t.harborBody)}</p>
        </section>

        <section>
          <h2>{t.reviewsTitle}</h2>
          <p>{rich(t.reviewsBody)}</p>
          <p className="text-sm text-slate-500">{t.machineReadable}</p>
        </section>
      </div>
    </article>
  );
}
