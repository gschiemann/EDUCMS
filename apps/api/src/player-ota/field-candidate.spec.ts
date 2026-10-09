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
    await expect(
      verifiedFieldBytes(
        release,
        { ...env, SUPABASE_URL: 'https://evil.test' },
        wrong,
      ),
    ).rejects.toThrow('field-storage-unconfigured');
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
