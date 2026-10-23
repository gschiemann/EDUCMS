/**
 * The render-trust GRADE, server side (2026-10-23, customer alert emails).
 *
 * The dashboard decides what a screen's render chip says with
 * `deriveRenderTrustGrade` (apps/web/src/components/screens/renderTrust.ts),
 * fed by the API's own `deriveRenderHealth` (screens/render-proof.ts). The
 * "online but not showing content" email must say exactly what that chip
 * says, never something stricter — so this is a verbatim PORT of the web
 * grade, and `render-trust-grade.spec.ts` runs the web module and this one
 * over the same fixtures so they cannot drift. Nothing here is new policy.
 */
import { deriveRenderHealth, type RenderHealth } from '../../screens/render-proof';

export type RenderTrustVariant = 'painting' | 'not-painting' | 'unknown' | 'offline';
export type RenderTrustGrade =
  | RenderTrustVariant
  | 'checking'
  | 'stale-chronic'
  | 'idle'
  | 'downloading'
  | 'content-unavailable'
  | 'content-loading'
  | 'connecting'
  | 'paused'
  | 'repair-required'
  | 'media-stalled'
  | 'alert-unconfirmed'
  | 'alert-not-painted';

export interface RenderTrustInput {
  status?: string | null;
  renderHealth?: RenderHealth | null;
  renderStale?: boolean | null;
  lastRenderedAtMs?: number | null;
  nowMs?: number;
  lastRenderedHash?: string | null;
  authState?: string | null;
}

/** Mirrors the web's RENDER_STALE_AFTER_MS / ALARM / CHRONIC constants. */
export const RENDER_STALE_AFTER_MS = 90_000;
export const RENDER_ALARM_AFTER_MS = 5 * 60_000;
export const RENDER_CHRONIC_AFTER_MS = 48 * 3600_000;

function idleProofKind(hash: string | null | undefined) {
  if (typeof hash !== 'string' || !hash.startsWith('idle:')) return null;
  switch (hash.slice('idle:'.length)) {
    case 'content-downloading':
      return 'downloading';
    case 'content-unavailable':
      return 'unavailable';
    case 'content-loading':
      return 'loading';
    case 'connecting':
    case 'registering':
    case 'pairing':
    case 'offline':
      return 'connecting';
    default:
      return 'nothing-scheduled';
  }
}

function deriveRenderTrust(input: RenderTrustInput): RenderTrustVariant {
  if (input.status !== 'ONLINE') return 'offline';
  if (input.renderStale === true) return 'not-painting';
  if (input.renderHealth === 'STALE') return 'not-painting';
  if (input.renderHealth === 'OK') return 'painting';
  if (input.renderHealth === 'UNKNOWN') return 'unknown';
  if (input.lastRenderedAtMs == null) return 'unknown';
  const now = input.nowMs ?? Date.now();
  return now - input.lastRenderedAtMs >= RENDER_STALE_AFTER_MS ? 'not-painting' : 'painting';
}

export function deriveRenderTrustGrade(input: RenderTrustInput): RenderTrustGrade {
  const base = deriveRenderTrust(input);
  const hash = input.lastRenderedHash;
  if (hash?.startsWith('pending|em:')) return 'alert-not-painted';
  if (base === 'painting' && typeof hash === 'string' && hash.startsWith('unconfirmed|em:')) return 'alert-unconfirmed';
  if (base === 'painting' && typeof hash === 'string' && hash.startsWith('stall|')) return 'media-stalled';
  if (input.authState === 'REPAIR_REQUIRED' && base !== 'offline') return 'repair-required';
  if (base === 'painting') {
    switch (idleProofKind(hash)) {
      case 'unavailable':
        return 'content-unavailable';
      case 'downloading':
        return 'downloading';
      case 'loading':
        return 'content-loading';
      case 'connecting':
        return 'connecting';
      case 'nothing-scheduled':
        return 'idle';
      default:
        break;
    }
  }
  if (base === 'painting' && typeof hash === 'string' && hash.startsWith('paused:')) return 'paused';
  if (base !== 'not-painting') return base;
  if (input.lastRenderedAtMs == null) return 'not-painting';
  const age = (input.nowMs ?? Date.now()) - input.lastRenderedAtMs;
  if (age < RENDER_ALARM_AFTER_MS) return 'checking';
  if (age > RENDER_CHRONIC_AFTER_MS) return 'stale-chronic';
  return 'not-painting';
}

/**
 * Grade one screen row the way `GET /screens` + the chip do: ONLINE when the
 * ping is fresh, render health from the server's own render-proof module.
 */
export function gradeScreenRow(
  s: {
    lastPingAt: Date | null;
    lastRenderedAt: Date | null;
    lastRenderedHash: string | null;
    authState: string | null;
  },
  nowMs: number,
  pingFreshMs: number,
): RenderTrustGrade {
  const pingAge = s.lastPingAt ? nowMs - s.lastPingAt.getTime() : Infinity;
  const live = pingAge >= 0 && pingAge <= pingFreshMs;
  const lastRenderedAtMs = s.lastRenderedAt ? s.lastRenderedAt.getTime() : null;
  const health = deriveRenderHealth({
    isLiveOnline: live,
    lastRenderedAtMs,
    lastRenderedHash: s.lastRenderedHash,
    nowMs,
  });
  return deriveRenderTrustGrade({
    status: live ? 'ONLINE' : 'OFFLINE',
    renderHealth: health.renderHealth,
    renderStale: health.renderStale,
    lastRenderedAtMs,
    lastRenderedHash: s.lastRenderedHash,
    authState: s.authState,
    nowMs,
  });
}
