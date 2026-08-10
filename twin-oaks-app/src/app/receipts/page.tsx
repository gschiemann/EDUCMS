import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { RECEIPT_STATUS_LABELS, type ReceiptStatus } from "@/lib/domain";
import { Card, Chip, EmptyState, PageHeader, btnPrimaryCls } from "@/components/ui";
import { ReceiptThumb, receiptStatusTone } from "./receipt-bits";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "inbox", label: "Inbox" },
  { key: "review", label: "Needs review" },
  { key: "all", label: "All" },
] as const;

export default async function ReceiptsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab = "inbox" } = await searchParams;

  const where =
    tab === "inbox"
      ? { status: "INBOX" }
      : tab === "review"
        ? { status: { in: ["NEEDS_REVIEW", "TAX_UNCERTAIN", "SPLIT_PERSONAL"] } }
        : {};

  const [receipts, inboxCount] = await Promise.all([
    prisma.receipt.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.receipt.count({ where: { status: "INBOX" } }),
  ]);

  return (
    <div>
      <PageHeader
        title="Receipts"
        sub="Snap now, categorize later — originals are stored permanently."
        action={
          <Link href="/receipts/new" className={btnPrimaryCls}>
            Add receipt
          </Link>
        }
      />

      <div className="mb-4 flex gap-2">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/receipts?tab=${t.key}`}
            className={`rounded-full px-3.5 py-1.5 text-sm font-medium ${
              tab === t.key
                ? "bg-oak-700 text-white"
                : "border border-stone-300 bg-white text-stone-600"
            }`}
          >
            {t.label}
            {t.key === "inbox" && inboxCount > 0 ? ` (${inboxCount})` : ""}
          </Link>
        ))}
      </div>

      {receipts.length === 0 ? (
        <EmptyState
          title={tab === "inbox" ? "Inbox zero — nothing waiting." : "No receipts here yet."}
          hint="Use Add receipt (or the + button) to snap a photo the moment you get a receipt."
          actionHref="/receipts/new"
          actionLabel="Add receipt"
        />
      ) : (
        <div className="space-y-2">
          {receipts.map((r) => (
            <Link key={r.id} href={`/receipts/${r.id}`} className="block">
              <Card className="flex items-center gap-3 active:bg-stone-50">
                <ReceiptThumb filePath={r.filePath} mimeType={r.mimeType} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold text-stone-900">
                    {r.vendorName ?? "Unknown vendor"}
                  </div>
                  <div className="text-sm text-stone-500">
                    {formatDate(r.receiptDate)} · added {formatDate(r.createdAt)}
                  </div>
                  <div className="mt-1">
                    <Chip tone={receiptStatusTone(r.status)}>
                      {RECEIPT_STATUS_LABELS[r.status as ReceiptStatus] ?? r.status}
                    </Chip>
                  </div>
                </div>
                <div className="text-right font-bold tabular-nums text-stone-900">
                  {formatCents(r.totalCents)}
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
