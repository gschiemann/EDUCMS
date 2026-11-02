'use client';

/**
 * PageToolbar — the one toolbar row a list page gets (pill audit 2026-11-02):
 *
 *   [ main TabRow ……………… ]  [ search ]  [ Filter (n) ]  [ Sort ]  [ trailing ]
 *
 * One quiet 48px line with a hairline under it (the Media Library look,
 * PR #237). When something is selected on desktop, pass `selection` and the
 * SAME row becomes the selection bar in place — the page never grows. On a
 * phone the page renders `ActionDock` instead and the toolbar stays.
 *
 * At phone width (`compact`) the tabs get their own line under search +
 * filter, because the row has no room for both.
 */
import type { ReactNode } from 'react';

export interface PageToolbarProps {
  tabs?: ReactNode;
  search?: ReactNode;
  filters?: ReactNode;
  sort?: ReactNode;
  trailing?: ReactNode;
  /** Desktop selection bar; replaces the whole row while set. */
  selection?: ReactNode;
  /** Phone layout (from `useIsMobile`) — each control renders ONCE, never twice. */
  compact?: boolean;
  /**
   * Desktop: tabs on their own line UNDER search · Filter · Sort. For a page
   * whose category row is long (Templates has 7+ tabs) — on one line at
   * 1325px the last tabs were cut off. The selection bar then replaces the
   * TOP line only, at the same height, so the page still never grows.
   */
  tabsBelow?: boolean;
  testId?: string;
  className?: string;
}

export function PageToolbar({ tabs, search, filters, sort, trailing, selection, compact, tabsBelow, testId, className }: PageToolbarProps) {
  if (tabsBelow && !compact) {
    return (
      <div className={className} data-testid={testId}>
        <div className="flex items-center gap-2 h-12">
          {selection ? (
            <div className="flex-1 min-w-0 h-full">{selection}</div>
          ) : (
            <>
              <div className="w-full max-w-sm">{search}</div>
              <div className="flex-1" />
              {filters}
              {sort}
              {trailing}
            </>
          )}
        </div>
        <div className="h-12 border-b border-slate-200">{tabs}</div>
      </div>
    );
  }
  if (selection) {
    return (
      <div className={`flex items-center h-12 border-b border-slate-200 ${className ?? ''}`} data-testid={testId}>
        <div className="flex-1 min-w-0 h-full">{selection}</div>
      </div>
    );
  }
  if (compact) {
    return (
      <div className={`space-y-2 ${className ?? ''}`} data-testid={testId}>
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0">{search}</div>
          {filters}
          {sort}
        </div>
        <div className="flex items-center gap-2 h-12 border-b border-slate-200">
          <div className="flex-1 min-w-0 h-full">{tabs}</div>
          {trailing}
        </div>
      </div>
    );
  }
  return (
    <div className={`flex items-center gap-3 h-12 border-b border-slate-200 ${className ?? ''}`} data-testid={testId}>
      <div className="flex-1 min-w-0 h-full">{tabs}</div>
      {search && <div className="shrink-0">{search}</div>}
      {filters}
      {sort}
      {trailing && <div className="flex items-center gap-2 shrink-0">{trailing}</div>}
    </div>
  );
}
