"use client";

/**
 * SelectionCheckbox — the ONE checkbox every list in the dashboard selects with.
 *
 * Greg, 2026-10-04: "select all should be the same across the entire app… it
 * looks best on the playlist columns so make the assets the same and find a good
 * solution for the tiled views as well… i dont want some random button like you
 * put that says select all". The Playlists table already had it right: a
 * tri-state box in the header's first column, a box on every row, and "Select all
 * N" only inside the bulk bar once something is checked. This file is that box,
 * lifted out of PlaylistLibraryV1 unchanged in look so every list can share it.
 *
 * THE PATTERN (every list that selects follows it — do not invent a variant):
 *
 *   TABLE   a SelectionCheckbox in the header's FIRST column, one per row, and
 *           nothing else. The header box is tri-state over the rows SHOWN.
 *   TILES   the same box at the START of the heading line above the tiles (same
 *           x as the table header's box, so switching list ⇄ tiles never moves
 *           it), and a SelectionTileCheckbox in each tile's top-left corner.
 *   BAR     "Select all N" lives inside the bulk bar, and only appears when N is
 *           more than what is selected. There is no stand-alone "Select all"
 *           button anywhere.
 *
 * Accessible names: the header box says what it covers — "Select all files
 * shown" / "Select all playlists shown" — and every item says "Select <name>".
 * A native <input type="checkbox"> carries the state (checked / mixed), so the
 * label never changes with it.
 *
 * Hit target: a <label> wraps the input and IS the target. 44 px on a touch
 * screen. The `compact` variant is 24 px (the WCAG 2.2 minimum) for places where
 * a table cell cannot afford more; on a touch screen it still grows to 44 px with
 * a negative margin, so it never changes the row's layout.
 *
 * Tooltip (Greg, 2026-10-04: "is a bare checkbox understood as select all?"): the
 * label carries a native `title` that says what a click will DO, so the box
 * explains itself without a visible button or label. A header / heading box passes
 * `selectAllTitle(...)` — "Select all files shown", turning into "Clear selection"
 * once everything it covers is selected; every other box defaults to its
 * accessible name ("Select Lobby Welcome"). The title sits on the <label>, not the
 * input, so the whole hit area has it and a screen reader — which reads the input's
 * aria-label — is not told the same sentence twice. (A native tooltip does not show
 * on a touch screen.)
 *
 * Dashboard surface, not player/widget: CSS `gap` and the like are fine. No
 * backdrop-blur (mobile performance standard).
 */

import { useEffect, useRef } from 'react';

export type SelectionState = 'none' | 'some' | 'all';

/** none / some / all, from how many of `total` rows are selected. */
export function selectionState(selected: number, total: number): SelectionState {
  if (total <= 0 || selected <= 0) return 'none';
  return selected >= total ? 'all' : 'some';
}

/**
 * The tooltip of a header / heading box: what a click will do. From none or
 * "some" it selects everything the box covers (`selectLabel`, the same sentence as
 * its accessible name); from "all" it clears (`clearLabel`). The accessible NAME
 * does not change with the state — the checkbox itself says checked / mixed — so
 * only the tooltip does.
 */
export function selectAllTitle(state: SelectionState, selectLabel: string, clearLabel: string): string {
  return state === 'all' ? clearLabel : selectLabel;
}

/**
 * A selected tile's look — ONE definition, used by every tiled list (Media
 * Library, Playlists grid, the "Add media" picker) so a selected asset and a
 * selected playlist read the same: an indigo border and a soft ring.
 *
 * It sets NO background on purpose. The Media tile used to carry
 * `bg-indigo-50/40` here, but its own `bg-white` always won the cascade, so the
 * wash never rendered; a class that does nothing is a trap for the next reader.
 * Leave the card's base `bg-white` alone and drop any competing border colour
 * from the selected branch (`border-[#E4E8F1]`, the amber attention border) —
 * two border colours on one element are decided by stylesheet order, not by you.
 */
export const SELECTED_TILE_CLASS = 'border-indigo-500 ring-2 ring-indigo-200';

export interface SelectionCheckboxProps {
  checked: boolean;
  /** Some — not all — of what this box covers is selected. Shown as the dash. */
  indeterminate?: boolean;
  /** The accessible name. Pass the full sentence ("Select all files shown", "Select Lobby Welcome"). */
  label: string;
  /**
   * The native tooltip — what a click will do. Defaults to the accessible name, so a
   * bare item box says "Select Lobby Welcome" on hover. A header / heading box passes
   * `selectAllTitle(...)`, which becomes "Clear selection" once all it covers is selected.
   */
  title?: string;
  /**
   * `next` is what the box would become: true from empty or from the dash,
   * false from checked. Callers that only toggle can ignore it.
   */
  onChange: (next: boolean) => void;
  disabled?: boolean;
  testId?: string;
  /** 24 px target (44 px on a touch screen) — for table cells where width is spoken for. */
  compact?: boolean;
}

export function SelectionCheckbox({
  checked, indeterminate, label, title, onChange, disabled, testId, compact,
}: SelectionCheckboxProps) {
  const ref = useRef<HTMLInputElement>(null);
  // `indeterminate` is a DOM property, not an attribute — React cannot set it.
  useEffect(() => { if (ref.current) ref.current.indeterminate = !!indeterminate && !checked; }, [indeterminate, checked]);
  return (
    <label
      title={title ?? label}
      className={`flex items-center justify-center shrink-0 cursor-pointer ${
        compact
          ? 'w-6 h-6 pointer-coarse:w-11 pointer-coarse:h-11 pointer-coarse:-m-2.5 pointer-coarse:relative pointer-coarse:z-[1]'
          // 44 px, trimmed to 36 only for a mouse on a wide window — exactly the
          // box the Playlists page has always had. A touch screen stays at 44.
          : 'w-11 h-11 md:pointer-fine:w-9 md:pointer-fine:h-9'
      }`}
    >
      <input
        ref={ref}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.currentTarget.checked)}
        aria-label={label}
        data-testid={testId}
        className="h-4 w-4 rounded border-slate-300 cursor-pointer"
        style={{ accentColor: 'var(--brand-primary, #3515E8)' }}
      />
    </label>
  );
}

/**
 * Only on a device that can HOVER do the boxes stay out of the way until the
 * pointer (or keyboard focus) is on the tile. A phone has no hover, so a box that
 * waited for one would make selecting impossible there — it is always drawn.
 * Needs the tile to carry Tailwind's `group` class.
 */
const REVEAL_ON_HOVER =
  'transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:opacity-100 [@media(hover:hover)]:focus-within:opacity-100';

/**
 * A tile's own box: a white chip in its top-left corner.
 *
 * Visible on hover and on keyboard focus; ALWAYS visible on a touch screen; and
 * visible on every tile while ANY tile is selected, so the next one is a single
 * tap away and the operator can see what is and is not in the selection.
 */
export function SelectionTileCheckbox({
  checked, anySelected, label, onChange, disabled, testId,
}: Pick<SelectionCheckboxProps, 'checked' | 'label' | 'onChange' | 'disabled' | 'testId'> & {
  /** Is anything in this list selected? */
  anySelected: boolean;
}) {
  return (
    <div
      className={`absolute top-1 left-1 z-20 rounded-lg bg-white/90 shadow-sm ${checked || anySelected ? '' : REVEAL_ON_HOVER}`}
      data-testid={testId ? `${testId}-chip` : undefined}
    >
      <SelectionCheckbox checked={checked} label={label} onChange={onChange} disabled={disabled} testId={testId} />
    </div>
  );
}
