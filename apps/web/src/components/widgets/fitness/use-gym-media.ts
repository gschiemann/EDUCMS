'use client';

/**
 * use-gym-media — turn a board's bound media sources into the one honest
 * snapshot the gym media boards render.
 *
 * The whole point of this file is that the DERIVATION LIVES IN ONE PLACE.
 * A signage board that says LIVE · CONNECTED while nothing is connected
 * is the club's liability printed eight feet tall, so "what may this
 * screen claim?" is answered once, from the connection's real status and
 * the server-supplied capability — never from a provider id, never from
 * a URL parameter, never from a default.
 *
 * What each state means is documented in
 * `apps/web/public/templates/fitness/_media-runtime.js`; this hook only
 * decides WHICH one is true right now.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';

export type GymMediaState =
  | 'unconfigured' | 'fresh' | 'stale' | 'offline'
  | 'external' | 'denied' | 'pending' | 'demo';

interface ConnectionLite {
  id: string;
  providerId: string;
  providerName: string;
  displayName?: string;
  status: 'PENDING' | 'ACTIVE' | 'EXPIRED' | 'REVOKED' | 'ERROR';
  statusReason?: string;
  mediaRole?: 'RENDERS' | 'EXTERNAL' | 'PENDING_ADAPTER';
  isMusic?: boolean;
}

export interface GymMediaBinding {
  programConnectionId?: string;
  musicConnectionId?: string;
}

export interface GymMediaSnapshot {
  state: GymMediaState;
  clock?: { timeZone?: string; hour12?: boolean };
  program?: { providerLabel?: string; sourceLabel?: string };
  music?: { state: GymMediaState; providerLabel?: string; playbackState?: 'PLAYING' | 'PAUSED' | 'IDLE' };
}

/**
 * One connection → the strongest claim it justifies.
 *
 * Ordered most-severe first: a revoked source is not "external" just
 * because it is an external device, and an unreachable feed is not
 * "live" just because the row says ACTIVE.
 */
export function stateForConnection(c: ConnectionLite | undefined): GymMediaState {
  if (!c) return 'unconfigured';
  // Access was taken away or ran out. Nothing may play.
  if (c.status === 'REVOKED' || c.status === 'EXPIRED') return 'denied';
  // We looked and could not reach it.
  if (c.status === 'ERROR') return 'offline';
  // Playback belongs to the provider's licensed device; we never claim it.
  if (c.mediaRole === 'EXTERNAL') return 'external';
  // A real service we have not finished building an adapter for.
  if (c.mediaRole === 'PENDING_ADAPTER' || c.status === 'PENDING') return 'pending';
  // A feed VenueOS plays itself, verified reachable. This is the ONLY
  // path to a live claim, and the player still has to actually play it.
  if (c.mediaRole === 'RENDERS' && c.status === 'ACTIVE') return 'fresh';
  return 'pending';
}

/**
 * @param enabled  only true for a gym media board — every other widget
 *                 must not pay for this query.
 */
export function useGymMedia(
  enabled: boolean,
  binding: GymMediaBinding | undefined,
  timeZone?: string,
): GymMediaSnapshot | null {
  const q = useQuery<ConnectionLite[]>({
    queryKey: ['stream-connections'],
    queryFn: () => apiFetch<ConnectionLite[]>('/streaming/connections'),
    enabled,
    staleTime: 30_000,
    retry: false,
  });

  return useMemo(() => {
    if (!enabled) return null;
    const rows = q.data;
    // Until we know, say nothing — the board's own default (SOURCE NOT
    // CONFIGURED) is the safe thing to be showing meanwhile.
    if (!rows) return null;

    const program = binding?.programConnectionId
      ? rows.find((c) => c.id === binding.programConnectionId)
      : undefined;
    const music = binding?.musicConnectionId
      ? rows.find((c) => c.id === binding.musicConnectionId)
      : undefined;

    const state = stateForConnection(program);
    const musicState = binding?.musicConnectionId ? stateForConnection(music) : 'unconfigured';

    return {
      state,
      clock: timeZone ? { timeZone } : undefined,
      program: program
        ? { providerLabel: (program.displayName || program.providerName || '').toUpperCase() || undefined }
        : undefined,
      music: {
        state: musicState,
        providerLabel: music ? (music.displayName || music.providerName) : undefined,
        // No adapter reports playback yet, so nothing here ever says
        // PLAYING — which is what keeps the equalizer still rather than
        // performing music that may not be on.
        playbackState: 'IDLE',
      },
    };
  }, [enabled, q.data, binding?.programConnectionId, binding?.musicConnectionId, timeZone]);
}
