/**
 * SYNTHETIC EMERGENCY DRILL — process-local state (2026-11-01).
 *
 * Plain module state, not a provider, for the same reason
 * `health/platform-degradation.ts` is one: its readers (the customer alert
 * emails' `recordEmergency`) live in another module and must be able to ask
 * without an injection. Two facts live here:
 *
 *   1. MINTED IDS. The drill runner mints the OVERRIDE id itself
 *      (`ovr_drill_<uuid>`) and registers it BEFORE it calls the trigger, so
 *      `CustomerAlertEmailsService.recordEmergency` — called synchronously by
 *      the controller after the trigger's writes — can recognise the runner's
 *      own drill and skip the customer record copy. Only ids THIS process
 *      minted, only for 15 minutes, and the skip also requires the trigger's
 *      own `isDrill === true`: an id that merely LOOKS like a drill id, a live
 *      alert, or anything another process sent always gets its copy.
 *   2. RUNS IN FLIGHT here (serial by construction; the orphan sweep never
 *      touches a run this process is still driving).
 *
 * Everything another replica needs (the customer-alert defer window, the
 * dead-man check, the canary hold, the orphan sweep) reads the append-only
 * audit rows instead — those are shared; this is not.
 */
import { randomUUID } from 'crypto';

export const DRILL_ID_PREFIX = 'ovr_drill_';
/** How long a minted id is recognised (a run is ≤ ~6 min; the email is queued at its trigger / clear). */
export const DRILL_ID_TTL_MS = 15 * 60_000;

const minted = new Map<string, number>();
const inFlight = new Map<string, { screenIds: readonly string[]; startedAtMs: number }>();

function prune(nowMs: number): void {
  for (const [id, at] of minted) if (nowMs - at > DRILL_ID_TTL_MS) minted.delete(id);
}

/** Mint and register a drill override id. */
export function mintDrillOverrideId(nowMs = Date.now()): string {
  const id = `${DRILL_ID_PREFIX}${randomUUID()}`;
  prune(nowMs);
  minted.set(id, nowMs);
  return id;
}

/**
 * Did THIS process mint `id` for a synthetic drill in the last 15 minutes?
 * The prefix alone never qualifies — the id must be in the registry.
 */
export function isRunnerMintedDrillId(id: unknown, nowMs = Date.now()): boolean {
  if (typeof id !== 'string' || !id.startsWith(DRILL_ID_PREFIX)) return false;
  const at = minted.get(id);
  return at !== undefined && nowMs - at <= DRILL_ID_TTL_MS;
}

export function markRunInFlight(runId: string, screenIds: readonly string[], nowMs = Date.now()): void {
  inFlight.set(runId, { screenIds: [...screenIds], startedAtMs: nowMs });
}

export function clearRunInFlight(runId: string): void {
  inFlight.delete(runId);
}

export function isRunInFlightHere(runId: string): boolean {
  return inFlight.has(runId);
}

export function runsInFlightHere(): number {
  return inFlight.size;
}

/** Test hook. */
export function resetSyntheticDrillRegistryForTests(): void {
  minted.clear();
  inFlight.clear();
}
