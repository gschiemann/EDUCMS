"use client";

/**
 * /dev/playlists-mock — a STAGED render of Playlists Operations v1, for design
 * verification only.
 *
 * Why this exists: the library only looks like the approved mock when a tenant
 * has eighteen playlists in five different operational states, real screens
 * with real acknowledgement history, and one G43-shaped exception. Comparing a
 * pixel rebuild against scratch/design/playlists-page/playlists-operations-v1.png
 * needs all of that at once, on a PRODUCTION build (the dev server drops
 * responsive CSS variants, which is how a layout ships looking right only on
 * the author's machine).
 *
 * IT SEEDS THE REAL QUERY CACHE rather than stubbing components. Every hook the
 * page and the embedded classic editor call reads from React Query, so priming
 * those keys before mount makes the WHOLE surface render for real — including
 * the Content tab's drag-ordered item rows, which a stubbed editor could only
 * have faked. Nothing is mocked; the network simply never has to answer.
 *
 * NOT A PRODUCT SURFACE. Inert unless NEXT_PUBLIC_ENABLE_DEV_HARNESS is "1" at
 * build time, reads no API, writes nothing, linked from nowhere. Every number
 * below is invented.
 */

import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useUIStore } from '@/store/ui-store';
import { PlaylistLibraryV1 } from '@/components/playlists/v1/PlaylistLibraryV1';
import { PlaylistWorkspace, type WorkspaceTab } from '@/components/playlists/v1/PlaylistWorkspace';
import {
  buildPlaylistRow, deriveDeliveryFromScreens, pauseEverywhereCopy, resolveTargetScreenIds,
  type OpsGroupRef, type OpsScheduleRef, type OpsScreenRef,
} from '@/components/playlists/v1/playlistOps';
import { appConfirm, AppDialogHost } from '@/components/ui/app-dialog';

const ENABLED = process.env.NEXT_PUBLIC_ENABLE_DEV_HARNESS === '1';

const NOW = Date.now();
const MIN = 60_000;
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

// The push every screen was asked to acknowledge, 12 minutes ago.
const PUSH = NOW - 12 * MIN;

// ── Screens ──────────────────────────────────────────────────────────
function scr(id: string, name: string, over: Partial<OpsScreenRef> = {}): OpsScreenRef {
  return {
    id, name,
    status: 'ONLINE',
    screenGroupId: null,
    pendingRefreshAt: iso(PUSH),
    refreshAckMs: PUSH,
    lastRenderedAt: iso(NOW - 20_000),
    renderHealth: 'OK',
    renderStale: false,
    pushChannel: 'live',
    ...over,
  };
}

const SCREENS: OpsScreenRef[] = [
  scr('s1', 'Lobby North', { screenGroupId: 'g1' }),
  scr('s2', 'Lobby South', { screenGroupId: 'g1' }),
  scr('s3', 'Front Desk', { screenGroupId: 'g1' }),
  scr('s4', 'Cardio Wall', { screenGroupId: 'g2' }),
  scr('s5', 'Free Weights', { screenGroupId: 'g2' }),
  scr('s6', 'Studio A'),
  scr('s7', 'Studio B'),
  scr('s8', 'Juice Bar'),
  // THE EXCEPTION. Same push value stamped, never echoed back → not updated.
  scr('G43', 'G43', { refreshAckMs: null, pushChannel: 'stale' }),
  scr('s10', 'Locker Hall'),
  scr('s11', 'Turf Ribbon'),
  scr('s12', 'Kids Club'),
];

const GROUPS: OpsGroupRef[] = [
  { id: 'g1', name: 'Lobby Wall', screens: [{ id: 's1' }, { id: 's2' }, { id: 's3' }] },
  { id: 'g2', name: 'Cardio Deck', screens: [{ id: 's4' }, { id: 's5' }] },
];

// ── Playlists ────────────────────────────────────────────────────────
type Kind = 'media' | 'template';
interface Spec {
  id: string; name: string; kind: Kind; items: number; secs: number;
  state: 'active' | 'scheduled' | 'unassigned' | 'paused';
  screens?: string[]; groups?: string[];
  window?: { days?: string; from?: string; to?: string };
  startsInDays?: number;
  hq?: boolean;
  updatedMinAgo: number;
}

