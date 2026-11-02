/**
 * Bulk selection on the Screens page (2026-10-11) — the pure half.
 *
 * Greg: "If I want to manually push a resync, an update of the player, allow
 * me to do a select-all and push — by group at least."
 *
 * The selection follows the app's ONE select-all pattern
 * (components/common/SelectionCheckbox.tsx): a tri-state box over what is
 * SHOWN (filters + search applied), a box per screen, a box per group, and
 * "Select all N" only inside the bulk bar. Everything here is pure so the
 * selection rules are unit-tested without mounting the page.
 */
import type { BulkScreenRequest, BulkScreenResult } from '@/hooks/use-api';
import { selectionState, type SelectionState } from '@/components/common/SelectionCheckbox';

/** What an operator picks in the bar or a group menu. */
export type BulkKind = 'resync' | 'update' | 'power-on' | 'power-off' | 'auto-on' | 'auto-off' | 'auto-inherit';

export const BULK_KINDS: readonly BulkKind[] = ['resync', 'update', 'power-on', 'power-off', 'auto-on', 'auto-off', 'auto-inherit'];

/** The API request a kind becomes (screen ids added by the caller). */
export function requestFor(kind: BulkKind, screenIds: string[]): BulkScreenRequest {
  switch (kind) {
    case 'resync': return { action: 'resync', screenIds };
    case 'update': return { action: 'update', screenIds };
    case 'power-on': return { action: 'power', state: 'on', screenIds };
    case 'power-off': return { action: 'power', state: 'off', screenIds };
    case 'auto-on': return { action: 'auto-update', mode: 'on', screenIds };
    case 'auto-off': return { action: 'auto-update', mode: 'off', screenIds };
    case 'auto-inherit': return { action: 'auto-update', mode: 'inherit', screenIds };
  }
}

/** Selected ids that are still covered by `ids` (in that order). */
export function selectedAmong(selected: ReadonlySet<string>, ids: readonly string[]): string[] {
  return ids.filter((id) => selected.has(id));
}

/** none / some / all for a box that covers `ids`. */
export function stateFor(selected: ReadonlySet<string>, ids: readonly string[]): SelectionState {
  return selectionState(selectedAmong(selected, ids).length, ids.length);
}

/** Turn every id in `ids` on (or off). Ids outside `ids` keep their state. */
export function setMany(selected: ReadonlySet<string>, ids: readonly string[], on: boolean): Set<string> {
  const next = new Set(selected);
  for (const id of ids) { if (on) next.add(id); else next.delete(id); }
  return next;
}

/** A header / group box click: from none or some → all of `ids`; from all → none of them. */
export function toggleMany(selected: ReadonlySet<string>, ids: readonly string[]): Set<string> {
  return setMany(selected, ids, stateFor(selected, ids) !== 'all');
}

export function toggleOne(selected: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id); else next.add(id);
  return next;
}

/** Drop ids that no longer exist (a screen was deleted / moved out of view by a refetch). */
export function pruneTo(selected: ReadonlySet<string>, existing: readonly string[]): Set<string> {
  const keep = new Set(existing);
  const next = new Set<string>();
  for (const id of selected) if (keep.has(id)) next.add(id);
  return next.size === selected.size ? (selected as Set<string>) : next;
}

/** i18n key segment for an API reason code (hyphenated codes are not message keys). */
const REASON_KEY: Record<string, string> = {
  'not-found': 'notFound',
  'out-of-scope': 'outOfScope',
  'already-current': 'alreadyCurrent',
  'no-player-app': 'noPlayerApp',
  unchanged: 'unchanged',
  unsupported: 'unsupported',
  'emergency-hold': 'emergencyHold',
  'not-delivered': 'notDelivered',
  'no-live-connection': 'noLiveConnection',
  error: 'error',
};

export function reasonKey(reason: string | undefined): string | null {
  return reason && REASON_KEY[reason] ? `screens.bulk.reason.${REASON_KEY[reason]}` : null;
}

/**
 * i18n key for a REQUEST-level refusal of "Send update" by the owner's fleet
 * push rules (apps/api/src/player-ota/fleet-push-policy.ts: one hardware class
 * per update, off-hours in each screen's own zone). null = not one of them —
 * the sheet then shows the server's own message, exactly as before.
 */
const REFUSAL_KEY: Record<string, string> = {
  BULK_UPDATE_MIXED_HARDWARE: 'mixedHardware',
  BULK_UPDATE_HARDWARE_UNKNOWN: 'hardwareUnknown',
  BULK_UPDATE_OUTSIDE_OFF_HOURS: 'outsideOffHours',
  BULK_UPDATE_TIME_ZONE_UNKNOWN: 'timeZoneUnknown',
};

export function refusalKey(code: unknown): string | null {
  return typeof code === 'string' && Object.prototype.hasOwnProperty.call(REFUSAL_KEY, code)
    ? `screens.bulk.refusal.${REFUSAL_KEY[code]}`
    : null;
}

export interface GroupedResults {
  sent: BulkScreenResult[];
  skipped: BulkScreenResult[];
  failed: BulkScreenResult[];
  /** reason → count, for the confirm sheet's "3 skipped — already on the latest Player". */
  skippedByReason: Array<{ reason: string; count: number }>;
  installPrompts: number;
}

export function groupResults(results: readonly BulkScreenResult[]): GroupedResults {
  const out: GroupedResults = { sent: [], skipped: [], failed: [], skippedByReason: [], installPrompts: 0 };
  const counts = new Map<string, number>();
  for (const r of results) {
    out[r.outcome].push(r);
    if (r.outcome === 'skipped') counts.set(r.reason ?? 'error', (counts.get(r.reason ?? 'error') ?? 0) + 1);
    if (r.outcome === 'sent' && r.installPrompt) out.installPrompts += 1;
  }
  out.skippedByReason = [...counts.entries()].map(([reason, count]) => ({ reason, count }));
  return out;
}
