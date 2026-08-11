// Sample data so the app renders with life on first run.
// Run: pnpm db:seed (wipes and re-creates — dev only).

import { PrismaClient } from "@prisma/client";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const prisma = new PrismaClient();

// 1×1 gray PNG — stands in for a receipt photo in dev.
const PLACEHOLDER_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

async function main() {
  // Wipe (dev only) — order matters for relations.
  await prisma.maintenanceRecord.deleteMany();
  await prisma.receipt.deleteMany();
  await prisma.expense.deleteMany();
  await prisma.income.deleteMany();
  await prisma.asset.deleteMany();
  await prisma.vendor.deleteMany();

  const uploadDir = path.resolve(process.cwd(), process.env.UPLOAD_DIR || "var/uploads");
  await mkdir(uploadDir, { recursive: true });
  for (const name of ["seed-receipt-1.png", "seed-receipt-2.png", "seed-receipt-3.png"]) {
    await writeFile(path.join(uploadDir, name), PLACEHOLDER_PNG);
  }

  const vendorNames = [
    "Tractor Supply Co",
    "Rural King",
    "Bambu Lab",
    "Valley Veterinary Clinic",
    "Miller Farm & Fleet",
    "Amazon",
  ];
  const vendors: Record<string, string> = {};
  for (const name of vendorNames) {
    const v = await prisma.vendor.create({ data: { name } });
    vendors[name] = v.id;
  }

  const tractor = await prisma.asset.create({
    data: {
      name: "Tractor #1",
      assetTag: "TO-EQ-001",
      kind: "Tractor",
      division: "FARM",
      manufacturer: "Kubota",
      model: "L3902",
      year: 2024,
      purchaseDate: new Date(2024, 3, 12, 12),
      purchasePriceCents: 3249900,
      purchasedFrom: "Miller Farm & Fleet",
      financingNotes: "0% for 60 months",
      warrantyNotes: "2-year full / 6-year powertrain",
      currentHours: 412,
      notes: "Primary loader tractor.",
    },
  });

  const printer = await prisma.asset.create({
    data: {
      name: "Bambu H2D #1",
      assetTag: "TO-EQ-010",
      kind: "3D printer",
      division: "TECH",
      manufacturer: "Bambu Lab",
      model: "H2D",
      year: 2026,
      purchaseDate: new Date(2026, 1, 3, 12),
      purchasePriceCents: 219900,
      purchasedFrom: "Bambu Lab",
      currentHours: 640,
      notes: "Main production printer.",
    },
  });

  await prisma.asset.create({
    data: {
      name: "Stock Trailer",
      assetTag: "TO-EQ-002",
      kind: "Trailer",
      division: "FARM",
      manufacturer: "W-W",
      year: 2019,
      currentMileage: 18400,
    },
  });

  // --- Expenses -----------------------------------------------------------
  // SPEC §26's canonical example: 2026 → Farm → Repairs & Maintenance →
  // Tractor #1 → Hydraulic hose → $87.42 → View receipt.
  const hydraulicHose = await prisma.expense.create({
    data: {
      date: new Date(2026, 6, 18, 12),
      taxYear: 2026,
      vendorId: vendors["Tractor Supply Co"],
      vendorName: "Tractor Supply Co",
      description: "Hydraulic hose",
      amountCents: 8742,
      salesTaxCents: 612,
      paymentMethod: "Card",
      division: "FARM",
      accountingCategory: "Repairs & maintenance",
      managementCategory: "Farm Equipment > Tractor #1 > Hydraulic system",
      businessPurpose: "Repair loader hydraulics on primary tractor",
      assetId: tractor.id,
      taxStatus: "LIKELY_BUSINESS",
    },
  });

  await prisma.receipt.create({
    data: {
      status: "CATEGORIZED",
      filePath: "seed-receipt-1.png",
      fileName: "tractor-supply-hose.png",
      mimeType: "image/png",
      fileSize: PLACEHOLDER_PNG.byteLength,
      vendorName: "Tractor Supply Co",
      receiptDate: new Date(2026, 6, 18, 12),
      totalCents: 8742,
      salesTaxCents: 612,
      paymentMethod: "Card",
      expenseId: hydraulicHose.id,
    },
  });

  await prisma.maintenanceRecord.create({
    data: {
      assetId: tractor.id,
      date: new Date(2026, 6, 18, 12),
      hoursAtService: 408,
      category: "Hydraulic components",
      description: "Replaced cracked loader hydraulic hose, topped off fluid",
      partsCostCents: 8742,
      vendorName: "Self",
      expenseId: hydraulicHose.id,
    },
  });

  await prisma.maintenanceRecord.create({
    data: {
      assetId: tractor.id,
      date: new Date(2026, 4, 2, 12),
      hoursAtService: 380,
      category: "Oil & filters",
      description: "50-hour service — oil, oil filter, grease all zerks",
      partsCostCents: 5418,
      vendorName: "Self",
    },
  });

  await prisma.maintenanceRecord.create({
    data: {
      assetId: printer.id,
      date: new Date(2026, 6, 30, 12),
      hoursAtService: 620,
      category: "Nozzles & hotends (printer)",
      description: "Swapped 0.4mm nozzle after clog",
      partsCostCents: 1499,
      vendorName: "Bambu Lab",
    },
  });

  const simpleExpenses: Array<{
    date: Date;
    vendor: string;
    description: string;
    amountCents: number;
    division: string;
    accountingCategory: string;
    managementCategory?: string;
    businessPurpose?: string;
    assetId?: string;
    taxStatus?: string;
    isCapital?: boolean;
  }> = [
    {
      date: new Date(2026, 7, 2, 12),
      vendor: "Rural King",
      description: "Sheep feed + mineral blocks",
      amountCents: 18650,
      division: "FARM",
      accountingCategory: "Feed",
      managementCategory: "Livestock > Feed",
      businessPurpose: "Flock feed",
      taxStatus: "LIKELY_BUSINESS",
    },
    {
      date: new Date(2026, 7, 5, 12),
      vendor: "Valley Veterinary Clinic",
      description: "Lamb checkup + dewormer",
      amountCents: 14200,
      division: "FARM",
      accountingCategory: "Veterinary",
      managementCategory: "Livestock > Veterinary care",
      taxStatus: "LIKELY_BUSINESS",
    },
    {
      date: new Date(2026, 7, 1, 12),
      vendor: "Bambu Lab",
      description: "PLA filament — 6 spools",
      amountCents: 11994,
      division: "TECH",
      accountingCategory: "Supplies",
      managementCategory: "Tech > Filament",
      businessPurpose: "Production stock for customer jobs",
      taxStatus: "LIKELY_BUSINESS",
    },
    {
      date: new Date(2026, 6, 25, 12),
      vendor: "Miller Farm & Fleet",
      description: "Fence posts + woven wire",
      amountCents: 32485,
      division: "FARM",
      accountingCategory: "Repairs & maintenance",
      managementCategory: "Property > Fencing & gates",
      businessPurpose: "East pasture fence repair",
      taxStatus: "LIKELY_BUSINESS",
    },
    {
      date: new Date(2026, 6, 10, 12),
      vendor: "Amazon",
      description: "Digital calipers",
      amountCents: 3299,
      division: "TECH",
      accountingCategory: "Supplies",
      managementCategory: "Tech > Tools & measuring",
      taxStatus: "NEEDS_REVIEW",
    },
    {
      date: new Date(2026, 1, 3, 12),
      vendor: "Bambu Lab",
      description: "Bambu H2D printer",
      amountCents: 219900,
      division: "TECH",
      accountingCategory: "Depreciable assets",
      managementCategory: "Tech > Printers",
      businessPurpose: "Production capacity",
      assetId: printer.id,
      taxStatus: "CAPITAL_ASSET",
      isCapital: true,
    },
  ];

  for (const e of simpleExpenses) {
    await prisma.expense.create({
      data: {
        date: e.date,
        taxYear: e.date.getFullYear(),
        vendorId: vendors[e.vendor],
        vendorName: e.vendor,
        description: e.description,
        amountCents: e.amountCents,
        division: e.division,
        accountingCategory: e.accountingCategory,
        managementCategory: e.managementCategory,
        businessPurpose: e.businessPurpose,
        assetId: e.assetId,
        taxStatus: e.taxStatus ?? "NEEDS_REVIEW",
        isCapital: e.isCapital ?? false,
      },
    });
  }

  // Two receipts waiting in the Inbox (the daily-driver flow).
  await prisma.receipt.create({
    data: {
      status: "INBOX",
      filePath: "seed-receipt-2.png",
      fileName: "rural-king-aug.png",
      mimeType: "image/png",
      fileSize: PLACEHOLDER_PNG.byteLength,
      vendorName: "Rural King",
      receiptDate: new Date(2026, 7, 8, 12),
      totalCents: 4327,
    },
  });
  await prisma.receipt.create({
    data: {
      status: "INBOX",
      filePath: "seed-receipt-3.png",
      fileName: "gas-station.png",
      mimeType: "image/png",
      fileSize: PLACEHOLDER_PNG.byteLength,
      notes: "Diesel for tractor — snap from the truck",
      receiptDate: new Date(2026, 7, 9, 12),
    },
  });

  // --- Income -------------------------------------------------------------
  await prisma.income.create({
    data: {
      date: new Date(2026, 7, 4, 12),
      taxYear: 2026,
      source: "Acme Fabrication",
      description: "20 custom mounting brackets",
      amountCents: 34000,
      division: "TECH",
      category: "3D-printed product sales",
      paymentMethod: "Bank transfer",
    },
  });
  await prisma.income.create({
    data: {
      date: new Date(2026, 6, 20, 12),
      taxYear: 2026,
      source: "Hartley family",
      description: "Two market lambs",
      amountCents: 67500,
      division: "FARM",
      category: "Livestock sales",
      paymentMethod: "Check",
    },
  });

  // --- V2: customers, invoices, payments, mileage -------------------------
  const acme = await prisma.customer.create({
    data: {
      name: "Dana Reyes",
      company: "Acme Fabrication",
      phone: "555-201-8890",
      email: "dana@acmefab.example",
      address: "412 Industrial Way\nSpringfield",
      notes: "Prefers PETG. Net-14 terms.",
    },
  });
  const hartley = await prisma.customer.create({
    data: { name: "Jane Hartley", phone: "555-330-1121", notes: "Buys market lambs each summer." },
  });

  const inv1 = await prisma.invoice.create({
    data: {
      number: "INV-001",
      customerId: acme.id,
      division: "TECH",
      status: "SENT",
      issueDate: new Date(2026, 7, 4, 12),
      dueDate: new Date(2026, 7, 18, 12),
      terms: "Due in 14 days",
      taxYear: 2026,
      subtotalCents: 34000,
      salesTaxCents: 0,
      totalCents: 34000,
      lines: {
        create: [
          {
            sortOrder: 0,
            description: "Custom mounting brackets, PETG",
            quantity: 20,
            unitPriceCents: 1700,
            totalCents: 34000,
          },
        ],
      },
    },
  });
  const inv1Income = await prisma.income.create({
    data: {
      date: new Date(2026, 7, 6, 12),
      taxYear: 2026,
      source: "Acme Fabrication",
      description: "Invoice INV-001 — Acme Fabrication ($340.00)",
      amountCents: 34000,
      division: "TECH",
      category: "3D-printed product sales",
      paymentMethod: "Bank transfer",
    },
  });
  await prisma.payment.create({
    data: {
      invoiceId: inv1.id,
      customerId: acme.id,
      date: new Date(2026, 7, 6, 12),
      amountCents: 34000,
      method: "Bank transfer",
      incomeId: inv1Income.id,
    },
  });

  await prisma.invoice.create({
    data: {
      number: "INV-002",
      customerId: hartley.id,
      division: "FARM",
      status: "SENT",
      issueDate: new Date(2026, 7, 9, 12),
      dueDate: new Date(2026, 7, 23, 12),
      terms: "Due on pickup",
      taxYear: 2026,
      subtotalCents: 67500,
      salesTaxCents: 0,
      totalCents: 67500,
      lines: {
        create: [
          {
            sortOrder: 0,
            description: "Market lambs (2)",
            quantity: 2,
            unitPriceCents: 33750,
            totalCents: 67500,
          },
        ],
      },
    },
  });

  await prisma.mileageLog.create({
    data: {
      date: new Date(2026, 7, 2, 12),
      startLocation: "Farm",
      destination: "Rural King, Springfield",
      purpose: "Feed + mineral pickup",
      startOdometer: 48210,
      endOdometer: 48252,
      miles: 42,
      taxYear: 2026,
    },
  });
  await prisma.mileageLog.create({
    data: {
      date: new Date(2026, 7, 6, 12),
      destination: "Acme Fabrication",
      purpose: "Deliver bracket order",
      customerName: "Acme Fabrication",
      miles: 18.4,
      taxYear: 2026,
    },
  });

  console.log(
    "Seeded: 6 vendors, 3 assets, 7 expenses, 3 income, 3 receipts, 3 maintenance records, 2 customers, 2 invoices (1 paid), 2 mileage trips.",
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
