"use client";

/**
 * /dev/assets-mock — a STAGED render of the Media Library, for design
 * verification only.
 *
 * Why this exists: the page only looks like itself with a real library
 * behind it — folders with counts and timestamps, mixed media at mixed
 * aspect ratios, a pending-review asset, a protected one, a total bigger
 * than the loaded window, and live usage data on the asset you open. Getting
 * all of that at once against a PRODUCTION build (the dev server drops
 * responsive CSS variants) is what lets the render be compared with
 * scratch/design/assets-menu/media-library-v1-calm.png.
 *
 * It seeds the React Query cache and then mounts the REAL page — no forked
 * copy of the component, so what gets screenshotted is what ships.
 *
 * NOT A PRODUCT SURFACE. Inert unless NEXT_PUBLIC_ENABLE_DEV_HARNESS is "1"
 * at build time; it reads no API, writes nothing, and is linked from
 * nowhere. Every number and filename below is invented.
 */

import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import AssetsPage from '@/app/[schoolId]/assets/page';
import type { AssetUsage } from '@/hooks/use-api';

const ENABLED = process.env.NEXT_PUBLIC_ENABLE_DEV_HARNESS === '1';

const NOW = Date.now();
const HOUR = 3_600_000;
const ago = (h: number) => new Date(NOW - h * HOUR).toISOString();

// Real files from public/ so the tiles carry real pixels at real aspect
// ratios — the uncropped-thumbnail claim can't be graded off grey boxes.
const IMG = (p: string) => `/templates/_thumbs/${p}`;

const UPLOADERS = [
  { id: 'u1', email: 'marketing@garlangroup.com' },
  { id: 'u2', email: 'ops@garlangroup.com' },
  { id: 'u3', email: 'coach.dana@garlangroup.com' },
];

type Row = Record<string, unknown>;

let n = 0;
function asset(over: Row = {}): Row {
  n += 1;
  return {
    id: `asset-${n}`,
    originalName: `Untitled-${n}.jpg`,
    fileUrl: IMG('signage/gym/03-welcome-poster.png'),
    mimeType: 'image/png',
    fileSize: 1_100_000 + n * 7_000,
    status: 'PUBLISHED',
    folderId: null,
    createdAt: ago(n * 3),
    uploadedBy: UPLOADERS[n % UPLOADERS.length],
    processingMeta: { processedDimensions: { w: 1920, h: 1080 } },
    ...over,
  };
}

const FEATURED: Row[] = [
  asset({ originalName: 'Recovery-Lounge-August.jpg', mimeType: 'image/jpeg', fileUrl: IMG('signage/gym/01-floor-board-flagship.png'), fileSize: 1_258_291, createdAt: ago(2) }),
  asset({ originalName: 'Club-Floor-Hero.jpg', mimeType: 'image/jpeg', fileUrl: IMG('signage/gym/02-leaderboard.png'), fileSize: 1_678_000, createdAt: ago(5) }),
  asset({ originalName: 'PEPF-Training.jpg', mimeType: 'image/jpeg', fileUrl: IMG('signage/gym/05-welcome-locker-room.png'), fileSize: 1_120_000, createdAt: ago(9) }),
  asset({ originalName: 'Summer-Strength-v12.png', fileUrl: IMG('signage/gym/leaderboard-v1-champion-wall-landscape.png'), fileSize: 1_400_000, createdAt: ago(12) }),
  asset({ originalName: 'Hydration-Reminder.mp4', mimeType: 'video/mp4', fileUrl: '/demo/hydration.mp4', fileSize: 12_400_000, createdAt: ago(15), processingMeta: null }),
  asset({ originalName: 'Member-Welcome.pdf', mimeType: 'application/pdf', fileUrl: '/demo/media-library-sample.pdf', fileSize: 2_300_000, createdAt: ago(20), processingMeta: null }),
  // A PORTRAIT board — the tile must letterbox it, never crop it.
  asset({ originalName: 'Locker-Room-Portrait.png', fileUrl: IMG('signage/gym/leaderboard-v2-finish-line-portrait.png'), fileSize: 980_000, createdAt: ago(24), processingMeta: { processedDimensions: { w: 1080, h: 1920 } } }),
  asset({ originalName: 'Black-Card-Perks.jpg', mimeType: 'image/jpeg', fileUrl: IMG('signage/qsr/04-lto-promo.png'), fileSize: 1_300_000, createdAt: ago(28) }),
  asset({ originalName: 'Club-Events-August.png', fileUrl: IMG('signage/qsr/02-counter-menu.png'), fileSize: 1_200_000, createdAt: ago(31) }),
  asset({ originalName: 'Trainer-Tips-01.mp4', mimeType: 'video/mp4', fileUrl: '/demo/trainer-tips.mp4', fileSize: 28_700_000, createdAt: ago(34), processingMeta: null }),
  // The three states that change what the operator can do.
  asset({ originalName: 'New-Member-Flyer-DRAFT.png', fileUrl: IMG('signage/qsr/05-combos-deals.png'), fileSize: 890_000, createdAt: ago(1), status: 'PENDING_APPROVAL' }),
  asset({ originalName: 'Lockdown-Instructions.png', fileUrl: IMG('signage/qsr/03-order-ready.png'), fileSize: 640_000, createdAt: ago(400), protectedEmergency: true }),
  asset({ originalName: 'Front-Desk-Playlist-Bed.mp3', mimeType: 'audio/mpeg', fileUrl: '/demo/bed.mp3', fileSize: 4_200_000, createdAt: ago(40), processingMeta: null }),
  asset({ originalName: 'https://garlangroup.com/hours', mimeType: 'text/html', fileUrl: 'https://garlangroup.com/hours', fileSize: null, createdAt: ago(44), processingMeta: null }),
];

