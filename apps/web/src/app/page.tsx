import Link from 'next/link';
import { ArrowRight, Shield, Palette, Zap, KeyRound } from 'lucide-react';
import { PublicShell } from '@/components/marketing/PublicShell';
import { TemplateEmbed } from '@/components/marketing/TemplateEmbed';
import { IndustryShowcase } from '@/components/marketing/IndustryShowcase';

/**
 * VenueOS landing page.
 *
 * 2026-05-16 — design refresh: "minimal & precise" (Linear/Vercel
 * territory). Dark navy hero, professional indigo (no rainbow
 * gradients), Inter throughout (the rounded Fredoka display font is
 * retired here — it read as a K-12 toy). Built around the hexagonal
 * network mark. K-12 still leads the industry list as the proven
 * pilot, but nothing on the page reads as a school-only product.
 */

export const metadata = {
  title: 'VenueOS — the operating system for every screen you run',
  description:
    'One platform for digital signage, interactive kiosks, live sports scoreboards, and emergency alerts — across K-12 schools, sports venues, restaurants, retail, gyms, healthcare, hotels, and corporate venues.',
};

const NAVY = '#070a14';

export default function LandingPage() {
  return (
    <PublicShell>
      <Hero />
      <LogoStrip />
      <IndustryShowcase />
      <Gallery />
      <Features />
      <EmergencyCallout />
      <PricingTeaser />
      <CTA />
    </PublicShell>
  );
}

// ── hero ─────────────────────────────────────────────────────────

