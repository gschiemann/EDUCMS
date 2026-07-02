"use client";

/**
 * VariantPicker — the Canva-style "swap this widget's look" panel.
 *
 * Behavior:
 *   - When NO zone is selected: shows ALL variants grouped by widget type so
 *     the user can drag a brand-new widget onto the canvas.
 *   - When a zone IS selected: shows only variants matching that zone's
 *     widgetType. Click a variant tile → the zone instantly swaps to that
 *     variant. Filter chips (Type / Category) are at the top.
 *
 * Each variant tile renders an actual LIVE preview of the widget at thumbnail
 * size — no static images needed. As you build new variants they auto-appear.
 */

import { useMemo, useState, useEffect } from 'react';
import { Search, X, Filter as FilterIcon, ArrowLeft } from 'lucide-react';
import { useDraggable } from '@dnd-kit/core';
import '@/components/widgets/variants-register'; // boot-time registration
import {
  listVariants, listVariantTypes,
  type WidgetVariant,
} from '@/components/widgets/variants';
import { useBuilderStore } from './useBuilderStore';
import { useTenantCopy } from '@/hooks/use-tenant-copy';
import { WidgetErrorBoundary } from '@/components/widgets/WidgetErrorBoundary';
// Wave B / editor-crush B6a (2026-07-02) — smart drop sizes so palette adds
// land at their natural footprint (shared with BuilderShell.handleDragEnd).
import { resolveDropSize } from './drop-sizes';

const WIDGET_TYPE_LABELS: Record<string, string> = {
  CLOCK:           'Clocks',
  WEATHER:         'Weather',
  TEXT:            'Headlines',
  RICH_TEXT:       'Rich Text',
  ANNOUNCEMENT:    'Announcements',
  VIDEO:           'Videos',
  VIDEO_CAROUSEL:  'Video Carousels',
  WEBPAGE:         'Web Pages',
  TICKER:          'Tickers',
  CALENDAR:        'Calendars',
  COUNTDOWN:       'Countdowns',
  STAFF_SPOTLIGHT: 'Staff',
  LOGO:            'Logos',
  IMAGE_CAROUSEL:  'Image Carousels',
  IMAGE:           'Images',
  BELL_SCHEDULE:   'Bell Schedules',
  LUNCH_MENU:      'Lunch Menus',
  // Phase D2.9-D2.11 — 25 touch widgets (hotspots, shapes, arrows,
  // kiosk nav, comm, engagement, utility) all canonicalize to
  // widgetType='TOUCH_POINT' with the visual selected via
  // config.variant. The picker chip says "Touch" so operators can
  // filter to just the interactive set.
  TOUCH_POINT:     'Touch',
  // Wave B / editor-crush B2/B3/B5 (2026-07-02) — the Elements wave:
  // static shapes, the lucide icon library, and the resurrected
  // Decoration animations each get a friendly chip.
  SHAPE:           'Shapes',
  ICON:            'Icons',
  DECORATION:      'Decorations',
  // v2 canonical types — without a friendly label the picker chip +
  // locked-filter badge show the raw SCREAMING_SNAKE widgetType.
  SCOREBOARD:      'Scoreboards',
  CELEBRATION:     'Celebrations',
  CHART:           'Charts',
  BACKGROUND:      'Backgrounds',
  LIVE_DATA:       'Live Data',
  EXTERNAL_HTML:   'HTML Templates',
  HEALTHCARE:      'Healthcare',
  CORPORATE:       'Corporate',
  HOSPITALITY:     'Hospitality',
  WORSHIP:         'Worship',
};

