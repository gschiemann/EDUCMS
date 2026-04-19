import Link from 'next/link';
import {
  Shield,
  LayoutGrid,
  MonitorPlay,
  Hand,
  KeyRound,
  Users,
  Sparkles,
  ArrowRight,
  CheckCircle2,
  Zap,
  Bell,
} from 'lucide-react';
import { PublicShell } from '@/components/marketing/PublicShell';

export const metadata = {
  title: 'EduSignage — K-12 digital signage that doesn\'t suck',
  description:
    'Secure, real-time signage, emergency alerts, and classroom displays for K-12 districts. Built for safety and easy enough for teachers.',
};

export default function LandingPage() {
  return (
    <PublicShell>
      <Hero />
      <LogoStrip />
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
          Now with Clever rostering and SSO
        </div>
        <h1 className="font-[family-name:var(--font-fredoka)] text-5xl md:text-7xl font-semibold tracking-tight text-slate-900 leading-[1.05]">
          K-12 digital signage
          <br />
          <span className="bg-gradient-to-r from-indigo-600 via-violet-600 to-fuchsia-500 bg-clip-text text-transparent">
            that doesn&apos;t suck.
          </span>
        </h1>
        <p className="mt-6 text-lg md:text-xl text-slate-600 max-w-2xl mx-auto leading-relaxed">
          One secure platform for hallway displays, cafeteria menus, classroom boards, and emergency
          lockdown alerts — across every screen in your district.
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
            href="/demo/branding"
            className="group inline-flex items-center gap-2 px-6 py-3.5 rounded-2xl text-sm font-semibold text-indigo-700 bg-white border-2 border-indigo-200 hover:border-indigo-400 hover:bg-indigo-50 transition"
          >
            <Sparkles className="w-4 h-4" />
            Try auto-branding live
          </Link>
          <Link
            href="/help"
            className="inline-flex items-center gap-2 px-6 py-3.5 rounded-2xl text-sm font-semibold text-slate-700 bg-white border border-slate-200 hover:border-slate-300 hover:bg-slate-50 transition"
          >
            Explore help center
          </Link>
        </div>
        <p className="mt-5 text-xs text-slate-500">
          No credit card required &middot; Free for pilot schools
        </p>

        {/* Product preview */}
        <div className="mt-16 relative mx-auto max-w-4xl">
          <div className="rounded-3xl overflow-hidden border border-slate-200 bg-gradient-to-br from-slate-50 to-indigo-50 shadow-2xl shadow-indigo-500/10">
            <div className="h-9 bg-slate-100/80 border-b border-slate-200 flex items-center gap-1.5 px-4">
              <span className="w-2.5 h-2.5 rounded-full bg-red-300" />
              <span className="w-2.5 h-2.5 rounded-full bg-amber-300" />
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-300" />
              <span className="ml-3 text-[11px] text-slate-500 font-mono">edusignage.app/lincoln-es/dashboard</span>
            </div>
            <div className="aspect-[16/9] p-6 grid grid-cols-6 grid-rows-4 gap-4 text-white">
              <div className="col-span-2 row-span-2 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-500 p-5 shadow-lg flex flex-col justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider opacity-80">Screens online</span>
                <span className="font-[family-name:var(--font-fredoka)] text-5xl font-bold">247</span>
              </div>
              <div className="col-span-2 row-span-1 rounded-2xl bg-white/90 backdrop-blur text-slate-800 p-4 shadow-md">
                <div className="text-[10px] font-bold uppercase text-indigo-500">Bell Schedule</div>
                <div className="font-[family-name:var(--font-fredoka)] text-xl mt-1">Period 3 &middot; 10:45</div>
              </div>
              <div className="col-span-2 row-span-1 rounded-2xl bg-white/90 backdrop-blur text-slate-800 p-4 shadow-md">
                <div className="text-[10px] font-bold uppercase text-emerald-500">Lunch Menu</div>
                <div className="font-[family-name:var(--font-fredoka)] text-xl mt-1">Taco Tuesday</div>
              </div>
              <div className="col-span-4 row-span-2 rounded-2xl bg-gradient-to-br from-amber-300 to-orange-400 p-5 shadow-lg flex flex-col justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider">Daily Announcement</span>
                <span className="font-[family-name:var(--font-fredoka)] text-3xl leading-tight">
                  Go Eagles! Pep rally Friday at 2pm in the gym.
                </span>
              </div>
              <div className="col-span-2 row-span-1 rounded-2xl bg-white/90 text-slate-800 p-4 shadow-md flex items-center justify-between">
                <div>
                  <div className="text-[10px] font-bold uppercase text-sky-500">Weather</div>
                  <div className="font-[family-name:var(--font-fredoka)] text-lg mt-1">68 &deg;F Sunny</div>
                </div>
                <Zap className="w-6 h-6 text-amber-400" />
              </div>
              <div className="col-span-2 row-span-1 rounded-2xl bg-white/90 text-slate-800 p-4 shadow-md">
                <div className="text-[10px] font-bold uppercase text-violet-500">Countdown</div>
                <div className="font-[family-name:var(--font-fredoka)] text-lg mt-1">12 days to Spring Break</div>
              </div>
            </div>
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
          Trusted by pilot districts across the country
        </p>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-6 opacity-70">
          {['Lincoln USD', 'Riverbend ISD', 'Oakridge Schools', 'Summit Prep', 'Greenvalley District'].map((d) => (
            <div
              key={d}
              className="flex items-center justify-center text-sm font-[family-name:var(--font-fredoka)] font-semibold text-slate-500"
            >
              {d}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const FEATURES = [
  {
    icon: LayoutGrid,
    title: '17 signage templates',
    desc: 'Pre-built layouts for hallways, cafeterias, lobbies, bell schedules, and more. Drag-and-drop to customize.',
    color: 'from-indigo-500 to-violet-500',
  },
  {
    icon: Shield,
    title: 'Emergency alerts, signed + logged',
    desc: 'Lockdown, weather, evacuation — pushed to every screen in seconds. Every trigger immutably audit-logged.',
    color: 'from-red-500 to-rose-500',
  },
  {
    icon: Hand,
    title: 'Touchscreen-ready',
    desc: 'Interactive displays for classrooms and kiosks. Tap-through menus, wayfinding, and student portals.',
    color: 'from-amber-500 to-orange-500',
  },
  {
    icon: KeyRound,
    title: 'SSO + Clever rostering',
    desc: 'Log in with Google, Microsoft, or your district SSO. Auto-sync staff and schedules via Clever.',
    color: 'from-emerald-500 to-teal-500',
  },
  {
    icon: Users,
    title: 'Multi-tenant by design',
    desc: 'District admins manage schools. School admins manage staff. Role-based access enforced end-to-end.',
    color: 'from-sky-500 to-cyan-500',
  },
  {
    icon: Bell,
    title: 'Realtime everywhere',
    desc: 'Signed WebSocket updates with HTTP polling fallback. Screens stay in sync, even over spotty Wi-Fi.',
    color: 'from-fuchsia-500 to-pink-500',
  },
];

function Features() {
  return (
    <section id="features" className="py-24">
      <div className="max-w-6xl mx-auto px-6">
        <div className="text-center mb-16">
          <h2 className="font-[family-name:var(--font-fredoka)] text-4xl md:text-5xl font-semibold tracking-tight text-slate-900">
            Everything your district needs.
          </h2>
          <p className="mt-4 text-lg text-slate-600 max-w-2xl mx-auto">
            Signage, schedules, and safety — without stitching together six vendors.
          </p>
        </div>
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="group relative rounded-3xl bg-white border border-slate-200 p-7 shadow-sm hover:shadow-xl hover:-translate-y-0.5 transition-all"
            >
              <div
                className={`w-11 h-11 rounded-2xl bg-gradient-to-br ${f.color} flex items-center justify-center shadow-lg`}
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
                Emergency System
              </div>
              <h2 className="mt-5 font-[family-name:var(--font-fredoka)] text-4xl md:text-5xl font-semibold tracking-tight leading-tight">
                When seconds matter,
                <br />
                we don&apos;t miss.
              </h2>
              <p className="mt-5 text-slate-300 text-base leading-relaxed max-w-lg">
                Hold-to-trigger UX prevents accidents. Signed WebSocket messages prevent spoofing. A separate
                HTTP polling channel keeps screens alive even if Redis goes down. Every action is immutably
                logged.
              </p>
            </div>
            <ul className="space-y-3 text-sm">
              {[
                'Lockdown, shelter-in-place, evacuation, and weather alerts',
                '3-second hold to trigger — prevents accidental taps',
                'Signed payloads verified on every screen',
                'Immutable audit log of every trigger and all-clear',
                'HTTP polling fallback when WebSocket is unavailable',
              ].map((item) => (
                <li key={item} className="flex items-start gap-3 text-slate-200">
                  <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
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
          One price per building. Unlimited screens, users, and templates. See all tiers on the pricing page.
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
            Ready to light up your district?
          </h2>
          <p className="mt-4 text-white/90 text-lg max-w-xl mx-auto">
            Start a free pilot in under 10 minutes. No hardware required — any Chromebook or smart TV works.
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
