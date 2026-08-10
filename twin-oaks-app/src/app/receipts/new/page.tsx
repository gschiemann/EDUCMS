import { PAYMENT_METHODS } from "@/lib/domain";
import { toDateInputValue } from "@/lib/dates";
import { Card, PageHeader, btnPrimaryCls, inputCls, labelCls } from "@/components/ui";
import { createReceipt } from "../actions";

export const dynamic = "force-dynamic";

export default function NewReceiptPage() {
  return (
    <div>
      <PageHeader
        title="Add receipt"
        sub="Only the photo is required — save to the Inbox and categorize when you have time."
      />
      <Card>
        <form action={createReceipt} className="space-y-4">
          <div>
            <label className={labelCls} htmlFor="file">
              Receipt photo or PDF
            </label>
            <input
              id="file"
              name="file"
              type="file"
              accept="image/*,application/pdf"
              capture="environment"
              className="w-full rounded-xl border border-dashed border-stone-300 bg-stone-50 px-3 py-6 text-sm text-stone-600 file:mr-3 file:rounded-lg file:border-0 file:bg-oak-700 file:px-4 file:py-2 file:font-semibold file:text-white"
            />
            <p className="mt-1 text-xs text-stone-500">
              On iPhone/iPad this opens the camera. You can also add the file later.
            </p>
          </div>

          <details className="rounded-xl border border-stone-200 bg-stone-50 p-3">
            <summary className="cursor-pointer text-sm font-medium text-stone-700">
              Add details now (optional)
            </summary>
            <div className="mt-3 space-y-3">
              <div>
                <label className={labelCls} htmlFor="vendorName">
                  Vendor
                </label>
                <input id="vendorName" name="vendorName" className={inputCls} placeholder="Tractor Supply Co" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls} htmlFor="receiptDate">
                    Date
                  </label>
                  <input
                    id="receiptDate"
                    name="receiptDate"
                    type="date"
                    defaultValue={toDateInputValue(new Date())}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls} htmlFor="total">
                    Total
                  </label>
                  <input id="total" name="total" inputMode="decimal" placeholder="$0.00" className={inputCls} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls} htmlFor="salesTax">
                    Sales tax
                  </label>
                  <input id="salesTax" name="salesTax" inputMode="decimal" placeholder="$0.00" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls} htmlFor="paymentMethod">
                    Payment method
                  </label>
                  <select id="paymentMethod" name="paymentMethod" className={inputCls} defaultValue="">
                    <option value="">—</option>
                    {PAYMENT_METHODS.map((m) => (
                      <option key={m}>{m}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className={labelCls} htmlFor="receiptNumber">
                  Receipt #
                </label>
                <input id="receiptNumber" name="receiptNumber" className={inputCls} />
              </div>
              <div>
                <label className={labelCls} htmlFor="notes">
                  Notes
                </label>
                <textarea id="notes" name="notes" rows={2} className={inputCls} />
              </div>
            </div>
          </details>

          <button type="submit" className={`${btnPrimaryCls} w-full`}>
            Save to Inbox
          </button>
        </form>
      </Card>
    </div>
  );
}
