// TODO(a11y): Sprint 2 — replace autoFocus on email input with useEffect-based focus management.
/* eslint-disable jsx-a11y/no-autofocus */
"use client";

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { MonitorPlay, Loader2, AlertCircle, KeyRound } from 'lucide-react';
import { useUIStore } from '@/store/ui-store';
import { useRouter, useSearchParams } from 'next/navigation';
import { API_URL, warnIfMisconfigured, isLikelyMisconfigured } from '@/lib/api-url';
import { clog } from '@/lib/client-logger';

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center bg-slate-950"><Loader2 className="w-8 h-8 text-indigo-500 animate-spin" /></div>}>
      <LoginContent />
    </Suspense>
  );
}

function LoginContent() {
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
      setError('Enter your district or school slug to continue.');
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
        router.push(redirectTarget || `/${data.user.tenantSlug || data.user.tenantId}/dashboard`);
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
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4 relative overflow-hidden">
      {/* Soft pastel blobs — match the dashboard aesthetic */}
      <div className="absolute -top-20 -left-20 w-[500px] h-[500px] bg-indigo-100/50 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute -bottom-20 -right-20 w-[500px] h-[500px] bg-violet-100/40 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute top-1/3 right-1/4 w-72 h-72 bg-emerald-50/60 rounded-full blur-[100px] pointer-events-none" />

      <div className="w-full max-w-sm relative z-10">
        {/* Logo / brand */}
        <div className="text-center mb-7">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-gradient-to-br from-indigo-500 to-violet-500 rounded-2xl mb-4 shadow-lg shadow-indigo-500/25">
            <MonitorPlay className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-slate-900 to-slate-700">
            EduSignage
          </h1>
          <p className="text-sm font-medium text-slate-500 mt-1">K-12 digital signage, made simple.</p>
        </div>

        {/* Card */}
        <div className="bg-white/80 backdrop-blur-2xl border border-slate-200/70 rounded-2xl shadow-[0_20px_60px_-15px_rgba(15,23,42,0.15)] p-7">
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label htmlFor="login-email" className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">Email</label>
              <input
                id="login-email"
                type="email"
                required
                autoFocus
                autoComplete="email"
                placeholder="you@school.edu"
                className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm text-slate-900 placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 transition-all shadow-sm"
                value={email}
                onChange={e => setEmail(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="login-password" className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">Password</label>
              <input
                id="login-password"
                type="password"
                required
                autoComplete="current-password"
                placeholder="••••••••"
                className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm text-slate-900 placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 transition-all shadow-sm"
                value={password}
                onChange={e => setPassword(e.target.value)}
              />
            </div>

            <div className="flex items-center justify-between gap-2">
              <label className="flex items-center gap-2 cursor-pointer group select-none">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={e => setRememberMe(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-400 cursor-pointer"
                />
                <span className="text-xs font-medium text-slate-600 group-hover:text-slate-800 transition-colors">
                  Keep me signed in
                </span>
              </label>
              <Link
                href="/reset-password/request"
                className="text-xs font-semibold text-indigo-600 hover:text-indigo-700"
              >
                Forgot password?
              </Link>
            </div>

            {/* EULA acceptance — required. Gates the Sign-in button. */}
            <label className="flex items-start gap-2 cursor-pointer group select-none">
              <input
                type="checkbox"
                checked={eulaAccepted}
                onChange={e => setEulaAccepted(e.target.checked)}
                className="w-4 h-4 mt-0.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-400 cursor-pointer shrink-0"
                required
                aria-describedby="eula-text"
              />
              <span id="eula-text" className="text-[11px] leading-snug text-slate-600 group-hover:text-slate-800 transition-colors">
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
              <div className="flex items-start gap-2 px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-xl">
                <AlertCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-800 font-medium">
                  Your session expired. Please sign in again to continue.
                </p>
              </div>
            )}

            {error && (
              <div className="flex items-start gap-2 px-3 py-2.5 bg-rose-50 border border-rose-200 rounded-xl">
                <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                <p className="text-xs text-rose-700 font-medium">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !eulaAccepted}
              className="w-full bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-2.5 px-4 rounded-xl transition-all shadow-md shadow-indigo-500/20 flex items-center justify-center gap-2 text-sm"
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
                className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 transition-colors"
              >
                <KeyRound className="w-4 h-4" /> Sign in with SSO
              </button>
            ) : (
              <form onSubmit={handleSsoStart} className="space-y-3">
                <label htmlFor="sso-slug" className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                  District or school slug
                </label>
                <input
                  id="sso-slug"
                  type="text"
                  autoComplete="organization"
                  placeholder="acme-district"
                  value={ssoSlug}
                  onChange={(e) => setSsoSlug(e.target.value)}
                  className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm text-slate-900 placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 shadow-sm"
                />
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={ssoChecking}
                    className="flex-1 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-bold py-2.5 rounded-xl flex items-center justify-center gap-2"
                  >
                    {ssoChecking ? <><Loader2 className="w-4 h-4 animate-spin" /> Redirecting…</> : 'Continue with SSO'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setSsoOpen(false)}
                    className="px-4 py-2.5 text-slate-500 hover:text-slate-700 text-xs font-bold"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>

        <p className="text-center text-xs text-slate-500 mt-6 font-medium">
          New here? <Link href="/signup" className="text-indigo-600 hover:text-indigo-700 font-bold">Create a workspace</Link>
        </p>
        <p className="text-center text-[11px] text-slate-400 mt-2 font-medium">
          Secure multi-tenant CMS • RBAC enforced
        </p>

        <nav className="mt-7 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-[11px] text-slate-500 font-medium">
          <a href="/" className="hover:text-slate-700 transition">Home</a>
          <span className="text-slate-300">&middot;</span>
          <a href="/pricing" className="hover:text-slate-700 transition">Pricing</a>
          <span className="text-slate-300">&middot;</span>
          <a href="/help" className="hover:text-slate-700 transition">Help</a>
          <span className="text-slate-300">&middot;</span>
          <a href="/privacy" className="hover:text-slate-700 transition">Privacy</a>
          <span className="text-slate-300">&middot;</span>
          <a href="/terms" className="hover:text-slate-700 transition">Terms</a>
          <span className="text-slate-300">&middot;</span>
          <a href="/ferpa" className="hover:text-slate-700 transition">FERPA</a>
          <span className="text-slate-300">&middot;</span>
          <a href="/coppa" className="hover:text-slate-700 transition">COPPA</a>
        </nav>
      </div>
    </div>
  );
}
