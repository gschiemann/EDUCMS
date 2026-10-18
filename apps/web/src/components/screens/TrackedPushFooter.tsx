'use client';

/**
 * TrackedPushFooter — the bottom line of the Player-app row while the SERVER
 * holds an operator push for this screen (2026-10-18, tracked pushes):
 * when it was sent, how many times it was handed to the screen, which build,
 * and Cancel.
 *
 * Cancel exists because a push no longer expires on its own: one that waits
 * for a tap, stalled, failed or expired stays on this row until the screen
 * runs the offered build or someone ends it here. The confirm says plainly
 * what Cancel cannot do — take an Android "Install?" prompt off the glass.
 *
 * Dashboard surface (not player/widget), so flex `gap` is fine.
 */

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useCancelApkUpdate } from '@/hooks/use-api';
import { appConfirm } from '@/components/ui/app-dialog';
import type { TrackedPush } from './trackedPush';

/** "5 minutes ago" / "hace 5 minutos" / "5分钟前" in the reader's language. */
export function relativeAgo(locale: string, atMs: number, nowMs: number): string {
  const diffSec = Math.min(0, Math.round((atMs - nowMs) / 1000));
  const abs = Math.abs(diffSec);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (abs < 60) return rtf.format(diffSec, 'second');
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), 'minute');
  if (abs < 86_400) return rtf.format(Math.round(diffSec / 3600), 'hour');
  return rtf.format(Math.round(diffSec / 86_400), 'day');
}

export function TrackedPushFooter({
  screenId,
  screenName,
  push,
  readOnly,
  nowMs,
  onCancelled,
}: {
  screenId: string;
  screenName: string | null;
  push: TrackedPush;
  readOnly?: boolean;
  nowMs: number;
  /** The page's own "just pushed" record for this screen ends with the push. */
  onCancelled?: () => void;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const cancel = useCancelApkUpdate();
  // Keyed by screen id, so re-pointing the drawer at another screen drops it.
  const [result, setResult] = useState<{ screenId: string; kind: 'cancelled' | 'failed' } | null>(null);
  const shown = result?.screenId === screenId ? result.kind : null;

  const facts =
    t('screens.apk.push.facts', { ago: relativeAgo(locale, push.pushedAtMs, nowMs), count: push.offers }) +
    (push.targetVersion ? ` · v${push.targetVersion}` : '');

  const onCancel = async () => {
    const ok = await appConfirm({
      title: t('screens.apk.push.cancelTitle', { name: screenName || t('screens.drawer.thisScreen') }),
      message: t('screens.apk.push.cancelMessage'),
      confirmLabel: t('screens.apk.push.cancelConfirm'),
      cancelLabel: t('screens.apk.push.cancelKeep'),
      tone: 'warn',
    });
    if (!ok) return;
    cancel.mutate(screenId, {
      onSuccess: () => {
        setResult({ screenId, kind: 'cancelled' });
        onCancelled?.();
      },
      onError: () => setResult({ screenId, kind: 'failed' }),
    });
  };

  return (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-slate-200 px-3.5 py-2"
      data-testid="apk-push-tracked"
    >
      <span className="flex-1 min-w-0 text-[11px] font-medium text-slate-600" data-testid="apk-push-facts">
        {facts}
      </span>
      {!readOnly && shown !== 'cancelled' && (
        <button
          type="button"
          data-testid="apk-push-cancel"
          onClick={onCancel}
          disabled={cancel.isPending}
          className="shrink-0 min-h-11 px-3 py-2 rounded-lg border border-slate-300 bg-white text-[11px] font-bold text-slate-700 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {cancel.isPending ? t('screens.apk.push.cancelling') : t('screens.apk.push.cancel')}
        </button>
      )}
      {/* Always mounted (only visually empty) so the live region exists before
          its text does — a region inserted with its message is often not read. */}
      <span role="status" aria-live="polite" className={shown ? 'w-full text-[11px]' : 'sr-only'}>
        {shown === 'cancelled' && <span className="text-slate-600">{t('screens.apk.push.cancelled')}</span>}
        {shown === 'failed' && <span className="text-rose-700">{t('screens.apk.push.cancelFailed')}</span>}
      </span>
    </div>
  );
}
