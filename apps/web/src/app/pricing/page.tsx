import Link from 'next/link';
import { Check, ArrowRight, Sparkles } from 'lucide-react';
import { PublicShell } from '@/components/marketing/PublicShell';

export const metadata = {
  title: 'Pricing — VenueOS',
  description:
    'Simple per-screen pricing for VenueOS — $20 per screen per month or $200 per screen per year, and $25 / $250 with AI. Signage, kiosks, live scoreboards and emergency alerts on every plan.',
};

const NAVY = '#070a14';

/**
 * Per-screen plans — the exact prices the billing catalog
 * (packages/api-types/src/billing.ts) and Stripe checkout charge, so the
 * page and the checkout never disagree (owner pricing decision, 2026-10-12):
 *   - VenueOS:       $20 / screen / month · $200 / screen / year
 *   - VenueOS + AI:  $25 / screen / month · $250 / screen / year
 * Enterprise is a custom volume agreement (sales-led, not self-serve).
 *
 * Every plan ships the whole signage + emergency product. AI on VenueOS's
 * own AI is the one add-on (+$5 / screen / month); a customer's OWN AI key
 * works on every plan.
 */
const TIERS: {
  name: string;
  price: number;
  per: string;
  aiPrice: number;
  sub: string;
  range: string;
  blurb: string;
  featured: boolean;
}[] = [
  {
    name: 'Monthly',
    price: 20,
    per: '/ screen / month',
    aiPrice: 25,
    sub: 'Billed monthly — cancel anytime',
    range: 'Pay as you go',
    blurb: 'Everything VenueOS does, billed per screen you connect. No commitment.',
    featured: false,
  },
  {
    name: 'Annual',
    price: 200,
    per: '/ screen / year',
    aiPrice: 250,
    sub: 'Billed yearly — two months free',
    range: 'Best value',
    blurb: 'Same product, billed once a year. Twelve months for the price of ten.',
    featured: true,
  },
];

/** What "with AI" adds, per paid screen, pooled across your locations. */
const AI_INCLUDES = [
  '10 AI board designs per screen, every month',
  '20 AI images per screen, every month',
  'AI writing help: announcements, menus, translations',
  'Shared across all your locations',
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
    a: "You're billed for each screen you connect to VenueOS — $20 per screen per month, or $200 per screen per year. With AI it's $25 a month or $250 a year. Add or remove screens anytime; we prorate the change.",
  },
  {
    q: 'What does the AI plan add?',
    a: 'VenueOS + AI includes, for every paid screen each month, 10 AI board designs and 20 AI images on our AI, plus writing help for announcements, menus and translations — shared across all your locations. Need more? Add your own AI key or contact us.',
  },
  {
    q: 'Can we use our own AI key instead?',
    a: 'Yes, on every plan. Add your own OpenAI, Anthropic or Google key in Settings → AI provider and you pay your AI provider directly, with no VenueOS limit.',
  },
  {
    q: 'What counts as a screen?',
    a: 'Any display running the VenueOS player — a TV, a kiosk, an LED scoreboard, or a ribbon board. Admin and operator logins are always free and unlimited.',
  },
  {
    q: 'Can we try it before we pay?',
    a: 'Yes. Start a free 14-day trial with no credit card — connect up to 3 screens, use every feature, and try the AI (2 board designs and 2 images). Add billing when you’re ready to go live.',
  },
  {
    q: 'Is annual billing cheaper?',
    a: 'Yes — pay annually and every screen is $200 per year ($250 with AI): twelve months for the price of ten.',
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
            Signage, kiosks, live scoreboards and emergency alerts on every plan —
            $20 per screen a month, or $200 a year. Add AI for $5 more per screen.
            Start with a 14-day free trial, AI included — no credit card.
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
                  ${t.price}
                </span>
                <span className="text-sm text-slate-500">{t.per}</span>
              </div>
              <p className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-violet-700">
                <Sparkles className="w-4 h-4" aria-hidden /> ${t.aiPrice} {t.per} with AI
              </p>
              <p className="mt-1.5 text-xs text-slate-500">{t.sub}</p>
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
                Start 14-day free trial <ArrowRight className="w-4 h-4" />
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
              href="mailto:sales@venue-os.app"
              className="mt-6 inline-flex items-center justify-center gap-2 px-5 py-3 rounded-lg text-sm font-semibold bg-white border border-slate-300 text-slate-900 hover:border-slate-400 transition-colors"
            >
              Contact us <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>

        <p className="mt-8 text-center text-xs text-slate-500 max-w-xl mx-auto px-6">
          Prices in USD. Screens are billed as you connect them — add or remove anytime,
          and we prorate the change. Turn AI on or off from your Billing page whenever you like.
        </p>
      </section>

      {/* ── the AI add-on ─────────────────────────────────────── */}
      <section className="pb-16 md:pb-20">
        <div className="max-w-6xl mx-auto px-6">
          <div className="rounded-2xl border border-violet-200 bg-violet-50/50 p-7 md:p-9 grid gap-8 md:grid-cols-2">
            <div>
              <p className="text-xs font-semibold tracking-[0.14em] uppercase text-violet-700">
                VenueOS + AI · +$5 / screen / month
              </p>
              <h2 className="mt-3 text-2xl md:text-3xl font-semibold tracking-tight text-slate-900">
                AI that designs, writes and illustrates for you.
              </h2>
              <p className="mt-3 text-sm md:text-base text-slate-600 leading-relaxed">
                Describe a board and get finished designs, generate on-brand images, and
                write copy in seconds — on our AI, with nothing to set up. Prefer your own
                AI account? Add your own key on any plan and pay your provider directly.
              </p>
            </div>
            <ul className="space-y-3 self-center">
              {AI_INCLUDES.map((f) => (
                <li key={f} className="flex items-start gap-2.5">
                  <Check className="w-4 h-4 text-violet-600 shrink-0 mt-0.5" strokeWidth={3} />
                  <span className="text-sm text-slate-700 leading-relaxed">{f}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ── everything included ───────────────────────────────── */}
      <section className="py-20 md:py-24 bg-[#fafbfc] border-y border-slate-200">
        <div className="max-w-6xl mx-auto px-6">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold tracking-[0.14em] uppercase text-indigo-600">
              On every plan
            </p>
            <h2 className="mt-3 text-3xl md:text-4xl font-semibold tracking-tight text-slate-900">
              Every plan is the whole product.
            </h2>
            <p className="mt-3 text-base md:text-lg text-slate-600">
              Signage, emergency alerts and live sports are never locked behind a higher
              tier. Whether you run one screen or a thousand, you get all of it — AI is the
              one optional add-on.
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
