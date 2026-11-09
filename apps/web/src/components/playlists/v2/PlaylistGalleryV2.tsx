"use client";

/**
 * PlaylistGalleryV2 — the Playlists page as a gallery of what is on the
 * screens (the Playlists page; filmstrip look chosen by the owner 2026-11-07).
 *
 * Owner on the first v2 (2026-11-02): "I want to see it with content previews
 * on it … no crazy colors, just a beautiful UI design so the playlists are a
 * joy to work with." So:
 *
 *  - The playlist's ACTUAL items are the hero — a filmstrip of its
 *    pictures under a large stage, each shown WHOLE on a soft neutral backdrop (never
 *    cropped). On desktop hover the card slowly cross-fades through every
 *    item, one per 3 s (owner rule: no fast carousels). The timer exists only
 *    while the pointer is on the card; reduced motion turns it off.
 *  - Calm and neutral: no tinted badges or fills. Status is small grey text
 *    and a tiny dot. 12px corners, hairline borders, generous whitespace.
 *  - Kept: "playing where" (offline screens named), the tabs, search, Filter,
 *    Sort, the whole card opens the playlist, "⋯" for the rest.
 *  - Bulk select through the shared SelectionToolbar / ActionDock (Delete
 *    always visible), and "Show more" paging for long libraries.
 *
 * Presentation only: schedule state, delivery and needs-attention come from
 * v1/playlistOps.ts; where/orientation/pictures/filtering/paging from
 * ./galleryModel.ts. Dashboard surface (not player/widget): no backdrop blur,
 * no pollers.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpDown, Check, Copy, ExternalLink, Layers, Monitor, Pause, Play, Plus, Search, Trash2, Upload, Usb } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { PlaylistPreviewThumb, type TemplateLookupEntry } from '@/components/playlists/PlaylistPreviewThumb';
import { assetPosterUrl } from '@/components/playlists/VideoPreviewThumb';
import { transformedImageUrl } from '@/lib/asset-image';
import { API_URL } from '@/lib/api-url';
import { usePhoneWidth } from '@/lib/use-phone-width';
import { PageToolbar } from '@/components/ui/page-toolbar';
import { TabRow } from '@/components/ui/tab-row';
import { FilterMenu, type FilterGroup } from '@/components/ui/filter-menu';
import { OverflowMenu, type OverflowItem } from '@/components/ui/overflow-menu';
import { ActionDock, SelectionToolbar, type SelectionBarProps } from '@/components/ui/selection-toolbar';
import { AnchoredMenu } from '@/components/ui/anchored-menu';
import { useDismiss } from '@/components/ui/use-dismiss';
import { formatDuration, needsAttention, type OpsGroupRef, type OpsScheduleRef, type PlaylistSummaryRow } from '../v1/playlistOps';
import {
  applyGallery, countGallery, EMPTY_GALLERY_FILTERS, GALLERY_PAGE_SIZE, pageGallery, playingWhere, playlistOrientation,
  previewPictures, screenLocation,
  type ContentOrientation, type GalleryEntry, type GalleryFilters, type GalleryScreenRef, type GallerySort, type GalleryTab,
  type PlayingWhere, type PreviewPicture,
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
  /** Bulk delete; without it there is no selection. */
  onRemoveMany?: (rows: PlaylistSummaryRow[]) => Promise<void> | void;
  onPublishToLocations?: (id: string) => void;
  onSetActive?: (row: PlaylistSummaryRow, next: boolean) => void;
  isViewer: boolean;
}

/** Same rule as v1: a press on a control inside the card never opens it. */
const CARD_CONTROL = 'button, a, input, select, textarea, label, [role="menu"], [role="menuitem"], [role="dialog"], [data-popover-panel]';
/** One item per 3 s on hover — calm, never a fast carousel (owner rule). */
const CYCLE_MS = 3000;
/** Neutral stage every picture sits on, whole. */
const STAGE = 'bg-[#f4f4f3]';
const HAIRLINE = 'border border-black/[0.07]';

function resolvePicture(asset: any): string | null {
  const mime = String(asset?.mimeType ?? '');
  if (mime.startsWith('video/')) return assetPosterUrl(asset);
  if (!mime.startsWith('image/') || !asset?.fileUrl) return null;
  const raw = String(asset.fileUrl).startsWith('http') ? asset.fileUrl : `${apiBase}${asset.fileUrl}`;
  return transformedImageUrl(raw, { width: 640, quality: 70 });
}

