import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { Card, PageHeader, inputCls } from "@/components/ui";

export const dynamic = "force-dynamic";

// SPEC §29: "Tractor #1 hydraulic 2026" should find every relevant expense,
// service record, and receipt. Every word must match somewhere in the record
// (AND across terms, OR across fields).
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const terms = (q ?? "").trim().split(/\s+/).filter(Boolean).slice(0, 6);

  const textAnd = (fields: string[]) =>
    terms.map((t) => ({
      OR: fields.map((f) => ({ [f]: { contains: t } })),
    }));

  const [expenses, receipts, assets, incomes, maintenance] =
    terms.length === 0
      ? [[], [], [], [], []]
      : await Promise.all([
          prisma.expense.findMany({
            where: {
              AND: textAnd([
                "description",
                "vendorName",
                "accountingCategory",
                "managementCategory",
                "businessPurpose",
                "notes",
              ]),
            },
            take: 25,
            orderBy: { date: "desc" },
          }),
          prisma.receipt.findMany({
            where: { AND: textAnd(["vendorName", "notes", "receiptNumber", "fileName"]) },
            take: 25,
            orderBy: { createdAt: "desc" },
          }),
          prisma.asset.findMany({
            where: {
              AND: textAnd(["name", "manufacturer", "model", "serialNumber", "assetTag", "notes"]),
            },
            take: 25,
          }),
          prisma.income.findMany({
            where: { AND: textAnd(["description", "source", "category", "notes"]) },
            take: 25,
            orderBy: { date: "desc" },
          }),
          prisma.maintenanceRecord.findMany({
            where: { AND: textAnd(["description", "category", "vendorName", "notes"]) },
            include: { asset: { select: { id: true, name: true } } },
            take: 25,
            orderBy: { date: "desc" },
          }),
        ]);

  const total =
    expenses.length + receipts.length + assets.length + incomes.length + maintenance.length;

  return (
    <div>
      <PageHeader title="Search" sub="Vendors, amounts, equipment, categories — everything." />

      <form action="/search" method="GET" className="mb-4">
        <input
          name="q"
          defaultValue={q ?? ""}
          placeholder={'Try "Tractor #1 hydraulic"'}
          className={inputCls}
          autoFocus
        />
      </form>

      {terms.length === 0 ? (
        <p className="text-center text-sm text-stone-500">
          Type to search across expenses, receipts, income, equipment, and maintenance history.
        </p>
      ) : total === 0 ? (
        <p className="text-center text-sm text-stone-500">No matches for “{q}”.</p>
      ) : (
        <div className="space-y-4">
          {expenses.length > 0 ? (
            <section>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-500">
                Expenses
              </h2>
              <Card className="divide-y divide-stone-100 p-0">
                {expenses.map((e) => (
                  <Link
                    key={e.id}
                    href={`/expenses/${e.id}`}
                    className="flex justify-between gap-3 px-4 py-3"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{e.description}</span>
                      <span className="text-sm text-stone-500">
                        {e.vendorName ?? "—"} · {formatDate(e.date)} · {e.accountingCategory}
                      </span>
                    </span>
                    <span className="font-semibold tabular-nums">{formatCents(e.amountCents)}</span>
                  </Link>
                ))}
              </Card>
            </section>
          ) : null}

          {maintenance.length > 0 ? (
            <section>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-500">
                Maintenance
              </h2>
              <Card className="divide-y divide-stone-100 p-0">
                {maintenance.map((m) => (
                  <Link
                    key={m.id}
                    href={`/assets/${m.asset.id}`}
                    className="flex justify-between gap-3 px-4 py-3"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{m.description}</span>
                      <span className="text-sm text-stone-500">
                        {m.asset.name} · {formatDate(m.date)} · {m.category}
                      </span>
                    </span>
                    <span className="font-semibold tabular-nums">
                      {formatCents((m.partsCostCents ?? 0) + (m.laborCostCents ?? 0))}
                    </span>
                  </Link>
                ))}
              </Card>
            </section>
          ) : null}

          {receipts.length > 0 ? (
            <section>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-500">
                Receipts
              </h2>
              <Card className="divide-y divide-stone-100 p-0">
                {receipts.map((r) => (
                  <Link
                    key={r.id}
                    href={`/receipts/${r.id}`}
                    className="flex justify-between gap-3 px-4 py-3"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">
                        {r.vendorName ?? "Unknown vendor"}
                      </span>
                      <span className="text-sm text-stone-500">
                        {formatDate(r.receiptDate)} · {r.status}
                      </span>
                    </span>
                    <span className="font-semibold tabular-nums">{formatCents(r.totalCents)}</span>
                  </Link>
                ))}
              </Card>
            </section>
          ) : null}

          {incomes.length > 0 ? (
            <section>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-500">
                Income
              </h2>
              <Card className="divide-y divide-stone-100 p-0">
                {incomes.map((i) => (
                  <Link
                    key={i.id}
                    href={`/income/${i.id}`}
                    className="flex justify-between gap-3 px-4 py-3"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{i.description}</span>
                      <span className="text-sm text-stone-500">
                        {i.source ?? "—"} · {formatDate(i.date)}
                      </span>
                    </span>
                    <span className="font-semibold tabular-nums text-oak-700">
                      +{formatCents(i.amountCents)}
                    </span>
                  </Link>
                ))}
              </Card>
            </section>
          ) : null}

          {assets.length > 0 ? (
            <section>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-500">
                Equipment
              </h2>
              <Card className="divide-y divide-stone-100 p-0">
                {assets.map((a) => (
                  <Link key={a.id} href={`/assets/${a.id}`} className="block px-4 py-3">
                    <span className="block font-medium">{a.name}</span>
                    <span className="text-sm text-stone-500">
                      {[a.manufacturer, a.model, a.serialNumber].filter(Boolean).join(" · ")}
                    </span>
                  </Link>
                ))}
              </Card>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}