/** 18 playlists: 11 active (one of them the G43 exception), 3 scheduled, 3 unassigned, 1 paused. */
const SPECS: Spec[] = [
  { id: 'p1', name: 'Member Promotions', kind: 'media', items: 6, secs: 90, state: 'active', screens: ['s1', 's4'], groups: ['g1'], window: { days: 'Mon,Tue,Wed,Thu,Fri', from: '05:00', to: '22:00' }, updatedMinAgo: 18 },
  { id: 'p2', name: 'Club Welcome', kind: 'template', items: 0, secs: 0, state: 'active', screens: ['s1', 's2', 's3'], updatedMinAgo: 60 * 26 },
  { id: 'p3', name: 'Lobby Promotions', kind: 'media', items: 8, secs: 120, state: 'active', screens: ['s6', 's7', 's8', 'G43'], updatedMinAgo: 12 },
  { id: 'p4', name: 'Class Timetable', kind: 'template', items: 0, secs: 0, state: 'active', screens: ['s4', 's5'], groups: ['g2'], window: { days: 'Mon,Tue,Wed,Thu,Fri', from: '06:00', to: '21:00' }, updatedMinAgo: 60 * 5 },
  { id: 'p5', name: 'Personal Training Offers', kind: 'media', items: 4, secs: 60, state: 'active', screens: ['s10'], updatedMinAgo: 60 * 30 },
  { id: 'p6', name: 'Juice Bar Menu', kind: 'template', items: 0, secs: 0, state: 'active', screens: ['s8'], window: { days: 'Mon,Tue,Wed,Thu,Fri,Sat,Sun', from: '06:00', to: '20:00' }, updatedMinAgo: 60 * 8 },
  { id: 'p7', name: 'Corporate Brand Loop', kind: 'media', items: 5, secs: 75, state: 'active', screens: ['s11'], hq: true, updatedMinAgo: 60 * 48 },
  { id: 'p8', name: 'Kids Club Notices', kind: 'media', items: 3, secs: 45, state: 'active', screens: ['s12'], updatedMinAgo: 60 * 12 },
  { id: 'p9', name: 'Locker Room Rules', kind: 'template', items: 0, secs: 0, state: 'active', screens: ['s10'], updatedMinAgo: 60 * 72 },
  { id: 'p10', name: 'Referral Reward', kind: 'media', items: 2, secs: 30, state: 'active', screens: ['s2'], updatedMinAgo: 60 * 4 },
  { id: 'p11', name: 'Summer Challenge', kind: 'media', items: 7, secs: 105, state: 'active', groups: ['g2'], hq: true, updatedMinAgo: 60 * 9 },

  { id: 'p12', name: 'Labor Day Hours', kind: 'template', items: 0, secs: 0, state: 'scheduled', screens: ['s1', 's2'], startsInDays: 4, window: { from: '16:00' }, updatedMinAgo: 60 * 50 },
  { id: 'p13', name: 'Fall Membership Drive', kind: 'media', items: 9, secs: 135, state: 'scheduled', groups: ['g1'], startsInDays: 11, window: { from: '08:00' }, updatedMinAgo: 60 * 20 },
  { id: 'p14', name: 'Holiday Closure Notice', kind: 'media', items: 1, secs: 15, state: 'scheduled', screens: ['s6', 's7'], startsInDays: 30, window: { from: '00:00' }, updatedMinAgo: 60 * 100 },

  { id: 'p15', name: 'New Member Orientation', kind: 'media', items: 3, secs: 45, state: 'unassigned', updatedMinAgo: 60 * 168 },
  { id: 'p16', name: 'Equipment Care Tips', kind: 'media', items: 5, secs: 70, state: 'unassigned', updatedMinAgo: 60 * 200 },
  { id: 'p17', name: 'Staff Spotlight Draft', kind: 'template', items: 0, secs: 0, state: 'unassigned', updatedMinAgo: 60 * 300 },

  { id: 'p18', name: 'Trainer Spotlight', kind: 'media', items: 4, secs: 60, state: 'paused', screens: ['s4', 's5'], window: { days: 'Sat,Sun', from: '08:00', to: '18:00' }, updatedMinAgo: 60 * 170 },
];