// ─────────────────────────────────────────────────────────────────────
// The page
// ─────────────────────────────────────────────────────────────────────

export function PlaylistGalleryV2(props: PlaylistGalleryV2Props) {
  const t = useTranslations('playlistsPage.v2');
  const tUi = useTranslations('ui');
  const isPhone = usePhoneWidth();
  const { rows, loading, error, isViewer, screens, schedules, groups } = props;

  const [tab, setTab] = useState<GalleryTab>('all');
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<GalleryFilters>(EMPTY_GALLERY_FILTERS);
  const [sort, setSort] = useState<GallerySort>('playing');
  const [shown, setShown] = useState(GALLERY_PAGE_SIZE);
  useEffect(() => { setShown(GALLERY_PAGE_SIZE); }, [tab, search, filters, sort]);

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

  // ── Selection (bulk delete) — always a subset of what is visible ──
  const selectable = !!props.onRemoveMany && !isViewer;
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const ids = new Set(visible.map((e) => e.row.id));
      const next = new Set<string>();
      prev.forEach((id) => { if (ids.has(id)) next.add(id); });
      return next.size === prev.size ? prev : next;
    });
  }, [visible]);
  const selectedRows = useMemo(() => visible.filter((e) => selected.has(e.row.id)).map((e) => e.row), [visible, selected]);
  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);
  const clearSelection = () => setSelected(new Set());
  const removeSelected = async () => {
    if (!props.onRemoveMany || selectedRows.length === 0 || bulkBusy) return;
    setBulkBusy(true);
    try { await props.onRemoveMany(selectedRows); } finally { setBulkBusy(false); }
  };
  const selecting = selectable && selectedRows.length > 0;
  const barProps: SelectionBarProps = {
    count: selectedRows.length,
    onClear: clearSelection,
    testId: 'playlists-selection',
    countTestId: 'bulk-count',
    selectAll: visible.length > selectedRows.length
      ? { label: tUi('selectAll', { count: visible.length }), onSelect: () => setSelected(new Set(visible.map((e) => e.row.id))), disabled: bulkBusy, testId: 'bulk-select-all' }
      : null,
    actions: [{
      id: 'delete', variant: 'danger', testId: 'bulk-delete',
      label: bulkBusy ? t('selDeleting') : t('selDelete', { count: selectedRows.length }),
      ariaLabel: t('selDelete', { count: selectedRows.length }),
      icon: <Trash2 className="w-3.5 h-3.5" aria-hidden />,
      onSelect: () => { void removeSelected(); },
      busy: bulkBusy, disabled: bulkBusy,
    }],
  };

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
  const { page, remaining } = pageGallery(visible, shown);
  // "Playing now" leads All in the default sort when nothing narrows the list.
  const sectioned = tab === 'all' && sort === 'playing' && !filtered;
  const playingNow = sectioned ? page.filter((e) => e.row.scheduleState === 'ACTIVE') : [];
  const rest = sectioned ? page.filter((e) => e.row.scheduleState !== 'ACTIVE') : page;

  const SORTS: GallerySort[] = ['playing', 'updated', 'name', 'screens'];
  const cardCtx: CardCtx = {
    ...props, isPhone, selectable, selecting, selected, toggle,
  };
  const renderList = (list: GalleryEntry[]) => (
    <CardGrid>{list.map((e) => <PlaylistCard key={e.row.id} entry={e} ctx={cardCtx} />)}</CardGrid>);

  return (
    <div className="space-y-6" data-testid="playlists-v2">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4">
        <div>
          <h1 className="text-[26px] leading-tight font-semibold tracking-[-0.01em] text-slate-900">{t('title')}</h1>
          <p className="text-[13px] text-slate-500 mt-1" data-testid="library-summary">
            {loading && rows.length === 0
              ? t('loading')
              : t('summary', { count: counts.all, playing: counts.playing, screens: liveScreens })}
          </p>
        </div>
        {!isViewer && (
          <button
            type="button"
            onClick={props.onNew}
            className="inline-flex items-center gap-1.5 px-3.5 min-h-11 sm:min-h-9 rounded-lg text-[13px] font-semibold text-white bg-slate-900 hover:bg-slate-800 transition-colors"
          >
            <Plus className="w-4 h-4" aria-hidden />
            {t('newPlaylist')}
          </button>
        )}
      </div>

      <PageToolbar
        testId="playlists-toolbar"
        compact={isPhone}
        selection={selecting && !isPhone ? <SelectionToolbar {...barProps} /> : undefined}
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
              className="min-h-11 w-full md:w-40 min-[1440px]:w-56 rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm placeholder:text-slate-400 focus:border-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-200 md:min-h-9"
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
        <div className="space-y-8">
          {playingNow.length > 0 && (
            <section aria-labelledby="pl-playing-now" className="space-y-3">
              <SectionHeading id="pl-playing-now" label={t('sectionPlaying')} count={playingNow.length} />
              {renderList(playingNow)}
            </section>
          )}
          {rest.length > 0 && (
            <section aria-labelledby="pl-rest" className="space-y-3">
              {sectioned && playingNow.length > 0 && (
                <SectionHeading id="pl-rest" label={t('sectionRest')} count={rest.length} />
              )}
              {renderList(rest)}
            </section>
          )}
          {remaining > 0 && (
            <div className="flex flex-col items-center gap-1 pt-2">
              <button
                type="button"
                data-testid="show-more"
                onClick={() => setShown((n) => n + GALLERY_PAGE_SIZE)}
                className="min-h-11 sm:min-h-9 px-4 rounded-lg border border-slate-200 bg-white text-[13px] font-semibold text-slate-700 hover:bg-slate-50 hover:text-slate-900 transition-colors"
              >
                {t('showMore', { count: Math.min(remaining, GALLERY_PAGE_SIZE) })}
              </button>
              <p className="text-[12px] text-slate-400 tabular-nums">{t('showingOf', { shown: page.length, total: visible.length })}</p>
            </div>
          )}
        </div>
      )}
      {selectable && isPhone && <ActionDock {...barProps} />}
    </div>
  );
}

