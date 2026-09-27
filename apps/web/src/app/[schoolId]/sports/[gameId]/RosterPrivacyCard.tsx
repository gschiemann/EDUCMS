'use client';

/**
 * "What public screens show about players" — the school's roster visibility
 * for this game (K-12 launch audit F38, 2026-09-27).
 *
 * The public board (`/sports/board/:id`, readable by anyone with the URL)
 * carries the roster for the lineup, player-card and intro surfaces. This
 * card is where the school decides, per game, whether students' names,
 * jersey numbers, photos, positions and stats leave the server at all. The
 * API applies it to the public payload (apps/api/src/sports/roster-privacy.ts)
 * — the operator's own roster view is unaffected.
 *
 * Saves immediately on each change (one PATCH, latest wins), like the other
 * game-day toggles on this page. No timers, no polling.
 */

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, Loader2 } from 'lucide-react';
import { apiFetch } from '@/lib/api-client';

export interface RosterPrivacy {
  names: 'full' | 'last' | 'hidden';
  numbers: boolean;
  photos: boolean;
  positions: boolean;
  stats: boolean;
}

const DEFAULTS: RosterPrivacy = { names: 'full', numbers: true, photos: true, positions: true, stats: true };

export function RosterPrivacyCard({ gameId }: { gameId: string }) {
  const t = useTranslations('sportsTemplates.privacy');
  const qc = useQueryClient();
  const key = ['sports', 'roster-privacy', gameId];
  const { data, isLoading } = useQuery<RosterPrivacy>({
    queryKey: key,
    queryFn: () => apiFetch<RosterPrivacy>(`/sports/games/${gameId}/roster-privacy`),
    staleTime: 60_000,
  });
  const save = useMutation({
    mutationFn: (next: RosterPrivacy) =>
      apiFetch<RosterPrivacy>(`/sports/games/${gameId}/roster-privacy`, {
        method: 'PATCH',
        body: JSON.stringify(next),
      }),
    onMutate: async (next) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<RosterPrivacy>(key);
      qc.setQueryData(key, next);
      return { prev };
    },
    onError: (_e, _next, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
    },
    onSuccess: (saved) => qc.setQueryData(key, saved),
  });

  const p = data ?? DEFAULTS;
  const set = (patch: Partial<RosterPrivacy>) => save.mutate({ ...p, ...patch });
  const restricted = p.names !== 'full' || !p.numbers || !p.photos || !p.positions || !p.stats;

  const toggle = (k: 'numbers' | 'photos' | 'positions' | 'stats', label: string) => (
    <label key={k} className="flex items-center gap-2 text-xs text-slate-600">
      <input type="checkbox" checked={p[k]} disabled={isLoading} onChange={(e) => set({ [k]: e.target.checked } as Partial<RosterPrivacy>)} />
      {label}
    </label>
  );

  return (
    <section
      aria-labelledby={`roster-privacy-${gameId}`}
      className="mb-4 rounded-xl border border-slate-200 bg-slate-50/70 p-3"
    >
      <div className="flex items-center justify-between gap-2 mb-1">
        <h3 id={`roster-privacy-${gameId}`} className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
          <ShieldCheck className="h-4 w-4 text-emerald-600" aria-hidden />
          {t('title')}
        </h3>
        <span role="status" className="text-[11px] text-slate-500">
          {save.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-label={t('saving')} /> : save.isError ? t('error') : restricted ? t('restricted') : t('everything')}
        </span>
      </div>
      <p className="text-[11px] text-slate-500 mb-2">
        {t('help')}{' '}
        <Link href="/ferpa" className="underline text-indigo-600">{t('ferpaLink')}</Link>
      </p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="flex items-center gap-2 text-xs text-slate-600">
          {t('names')}
          <select
            aria-label={t('names')}
            value={p.names}
            disabled={isLoading}
            onChange={(e) => set({ names: e.target.value as RosterPrivacy['names'] })}
            className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs"
          >
            <option value="full">{t('namesFull')}</option>
            <option value="last">{t('namesLast')}</option>
            <option value="hidden">{t('namesHidden')}</option>
          </select>
        </label>
        {toggle('numbers', t('numbers'))}
        {toggle('photos', t('photos'))}
        {toggle('positions', t('positions'))}
        {toggle('stats', t('stats'))}
      </div>
    </section>
  );
}
