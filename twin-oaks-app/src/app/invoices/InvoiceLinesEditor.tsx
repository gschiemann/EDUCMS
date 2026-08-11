"use client";

import { useState } from "react";
import { inputCls, labelCls } from "@/components/ui";

type Row = { key: number; description: string; quantity: string; price: string };

function rowTotal(r: Row): number {
  const qty = Number(r.quantity) || 0;
  const price = Number(r.price.replace(/[$,\s]/g, "")) || 0;
  return qty * price;
}

export default function InvoiceLinesEditor({
  initialLines,
}: {
  initialLines?: { description: string; quantity: number; unitPriceCents: number }[];
}) {
  const [rows, setRows] = useState<Row[]>(() =>
    initialLines && initialLines.length > 0
      ? initialLines.map((l, i) => ({
          key: i,
          description: l.description,
          quantity: String(l.quantity),
          price: (l.unitPriceCents / 100).toFixed(2),
        }))
      : [{ key: 0, description: "", quantity: "1", price: "" }],
  );
  const [nextKey, setNextKey] = useState(rows.length);

  const subtotal = rows.reduce((s, r) => s + rowTotal(r), 0);

  const update = (key: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  return (
    <div>
      <span className={labelCls}>Line items *</span>
      <div className="space-y-3">
        {rows.map((r) => (
          <div key={r.key} className="rounded-xl border border-stone-200 bg-stone-50 p-3">
            <input
              name={`line-desc-${r.key}`}
              value={r.description}
              onChange={(e) => update(r.key, { description: e.target.value })}
              placeholder="20 custom brackets, PETG"
              className={`${inputCls} mb-2`}
            />
            <div className="flex items-end gap-2">
              <div className="w-20">
                <label className="mb-1 block text-xs text-stone-500">Qty</label>
                <input
                  name={`line-qty-${r.key}`}
                  value={r.quantity}
                  onChange={(e) => update(r.key, { quantity: e.target.value })}
                  inputMode="decimal"
                  className={inputCls}
                />
              </div>
              <div className="flex-1">
                <label className="mb-1 block text-xs text-stone-500">Unit price</label>
                <input
                  name={`line-price-${r.key}`}
                  value={r.price}
                  onChange={(e) => update(r.key, { price: e.target.value })}
                  inputMode="decimal"
                  placeholder="$0.00"
                  className={inputCls}
                />
              </div>
              <div className="flex-1 pb-2.5 text-right text-sm font-semibold tabular-nums text-stone-700">
                {rowTotal(r).toLocaleString("en-US", { style: "currency", currency: "USD" })}
              </div>
              {rows.length > 1 ? (
                <button
                  type="button"
                  onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
                  className="pb-2 text-sm font-medium text-red-500"
                  aria-label="Remove line"
                >
                  ✕
                </button>
              ) : null}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between">
        <button
          type="button"
          onClick={() => {
            setRows((rs) => [...rs, { key: nextKey, description: "", quantity: "1", price: "" }]);
            setNextKey((k) => k + 1);
          }}
          className="text-sm font-semibold text-oak-700"
        >
          + Add line
        </button>
        <span className="text-sm text-stone-500">
          Subtotal:{" "}
          <span className="font-semibold tabular-nums text-stone-900">
            {subtotal.toLocaleString("en-US", { style: "currency", currency: "USD" })}
          </span>
        </span>
      </div>
    </div>
  );
}
