import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatCents } from "@/lib/money";
import { formatDate, startOfMonth, startOfYear } from "@/lib/dates";
import { Card, Chip, PageHeader, StatCard, divisionTone } from "@/components/ui";
import { DIVISION_LABELS, type Division } from "@/lib/domain";
import { ensureSchema } from "@/lib/ensure-schema";

export const dynamic = "force-dynamic";

async function sums(model: "expense" | "income", gte: Date, division?: string) {
  const where = { date: { gte }, ...(division ? { division } : {}) };
  const agg =
    model === "expense"
      ? await prisma.expense.aggregate({ where, _sum: { amountCents: true } })
      : await prisma.income.aggregate({ where, _sum: { amountCents: true } });
  return agg._sum.amountCents ?? 0;
}

export default async function DashboardPage() {
  const db = await ensureSchema();
  if (!db.ok) {
    return (
      <div>
        <PageHeader title="Twin Oaks Farm & Tech" />
        <Card className="border-amber-300 bg-amber-50">
          <h2 className="mb-1 font-semibold text-amber-900">
            Database isn&apos;t ready yet
          </h2>
          <p className="mb-2 text-sm text-amber-900">{db.reason}</p>
          {db.detail ? (
            <p className="mb-2 rounded-lg bg-white/60 p-2 font-mono text-xs text-amber-950">
              {db.detail}
            </p>
          ) : null}
          <p className="mb-1 text-xs text-amber-800">
            Database-related settings this deployment can see:{" "}
            {db.envNames.length > 0 ? db.envNames.join(", ") : "none"}
          </p>
          <p className="text-xs text-amber-800">
            Fix: in Vercel, open the twin-oaks project → Storage → make sure the
            Neon database is connected with env prefix DATABASE — then reload
            this page. It sets itself up automatically.
          </p>
        </Card>
      </div>
    );
  }

  const monthStart = startOfMonth();
  const yearStart = startOfYear();

  const [
    expMonth,
    incMonth,
    expYtd,
    incYtd,
    farmExpYtd,
    farmIncYtd,
    techExpYtd,
    techIncYtd,
    inboxCount,
    reviewCount,
    missingReceiptCount,
    recentExpenses,
    recentIncome,
    openInvoices,
  ] = await Promise.all([
    sums("expense", monthStart),
    sums("income", monthStart),
    sums("expense", yearStart),
    sums("income", yearStart),
    sums("expense", yearStart, "FARM"),
    sums("income", yearStart, "FARM"),
    sums("expense", yearStart, "TECH"),
    sums("income", yearStart, "TECH"),
    prisma.receipt.count({ where: { status: "INBOX" } }),
    prisma.expense.count({ where: { taxStatus: "NEEDS_REVIEW" } }),
    prisma.expense.count({ where: { receipts: { none: {} } } }),
    prisma.expense.findMany({ orderBy: { date: "desc" }, take: 5 }),
    prisma.income.findMany({ orderBy: { date: "desc" }, take: 3 }),
    prisma.invoice.findMany({
      where: { status: "SENT" },
      include: { payments: { select: { amountCents: true } } },
    }),
  ]);

  const outstandingCents = openInvoices.reduce(
    (s, i) => s + Math.max(0, i.totalCents - i.payments.reduce((p, x) => p + x.amountCents, 0)),
    0,
  );
  const awaitingCount = openInvoices.filter(
    (i) => i.totalCents - i.payments.reduce((p, x) => p + x.amountCents, 0) > 0,
  ).length;

  const netMonth = incMonth - expMonth;
  const netYtd = incYtd - expYtd;
  const monthLabel = new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" });
  // Planning number only (25% of YTD profit) — not tax advice; the real number
  // comes from the accountant.
  const setAside = netYtd > 0 ? Math.round(netYtd * 0.25) : 0;

  return (
    <div>
      <PageHeader title="Twin Oaks Farm & Tech" sub={monthLabel} />

      {inboxCount > 0 ? (
        <Link href="/receipts" className="mb-4 block">
          <Card className="border-amber-300 bg-amber-50 active:bg-amber-100">
            <p className="font-semibold text-amber-900">
              📥 {inboxCount} receipt{inboxCount === 1 ? "" : "s"} waiting in the Inbox
            </p>
            <p className="text-sm text-amber-800">Tap to categorize before they pile up.</p>
          </Card>
        </Link>
      ) : null}

      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-500">
        Company
      </h2>
      <div className="mb-2 grid grid-cols-3 gap-2">
        <StatCard label="Revenue (mo)" value={formatCents(incMonth)} tone="green" />
        <StatCard label="Expenses (mo)" value={formatCents(expMonth)} />
        <StatCard
          label="Net (mo)"
          value={formatCents(netMonth)}
          tone={netMonth >= 0 ? "green" : "red"}
        />
      </div>
      <div className="mb-4 grid grid-cols-3 gap-2">
        <StatCard label="Revenue YTD" value={formatCents(incYtd)} tone="green" />
        <StatCard label="Expenses YTD" value={formatCents(expYtd)} />
        <StatCard
          label="Net YTD"
          value={formatCents(netYtd)}
          tone={netYtd >= 0 ? "green" : "red"}
        />
      </div>

      <Card className="mb-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-stone-700">Estimated tax set-aside</p>
            <p className="text-xs text-stone-500">
              Planning number (25% of YTD profit) — your accountant sets the real one.
            </p>
          </div>
          <span className="text-xl font-bold tabular-nums text-stone-900">
            {formatCents(setAside)}
          </span>
        </div>
      </Card>

      {awaitingCount > 0 ? (
        <Link href="/invoices" className="mb-4 block">
          <Card className="flex items-center justify-between active:bg-stone-50">
            <div>
              <p className="text-sm font-medium text-stone-700">
                💸 {awaitingCount} invoice{awaitingCount === 1 ? "" : "s"} awaiting payment
              </p>
              <p className="text-xs text-stone-500">Tap to see who owes what.</p>
            </div>
            <span className="text-xl font-bold tabular-nums text-red-700">
              {formatCents(outstandingCents)}
            </span>
          </Card>
        </Link>
      ) : null}

      <div className="mb-4 grid grid-cols-2 gap-2">
        <Card>
          <div className="mb-1 flex items-center gap-1.5">
            <Chip tone="green">Farm</Chip>
          </div>
          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-stone-500">Revenue YTD</span>
              <span className="font-semibold tabular-nums">{formatCents(farmIncYtd)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-stone-500">Expenses YTD</span>
              <span className="font-semibold tabular-nums">{formatCents(farmExpYtd)}</span>
            </div>
            <div className="flex justify-between border-t border-stone-100 pt-1">
              <span className="text-stone-500">Net</span>
              <span
                className={`font-bold tabular-nums ${farmIncYtd - farmExpYtd >= 0 ? "text-oak-700" : "text-red-700"}`}
              >
                {formatCents(farmIncYtd - farmExpYtd)}
              </span>
            </div>
          </div>
          <p className="mt-2 text-xs text-stone-400">Sheep & lambing arrive in V3.</p>
        </Card>
        <Card>
          <div className="mb-1 flex items-center gap-1.5">
            <Chip tone="indigo">Tech</Chip>
          </div>
          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-stone-500">Revenue YTD</span>
              <span className="font-semibold tabular-nums">{formatCents(techIncYtd)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-stone-500">Expenses YTD</span>
              <span className="font-semibold tabular-nums">{formatCents(techExpYtd)}</span>
            </div>
            <div className="flex justify-between border-t border-stone-100 pt-1">
              <span className="text-stone-500">Net</span>
              <span
                className={`font-bold tabular-nums ${techIncYtd - techExpYtd >= 0 ? "text-oak-700" : "text-red-700"}`}
              >
                {formatCents(techIncYtd - techExpYtd)}
              </span>
            </div>
          </div>
          <p className="mt-2 text-xs text-stone-400">Print jobs & filament arrive in V4.</p>
        </Card>
      </div>

      {reviewCount > 0 || missingReceiptCount > 0 ? (
        <Card className="mb-4">
          <h3 className="mb-1 font-semibold text-stone-900">Needs attention</h3>
          <div className="space-y-1 text-sm">
            {reviewCount > 0 ? (
              <Link href="/tax" className="block text-amber-700">
                • {reviewCount} expense{reviewCount === 1 ? "" : "s"} awaiting tax review
              </Link>
            ) : null}
            {missingReceiptCount > 0 ? (
              <Link href="/tax" className="block text-red-700">
                • {missingReceiptCount} expense{missingReceiptCount === 1 ? "" : "s"} missing a
                receipt
              </Link>
            ) : null}
          </div>
        </Card>
      ) : null}

      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-500">
        Recent activity
      </h2>
      <Card>
        {recentExpenses.length === 0 && recentIncome.length === 0 ? (
          <p className="text-sm text-stone-500">
            Nothing yet — use the big + button to record your first receipt, expense, or income.
          </p>
        ) : (
          <div className="divide-y divide-stone-100">
            {recentIncome.map((i) => (
              <Link key={i.id} href={`/income/${i.id}`} className="flex justify-between py-2.5">
                <span className="min-w-0">
                  <span className="block truncate font-medium text-stone-900">{i.description}</span>
                  <span className="text-sm text-stone-500">
                    {formatDate(i.date)} ·{" "}
                    {DIVISION_LABELS[i.division as Division] ?? i.division}
                  </span>
                </span>
                <span className="font-semibold tabular-nums text-oak-700">
                  +{formatCents(i.amountCents)}
                </span>
              </Link>
            ))}
            {recentExpenses.map((e) => (
              <Link key={e.id} href={`/expenses/${e.id}`} className="flex justify-between py-2.5">
                <span className="min-w-0">
                  <span className="block truncate font-medium text-stone-900">{e.description}</span>
                  <span className="text-sm text-stone-500">
                    {formatDate(e.date)} · {e.vendorName ?? "—"}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <Chip tone={divisionTone(e.division)}>
                    {DIVISION_LABELS[e.division as Division] ?? e.division}
                  </Chip>
                  <span className="font-semibold tabular-nums text-stone-900">
                    −{formatCents(e.amountCents)}
                  </span>
                </span>
              </Link>
            ))}
          </div>
        )}
      </Card>

      <p className="mt-6 text-center text-xs text-stone-400">
        V2 — invoicing & mileage live. Next: sheep (V3), print jobs (V4).
      </p>
    </div>
  );
}
