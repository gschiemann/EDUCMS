import { prisma } from "@/lib/db";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import InvoiceForm from "../InvoiceForm";
import { createInvoice } from "../actions";

export const dynamic = "force-dynamic";

export default async function NewInvoicePage({
  searchParams,
}: {
  searchParams: Promise<{ customerId?: string }>;
}) {
  const { customerId } = await searchParams;
  const customers = await prisma.customer.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, company: true },
  });

  if (customers.length === 0) {
    return (
      <div>
        <PageHeader title="New invoice" />
        <EmptyState
          title="Add a customer first."
          hint="Invoices are addressed to a customer — create one and you'll come right back here."
          actionHref="/customers/new?returnTo=invoice"
          actionLabel="Add customer"
        />
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="New invoice" sub="Saved as a draft — you review it before it counts." />
      <Card>
        <InvoiceForm
          action={createInvoice}
          submitLabel="Save draft"
          customers={customers}
          defaults={{ customerId }}
        />
      </Card>
    </div>
  );
}
