/**
 * Alert targeting — "all screens, a group, or single screens" (2026-10-05).
 *
 * The owner's ask: "We have no way to just target 1 screen… all screens, a
 * group, or single screens. All screens needs to be on by default and needs
 * to be easy to use."
 *
 * The API has always accepted `scopeType: 'tenant' | 'group' | 'device'`;
 * every operator surface sent only `tenant`. This module is the one place the
 * surfaces (/panic, the dashboard trigger modal, the active-alert overlay)
 * turn a chosen target into words and into the request — so "All screens"
 * can be proven to send BYTE-FOR-BYTE what was sent before this existed
 * (`emergencyTriggerBody`, pinned by its unit test).
 *
 * PURE — no React, no store, no network.
 */

export type EmergencyScopeType = 'tenant' | 'group' | 'device';

/** Who an alert goes to. `tenant` = All screens, the default. */
export interface EmergencyTarget {
  scopeType: EmergencyScopeType;
  /** Tenant id (All screens), group id, or screen id. */
  scopeId: string;
  /** Group or screen name; null for All screens. */
  name: string | null;
  /** Screens the alert reaches (whole double-sided displays counted); null = not known yet. */
  screenCount: number | null;
}

/** One group as GET /emergency/targets reports it. */
export interface TargetGroup {
  id: string;
  name: string;
  tenantId: string;
  tenantName: string | null;
  screenCount: number;
}

/** One screen as GET /emergency/targets reports it. */
export interface TargetScreen {
  id: string;
  name: string;
  location: string | null;
  online: boolean;
  groupId: string | null;
  groupName: string | null;
  tenantId: string;
  tenantName: string | null;
  /** Screens an alert on this one reaches — 2 for either side of a double-sided display. */
  displayScreenCount: number;
}

/** GET /emergency/targets. */
export interface EmergencyTargets {
  tenantId: string | null;
  tenantName: string | null;
  allScreensCount: number;
  groups: TargetGroup[];
  screens: TargetScreen[];
}

/** One live alert as GET /emergency/active reports it. */
export interface ActiveAlert {
  /** The trigger's overrideId; null for the tenant-wide alert and pre-2026-10-05 rows. */
  alertId: string | null;
  scopeType: EmergencyScopeType;
  scopeId: string;
  targetName: string | null;
  tenantId: string;
  tenantName: string | null;
  /** Incident type ("LOCKDOWN"); null when the row predates incident types. */
  type: string | null;
  severity: string | null;
  screenCount: number;
  showingCount: number | null;
  triggeredAt: string | null;
  /**
   * Where the all-clear must be sent, when it differs from the alert's own
   * target — the server sets it if that target no longer exists (a group
   * deleted mid-alert). Absent = the alert's own scope.
   */
  clearScopeType?: EmergencyScopeType;
  clearScopeId?: string;
}

/** The scope an alert's all-clear is sent to (see `ActiveAlert.clearScopeType`). */
export function allClearScopeOf(alert: ActiveAlert): { scopeType: EmergencyScopeType; scopeId: string } {
  return alert.clearScopeType && alert.clearScopeId
    ? { scopeType: alert.clearScopeType, scopeId: alert.clearScopeId }
    : { scopeType: alert.scopeType, scopeId: alert.scopeId };
}

/** The default target: every screen of the operator's organisation. */
export function allScreensTarget(tenantId: string, screenCount: number | null = null): EmergencyTarget {
  return { scopeType: 'tenant', scopeId: tenantId, name: null, screenCount };
}

export function isAllScreens(target: EmergencyTarget | null | undefined): boolean {
  return !target || target.scopeType === 'tenant';
}

export function groupTarget(g: TargetGroup): EmergencyTarget {
  return { scopeType: 'group', scopeId: g.id, name: g.name, screenCount: g.screenCount };
}

export function screenTarget(s: TargetScreen): EmergencyTarget {
  return { scopeType: 'device', scopeId: s.id, name: s.name, screenCount: s.displayScreenCount };
}

/**
 * The exact JSON body POSTed to /emergency/trigger.
 *
 * With no `target` (or All screens) this MUST stay identical — key order
 * included — to the body every surface sent before targeting existed:
 *   { scopeType: 'tenant', scopeId: schoolId,
 *     overridePayload: { severity: 'CRITICAL', type, playlistId } }
 * `JSON.stringify` drops an undefined `playlistId`, exactly as before.
 */
export function emergencyTriggerBody(payload: {
  schoolId: string;
  type: string;
  playlistId?: string;
  target?: { scopeType: EmergencyScopeType; scopeId: string } | null;
}): {
  scopeType: EmergencyScopeType;
  scopeId: string;
  overridePayload: { severity: 'CRITICAL'; type: string; playlistId: string | undefined };
} {
  const scoped = payload.target && payload.target.scopeType !== 'tenant' ? payload.target : null;
  return {
    scopeType: scoped ? scoped.scopeType : 'tenant',
    scopeId: scoped ? scoped.scopeId : payload.schoolId,
    overridePayload: { severity: 'CRITICAL', type: payload.type, playlistId: payload.playlistId },
  };
}

