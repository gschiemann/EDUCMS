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
import { TemplateEmbed } from './TemplateEmbed';
import { VERTICAL_ICONS } from '@/lib/vertical-icons';

interface Industry {
  vertical: Vertical;
  emoji: string;
  name: string;
  tagline: string;
  pitch: string;
  benefits: string[];
  /** A flagship template to preview for this industry. */
  template: { src: string; staticImage?: string; label: string };
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
    template: {
      src: '/demo/templates/rainbow.html',
      staticImage: '/demo/templates/rainbow.jpg',
      label: 'Animated Rainbow — Elementary Welcome',
    },
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
    template: {
      src: '/templates/hs/ath-broadcast.html',
      staticImage: '/demo/templates/sports-broadcast.jpg',
      label: 'Scoreboard & Standings',
    },
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
    template: {
      src: '/templates/signage/qsr/01-drive-thru-flagship.html',
      staticImage: '/demo/templates/qsr-drive-thru.jpg',
      label: 'Drive-Thru Menu Board',
    },
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
    template: {
      src: '/templates/signage/menus-pos/01-fullservice-menu.html',
      staticImage: '/demo/templates/restaurant-menu.jpg',
      label: 'Full-Service Menu',
    },
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
    template: {
      src: '/templates/signage/fashion/03-sale.html',
      staticImage: '/demo/templates/retail-sale.jpg',
      label: 'Seasonal Sale Board',
    },
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
    template: {
      src: '/templates/signage/fashion/01-lookbook-flagship.html',
      staticImage: '/demo/templates/fashion-lookbook.jpg',
      label: 'Boutique Lookbook',
    },
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
    template: {
      src: '/templates/fitness/01-stadium.html',
      staticImage: '/demo/templates/fitness-stadium.jpg',
      label: 'Gym Floor Board',
    },
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
    template: {
      src: '/templates/signage/healthcare/01-waiting-room-flagship.html',
      staticImage: '/demo/templates/healthcare-waiting.jpg',
      label: 'Waiting-Room Board',
    },
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
    template: {
      src: '/templates/signage/hospitality/03-events-board.html',
      staticImage: '/demo/templates/hospitality-events.jpg',
      label: 'Events & Catering Board',
    },
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
    template: {
      src: '/templates/signage/corporate/01-lobby-welcome-flagship.html',
      staticImage: '/demo/templates/corporate-lobby.jpg',
      label: 'Lobby & Comms Board',
    },
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
    template: {
      src: '/templates/signage/bar/01-tap-list-flagship.html',
      staticImage: '/demo/templates/bar-taplist.jpg',
      label: 'Tap List',
    },
  },
];

