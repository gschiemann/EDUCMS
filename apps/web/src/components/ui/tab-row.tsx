'use client';

/**
 * TabRow — the page's MAIN category as an underlined tab row (pill audit
 * 2026-11-02, rule 3; generalised from the Media Library's MediaTypeTabs,
 * PR #237). One quiet line; the active tab carries a 2px brand underline;
 * counts are plain grey numbers, never a nested pill.
 *
 * Long rows: by default the row scrolls sideways. With `overflow`, it stays
 * ONE line at any width — the tabs that do not fit go into a "More" menu at
 * the end (the shared `AnchoredMenu`). The ACTIVE tab is always on the line:
 * picked from More, it takes the last visible slot. Templates uses this so its
 * category tabs share the toolbar row with search · Filter · Sort, like the
 * Media Library.
 *
 * `role="tablist"`, roving tabindex, arrow keys move and select (a filter
 * tab has no panel of its own to defer to, so selection follows focus).
 * `value` may match no tab — then no tab is underlined (Screens: a status
 * shown by the Filter button instead).
 */
import { useCallback, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { AnchoredMenu } from './anchored-menu';
import { useDismiss } from './use-dismiss';

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
  /** Keep one line; tabs that do not fit go into a "More" menu. */
  overflow?: boolean;
}

/** Gap between tabs (`gap-5`), in px — the fit maths must match the CSS. */
const GAP = 20;

/**
 * Which tabs stay on the line, given each tab's width, the room, and the
 * More button's width. Pure; exported for tests. Returns indexes in order.
 * The active tab is always kept: if it would overflow, it replaces the last
 * tab that fits.
 */
export function fitTabs(widths: number[], room: number, moreWidth: number, activeIndex: number): number[] {
  const span = (idx: number[]) => idx.reduce((sum, i, n) => sum + widths[i] + (n > 0 ? GAP : 0), 0);
  const all = widths.map((_, i) => i);
  if (room <= 0 || span(all) <= room) return all;
  const budget = room - moreWidth - GAP;
  const kept: number[] = [];
  for (const i of all) {
    if (span([...kept, i]) > budget) break;
    kept.push(i);
  }
  if (activeIndex >= 0 && !kept.includes(activeIndex)) {
    // The active tab always stays on the line: drop tabs from the end to fit it.
    while (kept.length > 0 && span([...kept, activeIndex]) > budget) kept.pop();
    kept.push(activeIndex);
  }
  return kept.length > 0 ? kept : [0];
}

const TAB_CLASS = 'shrink-0 min-h-11 flex items-center gap-1.5 whitespace-nowrap border-b-2 px-0.5 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500';

function TabContent<T extends string>({ tab }: { tab: TabRowTab<T> }) {
  return (
    <>
      {tab.icon}
      {tab.label}
      {tab.count != null && (
        <span className="text-xs tabular-nums text-slate-500">{tab.count}</span>
      )}
    </>
  );
}

