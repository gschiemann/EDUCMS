'use client';

/**
 * Per-student privacy flags on a game's roster (K-12 sports launch, lane B3,
 * 2026-09-27):
 *   "Directory opt-out — never display" — the family opted out of directory
 *       information: the student's name and photo never reach a public screen;
 *   "Photo release on file" — required, per student, before a school's public
 *       screen may show this student's photo.
 *
 * Rendered only where the student-privacy policy applies (a school, or a
 * tenant serving minors). Protecting a student — opting out, removing a
 * release — is anyone who edits the roster; showing MORE — clearing an
 * opt-out, recording a release — is a school administrator's call, so those
 * directions are disabled for everyone else (the API enforces the same rule).
 * The values shown are the ones the public view applies (a linked athlete's
 * flags count), and a change shows at once while it saves.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useSetStudentFlags } from '@/hooks/use-student-privacy';

export function StudentFlagControls({
  gameId,
  playerId,
  directoryOptOut,
  photoRelease,
  isAdmin,
}: {
  gameId: string;
  playerId: string;
  directoryOptOut: boolean;
  photoRelease: boolean;
  isAdmin: boolean;
}) {
  const t = useTranslations('studentPrivacy.roster');
  const save = useSetStudentFlags(gameId);
  const [pending, setPending] = useState<{ directoryOptOut?: boolean; photoRelease?: boolean } | null>(null);
  const optOut = pending?.directoryOptOut ?? directoryOptOut;
  const release = pending?.photoRelease ?? photoRelease;

  const set = (patch: { directoryOptOut?: boolean; photoRelease?: boolean }) => {
    setPending((cur) => ({ ...(cur ?? {}), ...patch }));
    save.mutate({ playerId, ...patch }, { onSettled: () => setPending(null) });
  };

  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-600">
      <label className="inline-flex items-center gap-1" title={optOut && !isAdmin ? t('adminOnly') : undefined}>
        <input
          type="checkbox"
          aria-label={t('optOut')}
          checked={optOut}
          disabled={save.isPending || (optOut && !isAdmin)}
          onChange={(e) => set({ directoryOptOut: e.target.checked })}
        />
        {t('optOut')}
      </label>
      <label className="inline-flex items-center gap-1" title={!release && !isAdmin ? t('adminOnly') : undefined}>
        <input
          type="checkbox"
          aria-label={t('photoRelease')}
          checked={release && !optOut}
          disabled={save.isPending || optOut || (!release && !isAdmin)}
          onChange={(e) => set({ photoRelease: e.target.checked })}
        />
        {t('photoRelease')}
      </label>
      {optOut && <span className="font-semibold text-amber-700">{t('optedOutNote')}</span>}
    </div>
  );
}
