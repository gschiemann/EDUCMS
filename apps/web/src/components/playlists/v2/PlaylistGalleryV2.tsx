"use client";

/**
 * PlaylistGalleryV2 — the Playlists page as a gallery of what is on the
 * screens (design preview, 2026-11-02, behind `?design=v2`).
 *
 * Greg on the v1 card grid: "the playlist tiles is a ugly ass design ...
 * playlist are exciting its what on the screen so this menu needs to present
 * them very well and make it easy to find what is playing where".
 *
 *  - The content is the hero: an edge-to-edge 16:9 frame whose backdrop is the
 *    picture itself, cover-fit and blurred, with the picture shown WHOLE on
 *    top (contain) — a portrait poster stands in the frame like a poster on a
 *    wall, never a thin strip in a dark box. Nothing is cropped.
 *  - "Playing where" on every card: the groups and screens it is on right
 *    now, the rest behind one popover.
 *  - One toolbar: TabRow (status) · search · Filter (screen / group /
 *    location / orientation) · Sort — the shared primitives, the Media
 *    Library's look.
 *  - The whole card opens the playlist; everything else is under "⋯".
 *    Needs-attention is one calm line on the card, no page banner.
 *
 * Presentation only: schedule state, delivery and needs-attention come from
 * v1/playlistOps.ts; where/orientation/filtering from ./galleryModel.ts.
 * Dashboard surface (not player/widget): gap and blur are fine; the blur is a
 * static image filter inside the card, never backdrop-filter on chrome.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowUpDown, Clock, Copy, ExternalLink, Layers, Monitor, MonitorSmartphone, Pause, Play, Plus, Search, Smartphone, Trash2, Upload, Usb } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { PlaylistPreviewThumb, type TemplateLookupEntry } from '@/components/playlists/PlaylistPreviewThumb';
import { assetPosterUrl } from '@/components/playlists/VideoPreviewThumb';
import { transformedImageUrl } from '@/lib/asset-image';
import { API_URL } from '@/lib/api-url';
import { usePhoneWidth } from '@/lib/use-phone-width';
import { PageToolbar } from '@/components/ui/page-toolbar';
import { TabRow } from '@/components/ui/tab-row';
import { FilterMenu, type FilterGroup } from '@/components/ui/filter-menu';
import { OverflowMenu, type OverflowItem } from '@/components/ui/overflow-menu';
import { StatusPill } from '@/components/ui/status-pill';
import { AnchoredMenu } from '@/components/ui/anchored-menu';
import { useDismiss } from '@/components/ui/use-dismiss';
import { formatDuration, needsAttention, type OpsGroupRef, type OpsScheduleRef, type PlaylistSummaryRow } from '../v1/playlistOps';
import {
  applyGallery, countGallery, EMPTY_GALLERY_FILTERS, heroPicture, playingWhere, playlistOrientation, screenLocation,
  type ContentOrientation, type GalleryEntry, type GalleryFilters, type GalleryScreenRef, type GallerySort, type GalleryTab,
  type PlayingWhere,
} from './galleryModel';

const apiBase = API_URL.replace('/api/v1', '');

export interface PlaylistGalleryV2Props {
  rows: PlaylistSummaryRow[];
  rawById: Map<string, unknown>;
  templateLookup: Record<string, TemplateLookupEntry | undefined>;
  schedules: OpsScheduleRef[];
  screens: GalleryScreenRef[];
  groups: OpsGroupRef[];
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  onOpen: (id: string) => void;
  onReviewDelivery: (id: string) => void;
  onNew: () => void;
  onDuplicate: (id: string) => void;
  onExport: (id: string) => void;
  onRemove: (row: PlaylistSummaryRow) => void;
  onPublishToLocations?: (id: string) => void;
  onSetActive?: (row: PlaylistSummaryRow, next: boolean) => void;
  isViewer: boolean;
}

/** Same rule as v1: a press on a control inside the card never opens it. */
const CARD_CONTROL = 'button, a, input, select, textarea, label, [role="menu"], [role="menuitem"], [role="dialog"], [data-popover-panel]';

