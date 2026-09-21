'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { AnchoredMenu } from './anchored-menu';
import { FIELD_ACCENT, type FieldAccent } from './field-accent';
import {
  WEEK_STARTS_ON,
  buildMonthGrid,
  formatDateDisplay,
  localeDateOrder,
  parseTypedDate,
  toLocalIsoDate,
} from '@/lib/date-time-entry';

/**
 * A date field the operator can TYPE or PICK.
 *
 * 2026-09-21 (operator, desktop Safari): "the date picker in schedule is kinda
 * tiny". Safari's native `<input type=date>` popup is small and cannot be
 * styled at all, so the calendar becomes ours: 44×40 day targets in a 336px
 * panel. The value it reports is unchanged (`''` or `YYYY-MM-DD`).
 *
 * `min` constrains NEW entry only. A schedule that started in the past is a
 * real, valid row — it displays normally and is never flagged; refusing to
 * show it would be the field lying about the data.
 */

/* ── local date arithmetic (navigation details, not wire format) ────── */

const fromIso = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const addDays = (iso: string, n: number) => {
  const d = fromIso(iso);
  return toLocalIsoDate(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n));
};
/** Month steps clamp the day, so Jan 31 → Feb 28, never Mar 3. */
const addMonths = (iso: string, n: number) => {
  const d = fromIso(iso);
  const target = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  return toLocalIsoDate(new Date(target.getFullYear(), target.getMonth(), Math.min(d.getDate(), lastDay)));
};
const startOfWeek = (iso: string) => addDays(iso, -((fromIso(iso).getDay() - WEEK_STARTS_ON + 7) % 7));
const monthOf = (iso: string) => {
  const d = fromIso(iso);
  return { year: d.getFullYear(), month: d.getMonth() };
};

const WEEKDAYS = [
  { letter: 'S', name: 'Sunday' },
  { letter: 'M', name: 'Monday' },
  { letter: 'T', name: 'Tuesday' },
  { letter: 'W', name: 'Wednesday' },
  { letter: 'T', name: 'Thursday' },
  { letter: 'F', name: 'Friday' },
  { letter: 'S', name: 'Saturday' },
];

const PANEL_WIDTH = 336;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export interface DateFieldProps {
  id: string;
  /** `''` or `YYYY-MM-DD`. */
  value: string;
  onChange: (next: string) => void;
  /** Earliest date the operator may ENTER. Existing earlier values still show. */
  min?: string;
  ariaLabel: string;
  placeholder?: string;
  accent?: FieldAccent;
  className?: string;
}

