"use client";

/**
 * /dev/fleet-mock — a STAGED render of the HQ dashboard (Fleet Command +
 * Network Atlas), for design verification only.
 *
 * Why this exists: the surface only appears for a multi-location admin with
 * real screens, real coordinates, real push history and 24h of recorded
 * pulse samples. Verifying a pixel rebuild against the operator's approved
 * mock needs all of that at once, on a PRODUCTION build (the dev server
 * drops responsive CSS variants, which is how a previous pass shipped a
 * layout that only looked right locally). This page hands
 * FleetCommandCenter a fixture with exactly that shape so the render can be
 * screenshotted and compared side-by-side with
 * scratch/design/multi-location-dashboard/network-atlas-v1.png.
 *
 * NOT A PRODUCT SURFACE. It is inert unless NEXT_PUBLIC_ENABLE_DEV_HARNESS
 * is "1" at build time, it reads no API, writes nothing, and is linked from
 * nowhere. Every number below is invented.
 */

import { FleetCommandCenter, type FleetScheduleRow } from '@/components/dashboard/district/FleetCommandCenter';
import type {
  FleetResponse, DistrictReadinessResponse, DistrictPendingApprovals,
  DeploymentRow, FleetPulseResponse,
} from '@/hooks/use-api';

const ENABLED = process.env.NEXT_PUBLIC_ENABLE_DEV_HARNESS === '1';

const NOW = Date.now();
const MIN = 60_000;

/** A push whose value some screens have echoed back and some have not. */
const PUSH_VALUE = NOW - 18 * MIN;

type Screen = FleetResponse['screens'][number];

function scr(
  id: string,
  tenant: { id: string; name: string; slug: string },
  over: Partial<Screen> = {},
): Screen {
  return {
    id,
    name: id,
    status: 'ONLINE',
    screenGroup: null,
    lastPingAt: new Date(NOW - 20_000).toISOString(),
    lastCacheReport: { emergency: { count: 3 } },
    renderHealth: 'OK',
    renderStale: false,
    renderStaleSeconds: 12,
    effectiveLatitude: null,
    effectiveLongitude: null,
    effectiveAddress: null,
    geoSource: 'tenant',
    sourceTenant: tenant,
    lastBundleSha: 'deadbeefcafe',
    // Gradeable AND confirmed: the ack echoes the pending value exactly.
    pendingRefreshAtMs: PUSH_VALUE,
    refreshAckMs: PUSH_VALUE,
    pushChannel: 'live',
    ...over,
  } as Screen;
}

const SAC = { id: 'sac', name: 'RIOT Sacramento', slug: 'sacramento' };
const MID = { id: 'mid', name: 'Planet Fitness Midtown', slug: 'midtown' };
const DTN = { id: 'dtn', name: 'Planet Fitness Downtown', slug: 'downtown' };
const HEN = { id: 'hen', name: 'Planet Fitness Henderson', slug: 'henderson' };

