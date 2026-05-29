"use client";

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import {
  ShieldCheck,
  ShieldOff,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Copy,
  Download,
  KeyRound,
} from 'lucide-react';
import {
  useMfaEnroll,
  useMfaVerify,
  useMfaDisable,
  useMfaRegenerateBackupCodes,
  type MfaEnrollResponse,
} from '@/hooks/use-api';

/**
 * MfaCard — enroll / manage TOTP two-factor auth for the signed-in user.
 *
 * Drives the already-built, audited backend at
 * apps/api/src/auth/mfa.controller.ts:
 *   enroll → QR (rendered client-side from the otpauth URL) + manual
 *   secret → user types a code → verify → backup codes shown ONCE →
 *   enabled. Plus Disable (password re-auth) + Regenerate backup codes.
 *
 * NOTE (reported contract gap, 2026-05-28): there is no GET endpoint
 * that returns "is MFA enabled for me", so on a cold page load this card
 * can't know the persisted state. It therefore starts in an "offer to
 * enable" posture and reacts to what the backend actually says:
 *  - clicking Enable when already enrolled → backend 400 MFA_ALREADY_ENABLED
 *    → we flip the card to the "enabled / manage" view.
 *  - completing verify → enabled.
 *  - disabling → back to the enable posture.
 * A small `GET /auth/mfa/status` would let this reflect persisted state
 * across reloads; flagged to the backend owner.
 */

type View = 'idle' | 'enrolling' | 'codes' | 'enabled';

function friendlyError(err: any, fallback: string): string {
  // apiFetch attaches err.code + err.message from the normalized envelope.
  return (err && (err.message as string)) || fallback;
}

