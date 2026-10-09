import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import {
  FIELD_CANDIDATE_RELEASES,
  type FieldCandidateRelease,
} from './field-candidate-releases';
import { evaluateReleaseForFleet } from './release-policy';

const uuid = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
const MAX_BYTES = 16 * 1024 * 1024;
const TICKET_MS = 15 * 60_000;

/** Exact ids + tenant + a bounded explicit field window; never a fleet latest override. */
export function isFieldCandidateTarget(
  id: string | null,
  tenant: string | null,
  env = process.env,
  now = Date.now(),
): boolean {
  const end = Date.parse(env.PLAYER_APK_FIELD_EXPIRES_AT ?? '');
  return (
    uuid(id) &&
    uuid(tenant) &&
    tenant === env.PLAYER_APK_FIELD_TENANT_ID &&
    (env.PLAYER_APK_FIELD_SCREEN_IDS ?? '')
      .split(',')
      .map((s) => s.trim())
      .includes(id) &&
    Number.isFinite(end) &&
    end > now &&
    end - now <= 24 * 60 * 60_000
  );
}

export function configuredFieldRelease(
  env = process.env,
  registry = FIELD_CANDIDATE_RELEASES,
): FieldCandidateRelease | null {
  const r = registry[env.PLAYER_APK_FIELD_CANDIDATE ?? ''];
  if (
    !r ||
    !/^\d+\.\d{1,2}\.\d{1,2}-field\.[1-9]\d*$/.test(r.versionName) ||
    !/^[a-f0-9]{64}$/.test(r.sha256) ||
    !Number.isSafeInteger(r.size) ||
    r.size <= 0 ||
    r.size > MAX_BYTES
  )
    return null;
  const p = r.versionName.split('-')[0].split('.').map(Number);
  if (
    r.versionCode !== p[0] * 10000 + p[1] * 100 + p[2] ||
    !Number.isSafeInteger(r.versionCode)
  )
    return null;
  const verdict = evaluateReleaseForFleet({
    versionName: r.versionName,
    apkUrl: r.sourceUrl,
    computedSha: r.sha256,
  });
  return verdict.allowed ? r : null;
}

interface FieldTicket {
  screenId: string;
  tenantId: string;
  sha256: string;
  versionCode: number;
  exp: number;
}
function mac(payload: string, env: NodeJS.ProcessEnv): Buffer {
  return createHmac('sha256', env.DEVICE_SECRET_KEY ?? '')
    .update(`player-private-field-apk:v1:${payload}`)
    .digest();
}
export function mintFieldTicket(
  r: FieldCandidateRelease,
  screenId: string,
  tenantId: string,
  env = process.env,
  now = Date.now(),
): string | null {
  if (
    !env.DEVICE_SECRET_KEY ||
    !isFieldCandidateTarget(screenId, tenantId, env, now)
  )
    return null;
  const exp = Math.min(
    now + TICKET_MS,
    Date.parse(env.PLAYER_APK_FIELD_EXPIRES_AT!),
  );
  const payload = Buffer.from(
    JSON.stringify({
      screenId,
      tenantId,
      sha256: r.sha256,
      versionCode: r.versionCode,
      exp,
    }),
  ).toString('base64url');
  return `${payload}.${mac(payload, env).toString('base64url')}`;
}
export function verifyFieldTicket(
  raw: unknown,
  r: FieldCandidateRelease,
  env = process.env,
  now = Date.now(),
): FieldTicket | null {
  try {
    if (typeof raw !== 'string' || raw.length > 1024 || !env.DEVICE_SECRET_KEY)
      return null;
    const parts = raw.split('.');
    if (parts.length !== 2 || !parts.every((s) => /^[A-Za-z0-9_-]+$/.test(s)))
      return null;
    const signature = Buffer.from(parts[1], 'base64url'),
      expected = mac(parts[0], env);
    if (
      signature.length !== expected.length ||
      !timingSafeEqual(signature, expected)
    )
      return null;
    const v = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    if (
      !v ||
      v.sha256 !== r.sha256 ||
      v.versionCode !== r.versionCode ||
      !Number.isSafeInteger(v.exp) ||
      v.exp <= now ||
      v.exp > now + TICKET_MS ||
      !isFieldCandidateTarget(v.screenId, v.tenantId, env, now)
    )
      return null;
    return v;
  } catch {
    return null;
  }
}

let cache: { sha: string; bytes: Buffer } | null = null;
let flight: { sha: string; task: Promise<Buffer> } | null = null;
/** Read a single private, digest-named mirror. The committed digest is the authority. */
export async function verifiedFieldBytes(
  r: FieldCandidateRelease,
  env = process.env,
  fetchImpl = fetch,
): Promise<Buffer> {
  if (cache?.sha === r.sha256 && cache.bytes.length === r.size)
    return cache.bytes;
  if (flight?.sha === r.sha256) return flight.task;
  const task = (async () => {
    const root = (env.SUPABASE_URL ?? '').replace(/\/+$/, '');
    if (
      root !== 'https://bhdaxzfalaycfopvcopm.supabase.co' ||
      !env.SUPABASE_SERVICE_ROLE_KEY
    )
      throw Error('field-storage-unconfigured');
    const bucket = env.PLAYER_APK_STORAGE_BUCKET || 'apks';
    if (!/^[a-z0-9_-]{1,63}$/.test(bucket)) throw Error('field-storage-bucket');
    const abort = new AbortController(),
      timer = setTimeout(() => abort.abort(), 15_000);
    try {
      const resp = await fetchImpl(
        `${root}/storage/v1/object/${bucket}/field-player/${r.sha256}.apk`,
        {
          headers: {
            apikey: env.SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
          },
          redirect: 'error',
          signal: abort.signal,
        },
      );
      if (!resp.ok || !resp.body) throw Error('field-storage-unavailable');
      const reader = resp.body.getReader(),
        chunks: Buffer[] = [];
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > r.size || size > MAX_BYTES) throw Error('field-apk-size');
          chunks.push(Buffer.from(value));
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
      const bytes = Buffer.concat(chunks);
      if (
        bytes.length !== r.size ||
        createHash('sha256').update(bytes).digest('hex') !== r.sha256
      )
        throw Error('field-apk-digest');
      cache = { sha: r.sha256, bytes };
      return bytes;
    } finally {
      clearTimeout(timer);
    }
  })();
  flight = { sha: r.sha256, task };
  try {
    return await task;
  } finally {
    if (flight?.task === task) flight = null;
  }
}
