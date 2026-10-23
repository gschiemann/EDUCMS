import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { deviceSecretKeyCandidatesFromEnv } from '../security/key-ring';
import {
  FIELD_CANDIDATE_RELEASES,
  type FieldCandidateRelease,
} from './field-candidate-releases';
import { evaluateReleaseForFleet } from './release-policy';
import { supabaseOrigin } from '../storage/supabase-origin';

const uuid = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
const MAX_BYTES = 16 * 1024 * 1024;
const TICKET_MS = 15 * 60_000;
/** The longest window there is: 24 h from now, and for an armed window 24 h from arming. */
const WINDOW_MS = 24 * 60 * 60_000;

const csv = (v: string | undefined): string[] =>
  (v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * One `field_build_windows` row (apps/api/src/field-builds), in the shape the
 * gate reads. A SUPER_ADMIN arms it from /super/field-builds; it replaces
 * editing the PLAYER_APK_FIELD_* variables, which still decide when no window
 * is live.
 */
export interface FieldBuildWindow {
  id: string;
  candidate: string;
  /** The registry digest when armed. A registry entry that no longer matches is refused. */
  candidateSha256: string;
  tenantIds: readonly string[];
  screenIds: readonly string[];
  /** Every screen of every listed tenant. There is no tenant wildcard. */
  allScreens: boolean;
  armedAt: Date | string | number;
  expiresAt: Date | string | number;
  cancelledAt?: Date | string | number | null;
}

let liveWindow: FieldBuildWindow | null = null;

/**
 * The newest un-cancelled, un-expired window as last read. FieldWindowGateMiddleware
 * reads it (cached ≤ 10 s) before an update check or a field download runs,
 * and on no other route — never on a manifest poll. null = no window: the
 * variables decide, exactly as before. Every function below takes it as an
 * explicit last argument; this is only the default.
 */
export function activeFieldWindow(): FieldBuildWindow | null {
  return liveWindow;
}

/** Written by FieldBuildsService after each read of the table (and by tests). */
export function setActiveFieldWindow(window: FieldBuildWindow | null): void {
  liveWindow = window;
}

const ms = (v: Date | string | number | null | undefined): number =>
  v == null ? NaN : v instanceof Date ? v.getTime() : typeof v === 'number' ? v : Date.parse(v);

/** What the gate admits from, whichever source supplied it. */
interface Admission {
  candidate: string;
  /** The armed digest of a window; null when the variables decide. */
  sha256: string | null;
  tenants: string[];
  screens: string[];
  all: boolean;
  end: number;
  /** The latest end this source may have. */
  latestEnd: number;
}

/**
 * A window that is not cancelled and has not (provably) expired wins outright.
 * Its rules are then applied as written: a malformed live window admits
 * nothing rather than falling back. A cancelled or expired window — or none —
 * leaves the variables in charge, read exactly as before.
 */
function admission(
  env: NodeJS.ProcessEnv,
  now: number,
  window: FieldBuildWindow | null | undefined,
): Admission {
  if (window && window.cancelledAt == null && !(ms(window.expiresAt) <= now)) {
    return {
      candidate: typeof window.candidate === 'string' ? window.candidate : '',
      sha256: typeof window.candidateSha256 === 'string' ? window.candidateSha256 : '',
      tenants: Array.isArray(window.tenantIds) ? [...window.tenantIds] : [],
      screens: Array.isArray(window.screenIds) ? [...window.screenIds] : [],
      all: window.allScreens === true,
      end: ms(window.expiresAt),
      // An unknown arming time makes this NaN, which admits nothing.
      latestEnd: Math.min(ms(window.armedAt) + WINDOW_MS, now + WINDOW_MS),
    };
  }
  const screens = csv(env.PLAYER_APK_FIELD_SCREEN_IDS);
  return {
    candidate: env.PLAYER_APK_FIELD_CANDIDATE ?? '',
    sha256: null,
    tenants: csv(env.PLAYER_APK_FIELD_TENANT_ID),
    screens,
    all: screens.some((s) => s.toLowerCase() === 'all'),
    end: Date.parse(env.PLAYER_APK_FIELD_EXPIRES_AT ?? ''),
    latestEnd: now + WINDOW_MS,
  };
}

/**
 * Who may be offered the private field artifact: a screen of a listed tenant,
 * named by id or covered by `all`, inside a bounded explicit window (≤ 24 h);
 * never a fleet latest override.
 *
 * The window comes from `field_build_windows` when one is live (armed from
 * /super/field-builds; at most 24 h from arming as well), otherwise from:
 *
 *   PLAYER_APK_FIELD_TENANT_ID   one tenant uuid, or a comma-separated list
 *                                (2026-10-17: the demo account and the home
 *                                test box live in different tenants)
 *   PLAYER_APK_FIELD_SCREEN_IDS  comma-separated screen uuids, or `all` =
 *                                every screen of every listed tenant (owner,
 *                                2026-10-17: the whole demo account may be
 *                                test screens). Anything else is ignored.
 */
export function isFieldCandidateTarget(
  id: string | null,
  tenant: string | null,
  env = process.env,
  now = Date.now(),
  window: FieldBuildWindow | null = activeFieldWindow(),
): boolean {
  if (!uuid(id) || !uuid(tenant)) return false;
  const a = admission(env, now, window);
  if (!a.tenants.some((t) => uuid(t) && t === tenant)) return false;
  const named = a.all || a.screens.some((s) => s === id);
  return named && Number.isFinite(a.end) && a.end > now && a.end <= a.latestEnd;
}

export function configuredFieldRelease(
  env = process.env,
  registry = FIELD_CANDIDATE_RELEASES,
  window: FieldBuildWindow | null = activeFieldWindow(),
  now = Date.now(),
): FieldCandidateRelease | null {
  const a = admission(env, now, window);
  const r = registry[a.candidate];
  if (
    !r ||
    !/^\d+\.\d{1,2}\.\d{1,2}-field\.[1-9]\d*$/.test(r.versionName) ||
    !/^[a-f0-9]{64}$/.test(r.sha256) ||
    !Number.isSafeInteger(r.size) ||
    r.size <= 0 ||
    r.size > MAX_BYTES
  )
    return null;
  // An armed window pins the digest it was armed with.
  if (a.sha256 !== null && r.sha256 !== a.sha256) return null;
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
function macWith(secret: string, payload: string): Buffer {
  return createHmac('sha256', secret)
    .update(`player-private-field-apk:v1:${payload}`)
    .digest();
}
/** Mint-side: the PRIMARY of the DEVICE_SECRET_KEY ring (security/key-ring.ts). */
function mac(payload: string, env: NodeJS.ProcessEnv): Buffer {
  return macWith(env.DEVICE_SECRET_KEY ?? '', payload);
}
/** Verify-side: primary, then previous during a rotation window; constant-time each. */
function macMatches(payload: string, signature: Buffer, env: NodeJS.ProcessEnv): boolean {
  return deviceSecretKeyCandidatesFromEnv(env).some((secret) => {
    const expected = macWith(secret, payload);
    return signature.length === expected.length && timingSafeEqual(signature, expected);
  });
}
export function mintFieldTicket(
  r: FieldCandidateRelease,
  screenId: string,
  tenantId: string,
  env = process.env,
  now = Date.now(),
  window: FieldBuildWindow | null = activeFieldWindow(),
): string | null {
  if (
    !env.DEVICE_SECRET_KEY ||
    !isFieldCandidateTarget(screenId, tenantId, env, now, window)
  )
    return null;
  const exp = Math.min(now + TICKET_MS, admission(env, now, window).end);
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
  window: FieldBuildWindow | null = activeFieldWindow(),
): FieldTicket | null {
  try {
    if (typeof raw !== 'string' || raw.length > 1024 || !env.DEVICE_SECRET_KEY)
      return null;
    const parts = raw.split('.');
    if (parts.length !== 2 || !parts.every((s) => /^[A-Za-z0-9_-]+$/.test(s)))
      return null;
    const signature = Buffer.from(parts[1], 'base64url');
    if (!macMatches(parts[0], signature, env)) return null;
    const v = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    if (
      !v ||
      v.sha256 !== r.sha256 ||
      v.versionCode !== r.versionCode ||
      !Number.isSafeInteger(v.exp) ||
      v.exp <= now ||
      v.exp > now + TICKET_MS ||
      !isFieldCandidateTarget(v.screenId, v.tenantId, env, now, window)
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
    // The one origin this deploy trusts, from SUPABASE_URL (a bare https
    // origin, exact host). Unset still means "not configured" here, exactly as
    // before: the service-role key is never sent to a defaulted host.
    const trusted = supabaseOrigin(env);
    if (!trusted?.fromEnv || !env.SUPABASE_SERVICE_ROLE_KEY)
      throw Error('field-storage-unconfigured');
    const root = trusted.origin;
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
