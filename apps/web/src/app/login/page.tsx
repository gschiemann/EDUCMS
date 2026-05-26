// TODO(a11y): Sprint 2 — replace autoFocus on email input with useEffect-based focus management.
/* eslint-disable jsx-a11y/no-autofocus */
"use client";

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, AlertCircle, KeyRound } from 'lucide-react';
import { useUIStore } from '@/store/ui-store';
import { useRouter, useSearchParams } from 'next/navigation';
import { API_URL, warnIfMisconfigured, isLikelyMisconfigured } from '@/lib/api-url';
import { clog } from '@/lib/client-logger';
import { getClientBrand } from '@/lib/brand';

const INPUT_CLS =
  'w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 ' +
  'placeholder:text-slate-400 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition';

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center bg-[#fafbfc]"><Loader2 className="w-8 h-8 text-indigo-500 animate-spin" /></div>}>
      <LoginContent />
    </Suspense>
  );
}

function LoginContent() {
  // 2026-05-05 — operator: "the login screen still says k-12 when
  // entering your credentials" + "lets change the default to Venue
  // OS right?". Pulls brand identity from getClientBrand() so the
  // h1 + tagline match whatever brand the deploy is configured for
  // (default VenueOS; EDU CMS only when NEXT_PUBLIC_CMS_BRAND=educms
  // is explicitly set).
  const brand = getClientBrand();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const login = useUIStore((state) => state.login);
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTarget = searchParams.get('redirect');
  const authReason = searchParams.get('reason'); // 'session-expired' | 'explicit-logout'
  const [rememberMe, setRememberMe] = useState(false);
  // EULA v1.0 acceptance. Persisted per-browser in localStorage so a
  // returning user isn't asked again on every login; the version is
  // part of the key so bumping the EULA forces re-acceptance.
  const EULA_VERSION = '1.0';
  const EULA_KEY = `edu_cms_eula_accepted_v${EULA_VERSION}`;
  const [eulaAccepted, setEulaAccepted] = useState(false);
  // Rehydrate on mount so users who've accepted previously don't see
  // the checkbox block the button. We still SHOW the checkbox (pre-
  // checked) so it's never silently auto-accepted on a shared device.
  useEffect(() => {
    try {
      if (typeof window !== 'undefined' && window.localStorage.getItem(EULA_KEY) === 'yes') {
        setEulaAccepted(true);
      }
    } catch { /* localStorage unavailable */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [ssoOpen, setSsoOpen] = useState(false);
  const [ssoSlug, setSsoSlug] = useState('');
  const [ssoChecking, setSsoChecking] = useState(false);

  const handleSsoStart = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!ssoSlug.trim()) {
      setError('Enter your organization slug to continue.');
      return;
    }
    setSsoChecking(true);
    try {
      // Ask the API which provider is configured for this tenant.
      const res = await fetch(`${API_URL}/auth/sso/${encodeURIComponent(ssoSlug.trim())}/config-public`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.enabled) {
        setError(`SSO is not enabled for "${ssoSlug}". Ask your admin to configure it or sign in with your password.`);
        setSsoChecking(false);
        return;
      }
      const provider = (data.provider as string).toLowerCase();
      // Navigate to the API SSO entry point; it will 302 to the IdP.
      window.location.href = `${API_URL}/auth/sso/${encodeURIComponent(ssoSlug.trim())}/${provider}/login`;
    } catch {
      setError("Can't reach the server to start SSO. Try again in a moment.");
      setSsoChecking(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!eulaAccepted) {
      setError('You must accept the End User License Agreement to continue.');
      return;
    }
    setError('');
    setLoading(true);
    warnIfMisconfigured();
    clog.info('auth', 'Login attempt', { email, rememberMe, redirectTarget });
    try {
      const res = await fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, rememberMe })
      });
      const data = await res.json();
      if (res.ok && data.access_token) {
        // Persist EULA acceptance AFTER a successful login so we know
        // which user/account the acceptance is tied to. Logged to the
        // client log so we have an audit crumb if counsel ever asks.
        try {
          if (typeof window !== 'undefined') {
            window.localStorage.setItem(EULA_KEY, 'yes');
            window.localStorage.setItem(`${EULA_KEY}_at`, new Date().toISOString());
            window.localStorage.setItem(`${EULA_KEY}_by`, email);
          }
        } catch { /* best-effort */ }
        clog.info('auth', 'EULA accepted', { version: EULA_VERSION, userId: data.user?.id });
        login(data.access_token, data.user);
        // 2026-05-03 — cross-tenant bleed fix. Operator (2026-05-03):
        // "logged back out and in as the education user and kept the
        // gym URL but the updated info for the school". The previous
        // unconditional `redirectTarget || ...` would honor the
        // redirect query param even when the target tenant slug
        // doesn't match the just-authenticated user's tenant. Result:
        // user lands on /<other-tenant>/dashboard with their actual
        // tenant's data, which is a confusing cross-tenant URL/data
        // mismatch and a borderline security smell.
        //
        // Fix: only honor `redirectTarget` if it points within the
        // authenticated user's own tenant slug (or one of their
        // accessible child tenants). Otherwise hard-redirect to the
        // user's home dashboard. The accessible-child-tenant case
        // (DISTRICT_ADMIN with multi-school access) is approximated
        // here by allowing any path that starts with their tenantSlug
        // OR tenantId; a stricter cross-check happens server-side
        // when the target tenant's API responds 403/404.
        const userSlug = data.user.tenantSlug || data.user.tenantId;
        const homeUrl = `/${userSlug}/dashboard`;
        const safeRedirect =
          redirectTarget &&
          (redirectTarget === '/' ||
            redirectTarget.startsWith(`/${userSlug}/`) ||
            redirectTarget.startsWith(`/${userSlug}?`))
            ? redirectTarget
            : homeUrl;
        router.push(safeRedirect);
      } else {
        clog.warn('auth', 'Login rejected', { status: res.status, message: data?.message });
        setError(data.message || 'Invalid email or password. Please try again.');
      }
    } catch {
      if (isLikelyMisconfigured()) {
        setError(
          "Can't reach the server. This deployment is missing NEXT_PUBLIC_API_URL — " +
            'ask your administrator to set it in Vercel (it should point to the Railway API + /api/v1).'
        );
      } else {
        setError(`Can't reach the server at ${API_URL}. If this keeps happening, contact your administrator.`);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#fafbfc] px-4 py-10">
      <div className="w-full max-w-sm">
        {/* brand */}
        <div className="text-center mb-7">
          <svg width="40" height="40" viewBox="0 0 32 32" aria-hidden className="mx-auto">
            <polygon points="30,16 23,28.12 9,28.12 2,16 9,3.88 23,3.88" fill="#4f46e5" />
            <polygon points="22,16 19,21.2 13,21.2 10,16 13,10.8 19,10.8" fill="#a5b4fc" />
          </svg>
          <h1 className="mt-4 text-xl font-semibold tracking-tight text-slate-900">
            Sign in to {brand.name}
          </h1>
          <p className="mt-1 text-sm text-slate-500">{brand.tagline}</p>
        </div>

        {/* card */}
        <div className="bg-white border border-slate-200 rounded-2xl p-7">
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label htmlFor="login-email" className="block text-xs font-semibold text-slate-700 mb-1.5">Email</label>
              <input
                id="login-email"
                type="email"
                required
                autoFocus
                autoComplete="email"
                placeholder="you@company.com"
                className={INPUT_CLS}
                value={email}
                onChange={e => setEmail(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="login-password" className="block text-xs font-semibold text-slate-700 mb-1.5">Password</label>
              <input
                id="login-password"
                type="password"
                required
                autoComplete="current-password"
                placeholder="••••••••"
                className={INPUT_CLS}
                value={password}
                onChange={e => setPassword(e.target.value)}
              />
            </div>

            <div className="flex items-center justify-between gap-2">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={e => setRememberMe(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                />
                <span className="text-xs font-medium text-slate-600">Keep me signed in</span>
              </label>
              <Link
                href="/reset-password/request"
                className="text-xs font-semibold text-indigo-600 hover:text-indigo-700"
              >
                Forgot password?
              </Link>
            </div>

            {/* EULA acceptance — required. Gates the Sign-in button. */}
            <label className="flex items-start gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={eulaAccepted}
                onChange={e => setEulaAccepted(e.target.checked)}
                className="w-4 h-4 mt-0.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer shrink-0"
                required
                aria-describedby="eula-text"
              />
              <span id="eula-text" className="text-[11px] leading-snug text-slate-600">
                I have read and agree to the{' '}
                <Link
                  href="/terms/eula"
                  target="_blank"
                  className="text-indigo-600 hover:text-indigo-700 underline underline-offset-2 font-semibold"
                >
                  End User License Agreement
                </Link>
                , including the emergency-features disclaimer and limitation of liability.
              </span>
            </label>

            {!error && authReason === 'session-expired' && (
              <div className="flex items-start gap-2 px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-lg">
                <AlertCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-800 font-medium">
                  Your session expired. Please sign in again to continue.
                </p>
              </div>
            )}

            {error && (
              <div className="flex items-start gap-2 px-3 py-2.5 bg-rose-50 border border-rose-200 rounded-lg">
                <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                <p className="text-xs text-rose-700 font-medium">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !eulaAccepted}
              className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold py-2.5 px-4 rounded-lg transition-colors flex items-center justify-center gap-2"
              title={!eulaAccepted ? 'You must accept the EULA to sign in' : undefined}
            >
              {loading ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Signing in…</>
              ) : (
                'Sign in'
              )}
            </button>
          </form>

          {/* SSO block */}
          <div className="mt-5 pt-5 border-t border-slate-100">
            {!ssoOpen ? (
              <button
                type="button"
                onClick={() => { setSsoOpen(true); setError(''); }}
                className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 transition-colors"
              >
                <KeyRound className="w-4 h-4" /> Sign in with SSO
              </button>
            ) : (
              <form onSubmit={handleSsoStart} className="space-y-3">
                <label htmlFor="sso-slug" className="block text-xs font-semibold text-slate-700">
                  Organization slug
                </label>
                <input
                  id="sso-slug"
                  type="text"
                  autoComplete="organization"
                  placeholder="acme-co"
                  value={ssoSlug}
                  onChange={(e) => setSsoSlug(e.target.value)}
                  className={INPUT_CLS}
                />
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={ssoChecking}
                    className="flex-1 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-semibold py-2.5 rounded-lg flex items-center justify-center gap-2"
                  >
                    {ssoChecking ? <><Loader2 className="w-4 h-4 animate-spin" /> Redirecting…</> : 'Continue with SSO'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setSsoOpen(false)}
                    className="px-4 py-2.5 text-slate-500 hover:text-slate-700 text-xs font-semibold"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>

        <p className="text-center text-xs text-slate-500 mt-6">
          New here? <Link href="/signup" className="text-indigo-600 hover:text-indigo-700 font-semibold">Create a workspace</Link>
        </p>

        {/* a11y (2026-05-26): bumped text-slate-400 (2.53:1 fail on #fafbfc bg)
            up to text-slate-600 (~7.86:1, comfortably above WCAG AA 4.5:1).
            Hover state bumped slate-600 → slate-800 to preserve the
            darken-on-hover affordance. Same source renders on every
            unauthenticated redirect, so this fixes all 9 axe routes at once. */}
        <nav className="mt-6 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-[11px] text-slate-600">
          <Link href="/" className="hover:text-slate-800 transition">Home</Link>
          <Link href="/pricing" className="hover:text-slate-800 transition">Pricing</Link>
          <Link href="/help" className="hover:text-slate-800 transition">Help</Link>
          <Link href="/privacy" className="hover:text-slate-800 transition">Privacy</Link>
          <Link href="/terms" className="hover:text-slate-800 transition">Terms</Link>
        </nav>
      </div>
    </div>
  );
}
