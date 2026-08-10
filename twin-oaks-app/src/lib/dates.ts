export function taxYearOf(date: Date): number {
  return date.getFullYear();
}

export function formatDate(date: Date | null | undefined): string {
  if (!date) return "—";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function toDateInputValue(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// Parses an <input type="date"> value ("2026-08-10") as local noon so the
// calendar day never shifts across timezones.
export function parseDateInput(input: FormDataEntryValue | null): Date | null {
  if (typeof input !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input)) return null;
  const [y, m, d] = input.split("-").map(Number);
  return new Date(y, m - 1, d, 12, 0, 0);
}

export function startOfMonth(now = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

export function startOfYear(now = new Date()): Date {
  return new Date(now.getFullYear(), 0, 1);
}
