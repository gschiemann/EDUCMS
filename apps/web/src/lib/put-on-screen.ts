"use client";

// E3 (CRUSH Wave E, 2026-07-03) — shared "Put on a screen" express lane.
//
// Extracted verbatim from the gallery's `putOnScreen` handler
// (apps/web/src/app/[schoolId]/templates/page.tsx, ~2026-06-30) so the
// SAME one-tap "board → live screen" flow is reachable from a second call
// site (the in-editor toolbar, E3) without duplicating the mutation /
// navigation logic. Behavior is unchanged: spin up a template-backed
// playlist (one DB row, no item wiring — a template playlist references
// the template), then hand off to the playlist's existing
// playlist Content workspace with its screen picker open. Works identically on
// desktop and mobile; no new API surface.
import { useCallback, useState } from 'react';
import { useCreatePlaylist } from '@/hooks/use-api';
import { appAlert } from '@/components/ui/app-dialog';

/** Minimal shape putOnScreen needs — callers can pass a full Template. */
export interface PutOnScreenTarget {
  id: string;
  name: string;
}

/**
 * Returns `{ putOnScreen, puttingOnScreenId }`. `putOnScreen(target)`
 * creates a one-item playlist from `target` and full-navigates to the
 * playlist Content workspace with its template loaded and Add screens open.
 *
 * `disabled` (e.g. RESTRICTED_VIEWER, or "nothing to publish yet") mirrors
 * the gallery's `isViewer` guard — pass the caller's own read-only check.
 */
export function usePutOnScreen(schoolId: string | undefined, disabled?: boolean) {
  const createPlaylist = useCreatePlaylist();
  const [puttingOnScreenId, setPuttingOnScreenId] = useState<string | null>(null);

  const putOnScreen = useCallback(async (target: PutOnScreenTarget) => {
    if (disabled || puttingOnScreenId) return;
    setPuttingOnScreenId(target.id);
    try {
      const created = await createPlaylist.mutateAsync({
        // Keep the name recognizable so it's easy to find in the playlist list.
        name: target.name,
        templateId: target.id,
      });
      const playlistId = (created as { id?: string } | undefined)?.id;
      if (!playlistId) throw new Error('Playlist was created without an id.');
      // Open the created playlist with its template selected, and immediately
      // offer the existing screen picker. No schedule is written by navigation.
      window.location.href =
        `/${schoolId ?? ''}/playlists/${encodeURIComponent(playlistId)}?addScreens=1`;
    } catch (err) {
      setPuttingOnScreenId(null);
      await appAlert({
        title: 'Could not start publishing',
        message: (err as Error)?.message || 'We could not create a playlist from this board. Try again.',
        tone: 'danger',
        confirmLabel: 'Got it',
      });
    }
  }, [disabled, puttingOnScreenId, createPlaylist, schoolId]);

  return { putOnScreen, puttingOnScreenId };
}
