'use client';

import { useEffect, useRef, useState } from 'react';
import { DateField } from './date-field';
import { TimeField } from './time-field';
import type { FieldAccent } from './field-accent';

/**
 * A `datetime-local` the operator can TYPE or PICK — `DateField` + `TimeField`
 * side by side, reporting one value.
 *
 * 2026-09-22, same operator report that produced the two halves: "the date
 * picker in schedule is kinda tiny…also i think we should have time picker
 * menu but also be able to type it in". The six `<input type="datetime-local">`
 * sites had the SAME problem twice over — Safari draws a cramped popup for the
 * date half and no menu at all for the time half.
 *
 * The wire format is the native input's, unchanged: `''` or
 * `YYYY-MM-DDTHH:MM` (local wall-clock, no zone). Hosts that convert at the
 * boundary (`datetimeLocalToIso`) keep working untouched.
 *
 * THE HALF-FILLED STATE is the whole reason this is a component and not two
 * fields at each call site. `2026-10-12T` is not a datetime — emitting it
 * would hand the host a string `new Date()` reads as Invalid Date. So while
 * exactly one half is filled we report `''` (what the native input reports for
 * an incomplete entry) and keep the filled half in LOCAL state, so the
 * operator's typing survives being told "you have nothing yet".
 */

const SPLIT = /^(\d{4}-\d{2}-\d{2})T(\d{1,2}:\d{2})/;

interface Halves {
  date: string;
  time: string;
}

/** `'2026-10-12T09:00'` → both halves; anything else → both empty. */
function splitValue(value: string): Halves {
  const m = SPLIT.exec(value ?? '');
  if (!m) return { date: '', time: '' };
  // The time half is normalized by TimeField's own contract (`HH:MM`), so a
  // single-digit hour from a hand-written value is padded here.
  const [h, min] = m[2].split(':');
  return { date: m[1], time: `${h.padStart(2, '0')}:${min}` };
}

export interface DateTimeFieldProps {
  /** Goes on the DATE half — the one every existing `htmlFor` points at. */
  id: string;
  /** `''` or `YYYY-MM-DDTHH:MM`. */
  value: string;
  onChange: (next: string) => void;
  /** The field's name, e.g. "Expiration date". The time half says "… time". */
  ariaLabel: string;
  /** Earliest date the operator may ENTER. Existing earlier values still show. */
  min?: string;
  placeholder?: string;
  accent?: FieldAccent;
  /** Applied to the field's outer box — hosts pass their width sizing here. */
  className?: string;
  disabled?: boolean;
  /** Extra classes for the COARSE-pointer native input (the host's own box). */
  nativeClassName?: string;
}

export function DateTimeField({
  id,
  value,
  onChange,
  ariaLabel,
  min,
  placeholder,
  accent = 'indigo',
  className = '',
  disabled = false,
  nativeClassName = '',
}: DateTimeFieldProps) {
  // Which control set to draw — the rule `ScheduleWindowFields` established.
  // Coarse pointer (phone / tablet) keeps the NATIVE input: iOS and Android
  // already draw a big, well-tuned wheel, and a text field would pop the
  // on-screen keyboard over whatever the operator is filling in. Read once,
  // lazily; every host of this field lives under /[schoolId], whose layout
  // renders a neutral placeholder until `mounted`, so there is no SSR pass
  // for this read to mismatch.
  const [coarsePointer] = useState(
    () => typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches,
  );

  /**
   * The halves, but ONLY while the pair is incomplete. `null` means "read the
   * host's value" — so a host-driven change (a poll, a Clear button, loading a
   * record) is displayed with no syncing effect to get out of step.
   */
  const [pending, setPending] = useState<Halves | null>(null);
  /**
   * The last value WE sent. An incoming `value` equal to it is our own echo
   * and must not clear `pending` — clearing the time half emits `''`, and
   * treating that `''` as a host edit would wipe the date the operator kept.
   */
  const lastEmitted = useRef(value);

  useEffect(() => {
    if (value === lastEmitted.current) return;
    lastEmitted.current = value;
    setPending(null);
  }, [value]);

  const current = pending ?? splitValue(value);

  const apply = (next: Halves) => {
    // Both halves or nothing — a half-filled pair is not a datetime.
    const out = next.date && next.time ? `${next.date}T${next.time}` : '';
    lastEmitted.current = out;
    setPending(out ? null : next);
    onChange(out);
  };

  if (coarsePointer) {
    return (
      <input
        id={id}
        type="datetime-local"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        min={min ? `${min}T00:00` : undefined}
        disabled={disabled}
        aria-label={ariaLabel}
        className={nativeClassName || `w-full min-h-[44px] px-3 py-2 border border-slate-200 rounded-lg bg-white text-sm text-slate-700 outline-none ${className}`}
      />
    );
  }

  return (
    // Stacks on a narrow window, sits side by side from `sm:` — the same
    // responsive rule the schedule fields use, for the same reason (a fixed
    // row shears the second field off the right edge).
    <div className={`flex flex-col sm:flex-row items-stretch ${className}`}>
      <DateField
        id={id}
        value={current.date}
        onChange={(date) => apply({ ...current, date })}
        min={min}
        ariaLabel={ariaLabel}
        placeholder={placeholder ?? ariaLabel}
        accent={accent}
        disabled={disabled}
        className="flex-[3] min-w-0"
      />
      <label className="sr-only" htmlFor={`${id}-time`}>
        {ariaLabel} time
      </label>
      <TimeField
        id={`${id}-time`}
        value={current.time}
        onChange={(time) => apply({ ...current, time })}
        ariaLabel={`${ariaLabel} time`}
        accent={accent}
        disabled={disabled}
        className="flex-[2] min-w-0 mt-1 sm:mt-0 sm:ml-1.5"
      />
    </div>
  );
}
