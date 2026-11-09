'use client';

/**
 * UpdateQuarantineSection - "Companion updates" in the screen drawer's Actions
 * tab (Manager wave 3, #8).
 *
 * The companion Manager sets a build aside after it failed its first boot and
 * never lets it go. This is the admin's way to let ONE screen be offered that
 * build again: POST /screens/:id/clear-update-quarantine.
 *
 * Copy states what the evidence proves (player-reliability rule 10):
 *  - it says "sent", never "cleared" - the server cannot see the glass and the
 *    command is not acknowledged;
 *  - it says plainly that this is NOT a rollback: VenueOS is never the device
 *    owner, and without device owner Android refuses to install an older
 *    version over the one running, so a build on the screen only goes forward.
 *
 * Shown only for a screen that has reported a companion (managerVersion) and
 * only to roles that can control the screen (the same set as the route).
 */

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Loader2, ShieldOff } from 'lucide-react';
import { apiFetch } from '@/lib/api-client';
import { appConfirm } from '@/components/ui/app-dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

export interface UpdateQuarantineSectionProps {
  screenId: string;
  /** `Screen.managerVersion` - null/empty = no companion has reported. */
  managerVersion?: string | null;
  canControl: boolean;
  onSent?: () => void;
}

export function UpdateQuarantineSection({ screenId, managerVersion, canControl, onSent }: UpdateQuarantineSectionProps) {
  const t = useTranslations();
  const [sentFor, setSentFor] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ screenId: string; message: string } | null>(null);

  const clear = useMutation({
    // The section renders its own failure line; no second toast.
    meta: { suppressGlobalError: true },
    mutationFn: (id: string) =>
      apiFetch<{ ok: boolean; published: boolean }>(`/screens/${id}/clear-update-quarantine`, { method: 'POST' }),
  });

  if (!managerVersion || !canControl) return null;

  const sent = sentFor === screenId;
  const error = failure?.screenId === screenId ? failure.message : null;

  const fire = async () => {
    if (clear.isPending || sent) return;
    const ok = await appConfirm({
      title: t('screens.quarantine.confirmTitle'),
      message: t('screens.quarantine.confirmMessage'),
      confirmLabel: t('screens.quarantine.confirmButton'),
    });
    if (!ok) return;
    setFailure(null);
    clear.mutate(screenId, {
      onSuccess: () => {
        setSentFor(screenId);
        onSent?.();
      },
      onError: (e) => setFailure({ screenId, message: e?.message || 'unknown error' }),
    });
  };

  return (
    <section data-testid="update-quarantine-section" aria-labelledby={`uq-${screenId}`}>
      <div className="mb-2">
        <h3 id={`uq-${screenId}`} className="text-[10px] font-black uppercase tracking-wider text-slate-400">
          {t('screens.quarantine.title')}
        </h3>
        <p className="text-[11px] font-semibold text-slate-400 mt-0.5">{t('screens.quarantine.hint')}</p>
      </div>
      <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3.5">
        <p className="text-[12.5px] font-semibold text-slate-700 leading-snug">{t('screens.quarantine.body')}</p>
        <p className="mt-2 text-[11.5px] font-semibold text-slate-500 leading-snug" data-testid="update-quarantine-no-rollback">
          {t('screens.quarantine.noRollback')}
        </p>
        <Button
          type="button"
          variant="outline"
          size="lg"
          className="mt-3 w-full justify-start"
          onClick={fire}
          disabled={clear.isPending || sent}
        >
          {clear.isPending ? (
            <Loader2 className="animate-spin" aria-label={t('screens.quarantine.sending')} />
          ) : (
            <ShieldOff aria-hidden />
          )}
          <span className="font-bold">{sent ? t('screens.quarantine.sent') : t('screens.quarantine.button')}</span>
        </Button>
        {sent && (
          <p className="mt-2 text-[11.5px] font-semibold text-slate-600 leading-snug" role="status">
            {t('screens.quarantine.sentNote')}
          </p>
        )}
        {error && (
          <Alert variant="destructive" className="mt-2">
            <AlertDescription>{t('screens.quarantine.failed', { error })}</AlertDescription>
          </Alert>
        )}
      </div>
    </section>
  );
}
