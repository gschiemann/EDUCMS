import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { DIVISION_LABELS, type Division } from "@/lib/domain";
import { Card, Chip, EmptyState, PageHeader, btnPrimaryCls, divisionTone } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function IncomePage() {
  const [incomes, total] = await Promise.all([
    prisma.income.findMany({ orderBy: { date: "desc" }, take: 200 }),
    prisma.income.aggregate({ _sum: { amountCents: true } }),
  ]);

  return (
    <div>
      <div className="mb-4 grid grid-cols-2 gap-2">
        <Link
          href="/expenses"
          className="rounded-xl border border-stone-300 bg-white px-4 py-2 text-center font-medium text-stone-600"
        >
          Expenses
        </Link>
        <span className="rounded-xl bg-oak-700 px-4 py-2 text-center font-semibold text-white">
          Income
        </span>
      </div>

      <PageHeader
        title="Income"
        sub={`${incomes.length} shown · ${formatCents(total._sum.amountCents ?? 0)} total`}
        action={
          <Link href="/income/new" className={btnPrimaryCls}>
            Add
          </Link>
        }
      />

      {incomes.length === 0 ? (
        <EmptyState
          title="No income recorded yet."
          hint="Print jobs, livestock sales, design work — every dollar in gets a record."
          actionHref="/income/new"
          actionLabel="Add income"
        />
      ) : (
        <div className="space-y-2">
          {incomes.map((i) => (
            <Link key={i.id} href={`/income/${i.id}`} className="block">
              <Card className="active:bg-stone-50">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-semibold text-stone-900">{i.description}</div>
                    <div className="text-sm text-stone-500">
                      {i.source ?? "—"} · {formatDate(i.date)}
                    </div>
                  </div>
                  <div className="font-bold tabular-nums text-oak-700">
                    +{formatCents(i.amountCents)}
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Chip tone={divisionTone(i.division)}>
                    {DIVISION_LABELS[i.division as Division] ?? i.division}
                  </Chip>
                  <Chip>{i.category}</Chip>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
