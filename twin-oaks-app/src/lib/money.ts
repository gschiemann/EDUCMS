// All money is stored as integer cents — never floats.

export function formatCents(cents: number | null | undefined): string {
  if (cents == null) return "—";
  const dollars = cents / 100;
  return dollars.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

// Parses "1,234.56", "$87.42", "87" → cents. Returns null for empty/invalid.
export function parseDollarsToCents(input: FormDataEntryValue | null): number | null {
  if (typeof input !== "string") return null;
  const cleaned = input.replace(/[$,\s]/g, "");
  if (cleaned === "") return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100);
}
