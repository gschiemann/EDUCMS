"use client";

/**
 * /dev/templates-mock — a STAGED render of the Templates gallery, for
 * design verification only.
 *
 * Why this exists: the gallery only looks like itself with a real tenant
 * catalog behind it — a dozen owned boards with MIXED usage (one live on
 * three screens, one idle, one broken), thirty presets across categories,
 * and a non-K12 vertical so the vertical-aware chips are exercised.
 * Verifying the Calm v1 rebuild against the operator's approved mock
 * (scratch/design/templates-page/templates-gallery-v1-calm.png) needs all
 * of that at once, on a PRODUCTION build — the dev server drops
 * responsive CSS variants, which is how a previous pass shipped a layout
 * that only looked right on the author's machine.
 *
 * The page seeds React Query and the UI store SYNCHRONOUSLY, before the
 * gallery mounts, so no request is ever made: `useTemplates` and
 * `useTemplateUsageSummary` find fresh cache entries inside their
 * staleTime and never call the API.
 *
 * NOT A PRODUCT SURFACE. It is inert unless NEXT_PUBLIC_ENABLE_DEV_HARNESS
 * is "1" at build time, it reads no API, writes nothing, and is linked
 * from nowhere. Every name and number below is invented.
 */

import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useUIStore } from '@/store/ui-store';
import { AppDialogHost } from '@/components/ui/app-dialog';
import TemplatesPage, { TemplateUsageImpactDialog } from '@/app/[schoolId]/templates/page';

const ENABLED = process.env.NEXT_PUBLIC_ENABLE_DEV_HARNESS === '1';

const NOW = Date.now();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const iso = (ms: number) => new Date(NOW - ms).toISOString();

type Zone = {
  id: string; name: string; widgetType: string;
  x: number; y: number; width: number; height: number; defaultConfig?: any;
};

/**
 * Real artwork per card, with no network fetch: a headline + kicker
 * rendered by the ACTUAL TEXT widget over the template's own gradient.
 *
 * `content` is the key WidgetRenderer reads. An earlier pass of this
 * fixture used `text`, and every card in the verification screenshot said
 * "Your text here" — which is what a fixture looks like when it guesses
 * at a contract instead of reading it.
 */
function zones(kind: 'text' | 'board' | 'none', i: number, headline: string, kicker: string): Zone[] {
  if (kind === 'none') return [];
  if (kind === 'board') {
    return [{
      id: `z-${i}`, name: 'Board', widgetType: 'EXTERNAL_HTML',
      x: 0, y: 0, width: 100, height: 100,
      defaultConfig: { url: '/templates/fitness/gym-media-pulsecast.html' },
    }];
  }
  return [
    {
      id: `z-${i}-a`, name: 'Headline', widgetType: 'TEXT',
      x: 6, y: 16, width: 74, height: 44,
      defaultConfig: {
        content: headline, fontSize: 230, bold: true, alignment: 'left',
        color: '#ffffff', lineHeight: 0.95,
      },
    },
    {
      id: `z-${i}-b`, name: 'Kicker', widgetType: 'TEXT',
      x: 6, y: 64, width: 66, height: 14,
      defaultConfig: { content: kicker, fontSize: 92, alignment: 'left', color: '#ffd200' },
    },
  ];
}

const PURPLE = 'linear-gradient(135deg, #2a0f6b 0%, #1a0940 100%)';
const DARK = 'linear-gradient(135deg, #14121c 0%, #241a3d 100%)';

