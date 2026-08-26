"use client";

/**
 * useStarterBoard — "does this tenant have the board we made for them?"
 *
 * Every tenant created after 2026-08-24 is seeded at signup with ONE
 * vertical-appropriate template plus a playlist that holds it
 * (`apps/api/src/onboarding/starter-board.service.ts`). Two dashboard surfaces
 * need to know about it — the simulated-screen card and the getting-started
 * guide's first step — so the lookup lives here once instead of twice.
 *
 * ZERO EXTRA NETWORK. It reads `useScreens` + `usePlaylists`, both already
 * mounted by the dashboard and deduped by React Query, and the playlist row
 * already carries `template: { id, name, … }`. No poller, no new endpoint.
 * (The card fetches the full template separately, but only when it is actually
 * going to render one.)
 *
 * Tenants that predate the seed simply have no template-backed playlist and get
 * `null` — the callers fall back to their old behavior. Nothing is backfilled.
 */

import { useMemo } from 'react';
import { usePlaylists, useScreens } from '@/hooks/use-api';

/**
 * The name `StarterBoardService` gives the seeded playlist. A PREFERENCE, not a
 * requirement: the resolver falls back to the oldest template-backed playlist,
 * so an operator renaming it (or the server-side constant changing) degrades to
 * "still finds the board" rather than "the card vanishes."
 */
export const STARTER_PLAYLIST_NAME = 'My first playlist';

export interface StarterBoardResult {
  /** True only once `useScreens` has SETTLED with an empty fleet. */
  fleetIsEmpty: boolean;
  /** The playlist holding the starter board, or null. */
  playlist: any | null;
  /** `{ id, name, screenWidth, screenHeight, category }` — the summary the
   *  playlist row already carries. Enough to link + label; NOT enough to
   *  render (that needs zones — fetch the template itself). */
  template: { id: string; name: string; screenWidth?: number; screenHeight?: number } | null;
  /**
   * "This operator has moved past the thing we made them."
   *
   * `StarterBoardService` leaves EXACTLY one artifact behind: one playlist,
   * holding one template, with ZERO items — and it refuses to seed a tenant
   * that already owns any template, so that shape is unambiguous. Anything
   * beyond it is the operator's own work:
   *   • a SECOND playlist exists — they built their own, or
   *   • the seeded playlist has slides in it — they filled it themselves.
   *
   * Both read off the already-mounted `usePlaylists()` rows (which carry
   * `items`), so this costs no request. It is deliberately NOT "the tenant owns
   * a template we didn't seed" — proving that needs the full `GET /templates`
   * gallery, a payload heavy enough that the 2026-05-09 perf note measured it
   * in SECONDS, and no dashboard mounts it today. That residual case (boards
   * built but never put in a playlist) is what the card's dismiss is for.
   */
  hasOwnContent: boolean;
}

export function useStarterBoard(): StarterBoardResult {
  const screensQuery = useScreens();
  const { data: playlists } = usePlaylists();

  // Gate on a SETTLED empty fleet, not on `screens?.length` — an in-flight
  // query reads as zero screens, which would flash "you have no screens" UI at
  // tenants running a live wall of displays.
  const fleetIsEmpty = screensQuery.isSuccess && (screensQuery.data || []).length === 0;

  const playlist = useMemo(() => {
    const backed = (playlists || []).filter((p: any) => p?.template?.id);
    if (backed.length === 0) return null;
    const byName = backed.find((p: any) => p.name === STARTER_PLAYLIST_NAME);
    if (byName) return byName;
    return [...backed].sort(
      (a: any, b: any) =>
        new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime(),
    )[0];
  }, [playlists]);

  // Graduation signal — see `hasOwnContent` above. Guarded on a settled list:
  // an in-flight query reads as "no content", which must not be mistaken for
  // "brand new tenant" in either direction.
  const hasOwnContent = useMemo(() => {
    const list = playlists || [];
    if (list.length === 0) return false;
    // Anything that is not the one playlist we seeded is the operator's own.
    if (list.some((p: any) => p?.id !== playlist?.id)) return true;
    // ...or they filled the seeded one themselves (it ships with zero items).
    return (playlist?.items?.length ?? 0) > 0;
  }, [playlists, playlist]);

  return { fleetIsEmpty, playlist, template: playlist?.template ?? null, hasOwnContent };
}
