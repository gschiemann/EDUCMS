import Link from 'next/link';
import {
  Shield,
  MonitorPlay,
  Sparkles,
  ArrowRight,
  Palette,
  Zap,
  KeyRound,
} from 'lucide-react';
import { PublicShell } from '@/components/marketing/PublicShell';
import { TemplateEmbed } from '@/components/marketing/TemplateEmbed';

/**
 * VenueOS landing page.
 *
 * 2026-05-16 — rebranded from school-only to universal CMS. VenueOS
 * runs digital signage, kiosks, and emergency alerts for ANY venue:
 * K-12 schools, restaurants, retail, gyms, healthcare, hotels, bars,
 * corporate. K-12 still leads every section — it's the proven pilot
 * and the strongest emergency-alert story — but the page no longer
 * reads as a school-only product. New "Industries" section makes the
 * multi-vertical coverage explicit; gallery + copy span industries.
 *
 * CTAs:
 *   - "Start free trial" → /signup
 *   - "Explore help center" → /help
 */

export const metadata = {
  title: 'VenueOS — every screen, every venue, in one place',
  description:
    'One platform for digital signage, interactive kiosks, and emergency alerts — across K-12 schools, restaurants, retail, gyms, healthcare, hotels, and corporate venues.',
};

export default function LandingPage() {
  return (
    <PublicShell>
      <Hero />
      <LogoStrip />
      <Industries />
      <Gallery />
      <Features />
      <EmergencyCallout />
      <PricingTeaser />
      <CTA />
    </PublicShell>
  );
}

