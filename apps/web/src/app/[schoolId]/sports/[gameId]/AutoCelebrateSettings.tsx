'use client';

/**
 * K12-F36 — the table's automatic-celebration settings for one game (Setup →
 * Show settings): on / off, which of the sport's automatic cues fire, and the
 * time between two. The API reads these fresh inside every scoring command,
 * so a change here holds on every server at once (it used to be a
 * per-process switch with no control in the console at all).
 *
 * No poller (mobile-perf standard): one read, and each change writes the
 * cache from the server's answer.
 */
import { useTranslations } from 'next-intl';
import { useAutoCelebrate, useSetAutoCelebrate } from '@/hooks/use-api';

export function AutoCelebrateSettings({ gameId }: { gameId: string }) {
  const t = useTranslations('sportsCelebrate');
  const { data } = useAutoCelebrate(gameId);
  const set = useSetAutoCelebrate(gameId);
  // An API from before K12-F36 answers `{ enabled }` only (the web can deploy
  // ahead of the API): show nothing rather than take the Setup view down.
  if (!data || !Array.isArray(data.available) || !Array.isArray(data.off) || !Array.isArray(data.cooldownOptions)) {
    return null;
  }

  const on = data.enabled;
  const busy = set.isPending;
  const toggleCue = (key: string) => {
    const off = data.off.includes(key) ? data.off.filter((k) => k !== key) : [...data.off, key];
    set.mutate({ off });
  };

  return (
    <div data-testid="auto-celebrate-settings">
      <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-2">{t('title')}</p>
      <p className="text-xs text-slate-400 mb-2">{t('intro')}</p>
      {data.available.length === 0 ? (
        <p className="text-xs text-slate-500">{t('noneForSport')}</p>
      ) : (
        <div className="space-y-2">
          <label className="flex min-h-[36px] items-center gap-2 text-sm font-semibold text-slate-700">
            <input
              type="checkbox"
              checked={on}
              disabled={busy}
              onChange={() => set.mutate({ enabled: !on })}
              className="h-4 w-4 accent-indigo-600"
            />
            {t('toggle')}
          </label>
          {on && (
            <>
              <p className="text-[11px] font-semibold text-slate-500">{t('whichLabel')}</p>
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {data.available.map((c) => (
                  <label
                    key={c.key}
                    className="flex min-h-[36px] items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-700"
                  >
                    <input
                      type="checkbox"
                      checked={!data.off.includes(c.key)}
                      disabled={busy}
                      onChange={() => toggleCue(c.key)}
                      className="h-3.5 w-3.5 accent-indigo-600"
                    />
                    <span aria-hidden>{c.emoji}</span>
                    <span className="font-semibold">{c.label}</span>
                    <span className="text-slate-400">{t('points', { list: c.points.join(' / ') })}</span>
                  </label>
                ))}
              </div>
              <label className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-600">
                <span>{t('cooldownLabel')}</span>
                <select
                  value={data.cooldownSec}
                  disabled={busy}
                  onChange={(e) => set.mutate({ cooldownSec: Number(e.target.value) })}
                  className="min-h-[36px] rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700"
                >
                  {data.cooldownOptions.map((sec) => (
                    <option key={sec} value={sec}>
                      {sec === 0 ? t('cooldownNone') : t('cooldownSeconds', { seconds: sec })}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
        </div>
      )}
      {set.isError && (
        <p role="alert" className="mt-1.5 text-xs text-rose-600">
          {t('saveFailed')}
        </p>
      )}
    </div>
  );
}
