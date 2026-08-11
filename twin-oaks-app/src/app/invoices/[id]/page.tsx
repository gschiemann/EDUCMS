import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { formatDate, toDateInputValue } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { DIVISION_LABELS, PAYMENT_METHODS, type Division } from "@/lib/domain";
import {
  Card,
  Chip,
  PageHeader,
  btnPrimaryCls,
  btnSecondaryCls,
  divisionTone,
  inputCls,
  labelCls,
} from "@/components/ui";
import {
  INVOICE_STATUS_LABELS,
  deriveInvoiceStatus,
  invoiceStatusTone,
  paidCentsOf,
} from "../invoice-bits";
import { deleteInvoice, deletePayment, recordPayment, setInvoiceStatus } from "../actions";

export const dynamic = "force-dynamic";

const ERROR_MESSAGES: Record<string, string> = {
  "not-draft": "Only draft invoices can be edited — once sent, an invoice is a financial record.",
  cancelled: "Payments can't be recorded on a cancelled invoice.",
  amount: "That payment needs a valid amount — nothing was recorded.",
};

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  if (value == null || value === "") return null;
  return (
    <div className="flex items-start justify-between gap-4 border-b border-stone-100 py-2 last:border-b-0">
      <span className="text-sm text-stone-500">{label}</span>
      <span className="text-right text-sm font-medium text-stone-900">{value}</span>
    </div>
  );
}

