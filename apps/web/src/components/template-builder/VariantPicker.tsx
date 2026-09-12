"use client";

/**
 * VariantPicker — the WIDGETS panel of the template builder.
 *
 * ── WHAT THIS REPLACED (Phase 2, 2026-09-11) ────────────────────────────────
 * The operator, after losing a customer demo to this surface: *"when you click
 * on widgets its blank and i thought we were going to redesign all these
 * fucking filter pills we have, its a fucking ugly mess."* Both halves were
 * real, and they were the same surface:
 *
 *   1. BLANK FROM SCRATCH. Creating a template seeds ONE full-screen zone of
 *      widgetType `EMPTY`. BuilderShell auto-selected that sole zone on load,
 *      any selection flipped the panel to Properties, and this component
 *      locked its type filter to the selected zone's widgetType. ZERO variants
 *      are registered for `EMPTY` — so a brand-new template opened on
 *      Properties, and clicking WIDGETS showed an empty grid with a "no
 *      variants match" card and no way out. The whole chain is fixed: the
 *      placeholder no longer drives the panel (BuilderShell), it no longer
 *      locks the filter (below), and no filter state can render an escape-less
 *      empty grid (the reset in the empty state).
 *
 *   2. THE PILL WALL. ~30 chips stacked seven-plus rows deep ABOVE the first
 *      visible widget, twelve of which printed the raw database enum at the
 *      operator (`HOUSE_AD_BANNER`, `FITNESS_STICK_LAUNCHER`,
 *      `STADIUM_MEET_BOARD`). Replaced with the shape every researched product
 *      converges on (Canva, Yodeck, ScreenCloud, OptiSigns, Rise Vision, Wix
 *      Studio): ONE search field, a curated default of ≤12 flagship widgets,
 *      named category rows with a per-row "See all", and ONE filter button
 *      holding at most four axes. Labels come from `widget-catalog.ts`, which
 *      can never emit an enum.
 *
 *   3. ADD ≠ REPLACE. The tile tooltip said "click to swap, drag to add" —
 *      backwards from every builder an operator has used, and a lie besides
 *      (both gestures added). Now: a click ADDS, or FILLS the selected empty
 *      placeholder; replacing an occupied zone is an explicit labelled choice.
 *      Drag stays an enhancement and is never the only way to do anything.
 *
 * INVARIANTS FOR ANYONE EDITING THIS FILE:
 *   - Never render a state with zero widgets and no one-click way back.
 *   - Never print a `SCREAMING_SNAKE` widget type. Use `friendlyTypeLabel`.
 *   - Industry-specific chrome is gated on `verticalKnown` — an INFERRED
 *     vertical must never paint school grade filters on a corporate account.
 *   - Everything must be reachable by click and by keyboard. Drag is extra.
 */

import { useMemo, useState, useEffect, type ReactNode } from 'react';
import { Search, X, SlidersHorizontal, ChevronRight, RotateCcw } from 'lucide-react';
import { useDraggable } from '@dnd-kit/core';
import '@/components/widgets/variants-register'; // boot-time registration
import {
  listVariants,
  type WidgetVariant,
} from '@/components/widgets/variants';
import { useBuilderStore, seedDefaultConfig, layoutReplacementTargets } from './useBuilderStore';
import { useTenantCopy } from '@/hooks/use-tenant-copy';
import { WidgetErrorBoundary } from '@/components/widgets/WidgetErrorBoundary';
// Wave B / editor-crush B6a (2026-07-02) — smart drop sizes so palette adds
// land at their natural footprint (shared with BuilderShell.handleDragEnd).
import { resolveDropSize } from './drop-sizes';
import {
  WIDGET_CATEGORIES, OTHER_CATEGORY, categoryForType,
  friendlyTypeLabel, friendlyVariantName,
  deriveStyleOptions, derivePlaceOptions, matchesStyle, matchesPlace,
  curatedFlagships, CURATED_LIMIT,
} from './widget-catalog';

/** Tiles shown in a category row before the operator has to say "See all". */
const ROW_TILES = 6;

// Map a variant's category (the scene name) to school grade levels.
// Each variant can fit one or more levels; "Universal" means it works K-12.
//
// 2026-04-28 — operator: "the filters in widgets dont seem to do anyting."
// Categories LITERALLY named after a level (HIGH, MIDDLE, ELEMENTARY) map
// strictly to that level — no Universal fallback, so a "MIDDLE School Lunch
// Menu" does not appear under Elementary. Categories that aren't level-themed
// (MODERN, MINIMAL, …) get 'Universal' and appear under every level.
const CATEGORY_TO_LEVELS: Record<string, string[]> = {
  // Strict level categories — only that level, no Universal.
  ELEMENTARY: ['Elementary'],
  MIDDLE:     ['Middle'],
  HIGH:       ['High'],
  // Functional categories — bias toward a couple of levels.
  CLASSROOM:  ['Elementary', 'Middle'],
  PLAYFUL:    ['Elementary'],
  HALLWAY:    ['Middle', 'High'],
  ATHLETICS:  ['Middle', 'High'],
  ARTS:       ['Middle', 'High'],
  STEM:       ['Middle', 'High'],
  DARK:       ['High'],
  BOLD:       ['High'],
  // Universal — work everywhere.
  CAFETERIA:  ['Universal'],
  SAFETY:     ['Universal'],
  LIBRARY:    ['Universal'],
  OFFICE:     ['Universal'],
  MODERN:     ['Universal'],
  MINIMAL:    ['Universal'],
  BROADCAST:  ['Universal'],
  LOBBY:      ['Universal'],
};

