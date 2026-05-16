'use client';

/**
 * IndustryShowcase — the interactive "every industry" section of the
 * landing page. The industry cards used to be static divs that looked
 * clickable but weren't. Now each card is a real button: clicking it
 * reveals that industry's pitch, benefits, and the template packs it
 * ships with, and deep-links into signup pre-set to that vertical.
 *
 * K-12 leads (the proven pilot, "Flagship"); Sports Venues is the
 * featured new vertical, badged with a star.
 */

import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Check } from 'lucide-react';
import { VERTICAL_TEMPLATE_CATEGORIES, type Vertical } from '@cms/api-types';

interface Industry {
  vertical: Vertical;
  emoji: string;
  name: string;
  tagline: string;
  pitch: string;
  benefits: string[];
  badge?: { label: string; cls: string };
}

const FLAGSHIP = { label: 'Flagship', cls: 'bg-indigo-600 text-white' };
const STAR = { label: '★ New', cls: 'bg-amber-400 text-amber-950' };

// K-12 first (flagship), Sports second (the featured new vertical),
// then the rest. Each maps to a real Tenant.vertical with its own
// template pack.
const INDUSTRIES: Industry[] = [
  {
    vertical: 'K12',
    emoji: '🎓',
    name: 'K-12 Schools',
    tagline: 'Districts, schools, campuses',
    pitch:
      'Every hallway, lobby, and classroom screen — plus the lockdown alert that flips all of them in seconds.',
    benefits: [
      'Bell schedules, lunch menus, and announcements that update themselves',
      'One-tap lockdown, evacuate, and weather alerts on every screen',
      'Clever rostering + SSO — staff sign in with what they already use',
    ],
    badge: FLAGSHIP,
  },
  {
    vertical: 'SPORTS',
    emoji: '🏟️',
    name: 'Sports Venues',
    tagline: 'Stadiums, arenas, gyms, athletic programs',
    pitch:
      'Real-time scoreboards, ribbon banners, and celebration animations — the whole game-day show on one platform.',
    benefits: [
      'Live scoreboards for 12 sports, run from a phone or tablet',
      'Sell sponsor banners with proof-of-play reporting built in',
      'One scorebug drives the in-venue board and your livestream overlay',
    ],
    badge: STAR,
  },
  {
    vertical: 'QSR',
    emoji: '🍔',
    name: 'Restaurants & QSR',
    tagline: 'Quick-service, drive-thru, counter',
    pitch: 'Drive-thru and counter menu boards that change price the moment you do.',
    benefits: [
      'Day-parting — breakfast flips to lunch on schedule',
      'Push an LTO or combo to every store at once',
      'Runs on the screens you already own',
    ],
  },
  {
    vertical: 'RESTAURANT',
    emoji: '🍽️',
    name: 'Full-Service Dining',
    tagline: 'Menus, wine lists, specials',
    pitch: 'Menus, wine lists, and the 86 board — updated live, no reprints.',
    benefits: [
      'Edit a price or special once, every screen updates',
      'Prix-fixe, wine, and cocktail layouts ready to go',
      'Schedule brunch, dinner, and late-night menus by time',
    ],
  },
  {
    vertical: 'RETAIL',
    emoji: '🛍️',
    name: 'Retail',
    tagline: 'Chains, big-box, specialty',
    pitch: 'Promos, pricing, and seasonal campaigns across every store.',
    benefits: [
      'Roll a sale out chain-wide in one click',
      'Lookbooks and pricing boards that stay on-brand',
      'Schedule campaigns to start and end on their own',
    ],
  },
  {
    vertical: 'FASHION',
    emoji: '👗',
    name: 'Fashion & Boutique',
    tagline: 'Apparel, runway, boutique',
    pitch: 'Editorial lookbooks and runway loops that make the floor feel like the brand.',
    benefits: [
      'Drop new arrivals to every boutique instantly',
      'Runway and lookbook layouts, recolored to your brand',
      'Fitting-room and window displays from one dashboard',
    ],
  },
  {
    vertical: 'GYM',
    emoji: '🏋️',
    name: 'Gyms & Fitness',
    tagline: 'Clubs, studios, athletic facilities',
    pitch: 'Class schedules, training boards, and member promos on every screen in the club.',
    benefits: [
      "Today's classes update themselves from your schedule",
      'Promote challenges and personal training automatically',
      'Evacuate and weather alerts for the whole facility',
    ],
  },
  {
    vertical: 'HEALTHCARE',
    emoji: '🏥',
    name: 'Healthcare',
    tagline: 'Clinics, practices, hospitals',
    pitch: 'Waiting-room info, wayfinding, and patient comms — calm, clear, current.',
    benefits: [
      'Wait times and directory boards that stay accurate',
      'Patient-education loops by department',
      'Evacuate and lockdown alerts across the practice',
    ],
  },
  {
    vertical: 'HOSPITALITY',
    emoji: '🏨',
    name: 'Hotels & Hospitality',
    tagline: 'Hotels, resorts, properties',
    pitch: 'Lobby welcome, event boards, and wayfinding for every property.',
    benefits: [
      'Personalized welcome and event screens',
      'Concierge and amenity boards, updated on the fly',
      'One dashboard across every property in the group',
    ],
  },
  {
    vertical: 'CORPORATE',
    emoji: '🏢',
    name: 'Corporate',
    tagline: 'Lobbies, conference rooms, comms',
    pitch: "Lobby screens, conference-room signs, and internal comms that don't go stale.",
    benefits: [
      'KPI dashboards and all-hands info on the lobby wall',
      'Conference-room signage synced to your calendar',
      'Push company news to every floor at once',
    ],
  },
  {
    vertical: 'BAR',
    emoji: '🍺',
    name: 'Bars & Nightlife',
    tagline: 'Bars, taprooms, nightclubs',
    pitch: 'Tap lists, cocktail menus, happy hour, and game day — all live.',
    benefits: [
      'Update what’s pouring the second the keg changes',
      'Happy-hour and event boards on a schedule',
      'Game-day mode turns every screen into the big game',
    ],
  },
];

