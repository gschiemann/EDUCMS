'use client';

/**
 * /account-suspended — where the dashboard lands when the API answers 403 ORG_SUSPENDED
 * (customer console, 2026-10-10). Says plainly what still works (screens, emergency alerts), how
 * to get it back, and keeps the two exits that must never be behind a billing state: the
 * emergency panel (its API routes are exempt from suspension) and sign-out.
 */
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { PauseCircle, Siren } from 'lucide-react';
import { useUIStore } from '@/store/ui-store';

const SUPPORT_EMAIL = 'sales@venue-os.app';

export default function AccountSuspendedPage() {
  const t = useTranslations('customerConsole.suspended');
  const logout = useUIStore((s) => s.logout);
  const user = useUIStore((s) => s.user);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const canPanic = mounted && !!user && (user.canTriggerPanic || ['DISTRICT_ADMIN', 'SCHOOL_ADMIN', 'SUPER_ADMIN'].includes(user.role));

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl p-8 text-center">
        <PauseCircle className="w-10 h-10 text-amber-500 mx-auto mb-3" aria-hidden />
        <h1 className="text-xl font-bold text-slate-900">{t('title')}</h1>
        <p className="text-sm text-slate-600 mt-2">{t('body')}</p>
        <p className="text-sm text-slate-600 mt-2">{t('contact', { email: SUPPORT_EMAIL })}</p>
        <div className="mt-5 flex flex-col gap-2">
          {canPanic && (
            <a href="/panic" className="min-h-11 inline-flex items-center justify-center gap-2 rounded-xl bg-rose-600 text-white text-sm font-semibold">
              <Siren className="w-4 h-4" aria-hidden /> {t('panic')}
            </a>
          )}
          <button
            type="button"
            onClick={() => { logout(); window.location.assign('/login'); }}
            className="min-h-11 rounded-xl border border-slate-300 text-sm font-semibold text-slate-700"
          >
            {t('signOut')}
          </button>
        </div>
      </div>
    </div>
  );
}
