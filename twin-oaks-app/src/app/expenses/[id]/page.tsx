import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import {
  DIVISION_LABELS,
  TAX_STATUS_LABELS,
  type Division,
  type TaxStatus,
} from "@/lib/domain";
import {
  Card,
  Chip,
  PageHeader,
  btnPrimaryCls,
  btnSecondaryCls,
  divisionTone,
} from "@/components/ui";
import { ReceiptThumb } from "../../receipts/receipt-bits";
import { taxStatusTone } from "../expense-bits";
import { deleteExpense } from "../actions";

export const dynamic = "force-dynamic";

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-stone-100 py-2 last:border-b-0">
      <span className="text-sm text-stone-500">{label}</span>
      <span className="text-right text-sm font-medium text-stone-900">{value ?? "—"}</span>
    </div>
  );
}

export default async function ExpenseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const expense = await prisma.expense.findUnique({
    where: { id },
    include: { receipts: true, asset: true },
  });
  if (!expense) notFound();

  return (
    <div>
      <PageHeader
        title={formatCents(expense.amountCents)}
        sub={`${expense.description} · ${formatDate(expense.date)}`}
        action={
          <Link href={`/expenses/${expense.id}/edit`} className={btnSecondaryCls}>
            Edit
          </Link>
        }
      />

      <div className="mb-4 flex flex-wrap gap-1.5">
        <Chip tone={divisionTone(expense.division)}>
          {DIVISION_LABELS[expense.division as Division] ?? expense.division}
        </Chip>
        <Chip>{expense.accountingCategory}</Chip>
        <Chip tone={taxStatusTone(expense.taxStatus)}>
          {TAX_STATUS_LABELS[expense.taxStatus as TaxStatus] ?? expense.taxStatus}
        </Chip>
        {expense.isCapital ? <Chip tone="blue">Capital purchase</Chip> : null}
      </div>

      <Card className="mb-4">
        <h2 className="mb-1 font-semibold text-stone-900">Details</h2>
        <Row label="Vendor" value={expense.vendorName} />
        <Row label="Sales tax" value={expense.salesTaxCents != null ? formatCents(expense.salesTaxCents) : "—"} />
        <Row label="Payment method" value={expense.paymentMethod} />
        <Row label="Management category" value={expense.managementCategory} />
        <Row label="Business purpose" value={expense.businessPurpose} />
        <Row
          label="Connected asset"
          value={
            expense.asset ? (
              <Link href={`/assets/${expense.asset.id}`} className="text-oak-700 underline">
                {expense.asset.name}
              </Link>
            ) : (
              "—"
            )
          }
        />
        <Row label="Tax year" value={String(expense.taxYear)} />
        <Row label="Notes" value={expense.notes} />
      </Card>

      <Card className="mb-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-semibold text-stone-900">
            Receipts {expense.receipts.length > 0 ? `(${expense.receipts.length})` : ""}
          </h2>
          <Link href={`/receipts/new`} className="text-sm font-medium text-oak-700">
            Add receipt
          </Link>
        </div>
        {expense.receipts.length === 0 ? (
          <p className="text-sm text-red-600">
            No receipt attached — this will be flagged in the Tax Center.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {expense.receipts.map((r) => (
              <Link key={r.id} href={`/receipts/${r.id}`}>
                <ReceiptThumb filePath={r.filePath} mimeType={r.mimeType} size="h-20 w-20" />
              </Link>
            ))}
          </div>
        )}
      </Card>

      <form
        action={deleteExpense}
        className="text-center"
      >
        <input type="hidden" name="id" value={expense.id} />
        <button
          type="submit"
          className="text-sm font-medium text-red-600 underline-offset-2 active:underline"
        >
          Delete expense (linked receipts are kept and flagged for review)
        </button>
      </form>
    </div>
  );
}
