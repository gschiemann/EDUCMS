import { createHash } from 'node:crypto';
import {
  activeFieldWindow,
  configuredFieldRelease,
  isFieldCandidateTarget,
  mintFieldTicket,
  setActiveFieldWindow,
  verifyFieldTicket,
  verifiedFieldBytes,
  type FieldBuildWindow,
} from './field-candidate';
const id = '11111111-1111-4111-8111-111111111111',
  tenant = '22222222-2222-4222-8222-222222222222';
const now = Date.now(),
  data = Buffer.from('test-only-candidate-bytes');
const release = {
  versionName: '1.1.25-field.1',
  versionCode: 10125,
  sha256: createHash('sha256').update(data).digest('hex'),
  size: data.length,
  sourceUrl: 'https://github.com/gschiemann/EDUCMS/actions/runs/1',
};
const env = {
  PLAYER_APK_FIELD_CANDIDATE: release.versionName,
  PLAYER_APK_FIELD_TENANT_ID: tenant,
  PLAYER_APK_FIELD_SCREEN_IDS: id,
  PLAYER_APK_FIELD_EXPIRES_AT: new Date(now + 60_000).toISOString(),
  DEVICE_SECRET_KEY: 'fake-test-secret',
  SUPABASE_URL: 'https://bhdaxzfalaycfopvcopm.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'fake-storage-test-key',
};
describe('private field admission and download capability', () => {
  it('covers a tenant list and a tenant-wide `all` (2026-10-17), never another tenant', () => {
    const tenant2 = '33333333-3333-4333-8333-333333333333';
    const id2 = '44444444-4444-4444-8444-444444444444';
    const list = { ...env, PLAYER_APK_FIELD_TENANT_ID: `${tenant}, ${tenant2}`, PLAYER_APK_FIELD_SCREEN_IDS: `${id},all` };
    expect(isFieldCandidateTarget(id, tenant, list, now)).toBe(true);
    expect(isFieldCandidateTarget(id2, tenant, list, now)).toBe(true);
    expect(isFieldCandidateTarget(id2, tenant2, list, now)).toBe(true);
    expect(isFieldCandidateTarget(id2, '55555555-5555-4555-8555-555555555555', list, now)).toBe(false);
    const named = { ...list, PLAYER_APK_FIELD_SCREEN_IDS: id };
    expect(isFieldCandidateTarget(id, tenant2, named, now)).toBe(true);
    expect(isFieldCandidateTarget(id2, tenant2, named, now)).toBe(false);
    expect(isFieldCandidateTarget(id2, tenant2, { ...list, PLAYER_APK_FIELD_SCREEN_IDS: 'ALL' }, now)).toBe(true);
    expect(isFieldCandidateTarget(id2, tenant2, { ...list, PLAYER_APK_FIELD_SCREEN_IDS: 'everyone' }, now)).toBe(false);
    expect(isFieldCandidateTarget(id2, tenant2, { ...list, PLAYER_APK_FIELD_TENANT_ID: 'all' }, now)).toBe(false);
  });
  it('requires exact id, tenant and a short explicit window; default does nothing', () => {
    expect(isFieldCandidateTarget(id, tenant, {}, now)).toBe(false);
    expect(isFieldCandidateTarget(id, tenant, env, now)).toBe(true);
    expect(isFieldCandidateTarget(id + '1', tenant, env, now)).toBe(false);
    expect(isFieldCandidateTarget(id, id, env, now)).toBe(false);
    expect(isFieldCandidateTarget(id, tenant, env, now + 60_001)).toBe(false);
    expect(
      isFieldCandidateTarget(
        id,
        tenant,
        {
          ...env,
          PLAYER_APK_FIELD_EXPIRES_AT: new Date(
            now + 25 * 3600_000,
          ).toISOString(),
        },
        now,
      ),
    ).toBe(false);
  });
  it('cannot offer an unknown, stable-named, unpinned-shape or wrong-code record', () => {
    expect(configuredFieldRelease(env, {})).toBeNull();
    expect(
      configuredFieldRelease(env, { [release.versionName]: release }),
    ).toEqual(release);
    for (const patch of [
      { versionName: '1.1.25' },
      { sha256: 'bad' },
      { size: 17 * 1024 * 1024 },
      { versionCode: 10126 },
      { sourceUrl: 'https://evil.test/a.apk' },
    ])
      expect(
        configuredFieldRelease(env, {
          [release.versionName]: { ...release, ...patch },
        }),
      ).toBeNull();
  });
  it('retains the shared quarantine/floor/digest policy', () => {
    process.env.PLAYER_APK_QUARANTINE = release.versionName;
    try {
      expect(
        configuredFieldRelease(env, { [release.versionName]: release }),
      ).toBeNull();
    } finally {
      delete process.env.PLAYER_APK_QUARANTINE;
    }
  });
  it('binds a short ticket to candidate, tenant, exact screen and active configuration', () => {
    const ticket = mintFieldTicket(release, id, tenant, env, now)!;
    expect(verifyFieldTicket(ticket, release, env, now)?.screenId).toBe(id);
    expect(verifyFieldTicket(ticket + 'x', release, env, now)).toBeNull();
    expect(
      verifyFieldTicket(
        ticket,
        { ...release, sha256: 'a'.repeat(64) },
        env,
        now,
      ),
    ).toBeNull();
    expect(
      verifyFieldTicket(
        ticket,
        release,
        { ...env, PLAYER_APK_FIELD_SCREEN_IDS: tenant },
        now,
      ),
    ).toBeNull();
    expect(verifyFieldTicket(ticket, release, env, now + 60_001)).toBeNull();
    expect(
      verifyFieldTicket(
        ticket,
        release,
        { ...env, DEVICE_SECRET_KEY: 'other' },
        now,
      ),
    ).toBeNull();
    expect(
      mintFieldTicket(
        release,
        id,
        tenant,
        { ...env, DEVICE_SECRET_KEY: '' },
        now,
      ),
    ).toBeNull();
  });
  it('rejects corrupt/oversize bytes and uses no redirect or untrusted storage origin', async () => {
    const wrong = jest
      .fn()
      .mockResolvedValue(new Response(Buffer.from('wrong-bytes')));
    await expect(verifiedFieldBytes(release, env, wrong)).rejects.toThrow();
    const tooLarge = jest
      .fn()
      .mockResolvedValue(new Response(Buffer.alloc(release.size + 1)));
    await expect(verifiedFieldBytes(release, env, tooLarge)).rejects.toThrow(
      'field-apk-size',
    );
    // 2026-10-10 — the storage origin is SUPABASE_URL's, not a hard-coded
    // host; anything but a bare https origin is refused before any request,
    // and an unset SUPABASE_URL is still "not configured" (the key is never
    // sent to a defaulted host).
    for (const bad of [
      '',
      'http://bhdaxzfalaycfopvcopm.supabase.co',
      'https://user:pw@bhdaxzfalaycfopvcopm.supabase.co',
      'https://bhdaxzfalaycfopvcopm.supabase.co:8443',
      'https://bhdaxzfalaycfopvcopm.supabase.co/storage',
      'https://bhdaxzfalaycfopvcopm.supabase.co/?x=1',
      'not a url',
    ]) {
      const never = jest.fn();
      await expect(
        verifiedFieldBytes(release, { ...env, SUPABASE_URL: bad }, never),
      ).rejects.toThrow('field-storage-unconfigured');
      expect(never).not.toHaveBeenCalled();
    }
    const staging = jest
      .fn()
      .mockResolvedValue(new Response(Buffer.from('wrong-bytes')));
    await expect(
      verifiedFieldBytes(
        release,
        { ...env, SUPABASE_URL: 'https://staging-proj.supabase.co/' },
        staging,
      ),
    ).rejects.toThrow();
    expect(staging.mock.calls[0][0]).toBe(
      `https://staging-proj.supabase.co/storage/v1/object/apks/field-player/${release.sha256}.apk`,
    );
    const correct = jest.fn().mockResolvedValue(new Response(data));
    expect(await verifiedFieldBytes(release, env, correct)).toEqual(data);
    expect(correct.mock.calls[0][0]).toBe(
      `${env.SUPABASE_URL}/storage/v1/object/apks/field-player/${release.sha256}.apk`,
    );
    expect(correct.mock.calls[0][1]).toMatchObject({
      redirect: 'error',
      headers: { apikey: 'fake-storage-test-key' },
    });
  });
});

