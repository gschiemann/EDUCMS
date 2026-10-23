"use client";

/**
 * /accept-invite/[token] — the page an invited teammate opens from their
 * invitation. QA 2026-10-23: it was the pre-rebrand dark card with the old
 * monitor icon, English-only, and showed the raw role code ("CONTRIBUTOR")
 * where the People page calls the same person an "Editor". It now uses the
 * /login card (AuthCardShell), the en/es/zh catalogue and the localized role
 * label every other surface uses. Behaviour unchanged.
 */
import { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Loader2, AlertCircle } from 'lucide-react';
import { API_URL } from '@/lib/api-url';
import { useUIStore } from '@/store/ui-store';
import { useLocaleSwitch } from '@/i18n/I18nProvider';
import { localizedRoleLabel } from '@/i18n/vertical-copy';
import { ResetShell as AuthCardShell, RESET_INPUT_CLS, RESET_BUTTON_CLS } from '@/components/auth/AuthCardShell';

interface InvitePreview {
  email: string;
  role: string;
  tenantName: string;
  expiresAt: string;
}

export default function AcceptInvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = use(params);
  const t = useTranslations('acceptInvite');
  const { locale } = useLocaleSwitch();
  const router = useRouter();
  const login = useUIStore((s) => s.login);

  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/invites/${encodeURIComponent(token)}`);
        const data = await res.json();
        if (cancelled) return;
        if (res.ok) setPreview(data);
        else setPreviewError(data.message || t('invalid'));
      } catch {
        if (!cancelled) setPreviewError(t('unreachable'));
      }
    })();
    return () => { cancelled = true; };
  }, [token, t]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password.length < 8) { setError(t('tooShort')); return; }
    if (password !== confirm) { setError(t('mismatch')); return; }

    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/invites/${encodeURIComponent(token)}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (res.ok && data.access_token) {
        login(data.access_token, data.user);
        router.push(`/${data.user.tenantSlug || data.user.tenantId}/dashboard`);
      } else if (res.ok && data.mfaRequired) {
        // 2026-09-11 — the invite SUCCEEDED and the password is set; this
        // organization requires two-factor, so there is no session yet. Send
        // them to /login, which already owns the forced-enrollment flow. Before
        // this branch existed the page fell into the `else` below and told the
        // user "Could not accept the invitation" about an invite that had in
        // fact been accepted — a dead end on an account that was already live.
        router.push('/login?reason=invite-mfa');
      } else {
        setError(data.message || t('acceptFailed'));
      }
    } catch {
      setError(t('unreachable'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthCardShell title={t('title')}>
      {previewError ? (
        <div role="alert" className="flex items-start gap-2 px-3 py-2.5 bg-red-50 border border-red-200 rounded-lg">
          <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" aria-hidden />
          <p className="text-xs text-red-700 font-medium">{previewError}</p>
        </div>
      ) : !preview ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="w-6 h-6 text-indigo-500 animate-spin" aria-label={t('loading')} />
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <dl className="rounded-lg bg-slate-50 border border-slate-200 p-3.5 text-xs text-slate-700 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <dt className="text-slate-500">{t('workspace')}</dt>
            <dd className="font-semibold text-slate-900 break-words">{preview.tenantName}</dd>
            <dt className="text-slate-500">{t('email')}</dt>
            <dd className="break-all">{preview.email}</dd>
            <dt className="text-slate-500">{t('role')}</dt>
            <dd>{localizedRoleLabel(locale, preview.role)}</dd>
          </dl>
          <div>
            <label htmlFor="invite-password" className="block text-xs font-semibold text-slate-700 mb-1.5">{t('password')}</label>
            <input
              id="invite-password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={RESET_INPUT_CLS}
            />
            <p className="mt-1 text-[11px] text-slate-500">{t('passwordHint')}</p>
          </div>
          <div>
            <label htmlFor="invite-confirm-password" className="block text-xs font-semibold text-slate-700 mb-1.5">{t('confirmPassword')}</label>
            <input
              id="invite-confirm-password"
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
            {loading ? <><Loader2 className="w-4 h-4 animate-spin" aria-hidden /> {t('joining')}</> : t('join')}
          </button>
        </form>
      )}
    </AuthCardShell>
  );
}
