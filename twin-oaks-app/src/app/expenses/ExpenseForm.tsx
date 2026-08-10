import {
  ACCOUNTING_CATEGORIES,
  DIVISIONS,
  DIVISION_LABELS,
  MANAGEMENT_CATEGORY_SUGGESTIONS,
  PAYMENT_METHODS,
  TAX_STATUSES,
  TAX_STATUS_LABELS,
  type Division,
} from "@/lib/domain";
import { toDateInputValue } from "@/lib/dates";
import { btnPrimaryCls, inputCls, labelCls } from "@/components/ui";

type Defaults = {
  id?: string;
  date?: Date;
  vendorName?: string | null;
  description?: string | null;
  amountCents?: number | null;
  salesTaxCents?: number | null;
  paymentMethod?: string | null;
  division?: string | null;
  accountingCategory?: string | null;
  managementCategory?: string | null;
  businessPurpose?: string | null;
  assetId?: string | null;
  taxStatus?: string | null;
  isCapital?: boolean;
  notes?: string | null;
};

export default function ExpenseForm({
  action,
  submitLabel,
  defaults = {},
  vendors,
  assets,
  fromReceiptId,
}: {
  action: (formData: FormData) => Promise<void>;
  submitLabel: string;
  defaults?: Defaults;
  vendors: string[];
  assets: { id: string; name: string }[];
  fromReceiptId?: string;
}) {
  const cents = (v: number | null | undefined) => (v != null ? (v / 100).toFixed(2) : "");

  return (
    <form action={action} className="space-y-4">
      {defaults.id ? <input type="hidden" name="id" value={defaults.id} /> : null}
      {fromReceiptId ? <input type="hidden" name="fromReceiptId" value={fromReceiptId} /> : null}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls} htmlFor="date">
            Date *
          </label>
          <input
            id="date"
            name="date"
            type="date"
            required
            defaultValue={toDateInputValue(defaults.date ?? new Date())}
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="amount">
            Amount *
          </label>
          <input
            id="amount"
            name="amount"
            inputMode="decimal"
            required
            placeholder="$0.00"
            defaultValue={cents(defaults.amountCents)}
            className={inputCls}
          />
        </div>
      </div>

      <div>
        <label className={labelCls} htmlFor="vendorName">
          Vendor
        </label>
        <input
          id="vendorName"
          name="vendorName"
          list="vendor-list"
          defaultValue={defaults.vendorName ?? ""}
          placeholder="Tractor Supply Co"
          className={inputCls}
        />
        <datalist id="vendor-list">
          {vendors.map((v) => (
            <option key={v} value={v} />
          ))}
        </datalist>
      </div>

      <div>
        <label className={labelCls} htmlFor="description">
          Description *
        </label>
        <input
          id="description"
          name="description"
          required
          defaultValue={defaults.description ?? ""}
          placeholder="Hydraulic hose for Tractor #1"
          className={inputCls}
        />
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
                defaultChecked={(defaults.division ?? "FARM") === d}
                className="accent-oak-700"
              />
              {DIVISION_LABELS[d as Division]}
            </label>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className={labelCls} htmlFor="accountingCategory">
            Accounting category *
          </label>
          <select
            id="accountingCategory"
            name="accountingCategory"
            required
            defaultValue={defaults.accountingCategory ?? ""}
            className={inputCls}
          >
            <option value="" disabled>
              Choose…
            </option>
            {ACCOUNTING_CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <p className="mt-1 text-xs text-stone-500">For bookkeeping & tax prep.</p>
        </div>
        <div>
          <label className={labelCls} htmlFor="managementCategory">
            Management category
          </label>
          <input
            id="managementCategory"
            name="managementCategory"
            list="mgmt-list"
            defaultValue={defaults.managementCategory ?? ""}
            placeholder="Farm Equipment > Tractor #1 > Hydraulic system"
            className={inputCls}
          />
          <datalist id="mgmt-list">
            {MANAGEMENT_CATEGORY_SUGGESTIONS.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
          <p className="mt-1 text-xs text-stone-500">Where the money really went (drill-down).</p>
        </div>
      </div>

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
            defaultValue={cents(defaults.salesTaxCents)}
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="paymentMethod">
            Payment method
          </label>
          <select
            id="paymentMethod"
            name="paymentMethod"
            defaultValue={defaults.paymentMethod ?? ""}
            className={inputCls}
          >
            <option value="">—</option>
            {PAYMENT_METHODS.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className={labelCls} htmlFor="assetId">
          Connected equipment / asset
        </label>
        <select id="assetId" name="assetId" defaultValue={defaults.assetId ?? ""} className={inputCls}>
          <option value="">None</option>
          {assets.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className={labelCls} htmlFor="businessPurpose">
          Business purpose
        </label>
        <input
          id="businessPurpose"
          name="businessPurpose"
          defaultValue={defaults.businessPurpose ?? ""}
          placeholder="Why this was a business purchase"
          className={inputCls}
        />
      </div>

      <div>
        <label className={labelCls} htmlFor="taxStatus">
          Tax status
        </label>
        <select
          id="taxStatus"
          name="taxStatus"
          defaultValue={defaults.taxStatus ?? "NEEDS_REVIEW"}
          className={inputCls}
        >
          {TAX_STATUSES.map((s) => (
            <option key={s} value={s}>
              {TAX_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-stone-500">
          The app never decides deductibility — uncertain items stay flagged for your accountant.
        </p>
      </div>

      <label className="flex items-start gap-2.5 rounded-xl border border-stone-200 bg-stone-50 p-3 text-sm text-stone-700">
        <input
          type="checkbox"
          name="isCapital"
          defaultChecked={defaults.isCapital ?? false}
          className="mt-0.5 accent-oak-700"
        />
        <span>
          <span className="font-medium">Capital purchase</span> — major equipment/property that may
          be depreciable or §179-eligible (final treatment reviewed by the accountant).
        </span>
      </label>

      <div>
        <label className={labelCls} htmlFor="notes">
          Notes
        </label>
        <textarea id="notes" name="notes" rows={2} defaultValue={defaults.notes ?? ""} className={inputCls} />
      </div>

      <button type="submit" className={`${btnPrimaryCls} w-full`}>
        {submitLabel}
      </button>
    </form>
  );
}
