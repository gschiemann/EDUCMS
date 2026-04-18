import Link from 'next/link';
import { Check, ArrowRight, Sparkles, Shield, Building2 } from 'lucide-react';
import { PublicShell } from '@/components/marketing/PublicShell';

export const metadata = {
  title: 'Pricing — EduSignage',
  description: 'Flat per-building pricing. Unlimited screens, users, and templates. Free pilot for K-12 schools.',
};

const TIERS = [
  {
    name: 'Single School',
    price: '$99',
    cadence: '/ month per school',
    tagline: 'For one building getting started with digital signage.',
    features: [
      'Unlimited screens',
      'Unlimited users + role-based access',
      'All 17 signage templates + custom builder',
      'Emergency alert system with audit log',
      'Email support',
      'Free 30-day pilot',
    ],
    icon: Sparkles,
    gradient: 'from-indigo-500 to-violet-500',
    cta: 'Start free pilot',
    featured: false,
  },
  {
    name: 'District',
    price: '$79',
    cadence: '/ month per school',
    tagline: 'For districts running 3+ buildings. Volume discount + hierarchy.',
    features: [
      'Everything in Single School',
      'District-level dashboard + branding',
      'SSO (Google, Microsoft, SAML/OIDC)',
      'Clever rostering + auto-sync',
      'District-wide emergency broadcasts',
      'Priority email + phone support',
      'Onboarding session + training',
    ],
    icon: Building2,
    gradient: 'from-violet-500 to-fuchsia-500',
    cta: 'Start free pilot',
    featured: true,
  },
  {
    name: 'Enterprise',
    price: "Let's talk",
    cadence: 'Custom',
    tagline: 'For state agencies, large districts (50+ schools), and regulated deployments.',
    features: [
      'Everything in District',
      'On-prem or private cloud option',
      'Custom SSO + IdP integrations',
      'Dedicated technical account manager',
      'Custom SLA + 24/7 incident response',
      'Security & FERPA review package',
      'Custom integrations (SIS, LMS, etc.)',
    ],
    icon: Shield,
    gradient: 'from-slate-700 to-slate-900',
    cta: 'Contact sales',
    featured: false,
  },
];

export default function PricingPage() {
  return (
    <PublicShell>
      <section className="pt-20 pb-12 text-center max-w-3xl mx-auto px-6">
        <h1 className="font-[family-name:var(--font-fredoka)] text-5xl md:text-6xl font-semibold tracking-tight text-slate-900">
          Pricing that scales
          <br />
          <span className="bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-transparent">
            with your district.
          </span>
        </h1>
        <p className="mt-6 text-lg text-slate-600">
          Flat per-building price. Unlimited screens, users, and templates. No surprise fees.
        </p>
      </section>

      <section className="pb-20">
        <div className="max-w-6xl mx-auto px-6 grid gap-6 md:grid-cols-3">
          {TIERS.map((t) => (
            <div
              key={t.name}
              className={`relative rounded-3xl border p-8 flex flex-col ${
                t.featured
                  ? 'bg-gradient-to-br from-white to-indigo-50/50 border-indigo-200 shadow-2xl shadow-indigo-500/10 ring-2 ring-indigo-500/20 md:-translate-y-3'
                  : 'bg-white border-slate-200 shadow-sm'
              }`}
            >
              {t.featured && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-gradient-to-r from-indigo-600 to-violet-600 text-white text-[10px] font-bold uppercase tracking-wider shadow-lg">
                  Most popular
                </span>
              )}
              <div className={`w-11 h-11 rounded-2xl bg-gradient-to-br ${t.gradient} flex items-center justify-center shadow-lg`}>
                <t.icon className="w-5 h-5 text-white" strokeWidth={2.25} />
              </div>
              <h3 className="mt-5 font-[family-name:var(--font-fredoka)] text-2xl font-semibold text-slate-900">
                {t.name}
              </h3>
              <p className="mt-2 text-sm text-slate-600 leading-relaxed min-h-[3rem]">{t.tagline}</p>
              <div className="mt-6 flex items-baseline gap-2">
                <span className="font-[family-name:var(--font-fredoka)] text-4xl font-bold text-slate-900">
                  {t.price}
                </span>
                <span className="text-sm text-slate-500">{t.cadence}</span>
              </div>
              <ul className="mt-6 space-y-3 text-sm flex-1">
                {t.features.map((f) => (
                  <li key={f} className="flex items-start gap-2.5 text-slate-700">
                    <Check className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" strokeWidth={3} />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <Link
                href={t.name === 'Enterprise' ? '/help' : '/signup'}
                className={`mt-8 inline-flex items-center justify-center gap-2 px-5 py-3 rounded-2xl text-sm font-semibold transition ${
                  t.featured
                    ? 'bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white shadow-lg shadow-indigo-500/25'
                    : 'bg-slate-900 hover:bg-slate-800 text-white'
                }`}
              >
                {t.cta} <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          ))}
        </div>

        <p className="mt-10 text-center text-xs text-slate-500 max-w-xl mx-auto px-6">
          Prices shown in USD and are placeholders for our pilot program. Final pricing may vary by region,
          billing cycle, and district-wide commitments. Need an invoice or PO? Contact sales.
        </p>
      </section>

      <section className="py-20 border-t border-slate-200/60">
        <div className="max-w-3xl mx-auto px-6">
          <h2 className="font-[family-name:var(--font-fredoka)] text-3xl md:text-4xl font-semibold text-slate-900 text-center mb-12">
            Frequently asked questions
          </h2>
          <div className="space-y-4">
            {[
              {
                q: 'Is there a per-screen charge?',
                a: 'No. Pricing is per building. Run one screen or five hundred — same price.',
              },
              {
                q: 'Can we try it before we buy?',
                a: 'Yes. Every plan starts with a 30-day free pilot. No credit card needed. Cancel anytime.',
              },
              {
                q: 'Do you integrate with Clever / Google / Microsoft?',
                a: 'Yes on District and Enterprise. Google and Microsoft SSO are supported on all paid plans.',
              },
              {
                q: 'What hardware do we need?',
                a: 'Any modern Chromebook, Chromecast, Fire TV, or smart TV with a browser. We also support Raspberry Pi kiosks.',
              },
              {
                q: 'Is student data FERPA-compliant?',
                a: 'We follow FERPA and COPPA guidance. We never display personally identifiable student information without your explicit opt-in.',
              },
            ].map((f) => (
              <details
                key={f.q}
                className="group rounded-2xl bg-white border border-slate-200 p-5 open:shadow-md transition"
              >
                <summary className="cursor-pointer list-none flex items-start justify-between gap-4">
                  <span className="font-semibold text-slate-900">{f.q}</span>
                  <span className="text-indigo-500 font-bold text-xl leading-none group-open:rotate-45 transition-transform">+</span>
                </summary>
                <p className="mt-3 text-sm text-slate-600 leading-relaxed">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>
    </PublicShell>
  );
}
