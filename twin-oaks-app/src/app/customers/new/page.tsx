import { Card, PageHeader } from "@/components/ui";
import CustomerForm from "../CustomerForm";
import { createCustomer } from "../actions";

export const dynamic = "force-dynamic";

export default async function NewCustomerPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const { returnTo } = await searchParams;
  return (
    <div>
      <PageHeader title="Add customer" />
      <Card>
        <CustomerForm action={createCustomer} submitLabel="Save customer" returnTo={returnTo} />
      </Card>
    </div>
  );
}
