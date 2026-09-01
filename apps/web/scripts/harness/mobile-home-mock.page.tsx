"use client";

/**
 * /dev/mobile-home-mock — a STAGED render of the phone home (§M04 Mobile
 * Fleet Command), for design verification only.
 *
 * Why this exists: the surface only appears for a multi-location admin on a
 * phone-width viewport, against a fleet that is unwell in several different
 * ways at once — which is precisely the state that is hard to reach on
 * demand and the only state worth photographing. This page hands
 * MobileFleetCommand a fixture with exactly that shape so the render can be
 * screenshotted at 360 / 390 / 430 (§7's frame table) on a PRODUCTION build.
 * The dev server drops responsive CSS variants, which is how a layout ships
 * looking right only on the author's machine.
 *
 * Three variants are rendered one under another so a single full-page shot
 * carries all of them: the fleet that needs attention, the calm fleet, and
 * the contributor's capability-reduced copy of the same screen.
 *
 * NOT A PRODUCT SURFACE. It is inert unless NEXT_PUBLIC_ENABLE_DEV_HARNESS
 * is "1" at build time, it reads no API, writes nothing, and is linked from
 * nowhere. Every number below is invented.
 */

import { MobileFleetCommand } from '@/components/dashboard/mobile/MobileFleetCommand';
import type {
  FleetResponse, DistrictReadinessResponse, DistrictPendingApprovals,
} from '@/hooks/use-api';

const ENABLED = process.env.NEXT_PUBLIC_ENABLE_DEV_HARNESS === '1';

const NOW = Date.now();
const MIN = 60_000;

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
    pushChannel: 'live',
    ...over,
  } as Screen;
}

const HQ = { id: 'hq', name: 'Iron Peak HQ', slug: 'hq' };
const WEST = { id: 'west', name: 'Peak West', slug: 'west' };
const EAST = { id: 'east', name: 'Peak East', slug: 'east' };
const NORTH = { id: 'north', name: 'Peak North', slug: 'north' };

/**
 * A fleet that is unwell in three DIFFERENT ways, so the exception ranking
 * has something to rank: West cannot display an alert at all, HQ has a
 * screen answering with no confirmed picture, North has one dark screen.
 * East is calm and must collapse into the healthy line.
 */
const troubledFleet: FleetResponse = {
  root: { id: 'hq', name: 'Iron Peak Fitness', slug: 'hq', vertical: 'GYM' },
  locations: [HQ, WEST, EAST, NORTH],
  stats: { total: 9, online: 7, offline: 2, locationCount: 4 },
  screens: [
    scr('Lobby North', HQ, { renderHealth: 'STALE', renderStale: true, renderStaleSeconds: 1080 }),
    scr('Lobby South', HQ),
    scr('Studio A', WEST),
    scr('Studio B', WEST, { status: 'OFFLINE', lastPingAt: new Date(NOW - 42 * MIN).toISOString() }),
    scr('Spin Room', WEST),
    scr('Front Desk', NORTH),
    scr('Cardio Wall', NORTH, { status: 'OFFLINE', lastPingAt: new Date(NOW - 6 * MIN).toISOString() }),
    scr('Cafe Board', EAST),
    scr('Locker Hall', EAST),
  ],
} as FleetResponse;

