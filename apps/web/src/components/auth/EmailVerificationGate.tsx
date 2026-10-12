"use client";

/**
 * SELF-SIGNUP EMAIL VERIFICATION (2026-10-11, launch security re-audit).
 *
 * A self-signed-up admin whose email is not proven yet (`user.
 * emailVerificationPending`) sees this INSTEAD of the dashboard / onboarding:
 * the API refuses every route but /auth/verify-email/{send,confirm},
 * /auth/logout and /users/me until the emailed code is entered (JwtAuthGuard
 * `EMAIL_VERIFICATION_ALLOWED_ROUTES`). Signup itself stays open — only the
 * address has to be real.
 *
 * One code is requested automatically when the screen first appears (the user
 * just signed up, so the address is fresh); "Send a new code" is rate-limited
 * by the server. On success the server hands back a session token whose `evv`
 * claim says verified, and the store flag flips so the page underneath renders.
 * Raw fetches, like CredentialSetupGate, because apiFetch's background token
 * refresh is a route this gate refuses.
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, MailCheck } from 'lucide-react';
import { useUIStore } from '@/store/ui-store';
import { API_URL } from '@/lib/api-url';
import { ensureCsrfToken } from '@/lib/csrf';

const INPUT_CLS =
  'w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 tracking-[0.3em] text-center font-mono ' +
  'placeholder:text-slate-400 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition';

export function EmailVerificationGate() {
  const t = useTranslations('emailVerification');
  const user = useUIStore((s) => s.user);
  const setToken = useUIStore((s) => s.setToken);
  const setUser = useUIStore((s) => s.setUser);
  const logout = useUIStore((s) => s.logout);

  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [resendIn, setResendIn] = useState(0);
  const sentOnce = useRef(false);
  const codeRef = useRef<HTMLInputElement>(null);

  const headers = async (): Promise<Record<string, string>> => {
    const h: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${useUIStore.getState().token ?? ''}`,
    };
    const csrf = await ensureCsrfToken().catch(() => null);
    if (csrf) h['X-CSRF-Token'] = csrf;
    return h;
  };

  const markVerified = () => {
    const cur = useUIStore.getState().user;
    if (cur) setUser({ ...cur, emailVerificationPending: false });
  };

  const send = async () => {
    setError('');
    setNote('');
    setBusy(true);
    try {
      const res = await fetch(`${API_URL}/auth/verify-email/send`, {
        method: 'POST',
        credentials: 'include',
        headers: await headers(),
        body: '{}',
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.sent) {
        setNote(t('sent'));
        setResendIn(30);
      } else if (data?.code === 'EMAIL_ALREADY_VERIFIED') {
        markVerified();
      } else if (res.status === 429) {
        setError(t('tooMany'));
      } else {
        setError(t('sendFailed'));
      }
    } catch {
      setError(t('unreachable'));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (sentOnce.current) return;
    sentOnce.current = true;
    void send();
    codeRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (resendIn <= 0) return;
    const id = setTimeout(() => setResendIn((n) => n - 1), 1000);
    return () => clearTimeout(id);
  }, [resendIn]);

  const confirm = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!/^\d{6}$/.test(code.replace(/[\s-]/g, ''))) {
      setError(t('enterCode'));
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`${API_URL}/auth/verify-email/confirm`, {
        method: 'POST',
        credentials: 'include',
        headers: await headers(),
        body: JSON.stringify({ code }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.verified) {
        if (typeof data.access_token === 'string') setToken(data.access_token);
        markVerified();
        return;
      }
      if (data?.code === 'EMAIL_ALREADY_VERIFIED') { markVerified(); return; }
      setError(
        data?.code === 'VERIFY_EMAIL_CODE_EXPIRED' ? t('expired')
          : data?.code === 'VERIFY_EMAIL_CODE_LOCKED' ? t('locked')
          : t('wrongCode'),
      );
    } catch {
      setError(t('unreachable'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#fafbfc] px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="bg-white border border-slate-200 rounded-2xl p-7">
          <div className="flex justify-center mb-4">
            <div className="w-12 h-12 rounded-xl bg-indigo-50 flex items-center justify-center">
              <MailCheck className="w-6 h-6 text-indigo-600" aria-hidden />
            </div>
          </div>
          <h1 className="text-center text-lg font-semibold text-slate-900">{t('title')}</h1>
          <p className="mt-2 text-sm text-slate-600 text-center">
            {t('lead')} <strong className="font-semibold break-all">{user?.email ?? ''}</strong>
          </p>
          <form onSubmit={confirm} className="mt-5 space-y-3" noValidate>
            <label htmlFor="verify-email-code" className="block text-xs font-semibold text-slate-700">
              {t('codeLabel')}
            </label>
            <input
              id="verify-email-code"
              ref={codeRef}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={7}
              placeholder="123456"
              className={INPUT_CLS}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? 'verify-email-error' : note ? 'verify-email-note' : undefined}
            />
            {error && (
              <p id="verify-email-error" role="alert" className="text-xs text-rose-700 font-medium">{error}</p>
            )}
            {!error && note && (
              <p id="verify-email-note" role="status" className="text-xs text-slate-500">{note}</p>
            )}
            <button
              type="submit"
              disabled={busy}
              className="w-full inline-flex items-center justify-center gap-2 min-h-[44px] rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-60"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : null}
              {t('confirm')}
            </button>
            <button
              type="button"
              onClick={() => void send()}
              disabled={busy || resendIn > 0}
              className="w-full text-xs font-semibold text-indigo-600 hover:text-indigo-700 disabled:opacity-50"
            >
              {resendIn > 0 ? t('resendIn', { seconds: resendIn }) : t('resend')}
            </button>
          </form>
        </div>
        <div className="text-center mt-5">
          <button
            type="button"
            onClick={() => {
              logout();
              window.location.replace('/login');
            }}
            className="text-xs font-semibold text-slate-500 hover:text-slate-700"
          >
            {t('signOut')}
          </button>
        </div>
      </div>
    </div>
  );
}
