/**
 * SYNTHETIC EMERGENCY DRILL — configuration (2026-11-01).
 *
 * Design: docs/governance/decisions/2026-10-31-synthetic-emergency-drill-design.md
 * (§4, with the lead's §9 and the owner's §10 defaults). Every variable can
 * only SUBTRACT: an unset, empty, malformed or unknown value never makes more
 * drills happen, never widens the screen list and never starts an email.
 *
 *   EMERGENCY_DRILL_CRON_DISABLED  `1` / `true` / `yes` = off. Beats everything.
 *   EMERGENCY_DRILL_SCREENS        screen UUIDs (comma / space separated), no
 *                                  wildcard, at most 12. UNSET = the job does
 *                                  nothing. A token that is not a UUID is
 *                                  ignored and logged; past 12 the rest are.
 *   EMERGENCY_DRILL_MODE           shadow (default) | alert | on | off. An
 *                                  unknown value reads as shadow (+ an error).
 *   EMERGENCY_DRILL_SCHEDULE       RETIRED AS A SCHEDULE (2026-11-10, the
 *                                  owner's rule): no value starts a drill. A
 *                                  pass runs only at the time a SUPER_ADMIN
 *                                  approves it (guard 0 in the runner). Still
 *                                  parsed; an invalid value = NO drills + an
 *                                  error. Leave it unset.
 *
 * All of it is off under NODE_ENV=test (the runner is driven by hand there).
 *
 * PURE: reads only the env object it is handed.
 */

export type DrillMode = 'shadow' | 'alert' | 'on' | 'off';

export interface DrillSlot {
  /** `HH:MM`, zero-padded — also the slot's key. */
  label: string;
  /** Minutes after local midnight. */
  minuteOfDay: number;
}

export interface DrillConfig {
  /** May the job run at all (tick, orphan sweep, dead-man check)? */
  enabled: boolean;
  /** Why not, when it may not (logged once at boot). */
  disabledReason: string | null;
  mode: DrillMode;
  /** Listed bench screens (validated UUIDs, ≤ 12, first-listed order). */
  screenIds: readonly string[];
  /**
   * The local slots. EMPTY when `EMERGENCY_DRILL_SCHEDULE` is invalid: the job
   * still runs (orphan sweep, the dead-man check that reports the gap) but no
   * drill is ever dispatched.
   */
  slots: readonly DrillSlot[];
  scheduleValid: boolean;
  /** Everything that was ignored or refused, for the boot log. */
  errors: readonly string[];
}

export const DRILL_MAX_SCREENS = 12;
export const DRILL_MAX_SLOTS = 4;
export const DRILL_DEFAULT_SLOT = '10:30';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An env value as text (anything that is not a string reads as unset). */
function text(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function truthy(v: unknown): boolean {
  const s = text(v).trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes';
}

/** `HH:MM` → minutes after midnight, or null. Strict: two digits each side. */
export function parseSlot(raw: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(raw.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export function resolveDrillMode(raw: unknown, errors: string[] = []): DrillMode {
  const s = text(raw).trim().toLowerCase();
  if (!s) return 'shadow';
  if (s === 'shadow' || s === 'alert' || s === 'on' || s === 'off') return s;
  errors.push(`EMERGENCY_DRILL_MODE '${text(raw).slice(0, 40)}' is not shadow|alert|on|off — read as shadow`);
  return 'shadow';
}

export function parseDrillScreens(raw: unknown, errors: string[] = []): string[] {
  const tokens = text(raw)
    .split(/[\s,;]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const t of tokens) {
    if (!UUID.test(t)) {
      errors.push(`EMERGENCY_DRILL_SCREENS: '${t.slice(0, 40)}' is not a screen id — ignored`);
      continue;
    }
    const id = t.toLowerCase();
    if (out.includes(id)) continue;
    if (out.length >= DRILL_MAX_SCREENS) {
      errors.push(`EMERGENCY_DRILL_SCREENS: more than ${DRILL_MAX_SCREENS} screens — '${id}' and later ignored`);
      break;
    }
    out.push(id);
  }
  return out;
}

/** The slots, or null when the variable is set but invalid (= no drills). */
export function parseDrillSchedule(raw: unknown, errors: string[] = []): DrillSlot[] | null {
  const value = text(raw).trim();
  const tokens = (value || DRILL_DEFAULT_SLOT).split(/[\s,;]+/).filter(Boolean);
  if (tokens.length > DRILL_MAX_SLOTS) {
    errors.push(`EMERGENCY_DRILL_SCHEDULE: more than ${DRILL_MAX_SLOTS} slots — no drills will run`);
    return null;
  }
  const slots: DrillSlot[] = [];
  for (const t of tokens) {
    const minute = parseSlot(t);
    if (minute === null) {
      errors.push(`EMERGENCY_DRILL_SCHEDULE: '${t.slice(0, 20)}' is not HH:MM — no drills will run`);
      return null;
    }
    const label = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
    if (!slots.some((s) => s.minuteOfDay === minute)) slots.push({ label, minuteOfDay: minute });
  }
  return slots.sort((a, b) => a.minuteOfDay - b.minuteOfDay);
}

export function readDrillConfig(env: NodeJS.ProcessEnv = process.env): DrillConfig {
  const errors: string[] = [];
  const mode = resolveDrillMode(env.EMERGENCY_DRILL_MODE, errors);
  const screenIds = parseDrillScreens(env.EMERGENCY_DRILL_SCREENS, errors);
  const slots = parseDrillSchedule(env.EMERGENCY_DRILL_SCHEDULE, errors);
  const build = (enabled: boolean, disabledReason: string | null): DrillConfig =>
    Object.freeze({
      enabled,
      disabledReason,
      mode,
      screenIds: Object.freeze([...screenIds]),
      slots: Object.freeze([...(slots ?? [])]),
      scheduleValid: slots !== null,
      errors: Object.freeze([...errors]),
    });
  // Order = precedence: the kill switch beats everything.
  if (truthy(env.EMERGENCY_DRILL_CRON_DISABLED)) return build(false, 'EMERGENCY_DRILL_CRON_DISABLED');
  if (String(env.NODE_ENV ?? '') === 'test') return build(false, 'NODE_ENV=test');
  if (mode === 'off') return build(false, 'EMERGENCY_DRILL_MODE=off');
  if (screenIds.length === 0) return build(false, 'EMERGENCY_DRILL_SCREENS unset (no screens listed)');
  return build(true, null);
}
