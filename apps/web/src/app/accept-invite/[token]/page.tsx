"use client";

import { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import { MonitorPlay, Loader2, AlertCircle } from 'lucide-react';
import { API_URL } from '@/lib/api-url';
import { useUIStore } from '@/store/ui-store';

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
        else setPreviewError(data.message || 'This invite link is not valid.');
      } catch {
        if (!cancelled) setPreviewError(`Can't reach the server at ${API_URL}.`);
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    if (password !== confirm) { setError('Passwords do not match.'); return; }

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
      } else {
        setError(data.message || 'Could not accept the invitation.');
      }
    } catch {
      setError(`Can't reach the server at ${API_URL}.`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-indigo-500/10 border border-indigo-500/20 rounded-2xl mb-4">
            <MonitorPlay className="w-8 h-8 text-indigo-400" />
          </div>
          <h1 className="text-2xl font-bold text-white">Accept your invitation</h1>
        </div>

        <div className="bg-slate-900/80 backdrop-blur-xl border border-slate-800 rounded-2xl shadow-2xl p-8">
          {previewError ? (
            <div className="flex items-start gap-2 px-3 py-2.5 bg-red-500/10 border border-red-500/20 rounded-xl">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <p className="text-xs text-red-300 font-medium">{previewError}</p>
            </div>
          ) : !preview ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="w-6 h-6 text-indigo-400 animate-spin" />
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="rounded-xl bg-slate-800/40 border border-slate-700 p-4 text-xs text-slate-300 space-y-1">
                <p><span className="text-slate-500">Workspace:</span> <span className="font-semibold text-white">{preview.tenantName}</span></p>
                <p><span className="text-slate-500">Email:</span> {preview.email}</p>
                <p><span className="text-slate-500">Role:</span> {preview.role}</p>
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
                  className="w-full px-4 py-3 bg-slate-800/50 border border-slate-700 rounded-xl text-sm text-white focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Confirm password</label>
                <input
                  type="password"
                  required
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="w-full px-4 py-3 bg-slate-800/50 border border-slate-700 rounded-xl text-sm text-white focus:ring-2 focus:ring-indigo-500"
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
                {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Joining…</> : 'Join workspace'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
