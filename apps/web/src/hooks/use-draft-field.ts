'use client';

/**
 * useDraftField — a typed field that commits on blur / Enter and CANCELS on
 * Escape (K12-F15 follow-up, 2026-09-27).
 *
 * THE BUG. The Run view's typed fields (game text, per-team text / numbers,
 * ride time, game counters, results cells) handled Escape as
 * `setEditing(false); input.blur()` — and the blur's commit handler ran with
 * the render's closure, where `editing` was still true, so the typed value
 * was SAVED. Escape wrote the very change the operator was trying to throw
 * away. The discard has to travel in a ref, because the blur that Escape
 * causes runs before React applies any state update.
 *
 * Contract:
 *   - focus → the draft starts from the live value (`current()`);
 *   - Enter → blur → commit the draft;
 *   - Escape → blur → the draft is dropped and the live value shows again;
 *   - blur (tap elsewhere) → commit the draft.
 * `onCommit` receives the raw draft text; callers skip a write when nothing
 * changed (every sports write is a command with an audit row).
 */
import { useRef, useState, type KeyboardEvent } from 'react';

export interface DraftField {
  /** The text being typed, or null while the field is not being edited. */
  draft: string | null;
  onFocus: () => void;
  onChange: (text: string) => void;
  onBlur: () => void;
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
}

export function useDraftField(current: () => string, onCommit: (text: string) => void): DraftField {
  const [draft, setDraft] = useState<string | null>(null);
  const discard = useRef(false);
  return {
    draft,
    onFocus: () => {
      discard.current = false;
      setDraft(current());
    },
    onChange: (text: string) => setDraft(text),
    onBlur: () => {
      const text = draft;
      setDraft(null);
      if (discard.current) {
        discard.current = false;
        return;
      }
      if (text !== null) onCommit(text);
    },
    onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') e.currentTarget.blur();
      if (e.key === 'Escape') {
        discard.current = true;
        e.currentTarget.blur();
      }
    },
  };
}
