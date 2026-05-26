'use client';

/**
 * /connect/square/done — Square OAuth landing page.
 *
 * The API's /api/v1/pos/oauth/square/callback redirects here with a
 * ?status=ok|error query param after the OAuth handshake completes
 * (success or failure). We don't have the tenant's schoolId in the
 * URL — the operator's session has it — so we read /me, find the
 * tenant slug, and redirect them back to /settings/pos with a flag
 * the page can surface in a toast.
 *
 * Why a dedicated route vs. parsing on /settings/pos directly: the
 * redirect target has to be a stable public URL we can register with
 * Square's OAuth app. Embedding it inside [schoolId] coupling would
 * require Square to know the schoolId — which it doesn't, and won't.
 */
import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { CheckCircle2, AlertCircle, ArrowRight, Loader2 } from 'lucide-react';
import { API_URL } from '@/lib/api-url';

interface MeResponse { tenant?: { id?: string; slug?: string } | null }

// 2026-05-26 — Next 16 requires `useSearchParams()` to be inside a
// Suspense boundary; otherwise `next build` fails on static
// prerender ("missing-suspense-with-csr-bailout"). The default export
// now just provides the boundary; the original component lives below
// it and runs on the client only.
export default function SquareConnectDonePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
      </div>
    }>
      <SquareConnectDoneInner />
    </Suspense>
  );
}

function SquareConnectDoneInner() {
  const params = useSearchParams();
  const status = params?.get('status') || 'ok';
  const reason = params?.get('reason') || '';
  const ok = status === 'ok';
  const router = useRouter();
  const [tenantSlug, setTenantSlug] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
        const res = await fetch(`${API_URL}/me`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          credentials: 'include',
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: MeResponse = await res.json();
        if (cancelled) return;
        const slug = data.tenant?.slug || data.tenant?.id || null;
        setTenantSlug(slug);
        if (slug && ok) {
          // Auto-bounce after a beat so the operator sees confirmation.
          setTimeout(() => router.replace(`/${slug}/settings/pos?connected=square`), 1500);
        }
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [ok, router]);

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-sm border border-slate-200 p-8 text-center space-y-4">
        {ok ? (
          <>
            <div className="mx-auto w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center">
              <CheckCircle2 className="w-8 h-8 text-emerald-600" />
            </div>
            <h1 className="text-xl font-extrabold text-slate-800">Square connected</h1>
            <p className="text-sm text-slate-600">Your catalog is syncing now. Menu boards will pick up the live items once the first poll finishes (usually under a minute).</p>
          </>
        ) : (
          <>
            <div className="mx-auto w-14 h-14 rounded-full bg-rose-100 flex items-center justify-center">
              <AlertCircle className="w-8 h-8 text-rose-600" />
            </div>
            <h1 className="text-xl font-extrabold text-slate-800">Could not connect Square</h1>
            <p className="text-sm text-slate-600">Reason: <code className="text-xs">{reason || 'unknown'}</code>.</p>
            <p className="text-xs text-slate-500">Try again from Settings → POS catalog sync.</p>
          </>
        )}
        {tenantSlug ? (
          <Link
            href={`/${tenantSlug}/settings/pos?connected=${ok ? 'square' : 'failed'}`}
            className="inline-flex items-center gap-1.5 mt-2 px-4 py-2 rounded-lg bg-slate-900 text-white text-xs font-bold"
          >
            Back to POS settings <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        ) : err ? (
          <p className="text-xs text-rose-600">{err}</p>
        ) : (
          <Loader2 className="w-4 h-4 animate-spin mx-auto text-slate-400" />
        )}
      </div>
    </div>
  );
}
