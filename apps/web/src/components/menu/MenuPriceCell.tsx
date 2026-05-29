'use client';

/**
 * MenuPriceCell — one item × one location cell in the price-book grid.
 * ──────────────────────────────────────────────────────────────────
 *
 * The core 30-second interaction (CLAUDE.md §20): click the price →
 * type → tab/enter to save. No modal, no separate edit mode toggle.
 *
 *   • Inherited (no override): the central price renders GREYED. The
 *     operator can click it and type a new value → that creates an
 *     override (the cell turns orange + shows a revert ↺).
 *   • Overridden: orange-tinted, bold, with a one-click revert that
 *     restores the inherited price.
 *   • 86'd: the cell dims and shows an "86" badge; the eye toggle
 *     puts it back on the board.
 *
 * Dashboard-only → no Chromium-83 constraints.
 */

import { useEffect, useRef, useState } from 'react';
import { RotateCcw, EyeOff, Eye } from 'lucide-react';
import {
  type ResolvedCell,
  dollarsToCents,
  centsToDollars,
} from '@/lib/menu/menu-console-api';

export function MenuPriceCell({
  cell,
  centralPriceCents,
  onSetPrice,
  onRevert,
  onToggle86,
}: {
  cell: ResolvedCell;
  centralPriceCents: number;
  onSetPrice: (cents: number) => void;
  onRevert: () => void;
  onToggle86: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      // Seed with the current resolved price so the operator tweaks
      // rather than retypes; select-all so a fresh value overwrites.
      setDraft(centsToDollars(cell.priceCents));
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [editing, cell.priceCents]);

  const commit = () => {
    const cents = dollarsToCents(draft);
    setEditing(false);
    if (cents === null) return; // unparseable → cancel
    // No-op if unchanged from what's already shown.
    if (cents === cell.priceCents) return;
    onSetPrice(cents);
  };

  const cancel = () => setEditing(false);

  const overridden = cell.isPriceOverridden;
  const hidden = !cell.isVisible;

  return (
    <div className="inline-flex flex-col items-center gap-1">
      <div
        className={[
          'group/cell relative inline-flex items-center justify-center rounded-lg px-2.5 py-1.5 min-w-[92px] transition-colors',
          hidden
            ? 'bg-rose-50 ring-1 ring-rose-200'
            : overridden
              ? 'bg-orange-50 ring-1 ring-orange-300'
              : 'bg-slate-50 ring-1 ring-transparent hover:ring-slate-200',
        ].join(' ')}
      >
        {editing ? (
          <div className="flex items-center">
            <span className="text-slate-400 text-sm pr-0.5">$</span>
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); commit(); }
                else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
              }}
              inputMode="decimal"
              aria-label="Price for this location"
              className="w-16 bg-transparent text-sm font-bold tabular-nums text-slate-800 focus:outline-none"
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => !hidden && setEditing(true)}
            disabled={hidden}
            aria-label={
              hidden
                ? 'Item 86’d at this location'
                : overridden
                  ? `Override price (currently $${centsToDollars(cell.priceCents)}) — click to edit`
                  : `Inherited price $${centsToDollars(cell.priceCents)} — click to override`
            }
            className={[
              'text-sm font-bold tabular-nums transition-colors',
              hidden
                ? 'text-rose-400 line-through cursor-default'
                : overridden
                  ? 'text-orange-700 cursor-text'
                  : 'text-slate-400 hover:text-slate-700 cursor-text',
            ].join(' ')}
          >
            ${centsToDollars(cell.priceCents)}
          </button>
        )}

        {hidden && (
          <span className="absolute -top-1.5 -right-1.5 px-1 py-px rounded bg-rose-500 text-white text-[9px] font-black leading-none">
            86
          </span>
        )}
      </div>

      {/* Per-cell actions — only show what's relevant so the grid stays calm. */}
      {!editing && (
        <div className="flex items-center gap-1.5">
          {overridden && !hidden && (
            <button
              type="button"
              onClick={onRevert}
              title="Revert to central price"
              aria-label="Revert to central price"
              className="inline-flex items-center justify-center w-5 h-5 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
            >
              <RotateCcw className="w-3 h-3" />
            </button>
          )}
          <button
            type="button"
            onClick={onToggle86}
            title={hidden ? 'Put back on the board' : '86 (hide at this location)'}
            aria-label={hidden ? 'Put back on the board' : '86 — hide at this location'}
            className={[
              'inline-flex items-center justify-center w-5 h-5 rounded transition-colors',
              hidden
                ? 'text-emerald-500 hover:text-emerald-700 hover:bg-emerald-50'
                : 'text-slate-300 hover:text-rose-600 hover:bg-rose-50',
            ].join(' ')}
          >
            {hidden ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
          </button>
        </div>
      )}
    </div>
  );
}