function SectionHeading({ id, label, count }: { id: string; label: string; count: number }) {
  return (
    <h2 id={id} className="flex items-baseline gap-2 text-[13px] font-semibold text-slate-800">
      {label}
      <span className="text-[12px] tabular-nums font-normal text-slate-400">{count}</span>
    </h2>
  );
}

function CardGrid({ children }: { children: React.ReactNode }) {
  const cols = 'grid-cols-1 min-[640px]:grid-cols-2 min-[1000px]:grid-cols-3 min-[1600px]:grid-cols-4 gap-x-5 gap-y-5';
  return <ul className={`grid ${cols} list-none p-0 m-0`}>{children}</ul>;
}

// ─────────────────────────────────────────────────────────────────────
// Shared pieces
// ─────────────────────────────────────────────────────────────────────

type CardCtx = PlaylistGalleryV2Props & {
  isPhone: boolean;
  selectable: boolean;
  selecting: boolean;
  selected: ReadonlySet<string>;
  toggle: (id: string) => void;
};

/**
 * While the pointer rests on a card (desktop pointers only, motion allowed),
 * step through its pictures one per CYCLE_MS. No timer exists otherwise.
 */
function useHoverCycle(count: number) {
  const [index, setIndex] = useState(0);
  const [hovering, setHovering] = useState(false);
  const timer = useRef<number | null>(null);
  const clear = () => { if (timer.current != null) { window.clearInterval(timer.current); timer.current = null; } };
  useEffect(() => clear, []);
  const onEnter = useCallback(() => {
    if (typeof window === 'undefined' || count < 1) return;
    if (!window.matchMedia?.('(hover: hover) and (pointer: fine)').matches) return;
    setHovering(true);
    if (count < 2 || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    clear();
    timer.current = window.setInterval(() => setIndex((i) => (i + 1) % count), CYCLE_MS);
  }, [count]);
  const onLeave = useCallback(() => { clear(); setHovering(false); setIndex(0); }, []);
  return { index, hovering, onEnter, onLeave };
}

/** A picture shown whole, centred in its box, with a hairline and soft shadow. */
function Whole({ pic, size = 'md' }: { pic: PreviewPicture; size?: 'sm' | 'md' }) {
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={pic.src}
        alt=""
        loading="lazy"
        decoding="async"
        draggable={false}
        className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 max-w-full max-h-full w-auto h-auto ${size === 'sm' ? 'rounded-[3px]' : 'rounded-[5px] shadow-[0_1px_2px_rgba(15,23,42,0.08),0_4px_14px_rgba(15,23,42,0.08)]'} ring-1 ring-black/[0.06]`}
      />
      {pic.isVideo && size === 'md' && (
        <span aria-hidden className="absolute bottom-1.5 right-1.5 w-5 h-5 rounded-full bg-white/90 shadow-sm flex items-center justify-center">
          <Play className="w-2.5 h-2.5 text-slate-700" fill="currentColor" />
        </span>
      )}
    </>
  );
}

/** Every picture stacked; only `index` is visible; opacity cross-fades. */
function CrossFade({ pictures, index, pad }: { pictures: PreviewPicture[]; index: number; pad: string }) {
  return (
    <div className={`absolute top-0 left-0 w-full h-full ${STAGE}`} data-testid="card-crossfade">
      {pictures.map((p, i) => (
        <div
          key={p.key}
          className={`absolute top-0 left-0 w-full h-full ${pad} transition-opacity duration-[900ms] ease-in-out`}
          style={{ opacity: i === index ? 1 : 0 }}
          aria-hidden={i !== index}
        >
          <div className="relative w-full h-full"><Whole pic={p} /></div>
        </div>
      ))}
    </div>
  );
}

function SelectCheck({ id, name, ctx, className }: { id: string; name: string; ctx: CardCtx; className?: string }) {
  const t = useTranslations('playlistsPage.v2');
  if (!ctx.selectable) return null;
  const on = ctx.selected.has(id);
  const always = on || ctx.selecting || ctx.isPhone;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      aria-label={t('selectOne', { name })}
      data-testid="card-select"
      onClick={(e) => { e.stopPropagation(); ctx.toggle(id); }}
      className={`w-11 h-11 sm:w-8 sm:h-8 flex items-center justify-center rounded-full transition-opacity focus-visible:opacity-100 focus-visible:outline-none ${always ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} ${className ?? ''}`}
    >
      <span
        aria-hidden
        className={`w-[22px] h-[22px] rounded-full flex items-center justify-center shadow-sm transition-colors ${on ? 'bg-slate-900 text-white' : 'bg-white/95 ring-1 ring-black/15 text-transparent'}`}
      >
        <Check className="w-3.5 h-3.5" strokeWidth={3} />
      </span>
    </button>
  );
}

function useCardMenu(row: PlaylistSummaryRow, ctx: CardCtx): OverflowItem[] {
  const t = useTranslations('playlistsPage.v2');
  const isActive = row.scheduleState === 'ACTIVE';
  const canToggle = !!ctx.onSetActive && !ctx.isViewer && row.scheduleState !== 'UNASSIGNED'
    && row.statusLabel !== 'PREPARING 1080P' && row.statusLabel !== 'MEDIA FAILED';
  return [
    { id: 'open', label: t('menuOpen'), icon: <ExternalLink className="w-3.5 h-3.5" aria-hidden />, onSelect: () => ctx.onOpen(row.id) },
    {
      id: 'toggle', hidden: !canToggle,
      label: isActive ? t('menuStop') : t('menuStart'),
      icon: isActive ? <Pause className="w-3.5 h-3.5" aria-hidden /> : <Play className="w-3.5 h-3.5" aria-hidden />,
      onSelect: () => ctx.onSetActive?.(row, !isActive),
    },
    { id: 'dup', label: t('menuDuplicate'), hidden: ctx.isViewer, icon: <Copy className="w-3.5 h-3.5" aria-hidden />, onSelect: () => ctx.onDuplicate(row.id) },
    { id: 'usb', label: t('menuUsb'), icon: <Usb className="w-3.5 h-3.5" aria-hidden />, onSelect: () => ctx.onExport(row.id) },
    { id: 'publish', label: t('menuPublishLocations'), hidden: !ctx.onPublishToLocations || ctx.isViewer, icon: <Upload className="w-3.5 h-3.5" aria-hidden />, onSelect: () => ctx.onPublishToLocations?.(row.id) },
    { id: 'remove', label: t('menuRemove'), hidden: ctx.isViewer, separated: true, icon: <Trash2 className="w-3.5 h-3.5 text-rose-600" aria-hidden />, onSelect: () => ctx.onRemove(row) },
  ];
}

function useRelative() {
  const locale = useLocale();
  return useCallback((iso: string) => {
    const ms = Date.parse(iso);
    if (!Number.isFinite(ms)) return '';
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
    const sec = Math.round((ms - Date.now()) / 1000);
    const abs = Math.abs(sec);
    if (abs < 60) return rtf.format(0, 'second');
    if (abs < 3600) return rtf.format(Math.round(sec / 60), 'minute');
    if (abs < 86400) return rtf.format(Math.round(sec / 3600), 'hour');
    if (abs < 86400 * 30) return rtf.format(Math.round(sec / 86400), 'day');
    return new Date(ms).toLocaleDateString(locale, { month: 'short', day: 'numeric' });
  }, [locale]);
}

function useMetaLine(entry: GalleryEntry, total: number) {
  const t = useTranslations('playlistsPage.v2');
  const rel = useRelative();
  const { row } = entry;
  const content = row.kind === 'template'
    ? t('template')
    : row.itemCount === 0 ? t('noContent') : t('itemsDuration', { count: row.itemCount || total, duration: formatDuration(row.durationMs) });
  return `${content} · ${t('updated', { when: rel(row.updatedAt) })}`;
}

/** The status mark: a tiny dot or glyph, all grey except a live (green) or needs-attention (amber) dot. */
function StatusMark({ entry }: { entry: GalleryEntry }) {
  const { row, where, attention } = entry;
  if (where.live) {
    return <span aria-hidden className={`inline-block shrink-0 w-1.5 h-1.5 rounded-full ${attention ? 'bg-amber-500' : 'bg-emerald-500'}`} />;
  }
  if (row.scheduleState === 'SCHEDULED') return <span aria-hidden className="inline-block shrink-0 w-1.5 h-1.5 rounded-full ring-1 ring-inset ring-slate-400" />;
  if (row.scheduleState === 'PAUSED') return <Pause aria-hidden className="w-3 h-3 shrink-0 text-slate-400" />;
  return <span aria-hidden className="inline-block shrink-0 w-1.5 h-1.5 rounded-full bg-slate-300" />;
}

function statusWord(entry: GalleryEntry, t: ReturnType<typeof useTranslations>): string {
  const s = entry.row.scheduleState;
  if (entry.where.live) return t('live');
  if (s === 'ACTIVE') return t('statusIdle');
  if (s === 'SCHEDULED') return t('statusScheduled');
  if (s === 'PAUSED') return t('statusPaused');
  return t('statusUnassigned');
}

/** "On Lobby Screens, Library Desk +1 · Gym Entrance offline" — the full list one press away. */
function WhereLine({ entry, compact }: { entry: GalleryEntry; compact?: boolean }) {
  const t = useTranslations('playlistsPage.v2');
  const { row, where } = entry;
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, anchor, close);

  if (row.scheduleState === 'UNASSIGNED' || where.places.length === 0) {
    return (
      <p className="flex items-center gap-1.5 text-[13px] text-slate-500 min-w-0">
        <StatusMark entry={entry} />
        <span className="truncate">{row.scheduleState === 'UNASSIGNED' ? t('notOnScreen') : row.scheduleSummary}</span>
      </p>
    );
  }
  const names = where.places.slice(0, compact ? 1 : 2).map((pl) => pl.name);
  const more = where.places.length - names.length;
  const lead = row.scheduleState === 'ACTIVE'
    ? (where.live ? t('playingOn') : t('setFor'))
    : row.scheduleState === 'SCHEDULED' ? t('scheduledFor') : t('pausedOn');
  const off = where.offline;

  return (
    <>
      <button
        ref={anchor}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        data-testid="where-button"
        className="max-w-full flex items-center gap-1.5 text-left text-[13px] rounded-md -mx-1 px-1 py-0.5 hover:bg-black/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
      >
        <StatusMark entry={entry} />
        <span className="min-w-0 truncate text-slate-500">
          {lead} <span className="text-slate-800">{names.join(', ')}</span>
          {more > 0 && <span className="tabular-nums"> {t('more', { count: more })}</span>}
        </span>
        {off.length > 0 && (
          <span className={`text-slate-500 ${compact ? 'min-w-0 truncate' : 'shrink-0'}`} data-testid="where-offline">
            · {off.length === 1 ? t('offlineNamed', { name: off[0].name }) : t('offlineCount', { count: off.length })}
          </span>
        )}
      </button>
      <AnchoredMenu anchorRef={anchor} open={open} width={300} align="left" ariaLabel={t('whereTitle', { name: row.name })}>
        <WherePanel where={where} live={where.live} />
      </AnchoredMenu>
    </>
  );
}

function WherePanel({ where, live }: { where: PlayingWhere; live: boolean }) {
  const t = useTranslations('playlistsPage.v2');
  const offline = new Set(where.offline.map((o) => o.id));
  return (
    <div className="py-2 max-h-[min(60vh,420px)] overflow-y-auto" data-testid="where-panel">
      <p className="px-3 pb-1.5 text-[12px] font-medium text-slate-500">
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
              ? <span className="text-xs tabular-nums text-slate-400">{t('screensCount', { count: pl.screens })}</span>
              : <span className="text-xs text-slate-400">{offline.has(pl.id) || pl.online === false ? t('offline') : t('online')}</span>}
          </li>
        ))}
      </ul>
      {where.offline.length > 0 && (
        <p className="px-3 pt-2 mt-1 border-t border-slate-100 text-[12px] text-slate-500">
          {t('panelOffline', { names: where.offline.map((o) => o.name).join(', ') })}
        </p>
      )}
    </div>
  );
}

function AttentionLine({ entry, ctx }: { entry: GalleryEntry; ctx: CardCtx }) {
  const t = useTranslations('playlistsPage.v2');
  return (
    <p className="flex items-center gap-1.5 text-[12.5px] text-slate-600 min-w-0" data-testid="card-attention">
      <span aria-hidden className="inline-block shrink-0 w-1.5 h-1.5 rounded-full bg-amber-500" />
      <span className="min-w-0 truncate">{entry.row.delivery.label}</span>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); ctx.onReviewDelivery(entry.row.id); }}
        className="shrink-0 font-medium text-slate-900 underline decoration-slate-300 underline-offset-2 hover:decoration-slate-900"
      >
        {t('review')}
      </button>
    </p>
  );
}

function openOnClick(open: () => void) {
  return (e: React.MouseEvent) => {
    const el = e.target as Element | null;
    if (el?.closest?.(CARD_CONTROL) && !el.closest('[data-card-open]')) return;
    open();
  };
}

function usePictures(entry: GalleryEntry, ctx: CardCtx) {
  const raw = ctx.rawById.get(entry.row.id) as any;
  const { pictures, total } = useMemo(
    () => (entry.row.kind === 'template' ? { pictures: [], total: 0 } : previewPictures(raw, resolvePicture, 8)),
    [raw, entry.row.kind],
  );
  return { raw, pictures, total };
}

/** A template playlist (or one with nothing visual) keeps the existing thumbnail renderer. */
function FallbackThumb({ raw, ctx }: { raw: any; ctx: CardCtx }) {
  if (!raw) return null;
  return (
    <div className="absolute top-0 left-0 w-full h-full p-3">
      <PlaylistPreviewThumb playlist={raw} templateLookup={ctx.templateLookup} size="tile" className="!border-0 h-full !rounded-[5px]" />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// The card (filmstrip)
// ─────────────────────────────────────────────────────────────────────

function PlaylistCard({ entry, ctx }: { entry: GalleryEntry; ctx: CardCtx }) {
  const t = useTranslations('playlistsPage.v2');
  const { row, orientation, attention } = entry;
  const { raw, pictures, total } = usePictures(entry, ctx);
  const cycle = useHoverCycle(pictures.length);
  const menu = useCardMenu(row, ctx);
  const meta = useMetaLine(entry, total);
  const open = () => ctx.onOpen(row.id);
  const on = ctx.selected.has(row.id);

  const stage = (
    <div className={`relative w-full overflow-hidden ${STAGE}`} style={{ aspectRatio: '16 / 10' }}>
      {pictures.length === 0 ? <FallbackThumb raw={raw} ctx={ctx} /> : <CrossFade pictures={pictures} index={cycle.index} pad="p-4" />}
      {cycle.hovering && pictures.length > 1 && (
        <span className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-1" aria-hidden>
          {pictures.map((p, i) => (
            <span key={p.key} className={`w-1 h-1 rounded-full transition-colors duration-500 ${i === cycle.index ? 'bg-slate-700' : 'bg-slate-300'}`} />
          ))}
        </span>
      )}
      <SelectCheck id={row.id} name={row.name} ctx={ctx} className="absolute top-1 left-1" />
    </div>
  );

  const strip = (
    <div className="flex items-center gap-1.5 px-3 pt-2.5" aria-hidden>
      {pictures.slice(0, 6).map((p, i) => (
        <div
          key={p.key}
          className={`relative h-9 flex-1 max-w-[64px] rounded-md ${STAGE} transition-shadow duration-500 ${i === cycle.index ? 'ring-1 ring-slate-500' : 'ring-1 ring-black/[0.05]'}`}
        >
          <div className="absolute top-0 left-0 w-full h-full p-[3px]"><div className="relative w-full h-full"><Whole pic={p} size="sm" /></div></div>
        </div>
      ))}
      {total > 6 && <span className="text-[11px] tabular-nums text-slate-400 pl-0.5">{t('more', { count: total - 6 })}</span>}
      {pictures.length === 0 && <div className="h-9" />}
    </div>
  );

  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions
    <li
      data-testid="playlist-card-v2"
      data-state={row.scheduleState}
      data-orientation={orientation}
      onClick={openOnClick(open)}
      onMouseEnter={cycle.onEnter}
      onMouseLeave={cycle.onLeave}
      className={`group relative cursor-pointer bg-white rounded-xl ${HAIRLINE} overflow-hidden transition-shadow duration-200 hover:shadow-[0_6px_24px_rgba(15,23,42,0.08)] ${on ? 'ring-2 ring-slate-900' : ''}`}
    >
      {stage}
      {strip}
      <div className="px-3 pt-2.5 pb-3.5">
        <div className="flex items-start gap-2">
          <button
            type="button"
            data-card-open
            onClick={(e) => { e.stopPropagation(); open(); }}
            className="flex-1 min-w-0 text-left text-[14.5px] font-semibold tracking-[-0.005em] text-slate-900 truncate focus:outline-none focus-visible:underline"
            title={row.name}
          >
            {row.name}
          </button>
          <div className={`-mr-2 -mt-2 shrink-0 ${ctx.isPhone ? '' : 'opacity-60 group-hover:opacity-100 focus-within:opacity-100 transition-opacity'}`}>
            <OverflowMenu items={menu} ariaLabel={t('moreFor', { name: row.name })} testId="card-more" />
          </div>
        </div>
        <div className="mt-0.5 space-y-0.5">
          <WhereLine entry={entry} />
          {attention ? <AttentionLine entry={entry} ctx={ctx} /> : <p className="text-[12px] text-slate-400 truncate">{meta}</p>}
        </div>
      </div>
    </li>
  );
}

function SkeletonCard() {
  return (
    <li className="space-y-3" aria-hidden>
      <div className={`rounded-xl ${STAGE} animate-pulse`} style={{ aspectRatio: '16 / 10' }} />
      <div className="space-y-2 px-0.5">
        <div className="h-3.5 w-2/3 rounded bg-slate-100" />
        <div className="h-3 w-1/2 rounded bg-slate-100" />
      </div>
    </li>
  );
}

function Empty({ title, body, action, onAction }: { title: string; body: string; action?: string; onAction?: () => void }) {
  return (
    <div className={`text-center py-16 bg-white rounded-xl ${HAIRLINE}`}>
      <h2 className="text-[15px] font-semibold text-slate-900">{title}</h2>
      <p className="text-sm text-slate-500 mt-1 max-w-md mx-auto">{body}</p>
      {action && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="mt-5 inline-flex items-center gap-2 min-h-11 sm:min-h-9 px-4 rounded-lg text-[13px] font-semibold text-white bg-slate-900 hover:bg-slate-800 transition-colors"
        >
          {action}
        </button>
      )}
    </div>
  );
}

export default PlaylistGalleryV2;
