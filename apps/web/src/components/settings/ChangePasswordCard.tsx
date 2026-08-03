"use client";

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlertCircle, CheckCircle2, KeyRound, Loader2, ShieldAlert } from 'lucide-react';
import { useChangePassword } from '@/hooks/use-api';
import { useUIStore } from '@/store/ui-store';

/**
 * ChangePasswordCard — rotate your own password, and sign every other device
 * out while you do it.
 *
 * ACC-02 (2026-08-01) added `POST /auth/change-password` and shipped it with
 * NO UI, so the only way to rotate a password was the emailed reset link: a
 * user who suspected their session was compromised had no in-product way to
 * lock it down. This is that door.
 *
 * TWO THINGS THIS DOES THAT A NAIVE FORM WOULD GET WRONG:
 *
 * 1. It swaps the stored token. The server revokes every live token for the
 *    account and hands back ONE replacement pinned past the revocation cut.
 *    If the client keeps its old token, the user's very next click 401s and
 *    they get bounced to the login screen by their own security action.
 *
 * 2. It tells the truth about containment. `sessionsRevoked:false` means the
 *    password DID change but the revocation store was unreachable — other
 *    sessions may still be live. Reporting a plain "Password updated" there
 *    would be a lie about the one property the user came here for.
 */
export function ChangePasswordCard() {
  const t = useTranslations();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<null | { sessionsRevoked: boolean }>(null);

  const changePassword = useChangePassword();
  const setToken = useUIStore((s) => s.setToken);

  const MIN_LEN = 8;

  const reset = () => {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setDone(null);

    // Client-side pre-checks mirror the server's Zod schema so the common
    // mistakes cost zero round-trips (and no argon2 work on the API).
    if (newPassword.length < MIN_LEN) {
      setError(t('changePassword.errTooShort', { min: MIN_LEN }));
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t('changePassword.errMismatch'));
      return;
    }
    if (newPassword === currentPassword) {
      setError(t('changePassword.errUnchanged'));
      return;
    }

    try {
      const res = await changePassword.mutateAsync({ currentPassword, newPassword });
      // Swap the token FIRST — every other token for this account, including
      // the one this tab is holding, was just revoked.
      if (res?.access_token) setToken(res.access_token);
      reset();
      setDone({ sessionsRevoked: !!res?.sessionsRevoked });
    } catch (err: any) {
      setError(err?.message || t('changePassword.errGeneric'));
    }
  };

  const inputCls =
    'w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 ' +
    'placeholder:text-slate-400 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition';

  return (
    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-100 flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
          <KeyRound className="w-4 h-4 text-slate-500" />
        </div>
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-slate-800">{t('changePassword.title')}</h2>
          <p className="text-[11px] text-slate-500 mt-0.5">{t('changePassword.subtitle')}</p>
        </div>
      </div>

      <div className="p-6">
        {error && (
          <div className="flex items-start gap-2 px-3 py-2.5 mb-4 bg-rose-50 border border-rose-200 rounded-lg">
            <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
            <p className="text-xs text-rose-700 font-medium">{error}</p>
          </div>
        )}

        {/* Success is deliberately two different messages — see the header
            note on telling the truth about containment. */}
        {done && done.sessionsRevoked && (
          <div className="flex items-start gap-2 px-3 py-2.5 mb-4 bg-emerald-50 border border-emerald-200 rounded-lg">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            <p className="text-xs text-emerald-800 font-medium">{t('changePassword.okRevoked')}</p>
          </div>
        )}
        {done && !done.sessionsRevoked && (
          <div className="flex items-start gap-2 px-3 py-2.5 mb-4 bg-amber-50 border border-amber-200 rounded-lg">
            <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-800 font-medium">{t('changePassword.okNotRevoked')}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* A hidden username field is what tells a password manager WHICH
              account these fields belong to; without it, saved-credential
              updates land on the wrong entry or not at all. */}
          <input type="text" name="username" autoComplete="username" className="hidden" tabIndex={-1} readOnly value="" />
          <div>
            <label htmlFor="cp-current" className="block text-xs font-semibold text-slate-700 mb-1.5">
              {t('changePassword.currentLabel')}
            </label>
            <input
              id="cp-current"
              type="password"
              required
              autoComplete="current-password"
              placeholder="••••••••"
              className={inputCls}
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="cp-new" className="block text-xs font-semibold text-slate-700 mb-1.5">
              {t('changePassword.newLabel')}
            </label>
            <input
              id="cp-new"
              type="password"
              required
              minLength={MIN_LEN}
              autoComplete="new-password"
              placeholder="••••••••"
              className={inputCls}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              aria-describedby="cp-new-help"
            />
            <p id="cp-new-help" className="mt-1.5 text-[11px] text-slate-400">
              {t('changePassword.newHelp', { min: MIN_LEN })}
            </p>
          </div>
          <div>
            <label htmlFor="cp-confirm" className="block text-xs font-semibold text-slate-700 mb-1.5">
              {t('changePassword.confirmLabel')}
            </label>
            <input
              id="cp-confirm"
              type="password"
              required
              autoComplete="new-password"
              placeholder="••••••••"
              className={inputCls}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </div>

          <button
            type="submit"
            disabled={changePassword.isPending}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-bold rounded-lg inline-flex items-center gap-2 transition-colors"
          >
            {changePassword.isPending ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> {t('changePassword.updating')}</>
            ) : (
              t('changePassword.submit')
            )}
          </button>
          <p className="text-[11px] text-slate-400">{t('changePassword.revokeNote')}</p>
        </form>
      </div>
    </div>
  );
}
