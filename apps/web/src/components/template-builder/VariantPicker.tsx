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

const WIDGET_TYPE_LABELS: Record<string, string> = {
  CLOCK:           'Clocks',
  WEATHER:         'Weather',
  TEXT:            'Headlines',
  RICH_TEXT:       'Rich Text',
  ANNOUNCEMENT:    'Announcements',
  TICKER:          'Tickers',
  CALENDAR:        'Calendars',
  COUNTDOWN:       'Countdowns',
  STAFF_SPOTLIGHT: 'Staff',
  LOGO:            'Logos',
  IMAGE_CAROUSEL:  'Photos',
  IMAGE:           'Images',
  VIDEO:           'Videos',
  BELL_SCHEDULE:   'Bell Schedules',
  LUNCH_MENU:      'Lunch Menus',
};

// Map a variant's category (the scene name) to school grade levels.
// Each variant can fit one or more levels; "Universal" means it works K-12.
//
// 2026-04-27 — operator removed the "Early Childhood" filter chip
// (we don't sell into Pre-K / daycare; the EC label was confusing
// elementary admins who'd see EC-tagged variants and assume the
// CMS was kid-only). Variants previously tagged 'Early Childhood'
// fall back to 'Elementary' so they still surface for K-5 admins.
const CATEGORY_TO_LEVELS: Record<string, string[]> = {
  CLASSROOM:  ['Elementary', 'Middle'],
  ELEMENTARY: ['Elementary'],
  PLAYFUL:    ['Elementary'],
  CAFETERIA:  ['Universal'],
  HALLWAY:    ['Middle', 'High'],
  SAFETY:     ['Universal'],
  LIBRARY:    ['Universal'],
  OFFICE:     ['Universal'],
  ATHLETICS:  ['Middle', 'High'],
  ARTS:       ['Middle', 'High'],
  STEM:       ['Middle', 'High'],
  DARK:       ['High'],
  BOLD:       ['High'],
  MODERN:     ['Universal'],
  MINIMAL:    ['Universal'],
};

function variantLevels(category?: string): string[] {
  if (!category) return ['Universal'];
  return CATEGORY_TO_LEVELS[category] || ['Universal'];
}

export function VariantPicker() {
  const zones        = useBuilderStore(s => s.zones);
  const selectedIds  = useBuilderStore(s => s.selectedIds);
  const updateZone   = useBuilderStore(s => s.updateZone);
  const addZone      = useBuilderStore(s => s.addZone);

  const selected = selectedIds.length === 1
    ? zones.find(z => z.id === selectedIds[0])
    : null;

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

  const allTypes = useMemo(() => listVariantTypes(), []);
  const variants = useMemo(() => {
    let list = listVariants();
    if (typeFilter !== 'ALL') list = list.filter(v => v.widgetType === typeFilter);
    if (levelFilter !== 'ALL') {
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
  }, [typeFilter, levelFilter, search]);

  const handlePick = (v: WidgetVariant) => {
    if (selected) {
      // Swap the selected zone's variant + merge the variant's defaultConfig
      const merged = { ...(selected.defaultConfig || {}), ...(v.defaultConfig || {}), variant: v.id };
      updateZone(selected.id, { defaultConfig: merged, widgetType: v.widgetType });
    } else {
      // Add a fresh zone of this widget type, pre-configured with the variant
      const id = addZone(v.widgetType);
      updateZone(id, { defaultConfig: { ...(v.defaultConfig || {}), variant: v.id } });
    }
  };

  const showingLockedFilter = !!selected && !browseAll;

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
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

      {/* Widget type filter — primary navigation */}
      <div className="px-3 py-2 border-b border-slate-100 flex flex-wrap gap-1 shrink-0">
        <FilterChip label="All widgets" active={typeFilter === 'ALL'} onClick={() => { setTypeFilter('ALL'); setBrowseAll(true); }} />
        {allTypes.map(t => (
          <FilterChip
            key={t}
            label={WIDGET_TYPE_LABELS[t] || t}
            active={typeFilter === t}
            onClick={() => { setTypeFilter(t); setBrowseAll(true); }}
          />
        ))}
      </div>
      {/* Grade level filter — secondary */}
      <div className="px-3 py-2 border-b border-slate-100 flex flex-wrap gap-1 shrink-0">
        <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 self-center mr-1">For:</span>
        <FilterChip label="All grades" active={levelFilter === 'ALL'} onClick={() => setLevelFilter('ALL')} small />
        <FilterChip label="Elementary" active={levelFilter === 'Elementary'} onClick={() => setLevelFilter('Elementary')} small />
        <FilterChip label="Middle" active={levelFilter === 'Middle'} onClick={() => setLevelFilter('Middle')} small />
        <FilterChip label="High" active={levelFilter === 'High'} onClick={() => setLevelFilter('High')} small />
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
          <Render config={{ ...(variant.defaultConfig || {}), _thumb: true }} compact={false} />
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
