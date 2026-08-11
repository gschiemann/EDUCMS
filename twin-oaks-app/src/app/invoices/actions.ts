"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { parseDateInput, taxYearOf } from "@/lib/dates";
import { formatCents, parseDollarsToCents } from "@/lib/money";
import { DIVISIONS } from "@/lib/domain";
import { incomeCategoryForDivision } from "./invoice-bits";

function str(v: FormDataEntryValue | null): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

type ParsedLine = {
  sortOrder: number;
  description: string;
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
};

// The lines editor posts fields named line-desc-<k>, line-qty-<k>,
// line-price-<k> — collect them in key order.
function parseLines(formData: FormData): ParsedLine[] {
  const keys: string[] = [];
  for (const key of formData.keys()) {
    const m = key.match(/^line-desc-(\d+)$/);
    if (m) keys.push(m[1]);
  }
  keys.sort((a, b) => Number(a) - Number(b));

  const lines: ParsedLine[] = [];
  for (const k of keys) {
    const description = str(formData.get(`line-desc-${k}`));
    if (!description) continue;
    const qtyRaw = str(formData.get(`line-qty-${k}`));
    const quantity = qtyRaw != null && Number.isFinite(Number(qtyRaw)) ? Number(qtyRaw) : 1;
    const unitPriceCents = parseDollarsToCents(formData.get(`line-price-${k}`)) ?? 0;
    lines.push({
      sortOrder: lines.length,
      description,
      quantity,
      unitPriceCents,
      totalCents: Math.round(quantity * unitPriceCents),
    });
  }
  return lines;
}

async function invoiceCoreFromForm(formData: FormData) {
  const customerId = str(formData.get("customerId"));
  const division = str(formData.get("division"));
  if (!customerId || !division || !(DIVISIONS as readonly string[]).includes(division)) {
    return null;
  }
  const lines = parseLines(formData);
  if (lines.length === 0) return null;

  const issueDate = parseDateInput(formData.get("issueDate")) ?? new Date();
  const subtotalCents = lines.reduce((s, l) => s + l.totalCents, 0);
  const salesTaxCents = parseDollarsToCents(formData.get("salesTax")) ?? 0;

  return {
    core: {
      customerId,
      division,
      issueDate,
      taxYear: taxYearOf(issueDate),
      dueDate: parseDateInput(formData.get("dueDate")),
      terms: str(formData.get("terms")),
      notes: str(formData.get("notes")),
      subtotalCents,
      salesTaxCents,
      totalCents: subtotalCents + salesTaxCents,
    },
    lines,
  };
}

async function nextInvoiceNumber(): Promise<string> {
  const count = await prisma.invoice.count();
  for (let n = count + 1; n < count + 50; n++) {
    const number = `INV-${String(n).padStart(3, "0")}`;
    const exists = await prisma.invoice.findUnique({ where: { number } });
    if (!exists) return number;
  }
  return `INV-${Date.now()}`;
}

export async function createInvoice(formData: FormData) {
  const parsed = await invoiceCoreFromForm(formData);
  if (!parsed) redirect("/invoices/new?error=missing");

  const number = await nextInvoiceNumber();
  const invoice = await prisma.invoice.create({
    data: {
      number,
      ...parsed.core,
      lines: { create: parsed.lines },
    },
  });
  redirect(`/invoices/${invoice.id}`);
}

// Draft invoices are fully editable; once sent they're financial records.
export async function updateInvoice(formData: FormData) {
  const id = str(formData.get("id"));
  if (!id) redirect("/invoices");
  const invoice = await prisma.invoice.findUnique({ where: { id } });
  if (!invoice) redirect("/invoices");
  if (invoice.status !== "DRAFT") redirect(`/invoices/${id}?error=not-draft`);

  const parsed = await invoiceCoreFromForm(formData);
  if (!parsed) redirect(`/invoices/${id}/edit?error=missing`);

  await prisma.$transaction([
    prisma.invoiceLine.deleteMany({ where: { invoiceId: id } }),
    prisma.invoice.update({
      where: { id },
      data: { ...parsed.core, lines: { create: parsed.lines } },
    }),
  ]);
  redirect(`/invoices/${id}`);
}

export async function setInvoiceStatus(formData: FormData) {
  const id = str(formData.get("id"));
  const to = str(formData.get("to"));
  if (!id || !to) redirect("/invoices");

  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: { payments: { select: { id: true } } },
  });
  if (!invoice) redirect("/invoices");

  const hasPayments = invoice.payments.length > 0;
  const allowed =
    (to === "SENT" && invoice.status === "DRAFT") ||
    (to === "DRAFT" && invoice.status === "SENT" && !hasPayments) ||
    (to === "CANCELLED" && !hasPayments);

  if (allowed) {
    await prisma.invoice.update({ where: { id }, data: { status: to } });
  }
  redirect(`/invoices/${id}`);
}

export async function deleteInvoice(formData: FormData) {
  const id = str(formData.get("id"));
  if (!id) redirect("/invoices");
  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: { payments: { select: { id: true } } },
  });
  if (invoice && invoice.status === "DRAFT" && invoice.payments.length === 0) {
    await prisma.invoice.delete({ where: { id } });
  }
  redirect("/invoices");
}

// Recording a payment puts it on the books automatically: an Income row is
// created (division-appropriate category) and linked — no double entry.
export async function recordPayment(formData: FormData) {
  const invoiceId = str(formData.get("invoiceId"));
  if (!invoiceId) redirect("/invoices");

  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { customer: true },
  });
  if (!invoice) redirect("/invoices");
  if (invoice.status === "CANCELLED") redirect(`/invoices/${invoiceId}?error=cancelled`);

  const amountCents = parseDollarsToCents(formData.get("amount"));
  if (amountCents == null || amountCents <= 0) {
    redirect(`/invoices/${invoiceId}?error=amount`);
  }
  const date = parseDateInput(formData.get("date")) ?? new Date();
  const method = str(formData.get("method"));

  const income = await prisma.income.create({
    data: {
      date,
      taxYear: taxYearOf(date),
      source: invoice.customer.name,
      description: `Invoice ${invoice.number} — ${invoice.customer.name} (${formatCents(amountCents)})`,
      amountCents,
      division: invoice.division,
      category: incomeCategoryForDivision(invoice.division),
      paymentMethod: method,
      notes: str(formData.get("notes")),
    },
  });

  await prisma.payment.create({
    data: {
      invoiceId,
      customerId: invoice.customerId,
      date,
      amountCents,
      method,
      checkNumber: str(formData.get("checkNumber")),
      notes: str(formData.get("notes")),
      incomeId: income.id,
    },
  });

  // First payment on a draft flips it to sent — the money is real either way.
  if (invoice.status === "DRAFT") {
    await prisma.invoice.update({ where: { id: invoiceId }, data: { status: "SENT" } });
  }

  redirect(`/invoices/${invoiceId}`);
}

export async function deletePayment(formData: FormData) {
  const id = str(formData.get("id"));
  const invoiceId = str(formData.get("invoiceId"));
  if (id) {
    const payment = await prisma.payment.findUnique({ where: { id } });
    if (payment) {
      await prisma.payment.delete({ where: { id } });
      if (payment.incomeId) {
        await prisma.income.delete({ where: { id: payment.incomeId } }).catch(() => {});
      }
    }
  }
  redirect(invoiceId ? `/invoices/${invoiceId}` : "/invoices");
}
