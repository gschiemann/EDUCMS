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
 * filter, because the row has no room for both. A long tab row stays on the
 * one desktop line through `TabRow overflow` (a "More" menu), never a
 * second line.
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
  testId?: string;
  className?: string;
}

export function PageToolbar({ tabs, search, filters, sort, trailing, selection, compact, testId, className }: PageToolbarProps) {
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
