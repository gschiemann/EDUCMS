"use client";

/**
 * PlaylistLibraryV1 — the calm library (handoff §7–§9, §21–§25).
 *
 * Design source: scratch/design/playlists-page/playlists-operations-v1.png
 * (the visual direction for the default desktop library) +
 * PLAYLISTS-V1-DESIGN-HANDOFF.md (the binding behaviour spec).
 *
 * PRESENTATION ONLY. Every verdict — schedule state, delivery rollup, which
 * rows need attention, what the pause/remove confirmations say — is decided in
 * playlistOps.ts and unit-tested there. This file arranges pixels and routes
 * intent back to the page.
 *
 * ── THE MOCK'S ONE CORRECTION (§10, binding) ─────────────────────────
 * The mock's Delivery column reads "Confirmed 4/4". The platform stores no
 * expected per-target content signature, so that claim cannot be made. Every
 * delivery cell here comes from summarizeDelivery(), whose ceiling is
 * "Update received on 4 of 4" (VALUE-identity acknowledgement) or
 * "Picture confirmed on 4 of 4" (the device's own render proof). The layout is
 * the mock's; the words are the ones the evidence supports.
 *
 * What is deliberately NOT on this page (§29): no global power switches, no
 * persistent trash icons, no fleet-wide "screens online" metric, no per-screen
 * roster in a row — individual screens live in the workspace drilldown.
 *
 * Dashboard surface, not player/widget: CSS gap is fine here. No backdrop-blur
 * anywhere (mobile performance standard), and no animated previews across the
 * list (§26 — static thumbnails only).
 */

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, Check, ChevronLeft, ChevronRight, Clock, Copy, Eye, Grid2X2, ListIcon,
  MoreHorizontal, Plus, Search, SlidersHorizontal, Trash2, Upload, X,
} from 'lucide-react';
import { PlaylistPreviewThumb, type TemplateLookupEntry } from '@/components/playlists/PlaylistPreviewThumb';
import {
  activeFilterCount, applyLibrary, buildExceptionBanner, countByStatus, describeContent,
  describeReach, EMPTY_FILTERS, exactStamp, needsAttention, SORT_LABELS, timeAgo,
  type LibraryFilters, type LibrarySort, type PlaylistSummaryRow, type StatusTab,
} from './playlistOps';

// ── The mock's neutrals (§24.1). Brand action stays var(--brand-primary). ──
const INK = 'text-[#111A3A]';
const INK_2 = 'text-[#536181]';
const INK_3 = 'text-[#7B87A4]';
const HAIRLINE = 'border-[#E4E8F1]';
const SURFACE = `bg-white border ${HAIRLINE}`;

const STATUS_TONE: Record<string, string> = {
  ACTIVE: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  SCHEDULED: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  PAUSED: 'bg-slate-100 text-slate-600 border-slate-200',
  ENDED: 'bg-slate-100 text-slate-600 border-slate-200',
  UNASSIGNED: 'bg-slate-100 text-slate-600 border-slate-200',
  'NEEDS ATTENTION': 'bg-amber-100 text-amber-800 border-amber-300',
};

const DELIVERY_TONE: Record<string, string> = {
  ok: 'text-emerald-700',
  warn: 'text-amber-700',
  bad: 'text-rose-700',
  muted: 'text-[#7B87A4]',
  unavailable: 'text-amber-700',
};

const PAGE_SIZE = 12;

export interface PlaylistLibraryV1Props {
  rows: PlaylistSummaryRow[];
  /** The raw playlist rows, keyed by id — the thumbnail component wants them. */
  rawById: Map<string, unknown>;
  templateLookup: Record<string, TemplateLookupEntry | undefined>;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  onOpen: (id: string) => void;
  /** Open the workspace straight on its Delivery tab (§7.5 "Review delivery"). */
  onReviewDelivery: (id: string) => void;
  onNew: () => void;
  onPreview: (id: string) => void;
  onDuplicate: (id: string) => void;
  onExport: (id: string) => void;
  onRemove: (row: PlaylistSummaryRow) => void;
  onPublishSchedule: (id: string) => void;
  onPublishToLocations?: () => void;
  onSubmitForReview?: (id: string) => void;
  onSwitchClassic: () => void;
  isViewer: boolean;
  isContributor: boolean;
  isHQ: boolean;
  creatorOptions: string[];
  screenOptions: Array<{ id: string; name: string }>;
  groupOptions: Array<{ id: string; name: string }>;
  groupOfScreen: Map<string, string | null>;
  /** Vertical-aware plural noun: "locations" / "schools" / "stores" / "gyms". */
  locationNoun: string;
  /** True when the delivery column is showing the client-side derivation. */
  deliveryDerived: boolean;
}

