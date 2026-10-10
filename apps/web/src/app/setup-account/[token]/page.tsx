"use client";

/**
 * /setup-account/[token] — ONE-TIME ACCOUNT SETUP LINK (2026-10-10).
 *
 * An administrator sends this link instead of a starter password. The page
 * first PREVIEWS the link (which account it is for — changes nothing), and the
 * person presses Continue to spend it: a mail scanner that opens the link can
 * never use it up. Redeeming signs them in to first-login setup — the
 * dashboard shell then shows CredentialSetupGate (own email + code + password),
 * and after that the required two-step setup on the sign-in page.
 *
 * The token travels in the request BODY, never a query string, and is never
 * stored by this page.
 */
import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { AlertCircle, KeyRound, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { API_URL } from '@/lib/api-url';
import { useUIStore } from '@/store/ui-store';
import { isTwoStepEnvelope, stashSetupTwoStep } from '@/lib/setup-two-step-handoff';

type Preview = { email: string; firstName: string | null; organization: string | null; expiresAt: string };

const ERROR_KEYS: Record<string, string> = {
  SETUP_LINK_INVALID: 'invalid',
  SETUP_LINK_EXPIRED: 'expired',
  SETUP_LINK_USED: 'used',
  SETUP_LINK_REPLACED: 'replaced',
};

export default function SetupAccountPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const t = useTranslations('accountSetupLink');
  const router = useRouter();
  const login = useUIStore((s) => s.login);

  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);

  const explain = (status: number, code: unknown): string => {
    if (typeof code === 'string' && ERROR_KEYS[code]) return t(ERROR_KEYS[code]);
    if (status === 429) return t('tooMany');
    return t('failed');
  };

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/auth/setup-link/preview`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });
        const data = await res.json().catch(() => ({}));
        if (!live) return;
        if (res.ok && typeof data?.email === 'string') setPreview(data as Preview);
        else setError(explain(res.status, data?.code));
      } catch {
        if (live) setError(t('unreachable', { url: API_URL }));
      }
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const redeem = async () => {
    setError('');
    setWorking(true);
    try {
      const res = await fetch(`${API_URL}/auth/setup-link/redeem`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.access_token && data?.user) {
        // A setup-gated session: the dashboard shell renders CredentialSetupGate.
        login(data.access_token, data.user, false);
        router.replace(`/${data.user.tenantSlug || data.user.tenantId}/dashboard`);
        return;
      }
      if (res.ok && isTwoStepEnvelope(data)) {
        // Only if the account already holds a factor: the sign-in page owns that step.
        stashSetupTwoStep(preview?.email ?? '', data);
        router.replace('/login?reason=setup-two-step');
        return;
      }
      setError(explain(res.status, data?.code));
    } catch {
      setError(t('unreachable', { url: API_URL }));
    }
    setWorking(false);
  };

  const expiresOn = preview ? new Date(preview.expiresAt).toLocaleDateString() : '';

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#fafbfc] px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="text-center mb-7">
          <svg width="40" height="40" viewBox="0 0 32 32" aria-hidden className="mx-auto">
            <polygon points="30,16 23,28.12 9,28.12 2,16 9,3.88 23,3.88" fill="#4f46e5" />
            <polygon points="22,16 19,21.2 13,21.2 10,16 13,10.8 19,10.8" fill="#a5b4fc" />
          </svg>
          <h1 className="mt-4 text-xl font-semibold tracking-tight text-slate-900">{t('title')}</h1>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-7">
          <div className="flex justify-center mb-4">
            <div className="w-12 h-12 rounded-xl bg-indigo-50 flex items-center justify-center">
              <KeyRound className="w-6 h-6 text-indigo-600" aria-hidden />
            </div>
          </div>

          {error ? (
            <div className="space-y-4">
              <div role="alert" className="flex items-start gap-2 px-3 py-2.5 bg-rose-50 border border-rose-200 rounded-lg">
                <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" aria-hidden />
                <p className="text-xs text-rose-700 font-medium">{error}</p>
              </div>
              <Link href="/login" className="block text-center text-sm font-semibold text-indigo-600 hover:text-indigo-700">
                {t('goToSignIn')}
              </Link>
            </div>
          ) : !preview ? (
            <div className="flex justify-center py-6" aria-busy="true">
              <Loader2 className="w-6 h-6 text-indigo-500 animate-spin" aria-hidden />
            </div>
          ) : (
            <div className="space-y-4">
              {preview.organization && (
                <p className="text-sm text-slate-700">{t('forOrg', { organization: preview.organization })}</p>
              )}
              <div className="rounded-lg bg-slate-50 border border-slate-200 px-3.5 py-2.5">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{t('accountLabel')}</p>
                <p className="text-sm font-mono text-slate-800 break-all">{preview.email}</p>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">{t('explain')}</p>
              <button
                type="button"
                onClick={redeem}
                disabled={working}
                // eslint-disable-next-line jsx-a11y/no-autofocus
                autoFocus
                className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-semibold py-2.5 px-4 rounded-lg flex items-center justify-center gap-2"
              >
                {working ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> {t('working')}
                  </>
                ) : (
                  t('continue')
                )}
              </button>
              <p className="text-[11px] text-slate-500 text-center">{t('expires', { date: expiresOn })}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
