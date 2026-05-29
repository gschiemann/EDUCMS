'use client';

/**
 * BulkPriceBar — per-item bulk actions under the item name in the
 * price-book grid: "set price across all locations" + "86 everywhere".
 * ──────────────────────────────────────────────────────────────────
 *
 * The 50-location killer feature: instead of editing 50 cells, the
 * operator sets one price that lands on every location (or a scoped
 * region) in a single call. One click → type the price → done.
 *
 * Reveals on row hover (and stays keyboard-reachable via focus-within)
 * so the grid isn't cluttered with controls on every row at rest.
 *
 * Dashboard-only → no Chromium-83 constraints.
 */

import { Layers, EyeOff, Eye } from 'lucide-react';
import { appPrompt } from '@/components/ui/app-dialog';
import { dollarsToCents } from '@/lib/menu/menu-console-api';

export function BulkPriceBar({
  itemName,
  scopeLabel,
  allVisible,
  onBulkPrice,
  onBulk86,
}: {
  itemName: string;
  /** When set, bulk actions target only this location/region. */
  scopeLabel?: string;
  /** Whether the item is visible at (any of) the scoped locations. */
  allVisible: boolean;
  onBulkPrice: (cents: number | null) => void;
  onBulk86: (available: boolean) => void;
}) {
  const scopeText = scopeLabel ? scopeLabel : 'all locations';

  const promptPrice = async () => {
    const v = await appPrompt({
      title: `Set price across ${scopeText}`,
      message: `Enter the new price for “${itemName}”. This overrides ${scopeText}.`,
      placeholder: 'e.g. 4.99',
      confirmLabel: 'Apply to all',
    });
    if (v === null) return;
    const cents = dollarsToCents(v);
    if (cents === null) return;
    onBulkPrice(cents);
  };

  return (
    <div className="mt-1.5 flex items-center gap-2 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
      <button
        type="button"
        onClick={promptPrice}
        title={`Set one price across ${scopeText}`}
        className="inline-flex items-center gap-1 rounded-md bg-orange-50 hover:bg-orange-100 text-orange-700 px-2 py-1 text-[10px] font-bold uppercase tracking-wide transition-colors"
      >
        <Layers className="w-3 h-3" /> Set all
      </button>
      <button
        type="button"
        onClick={() => onBulk86(!allVisible)}
        title={allVisible ? `86 across ${scopeText}` : `Restore across ${scopeText}`}
        className={[
          'inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-wide transition-colors',
          allVisible
            ? 'bg-slate-50 hover:bg-rose-50 text-slate-500 hover:text-rose-600'
            : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700',
        ].join(' ')}
      >
        {allVisible ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
        {allVisible ? '86 all' : 'Restore all'}
      </button>
    </div>
  );
}
