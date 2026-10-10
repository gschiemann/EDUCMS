/**
 * The DRILL LOG (2026-10-10) — recent drills as Settings → Emergency → Drill
 * lists them, built from the audit trail: TRIGGER_EMERGENCY_DRILL rows paired
 * with their CLEAR_EMERGENCY_DRILL rows by `overrideId`. Pure, no React.
 */

export type AuditRow = {
  id?: string;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  details?: string | null;
  createdAt: string;
  user?: { email?: string | null } | null;
};

export interface DrillLogEntry {
  key: string;
  overrideId: string | null;
  type: string | null;
  scopeType: string | null;
  scopeId: string | null;
  who: string | null;
  startedAt: string;
  endedAt: string | null;
}

/**
 * Pair TRIGGER_EMERGENCY_DRILL rows with their CLEAR_EMERGENCY_DRILL rows by
 * `overrideId` (in `details`), newest first. A district drill writes one row
 * per tenant; this list is one tenant's trail, so each start row is its own
 * drill. A start with no matching clear is "in progress". Pure.
 */
export function pairDrillLog(triggers: AuditRow[], clears: AuditRow[]): DrillLogEntry[] {
  const parse = (r: AuditRow): Record<string, unknown> => {
    try {
      const v = r.details ? JSON.parse(r.details) : null;
      return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  };
  const endedBy = new Map<string, string>();
  for (const c of clears) {
    const id = parse(c).overrideId;
    if (typeof id === 'string' && !endedBy.has(id)) endedBy.set(id, c.createdAt);
  }
  return triggers
    .map((r, i) => {
      const d = parse(r);
      const overrideId = typeof d.overrideId === 'string' ? d.overrideId : null;
      const endedAt = overrideId ? endedBy.get(overrideId) ?? null : null;
      return {
        key: r.id ?? `${r.createdAt}-${i}`,
        overrideId,
        type: typeof d.type === 'string' ? d.type : null,
        scopeType: r.targetType ?? (typeof d.scopeType === 'string' ? d.scopeType : null),
        scopeId: r.targetId ?? (typeof d.scopeId === 'string' ? d.scopeId : null),
        who: r.user?.email ?? null,
        startedAt: r.createdAt,
        // A clear that predates the start belongs to an earlier drill with a reused id; ignore it.
        endedAt: endedAt && Date.parse(endedAt) >= Date.parse(r.createdAt) ? endedAt : null,
      };
    })
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
}

/** "4m 12s" / "1h 03m" — the drill's length, or null while it runs. */
export function drillDuration(startedAt: string, endedAt: string | null): string | null {
  if (!endedAt) return null;
  const ms = Date.parse(endedAt) - Date.parse(startedAt);
  if (!Number.isFinite(ms) || ms < 0) return null;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}
