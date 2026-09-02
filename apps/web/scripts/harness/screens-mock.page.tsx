"use client";

/**
 * /dev/screens-mock — a STAGED render of the Calm Operations v3 Screens
 * surface, for design verification only.
 *
 * Why this exists: the surface only tells its story with a fleet that has a
 * screen behind on content, one on the polling backstop, one offline, one with
 * no evidence capability, and several healthy groups that must stay collapsed.
 * Verifying the rebuild against
 * scratch/design/screens-menu/screen-operations-v3-calm.png needs all of that
 * at once, on a PRODUCTION build (the dev server drops responsive CSS
 * variants, which is how a previous pass shipped a layout that only looked
 * right locally).
 *
 * NOT A PRODUCT SURFACE. It is inert unless NEXT_PUBLIC_ENABLE_DEV_HARNESS is
 * "1" at build time, it reads no API, writes nothing, and is linked from
 * nowhere. Every number below is invented. It also lives OUTSIDE src/app —
 * `scripts/verify-screens-v3.mjs --install` copies it in for a verification
 * build and `--remove` takes it back out, because a compiled-in harness route
 * costs real production bundle bytes (the ratchet caught exactly that on
 * 2026-08-31).
 */

import { ScreenOperationsV3 } from '@/components/screens/v3/ScreenOperationsV3';
import type { OpsPlaylist, OpsSchedule, OpsScreen } from '@/components/screens/v3/screenOps';

const ENABLED = process.env.NEXT_PUBLIC_ENABLE_DEV_HARNESS === '1';

/** Pinned instant so every age in the screenshot is reproducible. */
const NOW = Date.parse('2026-08-31T17:02:41.000Z');
const MIN = 60_000;
const SHA = 'a91c4e2b77d0';

const GROUPS = [
  { id: 'sac', name: 'RIOT Sacramento' },
  { id: 'hen', name: 'RIOT Henderson' },
  { id: 'mid', name: 'RIOT Midtown' },
  { id: 'dtn', name: 'RIOT Downtown' },
];

function scr(
  id: string,
  name: string,
  group: { id: string; name: string } | null,
  over: Partial<OpsScreen> = {},
): OpsScreen {
  return {
    id,
    name,
    status: 'ONLINE',
    screenGroupId: group?.id ?? null,
    screenGroup: group ? { id: group.id, name: group.name } : null,
    lastPingAt: new Date(NOW - 12_000).toISOString(),
    renderHealth: 'OK',
    renderStale: false,
    lastRenderedAt: new Date(NOW - 24_000).toISOString(),
    lastRenderedHash: 'content:7fa2',
    lastBundleSha: SHA,
    pendingRefreshAt: null,
    pushChannel: 'live',
    lastPushConnectedAt: new Date(NOW - 40_000).toISOString(),
    authState: 'PROVEN',
    hardwareModel: 'Wall Mount',
    osInfo: 'Android 11',
    orientation: 'LANDSCAPE',
    deviceFingerprint: `fp-${id}`,
    resolution: '1920x1080',
    ...over,
  };
}

/** 11 screens across 4 locations — the handoff's own example fleet. */
const SCREENS: OpsScreen[] = [
  // RIOT Sacramento — the location that needs the operator.
  scr('g43', 'G43', GROUPS[0], {
    pendingRefreshAt: new Date(NOW - 18 * MIN).toISOString(),
  }),
  scr('m43', 'M43', GROUPS[0], {
    pushChannel: 'stale',
    lastPushConnectedAt: new Date(NOW - 42 * MIN).toISOString(),
  }),
  scr('aframe', 'Mobile A-Frame', GROUPS[0], { hardwareModel: 'Portable' }),
  // RIOT Henderson — healthy, collapsed.
  scr('hen1', 'Henderson Lobby', GROUPS[1]),
  scr('hen2', 'Henderson Cardio', GROUPS[1]),
  scr('hen3', 'Henderson Studio', GROUPS[1]),
  // RIOT Midtown — healthy, plus one panel too old to prove a picture.
  scr('mid1', 'Midtown Front Desk', GROUPS[2]),
  scr('mid2', 'Midtown Weights', GROUPS[2], {
    renderHealth: 'UNKNOWN',
    renderStale: null,
    lastRenderedAt: null,
    lastRenderedHash: null,
    lastBundleSha: null,
    hardwareModel: 'Taurus TB60',
  }),
  scr('mid3', 'Midtown Turf', GROUPS[2]),
  // RIOT Downtown — one dark panel.
  scr('dtn1', 'Downtown Lobby', GROUPS[3]),
  scr('dtn2', 'Downtown Locker Hall', GROUPS[3], {
    status: 'OFFLINE',
    lastPingAt: new Date(NOW - 3 * 3600_000 - 12 * MIN).toISOString(),
    pushChannel: 'unknown',
  }),
];