const fleet: FleetResponse = {
  root: { id: 'hq', name: 'Garlan Group', slug: 'garlan', vertical: 'GYM' },
  locations: [
    { ...SAC, latitude: 38.5816, longitude: -121.4944, address: '1201 K St, Sacramento, CA 95814' },
    { ...MID, latitude: 37.9577, longitude: -121.2908, address: '450 W Weber Ave, Stockton, CA 95203' },
    { ...DTN, latitude: 35.3733, longitude: -119.0187, address: '1400 Truxtun Ave, Bakersfield, CA 93301' },
    { ...HEN, latitude: 36.0395, longitude: -114.9817, address: '240 S Water St, Henderson, NV 89015' },
    // Address, no coordinates — the server is already geocoding this one.
    { id: 'ren', name: 'Planet Fitness Reno', slug: 'reno', address: '50 N Sierra St, Reno, NV 89501' },
    // No address at all — the one case the operator has something to do about.
    { id: 'fre', name: 'Planet Fitness Fresno', slug: 'fresno' },
  ],
  stats: { total: 11, online: 10, offline: 1, locationCount: 6 },
  screens: [
    scr('G41', SAC, { effectiveLatitude: 38.5816, effectiveLongitude: -121.4944, effectiveAddress: '1201 K St, Sacramento, CA 95814' }),
    scr('G42', SAC, { effectiveLatitude: 38.5816, effectiveLongitude: -121.4944 }),
    // Behind: the ack is from an OLDER push than the one outstanding.
    scr('G43', SAC, { refreshAckMs: PUSH_VALUE - 60 * MIN, effectiveLatitude: 38.5816, effectiveLongitude: -121.4944 }),

    scr('G09', MID, { pushChannel: 'stale', effectiveLatitude: 37.9577, effectiveLongitude: -121.2908, effectiveAddress: '450 W Weber Ave, Stockton, CA 95203' }),
    scr('G10', MID, { effectiveLatitude: 37.9577, effectiveLongitude: -121.2908 }),

    scr('G01', DTN, { effectiveLatitude: 35.3733, effectiveLongitude: -119.0187, effectiveAddress: '1400 Truxtun Ave, Bakersfield, CA 93301' }),
    scr('G02', DTN, { renderHealth: 'STALE', renderStale: true, renderStaleSeconds: 1080, effectiveLatitude: 35.3733, effectiveLongitude: -119.0187 }),
    scr('G03', DTN, { effectiveLatitude: 35.3733, effectiveLongitude: -119.0187 }),

    scr('G17', HEN, { refreshAckMs: PUSH_VALUE - 40 * MIN, effectiveLatitude: 36.0395, effectiveLongitude: -114.9817, effectiveAddress: '240 S Water St, Henderson, NV 89015' }),
    scr('G18', HEN, { effectiveLatitude: 36.0395, effectiveLongitude: -114.9817 }),
    scr('G19', HEN, {
      status: 'OFFLINE',
      lastPingAt: new Date(NOW - 42 * MIN).toISOString(),
      lastCacheReport: null,
      effectiveLatitude: 36.0395,
      effectiveLongitude: -114.9817,
    }),
  ],
};

const readiness: DistrictReadinessResponse = {
  delivery: { key: 'delivery', status: 'ok', label: '', detail: '', fixHint: '' },
  schools: [
    { tenantId: 'sac', name: SAC.name, slug: SAC.slug, isSelf: false, verdict: 'READY', contentWired: 3, contentTotal: 3, lockdownWired: true, missingTypes: [], screensTotal: 3, screensOnline: 3 },
    { tenantId: 'mid', name: MID.name, slug: MID.slug, isSelf: false, verdict: 'READY', contentWired: 3, contentTotal: 3, lockdownWired: true, missingTypes: [], screensTotal: 2, screensOnline: 2 },
    { tenantId: 'dtn', name: DTN.name, slug: DTN.slug, isSelf: false, verdict: 'READY', contentWired: 3, contentTotal: 3, lockdownWired: true, missingTypes: [], screensTotal: 3, screensOnline: 3 },
    { tenantId: 'hen', name: HEN.name, slug: HEN.slug, isSelf: false, verdict: 'NEEDS_ATTENTION', contentWired: 2, contentTotal: 3, lockdownWired: true, missingTypes: ['Evacuate'], screensTotal: 3, screensOnline: 2 },
    { tenantId: 'ren', name: 'Planet Fitness Reno', slug: 'reno', isSelf: false, verdict: 'NOT_CONFIGURED', contentWired: 0, contentTotal: 3, lockdownWired: false, missingTypes: ['Lockdown', 'Evacuate'], screensTotal: 0, screensOnline: 0 },
    { tenantId: 'fre', name: 'Planet Fitness Fresno', slug: 'fresno', isSelf: false, verdict: 'NOT_CONFIGURED', contentWired: 0, contentTotal: 3, lockdownWired: false, missingTypes: ['Lockdown'], screensTotal: 0, screensOnline: 0 },
  ],
  notReadyCount: 1,
  computedAt: new Date(NOW).toISOString(),
};

const approvals: DistrictPendingApprovals = {
  total: 2,
  byTenant: [{ tenantId: 'mid', pending: 2 }],
};

const deployments: { deployments: DeploymentRow[] } = {
  deployments: [
    {
      id: 'dep-1',
      tenantId: 'sac',
      label: 'Summer Strength Campaign',
      createdAt: new Date(PUSH_VALUE).toISOString(),
      valueMs: PUSH_VALUE,
      targetCount: 11,
      convergence: { converged: 9, painting: 8, done: false },
    },
    { id: 'dep-2', tenantId: 'hen', label: 'Henderson grand-opening loop', createdAt: new Date(NOW - 3 * 60 * MIN).toISOString(), valueMs: NOW - 3 * 60 * MIN, targetCount: 3, convergence: { converged: 3, painting: 3, done: true } },
    { id: 'dep-3', tenantId: 'dtn', label: 'Downtown class schedule', createdAt: new Date(NOW - 5 * 60 * MIN).toISOString(), valueMs: NOW - 5 * 60 * MIN, targetCount: 3, convergence: { converged: 3, painting: 3, done: true } },
    { id: 'dep-4', tenantId: 'mid', label: 'Midtown promo refresh', createdAt: new Date(NOW - 9 * 60 * MIN).toISOString(), valueMs: NOW - 9 * 60 * MIN, targetCount: 2, convergence: { converged: 2, painting: 2, done: true } },
  ],
};

