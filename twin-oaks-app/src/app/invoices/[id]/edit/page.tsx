import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { Card, PageHeader } from "@/components/ui";
import InvoiceForm from "../../InvoiceForm";
import { updateInvoice } from "../../actions";

export const dynamic = "force-dynamic";

export default async function EditInvoicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: { lines: { orderBy: { sortOrder: "asc" } } },
  });
  if (!invoice) notFound();
  if (invoice.status !== "DRAFT") redirect(`/invoices/${invoice.id}`);

  const customers = await prisma.customer.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, company: true },
  });

  return (
    <div>
      <PageHeader title="Edit draft" sub={invoice.number} />
      <Card>
        <InvoiceForm
          action={updateInvoice}
          submitLabel="Save changes"
          customers={customers}
          defaults={{
            id: invoice.id,
            customerId: invoice.customerId,
            division: invoice.division,
            issueDate: invoice.issueDate,
            dueDate: invoice.dueDate,
            terms: invoice.terms,
            notes: invoice.notes,
            salesTaxCents: invoice.salesTaxCents,
            lines: invoice.lines.map((l) => ({
              description: l.description,
              quantity: l.quantity,
              unitPriceCents: l.unitPriceCents,
            })),
          }}
        />
      </Card>
    </div>
  );
}