const PLAYLISTS: OpsPlaylist[] = [
  {
    id: 'pl-summer',
    name: 'Summer Strength',
    items: [{ asset: { fileUrl: '/demo/templates/fitness-stadium.jpg', mimeType: 'image/jpeg' } }],
  },
  {
    id: 'pl-lobby',
    name: 'Lobby Welcome Loop',
    items: [{ asset: { fileUrl: '/demo/templates/worship-lobby.jpg', mimeType: 'image/jpeg' } }],
  },
  // The operator's 2026-09-01 report: a playlist that IS a board, no items of
  // its own. Drew a blank grey box before previewOf learned to resolve the
  // board's poster. Real preset id + url from the fleet row that was reported.
  {
    id: 'pl-led-posters',
    name: 'LED posters',
    items: [],
    template: {
      id: 'preset-sig-gym-08-portrait',
      name: 'Gym · Leaderboard · Plate Stack — Portrait',
      zones: [{
        widgetType: 'EXTERNAL_HTML',
        defaultConfig: { url: '/templates/signage/gym/leaderboard-v3-plate-stack-portrait.html' },
      }],
    },
  },
  // Video-only — the second silent blank case (10 playlists at the time).
  {
    id: 'pl-video',
    name: 'Fitness promo reel',
    items: [{ asset: { fileUrl: '/demo/videos/promo.mp4', mimeType: 'video/mp4' } }],
  },
];

const SCHEDULES: OpsSchedule[] = GROUPS.map((g, i) => ({
  id: `sch-${g.id}`,
  playlistId: i === 3 ? 'pl-lobby' : i === 0 ? 'pl-led-posters' : i === 2 ? 'pl-video' : 'pl-summer',
  screenGroupId: g.id,
  isActive: true,
  mode: 'replace',
  priority: 0,
  startTime: new Date(NOW - 6 * 3600_000).toISOString(),
  playlist: i === 3 ? { id: 'pl-lobby', name: 'Lobby Welcome Loop' }
    : i === 0 ? { id: 'pl-led-posters', name: 'LED posters' }
    : i === 2 ? { id: 'pl-video', name: 'Fitness promo reel' }
    : { id: 'pl-summer', name: 'Summer Strength' },
}));

export default function ScreensMockPage() {
  if (!ENABLED) {
    return (
      <div className="p-10 text-sm text-slate-500">
        Dev harness disabled. Build with NEXT_PUBLIC_ENABLE_DEV_HARNESS=1 to render it.
      </div>
    );
  }
  return (
    <div className="min-h-screen bg-[#F8FAFC] p-6 lg:p-7">
      <ScreenOperationsV3
        screens={SCREENS}
        groups={GROUPS}
        schedules={SCHEDULES}
        playlists={PLAYLISTS}
        deployedSha={SHA}
        readiness={{
          known: true,
          locationsReady: 4,
          locationsTotal: 4,
          anyNotConfigured: false,
          anyNeedsAttention: false,
        }}
        isLoading={false}
        isError={false}
        onRetry={() => {}}
        canControl
        viewMode="list"
        onViewMode={() => {}}
        onPairScreen={() => {}}
        onSetGroupLocation={() => {}}
        onOpenDisplaySchedule={() => {}}
        onSwitchClassic={() => {}}
        onChanged={() => {}}
        buildPreviewHref={(s) => `/player?deviceId=${s.deviceFingerprint}&preview=1`}
        now={NOW}
      />
    </div>
  );
}
