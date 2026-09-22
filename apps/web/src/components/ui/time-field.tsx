'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown, Clock } from 'lucide-react';
import { AnchoredMenu } from './anchored-menu';
import { FIELD_ACCENT, type FieldAccent } from './field-accent';
import { formatTimeDisplay, nearestOptionIndex, parseTypedTime, timeOptions } from '@/lib/date-time-entry';

/**
 * A time field the operator can TYPE or PICK.
 *
 * 2026-09-21 (operator, desktop Safari): "i think we should have time picker
 * menu but also be able to type it in". Safari's native `<input type=time>`
 * has no menu at all — it is a bare stepper — so there was nothing to pick
 * from. This is a plain text input plus a quarter-hour listbox; the value it
 * reports is unchanged (`''` or 24-hour `HH:MM`), so every host keeps working.
 *
 * Typing never filters the list. The list is a shortcut, not a constraint —
 * `8:05` is a perfectly good time and must survive Enter, which is why the
 * commit path runs `parseTypedTime`, not "snap to the nearest option".
 */

const OPTIONS = timeOptions(15);
/** Where the list opens when there is nothing to anchor on — start of a school day. */
const DEFAULT_ANCHOR = '08:00';

export interface TimeFieldProps {
  id: string;
  /** `''` or 24-hour `HH:MM`. */
  value: string;
  onChange: (next: string) => void;
  ariaLabel: string;
  accent?: FieldAccent;
  /** Applied to the field's outer box — the hosts pass their flex sizing here. */
  className?: string;
  /**
   * Read-only, exactly as the native input's `disabled` was: no typing, no
   * menu, no clearing. Several hosts of this field gate on a capability
   * (`canManage`, `RESTRICTED_VIEWER`, "pick a date first"), so dropping it
   * on the swap would have handed those operators an editable control.
   */
  disabled?: boolean;
}