// 2026-05-10 — operator iteration 3: "leave the image, videos,
// webpage pills and revert the rest back to the original names we
// had, they make more sense when there were a lot of them".
//
// Final shape:
//   1. Images / Videos / Web Pages stay as COMBINED chips at the top
//      (Images = IMAGE + IMAGE_CAROUSEL, Videos = VIDEO + VIDEO_CAROUSEL,
//      Web Pages = WEBPAGE). These are the operator's most common drops
//      so consolidating two-of-each into one chip saves a click.
//   2. Every OTHER widget type goes back to being its own individual
//      chip — Clocks, Headlines, Rich Text, Announcements, Tickers,
//      Weather, Calendars, Countdowns, Staff, Logos, Bell Schedules,
//      Lunch Menus. With 12 individual chips + 3 combined media chips,
//      a flat row reads better than the abstract group labels.
//   3. The "More ▾" overflow is gone — all chips are visible.
//
// WIDGET_GROUPS now ONLY holds the 3 combined media chips. The rest
// are rendered straight from listVariantTypes() filtered against the
// 5 widget types that the combined chips already cover.
type WidgetGroup = {
  id: string;
  label: string;
  emoji: string;
  types: string[];
};
const WIDGET_GROUPS: WidgetGroup[] = [
  { id: 'images', label: 'Images',    emoji: '🖼', types: ['IMAGE', 'IMAGE_CAROUSEL'] },
  { id: 'videos', label: 'Videos',    emoji: '🎥', types: ['VIDEO', 'VIDEO_CAROUSEL'] },
  { id: 'web',    label: 'Web Pages', emoji: '🌐', types: ['WEBPAGE'] },
];

// Map a variant's category (the scene name) to school grade levels.
// Each variant can fit one or more levels; "Universal" means it works K-12.
//
// 2026-04-28 — operator: "the filters in widgets dont seem to do
// anyting, i dont think you have lined up the filtered templates to
// the widgets that belong to them for each school." Two fixes:
//
//  1. Categories LITERALLY named after a level (HIGH, MIDDLE,
//     ELEMENTARY) now strictly map to that level — no Universal
//     fallback. A "MIDDLE School Lunch Menu" should NOT appear in
//     the Elementary filter just because its category isn't in the
//     table. Previously the map didn't include HIGH or MIDDLE at
//     all, so they fell through to Universal and showed everywhere.
//
//  2. Categories that aren't level-themed (MODERN, MINIMAL, etc) get
//     'Universal' so they appear under every level chip — those are
//     legit school-agnostic styles.
//
//  Plus filled in the previously-missing BROADCAST, LOBBY entries.
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