function resolvePicture(asset: any): string | null {
  const mime = String(asset?.mimeType ?? '');
  if (mime.startsWith('video/')) return assetPosterUrl(asset);
  if (!mime.startsWith('image/') || !asset?.fileUrl) return null;
  const raw = String(asset.fileUrl).startsWith('http') ? asset.fileUrl : `${apiBase}${asset.fileUrl}`;
  return transformedImageUrl(raw, { width: 640, quality: 65 });
}

export function PlaylistGalleryV2(props: PlaylistGalleryV2Props) {
  const t = useTranslations('playlistsPage.v2');
  const tUi = useTranslations('ui');
  const isPhone = usePhoneWidth();
  const { rows, loading, error, isViewer, screens, schedules, groups } = props;

  const [tab, setTab] = useState<GalleryTab>('all');
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<GalleryFilters>(EMPTY_GALLERY_FILTERS);
  const [sort, setSort] = useState<GallerySort>('playing');

  const entries: GalleryEntry[] = useMemo(() => {
    const now = new Date();
    const screenById = new Map(screens.map((s) => [s.id, s]));
    return rows.map((row) => {
      const targets = row.targetScreenIds.map((id) => screenById.get(id)).filter((s): s is GalleryScreenRef => !!s);
      return {
        row,
        orientation: playlistOrientation(props.rawById.get(row.id), targets),
        where: playingWhere(row, schedules, screens, groups, now),
        attention: needsAttention(row),
      };
    });
  }, [rows, screens, schedules, groups, props.rawById]);

  const counts = useMemo(() => countGallery(entries), [entries]);
  const visible = useMemo(
    () => applyGallery({ entries, tab, search, filters, sort, screens }),
    [entries, tab, search, filters, sort, screens],
  );
  const liveScreens = useMemo(() => {
    const ids = new Set<string>();
    for (const e of entries) if (e.where.live) e.row.targetScreenIds.forEach((id) => ids.add(id));
    return ids.size;
  }, [entries]);

  // ── Filter menu: screen · group · location · orientation ──
  const filterGroups: FilterGroup[] = useMemo(() => {
    const countFor = (pred: (e: GalleryEntry) => boolean) => entries.filter(pred).length;
    const byId = new Map(screens.map((s) => [s.id, s]));
    const locations = Array.from(new Set(screens.map(screenLocation).filter((l): l is string => !!l))).sort();
    const all = t('filterAny');
    return [
      {
        id: 'orientation', label: t('filterOrientation'), type: 'single',
        options: [
          { value: '', label: all },
          { value: 'landscape', label: t('landscape'), count: countFor((e) => e.orientation === 'landscape') },
          { value: 'portrait', label: t('portrait'), count: countFor((e) => e.orientation === 'portrait') },
        ],
      },
      {
        id: 'location', label: t('filterLocation'), type: 'single',
        options: locations.length > 1 ? [{ value: '', label: all }, ...locations.map((l) => ({
          value: l, label: l,
          count: countFor((e) => e.row.targetScreenIds.some((id) => { const s = byId.get(id); return s ? screenLocation(s) === l : false; })),
        }))] : [],
      },
      {
        id: 'group', label: t('filterGroup'), type: 'single',
        options: groups.length > 0 ? [{ value: '', label: all }, ...[...groups].sort((a, b) => String(a.name).localeCompare(String(b.name))).map((g) => ({
          value: g.id, label: g.name || g.id,
          count: countFor((e) => e.row.targetScreenIds.some((id) => byId.get(id)?.screenGroupId === g.id)),
        }))] : [],
      },
      {
        id: 'screen', label: t('filterScreen'), type: 'single',
        options: screens.length > 0 ? [{ value: '', label: all }, ...[...screens].sort((a, b) => String(a.name).localeCompare(String(b.name))).map((s) => ({
          value: s.id, label: s.name || s.id,
          count: countFor((e) => e.row.targetScreenIds.includes(s.id)),
        }))] : [],
      },
    ];
  }, [entries, screens, groups, t]);

  const clearAll = () => { setFilters(EMPTY_GALLERY_FILTERS); setSearch(''); setTab('all'); };
  const filtered = search.trim() !== '' || Object.values(filters).some(Boolean);
  // "Playing now" gets its own section at the top of All, in the default sort,
  // when nothing narrows the list — the first thing on the page is what is on
  // the screens.
  const sectioned = tab === 'all' && sort === 'playing' && !filtered;
  const playingNow = sectioned ? visible.filter((e) => e.row.scheduleState === 'ACTIVE') : [];
  const rest = sectioned ? visible.filter((e) => e.row.scheduleState !== 'ACTIVE') : visible;

  const SORTS: GallerySort[] = ['playing', 'updated', 'name', 'screens'];

  return (
    <div className="space-y-5" data-testid="playlists-v2">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">{t('title')}</h1>
          <p className="text-sm text-slate-600 mt-0.5" data-testid="library-summary">
            {loading && rows.length === 0
              ? t('loading')
              : t('summary', { count: counts.all, playing: counts.playing, screens: liveScreens })}
          </p>
        </div>
        {!isViewer && (
          <button
            type="button"
            onClick={props.onNew}
            className="inline-flex items-center gap-2 px-4 min-h-11 sm:min-h-10 rounded-lg text-sm font-semibold text-white shadow-sm"
            style={{ background: 'var(--brand-primary, #4f46e5)' }}
          >
            <Plus className="w-4 h-4" aria-hidden />
            {t('newPlaylist')}
          </button>
        )}
      </div>

      <PageToolbar
        testId="playlists-toolbar"
        compact={isPhone}
        tabs={
          <TabRow<GalleryTab>
            value={tab}
            onChange={setTab}
            ariaLabel={t('tabsAria')}
            testId="playlists-tabs"
            overflow={!isPhone}
            tabs={[
              { key: 'all', label: t('tabAll'), count: counts.all },
              { key: 'playing', label: t('tabPlaying'), count: counts.playing },
              { key: 'scheduled', label: t('tabScheduled'), count: counts.scheduled },
              { key: 'unassigned', label: t('tabUnassigned'), count: counts.unassigned },
              { key: 'attention', label: t('tabAttention'), count: counts.attention },
            ]}
          />
        }
        search={
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('searchPlaceholder')}
              aria-label={t('searchAria')}
              className="min-h-11 w-full md:w-40 min-[1440px]:w-56 rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm placeholder:text-slate-400 focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-200 md:min-h-9"
            />
          </div>
        }
        filters={
          <FilterMenu
            testId="playlists-filter-menu"
            groups={filterGroups}
            value={filters as unknown as Record<string, string>}
            onChange={(group, next) => setFilters((f) => ({ ...f, [group]: next as string }))}
            onClear={() => setFilters(EMPTY_GALLERY_FILTERS)}
          />
        }
        sort={
          <div className="relative shrink-0 min-w-11 min-h-11 md:min-h-9 rounded-lg border border-slate-200 bg-white flex items-center gap-1.5 px-2.5 text-slate-700" title={tUi('sortValue', { label: t(`sort.${sort}`) })}>
            <ArrowUpDown className="w-4 h-4" aria-hidden />
            <span className="hidden min-[1440px]:inline text-[13px] font-semibold">{t(`sort.${sort}`)}</span>
            <select
              aria-label={tUi('sortValue', { label: t(`sort.${sort}`) })}
              data-testid="playlists-sort"
              value={sort}
              onChange={(e) => setSort(e.target.value as GallerySort)}
              className="absolute top-0 left-0 w-full h-full opacity-0 cursor-pointer"
            >
              {SORTS.map((k) => <option key={k} value={k}>{t(`sort.${k}`)}</option>)}
            </select>
          </div>
        }
      />

      {error ? (
        <Empty title={t('errorTitle')} body={t('errorBody')} action={t('tryAgain')} onAction={props.onRetry} />
      ) : loading && rows.length === 0 ? (
        <CardGrid>{Array.from({ length: 6 }, (_, i) => <SkeletonCard key={i} />)}</CardGrid>
      ) : rows.length === 0 ? (
        <Empty title={t('emptyTitle')} body={t('emptyBody')} action={isViewer ? undefined : t('emptyAction')} onAction={props.onNew} />
      ) : visible.length === 0 ? (
        <Empty title={t('noMatchTitle')} body={t('noMatchBody')} action={t('clearFilters')} onAction={clearAll} />
      ) : (
        <>
          {playingNow.length > 0 && (
            <section aria-labelledby="pl-playing-now" className="space-y-3">
              <SectionHeading id="pl-playing-now" live label={t('sectionPlaying')} count={playingNow.length} />
              <CardGrid>{playingNow.map((e) => <Card key={e.row.id} entry={e} {...props} />)}</CardGrid>
            </section>
          )}
          {rest.length > 0 && (
            <section aria-labelledby="pl-rest" className="space-y-3">
              {sectioned && playingNow.length > 0 && (
                <SectionHeading id="pl-rest" label={t('sectionRest')} count={rest.length} />
              )}
              <CardGrid>{rest.map((e) => <Card key={e.row.id} entry={e} {...props} />)}</CardGrid>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function SectionHeading({ id, label, count, live }: { id: string; label: string; count: number; live?: boolean }) {
  return (
    <h2 id={id} className="flex items-center gap-2 text-[13px] font-semibold text-slate-700">
      {live && <LiveDot />}
      {label}
      <span className="text-xs tabular-nums font-normal text-slate-500">{count}</span>
    </h2>
  );
}

function CardGrid({ children }: { children: React.ReactNode }) {
  return (
    <ul className="grid grid-cols-1 min-[640px]:grid-cols-2 min-[1100px]:grid-cols-3 min-[1600px]:grid-cols-4 gap-4 list-none p-0 m-0">
      {children}
    </ul>
  );
}

function LiveDot({ small, warn }: { small?: boolean; warn?: boolean }) {
  const tone = warn ? 'bg-amber-500 ring-amber-500/25' : 'bg-emerald-500 ring-emerald-500/25';
  return <span aria-hidden className={`inline-block shrink-0 rounded-full ${tone} ${small ? 'w-1.5 h-1.5 ring-2' : 'w-2 h-2 ring-[3px]'}`} />;
}

function OrientationIcon({ orientation, className }: { orientation: ContentOrientation; className?: string }) {
  const Icon = orientation === 'portrait' ? Smartphone : orientation === 'landscape' ? Monitor : MonitorSmartphone;
  return <Icon className={className} aria-hidden />;
}

// ─────────────────────────────────────────────────────────────────────
// The card
// ─────────────────────────────────────────────────────────────────────

function Card({ entry, ...p }: { entry: GalleryEntry } & PlaylistGalleryV2Props) {
  const t = useTranslations('playlistsPage.v2');
  const { row, where, orientation, attention } = entry;
  const raw = p.rawById.get(row.id) as any;
  const open = () => p.onOpen(row.id);
  const isActive = row.scheduleState === 'ACTIVE';
  const canToggle = !!p.onSetActive && !p.isViewer && row.scheduleState !== 'UNASSIGNED'
    && row.statusLabel !== 'PREPARING 1080P' && row.statusLabel !== 'MEDIA FAILED';

  const items: OverflowItem[] = [
    { id: 'open', label: t('menuOpen'), icon: <ExternalLink className="w-3.5 h-3.5" aria-hidden />, onSelect: open },
    {
      id: 'toggle', hidden: !canToggle,
      label: isActive ? t('menuStop') : t('menuStart'),
      icon: isActive ? <Pause className="w-3.5 h-3.5" aria-hidden /> : <Play className="w-3.5 h-3.5" aria-hidden />,
      onSelect: () => p.onSetActive?.(row, !isActive),
    },
    { id: 'dup', label: t('menuDuplicate'), hidden: p.isViewer, icon: <Copy className="w-3.5 h-3.5" aria-hidden />, onSelect: () => p.onDuplicate(row.id) },
    { id: 'usb', label: t('menuUsb'), icon: <Usb className="w-3.5 h-3.5" aria-hidden />, onSelect: () => p.onExport(row.id) },
    { id: 'publish', label: t('menuPublishLocations'), hidden: !p.onPublishToLocations || p.isViewer, icon: <Upload className="w-3.5 h-3.5" aria-hidden />, onSelect: () => p.onPublishToLocations?.(row.id) },
    { id: 'remove', label: t('menuRemove'), hidden: p.isViewer, separated: true, icon: <Trash2 className="w-3.5 h-3.5 text-rose-600" aria-hidden />, onSelect: () => p.onRemove(row) },
  ];

  const contentLine = row.kind === 'template'
    ? t('template')
    : row.itemCount === 0 ? t('noContent') : t('itemsDuration', { count: row.itemCount, duration: formatDuration(row.durationMs) });

  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions
    <li
      data-testid="playlist-card-v2"
      data-state={row.scheduleState}
      data-orientation={orientation}
      onClick={(e) => {
        const el = e.target as Element | null;
        if (el?.closest?.(CARD_CONTROL) && !el.closest('[data-card-open]')) return;
        open();
      }}
      className="group relative bg-white rounded-2xl border border-slate-200 overflow-hidden cursor-pointer transition-shadow hover:shadow-lg hover:border-slate-300 focus-within:ring-2 focus-within:ring-indigo-400"
    >
      <Hero raw={raw} row={row} orientation={orientation} templateLookup={p.templateLookup} contentLine={contentLine} live={where.live} warn={attention} />

      <div className="px-4 pt-3 pb-3.5">
        <div className="flex items-start gap-2">
          <button
            type="button"
            data-card-open
            onClick={(e) => { e.stopPropagation(); open(); }}
            className="flex-1 min-w-0 text-left text-[15px] font-semibold text-slate-900 truncate focus:outline-none"
            title={row.name}
          >
            {row.name}
          </button>
          <div className="-mr-2 -mt-1.5 shrink-0">
            <OverflowMenu items={items} ariaLabel={t('moreFor', { name: row.name })} testId="card-more" />
          </div>
        </div>
        <WhereLine entry={entry} />
        {attention && (
          <p className="mt-2 flex items-start gap-1.5 text-[12.5px] text-amber-800" data-testid="card-attention">
            <AlertTriangle className="w-3.5 h-3.5 mt-[2px] shrink-0 text-amber-500" aria-hidden />
            <span className="min-w-0 flex-1 truncate">{row.delivery.label}</span>
            <button
              type="button"
              onClick={() => p.onReviewDelivery(row.id)}
              className="shrink-0 font-semibold text-amber-900 underline underline-offset-2 hover:no-underline"
            >
              {t('review')}
            </button>
          </p>
        )}
      </div>
    </li>
  );
}

function Hero({
  raw, row, orientation, templateLookup, contentLine, live, warn,
}: {
  raw: any; row: PlaylistSummaryRow; orientation: ContentOrientation;
  templateLookup: Record<string, TemplateLookupEntry | undefined>; contentLine: string; live: boolean; warn: boolean;
}) {
  const t = useTranslations('playlistsPage.v2');
  const pic = useMemo(() => (row.kind === 'template' ? null : heroPicture(raw, resolvePicture)), [raw, row.kind]);
  const [measured, setMeasured] = useState<ContentOrientation>('unknown');
  const o = orientation !== 'unknown' ? orientation : measured;
  const dim = row.scheduleState === 'PAUSED' || row.scheduleState === 'UNASSIGNED';

  return (
    <div className="relative w-full overflow-hidden bg-slate-900" style={{ aspectRatio: '16 / 9' }}>
      {pic ? (
        <>
          {/* The picture itself, cover-fit and blurred, fills the frame —
              no black bars around a portrait poster. Static: no animation. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={pic.src}
            alt=""
            aria-hidden
            loading="lazy"
            decoding="async"
            className="absolute top-0 left-0 w-full h-full object-cover"
            style={{ filter: 'blur(22px) saturate(1.2)', transform: 'scale(1.25)', opacity: 0.85 }}
          />
          <div className="absolute top-0 left-0 w-full h-full bg-black/15" aria-hidden />
          <div className={`absolute top-0 left-0 w-full h-full flex items-center justify-center ${o === 'portrait' ? 'py-3' : ''}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={pic.src}
              alt=""
              loading="lazy"
              decoding="async"
              onLoad={(e) => {
                const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
                if (w > 0 && h > 0) setMeasured(h > w ? 'portrait' : 'landscape');
              }}
              className={o === 'portrait'
                ? 'h-full w-auto max-w-full object-contain rounded-md shadow-[0_8px_30px_rgba(0,0,0,0.45)] ring-1 ring-white/20'
                : 'w-full h-full object-contain'}
            />
          </div>
          {pic.isVideo && (
            <div className="absolute top-0 left-0 w-full h-full flex items-center justify-center pointer-events-none" aria-hidden>
              <span className="w-10 h-10 rounded-full bg-black/45 flex items-center justify-center">
                <Play className="w-4 h-4 text-white" fill="white" />
              </span>
            </div>
          )}
        </>
      ) : raw ? (
        <PlaylistPreviewThumb playlist={raw} templateLookup={templateLookup} size="tile" className="!rounded-none !border-0 h-full" />
      ) : null}

      {/* A paused / unassigned playlist reads quieter at a glance. */}
      {dim && <div className="absolute top-0 left-0 w-full h-full bg-white/25 pointer-events-none" aria-hidden />}

      {live && (
        <div className="absolute top-2.5 left-2.5">
          <StatusPill tone={warn ? 'warning' : 'success'} className="shadow-sm ring-1 ring-black/5" icon={<LiveDot small warn={warn} />}>{t('live')}</StatusPill>
        </div>
      )}
      <div className="absolute bottom-2.5 left-2.5 right-2.5 flex items-end justify-between gap-2 pointer-events-none">
        <span className="inline-flex items-center gap-1.5 rounded-md bg-black/60 px-2 py-1 text-[11px] font-semibold text-white tabular-nums">
          {row.kind === 'template' ? <Layers className="w-3 h-3" aria-hidden /> : null}
          {contentLine}
        </span>
        {o !== 'unknown' && (
          <span className="inline-flex items-center gap-1 rounded-md bg-black/60 px-1.5 py-1 text-[11px] font-semibold text-white" title={t(o)}>
            <OrientationIcon orientation={o} className="w-3 h-3" />
            <span className="sr-only">{t(o)}</span>
          </span>
        )}
      </div>
    </div>
  );
}

/** "Playing on Main Lobby, Cafeteria +2" — and the full list one press away. */
function WhereLine({ entry }: { entry: GalleryEntry }) {
  const t = useTranslations('playlistsPage.v2');
  const { row, where } = entry;
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, anchor, close);

  if (row.scheduleState === 'UNASSIGNED' || where.places.length === 0) {
    return <p className="mt-1 text-[13px] text-slate-500">{row.scheduleState === 'UNASSIGNED' ? t('notOnScreen') : row.scheduleSummary}</p>;
  }
  const names = where.places.slice(0, 2).map((pl) => pl.name);
  const more = where.places.length - names.length;
  const lead = row.scheduleState === 'ACTIVE'
    ? (where.live ? t('playingOn') : t('setFor'))
    : row.scheduleState === 'SCHEDULED' ? t('scheduledFor') : t('pausedOn');

  return (
    <>
      <button
        ref={anchor}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        data-testid="where-button"
        className="mt-1 max-w-full flex items-center gap-1.5 text-left text-[13px] rounded-md -mx-1 px-1 py-0.5 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      >
        {where.live ? <LiveDot warn={entry.attention} /> : row.scheduleState === 'SCHEDULED'
          ? <Clock className="w-3.5 h-3.5 shrink-0 text-indigo-500" aria-hidden />
          : <Pause className="w-3.5 h-3.5 shrink-0 text-slate-400" aria-hidden />}
        <span className={`min-w-0 truncate ${where.live ? 'text-slate-800' : 'text-slate-500'}`}>
          <span className="text-slate-500">{lead} </span>
          <span className="font-medium">{names.join(', ')}</span>
        </span>
        {more > 0 && <span className="shrink-0 text-xs font-semibold tabular-nums text-slate-500">{t('more', { count: more })}</span>}
      </button>
      {row.scheduleState === 'SCHEDULED' && (
        <p className="text-[12px] text-slate-500 truncate">{row.scheduleSummary}</p>
      )}
      <AnchoredMenu anchorRef={anchor} open={open} width={280} align="left" ariaLabel={t('whereTitle', { name: row.name })}>
        <WherePanel where={where} live={where.live} />
      </AnchoredMenu>
    </>
  );
}

function WherePanel({ where, live }: { where: PlayingWhere; live: boolean }) {
  const t = useTranslations('playlistsPage.v2');
  return (
    <div className="py-2 max-h-[min(60vh,420px)] overflow-y-auto" data-testid="where-panel">
      <p className="px-3 pb-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500">
        {live ? t('panelLive', { count: where.screenCount }) : t('panelTargets', { count: where.screenCount })}
      </p>
      <ul className="list-none m-0 p-0">
        {where.places.map((pl) => (
          <li key={`${pl.kind}:${pl.id}`} className="px-3 min-h-9 flex items-center gap-2 text-[13px] text-slate-700">
            {pl.kind === 'group'
              ? <Layers className="w-3.5 h-3.5 shrink-0 text-slate-400" aria-hidden />
              : <Monitor className="w-3.5 h-3.5 shrink-0 text-slate-400" aria-hidden />}
            <span className="flex-1 min-w-0 truncate">{pl.name}</span>
            {pl.kind === 'group'
              ? <span className="text-xs tabular-nums text-slate-500">{t('screensCount', { count: pl.screens })}</span>
              : pl.online === false
                ? <span className="text-xs text-slate-500">{t('offline')}</span>
                : pl.online ? <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" aria-label={t('online')} /> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function SkeletonCard() {
  return (
    <li className="bg-white rounded-2xl border border-slate-200 overflow-hidden" aria-hidden>
      <div className="bg-slate-100 animate-pulse" style={{ aspectRatio: '16 / 9' }} />
      <div className="p-4 space-y-2">
        <div className="h-4 w-2/3 rounded bg-slate-100" />
        <div className="h-3 w-1/2 rounded bg-slate-100" />
      </div>
    </li>
  );
}

function Empty({ title, body, action, onAction }: { title: string; body: string; action?: string; onAction?: () => void }) {
  return (
    <div className="text-center py-14 bg-white rounded-2xl border border-slate-200">
      <h2 className="text-base font-semibold text-slate-900">{title}</h2>
      <p className="text-sm text-slate-600 mt-1 max-w-md mx-auto">{body}</p>
      {action && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="mt-4 inline-flex items-center gap-2 min-h-11 sm:min-h-10 px-4 rounded-lg text-sm font-semibold text-white"
          style={{ background: 'var(--brand-primary, #4f46e5)' }}
        >
          {action}
        </button>
      )}
    </div>
  );
}

export default PlaylistGalleryV2;