/** 12 tenant-owned templates with deliberately mixed operational state. */
const OWNED = [
  { name: 'Club Welcome',       head: 'WELCOME TO\nPLANET FITNESS', kick: 'Judgement Free Zone',   cat: 'LOBBY',   edited: 18 * MIN,  bg: PURPLE, kind: 'text'  as const },
  { name: 'Summer Strength',    head: 'SUMMER\nSTRENGTH',           kick: 'Starts here',           cat: 'PROMO',   edited: 26 * HOUR, bg: DARK,   kind: 'text'  as const },
  { name: 'Member Events',      head: 'MEMBER\nEVENTS',             kick: 'This month at the club', cat: 'PROMO',  edited: 3 * DAY,   bg: DARK,   kind: 'text'  as const },
  { name: 'Hydration Reminder', head: 'STAY\nHYDRATED',             kick: 'Drink water. Feel better.', cat: 'FITNESS', edited: 7 * DAY, bg: PURPLE, kind: 'text' as const, portrait: true },
  { name: 'New Year Challenge', head: '',                           kick: '',                      cat: 'PROMO',   edited: 9 * DAY,   bg: PURPLE, kind: 'board' as const },
  { name: 'Class Timetable',    head: 'CLASS\nTIMETABLE',           kick: 'Studio 1 · Studio 2',   cat: 'FITNESS', edited: 12 * DAY,  bg: DARK,   kind: 'text'  as const },
  { name: 'Front Desk Notices', head: 'FRONT DESK\nNOTICES',        kick: 'Today at the club',     cat: 'LOBBY',   edited: 14 * DAY,  bg: PURPLE, kind: 'text'  as const },
  { name: 'Protein Bar Menu',   head: 'PROTEIN\nBAR',               kick: 'Shakes · Smoothies',    cat: 'LOBBY',   edited: 21 * DAY,  bg: DARK,   kind: 'text'  as const },
  { name: 'Personal Training',  head: 'PERSONAL\nTRAINING',         kick: 'Book a free session',   cat: 'FITNESS', edited: 24 * DAY,  bg: PURPLE, kind: 'text'  as const },
  { name: 'Locker Room Rules',  head: 'LOCKER\nROOM',               kick: 'Please keep it tidy',   cat: 'LOBBY',   edited: 30 * DAY,  bg: DARK,   kind: 'text'  as const },
  { name: 'Guest Pass Offer',   head: 'BRING A\nFRIEND',            kick: 'Free guest pass',       cat: 'PROMO',   edited: 45 * DAY,  bg: PURPLE, kind: 'text'  as const },
  // The §10.5 case: a saved layout with no zones. A screen running this
  // shows nothing, so the card must say "Needs attention" AND
  // "Preview unavailable" while keeping its management actions.
  { name: 'Draft — Spring Promo', head: '', kick: '',                cat: 'PROMO',   edited: 55 * MIN,  bg: DARK,   kind: 'none'  as const },
];

// Real GYM taxonomy keys (packages/api-types verticals.ts): LOBBY /
// PROMO / FITNESS / KIOSK. Using the tenant's ACTUAL category keys is the
// point — a fixture with invented keys would render chips the real
// gallery never shows, and the "no empty categories" rule would be
// untested.
const PRESET_NAMES = [
  ['Front Desk Welcome', 'LOBBY'], ['Class Schedule', 'FITNESS'],
  ['Trainer Spotlight', 'FITNESS'], ['Holiday Hours', 'PROMO'],
  ['Member of the Month', 'FITNESS'], ['New Equipment', 'PROMO'],
  ['Group Fitness Grid', 'FITNESS'], ['Smoothie Bar', 'LOBBY'],
  ['Referral Offer', 'PROMO'], ['Club Rules', 'LOBBY'],
  ['Open Gym Hours', 'LOBBY'], ['Personal Training Promo', 'PROMO'],
  ['Challenge Leaderboard', 'FITNESS'], ['Supplement Menu', 'LOBBY'],
  ['Locker Availability', 'LOBBY'], ['Weekend Events', 'PROMO'],
  ['Nutrition Tips', 'FITNESS'], ['Guest Policy', 'LOBBY'],
  ['Summer Bootcamp', 'FITNESS'], ['Recovery Room', 'FITNESS'],
  ['Protein Shake Bar', 'LOBBY'], ['Membership Tiers', 'PROMO'],
  ['Class Cancelled', 'FITNESS'], ['Staff Directory', 'LOBBY'],
  ['Anniversary Sale', 'PROMO'], ['Hydration Station', 'FITNESS'],
  ['Charity Ride', 'PROMO'], ['Juice Bar Specials', 'LOBBY'],
  ['Check-in Kiosk', 'KIOSK'], ['Class Sign-up Kiosk', 'KIOSK'],
] as const;

function buildTemplates() {
  const owned = OWNED.map((t, i) => ({
    id: `tpl-${i}`,
    name: t.name,
    description: '',
    category: t.cat,
    schoolLevel: 'UNIVERSAL',
    orientation: t.portrait ? 'PORTRAIT' : 'LANDSCAPE',
    screenWidth: t.portrait ? 1080 : 1920,
    screenHeight: t.portrait ? 1920 : 1080,
    isSystem: false,
    status: 'ACTIVE',
    bgColor: '#1a0940',
    bgGradient: t.bg,
    bgImage: null,
    zones: zones(t.kind, i, t.head, t.kick),
    _count: { zones: zones(t.kind, i, t.head, t.kick).length, playlists: i === 0 ? 2 : i === 1 ? 4 : i === 3 ? 1 : 0 },
    createdAt: iso(90 * DAY),
    updatedAt: iso(t.edited),
  }));

  const presets = PRESET_NAMES.map(([name, cat], i) => ({
    id: `preset-${i}`,
    name,
    description: '',
    category: cat,
    schoolLevel: 'UNIVERSAL',
    orientation: 'LANDSCAPE',
    screenWidth: 1920,
    screenHeight: 1080,
    isSystem: true,
    status: 'ACTIVE',
    bgColor: '#1a0940',
    bgGradient: i % 2 ? DARK : PURPLE,
    bgImage: null,
    zones: zones('text', 100 + i, name.toUpperCase().replace(/ /, '\n'), 'Planet Fitness'),
    _count: { zones: 2, playlists: 0 },
    createdAt: iso(120 * DAY),
    updatedAt: iso(120 * DAY),
  }));

  return [...owned, ...presets];
}