export function TimeField({
  id,
  value,
  onChange,
  ariaLabel,
  accent = 'indigo',
  className = '',
  disabled = false,
}: TimeFieldProps) {
  const a = FIELD_ACCENT[accent];
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  /**
   * `null` means "show the committed value". Only unsent keystrokes live in
   * state, so a value the HOST changes (loading a schedule, a quick pick) is
   * displayed with no syncing effect to get out of step — and re-committing
   * the same time still re-normalizes what is on screen, because the draft
   * clears either way.
   */
  const [draft, setDraft] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [invalid, setInvalid] = useState(false);
  const [panelWidth, setPanelWidth] = useState(180);

  const display = draft ?? formatTimeDisplay(value);
  const listboxId = `${id}-listbox`;
  const hintId = `${id}-hint`;

  /** The option the list should open on: what is typed, else the value, else 8am. */
  const startIndex = useCallback(() => {
    const anchor = parseTypedTime(display) ?? (value || DEFAULT_ANCHOR);
    const i = nearestOptionIndex(anchor, OPTIONS);
    return i < 0 ? nearestOptionIndex(DEFAULT_ANCHOR, OPTIONS) : i;
  }, [display, value]);

  /**
   * Centre an option in the scroll box. Manual math, not scrollIntoView —
   * scrollIntoView would also scroll the DIALOG this field sits in.
   *
   * This runs while AnchoredMenu's panel is still in its `visibility: hidden`
   * measuring paint, and that is fine: a visibility-hidden box still has
   * layout, so offsetTop/clientHeight are real and scrollTop sticks. (Focus is
   * the thing visibility-hidden blocks — see AnchoredMenu's `onPlaced`, which
   * DateField needs for exactly that reason.) No rAF, no timer.
   */
  const centerOption = useCallback((index: number) => {
    const list = listRef.current;
    const el = list?.children[index] as HTMLElement | undefined;
    if (!list || !el) return;
    list.scrollTop = el.offsetTop - list.clientHeight / 2 + el.offsetHeight / 2;
  }, []);

  const commit = useCallback(
    (raw: string) => {
      const trimmed = raw.trim();
      if (trimmed === '') {
        // Clearing must still produce '' — the native input did.
        setInvalid(false);
        setDraft(null);
        onChange('');
        return;
      }
      const parsed = parseTypedTime(trimmed);
      if (parsed === null) {
        // Keep the draft on screen so they can fix it; never report a value we
        // could not read.
        setInvalid(true);
        setDraft(raw);
        return;
      }
      setInvalid(false);
      setDraft(null);
      onChange(parsed);
    },
    [onChange],
  );

  const openMenu = useCallback(() => {
    if (disabled) return;
    const box = shellRef.current?.getBoundingClientRect();
    setPanelWidth(Math.max(180, Math.round(box?.width ?? 0)));
    setOpen(true);
  }, [disabled]);

  // On open, park the scroll on the current value so the operator sees where
  // they are instead of midnight. DOM only — no state is set here.
  useLayoutEffect(() => {
    if (!open) return;
    centerOption(startIndex());
    // startIndex is intentionally read once, at open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Any pointer press outside the field AND outside the portaled panel closes.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: Event) => {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      if (wrapRef.current?.contains(t)) return;
      if (typeof t.closest === 'function' && t.closest('[data-popover-panel]')) return;
      setOpen(false);
      setActiveIndex(-1);
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('mousedown', onDown, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('mousedown', onDown, true);
    };
  }, [open]);

  const moveActive = (delta: number) => {
    const from = activeIndex < 0 ? startIndex() : activeIndex + delta;
    const next = Math.min(OPTIONS.length - 1, Math.max(0, from));
    setActiveIndex(next);
    centerOption(next);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      // Only swallow Escape when it has a job here. The wizard closes itself
      // from a `window` keydown listener in the BUBBLE phase, so an unstopped
      // Escape would throw away the whole playlist draft just because a menu
      // was open.
      if (!open) return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      setActiveIndex(-1);
      setInvalid(false);
      setDraft(null);
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) {
        openMenu();
        setActiveIndex(startIndex());
        return;
      }
      moveActive(e.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      commit(open && activeIndex >= 0 ? OPTIONS[activeIndex] : display);
      setOpen(false);
      setActiveIndex(-1);
    }
  };

  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    const next = e.relatedTarget as HTMLElement | null;
    // Focus moving INTO our own popover is not leaving the field.
    if (next && (wrapRef.current?.contains(next) || next.closest?.('[data-popover-panel]'))) return;
    setOpen(false);
    setActiveIndex(-1);
    commit(display);
  };

  return (
    <div ref={wrapRef} className={className}>
      <div
        ref={shellRef}
        className={`relative flex items-center rounded-lg border outline-none focus-within:ring-2 ${a.ring} ${
          disabled ? 'bg-slate-50' : 'bg-white'
        } ${invalid ? 'border-red-400' : 'border-slate-200'}`}
      >
        <input
          ref={inputRef}
          id={id}
          type="text"
          role="combobox"
          disabled={disabled}
          aria-expanded={open}
          // Only while the listbox exists — a reference to a missing id is an
          // axe `aria-valid-attr-value` finding.
          aria-controls={open ? listboxId : undefined}
          aria-autocomplete="none"
          aria-activedescendant={open && activeIndex >= 0 ? `${id}-opt-${activeIndex}` : undefined}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? hintId : undefined}
          aria-label={ariaLabel}
          inputMode="text"
          autoComplete="off"
          spellCheck={false}
          value={display}
          placeholder="--:--"
          onChange={(e) => {
            const next = e.target.value;
            setDraft(next);
            setInvalid(false);
            // The list is a shortcut, never a filter: keep all 96 rows and
            // just slide the scroll to where the typing points.
            setActiveIndex(-1);
            const parsed = parseTypedTime(next);
            if (parsed && open) {
              const i = nearestOptionIndex(parsed, OPTIONS);
              if (i >= 0) centerOption(i);
            }
          }}
          onClick={() => {
            if (!open) openMenu();
          }}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          className="flex-1 min-w-0 min-h-[44px] px-3 py-2 bg-transparent text-sm text-slate-700 outline-none rounded-lg disabled:text-slate-400 disabled:cursor-not-allowed"
        />
        <button
          type="button"
          tabIndex={-1}
          disabled={disabled}
          data-popover-trigger
          aria-label="Show times"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            if (open) {
              setOpen(false);
              setActiveIndex(-1);
            } else {
              openMenu();
            }
            inputRef.current?.focus();
          }}
          className="flex items-center px-2 text-slate-400 hover:text-slate-600 disabled:cursor-not-allowed disabled:hover:text-slate-400"
        >
          <Clock className="w-3.5 h-3.5" aria-hidden />
          <ChevronDown className="w-3.5 h-3.5 -ml-0.5" aria-hidden />
        </button>
      </div>

      {invalid && (
        <p id={hintId} className="mt-1 text-[11px] font-semibold text-red-600 leading-tight">
          Try 8:30 AM or 14:00
        </p>
      )}

      <AnchoredMenu
        anchorRef={shellRef}
        open={open}
        align="left"
        width={panelWidth}
        ariaLabel={ariaLabel}
        className="p-1"
      >
        <div
          ref={listRef}
          id={listboxId}
          role="listbox"
          aria-label={ariaLabel}
          // Programmatically focusable only: the listbox is driven from the
          // input (aria-activedescendant), so it must never be a tab stop.
          tabIndex={-1}
          style={{ maxHeight: 280 }}
          className="overflow-y-auto"
          // Keep the press from blurring the input — the input must still own
          // focus after a pick so the operator can keep typing.
          onMouseDown={(e) => e.preventDefault()}
          onPointerDown={(e) => e.preventDefault()}
        >
          {OPTIONS.map((opt, i) => {
            const isValue = opt === value;
            const isActive = i === activeIndex;
            return (
              <button
                key={opt}
                type="button"
                id={`${id}-opt-${i}`}
                role="option"
                aria-selected={isValue}
                tabIndex={-1}
                onClick={() => {
                  commit(opt);
                  setOpen(false);
                  setActiveIndex(-1);
                }}
                className={`w-full flex items-center text-left px-3 min-h-[40px] text-sm rounded-md transition-colors ${
                  isValue ? a.selected : isActive ? 'bg-slate-100 text-slate-900' : `text-slate-700 ${a.hover}`
                }`}
              >
                {formatTimeDisplay(opt)}
              </button>
            );
          })}
        </div>
      </AnchoredMenu>
    </div>
  );
}
