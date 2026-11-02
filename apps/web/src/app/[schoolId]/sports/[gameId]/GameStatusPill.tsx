'use client';

/**
 * GameStatusPill — the game's state (Scheduled / Pre-game / Live / Halftime /
 * Final) as the ONE read-only status pill (pill audit 2026-11-02). It used to be
 * hand-rolled three times on the game page (command bar, setup, standalone
 * state strip) with three copies of the same colour table.
 *
 * Read-only by construction (`StatusPill` is a span). The colour is never the
 * only signal: the dot plus the word say it, and a live game's dot pulses.
 */
import { useTranslations } from 'next-intl';
import { StatusPill, type StatusTone } from '@/components/ui/status-pill';

const TONE: Record<string, { tone: StatusTone; dot: string }> = {
  SCHEDULED: { tone: 'neutral', dot: 'bg-slate-400' },
  PRE_GAME: { tone: 'warning', dot: 'bg-amber-500' },
  LIVE: { tone: 'danger', dot: 'bg-red-500 animate-pulse motion-reduce:animate-none' },
  HALFTIME: { tone: 'info', dot: 'bg-sky-500' },
  FINAL: { tone: 'neutral', dot: 'bg-slate-700' },
};

export const GAME_STATUSES = ['SCHEDULED', 'PRE_GAME', 'LIVE', 'HALFTIME', 'FINAL'] as const;

export function GameStatusPill({ status, testId }: { status: string | null | undefined; testId?: string }) {
  const t = useTranslations('sportsPad.status');
  const key = (GAME_STATUSES as readonly string[]).includes(String(status)) ? String(status) : 'SCHEDULED';
  const m = TONE[key];
  return (
    // aria-live on the wrapper: a state change (Live → Halftime) is announced.
    <span aria-live="polite" className="inline-flex shrink-0">
      <StatusPill
        tone={m.tone}
        data-testid={testId ?? 'game-status-pill'}
        icon={<span className={`h-2 w-2 rounded-full ${m.dot}`} aria-hidden="true" />}
      >
        {t(key)}
      </StatusPill>
    </span>
  );
}