export function TabRow<T extends string>({ value, onChange, tabs, ariaLabel, testId, className, overflow }: TabRowProps<T>) {
  const t = useTranslations('ui');
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const wrapRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const moreMeasureRef = useRef<HTMLSpanElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const closeMore = useCallback(() => setMoreOpen(false), []);
  useDismiss(moreOpen, moreRef, closeMore);

  const activeIndex = tabs.findIndex((tab) => tab.key === value);
  const [shown, setShown] = useState<number[] | null>(null);
  const tabsSig = tabs.map((tab) => `${tab.key}:${tab.count ?? ''}`).join('|');

  useLayoutEffect(() => {
    if (!overflow) return;
    const wrap = wrapRef.current;
    const measure = measureRef.current;
    if (!wrap || !measure) return;
    const run = () => {
      const widths = Array.from(measure.children).map((el) => (el as HTMLElement).offsetWidth);
      const room = wrap.clientWidth;
      const moreWidth = moreMeasureRef.current?.offsetWidth ?? 0;
      const kept = fitTabs(widths, room, moreWidth, activeIndex);
      setShown((prev) => (prev && prev.join(',') === kept.join(',') ? prev : kept));
    };
    run();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(run);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [overflow, tabsSig, activeIndex]);

  const visibleIdx = overflow && shown ? shown.filter((i) => i < tabs.length) : tabs.map((_, i) => i);
  const hiddenIdx = overflow && shown ? tabs.map((_, i) => i).filter((i) => !visibleIdx.includes(i)) : [];
  const visible = visibleIdx.map((i) => tabs[i]);
  const visibleActive = visible.findIndex((tab) => tab.key === value);

  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (visible.length === 0) return;
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    const edge = e.key === 'Home' ? 0 : e.key === 'End' ? visible.length - 1 : -1;
    if (!step && edge < 0) return;
    e.preventDefault();
    const from = visibleActive < 0 ? 0 : visibleActive;
    const next = edge >= 0 ? edge : (from + step + visible.length) % visible.length;
    onChange(visible[next].key);
    refs.current[next]?.focus();
  };

  return (
    <div ref={wrapRef} className={`relative h-full min-w-0 ${className ?? ''}`}>
      {/* With `overflow`, More sits BESIDE the tablist (a tablist may only
          own tabs — axe aria-required-children); same row, same 20px gap. */}
      <div className={overflow ? 'flex items-stretch gap-5 h-full -mb-px overflow-hidden' : 'contents'}>
      <div
        role="tablist"
        aria-label={ariaLabel}
        data-testid={testId}
        className={`flex items-stretch gap-5 ${overflow ? 'shrink-0' : 'h-full -mb-px overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'}`}
      >
        {visible.map((tab, i) => {
          const active = tab.key === value;
          return (
            <button
              key={tab.key}
              ref={(el) => { refs.current[i] = el; }}
              type="button"
              role="tab"
              aria-selected={active}
              tabIndex={active || (visibleActive < 0 && i === 0) ? 0 : -1}
              onClick={() => onChange(tab.key)}
              onKeyDown={onKey}
              className={`${TAB_CLASS} ${
                active
                  ? 'border-indigo-600 text-slate-900 font-semibold'
                  : 'border-transparent text-slate-500 hover:text-slate-800 font-medium'
              }`}
            >
              <TabContent tab={tab} />
            </button>
          );
        })}
      </div>
        {hiddenIdx.length > 0 && (
          <button
            ref={moreRef}
            type="button"
            aria-haspopup="menu"
            aria-expanded={moreOpen}
            data-testid={testId ? `${testId}-more` : undefined}
            onClick={() => setMoreOpen((v) => !v)}
            className={`${TAB_CLASS} border-transparent text-slate-500 hover:text-slate-800 font-medium`}
          >
            {t('moreTabs')}
            <ChevronDown className="w-3.5 h-3.5" aria-hidden />
          </button>
        )}
      </div>
      {overflow && (
        // Off-screen copy at natural width — what the fit maths measures.
        <div aria-hidden className="pointer-events-none invisible absolute left-0 top-0 flex gap-5 whitespace-nowrap" style={{ width: 'max-content' }}>
          <div ref={measureRef} className="flex gap-5">
            {tabs.map((tab) => (
              <span key={tab.key} className={`${TAB_CLASS} border-transparent font-semibold`}>
                <TabContent tab={tab} />
              </span>
            ))}
          </div>
          <span ref={moreMeasureRef} className={`${TAB_CLASS} border-transparent font-medium`}>
            {t('moreTabs')}
            <ChevronDown className="w-3.5 h-3.5" aria-hidden />
          </span>
        </div>
      )}
      <AnchoredMenu anchorRef={moreRef} open={moreOpen && hiddenIdx.length > 0} width={240} ariaLabel={t('moreTabs')}>
        <div role="menu" className="py-1" data-testid={testId ? `${testId}-more-menu` : undefined}>
          {hiddenIdx.map((i) => {
            const tab = tabs[i];
            return (
              <button
                key={tab.key}
                type="button"
                role="menuitemradio"
                aria-checked={tab.key === value}
                onClick={() => { onChange(tab.key); setMoreOpen(false); }}
                className="w-full min-h-11 sm:min-h-9 px-3 flex items-center gap-2 text-left text-[13px] text-slate-700 hover:bg-slate-50"
              >
                <span className="flex-1 min-w-0 truncate">{tab.icon}{tab.label}</span>
                {tab.count != null && <span className="text-xs tabular-nums text-slate-400">{tab.count}</span>}
                {tab.key === value && <Check className="w-3.5 h-3.5 text-indigo-600" aria-hidden />}
              </button>
            );
          })}
        </div>
      </AnchoredMenu>
    </div>
  );
}
