"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { parseDateInput, taxYearOf } from "@/lib/dates";
import { parseDollarsToCents } from "@/lib/money";
import { DIVISIONS, TAX_STATUSES } from "@/lib/domain";

function str(v: FormDataEntryValue | null): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

async function expenseDataFromForm(formData: FormData) {
  const date = parseDateInput(formData.get("date")) ?? new Date();
  const amountCents = parseDollarsToCents(formData.get("amount"));
  const description = str(formData.get("description"));
  const division = str(formData.get("division"));
  const accountingCategory = str(formData.get("accountingCategory"));

  if (amountCents == null || !description || !accountingCategory) return null;
  if (!division || !(DIVISIONS as readonly string[]).includes(division)) return null;

  const taxStatus = str(formData.get("taxStatus"));
  const vendorName = str(formData.get("vendorName"));

  // Vendors dedupe by name so reports can group by vendor (SPEC §5).
  let vendorId: string | null = null;
  if (vendorName) {
    const vendor = await prisma.vendor.upsert({
      where: { name: vendorName },
      create: { name: vendorName },
      update: {},
    });
    vendorId = vendor.id;
  }

  return {
    date,
    taxYear: taxYearOf(date),
    amountCents,
    description,
    division,
    accountingCategory,
    vendorId,
    vendorName,
    salesTaxCents: parseDollarsToCents(formData.get("salesTax")),
    paymentMethod: str(formData.get("paymentMethod")),
    managementCategory: str(formData.get("managementCategory")),
    businessPurpose: str(formData.get("businessPurpose")),
    assetId: str(formData.get("assetId")),
    notes: str(formData.get("notes")),
    // Tax-safety principle (SPEC §1): default is NEEDS_REVIEW, never
    // silently "deductible".
    taxStatus:
      taxStatus && (TAX_STATUSES as readonly string[]).includes(taxStatus)
        ? taxStatus
        : "NEEDS_REVIEW",
    isCapital: formData.get("isCapital") === "on",
  };
}

export async function createExpense(formData: FormData) {
  const data = await expenseDataFromForm(formData);
  if (!data) redirect("/expenses/new?error=missing");

  const expense = await prisma.expense.create({ data });

  // Categorizing straight from a receipt links the original document and
  // completes the Inbox → Categorized flow (SPEC §4).
  const fromReceiptId = str(formData.get("fromReceiptId"));
  if (fromReceiptId) {
    await prisma.receipt
      .update({
        where: { id: fromReceiptId },
        data: {
          expenseId: expense.id,
          status: "CATEGORIZED",
          vendorName: data.vendorName ?? undefined,
          totalCents: data.amountCents,
          receiptDate: data.date,
        },
      })
      .catch(() => {}); // receipt may have been archived meanwhile — expense still stands
  }

  redirect(`/expenses/${expense.id}`);
}

export async function updateExpense(formData: FormData) {
  const id = str(formData.get("id"));
  if (!id) redirect("/expenses");
  const data = await expenseDataFromForm(formData);
  if (!data) redirect(`/expenses/${id}/edit?error=missing`);

  await prisma.expense.update({ where: { id }, data });
  redirect(`/expenses/${id}`);
}

export async function deleteExpense(formData: FormData) {
  const id = str(formData.get("id"));
  if (!id) redirect("/expenses");

  // Never orphan documentation silently: linked receipts go back to
  // NEEDS_REVIEW instead of disappearing with the expense.
  await prisma.receipt.updateMany({
    where: { expenseId: id },
    data: { status: "NEEDS_REVIEW" },
  });
  await prisma.expense.delete({ where: { id } });
  redirect("/expenses");
}