function variantLevels(category?: string): string[] {
  if (!category) return ['Universal'];
  return CATEGORY_TO_LEVELS[category] || ['Universal'];
}

// 2026-05-03 — VenueOS rebrand: variant filtering by tenant vertical. The
// catalogue carries hundreds of K-12-themed tiles (Polaroid, PTA, Pennant
// Banner, Crest Sticker, Chalkboard) registered against universal widget types.
// For a gym tenant those are noise. K12 sees everything; other verticals hide
// the categories that clearly map to a K-12 audience. Variants with no
// category stay visible so the picker is never starved.
// CYCLE-5 v2-ops-console-not-k12-only fix — 'OFFICE' removed: the v2 admin
// "Ops Console" widgets carry category=OFFICE and are neutral cyber-aesthetic,
// equally relevant to a gym, restaurant, retail or corporate tenant.
const K12_ONLY_CATEGORIES: ReadonlySet<string> = new Set([
  'ELEMENTARY', 'MIDDLE', 'HIGH',
  'CLASSROOM', 'PLAYFUL', 'HALLWAY',
  'CAFETERIA', 'LIBRARY',
  'ATHLETICS', 'ARTS', 'STEM',
  'SAFETY',
]);

// 2026-05-29 — operator: "all widgets showing up under the sports venue; every
// business type should filter widgets to just what pertains to it." Only
// BAR/GYM/SPORTS variants were ever explicitly `vertical`-tagged, so the
// RESTAURANT_/RETAIL_/WORSHIP/HEALTHCARE packs leaked into EVERY vertical.
// This derives the vertical a widget TYPE is exclusive to from its type-name
// prefix. Returns null for universal signage types, which show everywhere.
export function verticalForWidgetType(wt: string): string | null {
  if (/^RESTAURANT(_|$)/.test(wt)) return 'RESTAURANT';
  if (/^BAR_/.test(wt)) return 'BAR';
  if (/^RETAIL(_|$)/.test(wt)) return 'RETAIL';
  if (/^FITNESS_/.test(wt)) return 'GYM';
  if (wt === 'WORSHIP') return 'WORSHIP';
  if (wt === 'HEALTHCARE') return 'HEALTHCARE';
  if (wt === 'HOSPITALITY') return 'HOSPITALITY';
  if (wt === 'CORPORATE') return 'CORPORATE';
  // SWIM_ / DIVE_ (2026-07-01 swim/dive split flagship widgets) join the
  // SPORTS-exclusive prefix set alongside SCOREBOARD/SCORE_/GAME_.
  if (/^(SCOREBOARD|SCORE_|GAME_|SWIM_|DIVE_)/.test(wt)) return 'SPORTS';
  if (/^(HS_|MS_|BULLETIN_|SCRAPBOOK_|STORYBOOK_)/.test(wt)) return 'K12';
  if (/^ANIMATED_(WELCOME|CAFETERIA|BELL|BUS|HALLWAY|MAIN_ENTRANCE|MORNING_NEWS|ACHIEVEMENT)/.test(wt)) return 'K12';
  return null;
}

function variantVisibleForVertical(v: WidgetVariant, vertical: string): boolean {
  // Multi-vertical scoped widgets (a Lunch Menu tagged [K12, QSR, RESTAURANT,
  // HOSPITALITY, BAR, CORPORATE] shows in exactly those and nowhere else).
  if (v.verticals && v.verticals.length) return v.verticals.includes(vertical);
  // Single business-line scoped widgets show ONLY in their own vertical.
  if (v.vertical) return v.vertical === vertical;
  // Type-name prefix → vertical (catches packs that were never tagged).
  const typeVertical = verticalForWidgetType(v.widgetType);
  if (typeVertical) return typeVertical === vertical;
  if (vertical === 'K12') return true;
  if (!v.category) return true; // neutral / no metadata — keep
  return !K12_ONLY_CATEGORIES.has(v.category.toUpperCase());
}

/** The variant id currently applied to a zone, if any. `defaultConfig` is an
 *  untyped bag on the Zone model, so read it once, here, rather than casting
 *  at four call sites. */
