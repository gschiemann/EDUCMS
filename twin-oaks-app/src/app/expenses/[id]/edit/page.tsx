import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { Card, PageHeader } from "@/components/ui";
import ExpenseForm from "../../ExpenseForm";
import { updateExpense } from "../../actions";

export const dynamic = "force-dynamic";

export default async function EditExpensePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [expense, vendors, assets] = await Promise.all([
    prisma.expense.findUnique({ where: { id } }),
    prisma.vendor.findMany({ orderBy: { name: "asc" }, select: { name: true } }),
    prisma.asset.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  if (!expense) notFound();

  return (
    <div>
      <PageHeader title="Edit expense" sub={expense.description} />
      <Card>
        <ExpenseForm
          action={updateExpense}
          submitLabel="Save changes"
          vendors={vendors.map((v) => v.name)}
          assets={assets}
          defaults={expense}
        />
      </Card>
    </div>
  );
}
