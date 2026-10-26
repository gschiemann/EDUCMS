import Link from 'next/link';
import type { ReactNode } from 'react';
import {
  Ban,
  CircleCheck,
  Crosshair,
  EyeOff,
  FileSearch,
  ListChecks,
  LockKeyhole,
  Mail,
  Scale,
  ShieldCheck,
  Target,
} from 'lucide-react';
import { LocaleVariant } from '@/components/marketing/PublicText';
import { LEGAL_CONTACTS } from '@/lib/legal-entity';
import { SECURITY_POLICY_TEXT, type SecurityPolicyText } from './policy-text';

/** Shown as "Last updated" on /security. Keep in step with security.txt and SECURITY.md. */
export const SECURITY_POLICY_UPDATED = '2026-10-24';

/** GitHub private vulnerability reporting (enabled on the public repo, 2026-10-22). */
export const GITHUB_PRIVATE_REPORT_URL = 'https://github.com/gschiemann/EDUCMS/security/advisories/new';

/** The machine-readable twin of this page (RFC 9116), served from `public/`. */
export const SECURITY_TXT_PATH = '/.well-known/security.txt';

const LINKS: Record<string, (c: string) => ReactNode> = {
  mail: (c) => <a href={`mailto:${LEGAL_CONTACTS.security}`}>{c}</a>,
  github: (c) => <a href={GITHUB_PRIVATE_REPORT_URL}>{c}</a>,
  overview: (c) => <Link href="/help/it-security-overview">{c}</Link>,
  network: (c) => <Link href="/help/network-requirements">{c}</Link>,
  dpa: (c) => <Link href="/dpa#subprocessors">{c}</Link>,
  txt: (c) => <a href={SECURITY_TXT_PATH}>{c}</a>,
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

/** "October 24, 2026" / "24 de octubre de 2026" / "2026年10月24日" — formatted on the server. */
function updatedOn(lang: string): string {
  try {
    return new Intl.DateTimeFormat(lang, { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(
      new Date(`${SECURITY_POLICY_UPDATED}T00:00:00Z`),
    );
  } catch {
    return SECURITY_POLICY_UPDATED;
  }
}

/**
 * "Report a security issue" — a SERVER component. Every language is rendered
 * here and `LocaleVariant` shows the reader's, so neither the markup nor the
 * text becomes client JavaScript (bundle budget). Prerendered: `/security` is
 * in `CSP_UNNONCEABLE_PREFIXES` (`lib/csp-script-policy.ts`).
 */
export function SecurityPolicy() {
  return (
    <LocaleVariant
      en={<Policy t={SECURITY_POLICY_TEXT.en} lang="en-US" />}
      es={<Policy t={SECURITY_POLICY_TEXT.es} lang="es" />}
      zh={<Policy t={SECURITY_POLICY_TEXT.zh} lang="zh-CN" />}
    />
  );
}

const SEND_ICONS = [FileSearch, ListChecks, Target, EyeOff];

const FOCUS =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600';

const H2 =
  'font-[family-name:var(--font-fredoka)] text-2xl md:text-3xl font-semibold tracking-tight text-slate-900';

function Policy({ t, lang }: { t: SecurityPolicyText; lang: string }) {
  const email = LEGAL_CONTACTS.security;
  return (
    <div lang={lang} data-testid="security-report-page">
      {/* ── Hero: what this is, and the two private ways in ─────────── */}
      {/* sRGB hex stops on purpose: Tailwind 4's `bg-gradient-to-b` interpolates
          in oklab, which WebKit painted as bright yellow scan lines across this
          hero (seen in Playwright WebKit, 2026-10-24). */}
      <section
        className="border-b border-slate-200"
        style={{ background: 'linear-gradient(180deg, #eef2ff 0%, #f8faff 45%, #ffffff 100%)' }}
      >
        <div className="max-w-5xl mx-auto px-6 pt-12 pb-12 md:pt-20 md:pb-16">
          <span className="inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-white px-3 py-1 text-xs font-semibold text-indigo-700">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
            {t.eyebrow}
          </span>
          <h1 className="mt-5 max-w-3xl font-[family-name:var(--font-fredoka)] text-4xl md:text-6xl font-semibold tracking-tight text-slate-900 leading-[1.05]">
            {t.title}
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-slate-600">{t.lead}</p>

          <p className="mt-9 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{t.sendVia}</p>
          <div className="mt-3 flex flex-col sm:flex-row gap-3">
            <a
              href={`mailto:${email}`}
              data-testid="security-report-email"
              className={`inline-flex items-center justify-center gap-2.5 rounded-xl bg-indigo-600 px-5 py-3.5 text-[15px] font-semibold text-white shadow-sm shadow-indigo-600/25 transition-colors hover:bg-indigo-700 ${FOCUS}`}
            >
              <Mail className="h-[18px] w-[18px]" aria-hidden />
              {email}
            </a>
            <a
              href={GITHUB_PRIVATE_REPORT_URL}
              className={`inline-flex items-center justify-center gap-2.5 rounded-xl border border-slate-300 bg-white px-5 py-3.5 text-[15px] font-semibold text-slate-800 transition-colors hover:border-slate-400 hover:bg-slate-50 ${FOCUS}`}
            >
              <LockKeyhole className="h-4 w-4" aria-hidden />
              {t.githubCta}
            </a>
          </div>
          <p className="mt-4 flex max-w-2xl items-start gap-2 text-sm leading-relaxed text-slate-500">
            <Ban className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" aria-hidden />
            <span>{t.publicWarning}</span>
          </p>
          <p className="mt-6 text-xs text-slate-400">{t.updated.replace('{date}', updatedOn(lang))}</p>
        </div>
      </section>

      <div className="max-w-5xl mx-auto px-6 pb-20 [&_a]:underline-offset-2">
        {/* ── The commitments, at a glance ───────────────────────────── */}
        <section aria-labelledby="sec-commit" className="pt-12 md:pt-16">
          <h2 id="sec-commit" className={H2}>
            {t.commitTitle}
          </h2>
          <dl className="mt-6 grid grid-cols-1 min-[420px]:grid-cols-2 lg:grid-cols-4 gap-3">
            {t.stats.map((s) => (
              <div
                key={s.value}
                className="flex flex-col-reverse justify-end rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
              >
                <dt className="mt-1.5 text-sm leading-snug text-slate-500">{s.label}</dt>
                <dd className="font-[family-name:var(--font-fredoka)] text-2xl font-semibold tracking-tight text-indigo-700">
                  {s.value}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        {/* ── What to send ───────────────────────────────────────────── */}
        <section aria-labelledby="sec-send" className="pt-14 md:pt-20">
          <h2 id="sec-send" className={H2}>
            {t.sendTitle}
          </h2>
          <p className="mt-3 max-w-2xl text-slate-600 leading-relaxed">{t.sendIntro}</p>
          <ul className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
            {t.send.map((item, i) => {
              const Icon = SEND_ICONS[i] ?? FileSearch;
              return (
                <li key={item.title} className="flex gap-4 rounded-2xl border border-slate-200 bg-white p-5">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
                    <Icon className="h-5 w-5" aria-hidden />
                  </span>
                  <span>
                    <span className="block font-semibold text-slate-900">{item.title}</span>
                    <span className="mt-1 block text-sm leading-relaxed text-slate-600">{item.body}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>

        {/* ── What happens next — the commitments as a sequence ──────── */}
        <section aria-labelledby="sec-next" className="pt-14 md:pt-20">
          <h2 id="sec-next" className={H2}>
            {t.processTitle}
          </h2>
          <ol className="mt-6 space-y-0">
            {t.steps.map((step, i) => (
              <li key={step.title} className="relative flex gap-4 pb-7 last:pb-0">
                {i < t.steps.length - 1 && (
                  <span aria-hidden className="absolute left-[19px] top-10 bottom-0 w-px bg-slate-200" />
                )}
                <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-indigo-200 bg-white font-semibold text-indigo-700">
                  {i + 1}
                </span>
                <span className="pt-1.5">
                  <span className="block font-semibold text-slate-900">{step.title}</span>
                  <span className="mt-1 block max-w-2xl text-[15px] leading-relaxed text-slate-600">{step.body}</span>
                </span>
              </li>
            ))}
          </ol>
          <p className="mt-6 text-sm text-slate-500">{t.bountyNote}</p>
        </section>

        {/* ── Safe harbor — the promise, set apart ───────────────────── */}
        <section
          aria-labelledby="sec-harbor"
          className="mt-14 md:mt-20 rounded-3xl bg-[#070a14] px-6 py-8 md:px-10 md:py-10 text-slate-300"
        >
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 text-indigo-300">
              <Scale className="h-5 w-5" aria-hidden />
            </span>
            <h2
              id="sec-harbor"
              className="font-[family-name:var(--font-fredoka)] text-2xl md:text-3xl font-semibold tracking-tight text-white"
            >
              {t.harborTitle}
            </h2>
          </div>
          <p className="mt-5 text-white">{t.harborIntro}</p>
          <ul className="mt-3 space-y-2.5">
            {t.harbor.map((line) => (
              <li key={line} className="flex gap-3 leading-relaxed">
                <CircleCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" aria-hidden />
                <span>{line}</span>
              </li>
            ))}
          </ul>
          <p className="mt-5 text-sm leading-relaxed text-slate-400 [&_a]:font-semibold [&_a]:text-indigo-300 [&_a]:underline">
            {rich(t.harborLimits)}
          </p>
        </section>

        {/* ── Scope ──────────────────────────────────────────────────── */}
        <section aria-labelledby="sec-scope" className="pt-14 md:pt-20">
          <h2 id="sec-scope" className={H2}>
            {t.scopeTitle}
          </h2>
          <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-3">
            <ScopeCard title={t.inScopeTitle} items={t.inScope} icon={<CircleCheck className="h-4 w-4 text-emerald-600" aria-hidden />} />
            <ScopeCard title={t.priorityTitle} items={t.priority} icon={<Crosshair className="h-4 w-4 text-indigo-600" aria-hidden />} />
            <ScopeCard title={t.outTitle} items={t.outOfScope} icon={<Ban className="h-4 w-4 text-slate-400" aria-hidden />} />
          </div>
        </section>

        {/* ── Rules of engagement ────────────────────────────────────── */}
        <section aria-labelledby="sec-rules" className="pt-14 md:pt-20">
          <h2 id="sec-rules" className={H2}>
            {t.rulesTitle}
          </h2>
          <ol className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-3">
            {t.rules.map((rule, i) => (
              <li key={rule} className="flex gap-3 rounded-2xl border border-slate-200 bg-white p-4">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-semibold text-white">
                  {i + 1}
                </span>
                <span className="text-[15px] leading-relaxed text-slate-700">{rule}</span>
              </li>
            ))}
          </ol>
        </section>

        {/* ── Reviews + the machine-readable twin ────────────────────── */}
        <section
          aria-labelledby="sec-reviews"
          className="mt-14 md:mt-20 rounded-2xl border border-slate-200 bg-slate-50 p-6 md:p-8 [&_a]:font-semibold [&_a]:text-indigo-600 [&_a]:underline"
        >
          <h2 id="sec-reviews" className="text-lg font-semibold text-slate-900">
            {t.reviewsTitle}
          </h2>
          <p className="mt-2 leading-relaxed text-slate-600">{rich(t.reviewsBody)}</p>
          <p className="mt-4 text-sm text-slate-500">{rich(t.machineReadable)}</p>
        </section>
      </div>
    </div>
  );
}

function ScopeCard({ title, items, icon }: { title: string; items: readonly string[]; icon: ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <h3 className="font-semibold text-slate-900">{title}</h3>
      <ul className="mt-3 space-y-2.5">
        {items.map((item) => (
          <li key={item} className="flex gap-2.5 text-sm leading-relaxed text-slate-600">
            <span className="mt-[3px] shrink-0">{icon}</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