// Fill out the first window to 50 rows so the footer has a real
// "loaded vs total" story to tell.
const FILLER: Row[] = Array.from({ length: 50 - FEATURED.length }, (_, i) =>
  asset({
    originalName: `Club-Promo-${String(i + 1).padStart(2, '0')}.png`,
    fileUrl: IMG(i % 2 === 0 ? 'signage/qsr/06-beverages.png' : 'signage/gym/04-welcome-split-duo.png'),
    createdAt: ago(48 + i * 4),
  }),
);

const ASSETS = [...FEATURED, ...FILLER];
const TOTAL = 148;

const FOLDER_SPEC: Array<[string, number, number]> = [
  // name, file count, hours since last update
  ['Campaigns', 42, 48],
  ['Club photography', 28, 24],
  ['Social promos', 18, 72],
  ['Training', 13, 120],
  ['Brand library', 11, 168],
  ['Front desk', 9, 200],
  ['Group fitness', 8, 260],
  ['Hiring', 6, 300],
  ['Member events', 5, 340],
  ['Seasonal', 4, 400],
  ['Signage archive', 3, 460],
  ['Sponsors', 2, 520],
];
const FOLDERS = FOLDER_SPEC.map(([name, files, hours], i) => ({
  id: `folder-${i + 1}`,
  name,
  parentId: null,
  createdAt: ago(hours + 200),
  updatedAt: ago(hours),
  _count: { assets: files, children: 0 },
}));

// Live usage for the first asset — the detail modal's headline section and
// the in-use deletion block both read this.
const USAGE_IN_USE: AssetUsage = {
  playlists: [
    { id: 'pl-1', name: 'Summer Strength', itemCount: 6, scheduled: true, activeNow: true, screensReached: 4 },
    { id: 'pl-2', name: 'Lobby Rotation', itemCount: 12, scheduled: true, activeNow: true, screensReached: 3 },
    { id: 'pl-3', name: 'Member Welcome', itemCount: 3, scheduled: false, activeNow: false, screensReached: 1 },
  ],
  totals: { playlists: 3, screensReached: 8, locations: 2 },
  protectedEmergency: false,
};
const USAGE_UNUSED: AssetUsage = {
  playlists: [],
  totals: { playlists: 0, screensReached: 0, locations: 0 },
  protectedEmergency: false,
};

export default function AssetsMockHarness() {
  const qc = useQueryClient();
  const [seeded, setSeeded] = useState(false);

  useEffect(() => {
    if (!ENABLED) return;
    // Same key shape useAssets({ take: 50 }) builds.
    qc.setQueryData(['assets', 'page', { take: 50, skip: undefined, q: undefined }], {
      assets: ASSETS,
      total: TOTAL,
    });
    qc.setQueryData(['asset-folders'], FOLDERS);
    ASSETS.forEach((a, i) => {
      qc.setQueryData(['asset-usage', a.id], i === 0 ? USAGE_IN_USE : USAGE_UNUSED);
    });
    setSeeded(true);
  }, [qc]);

  if (!ENABLED) return null;

  return (
    <div className="min-h-dvh bg-slate-50 flex">
      {/* Geometry stand-in for the real md:w-72 sidebar so the content
          column is the width it is in production. Deliberately blank: this
          harness stages the Media Library, not the app chrome. */}
      <div className="hidden md:block w-72 shrink-0 bg-white border-r border-slate-200">
        <p className="p-4 text-[10px] uppercase tracking-wider text-slate-300">sidebar — not part of this harness</p>
      </div>
      <main className="flex-1 overflow-y-auto p-4 sm:p-6 md:p-8">
        <div className="max-w-7xl mx-auto space-y-6 md:space-y-8">
          {seeded ? <AssetsPage /> : null}
        </div>
      </main>
    </div>
  );
}
