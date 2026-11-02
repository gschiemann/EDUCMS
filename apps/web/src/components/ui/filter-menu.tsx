'use client';

/**
 * FilterMenu — every SECONDARY filter of a page behind one "Filter" button
 * (pill audit 2026-11-02, rule 3). The button carries a small count of the
 * filters that are on; the panel lists each dimension as a group of
 * radio / checkbox rows with grey counts, and one "Clear filters".
 *
 * A page has at most one TabRow (its main category) + one FilterMenu + one
 * Sort. The panel is the shared `AnchoredMenu`, clamped to the viewport, so
 * it works at phone width too.
 *
 * Value semantics are the CALLER's: `onChange(groupId, next)` hands back the
 * new value and the page decides what else changes with it (the Templates
 * page resets paging; the Screens page writes its single filter key).
 */
import { useCallback, useRef, useState } from 'react';
import { Check, SlidersHorizontal } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { AnchoredMenu } from './anchored-menu';
import { useDismiss } from './use-dismiss';

export interface FilterOption {
  value: string;
  label: string;
  count?: number;
  disabled?: boolean;
}

export interface FilterGroup {
  id: string;
  label: string;
  type: 'single' | 'multi';
  options: FilterOption[];
  /** For a single group: the value that means "no filter" (default ''). */
  emptyValue?: string;
}

export type FilterValue = Record<string, string | string[]>;

export interface FilterMenuProps {
  groups: FilterGroup[];
  value: FilterValue;
  onChange: (groupId: string, next: string | string[]) => void;
  onClear: () => void;
  label?: string;
  testId?: string;
  width?: number;
  /**
   * What the button counts, when the page shows part of the filter elsewhere
   * (Screens: a status that has its own tab is shown BY the tab, so the
   * button does not count it too). Defaults to `activeFilterCount`.
   */
  activeCount?: number;
}

/** How many groups are narrowing the list right now. Exported for tests. */
export function activeFilterCount(groups: FilterGroup[], value: FilterValue): number {
  let n = 0;
  for (const g of groups) {
    const v = value[g.id];
    if (g.type === 'multi') { if (Array.isArray(v) && v.length > 0) n += 1; }
    else if (typeof v === 'string' && v !== (g.emptyValue ?? '')) n += 1;
  }
  return n;
}

export function FilterMenu({ groups, value, onChange, onClear, label, testId, width = 280, activeCount }: FilterMenuProps) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, anchor, close);
  const selectedCount = activeFilterCount(groups, value);
  const count = activeCount ?? selectedCount;
  const visible = groups.filter((g) => g.options.length > 0);

  return (
    <>
      <button
        ref={anchor}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t('ui.filterButton', { count })}
        data-testid={testId}
        onClick={() => setOpen((v) => !v)}
        className={`min-h-11 sm:min-h-9 px-3 rounded-lg border text-[13px] font-semibold flex items-center gap-1.5 shrink-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
          count > 0 || open ? 'border-indigo-200 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
        }`}
      >
        <SlidersHorizontal className="w-4 h-4" aria-hidden />
        {label ?? t('ui.filter')}
        {count > 0 && (
          <span aria-hidden className="min-w-[18px] h-[18px] px-1 rounded-full bg-indigo-600 text-white text-[11px] font-bold leading-[18px] text-center tabular-nums">
            {count}
          </span>
        )}
      </button>
      <AnchoredMenu anchorRef={anchor} open={open} width={width} ariaLabel={label ?? t('ui.filter')}>
        <div className="max-h-[min(70vh,520px)] overflow-y-auto py-1" data-testid={testId ? `${testId}-panel` : undefined}>
          {visible.map((g, gi) => {
            const v = value[g.id];
            const selected = g.type === 'multi' ? (Array.isArray(v) ? v : []) : [typeof v === 'string' ? v : g.emptyValue ?? ''];
            return (
              <div key={g.id} role={g.type === 'multi' ? 'group' : 'radiogroup'} aria-label={g.label} className={gi > 0 ? 'border-t border-slate-100 mt-1 pt-1' : ''}>
                <p className="px-3 pt-2 pb-1 text-[11px] font-bold uppercase tracking-wider text-slate-500">{g.label}</p>
                {g.options.map((o) => {
                  const on = selected.includes(o.value);
                  return (
                    <button
                      key={o.value || '__all'}
                      type="button"
                      role={g.type === 'multi' ? 'checkbox' : 'radio'}
                      aria-checked={on}
                      disabled={o.disabled && !on}
                      onClick={() => {
                        if (g.type === 'multi') {
                          onChange(g.id, on ? selected.filter((x) => x !== o.value) : [...selected, o.value]);
                        } else {
                          onChange(g.id, o.value);
                        }
                      }}
                      className="w-full min-h-11 sm:min-h-9 px-3 flex items-center gap-2 text-left text-[13px] text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <span
                        aria-hidden
                        className={`w-4 h-4 shrink-0 flex items-center justify-center border ${g.type === 'multi' ? 'rounded' : 'rounded-full'} ${
                          on ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-slate-300 bg-white'
                        }`}
                      >
                        {on && <Check className="w-3 h-3" strokeWidth={3} />}
                      </span>
                      <span className={`flex-1 min-w-0 truncate ${on ? 'font-semibold text-slate-900' : ''}`}>{o.label}</span>
                      {o.count != null && <span className="text-xs tabular-nums text-slate-400">{o.count}</span>}
                    </button>
                  );
                })}
              </div>
            );
          })}
          <div className="border-t border-slate-100 mt-1 px-3 py-2 flex items-center justify-between">
            <span className="text-xs text-slate-500">{count > 0 ? t('ui.filtersActive', { count }) : ''}</span>
            <button
              type="button"
              onClick={() => { onClear(); }}
              disabled={selectedCount === 0}
              className="min-h-11 sm:min-h-0 px-2 py-1 rounded-md text-xs font-semibold text-indigo-700 hover:bg-indigo-50 disabled:text-slate-300 disabled:hover:bg-transparent"
            >
              {t('ui.clearFilters')}
            </button>
          </div>
        </div>
      </AnchoredMenu>
    </>
  );
}
