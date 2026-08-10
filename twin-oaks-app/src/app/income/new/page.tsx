import { Card, PageHeader } from "@/components/ui";
import IncomeForm from "../IncomeForm";
import { createIncome } from "../actions";

export const dynamic = "force-dynamic";

export default function NewIncomePage() {
  return (
    <div>
      <PageHeader title="Add income" sub="Record money coming in — sales, jobs, services." />
      <Card>
        <IncomeForm action={createIncome} submitLabel="Save income" />
      </Card>
    </div>
  );
}