const troubledReadiness: DistrictReadinessResponse = {
  delivery: { key: 'delivery', status: 'ok', label: '', detail: '', fixHint: '' },
  schools: [
    { tenantId: 'hq', name: 'Iron Peak HQ', slug: 'hq', isSelf: true, verdict: 'READY', contentWired: 3, contentTotal: 3, lockdownWired: true, missingTypes: [], screensTotal: 2, screensOnline: 2 },
    { tenantId: 'west', name: 'Peak West', slug: 'west', isSelf: false, verdict: 'NOT_CONFIGURED', contentWired: 0, contentTotal: 3, lockdownWired: false, missingTypes: ['Evacuate', 'Weather'], screensTotal: 3, screensOnline: 2 },
    { tenantId: 'east', name: 'Peak East', slug: 'east', isSelf: false, verdict: 'READY', contentWired: 3, contentTotal: 3, lockdownWired: true, missingTypes: [], screensTotal: 2, screensOnline: 2 },
    { tenantId: 'north', name: 'Peak North', slug: 'north', isSelf: false, verdict: 'READY', contentWired: 3, contentTotal: 3, lockdownWired: true, missingTypes: [], screensTotal: 2, screensOnline: 1 },
  ],
  notReadyCount: 1,
  computedAt: new Date(NOW).toISOString(),
} as unknown as DistrictReadinessResponse;

const approvals = { byTenant: [{ tenantId: 'east', pending: 2 }] } as unknown as DistrictPendingApprovals;

/** Everything answering, every picture confirmed, every alert wired. */
const calmFleet: FleetResponse = {
  ...troubledFleet,
  locations: [HQ, EAST],
  stats: { total: 4, online: 4, offline: 0, locationCount: 2 },
  screens: [
    scr('Lobby North', HQ), scr('Lobby South', HQ),
    scr('Cafe Board', EAST), scr('Locker Hall', EAST),
  ],
} as FleetResponse;

const calmReadiness = {
  ...troubledReadiness,
  schools: (troubledReadiness as any).schools.filter((s: any) => s.tenantId === 'hq' || s.tenantId === 'east'),
  notReadyCount: 0,
} as unknown as DistrictReadinessResponse;

const calmApprovals = { byTenant: [] } as unknown as DistrictPendingApprovals;

const schedule = [
  { key: 's1', name: 'Morning Energy Loop', deviceLine: 'All screens', timeStart: '05:30', timeEnd: '11:00' },
  { key: 's2', name: 'Class Timetable', deviceLine: 'Studio A', timeStart: '11:00', timeEnd: '20:00' },
  { key: 's3', name: 'Member Spotlight', deviceLine: 'Lobby North', timeStart: '', timeEnd: '' },
];

const ADMIN = { upload: true, createPlaylist: true, pairScreen: true, submitOnly: false };
const CONTRIB = { upload: true, createPlaylist: true, pairScreen: false, submitOnly: true };

/** One phone-width column with the app's real mobile gutter and background. */
function Frame({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 40 }}>
      <p className="px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-slate-500 bg-slate-200">
        {label}
      </p>
      <div className="bg-slate-50 p-4">{children}</div>
    </section>
  );
}

export default function MobileHomeMockPage() {
  if (!ENABLED) return null;
  return (
    <div className="bg-slate-50 text-slate-900 font-sans min-h-dvh">
      <Frame label="M04 · needs attention (admin, 4 locations, gym vertical)">
        <MobileFleetCommand
          schoolId="hq"
          fleet={troubledFleet as never}
          readiness={troubledReadiness}
          approvals={approvals}
          firstName="Greg"
          orgName="Iron Peak Fitness"
          schedule={schedule}
          can={ADMIN}
        />
      </Frame>

      <Frame label="M04 · fleet checks passed (admin, calm)">
        <MobileFleetCommand
          schoolId="hq"
          fleet={calmFleet as never}
          readiness={calmReadiness}
          approvals={calmApprovals}
          firstName="Greg"
          orgName="Iron Peak Fitness"
          schedule={schedule.slice(0, 2)}
          can={ADMIN}
        />
      </Frame>

      <Frame label="M04 · same fleet, CONTRIBUTOR capabilities (no Pair screen)">
        <MobileFleetCommand
          schoolId="hq"
          fleet={troubledFleet as never}
          readiness={troubledReadiness}
          approvals={approvals}
          firstName="Sam"
          orgName="Iron Peak Fitness"
          schedule={null}
          can={CONTRIB}
        />
      </Frame>
    </div>
  );
}
