import { createHash } from 'node:crypto';
import {
  configuredFieldRelease,
  isFieldCandidateTarget,
  mintFieldTicket,
  verifyFieldTicket,
  verifiedFieldBytes,
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
