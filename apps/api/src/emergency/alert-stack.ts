/**
 * ONE ROW PER SCREEN, SEVERAL ALERTS — the bookkeeping behind "each alert has
 * its own all-clear" (alert targeting, 2026-10-05).
 *
 * THE CONSTRAINT. A screen's emergency state is ONE `ScreenEmergencyOverride`
 * row (`screenId` is unique), and the manifest reads exactly that row — it is
 * the HTTP backstop every screen polls and the only thing Player 1.1.22's
 * native panel-off watch reads. That stays exactly as it is.
 *
 * THE PROBLEM IT CREATED once an operator can aim an alert at all screens, a
 * group, or one screen: two alerts can cover the same screen, and the row did
 * not say which alert wrote it. So an all-clear could only ever mean "delete
 * this screen's row" — and clearing a one-screen medical alert inside an
 * active gym lockdown put that gym screen back on the lunch menu, while
 * clearing the building-wide weather alert silently ended the nurse's medical
 * alert. Measured by `emergency.targeting.spec.ts` before this module existed.
 *
 * THE RULE THIS MODULE IMPLEMENTS, in one sentence an operator can hold:
 *   **A screen shows the newest alert aimed at it; ending an alert returns
 *   each of its screens to the next-newest alert still aimed at it, or to
 *   normal content.**
 * Two refinements:
 *   • A new alert on the SAME target replaces the old one rather than stacking
 *     on it (escalating the gym from Hold to Lockdown ends the Hold — clearing
 *     the Lockdown must not bring a stale Hold back). Same rule the tenant-wide
 *     alert has always followed: one slot per target.
 *   • The row carries the alerts it is covering as `displaced` (newest first).
 *     That is what makes "returns to the next-newest" exact — no guessing from
 *     group membership at all-clear time, which would be wrong for any screen
 *     moved between groups mid-incident.
 *
 * FAIL-SAFE DIRECTION. Every ambiguity resolves toward KEEPING an alert on
 * glass: an unreadable `displaced` value parses to "nothing covered" (the row
 * itself still alerts), an entry whose identity cannot be matched is never
 * removed by somebody else's all-clear, and the stack is bounded so a pathological
 * history cannot grow a row without limit (`MAX_DISPLACED_ALERTS` — nine
 * different overlapping alerts on one screen before the oldest is dropped).
 *
 * PURE AND PRISMA-FREE — same discipline as `screen-faces.ts` and
 * `effective-schedule.ts` — so every rule above is a microsecond unit test.
 */

/** The scopes an alert can be aimed at. */
export type AlertScopeType = 'tenant' | 'group' | 'device';

/**
 * One alert as it applies to one screen: the content columns of a
 * `ScreenEmergencyOverride` row plus who sent it where. Dates travel as ISO
 * strings so the same shape round-trips through the JSON `displaced` column.
 */
export interface OverrideEntry {
  /** The trigger's overrideId. Null on rows written before 2026-10-05 or by a
   *  writer that predates targeting (GPIO input, the floor-plan endpoint). */
  alertId: string | null;
  scopeType: string | null;
  scopeId: string | null;
  type: string;
  severity: string;
  scopeNote: string | null;
  playlistId: string | null;
  mediaUrl: string | null;
  textBlob: string | null;
  floorPlanId: string | null;
  floorZoneId: string | null;
  scenarioId: string | null;
  triggeredByUserId: string;
  triggeredAt: string;
  expiresAt: string | null;
}

/** Most alerts one row will remember underneath the one it shows. */
export const MAX_DISPLACED_ALERTS = 8;