export function MfaCard() {
  const [view, setView] = useState<View>('idle');
  const [error, setError] = useState<string | null>(null);

  // Enrollment artifacts (shown once).
  const [enroll, setEnroll] = useState<MfaEnrollResponse | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [verifyCode, setVerifyCode] = useState('');

  // Backup codes (shown once, after verify OR regenerate).
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [copiedCodes, setCopiedCodes] = useState(false);

  // Disable / regenerate password re-auth.
  const [showDisable, setShowDisable] = useState(false);
  const [showRegen, setShowRegen] = useState(false);
  const [password, setPassword] = useState('');

  const enrollMut = useMfaEnroll();
  const verifyMut = useMfaVerify();
  const disableMut = useMfaDisable();
  const regenMut = useMfaRegenerateBackupCodes();

  // Render the otpauth URL into a scannable QR data-URL whenever a new
  // enrollment arrives. qrcode.toDataURL is a pure client computation —
  // the secret never round-trips for QR rendering.
  useEffect(() => {
    let cancelled = false;
    if (enroll?.otpauthUrl) {
      QRCode.toDataURL(enroll.otpauthUrl, { width: 220, margin: 1 })
        .then((url) => { if (!cancelled) setQrDataUrl(url); })
        .catch(() => { if (!cancelled) setQrDataUrl(null); });
    } else {
      setQrDataUrl(null);
    }
    return () => { cancelled = true; };
  }, [enroll?.otpauthUrl]);

  const handleEnable = async () => {
    setError(null);
    try {
      const data = await enrollMut.mutateAsync();
      setEnroll(data);
      setVerifyCode('');
      setView('enrolling');
    } catch (err: any) {
      // Already enrolled — surface the manage view rather than a dead-end.
      if (err?.code === 'MFA_ALREADY_ENABLED') {
        setView('enabled');
        return;
      }
      setError(friendlyError(err, 'Could not start two-factor setup. Try again.'));
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const code = verifyCode.trim();
    if (!code) {
      setError('Enter the 6-digit code from your authenticator app.');
      return;
    }
    try {
      const res = await verifyMut.mutateAsync({ code });
      setBackupCodes(res.backupCodes);
      setEnroll(null);
      setQrDataUrl(null);
      setVerifyCode('');
      setView('codes');
    } catch (err: any) {
      setError(friendlyError(err, 'That code did not match. Try the current code from your app.'));
    }
  };

  const handleDisable = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!password) {
      setError('Enter your password to disable two-factor.');
      return;
    }
    try {
      await disableMut.mutateAsync({ password });
      setPassword('');
      setShowDisable(false);
      setBackupCodes(null);
      setView('idle');
    } catch (err: any) {
      setError(friendlyError(err, 'Could not disable two-factor. Check your password.'));
    }
  };

  const handleRegen = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!password) {
      setError('Enter your password to generate new backup codes.');
      return;
    }
    try {
      const res = await regenMut.mutateAsync({ password });
      setBackupCodes(res.backupCodes);
      setPassword('');
      setShowRegen(false);
      setView('codes');
    } catch (err: any) {
      setError(friendlyError(err, 'Could not regenerate backup codes. Check your password.'));
    }
  };

  const copyCodes = async () => {
    if (!backupCodes) return;
    try {
      await navigator.clipboard.writeText(backupCodes.join('\n'));
      setCopiedCodes(true);
      setTimeout(() => setCopiedCodes(false), 1500);
    } catch { /* ignore */ }
  };

  const downloadCodes = () => {
    if (!backupCodes) return;
    const blob = new Blob(
      [
        'VenueOS two-factor backup codes\n',
        'Each code works once. Store them somewhere safe.\n\n',
        backupCodes.join('\n'),
        '\n',
      ],
      { type: 'text/plain' },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'venueos-backup-codes.txt';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      {/* Header row */}
      <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
            view === 'enabled' || view === 'codes' ? 'bg-emerald-50' : 'bg-slate-100'
          }`}>
            {view === 'enabled' || view === 'codes' ? (
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
            ) : (
              <KeyRound className="w-4 h-4 text-slate-500" />
            )}
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-slate-800 flex items-center gap-2">
              Two-factor authentication
              {(view === 'enabled' || view === 'codes') && (
                <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                  On
                </span>
              )}
            </h2>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Require a code from your authenticator app each time you sign in.
            </p>
          </div>
        </div>
        {view === 'idle' && (
          <button
            type="button"
            onClick={handleEnable}
            disabled={enrollMut.isPending}
            className="shrink-0 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 transition-colors disabled:opacity-60"
          >
            {enrollMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
            Enable 2FA
          </button>
        )}
      </div>

      <div className="p-6 space-y-5">
        {error && (
          <div className="flex items-start gap-2 px-3 py-2.5 bg-rose-50 border border-rose-200 rounded-lg">
            <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
            <p className="text-xs text-rose-700 font-medium">{error}</p>
          </div>
        )}

        {/* ── IDLE ─────────────────────────────────────────────── */}
        {view === 'idle' && (
          <p className="text-xs text-slate-500 leading-relaxed">
            Two-factor authentication adds a second step to sign-in using a free
            authenticator app (Google Authenticator, 1Password, Authy). After you
            enable it, you&apos;ll enter a 6-digit code alongside your password.
          </p>
        )}

        {/* ── ENROLLING (QR + verify) ──────────────────────────── */}
        {view === 'enrolling' && enroll && (
          <div className="space-y-5">
            <ol className="text-xs text-slate-600 space-y-1.5 list-decimal list-inside">
              <li>Open your authenticator app and add a new account.</li>
              <li>Scan this QR code (or enter the key manually).</li>
              <li>Type the 6-digit code it shows to confirm.</li>
            </ol>

            <div className="flex flex-col sm:flex-row items-center gap-5">
              <div className="shrink-0 rounded-xl border border-slate-200 p-3 bg-white">
                {qrDataUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={qrDataUrl} alt="Two-factor QR code" width={180} height={180} className="block" />
                ) : (
                  <div className="w-[180px] h-[180px] flex items-center justify-center text-slate-300">
                    <Loader2 className="w-6 h-6 animate-spin" />
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0 w-full">
                <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Manual entry key</p>
                <div className="flex items-center gap-2">
                  <code className="text-xs text-slate-700 select-all break-all flex-1 bg-slate-50 rounded-lg px-2.5 py-2 font-mono">
                    {enroll.secret}
                  </code>
                  <button
                    type="button"
                    onClick={() => { navigator.clipboard?.writeText(enroll.secret); }}
                    aria-label="Copy setup key"
                    className="text-slate-400 hover:text-indigo-500 transition-colors shrink-0"
                  >
                    <Copy className="w-4 h-4" />
                  </button>
                </div>
                <p className="text-[11px] text-slate-400 mt-2">
                  Account: <span className="font-medium text-slate-500">{enroll.label}</span>
                </p>
              </div>
            </div>

            <form onSubmit={handleVerify} className="space-y-3">
              <div>
                <label htmlFor="mfa-verify-code" className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Enter the 6-digit code
                </label>
                <input
                  id="mfa-verify-code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="123456"
                  value={verifyCode}
                  onChange={(e) => setVerifyCode(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-lg text-base font-mono tracking-[0.4em] text-center text-slate-900 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                />
              </div>
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={verifyMut.isPending}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-bold rounded-lg inline-flex items-center gap-2"
                >
                  {verifyMut.isPending ? <><Loader2 className="w-4 h-4 animate-spin" /> Verifying…</> : 'Verify & turn on'}
                </button>
                <button
                  type="button"
                  onClick={() => { setView('idle'); setEnroll(null); setError(null); }}
                  className="px-4 py-2 text-slate-500 hover:text-slate-700 text-xs font-semibold"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {/* ── CODES (show once) ────────────────────────────────── */}
        {view === 'codes' && backupCodes && (
          <div className="space-y-4">
            <div className="flex items-start gap-2 px-3 py-2.5 bg-emerald-50 border border-emerald-200 rounded-lg">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <p className="text-xs text-emerald-800 font-medium">
                Two-factor is on. Save these backup codes now — they let you sign in if
                you lose your phone. Each works once and they won&apos;t be shown again.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 rounded-xl border border-slate-200 bg-slate-50 p-4">
              {backupCodes.map((c) => (
                <code key={c} className="text-sm font-mono text-slate-700 select-all text-center">
                  {c}
                </code>
              ))}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={copyCodes}
                className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg inline-flex items-center gap-1.5"
              >
                {copiedCodes ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                {copiedCodes ? 'Copied' : 'Copy codes'}
              </button>
              <button
                type="button"
                onClick={downloadCodes}
                className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg inline-flex items-center gap-1.5"
              >
                <Download className="w-4 h-4" /> Download
              </button>
              <button
                type="button"
                onClick={() => { setBackupCodes(null); setView('enabled'); }}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg ml-auto"
              >
                I&apos;ve saved them
              </button>
            </div>
          </div>
        )}

        {/* ── ENABLED (manage) ─────────────────────────────────── */}
        {view === 'enabled' && (
          <div className="space-y-4">
            <p className="text-xs text-slate-500 leading-relaxed">
              Two-factor authentication is on for your account. You&apos;ll be asked for a
              code from your authenticator app whenever you sign in.
            </p>

            {/* Regenerate backup codes */}
            {!showRegen ? (
              <button
                type="button"
                onClick={() => { setShowRegen(true); setShowDisable(false); setError(null); setPassword(''); }}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold"
              >
                <KeyRound className="w-4 h-4" /> Regenerate backup codes
              </button>
            ) : (
              <form onSubmit={handleRegen} className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-3">
                <p className="text-xs font-semibold text-slate-700">Confirm your password to generate new backup codes</p>
                <p className="text-[11px] text-slate-500">This invalidates any unused codes you have now.</p>
                <input
                  type="password"
                  autoComplete="current-password"
                  placeholder="Your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={regenMut.isPending}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-bold rounded-lg inline-flex items-center gap-2"
                  >
                    {regenMut.isPending ? <><Loader2 className="w-4 h-4 animate-spin" /> Working…</> : 'Generate new codes'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowRegen(false); setPassword(''); setError(null); }}
                    className="px-4 py-2 text-slate-500 hover:text-slate-700 text-xs font-semibold"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}

            {/* Disable */}
            {!showDisable ? (
              <button
                type="button"
                onClick={() => { setShowDisable(true); setShowRegen(false); setError(null); setPassword(''); }}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-bold"
              >
                <ShieldOff className="w-4 h-4" /> Disable 2FA
              </button>
            ) : (
              <form onSubmit={handleDisable} className="rounded-lg border border-rose-200 bg-rose-50/60 p-4 space-y-3">
                <p className="text-xs font-semibold text-rose-800">Confirm your password to turn off two-factor</p>
                <input
                  type="password"
                  autoComplete="current-password"
                  placeholder="Your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-rose-300 rounded-lg"
                />
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={disableMut.isPending}
                    className="px-4 py-2 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-xs font-bold rounded-lg inline-flex items-center gap-2"
                  >
                    {disableMut.isPending ? <><Loader2 className="w-4 h-4 animate-spin" /> Disabling…</> : 'Disable 2FA'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowDisable(false); setPassword(''); setError(null); }}
                    className="px-4 py-2 text-slate-500 hover:text-slate-700 text-xs font-semibold"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}

            <p className="text-[11px] text-slate-400">
              Already set up on another device?{' '}
              <button
                type="button"
                onClick={() => { setView('idle'); setError(null); }}
                className="font-semibold text-indigo-600 hover:text-indigo-700"
              >
                Start over
              </button>
              .
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
