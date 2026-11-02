'use client';

/**
 * Segmented — a choose-one control for a VIEW, never a filter row (pill
 * audit 2026-11-02, rule 4): grid/list, list/map/floor, local/company,
 * landscape/portrait. Two or three options, enforced by the type.
 *
 * One rounded-lg container, the active option a white raised segment (the
 * look the Screens view switch already had). `role="radiogroup"` with roving
 * tabindex: Tab lands on the chosen option, arrow keys move AND choose.
 * 44px tall on a phone, 32px from `sm` up.
 */
import { useRef, type ComponentType, type KeyboardEvent } from 'react';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
}

type TwoOrThree<T extends string> =
  | readonly [SegmentedOption<T>, SegmentedOption<T>]
  | readonly [SegmentedOption<T>, SegmentedOption<T>, SegmentedOption<T>];

export interface SegmentedProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: TwoOrThree<T>;
  ariaLabel: string;
  /** Show only the icon; the label becomes the accessible name + tooltip. */
  iconOnly?: boolean;
  /** Stretch to the container width on a phone (each option grows). */
  fullWidthOnMobile?: boolean;
  className?: string;
  testId?: string;
}

export function Segmented<T extends string>({
  value, onChange, options, ariaLabel, iconOnly, fullWidthOnMobile, className, testId,
}: SegmentedProps<T>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const index = Math.max(0, options.findIndex((o) => o.value === value));

  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = (index + step + options.length) % options.length;
    onChange(options[next].value);
    refs.current[next]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      data-testid={testId}
      className={`inline-flex items-center rounded-lg border border-slate-200 bg-slate-100 p-0.5 ${fullWidthOnMobile ? 'flex w-full sm:inline-flex sm:w-auto' : ''} ${className ?? ''}`}
    >
      {options.map((o, i) => {
        const active = i === index;
        const Icon = o.icon;
        return (
          <button
            key={o.value}
            ref={(el) => { refs.current[i] = el; }}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={iconOnly ? o.label : undefined}
            title={iconOnly ? o.label : undefined}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(o.value)}
            onKeyDown={onKey}
            className={`inline-flex min-h-11 items-center justify-center gap-1.5 rounded-md text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 sm:min-h-8 motion-reduce:transition-none ${
              iconOnly ? 'min-w-11 sm:min-w-8' : 'px-3'
            } ${fullWidthOnMobile ? 'flex-1 sm:flex-none' : ''} ${
              active ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            {Icon && <Icon className="h-3.5 w-3.5" aria-hidden />}
            {!iconOnly && o.label}
          </button>
        );
      })}
    </div>
  );
}