export function DateField({
  id,
  value,
  onChange,
  min,
  ariaLabel,
  placeholder,
  accent = 'indigo',
  className = '',
}: DateFieldProps) {
  const a = FIELD_ACCENT[accent];
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const dayRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const today = toLocalIsoDate(new Date());
  const floor = min && ISO.test(min) ? min : '';

  /**
   * `null` means "show the committed value" — see TimeField for the full
   * reasoning. Only unsent keystrokes live in state, so a host-driven value
   * change needs no syncing effect and re-committing the same date still
   * re-normalizes what is on screen.
   */
  const [draft, setDraft] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [invalid, setInvalid] = useState<null | 'unreadable' | 'too-early'>(null);
  /** True only when the keyboard has been moved INTO the grid. */
  const [gridActive, setGridActive] = useState(false);
  const [panelWidth, setPanelWidth] = useState(PANEL_WIDTH);

  const display = draft ?? formatDateDisplay(value);
  const hintId = `${id}-hint`;

  const isDisabled = useCallback((iso: string) => !!floor && iso < floor, [floor]);
  /** Where the roving tab stop sits: the value, else today, else the floor. */
  const preferredFocus = useCallback(() => {
    if (value && !isDisabled(value)) return value;
    if (!isDisabled(today)) return today;
    return floor || today;
  }, [value, today, floor, isDisabled]);

  const [focusIso, setFocusIso] = useState(() => value || today);
  const [view, setView] = useState(() => monthOf(value || today));

  const parse = useCallback(
    (text: string) => parseTypedDate(text, { today, min: floor || undefined, order: localeDateOrder() }),
    [today, floor],
  );

  /** What the typed text points at, for the calendar's preview ring. */
  const typedPreview = useMemo(() => (draft && draft.trim() ? parse(draft) : null), [draft, parse]);

  const cells = useMemo(() => buildMonthGrid(view.year, view.month), [view.year, view.month]);
  /**
   * Exactly one day is the grid's tab stop. It is the focused day when that
   * day is on screen and pickable; otherwise the first pickable cell — a grid
   * where every cell is tabIndex -1 is a grid the keyboard cannot reach.
   */
  const tabStopIso = useMemo(() => {
    const onScreen = cells.find((c) => c.iso === focusIso && !isDisabled(c.iso));
    if (onScreen) return onScreen.iso;
    return cells.find((c) => c.inMonth && !isDisabled(c.iso))?.iso ?? cells.find((c) => !isDisabled(c.iso))?.iso ?? '';
  }, [cells, focusIso, isDisabled]);

  const monthLabel = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(new Date(view.year, view.month, 1)),
    [view.year, view.month],
  );

  const showMonthOf = useCallback((iso: string) => {
    const next = monthOf(iso);
    setView((prev) => (prev.year === next.year && prev.month === next.month ? prev : next));
  }, []);

  const openMenu = useCallback(() => {
    setPanelWidth(
      typeof window === 'undefined' ? PANEL_WIDTH : Math.min(PANEL_WIDTH, Math.max(240, window.innerWidth - 16)),
    );
    showMonthOf(value || today);
    setFocusIso(preferredFocus());
    setOpen(true);
  }, [showMonthOf, value, today, preferredFocus]);

  const closeMenu = useCallback((refocus: boolean) => {
    setOpen(false);
    setGridActive(false);
    if (refocus) inputRef.current?.focus();
  }, []);

  // Roving focus: move the real DOM focus only once the keyboard has entered
  // the grid — opening by click must leave focus in the input so the operator
  // can keep typing. DOM only; no state is set here.
  useLayoutEffect(() => {
    if (!open || !gridActive) return;
    dayRefs.current[focusIso]?.focus();
  }, [open, gridActive, focusIso, view.year, view.month]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: Event) => {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      if (wrapRef.current?.contains(t)) return;
      if (typeof t.closest === 'function' && t.closest('[data-popover-panel]')) return;
      closeMenu(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('mousedown', onDown, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('mousedown', onDown, true);
    };
  }, [open, closeMenu]);

  const commit = useCallback(
    (raw: string) => {
      const trimmed = raw.trim();
      if (trimmed === '') {
        setInvalid(null);
        setDraft(null);
        onChange('');
        return;
      }
      const parsed = parse(trimmed);
      if (parsed === null) {
        setInvalid('unreadable');
        setDraft(raw);
        return;
      }
      if (floor && parsed < floor) {
        // A real date, just out of range — name the range, don't say "invalid".
        setInvalid('too-early');
        setDraft(raw);
        return;
      }
      setInvalid(null);
      setDraft(null);
      onChange(parsed);
    },
    [onChange, parse, floor],
  );

  const pick = useCallback(
    (iso: string) => {
      setInvalid(null);
      setDraft(null);
      onChange(iso);
      closeMenu(true);
    },
    [onChange, closeMenu],
  );

  /** Navigation never lands on a disabled day: `min` only ever blocks a
   *  contiguous past range, so clamping forward to the floor IS the skip. */
  const moveFocus = (next: string) => {
    const iso = floor && next < floor ? floor : next;
    setFocusIso(iso);
    showMonthOf(iso);
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      // Same rule as TimeField: only swallow Escape when the popover is up.
      // The wizard closes itself from a bubble-phase `window` listener.
      if (!open) return;
      e.preventDefault();
      e.stopPropagation();
      setInvalid(null);
      setDraft(null);
      closeMenu(false);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const target = typedPreview && !isDisabled(typedPreview) ? typedPreview : preferredFocus();
      if (!open) openMenu();
      setFocusIso(target);
      showMonthOf(target);
      setGridActive(true);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      commit(display);
      closeMenu(false);
    }
  };

  const handleGridKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const { key } = e;
    if (key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeMenu(true);
      return;
    }
    if (key === 'Enter' || key === ' ' || key === 'Spacebar') {
      e.preventDefault();
      if (!isDisabled(focusIso)) pick(focusIso);
      return;
    }
    const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (key in step) {
      e.preventDefault();
      moveFocus(addDays(focusIso, step[key]));
      return;
    }
    if (key === 'Home' || key === 'End') {
      e.preventDefault();
      const weekStart = startOfWeek(focusIso);
      moveFocus(key === 'Home' ? weekStart : addDays(weekStart, 6));
      return;
    }
    if (key === 'PageUp' || key === 'PageDown') {
      e.preventDefault();
      const dir = key === 'PageUp' ? -1 : 1;
      moveFocus(addMonths(focusIso, e.shiftKey ? dir * 12 : dir));
    }
  };

  const handleInputBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    const next = e.relatedTarget as HTMLElement | null;
    // Moving INTO our own popover is not leaving the field.
    if (next && (wrapRef.current?.contains(next) || next.closest?.('[data-popover-panel]'))) return;
    closeMenu(false);
    commit(display);
  };

  /** Every control in the panel keeps focus in the input on press. */
  const keepFocus = (e: React.MouseEvent) => e.preventDefault();
  const todayDisabled = isDisabled(today);

  return (
    <div ref={wrapRef} className={className}>
      <div
        ref={shellRef}
        className={`relative flex items-center rounded-lg border bg-white outline-none focus-within:ring-2 ${a.ring} ${
          invalid ? 'border-red-400' : 'border-slate-200'
        }`}
      >
        <input
          ref={inputRef}
          id={id}
          type="text"
          aria-label={ariaLabel}
          aria-invalid={invalid ? true : undefined}
          aria-describedby={invalid ? hintId : undefined}
          inputMode="text"
          autoComplete="off"
          spellCheck={false}
          value={display}
          placeholder={placeholder ?? ariaLabel}
          onChange={(e) => {
            const next = e.target.value;
            setDraft(next);
            setInvalid(null);
            // The calendar follows the typing — this is the event that causes
            // the month to move, so it moves here rather than in an effect.
            if (open) {
              const parsed = parse(next);
              if (parsed) showMonthOf(parsed);
            }
          }}
          onClick={() => {
            if (!open) openMenu();
          }}
          onKeyDown={handleInputKeyDown}
          onBlur={handleInputBlur}
          className="flex-1 min-w-0 min-h-[44px] px-3 py-2 bg-transparent text-sm text-slate-700 outline-none rounded-lg"
        />
        {value && (
          <button
            type="button"
            tabIndex={-1}
            aria-label="Clear date"
            onMouseDown={keepFocus}
            onClick={() => {
              commit('');
              closeMenu(false);
              inputRef.current?.focus();
            }}
            className="flex items-center px-1 text-slate-400 hover:text-slate-600"
          >
            <X className="w-3.5 h-3.5" aria-hidden />
          </button>
        )}
        <button
          type="button"
          tabIndex={-1}
          data-popover-trigger
          aria-haspopup="dialog"
          aria-label="Choose date"
          onMouseDown={keepFocus}
          onClick={() => {
            if (open) closeMenu(false);
            else openMenu();
            inputRef.current?.focus();
          }}
          className="flex items-center px-2.5 text-slate-400 hover:text-slate-600"
        >
          <CalendarDays className="w-4 h-4" aria-hidden />
        </button>
      </div>

      {invalid && (
        <p id={hintId} className="mt-1 text-[11px] font-semibold text-red-600 leading-tight">
          {invalid === 'too-early' ? `Pick ${formatDateDisplay(floor)} or later` : 'Try 10/12/2026 or Oct 12'}
        </p>
      )}

      <AnchoredMenu
        anchorRef={shellRef}
        open={open}
        align="left"
        width={panelWidth}
        ariaLabel={`Choose ${ariaLabel}`}
      >
        {/*
          `tabIndex={-1}` instead of a mousedown handler: a press on the
          panel's dead space then lands on THIS element, so the input's blur
          guard sees a relatedTarget inside `[data-popover-panel]` and leaves
          the popover open. Every actual control below stops its own press.
        */}
        <div
          role="dialog"
          aria-label={`Choose ${ariaLabel}`}
          tabIndex={-1}
          className="px-3.5 py-3 outline-none"
        >
          <div className="flex items-center justify-between mb-2">
            <button
              type="button"
              tabIndex={-1}
              aria-label="Previous month"
              onMouseDown={keepFocus}
              onClick={() => setView((v) => stepView(v, -1))}
              className="w-10 h-10 flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
            >
              <ChevronLeft className="w-4 h-4" aria-hidden />
            </button>
            <div aria-live="polite" className="text-sm font-bold text-slate-800">
              {monthLabel}
            </div>
            <button
              type="button"
              tabIndex={-1}
              aria-label="Next month"
              onMouseDown={keepFocus}
              onClick={() => setView((v) => stepView(v, 1))}
              className="w-10 h-10 flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
            >
              <ChevronRight className="w-4 h-4" aria-hidden />
            </button>
          </div>

          <div className="flex">
            {WEEKDAYS.map((d, i) => (
              <div
                key={`${d.name}-${i}`}
                className="w-11 text-center text-[10px] font-bold text-slate-400 uppercase tracking-wider"
              >
                <abbr title={d.name} className="no-underline">
                  {d.letter}
                </abbr>
              </div>
            ))}
          </div>

          {/* One key handler for 42 cells: every day shares one roving-focus
              rule. `tabIndex={-1}` keeps the grid itself out of the tab order
              — the cell carrying tabIndex 0 is the way in. */}
          <div
            role="grid"
            aria-label={`Choose ${ariaLabel}`}
            tabIndex={-1}
            className="outline-none"
            onKeyDown={handleGridKeyDown}
            onBlur={(e) => {
              // Tabbing clean out of the calendar closes it. This lives on the
              // grid, not the dialog wrapper, because the grid is where the
              // keyboard actually is — and because a listener on a
              // non-interactive role is an a11y-ratchet finding.
              const next = e.relatedTarget as HTMLElement | null;
              if (!next) return;
              if (wrapRef.current?.contains(next)) return;
              if (next.closest?.('[data-popover-panel]')) return;
              closeMenu(false);
            }}
          >
            {[0, 1, 2, 3, 4, 5].map((row) => (
              <div key={row} role="row" className="flex">
                {cells.slice(row * 7, row * 7 + 7).map((cell) => {
                  const selected = !!value && cell.iso === value;
                  const disabled = isDisabled(cell.iso);
                  const isToday = cell.iso === today;
                  const preview = !selected && !!typedPreview && cell.iso === typedPreview;
                  return (
                    <button
                      key={cell.iso}
                      type="button"
                      role="gridcell"
                      ref={(el) => {
                        dayRefs.current[cell.iso] = el;
                      }}
                      tabIndex={cell.iso === tabStopIso ? 0 : -1}
                      disabled={disabled}
                      aria-selected={selected}
                      aria-current={isToday ? 'date' : undefined}
                      aria-label={formatDateDisplay(cell.iso)}
                      onMouseDown={keepFocus}
                      onClick={() => pick(cell.iso)}
                      className={[
                        'w-11 h-10 flex items-center justify-center text-sm rounded-lg transition-colors',
                        selected ? `${a.selected} font-bold` : '',
                        !selected && disabled ? 'text-slate-300 cursor-not-allowed' : '',
                        !selected && !disabled && cell.inMonth ? `text-slate-700 ${a.hover}` : '',
                        !selected && !disabled && !cell.inMonth ? `text-slate-400 ${a.hover}` : '',
                        !selected && isToday ? `ring-1 ${a.today}` : '',
                        preview ? 'ring-2 ring-slate-400' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    >
                      {cell.day}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-100">
            <button
              type="button"
              tabIndex={-1}
              disabled={todayDisabled}
              onMouseDown={keepFocus}
              onClick={() => pick(today)}
              className={`min-h-[36px] px-2 text-xs font-semibold rounded-lg ${
                todayDisabled ? 'text-slate-300 cursor-not-allowed' : a.text
              }`}
            >
              Today
            </button>
            {value && (
              <button
                type="button"
                tabIndex={-1}
                onMouseDown={keepFocus}
                onClick={() => {
                  commit('');
                  closeMenu(true);
                }}
                className="min-h-[36px] px-2 text-xs font-semibold rounded-lg text-slate-500 hover:text-slate-800"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      </AnchoredMenu>
    </div>
  );
}

/** Month step for the header arrows — moves the VIEW, not the focused day. */
function stepView(v: { year: number; month: number }, delta: number) {
  const d = new Date(v.year, v.month + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() };
}
