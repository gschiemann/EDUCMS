/**
 * profilePatch — the two account facts added 2026-10-24 (launch QA S1 / S2)
 * reconcile from GET /users/me like the setup flags before them.
 */
import { profilePatch } from '../workspace-config-refresh';

describe('profilePatch — setupPasswordOnly (S1) and termsAcceptedVersion (S2)', () => {
  it('adopts the server’s answers when the cached session lacks them', () => {
    expect(profilePatch({}, { setupPasswordOnly: true, termsAcceptedVersion: '1.0' })).toEqual({
      setupPasswordOnly: true,
      termsAcceptedVersion: '1.0',
    });
  });

  it('a server null (never accepted) replaces a stale cached acceptance — the server is the record', () => {
    expect(profilePatch({ termsAcceptedVersion: '1.0' }, { termsAcceptedVersion: null })).toEqual({ termsAcceptedVersion: null });
  });

  it('changes nothing when they agree, or when the server did not say', () => {
    expect(profilePatch({ setupPasswordOnly: false, termsAcceptedVersion: '1.0' }, { setupPasswordOnly: false, termsAcceptedVersion: '1.0' })).toEqual({});
    expect(profilePatch({ termsAcceptedVersion: '1.0' }, {})).toEqual({});
  });
});
