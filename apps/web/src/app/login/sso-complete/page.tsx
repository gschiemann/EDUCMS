"use client";

import { Suspense, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, AlertCircle } from 'lucide-react';
import { useUIStore } from '@/store/ui-store';
import { API_URL } from '@/lib/api-url';

/**
 * SSO Completion landing page.
 *
 * The API callback redirects here with a JWT in the URL fragment, e.g.
 *   /login/sso-complete#token=eyJ...&tenant=acme-district
 *
 * We pull it out of the hash (which never hits the server), exchange it for
 * a user object via /auth/me, persist to the auth store, and route to the
 * dashboard. The hash is cleared before we leave this page.
 */

function SsoCompleteInner() {
  const router = useRouter();
  const login = useUIStore((s) => s.login);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const run = async () => {
      try {
        const hash = window.location.hash.replace(/^#/, '');
        const params = new URLSearchParams(hash);
        const token = params.get('token');
        const tenant = params.get('tenant');
        if (!token) {
          setError('SSO completed but no token was returned. Try again or contact your admin.');
          return;
        }

        // Best-effort user lookup. If /auth/me isn't available we still have
        // enough from the JWT to route — decode the payload client-side.
        let user: { id: string; email: string; role: string; tenantId: string; tenantSlug?: string } | null = null;
        try {
          const res = await fetch(`${API_URL}/auth/me`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (res.ok) user = await res.json();
        } catch {
          /* fall through */
        }
        if (!user) {
          const payload = JSON.parse(atob(token.split('.')[1] || ''));
          user = {
            id: payload.sub,
            email: payload.email,
            role: payload.role,
            tenantId: payload.tenantId,
            tenantSlug: tenant || payload.tenantId,
          };
        }

        login(token, user);
        // Clear the hash so tokens don't stick around in history.
        window.history.replaceState(null, '', '/login/sso-complete');
        router.replace(`/${user.tenantSlug || user.tenantId}/dashboard`);
      } catch (e) {
        setError((e as Error).message || 'SSO completion failed');
      }
    };
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 text-white p-4">
      <div className="max-w-sm text-center">
        {error ? (
          <div className="flex flex-col items-center gap-3">
            <AlertCircle className="w-8 h-8 text-red-400" />
            <h1 className="text-lg font-bold">SSO sign-in failed</h1>
            <p className="text-sm text-slate-400">{error}</p>
            <button
              onClick={() => router.replace('/login')}
              className="mt-3 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-sm font-semibold"
            >
              Back to sign in
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="w-8 h-8 text-indigo-400 animate-spin" />
            <p className="text-sm text-slate-400">Signing you in via SSO...</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default function SsoCompletePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-950" />}>
      <SsoCompleteInner />
    </Suspense>
  );
}
