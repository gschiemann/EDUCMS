import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatCents } from "@/lib/money";
import { Card, EmptyState, PageHeader, btnPrimaryCls } from "@/components/ui";
import { ChevronRightIcon } from "@/components/Icons";
import { deriveInvoiceStatus, paidCentsOf } from "../invoices/invoice-bits";

export const dynamic = "force-dynamic";

export default async function CustomersPage() {
  const customers = await prisma.customer.findMany({
    orderBy: { name: "asc" },
    include: { invoices: { include: { payments: { select: { amountCents: true } } } } },
  });

  return (
    <div>
      <PageHeader
        title="Customers"
        sub="Everyone you sell to — with their lifetime value and open balance."
        action={
          <Link href="/customers/new" className={btnPrimaryCls}>
            Add
          </Link>
        }
      />

      {customers.length === 0 ? (
        <EmptyState
          title="No customers yet."
          hint="Add your first customer, then send them an invoice from the Invoices page."
          actionHref="/customers/new"
          actionLabel="Add customer"
        />
      ) : (
        <div className="space-y-2">
          {customers.map((c) => {
            const active = c.invoices.filter((i) => i.status !== "CANCELLED");
            const revenue = active.reduce((s, i) => s + paidCentsOf(i.payments), 0);
            const outstanding = active.reduce((s, i) => {
              const st = deriveInvoiceStatus(i, paidCentsOf(i.payments));
              return st === "DRAFT" || st === "CANCELLED"
                ? s
                : s + Math.max(0, i.totalCents - paidCentsOf(i.payments));
            }, 0);
            return (
              <Link key={c.id} href={`/customers/${c.id}`} className="block">
                <Card className="flex items-center gap-3 active:bg-stone-50">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-oak-100 font-bold text-oak-800">
                    {c.name.charAt(0).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold text-stone-900">{c.name}</div>
                    <div className="truncate text-sm text-stone-500">
                      {c.company ?? c.email ?? c.phone ?? "—"}
                    </div>
                  </div>
                  <div className="shrink-0 text-right text-sm">
                    <div className="font-semibold tabular-nums text-oak-700">
                      {formatCents(revenue)}
                    </div>
                    {outstanding > 0 ? (
                      <div className="tabular-nums text-red-600">
                        {formatCents(outstanding)} due
                      </div>
                    ) : (
                      <div className="text-stone-400">paid up</div>
                    )}
                  </div>
                  <ChevronRightIcon className="h-5 w-5 shrink-0 text-stone-400" />
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
