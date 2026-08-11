import { prisma } from "@/lib/db";
import { formatDate, startOfYear, toDateInputValue } from "@/lib/dates";
import { Card, PageHeader, StatCard, btnPrimaryCls, inputCls, labelCls } from "@/components/ui";
import { createMileage, deleteMileage } from "./actions";

export const dynamic = "force-dynamic";

function fmtMiles(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

export default async function MileagePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const yearStart = startOfYear();

  const [trips, vehicles, ytd] = await Promise.all([
    prisma.mileageLog.findMany({
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: 200,
      include: { vehicle: true },
    }),
    prisma.asset.findMany({ orderBy: { name: "asc" } }),
    prisma.mileageLog.aggregate({
      where: { date: { gte: yearStart } },
      _sum: { miles: true },
      _count: true,
    }),
  ]);

  const milesYtd = ytd._sum.miles ?? 0;
  const tripsYtd = ytd._count;

  return (
    <div>
      <PageHeader
        title="Mileage"
        sub="Every business trip logged — the deduction rate is your accountant's call."
      />

      <div className="mb-4 grid grid-cols-2 gap-2">
        <StatCard label="Miles YTD" value={fmtMiles(milesYtd)} />
        <StatCard label="Trips YTD" value={tripsYtd.toLocaleString("en-US")} />
      </div>

      <Card className="mb-4">
        <h2 className="mb-3 font-semibold text-stone-900">Log a trip</h2>
        {error === "missing" || error === "miles" ? (
          <p className="mb-3 text-sm font-medium text-amber-700">
            {error === "missing"
              ? "Destination and purpose are required."
              : "Enter miles, or both odometer readings."}
          </p>
        ) : null}
        <form action={createMileage} className="space-y-3">
          <div>
            <label className={labelCls} htmlFor="t-date">
              Date
            </label>
            <input
              id="t-date"
              name="date"
              type="date"
              defaultValue={toDateInputValue(new Date())}
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="t-destination">
              Destination *
            </label>
            <input
              id="t-destination"
              name="destination"
              required
              placeholder="Tractor Supply, Springfield"
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="t-startLocation">
              Start location
            </label>
            <input id="t-startLocation" name="startLocation" placeholder="Farm" className={inputCls} />
          </div>
          <div>
            <label className={labelCls} htmlFor="t-purpose">
              Purpose *
            </label>
            <input
              id="t-purpose"
              name="purpose"
              required
              placeholder="Pick up fence posts"
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="t-customerName">
              Customer
            </label>
            <input id="t-customerName" name="customerName" className={inputCls} />
          </div>
          <div>
            <label className={labelCls} htmlFor="t-vehicle">
              Vehicle
            </label>
            <select id="t-vehicle" name="vehicleAssetId" defaultValue="" className={inputCls}>
              <option value="">—</option>
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls} htmlFor="t-startOdometer">
                Start odometer
              </label>
              <input id="t-startOdometer" name="startOdometer" inputMode="decimal" className={inputCls} />
            </div>
            <div>
              <label className={labelCls} htmlFor="t-endOdometer">
                End odometer
              </label>
              <input id="t-endOdometer" name="endOdometer" inputMode="decimal" className={inputCls} />
            </div>
          </div>
          <div>
            <label className={labelCls} htmlFor="t-miles">
              Miles
            </label>
            <input id="t-miles" name="miles" inputMode="decimal" className={inputCls} />
            <p className="mt-1 text-xs text-stone-500">Leave blank to use end − start</p>
          </div>
          <div>
            <label className={labelCls} htmlFor="t-notes">
              Notes
            </label>
            <textarea id="t-notes" name="notes" rows={2} className={inputCls} />
          </div>
          <button type="submit" className={`${btnPrimaryCls} w-full`}>
            Save trip
          </button>
        </form>
      </Card>

      <Card>
        <h2 className="mb-2 font-semibold text-stone-900">Trips ({trips.length})</h2>
        {trips.length === 0 ? (
          <p className="text-sm text-stone-500">No trips yet — log the first one above.</p>
        ) : (
          <div className="divide-y divide-stone-100">
            {trips.map((t) => (
              <div key={t.id} className="flex items-start justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <div className="font-medium text-stone-900">{t.destination}</div>
                  <div className="text-sm text-stone-500">
                    {formatDate(t.date)} · {t.purpose}
                    {t.vehicle ? ` · ${t.vehicle.name}` : ""}
                    {t.customerName ? ` · ${t.customerName}` : ""}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="font-semibold tabular-nums text-stone-900">
                    {fmtMiles(t.miles)} mi
                  </span>
                  <form action={deleteMileage}>
                    <input type="hidden" name="id" value={t.id} />
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
    </div>
  );
}
