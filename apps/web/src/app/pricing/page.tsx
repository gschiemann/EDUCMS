import Link from 'next/link';
import { Check, ArrowRight } from 'lucide-react';
import { PublicShell } from '@/components/marketing/PublicShell';

export const metadata = {
  title: 'Pricing — VenueOS',
  description:
    'Simple per-screen pricing for VenueOS — $25 per screen per month, $20 at five or more. Every feature included: signage, kiosks, live scoreboards, and emergency alerts.',
};

const NAVY = '#070a14';

/**
 * Per-screen pricing. The first four screens are $25/mo each; at five
 * or more, every screen is $20/mo (a flat 20% volume cut, applied to
 * the whole account). Annual billing is 10× the monthly rate — two
 * months free. Enterprise is a custom volume agreement.
 *
 * No feature gating between tiers — every plan ships the whole
 * product. The only thing that changes with scale is the per-screen
 * price.
 */
const TIERS: {
  name: string;
  monthly: number;
  annual: number;
  range: string;
  blurb: string;
  featured: boolean;
}[] = [
  {
    name: 'Per Screen',
    monthly: 25,
    annual: 250,
    range: 'For 1–4 screens',
    blurb: 'Everything VenueOS does, billed per screen you connect.',
    featured: false,
  },
  {
    name: 'Volume',
    monthly: 20,
    annual: 200,
    range: '5 screens or more',
    blurb: 'Reach five screens and every screen drops to $20 — a 20% cut, applied automatically.',
    featured: true,
  },
];

const INCLUDED = [
  'Unlimited admin & operator logins',
  '170+ templates + drag-and-drop builder',
  'Live sports scoreboards, ribbon boards & scorebug',
  'Emergency alerts with an immutable audit log',
  'Real-time sync across your whole screen fleet',
  'Runs on smart TVs, Android players & LED controllers',
  'Google, Microsoft & SSO sign-in',
  'Scheduling, playlists & content approvals',
];

const FAQ = [
  {
    q: 'How does per-screen pricing work?',
    a: "You're billed for each screen you connect to VenueOS. The first four screens are $25 each per month; once you reach five, every screen is $20. Add or remove screens anytime — we prorate the change.",
  },
  {
    q: 'What counts as a screen?',
    a: 'Any display running the VenueOS player — a TV, a kiosk, an LED scoreboard, or a ribbon board. Admin and operator logins are always free and unlimited.',
  },
  {
    q: 'Can we try it before we pay?',
    a: 'Yes. Start free with no credit card, connect a screen, and use every feature. Add billing when you’re ready to go live.',
  },
  {
    q: 'Is annual billing cheaper?',
    a: 'Yes — pay annually and two months are free: $250 per screen per year, or $200 per screen at five or more.',
  },
  {
    q: 'Do you take purchase orders or invoices?',
    a: 'Yes, on Enterprise. Districts, chains, and larger venues can pay by invoice or PO — get in touch and we’ll set it up.',
  },
  {
    q: 'What hardware do we need?',
    a: 'Any modern smart TV, Android player, Chromebox, or LED controller with a browser. There’s no proprietary hardware to buy.',
  },
];

