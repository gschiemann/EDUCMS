"use client";

/**
 * ScreenPinCard — the organization's screen PIN (2026-11-09, player stability
 * gap 6). Mounted in Settings → Organization → Organization defaults, next to
 * `LedPosterStandardCard`, with the same look.
 *
 * What it does: when set, a screen's on-screen menu asks for this PIN before
 * it can unpair the screen (which would take it off the emergency alert
 * channel). The API verifies it (`apps/api/src/screens/screen-pin.ts`).
 * Removing a screen from the dashboard never needs it — that is the
 * forgotten-PIN recovery, and the copy says so.
 *
 * The PIN is typed twice, masked, sent once and never shown or read back:
 * the API only ever answers "set / not set". No optimistic success.
 */

import { useState } from 'react';
import { KeyRound, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useClearScreenPin, useScreenPin, useSetScreenPin } from '@/hooks/use-api';
import { useUIStore } from '@/store/ui-store';

/** Mirrors the server's RequireRoles on PUT / DELETE. */
const WRITE_ROLES = ['SUPER_ADMIN', 'DISTRICT_ADMIN'];
const PIN_RE = /^[0-9]{4,8}$/;

export function ScreenPinCard() {
  const t = useTranslations('screenPin');
  const role = useUIStore((s) => s.user?.role as string | undefined);
  const canWrite = !!role && WRITE_ROLES.includes(role);
  const status = useScreenPin();
  const save = useSetScreenPin();
  const clear = useClearScreenPin();

  const [pin, setPin] = useState('');
  const [again, setAgain] = useState('');
  const [result, setResult] = useState<'none' | 'saved' | 'cleared'>('none');

  const isSet = status.data?.set === true;
  const valid = PIN_RE.test(pin);
  const matches = pin === again;
  const busy = save.isPending || clear.isPending;

  const onlyDigits = (v: string) => v.replace(/[^0-9]/g, '').slice(0, 8);

  function submit() {
    if (!valid || !matches) return;
    setResult('none');
    save.mutate(pin, {
      onSuccess: () => { setPin(''); setAgain(''); setResult('saved'); },
    });
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden mt-4" data-testid="screen-pin-card">
      <div className="px-6 py-4 border-b border-slate-100 flex items-start gap-3">
        <div className="w-9 h-9 rounded-lg bg-rose-50 flex items-center justify-center shrink-0">
          <KeyRound className="w-4 h-4 text-rose-600" />
        </div>
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-slate-700">{t('title')}</h2>
          <p className="text-[11px] text-slate-500 mt-0.5">{t('desc')}</p>
        </div>
      </div>

      <div className="px-6 py-4">
        <p className="text-[12px] text-slate-700" data-testid="screen-pin-status">
          {status.isLoading ? '…' : isSet ? t('statusSet') : t('statusUnset')}
        </p>

        <form
          className="flex flex-wrap items-end gap-3 mt-3"
          onSubmit={(e) => { e.preventDefault(); submit(); }}
        >
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{t('pinLabel')}</span>
            <input
              type="password" inputMode="numeric" autoComplete="new-password" maxLength={8}
              value={pin}
              disabled={!canWrite || busy}
              onChange={(e) => { setPin(onlyDigits(e.target.value)); setResult('none'); }}
              className="w-28 px-2 py-1.5 text-sm font-mono text-slate-700 bg-white border border-slate-200 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
              data-testid="screen-pin-input"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{t('confirmLabel')}</span>
            <input
              type="password" inputMode="numeric" autoComplete="new-password" maxLength={8}
              value={again}
              disabled={!canWrite || busy}
              onChange={(e) => { setAgain(onlyDigits(e.target.value)); setResult('none'); }}
              className="w-28 px-2 py-1.5 text-sm font-mono text-slate-700 bg-white border border-slate-200 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
              data-testid="screen-pin-confirm"
            />
          </label>

          <button
            type="submit"
            disabled={!canWrite || busy || !valid || !matches}
            className="px-3 py-2 rounded-lg text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
          >
            {save.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {isSet ? t('change') : t('save')}
          </button>

          {isSet && (
            <button
              type="button"
              disabled={!canWrite || busy}
              onClick={() => { setResult('none'); clear.mutate(undefined, { onSuccess: () => setResult('cleared') }); }}
              className="px-3 py-2 rounded-lg text-xs font-bold text-slate-600 bg-white border border-slate-200 hover:border-slate-400 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t('clear')}
            </button>
          )}
        </form>

        <div className="text-[11px] text-slate-500 mt-3 flex flex-wrap items-center gap-x-2 gap-y-1" role="status">
          {pin.length > 0 && !valid && <span className="text-amber-600">{t('invalid')}</span>}
          {valid && again.length > 0 && !matches && <span className="text-amber-600">{t('mismatch')}</span>}
          {(save.isError || clear.isError) && <span className="text-rose-600">{t('saveFailed')}</span>}
          {result === 'saved' && !busy && <span className="text-emerald-600">{t('saved')}</span>}
          {result === 'cleared' && !busy && <span className="text-emerald-600">{t('cleared')}</span>}
          {!canWrite && <span className="text-slate-400">{t('readOnly')}</span>}
        </div>
        <p className="text-[11px] text-slate-500 mt-2">{t('recovery')}</p>
      </div>
    </div>
  );
}
