"use client";

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronDown, MapPin, Search } from 'lucide-react';
import { AnchoredMenu } from '@/components/ui/anchored-menu';
import { SelectionCheckbox } from '@/components/common/SelectionCheckbox';

/** Empty selection means all locations. Filters only narrow the current view. */
export function LocationFilter({ locations, value, onChange, label = 'Filter by location', allLabel = 'All locations' }: {
  locations: Array<{ id: string; name: string }>;
  value: string[];
  onChange: (ids: string[]) => void;
  label?: string;
  allLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const panelId = useId();
  const sorted = useMemo(() => [...locations].sort((a, b) => a.name.localeCompare(b.name)), [locations]);
  const selected = new Set(value);
  const choices = sorted.filter((location) => location.name.toLowerCase().includes(search.trim().toLowerCase()));
  const summary = value.length === 0 ? allLabel : value.length === 1
    ? locations.find((location) => location.id === value[0])?.name ?? '1 location selected'
    : `${value.length} locations selected`;

  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent | FocusEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !panelRef.current?.contains(target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('mousedown', outside);
    document.addEventListener('focusin', outside);
    document.addEventListener('keydown', escape, true);
    return () => {
      document.removeEventListener('mousedown', outside);
      document.removeEventListener('focusin', outside);
      document.removeEventListener('keydown', escape, true);
    };
  }, [open]);

  const toggle = (id: string) => onChange(selected.has(id) ? value.filter((item) => item !== id) : [...value, id]);
  const close = () => { setOpen(false); triggerRef.current?.focus(); };

  return (
    <div className="min-w-0 max-w-full">
      <button ref={triggerRef} type="button" aria-label={label} aria-expanded={open} aria-controls={open ? panelId : undefined}
        onClick={() => { setSearch(''); setOpen(!open); }}
        className="inline-flex items-center gap-2 max-w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-[13px] font-bold text-slate-700 outline-none focus-visible:ring-2 focus-visible:ring-indigo-300">
        <MapPin className="w-4 h-4 shrink-0 text-slate-400" aria-hidden />
        <span className="truncate max-w-[220px]">{summary}</span>
        <ChevronDown className="w-4 h-4 shrink-0 text-slate-400" aria-hidden />
      </button>
      <AnchoredMenu anchorRef={triggerRef} open={open} width={typeof window === 'undefined' ? 320 : Math.min(320, window.innerWidth - 16)}
        ariaLabel={`${label} options`} onPlaced={() => searchRef.current?.focus()}>
        <div ref={panelRef} id={panelId}>
          <div className="relative m-3">
            <Search className="absolute left-3 top-3 w-4 h-4 text-slate-400" aria-hidden />
            <input ref={searchRef} type="search" value={search} onChange={(event) => setSearch(event.target.value)}
              aria-label="Search locations" placeholder="Search locations…"
              className="w-full min-h-11 pl-9 pr-3 rounded-lg border border-slate-200 text-sm outline-none focus:ring-2 focus:ring-indigo-300" />
          </div>
          <div className="flex items-center px-3 border-b border-slate-100">
            <SelectionCheckbox checked={value.length === 0} label={allLabel} onChange={() => onChange([])} />
            <button type="button" onClick={() => onChange([])} className="flex-1 min-h-11 text-left px-2 text-sm font-semibold text-slate-700">{allLabel}</button>
          </div>
          <div className="max-h-[min(320px,45vh)] overflow-y-auto p-1">
            {choices.map((location) => (
              <div key={location.id} className={`flex items-center px-2 rounded-lg ${selected.has(location.id) ? 'bg-indigo-50' : 'hover:bg-slate-50'}`}>
                <SelectionCheckbox checked={selected.has(location.id)} label={`Select ${location.name}`} onChange={() => toggle(location.id)} />
                <button type="button" onClick={() => toggle(location.id)} className="flex-1 min-h-11 text-left px-2 text-sm text-slate-700">{location.name}</button>
              </div>
            ))}
            {choices.length === 0 && <p className="px-3 py-4 text-sm text-slate-500">No matching locations</p>}
          </div>
          <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-3 py-2">
            <span className="text-xs text-slate-500">{value.length ? `${value.length} selected` : allLabel}</span>
            <button type="button" onClick={close} className="min-h-11 px-3 rounded-lg text-sm font-bold text-indigo-600 hover:bg-indigo-50">Done</button>
          </div>
        </div>
      </AnchoredMenu>
    </div>
  );
}
