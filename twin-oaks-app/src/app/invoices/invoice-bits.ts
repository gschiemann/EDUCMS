// Derived invoice status — computed from payments + due date, never stored.

export type DerivedStatus = "DRAFT" | "SENT" | "PARTIAL" | "PAID" | "OVERDUE" | "CANCELLED";

export function deriveInvoiceStatus(
  invoice: { status: string; totalCents: number; dueDate: Date | null },
  paidCents: number,
): DerivedStatus {
  if (invoice.status === "CANCELLED") return "CANCELLED";
  if (invoice.status === "DRAFT") return "DRAFT";
  if (invoice.totalCents > 0 && paidCents >= invoice.totalCents) return "PAID";
  if (paidCents > 0) return "PARTIAL";
  if (invoice.dueDate && invoice.dueDate < new Date()) return "OVERDUE";
  return "SENT";
}

export const INVOICE_STATUS_LABELS: Record<DerivedStatus, string> = {
  DRAFT: "Draft",
  SENT: "Sent",
  PARTIAL: "Partially paid",
  PAID: "Paid",
  OVERDUE: "Overdue",
  CANCELLED: "Cancelled",
};

export function invoiceStatusTone(status: DerivedStatus): string {
  switch (status) {
    case "PAID":
      return "green";
    case "PARTIAL":
      return "blue";
    case "OVERDUE":
      return "red";
    case "SENT":
      return "amber";
    default:
      return "stone";
  }
}

// Income category used when an invoice payment lands on the books (SPEC §25).
export function incomeCategoryForDivision(division: string): string {
  switch (division) {
    case "TECH":
      return "3D-printed product sales";
    case "FARM":
      return "Other farm income";
    default:
      return "Other business income";
  }
}

export function paidCentsOf(payments: { amountCents: number }[]): number {
  return payments.reduce((s, p) => s + p.amountCents, 0);
}