const TEMPLATE = { id: 't1', name: 'Flagship Board', screenWidth: 1920, screenHeight: 1080, category: 'SIGNAGE', zones: [] };

const PLAYLISTS = SPECS.map((s) => ({
  id: s.id,
  name: s.name,
  templateId: s.kind === 'template' ? TEMPLATE.id : null,
  template: s.kind === 'template' ? TEMPLATE : null,
  sourcePlaylistId: s.hq ? 'hq-source' : null,
  createdBy: { id: 'u1', email: 'garlan@planetfitness.example' },
  createdAt: iso(NOW - 90 * DAY),
  updatedAt: iso(NOW - s.updatedMinAgo * MIN),
  _count: { schedules: (s.screens?.length ?? 0) + (s.groups?.length ?? 0) },
  items: Array.from({ length: s.items }, (_, i) => ({
    id: `${s.id}-i${i}`,
    assetId: `a${i}`,
    playlistId: s.id,
    durationMs: Math.round((s.secs / Math.max(1, s.items)) * 1000),
    sequenceOrder: i,
    daysOfWeek: null,
    timeStart: null,
    timeEnd: null,
    transitionType: 'FADE',
    muted: true,
    asset: {
      id: `a${i}`,
      originalName: `${s.name.toLowerCase().replace(/[^a-z]+/g, '-')}-${i + 1}.jpg`,
      mimeType: 'image/jpeg',
      fileUrl: '',
    },
  })),
}));

const SCHEDULES: OpsScheduleRef[] = SPECS.flatMap((s) => {
  const rows: OpsScheduleRef[] = [];
  const start = s.state === 'scheduled'
    ? NOW + (s.startsInDays ?? 3) * DAY
    : NOW - 30 * DAY;
  const base = {
    playlistId: s.id,
    startTime: iso(start),
    isActive: s.state !== 'paused',
    daysOfWeek: s.window?.days ?? null,
    timeStart: s.window?.from ?? null,
    timeEnd: s.window?.to ?? null,
    priority: 0,
    mode: 'replace',
  };
  for (const id of s.screens ?? []) {
    rows.push({ ...base, id: `${s.id}-sc-${id}`, screenId: id, screenGroupId: null, screen: { id, name: id } });
  }
  for (const id of s.groups ?? []) {
    const g = GROUPS.find((x) => x.id === id)!;
    rows.push({ ...base, id: `${s.id}-gr-${id}`, screenId: null, screenGroupId: id, screenGroup: { id, name: g.name ?? id } });
  }
  return rows;
});

const AUDIT = {
  items: [
    { id: 'au1', action: 'SCHEDULE_CREATED', targetId: 'p3', createdAt: iso(NOW - 12 * MIN), user: { email: 'garlan@planetfitness.example' }, details: null },
    { id: 'au2', action: 'PLAYLIST_ITEMS_REORDERED', targetId: 'p3', createdAt: iso(NOW - 40 * MIN), user: { email: 'dana@planetfitness.example' }, details: null },
    { id: 'au3', action: 'PLAYLIST_CREATED', targetId: 'p3', createdAt: iso(NOW - 9 * DAY), user: { email: 'garlan@planetfitness.example' }, details: null },
  ],
  total: 3, limit: 200, offset: 0,
};

/**
 * Prime every query key the surfaces read. Done in a state initializer so the
 * cache is warm BEFORE any child mounts — a hook that finds fresh data never
 * hits the network, and the harness needs no API at all.
 */
function useSeededCache(): boolean {
  const qc = useQueryClient();
  const [ready] = useState(() => {
    useUIStore.setState({
      user: { id: 'u1', email: 'garlan@planetfitness.example', role: 'SUPER_ADMIN', tenantId: 't1' } as never,
    });
    qc.setQueryData(['playlists'], PLAYLISTS);
    qc.setQueryData(['playlists', 'summary'], null);
    qc.setQueryData(['schedules'], SCHEDULES);
    qc.setQueryData(['screens'], SCREENS);
    qc.setQueryData(['screen-groups'], GROUPS);
    qc.setQueryData(['templates', undefined], [TEMPLATE]);
    qc.setQueryData(['assets'], []);
    qc.setQueryData(['asset-folders'], []);
    qc.setQueryData(['users'], []);
    qc.setQueryData(['screens', 'fleet'], { root: null, locations: [{ id: 't1' }], stats: {}, screens: [] });
    qc.setQueryData(['audit', { limit: 200, enabled: true }], AUDIT);
    return true;
  });
  return ready;
}

