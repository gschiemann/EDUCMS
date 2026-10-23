'use client';

/**
 * /connect/[provider]/done — the OAuth landing page for every provider that
 * hands the browser back to us: the POS providers (Clover, Lightspeed,
 * Shopify — Square keeps its own static /connect/square/done) AND the social
 * apps (Instagram, Facebook Page — `social-oauth.controller.ts` redirects
 * here too).
 *
 * The URL carries no workspace; the signed-in session in this tab does
 * (`useUIStore().activeTenant`). QA 2026-10-23: this page used to ask
 * GET /me — a route that does not exist — with a localStorage token nothing
 * writes any more, so every successful connection stranded the operator on
 * "HTTP 404". It also told an Instagram operator their "POS" catalog was
 * syncing and sent them to POS settings, away from the board they were
 * building. A social connection now returns to the page that started it
 * (`connect-return.ts`), a POS connection to POS settings as before.
 */
import { Suspense, useEffect, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useSearchParams, useRouter, useParams } from 'next/navigation';
import { CheckCircle2, AlertCircle, ArrowRight, Loader2 } from 'lucide-react';
import { useUIStore } from '@/store/ui-store';
import { readConnectReturn, clearConnectReturn } from '@/lib/connect-return';

/** Provider id → the name the operator knows it by. */
const PROVIDER_LABELS: Record<string, string> = {
  square: 'Square',
  clover: 'Clover',
  'lightspeed-retail': 'Lightspeed',
  'shopify-pos': 'Shopify',
  instagram: 'Instagram',
  facebook: 'Facebook',
};
const SOCIAL = new Set(['instagram', 'facebook']);

export default function ConnectDonePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
      </div>
    }>
      <ConnectDoneInner />
    </Suspense>
  );
}

function ConnectDoneInner() {
  const t = useTranslations('connectDone');
  const tAuth = useTranslations('auth');
  const params = useSearchParams();
  const routeParams = useParams();
  const router = useRouter();
  const providerId = String((routeParams?.provider as string) || '').toLowerCase();
  const social = SOCIAL.has(providerId);
  const providerName = PROVIDER_LABELS[providerId] || t('unknownProvider');
  const status = params?.get('status') || 'ok';
  const reason = params?.get('reason') || '';
  const ok = status === 'ok';
  const tenantSlug = useUIStore((s) => s.activeTenant);

  // Reading the stored return path is pure; it is cleared when we leave.
  const target = useMemo(() => {
    if (!tenantSlug) return null;
    if (social) return readConnectReturn(tenantSlug) || `/${tenantSlug}/templates`;
    return `/${tenantSlug}/settings/pos?connected=${ok ? providerId : 'failed'}`;
  }, [tenantSlug, social, ok, providerId]);

  useEffect(() => {
    if (!target || !ok) return;
    // Auto-bounce after a beat so the operator sees confirmation.
    const timer = setTimeout(() => { clearConnectReturn(); router.replace(target); }, 1500);
    return () => clearTimeout(timer);
  }, [ok, router, target]);

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-sm border border-slate-200 p-8 text-center space-y-4">
        {ok ? (
          <>
            <div className="mx-auto w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center">
              <CheckCircle2 className="w-8 h-8 text-emerald-600" />
            </div>
            <h1 className="text-xl font-extrabold text-slate-800">{t('connected', { provider: providerName })}</h1>
            <p className="text-sm text-slate-600">{social ? t('socialSyncing') : t('posSyncing')}</p>
          </>
        ) : (
          <>
            <div className="mx-auto w-14 h-14 rounded-full bg-rose-100 flex items-center justify-center">
              <AlertCircle className="w-8 h-8 text-rose-600" />
            </div>
            <h1 className="text-xl font-extrabold text-slate-800">{t('failed', { provider: providerName })}</h1>
            <p className="text-sm text-slate-600">{t('reason')} <code className="text-xs">{reason || 'unknown'}</code></p>
            <p className="text-xs text-slate-500">{social ? t('socialRetry') : t('posRetry')}</p>
          </>
        )}
        {target ? (
          <Link
            href={target}
            className="inline-flex items-center gap-1.5 mt-2 px-4 py-2 rounded-lg bg-slate-900 text-white text-xs font-bold"
          >
            {social ? t('backToVenueOS') : t('backToPos')} <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        ) : (
          // Signed out in this tab (or another browser finished the OAuth
          // hop): the connection is saved server-side either way.
          <Link
            href="/login"
            className="inline-flex items-center gap-1.5 mt-2 px-4 py-2 rounded-lg bg-slate-900 text-white text-xs font-bold"
          >
            {tAuth('signIn')} <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        )}
      </div>
    </div>
  );
}
