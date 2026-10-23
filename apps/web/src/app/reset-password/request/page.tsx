"use client";

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { API_URL } from '@/lib/api-url';
import { takeEmailForReset } from '@/lib/sign-in-steps';
import { ResetShell, RESET_INPUT_CLS, RESET_BUTTON_CLS } from '@/components/auth/AuthCardShell';

export default function RequestPasswordResetPage() {
  const t = useTranslations('passwordReset');
  const [email, setEmail] = useState('');
  // The sign-in page hands over the address the operator already typed
  // ("Forgot password?" on its password step) so it is not typed twice. Read
  // after mount (no storage on the server) and consumed on read.
  useEffect(() => {
    const handed = takeEmailForReset();
    if (handed) setEmail((current) => current || handed);
  }, []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  // 2026-05-23 launch audit P0: when the deploy is missing
  // RESEND_API_KEY the API still returns ok:true, so we need to
  // surface a different UI message ("contact admin") instead of
  // "check your inbox" — otherwise a locked-out user waits forever
  // for an email that's never coming.
  const [emailConfigured, setEmailConfigured] = useState(true);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/password-reset/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data?.emailConfigured === false) setEmailConfigured(false);
        setSubmitted(true);
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.message || t('genericError'));
      }
    } catch {
      setError(t('unreachable'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <ResetShell title={t('requestTitle')} subtitle={submitted ? undefined : t('requestSubtitle')}>
      {submitted ? (
        emailConfigured ? (
          <div className="text-center space-y-2" role="status">
            <CheckCircle2 className="w-9 h-9 text-emerald-500 mx-auto" aria-hidden />
            <p className="text-sm text-slate-900 font-semibold">{t('checkInboxTitle')}</p>
            <p className="text-xs text-slate-600">{t('checkInboxBody')}</p>
          </div>
        ) : (
          <div className="text-center space-y-2" role="status">
            <AlertCircle className="w-9 h-9 text-amber-500 mx-auto" aria-hidden />
            <p className="text-sm text-slate-900 font-semibold">{t('emailOffTitle')}</p>
            <p className="text-xs text-slate-600">{t('emailOffBody')}</p>
          </div>
        )
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="reset-request-email" className="block text-xs font-semibold text-slate-700 mb-1.5">{t('emailLabel')}</label>
            <input
              id="reset-request-email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
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
            {loading ? <><Loader2 className="w-4 h-4 animate-spin" aria-hidden /> {t('sending')}</> : t('sendLink')}
          </button>
        </form>
      )}
    </ResetShell>
  );
}