/** The exact JSON body POSTed to /emergency/:overrideId/all-clear. Default: the whole tenant, as before. */
export function emergencyAllClearBody(payload: {
  schoolId: string;
  scopeType?: EmergencyScopeType;
  scopeId?: string;
}): { scopeType: EmergencyScopeType; scopeId: string } {
  if (payload.scopeType && payload.scopeType !== 'tenant' && payload.scopeId) {
    return { scopeType: payload.scopeType, scopeId: payload.scopeId };
  }
  return { scopeType: 'tenant', scopeId: payload.schoolId };
}

/** Case- and accent-insensitive "does `query` occur in any of these fields". */
function matches(query: string, ...fields: Array<string | null | undefined>): boolean {
  const q = fold(query);
  if (!q) return true;
  return fields.some((f) => !!f && fold(f).includes(q));
}

function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/** Narrow the picker's two lists to a search query (name, location, group, school). */
export function filterTargets(
  targets: Pick<EmergencyTargets, 'groups' | 'screens'> | null | undefined,
  query: string,
): { groups: TargetGroup[]; screens: TargetScreen[] } {
  const groups = targets?.groups ?? [];
  const screens = targets?.screens ?? [];
  return {
    groups: groups.filter((g) => matches(query, g.name, g.tenantName)),
    screens: screens.filter((s) => matches(query, s.name, s.location, s.groupName, s.tenantName)),
  };
}

/** next-intl's translator, narrowed to what this module needs. */
export type Translate = (key: string, values?: Record<string, string | number>) => string;

/**
 * A group's display name: "Gym group". A group the operator already called
 * "… group" is not doubled ("Gym Group", not "Gym Group group").
 */
export function groupDisplayName(t: Translate, name: string): string {
  return /\bgroup\s*$/i.test(name.trim()) ? name.trim() : t('emergency.target.groupName', { name });
}

/** The target's name as an operator reads it — no count. */
export function targetName(t: Translate, target: EmergencyTarget): string {
  if (isAllScreens(target)) return t('emergency.target.allScreens');
  const name = target.name ?? '';
  return target.scopeType === 'group' ? groupDisplayName(t, name) : name;
}

/**
 * The confirmation, in plain words:
 *   "Lockdown on all 24 screens" · "Lockdown on 1 screen — Lobby"
 *   "Lockdown on 6 screens — Gym group"
 */
export function targetSummary(t: Translate, typeName: string, target: EmergencyTarget): string {
  if (isAllScreens(target)) {
    return target.screenCount == null
      ? t('emergency.target.summaryAllUnknown', { type: typeName })
      : t('emergency.target.summaryAll', { type: typeName, count: target.screenCount });
  }
  return t('emergency.target.summaryOne', {
    type: typeName,
    count: target.screenCount ?? 1,
    name: targetName(t, target),
  });
}

/** The short label on the "Send to" control: "All screens (24)" / "Gym group · 6 screens". */
export function targetChipLabel(t: Translate, target: EmergencyTarget): string {
  if (isAllScreens(target)) {
    return target.screenCount == null
      ? t('emergency.target.allScreens')
      : t('emergency.target.allScreensCount', { count: target.screenCount });
  }
  return t('emergency.target.chipOne', {
    name: targetName(t, target),
    count: target.screenCount ?? 1,
  });
}

/**
 * An active alert, listed: "Lockdown — Gym group, 6 screens" /
 * "Lockdown — all 24 screens".
 */
export function activeAlertLabel(t: Translate, typeName: string, alert: ActiveAlert): string {
  if (alert.scopeType === 'tenant') {
    return t('emergency.target.activeAll', { type: typeName, count: alert.screenCount });
  }
  const name =
    alert.scopeType === 'group'
      ? alert.targetName
        ? groupDisplayName(t, alert.targetName)
        : t('emergency.target.deletedGroup')
      : alert.targetName ?? t('emergency.target.unnamedScreen');
  return t('emergency.target.activeOne', { type: typeName, name, count: alert.screenCount });
}

/** The panic/modal type id ("lockdown") for an API incident type ("LOCKDOWN"), or null. */
export function typeIdOf(apiType: string | null | undefined): string | null {
  const v = String(apiType ?? '').trim().toLowerCase();
  return ['hold', 'secure', 'lockdown', 'evacuate', 'weather', 'medical'].includes(v) ? v : null;
}

/**
 * Is `alert` the one a trigger just created? Scoped alerts match by id; the
 * tenant-wide alert (no id on the Tenant row) by being the tenant-wide entry
 * for the same tenant.
 */
export function isSameAlert(
  alert: ActiveAlert,
  fired: { overrideId?: string | null; target: EmergencyTarget },
): boolean {
  if (isAllScreens(fired.target)) {
    return alert.scopeType === 'tenant' && alert.scopeId === fired.target.scopeId;
  }
  return !!fired.overrideId && alert.alertId === fired.overrideId;
}
