"use client";

import { ChevronDown, MapPin } from 'lucide-react';

/** The same named location selector for dashboard and screen operations. */
export function LocationFilter({ locations, value, onChange, label = 'Filter by location', allLabel = 'All locations' }: {
  locations: Array<{ id: string; name: string }>;
  value: string;
  onChange: (id: string) => void;
  label?: string;
  allLabel?: string;
}) {
  return (
    <div className="relative min-w-0 max-w-full">
      <MapPin className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden />
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}
        className="appearance-none max-w-full pl-9 pr-9 py-2.5 rounded-xl border border-slate-200 bg-white text-[13px] font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-300">
        <option value="all">{allLabel}</option>
        {[...locations].sort((a, b) => a.name.localeCompare(b.name)).map((location) => (
          <option key={location.id} value={location.id}>{location.name}</option>
        ))}
      </select>
      <ChevronDown className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden />
    </div>
  );
}
