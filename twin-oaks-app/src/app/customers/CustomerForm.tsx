import { btnPrimaryCls, inputCls, labelCls } from "@/components/ui";

type Defaults = {
  id?: string;
  name?: string | null;
  company?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  notes?: string | null;
};

export default function CustomerForm({
  action,
  submitLabel,
  defaults = {},
  returnTo,
}: {
  action: (formData: FormData) => Promise<void>;
  submitLabel: string;
  defaults?: Defaults;
  returnTo?: string;
}) {
  return (
    <form action={action} className="space-y-4">
      {defaults.id ? <input type="hidden" name="id" value={defaults.id} /> : null}
      {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}

      <div>
        <label className={labelCls} htmlFor="name">
          Name *
        </label>
        <input
          id="name"
          name="name"
          required
          defaultValue={defaults.name ?? ""}
          placeholder="Jane Hartley"
          className={inputCls}
        />
      </div>

      <div>
        <label className={labelCls} htmlFor="company">
          Company
        </label>
        <input
          id="company"
          name="company"
          defaultValue={defaults.company ?? ""}
          placeholder="Acme Fabrication"
          className={inputCls}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls} htmlFor="phone">
            Phone
          </label>
          <input
            id="phone"
            name="phone"
            type="tel"
            defaultValue={defaults.phone ?? ""}
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="email">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            defaultValue={defaults.email ?? ""}
            className={inputCls}
          />
        </div>
      </div>

      <div>
        <label className={labelCls} htmlFor="address">
          Address
        </label>
        <textarea
          id="address"
          name="address"
          rows={2}
          defaultValue={defaults.address ?? ""}
          className={inputCls}
        />
      </div>

      <div>
        <label className={labelCls} htmlFor="notes">
          Notes
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