function Hero() {
  return (
    <section className="relative pt-20 pb-24 md:pt-28 md:pb-32">
      <div className="max-w-6xl mx-auto px-6 text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white border border-slate-200 shadow-sm text-xs font-medium text-slate-600 mb-8">
          <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
          One CMS for every industry
        </div>
        <h1 className="font-[family-name:var(--font-fredoka)] text-5xl md:text-7xl font-semibold tracking-tight text-slate-900 leading-[1.05]">
          Every screen in your venue,
          <br />
          <span className="bg-gradient-to-r from-indigo-600 via-violet-600 to-fuchsia-500 bg-clip-text text-transparent">
            in one place.
          </span>
        </h1>
        <p className="mt-6 text-lg md:text-xl text-slate-600 max-w-2xl mx-auto leading-relaxed">
          Digital signage, interactive kiosks, and emergency alerts — for K-12 schools,
          restaurants, retail, gyms, clinics, hotels, and offices. One dashboard anyone
          on your team can run.
        </p>
        <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link
            href="/signup"
            className="group inline-flex items-center gap-2 px-6 py-3.5 rounded-2xl text-sm font-semibold text-white bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 shadow-xl shadow-indigo-500/25 transition"
          >
            Start free trial
            <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
          </Link>
          <Link
            href="/help"
            className="inline-flex items-center gap-2 px-6 py-3.5 rounded-2xl text-sm font-semibold text-slate-700 bg-white border border-slate-200 hover:border-slate-300 hover:bg-slate-50 transition"
          >
            Explore help center
          </Link>
        </div>
        <p className="mt-5 text-xs text-slate-500">
          No credit card required &middot; Free pilot, any industry &middot; Up in 10 minutes
        </p>

        {/* Hero template preview — a live VenueOS template in a
            browser-chrome frame. TemplateEmbed sizes the 1920×1080
            render with a CSS transform; on mobile it shows the
            staticImage so Safari never has to composite a live
            animated iframe. */}
        <div className="mt-16 relative mx-auto max-w-5xl">
          <div
            aria-hidden
            className="absolute -inset-8 -z-10 rounded-[40px]"
            style={{
              background:
                'radial-gradient(ellipse 60% 50% at 30% 40%, rgba(99,102,241,.18), transparent 70%), radial-gradient(ellipse 50% 40% at 80% 60%, rgba(217,70,239,.16), transparent 70%)',
              filter: 'blur(40px)',
            }}
          />
          <div className="rounded-2xl overflow-hidden border border-slate-200 bg-white shadow-[0_24px_60px_-12px_rgba(15,23,42,0.25)]">
            <div className="h-9 bg-slate-100/80 border-b border-slate-200 flex items-center gap-1.5 px-4">
              <span className="w-2.5 h-2.5 rounded-full bg-red-300" />
              <span className="w-2.5 h-2.5 rounded-full bg-amber-300" />
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-300" />
              <span className="ml-3 text-[11px] text-slate-500 font-mono">
                venueos.app/your-venue/screens/lobby
              </span>
            </div>
            <TemplateEmbed
              src="/demo/templates/rainbow.html"
              staticImage="/demo/templates/rainbow.jpg"
              title="Live preview — VenueOS template"
              eager
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function LogoStrip() {
  return (
    <section className="py-10">
      <div className="max-w-5xl mx-auto px-6">
        <p className="text-center text-xs font-semibold tracking-wider uppercase text-slate-500 mb-8">
          Trusted across schools, restaurants, gyms &amp; retail
        </p>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-6 opacity-70">
          {['Lincoln USD', 'Northgate Market', 'Iron & Oak Fitness', 'Harbor Health', 'Summit Hotels'].map((d) => (
            <div
              key={d}
              className="flex items-center justify-center text-sm font-[family-name:var(--font-fredoka)] font-semibold text-slate-500 text-center"
            >
              {d}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/**
 * Industries — the explicit "VenueOS is universal" statement. K-12 is
 * the first, emphasized card (proven pilot, leads the story); the
 * rest follow. Each maps to a real Tenant.vertical the product
 * supports, with its own template pack.
 */
const INDUSTRIES: Array<{ emoji: string; name: string; blurb: string; lead?: boolean }> = [
  { emoji: '🎓', name: 'K-12 Schools', blurb: 'Hallway boards, bell schedules, cafeteria menus — and lockdown alerts on every screen.', lead: true },
  { emoji: '🍔', name: 'Restaurants & QSR', blurb: 'Drive-thru and counter menu boards, LTOs, combos, loyalty.' },
  { emoji: '🍽️', name: 'Full-Service Dining', blurb: 'Menus, wine lists, prix-fixe, the 86 board — updated live.' },
  { emoji: '🛍️', name: 'Retail', blurb: 'Promos, pricing, lookbooks, seasonal campaigns across stores.' },
  { emoji: '👗', name: 'Fashion & Boutique', blurb: 'Editorial lookbooks, runway loops, fitting-room displays.' },
  { emoji: '🏋️', name: 'Gyms & Fitness', blurb: 'Class schedules, training boards, member promos.' },
  { emoji: '🏥', name: 'Healthcare', blurb: 'Waiting-room info, wayfinding, patient and visitor comms.' },
  { emoji: '🏨', name: 'Hotels & Hospitality', blurb: 'Lobby welcome, events, concierge boards, wayfinding.' },
  { emoji: '🏢', name: 'Corporate', blurb: 'Lobby screens, conference-room signs, internal comms, KPIs.' },
  { emoji: '🍺', name: 'Bars & Nightlife', blurb: 'Tap lists, cocktail menus, happy hour, game day, trivia.' },
];

function Industries() {
  return (
    <section id="industries" className="py-16 md:py-20">
      <div className="max-w-6xl mx-auto px-6">
        <div className="text-center mb-12">
          <p className="text-xs font-bold tracking-[0.12em] uppercase text-indigo-600 mb-2">
            One platform, every industry
          </p>
          <h2 className="font-[family-name:var(--font-fredoka)] text-3xl md:text-5xl font-semibold tracking-tight text-slate-900">
            Built for your industry.
          </h2>
          <p className="mt-4 text-lg text-slate-600 max-w-2xl mx-auto">
            Templates, widgets, and workflows tuned to how each kind of venue
            actually runs — starting with the K-12 districts we were built for.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {INDUSTRIES.map((ind) => (
            <div
              key={ind.name}
              className={`rounded-2xl border p-6 transition-all hover:-translate-y-0.5 ${
                ind.lead
                  ? 'border-indigo-300 bg-gradient-to-br from-indigo-50 to-violet-50 shadow-md'
                  : 'border-slate-200 bg-white hover:border-indigo-200 hover:shadow-md'
              }`}
            >
              <div className="flex items-center gap-3">
                <span className="text-3xl leading-none" aria-hidden>{ind.emoji}</span>
                <h3 className="font-[family-name:var(--font-fredoka)] font-semibold text-slate-900 text-lg">
                  {ind.name}
                </h3>
                {ind.lead && (
                  <span className="ml-auto shrink-0 text-[10px] font-bold tracking-wider uppercase px-2 py-1 rounded-md bg-indigo-600 text-white">
                    Flagship
                  </span>
                )}
              </div>
              <p className="mt-3 text-sm text-slate-600 leading-relaxed">{ind.blurb}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const GALLERY = [
  {
    src: '/demo/templates/rainbow.html',
    staticImage: '/demo/templates/rainbow.jpg',
    name: 'Elementary Lobby',
    blurb: 'Friendly, playful welcome board for K-5 schools.',
    chip: 'K-12',
    chipCls: 'bg-amber-100 text-amber-700',
  },
  {
    src: '/templates/signage/qsr/01-drive-thru-flagship.html',
    staticImage: '/demo/templates/qsr-drive-thru.jpg',
    name: 'Drive-Thru Menu',
    blurb: 'Quick-service menu board with combos and live pricing.',
    chip: 'Restaurant',
    chipCls: 'bg-orange-100 text-orange-700',
  },
  {
    src: '/templates/signage/fashion/01-lookbook-flagship.html',
    staticImage: '/demo/templates/fashion-lookbook.jpg',
    name: 'Boutique Lookbook',
    blurb: 'Editorial lookbook display for fashion retail.',
    chip: 'Fashion',
    chipCls: 'bg-fuchsia-100 text-fuchsia-700',
  },
];

function Gallery() {
  return (
    <section id="templates" className="py-12 md:py-16">
      <div className="max-w-6xl mx-auto px-6">
        <div className="text-center mb-10">
          <p className="text-xs font-bold tracking-[0.12em] uppercase text-indigo-600 mb-2">
            170+ templates, every industry
          </p>
          <h2 className="font-[family-name:var(--font-fredoka)] text-3xl md:text-5xl font-semibold tracking-tight text-slate-900">
            A look for every space.
          </h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {GALLERY.map((t) => (
            <div
              key={t.name}
              className="bg-white rounded-2xl overflow-hidden border border-slate-200 hover:border-indigo-300 hover:-translate-y-0.5 hover:shadow-[0_12px_24px_rgba(15,23,42,0.08)] transition-all"
            >
              <TemplateEmbed
                src={t.src}
                staticImage={t.staticImage}
                title={`${t.name} template preview`}
              />
              <div className="px-5 py-4 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="font-[family-name:var(--font-fredoka)] font-semibold text-slate-900 text-lg">
                    {t.name}
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">{t.blurb}</p>
                </div>
                <span className={`shrink-0 text-[10px] font-bold tracking-wider uppercase px-2 py-1 rounded-md ${t.chipCls}`}>
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

/**
 * 4 plain-English benefits. Every tile answers "what's in it for me?"
 * Lockdown leads — it's the K-12-born differentiator and a universal
 * venue-safety story.
 */
const FEATURES = [
  {
    icon: Shield,
    title: 'Emergency alert in a tap.',
    desc:
      'Every screen in the venue flips to a lockdown, evacuation, or weather message within seconds. Hold-to-trigger so no one fires it by accident.',
    cls: 'from-red-500 to-rose-500',
  },
  {
    icon: Palette,
    title: 'Templates for every industry.',
    desc:
      'Schools, restaurants, gyms, retail, healthcare, hotels. Pick one, change the text, recolor it to your brand — you’re done.',
    cls: 'from-indigo-500 to-violet-500',
  },
  {
    icon: Zap,
    title: 'Any screen, anywhere.',
    desc:
      'Works on a Smart TV, a cheap Android stick, or the touchscreen you already own. No proprietary hardware to buy.',
    cls: 'from-emerald-500 to-teal-500',
  },
  {
    icon: KeyRound,
    title: 'Logs in with what you use.',
    desc:
      'Google, Microsoft, SSO — sign-in works out of the box. K-12 districts get Clever rostering with staff sync built in.',
    cls: 'from-amber-500 to-orange-500',
  },
];

function Features() {
  return (
    <section id="features" className="py-20 md:py-24">
      <div className="max-w-6xl mx-auto px-6">
        <div className="text-center mb-14">
          <p className="text-xs font-bold tracking-[0.12em] uppercase text-indigo-600 mb-2">
            Why teams pick VenueOS
          </p>
          <h2 className="font-[family-name:var(--font-fredoka)] text-3xl md:text-5xl font-semibold tracking-tight text-slate-900">
            Built for the people actually running the place.
          </h2>
          <p className="mt-4 text-lg text-slate-600 max-w-2xl mx-auto">
            Not just another signage tool — designed around the stuff a real
            venue does every day.
          </p>
        </div>
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="group relative rounded-3xl bg-white border border-slate-200 p-7 shadow-sm hover:shadow-xl hover:-translate-y-0.5 transition-all"
            >
              <div
                className={`w-11 h-11 rounded-2xl bg-gradient-to-br ${f.cls} flex items-center justify-center shadow-lg`}
              >
                <f.icon className="w-5 h-5 text-white" strokeWidth={2.25} />
              </div>
              <h3 className="mt-5 font-[family-name:var(--font-fredoka)] text-xl font-semibold text-slate-900">
                {f.title}
              </h3>
              <p className="mt-2 text-sm text-slate-600 leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function EmergencyCallout() {
  return (
    <section className="py-16">
      <div className="max-w-6xl mx-auto px-6">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 p-10 md:p-16 text-white shadow-2xl">
          <div aria-hidden className="absolute -top-20 -right-20 w-80 h-80 rounded-full bg-red-500/20 blur-3xl" />
          <div aria-hidden className="absolute -bottom-20 -left-20 w-80 h-80 rounded-full bg-indigo-500/20 blur-3xl" />
          <div className="relative grid md:grid-cols-2 gap-10 items-center">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-red-500/20 border border-red-400/30 text-xs font-semibold">
                <Shield className="w-3.5 h-3.5" />
                Built for safety
              </div>
              <h2 className="mt-5 font-[family-name:var(--font-fredoka)] text-4xl md:text-5xl font-semibold tracking-tight leading-tight">
                When seconds matter,
                <br />
                it doesn&apos;t miss.
              </h2>
              <p className="mt-5 text-slate-300 text-base leading-relaxed max-w-lg">
                A hold-to-trigger panic button, a private alert channel, and every action
                written to an immutable log. Forged for K-12 lockdown drills — and just
                as ready for an office, a hotel, or a hospital. Drill it Monday morning
                with confidence.
              </p>
            </div>
            <ul className="space-y-3 text-sm">
              {[
                'Lockdown, shelter-in-place, evacuation, and weather alerts',
                '3-second hold to trigger — no accidental taps',
                'Every action logged forever, viewable by admins',
                'Keeps running even if the network goes down',
                'Tested with real-world drill scenarios',
              ].map((item) => (
                <li key={item} className="flex items-start gap-3 text-slate-200">
                  <span
                    aria-hidden
                    className="mt-1.5 inline-block w-2 h-2 shrink-0 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]"
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

function PricingTeaser() {
  return (
    <section className="py-20">
      <div className="max-w-4xl mx-auto px-6 text-center">
        <h2 className="font-[family-name:var(--font-fredoka)] text-4xl md:text-5xl font-semibold tracking-tight text-slate-900">
          Fair pricing. No screen taxes.
        </h2>
        <p className="mt-4 text-lg text-slate-600">
          One price per location. Unlimited screens, users, and templates. See all tiers on the pricing page.
        </p>
        <div className="mt-8">
          <Link
            href="/pricing"
            className="inline-flex items-center gap-2 px-6 py-3.5 rounded-2xl text-sm font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 transition"
          >
            See pricing <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}

function CTA() {
  return (
    <section className="py-24">
      <div className="max-w-4xl mx-auto px-6 text-center">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-500 to-violet-600 p-12 md:p-16 shadow-2xl shadow-indigo-500/30">
          <div aria-hidden className="absolute -top-16 -right-16 w-64 h-64 rounded-full bg-white/10 blur-2xl" />
          <MonitorPlay className="w-12 h-12 mx-auto text-white/90" strokeWidth={1.75} />
          <h2 className="mt-6 font-[family-name:var(--font-fredoka)] text-4xl md:text-5xl font-semibold tracking-tight text-white">
            Ready to light up your venue?
          </h2>
          <p className="mt-4 text-white/90 text-lg max-w-xl mx-auto">
            Free pilot for any industry. Up and running in under ten minutes — no card on file, no hardware, no calls.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/signup"
              className="inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-2xl text-sm font-semibold text-indigo-700 bg-white hover:bg-slate-50 shadow-lg transition"
            >
              Start free trial <ArrowRight className="w-4 h-4" />
            </Link>
            <Link
              href="/help"
              className="inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-2xl text-sm font-semibold text-white bg-white/10 hover:bg-white/20 border border-white/20 transition"
            >
              Browse help articles
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
