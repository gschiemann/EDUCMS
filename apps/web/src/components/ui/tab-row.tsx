'use client';

/**
 * TabRow — the page's MAIN category as an underlined tab row (pill audit
 * 2026-11-02, rule 3; generalised from the Media Library's MediaTypeTabs,
 * PR #237). One quiet line; the active tab carries a 2px brand underline;
 * counts are plain grey numbers, never a nested pill. Scrolls sideways at
 * phone width instead of wrapping.
 *
 * `role="tablist"`, roving tabindex, arrow keys move and select (a filter
 * tab has no panel of its own to defer to, so selection follows focus).
 */
import { useRef, type KeyboardEvent, type ReactNode } from 'react';

export interface TabRowTab<T extends string> {
  key: T;
  label: ReactNode;
  /** Plain grey number after the label. Omit to show none. */
  count?: number;
  icon?: ReactNode;
}

export interface TabRowProps<T extends string> {
  value: T;
  onChange: (key: T) => void;
  tabs: ReadonlyArray<TabRowTab<T>>;
  ariaLabel: string;
  testId?: string;
  className?: string;
}

export function TabRow<T extends string>({ value, onChange, tabs, ariaLabel, testId, className }: TabRowProps<T>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const activeIndex = tabs.findIndex((tab) => tab.key === value);

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (tabs.length === 0) return;
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    const edge = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : -1;
    if (!step && edge < 0) return;
    e.preventDefault();
    const from = activeIndex < 0 ? 0 : activeIndex;
    const next = edge >= 0 ? edge : (from + step + tabs.length) % tabs.length;
    onChange(tabs[next].key);
    refs.current[next]?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      data-testid={testId}
      onKeyDown={onKey}
      className={`flex items-stretch gap-5 overflow-x-auto h-full -mb-px [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${className ?? ''}`}
    >
      {tabs.map((tab, i) => {
        const active = tab.key === value;
        return (
          <button
            key={tab.key}
            ref={(el) => { refs.current[i] = el; }}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active || (activeIndex < 0 && i === 0) ? 0 : -1}
            onClick={() => onChange(tab.key)}
            className={`shrink-0 min-h-11 flex items-center gap-1.5 whitespace-nowrap border-b-2 px-0.5 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 ${
              active
                ? 'border-indigo-600 text-slate-900 font-semibold'
                : 'border-transparent text-slate-500 hover:text-slate-800 font-medium'
            }`}
          >
            {tab.icon}
            {tab.label}
            {tab.count != null && (
              <span className={`text-xs tabular-nums ${active ? 'text-slate-500' : 'text-slate-400'}`}>{tab.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
