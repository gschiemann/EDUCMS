"use client";

import { Lock, Unlock, ChevronUp, ChevronDown, Trash2, Copy } from 'lucide-react';
import { useBuilderStore } from './useBuilderStore';
import { getZoneColor, widgetIcon, widgetLabel } from './constants';

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

  if (zones.length === 0) {
    return (
      <div className="p-6 text-center text-xs text-slate-400">
        No zones yet. Use the <strong>Widgets</strong> tab to add one.
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
    </ul>
  );
}
