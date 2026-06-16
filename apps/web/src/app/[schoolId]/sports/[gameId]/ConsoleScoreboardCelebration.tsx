'use client';

/**
 * 2026-06-16 — Celebration overlay for the operator console's interactive
 * scoreboard. ROOT CAUSE of "nothing fires on the scoreboard": the console's
 * ribbon preview is an <iframe> of the real /ribbon route (so cues fire there),
 * but the scoreboard zone is RunInteractiveScoreboard — the operator's CONTROL
 * surface (score tiles + clock) with NO celebration rendering. So a fired cue
 * showed on the ribbon preview and nothing on the scoreboard.
 *
 * This mounts an absolute overlay over the scoreboard zone that polls the same
 * board cue feed and plays the SAME cinematic (celebrationSrc) the real board
 * does — in place, so the operator sees the celebration fire right where
 * they're working, keeping the controls and costing no extra screen height.
 * Mirrors the board route's cue pump (seen/firstLoad/lastCueSig dedup + hold).
 */
import { useEffect, useRef, useState } from 'react';
import { API_URL } from '@/lib/api-url';
import {
  celebrationSrc,
  celebrationLiveDataFromCue,
  type CelebrationPack,
} from '@/lib/celebration-assets';

interface BoardCue {
  id: string;
  key?: string;
  target?: string;
  team?: 'home' | 'away' | string;
  color?: string | null;
  mediaUrl?: string | null;
  durationMs?: number;
  snapshot?: { homeColor?: string | null; awayColor?: string | null } | null;
  scorerName?: string | null;
  scorerNumber?: string | null;
}

export function ConsoleScoreboardCelebration({
  gameId,
  sport,
  pack,
}: {
  gameId: string;
  sport?: string | null;
  pack: CelebrationPack;
}) {
  const [cue, setCue] = useState<BoardCue | null>(null);
  const seen = useRef<Set<string>>(new Set());
  const firstLoad = useRef(true);
  const queue = useRef<BoardCue[]>([]);
  const playing = useRef(false);
  const lastSig = useRef<{ key: string; team: string; t: number }>({ key: '', team: '', t: 0 });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!gameId) return;
    let alive = true;

    const pump = () => {
      if (playing.current) return;
      const next = queue.current.shift();
      if (!next) return;
      playing.current = true;
      setCue(next);
      const hold =
        next.mediaUrl && next.durationMs && next.durationMs > 0 ? next.durationMs : 4800;
      timer.current = setTimeout(() => {
        setCue(null);
        playing.current = false;
        pump();
      }, hold);
    };

    const load = async () => {
      try {
        const res = await fetch(`${API_URL}/sports/board/${gameId}`, { cache: 'no-store' });
        if (!res.ok) return;
        const json = await res.json();
        if (!alive) return;
        for (const c of (json.cues || []) as BoardCue[]) {
          if (seen.current.has(c.id)) continue;
          seen.current.add(c.id);
          // First poll's cues already happened; record as seen, don't replay.
          // Ribbon-only cues never play on the scoreboard.
          if (firstLoad.current || c.target === 'RIBBON') continue;
          // Coalesce the auto+manual duplicate of one scoring moment.
          const ck = String(c.key || '');
          const ctm = String(c.team || '');
          const now = Date.now();
          const lc = lastSig.current;
          if (ck && lc.key === ck && (!lc.team || !ctm || lc.team === ctm) && now - lc.t < 6000) {
            continue;
          }
          lastSig.current = { key: ck, team: ctm, t: now };
          queue.current.push(c);
        }
        firstLoad.current = false;
        pump();
      } catch {
        /* transient poll error — try again next tick */
      }
    };

    load();
    const t = setInterval(load, 750);
    return () => {
      alive = false;
      clearInterval(t);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [gameId]);

  if (!cue) return null;

  const teamColor =
    cue.color ||
    (cue.team === 'away' ? cue.snapshot?.awayColor : cue.snapshot?.homeColor) ||
    cue.snapshot?.homeColor ||
    null;
  const url = cue.mediaUrl
    ? null
    : celebrationSrc(
        sport,
        cue.key,
        teamColor,
        pack,
        'scoreboard',
        celebrationLiveDataFromCue(cue as Parameters<typeof celebrationLiveDataFromCue>[0]),
      );

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        zIndex: 40,
        background: '#05070d',
        pointerEvents: 'none',
        overflow: 'hidden',
        // 2026-06-16 — CENTER the cinematic and LOCK its aspect. The console's
        // scoreboard zone is wide-and-short (control tiles), so a width:100%
        // height:100% iframe stretched the 16:9 board cinematic into a squished
        // "wrong resolution." Now it renders as a proper 16:9 box, fit to the
        // zone's height, centered — exactly the 1920×1080 board, just scaled.
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {cue.mediaUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={cue.mediaUrl}
          alt=""
          style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
        />
      ) : url ? (
        <iframe
          src={url}
          title="scoreboard celebration"
          scrolling="no"
          allow="autoplay"
          sandbox="allow-scripts"
          style={{
            // 16:9 board, fit to the zone height, never stretched.
            height: '100%',
            aspectRatio: '16 / 9',
            maxWidth: '100%',
            border: 0,
            display: 'block',
          }}
        />
      ) : null}
    </div>
  );
}
