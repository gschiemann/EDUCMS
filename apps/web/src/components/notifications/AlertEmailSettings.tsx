"use client";

/**
 * Alert emails — the person's own switch + language (2026-10-23).
 *
 * Administrators get an email when one of their screens goes offline, stops
 * showing content, or an emergency alert / all-clear is sent. ON by default;
 * this is where they turn it off (every alert email links here:
 * /<slug>/account#alert-emails). Rendered only for people who receive them.
 *
 * A failed save keeps the state the SERVER last confirmed and says so — never
 * an optimistic flip to the value that was clicked.
 */
import { useState } from 'react';
import { Mail } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useAlertEmailPrefs, useSetAlertEmailPrefs, type AlertEmailPrefs } from '@/hooks/use-api';
import { LOCALES, LOCALE_LABELS } from '@/i18n/config';
import { cn } from '@/lib/utils';

export function AlertEmailSettings() {
  const t = useTranslations('account.alertEmails');
  const { data, isPending, isError } = useAlertEmailPrefs();
  const save = useSetAlertEmailPrefs();
  const [status, setStatus] = useState<'idle' | 'saved' | 'failed'>('idle');

  if (isPending || isError || !data || !data.eligible) return null;

  const submit = async (body: { enabled?: boolean; locale?: AlertEmailPrefs['locale'] }) => {
    setStatus('idle');
    try {
      await save.mutateAsync(body);
      setStatus('saved');
    } catch {
      setStatus('failed');
    }
  };

  const enabled = data.enabled;
  return (
    <div id="alert-emails" className="px-4 py-3 space-y-3 scroll-mt-20">
      <div className="flex items-center gap-3">
        <Mail className="w-4 h-4 text-slate-400 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-slate-800">{t('title')}</div>
          <div className="text-[11px] text-slate-500">{t('sub')}</div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label={t('toggle')}
          disabled={save.isPending}
          onClick={() => submit({ enabled: !enabled })}
          className={cn(
            'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-60',
            enabled ? 'bg-emerald-500' : 'bg-slate-300',
          )}
        >
          <span
            className={cn(
              'inline-block h-5 w-5 rounded-full bg-white shadow transition-transform',
              enabled ? 'translate-x-5' : 'translate-x-0.5',
            )}
          />
          <span className="sr-only">{enabled ? t('on') : t('off')}</span>
        </button>
      </div>
      {enabled && (
        <label className="flex items-center justify-between gap-3 pl-7 text-[12px] text-slate-600">
          <span>{t('language')}</span>
          <select
            value={data.locale ?? ''}
            disabled={save.isPending}
            onChange={(e) => submit({ locale: (e.target.value || null) as AlertEmailPrefs['locale'] })}
            className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[12px] text-slate-800"
          >
            <option value="">{t('languageDefault')}</option>
            {LOCALES.map((l) => (
              <option key={l} value={l}>
                {LOCALE_LABELS[l]}
              </option>
            ))}
          </select>
        </label>
      )}
      {status !== 'idle' && (
        <div role="status" className={cn('pl-7 text-[11px]', status === 'failed' ? 'text-rose-600' : 'text-emerald-600')}>
          {status === 'failed' ? t('saveFailed') : t('saved')}
        </div>
      )}
    </div>
  );
}