export function IndustryShowcase() {
  const [selected, setSelected] = useState<Vertical>('K12');
  const active = INDUSTRIES.find((i) => i.vertical === selected) || INDUSTRIES[0];
  const templates = VERTICAL_TEMPLATE_CATEGORIES[active.vertical]
    .filter((c) => c.key)
    .map((c) => c.label);

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
            Pick yours — see the templates, the workflow, and the benefits tuned
            to how that kind of venue actually runs.
          </p>
        </div>

        {/* clickable industry cards */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {INDUSTRIES.map((ind) => {
            const isSelected = ind.vertical === selected;
            return (
              <button
                key={ind.vertical}
                type="button"
                onClick={() => setSelected(ind.vertical)}
                aria-pressed={isSelected}
                className={`text-left rounded-2xl border p-5 transition-all ${
                  isSelected
                    ? 'border-indigo-400 bg-gradient-to-br from-indigo-50 to-violet-50 shadow-md ring-2 ring-indigo-300'
                    : 'border-slate-200 bg-white hover:border-indigo-200 hover:shadow-md hover:-translate-y-0.5'
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className="text-3xl leading-none" aria-hidden>
                    {ind.emoji}
                  </span>
                  <h3 className="font-[family-name:var(--font-fredoka)] font-semibold text-slate-900 text-base">
                    {ind.name}
                  </h3>
                  {ind.badge && (
                    <span
                      className={`ml-auto shrink-0 text-[10px] font-bold tracking-wider uppercase px-2 py-1 rounded-md ${ind.badge.cls}`}
                    >
                      {ind.badge.label}
                    </span>
                  )}
                </div>
                <p className="mt-2 text-xs text-slate-500">{ind.tagline}</p>
              </button>
            );
          })}
        </div>

        {/* detail panel for the selected industry */}
        <div className="mt-6 rounded-3xl border border-slate-200 bg-white shadow-[0_12px_40px_rgba(15,23,42,0.07)] overflow-hidden">
          <div className="grid md:grid-cols-[1.4fr_1fr]">
            {/* left — pitch + benefits */}
            <div className="p-7 md:p-9">
              <div className="flex items-center gap-3">
                <span className="text-4xl leading-none" aria-hidden>
                  {active.emoji}
                </span>
                <div>
                  <h3 className="font-[family-name:var(--font-fredoka)] text-2xl font-semibold text-slate-900">
                    {active.name}
                  </h3>
                  <p className="text-xs text-slate-500">{active.tagline}</p>
                </div>
                {active.badge && (
                  <span
                    className={`ml-auto shrink-0 text-[10px] font-bold tracking-wider uppercase px-2 py-1 rounded-md ${active.badge.cls}`}
                  >
                    {active.badge.label}
                  </span>
                )}
              </div>
              <p className="mt-5 text-lg text-slate-700 leading-relaxed">{active.pitch}</p>
              <ul className="mt-5 space-y-2.5">
                {active.benefits.map((b) => (
                  <li key={b} className="flex items-start gap-2.5">
                    <span className="mt-0.5 shrink-0 w-5 h-5 rounded-full bg-emerald-100 flex items-center justify-center">
                      <Check className="w-3 h-3 text-emerald-600" strokeWidth={3} />
                    </span>
                    <span className="text-sm text-slate-600 leading-relaxed">{b}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* right — template packs + CTA */}
            <div className="p-7 md:p-9 bg-gradient-to-br from-slate-50 to-indigo-50/60 border-t md:border-t-0 md:border-l border-slate-200">
              <p className="text-xs font-bold tracking-[0.12em] uppercase text-indigo-600">
                Templates for {active.name}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {templates.map((t) => (
                  <span
                    key={t}
                    className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-700 shadow-sm"
                  >
                    {t}
                  </span>
                ))}
              </div>
              <p className="mt-4 text-xs text-slate-500 leading-relaxed">
                Every pack is fully editable — change the text, recolor it to your
                brand, drop it on a screen.
              </p>
              <Link
                href={`/signup?vertical=${active.vertical}`}
                className="group mt-6 inline-flex items-center gap-2 px-5 py-3 rounded-2xl text-sm font-semibold text-white bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 shadow-lg shadow-indigo-500/25 transition"
              >
                Start your free {active.name} trial
                <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