function Hero() {
  return (
    <section className="relative overflow-hidden" style={{ background: NAVY }}>
      {/* radial indigo glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 -translate-x-1/2 -top-[420px] h-[900px] w-[900px]"
        style={{ background: 'radial-gradient(circle, rgba(99,102,241,0.18), transparent 62%)' }}
      />
      {/* faint hexagon network field */}
      <svg
        aria-hidden
        className="pointer-events-none absolute top-0 left-0 h-full w-full opacity-40"
        viewBox="0 0 1120 560"
        preserveAspectRatio="xMidYMid slice"
      >
        <g stroke="#26304d" strokeWidth="1.25" fill="none">
          <polygon points="120,90 165,116 165,168 120,194 75,168 75,116" />
          <polygon points="210,142 255,168 255,220 210,246 165,220 165,168" />
          <polygon points="1000,360 1045,386 1045,438 1000,464 955,438 955,386" />
          <polygon points="910,308 955,334 955,386 910,412 865,386 865,334" />
          <polygon points="990,150 1035,176 1035,228 990,254 945,228 945,176" />
          <polygon points="60,360 105,386 105,438 60,464 15,438 15,386" />
        </g>
      </svg>

      <div className="relative max-w-5xl mx-auto px-6 pt-24 pb-24 md:pt-28 md:pb-28 text-center">
        <span className="text-xs font-semibold tracking-[0.14em] uppercase text-indigo-300">
          Signage · Kiosks · Scoreboards · Emergency alerts
        </span>
        <h1 className="mt-5 text-4xl sm:text-5xl md:text-6xl font-semibold tracking-tight text-white leading-[1.08] max-w-4xl mx-auto">
          The operating system for{' '}
          <span className="text-indigo-300">every screen</span> you run.
        </h1>
        <p className="mt-6 text-base md:text-lg text-slate-400 max-w-2xl mx-auto leading-relaxed">
          One platform for digital signage, interactive kiosks, live scoreboards, and
          life-safety alerts — across schools, stadiums, restaurants, retail, healthcare,
          hospitality, and corporate venues.
        </p>
        <div className="mt-9 flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            href="/signup"
            className="group inline-flex items-center justify-center gap-2 px-5 py-3 rounded-lg text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 transition-colors"
          >
            Start free trial
            <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
          </Link>
          <Link
            href="/pricing"
            className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-lg text-sm font-semibold text-white border border-[#2b3550] hover:border-[#46527a] transition-colors"
          >
            See pricing
          </Link>
        </div>
        <p className="mt-5 text-sm text-slate-500">
          No credit card · Free pilot, any industry · Up and running in 10 minutes
        </p>
      </div>
    </section>
  );
}

// ── trusted strip ────────────────────────────────────────────────

function LogoStrip() {
  return (
    <div className="border-b border-slate-200 bg-[#fafbfc]">
      <div className="max-w-5xl mx-auto px-6 py-7 flex flex-wrap items-center justify-center gap-x-9 gap-y-3">
        <span className="text-[11px] font-semibold tracking-[0.12em] uppercase text-slate-400">
          Running on screens at
        </span>
        {['Lincoln USD', 'Riverside Arena', 'Northgate Market', 'Iron & Oak Fitness', 'Summit Hotels'].map(
          (d) => (
            <span key={d} className="text-sm font-semibold text-slate-400">
              {d}
            </span>
          ),
        )}
      </div>
    </div>
  );
}

// ── template gallery ─────────────────────────────────────────────

const GALLERY = [
  {
    src: '/demo/templates/rainbow.html',
    staticImage: '/demo/templates/rainbow.jpg',
    name: 'Elementary Lobby',
    blurb: 'A friendly welcome board for K-5 schools.',
    chip: 'K-12',
  },
  {
    src: '/templates/hs/ath-gameday.html',
    staticImage: '/demo/templates/sports-gameday.jpg',
    name: 'Game Day Hub',
    blurb: 'Live scoreboard and game-day show control.',
    chip: 'Sports',
  },
  {
    src: '/templates/signage/qsr/01-drive-thru-flagship.html',
    staticImage: '/demo/templates/qsr-drive-thru.jpg',
    name: 'Drive-Thru Menu',
    blurb: 'A counter menu board with live pricing.',
    chip: 'Restaurant',
  },
];

function Gallery() {
  return (
    <section id="templates" className="py-20 md:py-24">
      <div className="max-w-6xl mx-auto px-6">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold tracking-[0.14em] uppercase text-indigo-600">
            170+ templates, every industry
          </p>
          <h2 className="mt-3 text-3xl md:text-4xl font-semibold tracking-tight text-slate-900">
            A look for every space.
          </h2>
          <p className="mt-3 text-base md:text-lg text-slate-600">
            Start from a polished template, change the text, recolor it to your brand —
            then drop it on any screen.
          </p>
        </div>
        <div className="mt-10 grid grid-cols-1 md:grid-cols-3 gap-5">
          {GALLERY.map((t) => (
            <div
              key={t.name}
              className="bg-white rounded-xl overflow-hidden border border-slate-200 hover:border-indigo-300 hover:-translate-y-0.5 transition-all"
            >
              <TemplateEmbed
                src={t.src}
                staticImage={t.staticImage}
                title={`${t.name} template preview`}
              />
              <div className="px-5 py-4 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="font-semibold tracking-tight text-slate-900">{t.name}</h3>
                  <p className="text-xs text-slate-500 mt-0.5">{t.blurb}</p>
                </div>
                <span className="shrink-0 text-[10px] font-semibold tracking-wider uppercase px-2 py-1 rounded-md bg-indigo-50 text-indigo-600">
                  {t.chip}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── features ─────────────────────────────────────────────────────

const FEATURES = [
  {
    icon: Shield,
    title: 'Emergency alerts in a tap',
    desc:
      'Every screen flips to a lockdown, evacuation, or weather message in seconds — signed, audited, and hold-to-trigger so nothing fires by accident.',
  },
  {
    icon: Palette,
    title: 'Templates for every industry',
    desc:
      'Schools, stadiums, restaurants, gyms, retail, healthcare, hotels. Pick one, change the text, recolor it to your brand — done.',
  },
  {
    icon: Zap,
    title: 'Runs on any screen',
    desc:
      'Smart TVs, Android players, LED controllers, kiosks. No proprietary hardware to buy or maintain.',
  },
  {
    icon: KeyRound,
    title: 'Logs in with what you use',
    desc:
      'Google, Microsoft, SSO — sign-in works out of the box. K-12 districts get Clever rostering with staff sync built in.',
  },
];

function Features() {
  return (
    <section id="features" className="py-20 md:py-24 bg-[#fafbfc] border-y border-slate-200">
      <div className="max-w-6xl mx-auto px-6">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold tracking-[0.14em] uppercase text-indigo-600">
            Why teams choose VenueOS
          </p>
          <h2 className="mt-3 text-3xl md:text-4xl font-semibold tracking-tight text-slate-900">
            Serious infrastructure, run by anyone.
          </h2>
        </div>
        <div className="mt-10 grid gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f) => (
            <div key={f.title}>
              <div className="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center">
                <f.icon className="w-5 h-5 text-indigo-600" strokeWidth={2.1} />
              </div>
              <h3 className="mt-4 font-semibold tracking-tight text-slate-900">{f.title}</h3>
              <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── emergency callout ────────────────────────────────────────────

function EmergencyCallout() {
  return (
    <section className="py-20 md:py-24">
      <div className="max-w-6xl mx-auto px-6">
        <div
          className="relative overflow-hidden rounded-2xl p-10 md:p-14 text-white"
          style={{ background: NAVY }}
        >
          <div
            aria-hidden
            className="pointer-events-none absolute -top-24 -right-24 w-80 h-80 rounded-full"
            style={{ background: 'radial-gradient(circle, rgba(239,68,68,0.18), transparent 70%)' }}
          />
          <div className="relative grid md:grid-cols-2 gap-10 items-center">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-red-500/15 border border-red-400/25 text-xs font-semibold text-red-200">
                <Shield className="w-3.5 h-3.5" />
                Built for safety
              </div>
              <h2 className="mt-5 text-3xl md:text-4xl font-semibold tracking-tight leading-tight text-white">
                When seconds matter, it doesn&rsquo;t miss.
              </h2>
              <p className="mt-4 text-slate-400 leading-relaxed max-w-lg">
                A hold-to-trigger panic button, a private signed alert channel, and every
                action written to an immutable log. Forged for K-12 lockdown drills — and
                just as ready for a stadium, an office, or a hospital.
              </p>
            </div>
            <ul className="space-y-3 text-sm">
              {[
                'Lockdown, shelter-in-place, evacuation, and weather alerts',
                '3-second hold to trigger — no accidental taps',
                'Every action logged forever, viewable by admins',
                'Keeps running even if the network goes down',
              ].map((item) => (
                <li key={item} className="flex items-start gap-3 text-slate-300">
                  <span
                    aria-hidden
                    className="mt-1.5 inline-block w-1.5 h-1.5 shrink-0 rounded-full bg-indigo-400"
                  />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

// ── pricing teaser ───────────────────────────────────────────────

function PricingTeaser() {
  return (
    <section className="py-8 md:py-12">
      <div className="max-w-3xl mx-auto px-6 text-center">
        <h2 className="text-3xl md:text-4xl font-semibold tracking-tight text-slate-900">
          One price per location. No per-screen tax.
        </h2>
        <p className="mt-3 text-base md:text-lg text-slate-600">
          Unlimited screens, users, and templates on every plan — you&rsquo;re never
          charged more for adding a display. See every tier on the pricing page.
        </p>
        <div className="mt-7">
          <Link
            href="/pricing"
            className="inline-flex items-center gap-2 px-5 py-3 rounded-lg text-sm font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 transition-colors"
          >
            See pricing <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}

// ── final CTA ────────────────────────────────────────────────────

function CTA() {
  return (
    <section className="py-20 md:py-24">
      <div className="max-w-5xl mx-auto px-6">
        <div
          className="relative overflow-hidden rounded-2xl px-8 py-16 md:px-16 md:py-20 text-center"
          style={{ background: NAVY }}
        >
          <div
            aria-hidden
            className="pointer-events-none absolute left-1/2 -translate-x-1/2 -top-40 h-[520px] w-[520px]"
            style={{ background: 'radial-gradient(circle, rgba(99,102,241,0.2), transparent 64%)' }}
          />
          <div className="relative">
            <h2 className="text-3xl md:text-4xl font-semibold tracking-tight text-white">
              Put it on every screen.
            </h2>
            <p className="mt-4 text-slate-400 text-base md:text-lg max-w-xl mx-auto">
              Free pilot, any industry. Up and running in under ten minutes — no card,
              no hardware, no sales call.
            </p>
            <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
              <Link
                href="/signup"
                className="group inline-flex items-center justify-center gap-2 px-5 py-3 rounded-lg text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 transition-colors"
              >
                Start free trial
                <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
              </Link>
              <Link
                href="/help"
                className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-lg text-sm font-semibold text-white border border-[#2b3550] hover:border-[#46527a] transition-colors"
              >
                Browse help center
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
