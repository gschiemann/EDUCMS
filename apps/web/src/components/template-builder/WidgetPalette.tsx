"use client";

import { useState, useMemo, useId } from 'react';
import { Search } from 'lucide-react';
import { useDraggable } from '@dnd-kit/core';
import { WIDGET_GROUPS, getZoneColor } from './constants';
import { useBuilderStore } from './useBuilderStore';
import { CSS } from '@dnd-kit/utilities';

function DraggableWidgetButton({ type, label, desc, icon: Icon, colorTheme }: any) {
  const { attributes, listeners, setNodeRef, isDragging, transform } = useDraggable({
    id: `widget-palette-${type}`,
    data: {
      type: 'widget-palette-item',
      widgetType: type,
    },
  });

  const addZone = useBuilderStore(s => s.addZone);

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 9999 : 'auto',
  };

  return (
    <button
      ref={setNodeRef}
      style={{ ...style, background: colorTheme.bg }}
      {...listeners}
      {...attributes}
      type="button"
      // Keep click functionality as a fallback / shortcut
      onClick={(e) => {
        // Only click if we didn't just drag
        if (!isDragging) {
           addZone(type);
        }
      }}
      className={`w-full flex items-center gap-3 p-3 rounded-xl text-left transition-all duration-200 border border-transparent shadow-sm hover:shadow-md focus:outline-none focus:ring-2 focus:ring-indigo-400 ${
        isDragging ? 'shadow-2xl scale-105 rotate-2 cursor-grabbing' : 'hover:-translate-y-0.5 hover:border-slate-200 cursor-grab'
      }`}
    >
      <div 
        className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 shadow-sm"
        style={{ background: 'white' }}
      >
        <Icon className="w-4 h-4" style={{ color: colorTheme.accent }} aria-hidden />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[11px] font-bold truncate tracking-tight" style={{ color: colorTheme.text }}>{label}</div>
        <div className="text-[10px] truncate opacity-80" style={{ color: colorTheme.text }}>{desc}</div>
      </div>
    </button>
  );
}

export function WidgetPalette() {
  const [query, setQuery] = useState('');
  const searchId = useId();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return WIDGET_GROUPS;
    return WIDGET_GROUPS.map(g => ({
      ...g,
      types: g.types.filter(t =>
        t.label.toLowerCase().includes(q) ||
        t.desc.toLowerCase().includes(q) ||
        t.type.toLowerCase().includes(q),
      ),
    })).filter(g => g.types.length > 0);
  }, [query]);

  return (
    <div className="p-4 space-y-5">
      <div className="relative group">
        <label htmlFor={searchId} className="sr-only">Search widgets</label>
        <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 transition-colors group-focus-within:text-indigo-500" aria-hidden />
        <input
          id={searchId}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search widgets..."
          className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-slate-50/50 border border-slate-200/60 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:bg-white focus:border-indigo-400 placeholder:text-slate-400 transition-all shadow-sm inset-shadow-sm"
        />
      </div>

      {filtered.length === 0 && (
        <p className="text-xs text-slate-400 text-center py-8 font-medium">No widgets match &ldquo;{query}&rdquo;.</p>
      )}

      {filtered.map(group => (
        <div key={group.label} className="space-y-2.5">
          <h3 className="text-[10px] font-bold text-slate-400/80 uppercase tracking-widest pl-1">{group.label}</h3>
          <div className="space-y-1.5">
            {group.types.map(t => (
              <DraggableWidgetButton 
                key={t.type}
                type={t.type}
                label={t.label}
                desc={t.desc}
                icon={t.icon}
                colorTheme={getZoneColor(t.type)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
