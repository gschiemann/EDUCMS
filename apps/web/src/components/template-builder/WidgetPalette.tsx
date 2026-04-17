"use client";

import { useState, useMemo, useId } from 'react';
import { Search } from 'lucide-react';
import { WIDGET_GROUPS, getZoneColor } from './constants';
import { useBuilderStore } from './useBuilderStore';

export function WidgetPalette() {
  const [query, setQuery] = useState('');
  const addZone = useBuilderStore(s => s.addZone);
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
    <div className="p-3 space-y-4">
      <div className="relative">
        <label htmlFor={searchId} className="sr-only">Search widgets</label>
        <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden />
        <input
          id={searchId}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search widgets..."
          className="w-full pl-9 pr-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-300 placeholder:text-slate-400"
        />
      </div>

      {filtered.length === 0 && (
        <p className="text-xs text-slate-400 text-center py-6">No widgets match &ldquo;{query}&rdquo;.</p>
      )}

      {filtered.map(group => (
        <div key={group.label}>
          <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">{group.label}</h3>
          <div className="space-y-1">
            {group.types.map(t => {
              const c = getZoneColor(t.type);
              const Icon = t.icon;
              return (
                <button
                  key={t.type}
                  type="button"
                  onClick={() => addZone(t.type)}
                  className="w-full flex items-center gap-3 p-2.5 rounded-xl text-left transition-all hover:shadow-md border border-transparent hover:border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  style={{ background: c.bg }}
                >
                  <Icon className="w-4 h-4 shrink-0" style={{ color: c.accent }} aria-hidden />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-bold truncate" style={{ color: c.text }}>{t.label}</div>
                    <div className="text-[10px] opacity-70 truncate" style={{ color: c.text }}>{t.desc}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
