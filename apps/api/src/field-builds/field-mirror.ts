/**
 * Is a field build's private copy in the bucket? (2026-10-18, /super/field-builds)
 *
 * The offer path reads ONE object per candidate — `<bucket>/field-player/<sha>.apk`
 * — and verifies every byte against the committed digest before any screen is
 * handed it (player-ota/field-candidate.ts `verifiedFieldBytes`). This file
 * only asks whether that object exists and has the registered size, with an
 * authenticated HEAD, so the panel can say "mirrored: yes / no" without
 * downloading anything. It is never a source of truth: a "present" here is
 * not a verified artifact, and the offer path verifies regardless.
 *
 * Same trust rules as the offer path: the one Supabase origin SUPABASE_URL
 * names (an unset variable is "not configured" — the service key is never sent
 * to a defaulted host), the same bucket rule, no redirects, a 5 s bound.
 * Answers are kept 30 s per digest so a page refresh does not re-probe.
 */
import type { FieldCandidateRelease } from '../player-ota/field-candidate-releases';
import { supabaseOrigin } from '../storage/supabase-origin';

export type MirrorState = 'present' | 'missing' | 'size-mismatch' | 'unconfigured' | 'unknown';

export interface MirrorStatus {
  state: MirrorState;
  /** The storage answer when there was one (never a URL — it carries no secret, but keeps the log terse). */
  httpStatus?: number;
  checkedAt: string;
}

/** The states in which an offer can never succeed — the push route refuses on these. */
export const MIRROR_BLOCKS_PUSH: ReadonlySet<MirrorState> = new Set(['missing', 'size-mismatch', 'unconfigured']);

const TTL_MS = 30_000;
const TIMEOUT_MS = 5_000;
const memo = new Map<string, { at: number; status: MirrorStatus }>();

/** Tests only. */
export function __resetFieldMirrorMemoForTests(): void {
  memo.clear();
}

export async function fieldMirrorStatus(
  r: FieldCandidateRelease,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
  now: () => number = Date.now,
): Promise<MirrorStatus> {
  const hit = memo.get(r.sha256);
  if (hit && now() - hit.at < TTL_MS) return hit.status;
  const status = await probe(r, env, fetchImpl, now);
  // An "unknown" (timeout, 5xx) is not remembered: the next look tries again.
  if (status.state !== 'unknown') memo.set(r.sha256, { at: now(), status });
  return status;
}

async function probe(
  r: FieldCandidateRelease,
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch,
  now: () => number,
): Promise<MirrorStatus> {
  const checkedAt = new Date(now()).toISOString();
  const trusted = supabaseOrigin(env);
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = env.PLAYER_APK_STORAGE_BUCKET || 'apks';
  if (!trusted?.fromEnv || !key || !/^[a-z0-9_-]{1,63}$/.test(bucket) || !/^[a-f0-9]{64}$/.test(r.sha256)) {
    return { state: 'unconfigured', checkedAt };
  }
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  try {
    const resp = await fetchImpl(`${trusted.origin}/storage/v1/object/${bucket}/field-player/${r.sha256}.apk`, {
      method: 'HEAD',
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      redirect: 'error',
      signal: abort.signal,
    });
    if (resp.ok) {
      const length = resp.headers.get('content-length');
      if (length !== null && Number(length) !== r.size) {
        return { state: 'size-mismatch', httpStatus: resp.status, checkedAt };
      }
      return { state: 'present', httpStatus: resp.status, checkedAt };
    }
    // Storage answers a missing object 404, or 400 on older versions.
    if (resp.status === 404 || resp.status === 400) return { state: 'missing', httpStatus: resp.status, checkedAt };
    return { state: 'unknown', httpStatus: resp.status, checkedAt };
  } catch {
    return { state: 'unknown', checkedAt };
  } finally {
    clearTimeout(timer);
  }
}