/** The row columns an entry occupies (what a create/update writes). */
export interface OverrideColumns {
  alertId: string | null;
  scopeType: string | null;
  scopeId: string | null;
  type: string;
  severity: string;
  scopeNote: string | null;
  playlistId: string | null;
  mediaUrl: string | null;
  textBlob: string | null;
  floorPlanId: string | null;
  floorZoneId: string | null;
  scenarioId: string | null;
  triggeredByUserId: string;
  triggeredAt: Date;
  expiresAt: Date | null;
  displaced: OverrideEntry[];
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

function isoOf(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  const d = v instanceof Date ? v : new Date(v as any);
  const t = d.getTime();
  return Number.isFinite(t) ? d.toISOString() : null;
}

/** Read a DB row (or a stored entry) into an entry. Never throws. */
export function entryFromRow(row: any): OverrideEntry {
  return {
    alertId: str(row?.alertId),
    scopeType: str(row?.scopeType),
    scopeId: str(row?.scopeId),
    type: str(row?.type) ?? 'CUSTOM',
    severity: str(row?.severity) ?? 'HIGH',
    scopeNote: str(row?.scopeNote),
    playlistId: str(row?.playlistId),
    mediaUrl: str(row?.mediaUrl),
    textBlob: str(row?.textBlob),
    floorPlanId: str(row?.floorPlanId),
    floorZoneId: str(row?.floorZoneId),
    scenarioId: str(row?.scenarioId),
    triggeredByUserId: str(row?.triggeredByUserId) ?? 'admin_system',
    triggeredAt: isoOf(row?.triggeredAt) ?? new Date(0).toISOString(),
    expiresAt: isoOf(row?.expiresAt),
  };
}

/**
 * Tolerant reader for the `displaced` JSON column. Anything that is not an
 * array of objects reads as "covering nothing" — the row's own alert is
 * untouched, so a damaged value can lose history but never an alert on glass.
 */
export function parseDisplaced(value: unknown): OverrideEntry[] {
  if (!Array.isArray(value)) return [];
  const out: OverrideEntry[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    if (!str((item as any).type)) continue;
    out.push(entryFromRow(item));
    if (out.length >= MAX_DISPLACED_ALERTS) break;
  }
  return out;
}

/** An entry whose `expiresAt` has passed no longer belongs on glass. */
export function isEntryExpired(e: OverrideEntry, now: number = Date.now()): boolean {
  if (!e.expiresAt) return false;
  const t = Date.parse(e.expiresAt);
  return Number.isFinite(t) && t < now;
}

function columnsOf(e: OverrideEntry, displaced: OverrideEntry[]): OverrideColumns {
  return {
    alertId: e.alertId,
    scopeType: e.scopeType,
    scopeId: e.scopeId,
    type: e.type,
    severity: e.severity,
    scopeNote: e.scopeNote,
    playlistId: e.playlistId,
    mediaUrl: e.mediaUrl,
    textBlob: e.textBlob,
    floorPlanId: e.floorPlanId,
    floorZoneId: e.floorZoneId,
    scenarioId: e.scenarioId,
    triggeredByUserId: e.triggeredByUserId,
    triggeredAt: new Date(e.triggeredAt),
    expiresAt: e.expiresAt ? new Date(e.expiresAt) : null,
    displaced,
  };
}

/**
 * Put `incoming` on a screen that currently holds `existing` (or nothing).
 *
 * The screen shows `incoming` (newest wins). Whatever it was showing — and
 * whatever that was covering — is remembered underneath, EXCEPT alerts aimed
 * at the same target as `incoming` (replaced, see the module header), the
 * same alert written twice, and anything already expired.
 *
 * Returns the columns to write and the ids of alerts this write REPLACED, so
 * the trigger's audit row can say "escalated from Hold".
 */
export function placeAlert(
  existing: any | null | undefined,
  incoming: OverrideEntry,
  sameTarget: (e: OverrideEntry) => boolean,
  now: number = Date.now(),
): { columns: OverrideColumns; replacedAlertIds: string[] } {
  const prior: OverrideEntry[] = existing
    ? [entryFromRow(existing), ...parseDisplaced(existing.displaced)]
    : [];
  const replacedAlertIds: string[] = [];
  const kept: OverrideEntry[] = [];
  for (const e of prior) {
    if (incoming.alertId && e.alertId === incoming.alertId) continue;
    if (sameTarget(e)) {
      if (e.alertId && !replacedAlertIds.includes(e.alertId)) replacedAlertIds.push(e.alertId);
      continue;
    }
    if (isEntryExpired(e, now)) continue;
    kept.push(e);
  }
  return {
    columns: columnsOf(incoming, kept.slice(0, MAX_DISPLACED_ALERTS)),
    replacedAlertIds,
  };
}

export type ClearPlan =
  /** The cleared alert is not on this row at all. */
  | { kind: 'keep' }
  /** The cleared alert was the last one on this screen. */
  | { kind: 'delete' }
  /**
   * Rewrite the row. `restored` is set when the screen now shows an older
   * alert it had been covering (the cleared one was on top); null when only
   * the hidden history changed.
   */
  | { kind: 'update'; columns: OverrideColumns; restored: OverrideEntry | null };

/**
 * Remove every entry `isCleared` matches from this screen's row.
 *
 * If the alert being shown is cleared, the screen falls back to the newest
 * alert it was covering that is neither cleared nor expired; with none left
 * the row goes away. Nothing outside `isCleared` is ever removed.
 */
export function clearAlert(
  row: any,
  isCleared: (e: OverrideEntry) => boolean,
  now: number = Date.now(),
): ClearPlan {
  const top = entryFromRow(row);
  const covered = parseDisplaced(row?.displaced);
  const topCleared = isCleared(top);
  const anyCoveredCleared = covered.some((e) => isCleared(e));
  if (!topCleared && !anyCoveredCleared) return { kind: 'keep' };

  const remaining = covered.filter((e) => !isCleared(e) && !isEntryExpired(e, now));
  if (!topCleared) {
    return { kind: 'update', columns: columnsOf(top, remaining), restored: null };
  }
  if (remaining.length === 0) return { kind: 'delete' };
  const [next, ...rest] = remaining;
  return { kind: 'update', columns: columnsOf(next, rest), restored: next };
}

/** Every entry on a row: the one shown, then what it is covering. */
export function entriesOfRow(row: any): OverrideEntry[] {
  return [entryFromRow(row), ...parseDisplaced(row?.displaced)];
}
