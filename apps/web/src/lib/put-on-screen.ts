"use client";

// E3 (CRUSH Wave E, 2026-07-03) — shared "Put on a screen" express lane.
//
// Extracted verbatim from the gallery's `putOnScreen` handler
// (apps/web/src/app/[schoolId]/templates/page.tsx, ~2026-06-30) so the
// SAME one-tap "board → live screen" flow is reachable from a second call
// site (the in-editor toolbar, E3) without duplicating the mutation /
// navigation logic. Behavior is unchanged: spin up a template-backed
// playlist (one DB row, no item wiring — a template playlist references
// the template), then hand off to the playlists page's existing
// Publish-to-Screens sheet via `?publishPlaylist=`. Works identically on
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
 * playlists page with `?publishPlaylist=<id>` so the operator lands
 * directly on the Publish-to-Screens sheet — no forms, no extra clicks.
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
      // Hand off to the playlists page, which auto-selects this playlist and
      // opens its Publish-to-Screens sheet (see the ?publishPlaylist= handler
      // there). Full nav (not router.push) matches the builder-open pattern and
      // guarantees the playlists page mounts fresh with the param.
      window.location.href =
        `/${schoolId ?? ''}/playlists?publishPlaylist=${encodeURIComponent(playlistId)}`;
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