export function IndustryShowcase() {
  const [selected, setSelected] = useState<Vertical>('K12');
  const active = INDUSTRIES.find((i) => i.vertical === selected) || INDUSTRIES[0];
  const ActiveIcon = VERTICAL_ICONS[active.vertical];
  const templates = VERTICAL_TEMPLATE_CATEGORIES[active.vertical]
    .filter((c) => c.key)
    .map((c) => c.label);

  return (
    <section id="industries" className="py-20 md:py-24">
      <div className="max-w-6xl mx-auto px-6">
        <div className="text-center mb-10">
          <p className="text-xs font-semibold tracking-[0.14em] uppercase text-indigo-600 mb-2">
            One platform, every industry
          </p>
          <h2 className="text-3xl md:text-4xl font-semibold tracking-tight text-slate-900">
            Built for the way your venue runs.
          </h2>
          <p className="mt-3 text-base md:text-lg text-slate-600 max-w-2xl mx-auto">
            Pick yours — see the templates, the workflow, and the benefits tuned
            to how that kind of venue actually runs.
          </p>
        </div>

        {/* mobile — a compact horizontal chip strip. The 11-card grid
            scrolled forever and pushed the preview off-screen; a one-row
            strip keeps the picker tiny so the live preview below updates
            in place the instant you tap an industry. */}
        <div className="md:hidden flex gap-2 overflow-x-auto pb-2 -mx-6 px-6">
          {INDUSTRIES.map((ind) => {
            const isSelected = ind.vertical === selected;
            const Icon = VERTICAL_ICONS[ind.vertical];
            return (
              <button
                key={ind.vertical}
                type="button"
                onClick={() => setSelected(ind.vertical)}
                aria-pressed={isSelected}
                className={`shrink-0 inline-flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-sm font-semibold transition-colors ${
                  isSelected
                    ? 'border-indigo-600 bg-indigo-600 text-white'
                    : 'border-slate-200 bg-white text-slate-600'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" strokeWidth={2} />
                {ind.name}
              </button>
            );
          })}
        </div>

        {/* desktop — the full card grid */}
        <div className="hidden md:grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {INDUSTRIES.map((ind) => {
            const isSelected = ind.vertical === selected;
            const Icon = VERTICAL_ICONS[ind.vertical];
            return (
              <button
                key={ind.vertical}
                type="button"
                onClick={() => setSelected(ind.vertical)}
                aria-pressed={isSelected}
                className={`text-left rounded-xl border p-5 transition-all ${
                  isSelected
                    ? 'border-indigo-500 bg-indigo-50 ring-1 ring-indigo-500'
                    : 'border-slate-200 bg-white hover:border-indigo-300 hover:-translate-y-0.5'
                }`}
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border ${
                      isSelected ? 'border-indigo-200 bg-white' : 'border-slate-200 bg-slate-50'
                    }`}
                  >
                    <Icon className="w-5 h-5 text-indigo-600" strokeWidth={1.75} />
                  </span>
                  <h3 className="font-semibold tracking-tight text-slate-900 text-base">
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
        <div className="mt-6 rounded-2xl border border-slate-200 bg-white overflow-hidden">
          <div className="grid md:grid-cols-[1fr_1.05fr]">
            {/* left — pitch, benefits, CTA */}
            <div className="p-7 md:p-9">
              <div className="flex items-center gap-3">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-indigo-100 bg-indigo-50">
                  <ActiveIcon className="w-6 h-6 text-indigo-600" strokeWidth={1.75} />
                </span>
                <div>
                  <h3 className="text-2xl font-semibold tracking-tight text-slate-900">
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
              <div className="mt-5 flex flex-wrap gap-1.5">
                {templates.map((t) => (
                  <span
                    key={t}
                    className="text-[11px] font-semibold px-2.5 py-1 rounded-md bg-slate-100 text-slate-600"
                  >
                    {t}
                  </span>
                ))}
              </div>
              <Link
                href={`/signup?vertical=${active.vertical}`}
                className="group mt-6 inline-flex items-center gap-2 px-5 py-3 rounded-lg text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 transition-colors"
              >
                Start your free {active.name} trial
                <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
              </Link>
            </div>

            {/* preview — first on mobile so tapping a chip shows the
                template change right away; right column on desktop */}
            <div className="order-first md:order-none p-5 md:p-7 bg-[#fafbfc] border-b md:border-b-0 md:border-l border-slate-200 flex flex-col">
              <p className="text-xs font-semibold tracking-[0.14em] uppercase text-indigo-600 mb-3">
                A ready-made {active.name} template
              </p>
              <div className="rounded-xl overflow-hidden border border-slate-200 shadow-sm bg-slate-950">
                <TemplateEmbed
                  key={active.template.src}
                  src={active.template.src}
                  staticImage={active.template.staticImage}
                  title={`${active.template.label} template preview`}
                  eager
                />
              </div>
              <p className="mt-3 text-sm font-semibold text-slate-700">{active.template.label}</p>
              <p className="mt-0.5 text-xs text-slate-500 leading-relaxed">
                One of 170+ templates — fully editable: change the text, recolor it to
                your brand, drop it on a screen.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