export default async function InvoiceDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: {
      customer: true,
      lines: { orderBy: { sortOrder: "asc" } },
      payments: { orderBy: { date: "desc" } },
    },
  });
  if (!invoice) notFound();

  const paidCents = paidCentsOf(invoice.payments);
  const status = deriveInvoiceStatus(invoice, paidCents);
  const balanceCents = invoice.totalCents - paidCents;

  return (
    <div>
      <PageHeader
        title={invoice.number}
        sub={`${invoice.customer.name} · ${formatDate(invoice.issueDate)}`}
        action={
          <Link href={`/invoices/${invoice.id}/print`} className={btnSecondaryCls}>
            Print / PDF
          </Link>
        }
      />

      {error && ERROR_MESSAGES[error] ? (
        <Card className="mb-4 border-amber-300 bg-amber-50 text-sm text-amber-900">
          {ERROR_MESSAGES[error]}
        </Card>
      ) : null}

      <div className="mb-4 flex flex-wrap gap-1.5">
        <Chip tone={invoiceStatusTone(status)}>{INVOICE_STATUS_LABELS[status]}</Chip>
        <Chip tone={divisionTone(invoice.division)}>
          {DIVISION_LABELS[invoice.division as Division] ?? invoice.division}
        </Chip>
      </div>

      <Card className="mb-4">
        <h2 className="mb-1 font-semibold text-stone-900">Details</h2>
        <Row
          label="Customer"
          value={
            <Link href={`/customers/${invoice.customerId}`} className="text-oak-700 underline">
              {invoice.customer.name}
              {invoice.customer.company ? ` — ${invoice.customer.company}` : ""}
            </Link>
          }
        />
        <Row label="Due date" value={invoice.dueDate ? formatDate(invoice.dueDate) : null} />
        <Row label="Terms" value={invoice.terms} />
        <Row label="Notes" value={invoice.notes} />
      </Card>

      <Card className="mb-4">
        <h2 className="mb-1 font-semibold text-stone-900">Lines</h2>
        <div className="divide-y divide-stone-100">
          {invoice.lines.map((line) => (
            <div key={line.id} className="flex items-start justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <div className="font-medium text-stone-900">{line.description}</div>
                <div className="text-sm text-stone-500">
                  {line.quantity} × {formatCents(line.unitPriceCents)}
                </div>
              </div>
              <span className="shrink-0 text-right font-semibold tabular-nums text-stone-900">
                {formatCents(line.totalCents)}
              </span>
            </div>
          ))}
        </div>
        <div className="mt-2 space-y-1 border-t border-stone-200 pt-3 text-sm">
          <div className="flex justify-between">
            <span className="text-stone-500">Subtotal</span>
            <span className="font-medium tabular-nums text-stone-900">
              {formatCents(invoice.subtotalCents)}
            </span>
          </div>
          {invoice.salesTaxCents > 0 ? (
            <div className="flex justify-between">
              <span className="text-stone-500">Sales tax</span>
              <span className="font-medium tabular-nums text-stone-900">
                {formatCents(invoice.salesTaxCents)}
              </span>
            </div>
          ) : null}
          <div className="flex justify-between text-base font-bold text-stone-900">
            <span>Total</span>
            <span className="tabular-nums">{formatCents(invoice.totalCents)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-stone-500">Paid</span>
            <span className="font-medium tabular-nums text-oak-700">{formatCents(paidCents)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-stone-500">Balance due</span>
            <span
              className={`font-semibold tabular-nums ${
                balanceCents > 0 ? "text-red-700" : "text-stone-900"
              }`}
            >
              {formatCents(balanceCents)}
            </span>
          </div>
        </div>
      </Card>

      <Card className="mb-4">
        <h2 className="mb-2 font-semibold text-stone-900">
          Payments {invoice.payments.length > 0 ? `(${invoice.payments.length})` : ""}
        </h2>
        {invoice.payments.length === 0 ? (
          <p className="text-sm text-stone-500">No payments recorded yet.</p>
        ) : (
          <div className="divide-y divide-stone-100">
            {invoice.payments.map((p) => (
              <div key={p.id} className="flex items-start justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <div className="font-medium tabular-nums text-stone-900">
                    {formatCents(p.amountCents)}
                  </div>
                  <div className="text-sm text-stone-500">
                    {formatDate(p.date)}
                    {p.method ? ` · ${p.method}` : ""}
                    {p.checkNumber ? ` · check #${p.checkNumber}` : ""}
                  </div>
                </div>
                <form action={deletePayment} className="shrink-0">
                  <input type="hidden" name="id" value={p.id} />
                  <input type="hidden" name="invoiceId" value={invoice.id} />
                  <button type="submit" className="text-xs text-red-500">
                    remove
                  </button>
                </form>
              </div>
            ))}
          </div>
        )}

        {invoice.status !== "CANCELLED" ? (
          <details className="mt-3 rounded-xl border border-stone-200 bg-stone-50 p-3">
            <summary className="cursor-pointer text-sm font-medium text-stone-700">
              Record payment
            </summary>
            <form action={recordPayment} className="mt-3 space-y-3">
              <input type="hidden" name="invoiceId" value={invoice.id} />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls} htmlFor="p-date">
                    Date *
                  </label>
                  <input
                    id="p-date"
                    name="date"
                    type="date"
                    required
                    defaultValue={toDateInputValue(new Date())}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls} htmlFor="p-amount">
                    Amount *
                  </label>
                  <input
                    id="p-amount"
                    name="amount"
                    inputMode="decimal"
                    required
                    placeholder="$0.00"
                    defaultValue={balanceCents > 0 ? (balanceCents / 100).toFixed(2) : ""}
                    className={inputCls}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls} htmlFor="p-method">
                    Method
                  </label>
                  <select id="p-method" name="method" defaultValue="" className={inputCls}>
                    <option value="">—</option>
                    {PAYMENT_METHODS.map((m) => (
                      <option key={m}>{m}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelCls} htmlFor="p-check">
                    Check #
                  </label>
                  <input id="p-check" name="checkNumber" className={inputCls} />
                </div>
              </div>
              <div>
                <label className={labelCls} htmlFor="p-notes">
                  Notes
                </label>
                <input id="p-notes" name="notes" className={inputCls} />
              </div>
              <button type="submit" className={`${btnPrimaryCls} w-full`}>
                Record payment
              </button>
              <p className="text-xs text-stone-500">
                Payments post to your Income books automatically.
              </p>
            </form>
          </details>
        ) : null}
      </Card>

      {invoice.status === "DRAFT" ? (
        <>
          <div className="mb-4 grid grid-cols-2 gap-2">
            <Link href={`/invoices/${invoice.id}/edit`} className={btnSecondaryCls}>
              Edit draft
            </Link>
            <form action={setInvoiceStatus}>
              <input type="hidden" name="id" value={invoice.id} />
              <input type="hidden" name="to" value="SENT" />
              <button type="submit" className={`${btnPrimaryCls} w-full`}>
                Mark as sent
              </button>
            </form>
          </div>
          {invoice.payments.length === 0 ? (
            <form action={deleteInvoice} className="text-center">
              <input type="hidden" name="id" value={invoice.id} />
              <button
                type="submit"
                className="text-sm font-medium text-red-600 underline-offset-2 active:underline"
              >
                Delete draft
              </button>
            </form>
          ) : null}
        </>
      ) : null}

      {invoice.status === "SENT" && invoice.payments.length === 0 ? (
        <div className="flex items-center justify-center gap-6">
          <form action={setInvoiceStatus}>
            <input type="hidden" name="id" value={invoice.id} />
            <input type="hidden" name="to" value="DRAFT" />
            <button
              type="submit"
              className="text-sm font-medium text-stone-600 underline-offset-2 active:underline"
            >
              Back to draft
            </button>
          </form>
          <form action={setInvoiceStatus}>
            <input type="hidden" name="id" value={invoice.id} />
            <input type="hidden" name="to" value="CANCELLED" />
            <button
              type="submit"
              className="text-sm font-medium text-red-600 underline-offset-2 active:underline"
            >
              Cancel invoice
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