/** 20 hours of samples at the sampler's real 15-minute cadence. */
const pulse: FleetPulseResponse = (() => {
  const points = [];
  const locations: FleetPulseResponse['locations'] = { sac: [], mid: [], dtn: [], hen: [] };
  const N = 80;
  for (let i = 0; i < N; i++) {
    const ts = NOW - (N - 1 - i) * 15 * MIN;
    const offline = i > 62 ? 1 : i % 17 === 0 ? 1 : 0;
    const notPainting = i > 70 ? 1 : i % 11 === 0 ? 1 : 0;
    const online = 11 - offline;
    points.push({ ts, online, offline, notPainting, total: 11 });
    locations.sac.push({ ts, online: 3, total: 3 });
    locations.mid.push({ ts, online: 2, total: 2 });
    locations.dtn.push({ ts, online: 3, total: 3 });
    locations.hen.push({ ts, online: i > 62 ? 2 : 3, total: 3 });
  }
  return { fleet: points, locations };
})();

const schedule: FleetScheduleRow[] = [
  { key: 's1', name: 'Summer Strength Campaign', deviceLine: 'G41 · G42 · G43', deviceCount: 3, timeStart: '05:00', timeEnd: '22:00', isActive: true, previewUrl: null, portrait: false },
  { key: 's2', name: 'Class schedule board', deviceLine: 'G01 · G03', deviceCount: 2, timeStart: '06:00', timeEnd: '20:00', isActive: true, previewUrl: null, portrait: true },
  { key: 's3', name: 'Member spotlight reel', deviceLine: 'G09 · G10', deviceCount: 2, timeStart: '16:00', timeEnd: '21:00', isActive: false, previewUrl: null, portrait: false },
  { key: 's4', name: 'Henderson grand opening', deviceLine: 'G17 · G18 · +1 more', deviceCount: 3, timeStart: 'All day', timeEnd: '', isActive: true, previewUrl: null, portrait: false },
];

const activity = [
  { title: 'Content pushed to RIOT Sacramento', detail: 'Summer Strength Campaign', at: new Date(NOW - 18 * MIN).toISOString() },
  { title: 'G09 lost its instant connection', detail: 'Now updating on check-ins', at: new Date(NOW - 38 * MIN).toISOString() },
  { title: 'Emergency content stored on Downtown', detail: 'All screens', at: new Date(NOW - 62 * MIN).toISOString() },
  { title: 'Content revision published', detail: 'Summer Strength Campaign v2', at: new Date(NOW - 95 * MIN).toISOString() },
];

/** A tiny inline mark so the pins have a real logo, with no network fetch. */
const LOGO =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="32" fill="#4f1d96"/><rect x="14" y="27" width="36" height="10" rx="5" fill="#facc15"/><rect x="10" y="22" width="9" height="20" rx="4" fill="#facc15"/><rect x="45" y="22" width="9" height="20" rx="4" fill="#facc15"/></svg>`,
  );

export default function FleetMockPage() {
  if (!ENABLED) {
    return (
      <div className="p-8">
        <p className="text-sm font-bold text-slate-600">
          Dev harness disabled. Build with NEXT_PUBLIC_ENABLE_DEV_HARNESS=1 to render it.
        </p>
      </div>
    );
  }
  return (
    <div className="min-h-screen bg-slate-50 p-4 sm:p-6 md:p-8">
      <div className="max-w-7xl mx-auto">
        <FleetCommandCenter
          fleet={fleet}
          readiness={readiness}
          approvals={approvals}
          deployments={deployments}
          pulse={pulse}
          activity={activity}
          schedule={schedule}
          scheduleTotals={{ playing: 3, total: 4 }}
          orgName="Planet Fitness"
          logoUrl={LOGO}
          onSwitchClassic={() => {}}
          onFleetCheck={() => {}}
        />
      </div>
    </div>
  );
}
