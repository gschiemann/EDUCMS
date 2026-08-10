import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatCents } from "@/lib/money";
import { startOfYear } from "@/lib/dates";
import { DIVISION_LABELS, type Division } from "@/lib/domain";
import { Card, Chip, EmptyState, PageHeader, btnPrimaryCls, divisionTone } from "@/components/ui";
import { TractorIcon, ChevronRightIcon } from "@/components/Icons";

export const dynamic = "force-dynamic";

export default async function AssetsPage() {
  const [assets, maintYtd, maintAll] = await Promise.all([
    prisma.asset.findMany({ orderBy: [{ division: "asc" }, { name: "asc" }] }),
    prisma.maintenanceRecord.groupBy({
      by: ["assetId"],
      where: { date: { gte: startOfYear() } },
      _sum: { partsCostCents: true, laborCostCents: true },
    }),
    prisma.maintenanceRecord.groupBy({
      by: ["assetId"],
      _sum: { partsCostCents: true, laborCostCents: true },
    }),
  ]);

  const ytdByAsset = new Map(
    maintYtd.map((m) => [m.assetId, (m._sum.partsCostCents ?? 0) + (m._sum.laborCostCents ?? 0)]),
  );
  const allByAsset = new Map(
    maintAll.map((m) => [m.assetId, (m._sum.partsCostCents ?? 0) + (m._sum.laborCostCents ?? 0)]),
  );

  return (
    <div>
      <PageHeader
        title="Equipment & assets"
        sub="Every machine gets a profile, a history, and a true cost."
        action={
          <Link href="/assets/new" className={btnPrimaryCls}>
            Add
          </Link>
        }
      />

      {assets.length === 0 ? (
        <EmptyState
          title="No equipment yet."
          hint="Add your tractors, printers, trailers, and buildings so expenses and maintenance can be pinned to them."
          actionHref="/assets/new"
          actionLabel="Add equipment"
        />
      ) : (
        <div className="space-y-2">
          {assets.map((a) => (
            <Link key={a.id} href={`/assets/${a.id}`} className="block">
              <Card className="flex items-center gap-3 active:bg-stone-50">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-oak-100 text-oak-700">
                  <TractorIcon className="h-6 w-6" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-semibold text-stone-900">{a.name}</span>
                    {a.status !== "ACTIVE" ? <Chip>{a.status}</Chip> : null}
                  </div>
                  <div className="truncate text-sm text-stone-500">
                    {[a.manufacturer, a.model, a.kind].filter(Boolean).join(" · ")}
                  </div>
                  <div className="mt-1 flex gap-1.5">
                    <Chip tone={divisionTone(a.division)}>
                      {DIVISION_LABELS[a.division as Division] ?? a.division}
                    </Chip>
                    <Chip tone="stone">
                      YTD {formatCents(ytdByAsset.get(a.id) ?? 0)} · life{" "}
                      {formatCents(allByAsset.get(a.id) ?? 0)}
                    </Chip>
                  </div>
                </div>
                <ChevronRightIcon className="h-5 w-5 shrink-0 text-stone-400" />
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
