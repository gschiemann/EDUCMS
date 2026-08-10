import {
  ASSET_KINDS,
  ASSET_STATUSES,
  DIVISIONS,
  DIVISION_LABELS,
  type Division,
} from "@/lib/domain";
import { toDateInputValue } from "@/lib/dates";
import { btnPrimaryCls, inputCls, labelCls } from "@/components/ui";

type Defaults = {
  id?: string;
  name?: string | null;
  assetTag?: string | null;
  kind?: string | null;
  division?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  serialNumber?: string | null;
  year?: number | null;
  purchaseDate?: Date | null;
  purchasePriceCents?: number | null;
  purchasedFrom?: string | null;
  financingNotes?: string | null;
  warrantyNotes?: string | null;
  currentHours?: number | null;
  currentMileage?: number | null;
  status?: string | null;
  notes?: string | null;
};

export default function AssetForm({
  action,
  submitLabel,
  defaults = {},
}: {
  action: (formData: FormData) => Promise<void>;
  submitLabel: string;
  defaults?: Defaults;
}) {
  return (
    <form action={action} className="space-y-4">
      {defaults.id ? <input type="hidden" name="id" value={defaults.id} /> : null}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls} htmlFor="name">
            Name *
          </label>
          <input
            id="name"
            name="name"
            required
            defaultValue={defaults.name ?? ""}
            placeholder="Tractor #1"
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="assetTag">
            Asset ID / tag
          </label>
          <input
            id="assetTag"
            name="assetTag"
            defaultValue={defaults.assetTag ?? ""}
            placeholder="TO-EQ-001"
            className={inputCls}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls} htmlFor="kind">
            Type *
          </label>
          <select id="kind" name="kind" required defaultValue={defaults.kind ?? ""} className={inputCls}>
            <option value="" disabled>
              Choose…
            </option>
            {ASSET_KINDS.map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls} htmlFor="status">
            Status
          </label>
          <select
            id="status"
            name="status"
            defaultValue={defaults.status ?? "ACTIVE"}
            className={inputCls}
          >
            {ASSET_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.charAt(0) + s.slice(1).toLowerCase()}
              </option>
            ))}
          </select>
        </div>
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

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls} htmlFor="manufacturer">
            Manufacturer
          </label>
          <input
            id="manufacturer"
            name="manufacturer"
            defaultValue={defaults.manufacturer ?? ""}
            placeholder="Kubota"
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="model">
            Model
          </label>
          <input
            id="model"
            name="model"
            defaultValue={defaults.model ?? ""}
            placeholder="L3902"
            className={inputCls}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls} htmlFor="serialNumber">
            Serial number
          </label>
          <input
            id="serialNumber"
            name="serialNumber"
            defaultValue={defaults.serialNumber ?? ""}
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="year">
            Year
          </label>
          <input
            id="year"
            name="year"
            inputMode="numeric"
            defaultValue={defaults.year ?? ""}
            placeholder="2024"
            className={inputCls}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls} htmlFor="purchaseDate">
            Purchase date
          </label>
          <input
            id="purchaseDate"
            name="purchaseDate"
            type="date"
            defaultValue={defaults.purchaseDate ? toDateInputValue(defaults.purchaseDate) : ""}
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="purchasePrice">
            Purchase price
          </label>
          <input
            id="purchasePrice"
            name="purchasePrice"
            inputMode="decimal"
            placeholder="$0.00"
            defaultValue={
              defaults.purchasePriceCents != null
                ? (defaults.purchasePriceCents / 100).toFixed(2)
                : ""
            }
            className={inputCls}
          />
        </div>
      </div>

      <div>
        <label className={labelCls} htmlFor="purchasedFrom">
          Purchased from
        </label>
        <input
          id="purchasedFrom"
          name="purchasedFrom"
          defaultValue={defaults.purchasedFrom ?? ""}
          className={inputCls}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls} htmlFor="currentHours">
            Current hours
          </label>
          <input
            id="currentHours"
            name="currentHours"
            inputMode="decimal"
            defaultValue={defaults.currentHours ?? ""}
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="currentMileage">
            Current mileage
          </label>
          <input
            id="currentMileage"
            name="currentMileage"
            inputMode="decimal"
            defaultValue={defaults.currentMileage ?? ""}
            className={inputCls}
          />
        </div>
      </div>

      <div>
        <label className={labelCls} htmlFor="financingNotes">
          Financing
        </label>
        <input
          id="financingNotes"
          name="financingNotes"
          defaultValue={defaults.financingNotes ?? ""}
          placeholder="0% for 60 months through dealer"
          className={inputCls}
        />
      </div>

      <div>
        <label className={labelCls} htmlFor="warrantyNotes">
          Warranty
        </label>
        <input
          id="warrantyNotes"
          name="warrantyNotes"
          defaultValue={defaults.warrantyNotes ?? ""}
          placeholder="2-year full, 6-year powertrain"
          className={inputCls}
        />
      </div>

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