/**
 * Mixed usage, on purpose:
 *   tpl-0  LIVE · 3 screens  + used by 2 playlists  (the proven case)
 *   tpl-1  LIVE · 6 screens  + used by 4 playlists
 *   tpl-3  used by 1 playlist, NOT proven live      (no status pill)
 *   tpl-2  Not in use                               (proven empty)
 *   tpl-4… absent from the map → also "Not in use"
 */
const USAGE: Record<string, { playlists: number; screensReached: number; activeNow: boolean }> = {
  'tpl-0': { playlists: 2, screensReached: 3, activeNow: true },
  'tpl-1': { playlists: 4, screensReached: 6, activeNow: true },
  'tpl-2': { playlists: 0, screensReached: 0, activeNow: false },
  'tpl-3': { playlists: 1, screensReached: 0, activeNow: false },
};

export default function TemplatesMockPage() {
  const qc = useQueryClient();

  // Seed synchronously, during the first render, so the gallery's own
  // hooks find fresh cache on mount and never hit the network. (An effect
  // would run AFTER the children mount, which is a request.)
  useState(() => {
    if (!ENABLED) return null;
    useUIStore.setState({
      token: 'harness',
      user: {
        id: 'u-harness',
        email: 'garlan@example.com',
        role: 'SUPER_ADMIN',
        firstName: 'Garlan',
        lastName: 'Group',
        tenantId: 't-harness',
        tenantSlug: 'planet-fitness',
        tenantName: 'Planet Fitness',
        tenantVertical: 'GYM',
      },
    } as any);
    qc.setQueryData(['templates', undefined], buildTemplates());
    qc.setQueryData(['templates', 'usage-summary'], USAGE);
    // Quiet the gallery's incidental queries so the harness makes no
    // requests at all (they don't affect the layout either way).
    qc.setQueryData(['branding', 'me'], { palette: { primary: '#3515E8', accent: '#FFD200' } });
    qc.setQueryData(['assets'], []);
    qc.setQueryData(['playlists'], []);
    qc.setQueryData(['asset-folders'], []);
    qc.setQueryData(['screens'], []);
    return null;
  });

  if (!ENABLED) return null;

  // ?impact=1 renders the §11.3 dialog with a 409-shaped payload. It is
  // the REAL exported component with the REAL server contract — the only
  // thing staged is the response, because the harness never calls an API
  // and so can never provoke a genuine 409.
  //
  // Read behind a mounted gate, never inline: an inline `typeof window`
  // check renders false on the server and true on the client, which is a
  // hydration mismatch (React #418) — the exact class of bug the player's
  // `bootMounted` two-pass gate exists to prevent, and it showed up in
  // the WebKit verification console until this was fixed.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const showImpact = mounted
    && new URLSearchParams(window.location.search).get('impact') === '1';

  // Mirrors the dashboard's <main> content box so measurements taken here
  // match the real page (the app shell itself is unchanged by this wave).
  return (
    <div className="min-h-dvh bg-slate-50 font-sans text-slate-900">
      {/* The gallery's confirmations go through appConfirm/appAlert, which
          need this host — DashboardLayout mounts it in the real app. */}
      <AppDialogHost />
      <div className="mx-auto max-w-[1400px] px-6 py-6">
        <div className="space-y-6">
          <TemplatesPage />
        </div>
      </div>
      {showImpact && (
        <TemplateUsageImpactDialog
          impact={{
            template: { id: 'tpl-0', name: 'Club Welcome' },
            playlists: [
              { id: 'p1', name: 'Morning Loop' },
              { id: 'p2', name: 'Front Desk Rotation' },
            ],
            screensReached: 3,
            locations: 1,
          }}
          onClose={() => {}}
          onReviewUsage={() => {}}
        />
      )}
    </div>
  );
}
