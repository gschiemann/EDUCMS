import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

// SPEC §32: export/backup capability — never rely on one copy of anything.
// Full JSON dump of every table (file originals live in the uploads dir /
// object storage; their storage keys are included here).
export async function GET() {
  const [vendors, receipts, expenses, incomes, assets, maintenance] = await Promise.all([
    prisma.vendor.findMany(),
    prisma.receipt.findMany(),
    prisma.expense.findMany(),
    prisma.income.findMany(),
    prisma.asset.findMany(),
    prisma.maintenanceRecord.findMany(),
  ]);

  const backup = {
    app: "twin-oaks-os",
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    counts: {
      vendors: vendors.length,
      receipts: receipts.length,
      expenses: expenses.length,
      incomes: incomes.length,
      assets: assets.length,
      maintenance: maintenance.length,
    },
    data: { vendors, receipts, expenses, incomes, assets, maintenance },
  };

  const date = new Date().toISOString().slice(0, 10);
  return new Response(JSON.stringify(backup, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="twin-oaks-backup-${date}.json"`,
    },
  });
}
