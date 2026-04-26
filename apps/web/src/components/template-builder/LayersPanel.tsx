"use client";

import { Lock, Unlock, ChevronUp, ChevronDown, Trash2, Copy, Image as ImageIcon } from 'lucide-react';
import { useBuilderStore } from './useBuilderStore';
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
      {sorted.map(zone => {
        const c = getZoneColor(zone.widgetType);
        const Icon = widgetIcon(zone.widgetType);
        const isSelected = selectedIds.includes(zone.id);
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