/**
 * 2026-10-18 — the window armed from /super/field-builds (field_build_windows).
 * The newest un-cancelled, un-expired row is read FIRST; with none, the
 * PLAYER_APK_FIELD_* variables decide exactly as above. Every case passes the
 * row explicitly — the functions stay pure — except the last, which pins the
 * default argument the untouched controller relies on.
 */
describe('a window armed from the panel (field_build_windows)', () => {
  const tenant2 = '33333333-3333-4333-8333-333333333333';
  const id2 = '44444444-4444-4444-8444-444444444444';
  const outsider = '55555555-5555-4555-8555-555555555555';
  const other = {
    versionName: '1.1.26-field.1',
    versionCode: 10126,
    sha256: 'b'.repeat(64),
    size: 8,
    sourceUrl: 'https://github.com/gschiemann/EDUCMS/actions/runs/2',
  };
  const registry = { [release.versionName]: release, [other.versionName]: other };
  const row = (patch: Partial<FieldBuildWindow> = {}): FieldBuildWindow => ({
    id: 'w-1',
    candidate: other.versionName,
    candidateSha256: other.sha256,
    tenantIds: [tenant2],
    screenIds: [id2],
    allScreens: false,
    armedAt: new Date(now - 60_000),
    expiresAt: new Date(now + 3_600_000),
    cancelledAt: null,
    ...patch,
  });
  const noEnv = {};
  afterEach(() => setActiveFieldWindow(null));

  it('admits exactly the named screen of a listed tenant, with no variables set', () => {
    expect(isFieldCandidateTarget(id2, tenant2, noEnv, now, row())).toBe(true);
    expect(configuredFieldRelease(noEnv, registry, row(), now)).toEqual(other);
  });

  it('refuses a tenant that is not listed, even for a listed screen id', () => {
    expect(isFieldCandidateTarget(id2, outsider, noEnv, now, row())).toBe(false);
    expect(isFieldCandidateTarget(id2, tenant, noEnv, now, row())).toBe(false);
  });

  it('refuses a screen that is not named', () => {
    expect(isFieldCandidateTarget(id, tenant2, noEnv, now, row())).toBe(false);
    expect(isFieldCandidateTarget(outsider, tenant2, noEnv, now, row())).toBe(false);
  });

  it('`all` covers every screen of every listed tenant and never another tenant', () => {
    const all = row({ allScreens: true, screenIds: [], tenantIds: [tenant, tenant2] });
    expect(isFieldCandidateTarget(id, tenant, noEnv, now, all)).toBe(true);
    expect(isFieldCandidateTarget(outsider, tenant2, noEnv, now, all)).toBe(true);
    expect(isFieldCandidateTarget(id, outsider, noEnv, now, all)).toBe(false);
    // The `all` token is a variables-only spelling: in a row it is not a wildcard,
    // and there is no tenant wildcard at all.
    expect(isFieldCandidateTarget(id, tenant2, noEnv, now, row({ screenIds: ['all'] }))).toBe(false);
    expect(isFieldCandidateTarget(id2, outsider, noEnv, now, row({ tenantIds: ['all'], allScreens: true, screenIds: [] }))).toBe(false);
  });

  it('a window past its expiry falls back to the variables', () => {
    const expired = row({ expiresAt: new Date(now - 1) });
    expect(isFieldCandidateTarget(id2, tenant2, noEnv, now, expired)).toBe(false);
    // The variables name screen `id` of `tenant` with the 1.1.25 candidate.
    expect(isFieldCandidateTarget(id, tenant, env, now, expired)).toBe(true);
    expect(isFieldCandidateTarget(id2, tenant2, env, now, expired)).toBe(false);
    expect(configuredFieldRelease(env, registry, expired, now)).toEqual(release);
    // Expiry is read at the call: a row read while live stops admitting the
    // moment it ends, whatever the cache says.
    expect(isFieldCandidateTarget(id2, tenant2, noEnv, now + 3_600_000, row())).toBe(false);
    expect(isFieldCandidateTarget(id2, tenant2, noEnv, now + 3_599_999, row())).toBe(true);
  });

  it('a cancelled window falls back to the variables', () => {
    const cancelled = row({ cancelledAt: new Date(now - 1_000) });
    expect(isFieldCandidateTarget(id2, tenant2, noEnv, now, cancelled)).toBe(false);
    expect(isFieldCandidateTarget(id, tenant, env, now, cancelled)).toBe(true);
    expect(configuredFieldRelease(env, registry, cancelled, now)).toEqual(release);
    expect(configuredFieldRelease(noEnv, registry, cancelled, now)).toBeNull();
  });

  it('with the variables AND a live window set, the window wins outright', () => {
    expect(isFieldCandidateTarget(id2, tenant2, env, now, row())).toBe(true);
    // The variables' own screen is NOT also admitted.
    expect(isFieldCandidateTarget(id, tenant, env, now, row())).toBe(false);
    expect(configuredFieldRelease(env, registry, row(), now)).toEqual(other);
  });

  it('never more than 24 h from arming, nor from now; a malformed live window admits nothing', () => {
    const day = 24 * 3_600_000;
    // Armed 23 h ago, ends in 2 h = 25 h after arming: refused, and the
    // variables do NOT take over (the row is live, just invalid).
    const long = row({ armedAt: new Date(now - 23 * 3_600_000), expiresAt: new Date(now + 2 * 3_600_000) });
    expect(isFieldCandidateTarget(id2, tenant2, noEnv, now, long)).toBe(false);
    expect(isFieldCandidateTarget(id, tenant, env, now, long)).toBe(false);
    // Exactly 24 h from arming is allowed.
    expect(isFieldCandidateTarget(id2, tenant2, noEnv, now, row({ armedAt: new Date(now), expiresAt: new Date(now + day) }))).toBe(true);
    // A clock that puts arming in the future cannot stretch it past now + 24 h.
    expect(isFieldCandidateTarget(id2, tenant2, noEnv, now, row({ armedAt: new Date(now + 60_000), expiresAt: new Date(now + day + 60_000) }))).toBe(false);
    for (const bad of [row({ armedAt: 'not a date' }), row({ expiresAt: 'not a date' }), row({ tenantIds: ['not-a-uuid'] })])
      expect(isFieldCandidateTarget(id2, tenant2, noEnv, now, bad)).toBe(false);
  });

  it('pins the digest it was armed with: a registry entry that changed is refused', () => {
    expect(configuredFieldRelease(noEnv, registry, row({ candidateSha256: 'c'.repeat(64) }), now)).toBeNull();
    expect(configuredFieldRelease(noEnv, registry, row({ candidate: '1.1.99-field.1' }), now)).toBeNull();
    // The registry's own shape and fleet policy still apply on top.
    expect(configuredFieldRelease(noEnv, { [other.versionName]: { ...other, versionCode: 10127 } }, row(), now)).toBeNull();
  });

  it('a ticket ends with its window and dies when the window is cancelled', () => {
    const short = row({ expiresAt: new Date(now + 60_000) });
    const ticket = mintFieldTicket(other, id2, tenant2, { DEVICE_SECRET_KEY: 'fake-test-secret' }, now, short)!;
    const v = verifyFieldTicket(ticket, other, { DEVICE_SECRET_KEY: 'fake-test-secret' }, now, short)!;
    expect(v.screenId).toBe(id2);
    expect(v.exp).toBe(now + 60_000);
    const cancelled = { ...short, cancelledAt: new Date(now + 1) };
    expect(verifyFieldTicket(ticket, other, { DEVICE_SECRET_KEY: 'fake-test-secret' }, now + 2, cancelled)).toBeNull();
    expect(mintFieldTicket(other, id, tenant2, { DEVICE_SECRET_KEY: 'fake-test-secret' }, now, short)).toBeNull();
  });

  it('the default argument is the last row read — what the untouched controller uses', () => {
    expect(activeFieldWindow()).toBeNull();
    expect(isFieldCandidateTarget(id2, tenant2, noEnv, now)).toBe(false);
    setActiveFieldWindow(row());
    expect(isFieldCandidateTarget(id2, tenant2, noEnv, now)).toBe(true);
    expect(configuredFieldRelease(noEnv, registry, undefined, now)).toEqual(other);
    // An explicit null still means "no window": the variables decide.
    expect(isFieldCandidateTarget(id2, tenant2, noEnv, now, null)).toBe(false);
    expect(isFieldCandidateTarget(id, tenant, env, now, null)).toBe(true);
    setActiveFieldWindow(null);
    expect(isFieldCandidateTarget(id, tenant, env, now)).toBe(true);
  });
});