// 2026-05-03 — VenueOS rebrand: variant picker filtering by tenant vertical.
//
// The variant catalog has 378 K-12-themed tiles (Polaroid, PTA, Pennant
// Banner, Crest Sticker, Field Trip, Chalkboard) registered against the
// universal widget types (CLOCK, TEXT, IMAGE, ANNOUNCEMENT, etc.). For a
// gym tenant those tiles are noise — they're nostalgic-classroom visual
// language that doesn't fit a fitness venue.
//
// Filtering strategy:
//   - K12 tenants: see EVERYTHING (current behavior preserved).
//   - Non-K12 tenants: hide every variant whose category clearly maps to
//     a K-12 audience (ELEMENTARY/MIDDLE/HIGH/CLASSROOM/PLAYFUL/HALLWAY/
//     CAFETERIA/LIBRARY/OFFICE/ATHLETICS/ARTS/STEM/SAFETY). Universal
//     categories (MODERN/MINIMAL/BROADCAST/LOBBY/DARK/BOLD) AND any
//     variant without a category (no metadata = neutral) stay visible
//     so we never starve the picker entirely.
//
// Adding a new vertical-tagged variant: include its category in
// `VERTICAL_CATEGORY_OK` for the right vertical (e.g. add 'GYM_FLOOR'
// when we ship gym-themed CLOCK variants). The default for missing
// categories is "show everywhere except when the operator filters it
// out themselves", so brand-new variants don't silently disappear.
// CYCLE-5 v2-ops-console-not-k12-only fix — 'OFFICE' was K-12-gated but
// the v2 admin-tier "Ops Console" widgets (OPS_FLEET_GRID, OPS_INCIDENT_BOARD,
// OPS_LICENSE_USAGE, etc.) carry category=OFFICE and are neutral cyber-
// aesthetic — equally relevant to a gym, restaurant, retail, or corporate
// tenant. Removed OFFICE so non-K12 tenants can see those tiles.
const K12_ONLY_CATEGORIES: ReadonlySet<string> = new Set([
  'ELEMENTARY', 'MIDDLE', 'HIGH',
  'CLASSROOM', 'PLAYFUL', 'HALLWAY',
  'CAFETERIA', 'LIBRARY',
  'ATHLETICS', 'ARTS', 'STEM',
  'SAFETY',
]);
// 2026-05-29 — operator: "all widgets showing up under the sports venue;
// every business type should filter widgets to just what pertains to it."
// Only BAR/GYM/SPORTS variants were ever explicitly `vertical`-tagged, so
// the RESTAURANT_/RETAIL_/WORSHIP/HEALTHCARE/… packs were untagged → treated
// as neutral → leaked into EVERY vertical. This derives the vertical a
// widget TYPE is exclusive to from its type-name prefix, so those packs
// scope correctly without hand-tagging all 386 untagged variants. Returns
// null for universal signage types (CLOCK / TEXT / IMAGE / WEATHER / …),
// which show in every vertical.
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
  // Multi-vertical scoped widgets (cross-over: Lunch Menu → food-service
  // verticals, Staff Spotlight → people-org verticals, Transit →
  // big-building verticals). Strict membership test — takes precedence
  // over the single `vertical` and the K-12 category logic. A Lunch
  // Menu tagged [K12, QSR, RESTAURANT, HOSPITALITY, BAR, CORPORATE]
  // shows in exactly those palettes and nowhere else.
  if (v.verticals && v.verticals.length) return v.verticals.includes(vertical);
  // Single business-line scoped widgets (EDU CMS-10/11/12 packs —
  // celebrations, healthcare, corporate, hospitality, worship) show
  // ONLY in their own vertical's palette. A healthcare widget never
  // clutters a gym; a touchdown ribbon never lands in a restaurant's
  // gallery. Strict match — overrides the K-12 category logic below.
  if (v.vertical) return v.vertical === vertical;
  // Type-name prefix → vertical (catches the per-vertical packs that were
  // never explicitly tagged). A type exclusive to one vertical shows ONLY in
  // that vertical's palette — RESTAURANT_MENU_BOARD never lands in a Sports
  // venue, HS_VARSITY never lands in a restaurant.
  const typeVertical = verticalForWidgetType(v.widgetType);
  if (typeVertical) return typeVertical === vertical;
  if (vertical === 'K12') return true;
  if (!v.category) return true; // neutral / no metadata — keep
  return !K12_ONLY_CATEGORIES.has(v.category.toUpperCase());
}

