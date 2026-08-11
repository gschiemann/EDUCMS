import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatCents } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { DIVISION_LABELS, type Division } from "@/lib/domain";
import { Card, Chip, PageHeader, StatCard, divisionTone } from "@/components/ui";

export const dynamic = "force-dynamic";

// SPEC §26: Tax Year → Division → Category → Transaction → Receipt.
// The Tax Center organizes and flags; the accountant makes the calls.
export default async function TaxCenterPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const { year } = await searchParams;

  const yearsRaw = await prisma.expense.findMany({
    distinct: ["taxYear"],
    select: { taxYear: true },
    orderBy: { taxYear: "desc" },
  });
  const years = yearsRaw.map((y) => y.taxYear);
  const taxYear = year ? Number(year) : (years[0] ?? new Date().getFullYear());

  const [
    expTotal,
    incTotal,
    byCategory,
    byDivision,
    incByCategory,
    needsReview,
    missingReceipts,
    capital,
    mileage,
  ] = await Promise.all([
    prisma.expense.aggregate({ where: { taxYear }, _sum: { amountCents: true } }),
    prisma.income.aggregate({ where: { taxYear }, _sum: { amountCents: true } }),
    prisma.expense.groupBy({
      by: ["accountingCategory"],
      where: { taxYear },
      _sum: { amountCents: true },
      _count: true,
      orderBy: { _sum: { amountCents: "desc" } },
    }),
    prisma.expense.groupBy({
      by: ["division"],
      where: { taxYear },
      _sum: { amountCents: true },
    }),
    prisma.income.groupBy({
      by: ["category"],
      where: { taxYear },
      _sum: { amountCents: true },
      orderBy: { _sum: { amountCents: "desc" } },
    }),
    prisma.expense.findMany({
      where: { taxYear, taxStatus: { in: ["NEEDS_REVIEW", "MIXED_PERSONAL", "MISSING_DOCS"] } },
      orderBy: { amountCents: "desc" },
      take: 50,
    }),
    prisma.expense.findMany({
      where: { taxYear, receipts: { none: {} } },
      orderBy: { amountCents: "desc" },
      take: 50,
    }),
    prisma.expense.findMany({
      where: { taxYear, isCapital: true },
      orderBy: { amountCents: "desc" },
    }),
    prisma.mileageLog.aggregate({
      where: { taxYear },
      _sum: { miles: true },
      _count: true,
    }),
  ]);

  const expenses = expTotal._sum.amountCents ?? 0;
  const revenue = incTotal._sum.amountCents ?? 0;

  return (
    <div>
      <PageHeader
        title="Tax Center"
        sub="Everything your accountant will ask for, in one place."
        action={
          <a
            href="/api/export"
            className="rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm font-medium text-stone-700"
          >
            Export backup
          </a>
        }
      />

      {years.length > 0 ? (
        <div className="mb-4 flex gap-2">
          {years.map((y) => (
            <Link
              key={y}
              href={`/tax?year=${y}`}
              className={`rounded-full px-4 py-1.5 text-sm font-semibold ${
                y === taxYear
                  ? "bg-oak-700 text-white"
                  : "border border-stone-300 bg-white text-stone-600"
              }`}
            >
              {y}
            </Link>
          ))}
        </div>
      ) : null}

      <div className="mb-4 grid grid-cols-3 gap-2">
        <StatCard label="Revenue" value={formatCents(revenue)} tone="green" />
        <StatCard label="Expenses" value={formatCents(expenses)} />
        <StatCard
          label="Profit / loss"
          value={formatCents(revenue - expenses)}
          tone={revenue - expenses >= 0 ? "green" : "red"}
        />
      </div>

      <div className="mb-4 grid grid-cols-3 gap-2">
        {byDivision.map((d) => (
          <StatCard
            key={d.division}
            label={`${DIVISION_LABELS[d.division as Division] ?? d.division} expenses`}
            value={formatCents(d._sum.amountCents ?? 0)}
          />
        ))}
      </div>

      {(needsReview.length > 0 || missingReceipts.length > 0) && (
        <Card className="mb-4 border-amber-300 bg-amber-50">
          <h2 className="mb-2 font-semibold text-amber-900">Flagged before filing</h2>
          {needsReview.length > 0 ? (
            <details className="mb-2">
              <summary className="cursor-pointer text-sm font-medium text-amber-900">
                {needsReview.length} item{needsReview.length === 1 ? "" : "s"} needing tax review
              </summary>
              <div className="mt-2 divide-y divide-amber-200">
                {needsReview.map((e) => (
                  <Link key={e.id} href={`/expenses/${e.id}`} className="flex justify-between py-2 text-sm">
                    <span className="min-w-0 truncate text-amber-950">
                      {e.description} · {formatDate(e.date)}
                    </span>
                    <span className="font-semibold tabular-nums">{formatCents(e.amountCents)}</span>
                  </Link>
                ))}
              </div>
            </details>
          ) : null}
          {missingReceipts.length > 0 ? (
            <details>
              <summary className="cursor-pointer text-sm font-medium text-amber-900">
                {missingReceipts.length} expense{missingReceipts.length === 1 ? "" : "s"} missing a
                receipt
              </summary>
              <div className="mt-2 divide-y divide-amber-200">
                {missingReceipts.map((e) => (
                  <Link key={e.id} href={`/expenses/${e.id}`} className="flex justify-between py-2 text-sm">
                    <span className="min-w-0 truncate text-amber-950">
                      {e.description} · {formatDate(e.date)}
                    </span>
                    <span className="font-semibold tabular-nums">{formatCents(e.amountCents)}</span>
                  </Link>
                ))}
              </div>
            </details>
          ) : null}
        </Card>
      )}

      <Card className="mb-4">
        <h2 className="mb-2 font-semibold text-stone-900">Expenses by category</h2>
        {byCategory.length === 0 ? (
          <p className="text-sm text-stone-500">No expenses recorded for {taxYear} yet.</p>
        ) : (
          <div className="divide-y divide-stone-100">
            {byCategory.map((c) => (
              <div key={c.accountingCategory} className="flex justify-between py-2 text-sm">
                <span className="text-stone-700">
                  {c.accountingCategory}{" "}
                  <span className="text-stone-400">({c._count})</span>
                </span>
                <span className="font-semibold tabular-nums">
                  {formatCents(c._sum.amountCents ?? 0)}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="mb-4">
        <h2 className="mb-2 font-semibold text-stone-900">Income by category</h2>
        {incByCategory.length === 0 ? (
          <p className="text-sm text-stone-500">No income recorded for {taxYear} yet.</p>
        ) : (
          <div className="divide-y divide-stone-100">
            {incByCategory.map((c) => (
              <div key={c.category} className="flex justify-between py-2 text-sm">
                <span className="text-stone-700">{c.category}</span>
                <span className="font-semibold tabular-nums text-oak-700">
                  {formatCents(c._sum.amountCents ?? 0)}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="mb-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-stone-900">Business mileage</h2>
            <p className="text-xs text-stone-500">
              {mileage._count} trip{mileage._count === 1 ? "" : "s"} logged · deduction rate is your
              accountant&apos;s call
            </p>
          </div>
          <Link href="/mileage" className="text-right">
            <span className="block text-xl font-bold tabular-nums text-stone-900">
              {(mileage._sum.miles ?? 0).toLocaleString("en-US", { maximumFractionDigits: 1 })} mi
            </span>
            <span className="text-xs font-medium text-oak-700 underline">view log</span>
          </Link>
        </div>
      </Card>

      <Card className="mb-4">
        <h2 className="mb-2 font-semibold text-stone-900">
          Capital purchases ({capital.length})
        </h2>
        <p className="mb-2 text-xs text-stone-500">
          Possible depreciation / §179 items — final treatment is the accountant&apos;s call.
        </p>
        {capital.length === 0 ? (
          <p className="text-sm text-stone-500">None flagged for {taxYear}.</p>
        ) : (
          <div className="divide-y divide-stone-100">
            {capital.map((e) => (
              <Link key={e.id} href={`/expenses/${e.id}`} className="flex justify-between py-2 text-sm">
                <span className="min-w-0">
                  <span className="block truncate font-medium text-stone-900">{e.description}</span>
                  <span className="text-stone-500">
                    {formatDate(e.date)} ·{" "}
                    <Chip tone={divisionTone(e.division)}>
                      {DIVISION_LABELS[e.division as Division] ?? e.division}
                    </Chip>
                  </span>
                </span>
                <span className="font-semibold tabular-nums">{formatCents(e.amountCents)}</span>
              </Link>
            ))}
          </div>
        )}
      </Card>

      <p className="text-center text-xs text-stone-400">
        Accountant package (P&L, mileage, receipt ZIP) lands in V2 — today&apos;s export is a full
        JSON backup.
      </p>
    </div>
  );
}
