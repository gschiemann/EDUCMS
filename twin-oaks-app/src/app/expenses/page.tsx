import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { DIVISION_LABELS, TAX_STATUS_LABELS, type Division, type TaxStatus } from "@/lib/domain";
import { Card, Chip, EmptyState, PageHeader, btnPrimaryCls, divisionTone } from "@/components/ui";
import { taxStatusTone } from "./expense-bits";

export const dynamic = "force-dynamic";

const DIVISION_TABS = ["ALL", "FARM", "TECH", "SHARED"] as const;

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<{ division?: string; year?: string }>;
}) {
  const { division = "ALL", year } = await searchParams;
  const taxYear = year ? Number(year) : undefined;

  const where = {
    ...(division !== "ALL" ? { division } : {}),
    ...(taxYear ? { taxYear } : {}),
  };

  const [expenses, total, years] = await Promise.all([
    prisma.expense.findMany({
      where,
      orderBy: { date: "desc" },
      take: 200,
      include: { receipts: { select: { id: true } } },
    }),
    prisma.expense.aggregate({ where, _sum: { amountCents: true } }),
    prisma.expense.findMany({ distinct: ["taxYear"], select: { taxYear: true }, orderBy: { taxYear: "desc" } }),
  ]);

  const qs = (d: string) => `/expenses?division=${d}${taxYear ? `&year=${taxYear}` : ""}`;

  return (
    <div>
      <div className="mb-4 grid grid-cols-2 gap-2">
        <span className="rounded-xl bg-oak-700 px-4 py-2 text-center font-semibold text-white">
          Expenses
        </span>
        <Link
          href="/income"
          className="rounded-xl border border-stone-300 bg-white px-4 py-2 text-center font-medium text-stone-600"
        >
          Income
        </Link>
      </div>

      <PageHeader
        title="Expenses"
        sub={`${expenses.length} shown · ${formatCents(total._sum.amountCents ?? 0)} total`}
        action={
          <Link href="/expenses/new" className={btnPrimaryCls}>
            Add
          </Link>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {DIVISION_TABS.map((d) => (
          <Link
            key={d}
            href={qs(d)}
            className={`rounded-full px-3.5 py-1.5 text-sm font-medium ${
              division === d
                ? "bg-oak-700 text-white"
                : "border border-stone-300 bg-white text-stone-600"
            }`}
          >
            {d === "ALL" ? "All" : DIVISION_LABELS[d as Division]}
          </Link>
        ))}
        {years.length > 1 ? (
          <span className="ml-auto flex gap-1.5">
            {years.map((y) => (
              <Link
                key={y.taxYear}
                href={`/expenses?division=${division}&year=${y.taxYear}`}
                className={`rounded-full px-3 py-1.5 text-sm font-medium ${
                  taxYear === y.taxYear
                    ? "bg-stone-800 text-white"
                    : "border border-stone-300 bg-white text-stone-600"
                }`}
              >
                {y.taxYear}
              </Link>
            ))}
          </span>
        ) : null}
      </div>

      {expenses.length === 0 ? (
        <EmptyState
          title="No expenses recorded yet."
          hint="Every dollar out gets a record — start with your most recent purchase."
          actionHref="/expenses/new"
          actionLabel="Add expense"
        />
      ) : (
        <div className="space-y-2">
          {expenses.map((e) => (
            <Link key={e.id} href={`/expenses/${e.id}`} className="block">
              <Card className="active:bg-stone-50">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-semibold text-stone-900">{e.description}</div>
                    <div className="text-sm text-stone-500">
                      {e.vendorName ?? "—"} · {formatDate(e.date)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-bold tabular-nums text-stone-900">
                      {formatCents(e.amountCents)}
                    </div>
                    {e.receipts.length > 0 ? (
                      <div className="text-xs text-oak-700">📎 receipt</div>
                    ) : (
                      <div className="text-xs text-red-600">no receipt</div>
                    )}
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Chip tone={divisionTone(e.division)}>
                    {DIVISION_LABELS[e.division as Division] ?? e.division}
                  </Chip>
                  <Chip>{e.accountingCategory}</Chip>
                  <Chip tone={taxStatusTone(e.taxStatus)}>
                    {TAX_STATUS_LABELS[e.taxStatus as TaxStatus] ?? e.taxStatus}
                  </Chip>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