export function VariantPicker() {
  const zones        = useBuilderStore(s => s.zones);
  const selectedIds  = useBuilderStore(s => s.selectedIds);
  const updateZone   = useBuilderStore(s => s.updateZone);
  const addZone      = useBuilderStore(s => s.addZone);
  // 2026-05-03 — vertical-aware variant filtering. K12 tenant sees the
  // full 378-variant K-12 wall (Polaroid / PTA / Chalkboard / etc.).
  // GYM/QSR/RETAIL/BAR/etc. see only universal + their own vertical's
  // tiles — no Polaroid + Pennant Banner mixed into a gym streaming-hub.
  const tenantCopy = useTenantCopy();
  const isK12 = tenantCopy.vertical === 'K12';

  const selected = selectedIds.length === 1
    ? zones.find(z => z.id === selectedIds[0])
    : null;

  // typeFilter holds either:
  //   - 'ALL'                — no widget-type filter
  //   - 'GROUP:<groupId>'    — filter to a curated bundle (Content / Time / etc.)
  //   - '<WIDGET_TYPE>'      — exact widget-type filter (used by the locked
  //                            filter when a zone is selected, and the "More
  //                            widgets" overflow menu for power users)
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [levelFilter, setLevelFilter] = useState<string>('ALL'); // 'ALL' | 'Elementary' | 'Middle' | 'High'
  const [search, setSearch] = useState('');
  // When user clicks a zone we auto-filter to its widgetType — but only ONCE per
  // selection. The user can still un-lock and browse other widget types via the
  // "Browse all widgets" button or the type chips.
  const [browseAll, setBrowseAll] = useState(false);

  useEffect(() => {
    if (selected && !browseAll) setTypeFilter(selected.widgetType);
  }, [selected?.id, browseAll]);

  // Reset the override the moment selection changes
  useEffect(() => { setBrowseAll(false); }, [selected?.id]);

  // Type chips filtered to the tenant's vertical: universal types (null) +
  // the tenant's own vertical only. Without this the chip rail showed every
  // vertical's types (RESTAURANT / BAR / RETAIL / WORSHIP) on a Sports venue.
  const allTypes = useMemo(
    () => listVariantTypes().filter((t) => {
      const tv = verticalForWidgetType(t);
      return tv === null || tv === tenantCopy.vertical;
    }),
    [tenantCopy.vertical],
  );
  // Long-tail widget types — anything not covered by a Group chip.
  // Surfaced inside the "More widgets" overflow menu so a power user
  // can still type-jump to BELL_SCHEDULE / LUNCH_MENU / etc.
  const groupedTypes = useMemo(
    () => new Set(WIDGET_GROUPS.flatMap(g => g.types)),
    [],
  );
  const otherTypes = useMemo(
    () => allTypes.filter(t => !groupedTypes.has(t)),
    [allTypes, groupedTypes],
  );
  const variants = useMemo(() => {
    let list = listVariants();
    // First narrow to variants that match the tenant's vertical. K-12-only
    // tiles (Pennant Banner, Polaroid, Field Trip, Crest Sticker, etc.)
    // disappear for gym / restaurant / retail / bar / corporate tenants.
    list = list.filter(v => variantVisibleForVertical(v, tenantCopy.vertical));
    if (typeFilter.startsWith('GROUP:')) {
      const gid = typeFilter.slice('GROUP:'.length);
      const group = WIDGET_GROUPS.find(g => g.id === gid);
      if (group) {
        const set = new Set(group.types);
        list = list.filter(v => set.has(v.widgetType));
      }
    } else if (typeFilter !== 'ALL') {
      list = list.filter(v => v.widgetType === typeFilter);
    }
    // Grade-level filter only applies to K-12 tenants (the picker's
    // ALL GRADES / ELEMENTARY / MIDDLE / HIGH chips are hidden below
    // for non-K12). For non-K12 tenants this is always 'ALL' so the
    // filter is a no-op even if levelFilter state somehow drifts.
    if (isK12 && levelFilter !== 'ALL') {
      list = list.filter(v => {
        const levels = variantLevels(v.category);
        return levels.includes(levelFilter) || levels.includes('Universal');
      });
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(v => v.name.toLowerCase().includes(q) || (v.description?.toLowerCase().includes(q)));
    }
    return list;
  }, [typeFilter, levelFilter, search, tenantCopy.vertical, isK12]);

  const handlePick = (v: WidgetVariant) => {
    // 2026-05-03 — operator: "I still can't add two of the same widgets,
    // they overwrite each other." Earlier fix only avoided overwrite for
    // SAME-variant clicks; clicking a *different* variant tile while a
    // zone was selected still SWAPPED the selected zone's style. That's
    // the wrong default — clicks should always APPEND. Swap behavior is
    // still available, just gated to the explicit user intent of dragging
    // a tile ONTO an existing zone (handled in BuilderShell.handleDragEnd
    // when isVariantTile && sel.length === 1 && drop overlaps the zone).
    //
    // Why this is the right call: the partner's original "swap clock
    // 2's style by dragging" feature is a DRAG gesture — and DRAG still
    // does exactly that. CLICK is the additive gesture: tap a tile, get
    // a new zone. No more accidental overwrites just because something
    // happened to be selected.
    //
    // Wave B / editor-crush B6a (2026-07-02): pass the smart drop size so
    // a LOGO, a TICKER, and a divider line land at their natural footprint
    // instead of the generic 40×30 box (resolveDropSize returns undefined
    // for unmapped types — addZone's default still applies there).
    const id = addZone(v.widgetType, undefined, resolveDropSize(v.widgetType, v.id));
    updateZone(id, { defaultConfig: { ...(v.defaultConfig || {}), variant: v.id } });
  };

  const showingLockedFilter = !!selected && !browseAll;

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      {/* Quick Layouts — only when no zone is locked-filter selected.
          Operator-asked: "splits the screen into multiple areas." Drops
          N pre-positioned zones the operator then fills with content
          (image / video / webpage). Mirrors the layout-picker every
          enterprise signage CMS ships. */}
      {!showingLockedFilter && <QuickLayoutsSection />}
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-100 shrink-0">
        <div className="flex items-center justify-between mb-2 gap-2">
          <h2 className="text-sm font-bold text-slate-800 truncate">
            {showingLockedFilter ? `Swap "${selected.name}"` : 'Widget Library'}
          </h2>
          {showingLockedFilter && (
            <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded shrink-0">
              {WIDGET_TYPE_LABELS[selected.widgetType] || selected.widgetType}
            </span>
          )}
        </div>
        {showingLockedFilter && (
          <button
            type="button"
            onClick={() => setBrowseAll(true)}
            className="w-full mb-2 inline-flex items-center justify-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-1.5 rounded bg-slate-50 text-slate-600 hover:bg-slate-100"
          >
            <ArrowLeft className="w-3 h-3" /> Browse all widgets
          </button>
        )}
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden />
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search widgets…"
            className="w-full pl-7 pr-2 py-1.5 text-xs border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-400"
          />
        </div>
      </div>

      {/* School / grade-level filter row.
          2026-05-09 — operator: "the school should be at the top level
          of the filters not below them" — moved above the type row.
          2026-05-10 — operator: "why do we have 'all' at the widget
          level and the school level?" — disambiguated: this row's
          chip says "All grades", widget row's says "All widgets". */}
      {isK12 && (
        <div className="px-3 py-2 border-b border-slate-100 flex flex-wrap gap-1 shrink-0 bg-slate-50/40">
          <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 self-center mr-1">School level:</span>
          <FilterChip label="All grades" active={levelFilter === 'ALL'} onClick={() => setLevelFilter('ALL')} />
          <FilterChip label="Elementary" active={levelFilter === 'Elementary'} onClick={() => setLevelFilter('Elementary')} />
          <FilterChip label="Middle" active={levelFilter === 'Middle'} onClick={() => setLevelFilter('Middle')} />
          <FilterChip label="High" active={levelFilter === 'High'} onClick={() => setLevelFilter('High')} />
        </div>
      )}

      {/* Widget category filter row.
          Layout: All widgets · Images · Videos · Web Pages · then every
          other individual widget type chip. The 3 media chips at the
          front are combined (Images = IMAGE+IMAGE_CAROUSEL etc.) since
          those are the most frequent drops; the rest stay individual
          per operator's "they make more sense when there were a lot of
          them" feedback. */}
      <div className="px-3 py-2 border-b border-slate-100 flex flex-wrap gap-1 shrink-0">
        <FilterChip
          label="All widgets"
          active={typeFilter === 'ALL'}
          onClick={() => { setTypeFilter('ALL'); setBrowseAll(true); }}
        />
        {WIDGET_GROUPS.map(g => (
          <FilterChip
            key={g.id}
            label={`${g.emoji} ${g.label}`}
            active={typeFilter === `GROUP:${g.id}`}
            onClick={() => { setTypeFilter(`GROUP:${g.id}`); setBrowseAll(true); }}
          />
        ))}
        {otherTypes.map(t => (
          <FilterChip
            key={t}
            label={WIDGET_TYPE_LABELS[t] || t}
            active={typeFilter === t}
            onClick={() => { setTypeFilter(t); setBrowseAll(true); }}
          />
        ))}
      </div>
      {/* Tiles — 2-up wide tiles like Canva, real visible previews */}
      <div className="flex-1 overflow-auto p-3 bg-slate-50/40">
        {variants.length === 0 ? (
          <div className="text-center text-xs text-slate-400 py-12">
            <FilterIcon className="w-6 h-6 mx-auto mb-2 opacity-50" aria-hidden />
            No variants match your filters yet.<br />
            <span className="text-[10px]">Try different filters or clear search.</span>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {variants.map(v => (
              <VariantTile
                key={v.id}
                variant={v}
                active={!!selected && (selected.defaultConfig as any)?.variant === v.id}
                onPick={handlePick}
              />
            ))}
          </div>
        )}
      </div>

      {/* Footer info */}
      <div className="px-3 py-2 border-t border-slate-100 text-[10px] text-slate-400 shrink-0">
        {variants.length} variant{variants.length === 1 ? '' : 's'} • {allTypes.length} widget types
      </div>
    </div>
  );
}

