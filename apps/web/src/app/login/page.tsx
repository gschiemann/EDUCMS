// TODO(a11y): Sprint 2 — replace autoFocus on email input with useEffect-based focus management.
/* eslint-disable jsx-a11y/no-autofocus */
"use client";

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { MonitorPlay, Loader2, AlertCircle } from 'lucide-react';
import { useUIStore } from '@/store/ui-store';
import { useRouter, useSearchParams } from 'next/navigation';
import { API_URL, warnIfMisconfigured, isLikelyMisconfigured } from '@/lib/api-url';

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
  const [rememberMe, setRememberMe] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    warnIfMisconfigured();
    try {
      const res = await fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, rememberMe })
      });
      const data = await res.json();
      if (res.ok && data.access_token) {
        login(data.access_token, data.user);
        router.push(redirectTarget || `/${data.user.tenantSlug || data.user.tenantId}/dashboard`);
      } else {
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
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 p-4 relative overflow-hidden">
      {/* Decorative elements */}
      <div className="absolute top-1/4 -left-32 w-96 h-96 bg-indigo-500/10 rounded-full blur-[120px]" />
      <div className="absolute bottom-1/4 -right-32 w-96 h-96 bg-violet-500/10 rounded-full blur-[120px]" />

      <div className="w-full max-w-sm relative z-10">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-indigo-500/10 border border-indigo-500/20 rounded-2xl mb-4">
            <MonitorPlay className="w-8 h-8 text-indigo-400" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white">EduSignage</h1>
          <p className="text-sm text-slate-400 mt-1">Digital Signage Management</p>
        </div>

        {/* Card */}
        <div className="bg-slate-900/80 backdrop-blur-xl border border-slate-800 rounded-2xl shadow-2xl p-8">
          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label htmlFor="login-email" className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Email</label>
              <input
                id="login-email"
                type="email"
                required
                autoFocus
                autoComplete="email"
                placeholder="you@school.edu"
                className="w-full px-4 py-3 bg-slate-800/50 border border-slate-700 rounded-xl text-sm text-white placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all"
                value={email}
                onChange={e => setEmail(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="login-password" className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Password</label>
              <input
                id="login-password"
                type="password"
                required
                autoComplete="current-password"
                placeholder="••••••••"
                className="w-full px-4 py-3 bg-slate-800/50 border border-slate-700 rounded-xl text-sm text-white placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all"
                value={password}
                onChange={e => setPassword(e.target.value)}
              />
            </div>

            <div className="flex items-center justify-between gap-2">
              <label className="flex items-center gap-2 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={e => setRememberMe(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-700 bg-slate-800/50 text-indigo-500 focus:ring-indigo-500 focus:ring-offset-slate-900 transition-all cursor-pointer"
                />
                <span className="text-xs font-semibold text-slate-400 group-hover:text-slate-300 transition-colors">
                  Keep me signed in
                </span>
              </label>
              <Link
                href="/reset-password/request"
                className="text-xs font-semibold text-indigo-400 hover:text-indigo-300"
              >
                Forgot password?
              </Link>
            </div>

            {error && (
              <div className="flex items-start gap-2 px-3 py-2.5 bg-red-500/10 border border-red-500/20 rounded-xl">
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <p className="text-xs text-red-300 font-medium">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold py-3 px-4 rounded-xl transition-all shadow-lg shadow-indigo-600/20 flex items-center justify-center gap-2"
            >
              {loading ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Signing in...</>
              ) : (
                'Sign In'
              )}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-slate-500 mt-6">
          New here? <Link href="/signup" className="text-indigo-400 hover:text-indigo-300 font-semibold">Create a workspace</Link>
        </p>
        <p className="text-center text-xs text-slate-600 mt-2">
          Secure multi-tenant CMS • RBAC enforced
        </p>
      </div>
    </div>
  );
}