export default function PlaylistsMockHarness() {
  const ready = useSeededCache();
  const [view, setView] = useState<'library' | 'workspace'>('library');
  const [tab, setTab] = useState<WorkspaceTab>('content');

  const rows = useMemo(() => {
    const now = new Date();
    return PLAYLISTS.map((pl) =>
      buildPlaylistRow({
        playlist: pl as never,
        schedules: SCHEDULES,
        screens: SCREENS,
        groups: GROUPS,
        now,
        assetNames: pl.items.map((i) => i.asset.originalName),
      }),
    );
  }, []);

  const workspaceRow = rows.find((r) => r.id === 'p3')!;
  const workspaceSchedules = SCHEDULES.filter((s) => s.playlistId === 'p3');
  const targetScreens = useMemo(() => {
    const ids = new Set(resolveTargetScreenIds(workspaceSchedules, GROUPS, SCREENS));
    return SCREENS.filter((s) => ids.has(s.id));
  }, [workspaceSchedules]);

  if (!ENABLED) {
    return <div style={{ padding: 40, fontFamily: 'system-ui' }}>Dev harness disabled.</div>;
  }
  if (!ready) return null;

  return (
    <div style={{ background: '#FBFCFF', minHeight: '100vh' }}>
      {/* Normally mounted by DashboardLayout, which a /dev route does not use —
          without it appConfirm resolves into nothing and the pause-everywhere
          confirmation cannot be photographed. */}
      <AppDialogHost />
      <div style={{ display: 'flex', gap: 8, padding: '8px 26px', borderBottom: '1px solid #E4E8F1' }}>
        {(['library', 'workspace'] as const).map((v) => (
          <button
            key={v}
            type="button"
            data-harness-view={v}
            onClick={() => setView(v)}
            style={{
              font: '600 12px system-ui', padding: '4px 10px', borderRadius: 8,
              border: '1px solid #E4E8F1', background: view === v ? '#F0ECFF' : '#fff',
            }}
          >
            {v}
          </button>
        ))}
        {view === 'workspace' && (['content', 'screens', 'schedule'] as const).map((t) => (
          <button
            key={t}
            type="button"
            data-harness-tab={t}
            onClick={() => setTab(t)}
            style={{
              font: '600 12px system-ui', padding: '4px 10px', borderRadius: 8,
              border: '1px solid #E4E8F1', background: tab === t ? '#F0ECFF' : '#fff',
            }}
          >
            {t}
          </button>
        ))}
      </div>

      <div style={{ padding: '20px 26px 60px', maxWidth: 1426, margin: '0 auto' }}>
        {view === 'library' ? (
          <PlaylistLibraryV1
            rows={rows}
            rawById={new Map(PLAYLISTS.map((p) => [p.id, p]))}
            templateLookup={{ [TEMPLATE.id]: { zones: [], screenWidth: 1920, screenHeight: 1080, bgColor: '#1b1140' } }}
            loading={false}
            error={false}
            onRetry={() => {}}
            onOpen={() => setView('workspace')}
            onReviewDelivery={() => { setView('workspace'); setTab('screens'); }}
            onNew={() => {}}
            onDuplicate={() => {}}
            onExport={() => {}}
            onRemove={() => {}}
            onPublishToLocations={() => {}}
            onSwitchClassic={() => {}}
            isViewer={false}
            isContributor={false}
            isHQ
            creatorOptions={['garlan@planetfitness.example']}
            screenOptions={SCREENS.map((s) => ({ id: s.id, name: s.name ?? s.id }))}
            groupOptions={GROUPS.map((g) => ({ id: g.id, name: g.name ?? g.id }))}
            groupOfScreen={new Map(SCREENS.map((s) => [s.id, s.screenGroupId ?? null]))}
            deliveryDerived
          />
        ) : (
          <PlaylistWorkspace
            row={workspaceRow}
            loading={false}
            notFound={false}
            tab={tab}
            onTab={setTab}
            onToggleSync={() => {}}
            syncPending={false}
            // The harness stubs the editor, so there is no publish sheet to
            // open here — the tab switch is the half of it this mock can show.
            onAddScreens={() => setTab('schedule')}
            screenRows={targetScreens.map((s) => ({
              id: s.id, name: s.name ?? s.id, online: s.status === 'ONLINE',
              scheduleId: `sc-${s.id}`, viaGroupName: null, active: true,
            }))}
            onToggleScreen={() => {}}
            onRemoveScreen={() => {}}
            onBack={() => setView('library')}
            editor={<HarnessEditor tab={tab} />}
            exportControl={null}
            ruleCount={workspaceSchedules.length}
            targetScreens={targetScreens}
            delivery={{ payload: undefined, loading: false, derived: true, onRetry: () => {} }}
            deliverySummary={deriveDeliveryFromScreens(targetScreens)}
            onPauseEverywhere={() => {
              const copy = pauseEverywhereCopy(workspaceRow.name, workspaceRow.reach, workspaceSchedules.length);
              void appConfirm({
                title: copy.title, message: copy.message,
                confirmLabel: copy.confirmLabel, cancelLabel: 'Cancel', tone: 'danger',
              });
            }}
            onResumeEverywhere={() => {}}
            pausePending={false}
            onRefreshScreen={() => {}}
            refreshingScreenId={null}
            onOpenScreen={() => {}}
            isViewer={false}
          />
        )}
      </div>
    </div>
  );
}

