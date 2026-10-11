import { createHash } from 'crypto';

/**
 * WORKSPACE CONFIG VERSION (Muse beta DEV-005 / S-01, 2026-10-07).
 *
 * An admin changed the industry in one session; a second live session kept
 * the old industry and module set until it logged out, because the dashboard
 * reconciled its cached identity with `/users/me` exactly once per session.
 * The dashboard now re-asks at a bounded rate (focus / visibility return /
 * navigation, ≥ 60 s apart) and this short fingerprint tells it whether the
 * workspace-level configuration actually moved, so it only re-reads the
 * tenant query when it has to.
 *
 * It is a pure function of the config-bearing columns — no schema change,
 * nothing stored. Deliberately EXCLUDES live state (`emergencyStatus`,
 * drills): those ride the realtime channel, not this fingerprint.
 */
export const WORKSPACE_CONFIG_FIELDS = [
  'vertical',
  'name',
  'slug',
  'emergencyEnabled',
  'locationBasedEmergencyEnabled',
  'mfaEnforced',
  'usbIngestEnabled',
  'requireContentApproval',
] as const;

export type WorkspaceConfigRow = Partial<Record<(typeof WORKSPACE_CONFIG_FIELDS)[number], unknown>>;

export function workspaceConfigVersion(tenant: WorkspaceConfigRow | null | undefined): string {
  const parts = WORKSPACE_CONFIG_FIELDS.map((k) => {
    const v = tenant?.[k];
    return `${k}=${v === undefined || v === null ? '' : String(v)}`;
  });
  return createHash('sha256').update(parts.join('\n')).digest('hex').slice(0, 16);
}
