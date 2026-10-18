/**
 * Contract-shaped answers for endpoints the dashboard pages read on every load
 * (2026-10-18).
 *
 * Most dashboard specs route every `/api/v1/**` call through one handler that
 * answers any path it does not know with `[]`. That is a fine default until a
 * page starts reading a field off a new endpoint. On 2026-10-11 two did:
 *
 *   - the Screens page reads `readiness.data?.schools.find(...)` off
 *     `GET /emergency/readiness/district` (5536a7a6, the map's "Emergency gaps"
 *     chip), and
 *   - the screen drawer's playback card reads `capability.maxShortEdge` off
 *     `GET /screens/:id/playback-capability` (80f3b695).
 *
 * The real API answers both with an object, never a list, so `[]` sent every
 * spec that opens the Screens page or a screen drawer to "This page couldn't
 * load". These are the shapes the API returns for a location with no
 * readiness rows and a screen with no playback evidence yet — the quiet
 * defaults: no gap chip (unknown is never a gap) and no capability line.
 *
 * Typed against the hooks the pages use, so a change to either response shape
 * fails type-checking here instead of silently in a browser.
 */
import type { DistrictReadinessResponse, ScreenPlaybackCapabilityResponse } from '../../src/hooks/use-api';

/** `GET /emergency/readiness/district` for a location with no readiness rows. */
export function emptyDistrictReadiness(): DistrictReadinessResponse {
  return {
    delivery: { key: 'delivery', status: 'ok', label: 'Alert delivery', detail: '', fixHint: '' },
    schools: [],
    notReadyCount: 0,
    disabledCount: 0,
    computedAt: new Date().toISOString(),
  };
}

/** `GET /screens/:id/playback-capability` for a screen that has not played a video yet. */
export function unknownPlaybackCapability(screenId: string): ScreenPlaybackCapabilityResponse {
  return {
    screenId,
    summary: 'unknown',
    capability: {
      deviceClass: null,
      maxShortEdge: null,
      stuttersAtShortEdge: null,
      maxFps: null,
      maxUnitConcurrentVideos: null,
      evidence: 'unknown',
      concurrencyEvidence: 'unknown',
      evidenceAt: null,
      classScreens: 0,
      stale: false,
    },
    declared: null,
    files: [],
    demotions: [],
  };
}

/** The screen id in a `/screens/:id/playback-capability` API path, or null for any other path. */
export function playbackCapabilityScreenId(apiPath: string): string | null {
  const m = /^\/screens\/([^/]+)\/playback-capability$/.exec(apiPath);
  return m ? decodeURIComponent(m[1]) : null;
}