/**
 * The Content / Publishing panels mount the production classic editor, which
 * needs the whole tenant graph. The harness seeds that graph above, but the
 * editor also owns its own page-level chrome and mutations — so for the
 * screenshot it renders this faithful stand-in of the two panels' SHAPE. The
 * chrome around it (header, exception summary, tab strip) is the real
 * component, unmodified.
 */
function HarnessEditor({ tab }: { tab: WorkspaceTab }) {
  const items = PLAYLISTS.find((p) => p.id === 'p3')!.items;
  if (tab === 'schedule') {
    return (
      <div style={{ background: '#fff', border: '1px solid #E4E8F1', borderRadius: 14, padding: 18 }}>
        <p style={{ font: '700 11px system-ui', letterSpacing: '.06em', color: '#7B87A4', textTransform: 'uppercase' }}>
          Publishing rules
        </p>
        {SCHEDULES.filter((s) => s.playlistId === 'p3').map((s) => (
          <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid #F1F4F9' }}>
            <div>
              <p style={{ font: '700 14px system-ui', color: '#111A3A' }}>{s.screen?.name ?? s.screenGroup?.name}</p>
              <p style={{ font: '400 12px system-ui', color: '#7B87A4' }}>Always · Replace current content</p>
            </div>
            <span style={{ font: '700 11px system-ui', color: '#047857', background: '#ECFDF5', border: '1px solid #A7F3D0', borderRadius: 6, padding: '3px 8px' }}>
              PLAYING NOW
            </span>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div style={{ background: '#fff', border: '1px solid #E4E8F1', borderRadius: 14, padding: 18 }}>
      <p style={{ font: '700 11px system-ui', letterSpacing: '.06em', color: '#7B87A4', textTransform: 'uppercase' }}>
        {items.length} items · 2:00
      </p>
      {items.map((it, i) => (
        <div key={it.id} style={{ display: 'flex', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #F1F4F9' }}>
          <span style={{ font: '700 12px system-ui', color: '#7B87A4', width: 24 }}>{i + 1}</span>
          <div style={{ width: 56, height: 32, background: '#EEF2FF', borderRadius: 6, marginRight: 12 }} />
          <span style={{ font: '600 13px system-ui', color: '#111A3A', flex: 1 }}>{it.asset.originalName}</span>
          <span style={{ font: '600 12px system-ui', color: '#536181' }}>{Math.round(it.durationMs / 1000)}s</span>
        </div>
      ))}
    </div>
  );
}
