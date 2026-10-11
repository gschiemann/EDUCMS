"use client";

/**
 * AutoUpdateSection — automatic Player app updates for ONE screen
 * (2026-10-11, owner decision).
 *
 * Automatic updates are OPT-IN: off unless the organisation turns them on
 * (Settings → Player) or an admin turns them on for this screen. The screen
 * switch overrides the organisation in both directions; "Organization"
 * follows it. Even when on, the SERVER only offers an update when this screen
 * can install without Android's "Install?" prompt, and only in the off-hours
 * window — this panel shows those facts as the server sees them
 * (GET /screens/:id/auto-update), never a guess. "Push update" above is
 * unaffected: a person chose to show the prompt.
 *
 * Read on demand while the settings are open (never polled — mobile-perf
 * standard). Admin roles only can change it (`readOnly` mirrors the API's
 * @RequireRoles); every change is audited server-side.
 */
import { useTranslations } from 'next-intl';
import {
  useScreenAutoUpdate,
  useSetScreenAutoUpdate,
  type AutoUpdateMode,
  type ScreenAutoUpdateInfo,
} from '@/hooks/use-api';

const REASON_KEY: Record<ScreenAutoUpdateInfo['readinessReason'], string | null> = {
  armed: null,
  'no-report': null,
  'report-predates-install': 'reasonReportPredatesInstall',
  'android-too-old': 'reasonAndroidTooOld',
  'installed-by-another-app': 'reasonInstalledByAnotherApp',
  'not-armed': 'reasonNotArmed',
};

export function AutoUpdateSection({ screenId, readOnly }: { screenId: string; readOnly?: boolean }) {
  const t = useTranslations('screens.autoUpdate');
  const q = useScreenAutoUpdate(screenId);
  const set = useSetScreenAutoUpdate();
  const info = q.data;
  const current: AutoUpdateMode = info?.override ?? 'inherit';
  const options: Array<{ v: AutoUpdateMode; label: string }> = [
    { v: 'inherit', label: t('modeInherit') },
    { v: 'on', label: t('modeOn') },
    { v: 'off', label: t('modeOff') },
  ];

  const switchLine = !info
    ? null
    : info.override === 'on'
      ? t('screenOn')
      : info.override === 'off'
        ? t('screenOff')
        : info.orgEnabled
          ? t('inheritOn')
          : t('inheritOff');

  const readinessLine = !info
    ? null
    : info.readiness === 'silent'
      ? t('silent')
      : info.readiness === 'needs-tap'
        ? t('needsTap')
        : t('unknown');
  const reasonKey = info ? REASON_KEY[info.readinessReason] : null;

  return (
    <div className="px-3.5 py-2.5 border-b border-slate-100" data-testid="auto-update-section">
      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{t('title')}</p>
      <p className="text-[10.5px] text-slate-500 mt-0.5">{t('hint')}</p>
      <div className="flex items-center gap-1 mt-1.5" role="group" aria-label={t('title')}>
        {options.map((o) => (
          <button
            key={o.v}
            type="button"
            disabled={readOnly || !info || set.isPending}
            aria-pressed={o.v === current}
            aria-label={`${t('title')}: ${o.label}`}
            onClick={(e) => {
              e.stopPropagation();
              if (o.v === current) return;
              set.mutate({ screenId, mode: o.v });
            }}
            className={`flex-1 px-2 py-1.5 rounded-lg text-[11px] font-bold border transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${
              o.v === current
                ? 'bg-indigo-600 text-white border-indigo-600'
                : 'bg-white text-slate-600 border-slate-200 hover:bg-indigo-50 hover:border-indigo-200'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
      <div className="mt-1.5 space-y-0.5 text-[11px] leading-snug" aria-live="polite">
        {q.isLoading && <p className="text-slate-400">{t('loading')}</p>}
        {switchLine && <p className="text-slate-700 font-semibold">{switchLine}</p>}
        {info && info.enabled && info.readiness === 'silent' && info.window && (
          <p className="text-emerald-700">
            {t('willUpdate', { start: info.window.start, end: info.window.end, timezone: info.window.timezone })}
          </p>
        )}
        {info && !info.enabled && <p className="text-slate-500">{t('off')}</p>}
        {readinessLine && (
          <p className={info?.readiness === 'silent' ? 'text-slate-600' : 'text-amber-700'}>{readinessLine}</p>
        )}
        {reasonKey && <p className="text-slate-500">{t(reasonKey)}</p>}
        {info && info.enabled && !info.window && <p className="text-amber-700">{t('noTimezone')}</p>}
        {set.isPending && <p className="text-slate-400">{t('saving')}</p>}
        {set.isError && <p className="text-rose-700">{t('saveFailed')}</p>}
      </div>
    </div>
  );
}
