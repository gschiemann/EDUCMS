import Link from "next/link";
import { DIVISIONS, DIVISION_LABELS, type Division } from "@/lib/domain";
import { toDateInputValue } from "@/lib/dates";
import { btnPrimaryCls, inputCls, labelCls } from "@/components/ui";
import InvoiceLinesEditor from "./InvoiceLinesEditor";

type Defaults = {
  id?: string;
  customerId?: string | null;
  division?: string | null;
  issueDate?: Date;
  dueDate?: Date | null;
  terms?: string | null;
  notes?: string | null;
  salesTaxCents?: number | null;
  lines?: { description: string; quantity: number; unitPriceCents: number }[];
};

export default function InvoiceForm({
  action,
  submitLabel,
  customers,
  defaults = {},
}: {
  action: (formData: FormData) => Promise<void>;
  submitLabel: string;
  customers: { id: string; name: string; company: string | null }[];
  defaults?: Defaults;
}) {
  return (
    <form action={action} className="space-y-4">
      {defaults.id ? <input type="hidden" name="id" value={defaults.id} /> : null}

      <div>
        <label className={labelCls} htmlFor="customerId">
          Customer *
        </label>
        <select
          id="customerId"
          name="customerId"
          required
          defaultValue={defaults.customerId ?? ""}
          className={inputCls}
        >
          <option value="" disabled>
            Choose…
          </option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {c.company ? ` — ${c.company}` : ""}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-stone-500">
          Someone new?{" "}
          <Link href="/customers/new?returnTo=invoice" className="font-medium text-oak-700 underline">
            Add a customer
          </Link>{" "}
          first.
        </p>
      </div>

      <div>
        <span className={labelCls}>Division *</span>
        <div className="grid grid-cols-3 gap-2">
          {DIVISIONS.map((d) => (
            <label
              key={d}
              className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-sm font-medium text-stone-700 has-checked:border-oak-600 has-checked:bg-oak-50 has-checked:text-oak-800"
            >
              <input
                type="radio"
                name="division"
                value={d}
                defaultChecked={(defaults.division ?? "TECH") === d}
                className="accent-oak-700"
              />
              {DIVISION_LABELS[d as Division]}
            </label>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls} htmlFor="issueDate">
            Invoice date *
          </label>
          <input
            id="issueDate"
            name="issueDate"
            type="date"
            required
            defaultValue={toDateInputValue(defaults.issueDate ?? new Date())}
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="dueDate">
            Due date
          </label>
          <input
            id="dueDate"
            name="dueDate"
            type="date"
            defaultValue={defaults.dueDate ? toDateInputValue(defaults.dueDate) : ""}
            className={inputCls}
          />
        </div>
      </div>

      <InvoiceLinesEditor initialLines={defaults.lines} />

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls} htmlFor="salesTax">
            Sales tax
          </label>
          <input
            id="salesTax"
            name="salesTax"
            inputMode="decimal"
            placeholder="$0.00"
            defaultValue={
              defaults.salesTaxCents != null && defaults.salesTaxCents !== 0
                ? (defaults.salesTaxCents / 100).toFixed(2)
                : ""
            }
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="terms">
            Payment terms
          </label>
          <input
            id="terms"
            name="terms"
            placeholder="Due in 14 days"
            defaultValue={defaults.terms ?? ""}
            className={inputCls}
          />
        </div>
      </div>

      <div>
        <label className={labelCls} htmlFor="notes">
          Notes (shown on the invoice)
        </label>
        <textarea
          id="notes"
          name="notes"
          rows={2}
          defaultValue={defaults.notes ?? ""}
          className={inputCls}
        />
      </div>

      <button type="submit" className={`${btnPrimaryCls} w-full`}>
        {submitLabel}
      </button>
    </form>
  );
}