export default function PricingPage() {
  return (
    <PublicShell>
      {/* ── hero ──────────────────────────────────────────────── */}
      <section className="relative overflow-hidden" style={{ background: NAVY }}>
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 -translate-x-1/2 -top-[360px] h-[760px] w-[760px]"
          style={{ background: 'radial-gradient(circle, rgba(99,102,241,0.18), transparent 62%)' }}
        />
        <div className="relative max-w-3xl mx-auto px-6 pt-20 pb-16 md:pt-24 md:pb-20 text-center">
          <span className="text-xs font-semibold tracking-[0.14em] uppercase text-indigo-300">
            Pricing
          </span>
          <h1 className="mt-5 text-4xl sm:text-5xl md:text-6xl font-semibold tracking-tight text-white leading-[1.08]">
            Pay for the screens
            <br />
            you run.
          </h1>
          <p className="mt-6 text-base md:text-lg text-slate-400 leading-relaxed max-w-xl mx-auto">
            Every feature on every plan — signage, kiosks, live scoreboards, and
            emergency alerts. The more screens you run, the less each one costs.
          </p>
        </div>
      </section>

      {/* ── tiers ─────────────────────────────────────────────── */}
      <section className="py-16 md:py-20">
        <div className="max-w-6xl mx-auto px-6 grid gap-5 md:grid-cols-3">
          {TIERS.map((t) => (
            <div
              key={t.name}
              className={`relative rounded-2xl p-7 flex flex-col bg-white ${
                t.featured
                  ? 'border border-indigo-200 ring-2 ring-indigo-500/25 shadow-xl shadow-indigo-500/10 md:-translate-y-2'
                  : 'border border-slate-200 shadow-sm'
              }`}
            >
              {t.featured && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-indigo-600 text-white text-[10px] font-bold uppercase tracking-wider shadow-lg">
                  Best value
                </span>
              )}
              <h2 className="text-sm font-semibold tracking-wide uppercase text-indigo-600">
                {t.name}
              </h2>
              <div className="mt-4 flex items-baseline gap-1.5">
                <span className="text-5xl font-semibold tracking-tight text-slate-900">
                  ${t.monthly}
                </span>
                <span className="text-sm text-slate-500">/ screen / month</span>
              </div>
              <p className="mt-1.5 text-xs text-slate-500">
                or ${t.annual}/screen billed annually — 2 months free
              </p>
              <p className="mt-4 text-sm font-semibold text-slate-900">{t.range}</p>
              <p className="mt-1 text-sm text-slate-600 leading-relaxed flex-1">{t.blurb}</p>
              <Link
                href="/signup"
                className={`mt-6 inline-flex items-center justify-center gap-2 px-5 py-3 rounded-lg text-sm font-semibold transition-colors ${
                  t.featured
                    ? 'bg-indigo-600 hover:bg-indigo-700 text-white'
                    : 'bg-slate-900 hover:bg-slate-800 text-white'
                }`}
              >
                Start free <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          ))}

          {/* Enterprise — custom volume agreement */}
          <div className="relative rounded-2xl p-7 flex flex-col bg-white border border-slate-200 shadow-sm">
            <h2 className="text-sm font-semibold tracking-wide uppercase text-indigo-600">
              Enterprise
            </h2>
            <div className="mt-4 flex items-baseline">
              <span className="text-4xl font-semibold tracking-tight text-slate-900">
                Let’s talk
              </span>
            </div>
            <p className="mt-1.5 text-xs text-slate-500">Custom volume agreement</p>
            <p className="mt-4 text-sm font-semibold text-slate-900">
              Districts, chains & large venues
            </p>
            <p className="mt-1 text-sm text-slate-600 leading-relaxed flex-1">
              Fleet-wide volume pricing, invoice or PO billing, custom SSO, an SLA, and a
              dedicated point of contact.
            </p>
            <Link
              href="/help"
              className="mt-6 inline-flex items-center justify-center gap-2 px-5 py-3 rounded-lg text-sm font-semibold bg-white border border-slate-300 text-slate-900 hover:border-slate-400 transition-colors"
            >
              Contact us <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>

        <p className="mt-8 text-center text-xs text-slate-500 max-w-xl mx-auto px-6">
          Prices in USD. Screens are billed as you connect them — add or remove anytime,
          and the volume rate kicks in automatically at five.
        </p>
      </section>

      {/* ── everything included ───────────────────────────────── */}
      <section className="py-20 md:py-24 bg-[#fafbfc] border-y border-slate-200">
        <div className="max-w-6xl mx-auto px-6">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold tracking-[0.14em] uppercase text-indigo-600">
              No feature gating
            </p>
            <h2 className="mt-3 text-3xl md:text-4xl font-semibold tracking-tight text-slate-900">
              Every plan is the whole product.
            </h2>
            <p className="mt-3 text-base md:text-lg text-slate-600">
              We don’t lock features behind a higher tier. Whether you run one screen or a
              thousand, you get all of it.
            </p>
          </div>
          <div className="mt-10 grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
            {INCLUDED.map((f) => (
              <div key={f} className="flex items-start gap-2.5">
                <Check className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" strokeWidth={3} />
                <span className="text-sm text-slate-700 leading-relaxed">{f}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── faq ───────────────────────────────────────────────── */}
      <section className="py-20 md:py-24">
        <div className="max-w-3xl mx-auto px-6">
          <h2 className="text-3xl md:text-4xl font-semibold tracking-tight text-slate-900 text-center mb-12">
            Pricing questions
          </h2>
          <div className="space-y-3">
            {FAQ.map((f) => (
              <details
                key={f.q}
                className="group rounded-xl bg-white border border-slate-200 p-5 open:shadow-md transition"
              >
                <summary className="cursor-pointer list-none flex items-start justify-between gap-4">
                  <span className="font-semibold text-slate-900">{f.q}</span>
                  <span className="text-indigo-600 font-bold text-xl leading-none group-open:rotate-45 transition-transform">
                    +
                  </span>
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
