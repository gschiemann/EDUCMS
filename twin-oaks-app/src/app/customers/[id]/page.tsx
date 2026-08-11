import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { Card, Chip, PageHeader, StatCard, btnPrimaryCls, btnSecondaryCls } from "@/components/ui";
import {
  INVOICE_STATUS_LABELS,
  deriveInvoiceStatus,
  invoiceStatusTone,
  paidCentsOf,
} from "../../invoices/invoice-bits";
import { deleteCustomer } from "../actions";

export const dynamic = "force-dynamic";

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  if (!value) return null;
  return (
    <div className="flex items-start justify-between gap-4 border-b border-stone-100 py-2 last:border-b-0">
      <span className="text-sm text-stone-500">{label}</span>
      <span className="text-right text-sm font-medium text-stone-900">{value}</span>
    </div>
  );
}

export default async function CustomerDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  const customer = await prisma.customer.findUnique({
    where: { id },
    include: {
      invoices: {
        orderBy: { issueDate: "desc" },
        include: { payments: { select: { amountCents: true } } },
      },
    },
  });
  if (!customer) notFound();

  const active = customer.invoices.filter((i) => i.status !== "CANCELLED");
  const revenue = active.reduce((s, i) => s + paidCentsOf(i.payments), 0);
  const outstanding = active.reduce((s, i) => {
    const st = deriveInvoiceStatus(i, paidCentsOf(i.payments));
    return st === "DRAFT" || st === "CANCELLED"
      ? s
      : s + Math.max(0, i.totalCents - paidCentsOf(i.payments));
  }, 0);

  return (
    <div>
      <PageHeader
        title={customer.name}
        sub={customer.company ?? undefined}
        action={
          <Link href={`/customers/${customer.id}/edit`} className={btnSecondaryCls}>
            Edit
          </Link>
        }
      />

      {error === "has-invoices" ? (
        <Card className="mb-4 border-amber-300 bg-amber-50 text-sm text-amber-900">
          This customer has invoices, so they can&apos;t be deleted — financial history stays.
        </Card>
      ) : null}

      <div className="mb-4 grid grid-cols-2 gap-2">
        <StatCard label="Revenue collected" value={formatCents(revenue)} tone="green" />
        <StatCard
          label="Outstanding"
          value={formatCents(outstanding)}
          tone={outstanding > 0 ? "red" : "stone"}
        />
      </div>

      <Card className="mb-4">
        <h2 className="mb-1 font-semibold text-stone-900">Contact</h2>
        <Row label="Phone" value={customer.phone} />
        <Row
          label="Email"
          value={customer.email ? <a className="text-oak-700 underline" href={`mailto:${customer.email}`}>{customer.email}</a> : null}
        />
        <Row label="Address" value={customer.address} />
        <Row label="Notes" value={customer.notes} />
        {!customer.phone && !customer.email && !customer.address && !customer.notes ? (
          <p className="text-sm text-stone-500">No contact details yet — tap Edit to add.</p>
        ) : null}
      </Card>

      <Card>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-semibold text-stone-900">
            Invoices ({customer.invoices.length})
          </h2>
          <Link href={`/invoices/new?customerId=${customer.id}`} className={btnPrimaryCls}>
            New invoice
          </Link>
        </div>
        {customer.invoices.length === 0 ? (
          <p className="text-sm text-stone-500">Nothing invoiced yet.</p>
        ) : (
          <div className="divide-y divide-stone-100">
            {customer.invoices.map((i) => {
              const st = deriveInvoiceStatus(i, paidCentsOf(i.payments));
              return (
                <Link
                  key={i.id}
                  href={`/invoices/${i.id}`}
                  className="flex items-center justify-between gap-3 py-2.5"
                >
                  <span className="min-w-0">
                    <span className="block font-medium text-stone-900">{i.number}</span>
                    <span className="text-sm text-stone-500">{formatDate(i.issueDate)}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <Chip tone={invoiceStatusTone(st)}>{INVOICE_STATUS_LABELS[st]}</Chip>
                    <span className="font-semibold tabular-nums">{formatCents(i.totalCents)}</span>
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </Card>

      {customer.invoices.length === 0 ? (
        <form action={deleteCustomer} className="mt-4 text-center">
          <input type="hidden" name="id" value={customer.id} />
          <button type="submit" className="text-sm font-medium text-red-600 underline-offset-2 active:underline">
            Delete customer
          </button>
        </form>
      ) : null}
    </div>
  );
}
