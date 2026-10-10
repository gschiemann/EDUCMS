'use client';

/**
 * /claim-account/[token] — the single-use OWNER link a VenueOS owner sends a new customer
 * (customer console, 2026-10-10). One button: the API spends the link and signs the person in
 * ONCE; the dashboard then shows first-login setup (CredentialSetupGate) because the account is
 * held to it — they set their own email and password there, and two-step sign-in is required on
 * every sign-in after that. No password is ever typed on this page.
 */
import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { AlertCircle, Loader2, MonitorPlay } from 'lucide-react';
import { API_URL } from '@/lib/api-url';
import { useUIStore } from '@/store/ui-store';

type Preview = { organizationName: string; expiresAt: string };

export default function ClaimAccountPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const t = useTranslations('customerConsole.claim');
  const router = useRouter();
  const login = useUIStore((s) => s.login);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [problem, setProblem] = useState<'invalid' | 'used' | 'expired' | 'unreachable' | null>(null);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/customer-claims/${encodeURIComponent(token)}`);
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.ok) setPreview(data);
        else setProblem(data?.code === 'CLAIM_LINK_USED' ? 'used' : data?.code === 'CLAIM_LINK_EXPIRED' ? 'expired' : 'invalid');
      } catch {
        if (!cancelled) setProblem('unreachable');
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  const claim = async () => {
    setWorking(true);
    try {
      const res = await fetch(`${API_URL}/customer-claims/${encodeURIComponent(token)}/claim`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.access_token) {
        login(data.access_token, data.user);
        router.push(`/${data.user.tenantSlug || data.user.tenantId}/dashboard`);
        return;
      }
      setProblem('invalid');
    } catch {
      setProblem('unreachable');
    }
    setWorking(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-sm bg-white border border-slate-200 rounded-2xl p-8 text-center">
        <MonitorPlay className="w-10 h-10 text-indigo-600 mx-auto mb-3" aria-hidden />
        <h1 className="text-xl font-bold text-slate-900">{t('title')}</h1>
        {problem ? (
          <div role="alert" className="mt-4 text-sm text-rose-700 flex items-start gap-2 text-left">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden />
            <span>{t(problem)}</span>
          </div>
        ) : !preview ? (
          <Loader2 className="w-6 h-6 animate-spin text-slate-400 mx-auto mt-4" aria-hidden />
        ) : (
          <>
            <p className="text-sm text-slate-600 mt-2">{t('body', { org: preview.organizationName })}</p>
            <button
              type="button"
              onClick={claim}
              disabled={working}
              className="mt-5 w-full min-h-11 rounded-xl bg-indigo-600 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {working ? <><Loader2 className="w-4 h-4 animate-spin" aria-hidden /> {t('working')}</> : t('continue')}
            </button>
          </>
        )}
        {(problem === 'used' || problem === 'invalid') && (
          <a href="/login" className="mt-4 inline-flex min-h-10 items-center text-sm font-semibold text-indigo-700">{t('signIn')}</a>
        )}
      </div>
    </div>
  );
}
