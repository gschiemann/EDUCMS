export function taxStatusTone(status: string): string {
  switch (status) {
    case "LIKELY_BUSINESS":
      return "green";
    case "CAPITAL_ASSET":
      return "blue";
    case "NEEDS_REVIEW":
    case "MIXED_PERSONAL":
      return "amber";
    case "MISSING_DOCS":
      return "red";
    default:
      return "stone";
  }
}
