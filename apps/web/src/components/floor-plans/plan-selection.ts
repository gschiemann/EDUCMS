/**
 * Which floor plan should be selected, given the plans that currently exist.
 *
 * 2026-08-25 — the emergency page mounts the floor-plan drawer inline and the
 * operator can now delete the plan they're standing on. That deletion has to
 * leave the drawer showing something real: the next plan, or the "add your
 * first floor plan" empty state. Never a blank pane, and never the id that
 * was just removed (which renders "Floor plan not found").
 *
 * Pure so the rule can be tested without mounting the page — the host is
 * responsible for retiring a deleted id from the list it passes in, because
 * the cached list still contains it until the refetch lands.
 */
export function selectionAfterPlans<T extends { id: string }>(
  plans: T[],
  current: string | null,
): string | null {
  if (plans.length === 0) return null;
  if (current && plans.some((p) => p.id === current)) return current;
  return plans[0].id;
}
