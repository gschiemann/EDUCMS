"use client";

import { useState, use } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { API_URL } from '@/lib/api-url';
import { ResetShell, RESET_INPUT_CLS, RESET_BUTTON_CLS } from '@/components/auth/AuthCardShell';

export default function ResetPasswordCompletePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = use(params);
  const t = useTranslations('passwordReset');
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password.length < 8) {
      setError(t('tooShort'));
      return;
    }
    if (password !== confirm) {
      setError(t('mismatch'));
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/password-reset/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword: password }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setDone(true);
        setTimeout(() => router.push('/login'), 1500);
      } else {
        setError(data.message || t('linkInvalid'));
      }
    } catch {
      setError(t('unreachable'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <ResetShell title={t('completeTitle')}>
      {done ? (
        <div className="text-center space-y-2" role="status">
          <CheckCircle2 className="w-9 h-9 text-emerald-500 mx-auto" aria-hidden />
          <p className="text-sm text-slate-900 font-semibold">{t('updatedTitle')}</p>
          <p className="text-xs text-slate-600">{t('updatedBody')}</p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="reset-new-password" className="block text-xs font-semibold text-slate-700 mb-1.5">{t('newPassword')}</label>
            <input
              id="reset-new-password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={RESET_INPUT_CLS}
            />
            <p className="mt-1 text-[11px] text-slate-500">{t('newPasswordHint')}</p>
          </div>
          <div>
            <label htmlFor="reset-confirm-password" className="block text-xs font-semibold text-slate-700 mb-1.5">{t('confirmPassword')}</label>
            <input
              id="reset-confirm-password"
              type="password"
              required
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className={RESET_INPUT_CLS}
            />
          </div>
          {error && (
            <div role="alert" className="flex items-start gap-2 px-3 py-2.5 bg-red-50 border border-red-200 rounded-lg">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" aria-hidden />
              <p className="text-xs text-red-700 font-medium">{error}</p>
            </div>
          )}
          <button type="submit" disabled={loading} className={RESET_BUTTON_CLS}>
            {loading ? <><Loader2 className="w-4 h-4 animate-spin" aria-hidden /> {t('saving')}</> : t('updatePassword')}
          </button>
        </form>
      )}
    </ResetShell>
  );
}
