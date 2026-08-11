import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { Card, PageHeader } from "@/components/ui";
import CustomerForm from "../../CustomerForm";
import { updateCustomer } from "../../actions";

export const dynamic = "force-dynamic";

export default async function EditCustomerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const customer = await prisma.customer.findUnique({ where: { id } });
  if (!customer) notFound();

  return (
    <div>
      <PageHeader title="Edit customer" sub={customer.name} />
      <Card>
        <CustomerForm action={updateCustomer} submitLabel="Save changes" defaults={customer} />
      </Card>
    </div>
  );
}
