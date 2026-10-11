import { workspaceConfigVersion, WORKSPACE_CONFIG_FIELDS } from './workspace-config-version';

describe('workspaceConfigVersion (DEV-005)', () => {
  const base = {
    vertical: 'K12', name: 'Springfield', slug: 'springfield',
    emergencyEnabled: null, locationBasedEmergencyEnabled: false,
    mfaEnforced: true, usbIngestEnabled: false, requireContentApproval: false,
  };

  it('is stable for the same configuration', () => {
    expect(workspaceConfigVersion(base)).toBe(workspaceConfigVersion({ ...base }));
    expect(workspaceConfigVersion(base)).toMatch(/^[0-9a-f]{16}$/);
  });

  it.each(WORKSPACE_CONFIG_FIELDS.map((f) => [f]))('changes when %s changes', (field) => {
    const cur = (base as any)[field];
    const next = typeof cur === 'boolean' ? !cur : cur === null ? true : `${cur}-x`;
    expect(workspaceConfigVersion({ ...base, [field]: next })).not.toBe(workspaceConfigVersion(base));
  });

  it('ignores live emergency state (that rides realtime, not this fingerprint)', () => {
    expect(workspaceConfigVersion({ ...base, emergencyStatus: 'LOCKDOWN' } as any)).toBe(workspaceConfigVersion(base));
  });
});
