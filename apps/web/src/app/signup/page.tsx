"use client";

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { MonitorPlay, Loader2, AlertCircle } from 'lucide-react';
import { API_URL } from '@/lib/api-url';
import { useUIStore } from '@/store/ui-store';

function slugify(v: string) {
  return v.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

export default function SignupPage() {
  const [districtName, setDistrictName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [adminEmail, setAdminEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const login = useUIStore((s) => s.login);
  const router = useRouter();

  const handleDistrictChange = (v: string) => {
    setDistrictName(v);
    if (!slugTouched) setSlug(slugify(v));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ districtName, slug, adminEmail, password }),
      });
      const data = await res.json();
      if (res.ok && data.access_token) {
        login(data.access_token, data.user);
        router.push(`/${data.user.tenantSlug || data.user.tenantId}/dashboard`);
      } else {
        setError(data.message || 'Signup failed. Please try again.');
      }
    } catch {
      setError(`Can't reach the server at ${API_URL}.`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-indigo-500/10 border border-indigo-500/20 rounded-2xl mb-4">
            <MonitorPlay className="w-8 h-8 text-indigo-400" />
          </div>
          <h1 className="text-2xl font-bold text-white">Start your EduSignage workspace</h1>
          <p className="text-sm text-slate-400 mt-1">Free to set up — no credit card required.</p>
        </div>

        <div className="bg-slate-900/80 backdrop-blur-xl border border-slate-800 rounded-2xl shadow-2xl p-8">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">District or school name</label>
              <input
                required
                value={districtName}
                onChange={(e) => handleDistrictChange(e.target.value)}
                placeholder="Springfield Unified School District"
                className="w-full px-4 py-3 bg-slate-800/50 border border-slate-700 rounded-xl text-sm text-white placeholder:text-slate-500 focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Workspace slug</label>
              <input
                required
                value={slug}
                onChange={(e) => { setSlug(slugify(e.target.value)); setSlugTouched(true); }}
                placeholder="springfield"
                className="w-full px-4 py-3 bg-slate-800/50 border border-slate-700 rounded-xl text-sm text-white placeholder:text-slate-500 focus:ring-2 focus:ring-indigo-500 font-mono"
              />
              <p className="text-xs text-slate-500 mt-1">Used in your workspace URL. Letters, numbers, and dashes only.</p>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Admin email</label>
              <input
                type="email"
                required
                autoComplete="email"
                value={adminEmail}
                onChange={(e) => setAdminEmail(e.target.value)}
                placeholder="you@school.edu"
                className="w-full px-4 py-3 bg-slate-800/50 border border-slate-700 rounded-xl text-sm text-white placeholder:text-slate-500 focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Password</label>
              <input
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
                className="w-full px-4 py-3 bg-slate-800/50 border border-slate-700 rounded-xl text-sm text-white placeholder:text-slate-500 focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Confirm password</label>
              <input
                type="password"
                required
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full px-4 py-3 bg-slate-800/50 border border-slate-700 rounded-xl text-sm text-white placeholder:text-slate-500 focus:ring-2 focus:ring-indigo-500"
              />
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
              className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold py-3 px-4 rounded-xl flex items-center justify-center gap-2"
            >
              {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Creating…</> : 'Create workspace'}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-slate-500 mt-6">
          Already have an account? <Link className="text-indigo-400 hover:text-indigo-300" href="/login">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
