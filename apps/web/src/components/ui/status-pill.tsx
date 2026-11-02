/**
 * StatusPill — the ONE pill the dashboard is allowed (pill audit, 2026-11-02).
 *
 * Rule: a fully rounded, tinted pill is a READ-ONLY status or count. It is a
 * `<span>`, never focusable, never hoverable, never clickable — the prop type
 * forbids `onClick` / `href`. Anything a person can press is a Button, a
 * `TabRow` tab, a `Segmented` option or a menu item instead.
 *
 * Tone never carries meaning alone: the text says it (and an optional icon).
 */
import type { ReactNode } from 'react';

export type StatusTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'brand';

const TONES: Record<StatusTone, string> = {
  neutral: 'bg-slate-100 text-slate-600',
  success: 'bg-emerald-50 text-emerald-700',
  warning: 'bg-amber-50 text-amber-800',
  danger: 'bg-rose-50 text-rose-700',
  info: 'bg-sky-50 text-sky-700',
  brand: 'bg-indigo-50 text-indigo-700',
};

export interface StatusPillProps {
  tone?: StatusTone;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
  title?: string;
  'data-testid'?: string;
  /** Pressing a status is not a thing — these exist only to make it a type error. */
  onClick?: never;
  href?: never;
}

export function StatusPill({ tone = 'neutral', icon, children, className, title, ...rest }: StatusPillProps) {
  return (
    <span
      title={title}
      data-testid={rest['data-testid']}
      data-status-pill={tone}
      className={`inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 text-[11px] font-semibold leading-none ${TONES[tone]} ${className ?? ''}`}
    >
      {icon}
      {children}
    </span>
  );
}