function FilterChip({ label, active, onClick, small }: { label: string; active: boolean; onClick: () => void; small?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${small ? 'text-[9px]' : 'text-[10px]'} font-bold uppercase tracking-wider px-2 py-1 rounded transition-colors ${
        active
          ? 'bg-indigo-600 text-white shadow-sm'
          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
      }`}
    >
      {label}
    </button>
  );
}

function VariantTile({ variant, active, onPick }: { variant: WidgetVariant; active: boolean; onPick: (v: WidgetVariant) => void }) {
  const Render = variant.render;

  // Make the tile draggable so it can be dropped onto the canvas
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `variant-${variant.id}`,
    data: {
      type: 'variant-tile',
      widgetType: variant.widgetType,
      variantId: variant.id,
      defaultConfig: variant.defaultConfig,
    },
  });

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      role="button"
      tabIndex={0}
      onClick={() => onPick(variant)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(variant); } }}
      className={`group relative rounded-xl border-2 transition-all overflow-hidden bg-white shadow-sm hover:shadow-lg cursor-grab active:cursor-grabbing select-none flex flex-col ${
        active ? 'border-indigo-500 ring-2 ring-indigo-300' : 'border-slate-200 hover:border-indigo-300'
      } ${isDragging ? 'opacity-40 scale-95' : 'hover:scale-[1.02]'}`}
      title={`${variant.description || variant.name} — click to swap, drag to add`}
    >
      {/* Live preview — wider 16:10 ratio, larger font scale so the widget reads */}
      <div className="relative w-full bg-slate-100" style={{ aspectRatio: '16 / 10', fontSize: '14px' }}>
        <div className="absolute inset-0 pointer-events-none">
          {/* One malformed thumbnail must not blank the whole widgets
              panel. Without this boundary a single throwing tile (bad
              defaultConfig, render bug) crashes every widget tile and
              the operator can no longer add ANY widget. */}
          <WidgetErrorBoundary resetKey={variant.id} widgetLabel={variant.name}>
            <Render config={{ ...(variant.defaultConfig || {}), _thumb: true }} compact={false} />
          </WidgetErrorBoundary>
        </div>
      </div>
      {/* Label below the preview (not overlay — easier to read) */}
      <div className="px-2 py-1.5 border-t border-slate-100 bg-white">
        <div className="text-[11px] font-bold text-slate-700 truncate">{variant.name}</div>
      </div>
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
// Operator then fills each zone with content (image / video / URL /
// carousel) by clicking the zone + picking a widget OR dragging a
// widget from the library below into the zone.
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
  const [open, setOpen] = useState(false);

  const onPick = async (preset: LayoutPreset) => {
    if (zones.length > 0) {
      const ok = await appConfirm({
        title: `Apply "${preset.label}" layout?`,
        message: `This will replace your current ${zones.length} zone${zones.length === 1 ? '' : 's'} with ${preset.rects.length} new one${preset.rects.length === 1 ? '' : 's'} — your existing content will be removed. You can undo with Cmd/Ctrl+Z.`,
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
        className="w-full flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-slate-600 hover:text-indigo-600"
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
              className="group p-2 rounded-md border border-slate-200 hover:border-indigo-400 hover:bg-indigo-50 transition-colors text-left"
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
