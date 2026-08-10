import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { toDateInputValue } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import {
  PAYMENT_METHODS,
  RECEIPT_STATUSES,
  RECEIPT_STATUS_LABELS,
  type ReceiptStatus,
} from "@/lib/domain";
import { Card, PageHeader, btnPrimaryCls, btnSecondaryCls, inputCls, labelCls } from "@/components/ui";
import { attachReceiptFile, updateReceipt } from "../actions";

export const dynamic = "force-dynamic";

export default async function ReceiptDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const receipt = await prisma.receipt.findUnique({
    where: { id },
    include: { expense: true },
  });
  if (!receipt) notFound();

  const isImage = receipt.mimeType?.startsWith("image/");

  return (
    <div>
      <PageHeader
        title={receipt.vendorName ?? "Receipt"}
        sub={`Status: ${RECEIPT_STATUS_LABELS[receipt.status as ReceiptStatus] ?? receipt.status}`}
      />

      {receipt.filePath ? (
        <a
          href={`/api/files/${receipt.filePath}`}
          target="_blank"
          rel="noreferrer"
          className="mb-4 block"
        >
          {isImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/files/${receipt.filePath}`}
              alt="Receipt original"
              className="max-h-96 w-full rounded-2xl border border-stone-200 bg-white object-contain"
            />
          ) : (
            <Card className="text-center text-sm font-medium text-stone-600">
              📄 {receipt.fileName ?? "Document"} — tap to open
            </Card>
          )}
        </a>
      ) : (
        <Card className="mb-4">
          <p className="mb-2 text-sm font-medium text-stone-700">
            No file attached yet — add the photo or emailed PDF:
          </p>
          <form action={attachReceiptFile} className="flex items-center gap-2">
            <input type="hidden" name="id" value={receipt.id} />
            <input
              name="file"
              type="file"
              accept="image/*,application/pdf"
              capture="environment"
              className="min-w-0 flex-1 text-sm text-stone-600 file:mr-2 file:rounded-lg file:border-0 file:bg-oak-700 file:px-3 file:py-1.5 file:font-semibold file:text-white"
            />
            <button type="submit" className={btnSecondaryCls}>
              Attach
            </button>
          </form>
        </Card>
      )}

      {receipt.expense ? (
        <Card className="mb-4 border-oak-200 bg-oak-50">
          <p className="text-sm text-oak-800">
            Categorized as expense:{" "}
            <Link href={`/expenses/${receipt.expense.id}`} className="font-semibold underline">
              {receipt.expense.description} · {formatCents(receipt.expense.amountCents)}
            </Link>
          </p>
        </Card>
      ) : (
        <Link
          href={`/expenses/new?fromReceipt=${receipt.id}`}
          className={`${btnPrimaryCls} mb-4 w-full`}
        >
          Categorize → create expense
        </Link>
      )}

      <Card>
        <h2 className="mb-3 font-semibold text-stone-900">Receipt details</h2>
        <form action={updateReceipt} className="space-y-3">
          <input type="hidden" name="id" value={receipt.id} />
          <div>
            <label className={labelCls} htmlFor="vendorName">
              Vendor
            </label>
            <input
              id="vendorName"
              name="vendorName"
              defaultValue={receipt.vendorName ?? ""}
              className={inputCls}
            />
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
                defaultValue={receipt.receiptDate ? toDateInputValue(receipt.receiptDate) : ""}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls} htmlFor="total">
                Total
              </label>
              <input
                id="total"
                name="total"
                inputMode="decimal"
                defaultValue={receipt.totalCents != null ? (receipt.totalCents / 100).toFixed(2) : ""}
                className={inputCls}
              />
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
                defaultValue={
                  receipt.salesTaxCents != null ? (receipt.salesTaxCents / 100).toFixed(2) : ""
                }
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
                defaultValue={receipt.paymentMethod ?? ""}
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
            <label className={labelCls} htmlFor="receiptNumber">
              Receipt #
            </label>
            <input
              id="receiptNumber"
              name="receiptNumber"
              defaultValue={receipt.receiptNumber ?? ""}
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="status">
              Status
            </label>
            <select id="status" name="status" defaultValue={receipt.status} className={inputCls}>
              {RECEIPT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {RECEIPT_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls} htmlFor="notes">
              Notes
            </label>
            <textarea
              id="notes"
              name="notes"
              rows={2}
              defaultValue={receipt.notes ?? ""}
              className={inputCls}
            />
          </div>
          <button type="submit" className={`${btnPrimaryCls} w-full`}>
            Save details
          </button>
        </form>
      </Card>
    </div>
  );
}