function zoneVariantId(zone: { defaultConfig?: Record<string, unknown> | null } | null | undefined): string | undefined {
  const v = zone?.defaultConfig?.variant;
  return typeof v === 'string' ? v : undefined;
}

/** A zone's name, guaranteed never to read as a database enum. */
function zoneDisplayName(zone: { name?: string; widgetType: string } | null | undefined): string {
  if (!zone) return 'this widget';
  const n = (zone.name || '').trim();
  if (!n || /^[A-Z0-9]+(_[A-Z0-9]+)+/.test(n)) return friendlyTypeLabel(zone.widgetType);
  return n;
}

type PickAction = 'add' | 'fill' | 'replace';

export function VariantPicker() {
  const zones          = useBuilderStore(s => s.zones);
  const selectedIds    = useBuilderStore(s => s.selectedIds);
  const updateZone     = useBuilderStore(s => s.updateZone);
  const addZone        = useBuilderStore(s => s.addZone);
  const setZoneWidget  = useBuilderStore(s => s.setZoneWidget);

  const tenantCopy = useTenantCopy();
  // 2026-09-11 — a CORPORATE operator was shown "School level: All grades /
  // Elementary / Middle / High" while building a board. `normalizeVertical()`
  // falls back to K12 for a missing value and ProfileHydrator (which heals
  // exactly that) is mounted in DashboardLayout — a shell the builder route
  // does not use. An INFERRED vertical must never paint industry chrome.
  const isK12 = tenantCopy.verticalKnown && tenantCopy.vertical === 'K12';

  const selected = selectedIds.length === 1
    ? zones.find(z => z.id === selectedIds[0])
    : null;
  /**
   * The seeded, never-touched full-screen placeholder a new template ships
   * with. It accepts ANY widget, so it must never narrow the library — and
   * clicking a widget FILLS it rather than dropping a second zone on top.
   */
  const selectedIsPlaceholder = !!selected && selected.widgetType === 'EMPTY';

  const [search, setSearch]           = useState('');
  const [category, setCategory]       = useState<string>('ALL');
  const [style, setStyle]             = useState<string>('ALL');
  const [place, setPlace]             = useState<string>('ALL');
  const [level, setLevel]             = useState<string>('ALL');
  /** Set by "See all styles" on the restyle row — a single widget type. */
  const [typeFilter, setTypeFilter]   = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  /**
   * REPLACE is opt-in and labelled. It resets whenever the selection changes,
   * so a mode chosen for one zone can never silently destroy the next one.
   */
  const [replaceMode, setReplaceMode] = useState(false);
  useEffect(() => { setReplaceMode(false); }, [selected?.id]);

  // Everything this tenant is allowed to see, before any operator filter.
  const visible = useMemo(
    () => listVariants().filter(v => variantVisibleForVertical(v, tenantCopy.vertical)),
    [tenantCopy.vertical],
  );

  const styleOptions = useMemo(() => deriveStyleOptions(visible), [visible]);
  const placeOptions = useMemo(() => derivePlaceOptions(visible), [visible]);

  const activeFilters =
    (category !== 'ALL' ? 1 : 0) +
    (style !== 'ALL' ? 1 : 0) +
    (place !== 'ALL' ? 1 : 0) +
    (isK12 && level !== 'ALL' ? 1 : 0);
  const searching = search.trim().length > 0;
  /** True whenever the operator has narrowed the library in any way. */
  const browsing = searching || activeFilters > 0 || !!typeFilter;

  const resetAll = () => {
    setSearch(''); setCategory('ALL'); setStyle('ALL'); setPlace('ALL');
    setLevel('ALL'); setTypeFilter(null); setFiltersOpen(false);
  };

  /** The flat list shown whenever the operator is browsing. */
  const results = useMemo(() => {
    let list = visible;
    if (typeFilter) list = list.filter(v => v.widgetType === typeFilter);
    if (category !== 'ALL') list = list.filter(v => categoryForType(String(v.widgetType)) === category);
    if (style !== 'ALL') list = list.filter(v => matchesStyle(v, style));
    if (place !== 'ALL') list = list.filter(v => matchesPlace(v, place));
    if (isK12 && level !== 'ALL') {
      list = list.filter(v => {
        const levels = variantLevels(v.category);
        return levels.includes(level) || levels.includes('Universal');
      });
    }
    if (searching) {
      const q = search.trim().toLowerCase();
      list = list.filter(v =>
        v.name.toLowerCase().includes(q) ||
        (v.description?.toLowerCase().includes(q)) ||
        friendlyTypeLabel(String(v.widgetType)).toLowerCase().includes(q),
      );
    }
    return list;
  }, [visible, typeFilter, category, style, place, level, isK12, search, searching]);

  // The curated default — ≤12 flagship widgets for THIS tenant, never the
  // whole catalogue. This is the first thing a first-time operator sees.
  const curated = useMemo(
    () => curatedFlagships(visible, tenantCopy.vertical, CURATED_LIMIT),
    [visible, tenantCopy.vertical],
  );

  // Named rows, built from what this tenant can actually see. A category with
  // nothing in it does not render; anything uncategorised lands in "More
  // widgets" so a newly-registered widget type can never become invisible.
  const rows = useMemo(() => {
    const buckets = new Map<string, WidgetVariant[]>();
    for (const v of visible) {
      const cid = categoryForType(String(v.widgetType));
      const arr = buckets.get(cid);
      if (arr) arr.push(v); else buckets.set(cid, [v]);
    }
    const ordered = [...WIDGET_CATEGORIES, OTHER_CATEGORY]
      .map(c => ({ cat: c, items: buckets.get(c.id) || [] }))
      .filter(r => r.items.length > 0);
    return ordered;
  }, [visible]);

  /** Styles registered for the selected zone's own widget type. */
  const selectedType = selected && !selectedIsPlaceholder ? String(selected.widgetType) : null;
  const restyleOptions = useMemo(
    () => (selectedType ? visible.filter(v => String(v.widgetType) === selectedType) : []),
    [visible, selectedType],
  );

  const defaultAction: PickAction = selectedIsPlaceholder
    ? 'fill'
    : (replaceMode && selected ? 'replace' : 'add');

  const handlePick = (v: WidgetVariant, action: PickAction) => {
    if (action !== 'add' && selected) {
      // FILL the seeded placeholder, or an explicit REPLACE. Keeps the zone's
      // position and size — that is the whole point — and is one undo step.
      setZoneWidget(selected.id, String(v.widgetType), v.id, v.defaultConfig);
      return;
    }
    // 2026-05-03 — a click always APPENDS. Swap behaviour used to ride on the
    // same gesture and silently overwrote whatever happened to be selected.
    // Wave B / editor-crush B6a (2026-07-02): smart drop size so a LOGO, a
    // TICKER and a divider line land at their natural footprint.
    const id = addZone(String(v.widgetType), undefined, resolveDropSize(String(v.widgetType), v.id));
    updateZone(id, {
      // Seed first so a widget whose variant config omits its content key
      // (TEXT without `content`, WEBPAGE without `url`) still renders
      // something visible — the same merge order `setZoneWidget` uses, so the
      // add and fill paths cannot drift apart.
      defaultConfig: { ...seedDefaultConfig(String(v.widgetType)), ...(v.defaultConfig || {}), variant: v.id },
    });
  };

  const selectedName = zoneDisplayName(selected);

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      {/* Quick layouts — a starting split for the canvas. Hidden while the
          operator is narrowing the library; it is a layout tool, not a
          search result. */}
      {!browsing && <QuickLayoutsSection />}

      {/* ── Header: ONE search field + ONE filter button ──────────────── */}
      <div className="px-4 py-3 border-b border-slate-100 shrink-0 space-y-2">
        <div className="flex items-center gap-2">
          <div className="relative flex-1 min-w-0">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden />
            <input
              type="search"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search widgets…"
              aria-label="Search widgets"
              className="w-full pl-7 pr-2 py-1.5 text-xs border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
          </div>
          <button
            type="button"
            onClick={() => setFiltersOpen(o => !o)}
            aria-expanded={filtersOpen}
            aria-controls="widget-filters"
            className={`shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-semibold border transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-400 ${
              activeFilters > 0
                ? 'bg-indigo-600 text-white border-indigo-600'
                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
            }`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" aria-hidden />
            Filters
            {activeFilters > 0 && (
              <span className="ml-0.5 rounded-full bg-white/25 px-1.5 leading-4">{activeFilters}</span>
            )}
          </button>
        </div>

        {filtersOpen && (
          <div id="widget-filters" className="rounded-lg border border-slate-200 bg-slate-50/70 p-2.5 space-y-2.5">
            <FilterAxis
              label="Category"
              value={category}
              onChange={(v) => { setCategory(v); setTypeFilter(null); }}
              options={rows.map(r => ({ id: r.cat.id, label: r.cat.label }))}
              allLabel="Everything"
            />
            {styleOptions.length > 1 && (
              <FilterAxis label="Look" value={style} onChange={setStyle} options={styleOptions} allLabel="Any look" />
            )}
            {placeOptions.length > 1 && (
              <FilterAxis label="Where it goes" value={place} onChange={setPlace} options={placeOptions} allLabel="Anywhere" />
            )}
            {/* K-12 ONLY, and only when the industry is genuinely KNOWN. */}
            {isK12 && (
              <FilterAxis
                label="School level"
                value={level}
                onChange={setLevel}
                options={[{ id: 'Elementary', label: 'Elementary' }, { id: 'Middle', label: 'Middle' }, { id: 'High', label: 'High' }]}
                allLabel="All grades"
              />
            )}
            {activeFilters > 0 && (
              <button
                type="button"
                onClick={resetAll}
                className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-slate-500 hover:text-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-400 rounded px-1"
              >
                <RotateCcw className="w-3 h-3" aria-hidden /> Clear filters
              </button>
            )}
          </div>
        )}

        {/* ── ADD vs REPLACE. A click never silently destroys a zone. ──── */}
        {selected && (
          selectedIsPlaceholder ? (
            <p className="text-[11px] text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-md px-2 py-1.5">
              Your board is still empty — pick any widget below and it drops straight into the blank area.
            </p>
          ) : (
            <div role="group" aria-label="What happens when you click a widget" className="flex items-center gap-1">
              <ModeButton active={!replaceMode} onClick={() => setReplaceMode(false)} label="Add to board" />
              <ModeButton
                active={replaceMode}
                onClick={() => setReplaceMode(true)}
                label={`Replace “${selectedName}”`}
                danger
              />
            </div>
          )
        )}
      </div>

      {/* ── Body ──────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto p-3 bg-slate-50/40">
        {browsing ? (
          <>
            <div className="flex items-center justify-between gap-2 mb-2">
              <h3 className="text-xs font-bold text-slate-700 truncate">
                {typeFilter
                  ? `${friendlyTypeLabel(typeFilter)} styles`
                  : (category !== 'ALL'
                      ? ([...WIDGET_CATEGORIES, OTHER_CATEGORY].find(c => c.id === category)?.label || 'Results')
                      : 'Results')}
                <span className="ml-1.5 font-medium text-slate-400">{results.length}</span>
              </h3>
              <button
                type="button"
                onClick={resetAll}
                className="shrink-0 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-400"
              >
                <X className="w-3 h-3" aria-hidden /> All widgets
              </button>
            </div>
            {results.length === 0 ? (
              <EmptyResults onReset={resetAll} search={search} />
            ) : (
              <TileGrid
                slot="results"
                variants={results}
                selectedVariantId={zoneVariantId(selected)}
                action={defaultAction}
                zoneName={selectedName}
                onPick={handlePick}
              />
            )}
          </>
        ) : (
          <div className="space-y-5">
            {/* Restyle — the one place a click is always a REPLACE, and it
                says so on every tile. Only for an occupied zone. */}
            {restyleOptions.length > 0 && selected && (
              <Section
                title={`Restyle “${selectedName}”`}
                blurb="These swap this widget's look. They replace it — they don't add another."
                count={restyleOptions.length}
                onSeeAll={restyleOptions.length > ROW_TILES ? () => setTypeFilter(String(selected.widgetType)) : undefined}
              >
                <TileGrid
                  slot="restyle"
                  variants={restyleOptions.slice(0, ROW_TILES)}
                  selectedVariantId={zoneVariantId(selected)}
                  action="replace"
                  zoneName={selectedName}
                  onPick={handlePick}
                />
              </Section>
            )}

            <Section
              title={selectedIsPlaceholder ? 'Start here' : 'Most used'}
              blurb="The handful most boards actually start with."
              count={curated.length}
            >
              <TileGrid
                slot="curated"
                variants={curated}
                selectedVariantId={zoneVariantId(selected)}
                action={defaultAction}
                zoneName={selectedName}
                onPick={handlePick}
              />
            </Section>

            {rows.map(({ cat, items }) => (
              <Section
                key={cat.id}
                title={cat.label}
                blurb={cat.blurb}
                count={items.length}
                onSeeAll={items.length > ROW_TILES ? () => { setCategory(cat.id); setFiltersOpen(false); } : undefined}
              >
                <TileGrid
                  slot={`cat-${cat.id}`}
                  variants={items.slice(0, ROW_TILES)}
                  selectedVariantId={zoneVariantId(selected)}
                  action={defaultAction}
                  zoneName={selectedName}
                  onPick={handlePick}
                />
              </Section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ModeButton({ active, onClick, label, danger }: { active: boolean; onClick: () => void; label: string; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex-1 min-w-0 truncate px-2 py-1.5 rounded-md text-[11px] font-semibold border transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-400 ${
        active
          ? (danger ? 'bg-amber-500 text-white border-amber-500' : 'bg-indigo-600 text-white border-indigo-600')
          : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
      }`}
    >
      {label}
    </button>
  );
}

/**
 * One filter axis, as a single compact dropdown.
 *
 * DELIBERATELY NOT CHIPS (2026-09-11). Rendering ~26 options as buttons would
 * rebuild the pill wall inside the popover — smaller, hidden, and still the
 * thing the operator called "a fucking ugly mess". A `select` is one control
 * per axis, keyboard-operable for free, and it collapses to its current value.
 */
function FilterAxis({
  label, value, onChange, options, allLabel,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ id: string; label: string }>;
  allLabel: string;
}) {
  const id = `widget-filter-${label.replace(/\s+/g, '-').toLowerCase()}`;
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="w-24 shrink-0 text-[9px] font-bold uppercase tracking-wider text-slate-400">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`flex-1 min-w-0 text-[11px] font-semibold px-2 py-1.5 rounded-md border bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400 ${
          value === 'ALL' ? 'border-slate-200 text-slate-600' : 'border-indigo-400 text-indigo-700'
        }`}
      >
        <option value="ALL">{allLabel}</option>
        {options.map(o => (
          <option key={o.id} value={o.id}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

function Section({
  title, blurb, count, onSeeAll, children,
}: {
  title: string;
  blurb: string;
  count: number;
  onSeeAll?: () => void;
  children: ReactNode;
}) {
  return (
    <section>
      <div className="flex items-end justify-between gap-2 mb-1.5">
        <div className="min-w-0">
          <h3 className="text-xs font-bold text-slate-800 truncate">
            {title}
            <span className="ml-1.5 font-medium text-slate-400">{count}</span>
          </h3>
          <p className="text-[10px] text-slate-500 leading-snug">{blurb}</p>
        </div>
        {onSeeAll && (
          <button
            type="button"
            onClick={onSeeAll}
            className="shrink-0 inline-flex items-center gap-0.5 text-[10px] font-bold uppercase tracking-wider text-indigo-600 hover:text-indigo-800 focus:outline-none focus:ring-2 focus:ring-indigo-400 rounded px-1 py-0.5"
          >
            See all <ChevronRight className="w-3 h-3" aria-hidden />
          </button>
        )}
      </div>
      {children}
    </section>
  );
}

function TileGrid({
  variants, selectedVariantId, action, zoneName, onPick, slot,
}: {
  variants: WidgetVariant[];
  selectedVariantId?: string;
  action: PickAction;
  zoneName: string;
  onPick: (v: WidgetVariant, action: PickAction) => void;
  /**
   * Which ROW this grid is. Part of each tile's dnd-kit draggable id, because
   * one variant legitimately appears in several rows at once — see the
   * `dragId` comment in VariantTile for what duplicate ids did to the
   * operator. Must be stable across renders and unique per row.
   */
  slot: string;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {variants.map(v => (
        <VariantTile
          key={v.id}
          dragId={`variant-${slot}-${v.id}`}
          variant={v}
          active={!!selectedVariantId && selectedVariantId === v.id}
          action={action}
          zoneName={zoneName}
          onPick={onPick}
        />
      ))}
    </div>
  );
}

/**
 * The escape hatch. A filter combination that matches nothing must SAY so and
 * offer one click back to the full library — the old panel rendered "No
 * variants match your filters yet" with no control at all, which is how a
 * brand-new template dead-ended on an empty grid.
 */
function EmptyResults({ onReset, search }: { onReset: () => void; search: string }) {
  return (
    <div className="text-center py-10 px-4">
      <p className="text-xs font-semibold text-slate-600">
        {search.trim() ? `Nothing matches “${search.trim()}”.` : 'Nothing matches those filters.'}
      </p>
      <p className="text-[11px] text-slate-500 mt-1">
        Your library still has plenty in it — this combination just came up empty.
      </p>
      <button
        type="button"
        onClick={onReset}
        className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-indigo-600 text-white text-[11px] font-semibold hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-400"
      >
        <RotateCcw className="w-3.5 h-3.5" aria-hidden /> Show all widgets
      </button>
    </div>
  );
}

function VariantTile({
  variant, active, action, zoneName, onPick, dragId,
}: {
  variant: WidgetVariant;
  active: boolean;
  action: PickAction;
  zoneName: string;
  onPick: (v: WidgetVariant, action: PickAction) => void;
  /**
   * Unique dnd-kit draggable id for THIS RENDER SLOT — never just the variant
   * id (2026-09-11). The panel deliberately shows one variant in more than
   * one row: "Start here" repeats what also appears under its category, and
   * "Restyle" repeats the selected zone's own type. Every tile used to call
   * `useDraggable({ id: `variant-${variant.id}` })`, so those copies all
   * registered the SAME id in one DndContext, and dnd-kit's registry keeps the
   * LAST node registered under an id. Pressing a tile in the top row therefore
   * drove the duplicate further down the list: the top tile refused to drag
   * and the page jumped to its twin. Operator: "when you try to drag and drop
   * the images at the top of the list it doesnt let you but then takes you to
   * the actual widget below that ... its like the first widgets are just links
   * to the real ones."
   *
   * The drag PAYLOAD below is unchanged and carries no slot, so the drop
   * handler cannot tell (or care) which row a tile came from.
   */
  dragId: string;
}) {
  const Render = variant.render;
  const name = friendlyVariantName(variant);

  // Make the tile draggable so it can also be dropped onto the canvas. Drag is
  // an ENHANCEMENT — every tile is equally usable with a click or the keyboard.
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: dragId,
    data: {
      type: 'variant-tile',
      widgetType: variant.widgetType,
      variantId: variant.id,
      defaultConfig: variant.defaultConfig,
    },
  });

  const actionLabel =
    action === 'replace' ? `Replace “${zoneName}” with ${name}`
    : action === 'fill' ? `Add ${name} to your empty board`
    : `Add ${name}`;

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      role="button"
      tabIndex={0}
      aria-label={actionLabel}
      onClick={() => onPick(variant, action)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(variant, action); } }}
      className={`group relative rounded-xl border-2 transition-all overflow-hidden bg-white shadow-sm hover:shadow-lg cursor-grab active:cursor-grabbing select-none flex flex-col focus:outline-none focus:ring-2 focus:ring-indigo-400 ${
        active ? 'border-indigo-500 ring-2 ring-indigo-300' : 'border-slate-200 hover:border-indigo-300'
      } ${isDragging ? 'opacity-40 scale-95' : 'hover:scale-[1.02]'}`}
      title={`${variant.description || name} — ${actionLabel}`}
    >
      {/* Live preview — wider 16:10 ratio, larger font scale so the widget reads.
          `overflow-hidden` is load-bearing (2026-09-12): the CARD clipped, but
          this box did not, so a thumbnail that paints outside its own frame —
          STAFF_HERO_BANNER's dark card, the Rainbow Ribbon bleeding off the left
          edge — painted straight over the name and type printed underneath it.
          The operator saw a tile whose LABEL was covered by the artwork. A
          preview is a window onto the widget; it clips, like every other window.
          (This hides the bleed, it does not excuse it — `tools/widget-legibility/
          measure-tiles.mjs` grades what each tile actually paints at 16:10.)
          `data-tile-preview` marks the boundary between COPY THIS PANEL WRITES
          and a widget's own artwork: some designs legitimately print
          SCREAMING_SNAKE as decoration (PHOTO_OPS_CONTACT_SHEET renders
          "● CONTACT_SHEET"), so the no-raw-enum sweep excludes this subtree. */}
      <div className="relative w-full bg-slate-100 overflow-hidden" data-tile-preview style={{ aspectRatio: '16 / 10', fontSize: '14px' }}>
        <div className="absolute top-0 right-0 bottom-0 left-0 pointer-events-none">
          {/* One malformed thumbnail must not blank the whole widgets panel:
              without this boundary a single throwing tile crashes every tile
              and the operator can no longer add ANY widget. */}
          <WidgetErrorBoundary resetKey={variant.id} widgetLabel={name}>
            <Render config={{ ...(variant.defaultConfig || {}), _thumb: true }} compact={false} />
          </WidgetErrorBoundary>
        </div>
      </div>
      {/* Label below the preview (not overlay — easier to read) */}
      <div className="px-2 py-1.5 border-t border-slate-100 bg-white">
        <div className="text-[11px] font-bold text-slate-700 truncate">{name}</div>
        <div className="text-[9px] font-medium text-slate-400 truncate">
          {friendlyTypeLabel(String(variant.widgetType))}
        </div>
      </div>
      {action === 'replace' && (
        <div className="absolute top-1.5 left-1.5 bg-amber-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded shadow pointer-events-none">
          REPLACES
        </div>
      )}
      {active && (
        <div className="absolute top-1.5 right-1.5 bg-indigo-600 text-white text-[9px] font-bold px-1.5 py-0.5 rounded shadow pointer-events-none">
          ACTIVE
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// QuickLayoutsSection — six pre-defined zone splits.
// Click → wipes existing zones and lays out new ones at preset rects.
// Operator then fills each zone with content by clicking the zone +
// picking a widget, or dragging a widget into it.
//
// Why wipe existing zones: this is meant to be a starting point —
// "give me a 4-quadrant layout to fill in." If the operator already
// has content they'd lose, the Confirm dialog catches it.
// ─────────────────────────────────────────────────────────────────────
import { appConfirm } from '@/components/ui/app-dialog';

type LayoutRect = { x: number; y: number; width: number; height: number };
type LayoutPreset = {
  id: string;
  label: string;
  desc: string;
  rects: LayoutRect[];
};

// Rects are 0-100 percentage-space, top-left origin. Margins kept at 0
// so the layout fills the canvas; operator can resize per-zone after.
const LAYOUT_PRESETS: LayoutPreset[] = [
  {
    id: 'one',
    label: '1 zone',
    desc: 'Full screen — one big area for a single piece of content.',
    rects: [{ x: 0, y: 0, width: 100, height: 100 }],
  },
  {
    id: 'two-cols',
    label: 'Two columns',
    desc: 'Side-by-side. Great for image carousel + webpage.',
    rects: [
      { x: 0, y: 0, width: 50, height: 100 },
      { x: 50, y: 0, width: 50, height: 100 },
    ],
  },
  {
    id: 'two-rows',
    label: 'Two rows',
    desc: 'Top + bottom. Great for video on top, ticker below.',
    rects: [
      { x: 0, y: 0, width: 100, height: 50 },
      { x: 0, y: 50, width: 100, height: 50 },
    ],
  },
  {
    id: 'big-plus-stack',
    label: 'Hero + 2 stack',
    desc: 'Big left zone, two stacked on the right.',
    rects: [
      { x: 0, y: 0, width: 65, height: 100 },
      { x: 65, y: 0, width: 35, height: 50 },
      { x: 65, y: 50, width: 35, height: 50 },
    ],
  },
  {
    id: 'quad',
    label: '4 quadrants',
    desc: 'Equal 2×2 grid. Mix images, videos, URLs.',
    rects: [
      { x: 0, y: 0, width: 50, height: 50 },
      { x: 50, y: 0, width: 50, height: 50 },
      { x: 0, y: 50, width: 50, height: 50 },
      { x: 50, y: 50, width: 50, height: 50 },
    ],
  },
  {
    id: 'header-three',
    label: 'Header + 3',
    desc: 'Banner up top, three columns below.',
    rects: [
      { x: 0, y: 0, width: 100, height: 30 },
      { x: 0, y: 30, width: 33.33, height: 70 },
      { x: 33.33, y: 30, width: 33.34, height: 70 },
      { x: 66.67, y: 30, width: 33.33, height: 70 },
    ],
  },
];

function QuickLayoutsSection() {
  const applyLayout = useBuilderStore((s) => s.applyLayout);
  const zones = useBuilderStore((s) => s.zones);
  // M0-6 — a Quick Layout only replaces the scene the operator is editing
  // (see layoutReplacementTargets). The confirm must therefore count THAT
  // slice, not every zone in a multi-scene kiosk: telling the operator we
  // are about to delete 24 zones when we are about to delete 4 is the same
  // class of lie as the copy rule in CLAUDE.md.
  const sceneCount = useBuilderStore((s) => s.scenes.length);
  const activeSceneId = useBuilderStore((s) => s.activeSceneId);
  const [open, setOpen] = useState(false);

  const doomed = layoutReplacementTargets(zones, sceneCount, activeSceneId);
  // A single untouched EMPTY placeholder is not content — replacing it costs
  // the operator nothing, so do not interrogate them about it.
  const hasRealContent = doomed.some((z) => z.widgetType !== 'EMPTY');

  const onPick = async (preset: LayoutPreset) => {
    if (hasRealContent) {
      const scoped = sceneCount > 1 ? ' on this scene' : '';
      const ok = await appConfirm({
        title: `Apply "${preset.label}" layout?`,
        message: `This will replace your current ${doomed.length} zone${doomed.length === 1 ? '' : 's'}${scoped} with ${preset.rects.length} new one${preset.rects.length === 1 ? '' : 's'} — your existing content will be removed. You can undo with Cmd/Ctrl+Z.`,
        confirmLabel: 'Apply layout',
        tone: 'warn',
      });
      if (!ok) return;
    }
    applyLayout(preset.rects, 'IMAGE');
    setOpen(false);
  };

  return (
    <div className="px-4 pt-3 pb-2 border-b border-slate-100 shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-slate-600 hover:text-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-400 rounded"
        aria-expanded={open}
      >
        <span className="flex items-center gap-1.5">
          <span aria-hidden>▦</span> Quick layouts
        </span>
        <span className="text-slate-400 text-[10px]">{open ? '−' : '+'}</span>
      </button>
      {open && (
        <div className="mt-2 grid grid-cols-3 gap-1.5">
          {LAYOUT_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => onPick(preset)}
              title={preset.desc}
              className="group p-2 rounded-md border border-slate-200 hover:border-indigo-400 hover:bg-indigo-50 transition-colors text-left focus:outline-none focus:ring-2 focus:ring-indigo-400"
            >
              {/* SVG diagram — visual preview of the rect arrangement */}
              <svg
                viewBox="0 0 100 60"
                className="w-full h-auto block"
                aria-hidden="true"
              >
                <rect x="0" y="0" width="100" height="60" fill="#f1f5f9" rx="3" />
                {preset.rects.map((r, i) => (
                  <rect
                    key={i}
                    x={r.x + 1}
                    // diagram is 100x60 (5:3) so we squash heights to 60% to roughly preview
                    y={(r.y * 0.6) + 1}
                    width={r.width - 2}
                    height={(r.height * 0.6) - 2}
                    fill="#fff"
                    stroke="#94a3b8"
                    strokeWidth="0.5"
                    rx="1"
                  />
                ))}
              </svg>
              <div className="mt-1 text-[10px] font-semibold text-slate-700 group-hover:text-indigo-700 truncate">
                {preset.label}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
