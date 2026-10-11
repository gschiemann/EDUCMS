"use client";

/**
 * Which screens can update themselves (2026-10-11).
 *
 * Automatic Player updates only go to screens that install without Android's
 * "Install?" prompt, inside the off-hours window. This list shows, per
 * screen, what the server will do — the same decision the update-check gate
 * makes (`apps/api/src/player-ota/auto-update-policy.ts`), read from
 * `GET /tenants/me/auto-update-readiness`. Read on demand, never polled.
 */
import { useTranslations } from 'next-intl';
import { useAutoUpdateReadiness, type ScreenAutoUpdateInfo } from '@/hooks/use-api';

const STATUS_CLASS: Record<ScreenAutoUpdateInfo['readiness'], string> = {
  silent: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  'needs-tap': 'bg-amber-50 text-amber-800 border-amber-200',
  unknown: 'bg-slate-50 text-slate-600 border-slate-200',
};

export function AutoUpdateReadinessList() {
  const t = useTranslations('settings.cc.player.autoReady');
  const q = useAutoUpdateReadiness();
  const rows = q.data?.screens ?? [];
  const count = (r: ScreenAutoUpdateInfo['readiness']) => rows.filter((s) => s.readiness === r).length;
  const status = (r: ScreenAutoUpdateInfo['readiness']) =>
    r === 'silent' ? t('statusSilent') : r === 'needs-tap' ? t('statusTap') : t('statusUnknown');

  if (q.isLoading) return <p className="text-[12px] text-slate-500">{t('loading')}</p>;
  if (q.isError) return <p className="text-[12px] text-rose-700">{t('loadFailed')}</p>;
  if (rows.length === 0) return <p className="text-[12px] text-slate-500">{t('empty')}</p>;

  return (
    <div data-testid="auto-update-readiness">
      <p className="text-[12.5px] text-slate-700" aria-live="polite">
        {t('countSilent', { count: count('silent') })} · {t('countTap', { count: count('needs-tap') })} ·{' '}
        {t('countUnknown', { count: count('unknown') })}
      </p>
      <ul className="mt-2 divide-y divide-slate-100 rounded-[10px] border border-slate-200 bg-white">
        {rows.map((s) => (
          <li key={s.screenId} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-[12.5px]">
            <span className="min-w-0 flex-1 truncate font-medium text-slate-900">{s.name}</span>
            <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${STATUS_CLASS[s.readiness]}`}>
              <span className="sr-only">{t('colInstall')}: </span>
              {status(s.readiness)}
            </span>
            <span className="shrink-0 text-[11.5px] text-slate-600">
              <span className="sr-only">{t('colAutomatic')}: </span>
              {s.enabled ? t('autoOn') : t('autoOff')}
              {s.enabledSource === 'screen' ? ` ${t('autoFromScreen')}` : ''}
            </span>
            <span className="basis-full text-[11px] text-slate-500 sm:basis-auto">
              {s.window
                ? t('window', { start: s.window.start, end: s.window.end, timezone: s.window.timezone })
                : t('windowNone')}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
