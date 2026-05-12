"use client";

import { Lock, Unlock, ChevronUp, ChevronDown, Trash2, Copy, Image as ImageIcon, Hand } from 'lucide-react';
import { useBuilderStore } from './useBuilderStore';
import { useTouchAggregate } from '@/hooks/use-api';
import { getZoneColor, widgetIcon, widgetLabel } from './constants';

/** A pseudo-layer for the canvas background — always at the bottom of
 *  the stack, can't be deleted or reordered. Clicking it deselects every
 *  zone (which makes PropertiesPanel show the template-level Backdrop
 *  section) and fires the same scroll-to-section event the canvas
 *  hotspots use, so the panel auto-scrolls to the Backdrop card.
 *  Mirrors how Canva surfaces "Page background" as the bottom layer. */
function BackgroundLayer({ selected, onSelect }: { selected: boolean; onSelect: () => void }) {
  return (
    <li>
      <div
        className={`group flex items-center gap-2 p-2 rounded-lg transition-colors ${
          selected ? 'bg-indigo-50 ring-1 ring-indigo-200' : 'hover:bg-slate-50'
        }`}
      >
        <button
          type="button"
          className="flex items-center gap-2 flex-1 min-w-0 text-left focus:outline-none focus:ring-2 focus:ring-indigo-400 rounded px-1 py-0.5"
          onClick={onSelect}
          aria-pressed={selected}
        >
          <span
            className="w-6 h-6 rounded flex items-center justify-center shrink-0 bg-gradient-to-br from-pink-200 via-violet-200 to-sky-200 border border-slate-200"
            aria-hidden
          >
            <ImageIcon className="w-3.5 h-3.5 text-slate-600" />
          </span>
          <span className="flex-1 min-w-0">
            <span className="text-xs font-semibold text-slate-700 truncate block">Background</span>
            <span className="text-[10px] uppercase font-medium text-slate-400 block">color · gradient · image</span>
          </span>
        </button>
      </div>
    </li>
  );
}

