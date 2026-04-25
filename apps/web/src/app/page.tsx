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

/**
 * Landing page — "doesn't suck" line retired, hero dashboard mockup
 * retired, features trimmed from 6 → 4 plain-English cards,
 * emergency section stripped of developer jargon.
 *
 * The hero visual is a live-rendered EduSignage template (the
 * Elementary "Rainbow" preset) embedded inside a browser-chrome
 * frame, scaled to fit via the same `scale-embed` pattern the HS
 * template gallery uses. Three tile thumbnails below the hero show
 * real templates for Elementary / Middle / High so the buyer can
 * picture their school.
 *
 * CTAs:
 *   - "Start free trial" → /signup
 *   - "See a live demo" REMOVED on 2026-04-24 by request — we
 *     don't have a walkthrough video yet and the button pointed
 *     at nothing useful. Add back once the video is produced.
 */

export const metadata = {
  title: 'EduSignage — every screen in your school, in one place',
  description:
    'One secure platform for hallway displays, cafeteria menus, classroom boards, and emergency lockdown alerts — across every screen in your district.',
};

export default function LandingPage() {
  return (
    <PublicShell>
      <Hero />
      <LogoStrip />
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
          Now with Clever rostering and SSO
        </div>
        <h1 className="font-[family-name:var(--font-fredoka)] text-5xl md:text-7xl font-semibold tracking-tight text-slate-900 leading-[1.05]">
          Every screen in your school,
          <br />
          <span className="bg-gradient-to-r from-indigo-600 via-violet-600 to-fuchsia-500 bg-clip-text text-transparent">
            in one place.
          </span>
        </h1>
        <p className="mt-6 text-lg md:text-xl text-slate-600 max-w-2xl mx-auto leading-relaxed">
          Hallway boards, cafeteria menus, lobby welcome screens, bell schedules, and lockdown
          alerts — from one dashboard any staff member can actually use.
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
          No credit card required &middot; Free for pilot schools &middot; Up in 10 minutes
        </p>

        {/* Hero template preview — live rendering of the Rainbow
            elementary template in a browser-chrome frame. The old
            page had a fake CSS-grid mockup here; this shows the
            actual product. */}
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
                edusignage.app/lincoln-es/screens/lobby
              </span>
            </div>
            {/* 16:9 aspect box. The TemplateEmbed component below
                handles sizing the iframe to a natural 1920x1080
                with a CSS transform so fonts read correctly. */}
            <TemplateEmbed src="/demo/templates/rainbow.html" title="Live preview — Rainbow Elementary" />
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * Renders a scaled template preview inside a 16:9 frame. Uses
 * the same 1920×1080 natural-size + CSS transform:scale pattern
 * that lets the template's fixed-pixel typography look correct
 * at any container width.
 */
function TemplateEmbed({ src, title }: { src: string; title: string }) {
  return (
    <div
      className="relative w-full bg-slate-950 overflow-hidden"
      style={{ aspectRatio: '16 / 9' }}
    >
      <iframe
        src={src}
        title={title}
        loading="lazy"
        className="absolute top-0 left-0 border-0"
        style={{
          width: '1920px',
          height: '1080px',
          transformOrigin: '0 0',
          // inline transform set by the tiny SSR-safe script below
        }}
      />
      {/* Tiny resize helper — scales the iframe so its 1920×1080
          render fits the parent width without cropping. Uses a
          ResizeObserver so it adapts as the container resizes. */}
      <script
        dangerouslySetInnerHTML={{
          __html: `
(function(){
  var frames = document.currentScript.parentElement;
  function fit(){
    var iframe = frames.querySelector('iframe');
    if (!iframe) return;
    var rect = frames.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    var k = Math.min(rect.width / 1920, rect.height / 1080);
    iframe.style.transform = 'scale(' + k + ')';
  }
  fit();
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(fit).observe(frames);
  } else {
    window.addEventListener('resize', fit);
  }
  setTimeout(fit, 60);
  setTimeout(fit, 400);
})();
`,
        }}
      />
    </div>
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

const GALLERY = [
  {
    src: '/demo/templates/rainbow.html',
    name: 'Rainbow',
    blurb: 'Friendly, playful — perfect for K-5 lobbies.',
    chip: 'Elementary',
    chipCls: 'bg-amber-100 text-amber-700',
  },
  {
    // v2.1 fix: was '/demo/templates/arcade.html' — but that was a
    // design mockup, not a productized React template. Swapped to
    // the actual Pep Rally MS scene (ANIMATED_WELCOME_MS), which
    // every tenant can already pick from /templates today. Honest
    // marketing — only show templates the buyer can actually use.
    src: '/demo/templates/middle-school.html',
    name: 'Pep Rally',
    blurb: 'Stadium spotlights + scoreboard clock for middle-school lobbies.',
    chip: 'Middle',
    chipCls: 'bg-sky-100 text-sky-700',
  },
  {
    src: '/demo/templates/varsity.html',
    name: 'Varsity',
    blurb: 'Athletic scoreboard energy for HS lobbies.',
    chip: 'High',
    chipCls: 'bg-fuchsia-100 text-fuchsia-700',
  },
];

function Gallery() {
  return (
    <section id="templates" className="py-12 md:py-16">
      <div className="max-w-6xl mx-auto px-6">
        <div className="text-center mb-10">
          <p className="text-xs font-bold tracking-[0.12em] uppercase text-indigo-600 mb-2">
            60+ templates, all editable
          </p>
          <h2 className="font-[family-name:var(--font-fredoka)] text-3xl md:text-5xl font-semibold tracking-tight text-slate-900">
            A look for every building.
          </h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {GALLERY.map((t) => (
            <div
              key={t.name}
              className="bg-white rounded-2xl overflow-hidden border border-slate-200 hover:border-indigo-300 hover:-translate-y-0.5 hover:shadow-[0_12px_24px_rgba(15,23,42,0.08)] transition-all"
            >
              <TemplateEmbed src={t.src} title={`${t.name} template preview`} />
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
 * Trimmed to 4 plain-English benefits (was 6 infrastructure-speak
 * cards). Every tile answers "what's in it for me?" — "Lockdown
 * in a tap" instead of "Emergency alerts, signed + logged".
 */
const FEATURES = [
  {
    icon: Shield,
    title: 'Lockdown in a tap.',
    desc:
      'Every screen in the district flips to a lockdown message within seconds. Hold-to-trigger so no one hits it by accident.',
    cls: 'from-red-500 to-rose-500',
  },
  {
    icon: Palette,
    title: '60+ templates, ready to go.',
    desc:
      'Lobbies, bell schedules, cafeteria menus, morning news. Pick one, change the text, you\u2019re done.',
    cls: 'from-indigo-500 to-violet-500',
  },
  {
    icon: Zap,
    title: 'Any screen, any classroom.',
    desc:
      'Works on a Smart TV, a Chromebook on a cart, or the touchscreen your district already bought. No new hardware.',
    cls: 'from-emerald-500 to-teal-500',
  },
  {
    icon: KeyRound,
    title: 'Logs in with what you use.',
    desc:
      'Google, Microsoft, Clever — sign-in works out of the box. Staff roster syncs automatically.',
    cls: 'from-amber-500 to-orange-500',
  },
];

function Features() {
  return (
    <section id="features" className="py-20 md:py-24">
      <div className="max-w-6xl mx-auto px-6">
        <div className="text-center mb-14">
          <p className="text-xs font-bold tracking-[0.12em] uppercase text-indigo-600 mb-2">
            Why schools pick EduSignage
          </p>
          <h2 className="font-[family-name:var(--font-fredoka)] text-3xl md:text-5xl font-semibold tracking-tight text-slate-900">
            Built for the people actually running the school.
          </h2>
          <p className="mt-4 text-lg text-slate-600 max-w-2xl mx-auto">
            Not just another signage tool — designed around the stuff a district really does every day.
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
                A hold-to-trigger panic button, a private alert channel, and every action written
                to an immutable log. Drill it on Monday morning with confidence.
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
            Free pilot for schools. Up and running in under ten minutes — no card on file, no hardware, no calls.
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