/** Everything a row needs, minus the collection it belongs to. */
type RowContext = Omit<PlaylistLibraryV1Props, 'rows'>;

export function PlaylistLibraryV1(props: PlaylistLibraryV1Props) {
  const { rows, loading, error, isViewer } = props;

  const [tab, setTab] = useState<StatusTab>('all');
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<LibraryFilters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<LibrarySort>('updated');
  const [view, setView] = useState<'list' | 'grid'>('list');
  const [page, setPage] = useState(0);
  const [filtersOpen, setFiltersOpen] = useState(false);
  // §7.5 — dismissal is session-scoped at most. Held in component state, so an
  // unresolved exception is back on the next visit. It never touches the
  // backend, so nothing is suppressed for anyone else.
  const [bannerDismissed, setBannerDismissed] = useState(false);

  const counts = useMemo(() => countByStatus(rows), [rows]);
  const visible = useMemo(
    () => applyLibrary({ rows, tab, search, filters, sort, groupOfScreen: props.groupOfScreen }),
    [rows, tab, search, filters, sort, props.groupOfScreen],
  );
  const banner = useMemo(() => buildExceptionBanner(rows), [rows]);

  // Any change to what is being listed resets to the first page — otherwise a
  // filter can land the operator on an empty page 3.
  useEffect(() => { setPage(0); }, [tab, search, filters, sort]);
  useEffect(() => { setBannerDismissed(false); }, [banner?.playlistId, banner?.count]);

  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const clampedPage = Math.min(page, pageCount - 1);
  const paged = visible.slice(clampedPage * PAGE_SIZE, clampedPage * PAGE_SIZE + PAGE_SIZE);

  const filtersActive = activeFilterCount(filters);
  const clearAll = () => { setFilters(EMPTY_FILTERS); setSearch(''); setTab('all'); };

  // Rows are passed per-view (paged); everything else flows down untouched.
  const { rows: _allRows, ...rowContext } = props;

  return (
    <div className="space-y-4">
      {/* ── Header (§7.2) — an honest summary, two actions, nothing else. ── */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div>
          <h1 className={`text-[28px] leading-tight font-extrabold tracking-tight ${INK}`}>Playlists</h1>
          <p className={`text-[13px] mt-0.5 ${INK_2}`} data-testid="library-summary">
            {loading && rows.length === 0
              ? 'Loading…'
              : `${counts.all} ${counts.all === 1 ? 'playlist' : 'playlists'} · ${counts.active} active`}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {props.isHQ && props.onPublishToLocations && !isViewer && (
            <button
              type="button"
              onClick={props.onPublishToLocations}
              className={`inline-flex items-center gap-2 px-3.5 h-10 rounded-[10px] text-[13px] font-semibold ${SURFACE} ${INK} hover:bg-slate-50 transition-colors`}
            >
              <Upload className="w-4 h-4" aria-hidden />
              Publish to {props.locationNoun}
            </button>
          )}
          <button
            type="button"
            onClick={props.onNew}
            disabled={isViewer}
            title={isViewer ? 'Read-only — viewer role' : undefined}
            className="inline-flex items-center gap-2 px-4 h-10 rounded-[10px] text-[13px] font-bold text-white shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: 'var(--brand-primary, #3515E8)' }}
          >
            <Plus className="w-4 h-4" aria-hidden />
            New playlist
          </button>
        </div>
      </div>

      {/* ── Status navigation (§7.3) ── */}
      <div
        role="tablist"
        aria-label="Playlist status"
        className="flex items-center gap-2 overflow-x-auto -mx-1 px-1 pb-0.5"
      >
        {([
          ['all', 'All', counts.all],
          ['active', 'Active', counts.active],
          ['scheduled', 'Scheduled', counts.scheduled],
          ['unassigned', 'Unassigned', counts.unassigned],
          ['attention', 'Needs attention', counts.attention],
        ] as Array<[StatusTab, string, number]>).map(([key, label, n]) => {
          const on = tab === key;
          const flag = key === 'attention' && n > 0;
          return (
            <button
              key={key}
              role="tab"
              aria-selected={on}
              onClick={() => setTab(key)}
              className={`shrink-0 inline-flex items-center gap-2 h-9 px-3.5 rounded-[10px] border text-[13px] font-semibold transition-colors ${
                on ? 'bg-white shadow-sm' : `bg-white/60 hover:bg-white ${INK_2}`
              } ${on ? HAIRLINE : 'border-transparent'} ${on ? INK : ''}`}
              style={on ? { borderColor: 'var(--brand-soft, #CFC4FF)' } : undefined}
            >
              {label}
              <span className={`text-[12px] font-bold ${on ? INK_2 : INK_3}`}>{n}</span>
              {/* Amber dot ONLY when the attention count is nonzero (§7.3). */}
              {flag && (
                <span className="w-4 h-4 rounded-full bg-amber-400 text-white inline-flex items-center justify-center text-[10px] font-black" aria-hidden>!</span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Toolbar (§7.4): search · Filters · Sort · view ── */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className={`w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 ${INK_3}`} aria-hidden />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search playlists..."
            aria-label="Search playlists"
            className={`w-full h-11 pl-9 pr-3 rounded-[10px] text-[13px] ${SURFACE} ${INK} placeholder:${INK_3} outline-none focus:ring-2`}
            style={{ ['--tw-ring-color' as string]: 'var(--brand-soft, #CFC4FF)' }}
          />
        </div>
        <FiltersControl
          open={filtersOpen}
          setOpen={setFiltersOpen}
          filters={filters}
          setFilters={setFilters}
          count={filtersActive}
          creatorOptions={props.creatorOptions}
          screenOptions={props.screenOptions}
          groupOptions={props.groupOptions}
        />
        <label className="sr-only" htmlFor="playlist-sort">Sort playlists</label>
        <select
          id="playlist-sort"
          value={sort}
          onChange={(e) => setSort(e.target.value as LibrarySort)}
          className={`h-11 px-3 rounded-[10px] text-[13px] font-semibold ${SURFACE} ${INK} outline-none`}
        >
          {(Object.keys(SORT_LABELS) as LibrarySort[]).map((k) => (
            <option key={k} value={k}>{SORT_LABELS[k]}</option>
          ))}
        </select>
        <div role="group" aria-label="View mode" className={`hidden sm:flex items-center h-11 rounded-[10px] ${SURFACE} p-1`}>
          {([['grid', Grid2X2, 'Grid view'], ['list', ListIcon, 'List view']] as const).map(([k, Icon, label]) => (
            <button
              key={k}
              type="button"
              aria-pressed={view === k}
              aria-label={label}
              onClick={() => setView(k)}
              className={`w-9 h-full rounded-[7px] flex items-center justify-center transition-colors ${
                view === k ? 'bg-[#F0ECFF]' : 'hover:bg-slate-50'
              }`}
              style={view === k ? { color: 'var(--brand-primary, #3515E8)' } : undefined}
            >
              <Icon className={`w-4 h-4 ${view === k ? '' : INK_3}`} aria-hidden />
            </button>
          ))}
        </div>
      </div>

      {/* Selected-filter chips (§21.2) */}
      {(filtersActive > 0 || search.trim() !== '' || tab !== 'all') && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-[12px] ${INK_3}`}>
            {visible.length} of {rows.length} shown
          </span>
          <button
            type="button"
            onClick={clearAll}
            className={`text-[12px] font-semibold underline ${INK_2} hover:${INK}`}
          >
            Clear all
          </button>
        </div>
      )}

      {/* ── Actionable exception banner (§7.5) ── */}
      {banner && !bannerDismissed && !loading && (
        <div
          className="flex items-start gap-3 rounded-[12px] border border-amber-200 bg-amber-50/70 px-4 py-3"
          role="status"
          data-testid="exception-banner"
        >
          <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" aria-hidden />
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-bold text-amber-900">{banner.headline}</p>
            <p className="text-[13px] text-amber-800/90 mt-0.5">{banner.detail}</p>
          </div>
          <button
            type="button"
            onClick={() => props.onReviewDelivery(banner.playlistId)}
            className="shrink-0 text-[13px] font-bold hover:underline"
            style={{ color: 'var(--brand-primary, #3515E8)' }}
          >
            Review delivery
          </button>
          <button
            type="button"
            onClick={() => setBannerDismissed(true)}
            aria-label="Dismiss for this visit"
            className="shrink-0 p-1 rounded text-amber-700/70 hover:text-amber-900 hover:bg-amber-100"
          >
            <X className="w-4 h-4" aria-hidden />
          </button>
        </div>
      )}

      {/* ── Body ── */}
      {error ? (
        <EmptyState
          title="Playlists couldn’t be loaded"
          body="Your content is still safe. Check your connection and try again."
          actionLabel="Try again"
          onAction={props.onRetry}
        />
      ) : loading && rows.length === 0 ? (
        <LoadingRows />
      ) : rows.length === 0 ? (
        <EmptyState
          title="Create your first playlist"
          body="Combine media or start from a template, then choose where and when it should play."
          actionLabel={isViewer ? undefined : 'New playlist'}
          onAction={isViewer ? undefined : props.onNew}
        />
      ) : visible.length === 0 ? (
        <EmptyState
          title="No playlists match these filters"
          body="Clear filters or try another search."
          actionLabel="Clear filters"
          onAction={clearAll}
        />
      ) : view === 'grid' ? (
        <GridView rows={paged} {...rowContext} />
      ) : (
        <ListView rows={paged} {...rowContext} />
      )}

      {/* ── Footer: honest paging + the quiet escape hatch ── */}
      {!error && visible.length > 0 && (
        <div className={`flex items-center justify-between gap-3 flex-wrap text-[12px] ${INK_3}`}>
          <span>
            Showing {clampedPage * PAGE_SIZE + 1}–{Math.min(visible.length, (clampedPage + 1) * PAGE_SIZE)} of {visible.length} playlists
          </span>
          {pageCount > 1 && (
            <div className="flex items-center gap-1" role="group" aria-label="Pagination">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={clampedPage === 0}
                aria-label="Previous page"
                className={`w-8 h-8 rounded-[8px] ${SURFACE} flex items-center justify-center disabled:opacity-40`}
              >
                <ChevronLeft className="w-4 h-4" aria-hidden />
              </button>
              {Array.from({ length: pageCount }, (_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setPage(i)}
                  aria-current={i === clampedPage ? 'page' : undefined}
                  className={`min-w-8 h-8 px-2 rounded-[8px] border text-[12px] font-bold ${
                    i === clampedPage ? 'text-white border-transparent' : `${SURFACE} ${INK_2}`
                  }`}
                  style={i === clampedPage ? { background: 'var(--brand-primary, #3515E8)' } : undefined}
                >
                  {i + 1}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                disabled={clampedPage >= pageCount - 1}
                aria-label="Next page"
                className={`w-8 h-8 rounded-[8px] ${SURFACE} flex items-center justify-center disabled:opacity-40`}
              >
                <ChevronRight className="w-4 h-4" aria-hidden />
              </button>
            </div>
          )}
        </div>
      )}

      <div className="flex items-center justify-end pt-1">
        <button
          type="button"
          onClick={props.onSwitchClassic}
          className={`text-[12px] ${INK_3} hover:${INK_2} underline underline-offset-2`}
        >
          Classic view
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Desktop list (§8) — a real table so headers mean something (§25).
// ─────────────────────────────────────────────────────────────────────

function ListView({ rows, ...p }: { rows: PlaylistSummaryRow[] } & RowContext) {
  return (
    <>
      {/* ≥1024: the mock's seven columns. */}
      <div className={`hidden lg:block rounded-[14px] overflow-hidden ${SURFACE}`}>
        <table className="w-full border-collapse" data-testid="playlist-table">
          <caption className="sr-only">Playlists, with schedule state, reach, schedule window and delivery status</caption>
          <thead>
            <tr className={`border-b ${HAIRLINE}`}>
              {['Playlist', 'Status', 'Publishing', 'Schedule', 'Delivery', 'Updated'].map((h) => (
                <th
                  key={h}
                  scope="col"
                  className={`text-left px-4 py-3 text-[11px] font-bold uppercase tracking-wide ${INK_3}`}
                >
                  {h}
                </th>
              ))}
              <th scope="col" className="px-4 py-3"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => <Row key={row.id} row={row} {...p} />)}
          </tbody>
        </table>
      </div>
      {/* <1024: one operational card per playlist (§23.3, §23.4). */}
      <div className="lg:hidden space-y-2">
        {rows.map((row) => <CompactCard key={row.id} row={row} {...p} />)}
      </div>
    </>
  );
}

function Row({ row, ...p }: { row: PlaylistSummaryRow } & RowContext) {
  const attention = needsAttention(row);
  const raw = p.rawById.get(row.id);
  return (
    <tr
      className={`border-b last:border-b-0 ${HAIRLINE} ${attention ? 'bg-amber-50/60' : 'hover:bg-slate-50/70'} transition-colors`}
      data-testid="playlist-row"
      data-attention={attention ? 'true' : 'false'}
    >
      <td className="px-4 py-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-[96px] h-[54px] shrink-0 rounded-md overflow-hidden bg-slate-100 border border-slate-200/70">
            {raw ? <PlaylistPreviewThumb playlist={raw} templateLookup={p.templateLookup} size="tile" /> : null}
          </div>
          <div className="min-w-0">
            {/* The accessible primary target. The row is NOT a button
                containing buttons (§25) — this named control is what a
                keyboard reaches, and the row's own click is a mouse
                convenience layered on top. */}
            <button
              type="button"
              onClick={() => p.onOpen(row.id)}
              className={`block text-left text-[14px] font-bold ${INK} truncate max-w-[240px] hover:underline rounded focus:outline-none focus-visible:ring-2`}
              style={{ ['--tw-ring-color' as string]: 'var(--brand-soft, #CFC4FF)' }}
            >
              {row.name}
            </button>
            <p className={`text-[12px] ${INK_3} truncate`}>{describeContent(row)}</p>
            {row.sourceOwnership === 'hq' && (
              <span className="inline-block mt-0.5 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-[#F0ECFF] text-[#3515E8]">
                Managed by HQ
              </span>
            )}
          </div>
        </div>
      </td>
      <td className="px-4 py-3">
        <StatusPill row={row} attention={attention} />
      </td>
      <td className={`px-4 py-3 text-[13px] ${INK_2} whitespace-nowrap`}>{describeReach(row.reach)}</td>
      <td className={`px-4 py-3 text-[13px] ${INK_2}`}>{row.scheduleSummary}</td>
      <td className="px-4 py-3"><DeliveryCell row={row} derived={p.deliveryDerived} onRetry={p.onRetry} /></td>
      <td className={`px-4 py-3 text-[13px] ${INK_3} whitespace-nowrap`} title={exactStamp(row.updatedAt)}>
        {timeAgo(row.updatedAt)}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center justify-end gap-1">
          {/* §29 — every row has exactly ONE primary action. */}
          <button
            type="button"
            onClick={() => (attention ? p.onReviewDelivery(row.id) : p.onOpen(row.id))}
            className={`h-8 px-3.5 rounded-[9px] border text-[13px] font-bold transition-colors ${
              attention
                ? 'border-amber-300 bg-white text-amber-800 hover:bg-amber-50'
                : `${HAIRLINE} bg-white hover:bg-slate-50`
            }`}
            style={attention ? undefined : { color: 'var(--brand-primary, #3515E8)' }}
          >
            {attention ? 'Review' : 'Open'}
          </button>
          <OverflowMenu row={row} {...p} />
        </div>
      </td>
    </tr>
  );
}

function StatusPill({ row, attention }: { row: PlaylistSummaryRow; attention: boolean }) {
  const label = attention ? 'NEEDS ATTENTION' : row.statusLabel;
  return (
    <span
      className={`inline-block px-2 py-1 rounded-md border text-[10px] font-bold uppercase tracking-wide whitespace-nowrap ${
        STATUS_TONE[label] ?? STATUS_TONE.PAUSED
      }`}
      data-testid="status-pill"
    >
      {label}
    </span>
  );
}

/**
 * §22.5 — when the delivery read failed, this cell says so and offers a retry.
 * It is never allowed to fall back to a calm gray, and it never prints a count
 * it did not receive.
 */
function DeliveryCell({
  row, derived, onRetry,
}: { row: PlaylistSummaryRow; derived: boolean; onRetry: () => void }) {
  const d = row.delivery;
  const tone = DELIVERY_TONE[d.tone] ?? DELIVERY_TONE.muted;
  const Icon = d.tone === 'ok' ? Check : d.tone === 'muted' ? Clock : AlertTriangle;
  return (
    <div className="flex items-start gap-1.5" data-testid="delivery-cell" data-tone={d.tone}>
      <Icon className={`w-4 h-4 shrink-0 mt-0.5 ${tone}`} aria-hidden />
      <div className="min-w-0">
        <p className={`text-[13px] font-semibold ${tone}`}>{d.label}</p>
        {d.tone === 'unavailable' && (
          <button type="button" onClick={onRetry} className="text-[12px] font-bold underline text-amber-800">
            Retry delivery status
          </button>
        )}
        {derived && d.tone === 'ok' && (
          <p className={`text-[11px] ${INK_3}`}>From each screen’s own report</p>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Tablet / mobile card (§23.3, §23.4)
// ─────────────────────────────────────────────────────────────────────

function CompactCard({ row, ...p }: { row: PlaylistSummaryRow } & RowContext) {
  const attention = needsAttention(row);
  const raw = p.rawById.get(row.id);
  return (
    <div
      className={`rounded-[12px] p-3 ${SURFACE} ${attention ? 'bg-amber-50/60 border-amber-200' : ''}`}
      data-testid="playlist-card-compact"
    >
      <div className="flex items-start gap-3">
        <div className="w-[84px] h-[47px] shrink-0 rounded-md overflow-hidden bg-slate-100 border border-slate-200/70">
          {raw ? <PlaylistPreviewThumb playlist={raw} templateLookup={p.templateLookup} size="tile" /> : null}
        </div>
        <div className="flex-1 min-w-0">
          <button
            type="button"
            onClick={() => p.onOpen(row.id)}
            className={`block text-left text-[14px] font-bold ${INK} truncate w-full`}
          >
            {row.name}
          </button>
          <p className={`text-[12px] ${INK_3} truncate`}>{describeContent(row)}</p>
        </div>
        <StatusPill row={row} attention={attention} />
      </div>
      <dl className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1.5">
        {([
          ['Publishing', describeReach(row.reach)],
          ['Schedule', row.scheduleSummary],
        ] as const).map(([k, v]) => (
          <div key={k} className="min-w-0">
            <dt className={`text-[10px] font-bold uppercase tracking-wide ${INK_3}`}>{k}</dt>
            <dd className={`text-[12px] ${INK_2} truncate`} title={v}>{v}</dd>
          </div>
        ))}
        <div className="col-span-2 min-w-0">
          <dt className={`text-[10px] font-bold uppercase tracking-wide ${INK_3}`}>Delivery</dt>
          <dd><DeliveryCell row={row} derived={p.deliveryDerived} onRetry={p.onRetry} /></dd>
        </div>
      </dl>
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={() => (attention ? p.onReviewDelivery(row.id) : p.onOpen(row.id))}
          className={`flex-1 h-11 rounded-[10px] border text-[13px] font-bold ${
            attention ? 'border-amber-300 bg-white text-amber-800' : `${HAIRLINE} bg-white`
          }`}
          style={attention ? undefined : { color: 'var(--brand-primary, #3515E8)' }}
        >
          {attention ? 'Review' : 'Open'}
        </button>
        <OverflowMenu row={row} sheetOnMobile {...p} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Grid (§9) — fixed card height, one delivery line, no animated previews.
// ─────────────────────────────────────────────────────────────────────

function GridView({ rows, ...p }: { rows: PlaylistSummaryRow[] } & RowContext) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
      {rows.map((row) => {
        const attention = needsAttention(row);
        const raw = p.rawById.get(row.id);
        return (
          <div
            key={row.id}
            className={`rounded-[12px] overflow-hidden flex flex-col h-[290px] ${SURFACE} ${attention ? 'border-amber-200 bg-amber-50/50' : ''}`}
            data-testid="playlist-card-grid"
          >
            <div className="h-[132px] bg-slate-100 overflow-hidden shrink-0">
              {raw ? <PlaylistPreviewThumb playlist={raw} templateLookup={p.templateLookup} size="tile" /> : null}
            </div>
            <div className="p-3 flex-1 flex flex-col min-h-0">
              <div className="flex items-start justify-between gap-2">
                <button
                  type="button"
                  onClick={() => p.onOpen(row.id)}
                  className={`text-left text-[14px] font-bold ${INK} truncate`}
                >
                  {row.name}
                </button>
                <StatusPill row={row} attention={attention} />
              </div>
              <p className={`text-[12px] ${INK_3} truncate`}>{describeContent(row)}</p>
              <p className={`text-[12px] ${INK_2} truncate mt-1.5`}>{describeReach(row.reach)}</p>
              <p className={`text-[12px] ${INK_2} truncate`}>{row.scheduleSummary}</p>
              <div className="mt-1.5 min-h-[36px]">
                <DeliveryCell row={row} derived={p.deliveryDerived} onRetry={p.onRetry} />
              </div>
              <div className="mt-auto pt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => (attention ? p.onReviewDelivery(row.id) : p.onOpen(row.id))}
                  className={`flex-1 h-9 rounded-[9px] border text-[13px] font-bold ${
                    attention ? 'border-amber-300 bg-white text-amber-800' : `${HAIRLINE} bg-white`
                  }`}
                  style={attention ? undefined : { color: 'var(--brand-primary, #3515E8)' }}
                >
                  {attention ? 'Review' : 'Open'}
                </button>
                <OverflowMenu row={row} {...p} />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Overflow (§8.4) — every entry is LABELLED. Nothing fleet-wide or
// destructive ever hides behind an unlabelled icon.
// ─────────────────────────────────────────────────────────────────────

function OverflowMenu({
  row, sheetOnMobile, ...p
}: { row: PlaylistSummaryRow; sheetOnMobile?: boolean } & RowContext) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      if (triggerRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      triggerRef.current?.focus(); // focus returns to the trigger (§25)
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const act = (fn: () => void) => () => { setOpen(false); fn(); };

  const items: Array<{ label: string; icon: typeof Eye; run: () => void; danger?: boolean; divider?: boolean }> = [
    { label: 'Open', icon: Eye, run: () => p.onOpen(row.id) },
    { label: 'Preview', icon: Eye, run: () => p.onPreview(row.id) },
  ];
  if (!p.isViewer) {
    items.push({
      label: p.isContributor ? 'Send for review' : 'Publish or schedule',
      icon: Upload,
      run: () => (p.isContributor && p.onSubmitForReview ? p.onSubmitForReview(row.id) : p.onPublishSchedule(row.id)),
    });
    items.push({ label: 'Duplicate', icon: Copy, run: () => p.onDuplicate(row.id) });
  }
  items.push({ label: 'Export for offline use', icon: Upload, run: () => p.onExport(row.id) });
  if (p.isHQ && p.onPublishToLocations && !p.isViewer && row.sourceOwnership === 'own') {
    items.push({ label: `Publish to ${p.locationNoun}`, icon: Upload, run: () => p.onPublishToLocations!() });
  }
  if (!p.isViewer) {
    items.push({ label: 'Remove playlist', icon: Trash2, run: () => p.onRemove(row), danger: true, divider: true });
  }

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`More actions for ${row.name}`}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className={`w-9 h-9 rounded-[9px] flex items-center justify-center ${INK_3} hover:bg-slate-100 transition-colors`}
      >
        <MoreHorizontal className="w-4 h-4" aria-hidden />
      </button>
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={`Actions for ${row.name}`}
          className={`absolute right-0 z-30 mt-1 w-56 rounded-[12px] py-1 shadow-lg ${SURFACE} ${
            sheetOnMobile ? 'bottom-full mb-1' : ''
          }`}
        >
          {items.map((item) => (
            <div key={item.label}>
              {item.divider && <div className={`my-1 border-t ${HAIRLINE}`} />}
              <button
                type="button"
                role="menuitem"
                onClick={act(item.run)}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left text-[13px] font-medium hover:bg-slate-50 ${
                  item.danger ? 'text-rose-700' : INK
                }`}
              >
                <item.icon className="w-4 h-4 shrink-0" aria-hidden />
                {item.label}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Filters (§21.2) — progressive disclosure, never four raw selects on the page.
// ─────────────────────────────────────────────────────────────────────

function FiltersControl({
  open, setOpen, filters, setFilters, count, creatorOptions, screenOptions, groupOptions,
}: {
  open: boolean;
  setOpen: (v: boolean) => void;
  filters: LibraryFilters;
  setFilters: (f: LibraryFilters) => void;
  count: number;
  creatorOptions: string[];
  screenOptions: Array<{ id: string; name: string }>;
  groupOptions: Array<{ id: string; name: string }>;
}) {
  const panelId = useId();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, setOpen]);

  const set = <K extends keyof LibraryFilters>(k: K, v: LibraryFilters[K]) =>
    setFilters({ ...filters, [k]: v });

  const field = (label: string, node: React.ReactNode) => (
    <label className="block">
      <span className={`block text-[11px] font-bold uppercase tracking-wide ${INK_3} mb-1`}>{label}</span>
      {node}
    </label>
  );
  const selectCls = `w-full h-9 px-2 rounded-[8px] border ${HAIRLINE} bg-white text-[13px] ${INK} outline-none`;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        className={`inline-flex items-center gap-2 h-11 px-3.5 rounded-[10px] text-[13px] font-semibold ${SURFACE} ${INK}`}
      >
        <SlidersHorizontal className="w-4 h-4" aria-hidden />
        Filters
        {count > 0 && (
          <span
            className="ml-0.5 min-w-5 h-5 px-1.5 rounded-full text-[11px] font-bold text-white inline-flex items-center justify-center"
            style={{ background: 'var(--brand-primary, #3515E8)' }}
          >
            {count}
          </span>
        )}
      </button>
      {open && (
        <div
          id={panelId}
          className={`absolute right-0 z-30 mt-1 w-[300px] rounded-[12px] p-3 shadow-lg space-y-3 ${SURFACE}`}
        >
          {field('Content type', (
            <select className={selectCls} value={filters.contentType} onChange={(e) => set('contentType', e.target.value as LibraryFilters['contentType'])}>
              <option value="all">Any</option>
              <option value="media">Media</option>
              <option value="template">Template</option>
            </select>
          ))}
          {field('Delivery', (
            <select className={selectCls} value={filters.deliveryHealth} onChange={(e) => set('deliveryHealth', e.target.value as LibraryFilters['deliveryHealth'])}>
              <option value="all">Any</option>
              <option value="ok">Confirmed on every screen</option>
              <option value="attention">Needs attention</option>
              <option value="not-published">Not published</option>
            </select>
          ))}
          {creatorOptions.length > 0 && field('Created by', (
            <select className={selectCls} value={filters.creatorId} onChange={(e) => set('creatorId', e.target.value)}>
              <option value="all">Anyone</option>
              {creatorOptions.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          ))}
          {groupOptions.length > 0 && field('Screen group', (
            <select className={selectCls} value={filters.groupId} onChange={(e) => set('groupId', e.target.value)}>
              <option value="all">Any group</option>
              {groupOptions.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          ))}
          {screenOptions.length > 0 && field('Screen', (
            <select className={selectCls} value={filters.screenId} onChange={(e) => set('screenId', e.target.value)}>
              <option value="all">Any screen</option>
              {screenOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          ))}
          {field('Source', (
            <select className={selectCls} value={filters.ownership} onChange={(e) => set('ownership', e.target.value as LibraryFilters['ownership'])}>
              <option value="all">Any</option>
              <option value="own">Created here</option>
              <option value="hq">Managed by HQ</option>
            </select>
          ))}
          <button
            type="button"
            onClick={() => setFilters(EMPTY_FILTERS)}
            className={`w-full h-9 rounded-[8px] border ${HAIRLINE} text-[13px] font-semibold ${INK_2} hover:bg-slate-50`}
          >
            Clear all
          </button>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Loading + empty (§22.1–§22.4). A failure is never presented as an
// empty library, and loading keeps the header + controls stable.
// ─────────────────────────────────────────────────────────────────────

function LoadingRows() {
  return (
    <div className={`rounded-[14px] overflow-hidden ${SURFACE}`} aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading playlists…</span>
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className={`flex items-center gap-3 px-4 py-3 border-b last:border-b-0 ${HAIRLINE}`}>
          <div className="w-[96px] h-[54px] rounded-md bg-slate-100 animate-pulse shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="h-3.5 w-48 rounded bg-slate-100 animate-pulse" />
            <div className="h-3 w-32 rounded bg-slate-100 animate-pulse" />
          </div>
          <div className="hidden lg:block h-6 w-20 rounded bg-slate-100 animate-pulse" />
          <div className="hidden lg:block h-3.5 w-32 rounded bg-slate-100 animate-pulse" />
          <div className="h-8 w-16 rounded bg-slate-100 animate-pulse" />
        </div>
      ))}
    </div>
  );
}

function EmptyState({
  title, body, actionLabel, onAction,
}: { title: string; body: string; actionLabel?: string; onAction?: () => void }) {
  return (
    <div className={`rounded-[14px] px-6 py-14 text-center ${SURFACE}`}>
      <h2 className={`text-[16px] font-bold ${INK}`}>{title}</h2>
      <p className={`text-[13px] ${INK_2} mt-1 max-w-md mx-auto`}>{body}</p>
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="mt-4 inline-flex items-center gap-2 h-10 px-4 rounded-[10px] text-[13px] font-bold text-white"
          style={{ background: 'var(--brand-primary, #3515E8)' }}
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}

export default PlaylistLibraryV1;
