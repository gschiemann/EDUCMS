import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import PrintButton from "@/components/PrintButton";
import { deriveInvoiceStatus, paidCentsOf } from "../../invoice-bits";

export const dynamic = "force-dynamic";

export default async function InvoicePrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: {
      customer: true,
      lines: { orderBy: { sortOrder: "asc" } },
      payments: true,
    },
  });
  if (!invoice) notFound();

  const paid = paidCentsOf(invoice.payments);
  const status = deriveInvoiceStatus(invoice, paid);
  const balance = Math.max(0, invoice.totalCents - paid);
  const hasPayments = invoice.payments.length > 0;
  const { customer } = invoice;

  return (
    <div>
      <div className="mb-4 flex flex-col gap-2 print:hidden sm:flex-row sm:items-center">
        <PrintButton />
        <p className="text-sm text-stone-500">
          On iPhone: tap Print, then share the preview to save a PDF.
        </p>
      </div>

      <div className="rounded-2xl border border-stone-200 bg-white p-6 print:rounded-none print:border-0 print:p-0">
        {/* Header */}
        <div className="flex items-start justify-between gap-6">
          <div>
            <div className="text-xl font-bold tracking-tight text-stone-900">
              Twin Oaks Farm &amp; Tech LLC
            </div>
            <div className="text-sm text-stone-500">Twin Oaks OS</div>
          </div>
          <div className="shrink-0 text-right">
            <div className="text-xs font-semibold uppercase tracking-widest text-stone-500">
              INVOICE
            </div>
            <div className="text-lg font-bold text-stone-900">{invoice.number}</div>
            <div className="mt-1 text-sm text-stone-600">Issued {formatDate(invoice.issueDate)}</div>
            {invoice.dueDate ? (
              <div className="text-sm text-stone-600">Due {formatDate(invoice.dueDate)}</div>
            ) : null}
          </div>
        </div>

        {/* Bill to */}
        <div className="mt-8">
          <div className="text-xs font-semibold uppercase tracking-wide text-stone-500">
            Bill to
          </div>
          <div className="mt-1 font-bold text-stone-900">{customer.name}</div>
          {customer.company ? (
            <div className="text-sm text-stone-700">{customer.company}</div>
          ) : null}
          {customer.address ? (
            <div className="whitespace-pre-line text-sm text-stone-700">{customer.address}</div>
          ) : null}
          {customer.email || customer.phone ? (
            <div className="mt-1 text-sm text-stone-500">
              {[customer.email, customer.phone].filter(Boolean).join(" · ")}
            </div>
          ) : null}
        </div>

        {/* Line items */}
        <table className="mt-8 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b-2 border-stone-300">
              <th className="py-2 pr-3 text-left text-xs font-semibold uppercase tracking-wide text-stone-500">
                Description
              </th>
              <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-stone-500">
                Qty
              </th>
              <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-stone-500">
                Unit
              </th>
              <th className="py-2 pl-3 text-right text-xs font-semibold uppercase tracking-wide text-stone-500">
                Amount
              </th>
            </tr>
          </thead>
          <tbody>
            {invoice.lines.map((line) => (
              <tr key={line.id} className="border-b border-stone-200">
                <td className="py-2.5 pr-3 text-stone-900">{line.description}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-stone-700">
                  {line.quantity}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-stone-700">
                  {formatCents(line.unitPriceCents)}
                </td>
                <td className="py-2.5 pl-3 text-right font-medium tabular-nums text-stone-900">
                  {formatCents(line.totalCents)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Totals */}
        <div className="mt-4 flex justify-end">
          <div className="w-full max-w-xs space-y-1 text-sm">
            <div className="flex justify-between text-stone-700">
              <span>Subtotal</span>
              <span className="tabular-nums">{formatCents(invoice.subtotalCents)}</span>
            </div>
            {invoice.salesTaxCents > 0 ? (
              <div className="flex justify-between text-stone-700">
                <span>Sales tax</span>
                <span className="tabular-nums">{formatCents(invoice.salesTaxCents)}</span>
              </div>
            ) : null}
            <div className="flex justify-between border-t border-stone-300 pt-1.5 text-base font-bold text-stone-900">
              <span>Total</span>
              <span className="tabular-nums">{formatCents(invoice.totalCents)}</span>
            </div>
            {hasPayments ? (
              <div className="flex justify-between text-stone-700">
                <span>Paid</span>
                <span className="tabular-nums">{formatCents(paid)}</span>
              </div>
            ) : null}
            {status === "PAID" ? (
              <div className="pt-1 text-right font-medium text-oak-700">PAID — thank you!</div>
            ) : hasPayments ? (
              <div className="flex justify-between font-bold text-stone-900">
                <span>Balance due</span>
                <span className="tabular-nums">{formatCents(balance)}</span>
              </div>
            ) : null}
          </div>
        </div>

        {/* Terms + notes */}
        {invoice.terms ? (
          <div className="mt-8">
            <div className="text-xs font-semibold uppercase tracking-wide text-stone-500">
              Terms
            </div>
            <p className="mt-1 whitespace-pre-line text-sm text-stone-500">{invoice.terms}</p>
          </div>
        ) : null}
        {invoice.notes ? (
          <div className={invoice.terms ? "mt-4" : "mt-8"}>
            <div className="text-xs font-semibold uppercase tracking-wide text-stone-500">
              Notes
            </div>
            <p className="mt-1 whitespace-pre-line text-sm text-stone-500">{invoice.notes}</p>
          </div>
        ) : null}

        {/* Footer */}
        <div className="mt-10 border-t border-stone-200 pt-4 text-center text-xs text-stone-400">
          Twin Oaks Farm &amp; Tech LLC
        </div>
      </div>
    </div>
  );
}