export function LayersPanel() {
  // Atomic selectors — one subscription per key.
  const zones = useBuilderStore((s) => s.zones);
  const selectedIds = useBuilderStore((s) => s.selectedIds);
  const select = useBuilderStore((s) => s.select);
  const moveLayer = useBuilderStore((s) => s.moveLayer);
  const toggleLock = useBuilderStore((s) => s.toggleLock);
  const duplicateZone = useBuilderStore((s) => s.duplicateZone);
  const removeSelected = useBuilderStore((s) => s.removeSelected);
  const templateId = useBuilderStore((s) => s.templateId);
  const isTouchEnabled = useBuilderStore((s) => s.isTouchEnabled);

  // Phase D5 — fetch tap aggregates so the operator can see which
  // zones are getting tapped. Only fires for touch-enabled templates
  // (non-touch templates have no edu:touch-action events to count) and
  // only when we have a saved templateId (new drafts have none yet).
  const { data: tapAgg } = useTouchAggregate(templateId, {
    enabled: isTouchEnabled && !!templateId,
    sinceDays: 30,
  });
  const tapsByZone = tapAgg?.byZone || {};
  const hasTapData = (tapAgg?.total || 0) > 0;

  const sorted = [...zones].sort((a, b) => b.zIndex - a.zIndex);

  // Click the Background pseudo-layer → deselect every zone (so
  // PropertiesPanel shows template-level fields) AND fire the
  // template-edit-field event so the panel scrolls to + flashes the
  // Backdrop section.
  const selectBackground = () => {
    select(null);
    try {
      window.dispatchEvent(new CustomEvent('template-edit-field', {
        detail: { fieldKey: 'backdrop', sectionKey: 'backdrop' },
      }));
    } catch { /* CustomEvent unsupported */ }
  };

  if (zones.length === 0) {
    return (
      <div>
        <ul className="p-2 space-y-1" aria-label="Layers">
          <BackgroundLayer selected={selectedIds.length === 0} onSelect={selectBackground} />
        </ul>
        <div className="p-6 text-center space-y-3">
          <p className="text-xs text-slate-500 leading-relaxed">
            The <strong>Layers</strong> panel manages stacking order
            and visibility for zones already on the canvas — z-order,
            lock/unlock, duplicate, delete.
          </p>
          <p className="text-xs text-slate-400 leading-relaxed">
            To <strong>add a new zone</strong>, switch to the
            <strong className="mx-1">Widgets</strong>tab and drag a
            widget tile onto the canvas.
          </p>
        </div>
      </div>
    );
  }

  return (
    <ul className="p-2 space-y-1" aria-label="Layers">
      {/* Phase D5 — surface aggregate tap counts when the template has
          ANY tap data. The per-zone counts render inline below. Hidden
          when there's nothing to show so the panel stays clean for
          freshly-built templates that haven't been deployed yet. */}
      {isTouchEnabled && hasTapData && (
        <li className="px-2 pt-1 pb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
          <Hand className="w-3 h-3 text-violet-500" />
          {tapAgg!.total} {tapAgg!.total === 1 ? 'tap' : 'taps'} · last {tapAgg!.sinceDays} days
        </li>
      )}
      {sorted.map(zone => {
        const c = getZoneColor(zone.widgetType);
        const Icon = widgetIcon(zone.widgetType);
        const isSelected = selectedIds.includes(zone.id);
        const tapCount = tapsByZone[zone.id] || 0;
        return (
          <li key={zone.id}>
            <div
              className={`group flex items-center gap-2 p-2 rounded-lg transition-colors ${
                isSelected ? 'bg-indigo-50 ring-1 ring-indigo-200' : 'hover:bg-slate-50'
              }`}
            >
              <button
                type="button"
                className="flex items-center gap-2 flex-1 min-w-0 text-left focus:outline-none focus:ring-2 focus:ring-indigo-400 rounded px-1 py-0.5"
                onClick={(e) => select([zone.id], e.shiftKey || e.metaKey || e.ctrlKey)}
                aria-pressed={isSelected}
              >
                <span
                  className="w-6 h-6 rounded flex items-center justify-center shrink-0"
                  style={{ background: c.bg, border: `1px solid ${c.border}` }}
                  aria-hidden
                >
                  <Icon className="w-3.5 h-3.5" style={{ color: c.accent }} />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="text-xs font-semibold text-slate-700 truncate block">{zone.name}</span>
                  <span className="text-[10px] uppercase font-medium text-slate-400 block">{widgetLabel(zone.widgetType)}</span>
                </span>
                {/* Phase D5 — tap count badge per zone. Only shown when
                    the template is touch-enabled AND this zone has at
                    least one recorded tap. Compact integer; tooltip
                    spells out the time window. */}
                {isTouchEnabled && tapCount > 0 && (
                  <span
                    className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700 text-[10px] font-bold"
                    title={`${tapCount} taps in the last ${tapAgg!.sinceDays} days`}
                  >
                    <Hand className="w-2.5 h-2.5" />
                    {tapCount}
                  </span>
                )}
              </button>
              <div className="flex items-center opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                <button
                  type="button"
                  onClick={() => moveLayer(zone.id, 'up')}
                  className="p-1 rounded hover:bg-slate-200 text-slate-400 hover:text-slate-700"
                  aria-label={`Bring ${zone.name} forward`}
                  title="Bring forward"
                >
                  <ChevronUp className="w-3 h-3" aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={() => moveLayer(zone.id, 'down')}
                  className="p-1 rounded hover:bg-slate-200 text-slate-400 hover:text-slate-700"
                  aria-label={`Send ${zone.name} back`}
                  title="Send back"
                >
                  <ChevronDown className="w-3 h-3" aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={() => toggleLock(zone.id)}
                  className="p-1 rounded hover:bg-slate-200 text-slate-400 hover:text-slate-700"
                  aria-label={zone.locked ? `Unlock ${zone.name}` : `Lock ${zone.name}`}
                  title={zone.locked ? 'Unlock' : 'Lock'}
                >
                  {zone.locked ? <Lock className="w-3 h-3" aria-hidden /> : <Unlock className="w-3 h-3" aria-hidden />}
                </button>
                <button
                  type="button"
                  onClick={() => duplicateZone(zone.id)}
                  className="p-1 rounded hover:bg-slate-200 text-slate-400 hover:text-slate-700"
                  aria-label={`Duplicate ${zone.name}`}
                  title="Duplicate"
                >
                  <Copy className="w-3 h-3" aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    select([zone.id]);
                    removeSelected();
                  }}
                  className="p-1 rounded hover:bg-rose-50 text-slate-400 hover:text-rose-600"
                  aria-label={`Delete ${zone.name}`}
                  title="Delete"
                >
                  <Trash2 className="w-3 h-3" aria-hidden />
                </button>
              </div>
            </div>
          </li>
        );
      })}
      {/* Background pseudo-layer at the bottom of the stack — always
          the bottom-most layer, always visible, can't be deleted. */}
      <BackgroundLayer selected={selectedIds.length === 0} onSelect={selectBackground} />
    </ul>
  );
}
