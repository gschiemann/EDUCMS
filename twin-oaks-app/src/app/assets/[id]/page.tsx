import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { formatDate, startOfYear, toDateInputValue } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { DIVISION_LABELS, MAINTENANCE_CATEGORIES, type Division } from "@/lib/domain";
import {
  Card,
  Chip,
  PageHeader,
  StatCard,
  btnPrimaryCls,
  btnSecondaryCls,
  divisionTone,
  inputCls,
  labelCls,
} from "@/components/ui";
import { addMaintenance, deleteMaintenance } from "../actions";

export const dynamic = "force-dynamic";

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  if (value == null || value === "" || value === "—") return null;
  return (
    <div className="flex items-start justify-between gap-4 border-b border-stone-100 py-2 last:border-b-0">
      <span className="text-sm text-stone-500">{label}</span>
      <span className="text-right text-sm font-medium text-stone-900">{value}</span>
    </div>
  );
}

export default async function AssetDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const asset = await prisma.asset.findUnique({
    where: { id },
    include: {
      maintenance: { orderBy: { date: "desc" } },
      expenses: { orderBy: { date: "desc" }, take: 25 },
    },
  });
  if (!asset) notFound();

  const yearStart = startOfYear();
  const maintCost = (m: (typeof asset.maintenance)[number]) =>
    (m.partsCostCents ?? 0) + (m.laborCostCents ?? 0);
  const lifetime = asset.maintenance.reduce((s, m) => s + maintCost(m), 0);
  const ytd = asset.maintenance
    .filter((m) => m.date >= yearStart)
    .reduce((s, m) => s + maintCost(m), 0);
  const costPerHour =
    asset.currentHours && asset.currentHours > 0 ? lifetime / asset.currentHours : null;
  const linkedExpenseTotal = asset.expenses.reduce((s, e) => s + e.amountCents, 0);

  return (
    <div>
      <PageHeader
        title={asset.name}
        sub={[asset.manufacturer, asset.model, asset.kind].filter(Boolean).join(" · ")}
        action={
          <Link href={`/assets/${asset.id}/edit`} className={btnSecondaryCls}>
            Edit
          </Link>
        }
      />

      <div className="mb-4 flex flex-wrap gap-1.5">
        <Chip tone={divisionTone(asset.division)}>
          {DIVISION_LABELS[asset.division as Division] ?? asset.division}
        </Chip>
        {asset.assetTag ? <Chip>{asset.assetTag}</Chip> : null}
        {asset.status !== "ACTIVE" ? <Chip tone="amber">{asset.status}</Chip> : null}
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatCard label="Maintenance YTD" value={formatCents(ytd)} />
        <StatCard label="Maintenance lifetime" value={formatCents(lifetime)} />
        <StatCard
          label="Cost / hour"
          value={costPerHour != null ? formatCents(Math.round(costPerHour)) : "—"}
          sub={asset.currentHours ? `${asset.currentHours} hrs logged` : "log hours to enable"}
        />
        <StatCard label="Linked expenses" value={formatCents(linkedExpenseTotal)} />
      </div>

      <Card className="mb-4">
        <h2 className="mb-1 font-semibold text-stone-900">Profile</h2>
        <Row label="Serial number" value={asset.serialNumber} />
        <Row label="Year" value={asset.year != null ? String(asset.year) : null} />
        <Row label="Purchased" value={asset.purchaseDate ? formatDate(asset.purchaseDate) : null} />
        <Row
          label="Purchase price"
          value={asset.purchasePriceCents != null ? formatCents(asset.purchasePriceCents) : null}
        />
        <Row label="Purchased from" value={asset.purchasedFrom} />
        <Row label="Financing" value={asset.financingNotes} />
        <Row label="Warranty" value={asset.warrantyNotes} />
        <Row
          label="Current hours"
          value={asset.currentHours != null ? `${asset.currentHours}` : null}
        />
        <Row
          label="Current mileage"
          value={asset.currentMileage != null ? `${asset.currentMileage}` : null}
        />
        <Row label="Notes" value={asset.notes} />
      </Card>

      <Card className="mb-4">
        <h2 className="mb-3 font-semibold text-stone-900">Log maintenance</h2>
        <form action={addMaintenance} className="space-y-3">
          <input type="hidden" name="assetId" value={asset.id} />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls} htmlFor="m-date">
                Date *
              </label>
              <input
                id="m-date"
                name="date"
                type="date"
                required
                defaultValue={toDateInputValue(new Date())}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls} htmlFor="m-hours">
                Hours / miles at service
              </label>
              <input id="m-hours" name="hoursAtService" inputMode="decimal" className={inputCls} />
            </div>
          </div>
          <div>
            <label className={labelCls} htmlFor="m-category">
              Category *
            </label>
            <select id="m-category" name="category" required defaultValue="" className={inputCls}>
              <option value="" disabled>
                Choose…
              </option>
              {MAINTENANCE_CATEGORIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls} htmlFor="m-description">
              What was done *
            </label>
            <input
              id="m-description"
              name="description"
              required
              placeholder="Replaced hydraulic hose, topped off fluid"
              className={inputCls}
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={labelCls} htmlFor="m-parts">
                Parts
              </label>
              <input id="m-parts" name="partsCost" inputMode="decimal" placeholder="$0.00" className={inputCls} />
            </div>
            <div>
              <label className={labelCls} htmlFor="m-labor">
                Labor
              </label>
              <input id="m-labor" name="laborCost" inputMode="decimal" placeholder="$0.00" className={inputCls} />
            </div>
            <div>
              <label className={labelCls} htmlFor="m-vendor">
                Shop / vendor
              </label>
              <input id="m-vendor" name="vendorName" className={inputCls} />
            </div>
          </div>
          <button type="submit" className={`${btnPrimaryCls} w-full`}>
            Add to history
          </button>
        </form>
      </Card>

      <Card className="mb-4">
        <h2 className="mb-2 font-semibold text-stone-900">
          Maintenance history ({asset.maintenance.length})
        </h2>
        {asset.maintenance.length === 0 ? (
          <p className="text-sm text-stone-500">
            Nothing logged yet — every oil change and repair belongs here.
          </p>
        ) : (
          <div className="divide-y divide-stone-100">
            {asset.maintenance.map((m) => (
              <div key={m.id} className="flex items-start justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <div className="font-medium text-stone-900">{m.description}</div>
                  <div className="text-sm text-stone-500">
                    {formatDate(m.date)} · {m.category}
                    {m.hoursAtService != null ? ` · ${m.hoursAtService} hrs` : ""}
                    {m.vendorName ? ` · ${m.vendorName}` : ""}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="font-semibold tabular-nums text-stone-900">
                    {formatCents(maintCost(m))}
                  </span>
                  <form action={deleteMaintenance}>
                    <input type="hidden" name="id" value={m.id} />
                    <input type="hidden" name="assetId" value={asset.id} />
                    <button type="submit" className="text-xs text-red-500">
                      remove
                    </button>
                  </form>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-semibold text-stone-900">Connected expenses</h2>
          <Link
            href={`/expenses/new?assetId=${asset.id}`}
            className="text-sm font-medium text-oak-700"
          >
            Add expense
          </Link>
        </div>
        {asset.expenses.length === 0 ? (
          <p className="text-sm text-stone-500">No expenses pinned to this asset yet.</p>
        ) : (
          <div className="divide-y divide-stone-100">
            {asset.expenses.map((e) => (
              <Link key={e.id} href={`/expenses/${e.id}`} className="flex justify-between py-2.5">
                <span className="min-w-0">
                  <span className="block truncate font-medium text-stone-900">{e.description}</span>
                  <span className="text-sm text-stone-500">{formatDate(e.date)}</span>
                </span>
                <span className="font-semibold tabular-nums text-stone-900">
                  {formatCents(e.amountCents)}
                </span>
              </Link>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
