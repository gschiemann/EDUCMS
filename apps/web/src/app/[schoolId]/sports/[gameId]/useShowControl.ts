'use client';

/**
 * useShowControl — the scene-recall state machine, lifted verbatim out of the
 * old full-width ShowControlPanel strip (2026-06-26 console de-clutter).
 *
 * Why a hook: the de-cluttered Run console drives the SAME on-air scene state
 * from TWO places now — the "Show on board" section inside the More menu (where
 * you TAKE a scene) and the slim on-air promote row under the command bar
 * (Back to live + countdown + Hold/+20s). Both need one shared `active` state,
 * so the machine moves up into a hook called once in RunMode and passed to both.
 *
 * Mechanics unchanged: each take fires ctl.scene.mutate({templateId, holdMs});
 * the board polls /sports/board/:id and renders the recalled scene until it
 * expires SERVER-SIDE (a closed laptop can't strand the board). The recall
 * response carries expiresAt, which drives the on-air countdown; the countdown
 * also fires a client-side clear at 0 as a courtesy safety net.
 */
import { useEffect, useRef, useState } from 'react';
import { useTemplates, useGameControl } from '@/hooks/use-api';

export type SceneTpl = { id: string; name?: string };

export function useShowControl(ctl: ReturnType<typeof useGameControl>) {
  const { data: templates } = useTemplates('GAMEDAY');
  const scenes: SceneTpl[] = Array.isArray(templates) ? (templates as SceneTpl[]) : [];

  // Locally-tracked on-air scene (what THIS console recalled). The board is the
  // display source of truth; this just drives the highlight + countdown.
  const [active, setActive] = useState<{ templateId: string; expiresAt: number } | null>(null);
  const [remaining, setRemaining] = useState(0);
  const clearedRef = useRef(false);

  const HOLD_MS = 20_000; // default on-air hold before auto-revert

  const take = (templateId: string) => {
    clearedRef.current = false;
    ctl.scene.mutate(
      { templateId, holdMs: HOLD_MS },
      {
        onSuccess: (res: unknown) => {
          const exp = (res as { expiresAt?: number })?.expiresAt;
          setActive({ templateId, expiresAt: typeof exp === 'number' ? exp : Date.now() + HOLD_MS });
        },
      },
    );
  };

  const backToLive = () => {
    setActive(null);
    ctl.sceneClear.mutate();
  };

  const hold = () => {
    // Freeze the scene on-air (extend to the server's max ~1h) until the
    // operator taps Back to live.
    ctl.sceneExtend.mutate(
      { holdMs: 3_600_000 },
      {
        onSuccess: (res: unknown) => {
          const exp = (res as { expiresAt?: number })?.expiresAt;
          setActive((cur) => (cur ? { ...cur, expiresAt: typeof exp === 'number' ? exp : cur.expiresAt } : cur));
        },
      },
    );
  };

  const extend = () => {
    ctl.sceneExtend.mutate(
      { holdMs: HOLD_MS },
      {
        onSuccess: (res: unknown) => {
          const exp = (res as { expiresAt?: number })?.expiresAt;
          setActive((cur) => (cur ? { ...cur, expiresAt: typeof exp === 'number' ? exp : cur.expiresAt + HOLD_MS } : cur));
        },
      },
    );
  };

  // Countdown + client safety-net auto-clear (server already reverts on expiry;
  // this keeps the panel honest and clears once at 0). Visible-only timer.
  useEffect(() => {
    if (!active) {
      setRemaining(0);
      return;
    }
    const tick = () => {
      const ms = active.expiresAt - Date.now();
      setRemaining(Math.max(0, ms));
      if (ms <= 0 && !clearedRef.current) {
        clearedRef.current = true;
        setActive(null);
        ctl.sceneClear.mutate();
      }
    };
    tick();
    const iv = setInterval(tick, 500);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const held = !!active && active.expiresAt - Date.now() > 600_000; // >10min ≈ "held"
  const secs = Math.ceil(remaining / 1000);
  const countdown = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;

  return { scenes, active, remaining, take, backToLive, hold, extend, held, countdown };
}
